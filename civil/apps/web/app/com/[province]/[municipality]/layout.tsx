import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { fetchCommunitySummary } from '../../../_lib/community'
import { CommunityContextProvider } from '../../_components/CommunityContext'
import CommunityNav from '../../_components/CommunityNav'

export const dynamic = 'force-dynamic'

type LayoutProps = {
  children: ReactNode
  params: {
    province: string
    municipality: string
  }
}

export default async function CommunityLayout({ children, params }: LayoutProps) {
  const summary = await fetchCommunitySummary(params.province, params.municipality)
  if (!summary) {
    notFound()
  }

  return (
    <CommunityContextProvider value={summary}>
      <div className="min-h-screen bg-slate-50">
        <section className="border-b bg-white py-6 shadow-sm">
          <div className="mx-auto max-w-screen-2xl px-4 sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Community</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{summary.municipalityName}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {summary.provinceName} · {summary.regionLabel || 'Canada-wide civic signal powered by postal geodata'}
            </p>
          </div>
        </section>
        <CommunityNav province={summary.provinceCode} municipality={summary.municipalitySlug} />
        <div className="pb-16">{children}</div>
      </div>
    </CommunityContextProvider>
  )
}
