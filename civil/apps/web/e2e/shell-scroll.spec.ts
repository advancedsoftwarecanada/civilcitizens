import { expect, test } from '@playwright/test'
import { authenticatePage, createTestUser } from './helpers/civilApi'

function measureDocumentOverflow() {
  const doc = document.documentElement
  return {
    viewportHeight: window.innerHeight,
    documentClientHeight: doc.clientHeight,
    documentScrollHeight: doc.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    overflow: doc.scrollHeight - doc.clientHeight,
  }
}

test.describe('App shell scrolling', () => {
  test('events page does not create extra desktop page overflow for short content', async ({ page, request }) => {
    const user = await createTestUser(request)

    await authenticatePage(page, user.token)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/events')
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible()

    const metrics = await page.evaluate(measureDocumentOverflow)
    expect(metrics.overflow, JSON.stringify(metrics)).toBeLessThanOrEqual(4)
  })

  test('messages page does not create extra mobile page overflow', async ({ page, request }) => {
    const user = await createTestUser(request)

    await authenticatePage(page, user.token)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/messages')
    await expect(page.getByText('Friends Inbox')).toBeVisible()

    const metrics = await page.evaluate(measureDocumentOverflow)
    expect(metrics.overflow, JSON.stringify(metrics)).toBeLessThanOrEqual(4)
  })
})
