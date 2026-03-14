import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type AnalyticsNotificationDeps = Record<string, any>

const FAMILY_RELATIONSHIP_VALUES = new Set([
  'mother',
  'father',
  'grandmother',
  'grandfather',
  'sister',
  'brother',
  'aunt',
  'uncle',
  'cousin',
  'second_cousin',
  'niece',
  'nephew',
  'wife',
  'husband',
  'significant_other',
  'partner',
  'mother_in_law',
  'father_in_law',
  'sister_in_law',
  'brother_in_law',
  'daughter_in_law',
  'son_in_law',
  'other',
])

export function registerAnalyticsNotificationRoutes(app: FastifyInstance, deps: AnalyticsNotificationDeps) {
  app.post('/analytics/track', async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = deps.TrackViewInput.safeParse(req.body)
    if (!parse.success) {
      return reply.code(400).send({ error: parse.error.flatten() })
    }

    const { path, postId, referrer } = parse.data
    const userId = (req as any).user?.id ?? null
    try {
      await prisma.pageView.create({ data: { path, postId: postId ?? null, referrer: referrer ?? null, userId } })
    } catch (err) {
      req.log.error({ err }, 'track_view_failed')
      return reply.code(500).send({ error: 'tracking_failed' })
    }

    return reply.send({ ok: true })
  })

  app.post('/notifications/:id/respond', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.NotificationRespondParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const body = deps.NotificationRespondBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const notification = await prisma.notification.findFirst({
        where: { id: params.data.id, userId },
        select: deps.NOTIFICATION_SELECT,
      })
      if (!notification) return reply.code(404).send({ error: 'notification_not_found' })

      if (notification.type === deps.PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY) {
        const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
        if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
        if (statusRaw !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

        const relationship = typeof payload.relationship === 'string' && FAMILY_RELATIONSHIP_VALUES.has(payload.relationship)
          ? payload.relationship
          : null
        if (!relationship) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const requesterUserId = notification.actorId
        if (!requesterUserId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const [requesterUser, targetUser] = await Promise.all([
          prisma.user.findUnique({ where: { id: requesterUserId }, select: { id: true, handle: true, name: true, communityMeta: true } }),
          prisma.user.findUnique({ where: { id: userId }, select: { id: true, handle: true, name: true, communityMeta: true } }),
        ])
        if (!requesterUser || !targetUser) return reply.code(404).send({ error: 'user_not_found' })

        const nowIso = new Date().toISOString()
        const nextStatus: 'accepted' | 'rejected' = body.data.action === 'accept' ? 'accepted' : 'rejected'
        const nextPayload: Prisma.InputJsonValue = { ...payload, status: nextStatus, respondedAt: nowIso }

        const writes: Prisma.PrismaPromise<unknown>[] = [
          prisma.notification.update({ where: { id: notification.id }, data: { payload: nextPayload, readAt: notification.readAt ?? new Date() } }),
        ]

        if (body.data.action === 'accept') {
          const requesterRelationships = deps.getStoredProfileFamilyRelationships(requesterUser.communityMeta)
          const targetRelationships = deps.getStoredProfileFamilyRelationships(targetUser.communityMeta)

          const requesterBaseMeta = deps.readBaseCommunityMeta(requesterUser.communityMeta ?? null)
          deps.writeStoredProfileFamilyRelationships(
            requesterBaseMeta,
            deps.upsertProfileFamilyRelationship(requesterRelationships, {
              relatedUserId: targetUser.id,
              relatedHandle: targetUser.handle,
              relatedName: targetUser.name ?? null,
              familyType: relationship,
              direction: 'outbound',
              createdAt: nowIso,
              updatedAt: nowIso,
            }),
          )

          const targetBaseMeta = deps.readBaseCommunityMeta(targetUser.communityMeta ?? null)
          deps.writeStoredProfileFamilyRelationships(
            targetBaseMeta,
            deps.upsertProfileFamilyRelationship(targetRelationships, {
              relatedUserId: requesterUser.id,
              relatedHandle: requesterUser.handle,
              relatedName: requesterUser.name ?? null,
              familyType: relationship,
              direction: 'inbound',
              createdAt: nowIso,
              updatedAt: nowIso,
            }),
          )

          writes.push(
            prisma.user.update({ where: { id: requesterUser.id }, data: { communityMeta: requesterBaseMeta as Prisma.InputJsonValue } }),
            prisma.user.update({ where: { id: targetUser.id }, data: { communityMeta: targetBaseMeta as Prisma.InputJsonValue } }),
          )
        }

        await prisma.$transaction(writes)

        if (requesterUser.id !== userId) {
          await deps.notifyProfileFamilyInviteResponse({
            inviteeUserId: requesterUser.id,
            actorUserId: targetUser.id,
            actorHandle: targetUser.handle,
            relationship,
            status: nextStatus,
          })
        }

        return reply.send({ ok: true, status: nextStatus })
      }

      if (notification.type === deps.FAMILY_NOTIFICATION_TYPES.FRIEND_REQUEST) {
        const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
        if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
        if (statusRaw !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

        const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : ''
        if (!requestId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const requesterParentId = notification.actorId
        if (!requesterParentId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const [requesterParent, targetParent] = await Promise.all([
          prisma.user.findUnique({ where: { id: requesterParentId }, select: { id: true, communityMeta: true } }),
          prisma.user.findUnique({ where: { id: userId }, select: { id: true, communityMeta: true } }),
        ])
        if (!requesterParent || !targetParent) return reply.code(404).send({ error: 'not_found' })

        const requesterRequests = deps.getStoredFamilyFriendRequests(requesterParent.communityMeta)
        const targetRequests = deps.getStoredFamilyFriendRequests(targetParent.communityMeta)
        const existingRequest = targetRequests.find((request: any) => request.id === requestId) ?? requesterRequests.find((request: any) => request.id === requestId)
        if (!existingRequest) return reply.code(404).send({ error: 'invite_not_found' })
        if (existingRequest.status !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

        const nowIso = new Date().toISOString()
        const nextStatus = body.data.action === 'accept' ? 'accepted' : 'rejected'
        const nextRequest = { ...existingRequest, status: nextStatus, respondedAt: nowIso }

        const requesterBaseMeta = deps.readBaseCommunityMeta(requesterParent.communityMeta ?? null)
        deps.writeStoredFamilyFriendRequests(requesterBaseMeta, deps.upsertFamilyFriendRequest(requesterRequests, nextRequest))

        const targetBaseMeta = deps.readBaseCommunityMeta(targetParent.communityMeta ?? null)
        deps.writeStoredFamilyFriendRequests(targetBaseMeta, deps.upsertFamilyFriendRequest(targetRequests, nextRequest))

        if (body.data.action === 'accept') {
          const requesterFriendships = deps.getStoredFamilyFriendships(requesterParent.communityMeta)
          const targetFriendships = deps.getStoredFamilyFriendships(targetParent.communityMeta)

          deps.writeStoredFamilyFriendships(
            requesterBaseMeta,
            deps.upsertFamilyFriendship(requesterFriendships, {
              id: nextRequest.id,
              memberId: nextRequest.requesterMemberId,
              peerMemberId: nextRequest.targetMemberId,
              peerParentId: nextRequest.targetParentId,
              peerDisplayName: nextRequest.targetDisplayName,
              peerUsername: nextRequest.targetUsername,
              peerAvatarUrl: nextRequest.targetAvatarUrl ?? null,
              peerCoverUrl: nextRequest.targetCoverUrl ?? null,
              createdAt: nowIso,
            }),
          )

          deps.writeStoredFamilyFriendships(
            targetBaseMeta,
            deps.upsertFamilyFriendship(targetFriendships, {
              id: nextRequest.id,
              memberId: nextRequest.targetMemberId,
              peerMemberId: nextRequest.requesterMemberId,
              peerParentId: nextRequest.requesterParentId,
              peerDisplayName: nextRequest.requesterDisplayName,
              peerUsername: nextRequest.requesterUsername,
              peerAvatarUrl: nextRequest.requesterAvatarUrl ?? null,
              peerCoverUrl: nextRequest.requesterCoverUrl ?? null,
              createdAt: nowIso,
            }),
          )
        }

        const nextPayload: Prisma.InputJsonValue = { ...payload, status: nextStatus, respondedAt: nowIso }

        await prisma.$transaction([
          prisma.user.update({ where: { id: requesterParentId }, data: { communityMeta: requesterBaseMeta as Prisma.InputJsonValue } }),
          prisma.user.update({ where: { id: userId }, data: { communityMeta: targetBaseMeta as Prisma.InputJsonValue } }),
          prisma.notification.update({ where: { id: notification.id }, data: { payload: nextPayload, readAt: notification.readAt ?? new Date() } }),
        ])

        return reply.send({ ok: true, status: nextStatus })
      }

      if (notification.type !== deps.EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE && notification.type !== deps.EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE) {
        return reply.code(400).send({ error: 'notification_not_actionable' })
      }

      const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
        ? (notification.payload as Record<string, unknown>)
        : null
      if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

      const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
      if (statusRaw !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

      const hostOrganizationId = typeof payload.hostOrganizationId === 'string' ? payload.hostOrganizationId : ''
      const eventId = typeof payload.eventId === 'string' ? payload.eventId : ''
      if (!hostOrganizationId || !eventId) return reply.code(400).send({ error: 'invalid_notification_payload' })

      const hostOrg = await prisma.business.findUnique({ where: { id: hostOrganizationId }, select: { id: true, metadata: true, provinceCode: true, communitySlug: true, slug: true } })
      if (!hostOrg) return reply.code(404).send({ error: 'organization_not_found' })

      const current = deps.readOrganizationSystemState(hostOrg.metadata)
      const eventIndex = current.events.findIndex((entry: any) => entry.id === eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previousEvent = current.events[eventIndex]
      if (!previousEvent) return reply.code(404).send({ error: 'event_not_found' })

      const nowIso = new Date().toISOString()
      const nextStatus = body.data.action === 'accept' ? 'ACCEPTED' : 'DECLINED'
      const nextStatusLower = body.data.action === 'accept' ? 'accepted' : 'declined'
      const nextEvent = {
        ...previousEvent,
        guestSpeakerInvites: [...(previousEvent.guestSpeakerInvites ?? [])],
        sponsorInvites: [...(previousEvent.sponsorInvites ?? [])],
        updatedAt: nowIso,
      }

      if (notification.type === deps.EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE) {
        const inviteIndex = nextEvent.guestSpeakerInvites.findIndex((invite: any) => invite.userId === userId)
        if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
        const invite = nextEvent.guestSpeakerInvites[inviteIndex]
        if (!invite || invite.status !== 'PENDING') return reply.code(409).send({ error: 'invitation_not_pending' })
        nextEvent.guestSpeakerInvites[inviteIndex] = { ...invite, status: nextStatus, respondedAt: nowIso, respondedByUserId: userId }
      } else {
        const targetOrganizationId = typeof payload.targetOrganizationId === 'string' ? payload.targetOrganizationId : ''
        if (!targetOrganizationId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const targetOrg = await prisma.business.findUnique({ where: { id: targetOrganizationId }, select: { id: true, ownerId: true } })
        if (!targetOrg) return reply.code(404).send({ error: 'organization_not_found' })

        let authorized = targetOrg.ownerId === userId
        if (!authorized) {
          const membership = await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: targetOrg.id, userId } }, select: { role: true } })
          authorized = membership?.role === 'OWNER' || membership?.role === 'MANAGER'
        }
        if (!authorized) return reply.code(403).send({ error: 'forbidden' })

        const inviteIndex = nextEvent.sponsorInvites.findIndex((invite: any) => invite.organizationId === targetOrganizationId)
        if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
        const invite = nextEvent.sponsorInvites[inviteIndex]
        if (!invite || invite.status !== 'PENDING') return reply.code(409).send({ error: 'invitation_not_pending' })
        nextEvent.sponsorInvites[inviteIndex] = { ...invite, status: nextStatus, respondedAt: nowIso, respondedByUserId: userId }
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = nextEvent
      const nextSystem = { ...current, events: nextEvents }

      await prisma.business.update({ where: { id: hostOrg.id }, data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(hostOrg.metadata, nextSystem) }, select: { id: true } })

      const nextPayload: Prisma.InputJsonValue = { ...payload, status: body.data.action === 'accept' ? 'accepted' : 'rejected', respondedAt: nowIso }

      await prisma.notification.update({ where: { id: notification.id }, data: { payload: nextPayload, readAt: notification.readAt ?? new Date() } })

      if (notification.actorId && notification.actorId !== userId) {
        const inviteKind = notification.type === deps.EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE ? 'guest_speaker' : 'sponsor'
        const responseType = notification.type === deps.EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE
          ? deps.EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_RESPONSE
          : deps.EVENT_NOTIFICATION_TYPES.SPONSOR_RESPONSE

        await deps.createNotificationRecord({
          userId: notification.actorId,
          actorId: userId,
          type: responseType,
          payload: {
            invitationKind: inviteKind,
            status: nextStatusLower,
            eventId,
            eventTitle: typeof payload.eventTitle === 'string' && payload.eventTitle.trim() ? payload.eventTitle.trim() : previousEvent.title,
            url:
              typeof payload.url === 'string' && payload.url.trim().startsWith('/')
                ? payload.url.trim()
                : hostOrg.provinceCode && hostOrg.communitySlug && hostOrg.slug
                  ? `/com/${encodeURIComponent(hostOrg.provinceCode)}/${encodeURIComponent(hostOrg.communitySlug)}/orgs/${encodeURIComponent(hostOrg.slug)}/events/${encodeURIComponent(eventId)}`
                  : '/notifications',
            respondedAt: nowIso,
          },
        })
      }

      return reply.send({ ok: true, status: body.data.action === 'accept' ? 'accepted' : 'rejected' })
    }),
  )
}