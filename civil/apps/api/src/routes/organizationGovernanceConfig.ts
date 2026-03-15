import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'

type OrganizationGovernanceConfigDeps = Record<string, any>

export function registerOrganizationGovernanceConfigRoutes(
  app: FastifyInstance,
  deps: OrganizationGovernanceConfigDeps,
) {
  app.post('/communities/:province/:municipality/orgs/:slug/governance/ranks', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgGovernanceRankBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'create_ranks')) return reply.code(403).send({ error: 'forbidden' })

      const nextRank = {
        id: `rank_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        name: body.data.name,
        description: body.data.description?.trim() || null,
        permissions: Array.from(new Set(body.data.permissions)),
        promotionAuthority: body.data.promotionAuthority ?? [],
        visibility: body.data.visibility,
      }

      const nextSystem = { ...current, ranks: [...current.ranks, nextRank] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'rank.created',
        reason: null,
        previousValue: null,
        nextValue: nextRank,
      })

      return reply.code(201).send({ rank: nextRank })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/sponsors', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgSponsorBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'create_announcements')) return reply.code(403).send({ error: 'forbidden' })

      const sponsor = {
        id: `sponsor_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        name: body.data.name,
        logoUrl: body.data.logoUrl ?? null,
        relationshipDescription: body.data.relationshipDescription ?? null,
        tier: body.data.tier,
        internalUserId: body.data.internalUserId ?? null,
        externalReference: body.data.externalReference ?? null,
        linkUrl: body.data.linkUrl ?? null,
        linkLabel: body.data.linkLabel ?? null,
        createdAt: new Date().toISOString(),
      }

      const nextSystem = { ...current, sponsors: [...current.sponsors, sponsor] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'sponsor.created',
        reason: null,
        previousValue: null,
        nextValue: sponsor,
      })

      return reply.code(201).send({ sponsor })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/achievements', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgAchievementBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'award_achievements')) return reply.code(403).send({ error: 'forbidden' })

      const achievement = {
        id: `ach_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        title: body.data.title,
        description: body.data.description?.trim() || null,
        reputationPoints: body.data.reputationPoints,
        visibility: body.data.visibility,
        createdAt: new Date().toISOString(),
      }

      const nextSystem = { ...current, achievements: [...current.achievements, achievement] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'achievement.created',
        reason: null,
        previousValue: null,
        nextValue: achievement,
      })

      return reply.code(201).send({ achievement })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/achievements/:achievementId/award', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgAchievementParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgAchievementAwardBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'award_achievements')) return reply.code(403).send({ error: 'forbidden' })

      const achievement = current.achievements.find((item: { id: string }) => item.id === params.data.achievementId)
      if (!achievement) return reply.code(404).send({ error: 'achievement_not_found' })
      if (current.achievementAwards.some((item: { achievementId: string; userId: string }) => item.achievementId === params.data.achievementId && item.userId === body.data.userId)) {
        return reply.code(409).send({ error: 'achievement_already_awarded' })
      }

      const previousMember = current.members[body.data.userId] ?? null
      const award = {
        id: `award_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        achievementId: achievement.id,
        userId: body.data.userId,
        awardedByUserId: actorUserId,
        note: body.data.note ?? null,
        createdAt: new Date().toISOString(),
      }
      const reputationDelta = achievement.reputationPoints
      const ledgerEntry = reputationDelta
        ? {
            id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
            userId: body.data.userId,
            delta: reputationDelta,
            source: 'achievement_award',
            sourceRefId: award.id,
            note: achievement.title,
            createdAt: new Date().toISOString(),
          }
        : null

      const nextMemberState = {
        rankId: previousMember?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID,
        planId: previousMember?.planId ?? null,
        status: previousMember?.status ?? 'ACTIVE',
        referredByUserId: previousMember?.referredByUserId ?? null,
        reputation: (previousMember?.reputation ?? 0) + reputationDelta,
        updatedAt: new Date().toISOString(),
      }

      const nextSystem = {
        ...current,
        achievementAwards: [...current.achievementAwards, award],
        reputationLedger: ledgerEntry ? [...current.reputationLedger, ledgerEntry] : current.reputationLedger,
        members: {
          ...current.members,
          [body.data.userId]: nextMemberState,
        },
      }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'achievement.awarded',
        reason: body.data.note ?? null,
        previousValue: { userId: body.data.userId, member: previousMember },
        nextValue: { award, member: nextMemberState },
      })

      return reply.code(201).send({ award, member: nextMemberState })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/reputation', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgReputationAdjustBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'award_achievements')) return reply.code(403).send({ error: 'forbidden' })

      const existingMember = current.members[body.data.userId] ?? null
      const nextMemberState = {
        rankId: existingMember?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID,
        planId: existingMember?.planId ?? null,
        status: existingMember?.status ?? 'ACTIVE',
        referredByUserId: existingMember?.referredByUserId ?? null,
        reputation: Math.max(0, (existingMember?.reputation ?? 0) + body.data.delta),
        updatedAt: new Date().toISOString(),
      }

      const ledgerEntry = {
        id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        userId: body.data.userId,
        delta: body.data.delta,
        source: body.data.source,
        sourceRefId: null,
        note: body.data.note ?? null,
        createdAt: new Date().toISOString(),
      }

      const nextSystem = {
        ...current,
        reputationLedger: [...current.reputationLedger, ledgerEntry],
        members: {
          ...current.members,
          [body.data.userId]: nextMemberState,
        },
      }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'reputation.adjusted',
        reason: body.data.note ?? null,
        previousValue: { userId: body.data.userId, member: existingMember },
        nextValue: { userId: body.data.userId, member: nextMemberState, ledgerEntry },
      })

      return reply.send({ ok: true, entry: ledgerEntry, member: nextMemberState })
    }),
  )
}