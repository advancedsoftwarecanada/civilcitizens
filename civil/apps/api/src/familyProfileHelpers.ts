import { Prisma } from '@prisma/client'

type FamilyModeBand = 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
type FamilyRelationship = 'son' | 'daughter' | 'child' | 'stepson' | 'stepdaughter' | 'foster_child' | 'ward' | 'other'

type CreateFamilyProfileHelpersDeps = {
  buildDefaultFamilyMemberUsernameBase: (firstName: string, lastName: string) => string
  normalizeFamilyMemberUsernameCandidate: (value: string) => string | null
  normalizeMediaUrl: (value: string | null | undefined) => string | null
  parseCommunityMeta: (value: Prisma.JsonValue | null | undefined) => {
    dateOfBirth?: string
    countryOfBirth?: string
  } | null
}

function parseProfileNameParts(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

function calculateAgeFromDateOfBirth(dateOfBirth: Date, now = new Date()) {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth()
  const dayDelta = now.getUTCDate() - dateOfBirth.getUTCDate()
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1
  }
  return age
}

function getFamilyModeBandFromAge(age: number): FamilyModeBand {
  if (age <= 8) return 'EARLY_CHILDHOOD'
  if (age <= 12) return 'JUNIOR'
  if (age <= 15) return 'TEEN'
  if (age <= 17) return 'YOUTH'
  return 'ADULT'
}

function getFamilyModeBandLabel(band: FamilyModeBand) {
  if (band === 'EARLY_CHILDHOOD') return 'Early Childhood Mode (5 to 8)'
  if (band === 'JUNIOR') return 'Junior Mode (9 to 12)'
  if (band === 'TEEN') return 'Teen Mode (13 to 15)'
  if (band === 'YOUTH') return 'Youth Mode (16 to 17)'
  return 'Adult Mode (18+)'
}

function getFamilyRelationshipLabel(value: FamilyRelationship) {
  if (value === 'son') return 'Son'
  if (value === 'daughter') return 'Daughter'
  if (value === 'child') return 'Child'
  if (value === 'stepson') return 'Stepson'
  if (value === 'stepdaughter') return 'Stepdaughter'
  if (value === 'foster_child') return 'Foster Child'
  if (value === 'ward') return 'Ward'
  return 'Other'
}

export function createFamilyProfileHelpers(deps: CreateFamilyProfileHelpersDeps) {
  function isParentProfileEligibleForFamilyMode(user: { name?: string | null; communityMeta?: Prisma.JsonValue | null | undefined }) {
    const nameParts = parseProfileNameParts(user.name)
    const meta = deps.parseCommunityMeta(user.communityMeta ?? null)
    return {
      firstName: Boolean(nameParts.firstName.trim()),
      lastName: Boolean(nameParts.lastName.trim()),
      dateOfBirth: Boolean(meta?.dateOfBirth),
      countryOfBirth: Boolean(meta?.countryOfBirth),
    }
  }

  function normalizeFamilyMemberSummary(member: {
    id: string
    firstName: string
    lastName: string
    dateOfBirth: Date
    relationship: FamilyRelationship
    friendCode: string
    username?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
    allowChildOwnMediaEdits?: boolean
    allowChildOwnUsernameEdits?: boolean
    allowChildAudioCalls?: boolean
    allowChildVideoCalls?: boolean
    notifyParentOnMediaChanges?: boolean
    suspendedAt: Date | null
    suspendedById: string | null
    suspensionNote: string | null
    createdAt: Date
    updatedAt: Date
  }) {
    const age = calculateAgeFromDateOfBirth(member.dateOfBirth)
    const modeBand = getFamilyModeBandFromAge(age)
    return {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      relationship: member.relationship,
      relationshipLabel: getFamilyRelationshipLabel(member.relationship),
      displayName: `${member.firstName} ${member.lastName}`.trim(),
      dateOfBirth: member.dateOfBirth.toISOString().slice(0, 10),
      age,
      modeBand,
      modeLabel: getFamilyModeBandLabel(modeBand),
      friendCode: member.friendCode,
      username:
        deps.normalizeFamilyMemberUsernameCandidate(member.username ?? '') ||
        deps.buildDefaultFamilyMemberUsernameBase(member.firstName, member.lastName),
      avatarUrl: deps.normalizeMediaUrl(member.avatarUrl ?? null),
      coverUrl: deps.normalizeMediaUrl(member.coverUrl ?? null),
      allowChildOwnMediaEdits: Boolean(member.allowChildOwnMediaEdits),
      allowChildOwnUsernameEdits:
        member.allowChildOwnUsernameEdits == null ? true : Boolean(member.allowChildOwnUsernameEdits),
      allowChildAudioCalls: member.allowChildAudioCalls == null ? true : Boolean(member.allowChildAudioCalls),
      allowChildVideoCalls: member.allowChildVideoCalls == null ? true : Boolean(member.allowChildVideoCalls),
      notifyParentOnMediaChanges: Boolean(member.notifyParentOnMediaChanges),
      suspended: Boolean(member.suspendedAt),
      suspendedAt: member.suspendedAt ? member.suspendedAt.toISOString() : null,
      suspendedById: member.suspendedById,
      suspensionNote: member.suspensionNote,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    }
  }

  return {
    isParentProfileEligibleForFamilyMode,
    normalizeFamilyMemberSummary,
  }
}
