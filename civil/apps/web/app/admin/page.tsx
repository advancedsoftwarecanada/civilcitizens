"use client"

import Link from 'next/link'
import { useMemo } from 'react'
import { HiOutlineBriefcase, HiOutlineCog8Tooth, HiOutlineFlag, HiOutlineGlobeAlt, HiOutlinePresentationChartBar } from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import DashboardShell from '../_components/DashboardShell'
import { useAdminAccess } from './_hooks/useAdminAccess'

type AdminAction = {
  key: string
  label: string
  description: string
  href: string
  icon: IconType
}

const ACTIONS: AdminAction[] = [
  {
    key: 'settings',
    label: 'Environment settings',
    description: 'Inspect runtime env files, Stripe configuration, and required keys.',
    href: '/admin/settings',
    icon: HiOutlineCog8Tooth,
  },
  {
    key: 'geodata',
    label: 'GeoData coverage',
    description: 'Review import counts for StatsCan + Elections Canada datasets.',
    href: '/admin/geodata',
    icon: HiOutlineGlobeAlt,
  },
  {
    key: 'analytics',
    label: 'Platform analytics',
    description: 'Open dashboards for usage, engagement, and traffic trends.',
    href: '/admin/analytics',
    icon: HiOutlinePresentationChartBar,
  },
  {
    key: 'moderation',
    label: 'Reports & support',
    description: 'Review quarantined content plus customer-service and feature requests.',
    href: '/settings/admin/reports',
    icon: HiOutlineFlag,
  },
  {
    key: 'jobs',
    label: 'Jobs taxonomy',
    description: 'Manage industries/sub-industries and populate seed data.',
    href: '/admin/jobs',
    icon: HiOutlineBriefcase,
  },
]

export default function AdminPage() {
  const { token, loading, error, isSuperAdmin } = useAdminAccess()

  const rightRailContent = useMemo(() => {
    if (!token) return null
    return (
      <div className="space-y-3">
        <section className="surface-card space-y-2 px-5 py-4 text-sm text-slate-600">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Session</p>
          <p>Bearer token (first 12 chars)</p>
          <p className="font-mono text-xs text-slate-900">{token.slice(0, 12)}…</p>
        </section>
      </div>
    )
  }, [token])

  const body = () => {
    if (loading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Authorizing admin tools…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {error ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }

    return (
      <>
        <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Admin</p>
          <h1 className="text-2xl font-semibold text-slate-900">Operator console</h1>
          <p className="text-sm text-slate-600">
            Jump to environment diagnostics, GeoData coverage, analytics dashboards, and the unified reports queue.
          </p>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ACTIONS.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.key}
                href={action.href}
                className="group rounded-3xl border border-slate-200 bg-white/90 p-4 text-slate-700 shadow-subtle transition hover:border-slate-300 hover:shadow-lg"
              >
                <span className="inline-flex rounded-2xl bg-slate-900/10 p-2 text-slate-900 transition group-hover:bg-slate-900 group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">{action.label}</h2>
                <p className="mt-2 text-sm text-slate-600">{action.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Open
                  <span className="transition group-hover:translate-x-1">→</span>
                </span>
              </Link>
            )
          })}
        </section>

        <section className="surface-card px-6 py-5 text-sm text-slate-500">
          <p className="font-semibold text-slate-700">Coming soon</p>
          <p className="mt-1">
            We&apos;ll keep expanding the operator console with billing insights and launch tools as they ship.
          </p>
        </section>
      </>
    )
  }

  return (
    <DashboardShell
      className="bg-slate-50"
      rightRail={rightRailContent}
      mainClassName="space-y-6"
    >
      {body()}
    </DashboardShell>
  )
}
