'use client'

export const PUSH_NAVIGATION_EVENT = 'cc:push-navigation'
export const PUSH_UI_RESET_EVENT = 'cc:push-ui-reset'

export function emitPushNavigation(url: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ url: string }>(PUSH_NAVIGATION_EVENT, { detail: { url } }))
}

export function emitPushUiReset(url?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ url?: string }>(PUSH_UI_RESET_EVENT, { detail: { url } }))
}
