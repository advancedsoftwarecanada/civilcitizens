'use client'

import { useEffect } from 'react'
import { buildApiUrl } from '../_lib/api'
import type { MeResponse } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'

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

export default function ViewerBootstrap() {
  const setMe = useViewerStore((s) => s.setMe)
  const setHydrated = useViewerStore((s) => s.setHydrated)

  useEffect(() => {
    const cached = readCachedViewer()
    if (cached) {
      setMe(cached)
    }
    setHydrated(true)

    const token = window.localStorage.getItem('token')
    if (!token) return

    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
        })

        if (cancelled) return

        if (res.status === 401) {
          window.localStorage.removeItem('token')
          setMe(null)
          return
        }

        if (!res.ok) {
          // transient error: keep cached viewer to avoid UI flashes
          return
        }

        const data = (await res.json()) as MeResponse
        setMe(data)
        writeCachedViewer(data)
      } catch {
        // network error: keep cached viewer
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [setHydrated, setMe])

  return null
}
