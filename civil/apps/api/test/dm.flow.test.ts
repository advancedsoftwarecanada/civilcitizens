import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { expect, describe, test, beforeAll, afterAll } from 'vitest'
import { truncateTables } from './testDbGuard'

const truncateForFlow = async () => {
  const tables = [
    'Message',
    'MessageCall',
    'MessageParticipant',
    'MessageThread',
    'Friendship',
    'Follow',
    'Vote',
    'Comment',
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

const makeFriends = async (
  app: FastifyInstance,
  requester: { token: string; id: string },
  addressee: { token: string; id: string },
) => {
  const requestRes = await app.inject({
    method: 'POST',
    url: '/friends/requests',
    headers: authHeader(requester.token),
    payload: { userId: addressee.id },
  })
  expect(requestRes.statusCode).toBe(201)
  const requestPayload = requestRes.json() as { request?: { id?: string } }
  expect(requestPayload.request?.id).toBeTruthy()

  const acceptRes = await app.inject({
    method: 'POST',
    url: `/friends/requests/${requestPayload.request!.id!}/accept`,
    headers: authHeader(addressee.token),
  })
  expect(acceptRes.statusCode).toBe(200)
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

    await makeFriends(app, userA, userB)

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

  test('direct calls can expand into exact-combo group threads', async () => {
    const userA = await registerUser(app, 'Casey', 'North')
    const userB = await registerUser(app, 'Jordan', 'South')
    const userC = await registerUser(app, 'River', 'West')

    await makeFriends(app, userA, userB)
    await makeFriends(app, userA, userC)

    const dmRes = await app.inject({
      method: 'POST',
      url: '/messages/threads/direct',
      headers: authHeader(userA.token),
      payload: { userId: userB.id },
    })
    expect(dmRes.statusCode).toBe(200)
    const dmPayload = dmRes.json() as { thread?: { id?: string } }
    const directThreadId = dmPayload.thread?.id
    expect(directThreadId).toBeTruthy()

    const callStartRes = await app.inject({
      method: 'POST',
      url: `/messages/threads/${directThreadId}/call/start`,
      headers: authHeader(userA.token),
      payload: { mode: 'video' },
    })
    expect(callStartRes.statusCode).toBe(201)
    const callStartPayload = callStartRes.json() as { call?: { id?: string; threadId?: string; mode?: string } }
    expect(callStartPayload.call?.id).toBeTruthy()
    expect(callStartPayload.call?.threadId).toBe(directThreadId)
    expect(callStartPayload.call?.mode).toBe('video')

    const resolveRes = await app.inject({
      method: 'POST',
      url: `/messages/threads/${directThreadId}/resolve-group`,
      headers: authHeader(userA.token),
      payload: { participantIds: [userC.id] },
    })
    expect(resolveRes.statusCode).toBe(201)
    const resolvePayload = resolveRes.json() as { thread?: { id?: string; type?: string; participants?: Array<{ userId?: string }> } }
    const groupThreadId = resolvePayload.thread?.id
    expect(groupThreadId).toBeTruthy()
    expect(groupThreadId).not.toBe(directThreadId)
    expect(resolvePayload.thread?.type).toBe('group')
    expect(resolvePayload.thread?.participants?.map((participant) => participant.userId).sort()).toEqual(
      [userA.id, userB.id, userC.id].sort(),
    )

    const resolveAgainRes = await app.inject({
      method: 'POST',
      url: `/messages/threads/${directThreadId}/resolve-group`,
      headers: authHeader(userA.token),
      payload: { participantIds: [userC.id] },
    })
    expect(resolveAgainRes.statusCode).toBe(200)
    const resolveAgainPayload = resolveAgainRes.json() as { thread?: { id?: string } }
    expect(resolveAgainPayload.thread?.id).toBe(groupThreadId)

    const groupCallRes = await app.inject({
      method: 'POST',
      url: `/messages/threads/${groupThreadId}/call/start`,
      headers: authHeader(userA.token),
      payload: { mode: 'audio' },
    })
    expect(groupCallRes.statusCode).toBe(201)
    const groupCallPayload = groupCallRes.json() as { call?: { id?: string } }
    expect(groupCallPayload.call?.id).toBeTruthy()

    const getCallRes = await app.inject({
      method: 'GET',
      url: `/messages/threads/${groupThreadId}/call`,
      headers: authHeader(userB.token),
    })
    expect(getCallRes.statusCode).toBe(200)
    const getCallPayload = getCallRes.json() as { call?: { id?: string } | null }
    expect(getCallPayload.call?.id).toBe(groupCallPayload.call?.id)

    const endCallRes = await app.inject({
      method: 'POST',
      url: `/messages/calls/${groupCallPayload.call?.id}/end`,
      headers: authHeader(userB.token),
    })
    expect(endCallRes.statusCode).toBe(200)
    expect(endCallRes.json()).toMatchObject({ success: true })
  })
})
