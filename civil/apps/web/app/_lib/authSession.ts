'use client'

import { useViewerStore } from './viewerStore'
import { clearFamilyView } from './familyView'

const TOKEN_KEY = 'token'
const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'
export const FAMILY_PARENT_TOKEN_KEY = 'cc:family-parent-token:v1'
export const AUTH_SESSION_CHANGED_EVENT = 'civil:auth-session-changed'

function emitAuthSessionChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CHANGED_EVENT))
}

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_KEY, token)
  window.localStorage.removeItem(FAMILY_PARENT_TOKEN_KEY)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  clearFamilyView()
  emitAuthSessionChanged()
}

export function setFamilyLockedAuthSession(args: { childToken: string; parentToken: string }) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FAMILY_PARENT_TOKEN_KEY, args.parentToken)
  window.localStorage.setItem(TOKEN_KEY, args.childToken)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  emitAuthSessionChanged()
}

export function restoreParentAuthSession() {
  if (typeof window === 'undefined') return false
  const parentToken = window.localStorage.getItem(FAMILY_PARENT_TOKEN_KEY)
  if (!parentToken) {
    clearAuthSession()
    return false
  }

  window.localStorage.setItem(TOKEN_KEY, parentToken)
  window.localStorage.removeItem(FAMILY_PARENT_TOKEN_KEY)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  clearFamilyView()
  emitAuthSessionChanged()
  return true
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(FAMILY_PARENT_TOKEN_KEY)
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  clearFamilyView()
  emitAuthSessionChanged()
}
