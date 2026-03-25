import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { truncateTables } from './testDbGuard'

const truncateAll = async () => {
  const tables = [
    'Notification',
    'PostMention',
    'PostCommunityTag',
    'PostHashtag',
    'Hashtag',
    'CommunityFollow',
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

describe('unified post tagging', () => {
  test('extracts topic slugs, community slugs, mentions, and home community tags on create', async () => {
    const author = await registerUser(app, 'Topic', 'Author')
    const mentioned = await registerUser(app, 'Mention', 'Target')

    await prisma.communityFollow.create({
      data: {
        userId: author.id,
        provinceCode: 'BC',
        communitySlug: 'victoria',
        home: true,
      },
    })

    const createRes = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(author.token),
      payload: {
        type: 'post',
        body: `Talking #Farming with #York-Durham and @${mentioned.handle}.`,
        communityProvince: 'ON',
        communitySlug: 'york-durham',
      },
    })

    expect(createRes.statusCode).toBe(201)
    const created = createRes.json() as {
      id: string
      topicSlugs: string[]
      communitySlugs: string[]
      mentionedUserIds: string[]
      mentions: Array<{ handle: string; matchedHandle: string }>
    }

    expect(created.topicSlugs).toEqual(['farming'])
    expect(created.communitySlugs).toEqual(expect.arrayContaining(['york-durham', 'victoria']))
    expect(created.mentionedUserIds).toEqual([mentioned.id])
    expect(created.mentions).toEqual([
      expect.objectContaining({
        handle: mentioned.handle,
        matchedHandle: mentioned.handle.toLowerCase(),
      }),
    ])

    const [topicRows, communityRows, mentionRows, notifications] = await Promise.all([
      prisma.postHashtag.findMany({ where: { postId: created.id }, orderBy: { tag: 'asc' } }),
      prisma.postCommunityTag.findMany({ where: { postId: created.id }, orderBy: { communitySlug: 'asc' } }),
      prisma.postMention.findMany({ where: { postId: created.id }, orderBy: { userId: 'asc' } }),
      prisma.notification.findMany({ where: { userId: mentioned.id }, orderBy: { createdAt: 'asc' } }),
    ])

    expect(topicRows.map((row) => row.tag)).toEqual(['farming'])
    expect(communityRows.map((row) => row.communitySlug)).toEqual(['victoria', 'york-durham'])
    expect(mentionRows).toEqual([
      expect.objectContaining({
        userId: mentioned.id,
        handleSnapshot: mentioned.handle.toLowerCase(),
      }),
    ])
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.type).toBe('post_mention')
    expect((notifications[0]?.payload as Record<string, unknown> | null)?.url).toBeTruthy()
  })

  test('re-syncs topic indexes on update and serves topic feeds', async () => {
    const author = await registerUser(app, 'Topic', 'Updater')
    const mentioned = await registerUser(app, 'Second', 'Mention')

    await prisma.communityFollow.create({
      data: {
        userId: author.id,
        provinceCode: 'BC',
        communitySlug: 'victoria',
        home: true,
      },
    })

    const createRes = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(author.token),
      payload: {
        type: 'post',
        body: 'Starting with #Farming only.',
        communityProvince: 'ON',
        communitySlug: 'york-durham',
      },
    })

    expect(createRes.statusCode).toBe(201)
    const created = createRes.json() as { id: string }

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/posts/${created.id}`,
      headers: authHeader(author.token),
      payload: {
        body: `Now tracking #Housing with @${mentioned.handle}.`,
      },
    })

    expect(updateRes.statusCode).toBe(200)
    const updated = updateRes.json() as {
      id: string
      topicSlugs: string[]
      communitySlugs: string[]
      mentionedUserIds: string[]
    }

    expect(updated.topicSlugs).toEqual(['housing'])
    expect(updated.communitySlugs).toEqual(expect.arrayContaining(['victoria', 'york-durham']))
    expect(updated.mentionedUserIds).toEqual([mentioned.id])

    const topicRows = await prisma.postHashtag.findMany({
      where: { postId: created.id },
      orderBy: { tag: 'asc' },
    })
    expect(topicRows.map((row) => row.tag)).toEqual(['housing'])

    const topicFeedRes = await app.inject({
      method: 'GET',
      url: '/topics/housing/posts',
    })

    expect(topicFeedRes.statusCode).toBe(200)
    const topicFeed = topicFeedRes.json() as { items?: Array<{ id: string }>; topic?: { slug: string } }
    expect(topicFeed.topic?.slug).toBe('housing')
    expect(topicFeed.items?.map((item) => item.id)).toContain(created.id)
  })
})
