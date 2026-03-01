'use client'

import { buildApiUrl } from './api'
import { clearAuthSession } from './authSession'
import type { MeResponse } from './me'
import { useViewerStore } from './viewerStore'

const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'

type ViewerCachePayload = {
  tokenSub: string | null
  me: MeResponse
}

function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payloadPart = parts[1]
    if (!payloadPart) return null
    const payload = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const parsed = JSON.parse(window.atob(padded)) as { sub?: unknown }
    return typeof parsed.sub === 'string' && parsed.sub ? parsed.sub : null
  } catch {
    return null
  }
}

function isMeForToken(me: MeResponse | null, tokenSub: string | null): me is MeResponse {
  if (!me) return false
  if (!tokenSub) return true
  return me.id === tokenSub
}

function readCachedViewer(tokenSub: string | null): MeResponse | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(VIEWER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ViewerCachePayload | MeResponse

    if (parsed && typeof parsed === 'object' && 'me' in parsed) {
      const payload = parsed as ViewerCachePayload
      if (tokenSub && payload.tokenSub && payload.tokenSub !== tokenSub) return null
      return isMeForToken(payload.me, tokenSub) ? payload.me : null
    }

    const legacy = parsed as MeResponse
    return isMeForToken(legacy, tokenSub) ? legacy : null
  } catch {
    return null
  }
}

function writeCachedViewer(tokenSub: string | null, me: MeResponse) {
  if (typeof window === 'undefined') return
  try {
    const payload: ViewerCachePayload = { tokenSub, me }
    window.localStorage.setItem(VIEWER_CACHE_KEY, JSON.stringify(payload))
  } catch {
  }
}

function clearCachedViewer() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(VIEWER_CACHE_KEY)
  } catch {
  }
}

let inFlight: Promise<MeResponse | null> | null = null
let inFlightToken: string | null = null

export async function ensureViewerMe(options?: {
  token?: string | null
  cache?: RequestCache
  force?: boolean
  refresh?: boolean
}): Promise<MeResponse | null> {
  const { token, cache = 'no-store', force = false, refresh = false } = options ?? {}

  if (typeof window === 'undefined') return null

  const store = useViewerStore.getState()

  const authToken = token ?? window.localStorage.getItem('token')
  if (!authToken) {
    clearCachedViewer()
    store.setMe(null)
    return null
  }

  const tokenSub = decodeJwtSub(authToken)

  if (store.me && !isMeForToken(store.me, tokenSub)) {
    store.setMe(null)
  }

  if (inFlight && inFlightToken === authToken) {
    return inFlight
  }

  if (!force && !refresh && isMeForToken(store.me, tokenSub)) {
    return store.me
  }

  if (!force && !refresh && !store.me) {
    const cached = readCachedViewer(tokenSub)
    if (cached) {
      store.setMe(cached)
      return cached
    }
  }

  inFlightToken = authToken
  inFlight = (async () => {
    try {
      const res = await fetch(buildApiUrl('/auth/me'), {
        headers: { authorization: `Bearer ${authToken}` },
        cache,
      })

      if (res.status === 401) {
        clearAuthSession()
        return null
      }

      if (!res.ok) {
        const fallback = useViewerStore.getState().me
        return isMeForToken(fallback, tokenSub) ? fallback : null
      }

      const data = (await res.json()) as MeResponse
      if (tokenSub && data.id !== tokenSub) {
        clearAuthSession()
        return null
      }
      store.setMe(data)
      writeCachedViewer(tokenSub ?? data.id, data)
      return data
    } catch {
      const fallback = useViewerStore.getState().me
      return isMeForToken(fallback, tokenSub) ? fallback : null
    } finally {
      inFlight = null
      inFlightToken = null
    }
  })()

  return inFlight
}
