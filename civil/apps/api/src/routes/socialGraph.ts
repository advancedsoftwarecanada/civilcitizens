import { prisma } from '@civil/db'
import { Prisma, FriendshipStatus } from '@prisma/client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

const FriendRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const FriendshipIdParam = z.object({ id: z.string().cuid() })
const ConnectionRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const ConnectionIdParam = z.object({ id: z.string().trim().min(1).max(120) })
const FriendDeleteParam = z.object({ id: z.string().trim().min(1) })

type RouteActionResult = Promise<unknown | FastifyReply>

type SocialGraphDeps = {
  buildFamilySponsorFriendshipId: (memberId: string) => string
  createNotificationRecord: (data: {
    userId: string
    actorId: string | null
    type: string
    postId?: string | null
    payload?: Prisma.InputJsonValue
    suppressMobilePush?: boolean
  }) => Promise<unknown>
  dispatchNotification: (record: any) => Promise<unknown>
  familyNotificationTypes: {
    FRIEND_REMOVED: string
  }
  findConnectionBetween: (userId: string, targetUserId: string) => Promise<any>
  findConnectionById: (id: string) => Promise<any>
  formatFamilyChildFriendship: (entry: any) => unknown
  formatFamilySponsorFriendship: (member: any) => { id: string }
  formatFriendRequest: (friendship: any, viewerId: string) => unknown
  formatFriendUser: (user: any) => unknown
  formatFriendship: (friendship: any, viewerId: string) => unknown
  friendNotificationTypes: {
    REQUEST: string
  }
  friendUserSelect: Prisma.UserSelect
  friendshipWithUsersInclude: Prisma.FriendshipInclude
  getStoredFamilyFriendships: (value: Prisma.JsonValue | null | undefined) => Array<{ memberId: string }>
  isConnectionTableMissingError: (err: unknown) => boolean
  loadViewerAuthContext: (req: FastifyRequest) => Promise<any>
  normalizeFamilyMemberSummary: (member: any) => { displayName: string }
  notificationSelect: Prisma.NotificationSelect
  notifyConnectionAcceptance: (connectionId: string, requesterId: string, addresseeId: string) => Promise<unknown>
  notifyConnectionRequest: (connectionId: string, requesterId: string, addresseeId: string) => Promise<unknown>
  notifyFriendAcceptance: (friendshipId: string, requesterId: string, addresseeId: string) => Promise<unknown>
  notifyFriendRequest: (friendshipId: string, requesterId: string, addresseeId: string) => Promise<unknown>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, action: () => Promise<unknown>) => RouteActionResult
}

type ConnectionStatusValue = 'PENDING' | 'ACCEPTED' | 'REJECTED'

type ConnectionRow = {
  id: string
  requesterId: string
  addresseeId: string
  status: ConnectionStatusValue
  requestedAt: Date
  respondedAt: Date | null
}

function readNotificationPayloadRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeNotificationRequestStatus(value: unknown): 'pending' | 'accepted' | 'rejected' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'pending') return 'pending'
  if (['accepted', 'accept', 'approved', 'confirmed', 'completed'].includes(normalized)) return 'accepted'
  if (['rejected', 'reject', 'declined', 'dismissed', 'denied', 'cancelled', 'canceled'].includes(normalized)) return 'rejected'
  return null
}

export function registerSocialGraphRoutes(app: FastifyInstance, deps: SocialGraphDeps) {
  const syncResolvedRequestNotifications = async (args: {
    userId: string
    actorId: string
    type: string
    payloadIdKey: 'friendshipId' | 'connectionId'
    entityId: string
    nextStatus: 'accepted' | 'rejected'
    respondedAt: Date
  }) => {
    const candidateNotifications = await prisma.notification.findMany({
      where: {
        userId: args.userId,
        actorId: args.actorId,
        type: args.type,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: deps.notificationSelect,
    })

    const matchingNotifications = candidateNotifications.filter((notification: any) => {
      const payload = readNotificationPayloadRecord(notification.payload)
      const payloadEntityId = payload[args.payloadIdKey]
      const entityId = typeof payloadEntityId === 'string' ? payloadEntityId.trim() : ''
      const status = normalizeNotificationRequestStatus(payload.status)
      if (entityId && entityId === args.entityId) return true
      return !entityId && (!status || status === 'pending')
    })

    if (!matchingNotifications.length) return

    const respondedAtIso = args.respondedAt.toISOString()
    const updatedNotifications = await prisma.$transaction(
      matchingNotifications.map((notification: any) => {
        const payload = readNotificationPayloadRecord(notification.payload)
        return prisma.notification.update({
          where: { id: notification.id },
          data: {
            payload: {
              ...payload,
              [args.payloadIdKey]: args.entityId,
              status: args.nextStatus,
              respondedAt: respondedAtIso,
            } as Prisma.InputJsonValue,
            readAt: notification.readAt ?? args.respondedAt,
          },
          select: deps.notificationSelect,
        })
      }),
    )

    await Promise.all(updatedNotifications.map((notification: any) => deps.dispatchNotification(notification).catch(() => undefined)))
  }

  app.get('/friends', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      if (authContext.actor === 'family_member') {
        const familyFriendships = deps.getStoredFamilyFriendships(authContext.member.parent.communityMeta)
          .filter((entry) => entry.memberId === authContext.member.id)
          .map((entry) => deps.formatFamilyChildFriendship(entry))
        return reply.send({ items: [deps.formatFamilySponsorFriendship(authContext.member), ...familyFriendships] })
      }

      const userId = authContext.userId

      const rows = await prisma.friendship.findMany({
        where: {
          status: FriendshipStatus.ACCEPTED,
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        orderBy: [{ respondedAt: 'desc' }, { requestedAt: 'desc' }],
        include: deps.friendshipWithUsersInclude,
      })

      return reply.send({ items: rows.map((row: (typeof rows)[number]) => deps.formatFriendship(row, userId)) })
    }),
  )

  app.get('/friends/requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      if (authContext.actor === 'family_member') {
        return reply.send({ incoming: [], outgoing: [] })
      }

      const userId = authContext.userId

      const rows = await prisma.friendship.findMany({
        where: {
          status: FriendshipStatus.PENDING,
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        orderBy: { requestedAt: 'asc' },
        include: deps.friendshipWithUsersInclude,
      })

      const incoming: unknown[] = []
      const outgoing: unknown[] = []
      for (const row of rows) {
        if (row.addresseeId === userId) incoming.push(deps.formatFriendRequest(row, userId))
        else outgoing.push(deps.formatFriendRequest(row, userId))
      }

      return reply.send({ incoming, outgoing })
    }),
  )

  app.post('/friends/requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = FriendRequestInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const targetUserId = parse.data.userId
      if (targetUserId === userId) return reply.code(400).send({ error: 'cannot_friend_self' })

      const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
      if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

      const existing = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: userId, addresseeId: targetUserId },
            { requesterId: targetUserId, addresseeId: userId },
          ],
        },
        select: { id: true, requesterId: true, addresseeId: true, status: true, requestedAt: true, respondedAt: true },
      })

      let friendship: any
      if (existing) {
        if (existing.status === FriendshipStatus.ACCEPTED) {
          return reply.code(409).send({ error: 'already_friends' })
        }
        if (existing.status === FriendshipStatus.PENDING) {
          const direction = existing.requesterId === userId ? 'outgoing' : 'incoming'
          return reply.code(409).send({ error: 'friendship_pending', direction })
        }
        friendship = await prisma.friendship.update({
          where: { id: existing.id },
          data: {
            requesterId: userId,
            addresseeId: targetUserId,
            status: FriendshipStatus.PENDING,
            requestedAt: new Date(),
            respondedAt: null,
          },
          include: deps.friendshipWithUsersInclude,
        })
      } else {
        friendship = await prisma.friendship.create({
          data: {
            requesterId: userId,
            addresseeId: targetUserId,
          },
          include: deps.friendshipWithUsersInclude,
        })
      }

      await deps.notifyFriendRequest(friendship.id, friendship.requesterId, friendship.addresseeId)

      return reply.code(201).send({ request: deps.formatFriendRequest(friendship, userId) })
    }),
  )

  app.post('/friends/requests/:id/accept', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = FriendshipIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const friendship = await prisma.friendship.findUnique({
        where: { id: params.data.id },
        include: deps.friendshipWithUsersInclude,
      })
      if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })
      if (friendship.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
      if (friendship.status !== FriendshipStatus.PENDING) return reply.code(409).send({ error: 'friendship_not_pending' })

      const updated = await prisma.friendship.update({
        where: { id: friendship.id },
        data: { status: FriendshipStatus.ACCEPTED, respondedAt: new Date() },
        include: deps.friendshipWithUsersInclude,
      })
      await syncResolvedRequestNotifications({
        userId: updated.addresseeId,
        actorId: updated.requesterId,
        type: deps.friendNotificationTypes.REQUEST,
        payloadIdKey: 'friendshipId',
        entityId: updated.id,
        nextStatus: 'accepted',
        respondedAt: updated.respondedAt ?? new Date(),
      })

      await deps.notifyFriendAcceptance(updated.id, updated.requesterId, updated.addresseeId)

      return reply.send({ friendship: deps.formatFriendship(updated, userId) })
    }),
  )

  app.post('/friends/requests/:id/reject', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = FriendshipIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const friendship = await prisma.friendship.findUnique({
        where: { id: params.data.id },
        include: deps.friendshipWithUsersInclude,
      })
      if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })
      if (friendship.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
      if (friendship.status !== FriendshipStatus.PENDING) return reply.code(409).send({ error: 'friendship_not_pending' })

      const updated = await prisma.friendship.update({
        where: { id: friendship.id },
        data: { status: FriendshipStatus.REJECTED, respondedAt: new Date() },
        include: deps.friendshipWithUsersInclude,
      })
      await syncResolvedRequestNotifications({
        userId: updated.addresseeId,
        actorId: updated.requesterId,
        type: deps.friendNotificationTypes.REQUEST,
        payloadIdKey: 'friendshipId',
        entityId: updated.id,
        nextStatus: 'rejected',
        respondedAt: updated.respondedAt ?? new Date(),
      })

      return reply.send({ request: deps.formatFriendRequest(updated, userId) })
    }),
  )

  app.delete('/friends/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const params = FriendDeleteParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      if (authContext.actor === 'family_member') {
        if (params.data.id === deps.buildFamilySponsorFriendshipId(authContext.member.id)) {
          return reply.code(403).send({ error: 'family_sponsor_friendship_locked' })
        }
        const friendship = await prisma.friendship.findUnique({
          where: { id: params.data.id },
          select: {
            id: true,
            requesterId: true,
            addresseeId: true,
            requester: { select: { id: true, handle: true, name: true } },
            addressee: { select: { id: true, handle: true, name: true } },
          },
        })
        if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })

        const parentUserId = authContext.member.parentId
        if (friendship.requesterId !== parentUserId && friendship.addresseeId !== parentUserId) {
          return reply.code(403).send({ error: 'not_participant' })
        }

        const targetUser = friendship.requesterId === parentUserId ? friendship.addressee : friendship.requester

        await prisma.friendship.delete({ where: { id: friendship.id } })

        void deps.createNotificationRecord({
          userId: parentUserId,
          actorId: null,
          type: deps.familyNotificationTypes.FRIEND_REMOVED,
          payload: {
            childDisplayName: deps.normalizeFamilyMemberSummary(authContext.member).displayName,
            targetUserId: targetUser.id,
            targetHandle: targetUser.handle,
            targetName: targetUser.name,
            url: `/u/${encodeURIComponent(targetUser.handle)}`,
            sourceUrl: `/u/${encodeURIComponent(targetUser.handle)}`,
          },
        }).catch((error) => {
          req.log.error({ err: error, memberId: authContext.member.id, targetUserId: targetUser.id }, 'family_friend_remove_notification_failed')
        })

        return reply.send({ success: true })
      }

      const userId = authContext.userId
      const friendship = await prisma.friendship.findUnique({ where: { id: params.data.id } })
      if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })
      if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
        return reply.code(403).send({ error: 'not_participant' })
      }

      await prisma.friendship.delete({ where: { id: friendship.id } })
      return reply.send({ success: true })
    }),
  )

  app.get('/connections', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      if (authContext.actor === 'family_member') return reply.send({ items: [] })

      const userId = authContext.userId

      try {
        const rows = (await prisma.$queryRaw<ConnectionRow[]>`
          SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
          FROM "Connection"
          WHERE "status" = 'ACCEPTED'
            AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
          ORDER BY COALESCE("respondedAt", "requestedAt") DESC
        `) as ConnectionRow[]

        const counterpartIds = Array.from(new Set(rows.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId))))
        const users = counterpartIds.length
          ? await prisma.user.findMany({ where: { id: { in: counterpartIds } }, select: deps.friendUserSelect })
          : []
        const userMap = new Map(users.map((user: any) => [user.id, user]))

        const items = rows
          .map((row) => {
            const counterpartId = row.requesterId === userId ? row.addresseeId : row.requesterId
            const counterpart = userMap.get(counterpartId)
            if (!counterpart) return null
            return {
              id: row.id,
              status: row.status,
              since: row.respondedAt ?? row.requestedAt,
              user: deps.formatFriendUser(counterpart),
            }
          })
          .filter(Boolean)

        return reply.send({ items })
      } catch (error) {
        if (deps.isConnectionTableMissingError(error)) return reply.send({ items: [] })
        throw error
      }
    }),
  )

  app.get('/connections/requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      try {
        const rows = (await prisma.$queryRaw<ConnectionRow[]>`
          SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
          FROM "Connection"
          WHERE "status" = 'PENDING'
            AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
          ORDER BY "requestedAt" ASC
        `) as ConnectionRow[]

        const counterpartIds = Array.from(new Set(rows.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId))))
        const users = counterpartIds.length
          ? await prisma.user.findMany({ where: { id: { in: counterpartIds } }, select: deps.friendUserSelect })
          : []
        const userMap = new Map(users.map((user: any) => [user.id, user]))

        const incoming: Array<Record<string, unknown>> = []
        const outgoing: Array<Record<string, unknown>> = []

        for (const row of rows) {
          const direction = row.requesterId === userId ? 'outgoing' : 'incoming'
          const counterpartId = row.requesterId === userId ? row.addresseeId : row.requesterId
          const counterpart = userMap.get(counterpartId)
          if (!counterpart) continue
          const payload = {
            id: row.id,
            status: row.status,
            direction,
            requestedAt: row.requestedAt,
            respondedAt: row.respondedAt ?? null,
            user: deps.formatFriendUser(counterpart),
          }
          if (direction === 'incoming') incoming.push(payload)
          else outgoing.push(payload)
        }

        return reply.send({ incoming, outgoing })
      } catch (error) {
        if (deps.isConnectionTableMissingError(error)) return reply.send({ incoming: [], outgoing: [] })
        throw error
      }
    }),
  )

  app.post('/connections/requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = ConnectionRequestInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const targetUserId = parse.data.userId
      if (targetUserId === userId) return reply.code(400).send({ error: 'cannot_connect_self' })

      const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
      if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

      try {
        const existing = await deps.findConnectionBetween(userId, targetUserId)
        if (existing) {
          if (existing.status === 'ACCEPTED') return reply.code(409).send({ error: 'already_connected' })
          if (existing.status === 'PENDING') {
            const direction = existing.requesterId === userId ? 'outgoing' : 'incoming'
            return reply.code(409).send({ error: 'connection_pending', direction })
          }

          const now = new Date()
          await prisma.$executeRaw`
            UPDATE "Connection"
            SET "requesterId" = ${userId},
                "addresseeId" = ${targetUserId},
                "status" = 'PENDING',
                "requestedAt" = ${now},
                "respondedAt" = NULL
            WHERE "id" = ${existing.id}
          `

          await deps.notifyConnectionRequest(existing.id, userId, targetUserId)

          return reply.code(201).send({
            request: {
              id: existing.id,
              status: 'PENDING',
              direction: 'outgoing',
              requestedAt: now,
              respondedAt: null,
            },
          })
        }

        const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const now = new Date()
        await prisma.$executeRaw`
          INSERT INTO "Connection" ("id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt")
          VALUES (${id}, ${userId}, ${targetUserId}, 'PENDING', ${now}, NULL)
        `

        await deps.notifyConnectionRequest(id, userId, targetUserId)

        return reply.code(201).send({
          request: {
            id,
            status: 'PENDING',
            direction: 'outgoing',
            requestedAt: now,
            respondedAt: null,
          },
        })
      } catch (error) {
        if (deps.isConnectionTableMissingError(error)) {
          return reply
            .code(503)
            .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
        }
        throw error
      }
    }),
  )

  app.post('/connections/requests/:id/accept', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = ConnectionIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      try {
        const connection = await deps.findConnectionById(params.data.id)
        if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
        if (connection.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
        if (connection.status !== 'PENDING') return reply.code(409).send({ error: 'connection_not_pending' })

        const now = new Date()
        await prisma.$executeRaw`
          UPDATE "Connection"
          SET "status" = 'ACCEPTED', "respondedAt" = ${now}
          WHERE "id" = ${connection.id}
        `

        await syncResolvedRequestNotifications({
          userId: connection.addresseeId,
          actorId: connection.requesterId,
          type: 'connection_request',
          payloadIdKey: 'connectionId',
          entityId: connection.id,
          nextStatus: 'accepted',
          respondedAt: now,
        })

        await deps.notifyConnectionAcceptance(connection.id, connection.requesterId, connection.addresseeId)

        return reply.send({
          connection: {
            id: connection.id,
            status: 'ACCEPTED',
            since: now,
          },
        })
      } catch (error) {
        if (deps.isConnectionTableMissingError(error)) {
          return reply
            .code(503)
            .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
        }
        throw error
      }
    }),
  )

  app.post('/connections/requests/:id/reject', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = ConnectionIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      try {
        const connection = await deps.findConnectionById(params.data.id)
        if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
        if (connection.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
        if (connection.status !== 'PENDING') return reply.code(409).send({ error: 'connection_not_pending' })

        await prisma.$executeRaw`
          UPDATE "Connection"
          SET "status" = 'REJECTED', "respondedAt" = ${new Date()}
          WHERE "id" = ${connection.id}
        `

        await syncResolvedRequestNotifications({
          userId: connection.addresseeId,
          actorId: connection.requesterId,
          type: 'connection_request',
          payloadIdKey: 'connectionId',
          entityId: connection.id,
          nextStatus: 'rejected',
          respondedAt: new Date(),
        })

        return reply.send({ request: { id: connection.id, status: 'REJECTED' } })
      } catch (error) {
        if (deps.isConnectionTableMissingError(error)) {
          return reply
            .code(503)
            .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
        }
        throw error
      }
    }),
  )

  app.delete('/connections/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = ConnectionIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      try {
        const connection = await deps.findConnectionById(params.data.id)
        if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
        if (connection.requesterId !== userId && connection.addresseeId !== userId) {
          return reply.code(403).send({ error: 'not_participant' })
        }

        await prisma.$executeRaw`DELETE FROM "Connection" WHERE "id" = ${connection.id}`
        return reply.send({ success: true })
      } catch (error) {
        if (deps.isConnectionTableMissingError(error)) {
          return reply
            .code(503)
            .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
        }
        throw error
      }
    }),
  )
}
