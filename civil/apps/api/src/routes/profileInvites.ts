import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { BusinessStatus, Prisma } from '@prisma/client'
import { z } from 'zod'

const ProfileInviteInput = z.object({
  type: z.enum(['event', 'organization']),
  targetUserId: z.string().trim().min(1),
  eventId: z.string().trim().min(1).optional(),
  organizationId: z.string().trim().min(1).optional(),
})

const ProfileFamilyRequestInput = z.object({
  targetUserId: z.string().trim().min(1),
  relationship: z.enum([
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
  ]),
})

const ProfileFamilyRelationshipParams = z.object({
  targetUserId: z.string().trim().min(1),
})

type ProfileInviteDeps = Record<string, any>

export function registerProfileInviteRoutes(app: FastifyInstance, deps: ProfileInviteDeps) {
  app.post('/profile/invites', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const body = ProfileInviteInput.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      if (body.data.targetUserId === actorUserId) return reply.code(400).send({ error: 'invalid_invitee' })

      const targetUser = await prisma.user.findUnique({ where: { id: body.data.targetUserId }, select: { id: true } })
      if (!targetUser) return reply.code(404).send({ error: 'user_not_found' })

      if (body.data.type === 'organization') {
        const organizationId = body.data.organizationId?.trim() ?? ''
        if (!organizationId) return reply.code(400).send({ error: 'organization_required' })

        const [org, follow, membership] = await Promise.all([
          prisma.business.findFirst({
            where: { id: organizationId, status: BusinessStatus.ACTIVE },
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
              ownerId: true,
            },
          }),
          prisma.businessFollow.findUnique({
            where: { businessId_userId: { businessId: organizationId, userId: actorUserId } },
            select: { businessId: true },
          }),
          prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: organizationId, userId: actorUserId } },
            select: { businessId: true },
          }),
        ])

        if (!org || !org.provinceCode || !org.communitySlug) return reply.code(404).send({ error: 'organization_not_found' })
        if (!(org.ownerId === actorUserId || follow || membership)) return reply.code(403).send({ error: 'organization_not_joined' })

        await deps.notifyProfileOrganizationInvite({
          inviteeUserId: targetUser.id,
          actorUserId,
          organizationId: org.id,
          organizationName: org.name,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          organizationSlug: org.slug,
        })

        return reply.code(201).send({ ok: true })
      }

      const eventId = body.data.eventId?.trim() ?? ''
      if (!eventId) return reply.code(400).send({ error: 'event_required' })

      const organizations = await prisma.business.findMany({
        where: {
          status: BusinessStatus.ACTIVE,
          OR: [
            { ownerId: actorUserId },
            { follows: { some: { userId: actorUserId } } },
            { memberships: { some: { userId: actorUserId } } },
          ],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          metadata: true,
        },
        take: 1000,
      })

      let matchedEvent: {
        id: string
        title: string
        organizationId: string
        organizationName: string
        organizationSlug: string
        provinceCode: string
        communitySlug: string
      } | null = null

      for (const org of organizations) {
        if (!org.provinceCode || !org.communitySlug) continue
        const system = deps.readOrganizationSystemState(org.metadata)
        const event = system.events.find((item: { id: string; title: string }) => item.id === eventId)
        if (!event) continue
        const viewerRsvp = system.eventRsvps.find(
          (row: { eventId: string; userId: string; status: string }) => row.eventId === eventId && row.userId === actorUserId && row.status === 'GOING',
        )
        if (!viewerRsvp) continue
        matchedEvent = {
          id: event.id,
          title: event.title,
          organizationId: org.id,
          organizationName: org.name,
          organizationSlug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
        }
        break
      }

      if (!matchedEvent) return reply.code(403).send({ error: 'event_not_joined' })

      await deps.notifyProfileEventInvite({
        inviteeUserId: targetUser.id,
        actorUserId,
        eventId: matchedEvent.id,
        eventTitle: matchedEvent.title,
        hostOrganizationId: matchedEvent.organizationId,
        hostOrganizationName: matchedEvent.organizationName,
        hostProvinceCode: matchedEvent.provinceCode,
        hostCommunitySlug: matchedEvent.communitySlug,
        hostOrganizationSlug: matchedEvent.organizationSlug,
      })

      return reply.code(201).send({ ok: true })
    }),
  )

  app.post('/profile/family-requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const body = ProfileFamilyRequestInput.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      if (body.data.targetUserId === actorUserId) return reply.code(400).send({ error: 'invalid_invitee' })

      const [actorUser, targetUser] = await Promise.all([
        prisma.user.findUnique({
          where: { id: actorUserId },
          select: { id: true, handle: true, name: true, communityMeta: true },
        }),
        prisma.user.findUnique({
          where: { id: body.data.targetUserId },
          select: { id: true, handle: true, name: true, communityMeta: true },
        }),
      ])

      if (!actorUser) return reply.code(401).send({ error: 'unauthorized' })
      if (!targetUser) return reply.code(404).send({ error: 'user_not_found' })

      const actorRelationships = deps.getStoredProfileFamilyRelationships(actorUser.communityMeta)
      const targetRelationships = deps.getStoredProfileFamilyRelationships(targetUser.communityMeta)
      const actorAlreadyRelated = actorRelationships.some((entry: { relatedUserId: string }) => entry.relatedUserId === targetUser.id)
      const targetAlreadyRelated = targetRelationships.some((entry: { relatedUserId: string }) => entry.relatedUserId === actorUser.id)
      if (actorAlreadyRelated && targetAlreadyRelated) {
        return reply.code(409).send({ error: 'already_family' })
      }

      const existingNotifications: Array<{ payload: unknown }> = await prisma.notification.findMany({
        where: {
          userId: targetUser.id,
          actorId: actorUser.id,
          type: deps.PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { payload: true },
      })
      let hasPendingInvite = false
      for (const entry of existingNotifications) {
        const payload = entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
          ? (entry.payload as Record<string, unknown>)
          : null
        if (typeof payload?.status === 'string' && payload.status.trim().toLowerCase() === 'pending') {
          hasPendingInvite = true
          break
        }
      }
      if (hasPendingInvite) {
        return reply.code(409).send({ error: 'family_invite_pending' })
      }

      await deps.notifyProfileFamilyInvite({
        inviteeUserId: targetUser.id,
        actorUserId: actorUser.id,
        actorHandle: actorUser.handle,
        relationship: body.data.relationship,
      })

      return reply.code(201).send({ ok: true })
    }),
  )

  app.delete('/profile/family-relationships/:targetUserId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = ProfileFamilyRelationshipParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (params.data.targetUserId === actorUserId) return reply.code(400).send({ error: 'invalid_target' })

      const [actorUser, targetUser] = await Promise.all([
        prisma.user.findUnique({
          where: { id: actorUserId },
          select: { id: true, communityMeta: true },
        }),
        prisma.user.findUnique({
          where: { id: params.data.targetUserId },
          select: { id: true, communityMeta: true },
        }),
      ])

      if (!actorUser) return reply.code(401).send({ error: 'unauthorized' })
      if (!targetUser) return reply.code(404).send({ error: 'user_not_found' })

      const actorRelationships = deps.getStoredProfileFamilyRelationships(actorUser.communityMeta)
      const targetRelationships = deps.getStoredProfileFamilyRelationships(targetUser.communityMeta)
      const nextActorRelationships = actorRelationships.filter((entry: { relatedUserId: string }) => entry.relatedUserId !== targetUser.id)
      const nextTargetRelationships = targetRelationships.filter((entry: { relatedUserId: string }) => entry.relatedUserId !== actorUser.id)

      if (nextActorRelationships.length === actorRelationships.length && nextTargetRelationships.length === targetRelationships.length) {
        return reply.code(404).send({ error: 'family_relationship_not_found' })
      }

      const actorBaseMeta = deps.readBaseCommunityMeta(actorUser.communityMeta ?? null)
      deps.writeStoredProfileFamilyRelationships(actorBaseMeta, nextActorRelationships)

      const targetBaseMeta = deps.readBaseCommunityMeta(targetUser.communityMeta ?? null)
      deps.writeStoredProfileFamilyRelationships(targetBaseMeta, nextTargetRelationships)

      const nowIso = new Date().toISOString()
      const relatedNotifications = await prisma.notification.findMany({
        where: {
          OR: [
            {
              userId: actorUser.id,
              actorId: targetUser.id,
            },
            {
              userId: targetUser.id,
              actorId: actorUser.id,
            },
          ],
          type: {
            in: [deps.PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY, deps.PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY_RESPONSE],
          },
        },
        select: {
          id: true,
          payload: true,
        },
      })

      await prisma.$transaction([
        prisma.user.update({ where: { id: actorUser.id }, data: { communityMeta: actorBaseMeta as Prisma.InputJsonValue } }),
        prisma.user.update({ where: { id: targetUser.id }, data: { communityMeta: targetBaseMeta as Prisma.InputJsonValue } }),
        ...relatedNotifications.map((notification) => {
          const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
            ? (notification.payload as Record<string, unknown>)
            : {}
          return prisma.notification.update({
            where: { id: notification.id },
            data: {
              payload: {
                ...payload,
                status: 'removed',
                reciprocalCompleted: false,
                removedAt: nowIso,
              } as Prisma.InputJsonValue,
            },
          })
        }),
      ])

      return reply.send({ ok: true })
    }),
  )
}