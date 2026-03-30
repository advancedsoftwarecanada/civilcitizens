import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { prisma } from '../../../packages/db/src/index.js'
import { authenticatePage, createTestUser } from './helpers/civilApi'

const MESSAGE_NAV_STORAGE_KEY = 'civil.messages.nav.active'

async function getHandle(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  })
  expect(user?.handle, `missing handle for ${userId}`).toBeTruthy()
  return user!.handle as string
}

async function makeFriends(request: APIRequestContext, requester: { token: string; userId: string }, addressee: { token: string; userId: string }) {
  const requestRes = await request.post('/api/friends/requests', {
    headers: { authorization: `Bearer ${requester.token}` },
    data: { userId: addressee.userId },
  })
  expect(requestRes.ok(), `friend request failed (${requestRes.status()})`).toBeTruthy()
  const requestJson = (await requestRes.json()) as { request?: { id?: string } }
  const friendshipId = requestJson.request?.id ?? null
  expect(friendshipId, 'missing friendship id').toBeTruthy()

  const acceptRes = await request.post(`/api/friends/requests/${encodeURIComponent(friendshipId as string)}/accept`, {
    headers: { authorization: `Bearer ${addressee.token}` },
  })
  expect(acceptRes.ok(), `friend accept failed (${acceptRes.status()})`).toBeTruthy()
}

async function makeFamily(
  request: APIRequestContext,
  requester: { token: string; userId: string },
  addressee: { token: string; userId: string },
  relationship: string,
  reciprocalRelationship: string,
) {
  const requestRes = await request.post('/api/profile/family-requests', {
    headers: { authorization: `Bearer ${requester.token}` },
    data: { targetUserId: addressee.userId, relationship },
  })
  expect(requestRes.ok(), `family request failed (${requestRes.status()})`).toBeTruthy()

  const notification = await prisma.notification.findFirst({
    where: {
      userId: addressee.userId,
      actorId: requester.userId,
      type: 'profile_family_invite',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  expect(notification?.id, 'missing family notification').toBeTruthy()

  const acceptRes = await request.post(`/api/notifications/${encodeURIComponent(notification!.id)}/respond`, {
    headers: { authorization: `Bearer ${addressee.token}` },
    data: { action: 'accept', reciprocalRelationship },
  })
  expect(acceptRes.ok(), `family accept failed (${acceptRes.status()})`).toBeTruthy()
}

async function makeConnectionViaNotification(
  request: APIRequestContext,
  requester: { token: string; userId: string },
  addressee: { token: string; userId: string },
) {
  const requestRes = await request.post('/api/connections/requests', {
    headers: { authorization: `Bearer ${requester.token}` },
    data: { userId: addressee.userId },
  })
  expect(requestRes.ok(), `connection request failed (${requestRes.status()})`).toBeTruthy()

  const notification = await prisma.notification.findFirst({
    where: {
      userId: addressee.userId,
      actorId: requester.userId,
      type: 'connection_request',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  expect(notification?.id, 'missing connection notification').toBeTruthy()

  const acceptRes = await request.post(`/api/notifications/${encodeURIComponent(notification!.id)}/respond`, {
    headers: { authorization: `Bearer ${addressee.token}` },
    data: { action: 'accept' },
  })
  expect(acceptRes.ok(), `connection accept failed (${acceptRes.status()})`).toBeTruthy()
}

async function createDirectThread(request: APIRequestContext, token: string, targetUserId: string) {
  const res = await request.post('/api/messages/threads/direct', {
    headers: { authorization: `Bearer ${token}` },
    data: { userId: targetUserId },
  })
  expect(res.ok(), `direct thread failed (${res.status()})`).toBeTruthy()
  const json = (await res.json()) as { thread?: { id?: string } }
  const threadId = json.thread?.id ?? null
  expect(threadId, 'missing thread id').toBeTruthy()
  return threadId as string
}

async function sendMessage(request: APIRequestContext, token: string, threadId: string, body: string) {
  const res = await request.post(`/api/messages/threads/${encodeURIComponent(threadId)}/messages`, {
    headers: { authorization: `Bearer ${token}` },
    data: { body },
  })
  expect(res.ok(), `send message failed (${res.status()})`).toBeTruthy()
}

function getThreadComposerInput(page: Page) {
  return page.getByRole('textbox', { name: 'Write a message' }).first()
}

async function sendMessageInOpenThread(page: Page, body: string) {
  const input = getThreadComposerInput(page)
  await expect(input).toBeVisible()
  await input.fill(body)
  await page.getByRole('button', { name: /^Send$/ }).last().click()
  await expect(page.getByText(body, { exact: true })).toBeVisible()
}

async function sendMessageFromProfile(page: Page, expectedInboxLabel: string, body: string) {
  await page.getByRole('button', { name: /^Message$/ }).first().click()
  await expect(page.getByText(expectedInboxLabel, { exact: true })).toBeVisible()
  await sendMessageInOpenThread(page, body)
}

test.describe('Relationship messaging flows', () => {
  test('friends can open a profile DM and send a message', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)
    const receiverHandle = await getHandle(receiver.userId)

    await makeFriends(request, sender, receiver)

    await authenticatePage(page, sender.token)
    await page.goto(`/u/${encodeURIComponent(receiverHandle)}`)

    await sendMessageFromProfile(page, 'Friends Inbox', 'friend profile smoke')
    await expect(page).toHaveURL(/\/messages\?inbox=friends&thread=/)
  })

  test('family can open a direct thread in the Family inbox and send a message', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)

    await makeFamily(request, sender, receiver, 'brother', 'sister')
    await createDirectThread(request, sender.token, receiver.userId)

    await authenticatePage(page, sender.token)
    await page.goto('/messages?inbox=family')

    await expect(page.getByText('Family Inbox', { exact: true })).toBeVisible()
    await page.locator('aside button').first().click()
    await sendMessageInOpenThread(page, 'family profile smoke')
    await expect(page).toHaveURL(/\/messages\?inbox=family/)
  })

  test('business connections can open a profile DM and send a message', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)
    const receiverHandle = await getHandle(receiver.userId)

    await makeConnectionViaNotification(request, sender, receiver)

    await authenticatePage(page, sender.token)
    await page.goto(`/u/${encodeURIComponent(receiverHandle)}`)

    await sendMessageFromProfile(page, 'Network Inbox', 'network profile smoke')
    await expect(page).toHaveURL(/\/messages\?inbox=network&thread=/)
  })

  test('network deep links recover the right inbox and keep the message visible', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)

    await makeConnectionViaNotification(request, sender, receiver)
    const threadId = await createDirectThread(request, sender.token, receiver.userId)
    await sendMessage(request, sender.token, threadId, 'network deep link smoke')

    await page.addInitScript((tokenAndNav) => {
      window.localStorage.setItem('token', tokenAndNav.token)
      window.localStorage.setItem(tokenAndNav.storageKey, JSON.stringify({ active: tokenAndNav.active }))
    }, { token: receiver.token, active: 'friends', storageKey: MESSAGE_NAV_STORAGE_KEY })

    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)

    await expect(page.getByText('Network Inbox', { exact: true })).toBeVisible()
    await expect(page.getByText('network deep link smoke', { exact: true })).toBeVisible()
    await expect(getThreadComposerInput(page)).toBeVisible()

    await page.reload()
    await expect(page.getByText('Network Inbox', { exact: true })).toBeVisible()
    await expect(page.getByText('network deep link smoke', { exact: true })).toBeVisible()
  })
})
