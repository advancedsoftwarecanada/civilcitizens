import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { FriendshipStatus, Prisma } from '@prisma/client'
import type { FamilyFriendshipRecord, FamilyParentConversationRecord } from './familyMetaHelpers.js'

type FamilyAccessMember = {
  id: string
  parentId: string
  parent: {
    communityMeta: Prisma.JsonValue | null
  }
}

type FamilyViewerAuthContext =
  | { actor: 'user'; userId: string }
  | { actor: 'family_member'; member: FamilyAccessMember }

type FamilyConversationAccessDeps = {
  buildFamilyParentThreadId: (parentId: string) => string
  getFamilyParentConversation: (value: Prisma.JsonValue | null | undefined, memberId: string, parentId: string) => FamilyParentConversationRecord | null | undefined
  getStoredFamilyFriendships: (value: Prisma.JsonValue | null | undefined) => FamilyFriendshipRecord[]
  getStoredFamilyMessageThreads: (value: Prisma.JsonValue | null | undefined) => Array<{ memberId: string; threadId: string; peerUserId: string; createdAt: string; updatedAt: string }>
  getStoredFamilyParentConversations: (value: Prisma.JsonValue | null | undefined) => FamilyParentConversationRecord[]
  hasAcceptedFamilyFriendship: (
    friendships: FamilyFriendshipRecord[],
    memberId: string,
    peerMemberId: string,
  ) => boolean
  hasFamilyMessageThreadForMember: (value: Prisma.JsonValue | null | undefined, memberId: string, threadId: string) => boolean
  loadFamilyMemberAuthViewerById: (memberId: string, parentId?: string | null) => Promise<FamilyAccessMember | null>
  loadNormalizedFamilyMembersForParent: (parentId: string) => Promise<Array<{ id: string }>>
  readBaseCommunityMeta: (value: Prisma.JsonValue | null | undefined) => Record<string, unknown>
  upsertFamilyMessageThread: (
    threads: Array<{ memberId: string; threadId: string; peerUserId: string; createdAt: string; updatedAt: string }>,
    nextThread: { memberId: string; threadId: string; peerUserId: string; createdAt: string; updatedAt: string },
  ) => Array<{ memberId: string; threadId: string; peerUserId: string; createdAt: string; updatedAt: string }>
  upsertFamilyParentConversation: (
    conversations: FamilyParentConversationRecord[],
    nextConversation: FamilyParentConversationRecord,
  ) => FamilyParentConversationRecord[]
  writeStoredFamilyMessageThreads: (
    baseMeta: Record<string, unknown>,
    threads: Array<{ memberId: string; threadId: string; peerUserId: string; createdAt: string; updatedAt: string }>,
  ) => void
  writeStoredFamilyParentConversations: (
    baseMeta: Record<string, unknown>,
    conversations: FamilyParentConversationRecord[],
  ) => void
}

export function createFamilyConversationAccessHelpers(deps: FamilyConversationAccessDeps) {
  async function storeFamilyParentConversationMessage(args: {
    parentId: string
    memberId: string
    sender: 'child' | 'parent'
    body: string
    timestamp?: Date
  }) {
    const parent = await prisma.user.findUnique({
      where: { id: args.parentId },
      select: { communityMeta: true },
    })
    const baseMeta = deps.readBaseCommunityMeta(parent?.communityMeta ?? null)
    const conversations = deps.getStoredFamilyParentConversations(parent?.communityMeta)
    const existing = deps.getFamilyParentConversation(parent?.communityMeta, args.memberId, args.parentId)
    const now = args.timestamp ?? new Date()
    const isoTimestamp = now.toISOString()
    const nextConversation: FamilyParentConversationRecord = {
      memberId: args.memberId,
      parentId: args.parentId,
      createdAt: existing?.createdAt ?? isoTimestamp,
      updatedAt: isoTimestamp,
      childLastReadAt: args.sender === 'child' ? isoTimestamp : (existing?.childLastReadAt ?? null),
      parentLastReadAt: args.sender === 'parent' ? isoTimestamp : (existing?.parentLastReadAt ?? null),
      messages: [
        ...(existing?.messages ?? []),
        {
          id: randomUUID(),
          sender: args.sender,
          body: args.body,
          createdAt: isoTimestamp,
          updatedAt: isoTimestamp,
        },
      ],
    }

    deps.writeStoredFamilyParentConversations(
      baseMeta,
      deps.upsertFamilyParentConversation(conversations, nextConversation),
    )

    await prisma.user.update({
      where: { id: args.parentId },
      data: {
        communityMeta: baseMeta as Prisma.InputJsonValue,
      },
    })

    return nextConversation
  }

  async function markFamilyParentConversationRead(args: {
    parentId: string
    memberId: string
    actor: 'child' | 'parent'
    readAt?: Date
  }) {
    const parent = await prisma.user.findUnique({
      where: { id: args.parentId },
      select: { communityMeta: true },
    })
    const existing = deps.getFamilyParentConversation(parent?.communityMeta, args.memberId, args.parentId)
    if (!existing) return null
    const baseMeta = deps.readBaseCommunityMeta(parent?.communityMeta ?? null)
    const conversations = deps.getStoredFamilyParentConversations(parent?.communityMeta)
    const isoTimestamp = (args.readAt ?? new Date()).toISOString()
    const nextConversation: FamilyParentConversationRecord = {
      ...existing,
      updatedAt: existing.updatedAt,
      childLastReadAt: args.actor === 'child' ? isoTimestamp : existing.childLastReadAt ?? null,
      parentLastReadAt: args.actor === 'parent' ? isoTimestamp : existing.parentLastReadAt ?? null,
    }

    deps.writeStoredFamilyParentConversations(
      baseMeta,
      deps.upsertFamilyParentConversation(conversations, nextConversation),
    )

    await prisma.user.update({
      where: { id: args.parentId },
      data: {
        communityMeta: baseMeta as Prisma.InputJsonValue,
      },
    })

    return nextConversation
  }

  async function storeFamilyMessageThreadForMember(args: {
    parentId: string
    memberId: string
    threadId: string
    peerUserId: string
    timestamp?: Date
  }) {
    const parent = await prisma.user.findUnique({
      where: { id: args.parentId },
      select: { communityMeta: true },
    })
    const baseMeta = deps.readBaseCommunityMeta(parent?.communityMeta ?? null)
    const currentThreads = deps.getStoredFamilyMessageThreads(parent?.communityMeta)
    const isoTimestamp = (args.timestamp ?? new Date()).toISOString()
    const existing = currentThreads.find((thread) => thread.memberId === args.memberId && thread.threadId === args.threadId)

    deps.writeStoredFamilyMessageThreads(
      baseMeta,
      deps.upsertFamilyMessageThread(currentThreads, {
        memberId: args.memberId,
        threadId: args.threadId,
        peerUserId: args.peerUserId,
        createdAt: existing?.createdAt ?? isoTimestamp,
        updatedAt: isoTimestamp,
      }),
    )

    await prisma.user.update({
      where: { id: args.parentId },
      data: {
        communityMeta: baseMeta as Prisma.InputJsonValue,
      },
    })
  }

  function familyMemberCanAccessMessageThread(member: FamilyAccessMember, threadId: string) {
    if (threadId === deps.buildFamilyParentThreadId(member.parentId)) {
      return true
    }
    return deps.hasFamilyMessageThreadForMember(member.parent.communityMeta, member.id, threadId)
  }

  async function resolveFamilyFeedTargetMember(
    authContext: FamilyViewerAuthContext,
    requestedMemberId?: string | null,
  ) {
    if (authContext.actor === 'family_member') {
      return authContext.member
    }

    const memberId = requestedMemberId?.trim()
    if (!memberId) return null
    return deps.loadFamilyMemberAuthViewerById(memberId, authContext.userId)
  }

  async function resolveFamilyProfileAccess(
    authContext: FamilyViewerAuthContext | null,
    targetMember: FamilyAccessMember,
  ): Promise<'self' | 'family' | 'friend' | null> {
    if (!authContext) return null

    if (authContext.actor === 'user') {
      if (authContext.userId === targetMember.parentId) return 'family'

      const directParentFriendship = await prisma.friendship.findFirst({
        where: {
          status: FriendshipStatus.ACCEPTED,
          OR: [
            { requesterId: authContext.userId, addresseeId: targetMember.parentId },
            { requesterId: targetMember.parentId, addresseeId: authContext.userId },
          ],
        },
        select: { id: true },
      })
      if (directParentFriendship) return 'friend'

      const [viewerMembers, viewerUser] = await Promise.all([
        deps.loadNormalizedFamilyMembersForParent(authContext.userId),
        prisma.user.findUnique({ where: { id: authContext.userId }, select: { communityMeta: true } }),
      ])
      const viewerFriendships = deps.getStoredFamilyFriendships(viewerUser?.communityMeta)
      const targetFriendships = deps.getStoredFamilyFriendships(targetMember.parent.communityMeta)

      const hasDirectStoredParentLink =
        viewerFriendships.some(
          (friendship) => friendship.peerMemberId === targetMember.id && friendship.peerParentId === targetMember.parentId,
        ) ||
        targetFriendships.some(
          (friendship) => friendship.memberId === targetMember.id && friendship.peerParentId === authContext.userId,
        )

      if (hasDirectStoredParentLink) return 'friend'
      if (viewerMembers.length === 0) return null

      const hasFriendAccess = viewerMembers.some((member) => {
        return (
          deps.hasAcceptedFamilyFriendship(viewerFriendships, member.id, targetMember.id) ||
          deps.hasAcceptedFamilyFriendship(targetFriendships, targetMember.id, member.id)
        )
      })

      return hasFriendAccess ? 'friend' : null
    }

    if (authContext.member.id === targetMember.id) return 'self'
    if (authContext.member.parentId === targetMember.parentId) return 'family'

    const viewerFriendships = deps.getStoredFamilyFriendships(authContext.member.parent.communityMeta)
    if (deps.hasAcceptedFamilyFriendship(viewerFriendships, authContext.member.id, targetMember.id)) {
      return 'friend'
    }

    return null
  }

  async function resolveReadableFamilyFeedTargetMember(
    authContext: FamilyViewerAuthContext,
    requestedMemberId?: string | null,
  ) {
    const memberId = requestedMemberId?.trim()
    if (authContext.actor === 'family_member') {
      if (!memberId || memberId === authContext.member.id) return authContext.member
      const targetMember = await deps.loadFamilyMemberAuthViewerById(memberId)
      if (!targetMember) return null
      return (await resolveFamilyProfileAccess(authContext, targetMember)) ? targetMember : null
    }

    if (!memberId) return null
    const targetMember = await deps.loadFamilyMemberAuthViewerById(memberId)
    if (!targetMember) return null
    return (await resolveFamilyProfileAccess(authContext, targetMember)) ? targetMember : null
  }

  return {
    familyMemberCanAccessMessageThread,
    markFamilyParentConversationRead,
    resolveFamilyFeedTargetMember,
    resolveFamilyProfileAccess,
    resolveReadableFamilyFeedTargetMember,
    storeFamilyMessageThreadForMember,
    storeFamilyParentConversationMessage,
  }
}
