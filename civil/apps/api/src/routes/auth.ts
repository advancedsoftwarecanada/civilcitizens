import { prisma } from '@civil/db'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { FriendshipStatus, type Prisma } from '@prisma/client'
import { buildHandleBase, LoginInput, RegisterInput } from '@civil/shared'
import { z, type ZodTypeAny } from 'zod'
import {
  applyWalletTopUpFromPaymentIntent,
  buildWalletView,
  buildWalletMetaValue,
  ensureCitizenWalletTables,
  insertCivilCreditLedgerEntry,
  readWalletSummary,
  walletHasConnectPayoutsEnabled,
} from '../walletHelpers.js'

type AuthJwtPayload = {
  sub?: string
  actor?: string
  parentId?: string | null
}

type AuthRoutesDeps = {
  CIVIL_PUBLIC_HOST: string
  RegisterInputApi: ZodTypeAny
  STRIPE_PUBLISHABLE_KEY: string
  ensureCitizenMarketplaceTables: () => Promise<void>
  ensureStripeCustomer: (userId: string) => Promise<{ customerId: string; user: { email?: string | null } }>
  getUpdateCivilStatusBody: () => ZodTypeAny
  getUpdateWalletBody: () => ZodTypeAny
  getStripeClient: () => any
  applyOrganizationInviteRegistration: (token: string, newUserId: string) => Promise<void>
  buildFamilyMemberAuthMeResponse: (member: any, homeCommunity: any) => any
  buildHomeCommunitySummaryForUserId: (userId: string) => Promise<any>
  generateUniqueHandle: (baseHandle: string) => Promise<string>
  getStoredProfileFamilyRelationships: (value: any) => Array<{ relatedUserId?: string | null }>
  isAccountSuspended: (value: any) => boolean
  isFamilyMemberTableMissing: (error: unknown) => boolean
  isStripeConfigured: () => boolean
  isPremium: (status: any) => boolean
  isSelfVerifiedCanadianCitizen: (meta: any) => boolean
  loadFamilyMemberAuthViewerById: (memberId: string, parentId?: string | null) => Promise<any>
  normalizeUserMedia: <T extends { avatarUrl?: string | null; coverUrl?: string | null }>(user: T) => T
  parseCommunityMeta: (value: any) => any
  readBaseCommunityMeta: (value: any) => Record<string, any>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, handler: () => Promise<any>) => Promise<any>
}

function readStripeCustomerSessionClientSecret(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const secret = (value as { client_secret?: unknown }).client_secret
  return typeof secret === 'string' && secret.trim() ? secret.trim() : null
}

const WalletAmountBody = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
})

const WalletDepositConfirmBody = z.object({
  paymentIntentId: z.string().trim().min(3).max(255),
})

const WalletUserTransferBody = z.object({
  recipientUserId: z.string().trim().min(3).max(255),
  amountCents: z.number().int().min(100).max(1_000_000),
})

function calculateWalletStripeProcessingFeeCents(amountCents: number) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
  return Math.round(amountCents * 0.029) + 30
}

function isStripeConnectNotEnabledError(error: unknown) {
  if (!(error instanceof Error)) return false
  return /signed up for connect/i.test(error.message)
}

function isStripeBalanceInsufficientError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && code === 'balance_insufficient') return true
  if (error instanceof Error) return /insufficient available funds/i.test(error.message)
  return false
}

function readStripeAvailableBalanceCents(balance: any, currency: string) {
  const normalizedCurrency = currency.trim().toLowerCase()
  const match = Array.isArray(balance?.available)
    ? balance.available.find((entry: any) => typeof entry?.currency === 'string' && entry.currency.toLowerCase() === normalizedCurrency)
    : null
  return typeof match?.amount === 'number' && Number.isFinite(match.amount) ? Math.max(0, Math.round(match.amount)) : 0
}

function readStripePendingBalanceCents(balance: any, currency: string) {
  const normalizedCurrency = currency.trim().toLowerCase()
  const match = Array.isArray(balance?.pending)
    ? balance.pending.find((entry: any) => typeof entry?.currency === 'string' && entry.currency.toLowerCase() === normalizedCurrency)
    : null
  return typeof match?.amount === 'number' && Number.isFinite(match.amount) ? Math.max(0, Math.round(match.amount)) : 0
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
        return reply.send({
          ...deps.buildFamilyMemberAuthMeResponse(member, homeCommunity),
          wallet: null,
        })
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
      const wallet = await buildWalletView(payload.sub, communityMeta)

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
        wallet,
        accountType: 'user',
        familyMemberSession: null,
      })
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.put('/auth/wallet', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      if (payload.actor === 'family_member') {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const body = deps.getUpdateWalletBody().safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta)
      const currentMeta = deps.parseCommunityMeta(user.communityMeta ?? null)
      const currentWallet = readWalletSummary(currentMeta)
      const nextEnabled = typeof body.data.enabled === 'boolean' ? body.data.enabled : currentWallet.enabled
      const nextETransferEmail = body.data.eTransferEmail?.trim() ? body.data.eTransferEmail.trim().toLowerCase() : null
      const nextSharing = {
        family:
          typeof body.data.sharing?.family === 'boolean' ? body.data.sharing.family : currentWallet.sharing.family,
        friends:
          typeof body.data.sharing?.friends === 'boolean' ? body.data.sharing.friends : currentWallet.sharing.friends,
        market:
          typeof body.data.sharing?.market === 'boolean' ? body.data.sharing.market : currentWallet.sharing.market,
      }
      baseMeta.wallet = {
        civilCreditsCents: currentWallet.civilCreditsCents,
        enabled: nextEnabled,
        eTransferEmail: nextETransferEmail,
        sharing: nextSharing,
        stripeConnect: currentWallet.stripeConnect,
      }

      const marketplaceWalletEmail = nextEnabled && nextSharing.market && nextETransferEmail ? nextETransferEmail : null

      await prisma.user.update({ where: { id: payload.sub }, data: { communityMeta: baseMeta } })

      await deps.ensureCitizenMarketplaceTables()
      await prisma.$executeRaw`
        UPDATE citizen_market_listing
        SET e_transfer_email = ${marketplaceWalletEmail},
            updated_at = NOW()
        WHERE seller_user_id = ${payload.sub}
          AND is_active = TRUE
          AND payment_types @> ${JSON.stringify(['etransfer'])}::jsonb
      `

      return reply.send({
        wallet: {
          ...(await buildWalletView(payload.sub, {
            ...baseMeta,
            wallet: {
              civilCreditsCents: currentWallet.civilCreditsCents,
              enabled: nextEnabled,
              eTransferEmail: nextETransferEmail,
              sharing: nextSharing,
              stripeConnect: currentWallet.stripeConnect,
              stripeCustomerId: currentWallet.stripeCustomerId,
            },
          })),
        },
      })
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.post('/auth/wallet/connect/account', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, communityMeta: true },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const currentWallet = readWalletSummary(user.communityMeta)
      if (currentWallet.stripeConnect.accountId) {
        return reply.send({ accountId: currentWallet.stripeConnect.accountId })
      }

      const stripe = deps.getStripeClient()
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        email: user.email ?? undefined,
        business_type: 'individual',
        capabilities: { transfers: { requested: true } },
        business_profile: {
          name: user.name ?? undefined,
          product_description: 'Civil wallet payouts',
        },
        metadata: { civilUserId: user.id, kind: 'wallet' },
      })

      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta)
      baseMeta.wallet = buildWalletMetaValue({
        ...currentWallet,
        stripeConnect: {
          ...currentWallet.stripeConnect,
          accountId: account.id,
        },
      })

      await prisma.user.update({ where: { id: user.id }, data: { communityMeta: baseMeta } })

      return reply.send({ accountId: account.id })
    } catch (error) {
      req.log.error({ err: error }, 'wallet_connect_account_failed')
      if (isStripeConnectNotEnabledError(error)) {
        return reply.code(503).send({ error: 'stripe_connect_not_enabled' })
      }
      return reply.code(400).send({ error: 'wallet_connect_account_failed' })
    }
  })

  app.post('/auth/wallet/connect/onboard', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, handle: true, communityMeta: true },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      let accountId = readWalletSummary(user.communityMeta).stripeConnect.accountId
      if (!accountId) {
        const stripe = deps.getStripeClient()
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'CA',
          email: user.email ?? undefined,
          business_type: 'individual',
          capabilities: { transfers: { requested: true } },
          business_profile: {
            name: user.name ?? undefined,
            product_description: 'Civil wallet payouts',
          },
          metadata: { civilUserId: user.id, kind: 'wallet' },
        })

        const currentWallet = readWalletSummary(user.communityMeta)
        const baseMeta = deps.readBaseCommunityMeta(user.communityMeta)
        baseMeta.wallet = buildWalletMetaValue({
          ...currentWallet,
          stripeConnect: {
            ...currentWallet.stripeConnect,
            accountId: account.id,
          },
        })
        await prisma.user.update({ where: { id: user.id }, data: { communityMeta: baseMeta } })
        accountId = account.id
      }

      if (!accountId) return reply.code(409).send({ error: 'connect_account_missing' })

      const stripe = deps.getStripeClient()
      const refreshUrl = `https://${deps.CIVIL_PUBLIC_HOST}/wallet?connect=refresh`
      const returnUrl = `https://${deps.CIVIL_PUBLIC_HOST}/wallet?connect=return`
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      })

      return reply.send({ url: link.url })
    } catch (error) {
      req.log.error({ err: error }, 'wallet_connect_onboard_failed')
      if (isStripeConnectNotEnabledError(error)) {
        return reply.code(503).send({ error: 'stripe_connect_not_enabled' })
      }
      return reply.code(400).send({ error: 'wallet_connect_onboard_failed' })
    }
  })

  app.get('/auth/wallet/connect/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, handle: true, name: true, communityMeta: true },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const currentWallet = readWalletSummary(user.communityMeta)
      if (!currentWallet.stripeConnect.accountId) {
        return reply.send({ accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false })
      }

      const stripe = deps.getStripeClient()
      const account = await stripe.accounts.retrieve(currentWallet.stripeConnect.accountId)
      const stripeConnect = {
        accountId: currentWallet.stripeConnect.accountId,
        chargesEnabled: Boolean((account as any).charges_enabled),
        payoutsEnabled: Boolean((account as any).payouts_enabled),
        detailsSubmitted: Boolean((account as any).details_submitted),
      }

      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta)
      baseMeta.wallet = buildWalletMetaValue({
        ...currentWallet,
        stripeConnect,
      })
      await prisma.user.update({ where: { id: user.id }, data: { communityMeta: baseMeta } })

      return reply.send(stripeConnect)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.post('/auth/wallet/deposits/intent', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })
      if (!deps.isStripeConfigured() || !deps.STRIPE_PUBLISHABLE_KEY) return reply.code(503).send({ error: 'stripe_not_configured' })

      const body = WalletAmountBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const existingUser = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      if (!existingUser) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(existingUser.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const { customerId, user } = await deps.ensureStripeCustomer(payload.sub)
      const stripe = deps.getStripeClient()
      const processingFeeCents = calculateWalletStripeProcessingFeeCents(body.data.amountCents)
      const totalChargeCents = body.data.amountCents + processingFeeCents
      const customerSession = await (stripe as any).customerSessions.create({
        customer: customerId,
        components: {
          payment_element: {
            enabled: true,
            features: {
              payment_method_save: 'enabled',
              payment_method_save_usage: 'off_session',
              payment_method_redisplay: 'enabled',
              payment_method_remove: 'enabled',
            },
          },
        },
      })
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalChargeCents,
        currency: 'cad',
        customer: customerId,
        payment_method_types: ['card'],
        setup_future_usage: 'off_session',
        description: 'Civil Wallet top-up',
        receipt_email: user.email ?? undefined,
        metadata: {
          kind: 'wallet_topup',
          civilUserId: payload.sub,
          civilCreditAmountCents: String(body.data.amountCents),
          processingFeeCents: String(processingFeeCents),
          totalChargeCents: String(totalChargeCents),
        },
      })

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        customerSessionClientSecret: readStripeCustomerSessionClientSecret(customerSession),
        paymentIntentId: paymentIntent.id,
        publishableKey: deps.STRIPE_PUBLISHABLE_KEY,
      })
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.post('/auth/wallet/deposits/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const body = WalletDepositConfirmBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const existingUser = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      if (!existingUser) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(existingUser.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const stripe = deps.getStripeClient()
      const paymentIntent = await stripe.paymentIntents.retrieve(body.data.paymentIntentId)
      if (paymentIntent.metadata?.kind !== 'wallet_topup' || paymentIntent.metadata?.civilUserId !== payload.sub) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (paymentIntent.status !== 'succeeded') {
        return reply.code(409).send({ error: 'payment_not_completed' })
      }

      await applyWalletTopUpFromPaymentIntent(paymentIntent)

      const updated = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      return reply.send({ wallet: await buildWalletView(payload.sub, updated?.communityMeta ?? null) })
    } catch (error) {
      req.log.error({ err: error }, 'wallet_deposit_confirm_failed')
      return reply.code(500).send({ error: 'wallet_refresh_failed' })
    }
  })

  app.post('/auth/wallet/payouts', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const body = WalletAmountBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, communityMeta: true },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const wallet = readWalletSummary(user.communityMeta)
      const walletView = await buildWalletView(payload.sub, user.communityMeta)
      if (!walletHasConnectPayoutsEnabled(wallet)) {
        return reply.code(409).send({ error: 'wallet_connect_required' })
      }
      if (walletView.availableCreditsCents < body.data.amountCents) {
        return reply.code(400).send({
          error: 'insufficient_available_wallet_balance',
          availableCreditsCents: walletView.availableCreditsCents,
          pendingCreditsCents: walletView.pendingCreditsCents,
        })
      }

      await ensureCitizenWalletTables()

      const stripe = deps.getStripeClient()
      const stripeBalance = await stripe.balance.retrieve()
      const availableBalanceCents = readStripeAvailableBalanceCents(stripeBalance, 'cad')
      const pendingBalanceCents = readStripePendingBalanceCents(stripeBalance, 'cad')
      if (availableBalanceCents < body.data.amountCents) {
        return reply.code(409).send({
          error: 'stripe_balance_insufficient',
          availableBalanceCents,
          pendingBalanceCents,
        })
      }

      const transfer = await stripe.transfers.create({
        amount: body.data.amountCents,
        currency: 'cad',
        destination: wallet.stripeConnect.accountId,
        metadata: {
          kind: 'wallet_payout',
          civilUserId: payload.sub,
        },
      })

      const userId = payload.sub

      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
          if (!freshUser) throw new Error('unauthorized')
          const freshWallet = readWalletSummary(freshUser.communityMeta)
          const freshWalletView = await buildWalletView(userId, freshUser.communityMeta, 1)
          if (freshWalletView.availableCreditsCents < body.data.amountCents) {
            throw new Error('insufficient_available_wallet_balance')
          }

          const baseMeta = deps.readBaseCommunityMeta(freshUser.communityMeta)
          baseMeta.wallet = buildWalletMetaValue({
            ...freshWallet,
            civilCreditsCents: freshWallet.civilCreditsCents - body.data.amountCents,
          })

          const transactionId = randomUUID()
          await tx.user.update({ where: { id: userId }, data: { communityMeta: baseMeta } })
          await tx.$executeRaw`
            INSERT INTO citizen_wallet_transaction (
              id,
              kind,
              status,
              user_id,
              amount_cents,
              currency,
              stripe_transfer_id,
              stripe_connect_account_id,
              metadata,
              updated_at
            )
            VALUES (
              ${transactionId},
              ${'payout'},
              ${'completed'},
              ${userId},
              ${body.data.amountCents},
              ${'cad'},
              ${transfer.id},
              ${wallet.stripeConnect.accountId},
              ${JSON.stringify({ kind: 'wallet_payout' })}::jsonb,
              NOW()
            )
          `

          await insertCivilCreditLedgerEntry(tx, {
            id: `withdrawal:${transactionId}`,
            eventId: transactionId,
            entryType: 'withdrawal',
            status: 'completed',
            amountCents: body.data.amountCents,
            currency: 'cad',
            from: {
              entityType: 'user_wallet',
              userId: user.id,
              handle: user.handle ?? null,
              name: user.name ?? null,
              entityLabel: 'Civil Wallet',
            },
            to: {
              entityType: 'external_bank',
              entityLabel: 'Linked bank account',
            },
            sourceType: 'wallet_transaction',
            sourceReferenceId: transactionId,
            stripeTransferId: transfer.id,
            stripeConnectAccountId: wallet.stripeConnect.accountId,
            description: 'Wallet withdrawal to connected bank account',
            metadata: {
              kind: 'wallet_payout',
            },
          })
        })
      } catch (error) {
        try {
          await stripe.transfers.createReversal(transfer.id, {
            amount: body.data.amountCents,
            metadata: { kind: 'wallet_payout_reversal', civilUserId: payload.sub },
          })
        } catch {
          // Ignore reversal failures and fall through to the original error.
        }

        if (error instanceof Error && error.message === 'insufficient_available_wallet_balance') {
          return reply.code(400).send({ error: 'insufficient_available_wallet_balance' })
        }
        throw error
      }

      const updated = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      return reply.send({ wallet: await buildWalletView(payload.sub, updated?.communityMeta ?? null) })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing features.') {
        return reply.code(503).send({ error: 'stripe_not_configured' })
      }
      if (isStripeBalanceInsufficientError(error)) {
        return reply.code(409).send({ error: 'stripe_balance_insufficient' })
      }
      req.log.error({ err: error }, 'wallet_payout_failed')
      return reply.code(400).send({ error: 'wallet_payout_failed' })
    }
  })

  app.post('/auth/wallet/transfers', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') return reply.code(401).send({ error: 'unauthorized' })
      if (payload.actor === 'family_member') return reply.code(403).send({ error: 'forbidden' })

      const body = WalletUserTransferBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      if (body.data.recipientUserId === payload.sub) return reply.code(400).send({ error: 'cannot_transfer_to_self' })

      await ensureCitizenWalletTables()

      const [sender, recipient, friendship] = await Promise.all([
        prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, handle: true, name: true, communityMeta: true } }),
        prisma.user.findUnique({ where: { id: body.data.recipientUserId }, select: { id: true, handle: true, name: true, communityMeta: true } }),
        prisma.friendship.findFirst({
          where: {
            status: FriendshipStatus.ACCEPTED,
            OR: [
              { requesterId: payload.sub, addresseeId: body.data.recipientUserId },
              { requesterId: body.data.recipientUserId, addresseeId: payload.sub },
            ],
          },
          select: { id: true },
        }),
      ])

      if (!sender || !recipient) return reply.code(404).send({ error: 'user_not_found' })
      if (deps.isAccountSuspended(sender.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

      const senderFamilyRelationship = deps
        .getStoredProfileFamilyRelationships(sender.communityMeta)
        .find((entry: { relatedUserId?: string | null }) => entry.relatedUserId === recipient.id)

      const recipientWallet = readWalletSummary(recipient.communityMeta)
      const canShareWithSender =
        (Boolean(senderFamilyRelationship) && recipientWallet.sharing.family) ||
        (Boolean(friendship?.id) && recipientWallet.sharing.friends)

      if (!recipientWallet.enabled || !recipientWallet.eTransferEmail || !canShareWithSender || !walletHasConnectPayoutsEnabled(recipientWallet)) {
        return reply.code(403).send({ error: 'wallet_not_available' })
      }

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const [freshSender, freshRecipient] = await Promise.all([
          tx.user.findUnique({ where: { id: sender.id }, select: { communityMeta: true } }),
          tx.user.findUnique({ where: { id: recipient.id }, select: { communityMeta: true } }),
        ])
        if (!freshSender || !freshRecipient) throw new Error('user_not_found')

        const freshSenderWallet = readWalletSummary(freshSender.communityMeta)
        const freshRecipientWallet = readWalletSummary(freshRecipient.communityMeta)
        if (freshSenderWallet.civilCreditsCents < body.data.amountCents) {
          throw new Error('insufficient_wallet_balance')
        }
        if (!walletHasConnectPayoutsEnabled(freshRecipientWallet)) {
          throw new Error('wallet_not_available')
        }

        const senderMeta = deps.readBaseCommunityMeta(freshSender.communityMeta)
        senderMeta.wallet = buildWalletMetaValue({
          ...freshSenderWallet,
          civilCreditsCents: freshSenderWallet.civilCreditsCents - body.data.amountCents,
        })

        const recipientMeta = deps.readBaseCommunityMeta(freshRecipient.communityMeta)
        recipientMeta.wallet = buildWalletMetaValue({
          ...freshRecipientWallet,
          civilCreditsCents: freshRecipientWallet.civilCreditsCents + body.data.amountCents,
        })

        await Promise.all([
          tx.user.update({ where: { id: sender.id }, data: { communityMeta: senderMeta } }),
          tx.user.update({ where: { id: recipient.id }, data: { communityMeta: recipientMeta } }),
        ])

        const transactionId = randomUUID()
        await tx.$executeRaw`
          INSERT INTO citizen_wallet_transaction (
            id,
            kind,
            status,
            user_id,
            counterparty_user_id,
            amount_cents,
            currency,
            stripe_connect_account_id,
            metadata,
            updated_at
          )
          VALUES (
            ${transactionId},
            ${'user_transfer'},
            ${'completed'},
            ${sender.id},
            ${recipient.id},
            ${body.data.amountCents},
            ${'cad'},
            ${freshRecipientWallet.stripeConnect.accountId},
            ${JSON.stringify({ kind: 'user_transfer' })}::jsonb,
            NOW()
          )
        `

        await insertCivilCreditLedgerEntry(tx, {
          id: `transfer:${transactionId}`,
          eventId: transactionId,
          entryType: 'transfer',
          status: 'completed',
          amountCents: body.data.amountCents,
          currency: 'cad',
          from: {
            entityType: 'user_wallet',
            userId: sender.id,
            handle: sender.handle ?? null,
            name: sender.name ?? null,
            entityLabel: 'Civil Wallet',
          },
          to: {
            entityType: 'user_wallet',
            userId: recipient.id,
            handle: recipient.handle ?? null,
            name: recipient.name ?? null,
            entityLabel: 'Civil Wallet',
          },
          sourceType: 'wallet_transaction',
          sourceReferenceId: transactionId,
          stripeConnectAccountId: freshRecipientWallet.stripeConnect.accountId,
          description: 'Civil Credit transfer between users',
          metadata: {
            kind: 'user_transfer',
          },
        })
      })

      const updated = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
      return reply.send({ wallet: await buildWalletView(payload.sub, updated?.communityMeta ?? null) })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'insufficient_wallet_balance') return reply.code(400).send({ error: 'insufficient_wallet_balance' })
        if (error.message === 'wallet_not_available') return reply.code(403).send({ error: 'wallet_not_available' })
      }
      return reply.code(400).send({ error: 'wallet_transfer_failed' })
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