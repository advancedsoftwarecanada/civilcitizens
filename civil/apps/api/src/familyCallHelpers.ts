type FamilyCallRecord = {
  id: string
  memberId: string
  parentId: string
  roomId: string
  mode: 'audio' | 'video'
  status: 'ringing' | 'active' | 'ended'
  initiatorActor: 'parent' | 'child'
  createdAt: string
  updatedAt: string
  startedAt: string | null
  lastJoinedAt: string | null
  endedAt: string | null
}

type CreateFamilyCallHelpersDeps = {
  formatFriendUser: (user: any) => any
  formatNormalizedFamilyMemberThreadUser: (member: any) => any
  loadFamilyMemberAuthViewerById: (memberId: string, parentId?: string | null) => Promise<any>
  normalizeFamilyMemberSummary: (member: any) => any
  redis: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string, mode: 'PX', duration: number) => Promise<unknown>
    del: (key: string) => Promise<unknown>
  }
}

const FAMILY_CALL_KEY_PREFIX = 'family:call:'
const FAMILY_CALL_MEMBER_KEY_PREFIX = 'family:call:member:'
const FAMILY_CALL_TTL_MS = 1000 * 60 * 60 * 12

export function createFamilyCallHelpers(deps: CreateFamilyCallHelpersDeps) {
  function buildFamilyCallKey(callId: string) {
    return `${FAMILY_CALL_KEY_PREFIX}${callId}`
  }

  function buildFamilyCallMemberKey(memberId: string) {
    return `${FAMILY_CALL_MEMBER_KEY_PREFIX}${memberId}`
  }

  function isFamilyCallRecord(value: unknown): value is FamilyCallRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (
      typeof record.id === 'string' &&
      typeof record.memberId === 'string' &&
      typeof record.parentId === 'string' &&
      typeof record.roomId === 'string' &&
      (record.mode === 'audio' || record.mode === 'video') &&
      (record.status === 'ringing' || record.status === 'active' || record.status === 'ended') &&
      (record.initiatorActor === 'parent' || record.initiatorActor === 'child') &&
      typeof record.createdAt === 'string' &&
      typeof record.updatedAt === 'string'
    )
  }

  async function loadFamilyCallRecord(callId: string) {
    const raw = await deps.redis.get(buildFamilyCallKey(callId))
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as unknown
      return isFamilyCallRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  async function writeFamilyCallRecord(record: FamilyCallRecord) {
    await deps.redis.set(buildFamilyCallKey(record.id), JSON.stringify(record), 'PX', FAMILY_CALL_TTL_MS)
    if (record.status === 'ended') {
      const memberKey = buildFamilyCallMemberKey(record.memberId)
      const current = await deps.redis.get(memberKey)
      if (current === record.id) {
        await deps.redis.del(memberKey)
      }
      return
    }
    await deps.redis.set(buildFamilyCallMemberKey(record.memberId), record.id, 'PX', FAMILY_CALL_TTL_MS)
  }

  async function loadFamilyCallForMember(memberId: string) {
    const callId = await deps.redis.get(buildFamilyCallMemberKey(memberId))
    if (!callId) return null
    const record = await loadFamilyCallRecord(callId)
    if (!record || record.status === 'ended') {
      await deps.redis.del(buildFamilyCallMemberKey(memberId))
      return null
    }
    return record
  }

  function buildFamilyRtcUserId(memberId: string) {
    return `family-member:${memberId}`
  }

  function formatFamilyCallSummary(args: {
    call: FamilyCallRecord
    member: any
    viewerRole: 'parent' | 'child'
  }) {
    const memberSummary = deps.normalizeFamilyMemberSummary(args.member)
    const parentUser = deps.formatFriendUser(args.member.parent)
    const childUser = deps.formatNormalizedFamilyMemberThreadUser(memberSummary)
    const initiator = args.call.initiatorActor === 'parent' ? parentUser : childUser
    const counterpart = args.viewerRole === 'parent' ? childUser : parentUser
    const viewerRtcUserId =
      args.viewerRole === 'parent' ? args.member.parentId : buildFamilyRtcUserId(args.member.id)
    return {
      member: {
        id: memberSummary.id,
        displayName: memberSummary.displayName,
        username: memberSummary.username,
        avatarUrl: memberSummary.avatarUrl,
        relationshipLabel: memberSummary.relationshipLabel,
        modeBand: memberSummary.modeBand,
        modeLabel: memberSummary.modeLabel,
      },
      parent: parentUser,
      viewerRole: args.viewerRole,
      counterpart,
      call: {
        id: args.call.id,
        memberId: args.call.memberId,
        parentId: args.call.parentId,
        roomId: args.call.roomId,
        mode: args.call.mode,
        status: args.call.status,
        createdAt: args.call.createdAt,
        updatedAt: args.call.updatedAt,
        startedAt: args.call.startedAt,
        lastJoinedAt: args.call.lastJoinedAt,
        endedAt: args.call.endedAt,
        initiatorActor: args.call.initiatorActor,
        initiator,
        isInitiator:
          (args.call.initiatorActor === 'parent' && args.viewerRole === 'parent') ||
          (args.call.initiatorActor === 'child' && args.viewerRole === 'child'),
        viewerRtcUserId,
      },
    }
  }

  async function loadFamilyCallContext(
    authContext: { actor: 'user'; userId: string } | { actor: 'family_member'; member: any },
    memberId: string,
  ) {
    const targetMember =
      authContext.actor === 'family_member'
        ? authContext.member.id === memberId
          ? authContext.member
          : null
        : await deps.loadFamilyMemberAuthViewerById(memberId, authContext.userId)

    if (!targetMember) return null

    return {
      member: targetMember,
      viewerRole: authContext.actor === 'family_member' ? ('child' as const) : ('parent' as const),
    }
  }

  return {
    buildFamilyRtcUserId,
    formatFamilyCallSummary,
    loadFamilyCallContext,
    loadFamilyCallForMember,
    loadFamilyCallRecord,
    writeFamilyCallRecord,
  }
}
