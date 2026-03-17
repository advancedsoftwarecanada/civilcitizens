import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type OrganizationCoreDeps = Record<string, any>

function resolveOrganizationCommunitySlug(deps: OrganizationCoreDeps, province: string, municipalityRaw: string) {
  const communitySlug = municipalityRaw.trim().toLowerCase()
  if (!communitySlug) return null
  const community = deps.findCommunity(province, communitySlug)
  return community?.slug ?? communitySlug
}

export function registerOrganizationCoreRoutes(app: FastifyInstance, deps: OrganizationCoreDeps) {
  app.get('/communities/:province/:municipality/orgs', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const query = deps.CommunityOrgListQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communitySlug = params.data.municipality.trim().toLowerCase()
      if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const authContext = await deps.loadViewerAuthContext(req)
      const viewerId = authContext ? (authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId) : undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)

      const where: Prisma.BusinessWhereInput = viewerId
        ? { provinceCode: province, communitySlug: community.slug, OR: [{ status: 'ACTIVE' }, { ownerId: viewerId }] }
        : { provinceCode: province, communitySlug: community.slug, status: 'ACTIVE' }

      deps.applyVisibleModerationFiltersToBusinessWhere(where, viewerBlockState)

      const orgs = (await prisma.business.findMany({
        where,
        orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
        take: query.data.limit,
        select: {
          id: true,
          ownerId: true,
          provinceCode: true,
          communitySlug: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          metadata: true,
          status: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { follows: true } },
        },
      })) as Array<{ id: string } & Record<string, unknown>>

      let followedSet = new Set<string>()
      if (viewerId && orgs.length) {
        const follows = await prisma.businessFollow.findMany({
          where: { userId: viewerId, businessId: { in: orgs.map((org: { id: string }) => org.id) } },
          select: { businessId: true },
        })
        followedSet = new Set(follows.map((follow: { businessId: string }) => follow.businessId))
      }

      return reply.send({
        provinceCode: province,
        communitySlug: community.slug,
        items: orgs.map((org: { id: string } & Record<string, unknown>) => deps.buildCommunityOrgPayload(org, followedSet.has(org.id))),
      })
    }),
  )

  app.get('/organizations/directory', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = deps.OrganizationsDirectoryQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const viewerId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)

      const where: Prisma.BusinessWhereInput = {
        status: 'ACTIVE',
        ...(query.data.type ? { type: query.data.type } : {}),
        ...(query.data.q ? { name: { contains: query.data.q, mode: 'insensitive' } } : {}),
      }

      deps.applyVisibleModerationFiltersToBusinessWhere(where, viewerBlockState)

      const items = (await prisma.business.findMany({
        where,
        orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
        take: query.data.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          provinceCode: true,
          communitySlug: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          phone: true,
          websiteUrl: true,
          address: true,
          schedule: true,
        },
      })) as Array<Record<string, unknown> & {
        id: string
        name: string
        slug: string
        type: string
        provinceCode: string | null
        communitySlug: string | null
        isVerified: boolean | null
        logoUrl: string | null
        coverUrl: string | null
        phone: string | null
        websiteUrl: string | null
        address: string | null
        schedule: Prisma.JsonValue | null
      }>

      return reply.send({
        items: items
          .filter((row: { provinceCode: string | null; communitySlug: string | null }) => Boolean(row.provinceCode) && Boolean(row.communitySlug))
          .map((row) => ({
            logoUrl: row.logoUrl ?? null,
            coverUrl: row.coverUrl ?? null,
            phone: row.phone ?? null,
            websiteUrl: row.websiteUrl ?? null,
            address: row.address ?? null,
            schedule: row.schedule ?? null,
            id: row.id,
            name: row.name,
            slug: row.slug,
            type: row.type,
            provinceCode: row.provinceCode as string,
            communitySlug: row.communitySlug as string,
            isVerified: Boolean(row.isVerified),
          })),
      })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const resolvedCommunitySlug = resolveOrganizationCommunitySlug(deps, province, params.data.municipality)
      if (!resolvedCommunitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: resolvedCommunitySlug, slug },
        select: {
          id: true,
          ownerId: true,
          provinceCode: true,
          communitySlug: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          metadata: true,
          status: true,
          moderationStatus: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { follows: true } },
        },
      })

      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const viewerId = (req as any).user?.id as string | undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)
      if (deps.isBusinessHiddenFromViewer(org, viewerBlockState)) {
        return reply.code(404).send({ error: 'organization_not_found' })
      }

      const viewerRole = viewerId
        ? org.ownerId === viewerId
          ? 'OWNER'
          : ((await prisma.businessMembership.findUnique({
              where: { businessId_userId: { businessId: org.id, userId: viewerId } },
              select: { role: true },
            }))?.role as 'OWNER' | 'MANAGER' | undefined) ?? null
        : null

      if ((org.status !== 'ACTIVE' || org.moderationStatus !== deps.ModerationStatus.VISIBLE) && !viewerRole) {
        return reply.code(404).send({ error: 'organization_not_found' })
      }

      const viewerFollowed = viewerId
        ? Boolean(
            await prisma.businessFollow.findUnique({
              where: { businessId_userId: { businessId: org.id, userId: viewerId } },
              select: { id: true },
            }),
          )
        : false

      return reply.send({ org: deps.buildCommunityOrgPayload(org, viewerFollowed, viewerRole) })
    }),
  )

  app.post('/communities/:province/:municipality/orgs', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communitySlug = params.data.municipality.trim().toLowerCase()
      if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const ownedCount = await prisma.business.count({ where: { ownerId: userId } })
      if (ownedCount >= deps.MAX_BUSINESSES_PER_USER) return reply.code(403).send({ error: 'business_limit_reached' })

      const desiredSlugRaw = body.data.slug?.trim() || ''
      const desiredSlug = desiredSlugRaw ? deps.trimSlugLength(deps.slugifyText(desiredSlugRaw.toLowerCase()), 80) : null
      const baseSlug = desiredSlug || deps.trimSlugLength(deps.slugifyText(body.data.name), 80) || 'organization'
      const slug = await deps.ensureUniqueCommunityOrgSlug({ provinceCode: province, communitySlug: community.slug, baseSlug })

      const type = (body.data.type ?? 'LOCAL_BUSINESS') as any
      const initialOrgSystem = deps.readOrganizationSystemState(null)
      initialOrgSystem.members[userId] = {
        rankId: deps.SYSTEM_MANAGER_RANK_ID,
        planId: null,
        status: 'ACTIVE',
        referredByUserId: null,
        reputation: 0,
        updatedAt: new Date().toISOString(),
      }

      const org = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.business.create({
          data: {
            ownerId: userId,
            provinceCode: province,
            communitySlug: community.slug,
            name: body.data.name.trim(),
            slug,
            type,
            description: body.data.description?.trim() ? deps.sanitizePlainText(body.data.description).trim() : null,
            metadata: deps.mergeOrganizationSystemStateIntoMetadata(null, initialOrgSystem),
            status: 'ACTIVE',
          },
          select: { id: true },
        })

        await tx.businessFollow.upsert({
          where: { businessId_userId: { businessId: created.id, userId } },
          create: { businessId: created.id, userId },
          update: {},
          select: { id: true },
        })

        await tx.businessMembership.upsert({
          where: { businessId_userId: { businessId: created.id, userId } },
          create: { businessId: created.id, userId, role: 'OWNER' },
          update: { role: 'OWNER' },
          select: { id: true },
        })

        await deps.appendOrganizationAuditLogEntry(tx, created.id, {
          actorUserId: userId,
          action: 'organization.created',
          reason: null,
          previousValue: null,
          nextValue: { name: body.data.name.trim(), slug, type, provinceCode: province, communitySlug: community.slug },
        })

        return tx.business.findUnique({
          where: { id: created.id },
          select: {
            id: true,
            ownerId: true,
            provinceCode: true,
            communitySlug: true,
            name: true,
            slug: true,
            type: true,
            description: true,
            metadata: true,
            status: true,
            isVerified: true,
            logoUrl: true,
            coverUrl: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { follows: true } },
          },
        })
      })

      void deps.enqueueContentAiScanForOrganization(org).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_organization_create_failed', error)
      })

      return reply.code(201).send({ org: deps.buildCommunityOrgPayload(org, true) })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/follow', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const resolvedCommunitySlug = resolveOrganizationCommunitySlug(deps, province, params.data.municipality)
      if (!resolvedCommunitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: resolvedCommunitySlug, slug, status: 'ACTIVE', moderationStatus: deps.ModerationStatus.VISIBLE },
        select: { id: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      await prisma.businessFollow.upsert({
        where: { businessId_userId: { businessId: org.id, userId } },
        create: { businessId: org.id, userId },
        update: {},
        select: { id: true },
      })

      return reply.send({ ok: true })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/follow', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const resolvedCommunitySlug = resolveOrganizationCommunitySlug(deps, province, params.data.municipality)
      if (!resolvedCommunitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: resolvedCommunitySlug, slug },
        select: { id: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      await prisma.businessFollow.deleteMany({ where: { businessId: org.id, userId } })
      return reply.send({ ok: true })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/settings', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgSettingsBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const resolvedCommunitySlug = resolveOrganizationCommunitySlug(deps, province, params.data.municipality)
      if (!resolvedCommunitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: resolvedCommunitySlug, slug },
        select: { id: true, ownerId: true, name: true, metadata: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership) return reply.code(403).send({ error: 'forbidden' })

      const nextData: Prisma.BusinessUpdateInput = {}
      let nextMetadata = org.metadata && typeof org.metadata === 'object' && !Array.isArray(org.metadata)
        ? ({ ...(org.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {}
      if ('name' in body.data && typeof body.data.name === 'string') {
        if (!isOwner) return reply.code(403).send({ error: 'owner_required_for_rename' })
        const nextName = body.data.name.trim()
        if (nextName && nextName !== org.name) nextData.name = nextName
      }
      if ('phone' in body.data) nextData.phone = body.data.phone ? body.data.phone : null
      if ('websiteUrl' in body.data) nextData.websiteUrl = body.data.websiteUrl ? body.data.websiteUrl : null
      if ('address' in body.data) nextData.address = body.data.address ? body.data.address : null
      if ('addressDetails' in body.data) {
        const normalizedAddress = body.data.addressDetails ? deps.normalizeStructuredAddressInput(body.data.addressDetails) : null
        nextMetadata = deps.mergeOrganizationAddressDetailsIntoMetadata(nextMetadata, normalizedAddress) as Record<string, unknown>
        nextData.address = normalizedAddress ? deps.formatStructuredAddress(normalizedAddress) : null
      }
      if ('schedule' in body.data) nextData.schedule = body.data.schedule ? body.data.schedule : null
      if ('description' in body.data) nextData.description = body.data.description ? deps.sanitizePlainText(body.data.description).trim() || null : null
      if ('headline' in body.data) {
        const nextHeadline = body.data.headline?.trim() ?? ''
        if (nextHeadline) nextMetadata.headline = nextHeadline.slice(0, 60)
        else delete nextMetadata.headline
      }
      if ('isPublic' in body.data && typeof body.data.isPublic === 'boolean') nextData.status = body.data.isPublic ? 'ACTIVE' : 'DRAFT'
      if ('headline' in body.data || 'addressDetails' in body.data) nextData.metadata = nextMetadata as Prisma.InputJsonValue

      if (body.data.logoMediaId) {
        const asset = await prisma.mediaAsset.findFirst({ where: { id: body.data.logoMediaId, ownerId: userId }, select: { id: true, category: true, status: true } })
        if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
        if (asset.category !== 'business_logo') return reply.code(400).send({ error: 'invalid_logo_category' })
        nextData.logoMedia = { connect: { id: asset.id } }
        nextData.logoUrl = null
      }
      if (body.data.coverMediaId) {
        const asset = await prisma.mediaAsset.findFirst({ where: { id: body.data.coverMediaId, ownerId: userId }, select: { id: true, category: true, status: true } })
        if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
        if (asset.category !== 'business_cover') return reply.code(400).send({ error: 'invalid_cover_category' })
        nextData.coverMedia = { connect: { id: asset.id } }
        nextData.coverUrl = null
      }

      const updated = await prisma.business.update({
        where: { id: org.id },
        data: nextData,
        select: {
          id: true,
          ownerId: true,
          provinceCode: true,
          communitySlug: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          metadata: true,
          phone: true,
          websiteUrl: true,
          address: true,
          schedule: true,
          status: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { follows: true } },
        },
      })

      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId: userId,
        action: 'organization.settings.updated',
        reason: null,
        previousValue: null,
        nextValue: { changedKeys: Object.keys(nextData) },
      })

      void deps.enqueueContentAiScanForOrganization(updated).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_organization_update_failed', error)
      })

      return reply.send({ org: deps.buildCommunityOrgPayload(updated, true, membership.role as any) })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, name: true, status: true, moderationStatus: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership) return reply.code(403).send({ error: 'forbidden' })

      const deletedAt = new Date().toISOString()
      const nextMetadata = org.metadata && typeof org.metadata === 'object' && !Array.isArray(org.metadata)
        ? ({ ...(org.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {}
      nextMetadata.deletion = {
        deletedAt,
        deletedByUserId: userId,
        deletedByRole: membership.role,
        previousStatus: org.status,
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.business.update({
          where: { id: org.id },
          data: {
            status: deps.BusinessStatus.CANCELED,
            moderationStatus: deps.ModerationStatus.QUARANTINED,
            metadata: nextMetadata as Prisma.InputJsonValue,
          },
        })

        await tx.post.updateMany({
          where: { businessId: org.id },
          data: {
            moderationStatus: deps.ModerationStatus.QUARANTINED,
            visibility: 'deleted',
          },
        })

        await deps.appendOrganizationAuditLogEntry(tx, org.id, {
          actorUserId: userId,
          action: 'organization.deleted',
          reason: null,
          previousValue: { status: org.status, moderationStatus: org.moderationStatus, name: org.name },
          nextValue: {
            status: deps.BusinessStatus.CANCELED,
            moderationStatus: deps.ModerationStatus.QUARANTINED,
            deletedAt,
          },
        })
      })

      return reply.send({ ok: true })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/members', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const communitySlug = params.data.municipality.trim().toLowerCase()
      if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })
      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({ where: { provinceCode: province, communitySlug: community.slug, slug }, select: { id: true, ownerId: true, name: true } })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const [owner, managers, followers] = await Promise.all([
        prisma.user.findUnique({ where: { id: org.ownerId }, select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true } }),
        prisma.businessMembership.findMany({
          where: { businessId: org.id, userId: { not: org.ownerId } },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          select: { userId: true, role: true, createdAt: true, user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true } } },
        }),
        prisma.businessFollow.findMany({
          where: { businessId: org.id, userId: { not: org.ownerId } },
          orderBy: { createdAt: 'asc' },
          select: { userId: true, createdAt: true, user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true } } },
        }),
      ])

      const memberUserIds = Array.from(new Set<string>([
        ...(owner ? [owner.id] : []),
        ...managers.map((row: { userId: string }) => row.userId),
        ...followers.map((row: { userId: string }) => row.userId),
      ]))

      const memberExperienceByUserId = new Map<string, { title: string | null; description: string | null }>()
      if (memberUserIds.length > 0) {
        const experiences = await prisma.experience.findMany({
          where: { userId: { in: memberUserIds }, organization: { equals: org.name, mode: 'insensitive' } },
          orderBy: [{ current: 'desc' }, { startDate: 'desc' }, { position: 'asc' }],
          select: { userId: true, title: true, description: true },
        })

        for (const exp of experiences) {
          if (memberExperienceByUserId.has(exp.userId)) continue
          const title = exp.title.trim()
          const description = typeof exp.description === 'string' ? exp.description.trim() : ''
          if (!title && !description) continue
          memberExperienceByUserId.set(exp.userId, { title: title || null, description: description || null })
        }
      }

      const managerIds = new Set(managers.map((row: { userId: string }) => row.userId))
      const memberItems = [
        ...(owner ? [{
          userId: owner.id,
          role: 'OWNER' as const,
          joinedAt: null,
          jobTitle: memberExperienceByUserId.get(owner.id)?.title ?? null,
          jobDescription: memberExperienceByUserId.get(owner.id)?.description ?? null,
          user: { id: owner.id, handle: owner.handle, name: owner.name, avatarUrl: deps.normalizeMediaUrl(owner.avatarUrl ?? null), coverUrl: deps.normalizeMediaUrl(owner.coverUrl ?? null) },
        }] : []),
        ...managers.map((row: { userId: string; role: any; createdAt: Date; user: { id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl: string | null } }) => ({
          userId: row.userId,
          role: row.role,
          joinedAt: row.createdAt,
          jobTitle: memberExperienceByUserId.get(row.userId)?.title ?? null,
          jobDescription: memberExperienceByUserId.get(row.userId)?.description ?? null,
          user: { id: row.user.id, handle: row.user.handle, name: row.user.name, avatarUrl: deps.normalizeMediaUrl(row.user.avatarUrl ?? null), coverUrl: deps.normalizeMediaUrl(row.user.coverUrl ?? null) },
        })),
      ]

      const followerItems = followers
        .filter((row: { userId: string }) => !managerIds.has(row.userId))
        .map((row: { userId: string; createdAt: Date; user: { id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl: string | null } }) => ({
          userId: row.userId,
          role: 'FOLLOWER' as const,
          joinedAt: row.createdAt,
          jobTitle: memberExperienceByUserId.get(row.userId)?.title ?? null,
          jobDescription: memberExperienceByUserId.get(row.userId)?.description ?? null,
          user: { id: row.user.id, handle: row.user.handle, name: row.user.name, avatarUrl: deps.normalizeMediaUrl(row.user.avatarUrl ?? null), coverUrl: deps.normalizeMediaUrl(row.user.coverUrl ?? null) },
        }))

      return reply.send({ members: memberItems, followers: followerItems })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/members/:userId/promote', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMemberParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const communitySlug = params.data.municipality.trim().toLowerCase()
      if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })
      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({ where: { provinceCode: province, communitySlug: community.slug, slug }, select: { id: true, ownerId: true } })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.ownerId !== userId) return reply.code(403).send({ error: 'forbidden' })
      if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_promote_owner' })

      const follow = await prisma.businessFollow.findUnique({ where: { businessId_userId: { businessId: org.id, userId: params.data.userId } }, select: { id: true } })
      if (!follow) return reply.code(400).send({ error: 'user_must_follow_org' })

      await prisma.businessMembership.upsert({
        where: { businessId_userId: { businessId: org.id, userId: params.data.userId } },
        create: { businessId: org.id, userId: params.data.userId, role: 'MANAGER' },
        update: { role: 'MANAGER' },
        select: { id: true },
      })

      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId: userId,
        action: 'member.promoted',
        reason: null,
        previousValue: { userId: params.data.userId },
        nextValue: { userId: params.data.userId, role: 'MANAGER' },
      })

      return reply.send({ ok: true })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/members/:userId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMemberParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const communitySlug = params.data.municipality.trim().toLowerCase()
      if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })
      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({ where: { provinceCode: province, communitySlug: community.slug, slug }, select: { id: true, ownerId: true } })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.ownerId !== userId) return reply.code(403).send({ error: 'forbidden' })
      if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_remove_owner' })

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
        await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
        await deps.appendOrganizationAuditLogEntry(tx, org.id, {
          actorUserId: userId,
          action: 'member.removed',
          reason: null,
          previousValue: { targetUserId: params.data.userId },
          nextValue: null,
        })
      })

      return reply.send({ ok: true })
    }),
  )
}