import type { ReactNode } from 'react'

import DashboardShell from '../../_components/DashboardShell'

type AdminWideShellProps = {
  children: ReactNode
  className?: string
  mainClassName?: string
  mainTopClassName?: string
}

export default function AdminWideShell({
  children,
  className = 'bg-slate-50',
  mainClassName,
  mainTopClassName = 'pt-6 lg:pt-8',
}: AdminWideShellProps) {
  return (
    <DashboardShell
      className={className}
      containerClassName="mx-auto w-full max-w-[1700px] px-4 sm:px-6 lg:px-8"
      gridClassName="grid-cols-1"
      mainTopClassName={mainTopClassName}
      mainClassName={mainClassName}
    >
      {children}
    </DashboardShell>
  )
}