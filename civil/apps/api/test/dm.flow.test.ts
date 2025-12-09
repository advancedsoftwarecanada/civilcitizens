import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { expect, describe, test, beforeAll, afterAll } from 'vitest'

const truncateForFlow = async () => {
  const tables = [
    'Message',
    'MessageParticipant',
    'MessageThread',
    'Friendship',
    'Follow',
    'Vote',
    'Comment',
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
    payload: {
      email,
      firstName,
      lastName,
      password,
      acceptTerms: true,
    },
  })
  const payload = res.json() as { token?: string; user?: { id?: string; handle?: string } }
  expect(res.statusCode).toBe(200)
  expect(payload.token).toBeTruthy()
  expect(payload.user?.id).toBeTruthy()
  return { token: payload.token!, id: payload.user!.id!, handle: payload.user!.handle! }
}

let app: FastifyInstance

beforeAll(async () => {
  process.env.API_SKIP_LISTEN = '1'
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_secret'
  const mod = await import('../src/index.js')
  app = mod.app as FastifyInstance
  await app.ready()
  await truncateForFlow()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

describe('direct messaging flow', () => {
  test('users can friend and DM', async () => {
    const userA = await registerUser(app, 'Kodi', 'Normore')
    const userB = await registerUser(app, 'Alex', 'Tester')

    const requestRes = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: authHeader(userA.token),
      payload: { userId: userB.id },
    })
    expect(requestRes.statusCode).toBe(201)
    const requestPayload = requestRes.json() as { request?: { id?: string } }
    expect(requestPayload.request?.id).toBeTruthy()
    const requestId = requestPayload.request!.id!

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/friends/requests/${requestId}/accept`,
      headers: authHeader(userB.token),
    })
    expect(acceptRes.statusCode).toBe(200)

    const dmRes = await app.inject({
      method: 'POST',
      url: '/messages/threads/direct',
      headers: authHeader(userA.token),
      payload: { userId: userB.id },
    })
    expect(dmRes.statusCode).toBe(200)
    const dmPayload = dmRes.json() as { thread?: { id?: string } }
    expect(dmPayload.thread?.id).toBeTruthy()
    const threadId = dmPayload.thread!.id!

    const sendRes = await app.inject({
      method: 'POST',
      url: `/messages/threads/${threadId}/messages`,
      headers: authHeader(userA.token),
      payload: { body: 'Hello from user A' },
    })
    expect(sendRes.statusCode).toBe(201)

    const listRes = await app.inject({
      method: 'GET',
      url: `/messages/threads/${threadId}/messages`,
      headers: authHeader(userB.token),
    })
    expect(listRes.statusCode).toBe(200)
    const listPayload = listRes.json() as { items?: Array<{ body?: string; senderId?: string }> }
    expect(listPayload.items?.length).toBe(1)
    expect(listPayload.items?.[0]?.body).toBe('Hello from user A')
    expect(listPayload.items?.[0]?.senderId).toBe(userA.id)
  })
})
