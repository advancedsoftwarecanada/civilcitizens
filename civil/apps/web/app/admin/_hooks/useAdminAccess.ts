'use client'

import { useEffect, useState } from 'react'
import { redirectToAuthModal } from '../../_lib/authModal'
import { buildApiUrl } from '../../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../../_lib/me'
import { isSuperAdmin as isSuperAdminUser } from '../../_lib/admin'

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
        const res = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${storedToken}` },
        })
        if (!res.ok) {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
          if (!cancelled) {
            setState({ token: null, me: null, loading: false, error: 'Authentication required.', isSuperAdmin: false })
          }
          return
        }
        const data = (await res.json()) as MeResponse
        if (!hasHomeCommunity(data)) {
          window.location.replace('/welcome')
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
  }, [])

  return state
}
