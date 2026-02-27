'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { redirectToAuthModal } from './authModal'
import { hasHomeCommunity, type MeResponse } from './me'
import { ensureViewerMe } from './viewerMe'
import { useViewerStore } from './viewerStore'

export type UseAuthedMeOptions = {
  /**
   * Require the viewer to have a home community configured before allowing access.
   */
  requireHomeCommunity?: boolean
  /**
   * @deprecated Use requireHomeCommunity instead.
   */
  requireHomeChamber?: boolean
}

export function useAuthedMe(options?: UseAuthedMeOptions) {
  const router = useRouter()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const cachedMe = useViewerStore((s) => s.me)
  const hydrated = useViewerStore((s) => s.hydrated)
  const setCachedMe = useViewerStore((s) => s.setMe)

  useEffect(() => {
    if (cachedMe) {
      setMe(cachedMe)
    }
  }, [cachedMe])

  useEffect(() => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      setLoading(false)
      return
    }

    const requireHomeCommunity = options?.requireHomeCommunity ?? options?.requireHomeChamber ?? true

    if (cachedMe) {
      if (requireHomeCommunity && !hasHomeCommunity(cachedMe)) {
        router.replace('/welcome')
        setLoading(false)
        return
      }
      setMe(cachedMe)
      setLoading(false)
      return
    }

    setLoading(true)
    if (!hydrated) {
      // Wait for ViewerBootstrap to hydrate from local cache first.
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      ensureViewerMe({ token })
        .then((data) => {
          if (cancelled) return
          if (!data) {
            const tokenStillPresent = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : true
            if (!tokenStillPresent) {
              redirectToAuthModal('login')
            }
            return
          }
          if (requireHomeCommunity && !hasHomeCommunity(data)) {
            router.replace('/welcome')
            return
          }
          setMe(data)
          setCachedMe(data)
        })
        .catch(() => {
          // Network / transient failure: don't clear token or force re-login.
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 800)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cachedMe, hydrated, options?.requireHomeChamber, options?.requireHomeCommunity, router, setCachedMe])

  return { me, loading }
}
