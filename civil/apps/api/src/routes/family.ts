import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { EnableFamilyModeInput, FamilyMemberInput, MediaAssetIdSchema } from '@civil/shared'
import { z } from 'zod'

const FamilyFriendRequestInput = z
  .object({
    username: z.string().trim().max(40).optional(),
    inviteCode: z.string().trim().max(40).optional(),
  })
  .refine((value) => Boolean(value.username?.trim() || value.inviteCode?.trim()), {
    message: 'username_or_invite_code_required',
    path: ['username'],
  })

type FamilyRoutesDeps = Record<string, any>

type FamilyNotificationRelationship = {
  relationship: string
  createdAt: string
}

type ReverseStoredRelationshipRow = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  familyType: string | null
}

export function registerFamilyRoutes(app: FastifyInstance, deps: FamilyRoutesDeps) {
  function safeFormatFamilyInteractivePost(
    post: any,
    log: FastifyRequest['log'],
    options: {
      viewerId?: string
      viewerReaction?: unknown
      viewerPollOptionId?: unknown
      recentComments?: unknown[]
    },
  ) {
    try {
      return deps.formatPost(post, options)
    } catch (error) {
      log.error({ err: error, postId: post?.id }, 'family_feed_post_format_failed')
      return null
    }
  }

  function normalizeFamilyFeedImages(images: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(images)) return []
    return images.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  }

  function toFamilyBadgeLabel(value?: string | null, fallback = 'Family') {
    const normalized = value?.trim()
    if (!normalized) return fallback

    return normalized
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
      .join(' ')
  }

  function formatAudienceFamilyFeedPost(
    post: any,
    log: FastifyRequest['log'],
    options: {
      badgeLabel: string
      target: {
        id: string
        name: string
        relationshipLabel: string
        modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
        modeLabel: string
      }
      viewerId?: string
      viewerReaction?: unknown
      viewerPollOptionId?: unknown
      recentComments?: unknown[]
    },
  ) {
    const formattedPost = safeFormatFamilyInteractivePost(post, log, {
      viewerId: options.viewerId,
      viewerReaction: options.viewerReaction,
      viewerPollOptionId: options.viewerPollOptionId,
      recentComments: options.recentComments,
    })
    const author = post?.author
    const authorName = author?.name?.trim() || author?.handle || 'Family'

    return {
      ...(formattedPost ?? {}),
      id: post.id,
      body: post.body,
      images: normalizeFamilyFeedImages(post.images),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      author: {
        id: author?.id ?? post.authorId,
        handle: author?.handle ?? null,
        name: authorName,
        avatarUrl: author?.avatarUrl ?? null,
        coverUrl: author?.coverUrl ?? null,
        badgeLabel: options.badgeLabel,
      },
      target: options.target,
    }
  }

  async function loadAcceptedNotificationRelationshipMap(userId: string, excludedUserIds?: Set<string>): Promise<Map<string, FamilyNotificationRelationship>> {
    try {
      const notifications = await prisma.notification.findMany({
        where: {
          OR: [{ userId }, { actorId: userId }],
          type: { in: ['profile_family_invite', 'profile_family_invite_response'] },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
        select: {
          userId: true,
          actorId: true,
          payload: true,
          createdAt: true,
        },
      })

      const relationshipMap = new Map<string, FamilyNotificationRelationship>()

      for (const notification of notifications) {
        const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
        if (!payload) continue

        const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : ''
        if (status !== 'accepted') continue

        const relationship = typeof payload.relationship === 'string' ? payload.relationship.trim() : ''
        if (!relationship) continue

        const relatedUserId = notification.userId === userId ? notification.actorId : notification.userId
        if (!relatedUserId || relatedUserId === userId || excludedUserIds?.has(relatedUserId)) continue
        if (!relationshipMap.has(relatedUserId)) {
          relationshipMap.set(relatedUserId, {
            relationship,
            createdAt: notification.createdAt.toISOString(),
          })
        }
      }

      return relationshipMap
    } catch (error) {
      console.error('accepted_family_notification_relationships_load_failed', error)
      return new Map<string, FamilyNotificationRelationship>()
    }
  }

  async function loadReverseStoredProfileRelationships(userId: string, excludedUserIds?: Set<string>): Promise<ReverseStoredRelationshipRow[]> {
    try {
      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT DISTINCT ON (u.id)
          u.id,
          u.handle,
          u.name,
          u."avatarUrl",
          u."coverUrl",
          rel.value->>'familyType' AS "familyType"
        FROM "User" u
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u."communityMeta"->'profileFamilyRelationships', '[]'::jsonb)) AS rel(value)
        WHERE u.id <> ${userId}
          AND rel.value->>'relatedUserId' = ${userId}
        ORDER BY u.id, u.name ASC NULLS LAST, u.handle ASC
      `)) as ReverseStoredRelationshipRow[]

      return rows.filter((row: ReverseStoredRelationshipRow) => !excludedUserIds?.has(row.id))
    } catch (error) {
      console.error('reverse_profile_family_relationships_load_failed', error)
      return []
    }
  }

  app.get('/family', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    let user: any = null
    let familyMemberDrafts: Array<{ id: string; createdAt: Date; updatedAt: Date }> = []
    let usedLegacyFamilyMemberSchema = false

    try {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          communityMeta: true,
          familyMembers: {
            orderBy: [{ createdAt: 'asc' }],
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              relationship: true,
              friendCode: true,
              username: true,
              avatarUrl: true,
              coverUrl: true,
              allowChildOwnMediaEdits: true,
              allowChildOwnUsernameEdits: true,
              notifyParentOnMediaChanges: true,
              suspendedAt: true,
              suspendedById: true,
              suspensionNote: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      })
    } catch (error) {
      if (!deps.isFamilyMemberTableMissing(error)) throw error
      usedLegacyFamilyMemberSchema = true
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          communityMeta: true,
          familyMembers: {
            orderBy: [{ createdAt: 'asc' }],
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              relationship: true,
              friendCode: true,
              suspendedAt: true,
              suspendedById: true,
              suspensionNote: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      })
    }

    if (!user) return reply.code(404).send({ error: 'not_found' })

    try {
      familyMemberDrafts = await prisma.familyMemberDraft.findMany({
        where: { parentId: userId },
        orderBy: [{ updatedAt: 'desc' }],
        take: 1,
        select: { id: true, createdAt: true, updatedAt: true },
      })
    } catch (error) {
      if (!deps.isFamilyMemberTableMissing(error)) throw error
      familyMemberDrafts = []
    }

    const eligibility = deps.isParentProfileEligibleForFamilyMode(user)
    const familyMode = deps.parseCommunityMeta(user.communityMeta ?? null)?.familyMode ?? null
    const [latestPostAtByMember, profileRelationships] = await Promise.all([
      deps.loadLatestFamilyPostAtByMember(userId, user.familyMembers.map((member: any) => member.id)),
      deps.loadProfileFamilyRelationshipsForRail(user.communityMeta),
    ])

    const storedRelationshipIds = new Set<string>(profileRelationships.map((entry: { id: string }) => entry.id))
    const [notificationRelationshipMap, reverseStoredRelationships] = await Promise.all([
      loadAcceptedNotificationRelationshipMap(userId, storedRelationshipIds),
      loadReverseStoredProfileRelationships(userId, storedRelationshipIds),
    ])

    let notificationDerivedRelationships: Array<{
      id: string
      handle: string
      displayName: string
      relationshipLabel: string
      avatarUrl: string | null
      coverUrl: string | null
      latestPostAt: string | null
    }> = []

    if (notificationRelationshipMap.size > 0) {
      try {
        const relatedUserIds = [...notificationRelationshipMap.keys()]
        const [relatedUsers, latestPostAtByUser] = await Promise.all([
          prisma.user.findMany({
            where: { id: { in: relatedUserIds } },
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          }),
          deps.loadLatestPublicPostAtByUsers(relatedUserIds),
        ])

        notificationDerivedRelationships = relatedUsers.flatMap((relatedUser: (typeof relatedUsers)[number]) => {
          const relationshipMeta = notificationRelationshipMap.get(relatedUser.id)
          if (!relationshipMeta) return []

          return [{
            id: relatedUser.id,
            handle: relatedUser.handle,
            displayName: relatedUser.name?.trim() || relatedUser.handle,
            relationshipLabel: deps.profileFamilyRelationshipLabels[relationshipMeta.relationship] ?? relationshipMeta.relationship,
            avatarUrl: deps.normalizeMediaUrl(relatedUser.avatarUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(relatedUser.coverUrl ?? null),
            latestPostAt: latestPostAtByUser.get(relatedUser.id) ?? null,
          }]
        })
      } catch (error) {
        console.error('accepted_family_notification_relationship_profiles_load_failed', error)
      }
    }

    let reverseStoredRelationshipItems: Array<{
      id: string
      handle: string
      displayName: string
      relationshipLabel: string
      avatarUrl: string | null
      coverUrl: string | null
      latestPostAt: string | null
    }> = []

    if (reverseStoredRelationships.length > 0) {
      try {
        const latestPostAtByUser = await deps.loadLatestPublicPostAtByUsers(reverseStoredRelationships.map((entry: ReverseStoredRelationshipRow) => entry.id))
        reverseStoredRelationshipItems = reverseStoredRelationships.map((relatedUser: ReverseStoredRelationshipRow) => ({
          id: relatedUser.id,
          handle: relatedUser.handle,
          displayName: relatedUser.name?.trim() || relatedUser.handle,
          relationshipLabel: deps.profileFamilyRelationshipLabels[relatedUser.familyType ?? ''] ?? toFamilyBadgeLabel(relatedUser.familyType),
          avatarUrl: deps.normalizeMediaUrl(relatedUser.avatarUrl ?? null),
          coverUrl: deps.normalizeMediaUrl(relatedUser.coverUrl ?? null),
          latestPostAt: latestPostAtByUser.get(relatedUser.id) ?? null,
        }))
      } catch (error) {
        console.error('reverse_family_relationship_profiles_load_failed', error)
      }
    }

    const mergedProfileRelationships = Array.from(
      new Map(
        [...profileRelationships, ...notificationDerivedRelationships, ...reverseStoredRelationshipItems].map((entry) => [entry.id, entry]),
      ).values(),
    ).sort((left, right) => {
      const leftTime = left.latestPostAt ? new Date(left.latestPostAt).getTime() : 0
      const rightTime = right.latestPostAt ? new Date(right.latestPostAt).getTime() : 0
      if (rightTime !== leftTime) return rightTime - leftTime
      return left.displayName.localeCompare(right.displayName)
    })

    return reply.send({
      profileEligibility: { ...eligibility, complete: Object.values(eligibility).every(Boolean) },
      familyMode: {
        enabled: Boolean(familyMode?.enabledAt),
        enabledAt: familyMode?.enabledAt ?? null,
        affirmedProfileTruthAt: familyMode?.affirmedProfileTruthAt ?? null,
        acceptedChildSafetyInfoAt: familyMode?.acceptedChildSafetyInfoAt ?? null,
      },
      limits: { maxMembers: 8 },
      childSafetyInfoUrl: '/privacy',
      pendingDraft: familyMemberDrafts[0] ? deps.normalizeFamilyMemberDraftSummary(familyMemberDrafts[0]) : null,
      members: user.familyMembers.map((member: any) => {
        const summary = deps.normalizeFamilyMemberSummary(
          usedLegacyFamilyMemberSchema
            ? {
                ...member,
                username: deps.getLegacyFamilyMemberStoredUsername(user?.communityMeta, member.id),
                ...deps.getLegacyFamilyMemberStoredProfileMedia(user?.communityMeta, member.id),
                ...deps.getLegacyFamilyMemberPermissionSettings(user?.communityMeta, member.id),
              }
            : member,
        )
        return { ...summary, latestPostAt: latestPostAtByMember.get(member.id) ?? null }
      }),
      profileRelationships: mergedProfileRelationships,
    })
  })

  app.put('/family', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = EnableFamilyModeInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, communityMeta: true } })
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

    const eligibility = deps.isParentProfileEligibleForFamilyMode(user)
    if (!Object.values(eligibility).every(Boolean)) {
      return reply.code(400).send({ error: 'family_profile_incomplete', eligibility: { ...eligibility, complete: false } })
    }

    const baseMeta = deps.readBaseCommunityMeta(user.communityMeta ?? null)
    const nowIso = new Date().toISOString()
    baseMeta.familyMode = { enabledAt: nowIso, affirmedProfileTruthAt: nowIso, acceptedChildSafetyInfoAt: nowIso }

    await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta as Prisma.InputJsonValue } })

    return reply.send({
      ok: true,
      familyMode: { enabled: true, enabledAt: nowIso, affirmedProfileTruthAt: nowIso, acceptedChildSafetyInfoAt: nowIso },
    })
  })

  app.post('/family/members/draft', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    let parent: any = null
    try {
      parent = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          communityMeta: true,
          _count: { select: { familyMembers: true } },
          familyMemberDrafts: { orderBy: [{ updatedAt: 'desc' }], take: 1, select: { id: true, createdAt: true, updatedAt: true } },
        },
      })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }

    if (!parent) return reply.code(404).send({ error: 'not_found' })
    if (deps.isAccountSuspended(parent.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

    const eligibility = deps.isParentProfileEligibleForFamilyMode(parent)
    if (!Object.values(eligibility).every(Boolean)) return reply.code(400).send({ error: 'family_profile_incomplete' })
    const familyMode = deps.parseCommunityMeta(parent.communityMeta ?? null)?.familyMode
    if (!familyMode?.enabledAt) return reply.code(400).send({ error: 'family_mode_not_enabled' })
    if (parent._count.familyMembers >= 8) return reply.code(400).send({ error: 'family_member_limit_reached' })

    let draft: any
    try {
      const [, createdDraft] = await prisma.$transaction([
        prisma.familyMemberDraft.deleteMany({ where: { parentId: userId } }),
        prisma.familyMemberDraft.create({ data: { parentId: userId }, select: { id: true, createdAt: true, updatedAt: true } }),
      ])
      draft = createdDraft
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }

    return reply.code(201).send({ ok: true, draft: deps.normalizeFamilyMemberDraftSummary(draft) })
  })

  app.get('/family/members/editor/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    try {
      const existingMember = await deps.loadFamilyMemberSummaryForParent(params.data.id, userId)
      if (existingMember) return reply.send({ ok: true, item: { kind: 'member', ...deps.normalizeFamilyMemberSummary(existingMember) } })

      let existingDraft: any = null
      try {
        existingDraft = await prisma.familyMemberDraft.findFirst({
          where: { id: params.data.id, parentId: userId },
          select: { id: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, createdAt: true, updatedAt: true },
        })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
      }

      if (!existingDraft) return reply.code(404).send({ error: 'family_member_not_found' })
      return reply.send({ ok: true, item: deps.normalizeFamilyMemberDraftEditorRecord(existingDraft) })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
  })

  app.put('/family/members/editor/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const parse = FamilyMemberInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const parsedDate = deps.parseFamilyMemberDateOfBirth(parse.data.dateOfBirth)
    if ('error' in parsedDate) return reply.code(400).send({ error: parsedDate.error })

    try {
      const existingMember = await deps.loadFamilyMemberSummaryForParent(params.data.id, userId)
      if (existingMember) {
        const member = await deps.updateFamilyMemberSummaryForParent({
          memberId: params.data.id,
          parentId: userId,
          firstName: parse.data.firstName.trim(),
          lastName: parse.data.lastName.trim(),
          dateOfBirth: parsedDate.dateOfBirth,
          relationship: parse.data.relationship,
          allowChildOwnMediaEdits: parse.data.allowChildOwnMediaEdits,
          allowChildOwnUsernameEdits: parse.data.allowChildOwnUsernameEdits,
          allowChildAudioCalls: parse.data.allowChildAudioCalls,
          allowChildVideoCalls: parse.data.allowChildVideoCalls,
          notifyParentOnMediaChanges: parse.data.notifyParentOnMediaChanges,
        })
        if (!member) return reply.code(404).send({ error: 'family_member_not_found' })
        return reply.send({ ok: true, kind: 'member', member: deps.normalizeFamilyMemberSummary(member) })
      }

      let existingDraft: any = null
      try {
        existingDraft = await prisma.familyMemberDraft.findFirst({ where: { id: params.data.id, parentId: userId }, select: { id: true } })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
      }
      if (!existingDraft) return reply.code(404).send({ error: 'family_member_not_found' })

      const parent = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, communityMeta: true, _count: { select: { familyMembers: true } } },
      })
      if (!parent) return reply.code(404).send({ error: 'not_found' })
      if (deps.isAccountSuspended(parent.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const eligibility = deps.isParentProfileEligibleForFamilyMode(parent)
      if (!Object.values(eligibility).every(Boolean)) return reply.code(400).send({ error: 'family_profile_incomplete' })
      const familyMode = deps.parseCommunityMeta(parent.communityMeta ?? null)?.familyMode
      if (!familyMode?.enabledAt) return reply.code(400).send({ error: 'family_mode_not_enabled' })
      if (parent._count.familyMembers >= 8) return reply.code(400).send({ error: 'family_member_limit_reached' })

      const member = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const friendCode = await deps.generateUniqueFamilyFriendCode()
        const created = await tx.familyMember.create({
          data: {
            parentId: userId,
            firstName: parse.data.firstName.trim(),
            lastName: parse.data.lastName.trim(),
            dateOfBirth: parsedDate.dateOfBirth,
            relationship: parse.data.relationship,
            allowChildOwnMediaEdits: parse.data.allowChildOwnMediaEdits,
            allowChildOwnUsernameEdits: parse.data.allowChildOwnUsernameEdits,
            allowChildAudioCalls: parse.data.allowChildAudioCalls,
            allowChildVideoCalls: parse.data.allowChildVideoCalls,
            notifyParentOnMediaChanges: parse.data.notifyParentOnMediaChanges,
            friendCode,
            username: await deps.generateUniqueFamilyMemberUsername(parse.data.firstName.trim(), parse.data.lastName.trim()),
          } as any,
        })
        await tx.familyMemberDraft.delete({ where: { id: params.data.id } })
        return created
      })

      return reply.send({ ok: true, kind: 'member', member: deps.normalizeFamilyMemberSummary(member) })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
  })

  app.post('/family/members', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = FamilyMemberInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    let parent: any = null
    try {
      parent = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, communityMeta: true, _count: { select: { familyMembers: true } } },
      })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }

    if (!parent) return reply.code(404).send({ error: 'not_found' })
    if (deps.isAccountSuspended(parent.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })
    const eligibility = deps.isParentProfileEligibleForFamilyMode(parent)
    if (!Object.values(eligibility).every(Boolean)) return reply.code(400).send({ error: 'family_profile_incomplete' })
    const familyMode = deps.parseCommunityMeta(parent.communityMeta ?? null)?.familyMode
    if (!familyMode?.enabledAt) return reply.code(400).send({ error: 'family_mode_not_enabled' })
    if (parent._count.familyMembers >= 8) return reply.code(400).send({ error: 'family_member_limit_reached' })

    const parsedDate = deps.parseFamilyMemberDateOfBirth(parse.data.dateOfBirth)
    if ('error' in parsedDate) return reply.code(400).send({ error: parsedDate.error })

    let member: any
    try {
      const friendCode = await deps.generateUniqueFamilyFriendCode()
      member = await prisma.familyMember.create({
        data: {
          parentId: userId,
          firstName: parse.data.firstName.trim(),
          lastName: parse.data.lastName.trim(),
          dateOfBirth: parsedDate.dateOfBirth,
          relationship: parse.data.relationship,
          allowChildOwnMediaEdits: parse.data.allowChildOwnMediaEdits,
          allowChildOwnUsernameEdits: parse.data.allowChildOwnUsernameEdits,
          allowChildAudioCalls: parse.data.allowChildAudioCalls,
          allowChildVideoCalls: parse.data.allowChildVideoCalls,
          notifyParentOnMediaChanges: parse.data.notifyParentOnMediaChanges,
          friendCode,
          username: await deps.generateUniqueFamilyMemberUsername(parse.data.firstName.trim(), parse.data.lastName.trim()),
        },
        select: {
          id: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
          username: true, avatarUrl: true, coverUrl: true, allowChildOwnMediaEdits: true, allowChildOwnUsernameEdits: true,
          allowChildAudioCalls: true, allowChildVideoCalls: true, notifyParentOnMediaChanges: true,
          suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
        },
      })
    } catch (error) {
      if (!deps.isFamilyMemberTableMissing(error)) throw error
      const friendCode = await deps.generateUniqueFamilyFriendCode()
      const createdLegacyMember = await prisma.familyMember.create({
        data: {
          parentId: userId,
          firstName: parse.data.firstName.trim(),
          lastName: parse.data.lastName.trim(),
          dateOfBirth: parsedDate.dateOfBirth,
          relationship: parse.data.relationship,
          friendCode,
        },
        select: {
          id: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
          suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
        },
      })

      const baseMeta = deps.readBaseCommunityMeta(parent.communityMeta ?? null)
      deps.writeLegacyFamilyMemberPermissionSettings(baseMeta, createdLegacyMember.id, {
        allowChildOwnMediaEdits: parse.data.allowChildOwnMediaEdits,
        allowChildOwnUsernameEdits: parse.data.allowChildOwnUsernameEdits,
        allowChildAudioCalls: parse.data.allowChildAudioCalls,
        allowChildVideoCalls: parse.data.allowChildVideoCalls,
        notifyParentOnMediaChanges: parse.data.notifyParentOnMediaChanges,
      })
      deps.writeLegacyFamilyMemberUsername(
        baseMeta,
        createdLegacyMember.id,
        await deps.generateUniqueFamilyMemberUsername(parse.data.firstName.trim(), parse.data.lastName.trim()),
      )
      await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta as Prisma.InputJsonValue } })

      member = {
        ...createdLegacyMember,
        username: deps.getLegacyFamilyMemberStoredUsername(baseMeta as Prisma.JsonValue, createdLegacyMember.id),
        avatarUrl: null,
        coverUrl: null,
        allowChildOwnMediaEdits: parse.data.allowChildOwnMediaEdits,
        allowChildOwnUsernameEdits: parse.data.allowChildOwnUsernameEdits,
        allowChildAudioCalls: parse.data.allowChildAudioCalls,
        allowChildVideoCalls: parse.data.allowChildVideoCalls,
        notifyParentOnMediaChanges: parse.data.notifyParentOnMediaChanges,
      }
    }

    return reply.code(201).send({ ok: true, member: deps.normalizeFamilyMemberSummary(member) })
  })

  app.put('/family/members/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
    const parse = FamilyMemberInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const existing = await deps.loadFamilyMemberSummaryForParent(params.data.id, userId)
    if (!existing) return reply.code(404).send({ error: 'family_member_not_found' })

    const parsedDate = deps.parseFamilyMemberDateOfBirth(parse.data.dateOfBirth)
    if ('error' in parsedDate) return reply.code(400).send({ error: parsedDate.error })

    let member: any
    try {
      member = await deps.updateFamilyMemberSummaryForParent({
        memberId: params.data.id,
        parentId: userId,
        firstName: parse.data.firstName.trim(),
        lastName: parse.data.lastName.trim(),
        dateOfBirth: parsedDate.dateOfBirth,
        relationship: parse.data.relationship,
        allowChildOwnMediaEdits: parse.data.allowChildOwnMediaEdits,
        allowChildOwnUsernameEdits: parse.data.allowChildOwnUsernameEdits,
        allowChildAudioCalls: parse.data.allowChildAudioCalls,
        allowChildVideoCalls: parse.data.allowChildVideoCalls,
        notifyParentOnMediaChanges: parse.data.notifyParentOnMediaChanges,
      })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
    if (!member) return reply.code(404).send({ error: 'family_member_not_found' })

    return reply.send({ ok: true, member: deps.normalizeFamilyMemberSummary(member) })
  })

  app.post('/family/members/:id/suspend', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    try {
      const existing = await deps.loadFamilyMemberSummaryForParent(params.data.id, userId)
      if (!existing) return reply.code(404).send({ error: 'family_member_not_found' })
      if (existing.suspendedAt) return reply.code(400).send({ error: 'family_member_already_suspended' })

      const displayName = `${existing.firstName} ${existing.lastName}`.trim()
      const member = await prisma.familyMember.update({
        where: { id: existing.id },
        data: { suspendedAt: new Date(), suspendedById: userId, suspensionNote: deps.buildFamilySuspensionMessage(displayName) },
        select: {
          id: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
          suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
        },
      })
      return reply.send({ ok: true, member: deps.normalizeFamilyMemberSummary(member) })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
  })

  app.post('/family/members/:id/restore', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    try {
      const existing = await deps.loadFamilyMemberSummaryForParent(params.data.id, userId)
      if (!existing) return reply.code(404).send({ error: 'family_member_not_found' })
      if (!existing.suspendedAt) return reply.code(400).send({ error: 'family_member_not_suspended' })

      const member = await prisma.familyMember.update({
        where: { id: existing.id },
        data: { suspendedAt: null, suspendedById: null, suspensionNote: null },
        select: {
          id: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
          suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
        },
      })
      return reply.send({ ok: true, member: deps.normalizeFamilyMemberSummary(member) })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
  })

  app.post('/family/members/:id/lock-device-session', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const parent = await deps.loadAuthenticatedUser(req)
    if (!parent) return reply.code(401).send({ error: 'unauthorized' })

    let member: any
    try {
      member = await deps.loadFamilyMemberAuthViewerById(params.data.id, parent.id)
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
    if (!member) return reply.code(404).send({ error: 'family_member_not_found' })

    const token = await (app as any).jwt.sign({ sub: member.id, actor: 'family_member', parentId: parent.id })
    const homeCommunity = await deps.buildHomeCommunitySummaryForUserId(parent.id)
    return reply.send({ ok: true, token, viewer: deps.buildFamilyMemberAuthMeResponse(member, homeCommunity) })
  })

  app.get('/family/feed/posts', async (req: FastifyRequest, reply: FastifyReply) => {
    const authContext = await deps.loadViewerAuthContext(req)
    if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

    const query = z.object({ memberId: z.string().trim().min(1).optional() }).safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    if (authContext.actor === 'user' && !query.data.memberId) {
      const viewerUser = await prisma.user.findUnique({
        where: { id: authContext.userId },
        select: {
          id: true,
          name: true,
          handle: true,
          communityMeta: true,
        },
      })
      if (!viewerUser) return reply.code(404).send({ error: 'not_found' })

      const storedRelationships = deps.getStoredProfileFamilyRelationships(viewerUser.communityMeta)
      const storedRelationshipLabels = new Map<string, string>(
        storedRelationships
          .filter((entry: any) => typeof entry?.relatedUserId === 'string' && entry.relatedUserId.trim().length > 0)
          .map((entry: any) => [entry.relatedUserId, toFamilyBadgeLabel(entry.familyType)]),
      )
      const storedRelatedUserIds = storedRelationships.map((entry: any) => entry.relatedUserId).filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      const reverseStoredRelationships = await loadReverseStoredProfileRelationships(authContext.userId)
      const reverseStoredRelationshipTypes = new Map<string, string | null>(reverseStoredRelationships.map((entry: ReverseStoredRelationshipRow) => [entry.id, entry.familyType]))
      const notificationRelationships = await loadAcceptedNotificationRelationshipMap(authContext.userId)
      const notificationRelatedUserIds = [...notificationRelationships.keys()]

      const relatedUserIds = Array.from(new Set<string>([...storedRelatedUserIds, ...notificationRelatedUserIds, ...reverseStoredRelationships.map((entry: ReverseStoredRelationshipRow) => entry.id)]))

      await deps.syncLegacyParentFamilyFeedPosts(authContext.userId)

      let members: any[] = []
      try {
        members = await prisma.familyMember.findMany({
          where: { parentId: authContext.userId, suspendedAt: null },
          orderBy: [{ createdAt: 'asc' }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            relationship: true,
            friendCode: true,
            username: true,
            avatarUrl: true,
            coverUrl: true,
            allowChildOwnMediaEdits: true,
            allowChildOwnUsernameEdits: true,
            allowChildAudioCalls: true,
            allowChildVideoCalls: true,
            notifyParentOnMediaChanges: true,
            suspendedAt: true,
            suspendedById: true,
            suspensionNote: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
      }

      const normalizedMembers = members.map((member: any) => deps.normalizeFamilyMemberSummary(member))
      const memberIds = normalizedMembers.map((member: any) => member.id)
      const authorIds = Array.from(new Set([authContext.userId, ...relatedUserIds]))
      const [audiencePosts, memberPosts] = await Promise.all([
        prisma.post.findMany({
          where: { authorId: { in: authorIds }, audience: 'family', type: { not: deps.FAMILY_FEED_POST_TYPE }, visibility: 'public' },
          orderBy: [{ createdAt: 'desc' }],
          take: 40,
          include: deps.POST_INCLUDE,
        }),
        memberIds.length
          ? prisma.post.findMany({
              where: {
                authorId: authContext.userId,
                type: deps.FAMILY_FEED_POST_TYPE,
                title: { in: memberIds.map((memberId: string) => deps.buildFamilyFeedPostTitle(memberId)) },
              },
              orderBy: [{ createdAt: 'desc' }],
              take: 40,
              include: deps.POST_INCLUDE,
            })
          : Promise.resolve([]),
      ])

      const allPosts = [...audiencePosts, ...memberPosts]
      if (!allPosts.length) return reply.send({ items: [] })

      const familyTarget = {
        id: viewerUser.id,
        name: viewerUser.name?.trim() || viewerUser.handle || 'Family circle',
        relationshipLabel: 'Family circle',
        modeBand: 'ADULT' as const,
        modeLabel: 'Family',
      }
      const memberMap = new Map(normalizedMembers.map((member: any) => [member.id, member]))

      let reactionsByPost: Record<string, unknown> = {}
      let pollSelectionsByPost: Record<string, unknown> = {}
      let recentCommentsByPost: Record<string, unknown[]> = {}
      try {
        const formattingContext = await deps.loadViewerPostFormattingContext(authContext.userId, allPosts.map((post: any) => post.id), 5)
        reactionsByPost = formattingContext.reactionsByPost
        pollSelectionsByPost = formattingContext.pollSelectionsByPost
        recentCommentsByPost = formattingContext.recentCommentsByPost
      } catch (error) {
        req.log.error({ err: error }, 'family_feed_context_load_failed')
      }

      const items = [
        ...audiencePosts.map((post: any) =>
          formatAudienceFamilyFeedPost(post, req.log, {
            badgeLabel:
              post.authorId === authContext.userId
                ? 'Parent'
                : storedRelationshipLabels.get(post.authorId) ||
                  toFamilyBadgeLabel(notificationRelationships.get(post.authorId)?.relationship, '') ||
                  toFamilyBadgeLabel(reverseStoredRelationshipTypes.get(post.authorId), 'Family'),
            target: familyTarget,
            viewerId: authContext.userId,
            viewerReaction: reactionsByPost[post.id] ?? null,
            viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
            recentComments: recentCommentsByPost[post.id] ?? [],
          }),
        ),
        ...memberPosts.flatMap((post: any) => {
          const memberId = typeof post.title === 'string' && post.title.startsWith('family-feed:')
            ? post.title.slice('family-feed:'.length)
            : null
          const member = memberId ? memberMap.get(memberId) : null
          if (!member) return []

          return [
            deps.formatChildFamilyFeedPost(memberId ? { id: post.id, familyMemberId: memberId, body: post.body, images: post.images, createdAt: post.createdAt, updatedAt: post.updatedAt } : post, member, safeFormatFamilyInteractivePost(post, req.log, {
              viewerId: authContext.userId,
              viewerReaction: reactionsByPost[post.id] ?? null,
              viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
              recentComments: recentCommentsByPost[post.id] ?? [],
            })),
          ]
        }),
      ]

      return reply.send({
        items: items
          .sort((left: any, right: any) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .slice(0, 40),
      })
    }

    const targetMember = await deps.resolveReadableFamilyFeedTargetMember(authContext, query.data.memberId)
    if (!targetMember) {
      return reply.code(authContext.actor === 'user' ? 400 : 404).send({ error: authContext.actor === 'user' ? 'family_member_required' : 'family_member_not_found' })
    }

    await deps.syncLegacyParentFamilyFeedPosts(targetMember.parentId)

    const rows = await prisma.post.findMany({
      where: { authorId: targetMember.parentId, type: deps.FAMILY_FEED_POST_TYPE, title: deps.buildFamilyFeedPostTitle(targetMember.id) },
      orderBy: [{ createdAt: 'desc' }], take: 40,
      include: deps.POST_INCLUDE,
    })

    const storedRelationships = deps.getStoredProfileFamilyRelationships(targetMember.parent.communityMeta)
    const storedRelationshipLabels = new Map<string, string>(
      storedRelationships
        .filter((entry: any) => typeof entry?.relatedUserId === 'string' && entry.relatedUserId.trim().length > 0)
        .map((entry: any) => [entry.relatedUserId, toFamilyBadgeLabel(entry.familyType)]),
    )
    const reverseStoredRelationships = await loadReverseStoredProfileRelationships(targetMember.parentId)
    const reverseStoredRelationshipTypes = new Map<string, string | null>(reverseStoredRelationships.map((entry: ReverseStoredRelationshipRow) => [entry.id, entry.familyType]))
    const notificationRelationships = await loadAcceptedNotificationRelationshipMap(targetMember.parentId)
    const familyAudienceAuthorIds = Array.from(new Set<string>([
      targetMember.parentId,
      ...storedRelationships.map((entry: any) => entry.relatedUserId).filter(Boolean),
      ...notificationRelationships.keys(),
      ...reverseStoredRelationships.map((entry: ReverseStoredRelationshipRow) => entry.id),
    ]))
    const audiencePosts = await prisma.post.findMany({
      where: {
        authorId: { in: familyAudienceAuthorIds },
        audience: 'family',
        type: { not: deps.FAMILY_FEED_POST_TYPE },
        visibility: 'public',
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 40,
      include: deps.POST_INCLUDE,
    })

    const viewerId = authContext.actor === 'user' ? authContext.userId : undefined
    let reactionsByPost: Record<string, unknown> = {}
    let pollSelectionsByPost: Record<string, unknown> = {}
    let recentCommentsByPost: Record<string, unknown[]> = {}
    try {
      const formattingContext = await deps.loadViewerPostFormattingContext(viewerId, [...rows, ...audiencePosts].map((row: any) => row.id), 5)
      reactionsByPost = formattingContext.reactionsByPost
      pollSelectionsByPost = formattingContext.pollSelectionsByPost
      recentCommentsByPost = formattingContext.recentCommentsByPost
    } catch (error) {
      req.log.error({ err: error, memberId: targetMember.id }, 'family_member_feed_context_load_failed')
    }

    let parentRows: any[] = []
    try {
      parentRows = await prisma.familyFeedPost.findMany({
        where: { parentId: targetMember.parentId, familyMemberId: targetMember.id },
        orderBy: [{ createdAt: 'desc' }], take: 40,
        select: { id: true, familyMemberId: true, body: true, images: true, createdAt: true, updatedAt: true },
      })
    } catch (error) {
      if (!deps.isSchemaOutOfDateError(error)) throw error
    }

    const normalizedMember = deps.normalizeFamilyMemberSummary(targetMember)
    const mirroredKeys = new Set(rows.map((row: any) => deps.buildLegacyFamilyFeedMirrorKey({ memberId: targetMember.id, body: row.body, createdAt: row.createdAt, images: row.images })))
    const items = [
      ...audiencePosts.map((post: any) =>
        formatAudienceFamilyFeedPost(post, req.log, {
          badgeLabel:
            post.authorId === targetMember.parentId
              ? 'Parent'
              : storedRelationshipLabels.get(post.authorId) ||
                toFamilyBadgeLabel(notificationRelationships.get(post.authorId)?.relationship, '') ||
                toFamilyBadgeLabel(reverseStoredRelationshipTypes.get(post.authorId), 'Family'),
          target: {
            id: normalizedMember.id,
            name: normalizedMember.displayName,
            relationshipLabel: normalizedMember.relationshipLabel,
            modeBand: normalizedMember.modeBand,
            modeLabel: normalizedMember.modeLabel,
          },
          viewerId,
          viewerReaction: reactionsByPost[post.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
          recentComments: recentCommentsByPost[post.id] ?? [],
        }),
      ),
      ...rows.map((row: any) => deps.formatChildFamilyFeedPost(
        { id: row.id, familyMemberId: targetMember.id, body: row.body, images: row.images, createdAt: row.createdAt, updatedAt: row.updatedAt },
        normalizedMember,
        safeFormatFamilyInteractivePost(row, req.log, {
          viewerId,
          viewerReaction: reactionsByPost[row.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[row.id] ?? null,
          recentComments: recentCommentsByPost[row.id] ?? [],
        }),
      )),
      ...parentRows
        .filter((row: any) => !mirroredKeys.has(deps.buildLegacyFamilyFeedMirrorKey({ memberId: row.familyMemberId, body: row.body, createdAt: row.createdAt, images: row.images })))
        .map((row: any) => deps.formatParentFamilyFeedPost(row, normalizedMember, targetMember.parent)),
    ].sort((left: any, right: any) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 40)

    return reply.send({ items })
  })

  app.post('/family/feed/posts', async (req: FastifyRequest, reply: FastifyReply) => {
    const authContext = await deps.loadViewerAuthContext(req)
    if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

    const parse = z.object({ memberId: z.string().trim().min(1).optional(), body: z.string().trim().max(2000).optional().default(''), images: z.array(z.string().trim().url()).max(6).optional().default([]) }).safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    if (authContext.actor === 'user' && !parse.data.memberId) {
      const viewerUser = await prisma.user.findUnique({ where: { id: authContext.userId }, select: { id: true, name: true, communityMeta: true, handle: true } })
      if (!viewerUser) return reply.code(404).send({ error: 'not_found' })

      const relatedUserIds = Array.from(new Set(deps.getStoredProfileFamilyRelationships(viewerUser.communityMeta).map((entry: any) => entry.relatedUserId).filter(Boolean)))
      const activeMemberCount = await prisma.familyMember.count({ where: { parentId: authContext.userId, suspendedAt: null } }).catch((error: unknown) => {
        if (deps.isFamilyMemberTableMissing(error)) return 0
        throw error
      })
      if (!relatedUserIds.length && activeMemberCount === 0) return reply.code(400).send({ error: 'family_audience_unavailable' })

      const body = deps.sanitizePlainText(parse.data.body)
      const images = parse.data.images.filter(Boolean)
      if (!body && images.length === 0) return reply.code(400).send({ error: 'family_feed_post_empty' })

      const slugBase = deps.buildPostSlugBase({ handle: viewerUser.handle, title: undefined, body })
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const seoSlug = await deps.generateUniquePostSlug(slugBase, tx)
        return tx.post.create({
          data: {
            authorId: authContext.userId,
            body,
            images: images.length ? (images as any) : undefined,
            type: images.length ? 'photo' : 'post',
            seoSlug,
            audience: 'family',
            visibility: 'public',
            jurisdiction: 'self',
          },
          include: deps.POST_INCLUDE,
        })
      })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(authContext.userId, [created.id], 5)
      return reply.code(201).send({
        post: formatAudienceFamilyFeedPost(created, req.log, {
          badgeLabel: 'Parent',
          target: {
            id: viewerUser.id,
            name: viewerUser.name?.trim() || viewerUser.handle || 'Family circle',
            relationshipLabel: 'Family circle',
            modeBand: 'ADULT',
            modeLabel: 'Family',
          },
          viewerId: authContext.userId,
          viewerReaction: reactionsByPost[created.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[created.id] ?? null,
          recentComments: recentCommentsByPost[created.id] ?? [],
        }),
      })
    }

    const targetMember = await deps.resolveFamilyFeedTargetMember(authContext, parse.data.memberId)
    if (!targetMember) {
      return reply.code(authContext.actor === 'user' ? 400 : 404).send({ error: authContext.actor === 'user' ? 'family_member_required' : 'family_member_not_found' })
    }

    const body = deps.sanitizePlainText(parse.data.body)
    const images = parse.data.images.filter(Boolean)
    if (!body && images.length === 0) return reply.code(400).send({ error: 'family_feed_post_empty' })

    const created = await prisma.post.create({
      data: {
        authorId: targetMember.parentId,
        body,
        images: images.length ? (images as any) : undefined,
        type: deps.FAMILY_FEED_POST_TYPE,
        title: deps.buildFamilyFeedPostTitle(targetMember.id),
        audience: 'family',
        visibility: 'public',
        jurisdiction: 'self',
      },
      include: deps.POST_INCLUDE,
    })

    const normalizedMember = deps.normalizeFamilyMemberSummary(targetMember)
    const viewerId = authContext.actor === 'user' ? authContext.userId : undefined
    let reactionsByPost: Record<string, unknown> = {}
    let pollSelectionsByPost: Record<string, unknown> = {}
    let recentCommentsByPost: Record<string, unknown[]> = {}
    try {
      const formattingContext = await deps.loadViewerPostFormattingContext(viewerId, [created.id], 5)
      reactionsByPost = formattingContext.reactionsByPost
      pollSelectionsByPost = formattingContext.pollSelectionsByPost
      recentCommentsByPost = formattingContext.recentCommentsByPost
    } catch (error) {
      req.log.error({ err: error, postId: created.id }, 'family_feed_created_post_context_load_failed')
    }

    return reply.code(201).send({
      post: deps.formatChildFamilyFeedPost(
        { id: created.id, familyMemberId: targetMember.id, body: created.body, images: created.images, createdAt: created.createdAt, updatedAt: created.updatedAt },
        normalizedMember,
        safeFormatFamilyInteractivePost(created, req.log, {
          viewerId,
          viewerReaction: reactionsByPost[created.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[created.id] ?? null,
          recentComments: recentCommentsByPost[created.id] ?? [],
        }),
      ),
    })
  })

  app.post('/family/friends/requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      if (authContext.actor !== 'family_member') return reply.code(403).send({ error: 'family_member_required' })

      const parse = FamilyFriendRequestInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const vagueResponse = { ok: true, message: "An invite has been sent to this user's parent or guardian if it exists." }
      const inviteCode = parse.data.inviteCode?.trim() ?? ''
      const username = parse.data.username?.trim() ?? ''

      let targetMember: any = null
      if (inviteCode) targetMember = await deps.findFamilyMemberByInviteCode(inviteCode)
      if (!targetMember && username) targetMember = await deps.findFamilyMemberByUsername(username)

      if (!targetMember) return reply.send(vagueResponse)
      if (targetMember.id === authContext.member.id || targetMember.parentId === authContext.member.parentId) return reply.send(vagueResponse)

      const requesterFriendships = deps.getStoredFamilyFriendships(authContext.member.parent.communityMeta)
      const targetFriendships = deps.getStoredFamilyFriendships(targetMember.parent.communityMeta)
      if (
        deps.hasAcceptedFamilyFriendship(requesterFriendships, authContext.member.id, targetMember.id) ||
        deps.hasAcceptedFamilyFriendship(targetFriendships, targetMember.id, authContext.member.id)
      ) return reply.send(vagueResponse)

      const requesterRequests = deps.getStoredFamilyFriendRequests(authContext.member.parent.communityMeta)
      const targetRequests = deps.getStoredFamilyFriendRequests(targetMember.parent.communityMeta)
      if (
        deps.findPendingFamilyFriendRequest(requesterRequests, authContext.member.id, targetMember.id) ||
        deps.findPendingFamilyFriendRequest(targetRequests, authContext.member.id, targetMember.id)
      ) return reply.send(vagueResponse)

      const requesterSummary = deps.normalizeFamilyMemberSummary(authContext.member)
      const targetSummary = deps.normalizeFamilyMemberSummary(targetMember)
      const requestId = randomUUID()
      const createdAt = new Date().toISOString()
      const requestRecord = {
        id: requestId,
        requesterParentId: authContext.member.parentId,
        requesterMemberId: authContext.member.id,
        requesterDisplayName: requesterSummary.displayName,
        requesterUsername: requesterSummary.username,
        requesterAvatarUrl: requesterSummary.avatarUrl ?? null,
        requesterCoverUrl: requesterSummary.coverUrl ?? null,
        requesterParentHandle: authContext.member.parent.handle,
        requesterParentName: authContext.member.parent.name,
        requesterParentAvatarUrl: authContext.member.parent.avatarUrl ?? null,
        requesterParentCoverUrl: authContext.member.parent.coverUrl ?? null,
        targetParentId: targetMember.parentId,
        targetMemberId: targetMember.id,
        targetDisplayName: targetSummary.displayName,
        targetUsername: targetSummary.username,
        targetAvatarUrl: targetSummary.avatarUrl ?? null,
        targetCoverUrl: targetSummary.coverUrl ?? null,
        status: 'pending',
        createdAt,
        respondedAt: null,
      }

      const requesterBaseMeta = deps.readBaseCommunityMeta(authContext.member.parent.communityMeta ?? null)
      deps.writeStoredFamilyFriendRequests(requesterBaseMeta, deps.upsertFamilyFriendRequest(requesterRequests, requestRecord))
      const targetBaseMeta = deps.readBaseCommunityMeta(targetMember.parent.communityMeta ?? null)
      deps.writeStoredFamilyFriendRequests(targetBaseMeta, deps.upsertFamilyFriendRequest(targetRequests, requestRecord))

      await prisma.$transaction([
        prisma.user.update({ where: { id: authContext.member.parentId }, data: { communityMeta: requesterBaseMeta as Prisma.InputJsonValue } }),
        prisma.user.update({ where: { id: targetMember.parentId }, data: { communityMeta: targetBaseMeta as Prisma.InputJsonValue } }),
      ])

      await deps.createNotificationRecord({
        userId: targetMember.parentId,
        actorId: authContext.member.parentId,
        type: deps.FAMILY_NOTIFICATION_TYPES.FRIEND_REQUEST,
        payload: {
          requestId,
          status: 'pending',
          url: '/notifications',
          sourceUrl: '/notifications',
          requesterChild: {
            id: requesterSummary.id,
            displayName: requesterSummary.displayName,
            username: requesterSummary.username,
            avatarUrl: requesterSummary.avatarUrl,
            coverUrl: requesterSummary.coverUrl,
          },
          targetChild: {
            id: targetSummary.id,
            displayName: targetSummary.displayName,
            username: targetSummary.username,
            avatarUrl: targetSummary.avatarUrl,
            coverUrl: targetSummary.coverUrl,
          },
        },
      })

      return reply.send(vagueResponse)
    }),
  )

  app.get('/family/username/check', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      if (authContext.actor !== 'family_member') return reply.code(403).send({ error: 'family_member_required' })

      const query = z.object({ username: z.string().trim().min(1).max(40) }).safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const username = deps.normalizeFamilyMemberUsernameCandidate(query.data.username)
      if (!deps.isValidFamilyMemberUsername(username)) {
        return reply.code(400).send({
          error: 'family_member_username_invalid',
          requirements: {
            min: deps.FAMILY_MEMBER_USERNAME_MIN_LENGTH,
            max: deps.FAMILY_MEMBER_USERNAME_MAX_LENGTH,
            pattern: 'letters_and_numbers_only',
          },
        })
      }

      const currentUsername = deps.normalizeFamilyMemberUsernameLookup(authContext.member.username ?? '')
      if (currentUsername && currentUsername === deps.normalizeFamilyMemberUsernameLookup(username)) {
        return reply.send({ ok: true, username, available: true })
      }

      const available = !(await deps.isFamilyMemberUsernameTaken(username, { excludeMemberId: authContext.member.id }))
      return reply.send({ ok: true, username, available })
    }),
  )

  app.put('/family/username', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      if (authContext.actor !== 'family_member') return reply.code(403).send({ error: 'family_member_required' })
      if (!authContext.member.allowChildOwnUsernameEdits) return reply.code(403).send({ error: 'family_member_username_edit_not_allowed' })

      const parse = z.object({ username: z.string().trim().min(1).max(40) }).safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const username = deps.normalizeFamilyMemberUsernameCandidate(parse.data.username)
      if (!deps.isValidFamilyMemberUsername(username)) {
        return reply.code(400).send({
          error: 'family_member_username_invalid',
          requirements: {
            min: deps.FAMILY_MEMBER_USERNAME_MIN_LENGTH,
            max: deps.FAMILY_MEMBER_USERNAME_MAX_LENGTH,
            pattern: 'letters_and_numbers_only',
          },
        })
      }

      const currentUsername = deps.normalizeFamilyMemberUsernameLookup(authContext.member.username ?? '')
      if (currentUsername !== deps.normalizeFamilyMemberUsernameLookup(username)) {
        const taken = await deps.isFamilyMemberUsernameTaken(username, { excludeMemberId: authContext.member.id })
        if (taken) return reply.code(409).send({ error: 'family_member_username_taken' })
      }

      let updatedMember: any = null
      try {
        updatedMember = await prisma.familyMember.update({
          where: { id: authContext.member.id },
          data: { username },
          select: {
            id: true, parentId: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
            username: true, avatarUrl: true, coverUrl: true, allowChildOwnMediaEdits: true, allowChildOwnUsernameEdits: true,
            notifyParentOnMediaChanges: true, suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
          },
        })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
        const parent = await prisma.user.findUnique({ where: { id: authContext.member.parentId }, select: { communityMeta: true } })
        const baseMeta = deps.readBaseCommunityMeta(parent?.communityMeta ?? null)
        deps.writeLegacyFamilyMemberUsername(baseMeta, authContext.member.id, username)
        await prisma.user.update({ where: { id: authContext.member.parentId }, data: { communityMeta: baseMeta as Prisma.InputJsonValue } })
        updatedMember = { ...authContext.member, username }
      }

      if (!updatedMember) return reply.code(500).send({ error: 'family_member_username_update_failed' })

      void deps.createNotificationRecord({
        userId: updatedMember.parentId,
        actorId: updatedMember.id,
        type: deps.FAMILY_NOTIFICATION_TYPES.USERNAME_CHANGED,
        payload: {
          memberId: updatedMember.id,
          childDisplayName: `${updatedMember.firstName} ${updatedMember.lastName}`.trim(),
          username,
          url: '/settings/family/settings',
          sourceUrl: '/settings/family/settings',
        },
      }).catch((error: unknown) => {
        req.log.error({ err: error, memberId: updatedMember?.id }, 'family_username_change_notification_failed')
      })

      const refreshedMember = await deps.loadFamilyMemberAuthViewerById(updatedMember.id, updatedMember.parentId)
      if (!refreshedMember) return reply.code(401).send({ error: 'unauthorized' })
      const homeCommunity = await deps.buildHomeCommunitySummaryForUserId(updatedMember.parentId)

      return reply.send({
        ok: true,
        username,
        member: deps.normalizeFamilyMemberSummary(updatedMember),
        viewer: deps.buildFamilyMemberAuthMeResponse(refreshedMember, homeCommunity),
      })
    }),
  )

  app.delete('/family/members/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const bodyParse = z.object({ confirmationName: z.string().trim().min(1).max(120) }).safeParse(req.body ?? {})
    if (!bodyParse.success) return reply.code(400).send({ error: bodyParse.error.flatten() })

    const existing = await deps.loadFamilyMemberSummaryForParent(params.data.id, userId)
    if (!existing) return reply.code(404).send({ error: 'family_member_not_found' })

    const expectedName = `${existing.firstName} ${existing.lastName}`.trim().toLowerCase()
    const providedName = bodyParse.data.confirmationName.trim().toLowerCase()
    if (expectedName !== providedName) return reply.code(400).send({ error: 'family_member_confirmation_mismatch' })

    try {
      await prisma.familyMember.delete({ where: { id: params.data.id } })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }

    try {
      const parent = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
      const baseMeta = deps.readBaseCommunityMeta(parent?.communityMeta ?? null)
      const nextSettings =
        baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
          ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
          : null

      if (nextSettings && Object.prototype.hasOwnProperty.call(nextSettings, params.data.id)) {
        delete nextSettings[params.data.id]
        baseMeta.familyMemberSettings = nextSettings
        await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta as Prisma.InputJsonValue } })
      }
    } catch (error) {
      req.log.error({ err: error, memberId: params.data.id, userId }, 'family_member_legacy_settings_cleanup_failed')
    }

    return reply.send({ ok: true })
  })

  app.post('/family/members/:id/media', async (req: FastifyRequest, reply: FastifyReply) => {
    const authContext = await deps.loadViewerAuthContext(req)
    if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

    const params = z.object({ id: z.string().cuid() }).safeParse(req.params ?? {})
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const body = z.object({ category: z.enum(['avatar', 'cover']), displayAssetId: MediaAssetIdSchema }).safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    try {
      const member =
        authContext.actor === 'family_member'
          ? await deps.loadFamilyMemberAuthViewerById(params.data.id, authContext.member.parentId)
          : await deps.loadFamilyMemberSummaryForParent(params.data.id, authContext.userId)

      if (!member) return reply.code(404).send({ error: 'family_member_not_found' })
      if (authContext.actor === 'family_member') {
        if (member.id !== authContext.member.id) return reply.code(403).send({ error: 'family_member_media_edit_not_allowed' })
        if (!member.allowChildOwnMediaEdits) return reply.code(403).send({ error: 'family_member_media_edit_not_allowed' })
      }

      const asset = await prisma.mediaAsset.findFirst({ where: { id: body.data.displayAssetId, ownerId: member.parentId, category: body.data.category } })
      if (!asset) return reply.code(404).send({ error: 'display_asset_not_found' })
      if (asset.status === 'failed') return reply.code(400).send({ error: 'display_asset_failed' })
      if (asset.status !== 'ready') return reply.code(409).send({ error: 'display_asset_not_ready' })
      if (authContext.actor === 'family_member' && !deps.familyMemberOwnsAssetForSession(asset, authContext.member.id)) {
        return reply.code(403).send({ error: 'asset_not_owned_by_family_member' })
      }

      const displayUrl = deps.extractVariantUrl(asset.variants, body.data.category === 'avatar' ? ['avatar@2x', 'avatar@1x', 'avatar-thumb'] : ['cover-xl', 'cover-lg', 'cover-md'])
      if (!displayUrl) return reply.code(400).send({ error: 'display_variant_missing' })

      let updatedMember: any
      try {
        updatedMember = await prisma.familyMember.update({
          where: { id: member.id },
          data: body.data.category === 'avatar' ? { avatarUrl: displayUrl } : { coverUrl: displayUrl },
          select: {
            id: true, parentId: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
            avatarUrl: true, coverUrl: true, allowChildOwnMediaEdits: true, notifyParentOnMediaChanges: true,
            suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
          },
        })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
        const legacyUpdatedMember = await prisma.familyMember.update({
          where: { id: member.id },
          data: body.data.category === 'avatar' ? { avatarUrl: displayUrl } : { coverUrl: displayUrl },
          select: {
            id: true, parentId: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true, friendCode: true,
            avatarUrl: true, coverUrl: true, suspendedAt: true, suspendedById: true, suspensionNote: true, createdAt: true, updatedAt: true,
          },
        })
        updatedMember = { ...legacyUpdatedMember, allowChildOwnMediaEdits: member.allowChildOwnMediaEdits, notifyParentOnMediaChanges: member.notifyParentOnMediaChanges }
      }

      if (authContext.actor === 'family_member' && updatedMember.notifyParentOnMediaChanges) {
        void deps.createNotificationRecord({
          userId: updatedMember.parentId,
          actorId: updatedMember.id,
          type: deps.FAMILY_NOTIFICATION_TYPES.MEDIA_CHANGED,
          payload: {
            memberId: updatedMember.id,
            childDisplayName: `${updatedMember.firstName} ${updatedMember.lastName}`.trim(),
            category: body.data.category,
            url: `/settings/family/edit?id=${encodeURIComponent(updatedMember.id)}`,
            sourceUrl: `/settings/family/edit?id=${encodeURIComponent(updatedMember.id)}`,
          },
        }).catch((error: unknown) => {
          req.log.error({ err: error, memberId: updatedMember?.id }, 'family_media_change_notification_failed')
        })
      }

      if (authContext.actor === 'family_member') {
        const refreshedMember = await deps.loadFamilyMemberAuthViewerById(updatedMember.id, updatedMember.parentId)
        if (!refreshedMember) return reply.code(401).send({ error: 'unauthorized' })
        const homeCommunity = await deps.buildHomeCommunitySummaryForUserId(updatedMember.parentId)
        return reply.send({ ok: true, member: deps.normalizeFamilyMemberSummary(updatedMember), viewer: deps.buildFamilyMemberAuthMeResponse(refreshedMember, homeCommunity) })
      }

      return reply.send({ ok: true, member: deps.normalizeFamilyMemberSummary(updatedMember) })
    } catch (error) {
      if (deps.isFamilyMemberTableMissing(error)) return reply.code(503).send({ error: 'family_mode_not_available' })
      throw error
    }
  })
}