'use client'

import { useViewerStore } from './viewerStore'
import { clearFamilyView } from './familyView'

const TOKEN_KEY = 'token'
const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'
export const FAMILY_PARENT_TOKEN_KEY = 'cc:family-parent-token:v1'
export const AUTH_SESSION_CHANGED_EVENT = 'civil:auth-session-changed'
export const FAMILY_SESSION_BOOTSTRAP_KEY = 'cc:family-session-bootstrap:v1'
const FAMILY_SESSION_BOOTSTRAP_TTL_MS = 20_000

function emitAuthSessionChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CHANGED_EVENT))
}

export function markFamilySessionBootstrapPending() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FAMILY_SESSION_BOOTSTRAP_KEY, String(Date.now()))
}

export function clearFamilySessionBootstrapPending() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(FAMILY_SESSION_BOOTSTRAP_KEY)
}

export function hasPendingFamilySessionBootstrap() {
  if (typeof window === 'undefined') return false
  const raw = window.localStorage.getItem(FAMILY_SESSION_BOOTSTRAP_KEY)
  if (!raw) return false
  const startedAt = Number(raw)
  if (!Number.isFinite(startedAt)) {
    window.localStorage.removeItem(FAMILY_SESSION_BOOTSTRAP_KEY)
    return false
  }
  const pending = Date.now() - startedAt <= FAMILY_SESSION_BOOTSTRAP_TTL_MS
  if (!pending) {
    window.localStorage.removeItem(FAMILY_SESSION_BOOTSTRAP_KEY)
  }
  return pending
}

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_KEY, token)
  window.localStorage.removeItem(FAMILY_PARENT_TOKEN_KEY)
  clearFamilySessionBootstrapPending()
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  clearFamilyView()
  emitAuthSessionChanged()
}

export function setFamilyLockedAuthSession(args: { childToken: string; parentToken: string }) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FAMILY_PARENT_TOKEN_KEY, args.parentToken)
  window.localStorage.setItem(TOKEN_KEY, args.childToken)
  markFamilySessionBootstrapPending()
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  emitAuthSessionChanged()
}

export function restoreParentAuthSession() {
  if (typeof window === 'undefined') return false
  const parentToken = window.localStorage.getItem(FAMILY_PARENT_TOKEN_KEY)
  if (!parentToken) {
    clearFamilyView()
    emitAuthSessionChanged()
    return false
  }

  window.localStorage.setItem(TOKEN_KEY, parentToken)
  window.localStorage.removeItem(FAMILY_PARENT_TOKEN_KEY)
  clearFamilySessionBootstrapPending()
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
  clearFamilySessionBootstrapPending()
  window.localStorage.removeItem(VIEWER_CACHE_KEY)
  useViewerStore.getState().setMe(null)
  clearFamilyView()
  emitAuthSessionChanged()
}
