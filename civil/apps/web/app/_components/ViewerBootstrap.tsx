'use client'

import { useEffect } from 'react'
import type { MeResponse } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
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
        await ensureViewerMe({ token, refresh: true, cache: 'no-store' })

        if (cancelled) return
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
