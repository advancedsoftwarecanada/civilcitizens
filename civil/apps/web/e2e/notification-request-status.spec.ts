import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { authenticatePage, createTestUser } from './helpers/civilApi'

async function sendConnectionRequest(
  request: APIRequestContext,
  requester: { token: string; userId: string },
  addressee: { userId: string },
) {
  const response = await request.post('/api/connections/requests', {
    headers: { authorization: `Bearer ${requester.token}` },
    data: { userId: addressee.userId },
  })
  expect(response.ok(), `connection request failed (${response.status()})`).toBeTruthy()
}

async function sendFriendRequest(
  request: APIRequestContext,
  requester: { token: string; userId: string },
  addressee: { userId: string },
) {
  const response = await request.post('/api/friends/requests', {
    headers: { authorization: `Bearer ${requester.token}` },
    data: { userId: addressee.userId },
  })
  expect(response.ok(), `friend request failed (${response.status()})`).toBeTruthy()
}

async function acceptFirstPendingRequestCard(page: Page, messageText: string) {
  const card = page.locator('div.rounded-2xl').filter({ has: page.getByText(messageText, { exact: true }) }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /^Accept$/i }).click()
  return card
}

test.describe('Notification request status persistence', () => {
  test('connection request accepted from notifications stays accepted after reload', async ({ page, request }) => {
    const requester = await createTestUser(request)
    const addressee = await createTestUser(request)

    await sendConnectionRequest(request, requester, addressee)

    await authenticatePage(page, addressee.token)
    await page.goto('/notifications')

    await acceptFirstPendingRequestCard(page, 'Sent you a connection request')
    await expect(page.getByText('You accepted the connection request', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible()

    await page.reload()

    await expect(page.getByText('You accepted the connection request', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Accept$/i })).toHaveCount(0)
  })

  test('friend request accepted from notifications stays accepted after reload', async ({ page, request }) => {
    const requester = await createTestUser(request)
    const addressee = await createTestUser(request)

    await sendFriendRequest(request, requester, addressee)

    await authenticatePage(page, addressee.token)
    await page.goto('/notifications')

    await acceptFirstPendingRequestCard(page, 'Sent you a friend request')
    await expect(page.getByText('You accepted the friend request', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible()

    await page.reload()

    await expect(page.getByText('You accepted the friend request', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Accept$/i })).toHaveCount(0)
  })
})
