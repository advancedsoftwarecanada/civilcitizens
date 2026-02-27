import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { fetchCommunitySummary } from '../../../_lib/community'
import DashboardShell from '../../../_components/DashboardShell'
import { CommunityContextProvider } from '../../_components/CommunityContext'
import CommunityHeader from '../../_components/CommunityHeader'

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
      <DashboardShell
        className="bg-slate-50"
        containerClassName="px-0 sm:px-0"
        mainClassName="pt-0"
      >
        <div className="min-h-screen bg-slate-50">
          <CommunityHeader summary={summary} />
          <div className="pb-16">{children}</div>
        </div>
      </DashboardShell>
    </CommunityContextProvider>
  )
}
