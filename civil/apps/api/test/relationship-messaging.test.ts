import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

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

const makeFamily = async (
  app: FastifyInstance,
  requester: { token: string; id: string },
  addressee: { token: string; id: string },
  relationship: string,
  reciprocalRelationship: string,
) => {
  const requestRes = await app.inject({
    method: 'POST',
    url: '/profile/family-requests',
    headers: authHeader(requester.token),
    payload: { targetUserId: addressee.id, relationship },
  })
  expect(requestRes.statusCode).toBe(201)

  const notification = await prisma.notification.findFirst({
    where: {
      userId: addressee.id,
      actorId: requester.id,
      type: 'profile_family_invite',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  expect(notification?.id).toBeTruthy()

  const acceptRes = await app.inject({
    method: 'POST',
    url: `/notifications/${notification!.id}/respond`,
    headers: authHeader(addressee.token),
    payload: { action: 'accept', reciprocalRelationship },
  })
  expect(acceptRes.statusCode).toBe(200)
}

const makeConnectionViaNotification = async (
  app: FastifyInstance,
  requester: { token: string; id: string },
  addressee: { token: string; id: string },
) => {
  const requestRes = await app.inject({
    method: 'POST',
    url: '/connections/requests',
    headers: authHeader(requester.token),
    payload: { userId: addressee.id },
  })
  expect(requestRes.statusCode).toBe(201)

  const notification = await prisma.notification.findFirst({
    where: {
      userId: addressee.id,
      actorId: requester.id,
      type: 'connection_request',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      payload: true,
    },
  })
  expect(notification?.id).toBeTruthy()

  const acceptRes = await app.inject({
    method: 'POST',
    url: `/notifications/${notification!.id}/respond`,
    headers: authHeader(addressee.token),
    payload: { action: 'accept' },
  })
  expect(acceptRes.statusCode).toBe(200)
  expect(acceptRes.json()).toMatchObject({ ok: true, status: 'accepted' })

  const refreshed = await prisma.notification.findUnique({
    where: { id: notification!.id },
    select: { payload: true, readAt: true },
  })
  const payload =
    refreshed?.payload && typeof refreshed.payload === 'object' && !Array.isArray(refreshed.payload)
      ? (refreshed.payload as Record<string, unknown>)
      : null
  expect(payload?.status).toBe('accepted')
  expect(refreshed?.readAt).toBeTruthy()
}

const expectDirectMessagingToWork = async (
  app: FastifyInstance,
  sender: { token: string; id: string },
  receiver: { token: string; id: string },
  messageBody: string,
) => {
  const dmRes = await app.inject({
    method: 'POST',
    url: '/messages/threads/direct',
    headers: authHeader(sender.token),
    payload: { userId: receiver.id },
  })
  expect(dmRes.statusCode).toBe(200)
  const dmPayload = dmRes.json() as { thread?: { id?: string } }
  expect(dmPayload.thread?.id).toBeTruthy()
  const threadId = dmPayload.thread!.id!

  const sendRes = await app.inject({
    method: 'POST',
    url: `/messages/threads/${threadId}/messages`,
    headers: authHeader(sender.token),
    payload: { body: messageBody },
  })
  expect(sendRes.statusCode).toBe(201)

  const listRes = await app.inject({
    method: 'GET',
    url: `/messages/threads/${threadId}`,
    headers: authHeader(receiver.token),
  })
  expect(listRes.statusCode).toBe(200)
  const listPayload = listRes.json() as { messages?: Array<{ body?: string; senderId?: string }> }
  expect(listPayload.messages?.some((item) => item.body === messageBody && item.senderId === sender.id)).toBe(true)
}

let app: FastifyInstance

beforeAll(async () => {
  process.env.API_SKIP_LISTEN = '1'
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_secret'
  const mod = await import('../src/index.js')
  app = mod.app as FastifyInstance
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

describe('relationship messaging flows', () => {
  test('accepted friends can start direct threads and exchange messages', async () => {
    const userA = await registerUser(app, 'Friend', 'One')
    const userB = await registerUser(app, 'Friend', 'Two')

    await makeFriends(app, userA, userB)
    await expectDirectMessagingToWork(app, userA, userB, 'friend hello')
  })

  test('accepted family relationships can start direct threads and exchange messages', async () => {
    const userA = await registerUser(app, 'Family', 'One')
    const userB = await registerUser(app, 'Family', 'Two')

    await makeFamily(app, userA, userB, 'wife', 'husband')
    await expectDirectMessagingToWork(app, userA, userB, 'family hello')
  })

  test('accepted business connections from notifications can start direct threads and exchange messages', async () => {
    const userA = await registerUser(app, 'Network', 'One')
    const userB = await registerUser(app, 'Network', 'Two')

    await makeConnectionViaNotification(app, userA, userB)
    await expectDirectMessagingToWork(app, userA, userB, 'network hello')
  })
})
