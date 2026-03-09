'use client'

import { usePathname } from 'next/navigation'
import MobileDock from './MobileDock'
import { useInviteViewStore } from '../_lib/inviteViewStore'
import { isMeetingRoomPath } from '../_lib/meetingRoomRoute'

export default function MobileDockVisibility() {
  const pathname = usePathname()
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false
  const isPostThreadRoute = hasResolvedPathname
    ? (/^\/u\/[^/]+\/posts\/[^/]+$/i.test(resolvedPathname) ||
      /^\/[a-z]{2}\/[^/]+\/posts\/[^/]+$/i.test(resolvedPathname) ||
      /^\/c\/[a-z]{2}\/[^/]+\/posts\/[^/]+$/i.test(resolvedPathname) ||
      /^\/post\/[^/]+$/i.test(resolvedPathname))
    : false

  if (
    !hasResolvedPathname ||
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
