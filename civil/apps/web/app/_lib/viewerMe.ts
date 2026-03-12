'use client'

import { buildApiUrl } from './api'
import { clearAuthSession, clearFamilySessionBootstrapPending, hasPendingFamilySessionBootstrap, markFamilySessionBootstrapPending } from './authSession'
import type { MeResponse } from './me'
import { useViewerStore } from './viewerStore'

const VIEWER_CACHE_KEY = 'cc:viewer-cache:v1'

type ViewerCachePayload = {
  tokenSub: string | null
  me: MeResponse
}

type DecodedAuthToken = {
  sub: string | null
  actor: 'user' | 'family_member' | null
}

function decodeJwtPayload(token: string): DecodedAuthToken {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return { sub: null, actor: null }
    const payloadPart = parts[1]
    if (!payloadPart) return { sub: null, actor: null }
    const payload = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const parsed = JSON.parse(window.atob(padded)) as { sub?: unknown; actor?: unknown }
    return {
      sub: typeof parsed.sub === 'string' && parsed.sub ? parsed.sub : null,
      actor: parsed.actor === 'family_member' || parsed.actor === 'user' ? parsed.actor : null,
    }
  } catch {
    return { sub: null, actor: null }
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

const DEV_SESSION_RECOVERY_ATTEMPTS = 8
const DEV_SESSION_RECOVERY_DELAY_MS = 1200

function shouldUseDevSessionRecovery() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.trim().toLowerCase()
  return host === 'dev.civilcitizens.ca' || host === 'localhost' || host === '127.0.0.1'
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function readAuthErrorCode(response: Response): Promise<string | null> {
  try {
    const payload = (await response.clone().json()) as { error?: unknown }
    return typeof payload?.error === 'string' ? payload.error : null
  } catch {
    return null
  }
}

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
    clearFamilySessionBootstrapPending()
    store.setMe(null)
    return null
  }

  const decodedToken = decodeJwtPayload(authToken)
  const tokenSub = decodedToken.sub
  const shouldUseFamilySessionRecovery = decodedToken.actor === 'family_member' || hasPendingFamilySessionBootstrap()

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
      const maxAttempts = shouldUseDevSessionRecovery() || shouldUseFamilySessionRecovery ? DEV_SESSION_RECOVERY_ATTEMPTS : 1
      let res: Response | null = null

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        res = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${authToken}` },
          cache,
        })

        if (res.status !== 401 || attempt === maxAttempts) {
          break
        }

        await wait(DEV_SESSION_RECOVERY_DELAY_MS)
      }

      if (!res) {
        const fallback = useViewerStore.getState().me
        return isMeForToken(fallback, tokenSub) ? fallback : null
      }

      if (res.status === 401) {
        if (shouldUseFamilySessionRecovery) {
          const cached = readCachedViewer(tokenSub)
          if (cached) {
            store.setMe(cached)
            return cached
          }
          return null
        }
        clearAuthSession()
        return null
      }

      if (res.status === 403) {
        const errorCode = await readAuthErrorCode(res)
        if (errorCode === 'account_suspended') {
          clearAuthSession()
          return null
        }
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
      if (data.accountType === 'family_member') {
        markFamilySessionBootstrapPending()
      } else {
        clearFamilySessionBootstrapPending()
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
