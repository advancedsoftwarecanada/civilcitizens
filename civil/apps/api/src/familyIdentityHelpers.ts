import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { buildHandleBase } from '@civil/shared'

export const FAMILY_MEMBER_USERNAME_MIN_LENGTH = 6
export const FAMILY_MEMBER_USERNAME_MAX_LENGTH = 20
export const FAMILY_MEMBER_USERNAME_PATTERN = /^[A-Za-z0-9]{6,20}$/

type FamilyIdentityHelperDeps = {
  getLegacyFamilyMemberStoredUsername: (communityMeta: Prisma.JsonValue | null | undefined, memberId: string) => string | null
  isFamilyMemberTableMissing: (error: unknown) => boolean
  loadFamilyMemberAuthViewerById: (memberId: string, parentId?: string | null) => Promise<any>
  parseCommunityMeta: (value: Prisma.JsonValue | null | undefined) => {
    familyMemberSettings?: Record<string, { username?: string | null }> | null
  } | null
}

export function createFamilyIdentityHelpers(deps: FamilyIdentityHelperDeps) {
  function calculateAgeFromDateOfBirth(dateOfBirth: Date, now = new Date()) {
    let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear()
    const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth()
    const dayDelta = now.getUTCDate() - dateOfBirth.getUTCDate()
    if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
      age -= 1
    }
    return age
  }

  function parseFamilyMemberDateOfBirth(rawDateOfBirth: string) {
    const dateOfBirth = new Date(`${rawDateOfBirth}T00:00:00.000Z`)
    if (Number.isNaN(dateOfBirth.getTime())) return { error: 'family_member_invalid_dob' as const }

    const age = calculateAgeFromDateOfBirth(dateOfBirth)
    if (age < 5) return { error: 'family_member_too_young' as const }
    if (age > 120) return { error: 'family_member_invalid_age' as const }

    return { dateOfBirth, age }
  }

  function buildFamilySuspensionMessage(displayName: string) {
    return `${displayName} has been suspended in Family Mode until a parent or guardian restores the account.`
  }

  function buildFamilyFriendCode() {
    return `${randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}-${randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}-${randomUUID().replace(/-/g, '').slice(0, 2).toUpperCase()}`
  }

  function normalizeFamilyMemberUsernameCandidate(value: string) {
    return value.trim()
  }

  function normalizeFamilyMemberUsernameLookup(value: string) {
    return normalizeFamilyMemberUsernameCandidate(value).toLowerCase()
  }

  function isValidFamilyMemberUsername(value: string) {
    return FAMILY_MEMBER_USERNAME_PATTERN.test(normalizeFamilyMemberUsernameCandidate(value))
  }

  function buildDefaultFamilyMemberUsernameBase(firstName: string, lastName: string) {
    const base = buildHandleBase(firstName, lastName).slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
    if (base.length >= FAMILY_MEMBER_USERNAME_MIN_LENGTH) return base
    return `${base}${'friend'.slice(0, Math.max(0, FAMILY_MEMBER_USERNAME_MIN_LENGTH - base.length))}`.slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
  }

  function applyFamilyMemberUsernameSuffix(base: string, attempt: number) {
    if (attempt === 0) return base
    const suffix = String(attempt + 1)
    const trimmedBase = base.slice(
      0,
      Math.max(FAMILY_MEMBER_USERNAME_MIN_LENGTH, FAMILY_MEMBER_USERNAME_MAX_LENGTH - suffix.length),
    )
    return `${trimmedBase}${suffix}`.slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
  }

  async function isFamilyMemberUsernameTaken(
    username: string,
    options?: {
      excludeMemberId?: string | null
    },
  ) {
    const normalizedLookup = normalizeFamilyMemberUsernameLookup(username)

    const existingUser = await prisma.user.findFirst({
      where: {
        handle: {
          equals: normalizedLookup,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    })
    if (existingUser) return true

    try {
      const existingMember = await prisma.familyMember.findFirst({
        where: {
          username: {
            equals: normalizeFamilyMemberUsernameCandidate(username),
            mode: 'insensitive',
          },
          ...(options?.excludeMemberId ? { NOT: { id: options.excludeMemberId } } : {}),
        },
        select: { id: true },
      })
      return Boolean(existingMember)
    } catch (error) {
      if (!deps.isFamilyMemberTableMissing(error)) throw error

      const users = await prisma.user.findMany({
        select: {
          communityMeta: true,
        },
      })

      return users.some((user: { communityMeta: Prisma.JsonValue | null }) => {
        const settings = deps.parseCommunityMeta(user.communityMeta ?? null)?.familyMemberSettings
        if (!settings) return false
        return Object.entries(settings).some(([memberId, value]) => {
          if (options?.excludeMemberId && memberId === options.excludeMemberId) return false
          return normalizeFamilyMemberUsernameLookup(value?.username ?? '') === normalizedLookup
        })
      })
    }
  }

  async function generateUniqueFamilyMemberUsername(firstName: string, lastName: string) {
    const base = buildDefaultFamilyMemberUsernameBase(firstName, lastName)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = applyFamilyMemberUsernameSuffix(base, attempt)
      if (!(await isFamilyMemberUsernameTaken(candidate))) {
        return candidate
      }
    }
    throw new Error('family_username_generation_failed')
  }

  async function findFamilyMemberByInviteCode(inviteCode: string) {
    const normalizedInviteCode = inviteCode.trim().toUpperCase()
    if (!normalizedInviteCode) return null
    const member = await prisma.familyMember.findFirst({
      where: { friendCode: normalizedInviteCode },
      select: { id: true, parentId: true },
    })
    if (!member) return null
    return deps.loadFamilyMemberAuthViewerById(member.id, member.parentId)
  }

  async function findFamilyMemberByUsername(username: string) {
    const normalizedLookup = normalizeFamilyMemberUsernameLookup(username)
    if (!normalizedLookup) return null

    try {
      const member = await prisma.familyMember.findFirst({
        where: {
          username: {
            equals: username.trim(),
            mode: 'insensitive',
          },
        },
        select: { id: true, parentId: true },
      })
      if (member) {
        return deps.loadFamilyMemberAuthViewerById(member.id, member.parentId)
      }
    } catch (error) {
      if (!deps.isFamilyMemberTableMissing(error)) throw error
    }

    const members = await prisma.familyMember.findMany({
      select: {
        id: true,
        parentId: true,
        firstName: true,
        lastName: true,
        friendCode: true,
        parent: {
          select: {
            communityMeta: true,
          },
        },
      },
    })

    for (const member of members) {
      const candidate =
        deps.getLegacyFamilyMemberStoredUsername(member.parent.communityMeta, member.id) ??
        buildDefaultFamilyMemberUsernameBase(member.firstName, member.lastName)
      if (normalizeFamilyMemberUsernameLookup(candidate) === normalizedLookup) {
        return deps.loadFamilyMemberAuthViewerById(member.id, member.parentId)
      }
    }

    return null
  }

  async function generateUniqueFamilyFriendCode() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = buildFamilyFriendCode()
      let existing: { id: string } | null = null
      try {
        existing = await prisma.familyMember.findUnique({ where: { friendCode: candidate }, select: { id: true } })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
        return candidate
      }
      if (!existing) return candidate
    }
    throw new Error('family_friend_code_generation_failed')
  }

  return {
    buildDefaultFamilyMemberUsernameBase,
    buildFamilySuspensionMessage,
    calculateAgeFromDateOfBirth,
    findFamilyMemberByInviteCode,
    findFamilyMemberByUsername,
    generateUniqueFamilyFriendCode,
    generateUniqueFamilyMemberUsername,
    isFamilyMemberUsernameTaken,
    isValidFamilyMemberUsername,
    normalizeFamilyMemberUsernameCandidate,
    normalizeFamilyMemberUsernameLookup,
    parseFamilyMemberDateOfBirth,
  }
}
