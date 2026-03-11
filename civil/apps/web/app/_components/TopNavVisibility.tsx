'use client'

import { usePathname } from 'next/navigation'
import TopNav from './TopNav'
import { useInviteViewStore } from '../_lib/inviteViewStore'
import { isMeetingRoomPath } from '../_lib/meetingRoomRoute'
import { useViewerStore } from '../_lib/viewerStore'

const HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])
const PUBLIC_HIDDEN_PATHS = new Set(['/reset', '/terms', '/privacy', '/safety', '/help'])

export default function TopNavVisibility() {
  const pathname = usePathname()
  const familyView = useViewerStore((state) => state.familyView)
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false
  const hideNav =
    Boolean(familyView) ||
    !hasResolvedPathname ||
    HIDDEN_PATHS.has(resolvedPathname) ||
    PUBLIC_HIDDEN_PATHS.has(resolvedPathname) ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/verify') ||
    resolvedPathname.startsWith('/install/') ||
    (isInviteRoute && inviteGuestMode !== false) ||
    isMeetingRoomPath(resolvedPathname)

  if (hideNav) {
    return null
  }

  return <TopNav />
}
