"use client"

import Link from 'next/link'
import DashboardShell from './DashboardShell'

type ComingSoonProps = {
  title: string
  message?: string
  activeNavKey?: string
  ctaLabel?: string
  ctaHref?: string
  secondaryLabel?: string
  secondaryHref?: string
}

export default function ComingSoon({
  title,
  message = 'We are still building this area. Check back soon for updates.',
  ctaLabel = 'Back to home',
  ctaHref = '/home',
  secondaryLabel = 'Contact support',
  secondaryHref = undefined,
}: ComingSoonProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white">
      <DashboardShell
        mainClassName="flex items-center justify-center py-12"
      >
        <section className="relative isolate w-full max-w-3xl overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 p-10 text-center shadow-[0_35px_120px_rgba(15,23,42,0.12)]">
          <div className="pointer-events-none absolute -left-16 -top-24 h-48 w-48 rounded-full bg-[var(--cc-primary)]/10 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-24 -right-20 h-56 w-56 rounded-full bg-amber-200/20 blur-3xl" aria-hidden="true" />

          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Coming soon</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">{message}</p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm font-semibold">
            <Link
              href={ctaHref}
              className="rounded-full bg-[var(--cc-primary)] px-5 py-2 text-white transition hover:bg-[var(--cc-primary-700)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cc-primary)]"
            >
              {ctaLabel}
            </Link>
            {secondaryHref ? (
              <Link
                href={secondaryHref}
                className="rounded-full border border-slate-200 px-5 py-2 text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cc-primary)]"
              >
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        </section>
      </DashboardShell>
    </div>
  )
}
