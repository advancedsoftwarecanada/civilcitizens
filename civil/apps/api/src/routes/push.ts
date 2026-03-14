import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { z } from 'zod'

import {
  deactivateSubscription,
  pruneInvalidSubscriptions,
  upsertSubscription,
  type PushSubscriptionMetaInput,
  type WebPushSubscriptionInput as WebPushSubscriptionRecordInput,
} from '../pushSubscriptions.js'
import { getVapidPublicKey, sendPushToUser } from '../pushSender.js'

const PUSH_ROUTE_BODY_LIMIT_BYTES = 16 * 1024
const PUSH_SUBSCRIBE_LIMIT_PER_MINUTE = 12
const PUSH_TEST_LIMIT_PER_MINUTE = 5

const PushDeviceRegisterInput = z.object({
  token: z.string().min(1),
  platform: z.string().trim().min(1).max(32).optional().default('ios'),
  bundleId: z.string().trim().min(1).max(255).optional(),
  deviceId: z.string().trim().min(1).max(255).optional(),
})

const PushDeviceUnregisterInput = z.object({
  token: z.string().min(1),
  platform: z.string().trim().min(1).max(32).optional().default('ios'),
})

const WebPushSubscriptionInput = z
  .object({
    endpoint: z.string().trim().url().max(2048),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().trim().min(1).max(1024),
        auth: z.string().trim().min(1).max(1024),
      })
      .strict(),
  })
  .strict()

const WebPushMetaInput = z
  .object({
    userAgent: z.string().trim().max(1024).optional(),
    platform: z.enum(['android', 'ios', 'desktop', 'unknown']).optional(),
    browser: z.enum(['chrome', 'edge', 'safari', 'unknown']).optional(),
  })
  .strict()

const WebPushSubscribeRouteInput = z
  .object({
    subscription: WebPushSubscriptionInput,
    meta: WebPushMetaInput.optional(),
  })
  .strict()

const WebPushUnsubscribeRouteInput = z
  .object({
    endpoint: z.string().trim().url().max(2048),
  })
  .strict()

const WebPushTestRouteInput = z.object({}).strict()

type RouteActionResult = Promise<unknown | FastifyReply>

type PushRoutesDeps = {
  ensurePushDeviceRegistryTable: () => Promise<void>
  getHeaderValue: (req: FastifyRequest, key: string) => string | null
  normalizePushToken: (rawToken: string) => string | null
  pushRegisterSecret: string
  redis: {
    incr: (key: string) => Promise<number>
    expire: (key: string, seconds: number) => Promise<unknown>
  }
  resolveUserId: (req: FastifyRequest) => Promise<string | null>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, action: () => Promise<unknown>) => RouteActionResult
}

function exceedsPushBodyLimit(value: unknown, maxBytes = PUSH_ROUTE_BODY_LIMIT_BYTES): boolean {
  try {
    const serialized = JSON.stringify(value ?? {})
    return Buffer.byteLength(serialized, 'utf8') > maxBytes
  } catch {
    return true
  }
}

function detectPushPlatformAndBrowser(userAgent: string | null | undefined): {
  platform: NonNullable<PushSubscriptionMetaInput['platform']>
  browser: NonNullable<PushSubscriptionMetaInput['browser']>
} {
  const ua = (userAgent || '').toLowerCase()
  let platform: NonNullable<PushSubscriptionMetaInput['platform']> = 'unknown'
  if (/iphone|ipad|ipod/.test(ua)) platform = 'ios'
  else if (/android/.test(ua)) platform = 'android'
  else if (/windows|macintosh|linux|x11|cros/.test(ua)) platform = 'desktop'

  let browser: NonNullable<PushSubscriptionMetaInput['browser']> = 'unknown'
  if (/edg\//.test(ua)) browser = 'edge'
  else if ((/chrome\//.test(ua) || /crios\//.test(ua)) && !/edg\//.test(ua)) browser = 'chrome'
  else if (/safari\//.test(ua) && !/chrome\//.test(ua) && !/crios\//.test(ua) && !/edg\//.test(ua)) browser = 'safari'

  return { platform, browser }
}

function resolvePushSubscriptionMeta(req: FastifyRequest, meta?: z.infer<typeof WebPushMetaInput>): PushSubscriptionMetaInput {
  const userAgentHeader = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : ''
  const userAgent = (meta?.userAgent?.trim() || userAgentHeader || '').trim().slice(0, 1024)
  const inferred = detectPushPlatformAndBrowser(userAgent)

  return {
    userAgent: userAgent || null,
    platform: meta?.platform ?? inferred.platform,
    browser: meta?.browser ?? inferred.browser,
  }
}

async function withinPushRateLimit(
  redis: PushRoutesDeps['redis'],
  options: {
    userId: string
    bucket: string
    maxPerMinute: number
  },
): Promise<boolean> {
  const key = `ratelimit:push:${options.bucket}:${options.userId}`
  try {
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, 60)
    }
    return count <= Math.max(1, options.maxPerMinute)
  } catch {
    return true
  }
}

export function registerPushRoutes(app: FastifyInstance, deps: PushRoutesDeps) {
  app.get('/push/public-key', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = await deps.resolveUserId(req)
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const publicKey = getVapidPublicKey()
      if (!publicKey) return reply.code(503).send({ error: 'push_not_configured' })

      return reply.send({ publicKey })
    }),
  )

  app.post('/push/subscribe', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = await deps.resolveUserId(req)
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      if (exceedsPushBodyLimit(req.body)) return reply.code(413).send({ error: 'payload_too_large' })

      const withinLimit = await withinPushRateLimit(deps.redis, {
        userId,
        bucket: 'subscribe',
        maxPerMinute: PUSH_SUBSCRIBE_LIMIT_PER_MINUTE,
      })
      if (!withinLimit) return reply.code(429).send({ error: 'rate_limited' })

      const parse = WebPushSubscribeRouteInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const subscriptionInput: WebPushSubscriptionRecordInput = {
        endpoint: parse.data.subscription.endpoint,
        expirationTime: parse.data.subscription.expirationTime ?? null,
        keys: {
          p256dh: parse.data.subscription.keys.p256dh,
          auth: parse.data.subscription.keys.auth,
        },
      }

      const meta = resolvePushSubscriptionMeta(req, parse.data.meta)
      await upsertSubscription(userId, subscriptionInput, meta)

      return reply.send({ ok: true })
    }),
  )

  app.post('/push/unsubscribe', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = await deps.resolveUserId(req)
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      if (exceedsPushBodyLimit(req.body)) return reply.code(413).send({ error: 'payload_too_large' })

      const parse = WebPushUnsubscribeRouteInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const count = await deactivateSubscription(userId, parse.data.endpoint)
      return reply.send({ ok: true, count })
    }),
  )

  app.post('/push/test', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = await deps.resolveUserId(req)
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      if (exceedsPushBodyLimit(req.body)) return reply.code(413).send({ error: 'payload_too_large' })

      const withinLimit = await withinPushRateLimit(deps.redis, {
        userId,
        bucket: 'test',
        maxPerMinute: PUSH_TEST_LIMIT_PER_MINUTE,
      })
      if (!withinLimit) return reply.code(429).send({ error: 'rate_limited' })

      const parse = WebPushTestRouteInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const payload = {
        title: 'Civil Citizens',
        body: 'This is a test notification from Civil.',
        url: '/notifications',
        type: 'system' as const,
      }

      if (process.env.NODE_ENV !== 'production') {
        req.log.info({ route: '/push/test', userId, payload }, 'push_test_dispatch_dev')
      }

      const summary = await sendPushToUser(userId, payload)
      if (summary.failed > 0) {
        await pruneInvalidSubscriptions()
      }

      return reply.send({ ok: true, summary })
    }),
  )

  app.post('/mobile/push/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = PushDeviceRegisterInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const token = deps.normalizePushToken(parse.data.token)
    if (!token) return reply.code(400).send({ error: 'invalid_token' })

    const tokenLen = token.length
    const tokenSuffix = token.slice(-8)

    const userId = await deps.resolveUserId(req)
    const registerSecret = deps.getHeaderValue(req, 'x-register-secret')
    const secretAuthorized = !!deps.pushRegisterSecret && registerSecret === deps.pushRegisterSecret
    if (!userId && !secretAuthorized) {
      req.log.info({ route: '/mobile/push/register', platform: parse.data.platform, hasUserId: false }, 'push_register_unauthorized')
      return reply.code(401).send({ error: 'unauthorized' })
    }

    await deps.ensurePushDeviceRegistryTable()

    const platform = parse.data.platform.trim().toLowerCase()
    const bundleId = parse.data.bundleId?.trim() || null
    const deviceId = parse.data.deviceId?.trim() || null

    req.log.info(
      {
        route: '/mobile/push/register',
        platform,
        tokenLen,
        tokenSuffix,
        hasUserId: !!userId,
        secretAuthorized,
        hasBundleId: !!bundleId,
        hasDeviceId: !!deviceId,
      },
      'push_register_attempt',
    )

    await prisma.$executeRaw`
      INSERT INTO "PushDeviceRegistration" (
        "id",
        "token",
        "platform",
        "bundle_id",
        "device_id",
        "user_id",
        "created_at",
        "updated_at",
        "last_seen_at",
        "revoked_at"
      )
      VALUES (
        ${randomUUID()},
        ${token},
        ${platform},
        ${bundleId},
        ${deviceId},
        ${userId},
        NOW(),
        NOW(),
        NOW(),
        NULL
      )
      ON CONFLICT ("token", "platform")
      DO UPDATE SET
        "bundle_id" = EXCLUDED."bundle_id",
        "device_id" = EXCLUDED."device_id",
        "user_id" = COALESCE(EXCLUDED."user_id", "PushDeviceRegistration"."user_id"),
        "updated_at" = NOW(),
        "last_seen_at" = NOW(),
        "revoked_at" = NULL
    `

    return reply.send({ ok: true })
  })

  app.delete('/mobile/push/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = PushDeviceUnregisterInput.safeParse(req.body ?? req.query ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const token = deps.normalizePushToken(parse.data.token)
    if (!token) return reply.code(400).send({ error: 'invalid_token' })

    const tokenLen = token.length
    const tokenSuffix = token.slice(-8)

    const userId = await deps.resolveUserId(req)
    const registerSecret = deps.getHeaderValue(req, 'x-register-secret')
    const secretAuthorized = !!deps.pushRegisterSecret && registerSecret === deps.pushRegisterSecret
    if (!userId && !secretAuthorized) return reply.code(401).send({ error: 'unauthorized' })

    await deps.ensurePushDeviceRegistryTable()

    const platform = parse.data.platform.trim().toLowerCase()

    req.log.info(
      {
        route: '/mobile/push/register',
        method: 'DELETE',
        platform,
        tokenLen,
        tokenSuffix,
        hasUserId: !!userId,
        secretAuthorized,
      },
      'push_unregister_attempt',
    )
    const userScopeSql = secretAuthorized
      ? Prisma.sql``
      : Prisma.sql` AND ("user_id" = ${userId} OR "user_id" IS NULL)`

    const updatedCount = await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "PushDeviceRegistration"
        SET
          "revoked_at" = NOW(),
          "updated_at" = NOW()
        WHERE "token" = ${token}
          AND "platform" = ${platform}
          ${userScopeSql}
      `,
    )

    return reply.send({ ok: true, count: Number(updatedCount) || 0 })
  })
}