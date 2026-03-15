import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ConnectionStatus } from '@prisma/client'
import { HandleParam, findCommunity } from '@civil/shared'

type UserConnectionsDeps = {
  formatFriendUser: (user: any) => any
  loadAcceptedFriendIds: (userId: string) => Promise<string[]>
  loadViewerAuthContext: (req: FastifyRequest) => Promise<any>
  normalizeMediaUrl: (url?: string | null) => string | null
  normalizeUserMedia: <T extends { avatarUrl?: string | null; coverUrl?: string | null }>(user: T) => T
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, handler: () => Promise<any>) => Promise<any>
}

export function registerUserConnectionsRoutes(app: FastifyInstance, deps: UserConnectionsDeps) {
  app.get('/home/right-rail', async (req: FastifyRequest, reply: FastifyReply) => {
    const authContext = await deps.loadViewerAuthContext(req)
    if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

    if (authContext.actor === 'family_member') {
      return {
        userHandle: undefined,
        totalFriends: 1,
        friends: [{
          ...deps.formatFriendUser(authContext.member.parent),
          newPosts: 0,
        }],
        communities: [],
      }
    }

    const userId = authContext.userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { handle: true, lastViewedFriendsAt: true, lastViewedHomeAt: true },
    })

    const friendIds = await deps.loadAcceptedFriendIds(userId)
    const friendsThreshold = [user?.lastViewedFriendsAt, user?.lastViewedHomeAt]
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

    const activeFriendCounts = friendIds.length
      ? await prisma.post.groupBy({
          by: ['authorId'],
          where: {
            authorId: { in: friendIds },
            createdAt: { gt: friendsThreshold },
          },
          _count: { id: true },
        })
      : []

    const friendCountMap = new Map<string, number>()
    activeFriendCounts.forEach((row: { authorId: string; _count: { id: number } }) => {
      friendCountMap.set(row.authorId, row._count.id)
    })

    const sortedActive = [...activeFriendCounts].sort((a, b) => b._count.id - a._count.id)
    const activeIds = sortedActive.map((row) => row.authorId)
    const activeIdSet = new Set(activeIds)
    const otherIds = friendIds.filter((id) => !activeIdSet.has(id))
    const shuffledOthers = otherIds.sort(() => 0.5 - Math.random())
    const selectedIds = [...activeIds, ...shuffledOthers].slice(0, 5)

    const friends = selectedIds.length
      ? await prisma.user.findMany({
          where: { id: { in: selectedIds } },
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            bio: true,
            communityMeta: true,
          },
        })
      : []

    const normalizedFriends = friends.map((friend: (typeof friends)[number]) => deps.normalizeUserMedia(friend))
    const friendsWithCounts = normalizedFriends.map((friend: (typeof normalizedFriends)[number]) => ({
      ...friend,
      newPosts: friendCountMap.get(friend.id) ?? 0,
    }))
    const finalFriends = friendsWithCounts.sort(
      (a: (typeof friendsWithCounts)[number], b: (typeof friendsWithCounts)[number]) => b.newPosts - a.newPosts,
    )

    const follows = await prisma.communityFollow.findMany({
      where: { userId },
      select: { provinceCode: true, communitySlug: true, lastViewedAt: true },
    })

    const followThresholds = follows.map((follow: (typeof follows)[number]) => {
      const lastViewed = [follow.lastViewedAt, user?.lastViewedHomeAt]
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

      return {
        ...follow,
        lastViewed,
      }
    })

    const communityOr = followThresholds.map((follow: (typeof followThresholds)[number]) => ({
      provinceCode: follow.provinceCode,
      communitySlug: follow.communitySlug,
      createdAt: { gt: follow.lastViewed },
    }))

    const groupedCommunityCounts = communityOr.length
      ? await prisma.post.groupBy({
          by: ['provinceCode', 'communitySlug'],
          where: {
            OR: communityOr,
          },
          _count: { id: true },
        })
      : []

    const communityCountMap = new Map<string, number>()
    groupedCommunityCounts.forEach((row: (typeof groupedCommunityCounts)[number]) => {
      const key = `${row.provinceCode}:${row.communitySlug}`
      communityCountMap.set(key, row._count?.id ?? 0)
    })

    const cityRows = follows.length
      ? await prisma.city.findMany({
          where: {
            OR: follows.map((follow: (typeof follows)[number]) => ({
              provinceCode: follow.provinceCode,
              communitySlug: follow.communitySlug,
            })),
          },
          select: { provinceCode: true, communitySlug: true, name: true, communityName: true },
        })
      : []

    const cityNameMap = new Map<string, string>()
    cityRows.forEach((row: (typeof cityRows)[number]) => {
      const key = `${row.provinceCode}:${row.communitySlug}`
      const name = row.communityName ?? row.name ?? null
      if (name) cityNameMap.set(key, name)
    })

    const communitiesWithCounts = followThresholds.map((follow: (typeof followThresholds)[number]) => {
      const key = `${follow.provinceCode}:${follow.communitySlug}`
      return {
        provinceCode: follow.provinceCode,
        communitySlug: follow.communitySlug,
        name: cityNameMap.get(key) ?? follow.communitySlug,
        newPosts: communityCountMap.get(key) ?? 0,
      }
    })

    const topCommunities = communitiesWithCounts
      .sort((a: (typeof communitiesWithCounts)[number], b: (typeof communitiesWithCounts)[number]) => b.newPosts - a.newPosts)
      .slice(0, 5)

    return {
      userHandle: user?.handle,
      totalFriends: friendIds.length,
      friends: finalFriends,
      communities: topCommunities,
    }
  })

  app.get('/users/:handle/friends', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = HandleParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const handle = params.data.handle.replace(/^@/, '').toLowerCase()
      const user = await prisma.user.findUnique({
        where: { handle },
        select: { id: true, handle: true },
      })

      if (!user) return reply.code(404).send({ error: 'not_found' })

      const friendIds = await deps.loadAcceptedFriendIds(user.id)
      const friends = await prisma.user.findMany({
        where: { id: { in: friendIds } },
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          bio: true,
        },
        orderBy: [{ name: 'asc' }, { handle: 'asc' }],
      })

      const items = friends.map((friend: (typeof friends)[number]) => ({
        id: friend.id,
        handle: friend.handle,
        name: friend.name,
        avatarUrl: deps.normalizeMediaUrl(friend.avatarUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(friend.coverUrl ?? null),
        bio: friend.bio,
      }))

      return { userHandle: user.handle, items }
    }),
  )

  app.get('/users/:handle/followers', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => reply.code(410).send({ error: 'person_follow_disabled' })),
  )

  app.get('/users/:handle/following', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => reply.code(410).send({ error: 'person_follow_disabled' })),
  )

  app.post('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => reply.code(410).send({ error: 'person_follow_disabled' })),
  )

  app.delete('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => reply.code(410).send({ error: 'person_follow_disabled' })),
  )

  app.get('/users/:handle/connections', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = HandleParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const handle = params.data.handle.replace(/^@/, '').toLowerCase()
      const user = await prisma.user.findUnique({
        where: { handle },
        select: { id: true, handle: true },
      })

      if (!user) return reply.code(404).send({ error: 'not_found' })

      const connections = await prisma.connection.findMany({
        where: {
          status: ConnectionStatus.ACCEPTED,
          OR: [{ requesterId: user.id }, { addresseeId: user.id }],
        },
        include: {
          requester: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
              bio: true,
            },
          },
          addressee: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
              bio: true,
            },
          },
        },
        orderBy: { respondedAt: 'desc' },
      })

      const items = connections
        .map((entry: (typeof connections)[number]) => {
          const other = entry.requesterId === user.id ? entry.addressee : entry.requester
          if (!other) return null
          return {
            id: other.id,
            handle: other.handle,
            name: other.name,
            avatarUrl: deps.normalizeMediaUrl(other.avatarUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(other.coverUrl ?? null),
            bio: other.bio,
            since: (entry.respondedAt ?? entry.requestedAt).toISOString(),
          }
        })
        .filter(Boolean)

      return { userHandle: user.handle, items }
    }),
  )

  app.get('/users/:handle/communities', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = HandleParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const handle = params.data.handle.replace(/^@/, '').toLowerCase()
      const user = await prisma.user.findUnique({
        where: { handle },
        select: { id: true, handle: true },
      })

      if (!user) return reply.code(404).send({ error: 'not_found' })

      const follows = await prisma.communityFollow.findMany({
        where: { userId: user.id },
        orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          provinceCode: true,
          communitySlug: true,
          home: true,
          createdAt: true,
        },
      })

      const items = follows.map((entry: (typeof follows)[number]) => {
        const city = findCommunity(entry.provinceCode, entry.communitySlug)
        return {
          id: entry.id,
          provinceCode: entry.provinceCode,
          communitySlug: entry.communitySlug,
          name: city?.name ?? entry.communitySlug,
          home: entry.home,
          since: entry.createdAt.toISOString(),
        }
      })

      return { userHandle: user.handle, items }
    }),
  )

  app.get('/users/:handle/organizations', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = HandleParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const handle = params.data.handle.replace(/^@/, '').toLowerCase()
      const user = await prisma.user.findUnique({
        where: { handle },
        select: { id: true, handle: true },
      })

      if (!user) return reply.code(404).send({ error: 'not_found' })

      const organizations = await prisma.business.findMany({
        where: {
          OR: [
            { ownerId: user.id },
            { memberships: { some: { userId: user.id } } },
            { follows: { some: { userId: user.id } } },
          ],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          logoUrl: true,
          coverUrl: true,
        },
        orderBy: [{ name: 'asc' }],
      })

      const items = organizations.map((org: (typeof organizations)[number]) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
      }))

      return { userHandle: user.handle, items }
    }),
  )
}