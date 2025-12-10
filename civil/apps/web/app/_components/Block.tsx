import Link from 'next/link'
import { ReactNode } from 'react'

type BlockProps = {
  title: string
  action?: {
    label: string
    href: string
  }
  children: ReactNode
  className?: string
}

export default function Block({ title, action, children, className = '' }: BlockProps) {
  return (
    <section className={`surface-card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
        {action && (
          <Link href={action.href} className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
