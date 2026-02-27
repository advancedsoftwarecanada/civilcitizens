import type { ReactNode } from 'react'
import clsx from 'clsx'

export type DashboardShellProps = {
  children: ReactNode
  rightRail?: ReactNode
  className?: string
  containerClassName?: string
  gridClassName?: string
  mainClassName?: string
  rightRailClassName?: string
}

export default function DashboardShell({
  children,
  rightRail,
  className,
  containerClassName,
  gridClassName,
  mainClassName,
  rightRailClassName,
}: DashboardShellProps) {
  const gridTemplate = rightRail
    ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-10'
    : 'grid gap-5 grid-cols-1'

  return (
    <div className={clsx('min-h-screen', className)}>
      <div className={clsx('mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pl-[18rem] lg:pr-0 xl:pl-[20rem] xl:pr-0', containerClassName)}>
        <div className={clsx(gridTemplate, gridClassName)}>
          <main className={clsx('pt-8', mainClassName)}>{children}</main>
          {rightRail ? (
            <aside className={clsx('hidden pt-8 lg:block', rightRailClassName)}>{rightRail}</aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
