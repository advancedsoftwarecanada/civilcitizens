'use client'

import { buildApiUrl } from './api'
import type { MeResponse } from './me'
import { useViewerStore } from './viewerStore'

const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'

function readCachedViewer(): MeResponse | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(VIEWER_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as MeResponse
  } catch {
    return null
  }
}

function writeCachedViewer(me: MeResponse) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(VIEWER_CACHE_KEY, JSON.stringify(me))
  } catch {
    // ignore quota / serialization issues
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
  if (!authToken) return null

  if (inFlight && inFlightToken === authToken) {
    return inFlight
  }

  if (!force && !refresh && store.me) {
    return store.me
  }

  if (!force && !refresh && !store.me) {
    const cached = readCachedViewer()
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
        window.localStorage.removeItem('token')
        store.setMe(null)
        return null
      }

      if (!res.ok) {
        return useViewerStore.getState().me
      }

      const data = (await res.json()) as MeResponse
      store.setMe(data)
      writeCachedViewer(data)
      return data
    } catch {
      return useViewerStore.getState().me
    } finally {
      inFlight = null
      inFlightToken = null
    }
  })()

  return inFlight
}
