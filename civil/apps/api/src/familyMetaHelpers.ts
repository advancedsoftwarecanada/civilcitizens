import { Prisma } from '@prisma/client'

type CitySummaryType = {
  name: string
  slug: string
  provinceCode: string
  provinceName: string | null
  communitySlug: string
  communityName: string | null
  latitude: number
  longitude: number
  population: number | null
}

export type ProfileFamilyRelationship =
  | 'husband'
  | 'wife'
  | 'spouse'
  | 'partner'
  | 'common_law_partner'
  | 'fiance'
  | 'ex_husband'
  | 'ex_wife'
  | 'widowed_spouse'
  | 'mother'
  | 'father'
  | 'parent'
  | 'stepfather'
  | 'stepmother'
  | 'adoptive_father'
  | 'adoptive_mother'
  | 'foster_parent'
  | 'son'
  | 'daughter'
  | 'child'
  | 'stepson'
  | 'stepdaughter'
  | 'adopted_son'
  | 'adopted_daughter'
  | 'foster_child'
  | 'grandmother'
  | 'grandfather'
  | 'grandparent'
  | 'grandson'
  | 'granddaughter'
  | 'grandchild'
  | 'sister'
  | 'brother'
  | 'sibling'
  | 'half_brother'
  | 'half_sister'
  | 'step_brother'
  | 'step_sister'
  | 'aunt'
  | 'uncle'
  | 'cousin'
  | 'second_cousin'
  | 'niece'
  | 'nephew'
  | 'great_uncle'
  | 'great_aunt'
  | 'mother_in_law'
  | 'father_in_law'
  | 'sister_in_law'
  | 'brother_in_law'
  | 'daughter_in_law'
  | 'son_in_law'
  | 'other'

export type ProfileFamilyRelationshipDirection = 'outbound' | 'inbound'

export type CommunityMetaPayload = {
  nearbyCommunities?: CitySummaryType[]
  computedAt?: string
  wallet?: {
    civilCreditsCents?: number
    enabled?: boolean
    eTransferEmail?: string | null
    sharing?: {
      family?: boolean
      friends?: boolean
      market?: boolean
    } | null
  } | null
  dateOfBirth?: string
  countryOfBirth?: string
  shareDateOfBirth?: boolean
  shareCountryOfBirth?: boolean
  civicStatus?: 'citizen' | 'permanent_resident' | 'work_permit' | 'study_permit' | 'unspecified'
  workAuthorization?: 'authorized' | 'not_authorized' | 'unspecified'
  verificationMethod?: 'self_declaration'
  statusDeclaredAt?: string
  statusUpdatedAt?: string
  reference?: {
    provinceCode?: string | null
    communitySlug?: string | null
    cityName?: string | null
  } | null
  familyMode?: {
    enabledAt?: string
    affirmedProfileTruthAt?: string
    acceptedChildSafetyInfoAt?: string
  } | null
  familyMemberSettings?: Record<
    string,
    {
      allowChildOwnMediaEdits?: boolean
      allowChildOwnUsernameEdits?: boolean
      allowChildAudioCalls?: boolean
      allowChildVideoCalls?: boolean
      notifyParentOnMediaChanges?: boolean
      username?: string | null
      avatarUrl?: string | null
      coverUrl?: string | null
    }
  > | null
  familyFriendRequests?: Array<{
    id: string
    requesterParentId: string
    requesterMemberId: string
    requesterDisplayName: string
    requesterUsername: string
    requesterAvatarUrl?: string | null
    requesterCoverUrl?: string | null
    requesterParentHandle?: string | null
    requesterParentName?: string | null
    requesterParentAvatarUrl?: string | null
    requesterParentCoverUrl?: string | null
    targetParentId: string
    targetMemberId: string
    targetDisplayName: string
    targetUsername: string
    targetAvatarUrl?: string | null
    targetCoverUrl?: string | null
    status: 'pending' | 'accepted' | 'rejected'
    createdAt: string
    respondedAt?: string | null
  }> | null
  familyFriendships?: Array<{
    id: string
    memberId: string
    peerMemberId: string
    peerParentId: string
    peerDisplayName: string
    peerUsername: string
    peerAvatarUrl?: string | null
    peerCoverUrl?: string | null
    createdAt: string
  }> | null
  familyMessageThreads?: Array<{
    memberId: string
    threadId: string
    peerUserId: string
    createdAt: string
    updatedAt: string
  }> | null
  familyParentConversations?: Array<{
    memberId: string
    parentId: string
    createdAt: string
    updatedAt: string
    childLastReadAt?: string | null
    parentLastReadAt?: string | null
    messages: Array<{
      id: string
      sender: 'child' | 'parent'
      body: string
      createdAt: string
      updatedAt: string
    }>
  }> | null
  profileFamilyRelationships?: Array<{
    relatedUserId: string
    relatedHandle: string
    relatedName?: string | null
    familyType: ProfileFamilyRelationship
    direction: ProfileFamilyRelationshipDirection
    createdAt: string
    updatedAt?: string | null
  }> | null
}

export type FamilyFriendRequestRecord = NonNullable<CommunityMetaPayload['familyFriendRequests']>[number]
export type FamilyFriendshipRecord = NonNullable<CommunityMetaPayload['familyFriendships']>[number]
export type FamilyMessageThreadRecord = NonNullable<CommunityMetaPayload['familyMessageThreads']>[number]
export type FamilyParentConversationRecord = NonNullable<CommunityMetaPayload['familyParentConversations']>[number]
export type ProfileFamilyRelationshipRecord = NonNullable<CommunityMetaPayload['profileFamilyRelationships']>[number]

export function parseCommunityMeta(value: Prisma.JsonValue | null | undefined): CommunityMetaPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const nearby = Array.isArray(payload.nearbyCommunities)
    ? (payload.nearbyCommunities as CitySummaryType[])
    : undefined
  const reference =
    payload.reference && typeof payload.reference === 'object' && !Array.isArray(payload.reference)
      ? (payload.reference as { provinceCode?: string | null; communitySlug?: string | null; cityName?: string | null })
      : null
  const computedAt = typeof payload.computedAt === 'string' ? payload.computedAt : undefined
  const walletValue = payload.wallet && typeof payload.wallet === 'object' && !Array.isArray(payload.wallet)
    ? (payload.wallet as Record<string, unknown>)
    : null
  const wallet = walletValue
    ? {
        civilCreditsCents:
          typeof walletValue.civilCreditsCents === 'number' && Number.isFinite(walletValue.civilCreditsCents)
            ? Math.max(0, Math.round(walletValue.civilCreditsCents))
            : undefined,
        enabled:
          typeof walletValue.enabled === 'boolean'
            ? walletValue.enabled
            : typeof walletValue.eTransferEmail === 'string' && walletValue.eTransferEmail.trim()
              ? true
              : undefined,
        eTransferEmail:
          typeof walletValue.eTransferEmail === 'string' && walletValue.eTransferEmail.trim()
            ? walletValue.eTransferEmail.trim().toLowerCase()
            : null,
        sharing:
          walletValue.sharing && typeof walletValue.sharing === 'object' && !Array.isArray(walletValue.sharing)
            ? {
                family:
                  typeof (walletValue.sharing as Record<string, unknown>).family === 'boolean'
                    ? Boolean((walletValue.sharing as Record<string, unknown>).family)
                    : undefined,
                friends:
                  typeof (walletValue.sharing as Record<string, unknown>).friends === 'boolean'
                    ? Boolean((walletValue.sharing as Record<string, unknown>).friends)
                    : undefined,
                market:
                  typeof (walletValue.sharing as Record<string, unknown>).market === 'boolean'
                    ? Boolean((walletValue.sharing as Record<string, unknown>).market)
                    : typeof walletValue.eTransferEmail === 'string' && walletValue.eTransferEmail.trim()
                      ? true
                      : undefined,
              }
            : null,
      }
    : null
  const dateOfBirth = typeof payload.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.dateOfBirth) ? payload.dateOfBirth : undefined
  const countryOfBirth = typeof payload.countryOfBirth === 'string' && payload.countryOfBirth.trim() ? payload.countryOfBirth.trim() : undefined
  const shareDateOfBirth = typeof payload.shareDateOfBirth === 'boolean' ? payload.shareDateOfBirth : undefined
  const shareCountryOfBirth = typeof payload.shareCountryOfBirth === 'boolean' ? payload.shareCountryOfBirth : undefined
  const civicStatus =
    payload.civicStatus === 'citizen' ||
    payload.civicStatus === 'permanent_resident' ||
    payload.civicStatus === 'work_permit' ||
    payload.civicStatus === 'study_permit' ||
    payload.civicStatus === 'unspecified'
      ? payload.civicStatus
      : undefined
  const workAuthorization =
    payload.workAuthorization === 'authorized' ||
    payload.workAuthorization === 'not_authorized' ||
    payload.workAuthorization === 'unspecified'
      ? payload.workAuthorization
      : undefined
  const verificationMethod = payload.verificationMethod === 'self_declaration' ? 'self_declaration' : undefined
  const statusDeclaredAt = typeof payload.statusDeclaredAt === 'string' ? payload.statusDeclaredAt : undefined
  const statusUpdatedAt = typeof payload.statusUpdatedAt === 'string' ? payload.statusUpdatedAt : undefined
  const familyModeValue = payload.familyMode && typeof payload.familyMode === 'object' && !Array.isArray(payload.familyMode)
    ? (payload.familyMode as Record<string, unknown>)
    : null
  const familyMode = familyModeValue
    ? {
        enabledAt: typeof familyModeValue.enabledAt === 'string' ? familyModeValue.enabledAt : undefined,
        affirmedProfileTruthAt:
          typeof familyModeValue.affirmedProfileTruthAt === 'string' ? familyModeValue.affirmedProfileTruthAt : undefined,
        acceptedChildSafetyInfoAt:
          typeof familyModeValue.acceptedChildSafetyInfoAt === 'string' ? familyModeValue.acceptedChildSafetyInfoAt : undefined,
      }
    : null
  const familyMemberSettingsValue =
    payload.familyMemberSettings && typeof payload.familyMemberSettings === 'object' && !Array.isArray(payload.familyMemberSettings)
      ? (payload.familyMemberSettings as Record<string, unknown>)
      : null
  const familyMemberSettings = familyMemberSettingsValue
    ? Object.fromEntries(
        Object.entries(familyMemberSettingsValue).flatMap(([memberId, rawValue]) => {
          if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
          const value = rawValue as Record<string, unknown>
          return [
            [
              memberId,
              {
                allowChildOwnMediaEdits:
                  typeof value.allowChildOwnMediaEdits === 'boolean' ? value.allowChildOwnMediaEdits : undefined,
                allowChildOwnUsernameEdits:
                  typeof value.allowChildOwnUsernameEdits === 'boolean' ? value.allowChildOwnUsernameEdits : undefined,
                allowChildAudioCalls:
                  typeof value.allowChildAudioCalls === 'boolean' ? value.allowChildAudioCalls : undefined,
                allowChildVideoCalls:
                  typeof value.allowChildVideoCalls === 'boolean' ? value.allowChildVideoCalls : undefined,
                notifyParentOnMediaChanges:
                  typeof value.notifyParentOnMediaChanges === 'boolean' ? value.notifyParentOnMediaChanges : undefined,
                username:
                  typeof value.username === 'string' && value.username.trim() ? value.username.trim() : null,
                avatarUrl:
                  typeof value.avatarUrl === 'string' && value.avatarUrl.trim() ? value.avatarUrl.trim() : null,
                coverUrl:
                  typeof value.coverUrl === 'string' && value.coverUrl.trim() ? value.coverUrl.trim() : null,
              },
            ],
          ]
        }),
      )
    : null
  const familyFriendRequests = Array.isArray(payload.familyFriendRequests)
    ? payload.familyFriendRequests.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        const status =
          value.status === 'accepted' || value.status === 'rejected' || value.status === 'pending'
            ? value.status
            : 'pending'
        if (
          typeof value.id !== 'string' ||
          typeof value.requesterParentId !== 'string' ||
          typeof value.requesterMemberId !== 'string' ||
          typeof value.requesterDisplayName !== 'string' ||
          typeof value.requesterUsername !== 'string' ||
          typeof value.targetParentId !== 'string' ||
          typeof value.targetMemberId !== 'string' ||
          typeof value.targetDisplayName !== 'string' ||
          typeof value.targetUsername !== 'string' ||
          typeof value.createdAt !== 'string'
        ) {
          return []
        }
        return [{
          id: value.id,
          requesterParentId: value.requesterParentId,
          requesterMemberId: value.requesterMemberId,
          requesterDisplayName: value.requesterDisplayName,
          requesterUsername: value.requesterUsername,
          requesterAvatarUrl: typeof value.requesterAvatarUrl === 'string' ? value.requesterAvatarUrl : null,
          requesterCoverUrl: typeof value.requesterCoverUrl === 'string' ? value.requesterCoverUrl : null,
          requesterParentHandle: typeof value.requesterParentHandle === 'string' ? value.requesterParentHandle : null,
          requesterParentName: typeof value.requesterParentName === 'string' ? value.requesterParentName : null,
          requesterParentAvatarUrl: typeof value.requesterParentAvatarUrl === 'string' ? value.requesterParentAvatarUrl : null,
          requesterParentCoverUrl: typeof value.requesterParentCoverUrl === 'string' ? value.requesterParentCoverUrl : null,
          targetParentId: value.targetParentId,
          targetMemberId: value.targetMemberId,
          targetDisplayName: value.targetDisplayName,
          targetUsername: value.targetUsername,
          targetAvatarUrl: typeof value.targetAvatarUrl === 'string' ? value.targetAvatarUrl : null,
          targetCoverUrl: typeof value.targetCoverUrl === 'string' ? value.targetCoverUrl : null,
          status,
          createdAt: value.createdAt,
          respondedAt: typeof value.respondedAt === 'string' ? value.respondedAt : null,
        } satisfies FamilyFriendRequestRecord]
      })
    : null
  const familyFriendships = Array.isArray(payload.familyFriendships)
    ? payload.familyFriendships.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        if (
          typeof value.id !== 'string' ||
          typeof value.memberId !== 'string' ||
          typeof value.peerMemberId !== 'string' ||
          typeof value.peerParentId !== 'string' ||
          typeof value.peerDisplayName !== 'string' ||
          typeof value.peerUsername !== 'string' ||
          typeof value.createdAt !== 'string'
        ) {
          return []
        }
        return [{
          id: value.id,
          memberId: value.memberId,
          peerMemberId: value.peerMemberId,
          peerParentId: value.peerParentId,
          peerDisplayName: value.peerDisplayName,
          peerUsername: value.peerUsername,
          peerAvatarUrl: typeof value.peerAvatarUrl === 'string' ? value.peerAvatarUrl : null,
          peerCoverUrl: typeof value.peerCoverUrl === 'string' ? value.peerCoverUrl : null,
          createdAt: value.createdAt,
        } satisfies FamilyFriendshipRecord]
      })
    : null
  const familyMessageThreads = Array.isArray(payload.familyMessageThreads)
    ? payload.familyMessageThreads.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        if (
          typeof value.memberId !== 'string' ||
          typeof value.threadId !== 'string' ||
          typeof value.peerUserId !== 'string' ||
          typeof value.createdAt !== 'string' ||
          typeof value.updatedAt !== 'string'
        ) {
          return []
        }
        return [{
          memberId: value.memberId,
          threadId: value.threadId,
          peerUserId: value.peerUserId,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
        } satisfies FamilyMessageThreadRecord]
      })
    : null
  const familyParentConversations = Array.isArray(payload.familyParentConversations)
    ? payload.familyParentConversations.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        if (
          typeof value.memberId !== 'string' ||
          typeof value.parentId !== 'string' ||
          typeof value.createdAt !== 'string' ||
          typeof value.updatedAt !== 'string'
        ) {
          return []
        }
        const messages = Array.isArray(value.messages)
          ? value.messages.flatMap((rawMessage) => {
              if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) return []
              const message = rawMessage as Record<string, unknown>
              if (
                typeof message.id !== 'string' ||
                (message.sender !== 'child' && message.sender !== 'parent') ||
                typeof message.body !== 'string' ||
                typeof message.createdAt !== 'string' ||
                typeof message.updatedAt !== 'string'
              ) {
                return []
              }
              return [{
                id: message.id,
                sender: message.sender,
                body: message.body,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
              } satisfies FamilyParentConversationRecord['messages'][number]]
            })
          : []
        return [{
          memberId: value.memberId,
          parentId: value.parentId,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          childLastReadAt: typeof value.childLastReadAt === 'string' ? value.childLastReadAt : null,
          parentLastReadAt: typeof value.parentLastReadAt === 'string' ? value.parentLastReadAt : null,
          messages,
        } satisfies FamilyParentConversationRecord]
      })
    : null
  const profileFamilyRelationships = Array.isArray(payload.profileFamilyRelationships)
    ? payload.profileFamilyRelationships.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        const familyType =
          value.familyType === 'husband' ||
          value.familyType === 'wife' ||
          value.familyType === 'spouse' ||
          value.familyType === 'partner' ||
          value.familyType === 'common_law_partner' ||
          value.familyType === 'fiance' ||
          value.familyType === 'ex_husband' ||
          value.familyType === 'ex_wife' ||
          value.familyType === 'widowed_spouse' ||
          value.familyType === 'mother' ||
          value.familyType === 'father' ||
          value.familyType === 'parent' ||
          value.familyType === 'stepfather' ||
          value.familyType === 'stepmother' ||
          value.familyType === 'adoptive_father' ||
          value.familyType === 'adoptive_mother' ||
          value.familyType === 'foster_parent' ||
          value.familyType === 'son' ||
          value.familyType === 'daughter' ||
          value.familyType === 'child' ||
          value.familyType === 'stepson' ||
          value.familyType === 'stepdaughter' ||
          value.familyType === 'adopted_son' ||
          value.familyType === 'adopted_daughter' ||
          value.familyType === 'foster_child' ||
          value.familyType === 'grandmother' ||
          value.familyType === 'grandfather' ||
          value.familyType === 'grandparent' ||
          value.familyType === 'grandson' ||
          value.familyType === 'granddaughter' ||
          value.familyType === 'grandchild' ||
          value.familyType === 'sister' ||
          value.familyType === 'brother' ||
          value.familyType === 'sibling' ||
          value.familyType === 'half_brother' ||
          value.familyType === 'half_sister' ||
          value.familyType === 'step_brother' ||
          value.familyType === 'step_sister' ||
          value.familyType === 'aunt' ||
          value.familyType === 'uncle' ||
          value.familyType === 'cousin' ||
          value.familyType === 'second_cousin' ||
          value.familyType === 'niece' ||
          value.familyType === 'nephew' ||
          value.familyType === 'great_uncle' ||
          value.familyType === 'great_aunt' ||
          value.familyType === 'mother_in_law' ||
          value.familyType === 'father_in_law' ||
          value.familyType === 'sister_in_law' ||
          value.familyType === 'brother_in_law' ||
          value.familyType === 'daughter_in_law' ||
          value.familyType === 'son_in_law' ||
          value.familyType === 'other'
            ? value.familyType
            : null
        const direction = value.direction === 'outbound' || value.direction === 'inbound' ? value.direction : null
        if (
          typeof value.relatedUserId !== 'string' ||
          typeof value.relatedHandle !== 'string' ||
          typeof value.createdAt !== 'string' ||
          !familyType ||
          !direction
        ) {
          return []
        }
        return [{
          relatedUserId: value.relatedUserId,
          relatedHandle: value.relatedHandle,
          relatedName: typeof value.relatedName === 'string' ? value.relatedName : null,
          familyType,
          direction,
          createdAt: value.createdAt,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        } satisfies ProfileFamilyRelationshipRecord]
      })
    : null
  return {
    nearbyCommunities: nearby,
    computedAt,
    wallet,
    dateOfBirth,
    countryOfBirth,
    shareDateOfBirth,
    shareCountryOfBirth,
    civicStatus,
    workAuthorization,
    verificationMethod,
    statusDeclaredAt,
    statusUpdatedAt,
    familyMode,
    familyMemberSettings,
    familyFriendRequests,
    familyFriendships,
    familyMessageThreads,
    familyParentConversations,
    profileFamilyRelationships,
    reference,
  }
}

export function getLegacyFamilyMemberPermissionSettings(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  const settings = parseCommunityMeta(value)?.familyMemberSettings?.[memberId]
  return {
    allowChildOwnMediaEdits: Boolean(settings?.allowChildOwnMediaEdits),
    allowChildOwnUsernameEdits: settings?.allowChildOwnUsernameEdits == null ? true : Boolean(settings.allowChildOwnUsernameEdits),
    allowChildAudioCalls: settings?.allowChildAudioCalls == null ? true : Boolean(settings.allowChildAudioCalls),
    allowChildVideoCalls: settings?.allowChildVideoCalls == null ? true : Boolean(settings.allowChildVideoCalls),
    notifyParentOnMediaChanges: Boolean(settings?.notifyParentOnMediaChanges),
  }
}

export function getLegacyFamilyMemberStoredUsername(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  const settings = parseCommunityMeta(value)?.familyMemberSettings?.[memberId]
  return typeof settings?.username === 'string' && settings.username.trim() ? settings.username.trim() : null
}

export function getLegacyFamilyMemberStoredProfileMedia(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  const settings = parseCommunityMeta(value)?.familyMemberSettings?.[memberId]
  return {
    avatarUrl: typeof settings?.avatarUrl === 'string' ? settings.avatarUrl : null,
    coverUrl: typeof settings?.coverUrl === 'string' ? settings.coverUrl : null,
  }
}

export function writeLegacyFamilyMemberPermissionSettings(
  baseMeta: Record<string, unknown>,
  memberId: string,
  settings: {
    allowChildOwnMediaEdits: boolean
    allowChildOwnUsernameEdits: boolean
    allowChildAudioCalls: boolean
    allowChildVideoCalls: boolean
    notifyParentOnMediaChanges: boolean
  },
) {
  const existingValue =
    baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
      ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
      : {}

  const existingSettings =
    existingValue[memberId] && typeof existingValue[memberId] === 'object' && !Array.isArray(existingValue[memberId])
      ? { ...(existingValue[memberId] as Record<string, unknown>) }
      : {}

  existingValue[memberId] = {
    ...existingSettings,
    allowChildOwnMediaEdits: settings.allowChildOwnMediaEdits,
    allowChildOwnUsernameEdits: settings.allowChildOwnUsernameEdits,
    allowChildAudioCalls: settings.allowChildAudioCalls,
    allowChildVideoCalls: settings.allowChildVideoCalls,
    notifyParentOnMediaChanges: settings.notifyParentOnMediaChanges,
  }

  baseMeta.familyMemberSettings = existingValue
}

export function writeLegacyFamilyMemberUsername(
  baseMeta: Record<string, unknown>,
  memberId: string,
  username: string,
) {
  const existingValue =
    baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
      ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
      : {}

  const existingSettings =
    existingValue[memberId] && typeof existingValue[memberId] === 'object' && !Array.isArray(existingValue[memberId])
      ? { ...(existingValue[memberId] as Record<string, unknown>) }
      : {}

  existingValue[memberId] = {
    ...existingSettings,
    username,
  }

  baseMeta.familyMemberSettings = existingValue
}

export function writeLegacyFamilyMemberProfileMedia(
  baseMeta: Record<string, unknown>,
  memberId: string,
  media: {
    avatarUrl?: string | null
    coverUrl?: string | null
  },
) {
  const existingValue =
    baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
      ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
      : {}

  const existingSettings =
    existingValue[memberId] && typeof existingValue[memberId] === 'object' && !Array.isArray(existingValue[memberId])
      ? { ...(existingValue[memberId] as Record<string, unknown>) }
      : {}

  existingValue[memberId] = {
    ...existingSettings,
    ...(media.avatarUrl !== undefined ? { avatarUrl: media.avatarUrl } : {}),
    ...(media.coverUrl !== undefined ? { coverUrl: media.coverUrl } : {}),
  }

  baseMeta.familyMemberSettings = existingValue
}

export function getStoredFamilyFriendRequests(value: Prisma.JsonValue | null | undefined): FamilyFriendRequestRecord[] {
  return parseCommunityMeta(value)?.familyFriendRequests ?? []
}

export function getStoredFamilyFriendships(value: Prisma.JsonValue | null | undefined): FamilyFriendshipRecord[] {
  return parseCommunityMeta(value)?.familyFriendships ?? []
}

export function getStoredFamilyMessageThreads(value: Prisma.JsonValue | null | undefined): FamilyMessageThreadRecord[] {
  return parseCommunityMeta(value)?.familyMessageThreads ?? []
}

export function getStoredFamilyParentConversations(value: Prisma.JsonValue | null | undefined): FamilyParentConversationRecord[] {
  return parseCommunityMeta(value)?.familyParentConversations ?? []
}

export function getStoredProfileFamilyRelationships(value: Prisma.JsonValue | null | undefined): ProfileFamilyRelationshipRecord[] {
  return parseCommunityMeta(value)?.profileFamilyRelationships ?? []
}

export function hasStoredProfileFamilyRelationshipWithUser(
  value: Prisma.JsonValue | null | undefined,
  relatedUserId: string,
) {
  return getStoredProfileFamilyRelationships(value).some((entry) => entry.relatedUserId === relatedUserId)
}

export function writeStoredFamilyFriendRequests(baseMeta: Record<string, unknown>, requests: FamilyFriendRequestRecord[]) {
  baseMeta.familyFriendRequests = requests as unknown as Prisma.InputJsonValue
}

export function writeStoredFamilyFriendships(baseMeta: Record<string, unknown>, friendships: FamilyFriendshipRecord[]) {
  baseMeta.familyFriendships = friendships as unknown as Prisma.InputJsonValue
}

export function writeStoredFamilyMessageThreads(baseMeta: Record<string, unknown>, threads: FamilyMessageThreadRecord[]) {
  baseMeta.familyMessageThreads = threads as unknown as Prisma.InputJsonValue
}

export function writeStoredFamilyParentConversations(baseMeta: Record<string, unknown>, conversations: FamilyParentConversationRecord[]) {
  baseMeta.familyParentConversations = conversations as unknown as Prisma.InputJsonValue
}

export function writeStoredProfileFamilyRelationships(baseMeta: Record<string, unknown>, relationships: ProfileFamilyRelationshipRecord[]) {
  baseMeta.profileFamilyRelationships = relationships as unknown as Prisma.InputJsonValue
}

export function upsertFamilyFriendRequest(requests: FamilyFriendRequestRecord[], nextRequest: FamilyFriendRequestRecord) {
  const remaining = requests.filter((request) => request.id !== nextRequest.id)
  return [nextRequest, ...remaining].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function upsertFamilyFriendship(friendships: FamilyFriendshipRecord[], nextFriendship: FamilyFriendshipRecord) {
  const remaining = friendships.filter((friendship) => friendship.peerMemberId !== nextFriendship.peerMemberId || friendship.memberId !== nextFriendship.memberId)
  return [nextFriendship, ...remaining].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function upsertFamilyMessageThread(threads: FamilyMessageThreadRecord[], nextThread: FamilyMessageThreadRecord) {
  const remaining = threads.filter((thread) => !(thread.memberId === nextThread.memberId && thread.threadId === nextThread.threadId))
  return [nextThread, ...remaining].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function upsertFamilyParentConversation(
  conversations: FamilyParentConversationRecord[],
  nextConversation: FamilyParentConversationRecord,
) {
  const remaining = conversations.filter(
    (conversation) => !(conversation.memberId === nextConversation.memberId && conversation.parentId === nextConversation.parentId),
  )
  return [nextConversation, ...remaining].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function upsertProfileFamilyRelationship(
  relationships: ProfileFamilyRelationshipRecord[],
  nextRelationship: ProfileFamilyRelationshipRecord,
) {
  const remaining = relationships.filter((relationship) => relationship.relatedUserId !== nextRelationship.relatedUserId)
  return [nextRelationship, ...remaining].sort((left, right) => {
    const leftKey = left.updatedAt ?? left.createdAt
    const rightKey = right.updatedAt ?? right.createdAt
    return rightKey.localeCompare(leftKey)
  })
}

export function findPendingFamilyFriendRequest(
  requests: FamilyFriendRequestRecord[],
  requesterMemberId: string,
  targetMemberId: string,
) {
  return requests.find(
    (request) =>
      request.status === 'pending' &&
      ((request.requesterMemberId === requesterMemberId && request.targetMemberId === targetMemberId) ||
        (request.requesterMemberId === targetMemberId && request.targetMemberId === requesterMemberId)),
  )
}

export function hasAcceptedFamilyFriendship(
  friendships: FamilyFriendshipRecord[],
  memberId: string,
  peerMemberId: string,
) {
  return friendships.some((friendship) => friendship.memberId === memberId && friendship.peerMemberId === peerMemberId)
}

export function getFamilyMessageThreadIdsForMember(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  return getStoredFamilyMessageThreads(value)
    .filter((thread) => thread.memberId === memberId)
    .map((thread) => thread.threadId)
}

export function hasFamilyMessageThreadForMember(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
  threadId: string,
) {
  return getStoredFamilyMessageThreads(value).some((thread) => thread.memberId === memberId && thread.threadId === threadId)
}

export function buildFamilyParentThreadId(parentId: string) {
  return `family-parent-${parentId}`
}

export function isFamilyParentThreadId(threadId: string) {
  return threadId.startsWith('family-parent-')
}

export function buildParentFamilyThreadId(memberId: string) {
  return `family-member-${memberId}`
}

export function isParentFamilyThreadId(threadId: string) {
  return threadId.startsWith('family-member-')
}

export function parseParentFamilyThreadId(threadId: string) {
  if (!isParentFamilyThreadId(threadId)) return null
  const memberId = threadId.slice('family-member-'.length).trim()
  return memberId || null
}

export function getFamilyParentConversation(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
  parentId: string,
) {
  return getStoredFamilyParentConversations(value).find(
    (conversation) => conversation.memberId === memberId && conversation.parentId === parentId,
  )
}
