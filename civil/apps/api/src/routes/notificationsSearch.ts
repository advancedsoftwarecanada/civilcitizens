import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Redis as IORedis } from 'ioredis'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { settleExpiredDriveRideEscrows } from './driveRides.js'

const NotificationAckInput = z
  .object({
    ids: z.array(z.string().cuid()).min(1).max(50).optional(),
    before: z.coerce.date().optional(),
  })
  .refine((value) => Boolean(value.ids?.length || value.before), {
    message: 'ids_or_before_required',
    path: ['ids'],
  })

const NotificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().cuid().optional(),
})

const UserSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

const SearchTypeEnum = z.enum(['all', 'people', 'communities', 'organizations', 'events', 'market', 'posts'])

const CombinedSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  type: SearchTypeEnum.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  peopleLimit: z.coerce.number().int().min(1).max(10).default(3),
  communityLimit: z.coerce.number().int().min(1).max(10).default(3),
  organizationLimit: z.coerce.number().int().min(1).max(10).default(3),
  eventLimit: z.coerce.number().int().min(1).max(10).default(3),
  marketLimit: z.coerce.number().int().min(1).max(10).default(3),
  postLimit: z.coerce.number().int().min(1).max(10).default(3),
})

type NotificationsSearchDeps = {
  NOTIFICATION_CHANNEL_PREFIX: string
  NOTIFICATION_FEED_EXCLUDED_TYPES: readonly string[]
  REDIS_URL: string
  clearUserRealtimeOnline: (userId: string, connectionId: string) => Promise<void>
  formatFriendUser: (user: any) => any
  formatNotification: (record: any) => any
  loadNotificationActor: (record: any) => Promise<any | null>
  markUserRealtimeOnline: (userId: string, connectionId: string) => Promise<void>
  normalizeSearchTerm: (value: string) => string
  resolveStreamUserId: (req: FastifyRequest) => Promise<string | null>
  searchCommunitiesForQuery: (query: string, limit: number) => Promise<any[]>
  searchCommunityPostsForQuery: (query: string, limit: number) => Promise<any[]>
  searchEventsForQuery: (input: { viewerId: string; query: string; limit: number }) => Promise<any[]>
  searchMarketListingsForQuery: (query: string, limit: number) => Promise<any[]>
  searchOrganizationsForQuery: (query: string, limit: number) => Promise<any[]>
  searchUsersForQuery: (input: { viewerId: string; query: string; limit: number }) => Promise<any[]>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, handler: () => Promise<any>) => Promise<any>
}

export function registerNotificationsSearchRoutes(app: FastifyInstance, deps: NotificationsSearchDeps) {
  app.get('/notifications', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = NotificationListQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { limit, cursor } = parse.data
      await settleExpiredDriveRideEscrows()
      const baseWhere: Prisma.NotificationWhereInput = {
        userId,
        type: { notIn: [...deps.NOTIFICATION_FEED_EXCLUDED_TYPES] },
      }

      const [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: baseWhere,
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }) as any,
        prisma.notification.count({
          where: {
            userId,
            readAt: null,
            type: { notIn: [...deps.NOTIFICATION_FEED_EXCLUDED_TYPES] },
          },
        }),
      ])

      const actors = await Promise.all(rows.map((row: any) => deps.loadNotificationActor(row)))

      let nextCursor: string | undefined
      if (rows.length > limit) {
        const next = rows.pop()!
        nextCursor = next.id
      }

      return reply.send({
        items: rows.map((record: any, index: number) => ({
          ...deps.formatNotification(record),
          actor: actors[index] ?? null,
        })),
        nextCursor,
        unreadCount,
      })
    }),
  )

  app.get('/search/users', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = UserSearchQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { q, limit } = parse.data
      const normalizedQuery = deps.normalizeSearchTerm(q)
      if (!normalizedQuery) {
        return reply.send({ items: [] })
      }

      const results = await deps.searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit })
      return reply.send({ items: results })
    }),
  )

  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = CombinedSearchQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { q, type, limit, peopleLimit, communityLimit, organizationLimit, eventLimit, marketLimit, postLimit } = parse.data
      const normalizedQuery = deps.normalizeSearchTerm(q)
      if (!normalizedQuery) {
        return reply.send({ people: [], communities: [], organizations: [], events: [], market: [], posts: [], meta: { type } })
      }

      if (type === 'people') {
        const take = limit + 1
        const peopleResults = await deps.searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit: take })
        const peopleHasMore = peopleResults.length > limit
        return reply.send({ people: peopleHasMore ? peopleResults.slice(0, limit) : peopleResults, meta: { type, peopleHasMore } })
      }

      if (type === 'communities') {
        const take = limit + 1
        const communityResults = await deps.searchCommunitiesForQuery(normalizedQuery, take)
        const communitiesHasMore = communityResults.length > limit
        return reply.send({ communities: communitiesHasMore ? communityResults.slice(0, limit) : communityResults, meta: { type, communitiesHasMore } })
      }

      if (type === 'organizations') {
        const take = limit + 1
        const organizationResults = await deps.searchOrganizationsForQuery(normalizedQuery, take)
        const organizationsHasMore = organizationResults.length > limit
        return reply.send({ organizations: organizationsHasMore ? organizationResults.slice(0, limit) : organizationResults, meta: { type, organizationsHasMore } })
      }

      if (type === 'events') {
        const take = limit + 1
        const eventResults = await deps.searchEventsForQuery({ viewerId: userId, query: normalizedQuery, limit: take })
        const eventsHasMore = eventResults.length > limit
        return reply.send({ events: eventsHasMore ? eventResults.slice(0, limit) : eventResults, meta: { type, eventsHasMore } })
      }

      if (type === 'market') {
        const take = limit + 1
        const marketResults = await deps.searchMarketListingsForQuery(normalizedQuery, take)
        const marketHasMore = marketResults.length > limit
        return reply.send({ market: marketHasMore ? marketResults.slice(0, limit) : marketResults, meta: { type, marketHasMore } })
      }

      if (type === 'posts') {
        const take = limit + 1
        const postResults = await deps.searchCommunityPostsForQuery(normalizedQuery, take)
        const postsHasMore = postResults.length > limit
        return reply.send({ posts: postsHasMore ? postResults.slice(0, limit) : postResults, meta: { type, postsHasMore } })
      }

      const [peopleResults, communityResults, organizationResults, eventResults, marketResults, postResults] = await Promise.all([
        deps.searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit: peopleLimit + 1 }),
        deps.searchCommunitiesForQuery(normalizedQuery, communityLimit + 1),
        deps.searchOrganizationsForQuery(normalizedQuery, organizationLimit + 1),
        deps.searchEventsForQuery({ viewerId: userId, query: normalizedQuery, limit: eventLimit + 1 }),
        deps.searchMarketListingsForQuery(normalizedQuery, marketLimit + 1),
        deps.searchCommunityPostsForQuery(normalizedQuery, postLimit + 1),
      ])

      const peopleHasMore = peopleResults.length > peopleLimit
      const communitiesHasMore = communityResults.length > communityLimit
      const organizationsHasMore = organizationResults.length > organizationLimit
      const eventsHasMore = eventResults.length > eventLimit
      const marketHasMore = marketResults.length > marketLimit
      const postsHasMore = postResults.length > postLimit

      return reply.send({
        people: peopleHasMore ? peopleResults.slice(0, peopleLimit) : peopleResults,
        communities: communitiesHasMore ? communityResults.slice(0, communityLimit) : communityResults,
        organizations: organizationsHasMore ? organizationResults.slice(0, organizationLimit) : organizationResults,
        events: eventsHasMore ? eventResults.slice(0, eventLimit) : eventResults,
        market: marketHasMore ? marketResults.slice(0, marketLimit) : marketResults,
        posts: postsHasMore ? postResults.slice(0, postLimit) : postResults,
        meta: { type, peopleHasMore, communitiesHasMore, organizationsHasMore, eventsHasMore, marketHasMore, postsHasMore },
      })
    }),
  )

  app.post('/notifications/ack', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = NotificationAckInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { ids, before } = parse.data
      const where: Prisma.NotificationWhereInput = { userId }
      if (ids?.length) where.id = { in: ids }
      if (before) where.createdAt = { lte: before }

      const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } })
      return reply.send({ updated: result.count })
    }),
  )

  app.get('/notifications/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await deps.resolveStreamUserId(req)
    if (!userId) {
      req.log.warn('notifications_stream_unauthorized')
      return reply.code(401).send({ error: 'unauthorized' })
    }
    req.log.info({ userId }, 'notifications_stream_connected')
    const sub = new IORedis(deps.REDIS_URL)
    const channel = `${deps.NOTIFICATION_CHANNEL_PREFIX}${userId}`
    const connectionId = randomUUID()
    await sub.subscribe(channel)
    await deps.markUserRealtimeOnline(userId, connectionId)
    reply.sse({ data: JSON.stringify({ type: 'connected' }) })

    const heartbeat = setInterval(() => {
      void deps.markUserRealtimeOnline(userId, connectionId).catch((err) => {
        req.log.warn({ err, userId }, 'notifications_stream_presence_refresh_failed')
      })
      reply.sse({ data: JSON.stringify({ type: 'ping' }) })
    }, 30000)

    sub.on('message', (_chan: string, message: string) => {
      req.log.debug({ userId, size: message.length }, 'notifications_stream_dispatch')
      reply.sse({ data: message })
    })
    req.raw.on('close', async () => {
      clearInterval(heartbeat)
      req.log.info({ userId }, 'notifications_stream_disconnected')
      await deps.clearUserRealtimeOnline(userId, connectionId).catch((err) => {
        req.log.warn({ err, userId }, 'notifications_stream_presence_clear_failed')
      })
      await sub.unsubscribe(channel)
      sub.disconnect()
    })
  })
}
