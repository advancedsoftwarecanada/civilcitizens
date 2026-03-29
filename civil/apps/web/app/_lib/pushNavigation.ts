'use client'

export const PUSH_NAVIGATION_EVENT = 'cc:push-navigation'

export function emitPushNavigation(url: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ url: string }>(PUSH_NAVIGATION_EVENT, { detail: { url } }))
}
