'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import Sidebar from './Sidebar'
import { useInviteViewStore } from '../_lib/inviteViewStore'

const TOP_NAV_HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])
const SIDEBAR_HIDDEN_PATHS = new Set([...TOP_NAV_HIDDEN_PATHS, '/reset', '/terms', '/privacy'])

type AppFrameProps = {
  children: ReactNode
  modal: ReactNode
}

export default function AppFrame({ children, modal }: AppFrameProps) {
  const pathname = usePathname()
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false
  const hideForInviteGuest = isInviteRoute && inviteGuestMode !== false

  const hideForInstall = hasResolvedPathname && resolvedPathname.startsWith('/install/')
  const topNavHidden = !hasResolvedPathname || TOP_NAV_HIDDEN_PATHS.has(resolvedPathname) || resolvedPathname.startsWith('/welcome') || hideForInstall || hideForInviteGuest
  const sidebarHidden = !hasResolvedPathname || SIDEBAR_HIDDEN_PATHS.has(resolvedPathname) || resolvedPathname.startsWith('/welcome') || hideForInstall || hideForInviteGuest

  return (
    <div
      className={clsx(
        'min-h-screen pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0',
        !topNavHidden && 'md:pt-[4.5rem]',
      )}
    >
      {!sidebarHidden ? <Sidebar /> : null}
      {children}
      {modal}
    </div>
  )
}
