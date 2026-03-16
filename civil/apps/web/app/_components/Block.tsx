import Link from 'next/link'
import { ReactNode } from 'react'

type BlockProps = {
  title: string
  action?: {
    label: string
    href: string
  }
  actionVariant?: 'link' | 'pill'
  children: ReactNode
  className?: string
}

export default function Block({ title, action, actionVariant = 'link', children, className = '' }: BlockProps) {
  return (
    <section className={`surface-card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
        {action && (
          <Link
            href={action.href}
            className={
              actionVariant === 'pill'
                ? 'inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300'
                : 'inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/35 hover:bg-[var(--cc-primary)]/5'
            }
          >
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
