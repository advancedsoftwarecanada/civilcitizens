'use client'

import { useEffect, useState } from 'react'
import { redirectToAuthModal } from './authModal'
import { buildApiUrl } from './api'
import { hasHomeChamber, type MeResponse } from './me'

export type UseAuthedMeOptions = {
  requireHomeChamber?: boolean
}

export function useAuthedMe(options?: UseAuthedMeOptions) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      setLoading(false)
      return
    }

    const requireHomeChamber = options?.requireHomeChamber ?? true

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (requireHomeChamber && !hasHomeChamber(data)) {
          window.location.replace('/welcome')
          return
        }
        setMe(data)
      })
      .catch(() => {
        window.localStorage.removeItem('token')
        redirectToAuthModal('login')
      })
      .finally(() => setLoading(false))
  }, [options?.requireHomeChamber])

  return { me, loading }
}
