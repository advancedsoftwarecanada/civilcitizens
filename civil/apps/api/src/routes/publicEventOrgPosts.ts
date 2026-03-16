import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

type PublicEventOrgPostDeps = Record<string, any>

function resolveOrganizationCommunitySlug(deps: PublicEventOrgPostDeps, province: string, municipalityRaw: string) {
  const communitySlug = municipalityRaw.trim().toLowerCase()
  if (!communitySlug) return null
  const community = deps.findCommunity(province, communitySlug)
  return community?.slug ?? communitySlug
}

export function registerPublicEventOrgPostRoutes(app: FastifyInstance, deps: PublicEventOrgPostDeps) {
  app.get('/events', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(500).default(120),
          includePast: z.coerce.boolean().default(false),
          mine: z.enum(['going']).optional(),
        })
        .safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const viewerId = (await deps.resolveUserId(req)) ?? null
      const now = Date.now()
      const organizationIds = new Set<string>()
      const communityKeys = new Set<string>()

      if (viewerId) {
        const [communityFollows, businessFollows, businessMemberships, ownedBusinesses] = await Promise.all([
          prisma.communityFollow.findMany({ where: { userId: viewerId }, select: { provinceCode: true, communitySlug: true } }),
          prisma.businessFollow.findMany({ where: { userId: viewerId }, select: { businessId: true } }),
          prisma.businessMembership.findMany({ where: { userId: viewerId }, select: { businessId: true } }),
          prisma.business.findMany({ where: { ownerId: viewerId }, select: { id: true } }),
        ])

        for (const follow of communityFollows) {
          if (!follow.provinceCode || !follow.communitySlug) continue
          communityKeys.add(`${follow.provinceCode}:${follow.communitySlug}`)
        }
        for (const follow of businessFollows) organizationIds.add(follow.businessId)
        for (const membership of businessMemberships) organizationIds.add(membership.businessId)
        for (const owned of ownedBusinesses) organizationIds.add(owned.id)
      }

      const whereOr: Prisma.BusinessWhereInput[] = []
      if (organizationIds.size) whereOr.push({ id: { in: [...organizationIds] } })
      if (communityKeys.size) {
        whereOr.push({
          OR: [...communityKeys].map((key) => {
            const [provinceCode, communitySlug] = key.split(':')
            return { provinceCode, communitySlug }
          }),
        })
      }

      if (viewerId && whereOr.length === 0) return reply.send({ items: [] })

      const organizations = await prisma.business.findMany({
        where: { status: deps.BusinessStatus.ACTIVE, ...(whereOr.length ? { OR: whereOr } : {}) },
        select: { id: true, name: true, slug: true, provinceCode: true, communitySlug: true, logoUrl: true, isVerified: true, metadata: true },
        take: 1000,
      })

      const items = organizations.flatMap((org: any) => {
        const system = deps.readOrganizationSystemState(org.metadata)
        const matchedByOrganization = organizationIds.has(org.id)
        const matchedByCommunity = org.provinceCode && org.communitySlug ? communityKeys.has(`${org.provinceCode}:${org.communitySlug}`) : false

        return system.events
          .filter((event: any) => (event.status ?? 'PUBLISHED') === 'PUBLISHED' && event.access === 'PUBLIC')
          .filter((event: any) => {
            if (query.data.mine !== 'going') return true
            return system.eventRsvps.some((rsvp: any) => rsvp.eventId === event.id && rsvp.userId === viewerId && rsvp.status === 'GOING')
          })
          .filter((event: any) => {
            if (query.data.includePast) return true
            const startsAtMs = Date.parse(event.startsAt)
            return Number.isFinite(startsAtMs) ? startsAtMs >= now : true
          })
          .map((event: any) => ({
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
            primaryPhotoUrl: event.primaryPhotoUrl,
            galleryPhotoUrls: event.galleryPhotoUrls,
            status: event.status ?? 'PUBLISHED',
            createdAt: event.createdAt,
            updatedAt: event.updatedAt ?? event.createdAt,
            organization: {
              id: org.id,
              name: org.name,
              slug: org.slug,
              provinceCode: org.provinceCode,
              communitySlug: org.communitySlug,
              logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
              isVerified: org.isVerified,
            },
            matchedBy: { organization: matchedByOrganization, community: matchedByCommunity },
          }))
      })

      items.sort((a: any, b: any) => {
        const aTime = Date.parse(a.startsAt)
        const bTime = Date.parse(b.startsAt)
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime
        if (a.organization.name !== b.organization.name) return a.organization.name.localeCompare(b.organization.name)
        return a.title.localeCompare(b.title)
      })

      return reply.send({ items: items.slice(0, query.data.limit) })
    }),
  )

  app.get('/events/sidebar', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const [communityFollows, businessFollows, businessMemberships, ownedBusinesses] = await Promise.all([
        prisma.communityFollow.findMany({ where: { userId }, select: { provinceCode: true, communitySlug: true } }),
        prisma.businessFollow.findMany({ where: { userId }, select: { businessId: true } }),
        prisma.businessMembership.findMany({ where: { userId }, select: { businessId: true, role: true } }),
        prisma.business.findMany({ where: { ownerId: userId, status: deps.BusinessStatus.ACTIVE }, select: { id: true } }),
      ])

      const organizationIds = new Set<string>([
        ...businessFollows.map((row: { businessId: string }) => row.businessId),
        ...businessMemberships.map((row: { businessId: string }) => row.businessId),
        ...ownedBusinesses.map((row: { id: string }) => row.id),
      ])
      const communityPairs = communityFollows
        .filter((row: { provinceCode: string | null; communitySlug: string | null }) => Boolean(row.provinceCode && row.communitySlug))
        .map((row: { provinceCode: string | null; communitySlug: string | null }) => ({ provinceCode: row.provinceCode, communitySlug: row.communitySlug }))

      const whereOr: Prisma.BusinessWhereInput[] = []
      if (organizationIds.size) whereOr.push({ id: { in: [...organizationIds] } })
      if (communityPairs.length) whereOr.push({ OR: communityPairs })

      const organizations = await prisma.business.findMany({
        where: { status: deps.BusinessStatus.ACTIVE, ...(whereOr.length ? { OR: whereOr } : {}) },
        select: {
          id: true,
          ownerId: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          metadata: true,
        },
        take: 1000,
      })

      const membershipRoleMap = new Map<string, 'MANAGER' | null>()
      for (const membership of businessMemberships) {
        membershipRoleMap.set(membership.businessId, membership.role === 'MANAGER' ? 'MANAGER' : null)
      }

      const now = Date.now()
      const rsvps: any[] = []
      const manageableOrganizations: any[] = []

      for (const org of organizations) {
        const system = deps.readOrganizationSystemState(org.metadata)
        const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === userId ? 'OWNER' : (membershipRoleMap.get(org.id) ?? null)
        const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId })

        if (deps.canOrganizationPermission(permissions, 'manage_events')) {
          manageableOrganizations.push({
            id: org.id,
            name: org.name,
            slug: org.slug,
            provinceCode: org.provinceCode,
            communitySlug: org.communitySlug,
            isVerified: org.isVerified,
            logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
          })
        }

        const userRsvps = system.eventRsvps.filter((row: any) => row.userId === userId && row.status === 'GOING')
        if (!userRsvps.length) continue

        for (const row of userRsvps) {
          const event = system.events.find((item: any) => item.id === row.eventId)
          if (!event || (event.status ?? 'PUBLISHED') !== 'PUBLISHED') continue
          const startsAtMs = Date.parse(event.startsAt)
          if (Number.isFinite(startsAtMs) && startsAtMs < now) continue

          rsvps.push({
            id: row.id,
            eventId: event.id,
            title: event.title,
            startsAt: event.startsAt,
            primaryPhotoUrl: event.primaryPhotoUrl ?? null,
            organization: {
              id: org.id,
              name: org.name,
              slug: org.slug,
              provinceCode: org.provinceCode,
              communitySlug: org.communitySlug,
              isVerified: org.isVerified,
            },
          })
        }
      }

      rsvps.sort((a: any, b: any) => {
        const aTime = Date.parse(a.startsAt)
        const bTime = Date.parse(b.startsAt)
        if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime
        return a.title.localeCompare(b.title)
      })
      manageableOrganizations.sort((a: any, b: any) => a.name.localeCompare(b.name))

      return reply.send({ rsvps: rsvps.slice(0, 12), manageableOrganizations: manageableOrganizations.slice(0, 12) })
    }),
  )

  app.get('/events/:organizationId/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      const params = z.object({ organizationId: z.string().trim().min(1).max(120), eventId: z.string().trim().min(3).max(120) }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const org = await prisma.business.findFirst({
        where: { id: params.data.organizationId, status: deps.BusinessStatus.ACTIVE },
        select: { id: true, name: true, slug: true, provinceCode: true, communitySlug: true, logoUrl: true, coverUrl: true, isVerified: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const system = deps.readOrganizationSystemState(org.metadata)
      const event = system.events.find((item: any) => item.id === params.data.eventId)
      if (!event || (event.status ?? 'PUBLISHED') !== 'PUBLISHED' || event.access !== 'PUBLIC') {
        return reply.code(404).send({ error: 'event_not_found' })
      }

      const eventRsvps = system.eventRsvps.filter((row: any) => row.eventId === event.id)
      const feeGoingCounts = new Map<string, number>()
      for (const row of eventRsvps) {
        if (row.status !== 'GOING') continue
        const ticketId = row.ticketId ?? null
        if (!ticketId) continue
        feeGoingCounts.set(ticketId, (feeGoingCounts.get(ticketId) ?? 0) + 1)
      }
      const viewerRsvp = viewerId ? eventRsvps.find((row: any) => row.userId === viewerId) ?? null : null
      const goingCount = eventRsvps.filter((row: any) => row.status === 'GOING').length
      const interestedCount = eventRsvps.filter((row: any) => row.status === 'INTERESTED').length

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
          fees: (event.fees ?? []).map((fee: any) => {
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
          guestSpeakers: event.guestSpeakers,
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
        rsvpSummary: { goingCount, interestedCount },
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

  app.get('/communities/:province/:municipality/orgs/:slug/posts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const query = deps.CursorQuery.extend({ jurisdiction: deps.JurisdictionEnum.optional(), sort: deps.PostSortEnum.optional() }).safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const resolvedCommunitySlug = resolveOrganizationCommunitySlug(deps, province, params.data.municipality)
      if (!resolvedCommunitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({ where: { provinceCode: province, communitySlug: resolvedCommunitySlug, slug }, select: { id: true, ownerId: true, moderationStatus: true } })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) return reply.code(404).send({ error: 'organization_not_found' })

      const { cursor, limit, jurisdiction, sort } = query.data
      const sortMode = sort ?? 'new'
      const where: Prisma.PostWhereInput = { businessId: org.id, ...(jurisdiction ? { jurisdiction } : {}) }

      const viewerId = (req as any).user?.id as string | undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)
      if (viewerBlockState.blockedBusinessIds.has(org.id)) return reply.code(404).send({ error: 'organization_not_found' })
      deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

      if (viewerId) {
        const isOwner = org.ownerId === viewerId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId: viewerId } }, select: { role: true } })
        if (!membership) where.visibility = 'public'
      } else {
        where.visibility = 'public'
      }

      let posts: any[] = []
      let nextCursor: string | undefined
      if (sortMode === 'hot') {
        posts = await prisma.post.findMany({ where, take: limit, orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }], include: deps.POST_INCLUDE })
      } else {
        const queryResult = await prisma.post.findMany({ where, take: limit + 1, orderBy: { createdAt: 'desc' }, include: deps.POST_INCLUDE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
        if (queryResult.length > limit) {
          const next = queryResult.pop()
          nextCursor = next?.id
        }
        posts = queryResult
      }

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(viewerId, posts.map((post: any) => post.id), 5)

      return reply.send({
        items: posts.map((post: any) =>
          deps.formatPost(post, {
            viewerId,
            viewerReaction: reactionsByPost[post.id] ?? null,
            viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
            recentComments: recentCommentsByPost[post.id] ?? [],
          }),
        ),
        nextCursor,
      })
    }),
  )
}