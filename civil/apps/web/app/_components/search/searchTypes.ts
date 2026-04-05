export type SearchType = 'all' | 'people' | 'communities' | 'organizations' | 'events' | 'lives' | 'market' | 'posts' | 'videos'

export type HomeCommunitySummary = {
  provinceCode: string
  provinceName: string | null
  communitySlug?: string | null
  communityName?: string | null
  chamberSlug?: string | null
  chamberName?: string | null
}

export type UserSearchResult = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  isPremium: boolean
  isVerified: boolean
  homeCommunity?: HomeCommunitySummary | null
  homeChamber?: HomeCommunitySummary | null
}

export type CommunitySearchResult = {
  slug: string
  name: string
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
  chamberSlug: string
  chamberName: string
  latitude: number
  longitude: number
  population: number | null
  distanceKm?: number
}

export type OrganizationSearchResult = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  isVerified: boolean
  provinceCode: string
  communitySlug: string
  communityName: string | null
  href: string
}

export type EventSearchResult = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  startsAt: string | null
  startsAtLabel: string | null
  organization: {
    name: string
    slug: string
    logoUrl: string | null
    isVerified: boolean
  }
  provinceCode: string
  communitySlug: string
  communityName: string | null
  href: string
}

export type MarketSearchResult = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  priceLabel: string
  locationLabel: string | null
  href: string
}

export type PostSearchResult = {
  id: string
  title: string | null
  excerpt: string | null
  imageUrl: string | null
  communityName: string | null
  provinceName: string | null
  author: {
    handle: string
    name: string | null
    avatarUrl: string | null
  }
  organization: {
    name: string
    slug: string
    logoUrl: string | null
  } | null
  href: string
}

export type VideoSearchResult = {
  id: string
  title: string | null
  excerpt: string | null
  thumbnailUrl: string | null
  durationMs: number | null
  communityName: string | null
  provinceName: string | null
  author: {
    handle: string
    name: string | null
    avatarUrl: string | null
  }
  organization: {
    name: string
    slug: string
    logoUrl: string | null
  } | null
  href: string
}

export type LiveSpaceSearchResult = {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  href: string
  host: {
    handle: string
    name: string | null
    avatarUrl: string | null
  }
}

export type SearchResponseMeta = {
  type?: SearchType
  peopleHasMore?: boolean
  communitiesHasMore?: boolean
  organizationsHasMore?: boolean
  eventsHasMore?: boolean
  livesHasMore?: boolean
  marketHasMore?: boolean
  postsHasMore?: boolean
  videosHasMore?: boolean
}

export type SearchResponse = {
  people?: UserSearchResult[]
  communities?: CommunitySearchResult[]
  organizations?: OrganizationSearchResult[]
  events?: EventSearchResult[]
  lives?: LiveSpaceSearchResult[]
  market?: MarketSearchResult[]
  posts?: PostSearchResult[]
  videos?: VideoSearchResult[]
  meta?: SearchResponseMeta
}
