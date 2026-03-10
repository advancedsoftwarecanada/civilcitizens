'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import MobileDock from './MobileDock'
import { useInviteViewStore } from '../_lib/inviteViewStore'
import { isMeetingRoomPath } from '../_lib/meetingRoomRoute'
import { AUTH_SESSION_CHANGED_EVENT } from '../_lib/authSession'

function hasStoredSessionToken() {
  if (typeof window === 'undefined') return false
  return Boolean(window.localStorage.getItem('token'))
}

export default function MobileDockVisibility() {
  const pathname = usePathname()
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const [hasSession, setHasSession] = useState(false)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false
  const isPostThreadRoute = hasResolvedPathname
    ? (/^\/u\/[^/]+\/posts\/[^/]+$/i.test(resolvedPathname) ||
      /^\/[a-z]{2}\/[^/]+\/posts\/[^/]+$/i.test(resolvedPathname) ||
      /^\/c\/[a-z]{2}\/[^/]+\/posts\/[^/]+$/i.test(resolvedPathname) ||
      /^\/post\/[^/]+$/i.test(resolvedPathname))
    : false

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncSession = () => setHasSession(hasStoredSessionToken())
    syncSession()

    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession)
    window.addEventListener('storage', syncSession)

    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession)
      window.removeEventListener('storage', syncSession)
    }
  }, [])

  if (
    !hasSession ||
    !hasResolvedPathname ||
    resolvedPathname === '/reset' ||
    resolvedPathname === '/terms' ||
    resolvedPathname === '/privacy' ||
    resolvedPathname === '/safety' ||
    resolvedPathname === '/help' ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/verify') ||
    resolvedPathname.startsWith('/install/') ||
    (isInviteRoute && inviteGuestMode !== false) ||
    isPostThreadRoute ||
    isMeetingRoomPath(resolvedPathname)
  ) {
    return null
  }

  return <MobileDock />
}
