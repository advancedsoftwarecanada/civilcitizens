export type HomeCommunitySummary = {
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
}

export type CivicStatusValue = 'citizen' | 'permanent_resident' | 'work_permit' | 'study_permit' | 'unspecified'
export type WorkAuthorizationValue = 'authorized' | 'not_authorized' | 'unspecified'

export type FamilyModeSummary = {
  enabled: boolean
  enabledAt?: string | null
  affirmedProfileTruthAt?: string | null
  acceptedChildSafetyInfoAt?: string | null
  memberCount?: number
  relationshipCount?: number
}

export type FamilyMemberSessionSummary = {
  parentId: string
  parentHandle: string
  parentName?: string | null
  username?: string | null
  relationshipLabel: string
  modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
  modeLabel: string
  age: number
  allowChildOwnMediaEdits?: boolean
  allowChildOwnUsernameEdits?: boolean
  allowChildAudioCalls?: boolean
  allowChildVideoCalls?: boolean
  notifyParentOnMediaChanges?: boolean
  suspended: boolean
  suspendedAt?: string | null
  suspensionNote?: string | null
}

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
  familyMode?: FamilyModeSummary | null
  accountType?: 'user' | 'family_member'
  familyMemberSession?: FamilyMemberSessionSummary | null
}

type FamilyModeLike = {
  familyMode?: {
    enabled?: boolean | null
    memberCount?: number | null
    relationshipCount?: number | null
  } | null
}

export function hasHomeCommunity(me: MeResponse | null | undefined): boolean {
  const home = me?.homeCommunity ?? me?.homeChamber
  return Boolean(home && home.communitySlug && home.provinceCode)
}

export function hasDeclaredCivilStatus(me: MeResponse | null | undefined): boolean {
  return Boolean(me?.civicStatus && me?.verificationMethod === 'self_declaration' && me?.statusDeclaredAt)
}

export function getAuthedEntryPath(me: MeResponse | null | undefined): '/welcome' | '/verify' | '/home' {
  if (me?.accountType === 'family_member') return '/home'
  if (!hasHomeCommunity(me)) return '/welcome'
  if (!hasDeclaredCivilStatus(me)) return '/verify'
  return '/home'
}

export { hasHomeCommunity as hasHomeChamber }

export function isPremiumMember(me: MeResponse | null | undefined): boolean {
  return Boolean(me?.isPremium)
}

export function hasFamilyModeEnabled(me: FamilyModeLike | null | undefined): boolean {
  return Boolean(me?.familyMode?.enabled)
}

export function hasFamilyProfilesAvailable(me: FamilyModeLike | null | undefined): boolean {
  const memberCount = me?.familyMode?.memberCount ?? 0
  const relationshipCount = me?.familyMode?.relationshipCount ?? 0
  return memberCount > 0 || relationshipCount > 0 || Boolean(me?.familyMode?.enabled && memberCount > 0)
}
