import type { ReactNode } from 'react'
import clsx from 'clsx'

export type DashboardShellProps = {
  children: ReactNode
  rightRail?: ReactNode
  showMobileRightRail?: boolean
  className?: string
  containerClassName?: string
  gridClassName?: string
  mainClassName?: string
  rightRailClassName?: string
}

export default function DashboardShell({
  children,
  rightRail,
  showMobileRightRail = false,
  className,
  containerClassName,
  gridClassName,
  mainClassName,
  rightRailClassName,
}: DashboardShellProps) {
  const gridTemplate = rightRail
    ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-10'
    : 'grid gap-5 grid-cols-1'

  return (
    <div className={clsx('min-h-screen', className)}>
      <div className={clsx('mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pl-[18rem] lg:pr-0 xl:pl-[20rem] xl:pr-0', containerClassName)}>
        <div className={clsx('min-w-0', gridTemplate, gridClassName)}>
          <main className={clsx('min-w-0 pt-8', mainClassName)}>
            {children}
            {rightRail && showMobileRightRail ? (
              <aside className={clsx('min-w-0 pt-6 lg:hidden [&_.sticky]:static', rightRailClassName)}>{rightRail}</aside>
            ) : null}
          </main>
          {rightRail ? (
            <aside className={clsx('min-w-0 hidden pt-8 lg:block', rightRailClassName)}>{rightRail}</aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
