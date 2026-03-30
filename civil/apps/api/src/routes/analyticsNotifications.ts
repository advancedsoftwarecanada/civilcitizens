import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { MessageParticipantRole, MessageThreadType, MessageType, Prisma, SupportRequestStatus } from '@prisma/client'
import { buildWalletMetaValue, ensureCitizenWalletTables, insertCivilCreditLedgerEntry, readWalletSummary } from '../walletHelpers.js'
import { applyWalletUserTransfer } from '../walletTransactions.js'
import { releaseDriveRideEscrow, settleExpiredDriveRideEscrows } from './driveRides.js'

type AnalyticsNotificationDeps = Record<string, any>

const FAMILY_RELATIONSHIP_VALUES = new Set([
  'husband',
  'wife',
  'spouse',
  'partner',
  'common_law_partner',
  'fiance',
  'ex_husband',
  'ex_wife',
  'widowed_spouse',
  'mother',
  'father',
  'parent',
  'stepfather',
  'stepmother',
  'adoptive_father',
  'adoptive_mother',
  'foster_parent',
  'son',
  'daughter',
  'child',
  'stepson',
  'stepdaughter',
  'adopted_son',
  'adopted_daughter',
  'foster_child',
  'grandmother',
  'grandfather',
  'grandparent',
  'grandson',
  'granddaughter',
  'grandchild',
  'sister',
  'brother',
  'sibling',
  'half_brother',
  'half_sister',
  'step_brother',
  'step_sister',
  'aunt',
  'uncle',
  'cousin',
  'second_cousin',
  'niece',
  'nephew',
  'great_uncle',
  'great_aunt',
  'mother_in_law',
  'father_in_law',
  'sister_in_law',
  'brother_in_law',
  'daughter_in_law',
  'son_in_law',
  'other',
])

const RECIPROCAL_FAMILY_RELATIONSHIP_OPTIONS_BY_TYPE: Partial<Record<string, string[]>> = {
  husband: ['wife', 'husband', 'spouse', 'partner', 'common_law_partner'],
  wife: ['husband', 'wife', 'spouse', 'partner', 'common_law_partner'],
  spouse: ['spouse', 'husband', 'wife', 'partner', 'common_law_partner'],
  partner: ['partner', 'spouse', 'husband', 'wife', 'common_law_partner'],
  common_law_partner: ['common_law_partner', 'partner', 'spouse', 'husband', 'wife'],
  fiance: ['fiance', 'partner', 'spouse'],
  ex_husband: ['ex_wife', 'ex_husband'],
  ex_wife: ['ex_husband', 'ex_wife'],
  widowed_spouse: ['widowed_spouse'],
  mother: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'adopted_son', 'adopted_daughter', 'foster_child'],
  father: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'adopted_son', 'adopted_daughter', 'foster_child'],
  parent: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'adopted_son', 'adopted_daughter', 'foster_child'],
  stepfather: ['stepson', 'stepdaughter'],
  stepmother: ['stepson', 'stepdaughter'],
  adoptive_father: ['adopted_son', 'adopted_daughter'],
  adoptive_mother: ['adopted_son', 'adopted_daughter'],
  foster_parent: ['foster_child'],
  son: ['parent', 'mother', 'father', 'stepmother', 'stepfather', 'adoptive_mother', 'adoptive_father', 'foster_parent'],
  daughter: ['parent', 'mother', 'father', 'stepmother', 'stepfather', 'adoptive_mother', 'adoptive_father', 'foster_parent'],
  child: ['parent', 'mother', 'father', 'stepmother', 'stepfather', 'adoptive_mother', 'adoptive_father', 'foster_parent'],
  stepson: ['stepmother', 'stepfather'],
  stepdaughter: ['stepmother', 'stepfather'],
  adopted_son: ['adoptive_mother', 'adoptive_father'],
  adopted_daughter: ['adoptive_mother', 'adoptive_father'],
  foster_child: ['foster_parent'],
  grandmother: ['grandchild', 'grandson', 'granddaughter'],
  grandfather: ['grandchild', 'grandson', 'granddaughter'],
  grandparent: ['grandchild', 'grandson', 'granddaughter'],
  grandson: ['grandparent', 'grandmother', 'grandfather'],
  granddaughter: ['grandparent', 'grandmother', 'grandfather'],
  grandchild: ['grandparent', 'grandmother', 'grandfather'],
  sister: ['sibling', 'sister', 'brother', 'half_sister', 'half_brother', 'step_sister', 'step_brother'],
  brother: ['sibling', 'brother', 'sister', 'half_brother', 'half_sister', 'step_brother', 'step_sister'],
  sibling: ['sibling', 'brother', 'sister', 'half_brother', 'half_sister', 'step_brother', 'step_sister'],
  half_brother: ['half_brother', 'half_sister', 'brother', 'sister', 'sibling'],
  half_sister: ['half_sister', 'half_brother', 'sister', 'brother', 'sibling'],
  step_brother: ['step_brother', 'step_sister', 'brother', 'sister', 'sibling'],
  step_sister: ['step_sister', 'step_brother', 'sister', 'brother', 'sibling'],
  aunt: ['niece', 'nephew'],
  uncle: ['nephew', 'niece'],
  great_aunt: ['niece', 'nephew'],
  great_uncle: ['nephew', 'niece'],
  niece: ['aunt', 'uncle'],
  nephew: ['uncle', 'aunt'],
  mother_in_law: ['daughter_in_law', 'son_in_law'],
  father_in_law: ['son_in_law', 'daughter_in_law'],
  sister_in_law: ['sister_in_law', 'brother_in_law'],
  brother_in_law: ['brother_in_law', 'sister_in_law'],
  daughter_in_law: ['mother_in_law', 'father_in_law'],
  son_in_law: ['father_in_law', 'mother_in_law'],
  cousin: ['cousin'],
  second_cousin: ['second_cousin'],
  other: ['other'],
}

const DELIVERY_GROUP_CONTEXT_TYPE = 'market_delivery'

function resolveReciprocalFamilyRelationship(value: string) {
  return RECIPROCAL_FAMILY_RELATIONSHIP_OPTIONS_BY_TYPE[value]?.[0] ?? value
}

function isAllowedReciprocalFamilyRelationship(sourceRelationship: string, reciprocalRelationship: string) {
  const allowedOptions = RECIPROCAL_FAMILY_RELATIONSHIP_OPTIONS_BY_TYPE[sourceRelationship]
  if (!allowedOptions?.length) return reciprocalRelationship === resolveReciprocalFamilyRelationship(sourceRelationship)
  return allowedOptions.includes(reciprocalRelationship)
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((Number(cents) || 0) / 100)
}

async function ensureDeliveryGroupThread(args: {
  tx: Prisma.TransactionClient
  deps: AnalyticsNotificationDeps
  contractId: string
  sellerUserId: string
  buyerUserId: string
  driverUserId: string
  driverName: string | null
  listingTitle: string
}) {
  const uniqueKey = `delivery_contract:${args.contractId}`
  let thread = await args.tx.messageThread.findUnique({
    where: { uniqueKey },
    include: { participants: { select: { userId: true, mutedUntil: true } } },
  })
  let created = false

  if (!thread) {
    const now = new Date()
    thread = await args.tx.messageThread.create({
      data: {
        type: MessageThreadType.group,
        uniqueKey,
        contextType: DELIVERY_GROUP_CONTEXT_TYPE,
        contextId: args.contractId,
        lastMessageAt: now,
        participants: {
          create: [
            { userId: args.sellerUserId, role: MessageParticipantRole.member, lastActivityAt: now },
            { userId: args.buyerUserId, role: MessageParticipantRole.member, lastActivityAt: now },
            { userId: args.driverUserId, role: MessageParticipantRole.member, lastReadAt: now, lastActivityAt: now },
          ],
        },
      },
      include: { participants: { select: { userId: true, mutedUntil: true } } },
    })
    created = true
  }

  const joinMessageBody = `${args.driverName?.trim() || 'Your delivery driver'} has joined the chat as your delivery driver for ${args.listingTitle}.`
  const joinMessage = await args.tx.message.create({
    data: {
      threadId: thread.id,
      senderId: args.driverUserId,
      body: joinMessageBody,
      messageType: MessageType.text,
    },
    select: args.deps.MESSAGE_SELECT,
  })

  await args.tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: joinMessage.createdAt } })
  await args.tx.messageParticipant.updateMany({ where: { threadId: thread.id }, data: { lastActivityAt: joinMessage.createdAt } })
  await args.tx.messageParticipant.update({
    where: { threadId_userId: { threadId: thread.id, userId: args.driverUserId } },
    data: { lastReadAt: joinMessage.createdAt, lastActivityAt: joinMessage.createdAt },
  })

  return { thread, joinMessage, created }
}

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

      await settleExpiredDriveRideEscrows()

      const notification = await prisma.notification.findFirst({
        where: { id: params.data.id, userId },
        select: deps.NOTIFICATION_SELECT,
      })
      if (!notification) return reply.code(404).send({ error: 'notification_not_found' })

      if (notification.type === deps.CONNECTION_NOTIFICATION_TYPES?.REQUEST) {
        const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
        if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
        if (statusRaw !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

        const connectionId = typeof payload.connectionId === 'string' ? payload.connectionId.trim() : ''
        if (!connectionId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        try {
          const connection = await deps.findConnectionById(connectionId)
          if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
          if (connection.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
          if (connection.status !== 'PENDING') return reply.code(409).send({ error: 'invitation_not_pending' })

          const now = new Date()
          const nextStatus = body.data.action === 'accept' ? 'accepted' : 'rejected'
          const nextPayload: Prisma.InputJsonValue = {
            ...payload,
            status: nextStatus,
            respondedAt: now.toISOString(),
          }

          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            if (body.data.action === 'accept') {
              await tx.$executeRaw`
                UPDATE "Connection"
                SET "status" = 'ACCEPTED',
                    "respondedAt" = ${now}
                WHERE "id" = ${connection.id}
              `
            } else {
              await tx.$executeRaw`
                UPDATE "Connection"
                SET "status" = 'REJECTED',
                    "respondedAt" = ${now}
                WHERE "id" = ${connection.id}
              `
            }

            await tx.notification.update({
              where: { id: notification.id },
              data: {
                payload: nextPayload,
                readAt: notification.readAt ?? now,
              },
            })
          })

          if (body.data.action === 'accept') {
            await deps.notifyConnectionAcceptance(connection.id, connection.requesterId, connection.addresseeId)
          }

          return reply.send({ ok: true, status: nextStatus })
        } catch (error) {
          if (deps.isConnectionTableMissingError?.(error)) {
            return reply
              .code(503)
              .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
          }
          throw error
        }
      }

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

        const reciprocalRelationship =
          typeof body.data.reciprocalRelationship === 'string' && FAMILY_RELATIONSHIP_VALUES.has(body.data.reciprocalRelationship)
            ? body.data.reciprocalRelationship
            : null
        if (reciprocalRelationship && !isAllowedReciprocalFamilyRelationship(relationship, reciprocalRelationship)) {
          return reply.code(400).send({ error: 'invalid_reciprocal_relationship' })
        }

        const requesterUserId = notification.actorId
        if (!requesterUserId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const [requesterUser, targetUser] = await Promise.all([
          prisma.user.findUnique({ where: { id: requesterUserId }, select: { id: true, handle: true, name: true, communityMeta: true } }),
          prisma.user.findUnique({ where: { id: userId }, select: { id: true, handle: true, name: true, communityMeta: true } }),
        ])
        if (!requesterUser || !targetUser) return reply.code(404).send({ error: 'user_not_found' })

        const nowIso = new Date().toISOString()
        const nextStatus: 'accepted' | 'rejected' = body.data.action === 'accept' ? 'accepted' : 'rejected'
        const nextPayload: Prisma.InputJsonValue = {
          ...payload,
          status: nextStatus,
          respondedAt: nowIso,
          reciprocalRelationship: body.data.action === 'accept' ? reciprocalRelationship ?? undefined : undefined,
          reciprocalCompleted: body.data.action === 'accept' ? Boolean(reciprocalRelationship) : false,
        }

        const writes: Prisma.PrismaPromise<unknown>[] = [
          prisma.notification.update({ where: { id: notification.id }, data: { payload: nextPayload, readAt: notification.readAt ?? new Date() } }),
        ]

        if (body.data.action === 'accept') {
          const requesterRelationships = deps.getStoredProfileFamilyRelationships(requesterUser.communityMeta)
          const targetRelationships = deps.getStoredProfileFamilyRelationships(targetUser.communityMeta)
          const existingRequesterRelationship = requesterRelationships.find((entry: { relatedUserId: string }) => entry.relatedUserId === targetUser.id) ?? null
          const existingTargetRelationship = targetRelationships.find((entry: { relatedUserId: string }) => entry.relatedUserId === requesterUser.id) ?? null

          const requesterBaseMeta = deps.readBaseCommunityMeta(requesterUser.communityMeta ?? null)
          deps.writeStoredProfileFamilyRelationships(
            requesterBaseMeta,
            deps.upsertProfileFamilyRelationship(requesterRelationships, {
              relatedUserId: targetUser.id,
              relatedHandle: targetUser.handle,
              relatedName: targetUser.name ?? null,
              familyType: relationship,
              direction: existingRequesterRelationship?.direction ?? 'outbound',
              createdAt: existingRequesterRelationship?.createdAt ?? nowIso,
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
              familyType: reciprocalRelationship ?? existingTargetRelationship?.familyType ?? resolveReciprocalFamilyRelationship(relationship),
              direction: existingTargetRelationship?.direction ?? 'inbound',
              createdAt: existingTargetRelationship?.createdAt ?? nowIso,
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

      if (notification.type === deps.DELIVERY_NOTIFICATION_TYPES.BID) {
        const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
        if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
        if (statusRaw !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

        const contractId = typeof payload.contractId === 'string' ? payload.contractId.trim() : ''
        if (!contractId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        await ensureCitizenWalletTables()
        await deps.ensureCitizenMarketplaceTables?.()

        const contractRows = await prisma.$queryRaw<Array<{
          id: string
          listing_id: string
          seller_user_id: string
          buyer_user_id: string
          status: string
          driver_user_id: string | null
          bid_driver_user_id: string | null
          bid_amount_cents: number | null
          group_thread_id: string | null
          listing_title: string
        }>>`
          SELECT c.id, c.listing_id, c.seller_user_id, c.buyer_user_id, c.status, c.driver_user_id, c.bid_driver_user_id, c.bid_amount_cents, c.group_thread_id, l.title AS listing_title
          FROM citizen_market_delivery_contract c
          INNER JOIN citizen_market_listing l ON l.id = c.listing_id
          WHERE c.id = ${contractId}
          LIMIT 1
        `

        const contract = contractRows[0]
        if (!contract || contract.buyer_user_id !== userId) return reply.code(404).send({ error: 'contract_not_found' })
        if (!contract.bid_driver_user_id || !contract.bid_amount_cents) return reply.code(400).send({ error: 'invalid_notification_payload' })
        if (contract.driver_user_id) return reply.code(409).send({ error: 'contract_already_assigned' })
        if (contract.status !== 'bid_pending' && contract.status !== 'open') return reply.code(409).send({ error: 'contract_not_open' })

        const nextStatus = body.data.action === 'accept' ? 'accepted' : 'rejected'
        const nowIso = new Date().toISOString()

        if (body.data.action === 'reject') {
          await prisma.$transaction([
            prisma.notification.update({
              where: { id: notification.id },
              data: { payload: { ...payload, status: nextStatus, respondedAt: nowIso } as Prisma.InputJsonValue, readAt: notification.readAt ?? new Date() },
            }),
            prisma.$executeRaw`
              UPDATE citizen_market_delivery_contract
              SET status = 'open',
                  bid_driver_user_id = NULL,
                  bid_amount_cents = NULL,
                  bid_requested_at = NULL,
                  bid_responded_at = NOW(),
                  updated_at = NOW()
              WHERE id = ${contract.id}
            `,
          ])

          if (contract.bid_driver_user_id !== userId) {
            await deps.createNotificationRecord({
              userId: contract.bid_driver_user_id,
              actorId: userId,
              type: deps.DELIVERY_NOTIFICATION_TYPES.BID_RESPONSE,
              payload: {
                contractId: contract.id,
                listingId: contract.listing_id,
                listingTitle: contract.listing_title,
                amountCents: contract.bid_amount_cents,
                status: nextStatus,
                respondedAt: nowIso,
                url: '/delivery',
              },
            })
          }

          return reply.send({ ok: true, status: nextStatus })
        }

        const [buyer, driver] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { id: true, handle: true, name: true, communityMeta: true } }),
          prisma.user.findUnique({ where: { id: contract.bid_driver_user_id }, select: { id: true, handle: true, name: true, communityMeta: true } }),
        ])
        if (!buyer || !driver) return reply.code(404).send({ error: 'user_not_found' })

        const buyerWallet = readWalletSummary(deps.parseCommunityMeta(buyer.communityMeta ?? null))

        if (!buyerWallet.enabled) return reply.code(400).send({ error: 'buyer_wallet_required' })
        if (buyerWallet.civilCreditsCents < contract.bid_amount_cents) {
          return reply.code(400).send({ error: 'insufficient_wallet_balance' })
        }

        const walletTransactionId = `${contract.id}-delivery-${Date.now()}`
        const eventId = walletTransactionId
        let threadId: string | null = null
        let joinMessage: any = null
        let threadParticipants: Array<{ userId: string; mutedUntil: Date | null }> = []

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await applyWalletUserTransfer(tx, {
            senderUserId: buyer.id,
            recipientUserId: driver.id,
            amountCents: contract.bid_amount_cents,
            transactionId: walletTransactionId,
            transactionKind: 'delivery_contract',
            transactionMetadata: {
              kind: 'delivery_contract',
              contractId: contract.id,
              listingId: contract.listing_id,
              buyerUserId: buyer.id,
              driverUserId: driver.id,
            },
            errors: {
              senderWalletDisabled: 'buyer_wallet_required',
              insufficientFunds: 'insufficient_wallet_balance',
            },
            transferLedger: {
              id: `${walletTransactionId}-ledger`,
              eventId,
              sourceType: 'delivery_contract',
              sourceReferenceId: contract.id,
              description: `Delivery contract for ${contract.listing_title}`,
              metadata: { kind: 'delivery_contract', contractId: contract.id, listingId: contract.listing_id },
            },
          })

          const threadResult = await ensureDeliveryGroupThread({
            tx,
            deps,
            contractId: contract.id,
            sellerUserId: contract.seller_user_id,
            buyerUserId: contract.buyer_user_id,
            driverUserId: driver.id,
            driverName: driver.name,
            listingTitle: contract.listing_title,
          })

          threadId = threadResult.thread.id
          joinMessage = threadResult.joinMessage
          threadParticipants = threadResult.thread.participants

          await tx.$executeRaw`
            UPDATE citizen_market_delivery_contract
            SET status = 'assigned',
                driver_user_id = ${driver.id},
                accepted_at = NOW(),
                bid_responded_at = NOW(),
                group_thread_id = ${threadResult.thread.id},
                updated_at = NOW()
            WHERE id = ${contract.id}
          `

          await tx.notification.update({
            where: { id: notification.id },
            data: {
              payload: {
                ...payload,
                status: nextStatus,
                respondedAt: nowIso,
                threadId: threadResult.thread.id,
                url: `/messages?thread=${encodeURIComponent(threadResult.thread.id)}`,
              } as Prisma.InputJsonValue,
              readAt: notification.readAt ?? new Date(),
            },
          })
        })

        if (threadId && joinMessage) {
          await Promise.all(
            threadParticipants.map((participant: { userId: string }) =>
              deps.dispatchRealtimeEvent(participant.userId, {
                type: 'message.created',
                data: { threadId, message: deps.formatMessage(joinMessage, participant.userId) },
              }),
            ),
          )

          void deps.sendMobilePushForMessageCreated({
            threadId,
            message: joinMessage,
            participants: threadParticipants,
            pushUrl: `/messages?thread=${encodeURIComponent(threadId)}`,
          })
        }

        await deps.createNotificationRecord({
          userId: driver.id,
          actorId: buyer.id,
          type: deps.DELIVERY_NOTIFICATION_TYPES.BID_RESPONSE,
          payload: {
            contractId: contract.id,
            listingId: contract.listing_id,
            listingTitle: contract.listing_title,
            amountCents: contract.bid_amount_cents,
            status: nextStatus,
            respondedAt: nowIso,
            url: threadId ? `/messages?thread=${encodeURIComponent(threadId)}` : '/delivery/my',
          },
        })

        return reply.send({ ok: true, status: nextStatus, threadId })
      }

      if (notification.type === 'drive_ride_complete_confirmation') {
        const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
        if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
        if (statusRaw !== 'pending') return reply.code(409).send({ error: 'invitation_not_pending' })

        const rideId = typeof payload.rideRequestId === 'string' ? payload.rideRequestId.trim() : ''
        if (!rideId) return reply.code(400).send({ error: 'invalid_notification_payload' })

        await ensureCitizenWalletTables()
        await deps.ensureCitizenMarketplaceTables?.()

        const rideRows = await prisma.$queryRaw<Array<{
          id: string
          requester_user_id: string
          driver_user_id: string | null
          escrow_status: string | null
          total_cost_cents: number
          accepted_offer_amount_cents: number | null
        }>>`
          SELECT
            id,
            requester_user_id,
            driver_user_id,
            escrow_status,
            total_cost_cents,
            accepted_offer_amount_cents
          FROM citizen_drive_ride_request
          WHERE id = ${rideId}
          LIMIT 1
        `

        const ride = rideRows[0]
        if (!ride || ride.requester_user_id !== userId) return reply.code(404).send({ error: 'ride_not_found' })
        if (!ride.driver_user_id) return reply.code(400).send({ error: 'invalid_notification_payload' })

        const [requester, driver] = await Promise.all([
          prisma.user.findUnique({
            where: { id: ride.requester_user_id },
            select: { id: true, handle: true, name: true },
          }),
          prisma.user.findUnique({
            where: { id: ride.driver_user_id },
            select: { id: true, handle: true, name: true },
          }),
        ])
        if (!requester || !driver) return reply.code(404).send({ error: 'user_not_found' })

        const now = new Date()
        const nowIso = now.toISOString()

        if (body.data.action === 'reject') {
          if (ride.escrow_status !== 'held') return reply.code(409).send({ error: 'ride_not_in_escrow' })

          const supportRequest = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const created = await tx.supportRequest.create({
              data: {
                requesterUserId: requester.id,
                type: 'CUSTOMER_SERVICE',
                subject: `Drive dispute: ride ${ride.id}`,
                body: [
                  'Passenger reported an issue with a completed Drive trip.',
                  `Ride request ID: ${ride.id}`,
                  `Passenger: ${requester.name ?? requester.handle ?? requester.id}`,
                  `Driver: ${driver.name ?? driver.handle ?? driver.id}`,
                  `Customer charge: ${formatMoney(ride.total_cost_cents)}`,
                  `Driver payout: ${formatMoney(ride.accepted_offer_amount_cents ?? 0)}`,
                  `Reported at: ${nowIso}`,
                ].join('\n'),
                status: SupportRequestStatus.OPEN,
              },
              select: { id: true },
            })

            await tx.$executeRaw`
              UPDATE citizen_drive_ride_request
              SET escrow_status = ${'disputed'},
                  rider_reported_issue_at = ${now},
                  support_request_id = ${created.id},
                  updated_at = NOW()
              WHERE id = ${ride.id}
                AND escrow_status = ${'held'}
            `

            await tx.$executeRaw`
              UPDATE citizen_wallet_transaction
              SET updated_at = NOW()
              WHERE id = ${`drive-ride:${ride.id}:escrow`}
            `

            await tx.notification.update({
              where: { id: notification.id },
              data: {
                payload: {
                  ...payload,
                  status: 'reported_issue',
                  respondedAt: nowIso,
                  supportRequestId: created.id,
                  url: '/settings/support',
                  sourceUrl: '/settings/support',
                } as Prisma.InputJsonValue,
                readAt: notification.readAt ?? now,
              },
            })

            return created
          })

          await deps.createNotificationRecord({
            userId: driver.id,
            actorId: requester.id,
            type: 'drive_ride_complete_response',
            payload: {
              rideRequestId: ride.id,
              status: 'reported_issue',
              supportRequestId: supportRequest.id,
              url: '/drive',
              sourceUrl: '/drive',
            },
          })

          return reply.send({ ok: true, status: 'reported_issue', supportRequestId: supportRequest.id })
        }

        if (ride.escrow_status !== 'held') return reply.code(409).send({ error: 'ride_not_in_escrow' })

        try {
          await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const result = await releaseDriveRideEscrow(tx, ride.id, 'confirmed', now)
            if (!result.settled) {
              throw new Error('ride_not_in_escrow')
            }

            await tx.notification.update({
              where: { id: notification.id },
              data: {
                payload: {
                  ...payload,
                  status: 'confirmed',
                  respondedAt: nowIso,
                  url: `/drive/myrides/${ride.id}/offers`,
                  sourceUrl: `/drive/myrides/${ride.id}/offers`,
                } as Prisma.InputJsonValue,
                readAt: notification.readAt ?? now,
              },
            })
          })
        } catch (error) {
          if (error instanceof Error && error.message === 'ride_not_in_escrow') {
            return reply.code(409).send({ error: 'ride_not_in_escrow' })
          }
          throw error
        }

        await deps.createNotificationRecord({
          userId: driver.id,
          actorId: requester.id,
          type: 'drive_ride_complete_response',
          payload: {
            rideRequestId: ride.id,
            status: 'confirmed',
            amountCents: ride.accepted_offer_amount_cents ?? null,
            url: '/drive',
            sourceUrl: '/drive',
          },
        })

        return reply.send({ ok: true, status: 'confirmed' })
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
