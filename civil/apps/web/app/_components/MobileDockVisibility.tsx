'use client'

import { usePathname } from 'next/navigation'
import MobileDock from './MobileDock'
import { useInviteViewStore } from '../_lib/inviteViewStore'

export default function MobileDockVisibility() {
  const pathname = usePathname()
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false

  if (
    !hasResolvedPathname ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/install/') ||
    (isInviteRoute && inviteGuestMode !== false)
  ) {
    return null
  }

  return <MobileDock />
}
