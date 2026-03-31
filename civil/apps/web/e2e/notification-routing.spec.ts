import { expect, test, type APIRequestContext } from '@playwright/test'
import { authenticatePage, createTestUser } from './helpers/civilApi'

const NATIVE_PUSH_TAP_STORAGE_KEY = 'cc:lastNativeNotificationTapUrl'

async function makeFriends(
  request: APIRequestContext,
  requester: { token: string; userId: string },
  addressee: { token: string; userId: string },
) {
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

test.describe('Native push notification routing', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as Window & { Capacitor?: { getPlatform: () => string } }).Capacitor = {
        getPlatform: () => 'ios',
      }
    })
  })

  test('cold launch from root opens the pushed thread instead of falling through to home', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)

    await makeFriends(request, sender, receiver)
    const threadId = await createDirectThread(request, sender.token, receiver.userId)
    await sendMessage(request, sender.token, threadId, 'notification cold launch smoke')

    await page.addInitScript(
      ({ token, threadId, storageKey }) => {
        window.localStorage.setItem('token', token)
        window.localStorage.setItem(storageKey, `/messages?thread=${encodeURIComponent(threadId)}`)
      },
      { token: receiver.token, threadId, storageKey: NATIVE_PUSH_TAP_STORAGE_KEY },
    )

    await page.goto('/')

    await expect(page).toHaveURL(new RegExp(`/messages\\?thread=${encodeURIComponent(threadId)}`))
    await expect(page.getByText('notification cold launch smoke', { exact: true })).toBeVisible()
  })

  test('notification-open from an already open app on home still routes into the pushed thread', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)

    await makeFriends(request, sender, receiver)
    const threadId = await createDirectThread(request, sender.token, receiver.userId)
    await sendMessage(request, sender.token, threadId, 'notification drawer close smoke')

    await authenticatePage(page, receiver.token)
    await page.goto('/home')
    await expect(page).toHaveURL(/\/home$/)

    await page.evaluate(({ storageKey, nextUrl }) => {
      window.localStorage.setItem(storageKey, nextUrl)
      window.dispatchEvent(new Event('focus'))
    }, { storageKey: NATIVE_PUSH_TAP_STORAGE_KEY, nextUrl: `/messages?thread=${encodeURIComponent(threadId)}` })

    await expect(page).toHaveURL(new RegExp(`/messages\\?thread=${encodeURIComponent(threadId)}`))
    await expect(page.getByText('notification drawer close smoke', { exact: true })).toBeVisible()
  })
})
