'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { redirectToAuthModal } from '../../_lib/authModal'
import { hasHomeCommunity, type MeResponse } from '../../_lib/me'
import { isSuperAdmin as isSuperAdminUser } from '../../_lib/admin'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { useViewerStore } from '../../_lib/viewerStore'

export type AdminAccessState = {
  token: string | null
  me: MeResponse | null
  loading: boolean
  error: string | null
  isSuperAdmin: boolean
}

const INITIAL_STATE: AdminAccessState = {
  token: null,
  me: null,
  loading: true,
  error: null,
  isSuperAdmin: false,
}

export function useAdminAccess(): AdminAccessState {
  const [state, setState] = useState<AdminAccessState>(INITIAL_STATE)
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const storedToken = window.localStorage.getItem('token')
    if (!storedToken) {
      redirectToAuthModal('login')
      setState((prev) => ({ ...prev, loading: false, error: 'Authentication required.' }))
      return
    }

    let cancelled = false

    const bootstrap = async () => {
      setState((prev) => ({ ...prev, token: storedToken, loading: true, error: null }))
      try {
        if (cachedMe) {
          if (!hasHomeCommunity(cachedMe)) {
            router.replace('/welcome')
            return
          }
          const superAdmin = isSuperAdminUser(cachedMe)
          if (!cancelled) {
            setState({
              token: storedToken,
              me: cachedMe,
              loading: false,
              error: superAdmin ? null : 'Admin access is limited to root operators.',
              isSuperAdmin: superAdmin,
            })
          }
          return
        }

        const data = await ensureViewerMe({ token: storedToken, refresh: true, cache: 'no-store' })
        if (!data) {
          const tokenStillPresent = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : true
          if (!tokenStillPresent) {
            redirectToAuthModal('login')
            if (!cancelled) {
              setState({ token: null, me: null, loading: false, error: 'Authentication required.', isSuperAdmin: false })
            }
            return
          }

          if (!cancelled) {
            setState({ token: storedToken, me: null, loading: false, error: 'Unable to load admin profile.', isSuperAdmin: false })
          }
          return
        }

        if (!hasHomeCommunity(data)) {
          router.replace('/welcome')
          return
        }
        const superAdmin = isSuperAdminUser(data)
        if (!cancelled) {
          setState({
            token: storedToken,
            me: data,
            loading: false,
            error: superAdmin ? null : 'Admin access is limited to root operators.',
            isSuperAdmin: superAdmin,
          })
        }
      } catch (error) {
        console.error('[admin] Failed to load admin viewer', error)
        if (!cancelled) {
          setState({ token: storedToken, me: null, loading: false, error: 'Unable to load admin profile.', isSuperAdmin: false })
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [cachedMe, router])

  return state
}
