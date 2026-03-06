'use client'

import { usePathname } from 'next/navigation'
import TopNav from './TopNav'
import { useInviteViewStore } from '../_lib/inviteViewStore'
import { isMeetingRoomPath } from '../_lib/meetingRoomRoute'

const HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])

export default function TopNavVisibility() {
  const pathname = usePathname()
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false
  const hideNav =
    !hasResolvedPathname ||
    HIDDEN_PATHS.has(resolvedPathname) ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/install/') ||
    (isInviteRoute && inviteGuestMode !== false) ||
    isMeetingRoomPath(resolvedPathname)

  if (hideNav) {
    return null
  }

  return <TopNav />
}
