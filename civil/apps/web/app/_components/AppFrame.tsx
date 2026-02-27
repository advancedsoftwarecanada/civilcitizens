'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import Sidebar from './Sidebar'

const TOP_NAV_HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])
const SIDEBAR_HIDDEN_PATHS = new Set([...TOP_NAV_HIDDEN_PATHS, '/reset', '/terms', '/privacy'])

type AppFrameProps = {
  children: ReactNode
  modal: ReactNode
}

export default function AppFrame({ children, modal }: AppFrameProps) {
  const pathname = usePathname()

  const topNavHidden = pathname ? TOP_NAV_HIDDEN_PATHS.has(pathname) || pathname.startsWith('/welcome') : false
  const sidebarHidden = pathname ? SIDEBAR_HIDDEN_PATHS.has(pathname) || pathname.startsWith('/welcome') : false

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
