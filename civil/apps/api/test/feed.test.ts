import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { ConnectionStatus, FriendshipStatus, PollResultsVisibility, prisma } from '@civil/db'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { truncateTables } from './testDbGuard'

const truncateAll = async () => {
  const tables = [
    'Notification',
    'BusinessFollow',
    'BusinessMembership',
    'Business',
    'CommunityFollow',
    'Connection',
    'Friendship',
    'MediaAsset',
    'Post',
    'User',
  ]
  await truncateTables(tables)
}

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` })

const registerUser = async (app: FastifyInstance, firstName: string, lastName: string) => {
  const email = `test+${randomUUID()}@example.com`
  const password = 'Password123!'
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, firstName, lastName, password, acceptTerms: true },
  })
  const payload = res.json() as { token?: string; user?: { id?: string; handle?: string } }
  expect(res.statusCode).toBe(200)
  expect(payload.token).toBeTruthy()
  expect(payload.user?.id).toBeTruthy()
  expect(payload.user?.handle).toBeTruthy()
  return { token: payload.token!, id: payload.user!.id!, handle: payload.user!.handle! }
}

let app: FastifyInstance

beforeAll(async () => {
  process.env.API_SKIP_LISTEN = '1'
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_secret'
  const mod = await import('../src/index.js')
  app = mod.app as FastifyInstance
  await app.ready()
})

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

describe('home feed and profile visibility', () => {
  test('default /posts scope=all stays chronological in new mode', async () => {
    const viewer = await registerUser(app, 'Feed', 'Viewer')
    const friend = await registerUser(app, 'Feed', 'Friend')
    const communityAuthor = await registerUser(app, 'Community', 'Author')

    await prisma.friendship.create({
      data: {
        requesterId: viewer.id,
        addresseeId: friend.id,
        status: FriendshipStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    })

    await prisma.communityFollow.create({
      data: {
        userId: viewer.id,
        provinceCode: 'ON',
        communitySlug: 'test-town',
        home: true,
      },
    })

    const olderCreatedAt = new Date(Date.now() - 60 * 60 * 1000)
    await prisma.post.create({
      data: {
        authorId: communityAuthor.id,
        audience: 'community',
        visibility: 'public',
        body: 'Older hot community post',
        type: 'post',
        provinceCode: 'ON',
        communitySlug: 'test-town',
        jurisdiction: 'municipal',
        createdAt: olderCreatedAt,
        lastActivityAt: olderCreatedAt,
        reactionTotal: 5000,
        commentCount: 2500,
        recentPositive: 1200,
        hotScore: 5000,
      },
    })

    const createFriendPostRes = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(friend.token),
      payload: {
        type: 'post',
        audience: 'friends',
        body: 'THIS IS A FRIENDS POST!',
      },
    })

    expect(createFriendPostRes.statusCode).toBe(201)
    const createdFriendPost = createFriendPostRes.json() as { id: string }

    const homeFeedRes = await app.inject({
      method: 'GET',
      url: '/posts?scope=all',
      headers: authHeader(viewer.token),
    })

    expect(homeFeedRes.statusCode).toBe(200)
    const homeFeedPayload = homeFeedRes.json() as { items?: Array<{ id: string; body: string }> }
    const items = Array.isArray(homeFeedPayload.items) ? homeFeedPayload.items : []
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]?.id).toBe(createdFriendPost.id)
    expect(items[0]?.body).toBe('THIS IS A FRIENDS POST!')
  })

  test('smart home feed rotates fresher community posts ahead of stale unseen hits', async () => {
    const viewer = await registerUser(app, 'Fresh', 'Viewer')
    const staleAuthor = await registerUser(app, 'Stale', 'Author')
    const freshAuthor = await registerUser(app, 'Fresh', 'Author')

    await prisma.communityFollow.create({
      data: {
        userId: viewer.id,
        provinceCode: 'ON',
        communitySlug: 'fresh-town',
        home: true,
      },
    })

    const staleCreatedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    await prisma.post.create({
      data: {
        authorId: staleAuthor.id,
        audience: 'community',
        visibility: 'public',
        body: 'Stale unseen community post',
        type: 'post',
        provinceCode: 'ON',
        communitySlug: 'fresh-town',
        jurisdiction: 'municipal',
        createdAt: staleCreatedAt,
        lastActivityAt: staleCreatedAt,
        reactionTotal: 7000,
        commentCount: 2800,
        recentPositive: 1600,
        hotScore: 8200,
      },
    })

    const freshCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const freshPost = await prisma.post.create({
      data: {
        authorId: freshAuthor.id,
        audience: 'community',
        visibility: 'public',
        body: 'Fresh community post',
        type: 'post',
        provinceCode: 'ON',
        communitySlug: 'fresh-town',
        jurisdiction: 'municipal',
        createdAt: freshCreatedAt,
        lastActivityAt: freshCreatedAt,
        reactionTotal: 2,
        commentCount: 1,
        recentPositive: 1,
        hotScore: 1,
      },
    })

    const homeFeedRes = await app.inject({
      method: 'GET',
      url: '/posts?scope=all&sort=hot&limit=2&cursor=rank:303:0',
      headers: authHeader(viewer.token),
    })

    expect(homeFeedRes.statusCode).toBe(200)
    const homeFeedPayload = homeFeedRes.json() as { items?: Array<{ id: string; body: string }> }
    const items = Array.isArray(homeFeedPayload.items) ? homeFeedPayload.items : []
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe(freshPost.id)
    expect(items[0]?.body).toBe('Fresh community post')
  })

  test('friends can see public organization poll posts on home and profile feeds', async () => {
    const author = await registerUser(app, 'Poll', 'Author')
    const viewer = await registerUser(app, 'Poll', 'Viewer')

    await prisma.friendship.create({
      data: {
        requesterId: author.id,
        addresseeId: viewer.id,
        status: FriendshipStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    })

    const business = await prisma.business.create({
      data: {
        ownerId: author.id,
        name: 'Poll Visibility Org',
        slug: `poll-visibility-org-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        provinceCode: 'ON',
        communitySlug: 'test-town',
      },
    })

    const createPollRes = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(author.token),
      payload: {
        type: 'poll',
        businessId: business.id,
        audience: 'organization',
        visibility: 'public',
        body: 'Can friends see this organization poll?',
        poll: {
          resultsVisibility: 'after_vote',
          options: ['Yes', 'No'],
        },
      },
    })

    expect(createPollRes.statusCode).toBe(201)
    const createdPoll = createPollRes.json() as { id: string }

    const homeFeedRes = await app.inject({
      method: 'GET',
      url: '/posts?scope=all',
      headers: authHeader(viewer.token),
    })

    expect(homeFeedRes.statusCode).toBe(200)
    const homeFeedPayload = homeFeedRes.json() as { items?: Array<{ id: string; type: string; poll?: { id: string } | null }> }
    const homeItems = Array.isArray(homeFeedPayload.items) ? homeFeedPayload.items : []
    expect(homeItems.some((item) => item.id === createdPoll.id && item.type === 'poll' && item.poll?.id)).toBe(true)

    const profileFeedRes = await app.inject({
      method: 'GET',
      url: `/users/${encodeURIComponent(author.handle)}/posts?sort=new`,
      headers: authHeader(viewer.token),
    })

    expect(profileFeedRes.statusCode).toBe(200)
    const profileFeedPayload = profileFeedRes.json() as { items?: Array<{ id: string; type: string; poll?: { id: string } | null }> }
    const profileItems = Array.isArray(profileFeedPayload.items) ? profileFeedPayload.items : []
    expect(profileItems.some((item) => item.id === createdPoll.id && item.type === 'poll' && item.poll?.id)).toBe(true)

    const persistedPoll = await prisma.poll.findUnique({
      where: { postId: createdPoll.id },
      select: { resultsVisibility: true },
    })
    expect(persistedPoll?.resultsVisibility).toBe(PollResultsVisibility.AFTER_VOTE)
  })

  test('smart home feed uses seeded weighted mixing with stable pagination', async () => {
    const viewer = await registerUser(app, 'Smart', 'Viewer')
    const friend = await registerUser(app, 'Smart', 'Friend')
    const connection = await registerUser(app, 'Smart', 'Connection')
    const communityAuthor = await registerUser(app, 'Smart', 'Community')
    const eventAuthor = await registerUser(app, 'Smart', 'Event')
    const marketAuthor = await registerUser(app, 'Smart', 'Market')
    const orgOwner = await registerUser(app, 'Smart', 'Org')

    await prisma.friendship.create({
      data: {
        requesterId: viewer.id,
        addresseeId: friend.id,
        status: FriendshipStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    })

    await prisma.connection.create({
      data: {
        requesterId: viewer.id,
        addresseeId: connection.id,
        status: ConnectionStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    })

    await prisma.communityFollow.create({
      data: {
        userId: viewer.id,
        provinceCode: 'ON',
        communitySlug: 'seed-town',
        home: true,
      },
    })

    const business = await prisma.business.create({
      data: {
        ownerId: orgOwner.id,
        name: 'Seeded Mix Org',
        slug: `seeded-mix-org-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
      },
    })

    await prisma.businessFollow.create({
      data: {
        userId: viewer.id,
        businessId: business.id,
      },
    })

    const now = Date.now()
    const basePostData = {
      visibility: 'public' as const,
      provinceCode: 'ON',
      communitySlug: 'seed-town',
      jurisdiction: 'municipal' as const,
      lastActivityAt: new Date(now),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }

    const friendPost = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(friend.token),
      payload: {
        type: 'post',
        audience: 'friends',
        body: 'Friend bucket post',
      },
    })
    expect(friendPost.statusCode).toBe(201)

    const networkPost = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(connection.token),
      payload: {
        type: 'post',
        audience: 'network',
        body: 'Network bucket post',
      },
    })
    expect(networkPost.statusCode).toBe(201)

    const communityPost = await prisma.post.create({
      data: {
        authorId: communityAuthor.id,
        audience: 'community',
        body: 'Community bucket post',
        type: 'post',
        ...basePostData,
      },
    })

    const eventPost = await prisma.post.create({
      data: {
        authorId: eventAuthor.id,
        audience: 'community',
        body: 'Event bucket post',
        type: 'event',
        ...basePostData,
      },
    })

    const marketPost = await prisma.post.create({
      data: {
        authorId: marketAuthor.id,
        audience: 'community',
        body: 'Market bucket post',
        type: 'market',
        ...basePostData,
      },
    })

    const organizationPost = await prisma.post.create({
      data: {
        authorId: orgOwner.id,
        businessId: business.id,
        audience: 'organization',
        body: 'Organization bucket post',
        type: 'post',
        ...basePostData,
      },
    })

    const seededFirstPageA = await app.inject({
      method: 'GET',
      url: '/posts?scope=all&sort=hot&limit=3&cursor=rank:101:0',
      headers: authHeader(viewer.token),
    })
    expect(seededFirstPageA.statusCode).toBe(200)
    const payloadA = seededFirstPageA.json() as { items?: Array<{ id: string }>; nextCursor?: string }
    const pageAIds = (payloadA.items ?? []).map((item) => item.id)
    expect(pageAIds).toHaveLength(3)
    expect(payloadA.nextCursor).toBe('rank:101:3')

    const seededSecondPageA = await app.inject({
      method: 'GET',
      url: `/posts?scope=all&sort=hot&limit=3&cursor=${encodeURIComponent(payloadA.nextCursor ?? '')}`,
      headers: authHeader(viewer.token),
    })
    expect(seededSecondPageA.statusCode).toBe(200)
    const payloadASecond = seededSecondPageA.json() as { items?: Array<{ id: string }>; nextCursor?: string }
    const pageASecondIds = (payloadASecond.items ?? []).map((item) => item.id)
    expect(pageASecondIds).toHaveLength(3)
    expect(new Set([...pageAIds, ...pageASecondIds]).size).toBe(6)
    expect(payloadASecond.nextCursor).toBeUndefined()

    const seededFirstPageARepeat = await app.inject({
      method: 'GET',
      url: '/posts?scope=all&sort=hot&limit=3&cursor=rank:101:0',
      headers: authHeader(viewer.token),
    })
    expect(seededFirstPageARepeat.statusCode).toBe(200)
    const payloadARepeat = seededFirstPageARepeat.json() as { items?: Array<{ id: string }> }
    expect((payloadARepeat.items ?? []).map((item) => item.id)).toEqual(pageAIds)

    const seededFirstPageB = await app.inject({
      method: 'GET',
      url: '/posts?scope=all&sort=hot&limit=6&cursor=rank:202:0',
      headers: authHeader(viewer.token),
    })
    expect(seededFirstPageB.statusCode).toBe(200)
    const payloadB = seededFirstPageB.json() as { items?: Array<{ id: string }> }
    const pageBIds = (payloadB.items ?? []).map((item) => item.id)
    expect(pageBIds).toHaveLength(6)
    expect(pageBIds).toEqual(expect.arrayContaining([
      (friendPost.json() as { id: string }).id,
      (networkPost.json() as { id: string }).id,
      communityPost.id,
      eventPost.id,
      marketPost.id,
      organizationPost.id,
    ]))
    expect(pageBIds).not.toEqual([...pageAIds, ...pageASecondIds])
  })
})
