'use client'

import { useViewerStore } from './viewerStore'

const TOKEN_KEY = 'token'
const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'
export const AUTH_SESSION_CHANGED_EVENT = 'civil:auth-session-changed'

function emitAuthSessionChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CHANGED_EVENT))
}

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_KEY, token)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  emitAuthSessionChanged()
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  emitAuthSessionChanged()
}
