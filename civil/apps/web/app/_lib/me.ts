export type HomeCommunitySummary = {
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
}

export type CivicStatusValue = 'citizen' | 'permanent_resident' | 'work_permit' | 'study_permit' | 'unspecified'
export type WorkAuthorizationValue = 'authorized' | 'not_authorized' | 'unspecified'

// Legacy alias for backwards compatibility
export type HomeChamberSummary = HomeCommunitySummary

export type MeResponse = {
  id: string
  email: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  homeCommunity?: HomeCommunitySummary | null
  homeChamber?: HomeChamberSummary | null
  isPremium?: boolean
  isVerified?: boolean
  premiumSince?: string | null
  premiumRenewsAt?: string | null
  civicStatus?: CivicStatusValue | null
  workAuthorization?: WorkAuthorizationValue | null
  verificationMethod?: 'self_declaration' | null
  statusDeclaredAt?: string | null
  statusUpdatedAt?: string | null
}

export function hasHomeCommunity(me: MeResponse | null | undefined): boolean {
  const home = me?.homeCommunity ?? me?.homeChamber
  return Boolean(home && home.communitySlug && home.provinceCode)
}

export function hasDeclaredCivilStatus(me: MeResponse | null | undefined): boolean {
  return Boolean(me?.civicStatus && me?.verificationMethod === 'self_declaration' && me?.statusDeclaredAt)
}

export function getAuthedEntryPath(me: MeResponse | null | undefined): '/welcome' | '/verify' | '/home' {
  if (!hasHomeCommunity(me)) return '/welcome'
  if (!hasDeclaredCivilStatus(me)) return '/verify'
  return '/home'
}

export { hasHomeCommunity as hasHomeChamber }

export function isPremiumMember(me: MeResponse | null | undefined): boolean {
  return Boolean(me?.isPremium)
}
