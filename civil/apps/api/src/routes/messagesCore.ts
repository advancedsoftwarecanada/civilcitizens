import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import {
  MessageCallMode,
  MessageCallStatus,
  MessageParticipantRole,
  MessageThreadType,
  Prisma,
} from '@prisma/client'
import {
  CreateDirectThreadInput,
  CreateGroupThreadInput,
  MessageCallRtcSessionInput,
  MessageThreadListQuery,
  ResolveGroupThreadInput,
  StartMessageCallInput,
} from '@civil/shared'
import { z } from 'zod'

const MessageThreadIdParam = z.object({ id: z.string().min(1) })
const MessageLinkPreviewQuery = z.object({ url: z.string().trim().min(1) })
const MessageCallIdParam = z.object({ id: z.string().cuid() })

type MessageCoreDeps = Record<string, any>

export function registerMessagesCoreRoutes(app: FastifyInstance, deps: MessageCoreDeps) {
  app.get('/messages/threads', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

      const parse = MessageThreadListQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { limit, cursor } = parse.data
      const allowedThreadIds =
        authContext.actor === 'family_member'
          ? deps.getFamilyMessageThreadIdsForMember(authContext.member.parent.communityMeta, authContext.member.id)
          : null
      const parentFamilyThreads = authContext.actor === 'user' ? await deps.loadParentFamilyConversationThreads(authContext.userId) : []
      const familyParentThread =
        authContext.actor === 'family_member'
          ? deps.buildFamilyParentConversationThread(
              authContext.member,
              deps.getFamilyParentConversation(
                authContext.member.parent.communityMeta,
                authContext.member.id,
                authContext.member.parentId,
              ) ?? null,
            )
          : null

      const rows = await prisma.messageThread.findMany({
        where: {
          participants: { some: { userId } },
          ...(allowedThreadIds ? { id: { in: allowedThreadIds } } : {}),
          OR: [{ contextType: null }, { contextType: { not: 'market_listing' } }],
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: deps.THREAD_SUMMARY_INCLUDE,
      }) as any[]

      let nextCursor: string | undefined
      if (rows.length > limit) {
        const next = rows.pop()!
        nextCursor = next.id
      }

      const threadIds = rows.map((thread) => thread.id)
      const unreadRows = threadIds.length
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT m."threadId" as "threadId", COUNT(*)::int as "count"
            FROM "Message" m
            JOIN "MessageParticipant" mp ON mp."threadId" = m."threadId"
            WHERE mp."userId" = ${userId}
              AND m."threadId" IN (${Prisma.join(threadIds)})
              AND m."senderId" <> ${userId}
              AND m."deletedAt" IS NULL
              AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
            GROUP BY m."threadId"
          `)) as Array<{ threadId: string; count: number }>)
        : []
      const unreadCountByThreadId = new Map(unreadRows.map((row) => [row.threadId, Number(row.count) || 0]))

      const items = rows.map((thread) =>
        deps.formatThreadSummaryRecord(thread, userId, {
          unreadCount: unreadCountByThreadId.get(thread.id) ?? 0,
        }),
      )

      const combinedItems = familyParentThread
        ? [familyParentThread, ...parentFamilyThreads, ...items.filter((thread) => thread.id !== familyParentThread.id)]
            .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
            .slice(0, limit)
        : parentFamilyThreads.length
          ? [...parentFamilyThreads, ...items]
              .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
              .slice(0, limit)
          : items

      return reply.send({
        items: combinedItems,
        nextCursor,
      })
    }),
  )

  app.get('/messages/link-preview', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = MessageLinkPreviewQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const normalizedPath = deps.normalizeMessageLinkPath(query.data.url)
      if (!normalizedPath) return reply.send({ preview: null })

      try {
        const preview = await deps.resolveMessageLinkPreview(normalizedPath, userId)
        return reply.send({ preview: preview ?? null })
      } catch (error) {
        req.log.warn({ err: error, userId, url: query.data.url }, 'message_link_preview_failed')
        return reply.send({ preview: null })
      }
    }),
  )

  app.get('/link-preview', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = await deps.resolveUserId(req)

      const query = MessageLinkPreviewQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const normalizedPath = deps.normalizeMessageLinkPath(query.data.url)
      if (!normalizedPath) return reply.send({ preview: null })

      try {
        const preview = await deps.resolveMessageLinkPreview(normalizedPath, userId)
        return reply.send({ preview: preview ?? null })
      } catch (error) {
        req.log.warn({ err: error, userId: userId ?? null, url: query.data.url }, 'public_link_preview_failed')
        return reply.send({ preview: null })
      }
    }),
  )

  app.post('/messages/threads/direct', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

      const parse = CreateDirectThreadInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const targetUserId = parse.data.userId
      if (targetUserId === userId) return reply.code(400).send({ error: 'cannot_message_self' })

      const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
      if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

      const [friendStatus, connectionStatus, familyStatus] = await Promise.all([
        deps.usersAreFriends(userId, targetUserId),
        deps.usersAreAcceptedConnections(userId, targetUserId),
        deps.canViewerAccessFamilyAudiencePost({ viewerId: userId, authorId: targetUserId }),
      ])
      if (!friendStatus && !connectionStatus && !familyStatus) return reply.code(403).send({ error: 'not_friends' })

      const existingFamilyThread =
        authContext.actor === 'family_member'
          ? deps
              .getStoredFamilyMessageThreads(authContext.member.parent.communityMeta)
              .find((thread: any) => thread.memberId === authContext.member.id && thread.peerUserId === targetUserId)
          : null

      const uniqueKey =
        authContext.actor === 'family_member'
          ? deps.buildFamilyDirectThreadKey(userId, targetUserId, authContext.member.id)
          : deps.buildDirectThreadKey(userId, targetUserId)

      let thread = existingFamilyThread
        ? await prisma.messageThread.findFirst({
            where: {
              id: existingFamilyThread.threadId,
              participants: { some: { userId } },
              OR: [{ contextType: null }, { contextType: { not: 'market_listing' } }],
            },
            include: deps.THREAD_SUMMARY_INCLUDE,
          })
        : null

      if (!thread) {
        thread = await prisma.messageThread.findUnique({ where: { uniqueKey }, include: deps.THREAD_SUMMARY_INCLUDE })
      }

      if (!thread) {
        const now = new Date()
        thread = await prisma.messageThread.create({
          data: {
            type: MessageThreadType.direct,
            uniqueKey,
            lastMessageAt: now,
            participants: {
              create: [
                { userId, role: MessageParticipantRole.member, lastReadAt: now, lastActivityAt: now },
                { userId: targetUserId, role: MessageParticipantRole.member, lastActivityAt: now },
              ],
            },
          },
          include: deps.THREAD_SUMMARY_INCLUDE,
        })
      } else {
        const now = new Date()
        const participantIds = new Set(thread.participants.map((participant: any) => participant.userId))
        const missingParticipantIds = [userId, targetUserId].filter((id) => !participantIds.has(id))

        if (missingParticipantIds.length > 0 || thread.type !== MessageThreadType.direct) {
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            if (thread && thread.type !== MessageThreadType.direct) {
              await tx.messageThread.update({
                where: { id: thread.id },
                data: { type: MessageThreadType.direct },
              })
            }

            for (const participantUserId of missingParticipantIds) {
              await tx.messageParticipant.create({
                data: {
                  threadId: thread.id,
                  userId: participantUserId,
                  role: MessageParticipantRole.member,
                  lastActivityAt: now,
                  ...(participantUserId === userId ? { lastReadAt: now } : {}),
                },
              })
            }
          })

          thread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
        }
      }

      if (!thread) return reply.code(500).send({ error: 'thread_creation_failed' })

      if (authContext.actor === 'family_member') {
        await deps.storeFamilyMessageThreadForMember({
          parentId: authContext.member.parentId,
          memberId: authContext.member.id,
          threadId: thread.id,
          peerUserId: targetUserId,
          timestamp: thread.lastMessageAt ?? thread.updatedAt,
        })
      }

      await Promise.all(
        thread.participants
          .filter((participant: any) => participant.userId !== userId)
          .map((participant: any) =>
            deps.dispatchRealtimeEvent(participant.userId, {
              type: 'thread.created',
              data: { thread: deps.formatThreadSummaryRecord(thread, participant.userId) },
            }),
          ),
      )

      return reply.send({ thread: deps.formatThreadSummaryRecord(thread, userId) })
    }),
  )

  app.post('/messages/threads/group', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = CreateGroupThreadInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const participantIds = Array.from(new Set((parse.data.participantIds as string[]).filter((id: string) => id !== userId)))
      if (participantIds.length < 2) return reply.code(400).send({ error: 'group_requires_at_least_two_friends' })

      const friendIdSet = await deps.loadFriendIdSet(userId)
      if (participantIds.some((id: string) => !friendIdSet.has(id))) {
        return reply.code(403).send({ error: 'group_members_must_be_friends' })
      }

      const users = await prisma.user.findMany({ where: { id: { in: participantIds } }, select: { id: true } })
      const userIdSet = new Set(users.map((row: { id: string }) => row.id))
      if (participantIds.some((id: string) => !userIdSet.has(id))) return reply.code(404).send({ error: 'user_not_found' })

      const now = new Date()
      const thread = await prisma.messageThread.create({
        data: {
          type: MessageThreadType.group,
          uniqueKey: null,
          lastMessageAt: now,
          participants: {
            create: [
              { userId, role: MessageParticipantRole.admin, lastReadAt: now, lastActivityAt: now },
              ...participantIds.map((id: string) => ({ userId: id, role: MessageParticipantRole.member, lastActivityAt: now })),
            ],
          },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
      })

      await Promise.all(
        thread.participants
          .filter((participant: any) => participant.userId !== userId)
          .map((participant: any) =>
            deps.dispatchRealtimeEvent(participant.userId, {
              type: 'thread.created',
              data: { thread: deps.formatThreadSummaryRecord(thread, participant.userId) },
            }),
          ),
      )

      return reply.code(201).send({ thread: deps.formatThreadSummaryRecord(thread, userId) })
    }),
  )

  app.post('/messages/threads/:id/resolve-group', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const parse = ResolveGroupThreadInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const sourceThread = await deps.loadCallableMessageThreadForUser(params.data.id, userId)
      if (!sourceThread) return reply.code(404).send({ error: 'thread_not_found' })

      const existingParticipantIds = sourceThread.participants.map((participant: any) => participant.userId)
      const additionalParticipantIds = Array.from(
        new Set<string>(parse.data.participantIds.filter((id: string) => id && id !== userId && !existingParticipantIds.includes(id))),
      )

      if (!additionalParticipantIds.length) {
        const existingThread = await prisma.messageThread.findUnique({ where: { id: sourceThread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
        if (!existingThread) return reply.code(404).send({ error: 'thread_not_found' })
        return reply.send({ thread: deps.formatThreadSummaryRecord(existingThread, userId), created: false })
      }

      const friendIdSet = await deps.loadFriendIdSet(userId)
      if (additionalParticipantIds.some((id) => !friendIdSet.has(id))) {
        return reply.code(403).send({ error: 'group_members_must_be_friends' })
      }

      const existingUsers = await prisma.user.findMany({
        where: { id: { in: additionalParticipantIds } },
        select: { id: true },
      })
      const existingUserIds = new Set(existingUsers.map((user: { id: string }) => user.id))
      if (additionalParticipantIds.some((id) => !existingUserIds.has(id))) {
        return reply.code(404).send({ error: 'user_not_found' })
      }

      const participantIds = Array.from(new Set([...existingParticipantIds, ...additionalParticipantIds])).sort()
      if (participantIds.length < 3) return reply.code(400).send({ error: 'group_requires_at_least_three_participants' })
      if (participantIds.length > 20) return reply.code(400).send({ error: 'group_too_large' })

      const existingThreadId = await deps.findExistingExactThreadId(participantIds)
      if (existingThreadId) {
        const existingThread = await prisma.messageThread.findUnique({ where: { id: existingThreadId }, include: deps.THREAD_SUMMARY_INCLUDE })
        if (!existingThread) return reply.code(404).send({ error: 'thread_not_found' })
        return reply.send({ thread: deps.formatThreadSummaryRecord(existingThread, userId), created: false })
      }

      const now = new Date()
      const uniqueKey = deps.buildGroupThreadKey(participantIds)
      const createdThread = await prisma.messageThread.create({
        data: {
          type: MessageThreadType.group,
          uniqueKey,
          lastMessageAt: now,
          participants: {
            create: participantIds.map((participantId) => ({
              userId: participantId,
              role: participantId === userId ? MessageParticipantRole.admin : MessageParticipantRole.member,
              lastActivityAt: now,
              ...(participantId === userId ? { lastReadAt: now } : {}),
            })),
          },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
      })

      await Promise.all(
        createdThread.participants
          .filter((participant: any) => participant.userId !== userId)
          .map((participant: any) =>
            deps.dispatchRealtimeEvent(participant.userId, {
              type: 'thread.created',
              data: { thread: deps.formatThreadSummaryRecord(createdThread, participant.userId) },
            }),
          ),
      )

      return reply.code(201).send({ thread: deps.formatThreadSummaryRecord(createdThread, userId), created: true })
    }),
  )

  app.get('/messages/threads/:id/call', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      if (authContext.actor === 'family_member' && !deps.familyMemberCanAccessMessageThread(authContext.member, params.data.id)) {
        return reply.code(404).send({ error: 'thread_not_found' })
      }

      const thread = await deps.loadCallableMessageThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

      const call = await deps.loadLiveThreadCall(thread.id, { expireStale: true, endedByUserId: userId })
      return reply.send({
        thread: deps.formatThreadBase(thread, userId),
        call: call ? deps.formatMessageCall(call, userId) : null,
      })
    }),
  )

  app.post('/messages/threads/:id/call/start', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const parse = StartMessageCallInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      if (authContext.actor === 'family_member') {
        if (!deps.familyMemberCanAccessMessageThread(authContext.member, params.data.id)) {
          return reply.code(404).send({ error: 'thread_not_found' })
        }
        if (parse.data.mode === MessageCallMode.audio && !authContext.member.allowChildAudioCalls) {
          return reply.code(403).send({ error: 'audio_calls_not_allowed' })
        }
        if (parse.data.mode === MessageCallMode.video && !authContext.member.allowChildVideoCalls) {
          return reply.code(403).send({ error: 'video_calls_not_allowed' })
        }
      }

      const thread = await deps.loadCallableMessageThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

      if (thread.type === MessageThreadType.direct) {
        const otherIds = thread.participants
          .map((participant: any) => participant.userId)
          .filter((participantId: string) => participantId !== userId)
        const counterpartId = otherIds[0]
        if (!counterpartId || otherIds.length !== 1) return reply.code(400).send({ error: 'invalid_direct_thread' })

        const [friendStatus, connectionStatus] = await Promise.all([
          deps.usersAreFriends(userId, counterpartId),
          deps.usersAreAcceptedConnections(userId, counterpartId),
        ])
        if (!friendStatus && !connectionStatus) return reply.code(403).send({ error: 'not_callable' })
      }

      const existingCall = await deps.loadLiveThreadCall(thread.id, { expireStale: true, endedByUserId: userId })
      if (existingCall) return reply.send({ call: deps.formatMessageCall(existingCall, userId) })

      const createdCall = await prisma.messageCall.create({
        data: {
          threadId: thread.id,
          initiatorId: userId,
          roomId: `message-call-${randomUUID()}`,
          mode: parse.data.mode as MessageCallMode,
          status: MessageCallStatus.ringing,
        },
        select: deps.MESSAGE_CALL_SELECT,
      })
      deps.scheduleMessageCallTimeout(createdCall)

      const updatedThread = await prisma.messageThread.findUnique({
        where: { id: thread.id },
        include: deps.THREAD_SUMMARY_INCLUDE,
      })
      if (!updatedThread) return reply.code(404).send({ error: 'thread_not_found' })

      await Promise.all(
        updatedThread.participants.map((participant: any) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: deps.formatThreadSummaryRecord(updatedThread, participant.userId) },
          }),
        ),
      )

      const initiatorLabel =
        deps.formatDisplayNameForPush(createdCall.initiator.name || createdCall.initiator.handle || 'Someone') ||
        createdCall.initiator.name ||
        createdCall.initiator.handle ||
        'Someone'
      const modeLabel = createdCall.mode === MessageCallMode.video ? 'video' : 'audio'
      const callUrl = `/messages/call/${encodeURIComponent(thread.id)}?call=${encodeURIComponent(createdCall.id)}`
      const callPushBody = `${initiatorLabel} started a ${modeLabel} call.`

      await Promise.all(
        updatedThread.participants
          .filter((participant: any) => participant.userId !== userId)
          .map(async (participant: any) => {
            const realtimePromise = deps.dispatchRealtimeEvent(participant.userId, {
              type: 'message.call.invited',
              data: {
                thread: deps.formatThreadSummaryRecord(updatedThread, participant.userId),
                call: deps.formatMessageCall(createdCall, participant.userId),
              },
            })

            const muted = deps.isThreadMuted(participant.mutedUntil ?? null)
            const online = muted ? false : await deps.isUserRealtimeOnline(participant.userId).catch(() => false)
            const pushPromise =
              muted || online
                ? Promise.resolve()
                : Promise.allSettled([
                    deps.sendPushToUser(participant.userId, {
                      title: initiatorLabel,
                      body: callPushBody,
                      url: callUrl,
                      type: 'call',
                      entityId: createdCall.id,
                    }),
                    deps.sendNativePushForIncomingCall({
                      recipientUserId: participant.userId,
                      title: initiatorLabel,
                      message: callPushBody,
                      url: callUrl,
                      callId: createdCall.id,
                      mode: modeLabel,
                      threadId: thread.id,
                    }),
                  ]).then(() => undefined)

            await Promise.allSettled([realtimePromise, pushPromise])
          }),
      )

      return reply.code(201).send({ call: deps.formatMessageCall(createdCall, userId) })
    }),
  )

  app.post('/messages/calls/:id/rtc/session', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveActingUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageCallIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const body = MessageCallRtcSessionInput.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const call = await deps.loadMessageCallForUser(params.data.id, userId)
      if (!call) return reply.code(404).send({ error: 'call_not_found' })

      if (!deps.isMessageCallLive(call)) {
        await deps.expireMessageCallIfStale(call, userId)
        return reply.code(410).send({ error: 'call_ended' })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, handle: true },
      })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const displayName = body.data.displayName?.trim() || user.name?.trim() || user.handle || 'Civil user'
      const shouldActivateCall = call.status === MessageCallStatus.active || userId !== call.initiatorId
      const refreshedCall = await prisma.messageCall.update({
        where: { id: call.id },
        data: {
          status: shouldActivateCall ? MessageCallStatus.active : call.status,
          startedAt: shouldActivateCall ? call.startedAt ?? new Date() : call.startedAt,
          lastJoinedAt: new Date(),
        },
        select: deps.MESSAGE_CALL_SELECT,
      })

      if (shouldActivateCall) {
        deps.clearScheduledMessageCallTimeout(refreshedCall.id)
      } else {
        deps.scheduleMessageCallTimeout(refreshedCall)
      }

      const rtc = await deps.issueMeetingRtcSession({
        roomId: refreshedCall.roomId,
        userId,
        role: 'participant',
        displayName,
        deviceId: body.data.deviceId ?? null,
        capabilities:
          body.data.capabilities ??
          ({
            audio: true,
            video: refreshedCall.mode === MessageCallMode.video,
          } as const),
      })

      if ('error' in rtc) {
        const statusCode =
          typeof rtc.statusCode === 'number' && rtc.statusCode >= 400
            ? rtc.statusCode
            : rtc.error === 'meeting_rtc_not_configured'
              ? 503
              : rtc.error === 'meeting_rtc_timeout'
                ? 504
                : 502
        return reply.code(statusCode).send({ error: rtc.error })
      }

      const updatedThread = await prisma.messageThread.findUnique({
        where: { id: refreshedCall.threadId },
        include: deps.THREAD_SUMMARY_INCLUDE,
      })
      if (updatedThread) {
        await Promise.all(
          updatedThread.participants.map((participant: any) =>
            deps.dispatchRealtimeEvent(participant.userId, {
              type: 'thread.created',
              data: { thread: deps.formatThreadSummaryRecord(updatedThread, participant.userId) },
            }),
          ),
        )
      }

      return reply.send({
        ...rtc.session,
        call: deps.formatMessageCall(refreshedCall, userId),
      })
    }),
  )

  app.post('/messages/calls/:id/end', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveActingUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageCallIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const call = await deps.loadMessageCallForUser(params.data.id, userId)
      if (!call) return reply.code(404).send({ error: 'call_not_found' })

      await deps.finalizeMessageCall({
        callId: call.id,
        endedByUserId: userId,
        reason: 'hangup',
      })
      return reply.send({ success: true })
    }),
  )
}