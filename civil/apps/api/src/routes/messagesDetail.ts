import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { MessageParticipantRole, MessageThreadType, MessageType, Prisma } from '@prisma/client'
import { GroupParticipantInput, MessageCallRtcSessionInput, MessageListQuery, SendMessageInput, ThreadReadInput } from '@civil/shared'
import { z } from 'zod'

const FamilyCallParams = z.object({ id: z.string().trim().min(1) })
const FamilyCallMemberParams = z.object({ memberId: z.string().trim().min(1) })
const FamilyCallStartBody = z.object({ memberId: z.string().trim().min(1), mode: z.enum(['audio', 'video']) })
const MessageThreadIdParam = z.object({ id: z.string().min(1) })
const MessageThreadParticipantParams = z.object({ id: z.string().min(1), userId: z.string().uuid() })

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

type MessagesDetailDeps = Record<string, any>

export function registerMessagesDetailRoutes(app: FastifyInstance, deps: MessagesDetailDeps) {
  app.get('/family/calls/member/:memberId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const params = FamilyCallMemberParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const context = await deps.loadFamilyCallContext(authContext, params.data.memberId)
      if (!context) return reply.code(404).send({ error: 'family_member_not_found' })

      const call = await deps.loadFamilyCallForMember(context.member.id)
      return reply.send({
        member: deps.normalizeFamilyMemberSummary(context.member),
        parent: deps.formatFriendUser(context.member.parent),
        viewerRole: context.viewerRole,
        call: call ? deps.formatFamilyCallSummary({ call, member: context.member, viewerRole: context.viewerRole }).call : null,
      })
    }),
  )

  app.post('/family/calls/start', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const parse = FamilyCallStartBody.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const context = await deps.loadFamilyCallContext(authContext, parse.data.memberId)
      if (!context) return reply.code(404).send({ error: 'family_member_not_found' })
      if (parse.data.mode === 'audio' && !context.member.allowChildAudioCalls) return reply.code(403).send({ error: 'audio_calls_not_allowed' })
      if (parse.data.mode === 'video' && !context.member.allowChildVideoCalls) return reply.code(403).send({ error: 'video_calls_not_allowed' })

      const existing = await deps.loadFamilyCallForMember(context.member.id)
      if (existing) return reply.send(deps.formatFamilyCallSummary({ call: existing, member: context.member, viewerRole: context.viewerRole }))

      const nowIso = new Date().toISOString()
      const call: FamilyCallRecord = {
        id: randomUUID(),
        memberId: context.member.id,
        parentId: context.member.parentId,
        roomId: `family-call-${randomUUID()}`,
        mode: parse.data.mode,
        status: 'ringing',
        initiatorActor: context.viewerRole,
        createdAt: nowIso,
        updatedAt: nowIso,
        startedAt: null,
        lastJoinedAt: null,
        endedAt: null,
      }
      await deps.writeFamilyCallRecord(call)

      const summary = deps.formatFamilyCallSummary({ call, member: context.member, viewerRole: context.viewerRole })
      await deps.dispatchRealtimeEvent(context.member.parentId, {
        type: 'family.call.invited',
        data: {
          memberId: context.member.id,
          targetRole: context.viewerRole === 'parent' ? 'child' : 'parent',
          ...summary,
        },
      })

      const initiatorLabel =
        deps.formatDisplayNameForPush(summary.call.initiator.name || summary.call.initiator.handle || 'Someone') ||
        summary.call.initiator.name ||
        summary.call.initiator.handle ||
        'Someone'
      const modeLabel = call.mode === 'video' ? 'video' : 'audio'
      const callUrl = `/family/call/${encodeURIComponent(context.member.id)}?call=${encodeURIComponent(call.id)}`
      const online = await deps.isUserRealtimeOnline(context.member.parentId).catch(() => false)

      if (!online) {
        await Promise.allSettled([
          deps.sendPushToUser(context.member.parentId, {
            title: initiatorLabel,
            body: `${initiatorLabel} started a ${modeLabel} call.`,
            url: callUrl,
            type: 'call',
            entityId: call.id,
          }),
          deps.sendNativePushForIncomingCall({
            recipientUserId: context.member.parentId,
            title: initiatorLabel,
            message: `${initiatorLabel} started a ${modeLabel} call.`,
            url: callUrl,
            callId: call.id,
            mode: modeLabel,
            memberId: context.member.id,
          }),
        ])
      }

      return reply.code(201).send(summary)
    }),
  )

  app.post('/family/calls/:id/rtc/session', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const params = FamilyCallParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const body = MessageCallRtcSessionInput.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const existing = await deps.loadFamilyCallRecord(params.data.id)
      if (!existing) return reply.code(404).send({ error: 'family_call_not_found' })
      if (existing.status === 'ended') return reply.code(410).send({ error: 'call_ended' })

      const context = await deps.loadFamilyCallContext(authContext, existing.memberId)
      if (!context || context.member.parentId !== existing.parentId) return reply.code(404).send({ error: 'family_call_not_found' })

      const nowIso = new Date().toISOString()
      const shouldActivateCall = existing.status === 'active' || existing.initiatorActor !== context.viewerRole
      const updatedCall: FamilyCallRecord = {
        ...existing,
        status: shouldActivateCall ? 'active' : existing.status,
        updatedAt: nowIso,
        startedAt: shouldActivateCall ? (existing.startedAt ?? nowIso) : existing.startedAt,
        lastJoinedAt: nowIso,
      }
      await deps.writeFamilyCallRecord(updatedCall)

      const rtcUserId = context.viewerRole === 'parent' ? context.member.parentId : deps.buildFamilyRtcUserId(context.member.id)
      const defaultDisplayName =
        context.viewerRole === 'parent'
          ? context.member.parent.name?.trim() || context.member.parent.handle
          : deps.normalizeFamilyMemberSummary(context.member).displayName

      const rtc = await deps.issueMeetingRtcSession({
        roomId: updatedCall.roomId,
        userId: rtcUserId,
        role: 'participant',
        displayName: body.data.displayName?.trim() || defaultDisplayName,
        deviceId: body.data.deviceId ?? null,
        capabilities: body.data.capabilities ?? {
          audio: updatedCall.mode === 'audio' || updatedCall.mode === 'video',
          video: updatedCall.mode === 'video',
        },
      })
      if ('error' in rtc) return reply.code(502).send({ error: rtc.error })

      const summary = deps.formatFamilyCallSummary({ call: updatedCall, member: context.member, viewerRole: context.viewerRole })
      await deps.dispatchRealtimeEvent(context.member.parentId, {
        type: 'family.call.updated',
        data: {
          memberId: context.member.id,
          targetRole: null,
          ...summary,
        },
      })

      return reply.send({
        ...rtc.session,
        member: summary.member,
        parent: summary.parent,
        viewerRole: summary.viewerRole,
        counterpart: summary.counterpart,
        call: summary.call,
      })
    }),
  )

  app.post('/family/calls/:id/end', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const params = FamilyCallParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const existing = await deps.loadFamilyCallRecord(params.data.id)
      if (!existing) return reply.code(404).send({ error: 'family_call_not_found' })

      const context = await deps.loadFamilyCallContext(authContext, existing.memberId)
      if (!context || context.member.parentId !== existing.parentId) return reply.code(404).send({ error: 'family_call_not_found' })

      const endedCall: FamilyCallRecord = {
        ...existing,
        status: 'ended',
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }
      await deps.writeFamilyCallRecord(endedCall)

      await deps.dispatchRealtimeEvent(context.member.parentId, {
        type: 'family.call.ended',
        data: { callId: endedCall.id, memberId: context.member.id },
      })

      return reply.send(deps.formatFamilyCallSummary({ call: endedCall, member: context.member, viewerRole: context.viewerRole }))
    }),
  )

  app.get('/messages/threads/:id/candidates', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const thread = await deps.loadThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
      if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

      const viewerParticipant = thread.participants.find((participant: any) => participant.userId === userId)
      if (!viewerParticipant || viewerParticipant.role !== MessageParticipantRole.admin) {
        return reply.code(403).send({ error: 'only_owner_can_manage_members' })
      }

      const friendIdSet = await deps.loadFriendIdSet(userId)
      const existingIds = new Set(thread.participants.map((participant: any) => participant.userId))
      const candidateIds = [...friendIdSet].filter((id) => !existingIds.has(id))
      if (!candidateIds.length) return reply.send({ items: [] })

      const users = await prisma.user.findMany({
        where: { id: { in: candidateIds } },
        select: deps.FRIEND_USER_SELECT,
        orderBy: [{ name: 'asc' }, { handle: 'asc' }],
      })

      return reply.send({ items: users.map((user: any) => deps.formatFriendUser(user)) })
    }),
  )

  app.post('/messages/threads/:id/participants', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const parse = GroupParticipantInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const thread = await deps.loadThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
      if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

      const viewerParticipant = thread.participants.find((participant: any) => participant.userId === userId)
      if (!viewerParticipant || viewerParticipant.role !== MessageParticipantRole.admin) {
        return reply.code(403).send({ error: 'only_owner_can_manage_members' })
      }

      const targetUserId = parse.data.userId
      if (targetUserId === userId) return reply.code(400).send({ error: 'cannot_add_self' })
      if (thread.participants.some((participant: any) => participant.userId === targetUserId)) {
        const existingThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
        if (!existingThread) return reply.code(404).send({ error: 'thread_not_found' })
        return reply.send({ thread: deps.formatThreadSummaryRecord(existingThread, userId) })
      }

      const friendIdSet = await deps.loadFriendIdSet(userId)
      if (!friendIdSet.has(targetUserId)) return reply.code(403).send({ error: 'group_members_must_be_friends' })

      const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
      if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

      await prisma.messageParticipant.create({
        data: {
          threadId: thread.id,
          userId: targetUserId,
          role: MessageParticipantRole.member,
          lastActivityAt: new Date(),
        },
      })

      const updatedThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
      if (!updatedThread) return reply.code(404).send({ error: 'thread_not_found' })

      await Promise.all(
        updatedThread.participants.map((participant: any) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: deps.formatThreadSummaryRecord(updatedThread, participant.userId) },
          }),
        ),
      )

      return reply.send({ thread: deps.formatThreadSummaryRecord(updatedThread, userId) })
    }),
  )

  app.delete('/messages/threads/:id/participants/:userId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageThreadParticipantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const thread = await deps.loadThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
      if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

      const viewerParticipant = thread.participants.find((participant: any) => participant.userId === userId)
      if (!viewerParticipant || viewerParticipant.role !== MessageParticipantRole.admin) {
        return reply.code(403).send({ error: 'only_owner_can_manage_members' })
      }

      const targetUserId = params.data.userId
      if (targetUserId === userId) return reply.code(400).send({ error: 'owner_cannot_remove_self' })

      const targetParticipant = thread.participants.find((participant: any) => participant.userId === targetUserId)
      if (!targetParticipant) return reply.code(404).send({ error: 'participant_not_found' })
      if (targetParticipant.role === MessageParticipantRole.admin) return reply.code(400).send({ error: 'cannot_remove_owner' })

      await prisma.messageParticipant.delete({
        where: {
          threadId_userId: {
            threadId: thread.id,
            userId: targetUserId,
          },
        },
      })

      const updatedThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
      if (!updatedThread) return reply.code(404).send({ error: 'thread_not_found' })

      await deps.dispatchRealtimeEvent(targetUserId, { type: 'thread.removed', data: { threadId: thread.id } })

      await Promise.all(
        updatedThread.participants.map((participant: any) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: deps.formatThreadSummaryRecord(updatedThread, participant.userId) },
          }),
        ),
      )

      return reply.send({ thread: deps.formatThreadSummaryRecord(updatedThread, userId) })
    }),
  )

  app.post('/messages/threads/:id/leave', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const thread = await deps.loadThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
      if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

      const viewerParticipant = thread.participants.find((participant: any) => participant.userId === userId)
      if (!viewerParticipant) return reply.code(404).send({ error: 'participant_not_found' })
      if (viewerParticipant.role === MessageParticipantRole.admin) return reply.code(400).send({ error: 'owner_cannot_leave' })

      await prisma.messageParticipant.delete({
        where: {
          threadId_userId: {
            threadId: thread.id,
            userId,
          },
        },
      })

      const updatedThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: deps.THREAD_SUMMARY_INCLUDE })
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

      await deps.dispatchRealtimeEvent(userId, { type: 'thread.removed', data: { threadId: thread.id } })
      return reply.send({ success: true })
    }),
  )

  app.get('/messages/threads/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      if (authContext.actor === 'user' && deps.isParentFamilyThreadId(params.data.id)) {
        const memberId = deps.parseParentFamilyThreadId(params.data.id)
        if (!memberId) return reply.code(404).send({ error: 'thread_not_found' })
        const query = MessageListQuery.safeParse(req.query ?? {})
        if (!query.success) return reply.code(400).send({ error: query.error.flatten() })
        const context = await deps.loadParentFamilyConversationContext(authContext.userId, memberId)
        if (!context) return reply.code(404).send({ error: 'thread_not_found' })
        const { rows, nextCursor } = deps.fetchParentFamilyConversationMessages(
          context.member,
          context.parent,
          context.conversation,
          query.data.limit,
          query.data.cursor,
        )
        return reply.send({ thread: deps.buildParentFamilyConversationThread(context), messages: rows, nextCursor })
      }

      if (authContext.actor === 'family_member' && params.data.id === deps.buildFamilyParentThreadId(authContext.member.parentId)) {
        const query = MessageListQuery.safeParse(req.query ?? {})
        if (!query.success) return reply.code(400).send({ error: query.error.flatten() })
        const conversation =
          deps.getFamilyParentConversation(authContext.member.parent.communityMeta, authContext.member.id, authContext.member.parentId) ?? null
        const { rows, nextCursor } = deps.fetchFamilyParentConversationMessages(
          authContext.member,
          conversation,
          query.data.limit,
          query.data.cursor,
        )
        return reply.send({
          thread: deps.buildFamilyParentConversationThread(authContext.member, conversation),
          messages: rows,
          nextCursor,
        })
      }

      if (authContext.actor === 'family_member' && !deps.familyMemberCanAccessMessageThread(authContext.member, params.data.id)) {
        return reply.code(404).send({ error: 'thread_not_found' })
      }

      const thread = await deps.loadThreadForUser(params.data.id, userId)
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

      const query = MessageListQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { rows, nextCursor } = await deps.fetchThreadMessages(thread.id, query.data.limit, query.data.cursor)
      return reply.send({
        thread: deps.formatThreadBase(thread, userId),
        messages: rows.map((message: any) => deps.formatMessage(message, userId)),
        nextCursor,
      })
    }),
  )

  app.post('/messages/threads/:id/messages', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const parse = SendMessageInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      if (authContext.actor === 'user' && deps.isParentFamilyThreadId(params.data.id)) {
        const memberId = deps.parseParentFamilyThreadId(params.data.id)
        if (!memberId) return reply.code(404).send({ error: 'thread_not_found' })
        const normalizedBody = parse.data.body?.trim() ? deps.sanitizePlainText(parse.data.body) : ''
        if (!normalizedBody) return reply.code(400).send({ error: 'message_body_required' })
        const context = await deps.loadParentFamilyConversationContext(authContext.userId, memberId)
        if (!context) return reply.code(404).send({ error: 'thread_not_found' })
        const conversation = await deps.storeFamilyParentConversationMessage({
          parentId: authContext.userId,
          memberId,
          sender: 'parent',
          body: normalizedBody,
        })
        const message = deps.formatParentFamilyConversationMessage(conversation, context.member, context.parent).at(-1)
        const thread = deps.buildParentFamilyConversationThread({ parent: context.parent, member: context.member, conversation })
        if (!message) return reply.code(500).send({ error: 'message_create_failed' })

        await Promise.all([
          deps.dispatchRealtimeEvent(authContext.userId, { type: 'thread.created', data: { thread } }),
          deps.dispatchRealtimeEvent(authContext.userId, { type: 'message.created', data: { threadId: thread.id, message } }),
        ])

        return reply.code(201).send({ message })
      }

      if (authContext.actor === 'family_member' && params.data.id === deps.buildFamilyParentThreadId(authContext.member.parentId)) {
        const normalizedBody = parse.data.body?.trim() ? deps.sanitizePlainText(parse.data.body) : ''
        if (!normalizedBody) return reply.code(400).send({ error: 'message_body_required' })
        const conversation = await deps.storeFamilyParentConversationMessage({
          parentId: authContext.member.parentId,
          memberId: authContext.member.id,
          sender: 'child',
          body: normalizedBody,
        })
        const message = deps.formatFamilyParentConversationMessage(conversation, authContext.member).at(-1)
        if (!message) return reply.code(500).send({ error: 'message_create_failed' })

        await Promise.all([
          deps.dispatchRealtimeEvent(authContext.member.parentId, {
            type: 'thread.created',
            data: {
              thread: await (async () => {
                const context = await deps.loadParentFamilyConversationContext(authContext.member.parentId, authContext.member.id)
                return context ? deps.buildParentFamilyConversationThread(context) : null
              })(),
            },
          }),
          deps.dispatchRealtimeEvent(authContext.member.parentId, {
            type: 'message.created',
            data: {
              threadId: deps.buildParentFamilyThreadId(authContext.member.id),
              message: await (async () => {
                const context = await deps.loadParentFamilyConversationContext(authContext.member.parentId, authContext.member.id)
                if (!context) return null
                return deps.formatParentFamilyConversationMessage(conversation, context.member, context.parent).at(-1) ?? null
              })(),
            },
          }),
          deps.dispatchRealtimeEvent(authContext.member.parentId, {
            type: 'thread.updated',
            data: {
              thread: await (async () => {
                const context = await deps.loadParentFamilyConversationContext(authContext.member.parentId, authContext.member.id)
                return context ? deps.buildParentFamilyConversationThread(context) : null
              })(),
            },
          }),
        ])

        void (async () => {
          const threadId = deps.buildParentFamilyThreadId(authContext.member.id)
          const sender = deps.formatNormalizedFamilyMemberThreadUser(deps.normalizeFamilyMemberSummary(authContext.member))
          const rawSenderLabel = sender.name || sender.handle || 'Someone'
          const title = deps.formatDisplayNameForPush(rawSenderLabel) || rawSenderLabel
          const body = deps.truncatePushBody(normalizedBody)
          const pushUrl = `/messages?inbox=family&thread=${encodeURIComponent(threadId)}`
          if (!body) return

          await deps.sendPushToUser(authContext.member.parentId, {
            title,
            body,
            url: pushUrl,
            type: 'message',
            entityId: threadId,
          }).catch(() => undefined)

          if (!deps.PUSH_DELIVERY_URL) return
          const deviceTargets = await deps.loadActiveNativePushTargets(authContext.member.parentId)
          if (!deviceTargets.length) return
          const badge = await deps.loadUnreadMessageCount(authContext.member.parentId)
          await Promise.allSettled(
            deviceTargets.map(({ platform, token }: any) =>
              deps.deliverNativePushToToken({
                platform,
                deviceToken: token,
                title,
                message: body,
                badge,
                sound: 'civil-message.caf',
                data: { kind: 'message', threadId, url: pushUrl },
              }),
            ),
          )
        })()

        return reply.code(201).send({ message })
      }

      if (authContext.actor === 'family_member' && !deps.familyMemberCanAccessMessageThread(authContext.member, params.data.id)) {
        return reply.code(404).send({ error: 'thread_not_found' })
      }

      const thread = await prisma.messageThread.findFirst({
        where: {
          id: params.data.id,
          participants: { some: { userId } },
        },
        select: { id: true, participants: { select: { userId: true, mutedUntil: true } } },
      })
      if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

      const messageRecord = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const normalizedBody = parse.data.body?.trim() ? deps.sanitizePlainText(parse.data.body) : ''
        const created = await tx.message.create({
          data: {
            threadId: thread.id,
            senderId: userId,
            body: normalizedBody ? normalizedBody : null,
            attachments: parse.data.attachments ?? undefined,
            messageType: MessageType.text,
          },
          select: deps.MESSAGE_SELECT,
        })

        await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: created.createdAt } })
        await tx.messageParticipant.update({
          where: { threadId_userId: { threadId: thread.id, userId } },
          data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
        })
        await tx.messageParticipant.updateMany({
          where: { threadId: thread.id, userId: { not: userId } },
          data: { lastActivityAt: created.createdAt },
        })

        return created
      })

      if (authContext.actor === 'family_member') {
        const counterpartId = thread.participants.find((participant: any) => participant.userId !== userId)?.userId
        if (counterpartId) {
          await deps.storeFamilyMessageThreadForMember({
            parentId: authContext.member.parentId,
            memberId: authContext.member.id,
            threadId: thread.id,
            peerUserId: counterpartId,
            timestamp: messageRecord.createdAt,
          })
        }
      }

      await Promise.all(
        thread.participants.map((participant: any) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'message.created',
            data: { threadId: thread.id, message: deps.formatMessage(messageRecord, participant.userId) },
          }),
        ),
      )

      void deps.sendMobilePushForMessageCreated({ threadId: thread.id, message: messageRecord, participants: thread.participants })
      return reply.code(201).send({ message: deps.formatMessage(messageRecord, userId) })
    }),
  )

  app.get('/messages/unread-count', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
      const allowedThreadIds =
        authContext.actor === 'family_member'
          ? deps.getFamilyMessageThreadIdsForMember(authContext.member.parent.communityMeta, authContext.member.id)
          : null

      const familyParentUnreadCount =
        authContext.actor === 'family_member'
          ? (deps
              .getFamilyParentConversation(authContext.member.parent.communityMeta, authContext.member.id, authContext.member.parentId)
              ?.messages.filter((message: any) => {
                if (message.sender !== 'parent') return false
                const conversation = deps.getFamilyParentConversation(
                  authContext.member.parent.communityMeta,
                  authContext.member.id,
                  authContext.member.parentId,
                )
                if (!conversation?.childLastReadAt) return true
                return message.createdAt > conversation.childLastReadAt
              }).length ?? 0)
          : 0

      const parentFamilyUnreadCount =
        authContext.actor === 'user'
          ? deps
              .getStoredFamilyParentConversations(
                (await prisma.user.findUnique({ where: { id: authContext.userId }, select: { communityMeta: true } }))?.communityMeta,
              )
              .reduce((total: number, conversation: any) => {
                return total + conversation.messages.filter((message: any) => {
                  if (message.sender !== 'child') return false
                  if (!conversation.parentLastReadAt) return true
                  return message.createdAt > conversation.parentLastReadAt
                }).length
              }, 0)
          : 0

      if (authContext.actor === 'family_member' && allowedThreadIds && allowedThreadIds.length === 0) {
        return reply.send({ count: familyParentUnreadCount })
      }

      let result: Array<{ count: number }>
      if (allowedThreadIds) {
        result = (await prisma.$queryRaw(Prisma.sql`
          SELECT COUNT(*)::int as count
          FROM "Message" m
          JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
          JOIN "MessageThread" t ON t.id = m."threadId"
          WHERE mp."userId" = ${userId}
          AND m."senderId" != ${userId}
          AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
          AND (t."contextType" IS NULL OR t."contextType" != 'market_listing')
          AND m."threadId" IN (${Prisma.join(allowedThreadIds)})
        `)) as Array<{ count: number }>
      } else {
        result = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int as count
          FROM "Message" m
          JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
          JOIN "MessageThread" t ON t.id = m."threadId"
          WHERE mp."userId" = ${userId}
          AND m."senderId" != ${userId}
          AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
          AND (t."contextType" IS NULL OR t."contextType" != 'market_listing')
        `
      }

      const count = Number(result[0]?.count || 0) + familyParentUnreadCount + parentFamilyUnreadCount
      return reply.send({ count })
    }),
  )

  app.post('/messages/threads/:id/read', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })

      const userId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
      const params = MessageThreadIdParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      if (authContext.actor === 'user' && deps.isParentFamilyThreadId(params.data.id)) {
        const memberId = deps.parseParentFamilyThreadId(params.data.id)
        if (!memberId) return reply.code(404).send({ error: 'thread_not_found' })
        const parse = ThreadReadInput.safeParse(req.body ?? {})
        if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
        const context = await deps.loadParentFamilyConversationContext(authContext.userId, memberId)
        if (!context) return reply.code(404).send({ error: 'thread_not_found' })
        if (!context.conversation) return reply.send({ lastReadAt: new Date() })

        let readAt = new Date()
        if (parse.data.messageId) {
          const message = context.conversation.messages.find((entry: any) => entry.id === parse.data.messageId)
          if (!message) return reply.code(400).send({ error: 'invalid_message' })
          readAt = new Date(message.createdAt)
        }
        await deps.markFamilyParentConversationRead({ parentId: authContext.userId, memberId, actor: 'parent', readAt })
        return reply.send({ lastReadAt: readAt })
      }

      if (authContext.actor === 'family_member' && params.data.id === deps.buildFamilyParentThreadId(authContext.member.parentId)) {
        const parse = ThreadReadInput.safeParse(req.body ?? {})
        if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
        const conversation =
          deps.getFamilyParentConversation(authContext.member.parent.communityMeta, authContext.member.id, authContext.member.parentId) ?? null
        if (!conversation) return reply.send({ lastReadAt: new Date() })

        let readAt = new Date()
        if (parse.data.messageId) {
          const message = conversation.messages.find((entry: any) => entry.id === parse.data.messageId)
          if (!message) return reply.code(400).send({ error: 'invalid_message' })
          readAt = new Date(message.createdAt)
        }
        await deps.markFamilyParentConversationRead({
          parentId: authContext.member.parentId,
          memberId: authContext.member.id,
          actor: 'child',
          readAt,
        })
        return reply.send({ lastReadAt: readAt })
      }

      if (authContext.actor === 'family_member' && !deps.familyMemberCanAccessMessageThread(authContext.member, params.data.id)) {
        return reply.code(404).send({ error: 'thread_not_found' })
      }

      const membership = await prisma.messageParticipant.findUnique({
        where: {
          threadId_userId: { threadId: params.data.id, userId },
        },
        select: { threadId: true },
      })
      if (!membership) return reply.code(404).send({ error: 'thread_not_found' })

      const parse = ThreadReadInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      let readAt = new Date()
      if (parse.data.messageId) {
        const message = await prisma.message.findUnique({ where: { id: parse.data.messageId }, select: { threadId: true, createdAt: true } })
        if (!message || message.threadId !== params.data.id) return reply.code(400).send({ error: 'invalid_message' })
        readAt = message.createdAt
      }

      await prisma.messageParticipant.update({
        where: { threadId_userId: { threadId: params.data.id, userId } },
        data: { lastReadAt: readAt },
      })

      return reply.send({ lastReadAt: readAt })
    }),
  )
}