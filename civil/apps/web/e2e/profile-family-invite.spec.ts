import { expect, test } from '@playwright/test'
import { prisma } from '../../../packages/db/src/index.js'
import { authenticatePage, createTestUser } from './helpers/civilApi'

async function getHandle(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  })
  expect(user?.handle, `missing handle for ${userId}`).toBeTruthy()
  return user!.handle as string
}

async function openFamilyInviteModal(page: import('@playwright/test').Page, handle: string) {
  await page.locator('summary').filter({ hasText: 'Connect' }).first().click()
  await page.getByRole('button', { name: 'Add Family' }).click()
  await expect(page.getByText(`Add @${handle} as family`, { exact: true })).toBeVisible()
}

async function chooseFamilyRelationship(page: import('@playwright/test').Page, label: string) {
  await page.locator('[data-family-relationship-picker] summary').click()
  await page.getByRole('button', { name: label, exact: true }).click()
}

test.describe('Profile family invites', () => {
  test('re-sending a pending family request as Brother refreshes cleanly from profile', async ({ page, request }) => {
    const sender = await createTestUser(request)
    const receiver = await createTestUser(request)
    const receiverHandle = await getHandle(receiver.userId)

    await authenticatePage(page, sender.token)
    await page.goto(`/u/${encodeURIComponent(receiverHandle)}`)

    await openFamilyInviteModal(page, receiverHandle)
    await chooseFamilyRelationship(page, 'Sister')
    await page.getByRole('button', { name: 'Send family request' }).click()
    await expect(page.getByText(`Family request sent to @${receiverHandle}.`)).toBeVisible()

    await openFamilyInviteModal(page, receiverHandle)
    await chooseFamilyRelationship(page, 'Brother')
    await page.getByRole('button', { name: 'Send family request' }).click()
    await expect(page.getByText(`Family request refreshed for @${receiverHandle}.`)).toBeVisible()
    await expect(page.getByText('Unable to send family request right now.')).toHaveCount(0)

    const notifications = await prisma.notification.findMany({
      where: {
        userId: receiver.userId,
        actorId: sender.userId,
        type: 'profile_family_invite',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        payload: true,
      },
    })

    expect(notifications.length).toBeGreaterThan(0)

    const latestPayload =
      notifications[0]?.payload && typeof notifications[0].payload === 'object' && !Array.isArray(notifications[0].payload)
        ? (notifications[0].payload as Record<string, unknown>)
        : null

    expect(latestPayload?.relationship).toBe('brother')
    expect(latestPayload?.status).toBe('pending')

    const pendingCount = notifications.filter((notification) => {
      const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
        ? (notification.payload as Record<string, unknown>)
        : null
      return payload?.status === 'pending'
    }).length

    expect(pendingCount).toBe(1)
  })
})
