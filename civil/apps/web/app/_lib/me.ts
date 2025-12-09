export type HomeCommunitySummary = {
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
}

// Legacy alias for backwards compatibility
export type HomeChamberSummary = HomeCommunitySummary

export type MeResponse = {
  id: string
  email: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  homeCommunity?: HomeCommunitySummary | null
  homeChamber?: HomeChamberSummary | null
  isPremium?: boolean
  isVerified?: boolean
  premiumSince?: string | null
  premiumRenewsAt?: string | null
}

export function hasHomeCommunity(me: MeResponse | null | undefined): boolean {
  const home = me?.homeCommunity ?? me?.homeChamber
  return Boolean(home && home.communitySlug && home.provinceCode)
}

export { hasHomeCommunity as hasHomeChamber }

export function isPremiumMember(me: MeResponse | null | undefined): boolean {
  return Boolean(me?.isPremium)
}
