import webpush from 'web-push'
import {
  getActiveSubscriptionsForUser,
  markSubscriptionDeliveryFailure,
  markSubscriptionDeliverySuccess,
  type ActivePushSubscription,
} from './pushSubscriptions.js'

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim()
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim()
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || '').trim()
const MAX_FAILURES_BEFORE_DEACTIVATE = 5
const PUSH_MAX_PAYLOAD_BYTES = 3072

const ALLOWED_PUSH_TYPES = ['message', 'org', 'marketplace', 'system'] as const

export type PushPayloadType = (typeof ALLOWED_PUSH_TYPES)[number]

export type PushPayload = {
  title: string
  body: string
  url: string
  type: PushPayloadType
  entityId?: string
}

type LoggerLike = {
  info?: (payload: unknown, message?: string) => void
  warn?: (payload: unknown, message?: string) => void
  error?: (payload: unknown, message?: string) => void
}

export type PushSendResult = {
  ok: boolean
  statusCode?: number
  deactivated?: boolean
}

export type PushUserSendSummary = {
  userId: string
  attempted: number
  sent: number
  failed: number
}

let vapidConfigured = false

function isProduction(): boolean {
  return (process.env.NODE_ENV || '').toLowerCase() === 'production'
}

function truncate(value: string, max = 160): string {
  const text = (value || '').trim()
  if (!text) return ''
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function normalizeUrl(value: string): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return '/notifications'
  if (trimmed.length > 512) return trimmed.slice(0, 512)
  return trimmed
}

function normalizeType(value: string): PushPayloadType {
  return ALLOWED_PUSH_TYPES.includes(value as PushPayloadType) ? (value as PushPayloadType) : 'system'
}

function normalizeEntityId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, 160)
}

function buildSafePayload(payload: PushPayload): string {
  const safe = {
    title: truncate(payload.title, 80) || 'Civil Citizens',
    body: truncate(payload.body, 180),
    url: normalizeUrl(payload.url),
    type: normalizeType(payload.type),
    entityId: normalizeEntityId(payload.entityId),
  }
  let serialized = JSON.stringify(safe)

  if (Buffer.byteLength(serialized, 'utf8') <= PUSH_MAX_PAYLOAD_BYTES) return serialized

  safe.body = truncate(safe.body, 120)
  safe.entityId = undefined
  serialized = JSON.stringify(safe)

  if (Buffer.byteLength(serialized, 'utf8') <= PUSH_MAX_PAYLOAD_BYTES) return serialized

  safe.body = truncate(safe.body, 80)
  return JSON.stringify(safe)
}

function hasValidVapidConfig(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)
}

function configureVapidIfNeeded(): boolean {
  if (vapidConfigured) return true
  if (!hasValidVapidConfig()) return false
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  vapidConfigured = true
  return true
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY
}

export function validatePushEnvironment(logger: LoggerLike = console): boolean {
  const missing: string[] = []
  if (!VAPID_PUBLIC_KEY) missing.push('VAPID_PUBLIC_KEY')
  if (!VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY')
  if (!VAPID_SUBJECT) missing.push('VAPID_SUBJECT')

  if (!missing.length) return true

  const payload = { missing }
  if (isProduction()) {
    logger.error?.(payload, 'web_push_vapid_missing_in_production')
  } else {
    logger.warn?.(payload, 'web_push_vapid_missing_non_production')
  }
  return false
}

function toWebPushSubscription(subscription: ActivePushSubscription): webpush.PushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  }
}

export async function sendPushToSubscription(
  subscription: ActivePushSubscription,
  payload: PushPayload,
): Promise<PushSendResult> {
  if (!configureVapidIfNeeded()) {
    return { ok: false }
  }

  const body = buildSafePayload(payload)

  try {
    await webpush.sendNotification(toWebPushSubscription(subscription), body)
    await markSubscriptionDeliverySuccess(subscription.id)
    return { ok: true }
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number } | null | undefined)?.statusCode || 0) || undefined
    const shouldDeactivate = statusCode === 404 || statusCode === 410
    const failure = await markSubscriptionDeliveryFailure(subscription.id, {
      forceDeactivate: shouldDeactivate,
      maxFailures: MAX_FAILURES_BEFORE_DEACTIVATE,
    })
    return {
      ok: false,
      statusCode,
      deactivated: failure.deactivated,
    }
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushUserSendSummary> {
  const summary: PushUserSendSummary = {
    userId,
    attempted: 0,
    sent: 0,
    failed: 0,
  }

  if (!configureVapidIfNeeded()) return summary

  const subscriptions = await getActiveSubscriptionsForUser(userId)
  if (!subscriptions.length) return summary

  const seen = new Set<string>()
  const unique = subscriptions.filter((subscription) => {
    const key = subscription.endpoint
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  summary.attempted = unique.length

  const results = await Promise.allSettled(unique.map((subscription) => sendPushToSubscription(subscription, payload)))
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.ok) summary.sent += 1
    else summary.failed += 1
  }

  return summary
}

export async function sendPushToManyUsers(userIds: string[], payload: PushPayload): Promise<PushUserSendSummary[]> {
  const deduped = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))]
  if (!deduped.length) return []

  const results = await Promise.all(deduped.map((userId) => sendPushToUser(userId, payload)))
  return results
}
