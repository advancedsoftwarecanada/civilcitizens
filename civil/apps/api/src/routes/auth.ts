import { prisma } from '@civil/db'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { buildHandleBase, LoginInput, RegisterInput } from '@civil/shared'
import type { ZodTypeAny } from 'zod'

type AuthJwtPayload = {
  sub?: string
  actor?: string
  parentId?: string | null
}

type AuthRoutesDeps = {
  RegisterInputApi: ZodTypeAny
  getUpdateCivilStatusBody: () => ZodTypeAny
  applyOrganizationInviteRegistration: (token: string, newUserId: string) => Promise<void>
  buildFamilyMemberAuthMeResponse: (member: any, homeCommunity: any) => any
  buildHomeCommunitySummaryForUserId: (userId: string) => Promise<any>
  generateUniqueHandle: (baseHandle: string) => Promise<string>
  getStoredProfileFamilyRelationships: (value: any) => Array<{ relatedUserId?: string | null }>
  isAccountSuspended: (value: any) => boolean
  isFamilyMemberTableMissing: (error: unknown) => boolean
  isPremium: (status: any) => boolean
  isSelfVerifiedCanadianCitizen: (meta: any) => boolean
  loadFamilyMemberAuthViewerById: (memberId: string, parentId?: string | null) => Promise<any>
  normalizeUserMedia: <T extends { avatarUrl?: string | null; coverUrl?: string | null }>(user: T) => T
  parseCommunityMeta: (value: any) => any
  readBaseCommunityMeta: (value: any) => Record<string, any>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, handler: () => Promise<any>) => Promise<any>
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps) {
  app.post('/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
    let parse = RegisterInput.safeParse(req.body)
    if (!parse.success) {
      parse = deps.RegisterInputApi.safeParse(req.body)
    }
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { email, firstName, lastName, password } = parse.data
    const rawBody = (req.body ?? {}) as Record<string, unknown>
    const orgInviteToken = typeof rawBody.orgInviteToken === 'string' ? rawBody.orgInviteToken.trim() : ''
    const normalizedFirstName = firstName.trim().toLowerCase()
    const normalizedLastName = lastName.trim().toLowerCase()
    const name = `${normalizedFirstName} ${normalizedLastName}`.trim()
    const baseHandle = buildHandleBase(normalizedFirstName, normalizedLastName)
    const handle = await deps.generateUniqueHandle(baseHandle)
    const hash = await bcrypt.hash(password, 10)

    try {
      const user = await prisma.user.create({ data: { id: randomUUID(), email, handle, name, passwordHash: hash } })
      if (orgInviteToken) {
        try {
          await deps.applyOrganizationInviteRegistration(orgInviteToken, user.id)
        } catch (inviteErr) {
          req.log.warn({ err: inviteErr }, 'org_invite_registration_apply_failed')
        }
      }
      const token = await (app as any).jwt.sign({ sub: user.id })
      return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
    } catch (error: any) {
      if (error.code === 'P2002') return reply.code(409).send({ error: 'email_or_handle_exists' })
      throw error
    }
  })

  app.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const parse = LoginInput.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { emailOrHandle, password } = parse.data
      const rawIdentifier = emailOrHandle.trim()
      const identifier = rawIdentifier.startsWith('@') ? rawIdentifier.slice(1) : rawIdentifier

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: identifier, mode: 'insensitive' } },
            { handle: { equals: identifier, mode: 'insensitive' } },
          ],
        },
      })
      if (!user) return reply.code(401).send({ error: 'invalid_credentials' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const ok = await bcrypt.compare(password, (user as any).passwordHash)
      if (!ok) return reply.code(401).send({ error: 'invalid_credentials' })

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      const token = await (app as any).jwt.sign({ sub: user.id })
      return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
    }),
  )

  app.get('/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      if (payload.actor === 'family_member') {
        const member = await deps.loadFamilyMemberAuthViewerById(payload.sub, payload.parentId ?? null)
        if (!member) return reply.code(401).send({ error: 'unauthorized' })

        const homeCommunity = await deps.buildHomeCommunitySummaryForUserId(member.parentId)
        return reply.send(deps.buildFamilyMemberAuthMeResponse(member, homeCommunity))
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          communityMeta: true,
          premiumStatus: true,
          premiumSince: true,
          premiumRenewsAt: true,
        },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const homeCommunity = await deps.buildHomeCommunitySummaryForUserId(payload.sub)
      const normalizedUser = deps.normalizeUserMedia(user)
      const communityMeta = deps.parseCommunityMeta(user.communityMeta ?? null)

      let familyMemberCount = 0
      try {
        familyMemberCount = await prisma.familyMember.count({ where: { parentId: payload.sub } })
      } catch (error) {
        if (!deps.isFamilyMemberTableMissing(error)) throw error
      }

      const familyRelationshipCount = Array.from(
        new Set(deps.getStoredProfileFamilyRelationships(user.communityMeta).map((entry) => entry.relatedUserId).filter(Boolean)),
      ).length

      return reply.send({
        ...normalizedUser,
        homeCommunity,
        isPremium: deps.isPremium(user.premiumStatus),
        isVerified: deps.isSelfVerifiedCanadianCitizen(communityMeta),
        premiumSince: user.premiumSince ?? null,
        premiumRenewsAt: user.premiumRenewsAt ?? null,
        civicStatus: communityMeta?.civicStatus ?? null,
        workAuthorization: communityMeta?.workAuthorization ?? null,
        verificationMethod: communityMeta?.verificationMethod ?? null,
        statusDeclaredAt: communityMeta?.statusDeclaredAt ?? null,
        statusUpdatedAt: communityMeta?.statusUpdatedAt ?? null,
        familyMode: {
          enabled: Boolean(communityMeta?.familyMode?.enabledAt),
          enabledAt: communityMeta?.familyMode?.enabledAt ?? null,
          affirmedProfileTruthAt: communityMeta?.familyMode?.affirmedProfileTruthAt ?? null,
          acceptedChildSafetyInfoAt: communityMeta?.familyMode?.acceptedChildSafetyInfoAt ?? null,
          memberCount: familyMemberCount,
          relationshipCount: familyRelationshipCount,
        },
        accountType: 'user',
        familyMemberSession: null,
      })
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.post('/auth/status-declaration', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const body = deps.getUpdateCivilStatusBody().safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta)
      const currentMeta = deps.parseCommunityMeta(user.communityMeta ?? null)
      const nowIso = new Date().toISOString()
      const workAuthorization =
        body.data.civicStatus === 'citizen' || body.data.civicStatus === 'permanent_resident'
          ? 'authorized'
          : body.data.workAuthorization ?? 'unspecified'

      baseMeta.civicStatus = body.data.civicStatus
      baseMeta.workAuthorization = workAuthorization
      baseMeta.verificationMethod = 'self_declaration'
      baseMeta.statusDeclaredAt = currentMeta?.statusDeclaredAt ?? nowIso
      baseMeta.statusUpdatedAt = nowIso

      await prisma.user.update({ where: { id: payload.sub }, data: { communityMeta: baseMeta } })

      return reply.send({
        civicStatus: body.data.civicStatus,
        workAuthorization,
        verificationMethod: 'self_declaration',
        statusDeclaredAt: currentMeta?.statusDeclaredAt ?? nowIso,
        statusUpdatedAt: nowIso,
      })
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })
}