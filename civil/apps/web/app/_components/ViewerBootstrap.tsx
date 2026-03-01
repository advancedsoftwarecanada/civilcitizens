'use client'

import { useEffect } from 'react'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

export default function ViewerBootstrap() {
  const setMe = useViewerStore((s) => s.setMe)
  const setHydrated = useViewerStore((s) => s.setHydrated)

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setMe(null)
      setHydrated(true)
      return
    }

    setHydrated(true)

    let cancelled = false
    const load = async () => {
      try {
        const me = await ensureViewerMe({ token, refresh: true, cache: 'no-store' })
        if (!cancelled && !me) {
          setMe(null)
        }
      } catch {
        if (!cancelled) {
          setMe(null)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [setHydrated, setMe])

  return null
}
