import type { ReactNode } from 'react'
import clsx from 'clsx'

export type DashboardShellProps = {
  sidebar: ReactNode
  children: ReactNode
  rightRail?: ReactNode
  className?: string
  containerClassName?: string
  gridClassName?: string
  mainClassName?: string
  rightRailClassName?: string
}

export default function DashboardShell({
  sidebar,
  children,
  rightRail,
  className,
  containerClassName,
  gridClassName,
  mainClassName,
  rightRailClassName,
}: DashboardShellProps) {
  return (
    <div className={clsx('min-h-screen', className)}>
      <div className={clsx('mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pr-0 xl:pl-12 xl:pr-0', containerClassName)}>
        <div
          className={clsx(
            'grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px] xl:gap-10',
            gridClassName,
          )}
        >
          <aside className="hidden lg:block">{sidebar}</aside>
          <main className={clsx('pt-8', mainClassName)}>{children}</main>
          {rightRail ? (
            <aside className={clsx('hidden pt-8 lg:block', rightRailClassName)}>{rightRail}</aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
