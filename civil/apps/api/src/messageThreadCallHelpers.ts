import { prisma } from '@civil/db'
import { FriendshipStatus, MessageCallStatus, MessageType, MessageThreadType, Prisma } from '@prisma/client'

type CreateMessageThreadCallHelpersDeps = {
  dispatchRealtimeEvent: (userId: string, payload: { type: string; data: unknown }) => Promise<void>
  formatFriendUser: (user: any) => any
  formatMessage: (record: any, viewerId: string) => any
  formatThreadParticipant: (participant: any, viewerId: string) => any
  friendUserSelect: any
  isConnectionTableMissingError: (error: unknown) => boolean
  loadAcceptedFriendIds: (userId: string) => Promise<string[]>
  messageCallSelect: any
  messageSelect: any
  threadSummaryInclude: any
  threadWithParticipantsInclude: any
}

const MESSAGE_CALL_RING_TTL_MS = 30 * 1000
const MESSAGE_CALL_IDLE_TTL_MS = 15 * 60 * 1000
const messageCallTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

export function createMessageThreadCallHelpers(deps: CreateMessageThreadCallHelpersDeps) {
  function clearScheduledMessageCallTimeout(callId: string) {
    const timer = messageCallTimeouts.get(callId)
    if (!timer) return
    clearTimeout(timer)
    messageCallTimeouts.delete(callId)
  }

  function isMessageCallLive(call: any): boolean {
    if (!call || call.endedAt) return false
    const now = Date.now()
    if (call.status === MessageCallStatus.ringing) {
      return now - call.createdAt.getTime() <= MESSAGE_CALL_RING_TTL_MS
    }
    const activityAt = call.lastJoinedAt ?? call.startedAt ?? call.createdAt
    return now - activityAt.getTime() <= MESSAGE_CALL_IDLE_TTL_MS
  }

  function formatMessageCall(call: any, viewerId: string) {
    return {
      id: call.id,
      threadId: call.threadId,
      initiatorId: call.initiatorId,
      endedByUserId: call.endedByUserId ?? null,
      roomId: call.roomId,
      mode: call.mode,
      status: call.status,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      startedAt: call.startedAt ?? null,
      lastJoinedAt: call.lastJoinedAt ?? null,
      endedAt: call.endedAt ?? null,
      initiator: deps.formatFriendUser(call.initiator),
      isInitiator: call.initiatorId === viewerId,
    }
  }

  function formatThreadBase(thread: any, viewerId: string) {
    const activeCall = thread.calls.find((call: any) => isMessageCallLive(call)) ?? null
    return {
      id: thread.id,
      type: thread.type,
      contextType: thread.contextType ?? null,
      contextId: thread.contextId ?? null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
      participants: thread.participants.map((participant: any) => deps.formatThreadParticipant(participant, viewerId)),
      activeCall: activeCall ? formatMessageCall(activeCall, viewerId) : null,
    }
  }

  function formatThreadSummaryRecord(thread: any, viewerId: string, options?: { unreadCount?: number }) {
    const base = formatThreadBase(thread, viewerId)
    const lastMessage = thread.messages[0] ? deps.formatMessage(thread.messages[0], viewerId) : null
    const unreadCount = Math.max(0, Number(options?.unreadCount ?? 0) || 0)
    return {
      ...base,
      lastMessage,
      unreadCount,
      unread: unreadCount > 0,
    }
  }

  function buildDirectThreadKey(userA: string, userB: string): string {
    const [first, second] = [userA, userB].sort()
    return `direct:${first}:${second}`
  }

  function buildFamilyDirectThreadKey(parentUserId: string, targetUserId: string, memberId: string): string {
    const [first, second] = [parentUserId, targetUserId].sort()
    return `direct:${first}:${second}:family:${memberId}`
  }

  function buildGroupThreadKey(userIds: string[]): string {
    return `group:${[...new Set(userIds)].sort().join(':')}`
  }

  function buildMessageCallEndedBody(args: { reason: 'hangup' | 'no_answer'; actorName: string | null }): string {
    if (args.reason === 'no_answer') return 'No answer.'
    if (args.actorName) return `${args.actorName} hung up.`
    return 'Call ended.'
  }

  function buildMessageCallSystemMeta(args: {
    call: Pick<any, 'id' | 'threadId' | 'mode'>
    reason: 'hangup' | 'no_answer'
    actorUserId: string | null
    actorName: string | null
  }) {
    return {
      kind: 'call_ended' as const,
      reason: args.reason,
      mode: args.call.mode,
      callId: args.call.id,
      callbackThreadId: args.call.threadId,
      callbackLabel: 'Call Back' as const,
      actorUserId: args.actorUserId,
      actorName: args.actorName,
    }
  }

  async function expireMessageCallIfStale(call: any, endedByUserId?: string | null) {
    if (!call || !call.id || isMessageCallLive(call)) return false
    clearScheduledMessageCallTimeout(call.id)
    await prisma.messageCall.updateMany({
      where: { id: call.id, endedAt: null },
      data: {
        status: MessageCallStatus.ended,
        endedAt: new Date(),
        ...(endedByUserId ? { endedByUserId } : {}),
      },
    })
    return true
  }

  async function findExistingExactThreadId(participantIds: string[]): Promise<string | null> {
    const normalized = [...new Set(participantIds)].sort()
    if (normalized.length < 2) return null
    if (normalized.length === 2) {
      const existing = await prisma.messageThread.findUnique({
        where: { uniqueKey: buildDirectThreadKey(normalized[0]!, normalized[1]!) },
        select: { id: true },
      })
      return existing?.id ?? null
    }

    const uniqueKey = buildGroupThreadKey(normalized)
    const byKey = await prisma.messageThread.findUnique({
      where: { uniqueKey },
      select: { id: true },
    })
    if (byKey?.id) return byKey.id

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT t."id", t."uniqueKey"
      FROM "MessageThread" t
      JOIN "MessageParticipant" mp ON mp."threadId" = t."id"
      WHERE t."type" = 'group'
        AND t."contextType" IS NULL
      GROUP BY t."id", t."uniqueKey"
      HAVING COUNT(*)::int = ${normalized.length}
        AND COUNT(*) FILTER (WHERE mp."userId" IN (${Prisma.join(normalized)}))::int = ${normalized.length}
      ORDER BY MAX(t."updatedAt") DESC
      LIMIT 1
    `)) as Array<{ id: string; uniqueKey: string | null }>

    const existing = rows[0]
    if (!existing?.id) return null
    if (!existing.uniqueKey) {
      await prisma.messageThread
        .update({
          where: { id: existing.id },
          data: { uniqueKey },
        })
        .catch(() => undefined)
    }
    return existing.id
  }

  async function usersAreFriends(userId: string, targetUserId: string): Promise<boolean> {
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: targetUserId },
          { requesterId: targetUserId, addresseeId: userId },
        ],
      },
      select: { id: true },
    })
    return Boolean(friendship)
  }

  async function usersAreAcceptedConnections(userId: string, targetUserId: string): Promise<boolean> {
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Connection"
        WHERE "status" = 'ACCEPTED'
          AND (
            ("requesterId" = ${userId} AND "addresseeId" = ${targetUserId})
            OR
            ("requesterId" = ${targetUserId} AND "addresseeId" = ${userId})
          )
        LIMIT 1
      `
      return rows.length > 0
    } catch (error) {
      if (deps.isConnectionTableMissingError(error)) return false
      throw error
    }
  }

  async function loadFriendIdSet(userId: string): Promise<Set<string>> {
    const ids = await deps.loadAcceptedFriendIds(userId)
    return new Set(ids)
  }

  async function loadThreadForUser(threadId: string, userId: string) {
    return prisma.messageThread.findFirst({
      where: {
        id: threadId,
        participants: {
          some: { userId },
        },
      },
      include: deps.threadWithParticipantsInclude,
    })
  }

  async function loadCallableMessageThreadForUser(threadId: string, userId: string) {
    return prisma.messageThread.findFirst({
      where: {
        id: threadId,
        type: { in: [MessageThreadType.direct, MessageThreadType.group] },
        contextType: null,
        participants: {
          some: { userId },
        },
      },
      include: deps.threadWithParticipantsInclude,
    })
  }

  async function loadLatestThreadCall(threadId: string) {
    const call = await prisma.messageCall.findFirst({
      where: {
        threadId,
        endedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: deps.messageCallSelect,
    })
    return call ?? null
  }

  async function loadLiveThreadCall(threadId: string, options?: { expireStale?: boolean; endedByUserId?: string | null }) {
    const latest = await loadLatestThreadCall(threadId)
    if (!latest) return null
    if (isMessageCallLive(latest)) {
      if (latest.status === MessageCallStatus.ringing) {
        scheduleMessageCallTimeout(latest)
      }
      return latest
    }
    if (options?.expireStale) {
      if (latest.status === MessageCallStatus.ringing) {
        await finalizeMessageCall({
          callId: latest.id,
          endedByUserId: options.endedByUserId ?? null,
          reason: 'no_answer',
        })
      } else {
        await expireMessageCallIfStale(latest, options.endedByUserId)
      }
    }
    return null
  }

  async function loadMessageCallForUser(callId: string, userId: string) {
    const call = await prisma.messageCall.findFirst({
      where: {
        id: callId,
        thread: {
          contextType: null,
          participants: {
            some: { userId },
          },
        },
      },
      select: deps.messageCallSelect,
    })
    return call ?? null
  }

  async function finalizeMessageCall(args: { callId: string; endedByUserId?: string | null; reason: 'hangup' | 'no_answer' | 'expired' }) {
    clearScheduledMessageCallTimeout(args.callId)

    const call = await prisma.messageCall.findUnique({
      where: { id: args.callId },
      select: {
        ...deps.messageCallSelect,
        thread: {
          include: deps.threadSummaryInclude,
        },
      },
    })
    if (!call) return null

    const actorUserId = args.endedByUserId ?? (args.reason === 'no_answer' ? call.initiatorId : null)
    const actorRecord =
      actorUserId && actorUserId !== call.initiatorId
        ? await prisma.user.findUnique({ where: { id: actorUserId }, select: deps.friendUserSelect })
        : null
    const actor = actorRecord ? deps.formatFriendUser(actorRecord) : deps.formatFriendUser(call.initiator)
    const actorName = actor?.name?.trim() || actor?.handle || null
    const shouldCreateSystemMessage = args.reason === 'hangup' || args.reason === 'no_answer'

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const endedAt = new Date()
      const updated = await tx.messageCall.updateMany({
        where: { id: call.id, endedAt: null },
        data: {
          status: MessageCallStatus.ended,
          endedAt,
          ...(args.endedByUserId ? { endedByUserId: args.endedByUserId } : {}),
        },
      })
      if (updated.count === 0) return null

      let systemMessage: any | null = null
      if (shouldCreateSystemMessage && actorUserId) {
        systemMessage = await tx.message.create({
          data: {
            threadId: call.threadId,
            senderId: actorUserId,
            body: buildMessageCallEndedBody({
              reason: args.reason === 'no_answer' ? 'no_answer' : 'hangup',
              actorName,
            }),
            attachments: buildMessageCallSystemMeta({
              call,
              reason: args.reason === 'no_answer' ? 'no_answer' : 'hangup',
              actorUserId,
              actorName,
            }) as Prisma.InputJsonValue,
            messageType: MessageType.system,
          },
          select: deps.messageSelect,
        })

        await tx.messageThread.update({
          where: { id: call.threadId },
          data: { lastMessageAt: systemMessage.createdAt },
        })

        await tx.messageParticipant.updateMany({
          where: { threadId: call.threadId, userId: actorUserId },
          data: {
            lastActivityAt: systemMessage.createdAt,
            lastReadAt: systemMessage.createdAt,
          },
        })

        await tx.messageParticipant.updateMany({
          where: { threadId: call.threadId, userId: { not: actorUserId } },
          data: { lastActivityAt: systemMessage.createdAt },
        })
      }

      const thread = await tx.messageThread.findUnique({
        where: { id: call.threadId },
        include: deps.threadSummaryInclude,
      })
      return {
        thread,
        systemMessage,
      }
    })

    if (!result?.thread) return null

    await Promise.all(
      result.thread.participants.map((participant: any) =>
        Promise.allSettled([
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: formatThreadSummaryRecord(result.thread!, participant.userId) },
          }),
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'message.call.ended',
            data: {
              threadId: call.threadId,
              callId: call.id,
              reason: args.reason,
            },
          }),
          result.systemMessage
            ? deps.dispatchRealtimeEvent(participant.userId, {
                type: 'message.created',
                data: {
                  threadId: call.threadId,
                  message: deps.formatMessage(result.systemMessage, participant.userId),
                },
              })
            : Promise.resolve(),
        ]),
      ),
    )

    return {
      thread: result.thread,
      systemMessage: result.systemMessage,
    }
  }

  function scheduleMessageCallTimeout(call: Pick<any, 'id' | 'createdAt'>) {
    clearScheduledMessageCallTimeout(call.id)
    const elapsedMs = Date.now() - call.createdAt.getTime()
    const delayMs = Math.max(0, MESSAGE_CALL_RING_TTL_MS - elapsedMs)
    const timer = setTimeout(() => {
      void finalizeMessageCall({
        callId: call.id,
        reason: 'no_answer',
      }).catch((error) => {
        console.error('message_call_timeout_finalize_failed', error)
      })
    }, delayMs)
    messageCallTimeouts.set(call.id, timer)
  }

  return {
    buildDirectThreadKey,
    buildFamilyDirectThreadKey,
    buildGroupThreadKey,
    buildMessageCallEndedBody,
    buildMessageCallSystemMeta,
    clearScheduledMessageCallTimeout,
    expireMessageCallIfStale,
    findExistingExactThreadId,
    formatMessageCall,
    formatThreadBase,
    formatThreadSummaryRecord,
    isMessageCallLive,
    loadCallableMessageThreadForUser,
    loadFriendIdSet,
    loadLatestThreadCall,
    loadLiveThreadCall,
    loadMessageCallForUser,
    loadThreadForUser,
    scheduleMessageCallTimeout,
    usersAreAcceptedConnections,
    usersAreFriends,
    finalizeMessageCall,
  }
}
