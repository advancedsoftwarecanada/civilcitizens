'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

const TOP_NAV_HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])

type AppFrameProps = {
  children: ReactNode
  modal: ReactNode
}

export default function AppFrame({ children, modal }: AppFrameProps) {
  const pathname = usePathname()

  const topNavHidden = pathname ? TOP_NAV_HIDDEN_PATHS.has(pathname) || pathname.startsWith('/welcome') : false

  return (
    <div
      className={clsx(
        'min-h-screen pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0',
        !topNavHidden && 'md:pt-[4.5rem]',
      )}
    >
      {children}
      {modal}
    </div>
  )
}
