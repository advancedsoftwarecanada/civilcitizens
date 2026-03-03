import { prisma } from '@civil/db'

type PushPlatformValue = 'android' | 'ios' | 'desktop' | 'unknown'
type PushBrowserValue = 'chrome' | 'edge' | 'safari' | 'unknown'

type PushSubscriptionRecord = {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
  platform: PushPlatformValue
  browser: PushBrowserValue
  createdAt: Date
  updatedAt: Date
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  failureCount: number
  isActive: boolean
}

export type WebPushSubscriptionInput = {
  endpoint: string
  expirationTime?: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export type PushSubscriptionMetaInput = {
  userAgent?: string | null
  platform?: PushPlatformValue | null
  browser?: PushBrowserValue | null
}

export type ActivePushSubscription = {
  id: string
  userId: string
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  userAgent: string | null
  platform: PushPlatformValue
  browser: PushBrowserValue
  createdAt: Date
  updatedAt: Date
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  failureCount: number
  isActive: boolean
}

function normalizeEndpoint(value: string): string {
  return value.trim()
}

function normalizeKey(value: string): string {
  return value.trim()
}

function normalizeUserAgent(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 1024)
}

function formatSubscription(record: PushSubscriptionRecord): ActivePushSubscription {
  return {
    id: record.id,
    userId: record.userId,
    endpoint: record.endpoint,
    keys: {
      p256dh: record.p256dh,
      auth: record.auth,
    },
    userAgent: record.userAgent ?? null,
    platform: record.platform,
    browser: record.browser,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSuccessAt: record.lastSuccessAt ?? null,
    lastFailureAt: record.lastFailureAt ?? null,
    failureCount: record.failureCount,
    isActive: record.isActive,
  }
}

export async function upsertSubscription(
  userId: string,
  subscription: WebPushSubscriptionInput,
  meta?: PushSubscriptionMetaInput,
): Promise<ActivePushSubscription> {
  const endpoint = normalizeEndpoint(subscription.endpoint)
  const p256dh = normalizeKey(subscription.keys.p256dh)
  const auth = normalizeKey(subscription.keys.auth)
  const userAgent = normalizeUserAgent(meta?.userAgent)
  const platform = meta?.platform ?? 'unknown'
  const browser = meta?.browser ?? 'unknown'

  const record = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      p256dh,
      auth,
      userAgent,
      platform,
      browser,
      isActive: true,
      failureCount: 0,
      lastFailureAt: null,
    },
    update: {
      // Endpoint ownership may change when users log out/in on shared devices.
      userId,
      p256dh,
      auth,
      userAgent,
      platform,
      browser,
      isActive: true,
      failureCount: 0,
      lastFailureAt: null,
    },
  })

  return formatSubscription(record)
}

export async function deactivateSubscription(userId: string, endpoint: string): Promise<number> {
  const normalizedEndpoint = normalizeEndpoint(endpoint)
  if (!normalizedEndpoint) return 0

  const result = await prisma.pushSubscription.updateMany({
    where: {
      userId,
      endpoint: normalizedEndpoint,
      isActive: true,
    },
    data: {
      isActive: false,
    },
  })

  return result.count
}

export async function getActiveSubscriptionsForUser(userId: string): Promise<ActivePushSubscription[]> {
  const records = await prisma.pushSubscription.findMany({
    where: {
      userId,
      isActive: true,
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  return records.map(formatSubscription)
}

export async function pruneInvalidSubscriptions(maxFailures = 5): Promise<number> {
  const result = await prisma.pushSubscription.updateMany({
    where: {
      isActive: true,
      failureCount: {
        gte: Math.max(1, maxFailures),
      },
    },
    data: {
      isActive: false,
    },
  })
  return result.count
}

export async function markSubscriptionDeliverySuccess(id: string): Promise<void> {
  await prisma.pushSubscription.updateMany({
    where: { id },
    data: {
      lastSuccessAt: new Date(),
      failureCount: 0,
    },
  })
}

export async function markSubscriptionDeliveryFailure(
  id: string,
  options?: {
    forceDeactivate?: boolean
    maxFailures?: number
  },
): Promise<{ failureCount: number; deactivated: boolean }> {
  try {
    const updated = await prisma.pushSubscription.update({
      where: { id },
      data: {
        lastFailureAt: new Date(),
        failureCount: { increment: 1 },
      },
      select: {
        id: true,
        failureCount: true,
        isActive: true,
      },
    })

    const maxFailures = Math.max(1, options?.maxFailures ?? 5)
    const shouldDeactivate = options?.forceDeactivate || updated.failureCount >= maxFailures
    if (shouldDeactivate && updated.isActive) {
      await prisma.pushSubscription.updateMany({
        where: { id: updated.id, isActive: true },
        data: { isActive: false },
      })
    }

    return {
      failureCount: updated.failureCount,
      deactivated: Boolean(shouldDeactivate),
    }
  } catch {
    return {
      failureCount: 0,
      deactivated: Boolean(options?.forceDeactivate),
    }
  }
}
