'use client'

import { usePathname } from 'next/navigation'
import type { CommunitySummary } from '../../_lib/community'

export default function CommunityHeader({ summary }: { summary: CommunitySummary }) {
  const pathname = usePathname()

  // Organization pages should feel like organization-first, not community-first.
  if (pathname?.includes('/orgs/')) {
    return null
  }

  return (
    <section className="border-b bg-white py-6 shadow-sm">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Community</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{summary.municipalityName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {summary.provinceName} · {summary.regionLabel || 'Canada-wide civic signal powered by postal geodata'}
        </p>
      </div>
    </section>
  )
}
