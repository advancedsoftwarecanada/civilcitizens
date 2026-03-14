import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma, MessageParticipantRole, MessageThreadType } from '@prisma/client'

type OrgChannelDeps = Record<string, any>

export function registerOrgChannelRoutes(app: FastifyInstance, deps: OrgChannelDeps) {
  app.get('/communities/:province/:municipality/orgs/:slug/channels', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communitySlug = params.data.municipality.trim().toLowerCase()
      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const orgSlug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug },
        select: { id: true, ownerId: true, name: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const [membership, follow, viewer] = await Promise.all([
        prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } }),
        prisma.businessFollow.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { id: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
      ])

      const isOwner = org.ownerId === userId
      const viewerRole = isOwner ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null
      const associated = isOwner || Boolean(membership) || Boolean(follow)
      if (!associated) return reply.code(403).send({ error: 'forbidden' })

      const orgPrefs = deps.readOrgChatPrefs(viewer?.communityMeta ?? null, org.id)

      const threads = await prisma.messageThread.findMany({
        where: {
          type: MessageThreadType.group,
          contextType: deps.ORG_CHANNEL_CONTEXT_TYPE,
          contextId: { startsWith: `${org.id}|` },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }],
      })

      const items = threads
        .map((thread: any) => {
          const parsed = deps.parseOrgChannelContextId(thread.contextId)
          if (!parsed || parsed.orgId !== org.id) return null
          const participant = thread.participants.find((entry: any) => entry.userId === userId)
          if (parsed.visibility === 'private' && !participant && !viewerRole) return null
          const channelPrefs = orgPrefs.channels?.[thread.id] ?? {}
          const unread = thread.messages[0]
            ? participant?.lastReadAt
              ? new Date(thread.messages[0].createdAt).getTime() > new Date(participant.lastReadAt).getTime() && thread.messages[0].senderId !== userId
              : thread.messages[0].senderId !== userId
            : false
          return {
            id: thread.id,
            name: parsed.name,
            slug: parsed.slug,
            visibility: parsed.visibility,
            joined: Boolean(participant),
            isOwner: participant?.role === MessageParticipantRole.admin,
            unread,
            participantCount: thread.participants.length,
            lastMessageAt: thread.lastMessageAt ?? thread.updatedAt,
            lastMessage: thread.messages[0] ? deps.formatMessage(thread.messages[0], userId) : null,
            notification: {
              muteChannel: Boolean(channelPrefs?.muteChannel),
              mentionsOnly: Boolean(channelPrefs?.mentionsOnly),
            },
          }
        })
        .filter(Boolean)

      return reply.send({
        organization: { id: org.id, name: org.name, viewerRole },
        serverNotification: {
          muteServer: Boolean(orgPrefs.muteServer),
          mentionsOnly: Boolean(orgPrefs.mentionsOnly),
        },
        items,
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/channels', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgChannelCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership =
        org.ownerId === userId
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'MANAGER' && membership.role !== 'OWNER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const name = body.data.name.trim()
      const slug = deps.slugifyChannelName(name)
      if (!slug) return reply.code(400).send({ error: 'invalid_channel_name' })
      const uniqueKey = `orgchan:${org.id}:${slug}`
      const now = new Date()

      const existing = await prisma.messageThread.findUnique({ where: { uniqueKey } })
      if (existing) return reply.code(409).send({ error: 'channel_exists' })

      const thread = await prisma.messageThread.create({
        data: {
          type: MessageThreadType.group,
          uniqueKey,
          contextType: deps.ORG_CHANNEL_CONTEXT_TYPE,
          contextId: deps.buildOrgChannelContextId(org.id, body.data.visibility, slug, name),
          lastMessageAt: now,
          participants: {
            create: [{ userId, role: MessageParticipantRole.admin, lastReadAt: now, lastActivityAt: now }],
          },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
      })

      return reply.code(201).send({
        channel: {
          id: thread.id,
          name,
          slug,
          visibility: body.data.visibility,
        },
        thread: deps.formatThreadSummaryRecord(thread, userId),
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/join', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgChannelParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const thread = await prisma.messageThread.findFirst({
        where: { id: params.data.channelId, contextType: deps.ORG_CHANNEL_CONTEXT_TYPE, type: MessageThreadType.group },
        include: deps.THREAD_WITH_PARTICIPANTS_INCLUDE,
      })
      if (!thread) return reply.code(404).send({ error: 'channel_not_found' })

      const parsed = deps.parseOrgChannelContextId(thread.contextId)
      if (!parsed) return reply.code(404).send({ error: 'channel_not_found' })
      if (parsed.visibility === 'private') return reply.code(403).send({ error: 'private_channel_invite_required' })

      if (!thread.participants.some((entry: any) => entry.userId === userId)) {
        await prisma.messageParticipant.create({
          data: {
            threadId: thread.id,
            userId,
            role: MessageParticipantRole.member,
            lastActivityAt: new Date(),
          },
        })
      }

      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/invite', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgChannelParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgChannelInviteBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const thread = await prisma.messageThread.findFirst({
        where: { id: params.data.channelId, contextType: deps.ORG_CHANNEL_CONTEXT_TYPE, type: MessageThreadType.group },
        include: deps.THREAD_WITH_PARTICIPANTS_INCLUDE,
      })
      if (!thread) return reply.code(404).send({ error: 'channel_not_found' })

      const inviter = thread.participants.find((entry: any) => entry.userId === userId)
      if (!inviter || inviter.role !== MessageParticipantRole.admin) {
        return reply.code(403).send({ error: 'only_channel_owner_can_invite' })
      }

      const targetUserId = body.data.userId
      if (thread.participants.some((entry: any) => entry.userId === targetUserId)) {
        return reply.send({ success: true })
      }

      await prisma.messageParticipant.create({
        data: {
          threadId: thread.id,
          userId: targetUserId,
          role: MessageParticipantRole.member,
          lastActivityAt: new Date(),
        },
      })

      const refreshed = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
      if (refreshed) {
        await deps.dispatchRealtimeEvent(targetUserId, {
          type: 'thread.created',
          data: { thread: deps.formatThreadSummaryRecord(refreshed, targetUserId) },
        })
      }

      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/leave', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgChannelParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const participant = await prisma.messageParticipant.findUnique({
        where: { threadId_userId: { threadId: params.data.channelId, userId } },
        select: { role: true },
      })
      if (!participant) return reply.code(404).send({ error: 'not_joined' })
      if (participant.role === MessageParticipantRole.admin) return reply.code(400).send({ error: 'owner_cannot_leave_channel' })

      await prisma.messageParticipant.delete({
        where: { threadId_userId: { threadId: params.data.channelId, userId } },
      })

      await deps.dispatchRealtimeEvent(userId, {
        type: 'thread.removed',
        data: { threadId: params.data.channelId },
      })

      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/notification', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgChannelParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgChannelNotificationBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })
      const thread = await prisma.messageThread.findUnique({ where: { id: params.data.channelId }, select: { contextId: true, contextType: true } })
      if (!thread || thread.contextType !== deps.ORG_CHANNEL_CONTEXT_TYPE) return reply.code(404).send({ error: 'channel_not_found' })
      const parsed = deps.parseOrgChannelContextId(thread.contextId)
      if (!parsed) return reply.code(404).send({ error: 'channel_not_found' })

      const baseMeta = user.communityMeta && typeof user.communityMeta === 'object' && !Array.isArray(user.communityMeta)
        ? ({ ...(user.communityMeta as Record<string, unknown>) } as Record<string, unknown>)
        : {}
      const currentOrgPrefs = deps.readOrgChatPrefs(baseMeta, parsed.orgId)
      const nextChannels = { ...(currentOrgPrefs.channels ?? {}) }
      const channelPrefs = { ...(nextChannels[params.data.channelId] ?? {}) }
      if (typeof body.data.muteChannel === 'boolean') channelPrefs.muteChannel = body.data.muteChannel
      if (typeof body.data.mentionsOnly === 'boolean') channelPrefs.mentionsOnly = body.data.mentionsOnly
      nextChannels[params.data.channelId] = channelPrefs

      const orgChatPrefs = baseMeta.orgChatPrefs && typeof baseMeta.orgChatPrefs === 'object' && !Array.isArray(baseMeta.orgChatPrefs)
        ? ({ ...(baseMeta.orgChatPrefs as Record<string, unknown>) } as Record<string, unknown>)
        : {}
      orgChatPrefs[parsed.orgId] = {
        ...currentOrgPrefs,
        channels: nextChannels,
      }
      baseMeta.orgChatPrefs = orgChatPrefs

      await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta } })
      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/channels/notification', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgServerNotificationBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const baseMeta = user.communityMeta && typeof user.communityMeta === 'object' && !Array.isArray(user.communityMeta)
        ? ({ ...(user.communityMeta as Record<string, unknown>) } as Record<string, unknown>)
        : {}
      const currentOrgPrefs = deps.readOrgChatPrefs(baseMeta, org.id)

      const nextOrgPrefs = {
        ...currentOrgPrefs,
        channels: { ...(currentOrgPrefs.channels ?? {}) },
      }
      if (typeof body.data.muteServer === 'boolean') nextOrgPrefs.muteServer = body.data.muteServer
      if (typeof body.data.mentionsOnly === 'boolean') nextOrgPrefs.mentionsOnly = body.data.mentionsOnly

      const orgChatPrefs = baseMeta.orgChatPrefs && typeof baseMeta.orgChatPrefs === 'object' && !Array.isArray(baseMeta.orgChatPrefs)
        ? ({ ...(baseMeta.orgChatPrefs as Record<string, unknown>) } as Record<string, unknown>)
        : {}
      orgChatPrefs[org.id] = nextOrgPrefs
      baseMeta.orgChatPrefs = orgChatPrefs

      await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta } })
      return reply.send({ success: true })
    }),
  )

  app.get('/org-channels/unread-count', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true, communityMeta: true } })
      if (!user) return reply.send({ count: 0 })

      const threads = await prisma.messageThread.findMany({
        where: {
          contextType: deps.ORG_CHANNEL_CONTEXT_TYPE,
          type: MessageThreadType.group,
          participants: { some: { userId } },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
      })

      let count = 0
      for (const thread of threads) {
        const parsed = deps.parseOrgChannelContextId(thread.contextId)
        if (!parsed) continue
        const orgPrefs = deps.readOrgChatPrefs(user.communityMeta ?? null, parsed.orgId)
        if (orgPrefs.muteServer) continue
        const channelPrefs = orgPrefs.channels?.[thread.id]
        if (channelPrefs?.muteChannel) continue

        const participant = thread.participants.find((entry: any) => entry.userId === userId)
        const lastMessage = thread.messages[0]
        if (!participant || !lastMessage || lastMessage.senderId === userId) continue

        const unread = participant.lastReadAt
          ? new Date(lastMessage.createdAt).getTime() > new Date(participant.lastReadAt).getTime()
          : true
        if (!unread) continue

        const mentionsOnly = channelPrefs?.mentionsOnly ?? orgPrefs.mentionsOnly
        if (mentionsOnly) {
          const needle = `@${user.handle}`.toLowerCase()
          if (!(lastMessage.body ?? '').toLowerCase().includes(needle)) {
            continue
          }
        }

        count += 1
      }

      return reply.send({ count })
    }),
  )

  app.get('/org-channels', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true, communityMeta: true } })
      if (!user) return reply.send({ items: [] })

      const threads = await prisma.messageThread.findMany({
        where: {
          contextType: deps.ORG_CHANNEL_CONTEXT_TYPE,
          type: MessageThreadType.group,
          participants: { some: { userId } },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }],
      })

      type UnreadCountRow = { threadId: string; count: number }
      const threadIds = threads.map((thread: any) => thread.id)
      const unreadRows = threadIds.length
        ? (await prisma.$queryRaw(Prisma.sql`
            SELECT m."threadId" as "threadId", COUNT(*)::int as "count"
            FROM "Message" m
            JOIN "MessageParticipant" mp ON mp."threadId" = m."threadId"
            WHERE mp."userId" = ${userId}
              AND m."threadId" IN (${Prisma.join(threadIds)})
              AND m."senderId" <> ${userId}
              AND m."deletedAt" IS NULL
              AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
            GROUP BY m."threadId"
          `)) as UnreadCountRow[]
        : []
      const unreadCountByThreadId = new Map(
        unreadRows.map((row: UnreadCountRow) => [row.threadId, Number(row.count) || 0]),
      )

      const orgIds = Array.from(
        new Set(
          threads
            .map((thread: any) => deps.parseOrgChannelContextId(thread.contextId)?.orgId ?? null)
            .filter((value: string | null): value is string => Boolean(value)),
        ),
      )

      type OrganizationChannelOrgRow = {
        id: string
        name: string
        slug: string
        provinceCode: string | null
        communitySlug: string | null
        logoUrl: string | null
        coverUrl: string | null
      }

      const orgs: OrganizationChannelOrgRow[] = orgIds.length
        ? await prisma.business.findMany({
            where: { id: { in: orgIds } },
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
              logoUrl: true,
              coverUrl: true,
            },
          })
        : []
      const orgById = new Map<string, OrganizationChannelOrgRow>(orgs.map((org: OrganizationChannelOrgRow) => [org.id, org]))

      const items = threads
        .map((thread: any) => {
          const parsed = deps.parseOrgChannelContextId(thread.contextId)
          if (!parsed) return null
          const org = orgById.get(parsed.orgId)
          if (!org || !org.provinceCode || !org.communitySlug) return null

          const orgPrefs = deps.readOrgChatPrefs(user.communityMeta ?? null, parsed.orgId)
          const channelPrefs = orgPrefs.channels?.[thread.id]

          const lastMessage = thread.messages[0]
          const unreadCount = unreadCountByThreadId.get(thread.id) ?? 0
          const unread = unreadCount > 0

          return {
            id: thread.id,
            name: parsed.name,
            slug: parsed.slug,
            visibility: parsed.visibility,
            unread,
            unreadCount,
            participantCount: thread.participants.length,
            lastMessageAt: thread.lastMessageAt ?? thread.updatedAt,
            notification: {
              muteServer: Boolean(orgPrefs.muteServer),
              muteChannel: Boolean(channelPrefs?.muteChannel),
              mentionsOnly: Boolean(channelPrefs?.mentionsOnly ?? orgPrefs.mentionsOnly),
            },
            lastMessage: lastMessage ? deps.formatMessage(lastMessage, userId) : null,
            organization: {
              id: org.id,
              name: org.name,
              slug: org.slug,
              province: org.provinceCode.toLowerCase(),
              municipality: org.communitySlug,
              logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
              coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
            },
          }
        })
        .filter(Boolean)

      return reply.send({ items })
    }),
  )
}