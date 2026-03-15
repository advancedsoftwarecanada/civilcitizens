import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'

type OrganizationGovernanceAdminDeps = Record<string, any>

export function registerOrganizationGovernanceAdminRoutes(
  app: FastifyInstance,
  deps: OrganizationGovernanceAdminDeps,
) {
  app.post('/communities/:province/:municipality/orgs/:slug/governance/economics', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgEconomicsRecordBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'manage_membership_plans')) return reply.code(403).send({ error: 'forbidden' })
      if (body.data.kind === 'event') {
        if (!body.data.eventId) return reply.code(400).send({ error: 'event_id_required' })
        if (!current.events.some((item: { id: string }) => item.id === body.data.eventId)) return reply.code(404).send({ error: 'event_not_found' })
      }

      const record = {
        id: `eco_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        kind: body.data.kind,
        amountCents: body.data.amountCents,
        currency: body.data.currency.toUpperCase(),
        memberUserId: body.data.memberUserId ?? null,
        eventId: body.data.eventId ?? null,
        note: body.data.note ?? null,
        createdAt: new Date().toISOString(),
      }

      const nextSystem = { ...current, economics: [...current.economics, record] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'economics.recorded',
        reason: body.data.note ?? null,
        previousValue: null,
        nextValue: record,
      })

      return reply.code(201).send({ record })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/governance/analytics', async (req: FastifyRequest, reply: FastifyReply) =>
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

      const system = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'view_audit_logs')) return reply.code(403).send({ error: 'forbidden' })

      const activeMembers = Object.values(system.members).filter((member: any) => member.status === 'ACTIVE').length
      const pendingMembers = Object.values(system.members).filter((member: any) => member.status === 'PENDING').length
      const totalRevenueCents = system.economics.reduce((sum: number, item: any) => sum + item.amountCents, 0)
      const paidEvents = system.events.filter((event: any) => event.paid).length
      const totalRsvps = system.eventRsvps.length
      const goingRsvps = system.eventRsvps.filter((item: any) => item.status === 'GOING').length
      const topReputation = Object.entries(system.members)
        .map(([userId, member]: [string, any]) => ({ userId, reputation: member.reputation }))
        .sort((a, b) => b.reputation - a.reputation)
        .slice(0, 10)

      return reply.send({
        summary: {
          activeMembers,
          pendingMembers,
          totalMembersTracked: Object.keys(system.members).length,
          plans: system.plans.length,
          referrals: system.referrals.length,
          achievements: system.achievements.length,
          awards: system.achievementAwards.length,
          paidEvents,
          events: system.events.length,
          totalRsvps,
          goingRsvps,
          totalRevenueCents,
        },
        topReputation,
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/members/:userId/status', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMemberParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMemberStatusBody.safeParse(req.body ?? {})
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
      const previous = current.members[params.data.userId] ?? null
      const wantsRemoval = body.data.status === 'BANNED' || body.data.status === 'SUSPENDED'
      if (wantsRemoval && !deps.canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

      const nextRankIdRaw = body.data.rankId ?? null
      const nextRankId = nextRankIdRaw === null ? previous?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID : nextRankIdRaw
      const rankChanged = Boolean(nextRankId && nextRankId !== (previous?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID))
      if (rankChanged) {
        const canChangeRank =
          deps.canOrganizationPermission(permissions, 'promote_members') ||
          deps.canOrganizationPermission(permissions, 'demote_members') ||
          deps.canOrganizationPermission(permissions, 'create_ranks')
        if (!canChangeRank) return reply.code(403).send({ error: 'forbidden' })
      }
      if (!wantsRemoval && body.data.status !== (previous?.status ?? 'PENDING')) {
        if (!deps.canOrganizationPermission(permissions, 'approve_members')) return reply.code(403).send({ error: 'forbidden' })
      }

      const nextMemberState = {
        rankId: nextRankId,
        planId: body.data.planId ?? previous?.planId ?? null,
        status: body.data.status,
        referredByUserId: previous?.referredByUserId ?? null,
        reputation: previous?.reputation ?? 0,
        updatedAt: new Date().toISOString(),
      }

      const nextSystem = {
        ...current,
        members: {
          ...current.members,
          [params.data.userId]: nextMemberState,
        },
      }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'member.status_changed',
        reason: body.data.reason ?? null,
        previousValue: { userId: params.data.userId, member: previous },
        nextValue: { userId: params.data.userId, member: nextMemberState },
      })

      return reply.send({ ok: true, member: nextMemberState })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/governance/members', async (req: FastifyRequest, reply: FastifyReply) =>
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
        select: { id: true, ownerId: true, metadata: true, name: true, slug: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const system = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
      const canView =
        deps.canOrganizationPermission(permissions, 'approve_members') ||
        deps.canOrganizationPermission(permissions, 'remove_members') ||
        deps.canOrganizationPermission(permissions, 'promote_members') ||
        deps.canOrganizationPermission(permissions, 'demote_members')
      if (!canView) return reply.code(403).send({ error: 'forbidden' })

      const [owner, managers, followers] = await Promise.all([
        prisma.user.findUnique({ where: { id: org.ownerId }, select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true, communityMeta: true } }),
        prisma.businessMembership.findMany({
          where: { businessId: org.id, userId: { not: org.ownerId } },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          select: {
            userId: true,
            role: true,
            createdAt: true,
            user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true, communityMeta: true } },
          },
        }),
        prisma.businessFollow.findMany({
          where: { businessId: org.id, userId: { not: org.ownerId } },
          orderBy: { createdAt: 'asc' },
          select: {
            userId: true,
            createdAt: true,
            user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true, communityMeta: true } },
          },
        }),
      ])

      const managerIds = new Set(managers.map((row: any) => row.userId))
      const items = [
        ...(owner
          ? [
              {
                userId: owner.id,
                membershipRole: 'OWNER',
                joinedAt: null,
                user: {
                  id: owner.id,
                  handle: owner.handle,
                  name: owner.name,
                  avatarUrl: deps.normalizeMediaUrl(owner.avatarUrl ?? null),
                  coverUrl: deps.normalizeMediaUrl(owner.coverUrl ?? null),
                  isPremium: deps.isPremium(owner.premiumStatus),
                  isVerified: deps.isSelfVerifiedCanadianCitizen(deps.parseCommunityMeta(owner.communityMeta ?? null)),
                },
                memberState:
                  system.members[owner.id] ??
                  {
                    rankId: deps.SYSTEM_MANAGER_RANK_ID,
                    planId: null,
                    status: 'ACTIVE',
                    referredByUserId: null,
                    reputation: 0,
                    updatedAt: new Date().toISOString(),
                  },
              },
            ]
          : []),
        ...managers.map((row: any) => ({
          userId: row.userId,
          membershipRole: row.role,
          joinedAt: row.createdAt,
          user: {
            id: row.user.id,
            handle: row.user.handle,
            name: row.user.name,
            avatarUrl: deps.normalizeMediaUrl(row.user.avatarUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(row.user.coverUrl ?? null),
            isPremium: deps.isPremium(row.user.premiumStatus),
            isVerified: deps.isSelfVerifiedCanadianCitizen(deps.parseCommunityMeta(row.user.communityMeta ?? null)),
          },
          memberState: system.members[row.userId] ?? null,
        })),
        ...followers
          .filter((row: any) => !managerIds.has(row.userId))
          .map((row: any) => ({
            userId: row.userId,
            membershipRole: 'FOLLOWER',
            joinedAt: row.createdAt,
            user: {
              id: row.user.id,
              handle: row.user.handle,
              name: row.user.name,
              avatarUrl: deps.normalizeMediaUrl(row.user.avatarUrl ?? null),
              coverUrl: deps.normalizeMediaUrl(row.user.coverUrl ?? null),
              isPremium: deps.isPremium(row.user.premiumStatus),
              isVerified: deps.isSelfVerifiedCanadianCitizen(deps.parseCommunityMeta(row.user.communityMeta ?? null)),
            },
            memberState: system.members[row.userId] ?? null,
          })),
      ]

      return reply.send({
        org: { id: org.id, name: org.name, slug: org.slug },
        ranks: system.ranks,
        items,
        viewer: { permissions },
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/members/:userId/kick', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMemberParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMemberModerationBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_remove_owner' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

      const previous = current.members[params.data.userId] ?? null
      const nextMemberState = {
        rankId: previous?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID,
        planId: previous?.planId ?? null,
        status: 'SUSPENDED',
        referredByUserId: previous?.referredByUserId ?? null,
        reputation: previous?.reputation ?? 0,
        updatedAt: new Date().toISOString(),
      }
      const nextSystem = {
        ...current,
        members: {
          ...current.members,
          [params.data.userId]: nextMemberState,
        },
      }

      await prisma.$transaction(async (tx: any) => {
        await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
        await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })
        await deps.appendOrganizationAuditLogEntry(tx, org.id, {
          actorUserId,
          action: 'member.kicked',
          reason: body.data.reason ?? null,
          previousValue: { userId: params.data.userId, member: previous },
          nextValue: { userId: params.data.userId, member: nextMemberState },
        })
      })

      await deps.createNotificationRecord({
        userId: params.data.userId,
        actorId: actorUserId,
        type: 'org_member_kicked',
        payload: {
          orgId: org.id,
          orgSlug: org.slug,
          orgName: org.name,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          reason: body.data.reason ?? null,
        },
      })

      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/members/:userId/ban', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMemberParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMemberModerationBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_remove_owner' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

      const previous = current.members[params.data.userId] ?? null
      const nextMemberState = {
        rankId: previous?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID,
        planId: previous?.planId ?? null,
        status: 'BANNED',
        referredByUserId: previous?.referredByUserId ?? null,
        reputation: previous?.reputation ?? 0,
        updatedAt: new Date().toISOString(),
      }
      const nextSystem = {
        ...current,
        members: {
          ...current.members,
          [params.data.userId]: nextMemberState,
        },
      }

      await prisma.$transaction(async (tx: any) => {
        await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
        await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })
        await deps.appendOrganizationAuditLogEntry(tx, org.id, {
          actorUserId,
          action: 'member.banned',
          reason: body.data.reason ?? null,
          previousValue: { userId: params.data.userId, member: previous },
          nextValue: { userId: params.data.userId, member: nextMemberState },
        })
      })

      await deps.createNotificationRecord({
        userId: params.data.userId,
        actorId: actorUserId,
        type: 'org_member_banned',
        payload: {
          orgId: org.id,
          orgSlug: org.slug,
          orgName: org.name,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          reason: body.data.reason ?? null,
        },
      })

      return reply.send({ ok: true })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/governance/audit', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const query = deps.CommunityOrgGovernanceQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

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

      const system = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'view_audit_logs')) return reply.code(403).send({ error: 'forbidden' })

      const entries = [...system.auditLog].sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1))
      const start = query.data.cursor ? entries.findIndex((entry: any) => entry.id === query.data.cursor) + 1 : 0
      const items = entries.slice(Math.max(start, 0), Math.max(start, 0) + query.data.limit)
      const nextCursor = items.length === query.data.limit ? items[items.length - 1]?.id ?? null : null

      return reply.send({ items, nextCursor })
    }),
  )
}