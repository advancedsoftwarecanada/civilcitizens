import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { prisma } from '../../../packages/db/src/index.js'
import { authenticatePage, createTestUser } from './helpers/civilApi'

type CommunitiesResponse = {
  items?: Array<{
    slug?: string
  }>
}

type CreatedPostResponse = {
  id?: string
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

async function pickCommunity(request: APIRequestContext): Promise<{ province: string; municipality: string }> {
  const province = 'on'
  const response = await request.get(`/api/communities/${encodeURIComponent(province)}`)
  expect(response.ok(), `community lookup failed (${response.status()})`).toBeTruthy()
  const json = (await response.json()) as CommunitiesResponse
  const municipality = json.items?.[0]?.slug ?? null
  expect(municipality, 'community lookup returned no municipality').toBeTruthy()
  return { province, municipality: municipality as string }
}

async function seedHomeCommunity(userId: string, province: string, municipality: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { communityMeta: true },
  })
  expect(user, `missing user ${userId}`).toBeTruthy()

  const currentMeta =
    user?.communityMeta && typeof user.communityMeta === 'object' && !Array.isArray(user.communityMeta)
      ? { ...(user.communityMeta as Record<string, unknown>) }
      : {}
  const nowIso = new Date().toISOString()
  currentMeta.civicStatus = currentMeta.civicStatus ?? 'citizen'
  currentMeta.verificationMethod = currentMeta.verificationMethod ?? 'self_declaration'
  currentMeta.statusDeclaredAt = currentMeta.statusDeclaredAt ?? nowIso
  currentMeta.statusUpdatedAt = nowIso

  await prisma.user.update({
    where: { id: userId },
    data: { communityMeta: currentMeta },
  })

  await prisma.communityFollow.updateMany({
    where: { userId },
    data: { home: false },
  })

  await prisma.communityFollow.upsert({
    where: {
      userId_provinceCode_communitySlug: {
        userId,
        provinceCode: province,
        communitySlug: municipality,
      },
    },
    create: {
      userId,
      provinceCode: province,
      communitySlug: municipality,
      home: true,
    },
    update: {
      home: true,
    },
  })
}

async function seedHomeReplyScenario(page: Page, request: APIRequestContext) {
  const viewer = await createTestUser(request)
  const commenter = await createTestUser(request)
  const { province, municipality } = await pickCommunity(request)

  await Promise.all([
    seedHomeCommunity(viewer.userId, province, municipality),
    seedHomeCommunity(commenter.userId, province, municipality),
  ])

  const postBody = `Playwright home feed body ${Date.now()}`
  const commentBody = `Playwright top-level comment ${Date.now()}`

  const postResponse = await request.post('/api/posts', {
    headers: { authorization: `Bearer ${viewer.token}` },
    data: {
      type: 'post',
      audience: 'friends',
      visibility: 'public',
      body: postBody,
    },
  })
  expect(postResponse.ok(), `post create failed (${postResponse.status()})`).toBeTruthy()
  const postJson = (await postResponse.json()) as CreatedPostResponse
  const postId = postJson.id ?? null
  expect(postId, 'post create missing id').toBeTruthy()

  const commentResponse = await request.post('/api/comments', {
    headers: {
      authorization: `Bearer ${commenter.token}`,
      'content-type': 'application/json',
    },
    data: {
      postId,
      body: commentBody,
    },
  })
  expect(commentResponse.ok(), `comment create failed (${commentResponse.status()})`).toBeTruthy()

  await authenticatePage(page, viewer.token)
  return { postBody, commentBody }
}

test.describe('Home mobile feed comments', () => {
  test('feed cards are preview-only on mobile and route commenting into the post thread', async ({ page, request }) => {
    const { postBody, commentBody } = await seedHomeReplyScenario(page, request)

    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/home')
    await page.getByRole('button', { name: 'Latest' }).click()

    const postCard = page.locator('[data-feed-post-id]').filter({ hasText: postBody }).first()
    await expect(postCard).toBeVisible()
    await expect(postCard.getByText(commentBody)).toBeVisible()

    await expect(postCard.getByRole('button', { name: 'Reply' })).toHaveCount(0)
    await expect(postCard.locator('input[type="text"]')).toHaveCount(0)
    await expect(postCard.getByText('Add a comment')).toHaveCount(0)

    await postCard.getByRole('link', { name: 'Open comments' }).click()
    await expect(page).toHaveURL(/\/u\/.+\/posts\//)
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Comment composer' })).toBeVisible()
  })

  test('thread replies stay inline on mobile and remain visible while the keyboard opens', async ({ page, request }) => {
    await installVisualViewportMock(page)
    const { postBody, commentBody } = await seedHomeReplyScenario(page, request)

    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/home')
    await page.getByRole('button', { name: 'Latest' }).click()

    const postCard = page.locator('[data-feed-post-id]').filter({ hasText: postBody }).first()
    await expect(postCard).toBeVisible()
    await postCard.getByRole('link', { name: 'Open comments' }).click()
    await expect(page).toHaveURL(/\/u\/.+\/posts\//)
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()

    const threadComment = page.locator('article[id^="comment-"]').filter({ hasText: commentBody }).first()
    await expect(threadComment).toBeVisible()

    await threadComment.getByRole('button', { name: 'Reply' }).click()

    const replyComposer = threadComment.getByLabel(/Reply composer for @/).first()
    const replyInput = replyComposer.locator('textarea').first()

    await expect(replyComposer).toBeVisible()
    await expect(replyInput).toBeFocused()
    await expect(page.getByRole('group', { name: 'Comment composer' })).toHaveCount(0)

    await setMockKeyboard(page, true)

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const replyComposer = document.querySelector('form[aria-label^="Reply composer for @"]')
          const bottomComposer = document.querySelector('[role="group"][aria-label="Comment composer"]')
          const rect = replyComposer?.getBoundingClientRect() ?? null
          const viewportHeight = window.visualViewport?.height ?? window.innerHeight
          if (!replyComposer || bottomComposer || !rect) return false
          const midPoint = rect.top + rect.height / 2
          return rect.top >= 24 && rect.bottom <= viewportHeight - 24 && midPoint >= viewportHeight * 0.24 && midPoint <= viewportHeight * 0.76
        })
      })
      .toBe(true)

    await replyInput.fill(`Playwright inline reply ${Date.now()}`)
    await replyComposer.getByRole('button', { name: 'Reply' }).click()

    await setMockKeyboard(page, false)
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const composerInput = document.querySelector('[role="group"][aria-label="Comment composer"] input[type="text"]')
          return {
            keyboardOpen: document.documentElement.classList.contains('cc-keyboard-open'),
            htmlLocked: document.documentElement.classList.contains('cc-mobile-scroll-lock'),
            bodyLocked: document.body.classList.contains('cc-mobile-scroll-lock'),
            inputFocused: document.activeElement === composerInput,
          }
        })
      })
      .toEqual({
        keyboardOpen: false,
        htmlLocked: false,
        bodyLocked: false,
        inputFocused: false,
      })
    await expect(page.getByRole('group', { name: 'Comment composer' })).toBeVisible()
    await expect(threadComment.getByLabel(/Reply composer for @/)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
  })

  test('thread bottom comment composer stays fixed near the bottom while the keyboard opens', async ({ page, request }) => {
    await installVisualViewportMock(page)
    const { postBody } = await seedHomeReplyScenario(page, request)

    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/home')
    await page.getByRole('button', { name: 'Latest' }).click()

    const postCard = page.locator('[data-feed-post-id]').filter({ hasText: postBody }).first()
    await expect(postCard).toBeVisible()
    await postCard.getByRole('link', { name: 'Open comments' }).click()
    await expect(page).toHaveURL(/\/u\/.+\/posts\//)

    const composer = page.getByRole('group', { name: 'Comment composer' })
    const composerInput = composer.locator('input[type="text"]').first()

    await expect(composer).toBeVisible()
    await composerInput.focus()
    await setMockKeyboard(page, true)

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const composer = document.querySelector('[role="group"][aria-label="Comment composer"]')
          const rect = composer?.getBoundingClientRect() ?? null
          const viewportHeight = window.visualViewport?.height ?? window.innerHeight
          if (!composer || !rect) return false
          return rect.bottom <= viewportHeight + 8 && rect.top >= Math.max(0, viewportHeight - 170)
        })
      })
      .toBe(true)

    await composerInput.fill(`Playwright thread comment ${Date.now()}`)
    await composer.getByRole('button', { name: 'Post comment' }).click()
    await setMockKeyboard(page, false)

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const composerInput = document.querySelector('[role="group"][aria-label="Comment composer"] input[type="text"]')
          return {
            keyboardOpen: document.documentElement.classList.contains('cc-keyboard-open'),
            htmlLocked: document.documentElement.classList.contains('cc-mobile-scroll-lock'),
            bodyLocked: document.body.classList.contains('cc-mobile-scroll-lock'),
            inputFocused: document.activeElement === composerInput,
          }
        })
      })
      .toEqual({
        keyboardOpen: false,
        htmlLocked: false,
        bodyLocked: false,
        inputFocused: false,
      })
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Comment composer' })).toBeVisible()
  })
})
