'use client'

import Link from 'next/link'
import clsx from 'clsx'
import DashboardShell from './DashboardShell'

export type FeatureHighlight = {
  title: string
  description: string
  status?: 'ready' | 'soon'
  actions?: Array<{ label: string; href?: string }>
}

export type FeatureRoadmapItem = {
  title: string
  detail: string
}

export type FeatureScaffoldProps = {
  activeNavKey: string
  title: string
  description: string
  heroBadge?: string
  heroCta?: { label: string; href: string }
  highlights?: FeatureHighlight[]
  roadmap?: FeatureRoadmapItem[]
}

export default function FeatureScaffold(props: FeatureScaffoldProps) {
  const { title, description, heroBadge, heroCta, highlights, roadmap } = props
  const statusBadge = (status?: 'ready' | 'soon') => {
    if (!status) return null
    const label = status === 'ready' ? 'In progress' : 'Coming soon'
    const color = status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
    return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', color)}>{label}</span>
  }

  return (
    <DashboardShell mainClassName="space-y-6">
      <section className="surface-card px-6 py-5 shadow-subtle">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            {heroBadge ? (
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--cc-primary)]">{heroBadge}</p>
            ) : null}
            <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
            <p className="text-sm text-slate-500">{description}</p>
          </div>
          {heroCta ? (
            <Link
              href={heroCta.href}
              className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white"
            >
              {heroCta.label}
            </Link>
          ) : null}
        </div>
      </section>

      {highlights && highlights.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2">
          {highlights.map((highlight) => (
            <div key={highlight.title} className="surface-card flex h-full flex-col justify-between px-6 py-5 shadow-subtle">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">{highlight.title}</h2>
                  {statusBadge(highlight.status)}
                </div>
                <p className="text-sm text-slate-500">{highlight.description}</p>
              </div>
              {highlight.actions && highlight.actions.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {highlight.actions.map((action) => (
                    <Link
                      key={`${highlight.title}-${action.label}`}
                      href={action.href ?? '#'}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
                    >
                      {action.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {roadmap && roadmap.length > 0 ? (
        <section className="surface-card px-6 py-5 shadow-subtle">
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Roadmap</h2>
          <div className="mt-4 space-y-4">
            {roadmap.map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-base font-semibold text-slate-900">{item.title}</p>
                <p className="text-sm text-slate-500">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </DashboardShell>
  )
}
