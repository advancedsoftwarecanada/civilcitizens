import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type FamilyRelationship = 'son' | 'daughter' | 'child' | 'stepson' | 'stepdaughter' | 'foster_child' | 'ward' | 'other'

type FamilyFeedPostRecord = {
  id: string
  familyMemberId: string
  parentId: string
  body: string
  images: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}

type ProfileFamilyRelationshipRecord = {
  relatedUserId: string
  relatedName?: string | null
  familyType: string
}

type CreateFamilyFeedHelpersDeps = {
  getStoredProfileFamilyRelationships: (value: Prisma.JsonValue | null | undefined) => ProfileFamilyRelationshipRecord[]
  isSchemaOutOfDateError: (error: unknown) => boolean
  normalizeMediaUrl: (url?: string | null) => string | null
  profileFamilyRelationshipLabels: Record<string, string>
}

export const FAMILY_FEED_POST_TYPE = 'family'

export function createFamilyFeedHelpers(deps: CreateFamilyFeedHelpersDeps) {
  function normalizeFamilyFeedImages(images: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(images)) return []
    return images.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  }

  function buildFamilyFeedPostTitle(memberId: string) {
    return `family-feed:${memberId}`
  }

  function buildLegacyFamilyFeedMirrorKey(args: {
    memberId: string
    body: string
    createdAt: Date
    images: Prisma.JsonValue | null
  }) {
    return JSON.stringify({
      memberId: args.memberId,
      body: args.body,
      createdAt: args.createdAt.toISOString(),
      images: normalizeFamilyFeedImages(args.images),
    })
  }

  async function loadLatestFamilyPostAtByMember(parentId: string, memberIds: string[]) {
    const latestByMember = new Map<string, string>()
    if (!memberIds.length) return latestByMember

    const rows = await Promise.all(
      memberIds.map(async (memberId) => {
        const [postRow, legacyRow] = await Promise.all([
          prisma.post.findFirst({
            where: {
              authorId: parentId,
              type: FAMILY_FEED_POST_TYPE,
              title: buildFamilyFeedPostTitle(memberId),
            },
            orderBy: [{ createdAt: 'desc' }],
            select: { createdAt: true },
          }),
          (async () => {
            try {
              return await prisma.familyFeedPost.findFirst({
                where: {
                  parentId,
                  familyMemberId: memberId,
                },
                orderBy: [{ createdAt: 'desc' }],
                select: { createdAt: true },
              })
            } catch (error) {
              if (!deps.isSchemaOutOfDateError(error)) throw error
              return null
            }
          })(),
        ])

        const timestamps = [postRow?.createdAt, legacyRow?.createdAt]
          .filter((value): value is Date => value instanceof Date)
          .map((value) => value.getTime())
        if (!timestamps.length) return [memberId, null] as const

        return [memberId, new Date(Math.max(...timestamps)).toISOString()] as const
      }),
    )

    for (const [memberId, latestPostAt] of rows) {
      if (latestPostAt) latestByMember.set(memberId, latestPostAt)
    }

    return latestByMember
  }

  async function loadLatestPublicPostAtByUsers(userIds: string[]) {
    const latestByUser = new Map<string, string>()
    if (!userIds.length) return latestByUser

    const rows = await Promise.all(
      userIds.map(async (userId) => {
        let latestDate: Date | null = null
        try {
          const row = await prisma.post.findFirst({
            where: {
              authorId: userId,
              publishedAt: { not: null },
              visibility: 'public',
            },
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              publishedAt: true,
              createdAt: true,
            },
          })
          latestDate = row?.publishedAt ?? row?.createdAt ?? null
        } catch (error) {
          if (!deps.isSchemaOutOfDateError(error)) throw error
          const fallbackRow = await prisma.post.findFirst({
            where: {
              authorId: userId,
            },
            orderBy: [{ createdAt: 'desc' }],
            select: {
              createdAt: true,
            },
          })
          latestDate = fallbackRow?.createdAt ?? null
        }

        return [userId, latestDate ? latestDate.toISOString() : null] as const
      }),
    )

    for (const [userId, latestPostAt] of rows) {
      if (latestPostAt) latestByUser.set(userId, latestPostAt)
    }

    return latestByUser
  }

  async function loadProfileFamilyRelationshipsForRail(value: Prisma.JsonValue | null | undefined) {
    try {
      const relationships = deps.getStoredProfileFamilyRelationships(value)
      if (!relationships.length) return []

      const validRelationships = relationships.filter(
        (entry: ProfileFamilyRelationshipRecord) => typeof entry.relatedUserId === 'string' && entry.relatedUserId.trim().length > 0,
      )
      if (!validRelationships.length) return []

      const dedupedRelationships = Array.from(
        new Map(validRelationships.map((entry: ProfileFamilyRelationshipRecord) => [entry.relatedUserId, entry])).values(),
      )
      const relatedUserIds = dedupedRelationships.map((entry: ProfileFamilyRelationshipRecord) => entry.relatedUserId)
      const [relatedUsers, latestPostAtByUser]: [
        Array<{ id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl: string | null }>,
        Map<string, string>,
      ] = await Promise.all([
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
        loadLatestPublicPostAtByUsers(relatedUserIds),
      ])

      const usersById = new Map(relatedUsers.map((user: (typeof relatedUsers)[number]) => [user.id, user]))

      return dedupedRelationships.flatMap((relationship: ProfileFamilyRelationshipRecord) => {
        const user = usersById.get(relationship.relatedUserId)
        if (!user) return []

        return [
          {
            id: user.id,
            handle: user.handle,
            displayName: user.name?.trim() || relationship.relatedName?.trim() || user.handle,
            relationshipLabel: deps.profileFamilyRelationshipLabels[relationship.familyType] ?? relationship.familyType,
            avatarUrl: deps.normalizeMediaUrl(user.avatarUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(user.coverUrl ?? null),
            latestPostAt: latestPostAtByUser.get(user.id) ?? null,
          },
        ]
      })
    } catch (error) {
      console.error('profile_family_relationship_rail_load_failed', error)
      return []
    }
  }

  async function syncLegacyParentFamilyFeedPosts(parentId: string) {
    try {
      const [legacyRows, mirroredRows]: [
        Array<{
          familyMemberId: string
          body: string
          images: Prisma.JsonValue | null
          createdAt: Date
          updatedAt: Date
        }>,
        Array<{
          title: string
          body: string
          images: Prisma.JsonValue | null
          createdAt: Date
        }>,
      ] = await Promise.all([
        prisma.familyFeedPost.findMany({
          where: { parentId },
          orderBy: [{ createdAt: 'desc' }],
          take: 80,
          select: {
            familyMemberId: true,
            body: true,
            images: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.post.findMany({
          where: {
            authorId: parentId,
            type: FAMILY_FEED_POST_TYPE,
          },
          orderBy: [{ createdAt: 'desc' }],
          take: 200,
          select: {
            title: true,
            body: true,
            images: true,
            createdAt: true,
          },
        }),
      ])

      if (!legacyRows.length) return

      const mirroredKeys = new Set(
        mirroredRows
          .filter((row) => row.title.startsWith('family-feed:'))
          .map((row) =>
            buildLegacyFamilyFeedMirrorKey({
              memberId: row.title.slice('family-feed:'.length),
              body: row.body,
              createdAt: row.createdAt,
              images: row.images,
            }),
          ),
      )

      const missingRows = legacyRows.filter(
        (row) =>
          !mirroredKeys.has(
            buildLegacyFamilyFeedMirrorKey({
              memberId: row.familyMemberId,
              body: row.body,
              createdAt: row.createdAt,
              images: row.images,
            }),
          ),
      )

      if (!missingRows.length) return

      await prisma.$transaction(
        missingRows.map((row) =>
          prisma.post.create({
            data: {
              authorId: parentId,
              body: row.body,
              images: normalizeFamilyFeedImages(row.images).length
                ? (normalizeFamilyFeedImages(row.images) as any)
                : undefined,
              type: FAMILY_FEED_POST_TYPE,
              title: buildFamilyFeedPostTitle(row.familyMemberId),
              audience: 'family',
              visibility: 'public',
              jurisdiction: 'self',
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          }),
        ),
      )
    } catch (error) {
      if (!deps.isSchemaOutOfDateError(error)) throw error
    }
  }

  function formatChildFamilyFeedPost(
    post: Pick<FamilyFeedPostRecord, 'id' | 'familyMemberId' | 'body' | 'images' | 'createdAt' | 'updatedAt'>,
    member: {
      id: string
      username: string | null
      displayName: string
      avatarUrl: string | null
      coverUrl: string | null
      relationshipLabel: string
      modeBand: string
      modeLabel: string
    },
    formattedPost?: Record<string, unknown> | null,
  ) {
    return {
      ...(formattedPost ?? {}),
      id: post.id,
      familyMemberId: post.familyMemberId,
      body: post.body,
      images: normalizeFamilyFeedImages(post.images),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      author: {
        id: member.id,
        handle: member.username,
        name: member.displayName,
        avatarUrl: member.avatarUrl,
        coverUrl: member.coverUrl,
        badgeLabel: member.relationshipLabel,
      },
      target: {
        id: member.id,
        name: member.displayName,
        relationshipLabel: member.relationshipLabel,
        modeBand: member.modeBand,
        modeLabel: member.modeLabel,
      },
    }
  }

  function formatParentFamilyFeedPost(
    post: {
      id: string
      familyMemberId: string
      body: string
      images: Prisma.JsonValue | null
      createdAt: Date
      updatedAt: Date
    },
    member: {
      id: string
      displayName: string
      relationshipLabel: string
      modeBand: string
      modeLabel: string
    },
    author: {
      id: string
      handle: string
      name: string | null
      avatarUrl: string | null
      coverUrl: string | null
    },
    formattedPost?: Record<string, unknown> | null,
  ) {
    const authorName = author.name?.trim() || author.handle || 'Parent'

    return {
      ...(formattedPost ?? {}),
      id: post.id,
      familyMemberId: post.familyMemberId,
      body: post.body,
      images: normalizeFamilyFeedImages(post.images),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      author: {
        id: author.id,
        handle: author.handle,
        name: authorName,
        avatarUrl: deps.normalizeMediaUrl(author.avatarUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(author.coverUrl ?? null),
        badgeLabel: 'Parent',
      },
      target: {
        id: member.id,
        name: member.displayName,
        relationshipLabel: member.relationshipLabel,
        modeBand: member.modeBand,
        modeLabel: member.modeLabel,
      },
    }
  }

  function buildFamilyProfileRelationshipPayload(
    authContext: { actor: 'user' | 'family_member' } | null,
    access: 'self' | 'family' | 'friend' | null,
  ) {
    const friendshipStatus =
      authContext?.actor === 'family_member'
        ? access === 'self'
          ? 'self'
          : access === 'friend'
            ? 'friends'
            : 'none'
        : 'none'

    return {
      friendshipStatus,
      friendshipId: undefined,
      friendshipSince: null,
      connectionStatus: friendshipStatus === 'self' ? 'self' : 'none',
      connectionId: undefined,
      connectionSince: null,
    }
  }

  function normalizeFamilyMemberDraftSummary(draft: { id: string; createdAt: Date; updatedAt: Date }) {
    return {
      id: draft.id,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    }
  }

  function normalizeFamilyMemberDraftEditorRecord(draft: {
    id: string
    firstName: string | null
    lastName: string | null
    dateOfBirth: Date | null
    relationship: FamilyRelationship | null
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      id: draft.id,
      kind: 'draft' as const,
      firstName: draft.firstName ?? '',
      lastName: draft.lastName ?? '',
      relationship: draft.relationship ?? 'son',
      dateOfBirth: draft.dateOfBirth ? draft.dateOfBirth.toISOString().slice(0, 10) : '',
      friendCode: null,
      avatarUrl: null,
      coverUrl: null,
      allowChildOwnMediaEdits: false,
      notifyParentOnMediaChanges: false,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    }
  }

  return {
    buildFamilyFeedPostTitle,
    buildFamilyProfileRelationshipPayload,
    buildLegacyFamilyFeedMirrorKey,
    formatChildFamilyFeedPost,
    formatParentFamilyFeedPost,
    loadLatestFamilyPostAtByMember,
    loadProfileFamilyRelationshipsForRail,
    normalizeFamilyFeedImages,
    normalizeFamilyMemberDraftEditorRecord,
    normalizeFamilyMemberDraftSummary,
    syncLegacyParentFamilyFeedPosts,
  }
}
