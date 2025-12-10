"use client"

import FeedPageClient from '../../_components/FeedPageClient'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'

type PageProps = {
  params: {
    province: string
    chamber: string
  }
}

export default function ProvinceChamberPage({ params }: PageProps) {
  const normalized = normalizeProvinceCode(params.province)
  const provinceName = (normalized ? getProvinceDisplayName(normalized) : null) || params.province.toUpperCase()
  const formattedCommunityName = params.chamber
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return (
    <FeedPageClient
      scope="communities"
      sidebarActive="communities"
      title={formattedCommunityName}
      description={`Community feed for ${formattedCommunityName}, ${provinceName}`}
      province={params.province}
      community={params.chamber}
      emptyState={`No posts in ${formattedCommunityName} yet. Be the first to post!`}
    />
  )
}
