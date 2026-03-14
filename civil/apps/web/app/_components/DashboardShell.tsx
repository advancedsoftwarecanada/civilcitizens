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
  mainTopClassName?: string
  rightRailClassName?: string
  rightRailTopClassName?: string
}

export default function DashboardShell({
  children,
  rightRail,
  showMobileRightRail = false,
  className,
  containerClassName,
  gridClassName,
  mainClassName,
  mainTopClassName = 'pt-4 md:pt-8',
  rightRailClassName,
  rightRailTopClassName = 'pt-4 md:pt-8',
}: DashboardShellProps) {
  const gridTemplate = rightRail
    ? 'grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px] 2xl:gap-10'
    : 'grid gap-5 grid-cols-1'

  return (
    <div data-dashboard-shell="true" className={clsx('min-h-0', className)}>
      <div className={clsx('mx-auto w-full max-w-screen-2xl px-4 sm:px-8 xl:pl-[18rem] xl:pr-0 2xl:pl-[20rem] 2xl:pr-0', containerClassName)}>
        <div className={clsx('min-h-0 min-w-0', gridTemplate, gridClassName)}>
          <main className={clsx('min-h-0 min-w-0', mainTopClassName, mainClassName)}>
            {children}
            {rightRail && showMobileRightRail ? (
              <aside className={clsx('min-w-0 pt-4 xl:hidden [&_.sticky]:static', rightRailClassName)}>{rightRail}</aside>
            ) : null}
          </main>
          {rightRail ? (
            <aside className={clsx('min-h-0 min-w-0 hidden xl:block', rightRailTopClassName, rightRailClassName)}>{rightRail}</aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
