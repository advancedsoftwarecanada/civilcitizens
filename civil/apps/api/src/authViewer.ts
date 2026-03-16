import { prisma } from '@civil/db'
import { PremiumStatus, Prisma } from '@prisma/client'
import { findCommunity, getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'

type FamilyRelationship = 'son' | 'daughter' | 'child' | 'stepson' | 'stepdaughter' | 'foster_child' | 'ward' | 'other'

type FamilyMemberAuthViewerRecord = {
  id: string
  parentId: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  relationship: FamilyRelationship
  friendCode: string
  username: string | null
  avatarUrl: string | null
  coverUrl: string | null
  allowChildOwnMediaEdits: boolean
  allowChildOwnUsernameEdits: boolean
  allowChildAudioCalls: boolean
  allowChildVideoCalls: boolean
  notifyParentOnMediaChanges: boolean
  suspendedAt: Date | null
  suspendedById: string | null
  suspensionNote: string | null
  createdAt: Date
  updatedAt: Date
  parent: {
    id: string
    email: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    communityMeta: Prisma.JsonValue | null
    premiumStatus: PremiumStatus
    premiumSince: Date | null
    premiumRenewsAt: Date | null
  }
}

type CreateAuthViewerHelpersDeps = {
  getLegacyFamilyMemberPermissionSettings: (communityMeta: Prisma.JsonValue | null | undefined, memberId: string) => any
  getLegacyFamilyMemberStoredProfileMedia: (communityMeta: Prisma.JsonValue | null | undefined, memberId: string) => any
  getLegacyFamilyMemberStoredUsername: (communityMeta: Prisma.JsonValue | null | undefined, memberId: string) => string | null
  isFamilyMemberTableMissing: (error: unknown) => boolean
  normalizeFamilyMemberSummary: (member: any) => any
  parseCommunityMeta: (value: any) => any
}

function readAccountModerationState(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const rawState = payload.accountModeration
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null

  const state = rawState as Record<string, unknown>
  if (state.status !== 'SUSPENDED') return null

  return {
    status: 'SUSPENDED' as const,
    suspendedAt: typeof state.suspendedAt === 'string' ? state.suspendedAt : undefined,
    suspendedByUserId: typeof state.suspendedByUserId === 'string' ? state.suspendedByUserId : null,
    suspensionReason: typeof state.suspensionReason === 'string' ? state.suspensionReason : null,
    sourceReportId: typeof state.sourceReportId === 'string' ? state.sourceReportId : null,
  }
}

export function createAuthViewerHelpers(deps: CreateAuthViewerHelpersDeps) {
  function isAccountSuspended(value: Prisma.JsonValue | null | undefined) {
    return readAccountModerationState(value)?.status === 'SUSPENDED'
  }

  async function loadActiveAuthUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        communityMeta: true,
      },
    })

    if (!user || isAccountSuspended(user.communityMeta)) return null
    return user
  }

  async function loadFamilyMemberAuthViewerById(memberId: string, parentId?: string | null) {
    const member = await prisma.familyMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        parentId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        username: true,
        avatarUrl: true,
        coverUrl: true,
        allowChildOwnMediaEdits: true,
        allowChildOwnUsernameEdits: true,
        allowChildAudioCalls: true,
        allowChildVideoCalls: true,
        notifyParentOnMediaChanges: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
        parent: {
          select: {
            id: true,
            email: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            communityMeta: true,
            premiumStatus: true,
            premiumSince: true,
            premiumRenewsAt: true,
          },
        },
      },
    })

    if (!member) return null
    if (parentId && member.parentId !== parentId) return null
    if (isAccountSuspended(member.parent.communityMeta)) return null
    return member
  }

  async function buildHomeCommunitySummaryForUserId(userId: string) {
    const homeFollow = await prisma.communityFollow.findFirst({ where: { userId, home: true } })
    if (!homeFollow) return null

    const community = findCommunity(homeFollow.provinceCode, homeFollow.communitySlug)
    const normalizedProvince = normalizeProvinceCode(homeFollow.provinceCode)
    return {
      provinceCode: normalizedProvince ?? homeFollow.provinceCode,
      provinceName: normalizedProvince
        ? getProvinceDisplayName(normalizedProvince)
        : homeFollow.provinceCode.toUpperCase(),
      communitySlug: homeFollow.communitySlug,
      communityName: community?.name ?? homeFollow.communitySlug,
    }
  }

  function buildFamilyMemberAuthMeResponse(
    member: FamilyMemberAuthViewerRecord,
    homeCommunity: {
      provinceCode: string
      provinceName: string
      communitySlug: string
      communityName: string
    } | null,
  ) {
    const normalizedMember = deps.normalizeFamilyMemberSummary(member)
    const parentMeta = deps.parseCommunityMeta(member.parent.communityMeta ?? null)
    return {
      id: normalizedMember.id,
      email: `${normalizedMember.friendCode.toLowerCase()}@family.local`,
      handle: `family-${normalizedMember.friendCode.toLowerCase()}`,
      name: normalizedMember.displayName,
      avatarUrl: normalizedMember.avatarUrl,
      coverUrl: normalizedMember.coverUrl,
      homeCommunity,
      isPremium: false,
      isVerified: false,
      premiumSince: null,
      premiumRenewsAt: null,
      civicStatus: parentMeta?.civicStatus ?? null,
      workAuthorization: parentMeta?.workAuthorization ?? null,
      verificationMethod: parentMeta?.verificationMethod ?? null,
      statusDeclaredAt: parentMeta?.statusDeclaredAt ?? null,
      statusUpdatedAt: parentMeta?.statusUpdatedAt ?? null,
      familyMode: null,
      accountType: 'family_member' as const,
      familyMemberSession: {
        parentId: member.parent.id,
        parentHandle: member.parent.handle,
        parentName: member.parent.name,
        username: normalizedMember.username,
        relationshipLabel: normalizedMember.relationshipLabel,
        modeBand: normalizedMember.modeBand,
        modeLabel: normalizedMember.modeLabel,
        age: normalizedMember.age,
        allowChildOwnMediaEdits: normalizedMember.allowChildOwnMediaEdits,
        allowChildOwnUsernameEdits: normalizedMember.allowChildOwnUsernameEdits,
        allowChildAudioCalls: normalizedMember.allowChildAudioCalls,
        allowChildVideoCalls: normalizedMember.allowChildVideoCalls,
        notifyParentOnMediaChanges: normalizedMember.notifyParentOnMediaChanges,
        suspended: normalizedMember.suspended,
        suspendedAt: normalizedMember.suspendedAt,
        suspensionNote: normalizedMember.suspensionNote,
      },
    }
  }

  return {
    buildFamilyMemberAuthMeResponse,
    buildHomeCommunitySummaryForUserId,
    isAccountSuspended,
    loadActiveAuthUserById,
    loadFamilyMemberAuthViewerById,
  }
}