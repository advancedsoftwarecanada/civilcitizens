'use client'

import { useViewerStore } from './viewerStore'

const TOKEN_KEY = 'token'
const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_KEY, token)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
}
