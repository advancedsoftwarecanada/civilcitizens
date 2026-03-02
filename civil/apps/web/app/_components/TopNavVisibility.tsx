'use client'

import { usePathname } from 'next/navigation'
import TopNav from './TopNav'
import { useInviteViewStore } from '../_lib/inviteViewStore'

const HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])

export default function TopNavVisibility() {
  const pathname = usePathname()
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = pathname ? pathname.includes('/invite/') : false
  const hideNav = pathname ? HIDDEN_PATHS.has(pathname) || pathname.startsWith('/welcome') || (isInviteRoute && inviteGuestMode !== false) : false

  if (hideNav) {
    return null
  }

  return <TopNav />
}
