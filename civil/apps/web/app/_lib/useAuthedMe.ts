'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { redirectToAuthModal } from './authModal'
import { buildApiUrl } from './api'
import { hasHomeCommunity, type MeResponse } from './me'
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

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401) {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
          return null
        }
        if (!res.ok) {
          return null
        }
        return (await res.json()) as MeResponse
      })
      .then((data) => {
        if (!data) return
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
      .finally(() => setLoading(false))
  }, [cachedMe, options?.requireHomeChamber, options?.requireHomeCommunity, router, setCachedMe])

  return { me, loading }
}
