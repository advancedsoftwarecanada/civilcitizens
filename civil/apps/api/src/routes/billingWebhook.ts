import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type Stripe from 'stripe'

type BillingWebhookDeps = Record<string, any>

export function registerBillingWebhookRoutes(app: FastifyInstance, deps: BillingWebhookDeps) {
  app.post(
    '/billing/stripe/webhook',
    { config: { rawBody: true } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!deps.isStripeConfigured() || !deps.STRIPE_WEBHOOK_SECRET) {
        return reply.code(503).send({ error: 'stripe_unconfigured' })
      }
      const signature = req.headers['stripe-signature']
      if (!signature) {
        return reply.code(400).send({ error: 'missing_signature' })
      }
      const payloadBuffer: Buffer | undefined = (req as any).rawBody
      if (!payloadBuffer) {
        return reply.code(400).send({ error: 'raw_body_required' })
      }

      const stripe = deps.getStripeClient()
      let event: Stripe.Event
      try {
        event = stripe.webhooks.constructEvent(payloadBuffer, signature, deps.STRIPE_WEBHOOK_SECRET)
      } catch (error) {
        req.log.error({ err: error }, 'stripe_webhook_signature_invalid')
        return reply.code(400).send({ error: 'invalid_signature' })
      }

      const record = await deps.recordStripeWebhookEvent(event)
      await deps.updateStripeWebhookEvent(record.id, {
        status: deps.StripeWebhookStatus.PROCESSING,
        processingStartedAt: new Date(),
        lastError: null,
      })

      try {
        const result = await deps.processStripeEvent(stripe, event)
        await deps.updateStripeWebhookEvent(record.id, {
          status: result.type === 'ignored' ? deps.StripeWebhookStatus.IGNORED : deps.StripeWebhookStatus.PROCESSED,
          processedAt: new Date(),
          lastError: null,
          userId: result.type === 'premium' ? result.userId : result.type === 'business' ? result.ownerId : undefined,
          businessId: result.type === 'business' ? result.businessId : undefined,
        })
        return reply.send({ received: true })
      } catch (error) {
        await deps.updateStripeWebhookEvent(record.id, {
          status: deps.StripeWebhookStatus.FAILED,
          processedAt: new Date(),
          lastError: deps.serializeError(error),
        })
        req.log.error({ err: error }, 'stripe_webhook_failed')
        return reply.code(500).send({ error: 'webhook_failure' })
      }
    },
  )
}