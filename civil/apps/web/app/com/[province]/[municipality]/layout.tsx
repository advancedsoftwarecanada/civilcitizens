import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { fetchCommunitySummary } from '../../../_lib/community'
import CommunityLayoutClient from '../../_components/CommunityLayoutClient'

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
    <CommunityLayoutClient summary={summary} province={params.province} municipality={params.municipality}>
      {children}
    </CommunityLayoutClient>
  )
}
