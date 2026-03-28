import { expect, test, type Page } from '@playwright/test'
import { authenticatePage, createTestUser } from './helpers/civilApi'

type ThreadCreateResponse = {
  thread?: {
    id?: string
  }
}

type FriendRequestResponse = {
  request?: {
    id?: string
  }
}

const MOBILE_VIEWPORT = { width: 390, height: 844 }
const KEYBOARD_OPEN_HEIGHT = 544

async function installVisualViewportMock(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    let width = window.innerWidth
    let height = window.innerHeight
    let offsetTop = 0
    let offsetLeft = 0

    const viewport = {
      get width() {
        return width
      },
      get height() {
        return height
      },
      get offsetTop() {
        return offsetTop
      },
      get offsetLeft() {
        return offsetLeft
      },
      scale: 1,
      pageTop: 0,
      pageLeft: 0,
      addEventListener(type: string, listener: (event: Event) => void) {
        const bucket = listeners.get(type) ?? new Set<(event: Event) => void>()
        bucket.add(listener)
        listeners.set(type, bucket)
      },
      removeEventListener(type: string, listener: (event: Event) => void) {
        listeners.get(type)?.delete(listener)
      },
    }

    const emit = (type: string) => {
      const event = new Event(type)
      listeners.get(type)?.forEach((listener) => listener(event))
    }

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    })

    Object.defineProperty(window, '__setMockVisualViewport', {
      configurable: true,
      value: (next: Partial<{ width: number; height: number; offsetTop: number; offsetLeft: number }>) => {
        if (typeof next.width === 'number') width = next.width
        if (typeof next.height === 'number') height = next.height
        if (typeof next.offsetTop === 'number') offsetTop = next.offsetTop
        if (typeof next.offsetLeft === 'number') offsetLeft = next.offsetLeft
        emit('resize')
        emit('scroll')
        window.dispatchEvent(new Event('resize'))
      },
    })
  })
}

async function setMockKeyboard(page: Page, open: boolean) {
  await page.evaluate(
    ({ nextHeight }) => {
      ;(window as Window & { __setMockVisualViewport?: (next: { height: number; offsetTop: number }) => void }).__setMockVisualViewport?.({
        height: nextHeight,
        offsetTop: 0,
      })
    },
    { nextHeight: open ? KEYBOARD_OPEN_HEIGHT : MOBILE_VIEWPORT.height },
  )
}

async function seedDirectThread(page: Page, request: Parameters<typeof test>[0]['request']) {
  const sender = await createTestUser(request)
  const recipient = await createTestUser(request)

  const friendRequestResponse = await request.post('/api/friends/requests', {
    headers: { authorization: `Bearer ${sender.token}` },
    data: { userId: recipient.userId },
  })
  expect(friendRequestResponse.ok(), `friend request failed (${friendRequestResponse.status()})`).toBeTruthy()
  const friendRequestJson = (await friendRequestResponse.json()) as FriendRequestResponse
  const friendshipId = friendRequestJson.request?.id ?? null
  expect(friendshipId, 'friend request missing id').toBeTruthy()

  const acceptResponse = await request.post(`/api/friends/requests/${encodeURIComponent(friendshipId as string)}/accept`, {
    headers: { authorization: `Bearer ${recipient.token}` },
  })
  expect(acceptResponse.ok(), `friend accept failed (${acceptResponse.status()})`).toBeTruthy()

  const threadResponse = await request.post('/api/messages/threads/direct', {
    headers: { authorization: `Bearer ${sender.token}` },
    data: { userId: recipient.userId },
  })
  expect(threadResponse.ok(), `direct thread failed (${threadResponse.status()})`).toBeTruthy()
  const threadJson = (await threadResponse.json()) as ThreadCreateResponse
  const threadId = threadJson.thread?.id ?? null
  expect(threadId, 'direct thread missing id').toBeTruthy()

  await authenticatePage(page, sender.token)
  return { threadId: threadId as string }
}

async function readComposerMetrics(page: Page) {
  return page.evaluate(() => {
    const composer = document.querySelector('[role="group"][aria-label="Message composer"]')
    const dock = document.querySelector('[data-mobile-dock="true"]')
    const composerRect = composer?.getBoundingClientRect() ?? null
    const dockStyle = dock ? getComputedStyle(dock) : null
    return {
      keyboardOpen: document.documentElement.classList.contains('cc-keyboard-open'),
      htmlLocked: document.documentElement.classList.contains('cc-mobile-scroll-lock'),
      bodyLocked: document.body.classList.contains('cc-mobile-scroll-lock'),
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      composerTop: composerRect?.top ?? null,
      composerBottom: composerRect?.bottom ?? null,
      dockOpacity: dockStyle ? Number.parseFloat(dockStyle.opacity) : null,
      dockPointerEvents: dockStyle?.pointerEvents ?? null,
    }
  })
}

test.describe('Messages mobile composer', () => {
  test('composer stays visible and dock toggles cleanly across repeated keyboard cycles', async ({ page, request }) => {
    await installVisualViewportMock(page)
    const { threadId } = await seedDirectThread(page, request)

    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)
    await expect(page.getByRole('group', { name: 'Message composer' })).toBeVisible()

    const composer = page.locator('[role="group"][aria-label="Message composer"]')
    const composerInput = composer.locator('input[type="text"]').first()
    const sendButton = composer.locator('button').last()

    for (const body of ['Playwright cycle one', 'Playwright cycle two', 'Playwright cycle three']) {
      await composerInput.focus()
      await setMockKeyboard(page, true)

      await expect
        .poll(async () => {
          const metrics = await readComposerMetrics(page)
          return (
            metrics.keyboardOpen &&
            metrics.composerBottom !== null &&
            metrics.composerBottom <= metrics.viewportHeight + 8 &&
            metrics.dockOpacity !== null &&
            metrics.dockOpacity < 0.1 &&
            metrics.dockPointerEvents === 'none'
          )
        })
        .toBe(true)

      await composerInput.fill(body)
      await sendButton.click()
      await expect(page.locator('p.whitespace-pre-wrap.break-words', { hasText: body }).first()).toBeVisible()

      await page.evaluate(() => {
        ;(document.activeElement as HTMLElement | null)?.blur()
      })
      await setMockKeyboard(page, false)

      await expect
        .poll(async () => {
          const metrics = await readComposerMetrics(page)
          return (
            !metrics.keyboardOpen &&
            !metrics.htmlLocked &&
            !metrics.bodyLocked &&
            metrics.composerBottom !== null &&
            metrics.composerTop !== null &&
            metrics.composerBottom <= metrics.viewportHeight + 8 &&
            metrics.composerTop >= metrics.viewportHeight - 170 &&
            metrics.dockOpacity !== null &&
            metrics.dockOpacity > 0.8 &&
            metrics.dockPointerEvents === 'auto'
          )
        })
        .toBe(true)
    }
  })

  test('composer hides while the mobile more drawer is open and returns after close', async ({ page, request }) => {
    const { threadId } = await seedDirectThread(page, request)

    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)

    const composer = page.getByRole('group', { name: 'Message composer' })
    await expect(composer).toBeVisible()

    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByText('Communities & shortcuts')).toBeVisible()
    await expect(composer).toHaveCount(0)

    await page.getByRole('button', { name: 'Close more panel' }).last().click()
    await expect(page.getByText('Communities & shortcuts')).toHaveCount(0)
    await expect(composer).toBeVisible()
  })
})
