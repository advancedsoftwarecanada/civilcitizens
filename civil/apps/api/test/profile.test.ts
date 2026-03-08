import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { truncateTables } from './testDbGuard'

const truncateAll = async () => {
  const tables = ['Experience', 'MediaAsset', 'User']
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
  return { token: payload.token!, id: payload.user!.id! }
}

const createMedia = async (ownerId: string, category: 'avatar' | 'cover', id = randomUUID()) => {
  return prisma.mediaAsset.create({
    data: {
      id,
      ownerId,
      category,
      assetType: 'image',
      storageType: 'minio',
      originalKey: `${category}/${id}.png`,
      mime: 'image/png',
      byteSize: 1234,
      status: 'ready',
      variants: { [`${category}@1x`]: `https://example.com/${category}/${id}.png` },
    },
  })
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

describe('profile update media ids', () => {
  test('accepts uuid media ids for avatar and cover', async () => {
    const user = await registerUser(app, 'Uuid', 'User')
    const avatar = await createMedia(user.id, 'avatar')
    const cover = await createMedia(user.id, 'cover')

    const res = await app.inject({
      method: 'PUT',
      url: '/profile',
      headers: authHeader(user.token),
      payload: {
        firstName: 'Uuid',
        lastName: 'User',
        bio: 'hello',
        experiences: [],
        avatarMediaId: avatar.id,
        coverMediaId: cover.id,
      },
    })

    expect(res.statusCode).toBe(200)
    const payload = res.json() as { ok?: boolean; user?: { avatarMediaId?: string | null; coverMediaId?: string | null } }
    expect(payload.ok).toBe(true)
    expect(payload.user?.avatarMediaId).toBe(avatar.id)
    expect(payload.user?.coverMediaId).toBe(cover.id)
  })

  test('rejects invalid media id format', async () => {
    const user = await registerUser(app, 'Bad', 'Format')

    const res = await app.inject({
      method: 'PUT',
      url: '/profile',
      headers: authHeader(user.token),
      payload: {
        firstName: 'Bad',
        lastName: 'Format',
        avatarMediaId: 'not-a-guid',
      },
    })

    expect(res.statusCode).toBe(400)
    const payload = res.json() as { error?: { fieldErrors?: Record<string, string[]> } }
    expect(payload.error?.fieldErrors?.avatarMediaId?.length).toBeGreaterThan(0)
  })

  test('rejects media not owned by user', async () => {
    const user = await registerUser(app, 'Wrong', 'Owner')
    const otherUser = await registerUser(app, 'Other', 'Owner')
    const avatar = await createMedia(otherUser.id, 'avatar')

    const res = await app.inject({
      method: 'PUT',
      url: '/profile',
      headers: authHeader(user.token),
      payload: {
        firstName: 'Wrong',
        lastName: 'Owner',
        avatarMediaId: avatar.id,
      },
    })

    expect(res.statusCode).toBe(400)
    const payload = res.json() as { error?: string }
    expect(payload.error).toBe('invalid_avatar_media')
  })
})
