import { expect, test } from '@playwright/test'
import { authenticatePage, createPublishedCause } from './helpers/civilApi'

test.describe('Causes', () => {
  test('loads published cause pages publicly without a login redirect', async ({ page, request }) => {
    const shareImageUrl = 'https://example.com/cause-share-preview.jpg'
    const cause = await createPublishedCause(request, { imageUrls: [shareImageUrl] })

    await page.goto(cause.path)

    await expect(page).toHaveURL(new RegExp(`${cause.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect(page.getByText(cause.title)).toBeVisible()
    await expect(page.getByText('Funding roadmap')).toBeVisible()
    await expect(page.getByText(cause.firstStageDescription)).toBeVisible()
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', cause.title)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', shareImageUrl)
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
  })

  test('supports one-time and monthly donations through the confirmation modal', async ({ page, request }) => {
    const cause = await createPublishedCause(request)

    await authenticatePage(page, cause.supporterToken)

    await page.goto(`/post/${cause.postId}`)
    await expect(page.getByText('Funding roadmap')).toBeVisible()
    await expect(page.getByText('Goals', { exact: true })).toBeVisible()
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

    await expect(page.getByRole('status').filter({ hasText: `Donated to ${cause.title}` })).toBeVisible()
    await expect(page.locator('[data-cc-modal-root]')).toHaveCount(0)
    await expect(page.getByText('$25 raised').first()).toBeVisible()
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

    await expect(page.getByRole('status').filter({ hasText: `Started monthly support for ${cause.title}` })).toBeVisible()
    await expect(page.locator('[data-cc-modal-root]')).toHaveCount(0)
    await expect(page.getByText('Current monthly support')).toBeVisible()
    await expect(page.getByText('$50 raised').first()).toBeVisible()
    await expect(page.getByText('2 backings')).toBeVisible()
  })
})
