import { expect, test } from '@playwright/test'
import { authenticatePage, createPublishedCause } from './helpers/civilApi'

test.describe('Causes', () => {
  test('supports one-time and monthly donations through the confirmation modal', async ({ page, request }) => {
    const cause = await createPublishedCause(request)

    await authenticatePage(page, cause.supporterToken)

    await page.goto(`/post/${cause.postId}`)
    await expect(page.getByText('Funding roadmap')).toBeVisible()
    await expect(page.getByText('Stage Goals', { exact: true })).toBeVisible()
    await expect(page.getByText(cause.firstStageDescription)).toBeVisible()
    await expect(page.getByText('Wallet balance', { exact: true })).toBeVisible()

    const supportCard = page.locator('div').filter({ has: page.getByText('Back this Cause') }).first()

    await supportCard.getByRole('button', { name: 'Donate Once' }).click()

    const oneTimeModal = page.locator('[data-cc-modal-root]').last()
    await expect(oneTimeModal.getByText('Confirm your support')).toBeVisible()
    await expect(oneTimeModal.getByText('Total wallet charge')).toBeVisible()

    const oneTimeResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/causes/${cause.postId}/wallet-contributions`) &&
        response.request().method() === 'POST' &&
        response.ok(),
    )
    await oneTimeModal.getByRole('button', { name: 'Donate Once' }).click()
    await oneTimeResponse

    await expect(page.getByRole('status').filter({ hasText: 'Support sent from your Civil Wallet.' })).toBeVisible()
    await expect(page.locator('[data-cc-modal-root]')).toHaveCount(0)
    await expect(page.getByText('$25 raised')).toBeVisible()
    await expect(page.getByText('1 backing')).toBeVisible()

    await supportCard.getByRole('button', { name: 'Donate Monthly' }).click()

    const monthlyModal = page.locator('[data-cc-modal-root]').last()
    await expect(monthlyModal.getByText('Confirm your support')).toBeVisible()
    await expect(monthlyModal.getByText('Total wallet charge')).toBeVisible()

    const monthlyResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/causes/${cause.postId}/subscriptions`) &&
        response.request().method() === 'POST' &&
        response.ok(),
    )
    await monthlyModal.getByRole('button', { name: 'Donate Monthly' }).click()
    await monthlyResponse

    await expect(page.getByRole('status').filter({ hasText: 'Monthly support started.' })).toBeVisible()
    await expect(page.locator('[data-cc-modal-root]')).toHaveCount(0)
    await expect(page.getByText('Current monthly support')).toBeVisible()
    await expect(page.getByText('$50 raised')).toBeVisible()
    await expect(page.getByText('2 backings')).toBeVisible()
  })
})