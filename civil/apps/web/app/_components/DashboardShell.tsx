"use client"

import type { ReactNode } from 'react'
import clsx from 'clsx'

export type DashboardShellProps = {
  children: ReactNode
  rightRail?: ReactNode
  showMobileRightRail?: boolean
  registerRightRail?: boolean
  className?: string
  containerClassName?: string
  gridClassName?: string
  mainClassName?: string
  mainTopClassName?: string
  rightRailClassName?: string
  rightRailTopClassName?: string
}

export default function DashboardShell({
  children,
  className,
  containerClassName,
  gridClassName,
  mainClassName,
  mainTopClassName = 'pt-4 md:pt-8',
}: DashboardShellProps) {
  return (
    <div data-dashboard-shell="true" className={clsx('min-h-0', className)}>
      <div className={clsx('mx-auto w-full max-w-screen-2xl px-4 sm:px-8 xl:pl-[18rem] xl:pr-8 2xl:pl-[20rem] 2xl:pr-10', containerClassName)}>
        <div className={clsx('grid min-h-0 min-w-0 grid-cols-1 gap-5', gridClassName)}>
          <main className={clsx('min-h-0 min-w-0', mainTopClassName, mainClassName)}>
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
