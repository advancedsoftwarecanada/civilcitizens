'use client'

import { useEffect } from 'react'
import { ensureViewerMe } from '../_lib/viewerMe'
import { AUTH_SESSION_CHANGED_EVENT, FAMILY_PARENT_TOKEN_KEY, clearFamilySessionBootstrapPending, markFamilySessionBootstrapPending } from '../_lib/authSession'
import { clearFamilyView, readStoredFamilyView } from '../_lib/familyView'
import { useViewerStore } from '../_lib/viewerStore'

export default function ViewerBootstrap() {
  const setMe = useViewerStore((s) => s.setMe)
  const setHydrated = useViewerStore((s) => s.setHydrated)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const token = window.localStorage.getItem('token')
      const storedFamilyView = readStoredFamilyView()
      if (!token) {
        if (!cancelled) {
          setMe(null)
          setHydrated(true)
        }
        return
      }

      if (storedFamilyView) {
        markFamilySessionBootstrapPending()
      }

      if (!cancelled) {
        setHydrated(true)
      }

      try {
        const me = await ensureViewerMe({ token, refresh: true, cache: 'no-store' })
        if (!cancelled && !me) {
          setMe(null)
          return
        }

        if (!cancelled && me?.accountType !== 'family_member' && storedFamilyView) {
          clearFamilyView()
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(FAMILY_PARENT_TOKEN_KEY)
          }
        }
        if (me?.accountType !== 'family_member') {
          clearFamilySessionBootstrapPending()
        }
      } catch {
        if (!cancelled) {
          setMe(null)
        }
      }
    }

    void load()
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, load)
    }
  }, [setHydrated, setMe])

  return null
}
