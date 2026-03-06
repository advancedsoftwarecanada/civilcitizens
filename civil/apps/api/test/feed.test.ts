import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { FriendshipStatus, PollResultsVisibility, prisma } from '@civil/db'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

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
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)
  }
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
})
