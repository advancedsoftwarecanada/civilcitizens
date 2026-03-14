import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type Stripe from 'stripe'
import { prisma } from '@civil/db'

type BillingDeps = Record<string, any>

export function registerBillingRoutes(app: FastifyInstance, deps: BillingDeps) {
  app.get('/billing/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        premiumStatus: true,
        premiumSince: true,
        premiumRenewsAt: true,
        ...deps.BILLING_PROFILE_SELECT,
      },
    })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })

    const businessCount = await prisma.business.count({ where: { ownerId: userId } })
    const billingProfile = deps.buildBillingProfileResponse(user)
    const billingProfileMissing = deps.missingBillingProfileFields(billingProfile)
    const billingProfileComplete = billingProfileMissing.length === 0
    return reply.send({
      stripeEnabled: deps.isStripeConfigured(),
      premiumStatus: user.premiumStatus,
      isPremium: deps.isPremium(user.premiumStatus),
      premiumSince: user.premiumSince ?? null,
      premiumRenewsAt: user.premiumRenewsAt ?? null,
      businessCount,
      businessLimit: deps.MAX_BUSINESSES_PER_USER,
      billingProfile,
      billingProfileComplete,
      billingProfileMissing,
    })
  })

  app.put('/billing/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const body = deps.BillingProfileSchema.safeParse(req.body ?? {})
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() })
    }

    const data = deps.mapProfileInputToUserData(body.data)
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: deps.BILLING_PROFILE_SELECT,
    })

    const profile = deps.buildBillingProfileResponse(user)
    return reply.send({
      profile,
      complete: deps.billingProfileIsComplete(profile),
      missingFields: deps.missingBillingProfileFields(profile),
    })
  })

  app.post('/billing/setup-intent', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })
    if (!deps.STRIPE_PUBLISHABLE_KEY) return reply.code(503).send({ error: 'publishable_key_missing' })

    const body = deps.SetupIntentSchema.safeParse(req.body ?? {})
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() })
    }

    if (body.data.businessId) {
      const business = await deps.loadOwnedBusiness(userId, body.data.businessId)
      if (!business) return reply.code(404).send({ error: 'business_not_found' })
    }

    const stripe = deps.getStripeClient()
    const { customerId, user } = await deps.ensureStripeCustomer(userId)
    const billingProfile = deps.buildBillingProfileResponse(user)
    if (!deps.billingProfileIsComplete(billingProfile)) {
      return reply.code(412).send(deps.buildBillingProfileIncompleteError(billingProfile))
    }
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
    })

    if (!setupIntent.client_secret) {
      return reply.code(502).send({ error: 'setup_intent_missing_secret' })
    }

    return reply.send({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      publishableKey: deps.STRIPE_PUBLISHABLE_KEY,
    })
  })

  app.post('/billing/premium/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

    const body = deps.PremiumCheckoutSchema.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const priceId = deps.ensurePriceAvailable(deps.STRIPE_PRICE_PREMIUM, 'premium')
    const stripe = deps.getStripeClient()

    if ('paymentMethodId' in body.data) {
      const { user, customerId } = await deps.ensureStripeCustomer(userId)
      const billingProfile = deps.buildBillingProfileResponse(user)
      if (!deps.billingProfileIsComplete(billingProfile)) {
        return reply.code(412).send(deps.buildBillingProfileIncompleteError(billingProfile))
      }
      const billingDetails = deps.convertProfileToBillingDetails(billingProfile)

      try {
        await deps.ensurePaymentMethodForCustomer(stripe, customerId, body.data.paymentMethodId)
      } catch (error) {
        if (error instanceof deps.PaymentMethodOwnershipError) {
          const ownershipError = error as { statusCode: number; message: string }
          return reply.code(ownershipError.statusCode).send({ error: ownershipError.message })
        }
        throw error
      }

      const customerUpdate: Stripe.CustomerUpdateParams = {
        invoice_settings: { default_payment_method: body.data.paymentMethodId },
      }
      if (billingDetails?.name || user.name) customerUpdate.name = billingDetails?.name || user.name || undefined
      if (billingDetails?.email) customerUpdate.email = billingDetails.email
      if (billingDetails?.phone) customerUpdate.phone = billingDetails.phone
      if (billingDetails?.address) {
        customerUpdate.address = billingDetails.address
      }
      await stripe.customers.update(customerId, customerUpdate)

      const metadata: Record<string, string> = { kind: 'premium', userId }
      if (body.data.setupIntentId) {
        metadata.setupIntentId = body.data.setupIntentId
      }

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
        metadata,
      })

      if (!deps.isPremium(user.premiumStatus)) {
        await prisma.user.update({ where: { id: userId }, data: { premiumStatus: 'PENDING' } })
      }

      const { invoice, paymentIntent } = deps.resolveSubscriptionInvoice(subscription)
      if (!paymentIntent) {
        return reply.code(502).send({ error: 'payment_intent_missing' })
      }
      const requiresAction = deps.paymentIntentRequiresAction(paymentIntent)
      const paymentSucceeded = deps.paymentIntentSucceeded(paymentIntent)

      if (paymentSucceeded) {
        await deps.syncPremiumSubscription(subscription)
      }

      return reply.send({
        subscriptionId: subscription.id,
        invoiceId: invoice?.id ?? null,
        paymentIntentId: paymentIntent?.id ?? null,
        paymentIntentStatus: paymentIntent?.status ?? null,
        requiresAction,
        clientSecret: paymentIntent?.client_secret ?? null,
        planApplied: paymentSucceeded,
      })
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(body.data.subscriptionId, {
      expand: ['latest_invoice.payment_intent'],
    })
    const { paymentIntent } = deps.resolveSubscriptionInvoice(stripeSubscription)
    const paymentSucceeded = deps.paymentIntentSucceeded(paymentIntent)
    if (paymentSucceeded) {
      await deps.syncPremiumSubscription(stripeSubscription)
    }

    return reply.send({
      subscriptionId: stripeSubscription.id,
      paymentIntentStatus: paymentIntent?.status ?? null,
      requiresAction: deps.paymentIntentRequiresAction(paymentIntent),
      planApplied: paymentSucceeded,
    })
  })

  app.post('/billing/portal', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

    const body = deps.PortalSessionSchema.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const business = await deps.loadOwnedBusiness(userId, body.data.businessId)
    if (!business) return reply.code(404).send({ error: 'business_not_found' })
    if (!business.stripeSubscriptionId) return reply.code(409).send({ error: 'subscription_missing' })

    const stripe = deps.getStripeClient()
    const { customerId } = await deps.ensureStripeCustomer(userId)
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: body.data.returnUrl ?? deps.BILLING_PORTAL_RETURN_FALLBACK,
    })
    return reply.send({ portalUrl: session.url })
  })
}