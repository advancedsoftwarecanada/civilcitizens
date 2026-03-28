'use client'

import { useSyncExternalStore } from 'react'

export type MobileKeyboardSnapshot = {
  viewportHeight: number
  viewportWidth: number
  viewportOffsetTop: number
  viewportOffsetLeft: number
  layoutViewportHeight: number
  layoutViewportWidth: number
  bottomOverlap: number
  heightDelta: number
  keyboardHeight: number
  keyboardOpen: boolean
  activeEditable: boolean
}

const KEYBOARD_MIN_INSET_PX = 72
const KEYBOARD_MIN_DELTA_PX = 96
const RECENT_EDITABLE_FOCUS_MS = 1200
const KEYBOARD_OPEN_HOLD_MS = 220
const VIEWPORT_BASELINE_RESET_WIDTH_DELTA_PX = 80

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLInputElement) {
    const nonTextTypes = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])
    return !nonTextTypes.has(element.type)
  }
  return false
}

function getServerSnapshot(): MobileKeyboardSnapshot {
  return {
    viewportHeight: 0,
    viewportWidth: 0,
    viewportOffsetTop: 0,
    viewportOffsetLeft: 0,
    layoutViewportHeight: 0,
    layoutViewportWidth: 0,
    bottomOverlap: 0,
    heightDelta: 0,
    keyboardHeight: 0,
    keyboardOpen: false,
    activeEditable: false,
  }
}

function snapshotsEqual(a: MobileKeyboardSnapshot, b: MobileKeyboardSnapshot): boolean {
  return (
    a.viewportHeight === b.viewportHeight &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportOffsetTop === b.viewportOffsetTop &&
    a.viewportOffsetLeft === b.viewportOffsetLeft &&
    a.layoutViewportHeight === b.layoutViewportHeight &&
    a.layoutViewportWidth === b.layoutViewportWidth &&
    a.bottomOverlap === b.bottomOverlap &&
    a.heightDelta === b.heightDelta &&
    a.keyboardHeight === b.keyboardHeight &&
    a.keyboardOpen === b.keyboardOpen &&
    a.activeEditable === b.activeEditable
  )
}

let currentSnapshot = getServerSnapshot()
let cleanupListeners: (() => void) | null = null
const subscribers = new Set<() => void>()
let baselineViewportHeight = 0
let baselineViewportWidth = 0
let lastEditableFocusAt = 0
let lastKeyboardOpenAt = 0

function computeSnapshot(): MobileKeyboardSnapshot {
  if (typeof window === 'undefined') return getServerSnapshot()

  const now = Date.now()
  const viewport = window.visualViewport
  const layoutViewportHeight = Math.round(window.innerHeight)
  const layoutViewportWidth = Math.round(window.innerWidth)
  const viewportHeight = Math.round(viewport?.height ?? layoutViewportHeight)
  const viewportWidth = Math.round(viewport?.width ?? layoutViewportWidth)
  const viewportOffsetTop = Math.round(viewport?.offsetTop ?? 0)
  const viewportOffsetLeft = Math.round(viewport?.offsetLeft ?? 0)
  const activeEditable = typeof document !== 'undefined' ? isEditableElement(document.activeElement) : false

  if (activeEditable) {
    lastEditableFocusAt = now
  }

  if (baselineViewportWidth > 0 && Math.abs(viewportWidth - baselineViewportWidth) >= VIEWPORT_BASELINE_RESET_WIDTH_DELTA_PX) {
    baselineViewportHeight = 0
    baselineViewportWidth = 0
    lastKeyboardOpenAt = 0
  }

  const closedViewportCandidate = Math.max(layoutViewportHeight, viewportHeight + viewportOffsetTop)
  baselineViewportHeight = baselineViewportHeight > 0 ? Math.max(baselineViewportHeight, closedViewportCandidate) : closedViewportCandidate
  baselineViewportWidth = baselineViewportWidth > 0 ? Math.max(baselineViewportWidth, viewportWidth) : viewportWidth

  const inferredBottomOverlap = Math.max(0, Math.round(baselineViewportHeight - viewportHeight - viewportOffsetTop))
  const inferredHeightDelta = Math.max(0, Math.round(baselineViewportHeight - viewportHeight))
  const keyboardVisible = inferredBottomOverlap > KEYBOARD_MIN_INSET_PX || inferredHeightDelta > KEYBOARD_MIN_DELTA_PX
  const editableRecentlyActive = activeEditable || now - lastEditableFocusAt < RECENT_EDITABLE_FOCUS_MS
  const keyboardOpen = keyboardVisible && (editableRecentlyActive || now - lastKeyboardOpenAt < KEYBOARD_OPEN_HOLD_MS)

  if (keyboardOpen) {
    lastKeyboardOpenAt = now
  }

  return {
    viewportHeight,
    viewportWidth,
    viewportOffsetTop,
    viewportOffsetLeft,
    layoutViewportHeight,
    layoutViewportWidth,
    bottomOverlap: inferredBottomOverlap,
    heightDelta: inferredHeightDelta,
    keyboardHeight: keyboardOpen ? Math.max(inferredBottomOverlap, inferredHeightDelta) : 0,
    keyboardOpen,
    activeEditable,
  }
}

function emitSnapshotChange() {
  const nextSnapshot = computeSnapshot()
  if (snapshotsEqual(currentSnapshot, nextSnapshot)) return
  currentSnapshot = nextSnapshot
  subscribers.forEach((subscriber) => subscriber())
}

function ensureListeners() {
  if (cleanupListeners || typeof window === 'undefined') return

  currentSnapshot = computeSnapshot()
  const handleChange = () => {
    emitSnapshotChange()
  }

  const viewport = window.visualViewport
  viewport?.addEventListener('resize', handleChange)
  viewport?.addEventListener('scroll', handleChange)
  window.addEventListener('resize', handleChange)
  window.addEventListener('orientationchange', handleChange)
  window.addEventListener('focusin', handleChange)
  window.addEventListener('focusout', handleChange)
  document.addEventListener('visibilitychange', handleChange)

  cleanupListeners = () => {
    viewport?.removeEventListener('resize', handleChange)
    viewport?.removeEventListener('scroll', handleChange)
    window.removeEventListener('resize', handleChange)
    window.removeEventListener('orientationchange', handleChange)
    window.removeEventListener('focusin', handleChange)
    window.removeEventListener('focusout', handleChange)
    document.removeEventListener('visibilitychange', handleChange)
    cleanupListeners = null
  }
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}

  ensureListeners()
  subscribers.add(onStoreChange)

  return () => {
    subscribers.delete(onStoreChange)
    if (subscribers.size === 0 && cleanupListeners) {
      cleanupListeners()
    }
  }
}

function getSnapshot() {
  if (typeof window !== 'undefined') {
    const nextSnapshot = computeSnapshot()
    if (!snapshotsEqual(currentSnapshot, nextSnapshot)) {
      currentSnapshot = nextSnapshot
    }
  }
  return currentSnapshot
}

export function useMobileKeyboardState(): MobileKeyboardSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function readMobileKeyboardSnapshot(): MobileKeyboardSnapshot {
  return getSnapshot()
}
