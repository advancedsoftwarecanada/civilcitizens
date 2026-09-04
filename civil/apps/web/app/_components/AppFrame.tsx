'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import Sidebar from './Sidebar'
import { useInviteViewStore } from '../_lib/inviteViewStore'
import { useViewerStore } from '../_lib/viewerStore'

const TOP_NAV_HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])
const PUBLIC_SHELLLESS_PATHS = new Set(['/reset', '/terms', '/privacy', '/safety', '/help'])
const SIDEBAR_HIDDEN_PATHS = new Set([...TOP_NAV_HIDDEN_PATHS, ...PUBLIC_SHELLLESS_PATHS])

type AppFrameProps = {
  children: ReactNode
  modal: ReactNode
}

export default function AppFrame({ children, modal }: AppFrameProps) {
  const pathname = usePathname()
  const familyView = useViewerStore((state) => state.familyView)
  const resolvedPathname = pathname || ''
  const hasResolvedPathname = resolvedPathname.length > 0
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode)
  const isInviteRoute = hasResolvedPathname ? resolvedPathname.includes('/invite/') : false
  const hideForInviteGuest = isInviteRoute && inviteGuestMode !== false

  const hideForInstall = hasResolvedPathname && resolvedPathname.startsWith('/install/')
  const topNavHidden =
    Boolean(familyView) ||
    !hasResolvedPathname ||
    TOP_NAV_HIDDEN_PATHS.has(resolvedPathname) ||
    PUBLIC_SHELLLESS_PATHS.has(resolvedPathname) ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/verify') ||
    hideForInstall ||
    hideForInviteGuest
  const sidebarHidden =
    !hasResolvedPathname ||
    SIDEBAR_HIDDEN_PATHS.has(resolvedPathname) ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/verify') ||
    hideForInstall ||
    hideForInviteGuest
  const showShellTopOffset = !topNavHidden && !hideForInstall
  const showMobileDockClearance = !sidebarHidden

  return (
    <div
      data-app-frame="true"
      className={clsx(
        'min-h-0',
        showShellTopOffset && 'pt-[calc(var(--cc-native-safe-top-offset)+var(--cc-native-shell-top-gap))]',
        showMobileDockClearance && 'pb-[var(--mobile-dock-active-clearance)] xl:pb-0',
        !topNavHidden && 'md:pt-[var(--cc-top-nav-offset)]',
      )}
    >
      {!sidebarHidden ? <Sidebar /> : null}
      {children}
      {modal}
    </div>
  )
}
