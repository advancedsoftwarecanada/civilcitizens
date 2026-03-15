import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { z } from 'zod'

type OrganizationGovernanceMembershipDeps = Record<string, any>

export function registerOrganizationGovernanceMembershipRoutes(
  app: FastifyInstance,
  deps: OrganizationGovernanceMembershipDeps,
) {
  app.post('/communities/:province/:municipality/orgs/:slug/governance/join-mode', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgJoinModeBody.safeParse(req.body ?? {})
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

      const nextSystem = { ...current, joinMode: body.data.joinMode }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'governance.join_mode.updated',
        reason: body.data.reason ?? null,
        previousValue: { joinMode: current.joinMode },
        nextValue: { joinMode: body.data.joinMode },
      })

      return reply.send({ ok: true, joinMode: body.data.joinMode })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/plans', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMembershipPlanBody.safeParse(req.body ?? {})
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

      const plan = {
        id: `plan_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        name: body.data.name,
        description: body.data.description?.trim() || null,
        type: body.data.type,
        amountCents: body.data.amountCents ?? 0,
        currency: body.data.currency.toUpperCase(),
        interval: body.data.interval ?? null,
        rankId: body.data.rankId ?? null,
        governanceRights: body.data.governanceRights,
        createdAt: new Date().toISOString(),
      }

      const nextSystem = { ...current, plans: [...current.plans, plan] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'plan.created',
        reason: null,
        previousValue: null,
        nextValue: plan,
      })

      return reply.code(201).send({ plan })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/join', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgJoinBody.safeParse(req.body ?? {})
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
      if (current.joinMode === 'INVITE_ONLY') {
        if (!body.data.referredByUserId) return reply.code(403).send({ error: 'invite_required' })

        const inviterId = body.data.referredByUserId
        if (inviterId === actorUserId) return reply.code(400).send({ error: 'invalid_referrer' })

        const inviterMember = current.members[inviterId] ?? null
        const inviterIsOwner = inviterId === org.ownerId
        if (inviterMember?.status === 'BANNED') return reply.code(403).send({ error: 'invalid_inviter' })

        const inviterEligibleStatus = ['ACTIVE', 'GRACE']
        const inviterIsEligibleBySystem = inviterMember?.status ? inviterEligibleStatus.includes(inviterMember.status) : false
        const inviterFollows = await prisma.businessFollow.findUnique({
          where: { businessId_userId: { businessId: org.id, userId: inviterId } },
          select: { userId: true },
        })
        const inviterAdminMembership = await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId: inviterId } },
          select: { role: true },
        })

        const inviterEligible = inviterIsOwner || inviterIsEligibleBySystem || Boolean(inviterFollows) || Boolean(inviterAdminMembership)
        if (!inviterEligible) return reply.code(403).send({ error: 'invalid_inviter' })
      }
      if (body.data.planId && !current.plans.some((plan: { id: string }) => plan.id === body.data.planId)) {
        return reply.code(400).send({ error: 'plan_not_found' })
      }
      if (body.data.referredByUserId && body.data.referredByUserId === actorUserId) {
        return reply.code(400).send({ error: 'invalid_referrer' })
      }

      const existing = current.members[actorUserId] ?? null
      if (existing?.status === 'BANNED') return reply.code(403).send({ error: 'membership_banned' })

      const status = current.joinMode === 'APPLICATION_REQUIRED' ? 'PENDING' : 'ACTIVE'
      const nextMemberState = {
        rankId: existing?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID,
        planId: body.data.planId ?? existing?.planId ?? null,
        status,
        referredByUserId: body.data.referredByUserId ?? existing?.referredByUserId ?? null,
        reputation: existing?.reputation ?? 0,
        updatedAt: new Date().toISOString(),
      }

      const shouldAppendReferral = Boolean(body.data.referredByUserId && body.data.referredByUserId !== actorUserId)
      const nextReferrals = shouldAppendReferral
        ? current.referrals.some((item: { referrerUserId: string; referredUserId: string }) => item.referrerUserId === body.data.referredByUserId && item.referredUserId === actorUserId)
          ? current.referrals
          : [
              ...current.referrals,
              {
                id: `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
                referrerUserId: body.data.referredByUserId,
                referredUserId: actorUserId,
                planId: body.data.planId ?? null,
                createdAt: new Date().toISOString(),
              },
            ]
        : current.referrals

      const nextSystem = {
        ...current,
        referrals: nextReferrals,
        members: {
          ...current.members,
          [actorUserId]: nextMemberState,
        },
      }

      await prisma.$transaction(async (tx: any) => {
        await tx.businessFollow.upsert({
          where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
          create: { businessId: org.id, userId: actorUserId },
          update: {},
        })
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })
        await deps.appendOrganizationAuditLogEntry(tx, org.id, {
          actorUserId,
          action: status === 'ACTIVE' ? 'member.joined' : 'member.join_requested',
          reason: body.data.note ?? null,
          previousValue: existing,
          nextValue: nextMemberState,
        })
      })

      return reply.send({ ok: true, member: nextMemberState })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/invite-links', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgInviteLinkBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'manage_referrals')) return reply.code(403).send({ error: 'forbidden' })
      if (body.data.planId && !current.plans.some((plan: { id: string }) => plan.id === body.data.planId)) {
        return reply.code(400).send({ error: 'plan_not_found' })
      }

      const nowIso = new Date().toISOString()
      const token = randomUUID().replace(/-/g, '')
      const invite = {
        id: `inv_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        token,
        createdByUserId: actorUserId,
        message: body.data.message?.trim() || null,
        planId: body.data.planId ?? null,
        createdAt: nowIso,
        viewCount: 0,
        registrationCount: 0,
        joinCount: 0,
        lastViewedAt: null,
        lastRegisteredAt: null,
        lastJoinedAt: null,
      }

      const nextSystem = { ...current, inviteLinks: [...current.inviteLinks, invite] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })

      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'invite_link.created',
        reason: body.data.message?.trim() || null,
        previousValue: null,
        nextValue: invite,
      })

      const landingUrl = `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(params.data.slug.trim().toLowerCase())}/invite/${encodeURIComponent(token)}`
      return reply.code(201).send({ invite, landingUrl })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/governance/invite-links', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const orgSlug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug },
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
      if (!deps.canOrganizationPermission(permissions, 'manage_referrals')) return reply.code(403).send({ error: 'forbidden' })

      const inviteLinks = current.inviteLinks
        .filter((entry: { createdByUserId: string }) => entry.createdByUserId === actorUserId)
        .sort((a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((entry: Record<string, any>) => ({
          ...entry,
          landingUrl: `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(orgSlug)}/invite/${encodeURIComponent(entry.token)}`,
        }))

      return reply.send({ inviteLinks })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/invite-users', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgInviteUserBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const orgSlug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug },
        select: { id: true, ownerId: true, name: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (body.data.targetUserId === actorUserId) return reply.code(400).send({ error: 'invalid_invitee' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!deps.canOrganizationPermission(permissions, 'manage_referrals')) return reply.code(403).send({ error: 'forbidden' })
      if (body.data.planId && !current.plans.some((plan: { id: string }) => plan.id === body.data.planId)) {
        return reply.code(400).send({ error: 'plan_not_found' })
      }

      const targetUser = await prisma.user.findUnique({ where: { id: body.data.targetUserId }, select: { id: true } })
      if (!targetUser) return reply.code(404).send({ error: 'user_not_found' })

      const nowIso = new Date().toISOString()
      const token = randomUUID().replace(/-/g, '')
      const invite = {
        id: `inv_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        token,
        createdByUserId: actorUserId,
        message: body.data.message?.trim() || null,
        planId: body.data.planId ?? null,
        createdAt: nowIso,
        viewCount: 0,
        registrationCount: 0,
        joinCount: 0,
        lastViewedAt: null,
        lastRegisteredAt: null,
        lastJoinedAt: null,
      }

      const nextSystem = { ...current, inviteLinks: [...current.inviteLinks, invite] }
      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })

      const landingUrl = `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(orgSlug)}/invite/${encodeURIComponent(token)}`

      await deps.createNotificationRecord({
        userId: targetUser.id,
        actorId: actorUserId,
        type: deps.ORG_NOTIFICATION_TYPES.USER_INVITE,
        payload: {
          status: 'pending',
          organizationId: org.id,
          organizationName: org.name,
          inviteToken: token,
          message: body.data.message?.trim() || null,
          url: landingUrl,
        },
      })

      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'invite_user.sent',
        reason: body.data.message?.trim() || null,
        previousValue: null,
        nextValue: { inviteId: invite.id, targetUserId: targetUser.id },
      })

      return reply.code(201).send({ invite, landingUrl })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/invite/:token/resolve', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerUserId = (await deps.resolveUserId(req)) ?? null
      const params = deps.CommunityOrgSlugParams.extend({ token: z.string().trim().min(12).max(160) }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgInviteResolveBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })
      const orgSlug = params.data.slug.trim().toLowerCase()

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug, status: 'ACTIVE' },
        select: { id: true, name: true, slug: true, description: true, coverUrl: true, logoUrl: true, ownerId: true, metadata: true, provinceCode: true, communitySlug: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const current = deps.readOrganizationSystemState(org.metadata)
      const inviteIndex = current.inviteLinks.findIndex((entry: { token: string }) => entry.token === params.data.token)
      if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
      const invite = current.inviteLinks[inviteIndex]
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' })

      const inviter = await prisma.user.findUnique({
        where: { id: invite.createdByUserId },
        select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true },
      })

      const isInviteOwner = Boolean(viewerUserId && (viewerUserId === invite.createdByUserId || viewerUserId === org.ownerId))
      const shouldIncrementView = !isInviteOwner
      const nextInviteLinks = [...current.inviteLinks]
      if (shouldIncrementView) {
        const nowIso = new Date().toISOString()
        nextInviteLinks[inviteIndex] = {
          ...invite,
          viewCount: invite.viewCount + 1,
          lastViewedAt: nowIso,
        }

        await prisma.business.update({
          where: { id: org.id },
          data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, { ...current, inviteLinks: nextInviteLinks }) },
          select: { id: true },
        })
      }

      return reply.send({
        invite: nextInviteLinks[inviteIndex],
        viewer: { id: viewerUserId, isInviteOwner },
        inviter: inviter
          ? {
              id: inviter.id,
              handle: inviter.handle,
              name: inviter.name,
              avatarUrl: deps.normalizeMediaUrl(inviter.avatarUrl ?? null),
              coverUrl: deps.normalizeMediaUrl(inviter.coverUrl ?? null),
            }
          : null,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          description: org.description ?? null,
          coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
          logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
        },
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/referrals', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const actorUserId = (await deps.resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgReferralBody.safeParse(req.body ?? {})
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
      if (!deps.canOrganizationPermission(permissions, 'manage_referrals')) return reply.code(403).send({ error: 'forbidden' })
      if (body.data.referrerUserId === body.data.referredUserId) return reply.code(400).send({ error: 'invalid_referral' })
      if (body.data.planId && !current.plans.some((plan: { id: string }) => plan.id === body.data.planId)) {
        return reply.code(400).send({ error: 'plan_not_found' })
      }
      if (current.referrals.some((item: { referrerUserId: string; referredUserId: string }) => item.referrerUserId === body.data.referrerUserId && item.referredUserId === body.data.referredUserId)) {
        return reply.code(409).send({ error: 'referral_exists' })
      }

      const referral = {
        id: `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        referrerUserId: body.data.referrerUserId,
        referredUserId: body.data.referredUserId,
        planId: body.data.planId ?? null,
        createdAt: new Date().toISOString(),
      }

      const existingMember = current.members[body.data.referredUserId] ?? null
      const nextMemberState = {
        rankId: existingMember?.rankId ?? deps.SYSTEM_MEMBER_RANK_ID,
        planId: body.data.planId ?? existingMember?.planId ?? null,
        status: existingMember?.status ?? 'PENDING',
        referredByUserId: body.data.referrerUserId,
        reputation: existingMember?.reputation ?? 0,
        updatedAt: new Date().toISOString(),
      }

      const nextSystem = {
        ...current,
        referrals: [...current.referrals, referral],
        members: {
          ...current.members,
          [body.data.referredUserId]: nextMemberState,
        },
      }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await deps.appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'referral.recorded',
        reason: null,
        previousValue: null,
        nextValue: referral,
      })

      return reply.code(201).send({ referral })
    }),
  )
}