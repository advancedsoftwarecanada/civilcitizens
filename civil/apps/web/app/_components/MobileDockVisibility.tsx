'use client'

import { usePathname } from 'next/navigation'
import MobileDock from './MobileDock'
import { useInviteViewStore } from '../_lib/inviteViewStore'

export default function MobileDockVisibility() {
  const pathname = usePathname()
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = pathname ? pathname.includes('/invite/') : false

  if (pathname?.startsWith('/welcome') || (isInviteRoute && inviteGuestMode !== false)) {
    return null
  }

  return <MobileDock />
}
