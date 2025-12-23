import { buildApiUrl, parseApiResponse } from './api'

export type CommunityOrganization = {
  id: string
  ownerId: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
  type:
    | 'LOCAL_BUSINESS'
    | 'NON_PROFIT'
    | 'COMMUNITY_GROUP'
    | 'EDUCATIONAL'
    | 'RELIGIOUS'
    | 'GOVERNMENT'
    | 'ARTS_CULTURE'
    | 'SPORTS_RECREATION'
  description: string | null
  phone?: string | null
  websiteUrl?: string | null
  address?: string | null
  schedule?: string | null
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED'
  isVerified: boolean
  logoUrl: string | null
  coverUrl: string | null
  followerCount: number
  viewerFollowed: boolean
  viewerRole?: 'OWNER' | 'MANAGER' | null
  createdAt: string
  updatedAt: string
}

export async function fetchCommunityOrganizations(province: string, municipality: string): Promise<CommunityOrganization[]> {
  const apiPath = buildApiUrl(
    `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs?limit=50`,
  )

  try {
    const response = await fetch(apiPath, { cache: 'no-store' })
    if (!response.ok) {
      return []
    }
    const { json } = await parseApiResponse<{ items?: CommunityOrganization[] }>(response)
    return json?.items ?? []
  } catch {
    return []
  }
}

export async function fetchCommunityOrganization({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}): Promise<CommunityOrganization | null> {
  const apiPath = buildApiUrl(
    `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
  )

  try {
    const response = await fetch(apiPath, { cache: 'no-store' })
    if (!response.ok) {
      return null
    }
    const { json } = await parseApiResponse<{ org?: CommunityOrganization }>(response)
    return json?.org ?? null
  } catch {
    return null
  }
}
