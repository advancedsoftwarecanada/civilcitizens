import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type OrganizationGovernanceEventsDeps = Record<string, any>

export function registerOrganizationGovernanceEventsRoutes(
  app: FastifyInstance,
  deps: OrganizationGovernanceEventsDeps,
) {
  app.post('/communities/:province/:municipality/orgs/:slug/governance/events/draft', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      const canCreate =
        deps.canOrganizationPermission(permissions, 'manage_events') ||
        deps.canOrganizationPermission(permissions, 'create_announcements') ||
        deps.canOrganizationPermission(permissions, 'create_paid_events')
      if (!canCreate) return reply.code(403).send({ error: 'forbidden' })

      const nowIso = new Date().toISOString()
      const event = {
        id: `event_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        title: 'Untitled event',
        description: null,
        category: 'Other',
        access: 'PUBLIC',
        eligibleRankIds: [],
        startsAt: nowIso,
        endsAt: null,
        capacity: null,
        paid: false,
        priceCents: null,
        currency: 'CAD',
        guestSpeakers: [],
        guestSpeakerInvites: [],
        sponsors: [],
        sponsorInvites: [],
        fees: [],
        primaryPhotoUrl: null,
        galleryPhotoUrls: [],
        agenda: [],
        attachments: [],
        status: 'DRAFT',
        createdAt: nowIso,
        updatedAt: nowIso,
      }

      const nextSystem = { ...current, events: [...current.events, event] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.draft.created',
        reason: null,
        previousValue: null,
        nextValue: event,
      })

      return reply.code(201).send({ event })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'manage_events')) return reply.code(403).send({ error: 'forbidden' })

      const event = current.events.find((item: { id: string }) => item.id === params.data.eventId) ?? null
      if (!event) return reply.code(404).send({ error: 'event_not_found' })

      const eventRsvps = current.eventRsvps.filter((row: { eventId: string }) => row.eventId === event.id)
      const rsvpUserIds = Array.from(new Set(eventRsvps.map((row: { userId: string }) => row.userId).filter(Boolean)))
      const rsvpUsers = rsvpUserIds.length
        ? await prisma.user.findMany({
            where: { id: { in: rsvpUserIds } },
            select: deps.BUSINESS_FRIEND_USER_SELECT,
          })
        : []
      const rsvpUserMap = new Map(rsvpUsers.map((user: { id: string }) => [user.id, user]))

      const rsvps = eventRsvps
        .map((row: Record<string, any>) => {
          const user = rsvpUserMap.get(row.userId)
          return {
            ...row,
            user: user ? deps.formatFriendUser(user) : null,
          }
        })
        .sort((a: Record<string, any>, b: Record<string, any>) => {
          const at = new Date(a.updatedAt ?? a.createdAt).getTime()
          const bt = new Date(b.updatedAt ?? b.createdAt).getTime()
          return bt - at
        })

      const aiScan = await deps.loadContentAiScanSummary('organization_event', deps.buildOrganizationEventScanTargetId(org.id, event.id))
      return reply.send({ event, rsvps, aiScan })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgEventDraftUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'manage_events')) return reply.code(403).send({ error: 'forbidden' })

      const eventIndex = current.events.findIndex((item: { id: string }) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })

      const nextFees = body.data.fees ?? previous.fees ?? []
      const hasPaidFees = nextFees.some((fee: { amountCents: number }) => fee.amountCents > 0)
      const nextPaid = body.data.paid ?? hasPaidFees
      const nextStartsAt = body.data.startsAt === undefined ? previous.startsAt : body.data.startsAt ?? previous.startsAt
      const nextCurrency = (body.data.currency ?? previous.currency).toUpperCase()
      const derivedPriceFromFees = nextFees
        .map((fee: { amountCents: number }) => fee.amountCents)
        .filter((amount: number) => Number.isFinite(amount) && amount > 0)
        .sort((a: number, b: number) => a - b)[0] ?? null
      const nowIso = new Date().toISOString()

      const normalizedGuestInput = body.data.guestSpeakers === undefined ? null : deps.normalizeGuestSpeakerInput(body.data.guestSpeakers)
      const guestInviteBuild = normalizedGuestInput
        ? deps.buildGuestSpeakerInvites({
            previous: previous.guestSpeakerInvites ?? [],
            selectedTags: normalizedGuestInput.guestSpeakerTags,
            nowIso,
          })
        : null

      const normalizedSponsors = body.data.sponsors ? deps.normalizeEventSponsorTags(body.data.sponsors) : null
      const sponsorRecipientMap = normalizedSponsors?.length
        ? await deps.resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor: { organizationId: string }) => sponsor.organizationId))
        : new Map<string, string[]>()
      const sponsorInviteBuild = normalizedSponsors
        ? deps.buildSponsorInvites({
            previous: previous.sponsorInvites ?? [],
            selectedSponsors: normalizedSponsors,
            recipientMap: sponsorRecipientMap,
            nowIso,
          })
        : null

      const nextAgenda =
        body.data.agenda === undefined
          ? previous.agenda
          : body.data.agenda.map((item: { title: string; startsAt?: string | null }) => ({ title: item.title, startsAt: item.startsAt ?? null }))

      const next = {
        ...previous,
        title: body.data.title ?? previous.title,
        description: body.data.description === undefined ? previous.description : body.data.description ?? null,
        category: body.data.category ?? previous.category ?? 'Other',
        access: body.data.access ?? previous.access,
        eligibleRankIds: body.data.eligibleRankIds ?? previous.eligibleRankIds,
        startsAt: nextStartsAt,
        endsAt: body.data.endsAt === undefined ? previous.endsAt : body.data.endsAt ?? null,
        capacity: body.data.capacity === undefined ? previous.capacity : body.data.capacity ?? null,
        paid: nextPaid,
        priceCents: nextPaid ? (body.data.priceCents === undefined ? previous.priceCents ?? derivedPriceFromFees : body.data.priceCents ?? null) : null,
        currency: nextCurrency,
        guestSpeakers: normalizedGuestInput ? normalizedGuestInput.guestSpeakers : previous.guestSpeakers,
        guestSpeakerInvites: guestInviteBuild ? guestInviteBuild.nextInvites : previous.guestSpeakerInvites ?? [],
        sponsors: normalizedSponsors ?? previous.sponsors ?? [],
        sponsorInvites: sponsorInviteBuild ? sponsorInviteBuild.nextInvites : previous.sponsorInvites ?? [],
        fees: nextFees,
        agenda: nextAgenda,
        attachments: body.data.attachments ?? previous.attachments,
        primaryPhotoUrl: body.data.primaryPhotoUrl === undefined ? previous.primaryPhotoUrl : body.data.primaryPhotoUrl ?? null,
        galleryPhotoUrls: body.data.galleryPhotoUrls ?? previous.galleryPhotoUrls,
        status: previous.status ?? 'PUBLISHED',
        updatedAt: nowIso,
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem = { ...current, events: nextEvents }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: (previous.status ?? 'PUBLISHED') === 'DRAFT' ? 'event.draft.updated' : 'event.updated',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      const hostSlug = params.data.slug.trim().toLowerCase()
      if (guestInviteBuild?.newlyInvited?.length) {
        await Promise.allSettled(
          guestInviteBuild.newlyInvited.map((invite: { userId: string }) =>
            deps.notifyEventGuestSpeakerInvite({
              inviteeUserId: invite.userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              eventId: next.id,
              eventTitle: next.title,
            }),
          ),
        )
      }

      if (sponsorInviteBuild?.newlyInvited?.length) {
        const notifications: Array<Promise<void>> = []
        for (const invite of sponsorInviteBuild.newlyInvited) {
          for (const userId of invite.recipientUserIds) {
            notifications.push(
              deps.notifyEventSponsorInvite({
                inviteeUserId: userId,
                actorUserId,
                hostOrganizationId: org.id,
                hostProvinceCode: province,
                hostCommunitySlug: community.slug,
                hostOrganizationSlug: hostSlug,
                targetOrganizationId: invite.organizationId,
                eventId: next.id,
                eventTitle: next.title,
              }),
            )
          }
        }
        if (notifications.length) await Promise.allSettled(notifications)
      }

      void deps.enqueueContentAiScanForOrganizationEvent({
        orgId: org.id,
        ownerUserId: org.ownerId,
        event: next,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_event_update_failed', error)
      })

      return reply.send({ event: next })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/publish', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgEventBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      const hasPaidFees = (body.data.fees ?? []).some((fee: { amountCents: number }) => fee.amountCents > 0)
      const isPaidEvent = body.data.paid || hasPaidFees
      const requiredPermission = isPaidEvent ? 'create_paid_events' : 'create_announcements'
      if (!deps.canOrganizationPermission(permissions, requiredPermission) && !deps.canOrganizationPermission(permissions, 'manage_events')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const eventIndex = current.events.findIndex((item: { id: string }) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })
      if (previous.status && previous.status !== 'DRAFT') return reply.code(409).send({ error: 'event_not_draft' })

      const nowIso = new Date().toISOString()
      const normalizedGuestInput = deps.normalizeGuestSpeakerInput(body.data.guestSpeakers)
      const guestInviteBuild = deps.buildGuestSpeakerInvites({
        previous: previous.guestSpeakerInvites ?? [],
        selectedTags: normalizedGuestInput.guestSpeakerTags,
        nowIso,
      })
      const normalizedSponsors = deps.normalizeEventSponsorTags(body.data.sponsors)
      const sponsorRecipientMap = normalizedSponsors.length
        ? await deps.resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor: { organizationId: string }) => sponsor.organizationId))
        : new Map<string, string[]>()
      const sponsorInviteBuild = deps.buildSponsorInvites({
        previous: previous.sponsorInvites ?? [],
        selectedSponsors: normalizedSponsors,
        recipientMap: sponsorRecipientMap,
        nowIso,
      })
      const publishPriceFromFees = (body.data.fees ?? [])
        .map((fee: { amountCents: number }) => fee.amountCents)
        .filter((amount: number) => Number.isFinite(amount) && amount > 0)
        .sort((a: number, b: number) => a - b)[0] ?? null
      const next = {
        ...previous,
        title: body.data.title,
        description: body.data.description ?? null,
        category: body.data.category,
        access: body.data.access,
        eligibleRankIds: body.data.eligibleRankIds ?? [],
        startsAt: body.data.startsAt,
        endsAt: body.data.endsAt ?? null,
        capacity: body.data.capacity ?? null,
        paid: body.data.paid || hasPaidFees,
        priceCents: body.data.paid || hasPaidFees ? body.data.priceCents ?? publishPriceFromFees : null,
        currency: body.data.currency.toUpperCase(),
        guestSpeakers: normalizedGuestInput.guestSpeakers,
        guestSpeakerInvites: guestInviteBuild.nextInvites,
        sponsors: normalizedSponsors,
        sponsorInvites: sponsorInviteBuild.nextInvites,
        fees: body.data.fees ?? [],
        primaryPhotoUrl: body.data.primaryPhotoUrl ?? null,
        galleryPhotoUrls: body.data.galleryPhotoUrls ?? [],
        agenda: body.data.agenda?.map((item: { title: string; startsAt?: string | null }) => ({ title: item.title, startsAt: item.startsAt ?? null })) ?? [],
        attachments: body.data.attachments ?? [],
        status: 'PUBLISHED',
        updatedAt: nowIso,
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem = { ...current, events: nextEvents }
      const hostSlug = params.data.slug.trim().toLowerCase()

      let announcementPost: { id: string; authorId: string; title: string | null; body: string; mediaUrl: string | null; images: unknown } | null = null
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })

        announcementPost = await deps.createOrganizationEventAnnouncementPost({
          client: tx,
          authorUserId: actorUserId,
          businessId: org.id,
          provinceCode: province,
          communitySlug: community.slug,
          organizationSlug: hostSlug,
          event: {
            id: next.id,
            title: next.title,
            description: next.description,
            startsAt: next.startsAt,
            primaryPhotoUrl: next.primaryPhotoUrl,
          },
        })
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.published',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      if (guestInviteBuild.newlyInvited.length) {
        await Promise.allSettled(
          guestInviteBuild.newlyInvited.map((invite: { userId: string }) =>
            deps.notifyEventGuestSpeakerInvite({
              inviteeUserId: invite.userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              eventId: next.id,
              eventTitle: next.title,
            }),
          ),
        )
      }

      if (sponsorInviteBuild.newlyInvited.length) {
        const notifications: Promise<void>[] = []
        for (const invite of sponsorInviteBuild.newlyInvited) {
          for (const userId of invite.recipientUserIds) {
            notifications.push(
              deps.notifyEventSponsorInvite({
                inviteeUserId: userId,
                actorUserId,
                hostOrganizationId: org.id,
                hostProvinceCode: province,
                hostCommunitySlug: community.slug,
                hostOrganizationSlug: hostSlug,
                targetOrganizationId: invite.organizationId,
                eventId: next.id,
                eventTitle: next.title,
              }),
            )
          }
        }
        if (notifications.length) await Promise.allSettled(notifications)
      }

      void deps.enqueueContentAiScanForOrganizationEvent({
        orgId: org.id,
        ownerUserId: org.ownerId,
        event: next,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_event_publish_failed', error)
      })
      if (announcementPost) {
        void deps.enqueueContentAiScanForPost(announcementPost).catch((error: unknown) => {
          console.error('content_ai_scan_enqueue_event_announcement_post_publish_failed', error)
        })
      }

      return reply.send({ event: next })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/unpublish', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'manage_events')) return reply.code(403).send({ error: 'forbidden' })

      const eventIndex = current.events.findIndex((item: { id: string }) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })

      const nowIso = new Date().toISOString()
      const next = { ...previous, status: 'DRAFT', updatedAt: nowIso }
      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem = { ...current, events: nextEvents }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.unpublished',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      return reply.send({ event: next })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/events', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgEventBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      const hasPaidFees = (body.data.fees ?? []).some((fee: { amountCents: number }) => fee.amountCents > 0)
      const isPaidEvent = body.data.paid || hasPaidFees
      const requiredPermission = isPaidEvent ? 'create_paid_events' : 'create_announcements'
      if (!deps.canOrganizationPermission(permissions, requiredPermission) && !deps.canOrganizationPermission(permissions, 'manage_events')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const nowIso = new Date().toISOString()
      const normalizedGuestInput = deps.normalizeGuestSpeakerInput(body.data.guestSpeakers)
      const guestInviteBuild = deps.buildGuestSpeakerInvites({
        previous: [],
        selectedTags: normalizedGuestInput.guestSpeakerTags,
        nowIso,
      })
      const normalizedSponsors = deps.normalizeEventSponsorTags(body.data.sponsors)
      const sponsorRecipientMap = normalizedSponsors.length
        ? await deps.resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor: { organizationId: string }) => sponsor.organizationId))
        : new Map<string, string[]>()
      const sponsorInviteBuild = deps.buildSponsorInvites({
        previous: [],
        selectedSponsors: normalizedSponsors,
        recipientMap: sponsorRecipientMap,
        nowIso,
      })
      const createPriceFromFees = (body.data.fees ?? [])
        .map((fee: { amountCents: number }) => fee.amountCents)
        .filter((amount: number) => Number.isFinite(amount) && amount > 0)
        .sort((a: number, b: number) => a - b)[0] ?? null
      const event = {
        id: `event_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        title: body.data.title,
        description: body.data.description ?? null,
        category: body.data.category,
        access: body.data.access,
        eligibleRankIds: body.data.eligibleRankIds ?? [],
        startsAt: body.data.startsAt,
        endsAt: body.data.endsAt ?? null,
        capacity: body.data.capacity ?? null,
        paid: body.data.paid || hasPaidFees,
        priceCents: body.data.paid || hasPaidFees ? body.data.priceCents ?? createPriceFromFees : null,
        currency: body.data.currency.toUpperCase(),
        guestSpeakers: normalizedGuestInput.guestSpeakers,
        guestSpeakerInvites: guestInviteBuild.nextInvites,
        sponsors: normalizedSponsors,
        sponsorInvites: sponsorInviteBuild.nextInvites,
        fees: body.data.fees ?? [],
        primaryPhotoUrl: body.data.primaryPhotoUrl ?? null,
        galleryPhotoUrls: body.data.galleryPhotoUrls ?? [],
        agenda: body.data.agenda?.map((item: { title: string; startsAt?: string | null }) => ({ title: item.title, startsAt: item.startsAt ?? null })) ?? [],
        attachments: body.data.attachments ?? [],
        status: 'PUBLISHED',
        createdAt: nowIso,
        updatedAt: nowIso,
      }

      const nextSystem = { ...current, events: [...current.events, event] }
      const hostSlug = params.data.slug.trim().toLowerCase()
      let announcementPost: { id: string; authorId: string; title: string | null; body: string; mediaUrl: string | null; images: unknown } | null = null
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })

        announcementPost = await deps.createOrganizationEventAnnouncementPost({
          client: tx,
          authorUserId: actorUserId,
          businessId: org.id,
          provinceCode: province,
          communitySlug: community.slug,
          organizationSlug: hostSlug,
          event: {
            id: event.id,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            primaryPhotoUrl: event.primaryPhotoUrl,
          },
        })
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.created',
        reason: null,
        previousValue: null,
        nextValue: event,
      })

      if (guestInviteBuild.newlyInvited.length) {
        await Promise.allSettled(
          guestInviteBuild.newlyInvited.map((invite: { userId: string }) =>
            deps.notifyEventGuestSpeakerInvite({
              inviteeUserId: invite.userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              eventId: event.id,
              eventTitle: event.title,
            }),
          ),
        )
      }

      if (sponsorInviteBuild.newlyInvited.length) {
        const notifications: Promise<void>[] = []
        for (const invite of sponsorInviteBuild.newlyInvited) {
          for (const userId of invite.recipientUserIds) {
            notifications.push(
              deps.notifyEventSponsorInvite({
                inviteeUserId: userId,
                actorUserId,
                hostOrganizationId: org.id,
                hostProvinceCode: province,
                hostCommunitySlug: community.slug,
                hostOrganizationSlug: hostSlug,
                targetOrganizationId: invite.organizationId,
                eventId: event.id,
                eventTitle: event.title,
              }),
            )
          }
        }
        if (notifications.length) await Promise.allSettled(notifications)
      }

      void deps.enqueueContentAiScanForOrganizationEvent({
        orgId: org.id,
        ownerUserId: org.ownerId,
        event,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_event_create_failed', error)
      })
      if (announcementPost) {
        void deps.enqueueContentAiScanForPost(announcementPost).catch((error: unknown) => {
          console.error('content_ai_scan_enqueue_event_announcement_post_create_failed', error)
        })
      }

      return reply.code(201).send({ event })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'manage_events')) return reply.code(403).send({ error: 'forbidden' })

      const eventIndex = current.events.findIndex((item: { id: string }) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const removed = current.events[eventIndex]
      if (!removed) return reply.code(404).send({ error: 'event_not_found' })

      const nextEvents = current.events.filter((item: { id: string }) => item.id !== params.data.eventId)
      const nextRsvps = current.eventRsvps.filter((row: { eventId: string }) => row.eventId !== params.data.eventId)
      const nextSystem = { ...current, events: nextEvents, eventRsvps: nextRsvps }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.deleted',
        reason: null,
        previousValue: removed,
        nextValue: null,
      })

      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/rsvp', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgEventRsvpBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true, status: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.status !== 'ACTIVE') return reply.code(404).send({ error: 'organization_not_found' })

      const current = deps.readOrganizationSystemState(org.metadata)
      const event = current.events.find((item: { id: string }) => item.id === params.data.eventId)
      if (!event) return reply.code(404).send({ error: 'event_not_found' })
      if ((event.status ?? 'PUBLISHED') !== 'PUBLISHED') return reply.code(404).send({ error: 'event_not_found' })

      const actorMember = current.members[actorUserId] ?? null
      if (event.access === 'RESTRICTED') {
        if (!actorMember || actorMember.status !== 'ACTIVE') {
          return reply.code(403).send({ error: 'restricted_event' })
        }
        if (event.eligibleRankIds.length > 0 && !event.eligibleRankIds.includes(actorMember.rankId)) {
          return reply.code(403).send({ error: 'rank_not_eligible' })
        }
      }

      const eventFees = event.fees ?? []
      const selectedTicket = body.data.ticketId ? eventFees.find((fee: { id: string }) => fee.id === body.data.ticketId) ?? null : null

      if (body.data.ticketId && !selectedTicket) {
        return reply.code(400).send({ error: 'invalid_ticket_type' })
      }

      if (body.data.status === 'GOING' && eventFees.length > 0 && !selectedTicket) {
        return reply.code(400).send({ error: 'ticket_type_required' })
      }

      const resolvedTicketType: 'FREE' | 'PAID' = selectedTicket
        ? selectedTicket.amountCents > 0
          ? 'PAID'
          : 'FREE'
        : body.data.ticketType ?? (event.paid ? 'PAID' : 'FREE')

      if (event.paid && eventFees.length === 0 && resolvedTicketType !== 'PAID') {
        return reply.code(400).send({ error: 'paid_ticket_required' })
      }
      if (!event.paid && eventFees.length === 0 && resolvedTicketType === 'PAID') {
        return reply.code(400).send({ error: 'paid_ticket_not_allowed' })
      }

      const message = body.data.message?.trim() ? body.data.message.trim() : null
      const previous = current.eventRsvps.find((item: { eventId: string; userId: string }) => item.eventId === event.id && item.userId === actorUserId) ?? null
      const existingGoingCount = current.eventRsvps.filter(
        (item: { eventId: string; status: string; userId: string }) => item.eventId === event.id && item.status === 'GOING' && item.userId !== actorUserId,
      ).length
      if (body.data.status === 'GOING' && typeof event.capacity === 'number' && event.capacity > 0 && existingGoingCount >= event.capacity) {
        return reply.code(409).send({ error: 'event_capacity_reached' })
      }

      if (body.data.status === 'GOING' && selectedTicket && typeof selectedTicket.capacity === 'number' && selectedTicket.capacity > 0) {
        const existingTicketGoingCount = current.eventRsvps.filter(
          (item: { eventId: string; status: string; ticketId?: string | null; userId: string }) =>
            item.eventId === event.id && item.status === 'GOING' && item.ticketId === selectedTicket.id && item.userId !== actorUserId,
        ).length
        if (existingTicketGoingCount >= selectedTicket.capacity) {
          return reply.code(409).send({ error: 'ticket_capacity_reached' })
        }
      }

      const nowIso = new Date().toISOString()
      const rsvp = {
        id: previous?.id ?? `rsvp_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        eventId: event.id,
        userId: actorUserId,
        status: body.data.status,
        ticketType: resolvedTicketType,
        ticketId: body.data.status === 'GOING' ? selectedTicket?.id ?? null : null,
        ticketLabel: body.data.status === 'GOING' ? selectedTicket?.label ?? null : null,
        amountCents: body.data.status === 'GOING' && selectedTicket ? selectedTicket.amountCents : null,
        message: body.data.status === 'GOING' ? message : null,
        createdAt: previous?.createdAt ?? nowIso,
        updatedAt: nowIso,
      }

      const nextSystem = {
        ...current,
        eventRsvps: [...current.eventRsvps.filter((item: { eventId: string; userId: string }) => !(item.eventId === event.id && item.userId === actorUserId)), rsvp],
      }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.rsvp.updated',
        reason: null,
        previousValue: previous,
        nextValue: rsvp,
      })

      return reply.send({ ok: true, rsvp })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null

      const params = deps.CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase(), status: 'ACTIVE' },
        select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true, logoUrl: true, coverUrl: true, isVerified: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const system = deps.readOrganizationSystemState(org.metadata)
      const event = system.events.find((item: { id: string }) => item.id === params.data.eventId)
      if (!event) return reply.code(404).send({ error: 'event_not_found' })

      const isDraft = (event.status ?? 'PUBLISHED') === 'DRAFT'
      const viewerGuestInvite = viewerId ? (event.guestSpeakerInvites ?? []).find((invite: { userId: string }) => invite.userId === viewerId) ?? null : null
      const viewerSponsorInvite = viewerId
        ? (event.sponsorInvites ?? []).find(
            (invite: { recipientUserIds?: string[] }) => Array.isArray(invite.recipientUserIds) && invite.recipientUserIds.includes(viewerId),
          ) ?? null
        : null
      const isDraftGuestInvitee = Boolean(viewerGuestInvite && (viewerGuestInvite.status === 'PENDING' || viewerGuestInvite.status === 'ACCEPTED'))
      const isDraftSponsorInvitee = Boolean(viewerSponsorInvite && (viewerSponsorInvite.status === 'PENDING' || viewerSponsorInvite.status === 'ACCEPTED'))
      const hasExistingRsvp = Boolean(viewerId && system.eventRsvps.some((row: { eventId: string; userId: string }) => row.eventId === event.id && row.userId === viewerId))
      const canViewDraft = Boolean(viewerId && (org.ownerId === viewerId || isDraftGuestInvitee || isDraftSponsorInvitee || hasExistingRsvp))

      if (isDraft && !canViewDraft) {
        return reply.code(404).send({ error: 'event_not_found' })
      }

      if (event.access === 'RESTRICTED' && !isDraft) {
        const viewerMember = viewerId ? system.members[viewerId] ?? null : null
        if (!viewerId || !viewerMember || viewerMember.status !== 'ACTIVE') {
          return reply.code(403).send({ error: 'restricted_event' })
        }
        if (event.eligibleRankIds.length > 0 && !event.eligibleRankIds.includes(viewerMember.rankId)) {
          return reply.code(403).send({ error: 'rank_not_eligible' })
        }
      }

      const eventRsvps = system.eventRsvps.filter((row: { eventId: string }) => row.eventId === event.id)
      const feeGoingCounts = new Map<string, number>()
      for (const row of eventRsvps) {
        if (row.status !== 'GOING') continue
        const ticketId = row.ticketId ?? null
        if (!ticketId) continue
        feeGoingCounts.set(ticketId, (feeGoingCounts.get(ticketId) ?? 0) + 1)
      }
      const viewerRsvp = viewerId ? eventRsvps.find((row: { userId: string }) => row.userId === viewerId) ?? null : null
      const goingCount = eventRsvps.filter((row: { status: string }) => row.status === 'GOING').length
      const interestedCount = eventRsvps.filter((row: { status: string }) => row.status === 'INTERESTED').length

      let viewerInvitation: {
        kind: 'guest_speaker' | 'sponsor'
        status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
        notificationId: string | null
        inviter: unknown
      } | null = null

      if (viewerId && (viewerGuestInvite || viewerSponsorInvite)) {
        const invitationKind = viewerGuestInvite ? 'guest_speaker' : 'sponsor'
        const invitationStatus = (viewerGuestInvite?.status ?? viewerSponsorInvite?.status ?? 'PENDING') as 'PENDING' | 'ACCEPTED' | 'DECLINED'

        const notification = await prisma.notification.findFirst({
          where: {
            userId: viewerId,
            type: invitationKind === 'guest_speaker' ? deps.EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE : deps.EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE,
            payload: {
              path: ['eventId'],
              equals: event.id,
            },
          },
          orderBy: { createdAt: 'desc' },
          select: deps.NOTIFICATION_SELECT,
        })

        const inviter = notification?.actorId
          ? await prisma.user.findUnique({ where: { id: notification.actorId }, select: deps.BUSINESS_FRIEND_USER_SELECT })
          : null

        viewerInvitation = {
          kind: invitationKind,
          status: invitationStatus,
          notificationId: invitationStatus === 'PENDING' ? notification?.id ?? null : null,
          inviter: inviter ? deps.formatFriendUser(inviter) : null,
        }
      }

      return reply.send({
        event: {
          id: event.id,
          title: event.title,
          description: event.description,
          category: event.category ?? 'Other',
          access: event.access,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          capacity: event.capacity,
          paid: event.paid,
          priceCents: event.priceCents,
          currency: event.currency,
          guestSpeakers: event.guestSpeakers,
          guestSpeakerInvites: (event.guestSpeakerInvites ?? []).map((invite: Record<string, any>) => ({
            userId: invite.userId,
            name: invite.name,
            handle: invite.handle,
            avatarUrl: deps.normalizeMediaUrl(invite.avatarUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(invite.coverUrl ?? null),
            status: invite.status,
          })),
          sponsors: event.sponsors ?? [],
          sponsorInvites: (event.sponsorInvites ?? []).map((invite: Record<string, any>) => ({
            organizationId: invite.organizationId,
            name: invite.name,
            slug: invite.slug,
            provinceCode: invite.provinceCode,
            communitySlug: invite.communitySlug,
            logoUrl: deps.normalizeMediaUrl(invite.logoUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(invite.coverUrl ?? null),
            status: invite.status,
          })),
          fees: (event.fees ?? []).map((fee: Record<string, any>) => {
            const goingCountForFee = feeGoingCounts.get(fee.id) ?? 0
            const remainingCount = typeof fee.capacity === 'number' && fee.capacity > 0 ? Math.max(0, fee.capacity - goingCountForFee) : null
            return {
              id: fee.id,
              label: fee.label,
              amountCents: fee.amountCents,
              capacity: fee.capacity ?? null,
              cashOnly: fee.cashOnly !== false,
              goingCount: goingCountForFee,
              remainingCount,
            }
          }),
          primaryPhotoUrl: event.primaryPhotoUrl,
          galleryPhotoUrls: event.galleryPhotoUrls,
          status: event.status ?? 'PUBLISHED',
          createdAt: event.createdAt,
          updatedAt: event.updatedAt ?? event.createdAt,
        },
        viewerRsvp: viewerRsvp
          ? {
              id: viewerRsvp.id,
              status: viewerRsvp.status,
              ticketId: viewerRsvp.ticketId ?? null,
              ticketLabel: viewerRsvp.ticketLabel ?? null,
              amountCents: typeof viewerRsvp.amountCents === 'number' ? viewerRsvp.amountCents : null,
              message: viewerRsvp.message ?? null,
              createdAt: viewerRsvp.createdAt,
              updatedAt: viewerRsvp.updatedAt ?? viewerRsvp.createdAt,
            }
          : null,
        rsvpSummary: {
          goingCount,
          interestedCount,
        },
        viewerInvitation,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
          coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
          isVerified: org.isVerified,
        },
      })
    }),
  )
}