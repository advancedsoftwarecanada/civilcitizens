import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sse from 'fastify-sse-v2'
import rawBody from 'fastify-raw-body'
import { Queue } from 'bullmq'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { prisma } from '@civil/db'
import {
  Prisma,
  MediaCategory,
  PremiumStatus,
  BusinessStatus,
  BusinessType,
  StripeWebhookStatus,
  FriendshipStatus,
  ConnectionStatus,
  MessageThreadType,
  MessageType,
  MessageParticipantRole,
  BusinessRole,
} from '@prisma/client'
import type { City as CityModel } from '@prisma/client'
import {
  CreatePostInput,
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  SetHomeCommunityInput,
  FollowCommunityInput,
  UnfollowCommunityInput,
  UpdateProfileInput,
  CursorQuery,
  HandleParam,
  CreateCommentInput,
  VoteCommentInput,
  UpdateProfilePhotoInput,
  PostSortEnum,
  CommentSortEnum,
  PROVINCES,
  getCommunitiesByProvince,
  findCommunity,
  normalizeProvinceCode,
  getProvinceDisplayName,
  buildHandleBase,
  JurisdictionEnum,
  CommunityGeolocateInput,
  PostalGeolocateInput,
  PostalLookupInput,
  RequestMediaUploadInput,
  CompleteMediaUploadInput,
  MediaAssetIdSchema,
  CitySummarySchema,
  CreateDirectThreadInput,
  CreateGroupThreadInput,
  GroupParticipantInput,
  SendMessageInput,
  MessageThreadListQuery,
  UpdatePostInput,
  MessageListQuery,
  ThreadReadInput,
  slugifyCommunityName,
} from '@civil/shared'
import bcrypt from 'bcryptjs'
import { Redis as IORedis } from 'ioredis'
import Stripe from 'stripe'
type DailyCount = { date: string; count: number }
type JobAnalyticsKind = 'job_added' | 'applicant_submitted' | 'applications_viewed' | 'applicant_hired'

const METRIC_TABLES = {
  users: { table: '"User"', column: '"createdAt"' },
  posts: { table: '"Post"', column: '"createdAt"' },
  comments: { table: '"Comment"', column: '"createdAt"' },
  reactions: { table: '"PostReaction"', column: '"createdAt"' },
} as const

type DateRange = { start: Date; end: Date }

async function queryDailyCounts(kind: keyof typeof METRIC_TABLES, range: DateRange): Promise<DailyCount[]> {
  const config = METRIC_TABLES[kind]
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', ${Prisma.raw(config.column)}) as date, count(*)::bigint as count
    from ${Prisma.raw(config.table)}
    where ${Prisma.raw(config.column)} >= ${range.start} and ${Prisma.raw(config.column)} < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function queryPageViewSeries(range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', "createdAt") as date, count(*)::bigint as count
    from "PageView"
    where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function queryJobAnalyticsSeries(kind: JobAnalyticsKind, range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', "createdAt") as date, count(*)::bigint as count
    from "JobAnalyticsEvent"
    where "kind" = ${kind}::"JobAnalyticsEventKind"
      and "createdAt" >= ${range.start}
      and "createdAt" < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function trackJobAnalyticsEvent(args: {
  kind: JobAnalyticsKind
  businessId: string
  jobPostingId?: string | null
  jobApplicationId?: string | null
  actorUserId?: string | null
  createdAt?: Date
}) {
  await prisma.$executeRaw`
    INSERT INTO "JobAnalyticsEvent" (
      "id", "kind", "businessId", "jobPostingId", "jobApplicationId", "actorUserId", "createdAt"
    )
    VALUES (
      ${randomUUID()},
      ${args.kind}::"JobAnalyticsEventKind",
      ${args.businessId},
      ${args.jobPostingId ?? null},
      ${args.jobApplicationId ?? null},
      ${args.actorUserId ?? null},
      ${args.createdAt ?? new Date()}
    )
  `
}

function startOfUtcDay(date: Date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

const TrackViewInput = z.object({
  path: z.string().min(1),
  postId: z.string().optional(),
  referrer: z.string().optional(),
})

function parseDateInput(value?: string | null, fallbackDays = 30): { start: Date; end: Date } {
  const now = new Date()
  const end = startOfUtcDay(now)
  end.setUTCDate(end.getUTCDate() + 1)

  let start = startOfUtcDay(new Date(now.getTime() - (fallbackDays - 1) * 24 * 60 * 60 * 1000))
  if (value) {
    const candidate = new Date(value)
    if (!Number.isNaN(candidate.getTime())) {
      start = startOfUtcDay(candidate)
    }
  }
  return { start, end }
}

function parseRange(start?: string | null, end?: string | null): DateRange {
  const today = startOfUtcDay(new Date())
  const defaultStart = startOfUtcDay(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000))
  let rangeStart = defaultStart
  let rangeEnd = startOfUtcDay(new Date(today.getTime() + 24 * 60 * 60 * 1000))

  if (start) {
    const s = new Date(start)
    if (!Number.isNaN(s.getTime())) rangeStart = startOfUtcDay(s)
  }
  if (end) {
    const e = new Date(end)
    if (!Number.isNaN(e.getTime())) {
      const endDay = startOfUtcDay(e)
      endDay.setUTCDate(endDay.getUTCDate() + 1)
      rangeEnd = endDay
    }
  }
  if (rangeEnd <= rangeStart) {
    rangeEnd = startOfUtcDay(new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000))
  }
  return { start: rangeStart, end: rangeEnd }
}
type ExperienceModel = Prisma.ExperienceGetPayload<{ select: { id: true; title: true; organization: true; location: true; startDate: true; endDate: true; current: true; description: true; position: true } }>
import { createHash, randomInt, randomUUID } from 'crypto'
import { locateCommunityFromPoint, getCommunityCentroid } from './geodata.js'
import { locateFsaFromPoint } from './fsaLocator.js'
import { statsCanPointToWgs84 } from './statscan.js'
import {
  deactivateSubscription,
  pruneInvalidSubscriptions,
  upsertSubscription,
  type PushSubscriptionMetaInput,
  type WebPushSubscriptionInput as WebPushSubscriptionRecordInput,
} from './pushSubscriptions.js'
import {
  getVapidPublicKey,
  sendPushToUser,
  validatePushEnvironment,
  type PushPayloadType,
} from './pushSender.js'

const PORT = Number(process.env.PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const MEDIA_S3_ENDPOINT = process.env.MEDIA_S3_ENDPOINT || 'http://127.0.0.1:9000'
const MEDIA_S3_REGION = process.env.MEDIA_S3_REGION || 'us-east-1'
const MEDIA_S3_ACCESS_KEY = process.env.MEDIA_S3_ACCESS_KEY || 'minioadmin'
const MEDIA_S3_SECRET_KEY = process.env.MEDIA_S3_SECRET_KEY || 'minioadmin'
const MEDIA_BUCKET_PUBLIC = process.env.MEDIA_BUCKET_PUBLIC || 'civil-media'
const MEDIA_BUCKET_ORIGINAL = process.env.MEDIA_BUCKET_ORIGINAL || 'civil-media-raw'
const CIVIL_PUBLIC_HOST = process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca'
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || `https://${CIVIL_PUBLIC_HOST}/media`).replace(/\/$/, '')
const MEDIA_SIGNED_URL_TTL = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || 900)
const LEGACY_MEDIA_BASE_URLS = [
  'http://localhost:9000/civil-media',
  'http://127.0.0.1:9000/civil-media',
  'http://minio:9000/civil-media',
]

function isPrivateOrLocalNetworkUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === 'minio') return true
    if (host === '127.0.0.1' || host === '::1') return true
    if (host.startsWith('10.')) return true
    if (host.startsWith('192.168.')) return true

    const match172 = host.match(/^172\.(\d{1,3})\./)
    if (match172) {
      const secondOctet = Number(match172[1])
      if (Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31) return true
    }

    return false
  } catch {
    return false
  }
}

const STRIPE_API_VERSION = '2024-06-20'
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const STRIPE_PRICE_PREMIUM = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || ''
const STRIPE_PRICE_BUSINESS = process.env.STRIPE_PRICE_BUSINESS_MONTHLY || ''
const STRIPE_PUBLISHABLE_KEY = (process.env.STRIPE_PUBLIC_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
const BILLING_PORTAL_RETURN_FALLBACK = process.env.BILLING_RETURN_URL || `https://${CIVIL_PUBLIC_HOST}/settings/billing`
const MAX_BUSINESSES_PER_USER = 5
const DEFAULT_SUPER_ADMINS = ['andrewnormore@gmail.com']
const COMMUNITY_FOLLOW_TARGET = 3
const COMMUNITY_SUGGESTION_CACHE_LIMIT = 10
const NOTIFICATION_CHANNEL_PREFIX = 'chan:notify:'
const PUSH_REGISTER_SECRET = (process.env.PUSH_REGISTER_SECRET || '').trim()
const PUSH_ADMIN_SECRET = (process.env.PUSH_ADMIN_SECRET || '').trim()
const PUSH_DELIVERY_URL = (process.env.PUSH_DELIVERY_URL || '').trim().replace(/\/$/, '')

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

const PUSH_ROUTE_BODY_LIMIT_BYTES = 16 * 1024
const PUSH_SUBSCRIBE_LIMIT_PER_MINUTE = 12
const PUSH_TEST_LIMIT_PER_MINUTE = 5

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

let pushDeviceRegistryReady: Promise<void> | null = null

function normalizePushToken(rawToken: string): string | null {
  const normalized = rawToken.trim().toLowerCase()
  if (!/^[0-9a-f]{32,512}$/.test(normalized)) return null
  return normalized
}

function getHeaderValue(req: FastifyRequest, key: string): string | null {
  const raw = req.headers[key.toLowerCase()]
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length ? trimmed : null
  }
  if (Array.isArray(raw)) {
    const first = raw[0]
    if (typeof first === 'string') {
      const trimmed = first.trim()
      return trimmed.length ? trimmed : null
    }
  }
  return null
}

function ensurePushDeviceRegistryTable(): Promise<void> {
  if (pushDeviceRegistryReady) return pushDeviceRegistryReady

  pushDeviceRegistryReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PushDeviceRegistration" (
        "id" TEXT PRIMARY KEY,
        "token" TEXT NOT NULL,
        "platform" TEXT NOT NULL,
        "bundle_id" TEXT,
        "device_id" TEXT,
        "user_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "revoked_at" TIMESTAMPTZ
      );
    `)
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "PushDeviceRegistration_token_platform_key" ON "PushDeviceRegistration" ("token", "platform");',
    )
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "PushDeviceRegistration_user_platform_revoked_idx" ON "PushDeviceRegistration" ("user_id", "platform", "revoked_at");',
    )
  })().catch((err) => {
    pushDeviceRegistryReady = null
    throw err
  })

  return pushDeviceRegistryReady
}

type CitySummaryType = z.infer<typeof CitySummarySchema>

type CommunityMetaPayload = {
  nearbyCommunities?: CitySummaryType[]
  computedAt?: string
  reference?: {
    provinceCode?: string | null
    communitySlug?: string | null
    cityName?: string | null
  } | null
}

const buildFollowKey = (province: string, communitySlug: string) => `${province}:${communitySlug}`

function parseCommunityMeta(value: Prisma.JsonValue | null | undefined): CommunityMetaPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const nearby = Array.isArray(payload.nearbyCommunities)
    ? (payload.nearbyCommunities as CitySummaryType[])
    : undefined
  const reference =
    payload.reference && typeof payload.reference === 'object' && !Array.isArray(payload.reference)
      ? (payload.reference as { provinceCode?: string | null; communitySlug?: string | null; cityName?: string | null })
      : null
  const computedAt = typeof payload.computedAt === 'string' ? payload.computedAt : undefined
  return {
    nearbyCommunities: nearby,
    computedAt,
    reference,
  }
}

function filterCachedSuggestions(
  suggestions: CitySummaryType[] | undefined,
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): CitySummaryType[] {
  if (!suggestions?.length) return []
  const filtered: CitySummaryType[] = []
  for (const entry of suggestions) {
    if (!entry?.communitySlug) continue
    const key = buildFollowKey(entry.provinceCode, entry.communitySlug)
    if (excludeKeys.has(key)) continue
    filtered.push(entry)
    if (filtered.length >= limit) break
  }
  return filtered
}

async function computeNearbyCommunitySuggestions(
  referenceCity: CityModel | null,
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): Promise<CitySummaryType[]> {
  let candidateCities: Array<{ city: CityModel; distance?: number }> = []

  if (referenceCity) {
    const provinceCities = await prisma.city.findMany({
      where: { provinceCode: referenceCity.provinceCode },
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: 400,
    })

    candidateCities = provinceCities.map((city: CityModel) => {
      let distance: number | undefined
      if (
        typeof referenceCity.latitude === 'number' &&
        typeof referenceCity.longitude === 'number' &&
        typeof city.latitude === 'number' &&
        typeof city.longitude === 'number'
      ) {
        distance = haversineDistanceKm(referenceCity.latitude, referenceCity.longitude, city.latitude, city.longitude)
      }
      return { city, distance }
    })

    candidateCities.sort((a, b) => {
      const distanceA = a.distance
      const distanceB = b.distance
      if (typeof distanceA === 'number' && typeof distanceB === 'number') {
        return distanceA - distanceB
      }
      if (typeof distanceA === 'number') return -1
      if (typeof distanceB === 'number') return 1
      const populationA = a.city.population ?? 0
      const populationB = b.city.population ?? 0
      return populationB - populationA
    })
  } else {
    const topCities = await prisma.city.findMany({
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: 400,
    })
    candidateCities = topCities.map((city: CityModel) => ({ city }))
  }

  const suggestions: CitySummaryType[] = []
  for (const candidate of candidateCities) {
    if (!candidate.city.communitySlug) continue
    const key = buildFollowKey(candidate.city.provinceCode, candidate.city.communitySlug)
    if (excludeKeys.has(key)) continue
    suggestions.push(formatCitySummary(candidate.city, candidate.distance))
    if (suggestions.length >= limit) break
  }

  return suggestions
}

function normalizeEmail(value?: string | null): string | null {
  if (!value) return null
  return value.trim().toLowerCase() || null
}

const SUPER_ADMIN_EMAILS = (() => {
  const emails = new Set<string>()
  for (const email of DEFAULT_SUPER_ADMINS) {
    const normalized = normalizeEmail(email)
    if (normalized) emails.add(normalized)
  }
  const extra = (process.env.CIVIL_ADMIN_EMAILS || '')
    .split(/[,;]/)
    .map((email) => normalizeEmail(email))
    .filter((email): email is string => Boolean(email))
  for (const email of extra) {
    emails.add(email)
  }
  return emails
})()

function isSuperAdminEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return SUPER_ADMIN_EMAILS.has(normalized)
}

type AdminChecklistItemDefinition = {
  key: string
  label: string
  optional?: boolean
  hint?: string
  resolve?: () => boolean
}

type AdminChecklistGroupDefinition = {
  id: string
  title: string
  description?: string
  items: AdminChecklistItemDefinition[]
}

const ADMIN_CHECKLIST_GROUPS: AdminChecklistGroupDefinition[] = [
  {
    id: 'environment',
    title: 'Environment metadata',
    description: 'Values exported by the launcher to explain which env file is active.',
    items: [
      { key: 'CIVIL_ENV_LABEL', label: 'Environment label', hint: 'Human friendly tag for dashboards.' },
      { key: 'CIVIL_ENV_PRIMARY', label: 'Primary env file', hint: 'Path recorded by the launcher.' },
    ],
  },
  {
    id: 'stripe',
    title: 'Stripe configuration',
    description: 'Keys required for premium and business billing.',
    items: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret key', resolve: () => Boolean(STRIPE_SECRET_KEY) },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook secret', resolve: () => Boolean(STRIPE_WEBHOOK_SECRET) },
      { key: 'STRIPE_PRICE_PREMIUM_MONTHLY', label: 'Premium price ID', resolve: () => Boolean(STRIPE_PRICE_PREMIUM) },
      { key: 'STRIPE_PRICE_BUSINESS_MONTHLY', label: 'Business price ID', resolve: () => Boolean(STRIPE_PRICE_BUSINESS) },
      {
        key: 'STRIPE_PUBLIC_KEY',
        label: 'Publishable key',
        optional: true,
        hint: 'Accepts STRIPE_PUBLIC_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.',
        resolve: () => Boolean(STRIPE_PUBLISHABLE_KEY),
      },
      { key: 'BILLING_RETURN_URL', label: 'Billing portal return URL', optional: true },
    ],
  },
]

function envValuePresent(key: string): boolean {
  const value = process.env[key]
  if (typeof value !== 'string') return false
  return value.trim().length > 0
}

function buildAdminChecklist() {
  return ADMIN_CHECKLIST_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    items: group.items.map((item) => ({
      key: item.key,
      label: item.label,
      optional: Boolean(item.optional),
      hint: item.hint,
      present: item.resolve ? item.resolve() : envValuePresent(item.key),
    })),
  }))
}

let stripeClient: Stripe | null = null

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY)
}

function requireStripeConfig() {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing features.')
  }
}

function getStripeClient() {
  requireStripeConfig()
  if (stripeClient) return stripeClient
  stripeClient = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
  return stripeClient
}

function mapSubscriptionStatus(status?: Stripe.Subscription.Status | null): PremiumStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ACTIVE'
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE'
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED'
    default:
      return 'PENDING'
  }
}

function businessStatusFromSubscription(status?: Stripe.Subscription.Status | null): BusinessStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ACTIVE'
    case 'past_due':
    case 'unpaid':
      return 'SUSPENDED'
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED'
    default:
      return 'DRAFT'
  }
}

function isPremium(status: PremiumStatus | null | undefined) {
  return status === 'ACTIVE'
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizeMediaUrl(url?: string | null): string | null {
  if (!url) return url ?? null
  for (const legacy of LEGACY_MEDIA_BASE_URLS) {
    if (url.startsWith(legacy)) {
      return `${MEDIA_PUBLIC_BASE_URL}${url.slice(legacy.length)}`
    }
  }
  return url
}

function normalizeMediaVariants(variants: unknown): unknown {
  if (!variants || typeof variants !== 'object') return variants
  let mutated = false
  const copy: Record<string, any> = { ...(variants as Record<string, any>) }
  for (const [name, value] of Object.entries(copy)) {
    if (value && typeof value === 'object' && typeof (value as any).url === 'string') {
      const normalized = normalizeMediaUrl((value as any).url)
      if (normalized !== (value as any).url) {
        copy[name] = { ...value, url: normalized }
        mutated = true
      }
    }
  }
  return mutated ? copy : variants
}

function normalizeUserMedia<T extends { avatarUrl?: string | null; coverUrl?: string | null }>(user: T): T {
  const normalizedAvatar = normalizeMediaUrl(user.avatarUrl ?? null)
  const normalizedCover = normalizeMediaUrl(user.coverUrl ?? null)
  if (normalizedAvatar !== (user.avatarUrl ?? null) || normalizedCover !== (user.coverUrl ?? null)) {
    return {
      ...user,
      avatarUrl: normalizedAvatar,
      coverUrl: normalizedCover,
    }
  }
  return user
}

const MB = 1024 * 1024
const MEDIA_CATEGORY_LIMITS: Record<MediaCategory, number> = {
  avatar: 8 * MB,
  cover: 20 * MB,
  business_logo: 8 * MB,
  business_cover: 20 * MB,
  post_image: 80 * MB,
  attachment: 200 * MB,
}
const MEDIA_PROXY_UPLOAD_LIMIT = 250 * MB

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'])
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
const BINARY_UPLOAD_MIME_TYPES = ['application/octet-stream', ...IMAGE_MIME_TYPES]

const s3Client = new S3Client({
  region: MEDIA_S3_REGION,
  endpoint: MEDIA_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: MEDIA_S3_ACCESS_KEY,
    secretAccessKey: MEDIA_S3_SECRET_KEY,
  },
})

export const app = Fastify({
  logger: true,
  trustProxy: true, // behind Nginx/Cloudflare
})

type CommunityRouteMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'
type CommunityRouteHandler = (req: FastifyRequest, reply: FastifyReply) => unknown

// Registers a community route and keeps a legacy /chambers alias for older clients.
function registerCommunityRoute(method: CommunityRouteMethod, path: string, handler: CommunityRouteHandler) {
  if (!path.startsWith('/communities')) {
    throw new Error(`registerCommunityRoute requires /communities path, received: ${path}`)
  }
  ;(app as any)[method](path, handler)
  const legacyPath = path.replace('/communities', '/chambers')
  if (legacyPath !== path) {
    ;(app as any)[method](legacyPath, handler)
  }
}

for (const mime of BINARY_UPLOAD_MIME_TYPES) {
  app.addContentTypeParser(mime, { parseAs: 'buffer' }, (request, payload, done) => {
    done(null, payload)
  })
}

const EARTH_RADIUS_KM = 6371

function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

const POSTAL_SANITIZE_RE = /[^A-Z0-9]/g
const POSTAL_FSA_REGEX = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/
const POSTAL_FULL_REGEX = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/

type NormalizedPostal = {
  postal: string
  fsa: string
}

function normalizePostalCodeInput(value?: string | null): NormalizedPostal | null {
  if (!value) return null
  const sanitized = value.toUpperCase().replace(POSTAL_SANITIZE_RE, '')
  if (sanitized.length < 3) return null
  const fsa = sanitized.slice(0, 3)
  if (!POSTAL_FSA_REGEX.test(fsa)) return null
  const full = sanitized.slice(0, 6)
  const postal = POSTAL_FULL_REGEX.test(full) ? full : fsa
  return { postal, fsa }
}

type ProvinceCodeLiteral = (typeof PROVINCES)[number]['code']

function formatCitySummary(city: CityModel, distanceKm?: number): CitySummaryType {
  const provinceName = getProvinceDisplayName(city.provinceCode) ?? city.provinceCode.toUpperCase()
  return {
    name: city.name,
    slug: city.slug,
    provinceCode: city.provinceCode,
    provinceName,
    communitySlug: city.communitySlug,
    communityName: city.communityName,
    latitude: city.latitude,
    longitude: city.longitude,
    population: city.population ?? null,
    distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(1)) : undefined,
  }
}

function pickNearestCitySummary(cities: CityModel[], lat: number, lng: number): CitySummaryType | undefined {
  if (!cities.length) return undefined
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return formatCitySummary(cities[0]!)
  }
  let closest: CityModel | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const city of cities) {
    const distance = haversineDistanceKm(lat, lng, city.latitude, city.longitude)
    if (!closest || distance < bestDistance) {
      closest = city
      bestDistance = distance
    }
  }
  if (!closest) return formatCitySummary(cities[0]!)
  return formatCitySummary(closest, bestDistance)
}

type CommunitySummaryPayload = {
  provinceCode: ProvinceCodeLiteral
  provinceName: string
  municipalitySlug: string
  municipalityName: string
  population: number | null
  regionLabel: string | null
  communitySlug: string | null
  communityName: string | null
  censusSubdivision: {
    slug: string
    name: string
    type: string | null
  } | null
  source: 'city' | 'subdivision'
}

const pickLabel = (...labels: Array<string | null | undefined>) => {
  for (const candidate of labels) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (trimmed) return trimmed
  }
  return null
}

type CityWithSubdivision = CityModel & {
  censusSubdivision?: {
    slug: string
    name: string
    type: string | null
    defaultCommunityName: string | null
  } | null
}

function buildCommunityPayloadFromCity(city: CityWithSubdivision): CommunitySummaryPayload {
  const provinceCode = city.provinceCode as ProvinceCodeLiteral
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) ?? provinceCode.toUpperCase(),
    municipalitySlug: city.slug,
    municipalityName: city.name,
    population: city.population ?? null,
    regionLabel: pickLabel(city.censusSubdivision?.defaultCommunityName, city.censusSubdivision?.name, city.communityName),
    communitySlug: city.communitySlug,
    communityName: city.communityName,
    censusSubdivision: city.censusSubdivision
      ? {
          slug: city.censusSubdivision.slug,
          name: city.censusSubdivision.name,
          type: city.censusSubdivision.type ?? null,
        }
      : null,
    source: 'city',
  }
}

type SubdivisionWithDivision = {
  slug: string
  name: string
  officialName: string | null
  type: string | null
  population: number | null
  defaultCommunityName: string | null
  defaultCommunitySlug: string | null
  division: { name: string | null } | null
}

function buildCommunityPayloadFromSubdivision(
  subdivision: SubdivisionWithDivision,
  provinceCode: ProvinceCodeLiteral,
): CommunitySummaryPayload {
  const municipalityName = pickLabel(subdivision.officialName, subdivision.name) ?? subdivision.name
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) ?? provinceCode.toUpperCase(),
    municipalitySlug: subdivision.slug,
    municipalityName,
    population: subdivision.population ?? null,
    regionLabel: pickLabel(subdivision.defaultCommunityName, subdivision.division?.name, subdivision.name),
    communitySlug: subdivision.defaultCommunitySlug ? subdivision.defaultCommunitySlug : null,
    communityName: pickLabel(subdivision.defaultCommunityName),
    censusSubdivision: {
      slug: subdivision.slug,
      name: subdivision.name,
      type: subdivision.type ?? null,
    },
    source: 'subdivision',
  }
}

type LocateResult = Awaited<ReturnType<typeof locateCommunityFromPoint>>
type RawGeoMatch = NonNullable<LocateResult['primary']>
type RawGeoMatchOrNull = LocateResult['primary']
type EnrichedGeoMatch = RawGeoMatch & { city?: CitySummaryType }
type EnrichedGeoMatchOrNull = (RawGeoMatch & { city?: CitySummaryType }) | null

async function enrichMatchesWithCities(matches: RawGeoMatchOrNull[], lat: number, lng: number): Promise<EnrichedGeoMatchOrNull[]> {
  const validMatches = matches.filter((match): match is RawGeoMatch => Boolean(match))
  if (!validMatches.length) {
    return matches as EnrichedGeoMatchOrNull[]
  }

  const communitySlugs = [...new Set(validMatches.map((match) => match.communitySlug))]
  const cityRows = await prisma.city.findMany({
    where: { communitySlug: { in: communitySlugs } },
  })

  const citiesByCommunity = new Map<string, CityModel[]>()
  for (const city of cityRows) {
    const list = citiesByCommunity.get(city.communitySlug)
    if (list) {
      list.push(city)
    } else {
      citiesByCommunity.set(city.communitySlug, [city])
    }
  }

  return matches.map((match) => {
    if (!match) return null
    const cityOptions = citiesByCommunity.get(match.communitySlug) ?? []
    const summary = pickNearestCitySummary(cityOptions, lat, lng)
    if (!summary) return match
    return { ...match, city: summary }
  }) as EnrichedGeoMatchOrNull[]
}

async function citySummaryFromGeoMatch(match: EnrichedGeoMatch): Promise<CitySummaryType | null> {
  if (!match) return null
  if (match.city) return match.city
  const centroid = await getCommunityCentroid(match.province, match.communitySlug)
  if (!centroid) return null
  const provinceName = getProvinceDisplayName(match.province as ProvinceCodeLiteral) ?? match.province.toUpperCase()
  return {
    name: match.communityName,
    slug: match.communitySlug,
    provinceCode: match.province,
    provinceName,
    communitySlug: match.communitySlug,
    communityName: match.communityName,
    latitude: centroid.lat,
    longitude: centroid.lng,
    population: match.city?.population ?? null,
    distanceKm: typeof match.distanceKm === 'number' ? Number(match.distanceKm.toFixed(1)) : undefined,
  }
}

async function computeGeodataFallbackSuggestions(
  referenceFollow: { provinceCode: string; communitySlug: string },
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): Promise<CitySummaryType[]> {
  const centroid = await getCommunityCentroid(referenceFollow.provinceCode, referenceFollow.communitySlug)
  if (!centroid) return []
  const locateResult = await locateCommunityFromPoint(centroid.lat, centroid.lng, { limit })
  const enriched = await enrichMatchesWithCities([locateResult.primary, ...locateResult.alternatives], centroid.lat, centroid.lng)
  const suggestions: CitySummaryType[] = []
  for (const match of enriched) {
    if (!match) continue
    const key = buildFollowKey(match.province, match.communitySlug)
    if (excludeKeys.has(key)) continue
    const summary = await citySummaryFromGeoMatch(match)
    if (!summary) continue
    suggestions.push(summary)
    if (suggestions.length >= limit) break
  }
  return suggestions
}

await app.register(cors, { origin: true, credentials: true })
await app.register(jwt, { secret: JWT_SECRET })
await app.register(sse as any)
await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true,
})

const redis = new IORedis(REDIS_URL)
void redis

const mediaQueue = new Queue('media', {
  connection: {
    url: REDIS_URL,
  },
})

const FRIEND_USER_SELECT = {
  id: true,
  handle: true,
  name: true,
  avatarUrl: true,
  coverUrl: true,
  premiumStatus: true,
} satisfies Prisma.UserSelect

type FriendUser = Prisma.UserGetPayload<{ select: typeof FRIEND_USER_SELECT }>

function formatFriendUser(user: FriendUser) {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
    isPremium: isPremium(user.premiumStatus),
    isVerified: isPremium(user.premiumStatus),
  }
}

const FRIENDSHIP_WITH_USERS_INCLUDE = {
  requester: { select: FRIEND_USER_SELECT },
  addressee: { select: FRIEND_USER_SELECT },
} satisfies Prisma.FriendshipInclude

type FriendshipWithUsers = Prisma.FriendshipGetPayload<{ include: typeof FRIENDSHIP_WITH_USERS_INCLUDE }>

const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  actorId: true,
  type: true,
  postId: true,
  payload: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect

type NotificationRecord = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>

function formatNotification(record: NotificationRecord) {
  return {
    id: record.id,
    type: record.type,
    actorId: record.actorId,
    postId: record.postId ?? null,
    payload: record.payload ?? null,
    readAt: record.readAt ?? null,
    createdAt: record.createdAt,
    unread: !record.readAt,
  }
}

async function dispatchRealtimeEvent(userId: string, payload: { type: string; data: unknown }) {
  const channel = `${NOTIFICATION_CHANNEL_PREFIX}${userId}`
  try {
    await redis.publish(channel, JSON.stringify(payload))
  } catch (err) {
    console.error('failed to publish realtime payload', err)
  }
}

async function loadActivePushTokens(userId: string, platform = 'ios'): Promise<string[]> {
  try {
    await ensurePushDeviceRegistryTable()
    const rows = await prisma.$queryRaw<Array<{ token: string }>>`
      SELECT "token"
      FROM "PushDeviceRegistration"
      WHERE "user_id" = ${userId}
        AND "platform" = ${platform}
        AND "revoked_at" IS NULL
      ORDER BY "last_seen_at" DESC
      LIMIT 25
    `
    const unique = new Set<string>()
    for (const row of rows) {
      const token = normalizePushToken(row.token)
      if (token) unique.add(token)
    }
    return [...unique]
  } catch (err) {
    console.error('failed to load push tokens', err)
    return []
  }
}

async function revokePushToken(token: string, platform: string): Promise<void> {
  try {
    await ensurePushDeviceRegistryTable()
    await prisma.$executeRaw`
      UPDATE "PushDeviceRegistration"
      SET
        "revoked_at" = NOW(),
        "updated_at" = NOW()
      WHERE "token" = ${token}
        AND "platform" = ${platform}
        AND "revoked_at" IS NULL
    `
  } catch {
    // ignore
  }
}

function parseApnsReason(payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText || '{}')
    return typeof parsed?.reason === 'string' ? parsed.reason : ''
  } catch {
    return ''
  }
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

async function withinPushRateLimit(options: {
  userId: string
  bucket: string
  maxPerMinute: number
}): Promise<boolean> {
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

function mapNotificationPushType(type: string): PushPayloadType {
  const normalized = type.trim().toLowerCase()
  if (normalized.startsWith('message_')) return 'message'
  if (normalized.includes('market')) return 'marketplace'
  if (normalized.startsWith('org_') || normalized.startsWith('event_')) return 'org'
  return 'system'
}

async function loadUnreadMessageCount(userId: string): Promise<number> {
  try {
    const result = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int as count
      FROM "Message" m
      JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
      WHERE mp."userId" = ${userId}
      AND m."senderId" != ${userId}
      AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
    `
    const count = Number(result[0]?.count || 0)
    return Number.isFinite(count) && count > 0 ? count : 0
  } catch {
    return 0
  }
}

function buildPushAlert(record: NotificationRecord, actor: ReturnType<typeof formatFriendUser> | null): { title: string; message: string } | null {
  const actorLabel = actor?.name || actor?.handle || 'Someone'
  if (record.type === FRIEND_NOTIFICATION_TYPES.REQUEST) {
    return {
      title: 'New friend request',
      message: `${actorLabel} sent you a friend request.`,
    }
  }
  if (record.type === FRIEND_NOTIFICATION_TYPES.ACCEPT) {
    return {
      title: 'Friend request accepted',
      message: `${actorLabel} accepted your friend request.`,
    }
  }
  if (record.type === COMMENT_NOTIFICATION_TYPES.REPLY) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
    return {
      title: 'New reply',
      message: preview ? `${actorLabel} replied: ${preview}` : `${actorLabel} replied to your comment.`,
    }
  }
  if (record.type === COMMENT_NOTIFICATION_TYPES.POST_COMMENT) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
    return {
      title: 'New comment',
      message: preview ? `${actorLabel} commented: ${preview}` : `${actorLabel} commented on your post.`,
    }
  }
  if (record.type === CONNECTION_NOTIFICATION_TYPES.REQUEST) {
    return {
      title: 'New connection request',
      message: `${actorLabel} sent you a connection request.`,
    }
  }
  if (record.type === CONNECTION_NOTIFICATION_TYPES.ACCEPT) {
    return {
      title: 'Connection request accepted',
      message: `${actorLabel} accepted your connection request.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    return {
      title: 'Guest speaker invite',
      message: eventTitle ? `${actorLabel} invited you to speak at "${eventTitle}".` : `${actorLabel} invited you to be a guest speaker.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    return {
      title: 'Sponsor invite',
      message: eventTitle ? `${actorLabel} invited your organization to sponsor "${eventTitle}".` : `${actorLabel} invited your organization to sponsor an event.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_RESPONSE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    const verb = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'responded to'
    return {
      title: 'Guest speaker response',
      message: eventTitle ? `${actorLabel} ${verb} your invite for "${eventTitle}".` : `${actorLabel} ${verb} your guest speaker invite.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.SPONSOR_RESPONSE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    const verb = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'responded to'
    return {
      title: 'Sponsor response',
      message: eventTitle ? `${actorLabel} ${verb} your sponsor invite for "${eventTitle}".` : `${actorLabel} ${verb} your sponsor invite.`,
    }
  }
  if (record.type === ORG_NOTIFICATION_TYPES.USER_INVITE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const organizationName = typeof payload?.organizationName === 'string' ? payload.organizationName.trim() : 'an organization'
    return {
      title: 'Organization invite',
      message: `${actorLabel} invited you to join ${organizationName}.`,
    }
  }
  return {
    title: 'Civil Citizens',
    message: `${actorLabel} sent you a notification.`,
  }
}

function getNotificationDeepLink(record: NotificationRecord): string | null {
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : null

  const candidates = record.type === COMMENT_NOTIFICATION_TYPES.REPLY
    ? [payload?.replyUrl, payload?.url, payload?.sourceUrl]
    : [payload?.url, payload?.sourceUrl, payload?.replyUrl]

  for (const raw of candidates) {
    const url = typeof raw === 'string' ? raw.trim() : ''
    if (url.startsWith('/')) {
      return url
    }
  }
  return null
}

function buildWebPushPayloadForNotification(
  record: NotificationRecord,
  actor: ReturnType<typeof formatFriendUser> | null,
): {
  title: string
  body: string
  url: string
  type: PushPayloadType
  entityId: string
} | null {
  const alert = buildPushAlert(record, actor)
  if (!alert) return null

  return {
    title: alert.title,
    body: alert.message,
    url: getNotificationDeepLink(record) ?? '/notifications',
    type: mapNotificationPushType(record.type),
    entityId: record.id,
  }
}

async function sendMobilePushNotification(record: NotificationRecord, actor: ReturnType<typeof formatFriendUser> | null) {
  if (!PUSH_DELIVERY_URL) return

  const alert = buildPushAlert(record, actor)
  if (!alert) return

  const tokens = await loadActivePushTokens(record.userId, 'ios')
  if (!tokens.length) return

  await Promise.allSettled(
    tokens.map(async (deviceToken) => {
      const response = await fetch(`${PUSH_DELIVERY_URL}/send-test`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(PUSH_ADMIN_SECRET ? { 'x-admin-secret': PUSH_ADMIN_SECRET } : {}),
        },
        body: JSON.stringify({
          deviceToken,
          title: alert.title,
          message: alert.message,
          sound: 'civil-general.caf',
          data: {
            kind: 'notification',
            url: getNotificationDeepLink(record) ?? '/notifications',
          },
        }),
      })

      const raw = await response.text().catch(() => '')
      if (!response.ok) {
        console.error('push_delivery_failed', {
          status: response.status,
          deviceTokenSuffix: deviceToken.slice(-8),
          payload: raw,
        })
        return
      }

      try {
        const parsed = JSON.parse(raw || '{}')
        const apnsStatus = Number(parsed?.result?.status || 0)
        const apnsText = typeof parsed?.result?.text === 'string' ? parsed.result.text : ''
        if (apnsStatus >= 200 && apnsStatus < 300) return

        const reason = parseApnsReason(apnsText)
        console.error('push_delivery_failed', {
          status: response.status,
          apnsStatus,
          reason,
          deviceTokenSuffix: deviceToken.slice(-8),
        })

        if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
          void revokePushToken(deviceToken, 'ios')
        }
      } catch {
        // ignore
      }
    }),
  )
}

function truncatePushBody(value: string, maxLen = 140): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
}

function formatDisplayNameForPush(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ')
}

function isThreadMuted(mutedUntil: Date | null | undefined): boolean {
  if (!mutedUntil) return false
  return new Date(mutedUntil).getTime() > Date.now()
}

async function sendMobilePushForMessageCreated(args: {
  threadId: string
  message: MessageRecord
  participants: Array<{ userId: string; mutedUntil?: Date | null }>
  pushUrl?: string
}) {
  const rawSenderLabel = args.message.sender?.name || args.message.sender?.handle || 'Someone'
  const senderLabel = formatDisplayNameForPush(rawSenderLabel) || rawSenderLabel
  const attachmentCount = normalizeAttachmentList(args.message.attachments).length
  const rawPreview = (args.message.body || '').trim()
  const preview = rawPreview
    ? rawPreview
    : attachmentCount > 0
      ? 'Sent an attachment.'
      : 'Sent you a message.'

  const title = senderLabel
  const body = truncatePushBody(preview)
  if (!body) return
  const pushUrl = args.pushUrl?.trim() || `/messages?thread=${encodeURIComponent(args.threadId)}`

  const targets = args.participants
    .filter((p) => p.userId !== args.message.senderId)
    .filter((p) => !isThreadMuted(p.mutedUntil ?? null))

  await Promise.allSettled(
    targets.map((participant) =>
      sendPushToUser(participant.userId, {
        title,
        body,
        url: pushUrl,
        type: 'message',
        entityId: args.threadId,
      }),
    ),
  )

  if (!PUSH_DELIVERY_URL) return

  await Promise.allSettled(
    targets.map(async (participant) => {
      const tokens = await loadActivePushTokens(participant.userId, 'ios')
      if (!tokens.length) return

      const badge = await loadUnreadMessageCount(participant.userId)

      await Promise.allSettled(
        tokens.map(async (deviceToken) => {
          const response = await fetch(`${PUSH_DELIVERY_URL}/send-test`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(PUSH_ADMIN_SECRET ? { 'x-admin-secret': PUSH_ADMIN_SECRET } : {}),
            },
            body: JSON.stringify({
              deviceToken,
              title,
              message: body,
              badge,
              sound: 'civil-message.caf',
              data: {
                kind: 'message',
                threadId: args.threadId,
                url: pushUrl,
              },
            }),
          })

          const raw = await response.text().catch(() => '')
          if (!response.ok) {
            console.error('push_delivery_failed', {
              status: response.status,
              deviceTokenSuffix: deviceToken.slice(-8),
              payload: raw,
            })
            return
          }

          try {
            const parsed = JSON.parse(raw || '{}')
            const apnsStatus = Number(parsed?.result?.status || 0)
            const apnsText = typeof parsed?.result?.text === 'string' ? parsed.result.text : ''
            if (apnsStatus >= 200 && apnsStatus < 300) return

            const reason = parseApnsReason(apnsText)
            console.error('push_delivery_failed', {
              status: response.status,
              apnsStatus,
              reason,
              deviceTokenSuffix: deviceToken.slice(-8),
            })

            if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
              void revokePushToken(deviceToken, 'ios')
            }
          } catch {
            // ignore
          }
        }),
      )
    }),
  )
}

async function dispatchNotification(
  record: NotificationRecord,
  options?: {
    suppressMobilePush?: boolean
  },
) {
  let actor: ReturnType<typeof formatFriendUser> | null = null
  if (record.actorId) {
    const actorRecord = await prisma.user.findUnique({ where: { id: record.actorId }, select: FRIEND_USER_SELECT })
    if (actorRecord) {
      actor = formatFriendUser(actorRecord)
    }
  }
  await dispatchRealtimeEvent(record.userId, {
    type: 'notification',
    data: {
      ...formatNotification(record),
      actor,
    },
  })
  if (!options?.suppressMobilePush) {
    void sendMobilePushNotification(record, actor)
    const payload = buildWebPushPayloadForNotification(record, actor)
    if (payload) {
      void sendPushToUser(record.userId, payload)
    }
  }
}

async function createNotificationRecord(data: {
  userId: string
  actorId: string
  type: string
  postId?: string | null
  payload?: Prisma.InputJsonValue
  suppressMobilePush?: boolean
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      actorId: data.actorId,
      type: data.type,
      postId: data.postId ?? null,
      payload: data.payload ?? undefined,
    },
    select: NOTIFICATION_SELECT,
  })
  await dispatchNotification(notification, { suppressMobilePush: Boolean(data.suppressMobilePush) })
  return notification
}

async function resolveStreamUserId(req: FastifyRequest): Promise<string | null> {
  if (!(req as any).user?.id) {
    try {
      await req.jwtVerify()
    } catch {
      // Authorization header missing or invalid; fall back to token param.
    }
  }
  const headerUserId = (req as any).user?.id
  if (headerUserId) return headerUserId
  const query = (req.query ?? {}) as { token?: string }
  const tokenParam = typeof query.token === 'string' && query.token.trim().length > 0 ? query.token.trim() : undefined
  if (!tokenParam) return null
  try {
    const payload = await app.jwt.verify<{ sub?: string }>(tokenParam)
    if (payload && typeof payload.sub === 'string' && payload.sub) {
      return payload.sub
    }
  } catch (err) {
    app.log.warn({ err }, 'notifications_stream_token_invalid')
  }
  return null
}

const FRIEND_NOTIFICATION_TYPES = {
  REQUEST: 'friend_request',
  ACCEPT: 'friend_accept',
} as const

const CONNECTION_NOTIFICATION_TYPES = {
  REQUEST: 'connection_request',
  ACCEPT: 'connection_accept',
} as const

const COMMENT_NOTIFICATION_TYPES = {
  REPLY: 'comment_reply',
  POST_COMMENT: 'comment_post',
} as const

const MESSAGE_NOTIFICATION_TYPES = {
  CREATED: 'message_created',
} as const

const EVENT_NOTIFICATION_TYPES = {
  GUEST_SPEAKER_INVITE: 'event_guest_speaker_invite',
  SPONSOR_INVITE: 'event_sponsor_invite',
  GUEST_SPEAKER_RESPONSE: 'event_guest_speaker_response',
  SPONSOR_RESPONSE: 'event_sponsor_response',
} as const

const ORG_NOTIFICATION_TYPES = {
  USER_INVITE: 'org_user_invite',
} as const

const MESSAGE_NOTIFICATION_DEDUPE_WINDOW_MS = 45_000

async function hasRecentUnreadMessageNotification(args: {
  userId: string
  actorId: string
  threadId: string
  since: Date
}): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Notification"
      WHERE "userId" = ${args.userId}
        AND "actorId" = ${args.actorId}
        AND "type" = ${MESSAGE_NOTIFICATION_TYPES.CREATED}
        AND "readAt" IS NULL
        AND "createdAt" >= ${args.since}
        AND COALESCE("payload"->>'threadId', '') = ${args.threadId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `
    return rows.length > 0
  } catch (err) {
    console.error('message_notification_dedupe_failed', err)
    return false
  }
}

async function notifyFriendRequest(friendshipId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: addresseeId,
    actorId: requesterId,
    type: FRIEND_NOTIFICATION_TYPES.REQUEST,
    payload: { friendshipId, status: 'pending' },
  })
}

async function notifyFriendAcceptance(friendshipId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: requesterId,
    actorId: addresseeId,
    type: FRIEND_NOTIFICATION_TYPES.ACCEPT,
    payload: { friendshipId },
  })
}

async function notifyConnectionRequest(connectionId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: addresseeId,
    actorId: requesterId,
    type: CONNECTION_NOTIFICATION_TYPES.REQUEST,
    payload: {
      connectionId,
      status: 'pending',
      url: '/network/professionals',
    },
  })
}

async function notifyConnectionAcceptance(connectionId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: requesterId,
    actorId: addresseeId,
    type: CONNECTION_NOTIFICATION_TYPES.ACCEPT,
    payload: {
      connectionId,
      status: 'accepted',
      url: '/network/professionals',
    },
  })
}

async function notifyEventGuestSpeakerInvite(args: {
  inviteeUserId: string
  actorUserId: string
  hostOrganizationId: string
  hostProvinceCode: string
  hostCommunitySlug: string
  hostOrganizationSlug: string
  eventId: string
  eventTitle: string
}) {
  const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE,
    payload: {
      status: 'pending',
      invitationKind: 'guest_speaker',
      hostOrganizationId: args.hostOrganizationId,
      eventId: args.eventId,
      eventTitle: args.eventTitle,
      url: eventUrl,
    },
  })
}

async function notifyEventSponsorInvite(args: {
  inviteeUserId: string
  actorUserId: string
  hostOrganizationId: string
  hostProvinceCode: string
  hostCommunitySlug: string
  hostOrganizationSlug: string
  targetOrganizationId: string
  eventId: string
  eventTitle: string
}) {
  const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE,
    payload: {
      status: 'pending',
      invitationKind: 'sponsor',
      hostOrganizationId: args.hostOrganizationId,
      targetOrganizationId: args.targetOrganizationId,
      eventId: args.eventId,
      eventTitle: args.eventTitle,
      url: eventUrl,
    },
  })
}

async function loadAcceptedFriendIds(userId: string): Promise<string[]> {
  const rows: Pick<Prisma.FriendshipGetPayload<{ select: { requesterId: true; addresseeId: true } }>, 'requesterId' | 'addresseeId'>[] =
    await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  })
  const result = new Set<string>()
  for (const row of rows) {
    result.add(row.requesterId === userId ? row.addresseeId : row.requesterId)
  }
  return [...result]
}

type ConnectionStatusValue = 'PENDING' | 'ACCEPTED' | 'REJECTED'

type ConnectionRow = {
  id: string
  requesterId: string
  addresseeId: string
  status: ConnectionStatusValue
  requestedAt: Date
  respondedAt: Date | null
}

function isConnectionTableMissingError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2021' || err.code === 'P2010') return true
  }
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : ''
  return /"Connection"|ConnectionStatus|relation .*Connection.* does not exist/i.test(message)
}

async function findConnectionBetween(userId: string, targetUserId: string): Promise<ConnectionRow | null> {
  try {
    const rows = await prisma.$queryRaw<ConnectionRow[]>`
      SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
      FROM "Connection"
      WHERE ("requesterId" = ${userId} AND "addresseeId" = ${targetUserId})
         OR ("requesterId" = ${targetUserId} AND "addresseeId" = ${userId})
      LIMIT 1
    `
    return rows[0] ?? null
  } catch (error) {
    if (isConnectionTableMissingError(error)) return null
    throw error
  }
}

async function findConnectionById(id: string): Promise<ConnectionRow | null> {
  try {
    const rows = await prisma.$queryRaw<ConnectionRow[]>`
      SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
      FROM "Connection"
      WHERE "id" = ${id}
      LIMIT 1
    `
    return rows[0] ?? null
  } catch (error) {
    if (isConnectionTableMissingError(error)) return null
    throw error
  }
}

async function createOrRefreshConnectionRequest(requesterId: string, addresseeId: string): Promise<void> {
  if (!requesterId || !addresseeId || requesterId === addresseeId) return

  try {
    const existing = await findConnectionBetween(requesterId, addresseeId)
    if (existing) {
      if (existing.status === 'ACCEPTED' || existing.status === 'PENDING') {
        return
      }

      const now = new Date()
      await prisma.$executeRaw`
        UPDATE "Connection"
        SET "requesterId" = ${requesterId},
            "addresseeId" = ${addresseeId},
            "status" = 'PENDING',
            "requestedAt" = ${now},
            "respondedAt" = NULL
        WHERE "id" = ${existing.id}
      `

      await notifyConnectionRequest(existing.id, requesterId, addresseeId)
      return
    }

    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const now = new Date()
    await prisma.$executeRaw`
      INSERT INTO "Connection" ("id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt")
      VALUES (${id}, ${requesterId}, ${addresseeId}, 'PENDING', ${now}, NULL)
    `

    await notifyConnectionRequest(id, requesterId, addresseeId)
  } catch (error) {
    if (isConnectionTableMissingError(error)) return
    throw error
  }
}

async function loadAcceptedConnectionIds(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ requesterId: string; addresseeId: string }>>`
      SELECT "requesterId", "addresseeId"
      FROM "Connection"
      WHERE "status" = 'ACCEPTED'
        AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
    `
    const ids = new Set<string>()
    for (const row of rows) {
      ids.add(row.requesterId === userId ? row.addresseeId : row.requesterId)
    }
    return [...ids]
  } catch (error) {
    if (isConnectionTableMissingError(error)) return []
    throw error
  }
}

function formatFriendRequest(friendship: FriendshipWithUsers, viewerId: string) {
  const direction = friendship.requesterId === viewerId ? 'outgoing' : 'incoming'
  const counterpart = direction === 'outgoing' ? friendship.addressee : friendship.requester
  return {
    id: friendship.id,
    status: friendship.status,
    direction,
    requestedAt: friendship.requestedAt,
    respondedAt: friendship.respondedAt ?? null,
    user: formatFriendUser(counterpart),
  }
}

function formatFriendship(friendship: FriendshipWithUsers, viewerId: string) {
  const counterpart = friendship.requesterId === viewerId ? friendship.addressee : friendship.requester
  return {
    id: friendship.id,
    status: friendship.status,
    since: friendship.respondedAt ?? friendship.requestedAt,
    user: formatFriendUser(counterpart),
  }
}

const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  senderId: true,
  body: true,
  attachments: true,
  messageType: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  sender: { select: FRIEND_USER_SELECT },
} satisfies Prisma.MessageSelect

const THREAD_PARTICIPANT_SELECT = {
  userId: true,
  role: true,
  joinedAt: true,
  lastReadAt: true,
  mutedUntil: true,
  lastActivityAt: true,
  user: { select: FRIEND_USER_SELECT },
} satisfies Prisma.MessageParticipantSelect

const THREAD_WITH_PARTICIPANTS_INCLUDE = {
  participants: { select: THREAD_PARTICIPANT_SELECT },
} satisfies Prisma.MessageThreadInclude

const THREAD_SUMMARY_INCLUDE = {
  ...THREAD_WITH_PARTICIPANTS_INCLUDE,
  messages: {
    select: MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.MessageThreadInclude

type MessageRecord = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>
type ThreadParticipantRecord = Prisma.MessageParticipantGetPayload<{ select: typeof THREAD_PARTICIPANT_SELECT }>
type ThreadWithParticipants = Prisma.MessageThreadGetPayload<{ include: typeof THREAD_WITH_PARTICIPANTS_INCLUDE }>
type ThreadSummaryRecord = Prisma.MessageThreadGetPayload<{ include: typeof THREAD_SUMMARY_INCLUDE }>

function normalizeAttachmentList(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function formatMessage(record: MessageRecord, viewerId: string) {
  return {
    id: record.id,
    threadId: record.threadId,
    body: record.body ?? null,
    attachments: normalizeAttachmentList(record.attachments),
    messageType: record.messageType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
    senderId: record.senderId,
    sender: formatFriendUser(record.sender),
    isMine: record.senderId === viewerId,
  }
}

function formatThreadParticipant(participant: ThreadParticipantRecord, viewerId: string) {
  return {
    userId: participant.userId,
    role: participant.role,
    joinedAt: participant.joinedAt,
    lastReadAt: participant.lastReadAt ?? null,
    mutedUntil: participant.mutedUntil ?? null,
    lastActivityAt: participant.lastActivityAt,
    user: formatFriendUser(participant.user),
    isViewer: participant.userId === viewerId,
  }
}

function formatThreadBase(thread: ThreadWithParticipants, viewerId: string) {
  return {
    id: thread.id,
    type: thread.type,
    contextType: thread.contextType ?? null,
    contextId: thread.contextId ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
    participants: thread.participants.map((participant) => formatThreadParticipant(participant, viewerId)),
  }
}

function formatThreadSummaryRecord(thread: ThreadSummaryRecord, viewerId: string) {
  const base = formatThreadBase(thread, viewerId)
  const lastMessage = thread.messages[0] ? formatMessage(thread.messages[0], viewerId) : null
  return {
    ...base,
    lastMessage,
  }
}

function buildDirectThreadKey(userA: string, userB: string): string {
  const [first, second] = [userA, userB].sort()
  return `direct:${first}:${second}`
}

async function usersAreFriends(userId: string, targetUserId: string): Promise<boolean> {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    },
    select: { id: true },
  })
  return Boolean(friendship)
}

async function loadFriendIdSet(userId: string): Promise<Set<string>> {
  const ids = await loadAcceptedFriendIds(userId)
  return new Set(ids)
}

async function loadThreadForUser(threadId: string, userId: string) {
  return prisma.messageThread.findFirst({
    where: {
      id: threadId,
      NOT: { contextType: 'market_listing' },
      participants: {
        some: { userId },
      },
    },
    include: THREAD_WITH_PARTICIPANTS_INCLUDE,
  })
}

async function fetchThreadMessages(
  threadId: string,
  limit: number,
  cursor?: string,
): Promise<{ rows: MessageRecord[]; nextCursor?: string }> {
  const rows = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: MESSAGE_SELECT,
  })

  let nextCursor: string | undefined
  if (rows.length > limit) {
    const next = rows.pop()!
    nextCursor = next.id
  }

  return {
    rows: rows.reverse(),
    nextCursor,
  }
}

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient
type Jurisdiction = z.infer<typeof JurisdictionEnum>
const DEFAULT_JURISDICTION: Jurisdiction = 'self'
const REDDIT_EPOCH_SECONDS = 1134028003
const REACTION_HOT_WINDOW_HOURS = 48

const SCHEMA_MISMATCH_MESSAGE =
  'Database schema is out of date for this API version. Apply the latest Prisma migration (pnpm --filter @civil/db prisma migrate deploy) and restart the API.'

function schemaOutOfDateDetail(err: unknown): { prismaCode?: string; prismaMetaMessage?: string; message?: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const metaMessage = typeof (err.meta as any)?.message === 'string' ? ((err.meta as any).message as string) : undefined
    return { prismaCode: err.code, prismaMetaMessage: metaMessage, message: err.message }
  }
  const message = typeof (err as any)?.message === 'string' ? ((err as any).message as string) : undefined
  return { message }
}

function isSchemaOutOfDateError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2021' || err.code === 'P2022') return true
    if (err.code === 'P2010') {
      const rawMessage = typeof (err.meta as any)?.message === 'string' ? (err.meta as any).message : ''
      return /does not exist|unknown column|undefined table|undefined column/i.test(rawMessage)
    }
    return false
  }
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : ''
  return /does not exist|unknown column|undefined table|undefined column/i.test(message)
}

const MediaAssetParam = z.object({ id: MediaAssetIdSchema })
const FriendRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const FriendshipIdParam = z.object({ id: z.string().cuid() })
const ConnectionRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const ConnectionIdParam = z.object({ id: z.string().trim().min(1).max(120) })
const MessageThreadIdParam = z.object({ id: z.string().cuid() })
const MessageThreadParticipantParams = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid().or(z.string().uuid()),
})
const NotificationAckInput = z
  .object({
    ids: z.array(z.string().cuid()).min(1).max(50).optional(),
    before: z.coerce.date().optional(),
  })
  .refine((value) => Boolean(value.ids?.length || value.before), {
    message: 'ids_or_before_required',
    path: ['ids'],
  })

const NotificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().cuid().optional(),
})

const NotificationRespondParams = z.object({
  id: z.string().cuid(),
})

const NotificationRespondBody = z.object({
  action: z.enum(['accept', 'reject']),
})

const UserSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

const SearchTypeEnum = z.enum(['people', 'communities', 'all'])

const CombinedSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  type: SearchTypeEnum.default('people'),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  peopleLimit: z.coerce.number().int().min(1).max(10).default(3),
  communityLimit: z.coerce.number().int().min(1).max(10).default(3),
})

function normalizeSearchTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

type UserSearchRecord = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  premiumStatus: PremiumStatus | null
}

type UserSearchResultPayload = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  isPremium: boolean
  isVerified: boolean
  homeCommunity: {
    provinceCode: string
    provinceName: string | null
    communitySlug: string
    communityName: string | null
  } | null
}

async function searchUsersForQuery({
  viewerId,
  query,
  limit,
}: {
  viewerId: string
  query: string
  limit: number
}): Promise<UserSearchResultPayload[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const normalizedHandle = normalizedQuery.replace(/^@/, '')

  const where: Prisma.UserWhereInput = {
    NOT: { id: viewerId },
    OR: [
      tokens.length
        ? {
            AND: tokens.map((token) => ({ name: { contains: token, mode: 'insensitive' } })),
          }
        : { name: { contains: normalizedQuery, mode: 'insensitive' } },
      { handle: { contains: normalizedHandle, mode: 'insensitive' } },
    ],
  }

  const users = (await prisma.user.findMany({
    where,
    orderBy: [{ name: 'asc' }, { handle: 'asc' }],
    take: limit,
    select: {
      id: true,
      name: true,
      handle: true,
      avatarUrl: true,
      coverUrl: true,
      premiumStatus: true,
    },
  })) as UserSearchRecord[]

  const userIds = users.map((user) => user.id)
  const homeFollows = userIds.length
    ? await prisma.communityFollow.findMany({
        where: { userId: { in: userIds }, home: true },
        select: {
          userId: true,
          provinceCode: true,
          communitySlug: true,
        },
      })
    : []

  const homeMap = new Map<
    string,
    { provinceCode: string; provinceName: string | null; communitySlug: string; communityName: string | null }
  >()
  for (const follow of homeFollows) {
    const community = findCommunity(follow.provinceCode, follow.communitySlug)
    const provinceName = getProvinceDisplayName(follow.provinceCode as ProvinceCodeLiteral)
    homeMap.set(follow.userId, {
      provinceCode: follow.provinceCode,
      provinceName,
      communitySlug: follow.communitySlug,
      communityName: community?.name ?? follow.communitySlug,
    })
  }

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    handle: user.handle,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
    isPremium: isPremium(user.premiumStatus),
    isVerified: isPremium(user.premiumStatus),
    homeCommunity: homeMap.get(user.id) ?? null,
  }))
}

async function searchCommunitiesForQuery(query: string, limit: number): Promise<CitySummaryType[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  const slugQuery = slugifyCommunityName(normalizedQuery)
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const tokenLowers = tokens.map((token) => token.toLowerCase())
  const normalizedLower = normalizedQuery.toLowerCase()

  const insensitiveMode = Prisma.QueryMode.insensitive

  const buildFieldCondition = (field: 'name' | 'communityName'): Prisma.CityWhereInput => {
    if (!tokens.length) {
      return {
        [field]: {
          contains: normalizedQuery,
          mode: insensitiveMode,
        },
      }
    }
    return {
      AND: tokens.map(
        (token) =>
          ({
            [field]: {
              contains: token,
              mode: insensitiveMode,
            },
          }) as Prisma.CityWhereInput,
      ),
    }
  }

  const nameCondition = buildFieldCondition('name')
  const communityCondition = buildFieldCondition('communityName')

  const where: Prisma.CityWhereInput = {
    OR: [
      nameCondition,
      communityCondition,
      { slug: { contains: slugQuery, mode: insensitiveMode } },
      { communitySlug: { contains: slugQuery, mode: insensitiveMode } },
    ],
  }

  const cities = await prisma.city.findMany({
    where,
    orderBy: [{ population: 'desc' }, { name: 'asc' }],
    take: limit,
  })

  const dbSummaries = cities.map((city: CityModel) => formatCitySummary(city))

  const seenKeys = new Set(dbSummaries.map((entry: CitySummaryType) => `${entry.provinceCode}:${entry.communitySlug}`))
  const staticMatches: CitySummaryType[] = []

  for (const province of PROVINCES) {
    const communities = getCommunitiesByProvince(province.code)
    for (const community of communities) {
      const communityNameLower = community.name.toLowerCase()
      const communitySlugLower = community.slug.toLowerCase()
      const matches =
        communityNameLower.includes(normalizedLower) ||
        communitySlugLower.includes(slugQuery) ||
        tokens.every((token) => communityNameLower.includes(token.toLowerCase()))

      if (!matches) continue

      const key = `${community.province}:${community.slug}`
      if (seenKeys.has(key)) continue

      seenKeys.add(key)
      staticMatches.push({
        name: community.name,
        slug: community.slug,
        provinceCode: community.province,
        provinceName: getProvinceDisplayName(community.province),
        communitySlug: community.slug,
        communityName: community.name,
        latitude: 0,
        longitude: 0,
        population: null,
      })
    }
  }

  const rankCommunityMatch = (entry: CitySummaryType) => {
    const label = (entry.communityName || entry.name || '').toLowerCase()
    const slug = (entry.communitySlug || entry.slug || '').toLowerCase()
    let score = 0

    if (label === normalizedLower || slug === slugQuery) score += 1000
    if (label.startsWith(normalizedLower) || slug.startsWith(slugQuery)) score += 600
    if (label.includes(normalizedLower) || slug.includes(slugQuery)) score += 300

    if (tokenLowers.length) {
      const tokenHits = tokenLowers.filter((token) => label.includes(token) || slug.includes(token)).length
      score += tokenHits * 80
      if (tokenHits === tokenLowers.length) score += 120
    }

    if (typeof entry.population === 'number' && entry.population > 0) {
      score += Math.min(entry.population / 1000, 50)
    }

    return score
  }

  const combined = [...dbSummaries, ...staticMatches]
  combined.sort((a, b) => {
    const scoreDelta = rankCommunityMatch(b) - rankCommunityMatch(a)
    if (scoreDelta !== 0) return scoreDelta
    const popA = typeof a.population === 'number' ? a.population : -1
    const popB = typeof b.population === 'number' ? b.population : -1
    if (popB !== popA) return popB - popA
    return (a.communityName || a.name).localeCompare(b.communityName || b.name)
  })

  return combined.slice(0, limit)
}

async function loadAuthenticatedUser(req: FastifyRequest) {
  const payload = await (req as any).jwtVerify()
  return prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, name: true } })
}

async function resolveUserId(req: FastifyRequest): Promise<string | null> {
  const existing = (req as any).user?.id
  if (typeof existing === 'string' && existing) return existing

  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null

  try {
    const payload = (await (req as any).jwtVerify()) as { sub?: string }
    if (payload?.sub && typeof payload.sub === 'string') return payload.sub
  } catch {
    // ignore
  }
  return null
}

async function withSchemaGuard<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await action()
  } catch (err) {
    if (isSchemaOutOfDateError(err)) {
      req.log.error({ err }, 'database schema out of date for social features')
      const payload: Record<string, unknown> = { error: 'schema_out_of_date', message: SCHEMA_MISMATCH_MESSAGE }
      if (process.env.NODE_ENV !== 'production') {
        payload.detail = schemaOutOfDateDetail(err)
      }
      return reply.code(503).send(payload)
    }
    throw err
  }
}

function ensureMimeSupported(mime: string) {
  return IMAGE_MIME_TYPES.has(mime.toLowerCase())
}

function extensionForMime(mime: string) {
  return MIME_EXTENSION_MAP[mime.toLowerCase()] || 'bin'
}

function buildOriginalObjectKey(category: MediaCategory, userId: string, assetId: string, extension: string) {
  return `raw/${category}/${userId}/${assetId}/original.${extension}`
}

async function readRequestBuffer(req: FastifyRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req.raw as any as AsyncIterable<Buffer | Uint8Array | string>) {
    if (!chunk) continue
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk)
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
    } else {
      chunks.push(Buffer.from(chunk))
    }
  }
  return Buffer.concat(chunks)
}

function extractVariantUrl(variants: unknown, preferred: string[]): string | null {
  if (!variants || typeof variants !== 'object') return null
  for (const name of preferred) {
    const value = (variants as Record<string, any>)[name]
    if (value && typeof value.url === 'string') {
      return normalizeMediaUrl(value.url)
    }
  }
  return null
}

type PostStatsInput = {
  positiveReactions: number
  supportReactions: number
  recentPositive: number
  commentCount: number
  commentScore: number
  createdAt: Date
  lastActivityAt: Date
}

function calculateHotScore({ recentPositive, commentCount, commentScore, createdAt, lastActivityAt }: PostStatsInput) {
  const discussionWeight = Math.min(commentCount, 50)
  const commentScoreWeight = Math.max(Math.min(commentScore / 4, 75), -75)
  const interactionScore = recentPositive + discussionWeight + commentScoreWeight
  const order = Math.log10(Math.max(Math.abs(interactionScore), 1))
  const baseTime = Math.max(createdAt.getTime(), lastActivityAt.getTime())
  const seconds = baseTime / 1000 - REDDIT_EPOCH_SECONDS
  return Number((seconds + order).toFixed(6))
}

async function refreshPostAggregates(
  tx: Prisma.TransactionClient,
  postId: string,
  times: { createdAt: Date; lastActivityAt: Date },
  options: { bumpActivity?: boolean } = {},
) {
  const reactionWindowStart = new Date(Date.now() - REACTION_HOT_WINDOW_HOURS * 60 * 60 * 1000)

  const [upvotes, downvotes, recentPositive, commentCount, commentScoreResult] = await Promise.all([
    tx.vote.count({ where: { postId, value: 1 } }),
    tx.vote.count({ where: { postId, value: -1 } }),
    tx.vote.count({
      where: {
        postId,
        value: 1,
        createdAt: { gte: reactionWindowStart },
      },
    }),
    tx.comment.count({ where: { postId } }),
    tx.comment.aggregate({ where: { postId }, _sum: { score: true } }),
  ])
  const positiveReactions = upvotes
  const supportReactions = 0
  const commentScore = commentScoreResult?._sum?.score ?? 0
  const score = upvotes - downvotes

  const nextLastActivityAt = options.bumpActivity ? new Date() : times.lastActivityAt
  const hotScore = calculateHotScore({
    positiveReactions,
    supportReactions,
    recentPositive,
    commentCount,
    commentScore,
    createdAt: times.createdAt,
    lastActivityAt: nextLastActivityAt,
  })

  await tx.post.update({
    where: { id: postId },
    data: {
      upvotes,
      downvotes,
      score,
      commentCount,
      hotScore,
      recentPositive,
      lastActivityAt: nextLastActivityAt,
    },
  })

  return {
    upvotes,
    downvotes,
    score,
    commentCount,
    commentScore,
    recentPositive,
    lastActivityAt: nextLastActivityAt,
  }
}

async function refreshCommentAggregates(tx: Prisma.TransactionClient, commentId: string) {
  const [upvotes, downvotes] = await Promise.all([
    tx.commentVote.count({ where: { commentId, value: 1 } }),
    tx.commentVote.count({ where: { commentId, value: -1 } }),
  ])
  const score = upvotes - downvotes
  await tx.comment.update({
    where: { id: commentId },
    data: {
      upvotes,
      downvotes,
      score,
    },
  })
  return { upvotes, downvotes, score }
}

type CommentWithUser = Prisma.CommentGetPayload<{
  include: {
    user: {
      select: {
        id: true
        handle: true
        name: true
        avatarUrl: true
        coverUrl: true
        premiumStatus: true
      }
    }
  }
}>

type CommentNode = {
  id: string
  postId: string
  parentId: string | null
  body: string
  createdAt: Date
  updatedAt: Date
  upvotes: number
  downvotes: number
  score: number
  viewerVote: number | null
  hotScore: number
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
  replies: CommentNode[]
}

function calculateCommentHotScore({
  upvotes,
  replyCount,
  replyScore,
  createdAt,
  updatedAt,
}: {
  upvotes: number
  replyCount: number
  replyScore: number
  createdAt: Date
  updatedAt: Date
}) {
  return calculateHotScore({
    positiveReactions: upvotes,
    supportReactions: 0,
    recentPositive: upvotes,
    commentCount: replyCount,
    commentScore: replyScore,
    createdAt,
    lastActivityAt: updatedAt,
  })
}

function attachCommentHotScore(node: CommentNode, stats?: { replyCount?: number; replyScore?: number }) {
  const replyCount = stats?.replyCount ?? node.replies.length
  const replyScore = stats?.replyScore ?? node.replies.reduce((total, child) => total + child.score, 0)
  node.hotScore = calculateCommentHotScore({
    upvotes: node.upvotes,
    replyCount,
    replyScore,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  })
  return node
}

function mapComment(row: CommentWithUser, viewerVote: number | null = null): CommentNode {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId ?? null,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.score,
    viewerVote,
    hotScore: 0,
    author: {
      id: row.user.id,
      handle: row.user.handle,
      name: row.user.name ?? null,
      avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
      isPremium: isPremium(row.user.premiumStatus),
      isVerified: isPremium(row.user.premiumStatus),
    },
    replies: [],
  }
}

function buildCommentTree(
  rows: CommentWithUser[],
  viewerVotes: Record<string, number> = {},
  options: { sort?: 'hot' | 'new' } = {},
): CommentNode[] {
  const nodeMap = new Map<string, CommentNode>()
  const roots: CommentNode[] = []
  const sortMode = options.sort ?? 'hot'

  rows.forEach((row) => {
    nodeMap.set(row.id, mapComment(row, viewerVotes[row.id] ?? null))
  })

  rows.forEach((row) => {
    const node = nodeMap.get(row.id)
    if (!node) return
    if (row.parentId) {
      const parent = nodeMap.get(row.parentId)
      if (parent) {
        parent.replies.push(node)
        return
      }
    }
    roots.push(node)
  })

  const visit = (node: CommentNode): CommentNode => {
    node.replies = node.replies.map(visit)
    attachCommentHotScore(node)

    if (sortMode === 'hot') {
      node.replies.sort((a, b) => {
        if (b.hotScore !== a.hotScore) return b.hotScore - a.hotScore
        const updatedDiff = b.updatedAt.getTime() - a.updatedAt.getTime()
        if (updatedDiff !== 0) return updatedDiff
        return a.id.localeCompare(b.id)
      })
    } else {
      node.replies.sort((a, b) => {
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
        if (createdDiff !== 0) return createdDiff
        return a.id.localeCompare(b.id)
      })
    }

    return node
  }

  const processedRoots = roots.map(visit)

  if (sortMode === 'hot') {
    processedRoots.sort((a, b) => {
      if (b.hotScore !== a.hotScore) return b.hotScore - a.hotScore
      const updatedDiff = b.updatedAt.getTime() - a.updatedAt.getTime()
      if (updatedDiff !== 0) return updatedDiff
      return a.id.localeCompare(b.id)
    })
  } else {
    processedRoots.sort((a, b) => {
      const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (createdDiff !== 0) return createdDiff
      return a.id.localeCompare(b.id)
    })
  }

  return processedRoots
}

// Local schema for API registration that always treats `handle` as optional.
// This guards against any shared package drift where `handle` might be required.
const RegisterInputApi = z.object({
  email: z.string().email(),
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  password: z.string().min(8).max(72),
  orgInviteToken: z.string().trim().min(12).max(160).optional(),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms' }),
  }),
})

function isExperienceTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')
}

const MAX_HANDLE_LENGTH = 32
const POST_SLUG_BASE_LIMIT = 80
const POST_SLUG_TOTAL_LIMIT = 200

function normalizeHandleBase(base: string) {
  return base
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

function trimHandleForSuffix(base: string, suffixLength: number) {
  const normalized = normalizeHandleBase(base)
  if (normalized.length + suffixLength <= MAX_HANDLE_LENGTH) {
    return normalized
  }
  return normalized.slice(0, Math.max(0, MAX_HANDLE_LENGTH - suffixLength))
}

function generateHandleSuffix() {
  const random = Math.floor(Math.random() * 900) + 100
  return `${random}`
}

async function generateUniqueHandle(base: string, client: PrismaClientOrTx, excludeUserId?: string): Promise<string> {
  const normalizedBase = normalizeHandleBase(base)
  let candidate = normalizedBase.length >= 3 ? normalizedBase.slice(0, MAX_HANDLE_LENGTH) : 'citizen'
  const whereFor = (handle: string) =>
    excludeUserId
      ? { handle, NOT: { id: excludeUserId } }
      : { handle }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await client.user.findFirst({ where: whereFor(candidate), select: { id: true } })
    if (!existing) {
      return candidate
    }
    const suffix = generateHandleSuffix()
    candidate = `${trimHandleForSuffix(normalizedBase, suffix.length)}${suffix}`
    if (candidate.length < 3) {
      candidate = `citizen${suffix}`.slice(0, MAX_HANDLE_LENGTH)
    }
  }

  const fallbackSuffix = `${Date.now()}`.slice(-4)
  return `${trimHandleForSuffix(normalizedBase || 'citizen', fallbackSuffix.length)}${fallbackSuffix}`.slice(0, MAX_HANDLE_LENGTH)
}

function slugifyText(input: string) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function stripHtmlToPlainText(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtmlToPlainTextWithNewlines(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'a',
]

const RICH_TEXT_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'name', 'target', 'rel'],
}

function sanitizeRichTextHtml(input: string) {
  const raw = typeof input === 'string' ? input : ''
  const cleaned = sanitizeHtml(raw, {
    allowedTags: RICH_TEXT_ALLOWED_TAGS,
    allowedAttributes: RICH_TEXT_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName: string, attribs: sanitizeHtml.Attributes) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'nofollow noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  })

  // Keep output stable for empty/whitespace-only cases.
  const trimmed = cleaned.trim()
  return trimmed || '<p></p>'
}

function sanitizePlainText(input: string) {
  return stripHtmlToPlainTextWithNewlines(typeof input === 'string' ? input : '')
}

function trimSlugLength(value: string, max: number) {
  let trimmed = value.slice(0, max)
  trimmed = trimmed.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return trimmed
}

function buildPostSlugBase(options: { handle?: string | null; title?: string | null; body: string }) {
  const handlePart = options.handle ? slugifyText(options.handle).slice(0, 24) : ''
  const titleSource = options.title?.trim()
  const rawSource = titleSource && titleSource.length > 0 ? titleSource : stripHtmlToPlainText(options.body).slice(0, 120)
  const contentPart = slugifyText(rawSource)
  const combined = [handlePart, contentPart].filter(Boolean).join('-')
  const normalized = combined.replace(/-+/g, '-')
  const trimmed = trimSlugLength(normalized, POST_SLUG_BASE_LIMIT)
  return trimmed || 'post'
}

function randomSlugSuffix() {
  return randomUUID().replace(/-/g, '').slice(0, 6)
}

function randomNumericSlugSuffix() {
  // 7 digits (e.g., 2324214) for user-friendly collision suffixes.
  return String(randomInt(1_000_000, 10_000_000))
}

async function generateUniquePostSlug(base: string, client: PrismaClientOrTx) {
  const normalizedBase = trimSlugLength(base, POST_SLUG_BASE_LIMIT) || 'post'
  const baseWithPost = normalizedBase.endsWith('-post') ? normalizedBase : trimSlugLength(`${normalizedBase}-post`, POST_SLUG_BASE_LIMIT)

  const buildCandidate = (suffix: string) => {
    const candidate = trimSlugLength(`${baseWithPost}-${suffix}`, POST_SLUG_TOTAL_LIMIT)
    return candidate || `post-${suffix}`
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = buildCandidate(randomSlugSuffix())
    const existing = await client.post.findUnique({ where: { seoSlug: candidate }, select: { id: true } })
    if (!existing) return candidate
  }
  return buildCandidate(randomUUID().replace(/-/g, '').slice(0, 12))
}

async function createOrganizationEventAnnouncementPost(args: {
  client: PrismaClientOrTx
  authorUserId: string
  businessId: string
  provinceCode: string
  communitySlug: string
  organizationSlug: string
  event: Pick<OrgEventDefinition, 'id' | 'title' | 'description' | 'startsAt' | 'primaryPhotoUrl'>
}) {
  const author = await args.client.user.findUnique({
    where: { id: args.authorUserId },
    select: { id: true, handle: true },
  })
  if (!author) return null

  const eventPath = `/com/${encodeURIComponent(args.provinceCode)}/${encodeURIComponent(args.communitySlug)}/orgs/${encodeURIComponent(args.organizationSlug)}/events/${encodeURIComponent(args.event.id)}`
  const eventUrl = `https://${CIVIL_PUBLIC_HOST}${eventPath}`
  const descriptionSnippet = sanitizePlainText(args.event.description ?? '').slice(0, 320).trim()

  const postBody = sanitizePlainText(
    [
      `New event published: ${args.event.title}`,
      descriptionSnippet,
      `View event: ${eventUrl}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  )

  const seoSlug = await generateUniquePostSlug(
    buildPostSlugBase({
      handle: author.handle,
      title: `Event: ${args.event.title}`,
      body: postBody,
    }),
    args.client,
  )

  return args.client.post.create({
    data: {
      authorId: args.authorUserId,
      businessId: args.businessId,
      audience: 'organization',
      visibility: 'public',
      body: postBody,
      title: `Event: ${args.event.title}`,
      type: 'post',
      mediaUrl: args.event.primaryPhotoUrl ?? undefined,
      provinceCode: args.provinceCode,
      communitySlug: args.communitySlug,
      jurisdiction: 'municipal',
      seoSlug,
    },
    select: { id: true },
  })
}

const POST_INCLUDE = {
  author: {
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      coverUrl: true,
      premiumStatus: true,
    },
  },
  business: {
    select: {
      id: true,
      name: true,
      slug: true,
      isVerified: true,
      logoUrl: true,
      coverUrl: true,
      provinceCode: true,
      communitySlug: true,
    },
  },
  sharedPost: {
    include: {
      author: {
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          premiumStatus: true,
        },
      },
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          provinceCode: true,
          communitySlug: true,
        },
      },
    },
  },
} as const

type PostWithAuthor = Prisma.PostGetPayload<{ include: typeof POST_INCLUDE }>

type FormattedPost = {
  id: string
  seoSlug: string | null
  type: string
  title: string | null
  body: string
  mediaUrl: string | null
  images: string[] | null
  createdAt: Date
  updatedAt: Date
  jurisdiction: string
  provinceCode: string | null
  communitySlug: string | null
  communityName: string | null
  provinceName: string | null
  organization: {
    id: string
    name: string
    slug: string
    isVerified: boolean
    logoUrl: string | null
    coverUrl: string | null
    provinceCode: string | null
    communitySlug: string | null
  } | null
  sharedPost: FormattedPost | null
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
  recentComments: Array<{
    id: string
    postId: string
    parentId: string | null
    body: string
    createdAt: Date
    updatedAt: Date
    score: number
    author: {
      id: string
      handle: string
      name: string | null
      avatarUrl: string | null
      coverUrl: string | null
      isPremium: boolean
      isVerified: boolean
    }
  }>
  counts: {
    commentCount: number
    recentPositive: number
    upvotes: number
    downvotes: number
    score: number
  }
  votes: {
    upvotes: number
    downvotes: number
    score: number
  }
  metrics: {
    hotScore: number
  }
  viewer: {
    vote: number | null
  }
}

type RecentCommentWithUser = Prisma.CommentGetPayload<{
  include: {
    user: {
      select: {
        id: true
        handle: true
        name: true
        avatarUrl: true
        coverUrl: true
        premiumStatus: true
      }
    }
  }
}>

async function getRecentCommentsByPostIds(postIds: string[], limitPerPost = 5) {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!uniquePostIds.length) return {} as Record<string, FormattedPost['recentComments']>

  const rows: RecentCommentWithUser[] = await prisma.comment.findMany({
    where: {
      postId: { in: uniquePostIds },
      parentId: null,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          premiumStatus: true,
        },
      },
    },
  })

  const grouped: Record<string, FormattedPost['recentComments']> = {}
  for (const row of rows) {
    const bucket = grouped[row.postId] ?? []
    if (bucket.length >= limitPerPost) continue
    bucket.push({
      id: row.id,
      postId: row.postId,
      parentId: row.parentId ?? null,
      body: sanitizePlainText(row.body),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      score: row.score,
      author: {
        id: row.user.id,
        handle: row.user.handle,
        name: row.user.name ?? null,
        avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
        coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
        isPremium: isPremium(row.user.premiumStatus),
        isVerified: isPremium(row.user.premiumStatus),
      },
    })
    grouped[row.postId] = bucket

    let filled = 0
    for (const postId of uniquePostIds) {
      if ((grouped[postId]?.length ?? 0) >= limitPerPost) filled += 1
    }
    if (filled === uniquePostIds.length) break
  }

  return grouped
}

function formatPost(
  post: PostWithAuthor,
  options: { viewerVote?: number | null; recentComments?: FormattedPost['recentComments'] } = {},
): FormattedPost {
  const community = post.provinceCode && post.communitySlug ? findCommunity(post.provinceCode, post.communitySlug) : null
  const provinceName = community ? getProvinceDisplayName(community.province as any) : null

  let sharedPost: FormattedPost | null = null
  if (post.sharedPost) {
    sharedPost = formatPost(post.sharedPost as any)
  }

  return {
    id: post.id,
    seoSlug: post.seoSlug,
    type: post.type,
    title: post.title,
    body: post.type === 'article' ? sanitizeRichTextHtml(post.body) : sanitizePlainText(post.body),
    mediaUrl: normalizeMediaUrl(post.mediaUrl ?? null),
    images: (post.images as string[] | null)?.map(normalizeMediaUrl).filter((url): url is string => url !== null) ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    jurisdiction: post.jurisdiction,
    provinceCode: post.provinceCode,
    communitySlug: post.communitySlug,
    communityName: community?.name ?? null,
    provinceName,
    organization: post.business
      ? {
          id: post.business.id,
          name: post.business.name,
          slug: post.business.slug,
          isVerified: Boolean(post.business.isVerified),
          logoUrl: normalizeMediaUrl((post.business as any).logoUrl ?? null),
          coverUrl: normalizeMediaUrl((post.business as any).coverUrl ?? null),
          provinceCode: post.business.provinceCode ?? null,
          communitySlug: post.business.communitySlug ?? null,
        }
      : null,
    sharedPost,
    author: {
      id: post.author.id,
      handle: post.author.handle,
      name: post.author.name,
      avatarUrl: normalizeMediaUrl(post.author.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl((post.author as any).coverUrl ?? null),
      isPremium: isPremium(post.author.premiumStatus),
      isVerified: isPremium(post.author.premiumStatus),
    },
    recentComments: options.recentComments ?? [],
    counts: {
      commentCount: post.commentCount,
      recentPositive: post.recentPositive ?? 0,
      upvotes: post.upvotes ?? 0,
      downvotes: post.downvotes ?? 0,
      score: post.score ?? 0,
    },
    votes: {
      upvotes: post.upvotes ?? 0,
      downvotes: post.downvotes ?? 0,
      score: post.score ?? 0,
    },
    metrics: {
      hotScore: post.hotScore,
    },
    viewer: {
      vote: options.viewerVote ?? null,
    },
  }
}

function getCanonicalPaths(post: PostWithAuthor) {
  const slug = post.seoSlug ?? post.id
  return {
    user: `/u/${post.author.handle}/posts/${slug}`,
    community: post.provinceCode && post.communitySlug ? `/${post.provinceCode}/${post.communitySlug}/posts/${slug}` : null,
    legacy: `/post/${post.id}`,
  }
}

app.get('/health', async () => ({ ok: true }))

// Ensure all unexpected errors return clean JSON (prevents malformed bodies)
app.setErrorHandler((err, req, reply) => {
  try {
    req.log.error({ err }, 'uncaught')
  } catch {}
  const status = (err as any)?.statusCode ?? 500
  const isClient = status >= 400 && status < 500
  const message = isClient ? (typeof (err as any)?.message === 'string' ? (err as any).message : 'request_error') : 'internal_error'
  if (!reply.sent) reply.code(status).send({ error: message })
})

// Prisma migrations/db push handle schema; no manual ensureSchema needed in production

async function applyOrganizationInviteRegistration(token: string, newUserId: string) {
  const normalizedToken = token.trim()
  if (!normalizedToken) return

  const businesses = await prisma.business.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      ownerId: true,
      provinceCode: true,
      communitySlug: true,
      slug: true,
      metadata: true,
    },
  })

  const matched = businesses.find((org: (typeof businesses)[number]) => {
    const system = readOrganizationSystemState(org.metadata)
    return system.inviteLinks.some((entry) => entry.token === normalizedToken)
  })
  if (!matched) return

  const current = readOrganizationSystemState(matched.metadata)
  const inviteIndex = current.inviteLinks.findIndex((entry) => entry.token === normalizedToken)
  if (inviteIndex < 0) return
  const invite = current.inviteLinks[inviteIndex]
  if (!invite) return

  const nowIso = new Date().toISOString()
  const existingMember = current.members[newUserId] ?? null
  const status: OrgMembershipStatus = current.joinMode === 'APPLICATION_REQUIRED' ? 'PENDING' : 'ACTIVE'

  const referralAlreadyExists = current.referrals.some(
    (item) => item.referrerUserId === invite.createdByUserId && item.referredUserId === newUserId,
  )
  const referralId = `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`
  const referral: OrgReferralRecord | null = referralAlreadyExists
    ? null
    : {
        id: referralId,
        referrerUserId: invite.createdByUserId,
        referredUserId: newUserId,
        planId: invite.planId ?? null,
        createdAt: nowIso,
      }

  const inviterCurrentMember = current.members[invite.createdByUserId] ?? {
    rankId: invite.createdByUserId === matched.ownerId ? SYSTEM_OWNER_RANK_ID : SYSTEM_MEMBER_RANK_ID,
    planId: null,
    status: 'ACTIVE' as OrgMembershipStatus,
    referredByUserId: null,
    reputation: 0,
    updatedAt: nowIso,
  }

  const hasRewardLedger = current.reputationLedger.some(
    (entry) => entry.source === 'signup_referral' && entry.userId === invite.createdByUserId && entry.sourceRefId === (referral?.id ?? null),
  )

  const rewardLedger: OrgReputationEntry | null =
    referral && !hasRewardLedger
      ? {
          id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          userId: invite.createdByUserId,
          delta: ORG_SIGNUP_REPUTATION_POINTS,
          source: 'signup_referral',
          sourceRefId: referral.id,
          note: `Signup referral reward (+${ORG_SIGNUP_REPUTATION_POINTS})`,
          createdAt: nowIso,
        }
      : null

  const nextInviteLinks = [...current.inviteLinks]
  nextInviteLinks[inviteIndex] = {
    ...invite,
    registrationCount: invite.registrationCount + 1,
    joinCount: status === 'ACTIVE' ? invite.joinCount + 1 : invite.joinCount,
    lastRegisteredAt: nowIso,
    lastJoinedAt: status === 'ACTIVE' ? nowIso : invite.lastJoinedAt,
  }

  const nextSystem: OrganizationSystemState = {
    ...current,
    inviteLinks: nextInviteLinks,
    referrals: referral ? [...current.referrals, referral] : current.referrals,
    reputationLedger: rewardLedger ? [...current.reputationLedger, rewardLedger] : current.reputationLedger,
    members: {
      ...current.members,
      [newUserId]: {
        rankId: existingMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
        planId: invite.planId ?? existingMember?.planId ?? null,
        status,
        referredByUserId: invite.createdByUserId,
        reputation: existingMember?.reputation ?? 0,
        updatedAt: nowIso,
      },
      [invite.createdByUserId]: rewardLedger
        ? {
            ...inviterCurrentMember,
            reputation: (inviterCurrentMember.reputation ?? 0) + ORG_SIGNUP_REPUTATION_POINTS,
            updatedAt: nowIso,
          }
        : inviterCurrentMember,
    },
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.businessFollow.upsert({
      where: { businessId_userId: { businessId: matched.id, userId: newUserId } },
      create: { businessId: matched.id, userId: newUserId },
      update: {},
    })

    await tx.business.update({
      where: { id: matched.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(matched.metadata, nextSystem) },
      select: { id: true },
    })

    await appendOrganizationAuditLogEntry(tx, matched.id, {
      actorUserId: newUserId,
      action: status === 'ACTIVE' ? 'member.joined_via_invite' : 'member.join_requested_via_invite',
      reason: 'Joined via invite landing registration',
      previousValue: existingMember,
      nextValue: nextSystem.members[newUserId],
    })
  })

  if (status === 'ACTIVE' && invite.createdByUserId !== newUserId) {
    const inviterExists = await prisma.user.findUnique({ where: { id: invite.createdByUserId }, select: { id: true } })
    if (inviterExists) {
      await createOrRefreshConnectionRequest(newUserId, invite.createdByUserId)
    }
  }
}

// Auth: register
app.post('/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
  // Accept both shapes: shared RegisterInput and our local variant with optional handle
  let parse = RegisterInput.safeParse(req.body)
  if (!parse.success) {
    parse = RegisterInputApi.safeParse(req.body)
  }
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { email, firstName, lastName, password } = parse.data
  const rawBody = (req.body ?? {}) as Record<string, unknown>
  const orgInviteToken = typeof rawBody.orgInviteToken === 'string' ? rawBody.orgInviteToken.trim() : ''
  const normalizedFirstName = firstName.trim().toLowerCase()
  const normalizedLastName = lastName.trim().toLowerCase()
  const name = `${normalizedFirstName} ${normalizedLastName}`.trim()
  const baseHandle = buildHandleBase(normalizedFirstName, normalizedLastName)
  const handle = await generateUniqueHandle(baseHandle, prisma)
  const hash = await bcrypt.hash(password, 10)
  try {
    const user = await prisma.user.create({ data: { id: randomUUID(), email, handle, name, passwordHash: hash } })
    if (orgInviteToken) {
      try {
        await applyOrganizationInviteRegistration(orgInviteToken, user.id)
      } catch (inviteErr) {
        req.log.warn({ err: inviteErr }, 'org_invite_registration_apply_failed')
      }
    }
    const token = await (app as any).jwt.sign({ sub: user.id })
    return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
  } catch (e: any) {
    if (e.code === 'P2002') return reply.code(409).send({ error: 'email_or_handle_exists' })
    throw e
  }
})

// Auth: login
registerCommunityRoute(
  'get',
  '/communities/:province/:community/posts',
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const params = z
        .object({
          province: z.string().min(2).max(64),
          community: z.string().min(1).max(160),
        })
        .safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communityRecord = findCommunity(province, params.data.community)
      if (!communityRecord) return reply.code(404).send({ error: 'community_not_found' })

      const query = CursorQuery.extend({
        jurisdiction: JurisdictionEnum.optional(),
        sort: PostSortEnum.optional(),
      }).safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { cursor, limit, jurisdiction, sort } = query.data
      const viewerId = (req as any).user?.id as string | undefined
      const sortMode = sort ?? 'new'

      const where: Prisma.PostWhereInput = {
        provinceCode: communityRecord.province,
        communitySlug: communityRecord.slug,
        visibility: 'public',
        ...(jurisdiction ? { jurisdiction } : {}),
      }

      let items: PostWithAuthor[] = []
      let nextCursor: string | undefined

      if (sortMode === 'hot') {
        items = await prisma.post.findMany({
          where,
          take: limit,
          orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
          include: POST_INCLUDE,
        })
      } else {
        const queryResult = await prisma.post.findMany({
          where,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
          include: POST_INCLUDE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        if (queryResult.length > limit) {
          const next = queryResult.pop()!
          nextCursor = next.id
        }
        items = queryResult
      }

      let votesByPost: Record<string, number> = {}
      if (viewerId && items.length) {
        const votes = await prisma.vote.findMany({
          where: { userId: viewerId, postId: { in: items.map((item) => item.id) } },
          select: { postId: true, value: true },
        })
        const voteMap: Record<string, number> = {}
        for (const vote of votes) {
          voteMap[vote.postId] = vote.value
        }
        votesByPost = voteMap
      }

      const recentCommentsByPost = await getRecentCommentsByPostIds(items.map((item) => item.id), 5)

      return {
        community: communityRecord,
        items: items.map((item) =>
          formatPost(item, {
            viewerVote: votesByPost[item.id] ?? null,
            recentComments: recentCommentsByPost[item.id] ?? [],
          }),
        ),
        nextCursor,
      }
    }),
)

registerCommunityRoute('get', '/communities/:province', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z.object({ province: z.string().min(2).max(64) }).safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

  const province = normalizeProvinceCode(params.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })

  const communities = getCommunitiesByProvince(province)
  return reply.send({ items: communities })
})

// Communitys - get current home community
registerCommunityRoute('get', '/communities/home', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  const follow = await prisma.communityFollow.findFirst({ where: { userId, home: true } })
  if (!follow) return reply.send({ home: null })
  const community = findCommunity(follow.provinceCode, follow.communitySlug)
  return reply.send({
    home: community ? { ...community } : { province: follow.provinceCode, slug: follow.communitySlug },
  })
})

// Communitys - set home community
registerCommunityRoute('post', '/communities/home', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = SetHomeCommunityInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const community = findCommunity(province, parse.data.communitySlug)
  if (!community) return reply.code(404).send({ error: 'community_not_found' })

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.communityFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
    await tx.communityFollow.upsert({
      where: {
        userId_provinceCode_communitySlug: {
          userId,
          provinceCode: province,
          communitySlug: community.slug,
        },
      },
      create: {
        userId,
        provinceCode: province,
        communitySlug: community.slug,
        home: true,
      },
      update: {
        home: true,
        provinceCode: province,
        communitySlug: community.slug,
      },
    })
  })

  return reply.send({ ok: true, home: community })
})

// Communitys - get follows list
registerCommunityRoute('get', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const follows = await prisma.communityFollow.findMany({
    where: { userId },
    orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
  })

  const items = follows.map((follow: { provinceCode: string; communitySlug: string; home: boolean; createdAt: Date }) => {
    const community = findCommunity(follow.provinceCode, follow.communitySlug)
    return {
      province: follow.provinceCode,
      communitySlug: follow.communitySlug,
      home: follow.home,
      followedAt: follow.createdAt,
      community,
    }
  })

  return reply.send({ items })
})

app.get('/communities/dashboard', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const [user, follows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
    prisma.communityFollow.findMany({
      where: { userId },
      orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const followCount = follows.length
  const followKeys: Set<string> = new Set(
    follows.map((follow: { provinceCode: string; communitySlug: string }) => buildFollowKey(follow.provinceCode, follow.communitySlug))
  )

  const referenceFollow = follows.find((follow: { home: boolean }) => follow.home) ?? follows[0] ?? null
  let referenceCity: CityModel | null = null

  if (referenceFollow) {
    referenceCity = await prisma.city.findFirst({
      where: { provinceCode: referenceFollow.provinceCode, communitySlug: referenceFollow.communitySlug },
      orderBy: [{ population: 'desc' }],
    })
  }

  const communityMeta = parseCommunityMeta(user?.communityMeta ?? null)
  let suggestions = filterCachedSuggestions(communityMeta?.nearbyCommunities, followKeys)

  if (!suggestions.length) {
    let computed: CitySummaryType[] = []
    let computedReference: CommunityMetaPayload['reference'] = null

    if (referenceCity) {
      const nearest = await computeNearbyCommunitySuggestions(referenceCity, followKeys)
      if (nearest.length) {
        computed = nearest
        computedReference = {
          provinceCode: referenceCity.provinceCode,
          communitySlug: referenceCity.communitySlug,
          cityName: referenceCity.name,
        }
      }
    }

    if (!computed.length && referenceFollow) {
      const fallback = await computeGeodataFallbackSuggestions(
        { provinceCode: referenceFollow.provinceCode, communitySlug: referenceFollow.communitySlug },
        followKeys,
      )
      if (fallback.length) {
        computed = fallback
        computedReference = {
          provinceCode: referenceFollow.provinceCode,
          communitySlug: referenceFollow.communitySlug,
          cityName: referenceCity?.name ?? null,
        }
      }
    }

    if (computed.length) {
      suggestions = computed.slice()
      const payload: CommunityMetaPayload = {
        nearbyCommunities: computed,
        computedAt: new Date().toISOString(),
        reference: computedReference,
      }
      try {
        await prisma.user.update({ where: { id: userId }, data: { communityMeta: payload } })
      } catch (error) {
        req.log?.warn({ err: error }, 'Failed to persist community meta')
      }
    }
  }

  let postsToday = 0
  if (followKeys.size) {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const orConditions = follows
      .filter((follow: { communitySlug: string }) => follow.communitySlug)
      .map((follow: { provinceCode: string; communitySlug: string }) => ({ provinceCode: follow.provinceCode, communitySlug: follow.communitySlug }))
    if (orConditions.length) {
      postsToday = await prisma.post.count({
        where: {
          createdAt: { gte: startOfToday },
          OR: orConditions,
        },
      })
    }
  }

  return reply.send({
    followCount,
    followTarget: COMMUNITY_FOLLOW_TARGET,
    postsToday,
    suggestions,
    home: referenceCity
      ? {
          provinceCode: referenceCity.provinceCode,
          communitySlug: referenceCity.communitySlug,
          communityName: referenceCity.communityName,
          cityName: referenceCity.name,
        }
      : null,
  })
})

// Communitys - follow additional community
registerCommunityRoute('post', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = FollowCommunityInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const community = findCommunity(province, parse.data.communitySlug)
  if (!community) return reply.code(404).send({ error: 'community_not_found' })

  const setAsHome = parse.data.setAsHome === true

  const follow = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (setAsHome) {
      await tx.communityFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
    }

    return tx.communityFollow.upsert({
      where: {
        userId_provinceCode_communitySlug: {
          userId,
          provinceCode: province,
          communitySlug: community.slug,
        },
      },
      create: {
        userId,
        provinceCode: province,
        communitySlug: community.slug,
        home: true,
      },
      update: {
        home: true,
        provinceCode: province,
        communitySlug: community.slug,
      },
    })
  })

  return reply.send({
    ok: true,
    follow: {
      province: follow.provinceCode,
      communitySlug: follow.communitySlug,
      home: follow.home,
      community,
    },
  })
})

// Communitys - unfollow
registerCommunityRoute('delete', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = UnfollowCommunityInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const existing = await prisma.communityFollow.findUnique({
    where: {
      userId_provinceCode_communitySlug: {
        userId,
        provinceCode: province,
        communitySlug: parse.data.communitySlug,
      },
    },
  })

  if (!existing) {
    return reply.code(404).send({ error: 'not_following' })
  }

  await prisma.communityFollow.delete({
    where: {
      userId_provinceCode_communitySlug: {
        userId,
        provinceCode: province,
        communitySlug: parse.data.communitySlug,
      },
    },
  })

  return reply.send({ ok: true })
})

registerCommunityRoute('post', '/communities/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = CommunityGeolocateInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  try {
    const { lat, lng, limit, bboxPaddingDegrees } = parse.data
    const { primary, alternatives, meta } = await locateCommunityFromPoint(lat, lng, {
      limit: limit ?? undefined,
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    const enriched = await enrichMatchesWithCities([primary, ...alternatives], lat, lng)
    const [enrichedPrimary, ...enrichedAlternatives] = enriched
    return reply.send({
      primary: enrichedPrimary ?? null,
      alternatives: enrichedAlternatives.filter((entry): entry is EnrichedGeoMatch => Boolean(entry)),
      meta,
    })
  } catch (error) {
    req.log.error({ err: error }, 'community_geolocate_failed')
    return reply.code(500).send({ error: 'geolocation_failed' })
  }
})

app.post('/postal/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = PostalGeolocateInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  try {
    const { lat, lng, limit, bboxPaddingDegrees } = parse.data
    const fsaResult = await locateFsaFromPoint(lat, lng, {
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    if (!fsaResult.match) {
      return reply.code(404).send({ error: 'fsa_not_found' })
    }

    const communityMatches = await locateCommunityFromPoint(lat, lng, {
      limit: limit ?? undefined,
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    const enriched = await enrichMatchesWithCities([communityMatches.primary, ...communityMatches.alternatives], lat, lng)
    const [primary, ...alternativeMatches] = enriched

    return reply.send({
      postalCode: fsaResult.match.code,
      fsa: {
        code: fsaResult.match.code,
        provinceCode: fsaResult.match.provinceCode ?? null,
        subdivisionId: fsaResult.match.subdivisionId ?? null,
        subdivisionName: fsaResult.match.subdivisionName ?? null,
        centroidLat: fsaResult.match.centroidLat ?? null,
        centroidLng: fsaResult.match.centroidLng ?? null,
        defaultCommunitySlug: fsaResult.match.defaultCommunitySlug ?? null,
        defaultCommunityName: fsaResult.match.defaultCommunityName ?? null,
      },
      primary: primary ?? null,
      alternatives: alternativeMatches.filter((entry): entry is EnrichedGeoMatch => Boolean(entry)),
    })
  } catch (error) {
    req.log.error({ err: error }, 'postal_geolocate_failed')
    return reply.code(500).send({ error: 'postal_geolocate_failed' })
  }
})

registerCommunityRoute('post', '/communities/postal-lookup', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = PostalLookupInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const normalized = normalizePostalCodeInput(parse.data.postalCode)
  if (!normalized) {
    return reply.code(400).send({ error: 'invalid_postal_code' })
  }

  try {
    const fsaRecord = await prisma.forwardSortationArea.findUnique({
      where: { code: normalized.fsa },
      select: {
        code: true,
        provinceCode: true,
        subdivisionId: true,
        subdivisionName: true,
        centroidLat: true,
        centroidLng: true,
        defaultCommunitySlug: true,
        defaultCommunityName: true,
      },
    })

    if (!fsaRecord) {
      return reply.code(404).send({ error: 'fsa_not_found' })
    }

    let coords = statsCanPointToWgs84(fsaRecord.centroidLat, fsaRecord.centroidLng)
    if (!coords) {
      const fallbackCity = await (fsaRecord.subdivisionId || fsaRecord.provinceCode
        ? prisma.city.findFirst({
            where: fsaRecord.subdivisionId
              ? { censusSubdivisionId: fsaRecord.subdivisionId }
              : { provinceCode: fsaRecord.provinceCode ?? undefined },
            orderBy: { population: 'desc' },
          })
        : null)
      if (fallbackCity) {
        coords = { lat: fallbackCity.latitude, lng: fallbackCity.longitude }
      }
    }

    let enrichedPrimary: EnrichedGeoMatchOrNull = null
    let enrichedAlternatives: EnrichedGeoMatch[] = []
    if (coords) {
      const locateResult = await locateCommunityFromPoint(coords.lat, coords.lng, {
        limit: parse.data.limit ?? undefined,
      })
      const enriched = await enrichMatchesWithCities([locateResult.primary, ...locateResult.alternatives], coords.lat, coords.lng)
      const [primaryMatch, ...alternativeMatches] = enriched
      enrichedPrimary = primaryMatch ?? null
      enrichedAlternatives = alternativeMatches.filter((entry): entry is EnrichedGeoMatch => Boolean(entry))
    }

    return reply.send({
      postalCode: normalized.postal,
      fsa: {
        code: fsaRecord.code,
        provinceCode: fsaRecord.provinceCode ?? null,
        subdivisionId: fsaRecord.subdivisionId ?? null,
        subdivisionName: fsaRecord.subdivisionName ?? null,
        centroidLat: coords?.lat ?? null,
        centroidLng: coords?.lng ?? null,
        defaultCommunitySlug: fsaRecord.defaultCommunitySlug ?? null,
        defaultCommunityName: fsaRecord.defaultCommunityName ?? null,
      },
      primary: enrichedPrimary,
      alternatives: enrichedAlternatives,
    })
  } catch (error) {
    req.log.error({ err: error }, 'postal_lookup_failed')
    return reply.code(500).send({ error: 'postal_lookup_failed' })
  }
})

// Basic auth hook (placeholder)
app.addHook('preHandler', async (req: FastifyRequest) => {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = (await (req as any).jwtVerify()) as { sub: string }
      // minimal: attach user id
      ;(req as any).user = { id: payload.sub }
    } catch {
      // ignore, public routes allowed
    }
  }
})

// Profile - fetch current user profile
app.get('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      handle: true,
      name: true,
      bio: true,
      billingAddress1: true,
      billingAddress2: true,
      billingCity: true,
      billingState: true,
      billingPostalCode: true,
      billingCountry: true,
      avatarUrl: true,
      coverUrl: true,
      premiumStatus: true,
      premiumSince: true,
      premiumRenewsAt: true,
      avatarMediaId: true,
      coverMediaId: true,
      avatarPostId: true,
      coverPostId: true,
      createdAt: true,
    },
  })

  if (!user) return reply.code(404).send({ error: 'not_found' })

  const [communitiesFollowing, homeFollow, friends, connections] = await Promise.all([
    prisma.communityFollow.count({ where: { userId } }),
    prisma.communityFollow.findFirst({ where: { userId, home: true } }),
    prisma.friendship.count({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    }),
    prisma.connection.count({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    }),
  ])

  let experienceItems: Array<{
    id: string
    title: string
    organization: string
    location: string | null
    startDate: Date
    endDate: Date | null
    current: boolean
    description: string | null
    organizationProfile: {
      id: string
      name: string
      slug: string
      provinceCode: string
      communitySlug: string
      logoUrl: string | null
      coverUrl: string | null
    } | null
  }> = []

  try {
    const experiences = await prisma.experience.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { startDate: 'desc' }],
    })

    const normalizedExperienceOrganizationNames: string[] = Array.from(
      new Set<string>(
        experiences
          .map((exp: ExperienceModel) => exp.organization.trim().toLowerCase())
          .filter((name: string) => name.length > 0),
      ),
    )

    const organizationByName = new Map<
      string,
      {
        id: string
        name: string
        slug: string
        provinceCode: string
        communitySlug: string
        logoUrl: string | null
        coverUrl: string | null
      }
    >()

    if (normalizedExperienceOrganizationNames.length > 0) {
      const linkedOrganizations = await prisma.business.findMany({
        where: {
          status: 'ACTIVE',
          OR: normalizedExperienceOrganizationNames.map((name) => ({
            name: {
              equals: name,
              mode: 'insensitive',
            },
          })),
        },
        orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          logoUrl: true,
          coverUrl: true,
        },
      })

      for (const org of linkedOrganizations) {
        if (!org.provinceCode || !org.communitySlug) continue
        const key = org.name.trim().toLowerCase()
        if (!key || organizationByName.has(key)) continue
        organizationByName.set(key, {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
          coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        })
      }
    }

  experienceItems = experiences.map((exp: ExperienceModel) => ({
      organizationProfile: organizationByName.get(exp.organization.trim().toLowerCase()) ?? null,
      id: exp.id,
      title: exp.title,
      organization: exp.organization,
      location: exp.location ?? null,
      startDate: exp.startDate,
      endDate: exp.endDate ?? null,
      current: exp.current,
      description: exp.description ?? null,
    }))
  } catch (err) {
    if (!isExperienceTableMissing(err)) {
      throw err
    }
  }

  const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  let homeCommunity: Record<string, any> | null = null
  if (homeFollow) {
    const community = findCommunity(homeFollow.provinceCode, homeFollow.communitySlug)
    const provinceName = getProvinceDisplayName(homeFollow.provinceCode as any)
    homeCommunity = {
      provinceCode: homeFollow.provinceCode,
      provinceName,
      communitySlug: homeFollow.communitySlug,
      communityName: community?.name ?? homeFollow.communitySlug,
    }
  }

  return reply.send({
    user: {
      id: user.id,
      email: user.email,
      handle: user.handle,
      firstName,
      lastName,
      name: user.name,
      bio: user.bio ? sanitizePlainText(user.bio) : '',
      billingAddress1: user.billingAddress1 ?? null,
      billingAddress2: user.billingAddress2 ?? null,
      billingCity: user.billingCity ?? null,
      billingState: user.billingState ?? null,
      billingPostalCode: user.billingPostalCode ?? null,
      billingCountry: user.billingCountry ?? null,
      avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
      avatarMediaId: user.avatarMediaId ?? null,
      coverMediaId: user.coverMediaId ?? null,
      avatarPostId: user.avatarPostId ?? null,
      coverPostId: user.coverPostId ?? null,
      createdAt: user.createdAt,
      experiences: experienceItems,
    },
    stats: {
      friends,
      connections,
      communitiesFollowing,
    },
    homeCommunity,
  })
})

// Profile - update current user
app.put('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = UpdateProfileInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const { firstName, lastName, bio, experiences, avatarMediaId, coverMediaId } = parse.data
  const normalizedFirstName = firstName.trim().toLowerCase()
  const normalizedLastName = lastName.trim().toLowerCase()
  const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim()

  let avatarAsset: Awaited<ReturnType<typeof prisma.mediaAsset.findFirst>> = null
  if (avatarMediaId) {
    avatarAsset = await prisma.mediaAsset.findFirst({ where: { id: avatarMediaId, ownerId: userId, category: 'avatar' } })
    if (!avatarAsset) {
      return reply.code(400).send({ error: 'invalid_avatar_media' })
    }
    if (avatarAsset.status === 'failed') {
      return reply.code(400).send({ error: 'avatar_media_failed' })
    }
  }

  let coverAsset: Awaited<ReturnType<typeof prisma.mediaAsset.findFirst>> = null
  if (coverMediaId) {
    coverAsset = await prisma.mediaAsset.findFirst({ where: { id: coverMediaId, ownerId: userId, category: 'cover' } })
    if (!coverAsset) {
      return reply.code(400).send({ error: 'invalid_cover_media' })
    }
    if (coverAsset.status === 'failed') {
      return reply.code(400).send({ error: 'cover_media_failed' })
    }
  }

  const normalizedExperiences = (experiences ?? []).map((exp: { title: string; organization: string; location?: string | null; startDate: string; endDate?: string | null; current: boolean; description?: string | null }, index: number) => ({
    id: randomUUID(),
    userId,
    title: exp.title.trim(),
    organization: exp.organization.trim(),
    location: exp.location?.trim() || null,
    startDate: new Date(exp.startDate),
    endDate: exp.current ? null : exp.endDate ? new Date(exp.endDate) : null,
    current: exp.current,
    description: exp.description?.trim() ? exp.description.trim() : null,
    position: index,
  }))

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const baseHandle = buildHandleBase(normalizedFirstName, normalizedLastName)
      const handle = await generateUniqueHandle(baseHandle, tx, userId)

      const userUpdateData: Prisma.UserUncheckedUpdateInput = {
        name: fullName,
        bio: bio?.trim() ? sanitizePlainText(bio).trim() : null,
        handle,
      }

      if (avatarMediaId) {
        userUpdateData.avatarMediaId = avatarMediaId
        const avatarUrl = avatarAsset?.status === 'ready' ? extractVariantUrl(avatarAsset.variants, ['avatar@2x', 'avatar@1x', 'avatar-thumb']) : null
        if (avatarUrl) {
          userUpdateData.avatarUrl = avatarUrl
        }
      }

      if (coverMediaId) {
        userUpdateData.coverMediaId = coverMediaId
        const coverUrl = coverAsset?.status === 'ready' ? extractVariantUrl(coverAsset.variants, ['cover-xl', 'cover-lg', 'cover-md']) : null
        if (coverUrl) {
          userUpdateData.coverUrl = coverUrl
        }
      }

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: userUpdateData,
        select: {
          id: true,
          name: true,
          bio: true,
          handle: true,
          avatarUrl: true,
          coverUrl: true,
          avatarMediaId: true,
          coverMediaId: true,
          avatarPostId: true,
          coverPostId: true,
        },
      })

      if (experiences) {
        await tx.experience.deleteMany({ where: { userId } })
        if (normalizedExperiences.length > 0) {
          await tx.experience.createMany({ data: normalizedExperiences })
        }
      }

      return updatedUser
    })

    return reply.send({ ok: true, user: normalizeUserMedia(result) })
  } catch (err) {
    if (isExperienceTableMissing(err)) {
      return reply.code(503).send({ error: 'experiences_not_available' })
    }
    throw err
  }
})

// Profile photo update + post
app.post('/profile/photo', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parsed = UpdateProfilePhotoInput.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const { category, displayAssetId, fullAssetId, caption } = parsed.data

    const displayAsset = await prisma.mediaAsset.findFirst({ where: { id: displayAssetId, ownerId: userId, category } })
    if (!displayAsset) return reply.code(404).send({ error: 'display_asset_not_found' })
    if (displayAsset.status === 'failed') return reply.code(400).send({ error: 'display_asset_failed' })
    if (displayAsset.status !== 'ready') return reply.code(409).send({ error: 'display_asset_not_ready' })

    const fullAsset = await prisma.mediaAsset.findFirst({ where: { id: fullAssetId, ownerId: userId } })
    if (!fullAsset) return reply.code(404).send({ error: 'full_asset_not_found' })
    if (fullAsset.status === 'failed') return reply.code(400).send({ error: 'full_asset_failed' })
    if (fullAsset.status !== 'ready') return reply.code(409).send({ error: 'full_asset_not_ready' })

    const displayVariantPreference = category === 'avatar' ? ['avatar@2x', 'avatar@1x', 'avatar-thumb'] : ['cover-xl', 'cover-lg', 'cover-md']
    const displayUrl = extractVariantUrl(displayAsset.variants, displayVariantPreference)
    if (!displayUrl) return reply.code(400).send({ error: 'display_variant_missing' })

    const postVariantPreference = (() => {
      if (fullAsset.category === 'post_image') {
        return ['post-xl', 'post-lg', 'post-md']
      }
      if (fullAsset.category === 'cover') {
        return ['cover-xl', 'cover-lg', 'cover-md']
      }
      return ['avatar@2x', 'avatar@1x', 'avatar-thumb']
    })()
    const postMediaUrl = extractVariantUrl(fullAsset.variants, postVariantPreference)
    if (!postMediaUrl) return reply.code(400).send({ error: 'full_variant_missing' })

    const baseBody = category === 'avatar' ? 'Updated profile photo.' : 'Updated cover photo.'
    const body = caption?.trim() ? caption.trim() : baseBody

    const author = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, handle: true, name: true, avatarUrl: true, premiumStatus: true } })
    if (!author) return reply.code(401).send({ error: 'unauthorized' })

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const post = await tx.post.create({
        data: {
          authorId: userId,
          body,
          mediaUrl: postMediaUrl,
          type: 'post',
          jurisdiction: 'self',
        },
        include: {
          author: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              premiumStatus: true,
            },
          },
        },
      })

      const userUpdate: Prisma.UserUncheckedUpdateInput =
        category === 'avatar'
          ? { avatarMediaId: displayAsset.id, avatarUrl: displayUrl, avatarPostId: post.id }
          : { coverMediaId: displayAsset.id, coverUrl: displayUrl, coverPostId: post.id }

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: userUpdate,
        select: {
          id: true,
          email: true,
          handle: true,
          name: true,
          bio: true,
          avatarUrl: true,
          coverUrl: true,
          avatarMediaId: true,
          coverMediaId: true,
          avatarPostId: true,
          coverPostId: true,
        },
      })

      return { post, user: updatedUser }
    })

    const postWithUpdatedAuthor: PostWithAuthor = {
      ...result.post,
      author: {
        ...result.post.author,
        avatarUrl: category === 'avatar' ? displayUrl : result.post.author.avatarUrl,
      },
    }

    return reply.send({
      ok: true,
      post: formatPost(postWithUpdatedAuthor),
      user: normalizeUserMedia(result.user),
    })
  }),
)

app.post('/media/uploads', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = RequestMediaUploadInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { category, mime, byteSize, filename } = parse.data
    const mediaCategory = category as MediaCategory
    const limit = MEDIA_CATEGORY_LIMITS[mediaCategory]
    if (byteSize > limit) {
      return reply.code(400).send({ error: 'file_too_large', maxBytes: limit })
    }
    if (!ensureMimeSupported(mime)) {
      return reply.code(400).send({ error: 'unsupported_mime' })
    }

    const assetId = randomUUID()
    const extension = extensionForMime(mime)
    const originalKey = buildOriginalObjectKey(mediaCategory, userId, assetId, extension)

    const asset = await prisma.mediaAsset.create({
      data: {
        id: assetId,
        ownerId: userId,
        category: mediaCategory,
        assetType: 'image',
        storageType: 'minio',
        originalKey,
        mime,
        byteSize,
        status: 'pending',
        metadata: filename ? { filename } : undefined,
      },
    })

    const command = new PutObjectCommand({
      Bucket: MEDIA_BUCKET_ORIGINAL,
      Key: originalKey,
      ContentType: mime,
    })
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: MEDIA_SIGNED_URL_TTL })
    const allowDirectUploadUrl = !isPrivateOrLocalNetworkUrl(uploadUrl)

    return reply.send({
      assetId: asset.id,
      upload: allowDirectUploadUrl
        ? {
            url: uploadUrl,
            method: 'PUT',
            headers: {
              'content-type': mime,
            },
          }
        : undefined,
      proxyPath: `/media/uploads/${asset.id}/proxy`,
      expiresInSeconds: MEDIA_SIGNED_URL_TTL,
      bucket: MEDIA_BUCKET_ORIGINAL,
      key: originalKey,
      maxBytes: limit,
    })
  }),
)

app.post('/media/uploads/complete', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CompleteMediaUploadInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { assetId, width, height, checksum } = parse.data
    const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, ownerId: userId } })
    if (!asset) return reply.code(404).send({ error: 'asset_not_found' })

    if (asset.status === 'ready') {
      return reply.send({ ok: true, assetId })
    }

    const updatedAsset = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        width: width ?? asset.width,
        height: height ?? asset.height,
        checksum: checksum ?? asset.checksum,
        status: 'processing',
        failureReason: null,
      },
    })

    if (asset.category === 'avatar') {
      await prisma.user.update({ where: { id: userId }, data: { avatarMediaId: updatedAsset.id } })
    } else if (asset.category === 'cover') {
      await prisma.user.update({ where: { id: userId }, data: { coverMediaId: updatedAsset.id } })
    }

    await mediaQueue.add(
      'process',
      { assetId },
      {
        removeOnComplete: true,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      },
    )

    return reply.send({ ok: true, assetId })
  }),
)

app.put(
  '/media/uploads/:id/proxy',
  { bodyLimit: MEDIA_PROXY_UPLOAD_LIMIT },
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = MediaAssetParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const asset = await prisma.mediaAsset.findFirst({ where: { id: params.data.id, ownerId: userId } })
      if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
      if (asset.status !== 'pending') {
        return reply.code(409).send({ error: 'asset_not_pending' })
      }

      const bodyBuffer = Buffer.isBuffer((req as any).body) ? ((req as any).body as Buffer) : await readRequestBuffer(req)
      if (!bodyBuffer || bodyBuffer.length === 0) {
        return reply.code(400).send({ error: 'empty_upload' })
      }

      const assetCategory = asset.category as MediaCategory
      const maxBytes = asset.byteSize ?? MEDIA_CATEGORY_LIMITS[assetCategory]
      if (maxBytes && bodyBuffer.length > maxBytes) {
        return reply.code(400).send({ error: 'file_too_large', maxBytes })
      }

      await s3Client.send(
        new PutObjectCommand({
          Bucket: MEDIA_BUCKET_ORIGINAL,
          Key: asset.originalKey,
          Body: bodyBuffer,
          ContentType: asset.mime ?? 'application/octet-stream',
        }),
      )

      return reply.send({ ok: true, bytesUploaded: bodyBuffer.length })
    }),
)

app.get('/media/assets/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MediaAssetParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const asset = await prisma.mediaAsset.findFirst({
      where: { id: params.data.id, ownerId: userId },
    })

    if (!asset) return reply.code(404).send({ error: 'asset_not_found' })

    return reply.send({
      asset: {
        id: asset.id,
        category: asset.category,
        status: asset.status,
        variants: normalizeMediaVariants(asset.variants),
        width: asset.width,
        height: asset.height,
        failureReason: asset.failureReason,
        readyAt: asset.readyAt,
      },
    })
  }),
)

// Create post
app.post('/posts', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const parse = CreatePostInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const author = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, handle: true } })
    if (!author) return reply.code(401).send({ error: 'unauthorized' })

    let business: { id: string; ownerId: string; provinceCode: string | null; communitySlug: string | null; status: BusinessStatus } | null = null
    const businessId = (parse.data as any).businessId as string | undefined
    if (businessId) {
      business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, ownerId: true, provinceCode: true, communitySlug: true, status: true },
      })
      if (!business) return reply.code(404).send({ error: 'organization_not_found' })

      const isOwner = business.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: business.id, userId } },
            select: { role: true },
          })
      if (!membership) return reply.code(403).send({ error: 'forbidden' })
    }

    let provinceCode: string | null = null
    let communitySlug: string | null = null
    if (business) {
      if (!business.provinceCode || !business.communitySlug) {
        return reply.code(400).send({ error: 'organization_missing_community' })
      }
      const normalizedProvince = normalizeProvinceCode(business.provinceCode)
      if (!normalizedProvince) {
        return reply.code(400).send({ error: 'invalid_province' })
      }
      provinceCode = normalizedProvince
      communitySlug = business.communitySlug

      const requestedProvince = parse.data.communityProvince ? normalizeProvinceCode(parse.data.communityProvince) : null
      const requestedCommunity = parse.data.communitySlug?.trim() ? slugifyCommunityName(parse.data.communitySlug) : null
      if ((requestedProvince && requestedProvince !== provinceCode) || (requestedCommunity && requestedCommunity !== communitySlug)) {
        return reply.code(400).send({ error: 'organization_community_mismatch' })
      }
    } else if (parse.data.communityProvince && parse.data.communitySlug) {
      const normalizedProvince = normalizeProvinceCode(parse.data.communityProvince)
      if (!normalizedProvince) {
        return reply.code(400).send({ error: 'invalid_province' })
      }
      const community = findCommunity(normalizedProvince, parse.data.communitySlug)
      if (!community) {
        return reply.code(404).send({ error: 'community_not_found' })
      }
      provinceCode = community.province
      communitySlug = community.slug
    }

    const { body: rawBody, mediaUrl, images, hashtags, type, title, jurisdiction, sharedPostId, visibility, audience } = parse.data

    const isArticle = type === 'article'
    const normalizedBody = sharedPostId
      ? sanitizePlainText(rawBody)
      : isArticle
        ? sanitizeRichTextHtml(rawBody)
        : sanitizePlainText(rawBody)

    if (sharedPostId && (!normalizedBody || normalizedBody.trim().length === 0)) {
      return reply.code(400).send({ error: 'Commentary is required when sharing a post.' })
    }

    const slugBase = buildPostSlugBase({ handle: author.handle, title, body: normalizedBody })
    const normalizedJurisdiction: Jurisdiction = jurisdiction ?? (provinceCode ? 'federal' : DEFAULT_JURISDICTION)
    const normalizedAudience = business
      ? 'organization'
      : provinceCode && communitySlug
        ? 'community'
        : audience === 'network'
          ? 'network'
          : 'friends'

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const seoSlug = await generateUniquePostSlug(slugBase, tx)

      const post = await tx.post.create({
        data: {
          authorId: userId,
          ...(business ? { businessId: business.id } : {}),
          ...(visibility ? { visibility } : {}),
          ...(normalizedAudience ? ({ audience: normalizedAudience } as any) : {}),
          body: normalizedBody,
          mediaUrl,
          images: images ? (images as any) : undefined,
          type,
          title,
          provinceCode,
          communitySlug,
          seoSlug,
          jurisdiction: normalizedJurisdiction,
          sharedPostId,
        },
        include: POST_INCLUDE,
      })

      if (hashtags?.length) {
        const tags = [...new Set(hashtags.map((t: string) => t.replace(/^#/, '')))] as string[]
        if (tags.length) {
          await tx.hashtag.createMany({ data: tags.map((tag: string) => ({ tag })), skipDuplicates: true })
          await tx.postHashtag.createMany({ data: tags.map((tag: string) => ({ postId: post.id, tag })) })
        }
      }

      return post
    })

    return reply.code(201).send(formatPost(created))
  }),
)

const VotePostInput = z.object({
  postId: z.string().cuid(),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
})

app.post('/posts/vote', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = VotePostInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { postId, value } = parse.data

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, createdAt: true, updatedAt: true, visibility: true, businessId: true },
    })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    if (post.visibility === 'members' && post.businessId) {
      const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true } })
      const isOwner = business?.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: post.businessId, userId } },
            select: { role: true },
          })
      if (!membership) return reply.code(404).send({ error: 'post_not_found' })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (value === 0) {
        await tx.vote.deleteMany({
          where: {
            userId,
            postId,
          },
        })
      } else {
        await tx.vote.upsert({
          where: {
            userId_postId: {
              userId,
              postId,
            },
          },
          create: {
            userId,
            postId,
            value,
          },
          update: {
            value,
          },
        })
      }

      await refreshPostAggregates(tx, postId, { createdAt: post.createdAt, lastActivityAt: post.updatedAt }, { bumpActivity: false })
    })

    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    })

    if (!updatedPost) return reply.code(404).send({ error: 'post_not_found' })

    return reply.send({ post: formatPost(updatedPost, { viewerVote: value === 0 ? null : value }) })
  }),
)

app.get('/posts/:id/comments', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

    const query = z.object({ sort: CommentSortEnum.optional() }).safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const post = await prisma.post.findUnique({
      where: { id: params.data.id },
      select: { id: true, visibility: true, businessId: true },
    })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    const viewerId = (req as any).user?.id as string | undefined

    if (post.visibility === 'members' && post.businessId) {
      if (!viewerId) return reply.code(404).send({ error: 'post_not_found' })
      const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true } })
      const isOwner = business?.ownerId === viewerId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: post.businessId, userId: viewerId } },
            select: { role: true },
          })
      if (!membership) return reply.code(404).send({ error: 'post_not_found' })
    }

    const sortMode = query.data.sort ?? 'hot'

    const commentRows: CommentWithUser[] = await prisma.comment.findMany({
      where: { postId: params.data.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            premiumStatus: true,
          },
        },
      },
    })

    let viewerCommentVotes: Record<string, number> = {}
    if (viewerId && commentRows.length) {
      const commentIds = commentRows.map((comment) => comment.id)
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: commentIds } },
        select: { commentId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.commentId] = vote.value
      }
      viewerCommentVotes = voteMap
    }

    return reply.send({
      comments: buildCommentTree(commentRows, viewerCommentVotes, { sort: sortMode }),
    })
  }),
)

app.post('/comments', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CreateCommentInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { postId, body: rawBody, parentId } = parse.data
    const body = sanitizePlainText(rawBody)

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return reply.code(404).send({ error: 'user_not_found' })
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, createdAt: true, updatedAt: true, visibility: true, businessId: true },
    })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    if (post.visibility === 'members' && post.businessId) {
      const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true } })
      const isOwner = business?.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: post.businessId, userId } },
            select: { role: true },
          })
      if (!membership) return reply.code(404).send({ error: 'post_not_found' })
    }

    let parentComment: { id: string; postId: string; userId: string } | null = null
    if (parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentId }, select: { id: true, postId: true, userId: true } })
      if (!parent || parent.postId !== postId) {
        return reply.code(400).send({ error: 'invalid_parent_comment' })
      }
      parentComment = parent
    }

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const comment = await tx.comment.create({
        data: {
          postId,
          userId,
          parentId: parentId ?? null,
          body,
        },
        include: {
          user: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
              premiumStatus: true,
            },
          },
        },
      })

      await refreshPostAggregates(tx, postId, { createdAt: post.createdAt, lastActivityAt: post.updatedAt }, { bumpActivity: true })

      return comment
    })

    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    })

    if (parentComment && parentComment.userId !== userId && updatedPost) {
      const paths = getCanonicalPaths(updatedPost)
      const basePath = paths.community ?? paths.user
      const sourceCommentTarget = `${basePath}?comment=${encodeURIComponent(parentComment.id)}#comment-${parentComment.id}`
      const replyCommentTarget = `${basePath}?comment=${encodeURIComponent(created.id)}#comment-${created.id}`
      await createNotificationRecord({
        userId: parentComment.userId,
        actorId: userId,
        type: COMMENT_NOTIFICATION_TYPES.REPLY,
        postId,
        payload: {
          commentId: created.id,
          parentCommentId: parentComment.id,
          bodyPreview: truncatePushBody(body, 90),
          url: sourceCommentTarget,
          sourceUrl: sourceCommentTarget,
          replyUrl: replyCommentTarget,
        },
      })
    }

    if (!parentComment && post.authorId && post.authorId !== userId && updatedPost) {
      const paths = getCanonicalPaths(updatedPost)
      const basePath = paths.community ?? paths.user
      const commentTarget = `${basePath}?comment=${encodeURIComponent(created.id)}#comment-${created.id}`
      await createNotificationRecord({
        userId: post.authorId,
        actorId: userId,
        type: COMMENT_NOTIFICATION_TYPES.POST_COMMENT,
        postId,
        payload: {
          commentId: created.id,
          bodyPreview: truncatePushBody(body, 90),
          url: commentTarget,
          sourceUrl: commentTarget,
        },
      })
    }

    return reply.code(201).send({
      comment: {
        ...mapComment(created, 0),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      post: updatedPost ? formatPost(updatedPost) : null,
    })
  }),
)

app.post('/comments/vote', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = VoteCommentInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return reply.code(404).send({ error: 'user_not_found' })
    }

    const { commentId, value } = parse.data
    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            premiumStatus: true,
          },
        },
        post: {
          select: { id: true, createdAt: true, updatedAt: true, visibility: true, businessId: true },
        },
      },
    })

    if (!existing) return reply.code(404).send({ error: 'comment_not_found' })

    if (existing.post.visibility === 'members' && existing.post.businessId) {
      const business = await prisma.business.findUnique({ where: { id: existing.post.businessId }, select: { ownerId: true } })
      const isOwner = business?.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: existing.post.businessId, userId } },
            select: { role: true },
          })
      if (!membership) return reply.code(404).send({ error: 'comment_not_found' })
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (value === 0) {
        await tx.commentVote.deleteMany({
          where: {
            userId,
            commentId,
          },
        })
      } else {
        await tx.commentVote.upsert({
          where: {
            userId_commentId: {
              userId,
              commentId,
            },
          },
          create: {
            userId,
            commentId,
            value,
          },
          update: {
            value,
          },
        })
      }

      await refreshCommentAggregates(tx, commentId)
      await refreshPostAggregates(tx, existing.postId, { createdAt: existing.post.createdAt, lastActivityAt: existing.post.updatedAt }, { bumpActivity: false })

      const updatedComment = await tx.comment.findUnique({
        where: { id: commentId },
        include: {
          user: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
              premiumStatus: true,
            },
          },
        },
      })

      return updatedComment
    })

    if (!result) return reply.code(404).send({ error: 'comment_not_found' })

    return reply.send({
      comment: {
        ...mapComment(result, value),
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      },
    })
  }),
)

app.delete('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

    const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { authorId: true, type: true } })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    if (post.authorId !== userId) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await prisma.post.delete({ where: { id: params.data.id } })

    return reply.send({ success: true })
  }),
)

app.patch('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

    const parse = UpdatePostInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { authorId: true } })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    if (post.authorId !== userId) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const { title, body: rawBody, mediaUrl, hashtags } = parse.data
    const body = post.type === 'article' ? sanitizeRichTextHtml(rawBody) : sanitizePlainText(rawBody)

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedPost = await tx.post.update({
        where: { id: params.data.id },
        data: {
          title,
          body,
          mediaUrl,
        },
        include: {
          author: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              premiumStatus: true,
            },
          },
        },
      })

      if (hashtags) {
        // Clear existing hashtags
        await tx.postHashtag.deleteMany({ where: { postId: params.data.id } })

        const tags = [...new Set(hashtags.map((t: string) => t.replace(/^#/, '')))] as string[]
        if (tags.length) {
          await tx.hashtag.createMany({ data: tags.map((tag: string) => ({ tag })), skipDuplicates: true })
          await tx.postHashtag.createMany({ data: tags.map((tag: string) => ({ postId: params.data.id, tag })) })
        }
      }

      return updatedPost
    })

    return reply.send(formatPost(updated))
  }),
)

// Auth: login
app.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
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
    const ok = await bcrypt.compare(password, (user as any).passwordHash)
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' })
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    const token = await (app as any).jwt.sign({ sub: user.id })
    return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
  }),
)

// Auth: me
app.get('/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const payload = await (req as any).jwtVerify()
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        handle: true,
        name: true,
        avatarUrl: true,
        coverUrl: true,
        premiumStatus: true,
        premiumSince: true,
        premiumRenewsAt: true,
      },
    })
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    const homeFollow = await prisma.communityFollow.findFirst({ where: { userId: payload.sub, home: true } })
    let homeCommunity: null | {
      provinceCode: string
      provinceName: string
      communitySlug: string
      communityName: string
    } = null

    if (homeFollow) {
      const community = findCommunity(homeFollow.provinceCode, homeFollow.communitySlug)
      const normalizedProvince = normalizeProvinceCode(homeFollow.provinceCode)
      homeCommunity = {
        provinceCode: normalizedProvince ?? homeFollow.provinceCode,
        provinceName: normalizedProvince
          ? getProvinceDisplayName(normalizedProvince)
          : homeFollow.provinceCode.toUpperCase(),
        communitySlug: homeFollow.communitySlug,
        communityName: community?.name ?? homeFollow.communitySlug,
      }
    }

    const normalizedUser = normalizeUserMedia(user)
    return reply.send({
      ...normalizedUser,
      homeCommunity,
      isPremium: isPremium(user.premiumStatus),
      isVerified: isPremium(user.premiumStatus),
      premiumSince: user.premiumSince ?? null,
      premiumRenewsAt: user.premiumRenewsAt ?? null,
    })
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }
})

app.get('/push/public-key', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = await resolveUserId(req)
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const publicKey = getVapidPublicKey()
    if (!publicKey) return reply.code(503).send({ error: 'push_not_configured' })

    return reply.send({ publicKey })
  }),
)

app.post('/push/subscribe', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = await resolveUserId(req)
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    if (exceedsPushBodyLimit(req.body)) return reply.code(413).send({ error: 'payload_too_large' })

    const withinLimit = await withinPushRateLimit({
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
  withSchemaGuard(req, reply, async () => {
    const userId = await resolveUserId(req)
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    if (exceedsPushBodyLimit(req.body)) return reply.code(413).send({ error: 'payload_too_large' })

    const parse = WebPushUnsubscribeRouteInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const count = await deactivateSubscription(userId, parse.data.endpoint)
    return reply.send({ ok: true, count })
  }),
)

app.post('/push/test', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = await resolveUserId(req)
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    if (exceedsPushBodyLimit(req.body)) return reply.code(413).send({ error: 'payload_too_large' })

    const withinLimit = await withinPushRateLimit({
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
      req.log.info(
        { route: '/push/test', userId, payload },
        'push_test_dispatch_dev',
      )
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

  const token = normalizePushToken(parse.data.token)
  if (!token) return reply.code(400).send({ error: 'invalid_token' })

  const tokenLen = token.length
  const tokenSuffix = token.slice(-8)

  const userId = await resolveUserId(req)
  const registerSecret = getHeaderValue(req, 'x-register-secret')
  const secretAuthorized = !!PUSH_REGISTER_SECRET && registerSecret === PUSH_REGISTER_SECRET
  if (!userId && !secretAuthorized) {
    req.log.info({ route: '/mobile/push/register', platform: parse.data.platform, hasUserId: false }, 'push_register_unauthorized')
    return reply.code(401).send({ error: 'unauthorized' })
  }

  await ensurePushDeviceRegistryTable()

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

  const token = normalizePushToken(parse.data.token)
  if (!token) return reply.code(400).send({ error: 'invalid_token' })

  const tokenLen = token.length
  const tokenSuffix = token.slice(-8)

  const userId = await resolveUserId(req)
  const registerSecret = getHeaderValue(req, 'x-register-secret')
  const secretAuthorized = !!PUSH_REGISTER_SECRET && registerSecret === PUSH_REGISTER_SECRET
  if (!userId && !secretAuthorized) return reply.code(401).send({ error: 'unauthorized' })

  await ensurePushDeviceRegistryTable()

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

app.get('/friends', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const rows: FriendshipWithUsers[] = await prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      orderBy: [{ respondedAt: 'desc' }, { requestedAt: 'desc' }],
      include: FRIENDSHIP_WITH_USERS_INCLUDE,
    })

    return reply.send({ items: rows.map((row) => formatFriendship(row, userId)) })
  }),
)

app.get('/friends/requests', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const rows: FriendshipWithUsers[] = await prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.PENDING,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      orderBy: { requestedAt: 'asc' },
      include: FRIENDSHIP_WITH_USERS_INCLUDE,
    })

    const incoming: ReturnType<typeof formatFriendRequest>[] = []
    const outgoing: ReturnType<typeof formatFriendRequest>[] = []
    for (const row of rows) {
      if (row.addresseeId === userId) {
        incoming.push(formatFriendRequest(row, userId))
      } else {
        outgoing.push(formatFriendRequest(row, userId))
      }
    }

    return reply.send({ incoming, outgoing })
  }),
)

app.post('/friends/requests', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = FriendRequestInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const targetUserId = parse.data.userId
    if (targetUserId === userId) {
      return reply.code(400).send({ error: 'cannot_friend_self' })
    }

    const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!targetExists) {
      return reply.code(404).send({ error: 'user_not_found' })
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: targetUserId },
          { requesterId: targetUserId, addresseeId: userId },
        ],
      },
      select: { id: true, requesterId: true, addresseeId: true, status: true, requestedAt: true, respondedAt: true },
    })

    let friendship: FriendshipWithUsers
    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        return reply.code(409).send({ error: 'already_friends' })
      }
      if (existing.status === FriendshipStatus.PENDING) {
        const direction = existing.requesterId === userId ? 'outgoing' : 'incoming'
        return reply.code(409).send({ error: 'friendship_pending', direction })
      }
      friendship = await prisma.friendship.update({
        where: { id: existing.id },
        data: {
          requesterId: userId,
          addresseeId: targetUserId,
          status: FriendshipStatus.PENDING,
          requestedAt: new Date(),
          respondedAt: null,
        },
        include: FRIENDSHIP_WITH_USERS_INCLUDE,
      })
    } else {
      friendship = await prisma.friendship.create({
        data: {
          requesterId: userId,
          addresseeId: targetUserId,
        },
        include: FRIENDSHIP_WITH_USERS_INCLUDE,
      })
    }

    await notifyFriendRequest(friendship.id, friendship.requesterId, friendship.addresseeId)

    return reply.code(201).send({ request: formatFriendRequest(friendship, userId) })
  }),
)

app.post('/friends/requests/:id/accept', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = FriendshipIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const friendship = await prisma.friendship.findUnique({
      where: { id: params.data.id },
      include: FRIENDSHIP_WITH_USERS_INCLUDE,
    })
    if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })
    if (friendship.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
    if (friendship.status !== FriendshipStatus.PENDING) {
      return reply.code(409).send({ error: 'friendship_not_pending' })
    }

    const updated = await prisma.friendship.update({
      where: { id: friendship.id },
      data: { status: FriendshipStatus.ACCEPTED, respondedAt: new Date() },
      include: FRIENDSHIP_WITH_USERS_INCLUDE,
    })

    const candidateNotifications = await prisma.notification.findMany({
      where: {
        userId: updated.addresseeId,
        type: FRIEND_NOTIFICATION_TYPES.REQUEST,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: NOTIFICATION_SELECT,
    })

    const existingNotification = candidateNotifications.find((n: any) => {
      const p = n.payload as Record<string, unknown> | null
      return p?.friendshipId === updated.id
    }) ?? candidateNotifications.find((n: any) => n.actorId === updated.requesterId)

    if (existingNotification) {
        const basePayload: Record<string, unknown> = (() => {
          const raw = existingNotification.payload
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return raw as Record<string, unknown>
          }
          return {}
        })()
        const nextPayload: Record<string, unknown> = {
          ...basePayload,
          friendshipId: updated.id,
          status: 'accepted',
        }
        const refreshed = await prisma.notification.update({
          where: { id: existingNotification.id },
          data: {
            payload: nextPayload as Prisma.InputJsonValue,
            readAt: new Date(),
          },
          select: NOTIFICATION_SELECT,
        })
        await dispatchNotification(refreshed)
      }

    await notifyFriendAcceptance(updated.id, updated.requesterId, updated.addresseeId)

    return reply.send({ friendship: formatFriendship(updated, userId) })
  }),
)

app.post('/friends/requests/:id/reject', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = FriendshipIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const friendship = await prisma.friendship.findUnique({
      where: { id: params.data.id },
      include: FRIENDSHIP_WITH_USERS_INCLUDE,
    })
    if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })
    if (friendship.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
    if (friendship.status !== FriendshipStatus.PENDING) {
      return reply.code(409).send({ error: 'friendship_not_pending' })
    }

    const updated = await prisma.friendship.update({
      where: { id: friendship.id },
      data: { status: FriendshipStatus.REJECTED, respondedAt: new Date() },
      include: FRIENDSHIP_WITH_USERS_INCLUDE,
    })

    const candidateNotifications = await prisma.notification.findMany({
      where: {
        userId: updated.addresseeId,
        type: FRIEND_NOTIFICATION_TYPES.REQUEST,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: NOTIFICATION_SELECT,
    })

    const existingNotification = candidateNotifications.find((n: any) => {
      const p = n.payload as Record<string, unknown> | null
      return p?.friendshipId === updated.id
    }) ?? candidateNotifications.find((n: any) => n.actorId === updated.requesterId)

    if (existingNotification) {
      const basePayload: Record<string, unknown> = (() => {
        const raw = existingNotification.payload
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          return raw as Record<string, unknown>
        }
        return {}
      })()
      const nextPayload: Record<string, unknown> = {
        ...basePayload,
        friendshipId: updated.id,
        status: 'rejected',
      }
      const refreshed = await prisma.notification.update({
        where: { id: existingNotification.id },
        data: {
          payload: nextPayload as Prisma.InputJsonValue,
          readAt: new Date(),
        },
        select: NOTIFICATION_SELECT,
      })
      await dispatchNotification(refreshed)
    }

    return reply.send({ request: formatFriendRequest(updated, userId) })
  }),
)

app.delete('/friends/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = FriendshipIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const friendship = await prisma.friendship.findUnique({
      where: { id: params.data.id },
    })
    if (!friendship) return reply.code(404).send({ error: 'friendship_not_found' })

    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      return reply.code(403).send({ error: 'not_participant' })
    }

    await prisma.friendship.delete({
      where: { id: friendship.id },
    })

    return reply.send({ success: true })
  }),
)

app.get('/connections', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    try {
      const rows = (await prisma.$queryRaw<ConnectionRow[]>`
        SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
        FROM "Connection"
        WHERE "status" = 'ACCEPTED'
          AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
        ORDER BY COALESCE("respondedAt", "requestedAt") DESC
      `) as ConnectionRow[]

      const counterpartIds = Array.from(
        new Set(rows.map((row: ConnectionRow) => (row.requesterId === userId ? row.addresseeId : row.requesterId))),
      )
      const users: FriendUser[] = counterpartIds.length
        ? await prisma.user.findMany({ where: { id: { in: counterpartIds } }, select: FRIEND_USER_SELECT })
        : []
      const userMap = new Map<string, FriendUser>(users.map((user: FriendUser) => [user.id, user]))

      const items = rows
        .map((row: ConnectionRow) => {
          const counterpartId = row.requesterId === userId ? row.addresseeId : row.requesterId
          const counterpart = userMap.get(counterpartId)
          if (!counterpart) return null
          return {
            id: row.id,
            status: row.status,
            since: row.respondedAt ?? row.requestedAt,
            user: formatFriendUser(counterpart),
          }
        })
        .filter((item: NonNullable<ReturnType<typeof formatFriendship>> | null): item is NonNullable<ReturnType<typeof formatFriendship>> => Boolean(item))

      return reply.send({ items })
    } catch (error) {
      if (isConnectionTableMissingError(error)) return reply.send({ items: [] })
      throw error
    }
  }),
)

app.get('/connections/requests', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    try {
      const rows = (await prisma.$queryRaw<ConnectionRow[]>`
        SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
        FROM "Connection"
        WHERE "status" = 'PENDING'
          AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
        ORDER BY "requestedAt" ASC
      `) as ConnectionRow[]

      const counterpartIds = Array.from(
        new Set(rows.map((row: ConnectionRow) => (row.requesterId === userId ? row.addresseeId : row.requesterId))),
      )
      const users: FriendUser[] = counterpartIds.length
        ? await prisma.user.findMany({ where: { id: { in: counterpartIds } }, select: FRIEND_USER_SELECT })
        : []
      const userMap = new Map<string, FriendUser>(users.map((user: FriendUser) => [user.id, user]))

      const incoming: Array<Record<string, unknown>> = []
      const outgoing: Array<Record<string, unknown>> = []

      for (const row of rows) {
        const direction = row.requesterId === userId ? 'outgoing' : 'incoming'
        const counterpartId = row.requesterId === userId ? row.addresseeId : row.requesterId
        const counterpart = userMap.get(counterpartId)
        if (!counterpart) continue
        const payload = {
          id: row.id,
          status: row.status,
          direction,
          requestedAt: row.requestedAt,
          respondedAt: row.respondedAt ?? null,
          user: formatFriendUser(counterpart),
        }
        if (direction === 'incoming') incoming.push(payload)
        else outgoing.push(payload)
      }

      return reply.send({ incoming, outgoing })
    } catch (error) {
      if (isConnectionTableMissingError(error)) return reply.send({ incoming: [], outgoing: [] })
      throw error
    }
  }),
)

app.post('/connections/requests', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = ConnectionRequestInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const targetUserId = parse.data.userId
    if (targetUserId === userId) return reply.code(400).send({ error: 'cannot_connect_self' })

    const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

    try {
      const existing = await findConnectionBetween(userId, targetUserId)
      if (existing) {
        if (existing.status === 'ACCEPTED') {
          return reply.code(409).send({ error: 'already_connected' })
        }
        if (existing.status === 'PENDING') {
          const direction = existing.requesterId === userId ? 'outgoing' : 'incoming'
          return reply.code(409).send({ error: 'connection_pending', direction })
        }

        const now = new Date()
        await prisma.$executeRaw`
          UPDATE "Connection"
          SET "requesterId" = ${userId},
              "addresseeId" = ${targetUserId},
              "status" = 'PENDING',
              "requestedAt" = ${now},
              "respondedAt" = NULL
          WHERE "id" = ${existing.id}
        `

        await notifyConnectionRequest(existing.id, userId, targetUserId)

        return reply.code(201).send({
          request: {
            id: existing.id,
            status: 'PENDING',
            direction: 'outgoing',
            requestedAt: now,
            respondedAt: null,
          },
        })
      }

      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const now = new Date()
      await prisma.$executeRaw`
        INSERT INTO "Connection" ("id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt")
        VALUES (${id}, ${userId}, ${targetUserId}, 'PENDING', ${now}, NULL)
      `

      await notifyConnectionRequest(id, userId, targetUserId)

      return reply.code(201).send({
        request: {
          id,
          status: 'PENDING',
          direction: 'outgoing',
          requestedAt: now,
          respondedAt: null,
        },
      })
    } catch (error) {
      if (isConnectionTableMissingError(error)) {
        return reply
          .code(503)
          .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
      }
      throw error
    }
  }),
)

app.post('/connections/requests/:id/accept', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = ConnectionIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    try {
      const connection = await findConnectionById(params.data.id)
      if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
      if (connection.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
      if (connection.status !== 'PENDING') return reply.code(409).send({ error: 'connection_not_pending' })

      const now = new Date()
      await prisma.$executeRaw`
        UPDATE "Connection"
        SET "status" = 'ACCEPTED', "respondedAt" = ${now}
        WHERE "id" = ${connection.id}
      `

      await notifyConnectionAcceptance(connection.id, connection.requesterId, connection.addresseeId)

      return reply.send({
        connection: {
          id: connection.id,
          status: 'ACCEPTED',
          since: now,
        },
      })
    } catch (error) {
      if (isConnectionTableMissingError(error)) {
        return reply
          .code(503)
          .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
      }
      throw error
    }
  }),
)

app.post('/connections/requests/:id/reject', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = ConnectionIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    try {
      const connection = await findConnectionById(params.data.id)
      if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
      if (connection.addresseeId !== userId) return reply.code(403).send({ error: 'not_addressee' })
      if (connection.status !== 'PENDING') return reply.code(409).send({ error: 'connection_not_pending' })

      await prisma.$executeRaw`
        UPDATE "Connection"
        SET "status" = 'REJECTED', "respondedAt" = ${new Date()}
        WHERE "id" = ${connection.id}
      `

      return reply.send({ request: { id: connection.id, status: 'REJECTED' } })
    } catch (error) {
      if (isConnectionTableMissingError(error)) {
        return reply
          .code(503)
          .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
      }
      throw error
    }
  }),
)

app.delete('/connections/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = ConnectionIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    try {
      const connection = await findConnectionById(params.data.id)
      if (!connection) return reply.code(404).send({ error: 'connection_not_found' })
      if (connection.requesterId !== userId && connection.addresseeId !== userId) {
        return reply.code(403).send({ error: 'not_participant' })
      }

      await prisma.$executeRaw`DELETE FROM "Connection" WHERE "id" = ${connection.id}`
      return reply.send({ success: true })
    } catch (error) {
      if (isConnectionTableMissingError(error)) {
        return reply
          .code(503)
          .send({ error: 'connections_unavailable', message: 'Connections table is missing. Apply the latest DB migration.' })
      }
      throw error
    }
  }),
)

app.get('/messages/threads', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = MessageThreadListQuery.safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { limit, cursor } = parse.data
    const rows: ThreadSummaryRecord[] = await prisma.messageThread.findMany({
      where: { participants: { some: { userId } }, NOT: { contextType: 'market_listing' } },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: THREAD_SUMMARY_INCLUDE,
    })

    let nextCursor: string | undefined
    if (rows.length > limit) {
      const next = rows.pop()!
      nextCursor = next.id
    }

    return reply.send({
      items: rows.map((thread) => formatThreadSummaryRecord(thread, userId)),
      nextCursor,
    })
  }),
)

app.post('/messages/threads/direct', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CreateDirectThreadInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const targetUserId = parse.data.userId
    if (targetUserId === userId) {
      return reply.code(400).send({ error: 'cannot_message_self' })
    }

    const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

    const friendStatus = await usersAreFriends(userId, targetUserId)
    if (!friendStatus) {
      return reply.code(403).send({ error: 'not_friends' })
    }

    const uniqueKey = buildDirectThreadKey(userId, targetUserId)
    let thread = await prisma.messageThread.findUnique({ where: { uniqueKey }, include: THREAD_SUMMARY_INCLUDE })
    if (!thread) {
      const now = new Date()
      thread = await prisma.messageThread.create({
        data: {
          type: MessageThreadType.direct,
          uniqueKey,
          lastMessageAt: now,
          participants: {
            create: [
              { userId, role: MessageParticipantRole.member, lastReadAt: now, lastActivityAt: now },
              { userId: targetUserId, role: MessageParticipantRole.member, lastActivityAt: now },
            ],
          },
        },
        include: THREAD_SUMMARY_INCLUDE,
      })
    }

    if (!thread) {
      return reply.code(500).send({ error: 'thread_creation_failed' })
    }

    await Promise.all(
      thread.participants
        .filter((participant: ThreadParticipantRecord) => participant.userId !== userId)
        .map((participant: ThreadParticipantRecord) =>
          dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: formatThreadSummaryRecord(thread, participant.userId) },
          }),
        ),
    )

    return reply.send({ thread: formatThreadSummaryRecord(thread, userId) })
  }),
)

app.post('/messages/threads/group', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CreateGroupThreadInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const participantIds: string[] = Array.from(new Set((parse.data.participantIds as string[]).filter((id: string) => id !== userId)))
    if (participantIds.length < 2) {
      return reply.code(400).send({ error: 'group_requires_at_least_two_friends' })
    }

    const friendIdSet = await loadFriendIdSet(userId)
    const hasNonFriend = participantIds.some((id) => !friendIdSet.has(id))
    if (hasNonFriend) {
      return reply.code(403).send({ error: 'group_members_must_be_friends' })
    }

    const users = await prisma.user.findMany({ where: { id: { in: participantIds } }, select: { id: true } })
    const userIdSet = new Set(users.map((row: { id: string }) => row.id))
    if (participantIds.some((id) => !userIdSet.has(id))) {
      return reply.code(404).send({ error: 'user_not_found' })
    }

    const now = new Date()
    const thread = await prisma.messageThread.create({
      data: {
        type: MessageThreadType.group,
        uniqueKey: null,
        lastMessageAt: now,
        participants: {
          create: [
            { userId, role: MessageParticipantRole.admin, lastReadAt: now, lastActivityAt: now },
            ...participantIds.map((id: string) => ({ userId: id, role: MessageParticipantRole.member, lastActivityAt: now })),
          ],
        },
      },
      include: THREAD_SUMMARY_INCLUDE,
    })

    await Promise.all(
      thread.participants
        .filter((participant: ThreadParticipantRecord) => participant.userId !== userId)
        .map((participant: ThreadParticipantRecord) =>
          dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: formatThreadSummaryRecord(thread, participant.userId) },
          }),
        ),
    )

    return reply.code(201).send({ thread: formatThreadSummaryRecord(thread, userId) })
  }),
)

app.get('/messages/threads/:id/candidates', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const thread = await loadThreadForUser(params.data.id, userId)
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
    if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

    const viewerParticipant = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId === userId)
    if (!viewerParticipant || viewerParticipant.role !== MessageParticipantRole.admin) {
      return reply.code(403).send({ error: 'only_owner_can_manage_members' })
    }

    const friendIdSet = await loadFriendIdSet(userId)
    const existingIds = new Set(thread.participants.map((participant: ThreadParticipantRecord) => participant.userId))
    const candidateIds = [...friendIdSet].filter((id) => !existingIds.has(id))
    if (!candidateIds.length) return reply.send({ items: [] })

    const users = await prisma.user.findMany({
      where: { id: { in: candidateIds } },
      select: FRIEND_USER_SELECT,
      orderBy: [{ name: 'asc' }, { handle: 'asc' }],
    })

    return reply.send({ items: users.map((user: FriendUser) => formatFriendUser(user)) })
  }),
)

app.post('/messages/threads/:id/participants', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
    const parse = GroupParticipantInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const thread = await loadThreadForUser(params.data.id, userId)
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
    if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

    const viewerParticipant = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId === userId)
    if (!viewerParticipant || viewerParticipant.role !== MessageParticipantRole.admin) {
      return reply.code(403).send({ error: 'only_owner_can_manage_members' })
    }

    const targetUserId = parse.data.userId
    if (targetUserId === userId) return reply.code(400).send({ error: 'cannot_add_self' })
    if (thread.participants.some((participant: ThreadParticipantRecord) => participant.userId === targetUserId)) {
      const existingThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: THREAD_SUMMARY_INCLUDE })
      if (!existingThread) return reply.code(404).send({ error: 'thread_not_found' })
      return reply.send({ thread: formatThreadSummaryRecord(existingThread, userId) })
    }

    const friendIdSet = await loadFriendIdSet(userId)
    if (!friendIdSet.has(targetUserId)) {
      return reply.code(403).send({ error: 'group_members_must_be_friends' })
    }

    const targetExists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!targetExists) return reply.code(404).send({ error: 'user_not_found' })

    await prisma.messageParticipant.create({
      data: {
        threadId: thread.id,
        userId: targetUserId,
        role: MessageParticipantRole.member,
        lastActivityAt: new Date(),
      },
    })

    const updatedThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: THREAD_SUMMARY_INCLUDE })
    if (!updatedThread) return reply.code(404).send({ error: 'thread_not_found' })

    await Promise.all(
      updatedThread.participants.map((participant: ThreadParticipantRecord) =>
        dispatchRealtimeEvent(participant.userId, {
          type: 'thread.created',
          data: { thread: formatThreadSummaryRecord(updatedThread, participant.userId) },
        }),
      ),
    )

    return reply.send({ thread: formatThreadSummaryRecord(updatedThread, userId) })
  }),
)

app.delete('/messages/threads/:id/participants/:userId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadParticipantParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const thread = await loadThreadForUser(params.data.id, userId)
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
    if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

    const viewerParticipant = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId === userId)
    if (!viewerParticipant || viewerParticipant.role !== MessageParticipantRole.admin) {
      return reply.code(403).send({ error: 'only_owner_can_manage_members' })
    }

    const targetUserId = params.data.userId
    if (targetUserId === userId) return reply.code(400).send({ error: 'owner_cannot_remove_self' })

    const targetParticipant = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId === targetUserId)
    if (!targetParticipant) return reply.code(404).send({ error: 'participant_not_found' })
    if (targetParticipant.role === MessageParticipantRole.admin) {
      return reply.code(400).send({ error: 'cannot_remove_owner' })
    }

    await prisma.messageParticipant.delete({
      where: {
        threadId_userId: {
          threadId: thread.id,
          userId: targetUserId,
        },
      },
    })

    const updatedThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: THREAD_SUMMARY_INCLUDE })
    if (!updatedThread) return reply.code(404).send({ error: 'thread_not_found' })

    await dispatchRealtimeEvent(targetUserId, {
      type: 'thread.removed',
      data: { threadId: thread.id },
    })

    await Promise.all(
      updatedThread.participants.map((participant: ThreadParticipantRecord) =>
        dispatchRealtimeEvent(participant.userId, {
          type: 'thread.created',
          data: { thread: formatThreadSummaryRecord(updatedThread, participant.userId) },
        }),
      ),
    )

    return reply.send({ thread: formatThreadSummaryRecord(updatedThread, userId) })
  }),
)

app.post('/messages/threads/:id/leave', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const thread = await loadThreadForUser(params.data.id, userId)
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
    if (thread.type !== MessageThreadType.group) return reply.code(400).send({ error: 'not_group_thread' })

    const viewerParticipant = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId === userId)
    if (!viewerParticipant) return reply.code(404).send({ error: 'participant_not_found' })
    if (viewerParticipant.role === MessageParticipantRole.admin) {
      return reply.code(400).send({ error: 'owner_cannot_leave' })
    }

    await prisma.messageParticipant.delete({
      where: {
        threadId_userId: {
          threadId: thread.id,
          userId,
        },
      },
    })

    const updatedThread = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: THREAD_SUMMARY_INCLUDE })
    if (updatedThread) {
      await Promise.all(
        updatedThread.participants.map((participant: ThreadParticipantRecord) =>
          dispatchRealtimeEvent(participant.userId, {
            type: 'thread.created',
            data: { thread: formatThreadSummaryRecord(updatedThread, participant.userId) },
          }),
        ),
      )
    }

    await dispatchRealtimeEvent(userId, {
      type: 'thread.removed',
      data: { threadId: thread.id },
    })

    return reply.send({ success: true })
  }),
)

app.get('/messages/threads/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const thread = await loadThreadForUser(params.data.id, userId)
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

    const query = MessageListQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const { rows, nextCursor } = await fetchThreadMessages(thread.id, query.data.limit, query.data.cursor)

    return reply.send({
      thread: formatThreadBase(thread, userId),
      messages: rows.map((message: MessageRecord) => formatMessage(message, userId)),
      nextCursor,
    })
  }),
)

app.get('/messages/threads/:id/messages', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const membership = await prisma.messageParticipant.findUnique({
      where: {
        threadId_userId: {
          threadId: params.data.id,
          userId,
        },
        thread: { NOT: { contextType: 'market_listing' } },
      },
      select: { threadId: true },
    })
    if (!membership) return reply.code(404).send({ error: 'thread_not_found' })

    const query = MessageListQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const { rows, nextCursor } = await fetchThreadMessages(params.data.id, query.data.limit, query.data.cursor)

    return reply.send({
      items: rows.map((message: MessageRecord) => formatMessage(message, userId)),
      nextCursor,
    })
  }),
)

app.post('/messages/threads/:id/messages', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const parse = SendMessageInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const thread = await prisma.messageThread.findFirst({
      where: {
        id: params.data.id,
        NOT: { contextType: 'market_listing' },
        participants: { some: { userId } },
      },
      select: {
        id: true,
        participants: { select: { userId: true, mutedUntil: true } },
      },
    })
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

    const messageRecord = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const normalizedBody = parse.data.body?.trim() ? sanitizePlainText(parse.data.body) : ''
      const created = await tx.message.create({
        data: {
          threadId: thread.id,
          senderId: userId,
          body: normalizedBody ? normalizedBody : null,
          attachments: parse.data.attachments ?? undefined,
          messageType: MessageType.text,
        },
        select: MESSAGE_SELECT,
      })

      await tx.messageThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: created.createdAt },
      })

      await tx.messageParticipant.update({
        where: {
          threadId_userId: {
            threadId: thread.id,
            userId,
          },
        },
        data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
      })

      await tx.messageParticipant.updateMany({
        where: {
          threadId: thread.id,
          userId: { not: userId },
        },
        data: { lastActivityAt: created.createdAt },
      })

      return created
    })

    await Promise.all(
      thread.participants.map((participant: { userId: string }) =>
        dispatchRealtimeEvent(participant.userId, {
          type: 'message.created',
          data: {
            threadId: thread.id,
            message: formatMessage(messageRecord, participant.userId),
          },
        }),
      ),
    )

    void sendMobilePushForMessageCreated({
      threadId: thread.id,
      message: messageRecord,
      participants: thread.participants,
    })

    const bodyPreview = truncatePushBody((messageRecord.body || '').trim(), 90)
    const dedupeSince = new Date(Date.now() - MESSAGE_NOTIFICATION_DEDUPE_WINDOW_MS)
    await Promise.all(
      thread.participants
        .filter((participant: { userId: string }) => participant.userId !== userId)
        .map(async (participant: { userId: string }) => {
          const alreadyNotified = await hasRecentUnreadMessageNotification({
            userId: participant.userId,
            actorId: userId,
            threadId: thread.id,
            since: dedupeSince,
          })
          if (alreadyNotified) return null

          return createNotificationRecord({
            userId: participant.userId,
            actorId: userId,
            type: MESSAGE_NOTIFICATION_TYPES.CREATED,
            payload: {
              threadId: thread.id,
              url: `/messages?thread=${encodeURIComponent(thread.id)}`,
              bodyPreview,
            },
            suppressMobilePush: true,
          })
        }),
    )

    return reply.code(201).send({ message: formatMessage(messageRecord, userId) })
  }),
)

app.get('/messages/unread-count', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const result = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int as count
      FROM "Message" m
      JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
      JOIN "MessageThread" t ON t.id = m."threadId"
      WHERE mp."userId" = ${userId}
      AND m."senderId" != ${userId}
      AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
      AND (t."contextType" IS NULL OR t."contextType" != 'market_listing')
    `
    const count = Number(result[0]?.count || 0)
    return reply.send({ count })
  }),
)

app.post('/messages/threads/:id/read', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MessageThreadIdParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const membership = await prisma.messageParticipant.findUnique({
      where: {
        threadId_userId: {
          threadId: params.data.id,
          userId,
        },
        thread: { NOT: { contextType: 'market_listing' } },
      },
      select: { threadId: true },
    })
    if (!membership) return reply.code(404).send({ error: 'thread_not_found' })

    const parse = ThreadReadInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    let readAt = new Date()
    if (parse.data.messageId) {
      const message = await prisma.message.findUnique({
        where: { id: parse.data.messageId },
        select: { threadId: true, createdAt: true },
      })
      if (!message || message.threadId !== params.data.id) {
        return reply.code(400).send({ error: 'invalid_message' })
      }
      readAt = message.createdAt
    }

    await prisma.messageParticipant.update({
      where: {
        threadId_userId: {
          threadId: params.data.id,
          userId,
        },
      },
      data: { lastReadAt: readAt },
    })

    return reply.send({ lastReadAt: readAt })
  }),
)

app.post('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    return reply.code(410).send({ error: 'person_follow_disabled' })
  }),
)

app.delete('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    return reply.code(410).send({ error: 'person_follow_disabled' })
  }),
)

// Auth: logout (client discards token; endpoint for symmetry)
app.post('/auth/logout', async (_req: FastifyRequest, reply: FastifyReply) => reply.send({ ok: true }))

// Auth: forgot password (no SMTP yet; generate token and return it for manual testing)
app.post('/auth/forgot', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = ForgotPasswordInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { emailOrHandle } = parse.data
  const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrHandle }, { handle: emailOrHandle }] } })
  if (!user) return reply.send({ ok: true })
  const token = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 48)
  const expires = new Date(Date.now() + 60 * 60 * 1000)
  await prisma.user.update({ where: { id: user.id }, data: { resetToken: token, resetExpires: expires } })
  return reply.send({ ok: true, token })
})

// Auth: reset password
app.post('/auth/reset', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = ResetPasswordInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { token, newPassword } = parse.data
  const user = await prisma.user.findFirst({ where: { resetToken: token, resetExpires: { gt: new Date() } } })
  if (!user) return reply.code(400).send({ error: 'invalid_or_expired' })
  const hash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash, resetToken: null, resetExpires: null } })
  return reply.send({ ok: true })
})

// Communitys - provinces list
registerCommunityRoute('get', '/communities/provinces', async (_req: FastifyRequest, reply: FastifyReply) =>
  reply.send({ items: PROVINCES }),
)

// Communitys - list within a province
registerCommunityRoute('get', '/communities', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = z.object({ province: z.string().min(2) }).safeParse(req.query)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const province = normalizeProvinceCode(parse.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })

  const communities = getCommunitiesByProvince(province)
  return reply.send({ items: communities })
})

app.get('/cities', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = z
    .object({
      province: z.string().optional(),
      q: z.string().optional(),
      communitySlug: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    })
    .safeParse(req.query)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { limit, q, communitySlug } = parse.data
  const province = parse.data.province ? normalizeProvinceCode(parse.data.province) : null
  if (parse.data.province && !province) return reply.code(404).send({ error: 'province_not_found' })

  const where: Prisma.CityWhereInput = {}
  if (province) {
    where.provinceCode = province
  }
  if (communitySlug) {
    where.communitySlug = slugifyCommunityName(communitySlug)
  }
  const trimmedQuery = q?.trim()
  if (trimmedQuery) {
    const slugQuery = slugifyCommunityName(trimmedQuery)
    where.OR = [
      { name: { contains: trimmedQuery, mode: 'insensitive' } },
      { slug: { contains: slugQuery, mode: 'insensitive' } },
      { communityName: { contains: trimmedQuery, mode: 'insensitive' } },
    ]
  }

  const cities = await prisma.city.findMany({
    where,
    orderBy: [{ population: 'desc' }, { name: 'asc' }],
    take: limit,
  })

  return reply.send({ items: cities.map((city: CityModel) => formatCitySummary(city)) })
})

app.get('/tax/canada/sales-rates', async (_req: FastifyRequest, reply: FastifyReply) => {
  // NOTE: This is a curated “latest known” dataset that we can update over time.
  // It intentionally avoids calling external services at runtime.
  reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')

  const asOf = '2026-03-02'
  const regions = [
    {
      code: 'AB',
      name: 'Alberta',
      defaultRatePct: 5,
      options: [
        { label: 'Standard — GST 5%', ratePct: 5 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'BC',
      name: 'British Columbia',
      defaultRatePct: 12,
      options: [
        { label: 'Standard — GST 5% + PST 7% (12%)', ratePct: 12 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'MB',
      name: 'Manitoba',
      defaultRatePct: 12,
      options: [
        { label: 'Standard — GST 5% + RST 7% (12%)', ratePct: 12 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'NB',
      name: 'New Brunswick',
      defaultRatePct: 15,
      options: [
        { label: 'Standard — HST 15%', ratePct: 15 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'NL',
      name: 'Newfoundland and Labrador',
      defaultRatePct: 15,
      options: [
        { label: 'Standard — HST 15%', ratePct: 15 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'NS',
      name: 'Nova Scotia',
      defaultRatePct: 15,
      options: [
        { label: 'Standard — HST 15%', ratePct: 15 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'NT',
      name: 'Northwest Territories',
      defaultRatePct: 5,
      options: [
        { label: 'Standard — GST 5%', ratePct: 5 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'NU',
      name: 'Nunavut',
      defaultRatePct: 5,
      options: [
        { label: 'Standard — GST 5%', ratePct: 5 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'ON',
      name: 'Ontario',
      defaultRatePct: 13,
      options: [
        { label: 'Standard — HST 13%', ratePct: 13 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'PE',
      name: 'Prince Edward Island',
      defaultRatePct: 15,
      options: [
        { label: 'Standard — HST 15%', ratePct: 15 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'QC',
      name: 'Quebec',
      defaultRatePct: 14.975,
      options: [
        { label: 'Standard — GST 5% + QST 9.975% (14.975%)', ratePct: 14.975 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'SK',
      name: 'Saskatchewan',
      defaultRatePct: 11,
      options: [
        { label: 'Standard — GST 5% + PST 6% (11%)', ratePct: 11 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
    {
      code: 'YT',
      name: 'Yukon',
      defaultRatePct: 5,
      options: [
        { label: 'Standard — GST 5%', ratePct: 5 },
        { label: 'No tax — 0%', ratePct: 0 },
      ],
    },
  ]

  return reply.send({ asOf, regions })
})

app.get('/communities/:province/:municipality', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z
    .object({
      province: z.string().min(2),
      municipality: z.string().min(1),
    })
    .safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

  const province = normalizeProvinceCode(params.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })

  const municipalitySlug = params.data.municipality.trim().toLowerCase()
  if (!municipalitySlug) return reply.code(404).send({ error: 'community_not_found' })

  reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')

  const city = await prisma.city.findFirst({
    where: { provinceCode: province, slug: municipalitySlug },
    select: {
      provinceCode: true,
      slug: true,
      name: true,
      population: true,
      communitySlug: true,
      communityName: true,
      censusSubdivision: {
        select: {
          slug: true,
          name: true,
          type: true,
          defaultCommunityName: true,
        },
      },
    },
  })

  if (city) {
    return reply.send(buildCommunityPayloadFromCity(city as CityWithSubdivision))
  }

  const subdivision = await prisma.censusSubdivision.findFirst({
    where: { provinceCode: province, slug: municipalitySlug },
    select: {
      slug: true,
      name: true,
      officialName: true,
      type: true,
      population: true,
      defaultCommunityName: true,
      defaultCommunitySlug: true,
      division: {
        select: {
          name: true,
        },
      },
    },
  })

  if (subdivision) {
    return reply.send(buildCommunityPayloadFromSubdivision(subdivision as SubdivisionWithDivision, province))
  }

  return reply.code(404).send({ error: 'community_not_found' })
})

app.get('/communities/:province/:municipality/stats', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z
    .object({
      province: z.string().min(2),
      municipality: z.string().min(1),
    })
    .safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

  const province = normalizeProvinceCode(params.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })

  const municipalitySlug = params.data.municipality.trim().toLowerCase()
  if (!municipalitySlug) return reply.code(404).send({ error: 'community_not_found' })

  const community = findCommunity(province, municipalitySlug)
  if (!community) return reply.code(404).send({ error: 'community_not_found' })

  const [city, subdivision, postsToday, postsThisMonth] = await Promise.all([
    prisma.city.findFirst({
      where: { provinceCode: province, slug: municipalitySlug },
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
    }),
    prisma.censusSubdivision.findFirst({
      where: { provinceCode: province, slug: municipalitySlug },
      select: { population: true },
    }),
    prisma.post.count({
      where: {
        provinceCode: province,
        communitySlug: community.slug,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.post.count({
      where: {
        provinceCode: province,
        communitySlug: community.slug,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
  ])

  const exclude = new Set<string>([buildFollowKey(province, community.slug)])
  const nearby = city
    ? await computeNearbyCommunitySuggestions(city, exclude, 6)
    : await computeGeodataFallbackSuggestions({ provinceCode: province, communitySlug: community.slug }, exclude, 6)

  return reply.send({
    provinceCode: province,
    communitySlug: community.slug,
    members: city?.population ?? subdivision?.population ?? null,
    postsToday,
    postsThisMonth,
    nearbyCommunities: nearby,
  })
})

const CommunityOrgParams = z.object({
  province: z.string().min(2),
  municipality: z.string().min(1),
})

const CommunityOrgSlugParams = CommunityOrgParams.extend({
  slug: z.string().trim().min(3).max(80),
})

const CommunityOrgListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const OrganizationsDirectoryQuery = z.object({
  q: z.string().trim().max(80).optional(),
  type: z
    .enum([
      'LOCAL_BUSINESS',
      'NON_PROFIT',
      'COMMUNITY_GROUP',
      'EDUCATIONAL',
      'RELIGIOUS',
      'GOVERNMENT',
      'ARTS_CULTURE',
      'SPORTS_RECREATION',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const CommunityOrgCreateBody = z.object({
  name: z.string().trim().min(3).max(160),
  slug: z.string().trim().min(1).max(80).optional(),
  type: z
    .enum([
      'LOCAL_BUSINESS',
      'NON_PROFIT',
      'COMMUNITY_GROUP',
      'EDUCATIONAL',
      'RELIGIOUS',
      'GOVERNMENT',
      'ARTS_CULTURE',
      'SPORTS_RECREATION',
    ])
    .optional(),
  description: z.string().trim().max(2000).optional(),
})

const CommunityOrgSettingsBody = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  headline: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(50000).optional().nullable(),
  logoMediaId: z.string().trim().min(3).optional(),
  coverMediaId: z.string().trim().min(3).optional(),
  phone: z.string().trim().min(1).max(50).optional().nullable(),
  websiteUrl: z.string().trim().max(2048).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  schedule: z.string().trim().max(2000).optional().nullable(),
  isPublic: z.boolean().optional(),
})

const CommunityOrgMemberParams = CommunityOrgSlugParams.extend({
  userId: z.string().uuid(),
})

const OrgPermissionValues = [
  'approve_members',
  'remove_members',
  'promote_members',
  'demote_members',
  'create_ranks',
  'view_audit_logs',
  'manage_membership_plans',
  'view_revenue',
  'issue_refunds',
  'create_paid_events',
  'manage_events',
  'manage_sponsors',
  'manage_referrals',
  'award_achievements',
  'create_announcements',
  'pin_posts',
  'moderate_content',
] as const

const OrgJoinModeValues = ['PUBLIC', 'INVITE_ONLY', 'APPLICATION_REQUIRED'] as const
const OrgMembershipStatusValues = ['PENDING', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'BANNED'] as const
const OrgEventCategoryValues = [
  'Business',
  'Food & Drink',
  'Health',
  'Music',
  'Auto, Boat & Air',
  'Charity & Causes',
  'Community',
  'Family & Education',
  'Fashion',
  'Film & Media',
  'Hobbies',
  'Home & Lifestyle',
  'Performing & Visual Arts',
  'Government',
  'Spirituality',
  'School Activities',
  'Science & Tech',
  'Holidays',
  'Sports & Fitness',
  'Travel & Outdoor',
  'Other',
] as const

const CommunityOrgGovernanceRankBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).optional().nullable(),
  permissions: z.array(z.enum(OrgPermissionValues)).min(1).max(24),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  promotionAuthority: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
})

const CommunityOrgMembershipPlanBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(240).optional().nullable(),
    type: z.enum(['FREE', 'ONE_TIME', 'SUBSCRIPTION']),
    amountCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
    currency: z.string().trim().min(3).max(3).default('CAD'),
    interval: z.enum(['monthly', 'yearly']).optional().nullable(),
    rankId: z.string().trim().min(2).max(64).optional().nullable(),
    governanceRights: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.type !== 'FREE' && typeof value.amountCents !== 'number') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountCents'], message: 'amount_cents_required' })
    }
    if (value.type === 'SUBSCRIPTION' && !value.interval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interval'], message: 'interval_required' })
    }
  })

const CommunityOrgSponsorBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    logoUrl: z.string().trim().url().max(2048).optional().nullable(),
    relationshipDescription: z.string().trim().max(500).optional().nullable(),
    tier: z.string().trim().min(2).max(40),
    internalUserId: z.string().trim().min(1).max(120).optional().nullable(),
    externalReference: z.string().trim().max(2048).optional().nullable(),
    linkUrl: z.string().trim().max(2048).optional().nullable(),
    linkLabel: z.string().trim().max(120).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (!value.linkUrl) return
    if (value.linkUrl.startsWith('/')) return

    try {
      const parsed = new URL(value.linkUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linkUrl'], message: 'invalid_url_or_path' })
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linkUrl'], message: 'invalid_url_or_path' })
    }
  })

const EventInviteStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'DECLINED'])

const OrgEventGuestSpeakerTagSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  handle: z.string().trim().min(1).max(80),
  avatarUrl: z.string().trim().url().max(2048).optional().nullable(),
  coverUrl: z.string().trim().url().max(2048).optional().nullable(),
})

const OrgEventSponsorTagSchema = z.object({
  organizationId: z.string().trim().cuid(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  provinceCode: z.string().trim().min(2).max(32),
  communitySlug: z.string().trim().min(1).max(160),
  logoUrl: z.string().trim().url().max(2048).optional().nullable(),
  coverUrl: z.string().trim().url().max(2048).optional().nullable(),
})

const OrgEventFeeSchema = z.object({
  id: z.string().trim().min(2).max(64),
  label: z.string().trim().min(1).max(120),
  amountCents: z.coerce.number().int().min(0).max(100_000_000),
  capacity: z.coerce.number().int().min(1).max(200000).optional().nullable(),
  cashOnly: z.boolean().default(true),
})

const CommunityOrgEventBody = z
  .object({
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().max(5000).optional().nullable(),
    access: z.enum(['PUBLIC', 'RESTRICTED']).default('PUBLIC'),
    eligibleRankIds: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional().nullable(),
    capacity: z.coerce.number().int().min(1).max(200000).optional().nullable(),
    paid: z.boolean().default(false),
    category: z.enum(OrgEventCategoryValues).default('Other'),
    priceCents: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
    currency: z.string().trim().min(3).max(3).default('CAD'),
    guestSpeakers: z.array(z.union([z.string().trim().min(1).max(120), OrgEventGuestSpeakerTagSchema])).max(50).optional(),
    sponsors: z.array(OrgEventSponsorTagSchema).max(30).optional(),
    fees: z.array(OrgEventFeeSchema).max(50).optional(),
    agenda: z.array(z.object({ title: z.string().trim().min(1).max(180), startsAt: z.string().datetime().optional().nullable() })).max(100).optional(),
    attachments: z.array(z.object({ title: z.string().trim().min(1).max(160), url: z.string().trim().url().max(2048) })).max(50).optional(),
    primaryPhotoUrl: z.string().trim().url().max(2048).optional().nullable(),
    galleryPhotoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paid && (typeof value.priceCents !== 'number' || value.priceCents <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceCents'], message: 'price_cents_required_for_paid_event' })
    }
  })

const CommunityOrgEventDraftUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    access: z.enum(['PUBLIC', 'RESTRICTED']).optional(),
    eligibleRankIds: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
    capacity: z.coerce.number().int().min(1).max(200000).optional().nullable(),
    paid: z.boolean().optional(),
    category: z.enum(OrgEventCategoryValues).optional(),
    priceCents: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
    currency: z.string().trim().min(3).max(3).optional(),
    guestSpeakers: z.array(z.union([z.string().trim().min(1).max(120), OrgEventGuestSpeakerTagSchema])).max(50).optional(),
    sponsors: z.array(OrgEventSponsorTagSchema).max(30).optional(),
    fees: z.array(OrgEventFeeSchema).max(50).optional(),
    agenda: z
      .array(z.object({ title: z.string().trim().min(1).max(180), startsAt: z.string().datetime().optional().nullable() }))
      .max(100)
      .optional(),
    attachments: z.array(z.object({ title: z.string().trim().min(1).max(160), url: z.string().trim().url().max(2048) })).max(50).optional(),
    primaryPhotoUrl: z.string().trim().url().max(2048).optional().nullable(),
    galleryPhotoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paid === true && (typeof value.priceCents !== 'number' || value.priceCents <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceCents'], message: 'price_cents_required_for_paid_event' })
    }
  })

const CommunityOrgMemberStatusBody = z.object({
  status: z.enum(OrgMembershipStatusValues),
  rankId: z.string().trim().min(2).max(64).optional().nullable(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
  reason: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgMemberModerationBody = z.object({
  reason: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgGovernanceQuery = z.object({
  cursor: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const CommunityOrgJoinModeBody = z.object({
  joinMode: z.enum(OrgJoinModeValues),
  reason: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgJoinBody = z.object({
  planId: z.string().trim().min(2).max(64).optional().nullable(),
  referredByUserId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgEventParams = CommunityOrgSlugParams.extend({
  eventId: z.string().trim().min(3).max(64),
})

const CommunityOrgAchievementParams = CommunityOrgSlugParams.extend({
  achievementId: z.string().trim().min(3).max(64),
})

const CommunityOrgAchievementBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional().nullable(),
  reputationPoints: z.coerce.number().int().min(0).max(10000).default(0),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
})

const CommunityOrgAchievementAwardBody = z.object({
  userId: z.string().uuid(),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgReferralBody = z.object({
  referrerUserId: z.string().uuid(),
  referredUserId: z.string().uuid(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
})

const CommunityOrgInviteLinkBody = z.object({
  message: z.string().trim().max(280).optional().nullable(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
})

const CommunityOrgInviteUserBody = z.object({
  targetUserId: z.string().uuid(),
  message: z.string().trim().max(280).optional().nullable(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
})

const CommunityOrgInviteResolveBody = z.object({
  deviceId: z.string().trim().min(1).max(120).optional().nullable(),
})

const CommunityOrgReputationAdjustBody = z.object({
  userId: z.string().uuid(),
  delta: z.coerce.number().int().min(-10000).max(10000),
  source: z.string().trim().min(2).max(80),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgEventRsvpBody = z.object({
  status: z.enum(['GOING', 'INTERESTED', 'DECLINED']),
  ticketType: z.enum(['FREE', 'PAID']).optional(),
  ticketId: z.string().trim().min(2).max(64).optional().nullable(),
  message: z.string().trim().max(600).optional().nullable(),
})

const CommunityOrgEconomicsRecordBody = z.object({
  kind: z.enum(['membership', 'event', 'refund', 'manual']),
  amountCents: z.coerce.number().int().min(-100_000_000).max(100_000_000),
  currency: z.string().trim().min(3).max(3).default('CAD'),
  memberUserId: z.string().uuid().optional().nullable(),
  eventId: z.string().trim().min(3).max(64).optional().nullable(),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgChannelCreateBody = z.object({
  name: z.string().trim().min(2).max(80),
  visibility: z.enum(['public', 'private']).default('public'),
})

const CommunityOrgChannelParams = CommunityOrgSlugParams.extend({
  channelId: z.string().cuid(),
})

const CommunityOrgChannelInviteBody = z.object({
  userId: z.string().trim().min(1).max(120),
})

const CommunityOrgChannelNotificationBody = z
  .object({
    muteChannel: z.boolean().optional(),
    mentionsOnly: z.boolean().optional(),
  })
  .refine((value) => typeof value.muteChannel === 'boolean' || typeof value.mentionsOnly === 'boolean', {
    message: 'at_least_one_setting_required',
  })

const CommunityOrgServerNotificationBody = z
  .object({
    muteServer: z.boolean().optional(),
    mentionsOnly: z.boolean().optional(),
  })
  .refine((value) => typeof value.muteServer === 'boolean' || typeof value.mentionsOnly === 'boolean', {
    message: 'at_least_one_setting_required',
  })

const CommunityOrgShopProductCreateBody = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).optional().nullable(),
  catalogId: z.string().trim().min(1).max(120).optional().nullable(),
  featuredHomepage: z.boolean().default(false),
  taxCollect: z.boolean().default(false),
  taxRatesByRegion: z.record(z.string(), z.string()).default({}),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().trim().min(3).max(3).default('CAD'),
  sku: z.string().trim().max(80).optional().nullable(),
  primaryImageUrl: z.string().trim().url().max(2048).optional().nullable(),
  galleryImageUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  fulfillmentType: z.enum(['physical', 'digital']).default('physical'),
  digitalDeliveryUrl: z.string().trim().url().max(2048).optional().nullable(),
  weightGrams: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  shippingPolicy: z.enum(['local_community', 'provincial', 'national']).default('local_community'),
  allowShippingContracts: z.boolean().default(false),
  trackInventory: z.boolean().default(true),
  initialInventory: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

const CommunityOrgShopProductUpdateBody = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  catalogId: z.string().trim().min(1).max(120).optional().nullable(),
  featuredHomepage: z.boolean().optional(),
  taxCollect: z.boolean().optional(),
  taxRatesByRegion: z.record(z.string(), z.string()).optional(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  sku: z.string().trim().max(80).optional().nullable(),
  fulfillmentType: z.enum(['physical', 'digital']).optional(),
  digitalDeliveryUrl: z.string().trim().url().max(2048).optional().nullable(),
  trackInventory: z.boolean().optional(),
  weightGrams: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  shippingPolicy: z.enum(['local_community', 'provincial', 'national']).optional(),
  allowShippingContracts: z.boolean().optional(),
  isDraft: z.boolean().optional(),
})

const CommunityOrgShopSettingsBody = z.object({
  headOfficeAddress: z.string().trim().max(500).optional().nullable(),
  warehouseSameAsHeadOffice: z.boolean().optional(),
  directDepositTransit: z.string().trim().max(20).optional().nullable(),
  directDepositInstitution: z.string().trim().max(20).optional().nullable(),
  directDepositAccount: z.string().trim().max(40).optional().nullable(),
})

const CommunityOrgShopWarehouseCreateBody = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.object({
    line1: z.string().trim().min(2).max(120),
    line2: z.string().trim().max(120).optional().nullable(),
    city: z.string().trim().min(2).max(80),
    province: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().min(2).max(32),
    country: z.string().trim().min(2).max(2).default('CA'),
  }),
})

const CommunityOrgShopCatalogCreateBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(240).optional().nullable(),
  imageUrl: z.string().trim().url().max(2048).optional().nullable(),
  enabled: z.boolean().default(true),
})

const CommunityOrgShopCatalogUpdateBody = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(240).optional().nullable(),
  imageUrl: z.string().trim().url().max(2048).optional().nullable(),
  enabled: z.boolean().optional(),
})

const CommunityOrgShopCatalogReorderBody = z.object({
  catalogIds: z.array(z.string().trim().min(1).max(120)).min(1),
})

const CommunityOrgShopProductParams = CommunityOrgSlugParams.extend({
  productId: z.string().trim().min(1).max(120),
})

const CommunityOrgShopCatalogParams = CommunityOrgSlugParams.extend({
  catalogId: z.string().trim().min(1).max(120),
})

const CommunityOrgShopInventoryUpdateBody = z.object({
  quantities: z.array(z.object({ warehouseId: z.string().trim().min(1).max(120), quantity: z.coerce.number().int().min(0).max(1_000_000) })).min(1),
})

const CommunityOrgShopProductPhotosUpdateBody = z.object({
  primaryImageUrl: z.string().trim().url().max(2048).optional().nullable(),
  galleryImageUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
})

const ORG_CHANNEL_CONTEXT_TYPE = 'organization_channel'
const MARKET_LISTING_CHAT_CONTEXT_TYPE = 'market_listing'

function slugifyChannelName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function buildOrgChannelContextId(orgId: string, visibility: 'public' | 'private', slug: string, name: string) {
  return `${orgId}|${visibility}|${slug}|${encodeURIComponent(name)}`
}

function parseOrgChannelContextId(contextId: string | null | undefined): null | {
  orgId: string
  visibility: 'public' | 'private'
  slug: string
  name: string
} {
  if (!contextId) return null
  const [orgId, visibilityRaw, slug, encodedName] = contextId.split('|')
  if (!orgId || !visibilityRaw || !slug || !encodedName) return null
  const visibility = visibilityRaw === 'private' ? 'private' : visibilityRaw === 'public' ? 'public' : null
  if (!visibility) return null
  return {
    orgId,
    visibility,
    slug,
    name: decodeURIComponent(encodedName),
  }
}

function buildMarketListingDirectThreadKey(listingId: string, userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort()
  return `marketlisting:${listingId}:${a}:${b}`
}

type OrgChatPrefs = {
  muteServer?: boolean
  mentionsOnly?: boolean
  channels?: Record<string, { muteChannel?: boolean; mentionsOnly?: boolean }>
}

let organizationShopTablesReady: Promise<void> | null = null
let citizenMarketplaceTablesReady: Promise<void> | null = null

function ensureOrganizationShopTables() {
  if (organizationShopTablesReady) return organizationShopTablesReady
  organizationShopTablesReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_settings (
          business_id TEXT PRIMARY KEY REFERENCES "Business"(id) ON DELETE CASCADE,
          head_office_address TEXT,
          warehouse_same_as_head_office BOOLEAN NOT NULL DEFAULT TRUE,
          direct_deposit_transit TEXT,
          direct_deposit_institution TEXT,
          direct_deposit_account TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_warehouse (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        address TEXT,
        is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_catalog (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_catalog
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_product (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
        catalog_id TEXT REFERENCES organization_shop_catalog(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT,
        price_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CAD',
        sku TEXT,
        primary_image_url TEXT,
        gallery_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        weight_grams INTEGER,
        shipping_policy TEXT NOT NULL DEFAULT 'local_community',
        allow_shipping_contracts BOOLEAN NOT NULL DEFAULT FALSE,
        is_draft BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
        created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_inventory (
        product_id TEXT NOT NULL REFERENCES organization_shop_product(id) ON DELETE CASCADE,
        warehouse_id TEXT NOT NULL REFERENCES organization_shop_warehouse(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, warehouse_id)
      );
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_order (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
        buyer_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        currency TEXT NOT NULL DEFAULT 'CAD',
        subtotal_cents INTEGER NOT NULL,
        fee_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        shipping_address JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_order
      ADD COLUMN IF NOT EXISTS buyer_user_id TEXT;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_order
      ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER NOT NULL DEFAULT 0;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_order
      ADD COLUMN IF NOT EXISTS fee_cents INTEGER NOT NULL DEFAULT 0;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_order
      ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0;
    `)

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'organization_shop_order_buyer_user_id_fkey'
        ) THEN
          ALTER TABLE organization_shop_order
          ADD CONSTRAINT organization_shop_order_buyer_user_id_fkey
          FOREIGN KEY (buyer_user_id)
          REFERENCES "User"(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_order_item (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES organization_shop_order(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES organization_shop_product(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        fulfillment_type TEXT NOT NULL DEFAULT 'physical',
        digital_delivery_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS organization_shop_payment (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES organization_shop_order(id) ON DELETE CASCADE,
        stripe_payment_intent_id TEXT,
        status TEXT NOT NULL DEFAULT 'requires_payment_method',
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CAD',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_warehouse_business_id_idx
      ON organization_shop_warehouse (business_id);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_catalog_business_id_idx
      ON organization_shop_catalog (business_id, created_at DESC);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_catalog_business_sort_idx
      ON organization_shop_catalog (business_id, sort_order ASC, created_at ASC);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_product_business_id_idx
      ON organization_shop_product (business_id, created_at DESC);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_order_business_id_idx
      ON organization_shop_order (business_id, created_at DESC);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_order_buyer_id_idx
      ON organization_shop_order (buyer_user_id, created_at DESC);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_order_item_order_id_idx
      ON organization_shop_order_item (order_id);
    `)

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS organization_shop_payment_stripe_pi_id_uniq
      ON organization_shop_payment (stripe_payment_intent_id);
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS primary_image_url TEXT;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS gallery_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS weight_grams INTEGER;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS shipping_policy TEXT NOT NULL DEFAULT 'local_community';
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS allow_shipping_contracts BOOLEAN NOT NULL DEFAULT FALSE;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS featured_homepage BOOLEAN NOT NULL DEFAULT FALSE;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS tax_collect BOOLEAN NOT NULL DEFAULT FALSE;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS tax_rates_by_region JSONB NOT NULL DEFAULT '{}'::jsonb;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'physical';
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS digital_delivery_url TEXT;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS catalog_id TEXT;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_product
      ADD COLUMN IF NOT EXISTS created_by TEXT;
    `)

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'organization_shop_product_created_by_fkey'
        ) THEN
          ALTER TABLE organization_shop_product
          ADD CONSTRAINT organization_shop_product_created_by_fkey
          FOREIGN KEY (created_by)
          REFERENCES "User"(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `)

    await prisma.$executeRawUnsafe(`
      ALTER TABLE organization_shop_catalog
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
    `)

    await prisma.$executeRawUnsafe(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at ASC, id ASC) - 1 AS next_order
        FROM organization_shop_catalog
      )
      UPDATE organization_shop_catalog c
      SET sort_order = ranked.next_order
      FROM ranked
      WHERE c.id = ranked.id
        AND c.sort_order = 0
        AND ranked.next_order > 0;
    `)

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'organization_shop_product_catalog_id_fkey'
        ) THEN
          ALTER TABLE organization_shop_product
          ADD CONSTRAINT organization_shop_product_catalog_id_fkey
          FOREIGN KEY (catalog_id)
          REFERENCES organization_shop_catalog(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS organization_shop_product_catalog_id_idx
      ON organization_shop_product (catalog_id);
    `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_inventory_warehouse_id_idx
        ON organization_shop_inventory (warehouse_id);
      `)
    } catch (err) {
      organizationShopTablesReady = null
      throw err
    }
  })()
  return organizationShopTablesReady
}

function ensureCitizenMarketplaceTables() {
  if (citizenMarketplaceTablesReady) return citizenMarketplaceTablesReady
  citizenMarketplaceTablesReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_market_listing (
          id TEXT PRIMARY KEY,
          seller_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'Draft Listing',
          description TEXT,
          price_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'CAD',
          photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          pickup_city TEXT,
          pickup_province TEXT,
          pickup_address_line1 TEXT,
          pickup_address_line2 TEXT,
          pickup_postal_code TEXT,
          listing_province_code TEXT,
          listing_community_slug TEXT,
          payment_types JSONB NOT NULL DEFAULT '[]'::jsonb,
          willing_to_deliver BOOLEAN NOT NULL DEFAULT FALSE,
          delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb,
          e_transfer_email TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          selected_buyer_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          sale_expires_at TIMESTAMPTZ,
          is_draft BOOLEAN NOT NULL DEFAULT TRUE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_seller_idx
        ON citizen_market_listing (seller_user_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_status_idx
        ON citizen_market_listing (status, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_selected_buyer_idx
        ON citizen_market_listing (selected_buyer_user_id);
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_province_code TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_community_slug TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_scope_idx
        ON citizen_market_listing (listing_province_code, listing_community_slug, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_market_chat_interest (
          thread_id TEXT NOT NULL REFERENCES "MessageThread"(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          interested BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (thread_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_chat_interest_user_idx
        ON citizen_market_chat_interest (user_id, updated_at DESC);
      `)
    } catch (err) {
      citizenMarketplaceTablesReady = null
      throw err
    }
  })()

  return citizenMarketplaceTablesReady
}

function readOrgChatPrefs(meta: unknown, orgId: string): OrgChatPrefs {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const typed = meta as Record<string, unknown>
  const orgChatPrefs = typed.orgChatPrefs
  if (!orgChatPrefs || typeof orgChatPrefs !== 'object' || Array.isArray(orgChatPrefs)) return {}
  const perOrg = (orgChatPrefs as Record<string, unknown>)[orgId]
  if (!perOrg || typeof perOrg !== 'object' || Array.isArray(perOrg)) return {}
  return perOrg as OrgChatPrefs
}

type CommunityOrgRecord = {
  id: string
  ownerId: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
  type: BusinessType
  description: string | null
  phone?: string | null
  websiteUrl?: string | null
  address?: string | null
  schedule?: string | null
  status: BusinessStatus
  isVerified: boolean
  logoUrl?: string | null
  coverUrl?: string | null
  metadata?: unknown
  createdAt: Date
  updatedAt: Date
  _count?: { follows?: number }
}

function readOrganizationHeadline(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).headline
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 60) : null
}

type OrganizationShopPaymentsState = {
  stripeConnectAccountId: string | null
}

function readOrganizationShopPaymentsState(metadata: unknown): OrganizationShopPaymentsState {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { stripeConnectAccountId: null }
  }
  const shop = (metadata as Record<string, unknown>).shop
  if (!shop || typeof shop !== 'object' || Array.isArray(shop)) {
    return { stripeConnectAccountId: null }
  }

  const raw = (shop as Record<string, unknown>).stripeConnectAccountId
  return {
    stripeConnectAccountId: typeof raw === 'string' && raw.trim().length ? raw.trim() : null,
  }
}

function mergeOrganizationShopPaymentsStateIntoMetadata(metadata: unknown, next: Partial<OrganizationShopPaymentsState>): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  const existingShop = base.shop && typeof base.shop === 'object' && !Array.isArray(base.shop) ? ({ ...(base.shop as Record<string, unknown>) } as Record<string, unknown>) : {}
  if (typeof next.stripeConnectAccountId === 'string' || next.stripeConnectAccountId === null) {
    existingShop.stripeConnectAccountId = next.stripeConnectAccountId
  }
  base.shop = existingShop
  return base as Prisma.InputJsonValue
}

function buildCommunityOrgPayload(org: CommunityOrgRecord, viewerFollowed: boolean, viewerRole: 'OWNER' | 'MANAGER' | null = null) {
  return {
    id: org.id,
    ownerId: org.ownerId,
    provinceCode: org.provinceCode,
    communitySlug: org.communitySlug,
    name: org.name,
    headline: readOrganizationHeadline(org.metadata),
    slug: org.slug,
    type: org.type,
    description: org.description ? sanitizePlainText(org.description) : null,
    phone: org.phone ?? null,
    websiteUrl: org.websiteUrl ?? null,
    address: org.address ?? null,
    schedule: org.schedule ?? null,
    status: org.status,
    isVerified: org.isVerified,
    logoUrl: org.logoUrl ?? null,
    coverUrl: org.coverUrl ?? null,
    followerCount: org._count?.follows ?? 0,
    viewerFollowed,
    viewerRole,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  }
}

type OrgPermission = (typeof OrgPermissionValues)[number]
type OrgJoinMode = (typeof OrgJoinModeValues)[number]
type OrgMembershipStatus = (typeof OrgMembershipStatusValues)[number]

type OrgRankDefinition = {
  id: string
  name: string
  description: string | null
  permissions: OrgPermission[]
  promotionAuthority: string[]
  visibility: 'PUBLIC' | 'PRIVATE'
  system?: boolean
}

type OrgPlanDefinition = {
  id: string
  name: string
  description: string | null
  type: 'FREE' | 'ONE_TIME' | 'SUBSCRIPTION'
  amountCents: number
  currency: string
  interval: 'monthly' | 'yearly' | null
  rankId: string | null
  governanceRights: boolean
  createdAt: string
}

type OrgSponsorDefinition = {
  id: string
  name: string
  logoUrl: string | null
  relationshipDescription: string | null
  tier: string
  internalUserId: string | null
  externalReference: string | null
  linkUrl?: string | null
  linkLabel?: string | null
  createdAt: string
}

type OrgEventSponsorTag = {
  organizationId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
}

type OrgEventGuestSpeakerTag = {
  userId: string
  name: string
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
}

type OrgEventGuestSpeakerInvite = OrgEventGuestSpeakerTag & {
  status: z.infer<typeof EventInviteStatusSchema>
  invitedAt: string
  respondedAt: string | null
  respondedByUserId: string | null
}

type OrgEventFee = z.infer<typeof OrgEventFeeSchema>

type OrgEventSponsorInvite = OrgEventSponsorTag & {
  status: z.infer<typeof EventInviteStatusSchema>
  invitedAt: string
  respondedAt: string | null
  respondedByUserId: string | null
  recipientUserIds: string[]
}

function normalizeEventSponsorTags(input: Array<z.infer<typeof OrgEventSponsorTagSchema>> | undefined): OrgEventSponsorTag[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => ({
    organizationId: item.organizationId,
    name: item.name,
    slug: item.slug,
    provinceCode: item.provinceCode,
    communitySlug: item.communitySlug,
    logoUrl: item.logoUrl ?? null,
    coverUrl: item.coverUrl ?? null,
  }))
}

function normalizeGuestSpeakerInput(
  input: Array<string | z.infer<typeof OrgEventGuestSpeakerTagSchema>> | undefined,
): { guestSpeakers: string[]; guestSpeakerTags: OrgEventGuestSpeakerTag[] } {
  if (!Array.isArray(input)) return { guestSpeakers: [], guestSpeakerTags: [] }

  const names: string[] = []
  const nameSeen = new Set<string>()
  const tags: OrgEventGuestSpeakerTag[] = []
  const tagSeen = new Set<string>()

  for (const item of input) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (nameSeen.has(key)) continue
      nameSeen.add(key)
      names.push(trimmed)
      continue
    }

    const userId = item.userId.trim()
    if (!userId || tagSeen.has(userId)) continue
    tagSeen.add(userId)

    const displayName = item.name.trim() || item.handle.trim()
    if (displayName) {
      const key = displayName.toLowerCase()
      if (!nameSeen.has(key)) {
        nameSeen.add(key)
        names.push(displayName)
      }
    }

    tags.push({
      userId,
      name: displayName,
      handle: item.handle.trim(),
      avatarUrl: item.avatarUrl ?? null,
      coverUrl: item.coverUrl ?? null,
    })
  }

  return { guestSpeakers: names, guestSpeakerTags: tags }
}

type OrgEventDefinition = {
  id: string
  title: string
  description: string | null
  category?: (typeof OrgEventCategoryValues)[number]
  access: 'PUBLIC' | 'RESTRICTED'
  eligibleRankIds: string[]
  startsAt: string
  endsAt: string | null
  capacity: number | null
  paid: boolean
  priceCents: number | null
  currency: string
  guestSpeakers: string[]
  guestSpeakerInvites: OrgEventGuestSpeakerInvite[]
  sponsors: OrgEventSponsorTag[]
  sponsorInvites: OrgEventSponsorInvite[]
  fees: OrgEventFee[]
  primaryPhotoUrl: string | null
  galleryPhotoUrls: string[]
  agenda: Array<{ title: string; startsAt: string | null }>
  attachments: Array<{ title: string; url: string }>
  status?: 'DRAFT' | 'PUBLISHED'
  createdAt: string
  updatedAt?: string
}

type OrgAchievementDefinition = {
  id: string
  title: string
  description: string | null
  reputationPoints: number
  visibility: 'PUBLIC' | 'PRIVATE'
  createdAt: string
}

type OrgAchievementAward = {
  id: string
  achievementId: string
  userId: string
  awardedByUserId: string
  note: string | null
  createdAt: string
}

type OrgReferralRecord = {
  id: string
  referrerUserId: string
  referredUserId: string
  planId: string | null
  createdAt: string
}

type OrgInviteLinkRecord = {
  id: string
  token: string
  createdByUserId: string
  message: string | null
  planId: string | null
  createdAt: string
  viewCount: number
  registrationCount: number
  joinCount: number
  lastViewedAt: string | null
  lastRegisteredAt: string | null
  lastJoinedAt: string | null
}

type OrgReputationEntry = {
  id: string
  userId: string
  delta: number
  source: string
  sourceRefId: string | null
  note: string | null
  createdAt: string
}

type OrgEventRsvp = {
  id: string
  eventId: string
  userId: string
  status: 'GOING' | 'INTERESTED' | 'DECLINED'
  ticketType: 'FREE' | 'PAID'
  ticketId: string | null
  ticketLabel: string | null
  amountCents: number | null
  message: string | null
  createdAt: string
  updatedAt: string
}

type OrgEconomicRecord = {
  id: string
  kind: 'membership' | 'event' | 'refund' | 'manual'
  amountCents: number
  currency: string
  memberUserId: string | null
  eventId: string | null
  note: string | null
  createdAt: string
}

type OrgMemberState = {
  rankId: string
  planId: string | null
  status: OrgMembershipStatus
  referredByUserId: string | null
  reputation: number
  updatedAt: string
}

type OrgAuditLogEntry = {
  id: string
  actorUserId: string
  action: string
  createdAt: string
  reason: string | null
  previousValue: unknown
  nextValue: unknown
}

type OrganizationSystemState = {
  version: 1
  joinMode: OrgJoinMode
  ranks: OrgRankDefinition[]
  plans: OrgPlanDefinition[]
  sponsors: OrgSponsorDefinition[]
  events: OrgEventDefinition[]
  achievements: OrgAchievementDefinition[]
  achievementAwards: OrgAchievementAward[]
  referrals: OrgReferralRecord[]
  inviteLinks: OrgInviteLinkRecord[]
  reputationLedger: OrgReputationEntry[]
  eventRsvps: OrgEventRsvp[]
  economics: OrgEconomicRecord[]
  members: Record<string, OrgMemberState>
  auditLog: OrgAuditLogEntry[]
}

const SYSTEM_OWNER_RANK_ID = 'system_owner'
const SYSTEM_MANAGER_RANK_ID = 'system_manager'
const SYSTEM_ROLE_MANAGER_RANK_ID = 'system_role_manager'
const SYSTEM_EVENT_MANAGER_RANK_ID = 'system_event_manager'
const SYSTEM_SHOP_MANAGER_RANK_ID = 'system_shop_manager'
const SYSTEM_MEMBER_RANK_ID = 'system_member'
const ORG_AUDIT_LOG_LIMIT = 1000
const ORG_SIGNUP_REPUTATION_POINTS = 100

const DEFAULT_MANAGER_PERMISSIONS: OrgPermission[] = [
  ...OrgPermissionValues,
]

const DEFAULT_ROLE_MANAGER_PERMISSIONS: OrgPermission[] = [
  'approve_members',
  'remove_members',
  'promote_members',
  'demote_members',
  'view_audit_logs',
  'manage_membership_plans',
  'manage_events',
  'manage_sponsors',
  'manage_referrals',
  'award_achievements',
  'create_announcements',
  'pin_posts',
  'moderate_content',
]

const DEFAULT_EVENT_MANAGER_PERMISSIONS: OrgPermission[] = [
  'manage_events',
  'create_paid_events',
  'create_announcements',
  'pin_posts',
  'moderate_content',
]

const DEFAULT_SHOP_MANAGER_PERMISSIONS: OrgPermission[] = [
  'view_revenue',
  'issue_refunds',
]

function buildDefaultOrganizationRanks(): OrgRankDefinition[] {
  return [
    {
      id: SYSTEM_OWNER_RANK_ID,
      name: 'Owner',
      description: 'Organization owner with full control.',
      permissions: [...OrgPermissionValues],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID],
      visibility: 'PRIVATE',
      system: true,
    },
    {
      id: SYSTEM_MANAGER_RANK_ID,
      name: 'Admin',
      description: 'Organization admins with elevated access.',
      permissions: [...OrgPermissionValues],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_ROLE_MANAGER_RANK_ID,
      name: 'Manager',
      description: 'General-purpose manager role.',
      permissions: [...DEFAULT_ROLE_MANAGER_PERMISSIONS],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_EVENT_MANAGER_RANK_ID,
      name: 'Event Manager',
      description: 'Manage events and event announcements.',
      permissions: [...DEFAULT_EVENT_MANAGER_PERMISSIONS],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID, SYSTEM_ROLE_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_SHOP_MANAGER_RANK_ID,
      name: 'Shop Manager',
      description: 'Manage organization commerce and financial reconciliation.',
      permissions: [...DEFAULT_SHOP_MANAGER_PERMISSIONS],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID, SYSTEM_ROLE_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_MEMBER_RANK_ID,
      name: 'Member',
      description: 'Standard organization member.',
      permissions: [],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
  ]
}

function readOrganizationSystemState(metadata: unknown): OrganizationSystemState {
  const fallback: OrganizationSystemState = {
    version: 1,
    joinMode: 'PUBLIC',
    ranks: buildDefaultOrganizationRanks(),
    plans: [],
    sponsors: [],
    events: [],
    achievements: [],
    achievementAwards: [],
    referrals: [],
    inviteLinks: [],
    reputationLedger: [],
    eventRsvps: [],
    economics: [],
    members: {},
    auditLog: [],
  }

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fallback
  const root = metadata as Record<string, unknown>
  const raw = root.orgSystem
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback

  const typed = raw as Partial<OrganizationSystemState>
  const ranks = Array.isArray(typed.ranks)
    ? (typed.ranks.filter((rank): rank is OrgRankDefinition => Boolean(rank && typeof rank === 'object' && (rank as any).id && (rank as any).name)) as OrgRankDefinition[])
    : []

  const defaultRanks = buildDefaultOrganizationRanks()
  const defaultSystemIds = new Set(defaultRanks.filter((r) => r.system).map((r) => r.id))
  const mergedRanks: OrgRankDefinition[] = [...defaultRanks]

  for (const rank of ranks) {
    if (defaultSystemIds.has(rank.id)) {
      // Keep system ranks canonical (names/permissions) even if old metadata has drifted.
      continue
    }
    if (!mergedRanks.some((existing) => existing.id === rank.id)) mergedRanks.push(rank)
  }

  return {
    version: 1,
    joinMode: typed.joinMode && OrgJoinModeValues.includes(typed.joinMode) ? typed.joinMode : 'PUBLIC',
    ranks: mergedRanks,
    plans: Array.isArray(typed.plans) ? (typed.plans as OrgPlanDefinition[]) : [],
    sponsors: Array.isArray(typed.sponsors) ? (typed.sponsors as OrgSponsorDefinition[]) : [],
    events: Array.isArray(typed.events)
      ? (typed.events as OrgEventDefinition[]).map((event) => ({
          ...event,
          guestSpeakerInvites: Array.isArray((event as Partial<OrgEventDefinition>).guestSpeakerInvites)
            ? ((event as Partial<OrgEventDefinition>).guestSpeakerInvites as OrgEventGuestSpeakerInvite[])
            : [],
          sponsors: Array.isArray((event as Partial<OrgEventDefinition>).sponsors)
            ? ((event as Partial<OrgEventDefinition>).sponsors as OrgEventSponsorTag[])
            : [],
          sponsorInvites: Array.isArray((event as Partial<OrgEventDefinition>).sponsorInvites)
            ? ((event as Partial<OrgEventDefinition>).sponsorInvites as OrgEventSponsorInvite[])
            : [],
          fees: Array.isArray((event as Partial<OrgEventDefinition>).fees)
            ? ((event as Partial<OrgEventDefinition>).fees as OrgEventFee[])
            : [],
        }))
      : [],
    achievements: Array.isArray(typed.achievements) ? (typed.achievements as OrgAchievementDefinition[]) : [],
    achievementAwards: Array.isArray(typed.achievementAwards) ? (typed.achievementAwards as OrgAchievementAward[]) : [],
    referrals: Array.isArray(typed.referrals) ? (typed.referrals as OrgReferralRecord[]) : [],
    inviteLinks: Array.isArray((typed as any).inviteLinks)
      ? ((typed as any).inviteLinks as OrgInviteLinkRecord[]).map((row) => ({
          id: row.id,
          token: row.token,
          createdByUserId: row.createdByUserId,
          message: row.message ?? null,
          planId: row.planId ?? null,
          createdAt: row.createdAt,
          viewCount: Number.isFinite(row.viewCount) ? row.viewCount : 0,
          registrationCount: Number.isFinite(row.registrationCount) ? row.registrationCount : 0,
          joinCount: Number.isFinite(row.joinCount) ? row.joinCount : 0,
          lastViewedAt: row.lastViewedAt ?? null,
          lastRegisteredAt: row.lastRegisteredAt ?? null,
          lastJoinedAt: row.lastJoinedAt ?? null,
        }))
      : [],
    reputationLedger: Array.isArray(typed.reputationLedger) ? (typed.reputationLedger as OrgReputationEntry[]) : [],
    eventRsvps: Array.isArray(typed.eventRsvps)
      ? (typed.eventRsvps as OrgEventRsvp[]).map((row) => ({
          ...row,
          ticketId: row.ticketId ?? null,
          ticketLabel: row.ticketLabel ?? null,
          amountCents: typeof row.amountCents === 'number' ? row.amountCents : null,
          message: row.message ?? null,
          updatedAt: row.updatedAt ?? row.createdAt,
        }))
      : [],
    economics: Array.isArray(typed.economics) ? (typed.economics as OrgEconomicRecord[]) : [],
    members: typed.members && typeof typed.members === 'object' && !Array.isArray(typed.members) ? (typed.members as Record<string, OrgMemberState>) : {},
    auditLog: Array.isArray(typed.auditLog) ? (typed.auditLog as OrgAuditLogEntry[]) : [],
  }
}

function mergeOrganizationSystemStateIntoMetadata(metadata: unknown, system: OrganizationSystemState): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  base.orgSystem = system as unknown as Prisma.InputJsonValue
  return base as Prisma.InputJsonValue
}

function resolveOrganizationPermissions({
  org,
  role,
  system,
  userId,
}: {
  org: Pick<CommunityOrgRecord, 'ownerId'>
  role: 'OWNER' | 'MANAGER' | null
  system: OrganizationSystemState
  userId: string | null
}): OrgPermission[] {
  if (!userId) return []
  if (org.ownerId === userId || role === 'OWNER') return [...OrgPermissionValues]

  const memberState = userId ? system.members[userId] : undefined
  if (memberState?.rankId) {
    const rank = system.ranks.find((entry) => entry.id === memberState.rankId)
    if (rank?.permissions?.length) return rank.permissions
  }

  if (role === 'MANAGER') return DEFAULT_MANAGER_PERMISSIONS
  return []
}

function canOrganizationPermission(permissions: OrgPermission[], permission: OrgPermission) {
  return permissions.includes(permission)
}

function buildGuestSpeakerInvites(args: {
  previous: OrgEventGuestSpeakerInvite[]
  selectedTags: OrgEventGuestSpeakerTag[]
  nowIso: string
}) {
  const previousByUserId = new Map(args.previous.map((invite) => [invite.userId, invite]))
  const nextInvites: OrgEventGuestSpeakerInvite[] = []
  const newlyInvited: OrgEventGuestSpeakerInvite[] = []

  for (const tag of args.selectedTags) {
    const existing = previousByUserId.get(tag.userId)
    if (existing) {
      nextInvites.push({
        ...existing,
        name: tag.name,
        handle: tag.handle,
        avatarUrl: tag.avatarUrl,
        coverUrl: tag.coverUrl,
      })
      continue
    }
    const created: OrgEventGuestSpeakerInvite = {
      ...tag,
      status: 'PENDING',
      invitedAt: args.nowIso,
      respondedAt: null,
      respondedByUserId: null,
    }
    nextInvites.push(created)
    newlyInvited.push(created)
  }

  return { nextInvites, newlyInvited }
}

async function resolveOrganizationAdminAndManagerIds(orgIds: string[]) {
  const uniqueIds = Array.from(new Set(orgIds.filter(Boolean)))
  if (!uniqueIds.length) return new Map<string, string[]>()

  const [orgRows, managerRows] = await Promise.all([
    prisma.business.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, ownerId: true },
    }),
    prisma.businessMembership.findMany({
      where: {
        businessId: { in: uniqueIds },
        role: { in: ['OWNER', 'MANAGER'] },
      },
      select: { businessId: true, userId: true },
    }),
  ])

  const recipientMap = new Map<string, Set<string>>()
  for (const org of orgRows) {
    if (!recipientMap.has(org.id)) recipientMap.set(org.id, new Set<string>())
    recipientMap.get(org.id)!.add(org.ownerId)
  }

  for (const row of managerRows) {
    if (!recipientMap.has(row.businessId)) recipientMap.set(row.businessId, new Set<string>())
    recipientMap.get(row.businessId)!.add(row.userId)
  }

  const result = new Map<string, string[]>()
  for (const [orgId, userIds] of recipientMap.entries()) {
    result.set(orgId, [...userIds])
  }
  return result
}

function buildSponsorInvites(args: {
  previous: OrgEventSponsorInvite[]
  selectedSponsors: OrgEventSponsorTag[]
  recipientMap: Map<string, string[]>
  nowIso: string
}) {
  const previousByOrgId = new Map(args.previous.map((invite) => [invite.organizationId, invite]))
  const nextInvites: OrgEventSponsorInvite[] = []
  const newlyInvited: OrgEventSponsorInvite[] = []

  for (const sponsor of args.selectedSponsors) {
    const existing = previousByOrgId.get(sponsor.organizationId)
    if (existing) {
      nextInvites.push({
        ...existing,
        name: sponsor.name,
        slug: sponsor.slug,
        provinceCode: sponsor.provinceCode,
        communitySlug: sponsor.communitySlug,
        logoUrl: sponsor.logoUrl,
        coverUrl: sponsor.coverUrl,
      })
      continue
    }
    const created: OrgEventSponsorInvite = {
      ...sponsor,
      status: 'PENDING',
      invitedAt: args.nowIso,
      respondedAt: null,
      respondedByUserId: null,
      recipientUserIds: args.recipientMap.get(sponsor.organizationId) ?? [],
    }
    nextInvites.push(created)
    newlyInvited.push(created)
  }

  return { nextInvites, newlyInvited }
}

async function appendOrganizationAuditLogEntry(
  dbClient: Prisma.TransactionClient | typeof prisma,
  orgId: string,
  entry: Omit<OrgAuditLogEntry, 'id' | 'createdAt'>,
) {
  const row = await dbClient.business.findUnique({ where: { id: orgId }, select: { metadata: true } })
  if (!row) return

  const system = readOrganizationSystemState(row.metadata)
  const nextEntry: OrgAuditLogEntry = {
    id: randomUUID(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    reason: entry.reason ?? null,
    previousValue: entry.previousValue ?? null,
    nextValue: entry.nextValue ?? null,
    createdAt: new Date().toISOString(),
  }
  const nextAuditLog = [...system.auditLog, nextEntry].slice(-ORG_AUDIT_LOG_LIMIT)
  const nextSystem: OrganizationSystemState = {
    ...system,
    auditLog: nextAuditLog,
  }

  await dbClient.business.update({
    where: { id: orgId },
    data: { metadata: mergeOrganizationSystemStateIntoMetadata(row.metadata, nextSystem) },
    select: { id: true },
  })
}

async function ensureUniqueCommunityOrgSlug({
  provinceCode,
  communitySlug,
  baseSlug,
}: {
  provinceCode: string
  communitySlug: string
  baseSlug: string
}) {
  const base = trimSlugLength(baseSlug, 80) || 'organization'
  let candidate = base
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await prisma.business.findFirst({
      where: { provinceCode, communitySlug, slug: candidate },
      select: { id: true },
    })
    if (!existing) return candidate

    const suffix = randomNumericSlugSuffix()
    candidate = trimSlugLength(`${base}-${suffix}`, 80) || `organization-${suffix}`
  }

  const suffix = randomNumericSlugSuffix()
  return trimSlugLength(`${base}-${suffix}`, 80) || `organization-${suffix}`
}

async function generateUniqueCommunityOrgSlug({
  provinceCode,
  communitySlug,
  name,
}: {
  provinceCode: string
  communitySlug: string
  name: string
}) {
  const base = trimSlugLength(slugifyText(name), 80) || 'organization'
  return ensureUniqueCommunityOrgSlug({ provinceCode, communitySlug, baseSlug: base })
}

// Organizations (community-tied): /communities/:province/:municipality/orgs
app.get('/communities/:province/:municipality/orgs', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const query = CommunityOrgListQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const viewerId = (req as any).user?.id as string | undefined

    const where: Prisma.BusinessWhereInput = viewerId
      ? {
          provinceCode: province,
          communitySlug: community.slug,
          OR: [{ status: 'ACTIVE' }, { ownerId: viewerId }],
        }
      : {
          provinceCode: province,
          communitySlug: community.slug,
          status: 'ACTIVE',
        }

    const orgs = (await prisma.business.findMany({
      where,
      orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
      take: query.data.limit,
      select: {
        id: true,
        ownerId: true,
        provinceCode: true,
        communitySlug: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        metadata: true,
        status: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { follows: true } },
      },
    })) as CommunityOrgRecord[]

    let followedSet: Set<string> = new Set()
    if (viewerId && orgs.length) {
      const follows = await prisma.businessFollow.findMany({
        where: { userId: viewerId, businessId: { in: orgs.map((org) => org.id) } },
        select: { businessId: true },
      })
      followedSet = new Set(follows.map((follow: { businessId: string }) => follow.businessId))
    }

    return reply.send({
      provinceCode: province,
      communitySlug: community.slug,
      items: orgs.map((org) => buildCommunityOrgPayload(org, followedSet.has(org.id))),
    })
  }),
)

// Organizations directory: /organizations/directory
app.get('/organizations/directory', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const query = OrganizationsDirectoryQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    type DirectoryOrgRow = Prisma.BusinessGetPayload<{
      select: {
        id: true
        name: true
        slug: true
        type: true
        provinceCode: true
        communitySlug: true
        isVerified: true
        logoUrl: true
        coverUrl: true
        phone: true
        websiteUrl: true
        address: true
        schedule: true
      }
    }>

    const where: Prisma.BusinessWhereInput = {
      status: 'ACTIVE',
      ...(query.data.type ? { type: query.data.type } : {}),
      ...(query.data.q
        ? {
            name: {
              contains: query.data.q,
              mode: 'insensitive',
            },
          }
        : {}),
    }

    const items = await prisma.business.findMany({
      where,
      orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
      take: query.data.limit,
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        provinceCode: true,
        communitySlug: true,
        isVerified: true,
        logoUrl: true,
        coverUrl: true,
        phone: true,
        websiteUrl: true,
        address: true,
        schedule: true,
      },
    })

    return reply.send({
      items: items
        .filter((row: DirectoryOrgRow) => Boolean(row.provinceCode) && Boolean(row.communitySlug))
        .map((row: DirectoryOrgRow) => ({
          logoUrl: row.logoUrl ?? null,
          coverUrl: row.coverUrl ?? null,
          phone: row.phone ?? null,
          websiteUrl: row.websiteUrl ?? null,
          address: row.address ?? null,
          schedule: row.schedule ?? null,
          id: row.id,
          name: row.name,
          slug: row.slug,
          type: row.type,
          provinceCode: row.provinceCode as string,
          communitySlug: row.communitySlug as string,
          isVerified: Boolean(row.isVerified),
        })),
    })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = (await prisma.business.findFirst({
      where: {
        provinceCode: province,
        communitySlug: community.slug,
        slug,
      },
      select: {
        id: true,
        ownerId: true,
        provinceCode: true,
        communitySlug: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        metadata: true,
        status: true,
        isVerified: true,
        logoUrl: true,
        coverUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { follows: true } },
      },
    })) as CommunityOrgRecord | null

    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const viewerId = (req as any).user?.id as string | undefined

    const viewerRole = viewerId
      ? org.ownerId === viewerId
        ? 'OWNER'
        : ((await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: org.id, userId: viewerId } },
            select: { role: true },
          }))?.role as 'OWNER' | 'MANAGER' | undefined) ?? null
      : null

    if (org.status !== 'ACTIVE' && !viewerRole) {
      return reply.code(404).send({ error: 'organization_not_found' })
    }
    const viewerFollowed = viewerId
      ? Boolean(
          await prisma.businessFollow.findUnique({
            where: { businessId_userId: { businessId: org.id, userId: viewerId } },
            select: { id: true },
          }),
        )
      : false

    return reply.send({ org: buildCommunityOrgPayload(org, viewerFollowed, viewerRole) })
  }),
)

app.post('/communities/:province/:municipality/orgs', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = CommunityOrgCreateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })

    const ownedCount = await prisma.business.count({ where: { ownerId: userId } })
    if (ownedCount >= MAX_BUSINESSES_PER_USER) {
      return reply.code(403).send({ error: 'business_limit_reached' })
    }

    const desiredSlugRaw = body.data.slug?.trim() || ''
    const desiredSlug = desiredSlugRaw ? trimSlugLength(slugifyText(desiredSlugRaw.toLowerCase()), 80) : null

    const baseSlug = desiredSlug || trimSlugLength(slugifyText(body.data.name), 80) || 'organization'
    const slug = await ensureUniqueCommunityOrgSlug({ provinceCode: province, communitySlug: community.slug, baseSlug })

    const type = (body.data.type ?? 'LOCAL_BUSINESS') as BusinessType
    const initialOrgSystem = readOrganizationSystemState(null)
    initialOrgSystem.members[userId] = {
      rankId: SYSTEM_MANAGER_RANK_ID,
      planId: null,
      status: 'ACTIVE',
      referredByUserId: null,
      reputation: 0,
      updatedAt: new Date().toISOString(),
    }

    const org = (await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.business.create({
        data: {
          ownerId: userId,
          provinceCode: province,
          communitySlug: community.slug,
          name: body.data.name.trim(),
          slug,
          type,
          description: body.data.description?.trim() ? sanitizePlainText(body.data.description).trim() : null,
          metadata: mergeOrganizationSystemStateIntoMetadata(null, initialOrgSystem),
          // Community organizations should be visible immediately.
          status: 'ACTIVE',
        },
        select: { id: true },
      })

      await tx.businessFollow.upsert({
        where: { businessId_userId: { businessId: created.id, userId } },
        create: { businessId: created.id, userId },
        update: {},
        select: { id: true },
      })

      await tx.businessMembership.upsert({
        where: { businessId_userId: { businessId: created.id, userId } },
        create: { businessId: created.id, userId, role: 'OWNER' },
        update: { role: 'OWNER' },
        select: { id: true },
      })

      await appendOrganizationAuditLogEntry(tx, created.id, {
        actorUserId: userId,
        action: 'organization.created',
        reason: null,
        previousValue: null,
        nextValue: {
          name: body.data.name.trim(),
          slug,
          type,
          provinceCode: province,
          communitySlug: community.slug,
        },
      })

      return (await tx.business.findUnique({
        where: { id: created.id },
        select: {
          id: true,
          ownerId: true,
          provinceCode: true,
          communitySlug: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          metadata: true,
          status: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { follows: true } },
        },
      })) as CommunityOrgRecord
    })) as CommunityOrgRecord

    return reply.code(201).send({ org: buildCommunityOrgPayload(org, true) })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    await prisma.businessFollow.upsert({
      where: { businessId_userId: { businessId: org.id, userId } },
      create: { businessId: org.id, userId },
      update: {},
      select: { id: true },
    })

    return reply.send({ ok: true })
  }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: { id: true, ownerId: true, name: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    await prisma.businessFollow.deleteMany({ where: { businessId: org.id, userId } })
    return reply.send({ ok: true })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/settings', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = CommunityOrgSettingsBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: { id: true, ownerId: true, name: true },
    })

    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId } },
          select: { role: true },
        })

    if (!membership) return reply.code(403).send({ error: 'forbidden' })

    const nextData: Prisma.BusinessUpdateInput = {}
    if ('name' in body.data && typeof body.data.name === 'string') {
      if (!isOwner) return reply.code(403).send({ error: 'owner_required_for_rename' })
      const nextName = body.data.name.trim()
      if (nextName && nextName !== org.name) {
        nextData.name = nextName
      }
    }

    if ('phone' in body.data) {
      const next = body.data.phone
      nextData.phone = next ? next : null
    }
    if ('websiteUrl' in body.data) {
      const next = body.data.websiteUrl
      nextData.websiteUrl = next ? next : null
    }
    if ('address' in body.data) {
      const next = body.data.address
      nextData.address = next ? next : null
    }
    if ('schedule' in body.data) {
      const next = body.data.schedule
      nextData.schedule = next ? next : null
    }
    if ('description' in body.data) {
      const next = body.data.description
      nextData.description = next ? sanitizePlainText(next).trim() || null : null
    }
    if ('headline' in body.data) {
      const currentMetadata =
        org.metadata && typeof org.metadata === 'object' && !Array.isArray(org.metadata)
          ? ({ ...(org.metadata as Record<string, unknown>) } as Record<string, unknown>)
          : {}
      const nextHeadline = body.data.headline?.trim() ?? ''
      if (nextHeadline) {
        currentMetadata.headline = nextHeadline.slice(0, 60)
      } else {
        delete currentMetadata.headline
      }
      nextData.metadata = currentMetadata as Prisma.InputJsonValue
    }
    if ('isPublic' in body.data && typeof body.data.isPublic === 'boolean') {
      nextData.status = body.data.isPublic ? 'ACTIVE' : 'DRAFT'
    }

    if (body.data.logoMediaId) {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: body.data.logoMediaId, ownerId: userId },
        select: { id: true, category: true, status: true },
      })
      if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
      if (asset.category !== 'business_logo') return reply.code(400).send({ error: 'invalid_logo_category' })
      nextData.logoMedia = { connect: { id: asset.id } }
      nextData.logoUrl = null
    }

    if (body.data.coverMediaId) {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: body.data.coverMediaId, ownerId: userId },
        select: { id: true, category: true, status: true },
      })
      if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
      if (asset.category !== 'business_cover') return reply.code(400).send({ error: 'invalid_cover_category' })
      nextData.coverMedia = { connect: { id: asset.id } }
      nextData.coverUrl = null
    }

    const updated = (await prisma.business.update({
      where: { id: org.id },
      data: nextData,
      select: {
        id: true,
        ownerId: true,
        provinceCode: true,
        communitySlug: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        metadata: true,
        phone: true,
        websiteUrl: true,
        address: true,
        schedule: true,
        status: true,
        isVerified: true,
        logoUrl: true,
        coverUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { follows: true } },
      },
    })) as CommunityOrgRecord

    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId: userId,
      action: 'organization.settings.updated',
      reason: null,
      previousValue: null,
      nextValue: {
        changedKeys: Object.keys(nextData),
      },
    })

    return reply.send({ org: buildCommunityOrgPayload(updated, true, membership.role as any) })
  }),
)

app.delete('/communities/:province/:municipality/orgs/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (org.ownerId !== userId) return reply.code(403).send({ error: 'owner_required_for_delete' })

    await prisma.business.delete({ where: { id: org.id } })
    return reply.send({ ok: true })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/members', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const [owner, managers, followers] = await Promise.all([
      prisma.user.findUnique({
        where: { id: org.ownerId },
        select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true },
      }),
      prisma.businessMembership.findMany({
        where: { businessId: org.id, userId: { not: org.ownerId } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true } },
        },
      }),
      prisma.businessFollow.findMany({
        where: { businessId: org.id, userId: { not: org.ownerId } },
        orderBy: { createdAt: 'asc' },
        select: {
          userId: true,
          createdAt: true,
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true } },
        },
      }),
    ])

    const memberUserIds = Array.from(
      new Set<string>([
        ...(owner ? [owner.id] : []),
        ...managers.map((row: { userId: string }) => row.userId),
        ...followers.map((row: { userId: string }) => row.userId),
      ]),
    )

    const memberExperienceByUserId = new Map<string, { title: string | null; description: string | null }>()
    if (memberUserIds.length > 0) {
      const experiences = await prisma.experience.findMany({
        where: {
          userId: { in: memberUserIds },
          organization: {
            equals: org.name,
            mode: 'insensitive',
          },
        },
        orderBy: [{ current: 'desc' }, { startDate: 'desc' }, { position: 'asc' }],
        select: {
          userId: true,
          title: true,
          description: true,
        },
      })

      for (const exp of experiences) {
        if (memberExperienceByUserId.has(exp.userId)) continue
        const title = exp.title.trim()
        const description = typeof exp.description === 'string' ? exp.description.trim() : ''
        if (!title && !description) continue
        memberExperienceByUserId.set(exp.userId, {
          title: title || null,
          description: description || null,
        })
      }
    }

    const managerIds = new Set(managers.map((row: { userId: string }) => row.userId))

    const memberItems = [
      ...(owner
        ? [
            {
              userId: owner.id,
              role: 'OWNER' as const,
              joinedAt: null,
              jobTitle: memberExperienceByUserId.get(owner.id)?.title ?? null,
              jobDescription: memberExperienceByUserId.get(owner.id)?.description ?? null,
              user: {
                id: owner.id,
                handle: owner.handle,
                name: owner.name,
                avatarUrl: normalizeMediaUrl(owner.avatarUrl ?? null),
                coverUrl: normalizeMediaUrl(owner.coverUrl ?? null),
              },
            },
          ]
        : []),
      ...managers.map((row: { userId: string; role: BusinessRole; createdAt: Date; user: { id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl: string | null } }) => ({
        userId: row.userId,
        role: row.role,
        joinedAt: row.createdAt,
        jobTitle: memberExperienceByUserId.get(row.userId)?.title ?? null,
        jobDescription: memberExperienceByUserId.get(row.userId)?.description ?? null,
        user: {
          id: row.user.id,
          handle: row.user.handle,
          name: row.user.name,
          avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
          coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
        },
      })),
    ]

    const followerItems = followers
      .filter((row: { userId: string }) => !managerIds.has(row.userId))
      .map((row: { userId: string; createdAt: Date; user: { id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl: string | null } }) => ({
        userId: row.userId,
        role: 'FOLLOWER' as const,
        joinedAt: row.createdAt,
        jobTitle: memberExperienceByUserId.get(row.userId)?.title ?? null,
        jobDescription: memberExperienceByUserId.get(row.userId)?.description ?? null,
        user: {
          id: row.user.id,
          handle: row.user.handle,
          name: row.user.name,
          avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
          coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
        },
      }))

    return reply.send({ members: memberItems, followers: followerItems })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/members/:userId/promote', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    if (org.ownerId !== userId) return reply.code(403).send({ error: 'forbidden' })
    if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_promote_owner' })

    const follow = await prisma.businessFollow.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: params.data.userId } },
      select: { id: true },
    })
    if (!follow) return reply.code(400).send({ error: 'user_must_follow_org' })

    await prisma.businessMembership.upsert({
      where: { businessId_userId: { businessId: org.id, userId: params.data.userId } },
      create: { businessId: org.id, userId: params.data.userId, role: 'MANAGER' },
      update: { role: 'MANAGER' },
      select: { id: true },
    })

    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId: userId,
      action: 'member.promoted',
      reason: null,
      previousValue: { userId: params.data.userId },
      nextValue: { userId: params.data.userId, role: 'MANAGER' },
    })

    return reply.send({ ok: true })
  }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/members/:userId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    if (org.ownerId !== userId) return reply.code(403).send({ error: 'forbidden' })
    if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_remove_owner' })

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await appendOrganizationAuditLogEntry(tx, org.id, {
        actorUserId: userId,
        action: 'member.removed',
        reason: null,
        previousValue: { targetUserId: params.data.userId },
        nextValue: null,
      })
    })

    return reply.send({ ok: true })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/state', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const viewerId = (await resolveUserId(req)) ?? null
    const membership = viewerId
      ? await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId: viewerId } },
          select: { role: true },
        })
      : null

    const viewerRole: 'OWNER' | 'MANAGER' | null = viewerId
      ? org.ownerId === viewerId
        ? 'OWNER'
        : membership?.role === 'MANAGER'
          ? 'MANAGER'
          : null
      : null

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({
      org: { ownerId: org.ownerId },
      role: viewerRole,
      system,
      userId: viewerId,
    })

    const rawIncludeDrafts = (req.query as any)?.includeDrafts
    const wantsDrafts = rawIncludeDrafts === '1' || rawIncludeDrafts === 'true'
    const canSeeDrafts = Boolean(viewerId && canOrganizationPermission(permissions, 'manage_events'))
    const events = wantsDrafts && canSeeDrafts ? system.events : system.events.filter((event) => event?.status !== 'DRAFT')

    return reply.send({
      state: {
        joinMode: system.joinMode,
        ranks: system.ranks,
        plans: system.plans,
        sponsors: system.sponsors,
        events,
        achievements: system.achievements,
        achievementAwards: system.achievementAwards,
        referrals: system.referrals,
        reputationLedger: system.reputationLedger,
        eventRsvps: system.eventRsvps,
        economics: system.economics,
      },
      viewer: {
        userId: viewerId,
        role: viewerRole,
        permissions,
        memberState: viewerId ? system.members[viewerId] ?? null : null,
      },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/events/draft', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    const canCreate =
      canOrganizationPermission(permissions, 'manage_events') ||
      canOrganizationPermission(permissions, 'create_announcements') ||
      canOrganizationPermission(permissions, 'create_paid_events')
    if (!canCreate) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nowIso = new Date().toISOString()
    const event: OrgEventDefinition = {
      id: `event_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      title: 'Untitled event',
      description: null,
      category: 'Other',
      access: 'PUBLIC',
      eligibleRankIds: [],
      startsAt: nowIso,
      endsAt: null,
      capacity: null,
      paid: false,
      priceCents: null,
      currency: 'CAD',
      guestSpeakers: [],
      guestSpeakerInvites: [],
      sponsors: [],
      sponsorInvites: [],
      fees: [],
      primaryPhotoUrl: null,
      galleryPhotoUrls: [],
      agenda: [],
      attachments: [],
      status: 'DRAFT',
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const nextSystem: OrganizationSystemState = { ...current, events: [...current.events, event] }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.draft.created',
      reason: null,
      previousValue: null,
      nextValue: event,
    })

    return reply.code(201).send({ event })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const event = current.events.find((item) => item.id === params.data.eventId) ?? null
    if (!event) return reply.code(404).send({ error: 'event_not_found' })

    const eventRsvps = current.eventRsvps.filter((row) => row.eventId === event.id)
    const rsvpUserIds = Array.from(new Set(eventRsvps.map((row) => row.userId).filter(Boolean)))
    const rsvpUsers: FriendUser[] = rsvpUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: rsvpUserIds } },
          select: FRIEND_USER_SELECT,
        })
      : []
    const rsvpUserMap = new Map(rsvpUsers.map((user) => [user.id, user]))

    const rsvps = eventRsvps
      .map((row) => {
        const user = rsvpUserMap.get(row.userId)
        return {
          ...row,
          user: user ? formatFriendUser(user) : null,
        }
      })
      .sort((a, b) => {
        const at = new Date(a.updatedAt ?? a.createdAt).getTime()
        const bt = new Date(b.updatedAt ?? b.createdAt).getTime()
        return bt - at
      })

    return reply.send({ event, rsvps })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEventDraftUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
    if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
    const previous = current.events[eventIndex]
    if (!previous) return reply.code(404).send({ error: 'event_not_found' })

    const nextFees = body.data.fees ?? previous.fees ?? []
    const hasPaidFees = nextFees.some((fee) => fee.amountCents > 0)
    const nextPaid = body.data.paid ?? hasPaidFees
    const nextStartsAt = body.data.startsAt === undefined ? previous.startsAt : body.data.startsAt ?? previous.startsAt
    const nextCurrency = (body.data.currency ?? previous.currency).toUpperCase()
    const derivedPriceFromFees = nextFees
      .map((fee) => fee.amountCents)
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => a - b)[0] ?? null
    const nowIso = new Date().toISOString()

    const normalizedGuestInput = body.data.guestSpeakers === undefined ? null : normalizeGuestSpeakerInput(body.data.guestSpeakers)
    const guestInviteBuild = normalizedGuestInput
      ? buildGuestSpeakerInvites({
          previous: previous.guestSpeakerInvites ?? [],
          selectedTags: normalizedGuestInput.guestSpeakerTags,
          nowIso,
        })
      : null

    const normalizedSponsors = body.data.sponsors ? normalizeEventSponsorTags(body.data.sponsors) : null
    const sponsorRecipientMap = normalizedSponsors?.length
      ? await resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor) => sponsor.organizationId))
      : new Map<string, string[]>()
    const sponsorInviteBuild = normalizedSponsors
      ? buildSponsorInvites({
          previous: previous.sponsorInvites ?? [],
          selectedSponsors: normalizedSponsors,
          recipientMap: sponsorRecipientMap,
          nowIso,
        })
      : null

    const nextAgenda =
      body.data.agenda === undefined
        ? previous.agenda
        : body.data.agenda.map((item) => ({ title: item.title, startsAt: item.startsAt ?? null }))

    const next: OrgEventDefinition = {
      ...previous,
      title: body.data.title ?? previous.title,
      description: body.data.description === undefined ? previous.description : body.data.description ?? null,
      category: body.data.category ?? previous.category ?? 'Other',
      access: body.data.access ?? previous.access,
      eligibleRankIds: body.data.eligibleRankIds ?? previous.eligibleRankIds,
      startsAt: nextStartsAt,
      endsAt: body.data.endsAt === undefined ? previous.endsAt : body.data.endsAt ?? null,
      capacity: body.data.capacity === undefined ? previous.capacity : body.data.capacity ?? null,
      paid: nextPaid,
      priceCents: nextPaid ? (body.data.priceCents === undefined ? previous.priceCents ?? derivedPriceFromFees : body.data.priceCents ?? null) : null,
      currency: nextCurrency,
      guestSpeakers: normalizedGuestInput ? normalizedGuestInput.guestSpeakers : previous.guestSpeakers,
      guestSpeakerInvites: guestInviteBuild ? guestInviteBuild.nextInvites : previous.guestSpeakerInvites ?? [],
      sponsors: normalizedSponsors ?? previous.sponsors ?? [],
      sponsorInvites: sponsorInviteBuild ? sponsorInviteBuild.nextInvites : previous.sponsorInvites ?? [],
      fees: nextFees,
      agenda: nextAgenda,
      attachments: body.data.attachments ?? previous.attachments,
      primaryPhotoUrl: body.data.primaryPhotoUrl === undefined ? previous.primaryPhotoUrl : body.data.primaryPhotoUrl ?? null,
      galleryPhotoUrls: body.data.galleryPhotoUrls ?? previous.galleryPhotoUrls,
      status: previous.status ?? 'PUBLISHED',
      updatedAt: nowIso,
    }

    const nextEvents = [...current.events]
    nextEvents[eventIndex] = next
    const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: (previous.status ?? 'PUBLISHED') === 'DRAFT' ? 'event.draft.updated' : 'event.updated',
      reason: null,
      previousValue: previous,
      nextValue: next,
    })

    const hostSlug = params.data.slug.trim().toLowerCase()
    if (guestInviteBuild?.newlyInvited?.length) {
      await Promise.allSettled(
        guestInviteBuild.newlyInvited.map((invite) =>
          notifyEventGuestSpeakerInvite({
            inviteeUserId: invite.userId,
            actorUserId,
            hostOrganizationId: org.id,
            hostProvinceCode: province,
            hostCommunitySlug: community.slug,
            hostOrganizationSlug: hostSlug,
            eventId: next.id,
            eventTitle: next.title,
          }),
        ),
      )
    }

    if (sponsorInviteBuild?.newlyInvited?.length) {
      const notifications: Array<Promise<void>> = []
      for (const invite of sponsorInviteBuild.newlyInvited) {
        for (const userId of invite.recipientUserIds) {
          notifications.push(
            notifyEventSponsorInvite({
              inviteeUserId: userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              targetOrganizationId: invite.organizationId,
              eventId: next.id,
              eventTitle: next.title,
            }),
          )
        }
      }
      if (notifications.length) {
        await Promise.allSettled(notifications)
      }
    }

    return reply.send({ event: next })
  }),
)

app.post(
  '/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/publish',
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const actorUserId = (await resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = CommunityOrgEventBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

      const current = readOrganizationSystemState(org.metadata)
      const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })

      const hasPaidFees = (body.data.fees ?? []).some((fee) => fee.amountCents > 0)
      const isPaidEvent = body.data.paid || hasPaidFees
      const requiredPermission: OrgPermission = isPaidEvent ? 'create_paid_events' : 'create_announcements'
      if (!canOrganizationPermission(permissions, requiredPermission) && !canOrganizationPermission(permissions, 'manage_events')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })
      if (previous.status && previous.status !== 'DRAFT') {
        return reply.code(409).send({ error: 'event_not_draft' })
      }

      const nowIso = new Date().toISOString()
      const normalizedGuestInput = normalizeGuestSpeakerInput(body.data.guestSpeakers)
      const guestInviteBuild = buildGuestSpeakerInvites({
        previous: previous.guestSpeakerInvites ?? [],
        selectedTags: normalizedGuestInput.guestSpeakerTags,
        nowIso,
      })
      const normalizedSponsors = normalizeEventSponsorTags(body.data.sponsors)
      const sponsorRecipientMap = normalizedSponsors.length
        ? await resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor) => sponsor.organizationId))
        : new Map<string, string[]>()
      const sponsorInviteBuild = buildSponsorInvites({
        previous: previous.sponsorInvites ?? [],
        selectedSponsors: normalizedSponsors,
        recipientMap: sponsorRecipientMap,
        nowIso,
      })
      const publishPriceFromFees = (body.data.fees ?? [])
        .map((fee) => fee.amountCents)
        .filter((amount) => Number.isFinite(amount) && amount > 0)
        .sort((a, b) => a - b)[0] ?? null
      const next: OrgEventDefinition = {
        ...previous,
        title: body.data.title,
        description: body.data.description ?? null,
        category: body.data.category,
        access: body.data.access,
        eligibleRankIds: body.data.eligibleRankIds ?? [],
        startsAt: body.data.startsAt,
        endsAt: body.data.endsAt ?? null,
        capacity: body.data.capacity ?? null,
        paid: body.data.paid || hasPaidFees,
        priceCents: body.data.paid || hasPaidFees ? body.data.priceCents ?? publishPriceFromFees : null,
        currency: body.data.currency.toUpperCase(),
        guestSpeakers: normalizedGuestInput.guestSpeakers,
        guestSpeakerInvites: guestInviteBuild.nextInvites,
        sponsors: normalizedSponsors,
        sponsorInvites: sponsorInviteBuild.nextInvites,
        fees: body.data.fees ?? [],
        primaryPhotoUrl: body.data.primaryPhotoUrl ?? null,
        galleryPhotoUrls: body.data.galleryPhotoUrls ?? [],
        agenda: body.data.agenda?.map((item) => ({ title: item.title, startsAt: item.startsAt ?? null })) ?? [],
        attachments: body.data.attachments ?? [],
        status: 'PUBLISHED',
        updatedAt: nowIso,
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }
      const hostSlug = params.data.slug.trim().toLowerCase()

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })

        await createOrganizationEventAnnouncementPost({
          client: tx,
          authorUserId: actorUserId,
          businessId: org.id,
          provinceCode: province,
          communitySlug: community.slug,
          organizationSlug: hostSlug,
          event: {
            id: next.id,
            title: next.title,
            description: next.description,
            startsAt: next.startsAt,
            primaryPhotoUrl: next.primaryPhotoUrl,
          },
        })
      })
      await appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.published',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      if (guestInviteBuild.newlyInvited.length) {
        await Promise.allSettled(
          guestInviteBuild.newlyInvited.map((invite) =>
            notifyEventGuestSpeakerInvite({
              inviteeUserId: invite.userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              eventId: next.id,
              eventTitle: next.title,
            }),
          ),
        )
      }

      if (sponsorInviteBuild.newlyInvited.length) {
        const notifications: Promise<void>[] = []
        for (const invite of sponsorInviteBuild.newlyInvited) {
          for (const userId of invite.recipientUserIds) {
            notifications.push(
              notifyEventSponsorInvite({
                inviteeUserId: userId,
                actorUserId,
                hostOrganizationId: org.id,
                hostProvinceCode: province,
                hostCommunitySlug: community.slug,
                hostOrganizationSlug: hostSlug,
                targetOrganizationId: invite.organizationId,
                eventId: next.id,
                eventTitle: next.title,
              }),
            )
          }
        }
        if (notifications.length) {
          await Promise.allSettled(notifications)
        }
      }

      return reply.send({ event: next })
    }),
)

app.post(
  '/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/unpublish',
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const actorUserId = (await resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

      const current = readOrganizationSystemState(org.metadata)
      const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!canOrganizationPermission(permissions, 'manage_events')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })

      const nowIso = new Date().toISOString()
      const next: OrgEventDefinition = {
        ...previous,
        status: 'DRAFT',
        updatedAt: nowIso,
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.unpublished',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      return reply.send({ event: next })
    }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
    if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
    const removed = current.events[eventIndex]
    if (!removed) return reply.code(404).send({ error: 'event_not_found' })

    const nextEvents = current.events.filter((item) => item.id !== params.data.eventId)
    const nextRsvps = current.eventRsvps.filter((row) => row.eventId !== params.data.eventId)
    const nextSystem: OrganizationSystemState = {
      ...current,
      events: nextEvents,
      eventRsvps: nextRsvps,
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.deleted',
      reason: null,
      previousValue: removed,
      nextValue: null,
    })

    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/join-mode', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgJoinModeBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_membership_plans')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nextSystem: OrganizationSystemState = { ...current, joinMode: body.data.joinMode }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'governance.join_mode.updated',
      reason: body.data.reason ?? null,
      previousValue: { joinMode: current.joinMode },
      nextValue: { joinMode: body.data.joinMode },
    })

    return reply.send({ ok: true, joinMode: body.data.joinMode })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/ranks', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgGovernanceRankBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'create_ranks')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const rankId = `rank_${randomUUID().replace(/-/g, '').slice(0, 14)}`
    const nextRank: OrgRankDefinition = {
      id: rankId,
      name: body.data.name,
      description: body.data.description?.trim() || null,
      permissions: Array.from(new Set(body.data.permissions)),
      promotionAuthority: body.data.promotionAuthority ?? [],
      visibility: body.data.visibility,
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      ranks: [...current.ranks, nextRank],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'rank.created',
      reason: null,
      previousValue: null,
      nextValue: nextRank,
    })

    return reply.code(201).send({ rank: nextRank })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/plans', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMembershipPlanBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_membership_plans')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const plan: OrgPlanDefinition = {
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

    const nextSystem: OrganizationSystemState = { ...current, plans: [...current.plans, plan] }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'plan.created',
      reason: null,
      previousValue: null,
      nextValue: plan,
    })

    return reply.code(201).send({ plan })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/sponsors', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgSponsorBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'create_announcements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const sponsor: OrgSponsorDefinition = {
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

    const nextSystem: OrganizationSystemState = { ...current, sponsors: [...current.sponsors, sponsor] }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'sponsor.created',
      reason: null,
      previousValue: null,
      nextValue: sponsor,
    })

    return reply.code(201).send({ sponsor })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/events', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEventBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    const hasPaidFees = (body.data.fees ?? []).some((fee) => fee.amountCents > 0)
    const isPaidEvent = body.data.paid || hasPaidFees
    const requiredPermission: OrgPermission = isPaidEvent ? 'create_paid_events' : 'create_announcements'
    if (!canOrganizationPermission(permissions, requiredPermission) && !canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nowIso = new Date().toISOString()
    const normalizedGuestInput = normalizeGuestSpeakerInput(body.data.guestSpeakers)
    const guestInviteBuild = buildGuestSpeakerInvites({
      previous: [],
      selectedTags: normalizedGuestInput.guestSpeakerTags,
      nowIso,
    })
    const normalizedSponsors = normalizeEventSponsorTags(body.data.sponsors)
    const sponsorRecipientMap = normalizedSponsors.length
      ? await resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor) => sponsor.organizationId))
      : new Map<string, string[]>()
    const sponsorInviteBuild = buildSponsorInvites({
      previous: [],
      selectedSponsors: normalizedSponsors,
      recipientMap: sponsorRecipientMap,
      nowIso,
    })
    const createPriceFromFees = (body.data.fees ?? [])
      .map((fee) => fee.amountCents)
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => a - b)[0] ?? null
    const event: OrgEventDefinition = {
      id: `event_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      title: body.data.title,
      description: body.data.description ?? null,
      category: body.data.category,
      access: body.data.access,
      eligibleRankIds: body.data.eligibleRankIds ?? [],
      startsAt: body.data.startsAt,
      endsAt: body.data.endsAt ?? null,
      capacity: body.data.capacity ?? null,
      paid: body.data.paid || hasPaidFees,
      priceCents: body.data.paid || hasPaidFees ? body.data.priceCents ?? createPriceFromFees : null,
      currency: body.data.currency.toUpperCase(),
      guestSpeakers: normalizedGuestInput.guestSpeakers,
      guestSpeakerInvites: guestInviteBuild.nextInvites,
      sponsors: normalizedSponsors,
      sponsorInvites: sponsorInviteBuild.nextInvites,
      fees: body.data.fees ?? [],
      primaryPhotoUrl: body.data.primaryPhotoUrl ?? null,
      galleryPhotoUrls: body.data.galleryPhotoUrls ?? [],
      agenda: body.data.agenda?.map((item) => ({ title: item.title, startsAt: item.startsAt ?? null })) ?? [],
      attachments: body.data.attachments ?? [],
      status: 'PUBLISHED',
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const nextSystem: OrganizationSystemState = { ...current, events: [...current.events, event] }
    const hostSlug = params.data.slug.trim().toLowerCase()
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })

      await createOrganizationEventAnnouncementPost({
        client: tx,
        authorUserId: actorUserId,
        businessId: org.id,
        provinceCode: province,
        communitySlug: community.slug,
        organizationSlug: hostSlug,
        event: {
          id: event.id,
          title: event.title,
          description: event.description,
          startsAt: event.startsAt,
          primaryPhotoUrl: event.primaryPhotoUrl,
        },
      })
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.created',
      reason: null,
      previousValue: null,
      nextValue: event,
    })

    if (guestInviteBuild.newlyInvited.length) {
      await Promise.allSettled(
        guestInviteBuild.newlyInvited.map((invite) =>
          notifyEventGuestSpeakerInvite({
            inviteeUserId: invite.userId,
            actorUserId,
            hostOrganizationId: org.id,
            hostProvinceCode: province,
            hostCommunitySlug: community.slug,
            hostOrganizationSlug: hostSlug,
            eventId: event.id,
            eventTitle: event.title,
          }),
        ),
      )
    }

    if (sponsorInviteBuild.newlyInvited.length) {
      const notifications: Promise<void>[] = []
      for (const invite of sponsorInviteBuild.newlyInvited) {
        for (const userId of invite.recipientUserIds) {
          notifications.push(
            notifyEventSponsorInvite({
              inviteeUserId: userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              targetOrganizationId: invite.organizationId,
              eventId: event.id,
              eventTitle: event.title,
            }),
          )
        }
      }
      if (notifications.length) {
        await Promise.allSettled(notifications)
      }
    }

    return reply.code(201).send({ event })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/join', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgJoinBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, status: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (org.status !== 'ACTIVE') return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(org.metadata)
    if (current.joinMode === 'INVITE_ONLY') {
      if (!body.data.referredByUserId) {
        return reply.code(403).send({ error: 'invite_required' })
      }

      const inviterId = body.data.referredByUserId
      if (inviterId === actorUserId) return reply.code(400).send({ error: 'invalid_referrer' })

      const inviterMember = current.members[inviterId] ?? null
      const inviterIsOwner = inviterId === org.ownerId
      if (inviterMember?.status === 'BANNED') {
        return reply.code(403).send({ error: 'invalid_inviter' })
      }

      const inviterEligibleStatus: OrgMembershipStatus[] = ['ACTIVE', 'GRACE']
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

      if (!inviterEligible) {
        return reply.code(403).send({ error: 'invalid_inviter' })
      }
    }
    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }
    if (body.data.referredByUserId && body.data.referredByUserId === actorUserId) {
      return reply.code(400).send({ error: 'invalid_referrer' })
    }

    const existing = current.members[actorUserId] ?? null
    if (existing?.status === 'BANNED') {
      return reply.code(403).send({ error: 'membership_banned' })
    }

    const status: OrgMembershipStatus = current.joinMode === 'APPLICATION_REQUIRED' ? 'PENDING' : 'ACTIVE'
    const nextMemberState: OrgMemberState = {
      rankId: existing?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: body.data.planId ?? existing?.planId ?? null,
      status,
      referredByUserId: body.data.referredByUserId ?? existing?.referredByUserId ?? null,
      reputation: existing?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const shouldAppendReferral = Boolean(body.data.referredByUserId && body.data.referredByUserId !== actorUserId)
    const nextReferrals = shouldAppendReferral
      ? current.referrals.some((item) => item.referrerUserId === body.data.referredByUserId && item.referredUserId === actorUserId)
        ? current.referrals
        : [
            ...current.referrals,
            {
              id: `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
              referrerUserId: body.data.referredByUserId as string,
              referredUserId: actorUserId,
              planId: body.data.planId ?? null,
              createdAt: new Date().toISOString(),
            } satisfies OrgReferralRecord,
          ]
      : current.referrals

    const nextSystem: OrganizationSystemState = {
      ...current,
      referrals: nextReferrals,
      members: {
        ...current.members,
        [actorUserId]: nextMemberState,
      },
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessFollow.upsert({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        create: { businessId: org.id, userId: actorUserId },
        update: {},
      })
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(tx, org.id, {
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

app.post('/communities/:province/:municipality/orgs/:slug/governance/achievements', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgAchievementBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'award_achievements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const achievement: OrgAchievementDefinition = {
      id: `ach_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      title: body.data.title,
      description: body.data.description?.trim() || null,
      reputationPoints: body.data.reputationPoints,
      visibility: body.data.visibility,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      achievements: [...current.achievements, achievement],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgAchievementParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgAchievementAwardBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'award_achievements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const achievement = current.achievements.find((item) => item.id === params.data.achievementId)
    if (!achievement) return reply.code(404).send({ error: 'achievement_not_found' })

    if (current.achievementAwards.some((item) => item.achievementId === params.data.achievementId && item.userId === body.data.userId)) {
      return reply.code(409).send({ error: 'achievement_already_awarded' })
    }

    const previousMember = current.members[body.data.userId] ?? null
    const award: OrgAchievementAward = {
      id: `award_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      achievementId: achievement.id,
      userId: body.data.userId,
      awardedByUserId: actorUserId,
      note: body.data.note ?? null,
      createdAt: new Date().toISOString(),
    }
    const reputationDelta = achievement.reputationPoints
    const ledgerEntry: OrgReputationEntry | null = reputationDelta
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

    const nextMemberState: OrgMemberState = {
      rankId: previousMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: previousMember?.planId ?? null,
      status: previousMember?.status ?? 'ACTIVE',
      referredByUserId: previousMember?.referredByUserId ?? null,
      reputation: (previousMember?.reputation ?? 0) + reputationDelta,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
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
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'achievement.awarded',
      reason: body.data.note ?? null,
      previousValue: { userId: body.data.userId, member: previousMember },
      nextValue: { award, member: nextMemberState },
    })

    return reply.code(201).send({ award, member: nextMemberState })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/invite-links', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgInviteLinkBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }

    const nowIso = new Date().toISOString()
    const token = randomUUID().replace(/-/g, '')
    const invite: OrgInviteLinkRecord = {
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

    const nextSystem: OrganizationSystemState = {
      ...current,
      inviteLinks: [...current.inviteLinks, invite],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })

    await appendOrganizationAuditLogEntry(prisma, org.id, {
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const inviteLinks = current.inviteLinks
      .filter((entry) => entry.createdByUserId === actorUserId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((entry) => ({
        ...entry,
        landingUrl: `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(orgSlug)}/invite/${encodeURIComponent(entry.token)}`,
      }))

    return reply.send({ inviteLinks })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/invite-users', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgInviteUserBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }

    const targetUser = await prisma.user.findUnique({ where: { id: body.data.targetUserId }, select: { id: true } })
    if (!targetUser) return reply.code(404).send({ error: 'user_not_found' })

    const nowIso = new Date().toISOString()
    const token = randomUUID().replace(/-/g, '')
    const invite: OrgInviteLinkRecord = {
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

    const nextSystem: OrganizationSystemState = {
      ...current,
      inviteLinks: [...current.inviteLinks, invite],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })

    const landingUrl = `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(orgSlug)}/invite/${encodeURIComponent(token)}`

    await createNotificationRecord({
      userId: targetUser.id,
      actorId: actorUserId,
      type: ORG_NOTIFICATION_TYPES.USER_INVITE,
      payload: {
        status: 'pending',
        organizationId: org.id,
        organizationName: org.name,
        inviteToken: token,
        message: body.data.message?.trim() || null,
        url: landingUrl,
      },
    })

    await appendOrganizationAuditLogEntry(prisma, org.id, {
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
  withSchemaGuard(req, reply, async () => {
    const viewerUserId = (await resolveUserId(req)) ?? null
    const params = CommunityOrgSlugParams.extend({ token: z.string().trim().min(12).max(160) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgInviteResolveBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })
    const orgSlug = params.data.slug.trim().toLowerCase()

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        coverUrl: true,
        logoUrl: true,
        ownerId: true,
        metadata: true,
        provinceCode: true,
        communitySlug: true,
      },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(org.metadata)
    const inviteIndex = current.inviteLinks.findIndex((entry) => entry.token === params.data.token)
    if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
    const invite = current.inviteLinks[inviteIndex]
    if (!invite) return reply.code(404).send({ error: 'invite_not_found' })

    const inviter = await prisma.user.findUnique({
      where: { id: invite.createdByUserId },
      select: {
        id: true,
        handle: true,
        name: true,
        avatarUrl: true,
        coverUrl: true,
      },
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
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, { ...current, inviteLinks: nextInviteLinks }) },
        select: { id: true },
      })
    }

    return reply.send({
      invite: nextInviteLinks[inviteIndex],
      viewer: {
        id: viewerUserId,
        isInviteOwner,
      },
      inviter: inviter
        ? {
            id: inviter.id,
            handle: inviter.handle,
            name: inviter.name,
            avatarUrl: normalizeMediaUrl(inviter.avatarUrl ?? null),
            coverUrl: normalizeMediaUrl(inviter.coverUrl ?? null),
          }
        : null,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description ?? null,
        coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
      },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/referrals', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgReferralBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (body.data.referrerUserId === body.data.referredUserId) {
      return reply.code(400).send({ error: 'invalid_referral' })
    }
    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }
    if (current.referrals.some((item) => item.referrerUserId === body.data.referrerUserId && item.referredUserId === body.data.referredUserId)) {
      return reply.code(409).send({ error: 'referral_exists' })
    }

    const referral: OrgReferralRecord = {
      id: `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      referrerUserId: body.data.referrerUserId,
      referredUserId: body.data.referredUserId,
      planId: body.data.planId ?? null,
      createdAt: new Date().toISOString(),
    }

    const existingMember = current.members[body.data.referredUserId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: existingMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: body.data.planId ?? existingMember?.planId ?? null,
      status: existingMember?.status ?? 'PENDING',
      referredByUserId: body.data.referrerUserId,
      reputation: existingMember?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      referrals: [...current.referrals, referral],
      members: {
        ...current.members,
        [body.data.referredUserId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'referral.recorded',
      reason: null,
      previousValue: null,
      nextValue: referral,
    })

    return reply.code(201).send({ referral })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/reputation', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgReputationAdjustBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'award_achievements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const existingMember = current.members[body.data.userId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: existingMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: existingMember?.planId ?? null,
      status: existingMember?.status ?? 'ACTIVE',
      referredByUserId: existingMember?.referredByUserId ?? null,
      reputation: Math.max(0, (existingMember?.reputation ?? 0) + body.data.delta),
      updatedAt: new Date().toISOString(),
    }

    const ledgerEntry: OrgReputationEntry = {
      id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      userId: body.data.userId,
      delta: body.data.delta,
      source: body.data.source,
      sourceRefId: null,
      note: body.data.note ?? null,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      reputationLedger: [...current.reputationLedger, ledgerEntry],
      members: {
        ...current.members,
        [body.data.userId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'reputation.adjusted',
      reason: body.data.note ?? null,
      previousValue: { userId: body.data.userId, member: existingMember },
      nextValue: { userId: body.data.userId, member: nextMemberState, ledgerEntry },
    })

    return reply.send({ ok: true, entry: ledgerEntry, member: nextMemberState })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/rsvp', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEventRsvpBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, status: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (org.status !== 'ACTIVE') return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(org.metadata)
    const event = current.events.find((item) => item.id === params.data.eventId)
    if (!event) return reply.code(404).send({ error: 'event_not_found' })
    if (event.status === 'DRAFT') return reply.code(404).send({ error: 'event_not_found' })

    const actorMember = current.members[actorUserId] ?? null
    if (event.access === 'RESTRICTED') {
      if (!actorMember || actorMember.status !== 'ACTIVE') {
        return reply.code(403).send({ error: 'restricted_event' })
      }
      if (event.eligibleRankIds.length > 0 && !event.eligibleRankIds.includes(actorMember.rankId)) {
        return reply.code(403).send({ error: 'rank_not_eligible' })
      }
    }

    const eventFees = event.fees ?? []
    const selectedTicket = body.data.ticketId
      ? eventFees.find((fee) => fee.id === body.data.ticketId) ?? null
      : null

    if (body.data.ticketId && !selectedTicket) {
      return reply.code(400).send({ error: 'invalid_ticket_type' })
    }

    if (body.data.status === 'GOING' && eventFees.length > 0 && !selectedTicket) {
      return reply.code(400).send({ error: 'ticket_type_required' })
    }

    const resolvedTicketType: 'FREE' | 'PAID' = selectedTicket
      ? selectedTicket.amountCents > 0
        ? 'PAID'
        : 'FREE'
      : body.data.ticketType ?? (event.paid ? 'PAID' : 'FREE')

    if (event.paid && eventFees.length === 0 && resolvedTicketType !== 'PAID') {
      return reply.code(400).send({ error: 'paid_ticket_required' })
    }
    if (!event.paid && eventFees.length === 0 && resolvedTicketType === 'PAID') {
      return reply.code(400).send({ error: 'paid_ticket_not_allowed' })
    }

    const message = body.data.message?.trim() ? body.data.message.trim() : null

    const previous = current.eventRsvps.find((item) => item.eventId === event.id && item.userId === actorUserId) ?? null
    const existingGoingCount = current.eventRsvps.filter((item) => item.eventId === event.id && item.status === 'GOING' && item.userId !== actorUserId).length
    if (body.data.status === 'GOING' && typeof event.capacity === 'number' && event.capacity > 0 && existingGoingCount >= event.capacity) {
      return reply.code(409).send({ error: 'event_capacity_reached' })
    }

    if (body.data.status === 'GOING' && selectedTicket && typeof selectedTicket.capacity === 'number' && selectedTicket.capacity > 0) {
      const existingTicketGoingCount = current.eventRsvps.filter(
        (item) => item.eventId === event.id && item.status === 'GOING' && item.ticketId === selectedTicket.id && item.userId !== actorUserId,
      ).length
      if (existingTicketGoingCount >= selectedTicket.capacity) {
        return reply.code(409).send({ error: 'ticket_capacity_reached' })
      }
    }

    const nowIso = new Date().toISOString()

    const rsvp: OrgEventRsvp = {
      id: previous?.id ?? `rsvp_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      eventId: event.id,
      userId: actorUserId,
      status: body.data.status,
      ticketType: resolvedTicketType,
      ticketId: body.data.status === 'GOING' ? selectedTicket?.id ?? null : null,
      ticketLabel: body.data.status === 'GOING' ? selectedTicket?.label ?? null : null,
      amountCents: body.data.status === 'GOING' && selectedTicket ? selectedTicket.amountCents : null,
      message: body.data.status === 'GOING' ? message : null,
      createdAt: previous?.createdAt ?? nowIso,
      updatedAt: nowIso,
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      eventRsvps: [...current.eventRsvps.filter((item) => !(item.eventId === event.id && item.userId === actorUserId)), rsvp],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.rsvp.updated',
      reason: null,
      previousValue: previous,
      nextValue: rsvp,
    })

    return reply.send({ ok: true, rsvp })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const viewerId = (await resolveUserId(req)) ?? null

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase(), status: BusinessStatus.ACTIVE },
      select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true, logoUrl: true, coverUrl: true, isVerified: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const system = readOrganizationSystemState(org.metadata)
    const event = system.events.find((item) => item.id === params.data.eventId)
    if (!event) return reply.code(404).send({ error: 'event_not_found' })

    const isDraft = (event.status ?? 'PUBLISHED') === 'DRAFT'
    const viewerGuestInvite = viewerId ? (event.guestSpeakerInvites ?? []).find((invite) => invite.userId === viewerId) ?? null : null
    const viewerSponsorInvite = viewerId
      ? (event.sponsorInvites ?? []).find(
          (invite) => Array.isArray(invite.recipientUserIds) && invite.recipientUserIds.includes(viewerId),
        ) ?? null
      : null
    const isDraftGuestInvitee = Boolean(
      viewerGuestInvite && (viewerGuestInvite.status === 'PENDING' || viewerGuestInvite.status === 'ACCEPTED'),
    )
    const isDraftSponsorInvitee = Boolean(
      viewerSponsorInvite && (viewerSponsorInvite.status === 'PENDING' || viewerSponsorInvite.status === 'ACCEPTED'),
    )
    const hasExistingRsvp = Boolean(viewerId && system.eventRsvps.some((row) => row.eventId === event.id && row.userId === viewerId))
    const canViewDraft = Boolean(viewerId && (org.ownerId === viewerId || isDraftGuestInvitee || isDraftSponsorInvitee || hasExistingRsvp))

    if (isDraft && !canViewDraft) {
      return reply.code(404).send({ error: 'event_not_found' })
    }

    if (event.access === 'RESTRICTED' && !isDraft) {
      const viewerMember = viewerId ? system.members[viewerId] ?? null : null
      if (!viewerId || !viewerMember || viewerMember.status !== 'ACTIVE') {
        return reply.code(403).send({ error: 'restricted_event' })
      }
      if (event.eligibleRankIds.length > 0 && !event.eligibleRankIds.includes(viewerMember.rankId)) {
        return reply.code(403).send({ error: 'rank_not_eligible' })
      }
    }

    const eventRsvps = system.eventRsvps.filter((row) => row.eventId === event.id)
    const feeGoingCounts = new Map<string, number>()
    for (const row of eventRsvps) {
      if (row.status !== 'GOING') continue
      const ticketId = row.ticketId ?? null
      if (!ticketId) continue
      feeGoingCounts.set(ticketId, (feeGoingCounts.get(ticketId) ?? 0) + 1)
    }
    const viewerRsvp = viewerId ? eventRsvps.find((row) => row.userId === viewerId) ?? null : null
    const goingCount = eventRsvps.filter((row) => row.status === 'GOING').length
    const interestedCount = eventRsvps.filter((row) => row.status === 'INTERESTED').length

    let viewerInvitation:
      | {
          kind: 'guest_speaker' | 'sponsor'
          status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
          notificationId: string | null
          inviter: ReturnType<typeof formatFriendUser> | null
        }
      | null = null

    if (viewerId && (viewerGuestInvite || viewerSponsorInvite)) {
      const invitationKind = viewerGuestInvite ? 'guest_speaker' : 'sponsor'
      const invitationStatus = (viewerGuestInvite?.status ?? viewerSponsorInvite?.status ?? 'PENDING') as 'PENDING' | 'ACCEPTED' | 'DECLINED'

      const notification = await prisma.notification.findFirst({
        where: {
          userId: viewerId,
          type:
            invitationKind === 'guest_speaker'
              ? EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE
              : EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE,
          payload: {
            path: ['eventId'],
            equals: event.id,
          },
        },
        orderBy: { createdAt: 'desc' },
        select: NOTIFICATION_SELECT,
      })

      const inviter = notification?.actorId
        ? await prisma.user.findUnique({ where: { id: notification.actorId }, select: FRIEND_USER_SELECT })
        : null

      viewerInvitation = {
        kind: invitationKind,
        status: invitationStatus,
        notificationId: invitationStatus === 'PENDING' ? notification?.id ?? null : null,
        inviter: inviter ? formatFriendUser(inviter) : null,
      }
    }

    return reply.send({
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        category: event.category ?? 'Other',
        access: event.access,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        capacity: event.capacity,
        paid: event.paid,
        priceCents: event.priceCents,
        currency: event.currency,
        guestSpeakers: event.guestSpeakers,
        guestSpeakerInvites: (event.guestSpeakerInvites ?? []).map((invite) => ({
          userId: invite.userId,
          name: invite.name,
          handle: invite.handle,
          avatarUrl: normalizeMediaUrl(invite.avatarUrl ?? null),
          coverUrl: normalizeMediaUrl(invite.coverUrl ?? null),
          status: invite.status,
        })),
        sponsors: event.sponsors ?? [],
        sponsorInvites: (event.sponsorInvites ?? []).map((invite) => ({
          organizationId: invite.organizationId,
          name: invite.name,
          slug: invite.slug,
          provinceCode: invite.provinceCode,
          communitySlug: invite.communitySlug,
          logoUrl: normalizeMediaUrl(invite.logoUrl ?? null),
          coverUrl: normalizeMediaUrl(invite.coverUrl ?? null),
          status: invite.status,
        })),
        fees: (event.fees ?? []).map((fee) => {
          const goingCountForFee = feeGoingCounts.get(fee.id) ?? 0
          const remainingCount = typeof fee.capacity === 'number' && fee.capacity > 0 ? Math.max(0, fee.capacity - goingCountForFee) : null
          return {
            id: fee.id,
            label: fee.label,
            amountCents: fee.amountCents,
            capacity: fee.capacity ?? null,
            cashOnly: fee.cashOnly !== false,
            goingCount: goingCountForFee,
            remainingCount,
          }
        }),
        primaryPhotoUrl: event.primaryPhotoUrl,
        galleryPhotoUrls: event.galleryPhotoUrls,
        status: event.status ?? 'PUBLISHED',
        createdAt: event.createdAt,
        updatedAt: event.updatedAt ?? event.createdAt,
      },
      viewerRsvp: viewerRsvp
        ? {
            id: viewerRsvp.id,
            status: viewerRsvp.status,
            ticketId: viewerRsvp.ticketId ?? null,
            ticketLabel: viewerRsvp.ticketLabel ?? null,
            amountCents: typeof viewerRsvp.amountCents === 'number' ? viewerRsvp.amountCents : null,
            message: viewerRsvp.message ?? null,
            createdAt: viewerRsvp.createdAt,
            updatedAt: viewerRsvp.updatedAt ?? viewerRsvp.createdAt,
          }
        : null,
      rsvpSummary: {
        goingCount,
        interestedCount,
      },
      viewerInvitation,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        isVerified: org.isVerified,
      },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/economics', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEconomicsRecordBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_membership_plans')) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (body.data.kind === 'event') {
      if (!body.data.eventId) return reply.code(400).send({ error: 'event_id_required' })
      if (!current.events.some((item) => item.id === body.data.eventId)) {
        return reply.code(404).send({ error: 'event_not_found' })
      }
    }

    const record: OrgEconomicRecord = {
      id: `eco_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      kind: body.data.kind,
      amountCents: body.data.amountCents,
      currency: body.data.currency.toUpperCase(),
      memberUserId: body.data.memberUserId ?? null,
      eventId: body.data.eventId ?? null,
      note: body.data.note ?? null,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      economics: [...current.economics, record],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'view_audit_logs')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const activeMembers = Object.values(system.members).filter((member) => member.status === 'ACTIVE').length
    const pendingMembers = Object.values(system.members).filter((member) => member.status === 'PENDING').length
    const totalRevenueCents = system.economics.reduce((sum, item) => sum + item.amountCents, 0)
    const paidEvents = system.events.filter((event) => event.paid).length
    const totalRsvps = system.eventRsvps.length
    const goingRsvps = system.eventRsvps.filter((item) => item.status === 'GOING').length
    const topReputation = Object.entries(system.members)
      .map(([userId, member]) => ({ userId, reputation: member.reputation }))
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMemberStatusBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    const previous = current.members[params.data.userId] ?? null

    const wantsRemoval = body.data.status === 'BANNED' || body.data.status === 'SUSPENDED'
    if (wantsRemoval && !canOrganizationPermission(permissions, 'remove_members')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nextRankIdRaw = body.data.rankId ?? null
    const nextRankId = nextRankIdRaw === null ? previous?.rankId ?? SYSTEM_MEMBER_RANK_ID : nextRankIdRaw
    const rankChanged = Boolean(nextRankId && nextRankId !== (previous?.rankId ?? SYSTEM_MEMBER_RANK_ID))

    if (rankChanged) {
      const canChangeRank =
        canOrganizationPermission(permissions, 'promote_members') ||
        canOrganizationPermission(permissions, 'demote_members') ||
        canOrganizationPermission(permissions, 'create_ranks')
      if (!canChangeRank) {
        return reply.code(403).send({ error: 'forbidden' })
      }
    }

    // For non-removal status updates (eg approvals), require approve_members.
    if (!wantsRemoval && body.data.status !== (previous?.status ?? 'PENDING')) {
      if (!canOrganizationPermission(permissions, 'approve_members')) {
        return reply.code(403).send({ error: 'forbidden' })
      }
    }

    const fallbackRankId = nextRankId
    const nextMemberState: OrgMemberState = {
      rankId: fallbackRankId,
      planId: body.data.planId ?? previous?.planId ?? null,
      status: body.data.status,
      referredByUserId: previous?.referredByUserId ?? null,
      reputation: previous?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      members: {
        ...current.members,
        [params.data.userId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
    const canView =
      canOrganizationPermission(permissions, 'approve_members') ||
      canOrganizationPermission(permissions, 'remove_members') ||
      canOrganizationPermission(permissions, 'promote_members') ||
      canOrganizationPermission(permissions, 'demote_members')
    if (!canView) return reply.code(403).send({ error: 'forbidden' })

    const [owner, managers, followers] = await Promise.all([
      prisma.user.findUnique({ where: { id: org.ownerId }, select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true } }),
      prisma.businessMembership.findMany({
        where: { businessId: org.id, userId: { not: org.ownerId } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true } },
        },
      }),
      prisma.businessFollow.findMany({
        where: { businessId: org.id, userId: { not: org.ownerId } },
        orderBy: { createdAt: 'asc' },
        select: {
          userId: true,
          createdAt: true,
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true } },
        },
      }),
    ])

    const managerIds = new Set(managers.map((row: { userId: string }) => row.userId))

    const items = [
      ...(owner
        ? [
            {
              userId: owner.id,
              membershipRole: 'OWNER' as const,
              joinedAt: null,
              user: {
                id: owner.id,
                handle: owner.handle,
                name: owner.name,
                avatarUrl: normalizeMediaUrl(owner.avatarUrl ?? null),
                coverUrl: normalizeMediaUrl(owner.coverUrl ?? null),
                isPremium: isPremium(owner.premiumStatus),
                isVerified: isPremium(owner.premiumStatus),
              },
              memberState:
                system.members[owner.id] ??
                ({
                  rankId: SYSTEM_MANAGER_RANK_ID,
                  planId: null,
                  status: 'ACTIVE',
                  referredByUserId: null,
                  reputation: 0,
                  updatedAt: new Date().toISOString(),
                } as OrgMemberState),
            },
          ]
        : []),
      ...managers.map(
        (row: {
          userId: string
          role: BusinessRole
          createdAt: Date
          user: {
            id: string
            handle: string
            name: string | null
            avatarUrl: string | null
            coverUrl: string | null
            premiumStatus: PremiumStatus | null
          }
        }) => ({
          userId: row.userId,
          membershipRole: row.role,
          joinedAt: row.createdAt,
          user: {
            id: row.user.id,
            handle: row.user.handle,
            name: row.user.name,
            avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
            coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
            isPremium: isPremium(row.user.premiumStatus),
            isVerified: isPremium(row.user.premiumStatus),
          },
          memberState: system.members[row.userId] ?? null,
        }),
      ),
      ...followers
        .filter((row: { userId: string }) => !managerIds.has(row.userId))
        .map(
          (row: {
            userId: string
            createdAt: Date
            user: {
              id: string
              handle: string
              name: string | null
              avatarUrl: string | null
              coverUrl: string | null
              premiumStatus: PremiumStatus | null
            }
          }) => ({
            userId: row.userId,
            membershipRole: 'FOLLOWER' as const,
            joinedAt: row.createdAt,
            user: {
              id: row.user.id,
              handle: row.user.handle,
              name: row.user.name,
              avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
              coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
              isPremium: isPremium(row.user.premiumStatus),
              isVerified: isPremium(row.user.premiumStatus),
            },
            memberState: system.members[row.userId] ?? null,
          }),
        ),
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMemberModerationBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

    const previous = current.members[params.data.userId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: previous?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: previous?.planId ?? null,
      status: 'SUSPENDED',
      referredByUserId: previous?.referredByUserId ?? null,
      reputation: previous?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      members: {
        ...current.members,
        [params.data.userId]: nextMemberState,
      },
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(tx, org.id, {
        actorUserId,
        action: 'member.kicked',
        reason: body.data.reason ?? null,
        previousValue: { userId: params.data.userId, member: previous },
        nextValue: { userId: params.data.userId, member: nextMemberState },
      })
    })

    await createNotificationRecord({
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMemberModerationBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

    const previous = current.members[params.data.userId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: previous?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: previous?.planId ?? null,
      status: 'BANNED',
      referredByUserId: previous?.referredByUserId ?? null,
      reputation: previous?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      members: {
        ...current.members,
        [params.data.userId]: nextMemberState,
      },
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(tx, org.id, {
        actorUserId,
        action: 'member.banned',
        reason: body.data.reason ?? null,
        previousValue: { userId: params.data.userId, member: previous },
        nextValue: { userId: params.data.userId, member: nextMemberState },
      })
    })

    await createNotificationRecord({
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
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const query = CommunityOrgGovernanceQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
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

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'view_audit_logs')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const entries = [...system.auditLog].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const start = query.data.cursor ? entries.findIndex((entry) => entry.id === query.data.cursor) + 1 : 0
    const items = entries.slice(Math.max(start, 0), Math.max(start, 0) + query.data.limit)
    const nextCursor = items.length === query.data.limit ? items[items.length - 1]?.id ?? null : null

    return reply.send({ items, nextCursor })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/shop', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const viewerId = (await resolveUserId(req)) ?? undefined
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, status: true, name: true, slug: true, provinceCode: true, communitySlug: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const [membership, follow] = viewerId
      ? await Promise.all([
          prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId: viewerId } }, select: { role: true } }),
          prisma.businessFollow.findUnique({ where: { businessId_userId: { businessId: org.id, userId: viewerId } }, select: { id: true } }),
        ])
      : [null, null]

    const isOwner = viewerId ? org.ownerId === viewerId : false
    const canManage = Boolean(isOwner || membership?.role === 'MANAGER' || membership?.role === 'OWNER')
    const isAssociated = Boolean(canManage || follow)
    if (org.status !== 'ACTIVE' && !isAssociated) {
      return reply.code(404).send({ error: 'organization_not_found' })
    }

    const includePrivateShopData = canManage

    await ensureOrganizationShopTables()

    type ShopSettingsRow = {
      business_id: string
      head_office_address: string | null
      warehouse_same_as_head_office: boolean
      direct_deposit_transit: string | null
      direct_deposit_institution: string | null
      direct_deposit_account: string | null
    }

    type ShopWarehouseRow = {
      id: string
      business_id: string
      name: string
      address: string | null
      is_head_office: boolean
      created_at: Date
      updated_at: Date
    }

    type ShopProductRow = {
      id: string
      business_id: string
      catalog_id: string | null
      name: string
      description: string | null
      featured_homepage: boolean
      tax_collect: boolean
      tax_rates_by_region: unknown
      price_cents: number
      currency: string
      sku: string | null
      primary_image_url: string | null
      gallery_image_urls: unknown
      fulfillment_type: string
      digital_delivery_url: string | null
      weight_grams: number | null
      shipping_policy: string
      allow_shipping_contracts: boolean
      is_draft: boolean
      is_active: boolean
      track_inventory: boolean
      created_at: Date
      updated_at: Date
      inventory_total: bigint | number | null
    }

    type ShopInventoryRow = {
      product_id: string
      warehouse_id: string
      quantity: number
      updated_at: Date
    }

    type ShopCatalogRow = {
      id: string
      business_id: string
      title: string
      description: string | null
      image_url: string | null
      sort_order: number
      enabled: boolean
      created_at: Date
      updated_at: Date
    }

    const [settingsRows, warehouseRows, catalogRows, productRows, inventoryRows] = await Promise.all([
      includePrivateShopData
        ? prisma.$queryRaw<ShopSettingsRow[]>`
            SELECT business_id, head_office_address, warehouse_same_as_head_office, direct_deposit_transit, direct_deposit_institution, direct_deposit_account
            FROM organization_shop_settings
            WHERE business_id = ${org.id}
            LIMIT 1
          `
        : Promise.resolve([] as ShopSettingsRow[]),
      includePrivateShopData
        ? prisma.$queryRaw<ShopWarehouseRow[]>`
            SELECT id, business_id, name, address, is_head_office, created_at, updated_at
            FROM organization_shop_warehouse
            WHERE business_id = ${org.id}
            ORDER BY is_head_office DESC, created_at ASC
          `
        : Promise.resolve([] as ShopWarehouseRow[]),
      prisma.$queryRaw<ShopCatalogRow[]>`
        SELECT id, business_id, title, description, image_url, sort_order, enabled, created_at, updated_at
        FROM organization_shop_catalog
        WHERE business_id = ${org.id}
        ORDER BY sort_order ASC, created_at ASC
      `,
      includePrivateShopData
        ? prisma.$queryRaw<ShopProductRow[]>`
            SELECT
              p.id,
              p.business_id,
              p.catalog_id,
              p.name,
              p.description,
              p.featured_homepage,
              p.tax_collect,
              p.tax_rates_by_region,
              p.price_cents,
              p.currency,
              p.sku,
              p.primary_image_url,
              p.gallery_image_urls,
              p.fulfillment_type,
              p.digital_delivery_url,
              p.weight_grams,
              p.shipping_policy,
              p.allow_shipping_contracts,
              p.is_draft,
              p.is_active,
              p.track_inventory,
              p.created_at,
              p.updated_at,
              COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total
            FROM organization_shop_product p
            LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
            WHERE p.business_id = ${org.id}
            GROUP BY p.id
            ORDER BY p.created_at DESC
          `
        : prisma.$queryRaw<ShopProductRow[]>`
            SELECT
              p.id,
              p.business_id,
              p.catalog_id,
              p.name,
              p.description,
              p.featured_homepage,
              p.tax_collect,
              p.tax_rates_by_region,
              p.price_cents,
              p.currency,
              p.sku,
              p.primary_image_url,
              p.gallery_image_urls,
              p.fulfillment_type,
              p.digital_delivery_url,
              p.weight_grams,
              p.shipping_policy,
              p.allow_shipping_contracts,
              p.is_draft,
              p.is_active,
              p.track_inventory,
              p.created_at,
              p.updated_at,
              COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total
            FROM organization_shop_product p
            LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
            LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
            WHERE p.business_id = ${org.id}
              AND p.is_active = TRUE
              AND p.is_draft = FALSE
              AND (p.catalog_id IS NULL OR c.enabled = TRUE)
            GROUP BY p.id
            ORDER BY p.created_at DESC
          `,
      includePrivateShopData
        ? prisma.$queryRaw<ShopInventoryRow[]>`
            SELECT i.product_id, i.warehouse_id, i.quantity, i.updated_at
            FROM organization_shop_inventory i
            INNER JOIN organization_shop_product p ON p.id = i.product_id
            WHERE p.business_id = ${org.id}
          `
        : Promise.resolve([] as ShopInventoryRow[]),
    ])

    const settings = settingsRows[0] ?? null
    const inventoryByProduct = new Map<string, Array<{ warehouseId: string; quantity: number; updatedAt: string }>>()
    for (const row of inventoryRows) {
      const current = inventoryByProduct.get(row.product_id) ?? []
      current.push({ warehouseId: row.warehouse_id, quantity: Number(row.quantity) || 0, updatedAt: row.updated_at.toISOString() })
      inventoryByProduct.set(row.product_id, current)
    }

    const publicCatalogs: ShopCatalogRow[] = []
    if (includePrivateShopData) {
      publicCatalogs.push(...catalogRows)
    } else {
      for (const row of catalogRows) {
        if (row.enabled) publicCatalogs.push(row)
      }
    }

    return reply.send({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        province: org.provinceCode?.toLowerCase() ?? null,
        municipality: org.communitySlug ?? null,
      },
      canManage,
      settings: includePrivateShopData
        ? {
            headOfficeAddress: settings?.head_office_address ?? null,
            warehouseSameAsHeadOffice: settings ? Boolean(settings.warehouse_same_as_head_office) : true,
            directDepositTransit: settings?.direct_deposit_transit ?? null,
            directDepositInstitution: settings?.direct_deposit_institution ?? null,
            directDepositAccount: settings?.direct_deposit_account ?? null,
          }
        : undefined,
      warehouses: warehouseRows.map((row: ShopWarehouseRow) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        isHeadOffice: row.is_head_office,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      catalogs: publicCatalogs.map((row: ShopCatalogRow) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        imageUrl: row.image_url,
        sortOrder: Number(row.sort_order) || 0,
        enabled: row.enabled,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      products: productRows.map((row: ShopProductRow) => ({
        id: row.id,
        catalogId: row.catalog_id,
        name: row.name,
        description: row.description,
        featuredHomepage: row.featured_homepage,
        taxCollect: row.tax_collect,
        taxRatesByRegion:
          row.tax_rates_by_region && typeof row.tax_rates_by_region === 'object' && !Array.isArray(row.tax_rates_by_region)
            ? (row.tax_rates_by_region as Record<string, unknown>)
            : {},
        priceCents: Number(row.price_cents) || 0,
        currency: row.currency,
        sku: row.sku,
        primaryImageUrl: row.primary_image_url,
        galleryImageUrls: Array.isArray(row.gallery_image_urls)
          ? row.gallery_image_urls.filter((value): value is string => typeof value === 'string')
          : [],
        fulfillmentType: row.fulfillment_type,
        digitalDeliveryUrl: includePrivateShopData ? row.digital_delivery_url : undefined,
        weightGrams: row.weight_grams,
        shippingPolicy: row.shipping_policy,
        allowShippingContracts: row.allow_shipping_contracts,
        isDraft: row.is_draft,
        isActive: row.is_active,
        trackInventory: row.track_inventory,
        inventoryTotal: Number(row.inventory_total ?? 0) || 0,
        inventoryByWarehouse: includePrivateShopData ? inventoryByProduct.get(row.id) ?? [] : [],
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/shop/settings', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopSettingsBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, address: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const headOfficeAddress = body.data.headOfficeAddress ?? null
    const warehouseSameAsHeadOffice =
      typeof body.data.warehouseSameAsHeadOffice === 'boolean' ? body.data.warehouseSameAsHeadOffice : true

    await prisma.$executeRaw`
      INSERT INTO organization_shop_settings (business_id, head_office_address, warehouse_same_as_head_office, direct_deposit_transit, direct_deposit_institution, direct_deposit_account, updated_at)
      VALUES (${org.id}, ${headOfficeAddress}, ${warehouseSameAsHeadOffice}, ${body.data.directDepositTransit ?? null}, ${body.data.directDepositInstitution ?? null}, ${body.data.directDepositAccount ?? null}, NOW())
      ON CONFLICT (business_id)
      DO UPDATE SET
        head_office_address = EXCLUDED.head_office_address,
        warehouse_same_as_head_office = EXCLUDED.warehouse_same_as_head_office,
        direct_deposit_transit = EXCLUDED.direct_deposit_transit,
        direct_deposit_institution = EXCLUDED.direct_deposit_institution,
        direct_deposit_account = EXCLUDED.direct_deposit_account,
        updated_at = NOW()
    `

    if (warehouseSameAsHeadOffice) {
      const existingHeadOffice = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organization_shop_warehouse
        WHERE business_id = ${org.id} AND is_head_office = TRUE
        LIMIT 1
      `
      const resolvedAddress = headOfficeAddress ?? org.address ?? null
      if (existingHeadOffice[0]) {
        await prisma.$executeRaw`
          UPDATE organization_shop_warehouse
          SET address = ${resolvedAddress}, updated_at = NOW()
          WHERE id = ${existingHeadOffice[0].id}
        `
      } else {
        await prisma.$executeRaw`
          INSERT INTO organization_shop_warehouse (id, business_id, name, address, is_head_office)
          VALUES (${randomUUID()}, ${org.id}, ${'Head Office Warehouse'}, ${resolvedAddress}, TRUE)
        `
      }
    }

    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/shop/connect/account', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, name: true, websiteUrl: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const shopPayments = readOrganizationShopPaymentsState(org.metadata)
    if (shopPayments.stripeConnectAccountId) {
      return reply.send({ accountId: shopPayments.stripeConnectAccountId })
    }

    const stripe = getStripeClient()

    const owner = await prisma.user.findUnique({ where: { id: org.ownerId }, select: { email: true } })
    const ownerEmail = owner?.email ?? null

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'CA',
      email: ownerEmail ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        name: org.name,
        url: org.websiteUrl ?? undefined,
      },
      metadata: {
        civilBusinessId: org.id,
        civilCommunity: community.slug,
        civilProvince: province,
      },
    })

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationShopPaymentsStateIntoMetadata(org.metadata, { stripeConnectAccountId: account.id }) },
      select: { id: true },
    })

    return reply.send({ accountId: account.id })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/shop/connect/onboard', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, slug: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const shopPayments = readOrganizationShopPaymentsState(org.metadata)
    if (!shopPayments.stripeConnectAccountId) {
      return reply.code(409).send({ error: 'connect_account_missing' })
    }

    const stripe = getStripeClient()

    const managePath = `/com/${encodeURIComponent(province.toLowerCase())}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(
      org.slug,
    )}/shop/manage`
    const refreshUrl = `https://${CIVIL_PUBLIC_HOST}${managePath}?connect=refresh`
    const returnUrl = `https://${CIVIL_PUBLIC_HOST}${managePath}?connect=return`

    const link = await stripe.accountLinks.create({
      account: shopPayments.stripeConnectAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    })

    return reply.send({ url: link.url })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/shop/connect/status', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const shopPayments = readOrganizationShopPaymentsState(org.metadata)
    if (!shopPayments.stripeConnectAccountId) {
      return reply.send({ accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false })
    }

    const stripe = getStripeClient()
    const account = await stripe.accounts.retrieve(shopPayments.stripeConnectAccountId)

    return reply.send({
      accountId: shopPayments.stripeConnectAccountId,
      chargesEnabled: Boolean((account as any).charges_enabled),
      payoutsEnabled: Boolean((account as any).payouts_enabled),
      detailsSubmitted: Boolean((account as any).details_submitted),
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/shop/warehouses', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopWarehouseCreateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const normalizedAddress = [
      body.data.address.line1.trim(),
      body.data.address.line2?.trim() || null,
      `${body.data.address.city.trim()}, ${body.data.address.province.trim()} ${body.data.address.postalCode.trim()}`,
      body.data.address.country.trim().toUpperCase(),
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n')

    const warehouseId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO organization_shop_warehouse (id, business_id, name, address, is_head_office)
      VALUES (${warehouseId}, ${org.id}, ${body.data.name.trim()}, ${normalizedAddress}, FALSE)
    `

    return reply.code(201).send({ warehouse: { id: warehouseId, name: body.data.name.trim(), address: normalizedAddress, isHeadOffice: false } })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/shop/catalogs', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopCatalogCreateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const catalogDescription = body.data.description?.trim() ? sanitizePlainText(body.data.description).trim() : null

    const catalogId = randomUUID()
    const sortOrderRows = await prisma.$queryRaw<Array<{ next_sort_order: number | null }>>`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
      FROM organization_shop_catalog
      WHERE business_id = ${org.id}
    `
    const nextSortOrder = Number(sortOrderRows[0]?.next_sort_order ?? 0)
    await prisma.$executeRaw`
      INSERT INTO organization_shop_catalog (id, business_id, title, description, image_url, sort_order, enabled, updated_at)
      VALUES (${catalogId}, ${org.id}, ${body.data.title.trim()}, ${catalogDescription}, ${body.data.imageUrl ?? null}, ${nextSortOrder}, ${body.data.enabled}, NOW())
    `

    return reply.code(201).send({
      catalog: {
        id: catalogId,
        title: body.data.title.trim(),
        description: catalogDescription,
        imageUrl: body.data.imageUrl ?? null,
        enabled: body.data.enabled,
      },
    })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/shop/catalogs/:catalogId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgShopCatalogParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopCatalogUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const catalogRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM organization_shop_catalog
      WHERE id = ${params.data.catalogId} AND business_id = ${org.id}
      LIMIT 1
    `
    if (!catalogRows[0]) return reply.code(404).send({ error: 'catalog_not_found' })

    const nextCatalogDescription =
      'description' in body.data ? (body.data.description?.trim() ? sanitizePlainText(body.data.description).trim() : null) : null

    await prisma.$executeRaw`
      UPDATE organization_shop_catalog
      SET title = COALESCE(${body.data.title?.trim() ?? null}, title),
          description = CASE WHEN ${'description' in body.data} THEN ${nextCatalogDescription} ELSE description END,
          image_url = CASE WHEN ${'imageUrl' in body.data} THEN ${body.data.imageUrl ?? null} ELSE image_url END,
          enabled = COALESCE(${typeof body.data.enabled === 'boolean' ? body.data.enabled : null}, enabled),
          updated_at = NOW()
      WHERE id = ${params.data.catalogId}
    `

    return reply.send({ success: true })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/shop/catalogs/reorder', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopCatalogReorderBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM organization_shop_catalog
      WHERE business_id = ${org.id}
    `

    const existingIds = new Set(existingRows.map((row: { id: string }) => row.id))
    const incomingIds = body.data.catalogIds
    const uniqueIncomingIds = Array.from(new Set(incomingIds))
    if (uniqueIncomingIds.length !== incomingIds.length) {
      return reply.code(400).send({ error: 'invalid_catalog_order' })
    }
    if (existingIds.size !== uniqueIncomingIds.length) {
      return reply.code(400).send({ error: 'invalid_catalog_order' })
    }
    if (uniqueIncomingIds.some((catalogId) => !existingIds.has(catalogId))) {
      return reply.code(400).send({ error: 'invalid_catalog_order' })
    }

    await prisma.$transaction(
      uniqueIncomingIds.map((catalogId, index) =>
        prisma.$executeRaw`
          UPDATE organization_shop_catalog
          SET sort_order = ${index},
              updated_at = NOW()
          WHERE id = ${catalogId}
            AND business_id = ${org.id}
        `,
      ),
    )

    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/shop/products/draft', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const productId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO organization_shop_product (
        id, business_id, name, description, price_cents, currency, sku,
        primary_image_url, gallery_image_urls, weight_grams, shipping_policy,
        allow_shipping_contracts, featured_homepage, tax_collect, tax_rates_by_region, is_draft, is_active, track_inventory, created_by
      )
      VALUES (
        ${productId}, ${org.id}, ${'Draft Product'}, ${null}, ${0}, ${'CAD'}, ${null},
        ${null}, ${JSON.stringify([])}::jsonb, ${null}, ${'local_community'},
        ${false}, ${false}, ${false}, ${JSON.stringify({})}::jsonb, ${true}, ${true}, ${true}, ${userId}
      )
    `

    return reply.code(201).send({ product: { id: productId, isDraft: true } })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgShopProductParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopProductUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const productRows = await prisma.$queryRaw<Array<{ id: string; fulfillment_type: string; digital_delivery_url: string | null }>>`
      SELECT id, fulfillment_type, digital_delivery_url FROM organization_shop_product
      WHERE id = ${params.data.productId} AND business_id = ${org.id}
      LIMIT 1
    `
    if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })

    const fulfillmentProvided = Object.prototype.hasOwnProperty.call(body.data, 'fulfillmentType')
    const digitalUrlProvided = Object.prototype.hasOwnProperty.call(body.data, 'digitalDeliveryUrl')
    const hasDigitalUpdate = fulfillmentProvided || digitalUrlProvided

    const existingFulfillment = String(productRows[0].fulfillment_type || 'physical').toLowerCase()
    const nextFulfillmentType = fulfillmentProvided ? String(body.data.fulfillmentType || 'physical').toLowerCase() : existingFulfillment
    let nextDigitalDeliveryUrl = digitalUrlProvided
      ? (body.data.digitalDeliveryUrl?.trim() ? body.data.digitalDeliveryUrl.trim() : null)
      : (productRows[0].digital_delivery_url ?? null)
    if (nextFulfillmentType !== 'digital') nextDigitalDeliveryUrl = null

    if (typeof body.data.isDraft === 'boolean' && body.data.isDraft === false) {
      if (nextFulfillmentType === 'digital' && !nextDigitalDeliveryUrl) {
        return reply.code(400).send({ error: 'digital_delivery_url_required' })
      }
    }

    const nextProductDescription =
      'description' in body.data ? (body.data.description?.trim() ? sanitizePlainText(body.data.description).trim() : null) : null

    const catalogProvided = Object.prototype.hasOwnProperty.call(body.data, 'catalogId')
    let resolvedCatalogId: string | null | undefined = undefined
    if (catalogProvided) {
      if (body.data.catalogId == null) {
        resolvedCatalogId = null
      } else {
        const catalogRows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM organization_shop_catalog
          WHERE id = ${body.data.catalogId} AND business_id = ${org.id}
          LIMIT 1
        `
        if (!catalogRows[0]) return reply.code(400).send({ error: 'invalid_catalog' })
        resolvedCatalogId = catalogRows[0].id
      }
    }

    await prisma.$executeRaw`
      UPDATE organization_shop_product
      SET catalog_id = CASE WHEN ${catalogProvided} THEN ${resolvedCatalogId ?? null} ELSE catalog_id END,
          name = COALESCE(${body.data.name?.trim() ?? null}, name),
          description = CASE WHEN ${'description' in body.data} THEN ${nextProductDescription} ELSE description END,
          featured_homepage = COALESCE(${typeof body.data.featuredHomepage === 'boolean' ? body.data.featuredHomepage : null}, featured_homepage),
          tax_collect = COALESCE(${typeof body.data.taxCollect === 'boolean' ? body.data.taxCollect : null}, tax_collect),
          tax_rates_by_region = CASE
            WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'taxRatesByRegion')} THEN ${JSON.stringify(body.data.taxRatesByRegion ?? {})}::jsonb
            ELSE tax_rates_by_region
          END,
          price_cents = COALESCE(${body.data.priceCents ?? null}, price_cents),
          currency = COALESCE(${body.data.currency?.toUpperCase() ?? null}, currency),
          sku = CASE WHEN ${'sku' in body.data} THEN ${body.data.sku ?? null} ELSE sku END,
          fulfillment_type = CASE WHEN ${fulfillmentProvided} THEN ${nextFulfillmentType} ELSE fulfillment_type END,
          digital_delivery_url = CASE WHEN ${hasDigitalUpdate} THEN ${nextDigitalDeliveryUrl} ELSE digital_delivery_url END,
          track_inventory = COALESCE(${typeof body.data.trackInventory === 'boolean' ? body.data.trackInventory : null}, track_inventory),
          weight_grams = CASE WHEN ${'weightGrams' in body.data} THEN ${body.data.weightGrams ?? null} ELSE weight_grams END,
          shipping_policy = COALESCE(${body.data.shippingPolicy ?? null}, shipping_policy),
          allow_shipping_contracts = COALESCE(${typeof body.data.allowShippingContracts === 'boolean' ? body.data.allowShippingContracts : null}, allow_shipping_contracts),
          is_draft = COALESCE(${typeof body.data.isDraft === 'boolean' ? body.data.isDraft : null}, is_draft),
          updated_at = NOW()
      WHERE id = ${params.data.productId}
    `

    return reply.send({ success: true })
  }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/shop/products/:productId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgShopProductParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM organization_shop_product
      WHERE id = ${params.data.productId} AND business_id = ${org.id}
      LIMIT 1
    `
    if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })

    await prisma.$executeRaw`
      UPDATE organization_shop_product
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE id = ${params.data.productId}
        AND business_id = ${org.id}
    `

    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/shop/products', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopProductCreateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, address: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const productId = randomUUID()
    const priceCents = body.data.priceCents
    const currency = body.data.currency.toUpperCase()
    const fulfillmentType = body.data.fulfillmentType
    const digitalDeliveryUrl = body.data.digitalDeliveryUrl?.trim() ? body.data.digitalDeliveryUrl.trim() : null
    if (fulfillmentType === 'digital' && !digitalDeliveryUrl) {
      return reply.code(400).send({ error: 'digital_delivery_url_required' })
    }
    const productDescription = body.data.description?.trim() ? sanitizePlainText(body.data.description).trim() : null
    const galleryImageUrls = body.data.galleryImageUrls ?? []
    let resolvedCatalogId: string | null = null

    if (body.data.catalogId != null) {
      const catalogRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM organization_shop_catalog
        WHERE id = ${body.data.catalogId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!catalogRows[0]) return reply.code(400).send({ error: 'invalid_catalog' })
      resolvedCatalogId = catalogRows[0].id
    }

    await prisma.$executeRaw`
      INSERT INTO organization_shop_product (
        id, business_id, catalog_id, name, description, price_cents, currency, sku,
        primary_image_url, gallery_image_urls, weight_grams, shipping_policy,
        allow_shipping_contracts, featured_homepage, tax_collect, tax_rates_by_region, fulfillment_type, digital_delivery_url, is_draft, is_active, track_inventory, created_by
      )
      VALUES (
        ${productId}, ${org.id}, ${resolvedCatalogId}, ${body.data.name.trim()}, ${productDescription}, ${priceCents}, ${currency}, ${body.data.sku ?? null},
        ${body.data.primaryImageUrl ?? null}, ${JSON.stringify(galleryImageUrls)}::jsonb, ${body.data.weightGrams ?? null}, ${body.data.shippingPolicy},
        ${body.data.allowShippingContracts}, ${body.data.featuredHomepage}, ${body.data.taxCollect}, ${JSON.stringify(body.data.taxRatesByRegion ?? {})}::jsonb, ${fulfillmentType}, ${fulfillmentType === 'digital' ? digitalDeliveryUrl : null}, ${false}, ${true}, ${body.data.trackInventory}, ${userId}
      )
    `

    if (body.data.trackInventory && body.data.initialInventory > 0) {
      const headOfficeWarehouseRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM organization_shop_warehouse
        WHERE business_id = ${org.id}
        ORDER BY is_head_office DESC, created_at ASC
        LIMIT 1
      `

      let warehouseId = headOfficeWarehouseRows[0]?.id
      if (!warehouseId) {
        warehouseId = randomUUID()
        await prisma.$executeRaw`
          INSERT INTO organization_shop_warehouse (id, business_id, name, address, is_head_office)
          VALUES (${warehouseId}, ${org.id}, ${'Head Office Warehouse'}, ${org.address ?? null}, TRUE)
        `
      }

      await prisma.$executeRaw`
        INSERT INTO organization_shop_inventory (product_id, warehouse_id, quantity, updated_at)
        VALUES (${productId}, ${warehouseId}, ${body.data.initialInventory}, NOW())
        ON CONFLICT (product_id, warehouse_id)
        DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
      `
    }

    return reply.code(201).send({ product: { id: productId } })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/inventory', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgShopProductParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopInventoryUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organization_shop_product
      WHERE id = ${params.data.productId} AND business_id = ${org.id}
      LIMIT 1
    `
    if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })

    const warehouseIds = body.data.quantities.map((entry) => entry.warehouseId)
    const warehouseRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organization_shop_warehouse
      WHERE business_id = ${org.id} AND id IN (${Prisma.join(warehouseIds)})
    `
    const warehouseIdSet = new Set(warehouseRows.map((row: { id: string }) => row.id))
    const invalidWarehouse = warehouseIds.find((warehouseId) => !warehouseIdSet.has(warehouseId))
    if (invalidWarehouse) return reply.code(400).send({ error: 'invalid_warehouse' })

    await prisma.$transaction(
      body.data.quantities.map((entry) =>
        prisma.$executeRaw`
          INSERT INTO organization_shop_inventory (product_id, warehouse_id, quantity, updated_at)
          VALUES (${params.data.productId}, ${entry.warehouseId}, ${entry.quantity}, NOW())
          ON CONFLICT (product_id, warehouse_id)
          DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
        `,
      ),
    )

    return reply.send({ success: true })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/photos', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgShopProductParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgShopProductPhotosUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureOrganizationShopTables()

    const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM organization_shop_product
      WHERE id = ${params.data.productId} AND business_id = ${org.id}
      LIMIT 1
    `
    if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })

    const galleryImageUrls = body.data.galleryImageUrls ?? []
    await prisma.$executeRaw`
      UPDATE organization_shop_product
      SET primary_image_url = ${body.data.primaryImageUrl ?? null},
          gallery_image_urls = ${JSON.stringify(galleryImageUrls)}::jsonb,
          updated_at = NOW()
      WHERE id = ${params.data.productId}
    `

    return reply.send({ success: true })
  }),
)

const MarketProductsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(24),
  cursor: z.string().trim().min(1).max(256).optional(),
})

const MarketProductParams = z.object({
  productId: z.string().trim().min(1).max(128),
})

const MarketCheckoutBody = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(128),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(20),
  shippingAddress: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      line1: z.string().trim().min(1).max(120).optional(),
      line2: z.string().trim().max(120).optional().nullable(),
      city: z.string().trim().min(1).max(80).optional(),
      province: z.string().trim().min(1).max(80).optional(),
      postalCode: z.string().trim().min(1).max(32).optional(),
      country: z.string().trim().min(2).max(2).optional().default('CA'),
    })
    .optional()
    .nullable(),
})

const CANADA_TAX_REGION_CODES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'])
const CANADA_TAX_REGION_NAME_TO_CODE: Record<string, string> = {
  ALBERTA: 'AB',
  BRITISHCOLUMBIA: 'BC',
  MANITOBA: 'MB',
  NEWBRUNSWICK: 'NB',
  NEWFOUNDLANDANDLABRADOR: 'NL',
  NOVASCOTIA: 'NS',
  NORTHWESTTERRITORIES: 'NT',
  NUNAVUT: 'NU',
  ONTARIO: 'ON',
  PRINCEEDWARDISLAND: 'PE',
  QUEBEC: 'QC',
  SASKATCHEWAN: 'SK',
  YUKON: 'YT',
}

function parseTaxRatePct(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

function resolveTaxRegionCode(value: unknown): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  if (!normalized) return null
  if (CANADA_TAX_REGION_CODES.has(normalized)) return normalized

  const compact = normalized.replace(/[^A-Z]/g, '')
  return CANADA_TAX_REGION_NAME_TO_CODE[compact] ?? null
}

const MarketOrderParams = z.object({
  orderId: z.string().trim().min(1).max(128),
})

const MarketOrdersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
})

const MarketListingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
})

const MarketListingParams = z.object({
  listingId: z.string().trim().min(1).max(128),
})

const MarketChatThreadParams = z.object({
  threadId: z.string().cuid(),
})

const MarketSelectBuyerBody = z
  .object({
    threadId: z.string().cuid(),
  })
  .strict()

const MarketRelistBody = z
  .object({
    notify: z.boolean().optional().default(true),
  })
  .strict()

const MarketDeliveryOptionsSchema = z
  .object({
    short50km: z.coerce.number().int().min(0).max(500000000).optional(),
    medium100km: z.coerce.number().int().min(0).max(500000000).optional(),
    long250km: z.coerce.number().int().min(0).max(500000000).optional(),
  })
  .strict()

const MarketListingUpdateBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  priceCents: z.coerce.number().int().min(0).max(500000000).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  photoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  listingProvinceCode: z.string().trim().min(2).max(8).optional().nullable(),
  listingCommunitySlug: z.string().trim().min(1).max(120).optional().nullable(),
  pickupCity: z.string().trim().max(120).optional().nullable(),
  pickupProvince: z.string().trim().max(80).optional().nullable(),
  pickupAddressLine1: z.string().trim().max(180).optional().nullable(),
  pickupAddressLine2: z.string().trim().max(180).optional().nullable(),
  pickupPostalCode: z.string().trim().max(32).optional().nullable(),
  paymentTypes: z.array(z.enum(['cash_pickup', 'etransfer'])).max(2).optional(),
  willingToDeliver: z.boolean().optional(),
  deliveryOptions: MarketDeliveryOptionsSchema.optional().nullable(),
  eTransferEmail: z.string().trim().email().max(320).optional().nullable(),
  isDraft: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'pending_sale', 'sold', 'canceled']).optional(),
})

function parseMarketCursor(cursor: string | undefined): null | { createdAt: Date; id: string } {
  if (!cursor) return null
  const [createdAtRaw, id] = cursor.split('|')
  if (!createdAtRaw || !id) return null
  const createdAt = new Date(createdAtRaw)
  if (Number.isNaN(createdAt.getTime())) return null
  const trimmedId = id.trim()
  if (!trimmedId) return null
  return { createdAt, id: trimmedId }
}

function readGalleryUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const urls: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') urls.push(entry)
  }
  return urls
}

function readStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const values: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') values.push(entry)
  }
  return values
}

type MarketDeliveryOptions = {
  short50km?: number
  medium100km?: number
  long250km?: number
}

function readDeliveryOptions(raw: unknown): MarketDeliveryOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const typed = raw as Record<string, unknown>
  const options: MarketDeliveryOptions = {}

  const short50km = typed.short50km
  if (typeof short50km === 'number' && Number.isFinite(short50km) && short50km >= 0) options.short50km = Math.round(short50km)

  const medium100km = typed.medium100km
  if (typeof medium100km === 'number' && Number.isFinite(medium100km) && medium100km >= 0) options.medium100km = Math.round(medium100km)

  const long250km = typed.long250km
  if (typeof long250km === 'number' && Number.isFinite(long250km) && long250km >= 0) options.long250km = Math.round(long250km)

  return options
}

async function readViewerCommunityFollows(userId: string): Promise<Array<{ provinceCode: string; communitySlug: string }>> {
  const follows = await prisma.communityFollow.findMany({
    where: { userId },
    select: { provinceCode: true, communitySlug: true },
    orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
  })
  return follows
    .filter((entry: { provinceCode: string; communitySlug: string }) => Boolean(entry.provinceCode && entry.communitySlug))
    .map((entry: { provinceCode: string; communitySlug: string }) => ({
      provinceCode: String(entry.provinceCode || '').trim().toUpperCase(),
      communitySlug: String(entry.communitySlug || '').trim().toLowerCase(),
    }))
}

app.get('/market/feed', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const query = MarketProductsQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const userId = (await resolveUserId(req)) ?? undefined
    await Promise.all([ensureOrganizationShopTables(), ensureCitizenMarketplaceTables()])

    const follows = userId ? await readViewerCommunityFollows(userId) : []
    const useCommunityScope = follows.length > 0

    const provinceCodes = Array.from(new Set(follows.map((entry) => entry.provinceCode)))
    const communitySlugs = Array.from(new Set(follows.map((entry) => entry.communitySlug)))

    type OrgFeedRow = {
      id: string
      business_id: string
      business_name: string
      business_slug: string
      province_code: string | null
      community_slug: string | null
      business_logo_url: string | null
      business_cover_url: string | null
      name: string
      description: string | null
      price_cents: number
      currency: string
      primary_image_url: string | null
      gallery_image_urls: unknown
      created_at: Date
    }

    const orgRows: OrgFeedRow[] = await prisma.$queryRaw<OrgFeedRow[]>`
      SELECT
        p.id,
        p.business_id,
        b.name AS business_name,
        b.slug AS business_slug,
        b."provinceCode" AS province_code,
        b."communitySlug" AS community_slug,
        b."logoUrl" AS business_logo_url,
        b."coverUrl" AS business_cover_url,
        p.name,
        p.description,
        p.price_cents,
        p.currency,
        p.primary_image_url,
        p.gallery_image_urls,
        p.created_at
      FROM organization_shop_product p
      INNER JOIN "Business" b ON b.id = p.business_id
      LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
      WHERE p.is_active = TRUE
        AND p.is_draft = FALSE
        AND b.status = 'ACTIVE'
        AND (${useCommunityScope ? Prisma.sql`(UPPER(COALESCE(b."provinceCode", '')) IN (${Prisma.join(provinceCodes)}) AND LOWER(COALESCE(b."communitySlug", '')) IN (${Prisma.join(communitySlugs)}))` : Prisma.sql`TRUE`})
        AND (p.catalog_id IS NULL OR c.enabled = TRUE)
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${query.data.limit * 2}
    `

    type CitizenFeedRow = {
      id: string
      title: string
      description: string | null
      price_cents: number
      currency: string
      photo_urls: unknown
      pickup_city: string | null
      pickup_province: string | null
      scoped_province_code: string | null
      scoped_community_slug: string | null
      created_at: Date
      seller_user_id: string
      seller_handle: string | null
      seller_name: string | null
      seller_avatar_url: string | null
      seller_cover_url: string | null
    }

    const citizenRows: CitizenFeedRow[] = await prisma.$queryRaw<CitizenFeedRow[]>`
      SELECT
        l.id,
        l.title,
        l.description,
        l.price_cents,
        l.currency,
        l.photo_urls,
        l.pickup_city,
        l.pickup_province,
        COALESCE(l.listing_province_code, cf_scope."provinceCode") AS scoped_province_code,
        COALESCE(l.listing_community_slug, cf_scope."communitySlug") AS scoped_community_slug,
        l.created_at,
        l.seller_user_id,
        u.handle AS seller_handle,
        u.name AS seller_name,
        u."avatarUrl" AS seller_avatar_url,
        u."coverUrl" AS seller_cover_url
      FROM citizen_market_listing l
      INNER JOIN "User" u ON u.id = l.seller_user_id
      LEFT JOIN LATERAL (
        SELECT cf."provinceCode", cf."communitySlug"
        FROM "CommunityFollow" cf
        WHERE cf."userId" = l.seller_user_id
        ORDER BY cf.home DESC, cf."createdAt" DESC
        LIMIT 1
      ) cf_scope ON TRUE
      WHERE l.is_active = TRUE
        AND l.is_draft = FALSE
        AND l.status = 'active'
        AND (${useCommunityScope
          ? Prisma.sql`((UPPER(COALESCE(l.listing_province_code, cf_scope."provinceCode", '')) IN (${Prisma.join(provinceCodes)}) AND LOWER(COALESCE(l.listing_community_slug, cf_scope."communitySlug", '')) IN (${Prisma.join(communitySlugs)})) OR l.seller_user_id = ${userId})`
          : Prisma.sql`TRUE`})
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${query.data.limit * 2}
    `

    const merged = [
      ...orgRows.map((row) => ({
        kind: 'organization_product' as const,
        createdAtMs: row.created_at.getTime(),
        id: row.id,
        payload: {
          id: row.id,
          kind: 'organization_product' as const,
          title: row.name,
          description: row.description,
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          primaryImageUrl: row.primary_image_url,
          galleryImageUrls: readGalleryUrls(row.gallery_image_urls),
          createdAt: row.created_at.toISOString(),
          organization: {
            id: row.business_id,
            name: row.business_name,
            slug: row.business_slug,
            province: row.province_code?.toLowerCase() ?? null,
            municipality: row.community_slug ?? null,
            logoUrl: normalizeMediaUrl(row.business_logo_url),
            coverUrl: normalizeMediaUrl(row.business_cover_url),
          },
        },
      })),
      ...citizenRows.map((row) => {
        const photoUrls = readGalleryUrls(row.photo_urls)
        return {
          kind: 'citizen_listing' as const,
          createdAtMs: row.created_at.getTime(),
          id: row.id,
          payload: {
            id: row.id,
            kind: 'citizen_listing' as const,
            title: row.title,
            description: row.description,
            priceCents: Number(row.price_cents) || 0,
            currency: row.currency,
            primaryImageUrl: photoUrls[0] ?? null,
            galleryImageUrls: photoUrls,
            createdAt: row.created_at.toISOString(),
            pickupCity: row.pickup_city,
            pickupProvince: row.pickup_province,
            seller: {
              id: row.seller_user_id,
              handle: row.seller_handle,
              name: row.seller_name,
              avatarUrl: normalizeMediaUrl(row.seller_avatar_url),
              coverUrl: normalizeMediaUrl(row.seller_cover_url),
            },
          },
        }
      }),
    ]
      .sort((a, b) => {
        if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs
        return b.id.localeCompare(a.id)
      })
      .slice(0, query.data.limit)
      .map((entry) => entry.payload)

    return reply.send({ items: merged, nextCursor: null })
  }),
)

app.get('/market/products', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const query = MarketProductsQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const cursor = parseMarketCursor(query.data.cursor)
    await ensureOrganizationShopTables()

    type MarketProductRow = {
      id: string
      business_id: string
      business_name: string
      business_slug: string
      province_code: string | null
      community_slug: string | null
      business_logo_url: string | null
      business_cover_url: string | null
      name: string
      description: string | null
      price_cents: number
      currency: string
      primary_image_url: string | null
      gallery_image_urls: unknown
      fulfillment_type: string
      created_at: Date
    }

    const rows: MarketProductRow[] = await prisma.$queryRaw<MarketProductRow[]>`
      SELECT
        p.id,
        p.business_id,
        b.name AS business_name,
        b.slug AS business_slug,
        b."provinceCode" AS province_code,
        b."communitySlug" AS community_slug,
        b."logoUrl" AS business_logo_url,
        b."coverUrl" AS business_cover_url,
        p.name,
        p.description,
        p.price_cents,
        p.currency,
        p.primary_image_url,
        p.gallery_image_urls,
        p.fulfillment_type,
        p.created_at
      FROM organization_shop_product p
      INNER JOIN "Business" b ON b.id = p.business_id
      LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
      WHERE p.is_active = TRUE
        AND p.is_draft = FALSE
        AND b.status = 'ACTIVE'
        AND (p.catalog_id IS NULL OR c.enabled = TRUE)
        AND (
          ${cursor ? Prisma.sql`(p.created_at < ${cursor.createdAt} OR (p.created_at = ${cursor.createdAt} AND p.id < ${cursor.id}))` : Prisma.sql`TRUE`}
        )
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${query.data.limit + 1}
    `

    const pageRows: MarketProductRow[] = rows.slice(0, query.data.limit)
    const nextCursor = rows.length > query.data.limit ? `${pageRows[pageRows.length - 1]!.created_at.toISOString()}|${pageRows[pageRows.length - 1]!.id}` : null

    const items: Array<{
      id: string
      name: string
      description: string | null
      priceCents: number
      currency: string
      primaryImageUrl: string | null
      galleryImageUrls: string[]
      fulfillmentType: string
      createdAt: string
      organization: {
        id: string
        name: string
        slug: string
        province: string | null
        municipality: string | null
        logoUrl: string | null
        coverUrl: string | null
      }
    }> = []

    for (const row of pageRows) {
      items.push({
        id: row.id,
        name: row.name,
        description: row.description,
        priceCents: Number(row.price_cents) || 0,
        currency: row.currency,
        primaryImageUrl: row.primary_image_url,
        galleryImageUrls: readGalleryUrls(row.gallery_image_urls),
        fulfillmentType: row.fulfillment_type,
        createdAt: row.created_at.toISOString(),
        organization: {
          id: row.business_id,
          name: row.business_name,
          slug: row.business_slug,
          province: row.province_code?.toLowerCase() ?? null,
          municipality: row.community_slug ?? null,
          logoUrl: normalizeMediaUrl(row.business_logo_url),
          coverUrl: normalizeMediaUrl(row.business_cover_url),
        },
      })
    }

    return reply.send({ items, nextCursor })
  }),
)

app.get('/market/products/:productId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = MarketProductParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    await ensureOrganizationShopTables()

    type MarketProductDetailRow = {
      id: string
      business_id: string
      business_name: string
      business_slug: string
      province_code: string | null
      community_slug: string | null
      business_logo_url: string | null
      business_cover_url: string | null
      name: string
      description: string | null
      tax_collect: boolean
      tax_rates_by_region: unknown
      price_cents: number
      currency: string
      sku: string | null
      primary_image_url: string | null
      gallery_image_urls: unknown
      weight_grams: number | null
      shipping_policy: string
      allow_shipping_contracts: boolean
      track_inventory: boolean
      fulfillment_type: string
      inventory_total: bigint | number | null
      created_at: Date
      updated_at: Date
    }

    const rows = await prisma.$queryRaw<MarketProductDetailRow[]>`
      SELECT
        p.id,
        p.business_id,
        b.name AS business_name,
        b.slug AS business_slug,
        b."provinceCode" AS province_code,
        b."communitySlug" AS community_slug,
        b."logoUrl" AS business_logo_url,
        b."coverUrl" AS business_cover_url,
        p.name,
        p.description,
        p.tax_collect,
        p.tax_rates_by_region,
        p.price_cents,
        p.currency,
        p.sku,
        p.primary_image_url,
        p.gallery_image_urls,
        p.weight_grams,
        p.shipping_policy,
        p.allow_shipping_contracts,
        p.track_inventory,
        p.fulfillment_type,
        COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total,
        p.created_at,
        p.updated_at
      FROM organization_shop_product p
      INNER JOIN "Business" b ON b.id = p.business_id
      LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
      LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
      WHERE p.id = ${params.data.productId}
        AND p.is_active = TRUE
        AND p.is_draft = FALSE
        AND b.status = 'ACTIVE'
        AND (p.catalog_id IS NULL OR c.enabled = TRUE)
      GROUP BY p.id, b.id
      LIMIT 1
    `

    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'product_not_found' })

    return reply.send({
      product: {
        id: row.id,
        name: row.name,
        description: row.description,
        taxCollect: row.tax_collect,
        taxRatesByRegion:
          row.tax_rates_by_region && typeof row.tax_rates_by_region === 'object' && !Array.isArray(row.tax_rates_by_region)
            ? (row.tax_rates_by_region as Record<string, unknown>)
            : {},
        priceCents: Number(row.price_cents) || 0,
        currency: row.currency,
        sku: row.sku,
        primaryImageUrl: row.primary_image_url,
        galleryImageUrls: readGalleryUrls(row.gallery_image_urls),
        fulfillmentType: row.fulfillment_type,
        weightGrams: row.weight_grams,
        shippingPolicy: row.shipping_policy,
        allowShippingContracts: row.allow_shipping_contracts,
        trackInventory: row.track_inventory,
        inventoryTotal: Number(row.inventory_total ?? 0) || 0,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      organization: {
        id: row.business_id,
        name: row.business_name,
        slug: row.business_slug,
        province: row.province_code?.toLowerCase() ?? null,
        municipality: row.community_slug ?? null,
        logoUrl: normalizeMediaUrl(row.business_logo_url),
        coverUrl: normalizeMediaUrl(row.business_cover_url),
      },
    })
  }),
)

app.post('/market/checkout', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const buyerId = (await resolveUserId(req)) ?? undefined
    if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

    const body = MarketCheckoutBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await ensureOrganizationShopTables()

    const quantitiesByProductId = new Map<string, number>()
    for (const item of body.data.items) {
      quantitiesByProductId.set(item.productId, (quantitiesByProductId.get(item.productId) ?? 0) + item.quantity)
    }
    const productIds = Array.from(quantitiesByProductId.keys())
    if (!productIds.length) return reply.code(400).send({ error: 'empty_cart' })

    type CheckoutProductRow = {
      id: string
      business_id: string
      name: string
      price_cents: number
      currency: string
      tax_collect: boolean
      tax_rates_by_region: unknown
      track_inventory: boolean
      inventory_total: bigint | number | null
      fulfillment_type: string
      digital_delivery_url: string | null
    }

    const productRows: CheckoutProductRow[] = await prisma.$queryRaw<CheckoutProductRow[]>`
      SELECT
        p.id,
        p.business_id,
        p.name,
        p.price_cents,
        p.currency,
        p.tax_collect,
        p.tax_rates_by_region,
        p.track_inventory,
        COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total,
        p.fulfillment_type,
        p.digital_delivery_url
      FROM organization_shop_product p
      INNER JOIN "Business" b ON b.id = p.business_id
      LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
      LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
      WHERE p.id IN (${Prisma.join(productIds)})
        AND p.is_active = TRUE
        AND p.is_draft = FALSE
        AND b.status = 'ACTIVE'
        AND (p.catalog_id IS NULL OR c.enabled = TRUE)
      GROUP BY p.id, b.id
    `

    if (productRows.length !== productIds.length) {
      return reply.code(404).send({ error: 'product_not_found' })
    }

    const businessId = productRows[0]!.business_id
    if (!businessId || productRows.some((row) => row.business_id !== businessId)) {
      return reply.code(400).send({ error: 'single_seller_required' })
    }

    const currency = productRows[0]!.currency
    if (!currency || productRows.some((row) => row.currency !== currency)) {
      return reply.code(400).send({ error: 'single_currency_required' })
    }

    const requiresShipping = productRows.some((row) => String(row.fulfillment_type || '').toLowerCase() === 'physical')
    const shippingAddress = body.data.shippingAddress ?? null
    if (requiresShipping && !shippingAddress) {
      return reply.code(412).send({ error: 'shipping_address_required' })
    }

    for (const row of productRows) {
      if (!row.track_inventory) continue
      const requested = quantitiesByProductId.get(row.id) ?? 0
      const available = Number(row.inventory_total ?? 0) || 0
      if (requested > available) {
        return reply.code(409).send({ error: 'insufficient_inventory', productId: row.id })
      }
    }

    let subtotalCents = 0
    let taxCents = 0

    const taxRegionCode = resolveTaxRegionCode(shippingAddress?.province)

    for (const row of productRows) {
      const qty = quantitiesByProductId.get(row.id) ?? 0
      const lineSubtotal = (Number(row.price_cents) || 0) * qty
      subtotalCents += lineSubtotal

      if (row.tax_collect && taxRegionCode && row.tax_rates_by_region && typeof row.tax_rates_by_region === 'object' && !Array.isArray(row.tax_rates_by_region)) {
        const ratesMap = row.tax_rates_by_region as Record<string, unknown>
        const ratePct = parseTaxRatePct(ratesMap[taxRegionCode])
        if (ratePct > 0) {
          taxCents += Math.max(0, Math.round(lineSubtotal * (ratePct / 100)))
        }
      }
    }
    if (subtotalCents <= 0) return reply.code(400).send({ error: 'invalid_total' })

    const stripeConnectFeeCents = Math.max(0, Math.round(subtotalCents * 0.029) + 30)
    const civilMarketFeeCents = Math.max(0, Math.round(subtotalCents * 0.05))
    const feeCents = stripeConnectFeeCents + civilMarketFeeCents
    const totalCents = subtotalCents + taxCents + feeCents

    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } })
    if (!business) return reply.code(404).send({ error: 'organization_not_found' })

    const orderId = randomUUID()

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`
        INSERT INTO organization_shop_order (id, business_id, buyer_user_id, status, currency, subtotal_cents, fee_cents, total_cents, shipping_address, created_at, updated_at)
        VALUES (${orderId}, ${businessId}, ${buyerId}, ${'pending'}, ${currency}, ${subtotalCents}, ${feeCents}, ${totalCents}, ${shippingAddress ? JSON.stringify(shippingAddress) : null}::jsonb, NOW(), NOW())
      `

      for (const row of productRows) {
        const qty = quantitiesByProductId.get(row.id) ?? 0
        await tx.$executeRaw`
          INSERT INTO organization_shop_order_item (id, order_id, product_id, name, price_cents, quantity, fulfillment_type, digital_delivery_url, created_at)
          VALUES (
            ${randomUUID()},
            ${orderId},
            ${row.id},
            ${row.name},
            ${Number(row.price_cents) || 0},
            ${qty},
            ${row.fulfillment_type || 'physical'},
            ${String(row.fulfillment_type || '').toLowerCase() === 'digital' ? row.digital_delivery_url ?? null : null},
            NOW()
          )
        `
      }
    })

    return reply.code(201).send({
      orderId,
      totals: {
        subtotalCents,
        taxCents,
        stripeConnectFeeCents,
        civilMarketFeeCents,
        grandTotalCents: totalCents,
      },
    })
  }),
)

app.get('/market/orders', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const buyerId = (await resolveUserId(req)) ?? undefined
    if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

    const query = MarketOrdersQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

    await ensureOrganizationShopTables()

    type OrderListRow = {
      id: string
      business_id: string
      business_name: string
      status: string
      currency: string
      subtotal_cents: number
      fee_cents: number
      total_cents: number
      created_at: Date
      item_count: bigint | number
    }

    const rows = await prisma.$queryRaw<OrderListRow[]>`
      SELECT
        o.id,
        o.business_id,
        b.name AS business_name,
        o.status,
        o.currency,
        o.subtotal_cents,
        o.fee_cents,
        o.total_cents,
        o.created_at,
        COALESCE(SUM(oi.quantity), 0)::bigint AS item_count
      FROM organization_shop_order o
      INNER JOIN "Business" b ON b.id = o.business_id
      LEFT JOIN organization_shop_order_item oi ON oi.order_id = o.id
      WHERE o.buyer_user_id = ${buyerId}
      GROUP BY o.id, b.id
      ORDER BY o.created_at DESC
      LIMIT ${query.data.limit}
    `

    const items: Array<{
      id: string
      businessId: string
      businessName: string
      status: string
      currency: string
      subtotalCents: number
      feeCents: number
      totalCents: number
      itemCount: number
      createdAt: string
    }> = []

    for (const row of rows as OrderListRow[]) {
      items.push({
        id: row.id,
        businessId: row.business_id,
        businessName: row.business_name,
        status: row.status,
        currency: row.currency,
        subtotalCents: Number(row.subtotal_cents) || 0,
        feeCents: Number(row.fee_cents) || 0,
        totalCents: Number(row.total_cents) || 0,
        itemCount: Number(row.item_count ?? 0) || 0,
        createdAt: row.created_at.toISOString(),
      })
    }

    return reply.send({ items })
  }),
)

app.get('/market/orders/:orderId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const buyerId = (await resolveUserId(req)) ?? undefined
    if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketOrderParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    await ensureOrganizationShopTables()

    type OrderRow = {
      id: string
      business_id: string
      status: string
      currency: string
      subtotal_cents: number
      fee_cents: number
      total_cents: number
      shipping_address: unknown
      created_at: Date
    }

    const orderRows = await prisma.$queryRaw<OrderRow[]>`
      SELECT id, business_id, status, currency, subtotal_cents, fee_cents, total_cents, shipping_address, created_at
      FROM organization_shop_order
      WHERE id = ${params.data.orderId} AND buyer_user_id = ${buyerId}
      LIMIT 1
    `
    const order = orderRows[0]
    if (!order) return reply.code(404).send({ error: 'order_not_found' })

    type OrderItemRow = {
      id: string
      name: string
      price_cents: number
      quantity: number
      fulfillment_type: string
      digital_delivery_url: string | null
    }

    const itemRows = await prisma.$queryRaw<OrderItemRow[]>`
      SELECT id, name, price_cents, quantity, fulfillment_type, digital_delivery_url
      FROM organization_shop_order_item
      WHERE order_id = ${order.id}
      ORDER BY created_at ASC
    `

    const allowDigitalDelivery = order.status === 'paid' || order.status === 'fulfilled'

    const items: Array<{
      id: string
      name: string
      priceCents: number
      quantity: number
      fulfillmentType: string
      digitalDeliveryUrl: string | null
    }> = []

    for (const item of itemRows) {
      items.push({
        id: item.id,
        name: item.name,
        priceCents: Number(item.price_cents) || 0,
        quantity: Number(item.quantity) || 0,
        fulfillmentType: item.fulfillment_type,
        digitalDeliveryUrl: allowDigitalDelivery && String(item.fulfillment_type || '').toLowerCase() === 'digital' ? item.digital_delivery_url : null,
      })
    }

    return reply.send({
      order: {
        id: order.id,
        businessId: order.business_id,
        status: order.status,
        currency: order.currency,
        subtotalCents: Number(order.subtotal_cents) || 0,
        feeCents: Number(order.fee_cents) || 0,
        totalCents: Number(order.total_cents) || 0,
        shippingAddress: order.shipping_address ?? null,
        createdAt: order.created_at.toISOString(),
      },
      items,
    })
  }),
)

app.post('/market/listings/draft', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    await ensureCitizenMarketplaceTables()

    const userScopeFollows = await readViewerCommunityFollows(userId)
    const listingScope = userScopeFollows[0] ?? null

    const listingId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO citizen_market_listing (
        id,
        seller_user_id,
        title,
        description,
        price_cents,
        currency,
        photo_urls,
        listing_province_code,
        listing_community_slug,
        payment_types,
        willing_to_deliver,
        delivery_options,
        status,
        is_draft,
        is_active,
        created_by
      )
      VALUES (
        ${listingId},
        ${userId},
        ${'Draft Listing'},
        ${null},
        ${0},
        ${'CAD'},
        ${JSON.stringify([])}::jsonb,
        ${listingScope?.provinceCode ?? null},
        ${listingScope?.communitySlug ?? null},
        ${JSON.stringify(['cash_pickup'])}::jsonb,
        ${false},
        ${JSON.stringify({})}::jsonb,
        ${'draft'},
        ${true},
        ${true},
        ${userId}
      )
    `

    return reply.code(201).send({ listing: { id: listingId, isDraft: true } })
  }),
)

app.get('/market/listings/mine', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const query = MarketListingsQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

    await ensureCitizenMarketplaceTables()

    type ListingRow = {
      id: string
      title: string
      description: string | null
      price_cents: number
      currency: string
      photo_urls: unknown
      listing_province_code: string | null
      listing_community_slug: string | null
      pickup_city: string | null
      pickup_province: string | null
      payment_types: unknown
      willing_to_deliver: boolean
      delivery_options: unknown
      status: string
      is_draft: boolean
      updated_at: Date
      created_at: Date
    }

    const rows = await prisma.$queryRaw<ListingRow[]>`
      SELECT
        id,
        title,
        description,
        price_cents,
        currency,
        photo_urls,
        listing_province_code,
        listing_community_slug,
        pickup_city,
        pickup_province,
        payment_types,
        willing_to_deliver,
        delivery_options,
        status,
        is_draft,
        updated_at,
        created_at
      FROM citizen_market_listing
      WHERE seller_user_id = ${userId}
        AND is_active = TRUE
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ${query.data.limit}
    `

    const items = rows.map((row: ListingRow) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      priceCents: Number(row.price_cents) || 0,
      currency: row.currency,
      photoUrls: readGalleryUrls(row.photo_urls),
      listingProvinceCode: row.listing_province_code,
      listingCommunitySlug: row.listing_community_slug,
      pickupCity: row.pickup_city,
      pickupProvince: row.pickup_province,
      paymentTypes: readStringList(row.payment_types),
      willingToDeliver: Boolean(row.willing_to_deliver),
      deliveryOptions: readDeliveryOptions(row.delivery_options),
      status: row.status,
      isDraft: Boolean(row.is_draft),
      updatedAt: row.updated_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    }))

    return reply.send({ items })
  }),
)

app.get('/market/listings/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    await ensureCitizenMarketplaceTables()

    type ListingDetailRow = {
      id: string
      title: string
      description: string | null
      price_cents: number
      currency: string
      photo_urls: unknown
      listing_province_code: string | null
      listing_community_slug: string | null
      pickup_city: string | null
      pickup_province: string | null
      pickup_address_line1: string | null
      pickup_address_line2: string | null
      pickup_postal_code: string | null
      payment_types: unknown
      willing_to_deliver: boolean
      delivery_options: unknown
      e_transfer_email: string | null
      status: string
      is_draft: boolean
      updated_at: Date
      created_at: Date
    }

    const rows = await prisma.$queryRaw<ListingDetailRow[]>`
      SELECT
        id,
        title,
        description,
        price_cents,
        currency,
        photo_urls,
        listing_province_code,
        listing_community_slug,
        pickup_city,
        pickup_province,
        pickup_address_line1,
        pickup_address_line2,
        pickup_postal_code,
        payment_types,
        willing_to_deliver,
        delivery_options,
        e_transfer_email,
        status,
        is_draft,
        updated_at,
        created_at
      FROM citizen_market_listing
      WHERE id = ${params.data.listingId}
        AND seller_user_id = ${userId}
        AND is_active = TRUE
      LIMIT 1
    `

    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'listing_not_found' })

    return reply.send({
      listing: {
        id: row.id,
        title: row.title,
        description: row.description,
        priceCents: Number(row.price_cents) || 0,
        currency: row.currency,
        photoUrls: readGalleryUrls(row.photo_urls),
        listingProvinceCode: row.listing_province_code,
        listingCommunitySlug: row.listing_community_slug,
        pickupCity: row.pickup_city,
        pickupProvince: row.pickup_province,
        pickupAddressLine1: row.pickup_address_line1,
        pickupAddressLine2: row.pickup_address_line2,
        pickupPostalCode: row.pickup_postal_code,
        paymentTypes: readStringList(row.payment_types),
        willingToDeliver: Boolean(row.willing_to_deliver),
        deliveryOptions: readDeliveryOptions(row.delivery_options),
        eTransferEmail: row.e_transfer_email,
        status: row.status,
        isDraft: Boolean(row.is_draft),
        updatedAt: row.updated_at.toISOString(),
        createdAt: row.created_at.toISOString(),
      },
    })
  }),
)

app.get('/market/listings/public/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    await ensureCitizenMarketplaceTables()

    type PublicListingRow = {
      id: string
      title: string
      description: string | null
      price_cents: number
      currency: string
      photo_urls: unknown
      pickup_city: string | null
      pickup_province: string | null
      willing_to_deliver: boolean
      delivery_options: unknown
      payment_types: unknown
      created_at: Date
      seller_user_id: string
      seller_handle: string | null
      seller_name: string | null
      seller_avatar_url: string | null
      seller_cover_url: string | null
    }

    const rows = await prisma.$queryRaw<PublicListingRow[]>`
      SELECT
        l.id,
        l.title,
        l.description,
        l.price_cents,
        l.currency,
        l.photo_urls,
        l.pickup_city,
        l.pickup_province,
        l.willing_to_deliver,
        l.delivery_options,
        l.payment_types,
        l.created_at,
        l.seller_user_id,
        u.handle AS seller_handle,
        u.name AS seller_name,
        u."avatarUrl" AS seller_avatar_url,
        u."coverUrl" AS seller_cover_url
      FROM citizen_market_listing l
      INNER JOIN "User" u ON u.id = l.seller_user_id
      WHERE l.id = ${params.data.listingId}
        AND l.is_active = TRUE
        AND l.is_draft = FALSE
        AND l.status = 'active'
      LIMIT 1
    `

    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'listing_not_found' })

    return reply.send({
      listing: {
        id: row.id,
        title: row.title,
        description: row.description,
        priceCents: Number(row.price_cents) || 0,
        currency: row.currency,
        photoUrls: readGalleryUrls(row.photo_urls),
        pickupCity: row.pickup_city,
        pickupProvince: row.pickup_province,
        willingToDeliver: Boolean(row.willing_to_deliver),
        deliveryOptions: readDeliveryOptions(row.delivery_options),
        paymentTypes: readStringList(row.payment_types),
        createdAt: row.created_at.toISOString(),
        seller: {
          id: row.seller_user_id,
          handle: row.seller_handle,
          name: row.seller_name,
          avatarUrl: normalizeMediaUrl(row.seller_avatar_url),
          coverUrl: normalizeMediaUrl(row.seller_cover_url),
        },
      },
    })
  }),
)

app.post('/market/chats/listings/:listingId/thread', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    await ensureCitizenMarketplaceTables()

    const listingRows = await prisma.$queryRaw<Array<{ id: string; title: string; status: string; is_draft: boolean; is_active: boolean; seller_user_id: string }>>`
      SELECT id, title, status, is_draft, is_active, seller_user_id
      FROM citizen_market_listing
      WHERE id = ${params.data.listingId}
      LIMIT 1
    `

    const listing = listingRows[0]
    if (!listing || !listing.is_active || listing.is_draft || String(listing.status || '').toLowerCase() !== 'active') {
      return reply.code(404).send({ error: 'listing_not_found' })
    }

    if (listing.seller_user_id === userId) {
      return reply.code(400).send({ error: 'cannot_message_self' })
    }

    const uniqueKey = buildMarketListingDirectThreadKey(listing.id, listing.seller_user_id, userId)
    let thread = await prisma.messageThread.findUnique({ where: { uniqueKey }, include: THREAD_SUMMARY_INCLUDE })
    if (!thread) {
      const now = new Date()
      thread = await prisma.messageThread.create({
        data: {
          type: MessageThreadType.direct,
          uniqueKey,
          contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
          contextId: listing.id,
          lastMessageAt: now,
          participants: {
            create: [
              { userId, role: MessageParticipantRole.member, lastReadAt: now, lastActivityAt: now },
              { userId: listing.seller_user_id, role: MessageParticipantRole.member, lastActivityAt: now },
            ],
          },
        },
        include: THREAD_SUMMARY_INCLUDE,
      })

      await Promise.all(
        thread.participants
          .filter((participant: ThreadParticipantRecord) => participant.userId !== userId)
          .map((participant: ThreadParticipantRecord) =>
            dispatchRealtimeEvent(participant.userId, {
              type: 'thread.created',
              data: { thread: formatThreadSummaryRecord(thread, participant.userId) },
            }),
          ),
      )
    }

    return reply.send({
      thread: formatThreadSummaryRecord(thread, userId),
      listing: {
        id: listing.id,
        title: listing.title,
        status: listing.status,
      },
    })
  }),
)

app.get('/market/chats', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    await ensureCitizenMarketplaceTables()

    const threads: ThreadSummaryRecord[] = await prisma.messageThread.findMany({
      where: {
        contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
        participants: { some: { userId } },
      },
      include: THREAD_SUMMARY_INCLUDE,
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })

    const threadIds = threads.map((thread: ThreadSummaryRecord) => thread.id)
    const notInterestedByThreadId = new Set<string>()
    if (threadIds.length) {
      const interestRows = await prisma.$queryRaw<Array<{ thread_id: string; interested: boolean }>>`
        SELECT thread_id, interested
        FROM citizen_market_chat_interest
        WHERE user_id = ${userId}
        AND thread_id IN (${Prisma.join(threadIds)})
      `

      for (const row of interestRows) {
        if (row && row.thread_id && row.interested === false) {
          notInterestedByThreadId.add(String(row.thread_id))
        }
      }
    }

    const listingIds = Array.from(
      new Set(
        threads
          .map((thread: ThreadSummaryRecord) => (thread.contextId ? thread.contextId.trim() : ''))
          .filter(Boolean),
      ),
    )

    const listingRows = listingIds.length
      ? await prisma.$queryRaw<
          Array<{
            id: string
            title: string
            status: string
            price_cents: number
            currency: string
            photo_urls: unknown
            pickup_city: string | null
            pickup_province: string | null
            seller_user_id: string
            seller_handle: string | null
            seller_name: string | null
            seller_avatar_url: string | null
            seller_cover_url: string | null
          }>
        >`
          SELECT
            l.id,
            l.title,
            l.status,
            l.price_cents,
            l.currency,
            l.photo_urls,
            l.pickup_city,
            l.pickup_province,
            l.seller_user_id,
            u.handle AS seller_handle,
            u.name AS seller_name,
            u."avatarUrl" AS seller_avatar_url,
            u."coverUrl" AS seller_cover_url
          FROM citizen_market_listing l
          INNER JOIN "User" u ON u.id = l.seller_user_id
          WHERE l.id IN (${Prisma.join(listingIds)})
        `
      : []

    const listingById = new Map<
      string,
      {
        id: string
        title: string
        status: string
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        seller_user_id: string
        seller_handle: string | null
        seller_name: string | null
        seller_avatar_url: string | null
        seller_cover_url: string | null
      }
    >(
      listingRows.map(
        (
          row: {
            id: string
            title: string
            status: string
            price_cents: number
            currency: string
            photo_urls: unknown
            pickup_city: string | null
            pickup_province: string | null
            seller_user_id: string
            seller_handle: string | null
            seller_name: string | null
            seller_avatar_url: string | null
            seller_cover_url: string | null
          },
        ) => [row.id, row],
      ),
    )

    const soldStatuses = new Set(['sold', 'canceled'])
    const yourListingChats: Array<Record<string, unknown>> = []
    const yourListingsById = new Map<
      string,
      {
        listing: Record<string, unknown>
        unrespondedThreads: Array<Record<string, unknown>>
        totalThreads: number
      }
    >()
    const activeItems: Array<Record<string, unknown>> = []
    const soldItems: Array<Record<string, unknown>> = []
    const inactiveItems: Array<Record<string, unknown>> = []

    for (const thread of threads) {
      const listingId = thread.contextId?.trim()
      if (!listingId) continue
      const listing = listingById.get(listingId)
      if (!listing) continue

      const counterpart = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId !== userId)
      const item = {
        threadId: thread.id,
        listingId,
        listingTitle: listing.title,
        listingStatus: listing.status,
        listingPriceCents: Number(listing.price_cents) || 0,
        listingCurrency: listing.currency,
        listingPhotoUrl: readGalleryUrls(listing.photo_urls)[0] ?? null,
        listingPickupCity: listing.pickup_city,
        listingPickupProvince: listing.pickup_province,
        seller: {
          id: listing.seller_user_id,
          handle: listing.seller_handle,
          name: listing.seller_name,
          avatarUrl: listing.seller_avatar_url,
          coverUrl: listing.seller_cover_url,
        },
        lastMessageAt: (thread.lastMessageAt ?? thread.updatedAt).toISOString(),
        lastMessage: thread.messages[0] ? formatMessage(thread.messages[0], userId) : null,
        counterpart: counterpart
          ? {
              id: counterpart.user.id,
              handle: counterpart.user.handle,
              name: counterpart.user.name,
              avatarUrl: normalizeMediaUrl(counterpart.user.avatarUrl ?? null),
              coverUrl: normalizeMediaUrl((counterpart.user as { coverUrl?: string | null }).coverUrl ?? null),
            }
          : null,
      }

      if (listing.seller_user_id === userId) {
        yourListingChats.push(item)

        let group = yourListingsById.get(listingId)
        if (!group) {
          group = {
            listing: {
              id: listingId,
              title: listing.title,
              status: listing.status,
              priceCents: Number(listing.price_cents) || 0,
              currency: listing.currency,
              photoUrl: readGalleryUrls(listing.photo_urls)[0] ?? null,
              pickupCity: listing.pickup_city,
              pickupProvince: listing.pickup_province,
            },
            unrespondedThreads: [],
            totalThreads: 0,
          }
          yourListingsById.set(listingId, group)
        }

        group.totalThreads += 1

        const lastMessageRecord = thread.messages[0]
        const isUnresponded = Boolean(lastMessageRecord && lastMessageRecord.senderId !== userId)
        if (isUnresponded && group.unrespondedThreads.length < 5) {
          group.unrespondedThreads.push({
            threadId: thread.id,
            counterpart: item.counterpart,
            lastMessageAt: item.lastMessageAt,
            lastMessage: item.lastMessage,
          })
        }

        continue
      }

      if (notInterestedByThreadId.has(thread.id)) {
        inactiveItems.push(item)
        continue
      }

      if (soldStatuses.has(String(listing.status || '').toLowerCase())) {
        soldItems.push(item)
      } else {
        activeItems.push(item)
      }
    }

    return reply.send({
      yourListings: Array.from(yourListingsById.values()),
      yourListingChats,
      activeItems,
      inactiveItems,
      soldItems,
    })
  }),
)

app.get('/market/chats/item/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    await ensureCitizenMarketplaceTables()

    const listingRows = await prisma.$queryRaw<
      Array<{
        id: string
        title: string
        status: string
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        seller_user_id: string
        selected_buyer_user_id: string | null
      }>
    >`
      SELECT id, title, status, price_cents, currency, photo_urls, pickup_city, pickup_province, seller_user_id, selected_buyer_user_id
      FROM citizen_market_listing
      WHERE id = ${params.data.listingId}
      LIMIT 1
    `

    const listing = listingRows[0]
    if (!listing) return reply.code(404).send({ error: 'listing_not_found' })
    if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })

    const threads: ThreadSummaryRecord[] = await prisma.messageThread.findMany({
      where: {
        contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
        contextId: listing.id,
        participants: { some: { userId } },
      },
      include: THREAD_SUMMARY_INCLUDE,
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })

    const formattedThreads = threads.map((thread: ThreadSummaryRecord) => {
      const counterpart = thread.participants.find((participant: ThreadParticipantRecord) => participant.userId !== userId)
      return {
        threadId: thread.id,
        lastMessageAt: (thread.lastMessageAt ?? thread.updatedAt).toISOString(),
        lastMessage: thread.messages[0] ? formatMessage(thread.messages[0], userId) : null,
        counterpart: counterpart
          ? {
              id: counterpart.user.id,
              handle: counterpart.user.handle,
              name: counterpart.user.name,
              avatarUrl: normalizeMediaUrl(counterpart.user.avatarUrl ?? null),
              coverUrl: normalizeMediaUrl((counterpart.user as { coverUrl?: string | null }).coverUrl ?? null),
            }
          : null,
      }
    })

    const selectedBuyerUserId = listing.selected_buyer_user_id
    const selectedThreadId = selectedBuyerUserId
      ? threads.find((thread: ThreadSummaryRecord) => thread.participants.some((p: ThreadParticipantRecord) => p.userId === selectedBuyerUserId))?.id ?? null
      : null

    return reply.send({
      listing: {
        id: listing.id,
        title: listing.title,
        status: listing.status,
        priceCents: Number(listing.price_cents) || 0,
        currency: listing.currency,
        photoUrl: readGalleryUrls(listing.photo_urls)[0] ?? null,
        pickupCity: listing.pickup_city,
        pickupProvince: listing.pickup_province,
      },
      threads: formattedThreads,
      selectedBuyerUserId,
      selectedThreadId,
    })
  }),
)

app.post('/market/chats/:threadId/no-longer-interested', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketChatThreadParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const membership = await prisma.messageParticipant.findFirst({
      where: {
        threadId: params.data.threadId,
        userId,
        thread: { contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE },
      },
      select: { threadId: true },
    })
    if (!membership) return reply.code(404).send({ error: 'market_chat_not_found' })

    await ensureCitizenMarketplaceTables()

    await prisma.$executeRaw`
      INSERT INTO citizen_market_chat_interest (thread_id, user_id, interested, updated_at)
      VALUES (${params.data.threadId}, ${userId}, FALSE, NOW())
      ON CONFLICT (thread_id, user_id)
      DO UPDATE SET interested = FALSE, updated_at = NOW()
    `

    return reply.send({ success: true, interested: false })
  }),
)

app.post('/market/chats/item/:listingId/relist', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = MarketRelistBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await ensureCitizenMarketplaceTables()

    const listingRows = await prisma.$queryRaw<Array<{ id: string; seller_user_id: string; status: string; is_active: boolean }>>`
      SELECT id, seller_user_id, status, is_active
      FROM citizen_market_listing
      WHERE id = ${params.data.listingId}
      LIMIT 1
    `
    const listing = listingRows[0]
    if (!listing || !listing.is_active) return reply.code(404).send({ error: 'listing_not_found' })
    if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })

    await prisma.$executeRaw`
      UPDATE citizen_market_listing
      SET status = 'active',
          selected_buyer_user_id = NULL,
          updated_at = NOW()
      WHERE id = ${listing.id}
        AND seller_user_id = ${userId}
    `

    if (body.data.notify) {
      const threads = await prisma.messageThread.findMany({
        where: {
          contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
          contextId: listing.id,
          participants: { some: { userId } },
        },
        select: {
          id: true,
          participants: { select: { userId: true } },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        take: 200,
      })

      const bodyText = sanitizePlainText("This item is available again if you're interested.").trim()

      const createdMessages: Array<{
        threadId: string
        record: MessageRecord
        participants: Array<{ userId: string }>
      }> = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const messageRecords: Array<{ threadId: string; record: MessageRecord; participants: Array<{ userId: string }> }> = []
        for (const thread of threads) {
          const created = await tx.message.create({
            data: {
              threadId: thread.id,
              senderId: userId,
              body: bodyText || null,
              messageType: MessageType.text,
            },
            select: MESSAGE_SELECT,
          })

          await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: created.createdAt } })
          await tx.messageParticipant.update({
            where: { threadId_userId: { threadId: thread.id, userId } },
            data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
          })
          await tx.messageParticipant.updateMany({
            where: { threadId: thread.id, userId: { not: userId } },
            data: { lastActivityAt: created.createdAt },
          })
          messageRecords.push({ threadId: thread.id, record: created, participants: thread.participants })
        }
        return messageRecords
      })

      await Promise.all(
        createdMessages.flatMap((entry: { threadId: string; record: MessageRecord; participants: Array<{ userId: string }> }) =>
          entry.participants.map((participant: { userId: string }) =>
            dispatchRealtimeEvent(participant.userId, {
              type: 'message.created',
              data: { threadId: entry.threadId, message: formatMessage(entry.record, participant.userId) },
            }),
          ),
        ),
      )
    }

    return reply.send({ success: true })
  }),
)

app.post('/market/chats/item/:listingId/select-buyer', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = MarketSelectBuyerBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await ensureCitizenMarketplaceTables()

    const listingRows = await prisma.$queryRaw<
      Array<{ id: string; seller_user_id: string; status: string; selected_buyer_user_id: string | null; is_active: boolean }>
    >`
      SELECT id, seller_user_id, status, selected_buyer_user_id, is_active
      FROM citizen_market_listing
      WHERE id = ${params.data.listingId}
      LIMIT 1
    `

    const listing = listingRows[0]
    if (!listing || !listing.is_active) return reply.code(404).send({ error: 'listing_not_found' })
    if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })
    if (listing.selected_buyer_user_id) return reply.code(400).send({ error: 'buyer_already_selected' })

    const selectedThread = await prisma.messageThread.findFirst({
      where: {
        id: body.data.threadId,
        contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
        contextId: listing.id,
        participants: { some: { userId } },
      },
      select: {
        id: true,
        participants: { select: { userId: true, mutedUntil: true } },
      },
    })
    if (!selectedThread) return reply.code(404).send({ error: 'market_chat_not_found' })

    const buyerId = selectedThread.participants.find((participant: { userId: string }) => participant.userId !== userId)?.userId
    if (!buyerId) return reply.code(400).send({ error: 'buyer_not_found' })

    const threads = await prisma.messageThread.findMany({
      where: {
        contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
        contextId: listing.id,
        participants: { some: { userId } },
      },
      select: {
        id: true,
        participants: { select: { userId: true, mutedUntil: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })

    const now = new Date()
    const notifyOthersBody = sanitizePlainText("I have found a potential buyer, but I'll let you know if that deal falls though").trim()
    const notifySelectedBody = sanitizePlainText('I have selected you as the buyer for this item. Please confirm pickup details.').trim()

    const createdMessages = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`
        UPDATE citizen_market_listing
        SET selected_buyer_user_id = ${buyerId},
            status = 'pending',
            is_draft = FALSE,
            updated_at = NOW()
        WHERE id = ${listing.id}
          AND seller_user_id = ${userId}
          AND selected_buyer_user_id IS NULL
      `

      const messageRecords: Array<{ threadId: string; record: MessageRecord; participants: Array<{ userId: string }> }> = []

      for (const thread of threads) {
        const messageBody = thread.id === selectedThread.id ? notifySelectedBody : notifyOthersBody
        const created = await tx.message.create({
          data: {
            threadId: thread.id,
            senderId: userId,
            body: messageBody || null,
            messageType: MessageType.text,
          },
          select: MESSAGE_SELECT,
        })

        await tx.messageThread.update({
          where: { id: thread.id },
          data: { lastMessageAt: created.createdAt },
        })

        await tx.messageParticipant.update({
          where: {
            threadId_userId: {
              threadId: thread.id,
              userId,
            },
          },
          data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
        })

        await tx.messageParticipant.updateMany({
          where: {
            threadId: thread.id,
            userId: { not: userId },
          },
          data: { lastActivityAt: created.createdAt },
        })

        messageRecords.push({ threadId: thread.id, record: created, participants: thread.participants })
      }

      return messageRecords
    })

    await Promise.all(
      createdMessages.flatMap((entry: { threadId: string; record: MessageRecord; participants: Array<{ userId: string }> }) =>
        entry.participants.map((participant: { userId: string }) =>
          dispatchRealtimeEvent(participant.userId, {
            type: 'message.created',
            data: {
              threadId: entry.threadId,
              message: formatMessage(entry.record, participant.userId),
            },
          }),
        ),
      ),
    )

    return reply.send({
      success: true,
      selectedBuyerUserId: buyerId,
      selectedThreadId: selectedThread.id,
      selectedAt: now.toISOString(),
    })
  }),
)

app.get('/market/chats/:threadId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketChatThreadParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const thread = await prisma.messageThread.findFirst({
      where: {
        id: params.data.threadId,
        contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
        participants: { some: { userId } },
      },
      include: THREAD_WITH_PARTICIPANTS_INCLUDE,
    })
    if (!thread) return reply.code(404).send({ error: 'market_chat_not_found' })

    const query = MessageListQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const { rows, nextCursor } = await fetchThreadMessages(thread.id, query.data.limit, query.data.cursor)

    return reply.send({
      thread: formatThreadBase(thread, userId),
      messages: rows.map((message: MessageRecord) => formatMessage(message, userId)),
      nextCursor,
    })
  }),
)

app.get('/market/chats/:threadId/messages', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketChatThreadParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const membership = await prisma.messageParticipant.findFirst({
      where: {
        threadId: params.data.threadId,
        userId,
        thread: { contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE },
      },
      select: { threadId: true },
    })
    if (!membership) return reply.code(404).send({ error: 'market_chat_not_found' })

    const query = MessageListQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const { rows, nextCursor } = await fetchThreadMessages(params.data.threadId, query.data.limit, query.data.cursor)

    return reply.send({
      items: rows.map((message: MessageRecord) => formatMessage(message, userId)),
      nextCursor,
    })
  }),
)

app.get('/market/chats/unread-count', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    await ensureCitizenMarketplaceTables()

    const result = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int as count
      FROM "Message" m
      JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
      JOIN "MessageThread" t ON t.id = m."threadId"
      WHERE mp."userId" = ${userId}
      AND m."senderId" != ${userId}
      AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
      AND t."contextType" = 'market_listing'
      AND NOT EXISTS (
        SELECT 1
        FROM citizen_market_chat_interest i
        WHERE i.thread_id = m."threadId"
        AND i.user_id = ${userId}
        AND i.interested = FALSE
      )
    `

    const count = Number(result[0]?.count || 0)
    return reply.send({ count })
  }),
)

app.post('/market/chats/:threadId/read', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketChatThreadParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const membership = await prisma.messageParticipant.findFirst({
      where: {
        threadId: params.data.threadId,
        userId,
        thread: { contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE },
      },
      select: { threadId: true },
    })
    if (!membership) return reply.code(404).send({ error: 'market_chat_not_found' })

    const parse = ThreadReadInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    let readAt = new Date()
    if (parse.data.messageId) {
      const message = await prisma.message.findUnique({
        where: { id: parse.data.messageId },
        select: { threadId: true, createdAt: true },
      })
      if (!message || message.threadId !== params.data.threadId) {
        return reply.code(400).send({ error: 'invalid_message' })
      }
      readAt = message.createdAt
    }

    await prisma.messageParticipant.update({
      where: {
        threadId_userId: {
          threadId: params.data.threadId,
          userId,
        },
      },
      data: { lastReadAt: readAt },
    })

    return reply.send({ lastReadAt: readAt })
  }),
)

app.post('/market/chats/:threadId/messages', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketChatThreadParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const parse = SendMessageInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const thread = await prisma.messageThread.findFirst({
      where: {
        id: params.data.threadId,
        contextType: MARKET_LISTING_CHAT_CONTEXT_TYPE,
        participants: { some: { userId } },
      },
      select: {
        id: true,
        participants: { select: { userId: true, mutedUntil: true } },
      },
    })
    if (!thread) return reply.code(404).send({ error: 'market_chat_not_found' })

    const messageRecord = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const normalizedBody = parse.data.body?.trim() ? sanitizePlainText(parse.data.body) : ''
      const created = await tx.message.create({
        data: {
          threadId: thread.id,
          senderId: userId,
          body: normalizedBody ? normalizedBody : null,
          attachments: parse.data.attachments ?? undefined,
          messageType: MessageType.text,
        },
        select: MESSAGE_SELECT,
      })

      await tx.messageThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: created.createdAt },
      })

      await tx.messageParticipant.update({
        where: {
          threadId_userId: {
            threadId: thread.id,
            userId,
          },
        },
        data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
      })

      await tx.messageParticipant.updateMany({
        where: {
          threadId: thread.id,
          userId: { not: userId },
        },
        data: { lastActivityAt: created.createdAt },
      })

      return created
    })

    await Promise.all(
      thread.participants.map((participant: { userId: string }) =>
        dispatchRealtimeEvent(participant.userId, {
          type: 'message.created',
          data: {
            threadId: thread.id,
            message: formatMessage(messageRecord, participant.userId),
          },
        }),
      ),
    )

    void sendMobilePushForMessageCreated({
      threadId: thread.id,
      message: messageRecord,
      participants: thread.participants,
      pushUrl: `/market/chats/${encodeURIComponent(thread.id)}`,
    })

    return reply.code(201).send({ message: formatMessage(messageRecord, userId) })
  }),
)

app.put('/market/listings/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = MarketListingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = MarketListingUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await ensureCitizenMarketplaceTables()

    const listingRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM citizen_market_listing
      WHERE id = ${params.data.listingId}
        AND seller_user_id = ${userId}
        AND is_active = TRUE
      LIMIT 1
    `
    if (!listingRows[0]) return reply.code(404).send({ error: 'listing_not_found' })

    const nextDescription =
      'description' in body.data ? (body.data.description?.trim() ? sanitizePlainText(body.data.description).trim() : null) : null

    const eTransferProvided = Object.prototype.hasOwnProperty.call(body.data, 'eTransferEmail')
    const nextETransferEmail = eTransferProvided ? (body.data.eTransferEmail?.trim() ? body.data.eTransferEmail.trim() : null) : null

    const hasPaymentTypesUpdate = Object.prototype.hasOwnProperty.call(body.data, 'paymentTypes')
    const nextPaymentTypes = hasPaymentTypesUpdate ? Array.from(new Set(body.data.paymentTypes ?? [])) : []

    const hasDeliveryOptionsUpdate = Object.prototype.hasOwnProperty.call(body.data, 'deliveryOptions')
    const nextDeliveryOptions = hasDeliveryOptionsUpdate ? readDeliveryOptions(body.data.deliveryOptions ?? {}) : {}

    const listingProvinceCodeProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingProvinceCode')
    const listingCommunitySlugProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingCommunitySlug')
    const nextListingProvinceCode = listingProvinceCodeProvided ? (body.data.listingProvinceCode?.trim() ? body.data.listingProvinceCode.trim().toUpperCase() : null) : null
    const nextListingCommunitySlug = listingCommunitySlugProvided
      ? (body.data.listingCommunitySlug?.trim() ? body.data.listingCommunitySlug.trim().toLowerCase() : null)
      : null

    const hasStatusUpdate = Object.prototype.hasOwnProperty.call(body.data, 'status')
    const hasDraftUpdate = Object.prototype.hasOwnProperty.call(body.data, 'isDraft')
    const nextStatus = hasStatusUpdate ? body.data.status : null
    const nextIsDraft = hasDraftUpdate ? body.data.isDraft : null

    const viewerScopeFollows = await readViewerCommunityFollows(userId)
    const viewerScope = viewerScopeFollows[0] ?? null

    await prisma.$executeRaw`
      UPDATE citizen_market_listing
      SET title = COALESCE(${body.data.title?.trim() ?? null}, title),
          description = CASE WHEN ${'description' in body.data} THEN ${nextDescription} ELSE description END,
          price_cents = COALESCE(${body.data.priceCents ?? null}, price_cents),
          currency = COALESCE(${body.data.currency?.toUpperCase() ?? null}, currency),
          photo_urls = CASE
            WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'photoUrls')} THEN ${JSON.stringify(body.data.photoUrls ?? [])}::jsonb
            ELSE photo_urls
          END,
          pickup_city = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupCity')} THEN ${body.data.pickupCity ?? null} ELSE pickup_city END,
          pickup_province = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupProvince')} THEN ${body.data.pickupProvince ?? null} ELSE pickup_province END,
          pickup_address_line1 = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupAddressLine1')} THEN ${body.data.pickupAddressLine1 ?? null} ELSE pickup_address_line1 END,
          pickup_address_line2 = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupAddressLine2')} THEN ${body.data.pickupAddressLine2 ?? null} ELSE pickup_address_line2 END,
          pickup_postal_code = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupPostalCode')} THEN ${body.data.pickupPostalCode ?? null} ELSE pickup_postal_code END,
          listing_province_code = CASE
            WHEN ${listingProvinceCodeProvided} THEN ${nextListingProvinceCode}
            ELSE COALESCE(listing_province_code, ${viewerScope?.provinceCode ?? null})
          END,
          listing_community_slug = CASE
            WHEN ${listingCommunitySlugProvided} THEN ${nextListingCommunitySlug}
            ELSE COALESCE(listing_community_slug, ${viewerScope?.communitySlug ?? null})
          END,
          payment_types = CASE WHEN ${hasPaymentTypesUpdate} THEN ${JSON.stringify(nextPaymentTypes)}::jsonb ELSE payment_types END,
          willing_to_deliver = COALESCE(${typeof body.data.willingToDeliver === 'boolean' ? body.data.willingToDeliver : null}, willing_to_deliver),
          delivery_options = CASE WHEN ${hasDeliveryOptionsUpdate} THEN ${JSON.stringify(nextDeliveryOptions)}::jsonb ELSE delivery_options END,
          e_transfer_email = CASE WHEN ${eTransferProvided} THEN ${nextETransferEmail} ELSE e_transfer_email END,
          status = CASE WHEN ${hasStatusUpdate} THEN ${nextStatus} ELSE status END,
          is_draft = CASE WHEN ${hasDraftUpdate} THEN ${nextIsDraft} ELSE is_draft END,
          updated_at = NOW()
      WHERE id = ${params.data.listingId}
    `

    return reply.send({ success: true })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/channels', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const orgSlug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug },
      select: { id: true, ownerId: true, name: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const [membership, follow, viewer] = await Promise.all([
      prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } }),
      prisma.businessFollow.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
    ])

    const isOwner = org.ownerId === userId
    const viewerRole = isOwner ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null
    const associated = isOwner || Boolean(membership) || Boolean(follow)
    if (!associated) return reply.code(403).send({ error: 'forbidden' })

    const orgPrefs = readOrgChatPrefs(viewer?.communityMeta ?? null, org.id)

    const threads = await prisma.messageThread.findMany({
      where: {
        type: MessageThreadType.group,
        contextType: ORG_CHANNEL_CONTEXT_TYPE,
        contextId: { startsWith: `${org.id}|` },
      },
      include: THREAD_SUMMARY_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    })

    const items = threads
      .map((thread: ThreadSummaryRecord) => {
        const parsed = parseOrgChannelContextId(thread.contextId)
        if (!parsed || parsed.orgId !== org.id) return null
        const participant = thread.participants.find((entry: ThreadParticipantRecord) => entry.userId === userId)
        if (parsed.visibility === 'private' && !participant && !viewerRole) return null
        const channelPrefs = orgPrefs.channels?.[thread.id] ?? {}
        const unread = thread.messages[0]
          ? participant?.lastReadAt
            ? new Date(thread.messages[0].createdAt).getTime() > new Date(participant.lastReadAt).getTime() && thread.messages[0].senderId !== userId
            : thread.messages[0].senderId !== userId
          : false
        return {
          id: thread.id,
          name: parsed.name,
          slug: parsed.slug,
          visibility: parsed.visibility,
          joined: Boolean(participant),
          isOwner: participant?.role === MessageParticipantRole.admin,
          unread,
          participantCount: thread.participants.length,
          lastMessageAt: thread.lastMessageAt ?? thread.updatedAt,
          lastMessage: thread.messages[0] ? formatMessage(thread.messages[0], userId) : null,
          notification: {
            muteChannel: Boolean(channelPrefs?.muteChannel),
            mentionsOnly: Boolean(channelPrefs?.mentionsOnly),
          },
        }
      })
      .filter(Boolean)

    return reply.send({
      organization: { id: org.id, name: org.name, viewerRole },
      serverNotification: {
        muteServer: Boolean(orgPrefs.muteServer),
        mentionsOnly: Boolean(orgPrefs.mentionsOnly),
      },
      items,
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/channels', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgChannelCreateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership =
      org.ownerId === userId
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
    if (!membership || (membership.role !== 'MANAGER' && membership.role !== 'OWNER')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const name = body.data.name.trim()
    const slug = slugifyChannelName(name)
    if (!slug) return reply.code(400).send({ error: 'invalid_channel_name' })
    const uniqueKey = `orgchan:${org.id}:${slug}`
    const now = new Date()

    const existing = await prisma.messageThread.findUnique({ where: { uniqueKey } })
    if (existing) return reply.code(409).send({ error: 'channel_exists' })

    const thread = await prisma.messageThread.create({
      data: {
        type: MessageThreadType.group,
        uniqueKey,
        contextType: ORG_CHANNEL_CONTEXT_TYPE,
        contextId: buildOrgChannelContextId(org.id, body.data.visibility, slug, name),
        lastMessageAt: now,
        participants: {
          create: [{ userId, role: MessageParticipantRole.admin, lastReadAt: now, lastActivityAt: now }],
        },
      },
      include: THREAD_SUMMARY_INCLUDE,
    })

    return reply.code(201).send({
      channel: {
        id: thread.id,
        name,
        slug,
        visibility: body.data.visibility,
      },
      thread: formatThreadSummaryRecord(thread, userId),
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/join', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = CommunityOrgChannelParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const thread = await prisma.messageThread.findFirst({
      where: { id: params.data.channelId, contextType: ORG_CHANNEL_CONTEXT_TYPE, type: MessageThreadType.group },
      include: THREAD_WITH_PARTICIPANTS_INCLUDE,
    })
    if (!thread) return reply.code(404).send({ error: 'channel_not_found' })

    const parsed = parseOrgChannelContextId(thread.contextId)
    if (!parsed) return reply.code(404).send({ error: 'channel_not_found' })
    if (parsed.visibility === 'private') return reply.code(403).send({ error: 'private_channel_invite_required' })

    if (!thread.participants.some((entry: ThreadParticipantRecord) => entry.userId === userId)) {
      await prisma.messageParticipant.create({
        data: {
          threadId: thread.id,
          userId,
          role: MessageParticipantRole.member,
          lastActivityAt: new Date(),
        },
      })
    }

    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/invite', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = CommunityOrgChannelParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgChannelInviteBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const thread = await prisma.messageThread.findFirst({
      where: { id: params.data.channelId, contextType: ORG_CHANNEL_CONTEXT_TYPE, type: MessageThreadType.group },
      include: THREAD_WITH_PARTICIPANTS_INCLUDE,
    })
    if (!thread) return reply.code(404).send({ error: 'channel_not_found' })

    const inviter = thread.participants.find((entry: ThreadParticipantRecord) => entry.userId === userId)
    if (!inviter || inviter.role !== MessageParticipantRole.admin) {
      return reply.code(403).send({ error: 'only_channel_owner_can_invite' })
    }

    const targetUserId = body.data.userId
    if (thread.participants.some((entry: ThreadParticipantRecord) => entry.userId === targetUserId)) {
      return reply.send({ success: true })
    }

    await prisma.messageParticipant.create({
      data: {
        threadId: thread.id,
        userId: targetUserId,
        role: MessageParticipantRole.member,
        lastActivityAt: new Date(),
      },
    })

    const refreshed = await prisma.messageThread.findUnique({ where: { id: thread.id }, include: THREAD_SUMMARY_INCLUDE })
    if (refreshed) {
      await dispatchRealtimeEvent(targetUserId, {
        type: 'thread.created',
        data: { thread: formatThreadSummaryRecord(refreshed, targetUserId) },
      })
    }

    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/leave', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = CommunityOrgChannelParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const participant = await prisma.messageParticipant.findUnique({
      where: { threadId_userId: { threadId: params.data.channelId, userId } },
      select: { role: true },
    })
    if (!participant) return reply.code(404).send({ error: 'not_joined' })
    if (participant.role === MessageParticipantRole.admin) return reply.code(400).send({ error: 'owner_cannot_leave_channel' })

    await prisma.messageParticipant.delete({
      where: { threadId_userId: { threadId: params.data.channelId, userId } },
    })

    await dispatchRealtimeEvent(userId, {
      type: 'thread.removed',
      data: { threadId: params.data.channelId },
    })

    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/channels/:channelId/notification', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = CommunityOrgChannelParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgChannelNotificationBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })
    const thread = await prisma.messageThread.findUnique({ where: { id: params.data.channelId }, select: { contextId: true, contextType: true } })
    if (!thread || thread.contextType !== ORG_CHANNEL_CONTEXT_TYPE) return reply.code(404).send({ error: 'channel_not_found' })
    const parsed = parseOrgChannelContextId(thread.contextId)
    if (!parsed) return reply.code(404).send({ error: 'channel_not_found' })

    const baseMeta = user.communityMeta && typeof user.communityMeta === 'object' && !Array.isArray(user.communityMeta)
      ? ({ ...(user.communityMeta as Record<string, unknown>) } as Record<string, unknown>)
      : {}
    const currentOrgPrefs = readOrgChatPrefs(baseMeta, parsed.orgId)
    const nextChannels = { ...(currentOrgPrefs.channels ?? {}) }
    const channelPrefs = { ...(nextChannels[params.data.channelId] ?? {}) }
    if (typeof body.data.muteChannel === 'boolean') channelPrefs.muteChannel = body.data.muteChannel
    if (typeof body.data.mentionsOnly === 'boolean') channelPrefs.mentionsOnly = body.data.mentionsOnly
    nextChannels[params.data.channelId] = channelPrefs

    const orgChatPrefs = baseMeta.orgChatPrefs && typeof baseMeta.orgChatPrefs === 'object' && !Array.isArray(baseMeta.orgChatPrefs)
      ? ({ ...(baseMeta.orgChatPrefs as Record<string, unknown>) } as Record<string, unknown>)
      : {}
    orgChatPrefs[parsed.orgId] = {
      ...currentOrgPrefs,
      channels: nextChannels,
    }
    baseMeta.orgChatPrefs = orgChatPrefs

    await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta } })
    return reply.send({ success: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/channels/notification', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgServerNotificationBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })

    const baseMeta = user.communityMeta && typeof user.communityMeta === 'object' && !Array.isArray(user.communityMeta)
      ? ({ ...(user.communityMeta as Record<string, unknown>) } as Record<string, unknown>)
      : {}
    const currentOrgPrefs = readOrgChatPrefs(baseMeta, org.id)

    const nextOrgPrefs: OrgChatPrefs = {
      ...currentOrgPrefs,
      channels: { ...(currentOrgPrefs.channels ?? {}) },
    }
    if (typeof body.data.muteServer === 'boolean') nextOrgPrefs.muteServer = body.data.muteServer
    if (typeof body.data.mentionsOnly === 'boolean') nextOrgPrefs.mentionsOnly = body.data.mentionsOnly

    const orgChatPrefs = baseMeta.orgChatPrefs && typeof baseMeta.orgChatPrefs === 'object' && !Array.isArray(baseMeta.orgChatPrefs)
      ? ({ ...(baseMeta.orgChatPrefs as Record<string, unknown>) } as Record<string, unknown>)
      : {}
    orgChatPrefs[org.id] = nextOrgPrefs
    baseMeta.orgChatPrefs = orgChatPrefs

    await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta } })
    return reply.send({ success: true })
  }),
)

app.get('/org-channels/unread-count', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true, communityMeta: true } })
    if (!user) return reply.send({ count: 0 })

    const threads = await prisma.messageThread.findMany({
      where: {
        contextType: ORG_CHANNEL_CONTEXT_TYPE,
        type: MessageThreadType.group,
        participants: { some: { userId } },
      },
      include: THREAD_SUMMARY_INCLUDE,
    })

    let count = 0
    for (const thread of threads) {
      const parsed = parseOrgChannelContextId(thread.contextId)
      if (!parsed) continue
      const orgPrefs = readOrgChatPrefs(user.communityMeta ?? null, parsed.orgId)
      if (orgPrefs.muteServer) continue
      const channelPrefs = orgPrefs.channels?.[thread.id]
      if (channelPrefs?.muteChannel) continue

      const participant = thread.participants.find((entry: ThreadParticipantRecord) => entry.userId === userId)
      const lastMessage = thread.messages[0]
      if (!participant || !lastMessage || lastMessage.senderId === userId) continue

      const unread = participant.lastReadAt
        ? new Date(lastMessage.createdAt).getTime() > new Date(participant.lastReadAt).getTime()
        : true
      if (!unread) continue

      const mentionsOnly = channelPrefs?.mentionsOnly ?? orgPrefs.mentionsOnly
      if (mentionsOnly) {
        const needle = `@${user.handle}`.toLowerCase()
        if (!(lastMessage.body ?? '').toLowerCase().includes(needle)) {
          continue
        }
      }

      count += 1
    }

    return reply.send({ count })
  }),
)

app.get('/org-channels', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true, communityMeta: true } })
    if (!user) return reply.send({ items: [] })

    const threads = await prisma.messageThread.findMany({
      where: {
        contextType: ORG_CHANNEL_CONTEXT_TYPE,
        type: MessageThreadType.group,
        participants: { some: { userId } },
      },
      include: THREAD_SUMMARY_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    })

    type UnreadCountRow = { threadId: string; count: number }
    const threadIds = threads.map((thread: ThreadSummaryRecord) => thread.id)
    const unreadRows = threadIds.length
      ? (await prisma.$queryRaw(Prisma.sql`
          SELECT m."threadId" as "threadId", COUNT(*)::int as "count"
          FROM "Message" m
          JOIN "MessageParticipant" mp ON mp."threadId" = m."threadId"
          WHERE mp."userId" = ${userId}
            AND m."threadId" IN (${Prisma.join(threadIds)})
            AND m."senderId" <> ${userId}
            AND m."deletedAt" IS NULL
            AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
          GROUP BY m."threadId"
        `)) as UnreadCountRow[]
      : []
    const unreadCountByThreadId = new Map(
      unreadRows.map((row: UnreadCountRow) => [row.threadId, Number(row.count) || 0]),
    )

    const orgIds = Array.from(
      new Set(
        threads
          .map((thread: ThreadSummaryRecord) => parseOrgChannelContextId(thread.contextId)?.orgId ?? null)
          .filter((value: string | null): value is string => Boolean(value)),
      ),
    )

    type OrganizationChannelOrgRow = {
      id: string
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      logoUrl: string | null
      coverUrl: string | null
    }

    const orgs: OrganizationChannelOrgRow[] = orgIds.length
      ? await prisma.business.findMany({
          where: { id: { in: orgIds } },
          select: {
            id: true,
            name: true,
            slug: true,
            provinceCode: true,
            communitySlug: true,
            logoUrl: true,
            coverUrl: true,
          },
        })
      : []
    const orgById = new Map<string, OrganizationChannelOrgRow>(orgs.map((org: OrganizationChannelOrgRow) => [org.id, org]))

    const items = threads
      .map((thread: ThreadSummaryRecord) => {
        const parsed = parseOrgChannelContextId(thread.contextId)
        if (!parsed) return null
        const org = orgById.get(parsed.orgId)
        if (!org || !org.provinceCode || !org.communitySlug) return null

        const orgPrefs = readOrgChatPrefs(user.communityMeta ?? null, parsed.orgId)
        const channelPrefs = orgPrefs.channels?.[thread.id]

        const lastMessage = thread.messages[0]
        const unreadCount = unreadCountByThreadId.get(thread.id) ?? 0
        const unread = unreadCount > 0

        return {
          id: thread.id,
          name: parsed.name,
          slug: parsed.slug,
          visibility: parsed.visibility,
          unread,
          unreadCount,
          participantCount: thread.participants.length,
          lastMessageAt: thread.lastMessageAt ?? thread.updatedAt,
          notification: {
            muteServer: Boolean(orgPrefs.muteServer),
            muteChannel: Boolean(channelPrefs?.muteChannel),
            mentionsOnly: Boolean(channelPrefs?.mentionsOnly ?? orgPrefs.mentionsOnly),
          },
          lastMessage: lastMessage ? formatMessage(lastMessage, userId) : null,
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            province: org.provinceCode.toLowerCase(),
            municipality: org.communitySlug,
            logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
            coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
          },
        }
      })
      .filter(Boolean)

    return reply.send({ items })
  }),
)

const CommunityOrgPhotoUpdateBody = z.object({
  category: z.enum(['business_logo', 'business_cover']),
  displayAssetId: MediaAssetIdSchema,
  fullAssetId: MediaAssetIdSchema.optional(),
  caption: z.string().trim().max(5000).optional(),
})

app.post('/communities/:province/:municipality/orgs/:slug/profile-photo', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = CommunityOrgPhotoUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: {
        id: true,
        ownerId: true,
        provinceCode: true,
        communitySlug: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        status: true,
        isVerified: true,
        logoUrl: true,
        coverUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { follows: true } },
      },
    })

    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const isOwner = org.ownerId === userId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId } },
          select: { role: true },
        })
    if (!membership) return reply.code(403).send({ error: 'forbidden' })

    const displayAsset = await prisma.mediaAsset.findFirst({ where: { id: body.data.displayAssetId, ownerId: userId, category: body.data.category } })
    if (!displayAsset) return reply.code(404).send({ error: 'display_asset_not_found' })
    if (displayAsset.status === 'failed') return reply.code(400).send({ error: 'display_asset_failed' })
    if (displayAsset.status !== 'ready') return reply.code(409).send({ error: 'display_asset_not_ready' })

    const fullAssetId = body.data.fullAssetId ?? body.data.displayAssetId
    const fullAsset = await prisma.mediaAsset.findFirst({ where: { id: fullAssetId, ownerId: userId } })
    if (!fullAsset) return reply.code(404).send({ error: 'full_asset_not_found' })
    if (fullAsset.status === 'failed') return reply.code(400).send({ error: 'full_asset_failed' })
    if (fullAsset.status !== 'ready') return reply.code(409).send({ error: 'full_asset_not_ready' })

    const displayVariantPreference = body.data.category === 'business_logo' ? ['logo@2x', 'logo@1x', 'logo-thumb'] : ['cover-xl', 'cover-lg', 'cover-md']
    const displayUrl = extractVariantUrl(displayAsset.variants, displayVariantPreference)
    if (!displayUrl) return reply.code(400).send({ error: 'display_variant_missing' })

    const postVariantPreference = (() => {
      if (fullAsset.category === 'post_image') {
        return ['post-xl', 'post-lg', 'post-md']
      }
      if (fullAsset.category === 'business_cover' || fullAsset.category === 'cover') {
        return ['cover-xl', 'cover-lg', 'cover-md']
      }
      if (fullAsset.category === 'business_logo' || fullAsset.category === 'avatar') {
        return ['logo@2x', 'logo@1x', 'logo-thumb']
      }
      return ['post-xl', 'post-lg', 'post-md']
    })()

    const postMediaUrl = extractVariantUrl(fullAsset.variants, postVariantPreference)
    if (!postMediaUrl) return reply.code(400).send({ error: 'full_variant_missing' })

    const baseBody = body.data.category === 'business_logo' ? 'Updated organization profile photo.' : 'Updated organization cover photo.'
    const postBody = body.data.caption?.trim() ? body.data.caption.trim() : baseBody

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const post = await tx.post.create({
        data: {
          authorId: userId,
          businessId: org.id,
          body: postBody,
          mediaUrl: postMediaUrl,
          type: 'post',
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          jurisdiction: 'municipal',
        },
        include: POST_INCLUDE,
      })

      const businessUpdate: Prisma.BusinessUpdateInput =
        body.data.category === 'business_logo'
          ? { logoMedia: { connect: { id: displayAsset.id } }, logoUrl: displayUrl }
          : { coverMedia: { connect: { id: displayAsset.id } }, coverUrl: displayUrl }

      const updated = (await tx.business.update({
        where: { id: org.id },
        data: businessUpdate,
        select: {
          id: true,
          ownerId: true,
          provinceCode: true,
          communitySlug: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          status: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { follows: true } },
        },
      })) as CommunityOrgRecord

      return { post, org: updated }
    })

    return reply.send({
      ok: true,
      post: formatPost(result.post),
      org: buildCommunityOrgPayload(result.org as any, true, membership.role as any),
    })
  }),
)

app.get('/organizations/follows', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const follows: Array<{
      business: {
        id: string
        name: string
        slug: string
        provinceCode: string
        communitySlug: string
        isVerified: boolean
        logoUrl: string | null
        coverUrl: string | null
      } | null
    }> = (await prisma.businessFollow.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
      select: {
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            provinceCode: true,
            communitySlug: true,
            isVerified: true,
            logoUrl: true,
            coverUrl: true,
          },
        },
      },
    })) as any

    const items = follows.flatMap((row) =>
      row.business
        ? [
            {
              id: row.business.id,
              name: row.business.name,
              slug: row.business.slug,
              provinceCode: row.business.provinceCode,
              communitySlug: row.business.communitySlug,
              isVerified: row.business.isVerified,
              logoUrl: normalizeMediaUrl(row.business.logoUrl ?? null),
              coverUrl: normalizeMediaUrl(row.business.coverUrl ?? null),
            },
          ]
        : [],
    )

    return reply.send({ items })
  }),
)

app.get('/organizations/owned', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const organizations = (await prisma.business.findMany({
      where: { ownerId: userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        isVerified: true,
        status: true,
        logoUrl: true,
        coverUrl: true,
      },
    })) as Array<{
      id: string
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      isVerified: boolean
      status: BusinessStatus
      logoUrl: string | null
      coverUrl: string | null
    }>

    const items = organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      provinceCode: org.provinceCode,
      communitySlug: org.communitySlug,
      isVerified: org.isVerified,
      status: org.status,
      logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
      coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
    }))

    return reply.send({ items })
  }),
)

app.get('/organizations/memberships', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const memberships: Array<{
      role: string
      business: {
        id: string
        name: string
        slug: string
        provinceCode: string | null
        communitySlug: string | null
        isVerified: boolean
        status: BusinessStatus
        logoUrl: string | null
        coverUrl: string | null
      } | null
    }> = (await prisma.businessMembership.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
      select: {
        role: true,
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            provinceCode: true,
            communitySlug: true,
            isVerified: true,
            status: true,
            logoUrl: true,
            coverUrl: true,
          },
        },
      },
    })) as any

    const items = memberships.flatMap((row) =>
      row.business
        ? [
            {
              id: row.business.id,
              name: row.business.name,
              slug: row.business.slug,
              provinceCode: row.business.provinceCode,
              communitySlug: row.business.communitySlug,
              isVerified: row.business.isVerified,
              status: row.business.status,
              role: row.role,
              logoUrl: normalizeMediaUrl(row.business.logoUrl ?? null),
              coverUrl: normalizeMediaUrl(row.business.coverUrl ?? null),
            },
          ]
        : [],
    )

    return reply.send({ items })
  }),
)

app.get('/events', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(120),
        includePast: z.coerce.boolean().default(false),
        mine: z.enum(['going']).optional(),
      })
      .safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const viewerId = (await resolveUserId(req)) ?? null
    const now = Date.now()

    const organizationIds = new Set<string>()
    const communityKeys = new Set<string>()

    if (viewerId) {
      const [communityFollows, businessFollows, businessMemberships, ownedBusinesses] = await Promise.all([
        prisma.communityFollow.findMany({
          where: { userId: viewerId },
          select: { provinceCode: true, communitySlug: true },
        }),
        prisma.businessFollow.findMany({
          where: { userId: viewerId },
          select: { businessId: true },
        }),
        prisma.businessMembership.findMany({
          where: { userId: viewerId },
          select: { businessId: true },
        }),
        prisma.business.findMany({
          where: { ownerId: viewerId },
          select: { id: true },
        }),
      ])

      for (const follow of communityFollows) {
        if (!follow.provinceCode || !follow.communitySlug) continue
        communityKeys.add(`${follow.provinceCode}:${follow.communitySlug}`)
      }
      for (const follow of businessFollows) {
        organizationIds.add(follow.businessId)
      }
      for (const membership of businessMemberships) {
        organizationIds.add(membership.businessId)
      }
      for (const owned of ownedBusinesses) {
        organizationIds.add(owned.id)
      }
    }

    const whereOr: Prisma.BusinessWhereInput[] = []
    if (organizationIds.size) {
      whereOr.push({ id: { in: [...organizationIds] } })
    }
    if (communityKeys.size) {
      whereOr.push({
        OR: [...communityKeys].map((key) => {
          const [provinceCode, communitySlug] = key.split(':')
          return { provinceCode, communitySlug }
        }),
      })
    }

    if (viewerId && whereOr.length === 0) {
      return reply.send({ items: [] })
    }

    const organizations = await prisma.business.findMany({
      where: {
        status: BusinessStatus.ACTIVE,
        ...(whereOr.length ? { OR: whereOr } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        logoUrl: true,
        isVerified: true,
        metadata: true,
      },
      take: 1000,
    })

    const items = organizations.flatMap((org: (typeof organizations)[number]) => {
      const system = readOrganizationSystemState(org.metadata)
      const matchedByOrganization = organizationIds.has(org.id)
      const matchedByCommunity = org.provinceCode && org.communitySlug ? communityKeys.has(`${org.provinceCode}:${org.communitySlug}`) : false

      const events = system.events
        .filter((event) => event.status !== 'DRAFT' && event.access === 'PUBLIC')
        .filter((event) => {
          if (query.data.mine !== 'going') return true
          return system.eventRsvps.some((rsvp) => rsvp.eventId === event.id && rsvp.userId === viewerId && rsvp.status === 'GOING')
        })
        .filter((event) => {
          if (query.data.includePast) return true
          const startsAtMs = Date.parse(event.startsAt)
          return Number.isFinite(startsAtMs) ? startsAtMs >= now : true
        })

      return events.map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        category: event.category ?? 'Other',
        access: event.access,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        capacity: event.capacity,
        paid: event.paid,
        priceCents: event.priceCents,
        currency: event.currency,
        guestSpeakers: event.guestSpeakers,
        primaryPhotoUrl: event.primaryPhotoUrl,
        galleryPhotoUrls: event.galleryPhotoUrls,
        status: event.status ?? 'PUBLISHED',
        createdAt: event.createdAt,
        updatedAt: event.updatedAt ?? event.createdAt,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
          isVerified: org.isVerified,
        },
        matchedBy: {
          organization: matchedByOrganization,
          community: matchedByCommunity,
        },
      }))
    })

    items.sort((a: (typeof items)[number], b: (typeof items)[number]) => {
      const aTime = Date.parse(a.startsAt)
      const bTime = Date.parse(b.startsAt)
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        if (aTime !== bTime) return aTime - bTime
      }
      if (a.organization.name !== b.organization.name) {
        return a.organization.name.localeCompare(b.organization.name)
      }
      return a.title.localeCompare(b.title)
    })

    return reply.send({ items: items.slice(0, query.data.limit) })
  }),
)

app.get('/events/sidebar', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const [communityFollows, businessFollows, businessMemberships, ownedBusinesses] = await Promise.all([
      prisma.communityFollow.findMany({ where: { userId }, select: { provinceCode: true, communitySlug: true } }),
      prisma.businessFollow.findMany({ where: { userId }, select: { businessId: true } }),
      prisma.businessMembership.findMany({ where: { userId }, select: { businessId: true, role: true } }),
      prisma.business.findMany({ where: { ownerId: userId, status: BusinessStatus.ACTIVE }, select: { id: true } }),
    ])

    const organizationIds = new Set<string>([
      ...businessFollows.map((row: { businessId: string }) => row.businessId),
      ...businessMemberships.map((row: { businessId: string }) => row.businessId),
      ...ownedBusinesses.map((row: { id: string }) => row.id),
    ])

    const communityPairs = communityFollows
      .filter((row: { provinceCode: string | null; communitySlug: string | null }) => Boolean(row.provinceCode && row.communitySlug))
      .map((row: { provinceCode: string | null; communitySlug: string | null }) => ({ provinceCode: row.provinceCode, communitySlug: row.communitySlug }))

    const whereOr: Prisma.BusinessWhereInput[] = []
    if (organizationIds.size) whereOr.push({ id: { in: [...organizationIds] } })
    if (communityPairs.length) whereOr.push({ OR: communityPairs })

    const organizations = await prisma.business.findMany({
      where: {
        status: BusinessStatus.ACTIVE,
        ...(whereOr.length ? { OR: whereOr } : {}),
      },
      select: {
        id: true,
        ownerId: true,
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        isVerified: true,
        logoUrl: true,
        coverUrl: true,
        metadata: true,
      },
      take: 1000,
    })

    const membershipRoleMap = new Map<string, 'MANAGER' | null>()
    for (const membership of businessMemberships) {
      membershipRoleMap.set(membership.businessId, membership.role === 'MANAGER' ? 'MANAGER' : null)
    }

    const now = Date.now()
    const rsvps: Array<{
      id: string
      eventId: string
      title: string
      startsAt: string
      primaryPhotoUrl: string | null
      organization: {
        id: string
        name: string
        slug: string
        provinceCode: string | null
        communitySlug: string | null
        isVerified: boolean
      }
    }> = []

    const manageableOrganizations: Array<{
      id: string
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      isVerified: boolean
      logoUrl: string | null
      coverUrl: string | null
    }> = []

    for (const org of organizations) {
      const system = readOrganizationSystemState(org.metadata)
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === userId ? 'OWNER' : (membershipRoleMap.get(org.id) ?? null)
      const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId })

      if (canOrganizationPermission(permissions, 'manage_events')) {
        manageableOrganizations.push({
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          isVerified: org.isVerified,
          logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
          coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        })
      }

      const userRsvps = system.eventRsvps.filter((row) => row.userId === userId && row.status === 'GOING')
      if (!userRsvps.length) continue

      for (const row of userRsvps) {
        const event = system.events.find((item) => item.id === row.eventId)
        if (!event || event.status === 'DRAFT') continue
        const startsAtMs = Date.parse(event.startsAt)
        if (Number.isFinite(startsAtMs) && startsAtMs < now) continue

        rsvps.push({
          id: row.id,
          eventId: event.id,
          title: event.title,
          startsAt: event.startsAt,
          primaryPhotoUrl: event.primaryPhotoUrl ?? null,
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            provinceCode: org.provinceCode,
            communitySlug: org.communitySlug,
            isVerified: org.isVerified,
          },
        })
      }
    }

    rsvps.sort((a, b) => {
      const aTime = Date.parse(a.startsAt)
      const bTime = Date.parse(b.startsAt)
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime
      return a.title.localeCompare(b.title)
    })

    manageableOrganizations.sort((a, b) => a.name.localeCompare(b.name))

    return reply.send({
      rsvps: rsvps.slice(0, 12),
      manageableOrganizations: manageableOrganizations.slice(0, 12),
    })
  }),
)

app.get('/events/:organizationId/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const viewerId = (await resolveUserId(req)) ?? null

    const params = z
      .object({
        organizationId: z.string().trim().min(1).max(120),
        eventId: z.string().trim().min(3).max(120),
      })
      .safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const org = await prisma.business.findFirst({
      where: {
        id: params.data.organizationId,
        status: BusinessStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        logoUrl: true,
        coverUrl: true,
        isVerified: true,
        metadata: true,
      },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const system = readOrganizationSystemState(org.metadata)
    const event = system.events.find((item) => item.id === params.data.eventId)
    if (!event || event.status === 'DRAFT' || event.access !== 'PUBLIC') {
      return reply.code(404).send({ error: 'event_not_found' })
    }

    const eventRsvps = system.eventRsvps.filter((row) => row.eventId === event.id)
    const feeGoingCounts = new Map<string, number>()
    for (const row of eventRsvps) {
      if (row.status !== 'GOING') continue
      const ticketId = row.ticketId ?? null
      if (!ticketId) continue
      feeGoingCounts.set(ticketId, (feeGoingCounts.get(ticketId) ?? 0) + 1)
    }
    const viewerRsvp = viewerId ? eventRsvps.find((row) => row.userId === viewerId) ?? null : null
    const goingCount = eventRsvps.filter((row) => row.status === 'GOING').length
    const interestedCount = eventRsvps.filter((row) => row.status === 'INTERESTED').length

    return reply.send({
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        category: event.category ?? 'Other',
        access: event.access,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        capacity: event.capacity,
        paid: event.paid,
        priceCents: event.priceCents,
        currency: event.currency,
        fees: (event.fees ?? []).map((fee) => {
          const goingCountForFee = feeGoingCounts.get(fee.id) ?? 0
          const remainingCount = typeof fee.capacity === 'number' && fee.capacity > 0 ? Math.max(0, fee.capacity - goingCountForFee) : null
          return {
            id: fee.id,
            label: fee.label,
            amountCents: fee.amountCents,
            capacity: fee.capacity ?? null,
            cashOnly: fee.cashOnly !== false,
            goingCount: goingCountForFee,
            remainingCount,
          }
        }),
        guestSpeakers: event.guestSpeakers,
        primaryPhotoUrl: event.primaryPhotoUrl,
        galleryPhotoUrls: event.galleryPhotoUrls,
        status: event.status ?? 'PUBLISHED',
        createdAt: event.createdAt,
        updatedAt: event.updatedAt ?? event.createdAt,
      },
      viewerRsvp: viewerRsvp
        ? {
            id: viewerRsvp.id,
            status: viewerRsvp.status,
            ticketId: viewerRsvp.ticketId ?? null,
            ticketLabel: viewerRsvp.ticketLabel ?? null,
            amountCents: typeof viewerRsvp.amountCents === 'number' ? viewerRsvp.amountCents : null,
            message: viewerRsvp.message ?? null,
            createdAt: viewerRsvp.createdAt,
            updatedAt: viewerRsvp.updatedAt ?? viewerRsvp.createdAt,
          }
        : null,
      rsvpSummary: {
        goingCount,
        interestedCount,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        isVerified: org.isVerified,
      },
    })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/posts', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const query = CursorQuery.extend({
      jurisdiction: JurisdictionEnum.optional(),
      sort: PostSortEnum.optional(),
    }).safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(province, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const slug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const { cursor, limit, jurisdiction, sort } = query.data
    const sortMode = sort ?? 'new'

    const where: Prisma.PostWhereInput = {
      businessId: org.id,
      ...(jurisdiction ? { jurisdiction } : {}),
    }

    const viewerId = (req as any).user?.id as string | undefined

    if (viewerId) {
      const isOwner = org.ownerId === viewerId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: org.id, userId: viewerId } },
            select: { role: true },
          })
      if (!membership) {
        where.visibility = 'public'
      }
    } else {
      where.visibility = 'public'
    }

    let posts: PostWithAuthor[] = []
    let nextCursor: string | undefined

    if (sortMode === 'hot') {
      posts = await prisma.post.findMany({
        where,
        take: limit,
        orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
        include: POST_INCLUDE,
      })
    } else {
      const queryResult = await prisma.post.findMany({
        where,
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
        include: POST_INCLUDE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (queryResult.length > limit) {
        const next = queryResult.pop()!
        nextCursor = next.id
      }
      posts = queryResult
    }

    let votesByPost: Record<string, number> = {}
    if (viewerId && posts.length) {
      const votes = await prisma.vote.findMany({
        where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } },
        select: { postId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.postId] = vote.value
      }
      votesByPost = voteMap
    }

    const recentCommentsByPost = await getRecentCommentsByPostIds(posts.map((post) => post.id), 5)

    return reply.send({
      items: posts.map((post) =>
        formatPost(post, {
          viewerVote: votesByPost[post.id] ?? null,
          recentComments: recentCommentsByPost[post.id] ?? [],
        }),
      ),
      nextCursor,
    })
  }),
)

// Get post by slug
app.get('/posts/slug/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ slug: z.string() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid slug' })

    const post = await prisma.post.findUnique({
      where: { seoSlug: params.data.slug },
      include: POST_INCLUDE,
    })

    if (!post) return reply.code(404).send({ error: 'not found' })

    const viewerId = (req as any).user?.id as string | undefined

    if (post.visibility === 'members' && post.businessId) {
      if (!viewerId) return reply.code(404).send({ error: 'not found' })
      const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true } })
      const isOwner = business?.ownerId === viewerId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: post.businessId, userId: viewerId } },
            select: { role: true },
          })
      if (!membership) return reply.code(404).send({ error: 'not found' })
    }

    let viewerVote: number | null = null
    if (viewerId) {
      const vote = await prisma.vote.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId: post.id,
          },
        },
        select: { value: true },
      })
      viewerVote = vote?.value ?? null
    }

    const commentRows: CommentWithUser[] = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            premiumStatus: true,
          },
        },
      },
    })

    let viewerCommentVotes: Record<string, number> = {}
    if (viewerId && commentRows.length) {
      const commentIds = commentRows.map((comment) => comment.id)
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: commentIds } },
        select: { commentId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.commentId] = vote.value
      }
      viewerCommentVotes = voteMap
    }

    return {
      post: formatPost(post, { viewerVote }),
      paths: getCanonicalPaths(post),
      comments: buildCommentTree(commentRows, viewerCommentVotes),
    }
  }),
)

// Get post by id
app.get('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid id' })
    const post = await prisma.post.findUnique({
      where: { id: params.data.id },
      include: POST_INCLUDE,
    })
    if (!post) return reply.code(404).send({ error: 'not found' })
    const viewerId = (req as any).user?.id as string | undefined

    if (post.visibility === 'members' && post.businessId) {
      if (!viewerId) return reply.code(404).send({ error: 'not found' })
      const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true } })
      const isOwner = business?.ownerId === viewerId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: post.businessId, userId: viewerId } },
            select: { role: true },
          })
      if (!membership) return reply.code(404).send({ error: 'not found' })
    }

    let viewerVote: number | null = null
    if (viewerId) {
      const vote = await prisma.vote.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId: post.id,
          },
        },
        select: { value: true },
      })
      viewerVote = vote?.value ?? null
    }

    const commentRows: CommentWithUser[] = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            premiumStatus: true,
          },
        },
      },
    })

    let viewerCommentVotes: Record<string, number> = {}
    if (viewerId && commentRows.length) {
      const commentIds = commentRows.map((comment) => comment.id)
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: commentIds } },
        select: { commentId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.commentId] = vote.value
      }
      viewerCommentVotes = voteMap
    }

    return {
      post: formatPost(post, { viewerVote }),
      paths: getCanonicalPaths(post),
      comments: buildCommentTree(commentRows, viewerCommentVotes),
    }
  }),
)

// List posts (newest first) with cursor pagination
app.get('/posts', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const parse = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        jurisdiction: JurisdictionEnum.optional(),
        sort: PostSortEnum.optional(),
        scope: z.enum(['all', 'friends', 'network', 'communities', 'organizations']).optional(),
        province: z.string().optional(),
        community: z.string().optional(),
      })
      .safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
    const { cursor, limit, jurisdiction, sort, scope = 'all', province, community } = parse.data
    const authorSelect = {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      premiumStatus: true,
    }
    const where: Prisma.PostWhereInput = {}
    if (jurisdiction) {
      where.jurisdiction = jurisdiction
    }
    if (province && community) {
      const normalizedProvince = normalizeProvinceCode(province)
      if (!normalizedProvince) {
        return reply.code(400).send({ error: 'invalid_province' })
      }
      const communityRecord = findCommunity(normalizedProvince, community)
      if (!communityRecord) {
        return reply.code(404).send({ error: 'community_not_found' })
      }
      where.provinceCode = communityRecord.province
      where.communitySlug = communityRecord.slug
    }

    const viewerId = (req as any).user?.id as string | undefined

    // Privacy: members-only business posts should never leak into public feeds.
    // - Community-filtered views are public.
    // - Anonymous home feed is public.
    // - Logged-in home feed includes members-only only when user is a business member/owner.
    let memberBusinessIds: string[] = []
    if (province && community) {
      where.visibility = 'public'
    } else if (!viewerId) {
      where.visibility = 'public'
    }

    if (!viewerId && scope !== 'all' && !province && !community) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (viewerId && !province && !community) {
      const [ownedBusinesses, memberships] = await Promise.all([
        prisma.business.findMany({ where: { ownerId: viewerId }, select: { id: true } }) as Promise<Array<{ id: string }>>,
        prisma.businessMembership.findMany({ where: { userId: viewerId }, select: { businessId: true } }) as Promise<
          Array<{ businessId: string }>
        >,
      ])
      memberBusinessIds = Array.from(new Set([...ownedBusinesses.map((row) => row.id), ...memberships.map((row) => row.businessId)]))

      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
      where.AND = [
        ...existingAnd,
        {
          OR: [
            { visibility: 'public' },
            {
              visibility: 'members',
              businessId: { in: memberBusinessIds },
            },
          ],
        },
      ]

      const includeFriends = scope === 'all' || scope === 'friends'
      const includeNetwork = scope === 'all' || scope === 'network'
      const includeCommunities = scope === 'all' || scope === 'communities'
      const includeOrganizations = scope === 'all' || scope === 'organizations'

      const accessibleFilters: Prisma.PostWhereInput[] = []

      const [friendIds, connectionIds, communityFollows, businessFollows] = await Promise.all([
        includeFriends ? loadAcceptedFriendIds(viewerId) : Promise.resolve([] as string[]),
        includeNetwork ? loadAcceptedConnectionIds(viewerId) : Promise.resolve([] as string[]),
        includeCommunities
          ? prisma.communityFollow.findMany({
              where: { userId: viewerId },
              select: { provinceCode: true, communitySlug: true },
            })
          : Promise.resolve([] as Array<{ provinceCode: string; communitySlug: string }>),
        includeOrganizations
          ? (prisma.businessFollow.findMany({
              where: { userId: viewerId },
              select: { businessId: true },
            }) as Promise<Array<{ businessId: string }>>)
          : Promise.resolve([] as Array<{ businessId: string }>),
      ])

      if (includeFriends) {
        const allowedAuthorIds = new Set<string>([viewerId, ...friendIds])
        if (allowedAuthorIds.size) {
          // If scope is strictly 'friends', we only want posts that are NOT targeted at a community
          // unless the user specifically wants to see everything their friends posted.
          // The requirement is: "When viewing /friends we should only see posts with the context of the post subtype of friend; not a community post."
          // This implies we should filter out posts that have a communitySlug set, OR we should only include posts where audience is 'friends' or 'public' but not community-specific.
          // However, the current schema might not have an explicit 'audience' field that distinguishes this easily other than provinceCode/communitySlug being null.
          // Let's check if we can filter by provinceCode: null.

          accessibleFilters.push({
            authorId: { in: [...allowedAuthorIds] },
            communitySlug: null,
            ...(scope === 'friends'
              ? ({ audience: 'friends' } as any)
              : ({ audience: { in: ['friends'] } } as any)),
          })
        }
      }

      if (includeNetwork) {
        const allowedAuthorIds = new Set<string>([viewerId, ...connectionIds])
        if (allowedAuthorIds.size) {
          accessibleFilters.push({
            authorId: { in: [...allowedAuthorIds] },
            communitySlug: null,
            ...(scope === 'network'
              ? ({ audience: 'network' } as any)
              : ({ audience: { in: ['network'] } } as any)),
          })
        }
      }

      if (includeCommunities) {
        const seenKeys = new Set<string>()
        for (const follow of communityFollows) {
          if (!follow.provinceCode || !follow.communitySlug) continue
          const key = `${follow.provinceCode}:${follow.communitySlug}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          accessibleFilters.push({ provinceCode: follow.provinceCode, communitySlug: follow.communitySlug })
        }
      }

      if (includeOrganizations) {
        const businessIds = Array.from(
          new Set([...businessFollows.map((follow) => follow.businessId), ...memberBusinessIds]),
        )
        if (businessIds.length) {
          accessibleFilters.push({ businessId: { in: businessIds } })
        }
      }

      if (!accessibleFilters.length && scope !== 'all') {
        return { items: [], nextCursor: undefined }
      }

      if (accessibleFilters.length) {
        const existingAnd = Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : []
        where.AND = [...existingAnd, { OR: accessibleFilters }]
      }
    }
    const sortMode = sort ?? 'new'

    let items: PostWithAuthor[] = []
    let nextCursor: string | undefined = undefined
    let lastViewedAt: Date | null = null

    if (viewerId) {
      if (province && community) {
        const normalized = normalizeProvinceCode(province)
        const provinceCode = normalized ?? province
        const follow = await prisma.communityFollow.findUnique({
          where: {
            userId_provinceCode_communitySlug: {
              userId: viewerId,
              provinceCode,
              communitySlug: community.toLowerCase(),
            },
          },
          select: { lastViewedAt: true },
        })
        lastViewedAt = follow?.lastViewedAt ?? null
        if (!cursor && follow) {
          prisma.communityFollow
            .update({
              where: {
                userId_provinceCode_communitySlug: {
                  userId: viewerId,
                  provinceCode,
                  communitySlug: community.toLowerCase(),
                },
              },
              data: { lastViewedAt: new Date() },
            })
            .catch(console.error)
        }
      } else if (scope === 'friends') {
        const u = await prisma.user.findUnique({ where: { id: viewerId }, select: { lastViewedFriendsAt: true } })
        lastViewedAt = u?.lastViewedFriendsAt ?? null
        if (!cursor) {
          prisma.user.update({ where: { id: viewerId }, data: { lastViewedFriendsAt: new Date() } }).catch(console.error)
        }
      } else if (scope === 'network') {
        lastViewedAt = null
      } else if (scope === 'communities') {
        const u = await prisma.user.findUnique({ where: { id: viewerId }, select: { lastViewedCommunitiesAt: true } })
        lastViewedAt = u?.lastViewedCommunitiesAt ?? null
        if (!cursor) {
          prisma.user.update({ where: { id: viewerId }, data: { lastViewedCommunitiesAt: new Date() } }).catch(console.error)
        }
      } else if (scope === 'organizations') {
        lastViewedAt = null
      } else {
        // scope === 'all'
        const u = await prisma.user.findUnique({ where: { id: viewerId }, select: { lastViewedHomeAt: true } })
        lastViewedAt = u?.lastViewedHomeAt ?? null
        if (!cursor) {
          prisma.user.update({ where: { id: viewerId }, data: { lastViewedHomeAt: new Date() } }).catch(console.error)
        }
      }
    }

    const query = await prisma.post.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: POST_INCLUDE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (query.length > limit) {
      const next = query.pop()!
      nextCursor = next.id
    }
    items = query

    let votesByPost: Record<string, number> = {}
    if (viewerId && items.length) {
      const votes = await prisma.vote.findMany({
        where: { userId: viewerId, postId: { in: items.map((post) => post.id) } },
        select: { postId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.postId] = vote.value
      }
      votesByPost = voteMap
    }

    const recentCommentsByPost = await getRecentCommentsByPostIds(items.map((item) => item.id), 5)

    return {
      items: items.map((item) =>
        formatPost(item, {
          viewerVote: votesByPost[item.id] ?? null,
          recentComments: recentCommentsByPost[item.id] ?? [],
        }),
      ),
      nextCursor,
      lastViewedAt,
    }
  }),
)

app.get('/users/:handle/posts', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    try {
    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()

    const userRecord = await prisma.user.findUnique({
      where: { handle },
      select: {
        id: true,
        handle: true,
        name: true,
        bio: true,
        avatarUrl: true,
        coverUrl: true,
        avatarPostId: true,
        coverPostId: true,
        createdAt: true,
        premiumStatus: true,
      },
    })

    if (!userRecord) return reply.code(404).send({ error: 'user_not_found' })

    let followersCount = 0
    let followingCount = 0
    let friendsCount = 0
    let communitiesCount = 0
    let organizationsCount = 0
    let connectionsCount = 0
    try {
      const [friends, communities, organizations, connections] = await Promise.all([
        prisma.friendship.count({
          where: {
            status: FriendshipStatus.ACCEPTED,
            OR: [{ requesterId: userRecord.id }, { addresseeId: userRecord.id }],
          },
        }),
        prisma.communityFollow.count({ where: { userId: userRecord.id } }),
        prisma.business.count({
          where: {
            OR: [
              { ownerId: userRecord.id },
              { memberships: { some: { userId: userRecord.id } } },
              { follows: { some: { userId: userRecord.id } } },
            ],
          },
        }),
        prisma.connection.count({
          where: {
            status: ConnectionStatus.ACCEPTED,
            OR: [{ requesterId: userRecord.id }, { addresseeId: userRecord.id }],
          },
        }),
      ])
      friendsCount = friends
      communitiesCount = communities
      organizationsCount = organizations
      connectionsCount = connections
    } catch (error) {
      // Ignore
    }

    followersCount = 0
    followingCount = 0

    let experiences: Array<{
      id: string
      title: string
      organization: string
      location: string | null
      startDate: Date
      endDate: Date | null
      current: boolean
      description: string | null
      position: number
    }> = []

    try {
      experiences = await prisma.experience.findMany({
        where: { userId: userRecord.id },
        orderBy: [{ position: 'asc' }, { startDate: 'desc' }],
      })
    } catch (error) {
      if (!isExperienceTableMissing(error)) {
        throw error
      }
    }

    const normalizedExperienceOrganizationNames = Array.from(
      new Set(
        experiences
          .map((exp) => exp.organization.trim().toLowerCase())
          .filter((name) => name.length > 0),
      ),
    )

    const organizationByName = new Map<
      string,
      {
        id: string
        name: string
        slug: string
        provinceCode: string
        communitySlug: string
        logoUrl: string | null
        coverUrl: string | null
      }
    >()

    if (normalizedExperienceOrganizationNames.length > 0) {
      const linkedOrganizations = await prisma.business.findMany({
        where: {
          status: 'ACTIVE',
          OR: normalizedExperienceOrganizationNames.map((name) => ({
            name: {
              equals: name,
              mode: 'insensitive',
            },
          })),
        },
        orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          logoUrl: true,
          coverUrl: true,
        },
      })

      for (const org of linkedOrganizations) {
        if (!org.provinceCode || !org.communitySlug) continue
        const key = org.name.trim().toLowerCase()
        if (!key || organizationByName.has(key)) continue
        organizationByName.set(key, {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
          coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        })
      }
    }

    const mappedExperiences = experiences.map((exp) => ({
      organizationProfile: organizationByName.get(exp.organization.trim().toLowerCase()) ?? null,
      id: exp.id,
      title: exp.title,
      organization: exp.organization,
      location: exp.location,
      startDate: exp.startDate.toISOString(),
      endDate: exp.endDate ? exp.endDate.toISOString() : null,
      current: exp.current,
      description: exp.description,
    }))

    const normalizedProfile = normalizeUserMedia({
      ...userRecord,
      experiences: mappedExperiences,
    }) as typeof userRecord & { experiences: typeof mappedExperiences }

    const { premiumStatus, ...restProfile } = normalizedProfile
    const user = {
      ...restProfile,
      isPremium: isPremium(premiumStatus),
      isVerified: isPremium(premiumStatus),
      friendCount: friendsCount,
      followerCount: followersCount,
      followingCount,
      communityCount: communitiesCount,
      organizationCount: organizationsCount,
      connectionCount: connectionsCount,
    }

    const query = CursorQuery.extend({
      jurisdiction: JurisdictionEnum.optional(),
      sort: PostSortEnum.optional(),
      province: z.string().optional(),
      community: z.string().optional(),
      municipality: z.string().optional(),
    }).safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const {
      cursor,
      limit,
      jurisdiction,
      sort,
      province: provinceParam,
      community: communityParam,
      municipality,
    } = query.data
    const viewerId = (req as any).user?.id as string | undefined
    let relationship: {
      friendshipStatus: 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'
      friendshipId: string | null
      friendshipSince: Date | null
      connectionStatus: 'self' | 'connected' | 'incoming' | 'outgoing' | 'none'
      connectionId: string | null
      connectionSince: Date | null
    } = {
      friendshipStatus: 'none',
      friendshipId: null,
      friendshipSince: null,
      connectionStatus: 'none',
      connectionId: null,
      connectionSince: null,
    }

    if (viewerId) {
      if (viewerId === user.id) {
        relationship.friendshipStatus = 'self'
        relationship.connectionStatus = 'self'
      } else {
        try {
          const [friendship, connection] = await Promise.all([
            prisma.friendship.findFirst({
              where: {
                OR: [
                  { requesterId: viewerId, addresseeId: user.id },
                  { requesterId: user.id, addresseeId: viewerId },
                ],
              },
            }),
            findConnectionBetween(viewerId, user.id),
          ])

          let friendshipStatus: 'none' | 'friends' | 'incoming' | 'outgoing' = 'none'
          let friendshipId: string | null = null
          let friendshipSince: Date | null = null
          let connectionStatus: 'none' | 'connected' | 'incoming' | 'outgoing' = 'none'
          let connectionId: string | null = null
          let connectionSince: Date | null = null

          if (friendship) {
            friendshipId = friendship.id
            if (friendship.status === FriendshipStatus.ACCEPTED) {
              friendshipStatus = 'friends'
              friendshipSince = friendship.respondedAt ?? friendship.requestedAt
            } else if (friendship.status === FriendshipStatus.PENDING) {
              if (friendship.requesterId === viewerId) {
                friendshipStatus = 'outgoing'
              } else {
                friendshipStatus = 'incoming'
              }
            }
          }

          if (connection) {
            connectionId = connection.id
            if (connection.status === 'ACCEPTED') {
              connectionStatus = 'connected'
              connectionSince = connection.respondedAt ?? connection.requestedAt
            } else if (connection.status === 'PENDING') {
              if (connection.requesterId === viewerId) {
                connectionStatus = 'outgoing'
              } else {
                connectionStatus = 'incoming'
              }
            }
          }

          relationship = {
            friendshipStatus,
            friendshipId,
            friendshipSince,
            connectionStatus,
            connectionId,
            connectionSince,
          }
        } catch (error) {
          // Ignore
        }
      }
    }
    const sortMode = sort ?? 'new'

    const where: Prisma.PostWhereInput = {
      authorId: user.id,
      ...(jurisdiction ? { jurisdiction } : {}),
    }

    if (relationship.friendshipStatus !== 'self') {
      const allowedAudiences: string[] = []
      if (relationship.friendshipStatus === 'friends') {
        allowedAudiences.push('friends')
      }
      if (relationship.connectionStatus === 'connected') {
        allowedAudiences.push('network')
      }

      const audienceGate: Prisma.PostWhereInput = allowedAudiences.length
        ? {
            OR: [
              { communitySlug: { not: null } },
              ({ audience: { in: allowedAudiences } } as any),
            ],
          }
        : { communitySlug: { not: null } }

      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
      where.AND = [...existingAnd, audienceGate]
    }

    if (!viewerId) {
      where.visibility = 'public'
    } else {
      const [ownedBusinesses, memberships] = await Promise.all([
        prisma.business.findMany({ where: { ownerId: viewerId }, select: { id: true } }) as Promise<Array<{ id: string }>>,
        prisma.businessMembership.findMany({ where: { userId: viewerId }, select: { businessId: true } }) as Promise<
          Array<{ businessId: string }>
        >,
      ])
      const memberBusinessIds = Array.from(new Set([...ownedBusinesses.map((row) => row.id), ...memberships.map((row) => row.businessId)]))
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
      where.AND = [
        ...existingAnd,
        {
          OR: [
            { visibility: 'public' },
            {
              visibility: 'members',
              businessId: { in: memberBusinessIds },
            },
          ],
        },
      ]
    }

    const province = provinceParam ? normalizeProvinceCode(provinceParam) : null
    if (provinceParam && !province) {
      return reply.code(404).send({ error: 'province_not_found' })
    }
    if (province) {
      where.provinceCode = province
    }

    const municipalitySlug = municipality?.trim().toLowerCase() || null
    if (municipalitySlug && !province) {
      return reply.code(400).send({ error: 'province_required_for_municipality' })
    }

    let communitySlugFilter = communityParam ? slugifyCommunityName(communityParam) : null

    if (!communitySlugFilter && municipalitySlug && province) {
      const cityMatch = await prisma.city.findFirst({
        where: { provinceCode: province, slug: municipalitySlug },
        select: { communitySlug: true },
      })
      if (cityMatch?.communitySlug) {
        communitySlugFilter = cityMatch.communitySlug
      } else {
        const subdivisionMatch = await prisma.censusSubdivision.findFirst({
          where: { provinceCode: province, slug: municipalitySlug },
          select: { defaultCommunitySlug: true },
        })
        if (subdivisionMatch?.defaultCommunitySlug) {
          communitySlugFilter = subdivisionMatch.defaultCommunitySlug
        }
      }
    }

    if (communitySlugFilter) {
      where.communitySlug = communitySlugFilter
    }

    let posts: PostWithAuthor[] = []
    let nextCursor: string | undefined

    if (sortMode === 'hot') {
      posts = await prisma.post.findMany({
        where,
        take: limit,
        orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
        include: POST_INCLUDE,
      })
    } else {
      const queryResult = await prisma.post.findMany({
        where,
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
        include: POST_INCLUDE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (queryResult.length > limit) {
        const next = queryResult.pop()!
        nextCursor = next.id
      }
      posts = queryResult
    }

    let votesByPost: Record<string, number> = {}
    if (viewerId && posts.length) {
      const votes = await prisma.vote.findMany({
        where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } },
        select: { postId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.postId] = vote.value
      }
      votesByPost = voteMap
    }

    const recentCommentsByPost = await getRecentCommentsByPostIds(posts.map((post) => post.id), 5)

    return {
      user,
      relationship,
      items: posts.map((post) =>
        formatPost(post, {
          viewerVote: votesByPost[post.id] ?? null,
          recentComments: recentCommentsByPost[post.id] ?? [],
        }),
      ),
      nextCursor,
    }
  } catch (e: any) {
    req.log.error(e)
    return reply.code(500).send({ error: e.message, stack: e.stack })
  }
  }),
)

const BillingDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().max(50).optional(),
    address: z
      .object({
        line1: z.string().trim().max(200).optional(),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().max(120).optional(),
        state: z.string().trim().max(120).optional(),
        postalCode: z.string().trim().max(40).optional(),
        country: z.string().trim().length(2).optional(),
      })
      .partial()
      .optional(),
  })
  .partial()

const BillingProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  companyName: z.string().trim().max(160).optional().nullable(),
  email: z.string().trim().min(1).email(),
  phone: z.string().trim().max(50).optional().nullable(),
  country: z.string().trim().min(2).max(2),
  state: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).optional().nullable(),
  postalCode: z.string().trim().min(2).max(40),
  taxId: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

type BillingProfileInput = z.infer<typeof BillingProfileSchema>

type BillingProfileResponse = {
  firstName: string
  lastName: string
  companyName: string
  email: string
  phone: string
  country: string
  state: string
  city: string
  address1: string
  address2: string
  postalCode: string
  taxId: string
  notes: string
}

const BILLING_PROFILE_REQUIRED_FIELDS: Array<keyof BillingProfileResponse> = [
  'firstName',
  'lastName',
  'email',
  'country',
  'state',
  'city',
  'address1',
  'postalCode',
]

const BILLING_PROFILE_SELECT = {
  email: true,
  billingEmail: true,
  billingFirstName: true,
  billingLastName: true,
  billingCompanyName: true,
  billingPhone: true,
  billingCountry: true,
  billingState: true,
  billingCity: true,
  billingAddress1: true,
  billingAddress2: true,
  billingPostalCode: true,
  billingTaxId: true,
  billingNotes: true,
} as const

const EMPTY_BILLING_PROFILE: BillingProfileResponse = {
  firstName: '',
  lastName: '',
  companyName: '',
  email: '',
  phone: '',
  country: '',
  state: '',
  city: '',
  address1: '',
  address2: '',
  postalCode: '',
  taxId: '',
  notes: '',
}

function trimOrEmpty(value?: string | null) {
  if (!value) return ''
  const trimmed = value.trim()
  return trimmed.length ? trimmed : ''
}

function normalizeNullable(value?: string | null) {
  const trimmed = trimOrEmpty(value)
  return trimmed.length ? trimmed : null
}

function buildBillingProfileResponse(user: { email?: string | null } & Record<string, unknown>): BillingProfileResponse {
  return {
    firstName: trimOrEmpty((user as any).billingFirstName),
    lastName: trimOrEmpty((user as any).billingLastName),
    companyName: trimOrEmpty((user as any).billingCompanyName),
    email: trimOrEmpty((user as any).billingEmail ?? (user as any).email),
    phone: trimOrEmpty((user as any).billingPhone),
    country: trimOrEmpty((user as any).billingCountry).toUpperCase(),
    state: trimOrEmpty((user as any).billingState),
    city: trimOrEmpty((user as any).billingCity),
    address1: trimOrEmpty((user as any).billingAddress1),
    address2: trimOrEmpty((user as any).billingAddress2),
    postalCode: trimOrEmpty((user as any).billingPostalCode),
    taxId: trimOrEmpty((user as any).billingTaxId),
    notes: trimOrEmpty((user as any).billingNotes),
  }
}

function billingProfileIsComplete(profile: BillingProfileResponse) {
  return BILLING_PROFILE_REQUIRED_FIELDS.every((field) => Boolean(profile[field].trim()))
}

function missingBillingProfileFields(profile: BillingProfileResponse) {
  return BILLING_PROFILE_REQUIRED_FIELDS.filter((field) => !profile[field].trim())
}

function buildBillingProfileIncompleteError(profile: BillingProfileResponse) {
  return {
    error: 'billing_profile_incomplete',
    missingFields: missingBillingProfileFields(profile),
  }
}

function mapProfileInputToUserData(input: BillingProfileInput) {
  return {
    billingEmail: input.email.trim().toLowerCase(),
    billingFirstName: input.firstName.trim(),
    billingLastName: input.lastName.trim(),
    billingCompanyName: normalizeNullable(input.companyName),
    billingPhone: normalizeNullable(input.phone),
    billingCountry: input.country.trim().toUpperCase(),
    billingState: input.state.trim(),
    billingCity: input.city.trim(),
    billingAddress1: input.address1.trim(),
    billingAddress2: normalizeNullable(input.address2),
    billingPostalCode: input.postalCode.trim(),
    billingTaxId: normalizeNullable(input.taxId),
    billingNotes: normalizeNullable(input.notes),
  }
}

function convertProfileToBillingDetails(profile: BillingProfileResponse) {
  const name = `${profile.firstName} ${profile.lastName}`.trim() || profile.companyName || ''
  const addressAvailable =
    profile.address1 || profile.address2 || profile.city || profile.state || profile.postalCode || profile.country
  return {
    name: name || undefined,
    email: profile.email || undefined,
    phone: profile.phone || undefined,
    address: addressAvailable
      ? {
          line1: profile.address1 || undefined,
          line2: profile.address2 || undefined,
          city: profile.city || undefined,
          state: profile.state || undefined,
          postal_code: profile.postalCode || undefined,
          country: profile.country || undefined,
        }
      : undefined,
  }
}

const CheckoutFinalizeSchema = z.object({
  subscriptionId: z.string().trim().min(1),
})

const CheckoutPaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1),
  setupIntentId: z.string().trim().min(1).optional(),
  billingDetails: BillingDetailsSchema.optional(),
})

const PremiumCheckoutSchema = z.union([CheckoutPaymentSchema, CheckoutFinalizeSchema])

const PortalSessionSchema = z.object({
  returnUrl: z.string().url().optional(),
  businessId: z.string().cuid(),
})

const CreateBusinessInput = z.object({
  name: z.string().trim().min(3).max(160),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/i, { message: 'slug_invalid' })
    .optional(),
  description: z.string().trim().max(2000).optional(),
})

const BusinessCheckoutSchema = PremiumCheckoutSchema
const BusinessParam = z.object({ businessId: z.string().cuid() })
const SetupIntentSchema = z.object({ businessId: z.string().cuid().optional() })

class PaymentMethodOwnershipError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'PaymentMethodOwnershipError'
    this.statusCode = statusCode
  }
}

function isStripeError(error: unknown): error is Stripe.errors.StripeError & { code?: string } {
  return Boolean(error) && typeof error === 'object' && 'type' in (error as Record<string, unknown>)
}

function escapeStripeSearch(value: string) {
  return value.replace(/["\\]/g, '\\$&')
}

async function findStripeCustomerByEmail(stripe: Stripe, email: string) {
  const trimmed = email.trim()
  if (!trimmed) return null
  try {
    const search = await stripe.customers.search({ query: `email:"${escapeStripeSearch(trimmed)}"`, limit: 1 })
    if (search.data.length > 0) {
      return search.data[0] ?? null
    }
  } catch (error) {
    if (!isStripeError(error)) {
      throw error
    }
    // Search may be disabled on some accounts; fall back to list below.
  }
  const list = await stripe.customers.list({ email: trimmed, limit: 1 })
  return list.data.length > 0 ? list.data[0] ?? null : null
}

async function ensurePaymentMethodForCustomer(stripe: Stripe, customerId: string, paymentMethodId: string) {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    return
  } catch (error) {
    if (isStripeError(error)) {
      const message = error.message ?? ''
      if (error.code === 'resource_already_exists' || message.includes('has already been attached')) {
        return
      }
      if (message.includes('may not be used again')) {
        throw new PaymentMethodOwnershipError(
          'Stripe cannot reuse this payment method. Re-enter your card details and try again.',
          400,
        )
      }
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    const methodCustomer =
      typeof paymentMethod.customer === 'string'
        ? paymentMethod.customer
        : paymentMethod.customer?.id ?? null

    if (!methodCustomer) {
      throw error
    }

    if (methodCustomer === customerId) {
      return
    }

    throw new PaymentMethodOwnershipError(
      'This card is already linked to another Civil Citizens account. Please use a different card.',
      409,
    )
  }
}

const BUSINESS_SUMMARY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  isVerified: true,
  stripeSubscriptionId: true,
  stripePriceId: true,
  billingEmail: true,
  createdAt: true,
  updatedAt: true,
} as const

type StripeProcessResult =
  | { type: 'premium'; userId: string | null }
  | { type: 'business'; businessId: string | null; ownerId: string | null }
  | { type: 'ignored' }

function buildBusinessSlugBase(name: string) {
  return trimSlugLength(slugifyText(name), 80) || 'business'
}

async function generateUniqueBusinessSlug(ownerId: string, name: string) {
  let candidate = buildBusinessSlugBase(name)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await prisma.business.findFirst({ where: { ownerId, slug: candidate }, select: { id: true } })
    if (!existing) return candidate
    candidate = trimSlugLength(`${candidate}-${randomSlugSuffix()}`, 80) || `business-${randomSlugSuffix()}`
  }
  return `${candidate}-${randomSlugSuffix()}`.slice(0, 80)
}

async function ensureStripeCustomer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      premiumStatus: true,
      premiumSince: true,
      premiumRenewsAt: true,
      ...BILLING_PROFILE_SELECT,
    },
  })
  if (!user) throw new Error('user_not_found')
  if (user.stripeCustomerId) {
    return { customerId: user.stripeCustomerId, user }
  }
  const stripe = getStripeClient()
  if (user.email) {
    const existing = await findStripeCustomerByEmail(stripe, user.email)
    if (existing) {
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: existing.id } })
      return { customerId: existing.id, user: { ...user, stripeCustomerId: existing.id } }
    }
  }
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId },
  })
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } })
  return { customerId: customer.id, user: { ...user, stripeCustomerId: customer.id } }
}

async function loadOwnedBusiness(ownerId: string, businessId: string) {
  return prisma.business.findFirst({ where: { id: businessId, ownerId }, select: BUSINESS_SUMMARY_SELECT })
}

function ensurePriceAvailable(priceId: string | undefined, label: string) {
  if (!priceId) {
    throw Object.assign(new Error(`${label}_price_missing`), { statusCode: 503 })
  }
  return priceId
}

function resolveSubscriptionInvoice(subscription: Stripe.Subscription) {
  const invoiceField = subscription.latest_invoice
  const invoice = typeof invoiceField === 'object' && invoiceField ? (invoiceField as Stripe.Invoice) : null
  const paymentIntentField = invoice?.payment_intent
  const paymentIntent =
    paymentIntentField && typeof paymentIntentField === 'object'
      ? (paymentIntentField as Stripe.PaymentIntent)
      : null
  return { invoice, paymentIntent }
}

function paymentIntentRequiresAction(intent: Stripe.PaymentIntent | null | undefined) {
  if (!intent) return false
  return intent.status === 'requires_action' || intent.status === 'requires_confirmation'
}

function paymentIntentSucceeded(intent: Stripe.PaymentIntent | null | undefined) {
  if (!intent) return false
  return intent.status === 'succeeded' || intent.status === 'processing'
}

function extractStripeIdentifiers(event: Stripe.Event) {
  const rawObject = event.data?.object as unknown
  const dataObj = rawObject && typeof rawObject === 'object' ? (rawObject as Record<string, unknown>) : null
  if (!dataObj) {
    return { subscriptionId: null, invoiceId: null, customerId: null }
  }
  const rawId = typeof dataObj.id === 'string' ? (dataObj.id as string) : null
  const subscriptionField = (dataObj as { subscription?: string | { id?: string } }).subscription
  const subscriptionId = event.type.startsWith('customer.subscription')
    ? rawId
    : typeof subscriptionField === 'string'
      ? subscriptionField
      : typeof subscriptionField === 'object' && subscriptionField && typeof subscriptionField.id === 'string'
        ? subscriptionField.id
        : null

  const invoiceField = (dataObj as { invoice?: string }).invoice
  const invoiceId = event.type.startsWith('invoice.')
    ? rawId
    : typeof invoiceField === 'string'
      ? invoiceField
      : null

  const customerField = (dataObj as { customer?: string | { id?: string } }).customer
  const customerId =
    typeof customerField === 'string'
      ? customerField
      : typeof customerField === 'object' && customerField && typeof customerField.id === 'string'
        ? customerField.id
        : null

  return { subscriptionId, invoiceId, customerId }
}

async function recordStripeWebhookEvent(event: Stripe.Event) {
  const identifiers = extractStripeIdentifiers(event)
  const payload = JSON.parse(JSON.stringify(event))
  const now = new Date()
  return prisma.stripeWebhookEvent.upsert({
    where: { eventId: event.id },
    create: {
      eventId: event.id,
      eventType: event.type,
      apiVersion: event.api_version ?? null,
      livemode: Boolean(event.livemode),
      payload,
      subscriptionId: identifiers.subscriptionId,
      invoiceId: identifiers.invoiceId,
      customerId: identifiers.customerId,
      lastReceivedAt: now,
    },
    update: {
      eventType: event.type,
      apiVersion: event.api_version ?? null,
      livemode: Boolean(event.livemode),
      payload,
      subscriptionId: identifiers.subscriptionId,
      invoiceId: identifiers.invoiceId,
      customerId: identifiers.customerId,
      lastReceivedAt: now,
      retryCount: { increment: 1 },
      status: StripeWebhookStatus.RECEIVED,
    },
    select: { id: true },
  })
}

async function updateStripeWebhookEvent(
  recordId: string,
  data: Prisma.StripeWebhookEventUpdateInput,
) {
  await prisma.stripeWebhookEvent.update({
    where: { id: recordId },
    data,
  })
}

async function syncPremiumSubscription(subscription: Stripe.Subscription) {
  const userIdFromMetadata = subscription.metadata?.userId
  let user = userIdFromMetadata
    ? await prisma.user.findUnique({ where: { id: userIdFromMetadata }, select: { id: true, premiumSince: true } })
    : null

  if (!user) {
    user = await prisma.user.findFirst({
      where: { stripeSubscriptionId: subscription.id },
      select: { id: true, premiumSince: true },
    })
  }

  if (!user) {
    return { userId: null }
  }

  const status = mapSubscriptionStatus(subscription.status)
  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null

  const updateData: Prisma.UserUpdateInput = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price?.id ?? null,
    premiumStatus: status,
    premiumRenewsAt: periodEnd,
    premiumCanceledAt: status === 'CANCELED' ? new Date() : null,
  }

  if (!user.premiumSince && status === 'ACTIVE') {
    updateData.premiumSince = new Date()
  }

  await prisma.user.update({ where: { id: user.id }, data: updateData })
  return { userId: user.id }
}

async function syncBusinessSubscription(subscription: Stripe.Subscription) {
  const businessId = subscription.metadata?.businessId
  if (!businessId) {
    return { businessId: null, ownerId: null }
  }
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, ownerId: true, isVerified: true },
  })
  if (!business) {
    return { businessId: null, ownerId: null }
  }

  const status = businessStatusFromSubscription(subscription.status)
  const nextData: Prisma.BusinessUpdateInput = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price?.id ?? null,
    status,
  }
  if (status === 'ACTIVE') {
    nextData.isVerified = true
  }

  await prisma.business.update({ where: { id: business.id }, data: nextData })
  return { businessId: business.id, ownerId: business.ownerId }
}

type PaymentIntentWithExpandedCharges = Stripe.Response<Stripe.PaymentIntent> & {
  charges?: Stripe.ApiList<Stripe.Charge>
}

async function fetchPaymentFingerprint(stripe: Stripe, invoice: Stripe.Invoice) {
  const paymentIntentId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id
  if (!paymentIntentId) {
    return null
  }
  try {
    const paymentIntentResponse = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['charges.data.payment_method_details'],
    })
    const paymentIntent = paymentIntentResponse as PaymentIntentWithExpandedCharges
    const charge = paymentIntent.charges?.data?.[0]
    return charge?.payment_method_details?.card?.fingerprint ?? null
  } catch (error) {
    console.warn('[stripe] Unable to fetch payment intent fingerprint', { error })
    return null
  }
}

async function handleInvoicePaymentSucceeded(stripe: Stripe, invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id ?? null
  if (!subscriptionId) {
    return
  }
  const priceId = invoice.lines?.data?.find((line) => line.type === 'subscription')?.price?.id ?? null
  if (!priceId) {
    return
  }

  if (STRIPE_PRICE_PREMIUM && priceId === STRIPE_PRICE_PREMIUM) {
    const user = await prisma.user.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
    if (!user) return
    const fingerprint = await fetchPaymentFingerprint(stripe, invoice)
    if (fingerprint) {
      const hashed = createHash('sha256').update(fingerprint).digest('hex')
      await prisma.user.update({ where: { id: user.id }, data: { premiumPaymentFingerprint: hashed } })
    }
  } else if (STRIPE_PRICE_BUSINESS && priceId === STRIPE_PRICE_BUSINESS) {
    const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
    if (!business) return
    await prisma.business.update({ where: { id: business.id }, data: { status: 'ACTIVE', isVerified: true } })
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id ?? null
  if (!subscriptionId) {
    return
  }
  const user = await prisma.user.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { premiumStatus: 'PAST_DUE' } })
  }
  const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
  if (business) {
    await prisma.business.update({ where: { id: business.id }, data: { status: 'SUSPENDED' } })
  }
}

async function handleShopPaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata?.orderId
  if (!orderId) return

  await ensureOrganizationShopTables()

  const orderRows = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status
    FROM organization_shop_order
    WHERE id = ${orderId}
    LIMIT 1
  `
  const order = orderRows[0]
  if (!order) return
  if (order.status === 'paid' || order.status === 'fulfilled') {
    await prisma.$executeRaw`
      UPDATE organization_shop_payment
      SET status = ${paymentIntent.status}, updated_at = NOW()
      WHERE order_id = ${orderId}
    `
    return
  }

  await prisma.$executeRaw`
    UPDATE organization_shop_payment
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${paymentIntent.id}),
        status = ${paymentIntent.status},
        updated_at = NOW()
    WHERE order_id = ${orderId}
  `

  await prisma.$executeRaw`
    UPDATE organization_shop_order
    SET status = ${'paid'}, updated_at = NOW()
    WHERE id = ${orderId}
  `

  type PaidItemRow = {
    product_id: string | null
    quantity: number
    track_inventory: boolean | null
  }

  const itemRows = await prisma.$queryRaw<PaidItemRow[]>`
    SELECT oi.product_id, oi.quantity, p.track_inventory
    FROM organization_shop_order_item oi
    LEFT JOIN organization_shop_product p ON p.id = oi.product_id
    WHERE oi.order_id = ${orderId}
  `

  for (const item of itemRows) {
    if (!item.product_id) continue
    if (!item.track_inventory) continue
    let remaining = Number(item.quantity) || 0
    if (remaining <= 0) continue

    const inventoryRows = await prisma.$queryRaw<Array<{ warehouse_id: string; quantity: number }>>`
      SELECT warehouse_id, quantity
      FROM organization_shop_inventory
      WHERE product_id = ${item.product_id}
      ORDER BY quantity DESC
    `

    for (const inv of inventoryRows) {
      if (remaining <= 0) break
      const available = Number(inv.quantity) || 0
      if (available <= 0) continue
      const take = Math.min(remaining, available)
      remaining -= take
      await prisma.$executeRaw`
        UPDATE organization_shop_inventory
        SET quantity = GREATEST(quantity - ${take}, 0), updated_at = NOW()
        WHERE product_id = ${item.product_id} AND warehouse_id = ${inv.warehouse_id}
      `
    }
  }
}

async function handleShopPaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata?.orderId
  if (!orderId) return
  await ensureOrganizationShopTables()
  await prisma.$executeRaw`
    UPDATE organization_shop_payment
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${paymentIntent.id}),
        status = ${paymentIntent.status},
        updated_at = NOW()
    WHERE order_id = ${orderId}
  `
  await prisma.$executeRaw`
    UPDATE organization_shop_order
    SET status = ${'payment_failed'}, updated_at = NOW()
    WHERE id = ${orderId} AND status = ${'pending'}
  `
}

async function handleShopPaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata?.orderId
  if (!orderId) return
  await ensureOrganizationShopTables()
  await prisma.$executeRaw`
    UPDATE organization_shop_payment
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${paymentIntent.id}),
        status = ${paymentIntent.status},
        updated_at = NOW()
    WHERE order_id = ${orderId}
  `
  await prisma.$executeRaw`
    UPDATE organization_shop_order
    SET status = ${'canceled'}, updated_at = NOW()
    WHERE id = ${orderId} AND status = ${'pending'}
  `
}

async function processStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<StripeProcessResult> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.kind === 'shop_order') {
        await handleShopPaymentIntentSucceeded(paymentIntent)
      }
      return { type: 'ignored' }
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.kind === 'shop_order') {
        await handleShopPaymentIntentFailed(paymentIntent)
      }
      return { type: 'ignored' }
    }
    case 'payment_intent.canceled': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.kind === 'shop_order') {
        await handleShopPaymentIntentCanceled(paymentIntent)
      }
      return { type: 'ignored' }
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const kind = subscription.metadata?.kind ?? (subscription.metadata?.businessId ? 'business' : 'premium')
      if (kind === 'business') {
        const result = await syncBusinessSubscription(subscription)
        return { type: 'business', businessId: result.businessId, ownerId: result.ownerId }
      }
      const result = await syncPremiumSubscription(subscription)
      return { type: 'premium', userId: result.userId }
    }
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(stripe, event.data.object as Stripe.Invoice)
      return { type: 'ignored' }
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      return { type: 'ignored' }
    default:
      return { type: 'ignored' }
  }
}

app.get('/billing/summary', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      premiumStatus: true,
      premiumSince: true,
      premiumRenewsAt: true,
      ...BILLING_PROFILE_SELECT,
    },
  })
  if (!user) return reply.code(404).send({ error: 'user_not_found' })

  const businessCount = await prisma.business.count({ where: { ownerId: userId } })
  const billingProfile = buildBillingProfileResponse(user)
  const billingProfileMissing = missingBillingProfileFields(billingProfile)
  const billingProfileComplete = billingProfileMissing.length === 0
  return reply.send({
    stripeEnabled: isStripeConfigured(),
    premiumStatus: user.premiumStatus,
    isPremium: isPremium(user.premiumStatus),
    premiumSince: user.premiumSince ?? null,
    premiumRenewsAt: user.premiumRenewsAt ?? null,
    businessCount,
    businessLimit: MAX_BUSINESSES_PER_USER,
    billingProfile,
    billingProfileComplete,
    billingProfileMissing,
  })
})

app.put('/billing/profile', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const body = BillingProfileSchema.safeParse(req.body ?? {})
  if (!body.success) {
    return reply.code(400).send({ error: body.error.flatten() })
  }

  const data = mapProfileInputToUserData(body.data)
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: BILLING_PROFILE_SELECT,
  })

  const profile = buildBillingProfileResponse(user)
  return reply.send({
    profile,
    complete: billingProfileIsComplete(profile),
    missingFields: missingBillingProfileFields(profile),
  })
})

app.post('/billing/setup-intent', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })
  if (!STRIPE_PUBLISHABLE_KEY) return reply.code(503).send({ error: 'publishable_key_missing' })

  const body = SetupIntentSchema.safeParse(req.body ?? {})
  if (!body.success) {
    return reply.code(400).send({ error: body.error.flatten() })
  }

  if (body.data.businessId) {
    const business = await loadOwnedBusiness(userId, body.data.businessId)
    if (!business) return reply.code(404).send({ error: 'business_not_found' })
  }

  const stripe = getStripeClient()
  const { customerId, user } = await ensureStripeCustomer(userId)
  const billingProfile = buildBillingProfileResponse(user)
  if (!billingProfileIsComplete(billingProfile)) {
    return reply.code(412).send(buildBillingProfileIncompleteError(billingProfile))
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
    publishableKey: STRIPE_PUBLISHABLE_KEY,
  })
})

app.post('/billing/premium/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

  const body = PremiumCheckoutSchema.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const priceId = ensurePriceAvailable(STRIPE_PRICE_PREMIUM, 'premium')
  const stripe = getStripeClient()

  if ('paymentMethodId' in body.data) {
    const { user, customerId } = await ensureStripeCustomer(userId)
    const billingProfile = buildBillingProfileResponse(user)
    if (!billingProfileIsComplete(billingProfile)) {
      return reply.code(412).send(buildBillingProfileIncompleteError(billingProfile))
    }
    const billingDetails = convertProfileToBillingDetails(billingProfile)

    try {
      await ensurePaymentMethodForCustomer(stripe, customerId, body.data.paymentMethodId)
    } catch (error) {
      if (error instanceof PaymentMethodOwnershipError) {
        return reply.code(error.statusCode).send({ error: error.message })
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

    if (!isPremium(user.premiumStatus)) {
      await prisma.user.update({ where: { id: userId }, data: { premiumStatus: 'PENDING' } })
    }

    const { invoice, paymentIntent } = resolveSubscriptionInvoice(subscription)
    if (!paymentIntent) {
      return reply.code(502).send({ error: 'payment_intent_missing' })
    }
    const requiresAction = paymentIntentRequiresAction(paymentIntent)
    const paymentSucceeded = paymentIntentSucceeded(paymentIntent)

    if (paymentSucceeded) {
      await syncPremiumSubscription(subscription)
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
  const { paymentIntent } = resolveSubscriptionInvoice(stripeSubscription)
  const paymentSucceeded = paymentIntentSucceeded(paymentIntent)
  if (paymentSucceeded) {
    await syncPremiumSubscription(stripeSubscription)
  }

  return reply.send({
    subscriptionId: stripeSubscription.id,
    paymentIntentStatus: paymentIntent?.status ?? null,
    requiresAction: paymentIntentRequiresAction(paymentIntent),
    planApplied: paymentSucceeded,
  })
})

app.post('/billing/portal', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

  const body = PortalSessionSchema.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const business = await loadOwnedBusiness(userId, body.data.businessId)
  if (!business) return reply.code(404).send({ error: 'business_not_found' })
  if (!business.stripeSubscriptionId) return reply.code(409).send({ error: 'subscription_missing' })

  const stripe = getStripeClient()
  const { customerId } = await ensureStripeCustomer(userId)
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: body.data.returnUrl ?? BILLING_PORTAL_RETURN_FALLBACK,
  })
  return reply.send({ portalUrl: session.url })
})

app.post(
  '/billing/stripe/webhook',
  { config: { rawBody: true } },
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isStripeConfigured() || !STRIPE_WEBHOOK_SECRET) {
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

    const stripe = getStripeClient()
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(payloadBuffer, signature, STRIPE_WEBHOOK_SECRET)

    } catch (error) {
      req.log.error({ err: error }, 'stripe_webhook_signature_invalid')
      return reply.code(400).send({ error: 'invalid_signature' })
    }

    const record = await recordStripeWebhookEvent(event)
    await updateStripeWebhookEvent(record.id, {
      status: StripeWebhookStatus.PROCESSING,
      processingStartedAt: new Date(),
      lastError: null,
    })

    try {
      const result = await processStripeEvent(stripe, event)
      await updateStripeWebhookEvent(record.id, {
        status: result.type === 'ignored' ? StripeWebhookStatus.IGNORED : StripeWebhookStatus.PROCESSED,
        processedAt: new Date(),
        lastError: null,
        userId: result.type === 'premium' ? result.userId : result.type === 'business' ? result.ownerId : undefined,
        businessId: result.type === 'business' ? result.businessId : undefined,
      })
      return reply.send({ received: true })
    } catch (error) {
      await updateStripeWebhookEvent(record.id, {
        status: StripeWebhookStatus.FAILED,
        processedAt: new Date(),
        lastError: serializeError(error),
      })
      req.log.error({ err: error }, 'stripe_webhook_failed')
      return reply.code(500).send({ error: 'webhook_failure' })
    }
  },
)

app.get('/admin/env', async (req: FastifyRequest, reply: FastifyReply) => {
  let user: { id: string; email: string | null; name: string | null } | null
  try {
    user = await loadAuthenticatedUser(req)
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }

  if (!user || !isSuperAdminEmail(user.email)) {
    return reply.code(403).send({ error: 'forbidden' })
  }

  const envSources = (process.env.CIVIL_ENV_FILES || '')
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean)
  const primarySource = process.env.CIVIL_ENV_PRIMARY?.trim() || envSources.at(-1) || null
  const label = process.env.CIVIL_ENV_LABEL?.trim() || (process.env.NODE_ENV === 'production' ? 'production' : 'development')

  return reply.send({
    env: {
      label,
      primarySource,
      sources: envSources,
      nodeEnv: process.env.NODE_ENV || null,
      projectName: process.env.COMPOSE_PROJECT_NAME || null,
    },
    stripeEnabled: isStripeConfigured(),
    checklist: buildAdminChecklist(),
    generatedAt: new Date().toISOString(),
  })
})

app.get('/admin/geodata', async (req: FastifyRequest, reply: FastifyReply) => {
  let user: { id: string; email: string | null } | null
  try {
    user = await loadAuthenticatedUser(req)
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }

  if (!user || !isSuperAdminEmail(user.email)) {
    return reply.code(403).send({ error: 'forbidden' })
  }

  const [divisionStats, subdivisionStats, fsaStats] = await Promise.all([
    prisma.censusDivision.aggregate({ _count: true, _max: { updatedAt: true } }),
    prisma.censusSubdivision.aggregate({ _count: true, _max: { updatedAt: true } }),
    prisma.forwardSortationArea.aggregate({ _count: true, _max: { updatedAt: true } }),
  ])

  return reply.send({
    generatedAt: new Date().toISOString(),
    datasets: [
      {
        key: 'divisions',
        label: 'Census divisions',
        count: divisionStats._count ?? 0,
        lastUpdatedAt: divisionStats._max?.updatedAt?.toISOString() ?? null,
      },
      {
        key: 'subdivisions',
        label: 'Census subdivisions',
        count: subdivisionStats._count ?? 0,
        lastUpdatedAt: subdivisionStats._max?.updatedAt?.toISOString() ?? null,
      },
      {
        key: 'fsas',
        label: 'Forward sortation areas',
        count: fsaStats._count ?? 0,
        lastUpdatedAt: fsaStats._max?.updatedAt?.toISOString() ?? null,
      },
    ],
  })
})

const AdminIndustryInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminSubIndustryInput = z.object({
  industryId: z.string().cuid(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminIndustryUpdateInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminSubIndustryUpdateInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminIndustryIdParams = z.object({ industryId: z.string().cuid() })
const AdminSubIndustryIdParams = z.object({ subIndustryId: z.string().cuid() })

const DEFAULT_JOB_TAXONOMY: Array<{
  name: string
  slug: string
  sortOrder: number
  subIndustries: Array<{ name: string; slug: string; sortOrder: number }>
}> = [
  {
    name: 'Technology',
    slug: 'technology',
    sortOrder: 10,
    subIndustries: [
      { name: 'Software Development', slug: 'software-development', sortOrder: 10 },
      { name: 'IT Support', slug: 'it-support', sortOrder: 20 },
      { name: 'Data & AI', slug: 'data-ai', sortOrder: 30 },
    ],
  },
  {
    name: 'Healthcare',
    slug: 'healthcare',
    sortOrder: 20,
    subIndustries: [
      { name: 'Nursing', slug: 'nursing', sortOrder: 10 },
      { name: 'Allied Health', slug: 'allied-health', sortOrder: 20 },
      { name: 'Administration', slug: 'health-admin', sortOrder: 30 },
    ],
  },
  {
    name: 'Education',
    slug: 'education',
    sortOrder: 30,
    subIndustries: [
      { name: 'Teaching', slug: 'teaching', sortOrder: 10 },
      { name: 'Early Childhood', slug: 'early-childhood', sortOrder: 20 },
      { name: 'Academic Support', slug: 'academic-support', sortOrder: 30 },
    ],
  },
  {
    name: 'Government & Public Service',
    slug: 'government-public-service',
    sortOrder: 40,
    subIndustries: [
      { name: 'Administration', slug: 'public-admin', sortOrder: 10 },
      { name: 'Policy', slug: 'policy', sortOrder: 20 },
      { name: 'Community Services', slug: 'community-services', sortOrder: 30 },
    ],
  },
  {
    name: 'Trades & Construction',
    slug: 'trades-construction',
    sortOrder: 50,
    subIndustries: [
      { name: 'Skilled Trades', slug: 'skilled-trades', sortOrder: 10 },
      { name: 'General Labour', slug: 'general-labour', sortOrder: 20 },
      { name: 'Project Management', slug: 'construction-pm', sortOrder: 30 },
    ],
  },
  {
    name: 'Sales & Marketing',
    slug: 'sales-marketing',
    sortOrder: 60,
    subIndustries: [
      { name: 'Sales', slug: 'sales', sortOrder: 10 },
      { name: 'Marketing', slug: 'marketing', sortOrder: 20 },
      { name: 'Customer Success', slug: 'customer-success', sortOrder: 30 },
    ],
  },
  {
    name: 'Operations & Logistics',
    slug: 'operations-logistics',
    sortOrder: 70,
    subIndustries: [
      { name: 'Operations', slug: 'operations', sortOrder: 10 },
      { name: 'Supply Chain', slug: 'supply-chain', sortOrder: 20 },
      { name: 'Warehouse', slug: 'warehouse', sortOrder: 30 },
    ],
  },
]

async function loadAdminUserOrReply(req: FastifyRequest, reply: FastifyReply) {
  let user: { id: string; email: string | null } | null
  try {
    user = await loadAuthenticatedUser(req)
  } catch {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }

  if (!user || !isSuperAdminEmail(user.email)) {
    reply.code(403).send({ error: 'forbidden' })
    return null
  }

  return user
}

app.get('/admin/jobs/taxonomy', async (req: FastifyRequest, reply: FastifyReply) => {
  const user = await loadAdminUserOrReply(req, reply)
  if (!user) return

  const industries = await prisma.jobIndustry.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      subIndustries: {
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      },
    },
  })

  return reply.send({
    items: industries.map((industry: Prisma.JobIndustryGetPayload<{ include: { subIndustries: true } }>) => ({
      id: industry.id,
      name: industry.name,
      slug: industry.slug,
      description: industry.description,
      sortOrder: industry.sortOrder,
      active: industry.active,
      subIndustries: industry.subIndustries.map((subIndustry: Prisma.JobSubIndustryGetPayload<{}>) => ({
        id: subIndustry.id,
        industryId: subIndustry.industryId,
        name: subIndustry.name,
        slug: subIndustry.slug,
        description: subIndustry.description,
        sortOrder: subIndustry.sortOrder,
        active: subIndustry.active,
      })),
    })),
  })
})

app.post('/admin/jobs/seed', async (req: FastifyRequest, reply: FastifyReply) => {
  const user = await loadAdminUserOrReply(req, reply)
  if (!user) return

  const now = new Date()
  let industriesInserted = 0
  let subIndustriesInserted = 0

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const industrySeed of DEFAULT_JOB_TAXONOMY) {
      const existingIndustry = await tx.jobIndustry.findUnique({ where: { slug: industrySeed.slug }, select: { id: true } })
      let industryId = existingIndustry?.id
      if (!industryId) {
        const insertedIndustry = await tx.jobIndustry.create({
          data: {
            name: industrySeed.name,
            slug: industrySeed.slug,
            sortOrder: industrySeed.sortOrder,
            active: true,
          },
          select: { id: true },
        })
        industryId = insertedIndustry.id
        industriesInserted += 1
      }

      for (const subSeed of industrySeed.subIndustries) {
        const existingSub = await tx.jobSubIndustry.findFirst({
          where: {
            industryId,
            slug: subSeed.slug,
          },
          select: { id: true },
        })
        if (!existingSub) {
          await tx.jobSubIndustry.create({
            data: {
              industryId,
              name: subSeed.name,
              slug: subSeed.slug,
              sortOrder: subSeed.sortOrder,
              active: true,
            },
          })
          subIndustriesInserted += 1
        }
      }
    }

    await tx.$executeRaw`
      UPDATE "JobIndustry"
      SET "updatedAt" = ${now}
      WHERE "id" IN (
        SELECT "id" FROM "JobIndustry"
      )
    `
  })

  return reply.send({ ok: true, industriesInserted, subIndustriesInserted })
})

app.post('/admin/jobs/industries', async (req: FastifyRequest, reply: FastifyReply) => {
  const user = await loadAdminUserOrReply(req, reply)
  if (!user) return

  const body = AdminIndustryInput.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const slug = body.data.slug.trim().toLowerCase()
  const duplicate = await prisma.jobIndustry.findUnique({ where: { slug }, select: { id: true } })
  if (duplicate) return reply.code(409).send({ error: 'industry_slug_exists' })

  const created = await prisma.jobIndustry.create({
    data: {
      name: body.data.name.trim(),
      slug,
      description: body.data.description?.trim() || null,
      sortOrder: body.data.sortOrder,
      active: body.data.active,
    },
    select: { id: true },
  })

  return reply.code(201).send({ id: created.id })
})

app.put('/admin/jobs/industries/:industryId', async (req: FastifyRequest, reply: FastifyReply) => {
  const user = await loadAdminUserOrReply(req, reply)
  if (!user) return

  const params = AdminIndustryIdParams.safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
  const body = AdminIndustryUpdateInput.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const slug = body.data.slug.trim().toLowerCase()
  const duplicate = await prisma.jobIndustry.findFirst({
    where: { slug, id: { not: params.data.industryId } },
    select: { id: true },
  })
  if (duplicate) return reply.code(409).send({ error: 'industry_slug_exists' })

  const updated = await prisma.jobIndustry.updateMany({
    where: { id: params.data.industryId },
    data: {
      name: body.data.name.trim(),
      slug,
      description: body.data.description?.trim() || null,
      sortOrder: body.data.sortOrder,
      active: body.data.active,
      updatedAt: new Date(),
    },
  })
  if (!updated.count) return reply.code(404).send({ error: 'industry_not_found' })

  return reply.send({ ok: true })
})

app.post('/admin/jobs/sub-industries', async (req: FastifyRequest, reply: FastifyReply) => {
  const user = await loadAdminUserOrReply(req, reply)
  if (!user) return

  const body = AdminSubIndustryInput.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const parent = await prisma.jobIndustry.findUnique({ where: { id: body.data.industryId }, select: { id: true } })
  if (!parent) return reply.code(404).send({ error: 'industry_not_found' })

  const slug = body.data.slug.trim().toLowerCase()
  const duplicate = await prisma.jobSubIndustry.findFirst({
    where: { industryId: body.data.industryId, slug },
    select: { id: true },
  })
  if (duplicate) return reply.code(409).send({ error: 'sub_industry_slug_exists' })

  const created = await prisma.jobSubIndustry.create({
    data: {
      industryId: body.data.industryId,
      name: body.data.name.trim(),
      slug,
      description: body.data.description?.trim() || null,
      sortOrder: body.data.sortOrder,
      active: body.data.active,
    },
    select: { id: true },
  })

  return reply.code(201).send({ id: created.id })
})

app.put('/admin/jobs/sub-industries/:subIndustryId', async (req: FastifyRequest, reply: FastifyReply) => {
  const user = await loadAdminUserOrReply(req, reply)
  if (!user) return

  const params = AdminSubIndustryIdParams.safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
  const body = AdminSubIndustryUpdateInput.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const existing = await prisma.jobSubIndustry.findUnique({
    where: { id: params.data.subIndustryId },
    select: { id: true, industryId: true },
  })
  if (!existing) return reply.code(404).send({ error: 'sub_industry_not_found' })

  const slug = body.data.slug.trim().toLowerCase()
  const duplicate = await prisma.jobSubIndustry.findFirst({
    where: {
      industryId: existing.industryId,
      slug,
      id: { not: params.data.subIndustryId },
    },
    select: { id: true },
  })
  if (duplicate) return reply.code(409).send({ error: 'sub_industry_slug_exists' })

  const updated = await prisma.jobSubIndustry.updateMany({
    where: { id: params.data.subIndustryId },
    data: {
      name: body.data.name.trim(),
      slug,
      description: body.data.description?.trim() || null,
      sortOrder: body.data.sortOrder,
      active: body.data.active,
      updatedAt: new Date(),
    },
  })
  if (!updated.count) return reply.code(404).send({ error: 'sub_industry_not_found' })

  return reply.send({ ok: true })
})

app.post('/analytics/track', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = TrackViewInput.safeParse(req.body)
  if (!parse.success) {
    return reply.code(400).send({ error: parse.error.flatten() })
  }
  const { path, postId, referrer } = parse.data
  const userId = (req as any).user?.id ?? null
  try {

    await prisma.pageView.create({ data: { path, postId: postId ?? null, referrer: referrer ?? null, userId } })
  } catch (err) {
    req.log.error({ err }, 'track_view_failed')
    return reply.code(500).send({ error: 'tracking_failed' })
  }
  return reply.send({ ok: true })
})

app.get('/admin/reports/summary', async (req: FastifyRequest, reply: FastifyReply) => {
  let user: { id: string; email: string | null } | null
  try {
    user = await loadAuthenticatedUser(req)
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }

  if (!user || !isSuperAdminEmail(user.email)) {
    return reply.code(403).send({ error: 'forbidden' })
  }

  const query = req.query as Record<string, string | undefined>
  const { start: startParam, end: endParam, format } = query
  const range = parseRange(startParam, endParam)
  const today = startOfUtcDay(new Date())

  const [
    totalUsers,
    usersToday,
    totalPosts,
    postsToday,
    totalComments,
    commentsToday,
    totalReactions,
    reactionsToday,
    userSeries,
    postSeries,
    commentSeries,
    reactionSeries,
    pageViewSeries,
    jobsAddedSeries,
    applicantsSeries,
    applicationsViewedSeries,
    hiredSeries,
    routeTraffic,
    topPostViews,
    totalJobsAdded,
    jobsAddedToday,
    totalApplicants,
    applicantsToday,
    totalApplicationsViewed,
    applicationsViewedToday,
    totalApplicantsHired,
    applicantsHiredToday,
    organizationsViewedTotalRows,
    organizationsViewedTodayRows,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.post.count(),
    prisma.post.count({ where: { createdAt: { gte: today } } }),
    prisma.comment.count(),
    prisma.comment.count({ where: { createdAt: { gte: today } } }),
    prisma.postReaction.count(),
    prisma.postReaction.count({ where: { createdAt: { gte: today } } }),
    queryDailyCounts('users', range),
    queryDailyCounts('posts', range),
    queryDailyCounts('comments', range),
    queryDailyCounts('reactions', range),
    queryPageViewSeries(range),
    queryJobAnalyticsSeries('job_added', range),
    queryJobAnalyticsSeries('applicant_submitted', range),
    queryJobAnalyticsSeries('applications_viewed', range),
    queryJobAnalyticsSeries('applicant_hired', range),
    prisma.$queryRaw<Array<{ path: string; views: bigint }>>`
      select path, count(*)::bigint as views
      from "PageView"
      where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
      group by path
      order by views desc
      limit 50
    `,
    prisma.$queryRaw<Array<{ postId: string; views: bigint; title: string | null }>>`
      select pv."postId" as "postId", count(*)::bigint as views, p.title as title
      from "PageView" pv
      join "Post" p on p.id = pv."postId"
      where pv."postId" is not null and pv."createdAt" >= ${range.start} and pv."createdAt" < ${range.end}
      group by pv."postId", p.title
      order by views desc
      limit 20
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'job_added'::"JobAnalyticsEventKind"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'job_added'::"JobAnalyticsEventKind"
        and "createdAt" >= ${today}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applicant_submitted'::"JobAnalyticsEventKind"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applicant_submitted'::"JobAnalyticsEventKind"
        and "createdAt" >= ${today}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
        and "createdAt" >= ${today}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applicant_hired'::"JobAnalyticsEventKind"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applicant_hired'::"JobAnalyticsEventKind"
        and "createdAt" >= ${today}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(distinct "businessId")::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(distinct "businessId")::bigint as count
      from "JobAnalyticsEvent"
      where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
        and "createdAt" >= ${today}
    `,
  ])

  const jobsAddedTotalCount = Number(totalJobsAdded[0]?.count ?? 0)
  const jobsAddedTodayCount = Number(jobsAddedToday[0]?.count ?? 0)
  const applicantsTotalCount = Number(totalApplicants[0]?.count ?? 0)
  const applicantsTodayCount = Number(applicantsToday[0]?.count ?? 0)
  const applicationsViewedTotalCount = Number(totalApplicationsViewed[0]?.count ?? 0)
  const applicationsViewedTodayCount = Number(applicationsViewedToday[0]?.count ?? 0)
  const applicantsHiredTotalCount = Number(totalApplicantsHired[0]?.count ?? 0)
  const applicantsHiredTodayCount = Number(applicantsHiredToday[0]?.count ?? 0)
  const organizationsViewedTotalCount = Number(organizationsViewedTotalRows[0]?.count ?? 0)
  const organizationsViewedTodayCount = Number(organizationsViewedTodayRows[0]?.count ?? 0)

  const responsePayload = {
    generatedAt: new Date().toISOString(),
    users: {
      total: totalUsers,
      today: usersToday,
      series: userSeries,
    },
    posts: {
      total: totalPosts,
      today: postsToday,
      series: postSeries,
    },
    comments: {
      total: totalComments,
      today: commentsToday,
      series: commentSeries,
    },
    reactions: {
      total: totalReactions,
      today: reactionsToday,
      series: reactionSeries,
    },
    jobs: {
      added: {
        total: jobsAddedTotalCount,
        today: jobsAddedTodayCount,
        series: jobsAddedSeries,
      },
      applicants: {
        total: applicantsTotalCount,
        today: applicantsTodayCount,
        series: applicantsSeries,
      },
      applicationsViewed: {
        views: {
          total: applicationsViewedTotalCount,
          today: applicationsViewedTodayCount,
          series: applicationsViewedSeries,
        },
        organizations: {
          total: organizationsViewedTotalCount,
          today: organizationsViewedTodayCount,
        },
      },
      hired: {
        total: applicantsHiredTotalCount,
        today: applicantsHiredTodayCount,
        series: hiredSeries,
      },
    },
    pageViews: {
      series: pageViewSeries,
    },
    traffic: {
      routes: routeTraffic.map((row: { path: string; views: bigint }) => ({ path: row.path, views: Number(row.views) || 0 })),
      posts: topPostViews.map((row: { postId: string; views: bigint; title: string | null }) => ({ postId: row.postId, views: Number(row.views) || 0, title: row.title })),
    },
  }

  if (format === 'csv') {
    const dateMap = new Map<string, {
      users?: number
      posts?: number
      comments?: number
      reactions?: number
      views?: number
      jobsAdded?: number
      applicants?: number
      applicationsViewed?: number
      hired?: number
    }>()
    const ingest = (series: DailyCount[], key: keyof NonNullable<ReturnType<typeof dateMap.get>>) => {
      series.forEach((point) => {
        const existing = dateMap.get(point.date) || {}
        existing[key] = point.count
        dateMap.set(point.date, existing)
      })
    }
    ingest(userSeries, 'users')
    ingest(postSeries, 'posts')
    ingest(commentSeries, 'comments')
    ingest(reactionSeries, 'reactions')
    ingest(pageViewSeries, 'views')
    ingest(jobsAddedSeries, 'jobsAdded')
    ingest(applicantsSeries, 'applicants')
    ingest(applicationsViewedSeries, 'applicationsViewed')
    ingest(hiredSeries, 'hired')

    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    const rows = sortedDates.map((date) => {
      const entry = dateMap.get(date) || {}
      return [
        date,
        entry.users ?? 0,
        entry.posts ?? 0,
        entry.comments ?? 0,
        entry.reactions ?? 0,
        entry.views ?? 0,
        entry.jobsAdded ?? 0,
        entry.applicants ?? 0,
        entry.applicationsViewed ?? 0,
        entry.hired ?? 0,
      ].join(',')
    })

    const csv = ['date,users,posts,comments,reactions,pageViews,jobsAdded,applicants,applicationsViewed,applicantsHired', ...rows].join('\n')
    return reply.header('content-type', 'text/csv').send(csv)
  }

  return reply.send(responsePayload)
})

app.get('/notifications', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = NotificationListQuery.safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { limit, cursor } = parse.data
    const baseWhere: Prisma.NotificationWhereInput = { userId }

    const [rows, unreadCount] = await Promise.all<[NotificationRecord[], number]>([
      prisma.notification.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: NOTIFICATION_SELECT,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ])

    const actorIds = Array.from(new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id))))
    const actors: FriendUser[] = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: FRIEND_USER_SELECT })
      : []
    const actorMap = new Map(actors.map((actor) => [actor.id, formatFriendUser(actor)]))

    let nextCursor: string | undefined
    if (rows.length > limit) {
      const next = rows.pop()!
      nextCursor = next.id
    }

    return reply.send({
      items: rows.map((record) => ({
        ...formatNotification(record),
        actor: record.actorId ? actorMap.get(record.actorId) ?? null : null,
      })),
      nextCursor,
      unreadCount,
    })
  }),
)

app.get('/search/users', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = UserSearchQuery.safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { q, limit } = parse.data
    const normalizedQuery = normalizeSearchTerm(q)
    if (!normalizedQuery) {
      return reply.send({ items: [] })
    }

    const results = await searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit })

    return reply.send({
      items: results,
    })
  }),
)

app.get('/search', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CombinedSearchQuery.safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { q, type, limit, peopleLimit, communityLimit } = parse.data
    const normalizedQuery = normalizeSearchTerm(q)
    if (!normalizedQuery) {
      return reply.send({ people: [], communities: [], meta: { type } })
    }

    if (type === 'people') {
      const take = limit + 1
      const peopleResults = await searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit: take })
      const peopleHasMore = peopleResults.length > limit
      const trimmedPeople = peopleHasMore ? peopleResults.slice(0, limit) : peopleResults
      return reply.send({ people: trimmedPeople, meta: { type, peopleHasMore } })
    }

    if (type === 'communities') {
      const take = limit + 1
      const communityResults = await searchCommunitiesForQuery(normalizedQuery, take)
      const communitiesHasMore = communityResults.length > limit
      const trimmedCommunities = communitiesHasMore ? communityResults.slice(0, limit) : communityResults
      return reply.send({ communities: trimmedCommunities, meta: { type, communitiesHasMore } })
    }

    const peopleTake = peopleLimit + 1
    const communityTake = communityLimit + 1
    const [peopleResults, communityResults] = await Promise.all([
      searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit: peopleTake }),
      searchCommunitiesForQuery(normalizedQuery, communityTake),
    ])

    const peopleHasMore = peopleResults.length > peopleLimit
    const communitiesHasMore = communityResults.length > communityLimit

    return reply.send({
      people: peopleHasMore ? peopleResults.slice(0, peopleLimit) : peopleResults,
      communities: communitiesHasMore ? communityResults.slice(0, communityLimit) : communityResults,
      meta: {
        type,
        peopleHasMore,
        communitiesHasMore,
      },
    })
  }),
)

app.post('/notifications/:id/respond', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = NotificationRespondParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
    const body = NotificationRespondBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const notification = await prisma.notification.findFirst({
      where: { id: params.data.id, userId },
      select: NOTIFICATION_SELECT,
    })
    if (!notification) return reply.code(404).send({ error: 'notification_not_found' })

    if (notification.type !== EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE && notification.type !== EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE) {
      return reply.code(400).send({ error: 'notification_not_actionable' })
    }

    const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
      ? (notification.payload as Record<string, unknown>)
      : null
    if (!payload) return reply.code(400).send({ error: 'invalid_notification_payload' })

    const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'pending'
    if (statusRaw !== 'pending') {
      return reply.code(409).send({ error: 'invitation_not_pending' })
    }

    const hostOrganizationId = typeof payload.hostOrganizationId === 'string' ? payload.hostOrganizationId : ''
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : ''
    if (!hostOrganizationId || !eventId) {
      return reply.code(400).send({ error: 'invalid_notification_payload' })
    }

    const hostOrg = await prisma.business.findUnique({
      where: { id: hostOrganizationId },
      select: { id: true, metadata: true, provinceCode: true, communitySlug: true, slug: true },
    })
    if (!hostOrg) return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(hostOrg.metadata)
    const eventIndex = current.events.findIndex((entry) => entry.id === eventId)
    if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
    const previousEvent = current.events[eventIndex]
    if (!previousEvent) return reply.code(404).send({ error: 'event_not_found' })

    const nowIso = new Date().toISOString()
    const nextStatus = body.data.action === 'accept' ? 'ACCEPTED' : 'DECLINED'
    const nextStatusLower = body.data.action === 'accept' ? 'accepted' : 'declined'
    const nextEvent: OrgEventDefinition = {
      ...previousEvent,
      guestSpeakerInvites: [...(previousEvent.guestSpeakerInvites ?? [])],
      sponsorInvites: [...(previousEvent.sponsorInvites ?? [])],
      updatedAt: nowIso,
    }

    if (notification.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE) {
      const inviteIndex = nextEvent.guestSpeakerInvites.findIndex((invite) => invite.userId === userId)
      if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
      const invite = nextEvent.guestSpeakerInvites[inviteIndex]
      if (!invite || invite.status !== 'PENDING') {
        return reply.code(409).send({ error: 'invitation_not_pending' })
      }
      nextEvent.guestSpeakerInvites[inviteIndex] = {
        ...invite,
        status: nextStatus,
        respondedAt: nowIso,
        respondedByUserId: userId,
      }
    } else {
      const targetOrganizationId = typeof payload.targetOrganizationId === 'string' ? payload.targetOrganizationId : ''
      if (!targetOrganizationId) return reply.code(400).send({ error: 'invalid_notification_payload' })

      const targetOrg = await prisma.business.findUnique({
        where: { id: targetOrganizationId },
        select: { id: true, ownerId: true },
      })
      if (!targetOrg) return reply.code(404).send({ error: 'organization_not_found' })

      let authorized = targetOrg.ownerId === userId
      if (!authorized) {
        const membership = await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: targetOrg.id, userId } },
          select: { role: true },
        })
        authorized = membership?.role === 'OWNER' || membership?.role === 'MANAGER'
      }
      if (!authorized) return reply.code(403).send({ error: 'forbidden' })

      const inviteIndex = nextEvent.sponsorInvites.findIndex((invite) => invite.organizationId === targetOrganizationId)
      if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
      const invite = nextEvent.sponsorInvites[inviteIndex]
      if (!invite || invite.status !== 'PENDING') {
        return reply.code(409).send({ error: 'invitation_not_pending' })
      }
      nextEvent.sponsorInvites[inviteIndex] = {
        ...invite,
        status: nextStatus,
        respondedAt: nowIso,
        respondedByUserId: userId,
      }
    }

    const nextEvents = [...current.events]
    nextEvents[eventIndex] = nextEvent
    const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }

    await prisma.business.update({
      where: { id: hostOrg.id },
      data: {
        metadata: mergeOrganizationSystemStateIntoMetadata(hostOrg.metadata, nextSystem),
      },
      select: { id: true },
    })

    const nextPayload: Prisma.InputJsonValue = {
      ...payload,
      status: body.data.action === 'accept' ? 'accepted' : 'rejected',
      respondedAt: nowIso,
    }

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        payload: nextPayload,
        readAt: notification.readAt ?? new Date(),
      },
    })

    if (notification.actorId && notification.actorId !== userId) {
      const inviteKind = notification.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE ? 'guest_speaker' : 'sponsor'
      const responseType =
        notification.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE
          ? EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_RESPONSE
          : EVENT_NOTIFICATION_TYPES.SPONSOR_RESPONSE

      await createNotificationRecord({
        userId: notification.actorId,
        actorId: userId,
        type: responseType,
        payload: {
          invitationKind: inviteKind,
          status: nextStatusLower,
          eventId,
          eventTitle:
            typeof payload.eventTitle === 'string' && payload.eventTitle.trim()
              ? payload.eventTitle.trim()
              : previousEvent.title,
          url:
            typeof payload.url === 'string' && payload.url.trim().startsWith('/')
              ? payload.url.trim()
              : hostOrg.provinceCode && hostOrg.communitySlug && hostOrg.slug
                ? `/com/${encodeURIComponent(hostOrg.provinceCode)}/${encodeURIComponent(hostOrg.communitySlug)}/orgs/${encodeURIComponent(hostOrg.slug)}/events/${encodeURIComponent(eventId)}`
                : '/notifications',
          respondedAt: nowIso,
        },
      })
    }

    return reply.send({ ok: true, status: body.data.action === 'accept' ? 'accepted' : 'rejected' })
  }),
)

app.post('/notifications/ack', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = NotificationAckInput.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { ids, before } = parse.data
    const where: Prisma.NotificationWhereInput = { userId }
    if (ids?.length) {
      where.id = { in: ids }
    }
    if (before) {
      where.createdAt = { lte: before }
    }

    const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } })
    return reply.send({ updated: result.count })
  }),
)

// SSE notifications (skeleton)
app.get('/notifications/stream', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = await resolveStreamUserId(req)
  if (!userId) {
    req.log.warn('notifications_stream_unauthorized')
    return reply.code(401).send({ error: 'unauthorized' })
  }
  req.log.info({ userId }, 'notifications_stream_connected')
  const sub = new IORedis(REDIS_URL)
  const channel = `${NOTIFICATION_CHANNEL_PREFIX}${userId}`
  await sub.subscribe(channel)
  reply.sse({ data: JSON.stringify({ type: 'connected' }) })

  const heartbeat = setInterval(() => {
    reply.sse({ data: JSON.stringify({ type: 'ping' }) })
  }, 30000)

  sub.on('message', (_chan: string, message: string) => {
    req.log.debug({ userId, size: message.length }, 'notifications_stream_dispatch')
    reply.sse({ data: message })
  })
  req.raw.on('close', async () => {
    clearInterval(heartbeat)
    req.log.info({ userId }, 'notifications_stream_disconnected')
    await sub.unsubscribe(channel)
    sub.disconnect()
  })
})

app.get('/home/right-rail', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true, lastViewedFriendsAt: true, lastViewedHomeAt: true },
  })

  // 1. Friends
  const friendIds = await loadAcceptedFriendIds(userId)

  // Determine the threshold for "new" friend posts
  const friendsThreshold = [user?.lastViewedFriendsAt, user?.lastViewedHomeAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

  // Get new post counts
  const activeFriendCounts = friendIds.length
    ? await prisma.post.groupBy({
        by: ['authorId'],
        where: {
          authorId: { in: friendIds },
          createdAt: { gt: friendsThreshold },
        },
        _count: { id: true },
      })
    : []

  const friendCountMap = new Map<string, number>()
  activeFriendCounts.forEach((row: { authorId: string; _count: { id: number } }) => {
    friendCountMap.set(row.authorId, row._count.id)
  })

  // Prioritize friends with new posts, then fill with others
  // Sort active counts descending
  const sortedActive = [...activeFriendCounts].sort((a: any, b: any) => b._count.id - a._count.id)
  const activeIds = sortedActive.map((row: any) => row.authorId)
  const activeIdSet = new Set(activeIds)
  const otherIds = friendIds.filter((id) => !activeIdSet.has(id))

  // Combine and limit to 10
  // We want active ones first, then random others? Or just others.
  // Let's shuffle others to keep it fresh if they have many friends
  const shuffledOthers = otherIds.sort(() => 0.5 - Math.random())
  const selectedIds = [...activeIds, ...shuffledOthers].slice(0, 10)

  const friends = selectedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: selectedIds } },
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          bio: true,
          communityMeta: true, // To get home community
        },
      })
    : []

  const normalizedFriends = friends.map((friend: any) => normalizeUserMedia(friend))

  const friendsWithCounts = normalizedFriends.map((friend: any) => ({
    ...friend,
    newPosts: friendCountMap.get(friend.id) ?? 0,
  }))

  // Sort by new posts desc
  const finalFriends = friendsWithCounts.sort((a: any, b: any) => b.newPosts - a.newPosts)

  // 2. Communities
  const follows = await prisma.communityFollow.findMany({
    where: { userId },
    select: { provinceCode: true, communitySlug: true, lastViewedAt: true },
  })

  const followThresholds = follows.map((follow: any) => {
    const lastViewed = [
      follow.lastViewedAt,
      user?.lastViewedHomeAt,
      // user?.lastViewedCommunitiesAt
    ]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

    return {
      ...follow,
      lastViewed,
    }
  })

  const communityOr = followThresholds.map((follow: any) => ({
    provinceCode: follow.provinceCode,
    communitySlug: follow.communitySlug,
    createdAt: { gt: follow.lastViewed },
  }))

  const groupedCommunityCounts = communityOr.length
    ? await prisma.post.groupBy({
        by: ['provinceCode', 'communitySlug'],
        where: {
          OR: communityOr,
        },
        _count: { id: true },
      })
    : []

  const communityCountMap = new Map<string, number>()
  groupedCommunityCounts.forEach((row: any) => {
    const key = `${row.provinceCode}:${row.communitySlug}`
    communityCountMap.set(key, row._count?.id ?? 0)
  })

  const cityRows = follows.length
    ? await prisma.city.findMany({
        where: {
          OR: follows.map((follow: any) => ({
            provinceCode: follow.provinceCode,
            communitySlug: follow.communitySlug,
          })),
        },
        select: { provinceCode: true, communitySlug: true, name: true, communityName: true },
      })
    : []

  const cityNameMap = new Map<string, string>()
  cityRows.forEach((row: any) => {
    const key = `${row.provinceCode}:${row.communitySlug}`
    const name = row?.communityName ?? row?.name ?? null
    if (name) cityNameMap.set(key, name)
  })

  const communitiesWithCounts = followThresholds.map((follow: any) => {
    const key = `${follow.provinceCode}:${follow.communitySlug}`
    return {
      provinceCode: follow.provinceCode,
      communitySlug: follow.communitySlug,
      name: cityNameMap.get(key) ?? follow.communitySlug,
      newPosts: communityCountMap.get(key) ?? 0,
    }
  })

  // Limit 5, sort by new posts desc
  const topCommunities = communitiesWithCounts.sort((a: any, b: any) => b.newPosts - a.newPosts).slice(0, 5)

  return {
    userHandle: user?.handle,
    totalFriends: friendIds.length,
    friends: finalFriends,
    communities: topCommunities,
  }
})

app.get('/users/:handle/friends', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()
    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true },
    })

    if (!user) return reply.code(404).send({ error: 'not_found' })

    const friendIds = await loadAcceptedFriendIds(user.id)

    const friends = await prisma.user.findMany({
      where: { id: { in: friendIds } },
      select: {
        id: true,
        handle: true,
        name: true,
        avatarUrl: true,
        coverUrl: true,
        bio: true,
      },
      orderBy: [{ name: 'asc' }, { handle: 'asc' }],
    })

    const items = friends.map((friend: any) => ({
      id: friend.id,
      handle: friend.handle,
      name: friend.name,
      avatarUrl: normalizeMediaUrl(friend.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl(friend.coverUrl ?? null),
      bio: friend.bio,
    }))

    return { userHandle: user.handle, items }
  }),
)

app.get('/users/:handle/followers', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    return reply.code(410).send({ error: 'person_follow_disabled' })
  }),
)

app.get('/users/:handle/following', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    return reply.code(410).send({ error: 'person_follow_disabled' })
  }),
)

app.get('/users/:handle/connections', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()
    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true },
    })

    if (!user) return reply.code(404).send({ error: 'not_found' })

    const connections = await prisma.connection.findMany({
      where: {
        status: ConnectionStatus.ACCEPTED,
        OR: [{ requesterId: user.id }, { addresseeId: user.id }],
      },
      include: {
        requester: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            bio: true,
          },
        },
        addressee: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            bio: true,
          },
        },
      },
      orderBy: { respondedAt: 'desc' },
    })

    const items = connections
      .map((entry: any) => {
        const other = entry.requesterId === user.id ? entry.addressee : entry.requester
        if (!other) return null
        return {
          id: other.id,
          handle: other.handle,
          name: other.name,
          avatarUrl: normalizeMediaUrl(other.avatarUrl ?? null),
          coverUrl: normalizeMediaUrl(other.coverUrl ?? null),
          bio: other.bio,
          since: (entry.respondedAt ?? entry.requestedAt).toISOString(),
        }
      })
      .filter(Boolean)

    return { userHandle: user.handle, items }
  }),
)

app.get('/users/:handle/communities', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()
    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true },
    })

    if (!user) return reply.code(404).send({ error: 'not_found' })

    const follows = await prisma.communityFollow.findMany({
      where: { userId: user.id },
      orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        provinceCode: true,
        communitySlug: true,
        home: true,
        createdAt: true,
      },
    })

    const items = follows.map((entry: any) => {
      const city = findCommunity(entry.provinceCode, entry.communitySlug)
      return {
        id: entry.id,
        provinceCode: entry.provinceCode,
        communitySlug: entry.communitySlug,
        name: city?.name ?? entry.communitySlug,
        home: entry.home,
        since: entry.createdAt.toISOString(),
      }
    })

    return { userHandle: user.handle, items }
  }),
)

app.get('/users/:handle/organizations', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()
    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true },
    })

    if (!user) return reply.code(404).send({ error: 'not_found' })

    const organizations = await prisma.business.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { memberships: { some: { userId: user.id } } },
          { follows: { some: { userId: user.id } } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        logoUrl: true,
        coverUrl: true,
      },
      orderBy: [{ name: 'asc' }],
    })

    const items = organizations.map((org: any) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      provinceCode: org.provinceCode,
      communitySlug: org.communitySlug,
      logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
      coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
    }))

    return { userHandle: user.handle, items }
  }),
)

const JobListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  provinceCode: z.string().trim().min(2).max(2).optional(),
  communitySlug: z.string().trim().min(1).max(120).optional(),
  industrySlug: z.string().trim().min(1).max(120).optional(),
  subIndustrySlug: z.string().trim().min(1).max(120).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const WorkApplicationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  jobId: z.string().trim().uuid().optional(),
})

const OrgJobListQuery = z.object({
  includeDrafts: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const JobLocationInput = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (value === 'special:remote' || value === 'special:not_in_canada') return true
    if (!value.startsWith('community:')) return false
    const body = value.slice('community:'.length)
    const [head] = body.split('|')
    const [provinceCode, communitySlug] = (head ?? '').split(':')
    return Boolean(provinceCode?.trim()) && Boolean(communitySlug?.trim())
  }, 'invalid_location')

const CreateJobBody = z.object({
  title: z.string().trim().min(3).max(180),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer']),
  salaryMin: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryMax: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryCurrency: z.string().trim().length(3).default('CAD'),
  salaryPeriod: z.string().trim().max(40).optional().nullable(),
  duties: z.string().trim().min(20).max(20000),
  roleRequirements: z.string().trim().min(20).max(20000),
  description: z.string().trim().max(20000).optional().nullable(),
  photoUrl: z.string().trim().url().max(2000).optional().nullable(),
  location: JobLocationInput,
  industryId: z.string().trim().min(3),
  subIndustryId: z.string().trim().min(3).optional().nullable(),
  expiresAt: z.string().datetime(),
  publish: z.boolean().default(true),
})

const UpdateJobBody = z.object({
  title: z.string().trim().min(3).max(180),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer']),
  salaryMin: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryMax: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryCurrency: z.string().trim().length(3).default('CAD'),
  salaryPeriod: z.string().trim().max(40).optional().nullable(),
  duties: z.string().trim().min(20).max(20000),
  roleRequirements: z.string().trim().min(20).max(20000),
  description: z.string().trim().max(20000).optional().nullable(),
  photoUrl: z.string().trim().url().max(2000).optional().nullable(),
  location: JobLocationInput,
  industryId: z.string().trim().min(3),
  subIndustryId: z.string().trim().min(3).optional().nullable(),
  expiresAt: z.string().datetime(),
})

const ApplyJobBody = z.object({
  motivationHtml: z.string().trim().min(20).max(20000),
})

const JobEntityId = z.string().trim().refine(
  (value) => z.string().cuid().safeParse(value).success || z.string().uuid().safeParse(value).success,
  'invalid_id',
)

const JobIdParams = z.object({
  jobId: JobEntityId,
})

const CommunityOrgJobParams = CommunityOrgSlugParams.extend({
  jobId: JobEntityId,
})

const CommunityOrgJobApplicationParams = CommunityOrgJobParams.extend({
  applicationId: JobEntityId,
})

const UpdateJobApplicationStatusBody = z.object({
  status: z.enum(['submitted', 'reviewing', 'shortlisted', 'rejected', 'hired', 'withdrawn']),
})

function parseStructuredJobLocation(raw: string): {
  locationType: 'community' | 'remote' | 'not_in_canada'
  locationProvinceCode: string | null
  locationCommunitySlug: string | null
  locationLabel: string
} {
  if (raw === 'special:remote') {
    return {
      locationType: 'remote',
      locationProvinceCode: null,
      locationCommunitySlug: null,
      locationLabel: 'Remote',
    }
  }
  if (raw === 'special:not_in_canada') {
    return {
      locationType: 'not_in_canada',
      locationProvinceCode: null,
      locationCommunitySlug: null,
      locationLabel: 'Not in Canada',
    }
  }

  const body = raw.slice('community:'.length)
  const [head, labelPart] = body.split('|')
  const [provinceCodeRaw, communitySlugRaw] = (head ?? '').split(':')
  const locationProvinceCode = (provinceCodeRaw ?? '').trim().toUpperCase()
  const locationCommunitySlug = (communitySlugRaw ?? '').trim().toLowerCase()
  const locationLabel = (labelPart ?? '').trim() || locationCommunitySlug.replace(/-/g, ' ')

  return {
    locationType: 'community',
    locationProvinceCode,
    locationCommunitySlug,
    locationLabel,
  }
}

function buildJobLocationValue(row: {
  locationType: 'community' | 'remote' | 'not_in_canada'
  locationProvinceCode: string | null
  locationCommunitySlug: string | null
  locationLabel: string | null
}) {
  if (row.locationType === 'remote') return 'special:remote'
  if (row.locationType === 'not_in_canada') return 'special:not_in_canada'
  const provinceCode = (row.locationProvinceCode ?? '').toUpperCase()
  const communitySlug = (row.locationCommunitySlug ?? '').toLowerCase()
  const label = (row.locationLabel ?? communitySlug).trim()
  return `community:${provinceCode}:${communitySlug}|${label}`
}

async function resolveOrgManagerOrOwner(args: {
  province: string
  municipality: string
  slug: string
  userId: string
}) {
  const province = normalizeProvinceCode(args.province)
  if (!province) return { error: 'province_not_found' as const }
  const community = findCommunity(province, args.municipality.trim().toLowerCase())
  if (!community) return { error: 'community_not_found' as const }

  const org = await prisma.business.findFirst({
    where: {
      provinceCode: province,
      communitySlug: community.slug,
      slug: args.slug.trim().toLowerCase(),
    },
    select: { id: true, ownerId: true, name: true, slug: true, provinceCode: true, communitySlug: true },
  })
  if (!org) return { error: 'organization_not_found' as const }

  const membership = await prisma.businessMembership.findUnique({
    where: { businessId_userId: { businessId: org.id, userId: args.userId } },
    select: { role: true },
  })
  const isOwner = org.ownerId === args.userId
  const isManager = membership?.role === 'MANAGER'
  if (!isOwner && !isManager) return { error: 'forbidden' as const }

  return {
    org,
    role: isOwner ? ('OWNER' as const) : ('MANAGER' as const),
  }
}

type JobListRow = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'active' | 'closed' | 'expired'
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  description: string | null
  duties: string
  roleRequirements: string
  locationType: 'community' | 'remote' | 'not_in_canada'
  photoUrl: string | null
  locationProvinceCode: string | null
  locationCommunitySlug: string | null
  locationLabel: string | null
  industryId: string
  industryName: string
  industrySlug: string
  subIndustryId: string | null
  subIndustryName: string | null
  subIndustrySlug: string | null
  applicantCount: number
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
  expiresAt: Date
  businessId: string
  businessName: string
  businessSlug: string
  businessProvinceCode: string | null
  businessCommunitySlug: string | null
  businessLogoUrl: string | null
  businessCoverUrl: string | null
  activePromotionId: string | null
  totalImpressionsServed?: number | null
  totalViews?: number | null
  activeImpressionCap?: number | null
}

function mapJobListRow(row: JobListRow) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    employmentType: row.employmentType,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
    description: row.description,
    photoUrl: normalizeMediaUrl(row.photoUrl),
    duties: row.duties,
    roleRequirements: row.roleRequirements,
    location: buildJobLocationValue({
      locationType: row.locationType,
      locationProvinceCode: row.locationProvinceCode,
      locationCommunitySlug: row.locationCommunitySlug,
      locationLabel: row.locationLabel,
    }),
    industry: {
      id: row.industryId,
      name: row.industryName,
      slug: row.industrySlug,
      subIndustry: row.subIndustryName
        ? {
            id: row.subIndustryId,
            name: row.subIndustryName,
            slug: row.subIndustrySlug,
          }
        : null,
    },
    applicantCount: Number(row.applicantCount) || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    sponsored: Boolean(row.activePromotionId),
    marketing: {
      impressions: Number(row.totalImpressionsServed ?? 0) || 0,
      views: Number(row.totalViews ?? row.totalImpressionsServed ?? 0) || 0,
      applications: Number(row.applicantCount) || 0,
      activePromotion: Boolean(row.activePromotionId),
      impressionCap: Number(row.activeImpressionCap ?? 1000) || 1000,
    },
    organization: {
      id: row.businessId,
      name: row.businessName,
      slug: row.businessSlug,
      provinceCode: row.businessProvinceCode,
      communitySlug: row.businessCommunitySlug,
      logoUrl: normalizeMediaUrl(row.businessLogoUrl),
      coverUrl: normalizeMediaUrl(row.businessCoverUrl),
    },
  }
}

app.get('/work/jobs', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const query = JobListQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const now = new Date()
    await prisma.$executeRaw`
      UPDATE "JobPosting"
      SET "status" = 'expired'::"JobStatus", "updatedAt" = NOW()
      WHERE "status" = 'active'::"JobStatus" AND "expiresAt" <= ${now}
    `

    await prisma.$executeRaw`
      UPDATE "JobPromotion"
      SET "status" = 'ended'::"JobPromotionStatus", "updatedAt" = NOW()
      WHERE "status" = 'active'::"JobPromotionStatus"
        AND ("endsAt" <= ${now} OR "impressionsServed" >= "impressionCap")
    `

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        jp."id",
        jp."title",
        jp."slug",
        jp."status",
        jp."employmentType",
        jp."salaryMin",
        jp."salaryMax",
        jp."salaryCurrency",
        jp."salaryPeriod",
        jp."description",
        jp."photoUrl",
        jp."duties",
        jp."roleRequirements",
        jp."locationType",
        jp."locationProvinceCode",
        jp."locationCommunitySlug",
        jp."locationLabel",
        jp."industryId",
        ji."name" as "industryName",
        ji."slug" as "industrySlug",
        jp."subIndustryId",
        jsi."name" as "subIndustryName",
        jsi."slug" as "subIndustrySlug",
        jp."applicantCount",
        jp."createdAt",
        jp."updatedAt",
        jp."publishedAt",
        jp."expiresAt",
        b."id" as "businessId",
        b."name" as "businessName",
        b."slug" as "businessSlug",
        b."provinceCode" as "businessProvinceCode",
        b."communitySlug" as "businessCommunitySlug",
        b."logoUrl" as "businessLogoUrl",
        b."coverUrl" as "businessCoverUrl",
        (
          SELECT prm."id"
          FROM "JobPromotion" prm
          WHERE prm."jobPostingId" = jp."id"
            AND prm."status" = 'active'::"JobPromotionStatus"
            AND prm."startsAt" <= ${now}
            AND prm."endsAt" > ${now}
            AND prm."impressionsServed" < prm."impressionCap"
          ORDER BY prm."createdAt" DESC
          LIMIT 1
        ) as "activePromotionId"
      FROM "JobPosting" jp
      JOIN "Business" b ON b."id" = jp."businessId"
      JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
      LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
      WHERE jp."status" = 'active'::"JobStatus"
        AND jp."publishedAt" IS NOT NULL
        AND jp."expiresAt" > ${now}
        ${query.data.q ? Prisma.sql`AND (jp."title" ILIKE ${`%${query.data.q}%`} OR jp."description" ILIKE ${`%${query.data.q}%`})` : Prisma.empty}
        ${query.data.provinceCode ? Prisma.sql`AND jp."locationProvinceCode" = ${query.data.provinceCode.toUpperCase()}` : Prisma.empty}
        ${query.data.communitySlug ? Prisma.sql`AND jp."locationCommunitySlug" = ${query.data.communitySlug.toLowerCase()}` : Prisma.empty}
        ${query.data.industrySlug ? Prisma.sql`AND ji."slug" = ${query.data.industrySlug.toLowerCase()}` : Prisma.empty}
        ${query.data.subIndustrySlug ? Prisma.sql`AND jsi."slug" = ${query.data.subIndustrySlug.toLowerCase()}` : Prisma.empty}
        ${query.data.employmentType ? Prisma.sql`AND jp."employmentType" = ${query.data.employmentType}::"JobEmploymentType"` : Prisma.empty}
      ORDER BY
        CASE WHEN (
          SELECT COUNT(*)
          FROM "JobPromotion" prm2
          WHERE prm2."jobPostingId" = jp."id"
            AND prm2."status" = 'active'::"JobPromotionStatus"
            AND prm2."startsAt" <= ${now}
            AND prm2."endsAt" > ${now}
            AND prm2."impressionsServed" < prm2."impressionCap"
        ) > 0 THEN 0 ELSE 1 END,
        jp."publishedAt" DESC NULLS LAST,
        jp."createdAt" DESC
      LIMIT ${query.data.limit}
    `)) as JobListRow[]

    const sponsored: ReturnType<typeof mapJobListRow>[] = []
    const items: ReturnType<typeof mapJobListRow>[] = []
    const rowJobIds = rows.map((row: JobListRow) => row.id)
    const userId = (req as any).user?.id as string | undefined
    let appliedJobIds: string[] = []

    if (userId && rowJobIds.length > 0) {
      const appliedRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT DISTINCT ja."jobPostingId"
        FROM "JobApplication" ja
        WHERE ja."applicantUserId" = ${userId}
          AND ja."jobPostingId" IN (${Prisma.join(rowJobIds)})
      `)) as Array<{ jobPostingId: string }>
      appliedJobIds = appliedRows.map((row: { jobPostingId: string }) => row.jobPostingId)
    }

    rows.forEach((row: JobListRow) => {
      const mapped = mapJobListRow(row)
      if (mapped.sponsored) sponsored.push(mapped)
      else items.push(mapped)
    })

    return reply.send({ sponsored, items, appliedJobIds })
  }),
)

app.get('/work/applications', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const query = WorkApplicationsQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        ja."id",
        ja."status",
        ja."createdAt",
        ja."jobPostingId",
        jp."title" as "jobTitle",
        jp."photoUrl" as "jobPhotoUrl",
        jp."status" as "jobStatus",
        jp."expiresAt" as "jobExpiresAt",
        b."name" as "businessName",
        b."slug" as "businessSlug",
        b."provinceCode" as "businessProvinceCode",
        b."communitySlug" as "businessCommunitySlug",
        b."logoUrl" as "businessLogoUrl",
        b."coverUrl" as "businessCoverUrl"
      FROM "JobApplication" ja
      JOIN "JobPosting" jp ON jp."id" = ja."jobPostingId"
      JOIN "Business" b ON b."id" = jp."businessId"
      WHERE ja."applicantUserId" = ${userId}
      ${query.data.jobId ? Prisma.sql`AND ja."jobPostingId" = ${query.data.jobId}` : Prisma.empty}
      ORDER BY ja."createdAt" DESC
      LIMIT ${query.data.limit}
    `)) as Array<{
      id: string
      status: string
      createdAt: Date
      jobPostingId: string
      jobTitle: string
      jobPhotoUrl: string | null
      jobStatus: string
      jobExpiresAt: Date
      businessName: string
      businessSlug: string
      businessProvinceCode: string | null
      businessCommunitySlug: string | null
      businessLogoUrl: string | null
      businessCoverUrl: string | null
    }>

    return reply.send({
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        job: {
          id: row.jobPostingId,
          title: row.jobTitle,
          photoUrl: normalizeMediaUrl(row.jobPhotoUrl),
          status: row.jobStatus,
          expiresAt: row.jobExpiresAt.toISOString(),
          organization: {
            name: row.businessName,
            slug: row.businessSlug,
            provinceCode: row.businessProvinceCode,
            communitySlug: row.businessCommunitySlug,
            logoUrl: normalizeMediaUrl(row.businessLogoUrl),
            coverUrl: normalizeMediaUrl(row.businessCoverUrl),
          },
        },
      })),
    })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/jobs', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const query = OrgJobListQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: {
        provinceCode: province,
        communitySlug: community.slug,
        slug: params.data.slug.trim().toLowerCase(),
      },
      select: { id: true, ownerId: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const includeDraftsRequested = query.data.includeDrafts
    let canManage = false
    if (includeDraftsRequested) {
      const userId = (req as any).user?.id as string | undefined
      if (userId) {
        const membership = await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId } },
          select: { role: true },
        })
        canManage = org.ownerId === userId || membership?.role === 'MANAGER'
      }
    }

    const now = new Date()
    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        jp."id",
        jp."title",
        jp."slug",
        jp."status",
        jp."employmentType",
        jp."salaryMin",
        jp."salaryMax",
        jp."salaryCurrency",
        jp."salaryPeriod",
        jp."description",
        jp."photoUrl",
        jp."duties",
        jp."roleRequirements",
        jp."locationType",
        jp."locationProvinceCode",
        jp."locationCommunitySlug",
        jp."locationLabel",
        jp."industryId",
        ji."name" as "industryName",
        ji."slug" as "industrySlug",
        jp."subIndustryId",
        jsi."name" as "subIndustryName",
        jsi."slug" as "subIndustrySlug",
        jp."applicantCount",
        jp."createdAt",
        jp."updatedAt",
        jp."publishedAt",
        jp."expiresAt",
        b."id" as "businessId",
        b."name" as "businessName",
        b."slug" as "businessSlug",
        b."provinceCode" as "businessProvinceCode",
        b."communitySlug" as "businessCommunitySlug",
        b."logoUrl" as "businessLogoUrl",
        b."coverUrl" as "businessCoverUrl",
        (
          SELECT prm."id"
          FROM "JobPromotion" prm
          WHERE prm."jobPostingId" = jp."id"
            AND prm."status" = 'active'::"JobPromotionStatus"
            AND prm."startsAt" <= ${now}
            AND prm."endsAt" > ${now}
            AND prm."impressionsServed" < prm."impressionCap"
          ORDER BY prm."createdAt" DESC
          LIMIT 1
        ) as "activePromotionId"
      FROM "JobPosting" jp
      JOIN "Business" b ON b."id" = jp."businessId"
      JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
      LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
      WHERE jp."businessId" = ${org.id}
      ${includeDraftsRequested && canManage ? Prisma.empty : Prisma.sql`AND jp."status" = 'active'::"JobStatus" AND jp."publishedAt" IS NOT NULL AND jp."expiresAt" > ${now}`}
      ORDER BY jp."createdAt" DESC
      LIMIT ${query.data.limit}
    `)) as JobListRow[]

    return reply.send({ items: rows.map((row: JobListRow) => mapJobListRow(row)), canManage: includeDraftsRequested ? canManage : undefined })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/jobs/draft', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const industryRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "JobIndustry"
      WHERE "active" = true
      ORDER BY "sortOrder" ASC, "name" ASC
      LIMIT 1
    `
    const industryId = industryRows[0]?.id
    if (!industryId) return reply.code(400).send({ error: 'industry_required' })

    const defaultProvinceCode = normalizeProvinceCode(params.data.province)
    const defaultCommunity = defaultProvinceCode ? findCommunity(defaultProvinceCode, params.data.municipality.trim().toLowerCase()) : null
    const defaultLocationProvinceCode = defaultProvinceCode ?? null
    const defaultLocationCommunitySlug = defaultCommunity?.slug ?? null
    const defaultLocationLabel = defaultCommunity?.name ?? params.data.municipality.replace(/-/g, ' ')

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const inserted = (await prisma.$queryRaw(Prisma.sql`
      INSERT INTO "JobPosting" (
        "id", "businessId", "createdByUserId", "title", "slug", "employmentType",
        "salaryCurrency", "duties", "roleRequirements", "description",
        "locationType", "locationProvinceCode", "locationCommunitySlug", "locationLabel", "industryId", "status", "publishedAt", "expiresAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()}, ${orgResult.org.id}, ${userId}, 'Untitled job', ${`draft-${randomSlugSuffix()}`}, 'full_time'::"JobEmploymentType",
        'CAD', '<p>Describe responsibilities.</p>', '<p>Describe requirements.</p>', null,
        'community'::"JobWorkplaceType", ${defaultLocationProvinceCode}, ${defaultLocationCommunitySlug}, ${defaultLocationLabel}, ${industryId}, 'draft'::"JobStatus", null, ${expiresAt}, ${now}, ${now}
      )
      RETURNING "id"
    `)) as Array<{ id: string }>

    const jobId = inserted[0]?.id
    if (!jobId) return reply.code(500).send({ error: 'draft_create_failed' })

    try {
      await trackJobAnalyticsEvent({
        kind: 'job_added',
        businessId: orgResult.org.id,
        jobPostingId: jobId,
        actorUserId: userId,
        createdAt: now,
      })
    } catch (err) {
      req.log.warn({ err, jobId }, 'job_analytics_track_failed')
    }

    return reply.code(201).send({ id: jobId })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        jp."id",
        jp."title",
        jp."slug",
        jp."status",
        jp."employmentType",
        jp."salaryMin",
        jp."salaryMax",
        jp."salaryCurrency",
        jp."salaryPeriod",
        jp."description",
        jp."photoUrl",
        jp."duties",
        jp."roleRequirements",
        jp."locationType",
        jp."locationProvinceCode",
        jp."locationCommunitySlug",
        jp."locationLabel",
        jp."industryId",
        ji."name" as "industryName",
        ji."slug" as "industrySlug",
        jp."subIndustryId",
        jsi."name" as "subIndustryName",
        jsi."slug" as "subIndustrySlug",
        jp."applicantCount",
        jp."createdAt",
        jp."updatedAt",
        jp."publishedAt",
        jp."expiresAt",
        b."id" as "businessId",
        b."name" as "businessName",
        b."slug" as "businessSlug",
        b."provinceCode" as "businessProvinceCode",
        b."communitySlug" as "businessCommunitySlug",
        b."logoUrl" as "businessLogoUrl",
        b."coverUrl" as "businessCoverUrl",
        (
          SELECT prm."id"
          FROM "JobPromotion" prm
          WHERE prm."jobPostingId" = jp."id"
            AND prm."status" = 'active'::"JobPromotionStatus"
            AND prm."startsAt" <= ${new Date()}
            AND prm."endsAt" > ${new Date()}
            AND prm."impressionsServed" < prm."impressionCap"
          ORDER BY prm."createdAt" DESC
          LIMIT 1
        ) as "activePromotionId",
        (
          SELECT COALESCE(SUM(prm."impressionsServed"), 0)::int
          FROM "JobPromotion" prm
          WHERE prm."jobPostingId" = jp."id"
        ) as "totalImpressionsServed",
        (
          SELECT COALESCE(SUM(prm."impressionsServed"), 0)::int
          FROM "JobPromotion" prm
          WHERE prm."jobPostingId" = jp."id"
        ) as "totalViews",
        (
          SELECT prm."impressionCap"::int
          FROM "JobPromotion" prm
          WHERE prm."jobPostingId" = jp."id"
            AND prm."status" = 'active'::"JobPromotionStatus"
            AND prm."startsAt" <= ${new Date()}
            AND prm."endsAt" > ${new Date()}
            AND prm."impressionsServed" < prm."impressionCap"
          ORDER BY prm."createdAt" DESC
          LIMIT 1
        ) as "activeImpressionCap"
      FROM "JobPosting" jp
      JOIN "Business" b ON b."id" = jp."businessId"
      JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
      LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
      WHERE jp."id" = ${params.data.jobId}
        AND jp."businessId" = ${orgResult.org.id}
      LIMIT 1
    `)) as JobListRow[]

    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'job_not_found' })
    return reply.send({ job: mapJobListRow(row) })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = UpdateJobBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const now = new Date()
    const expiresAt = new Date(body.data.expiresAt)
    const maxExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return reply.code(400).send({ error: 'invalid_expiry' })
    }
    if (expiresAt > maxExpiresAt) {
      return reply.code(400).send({ error: 'expiry_exceeds_30_days' })
    }

    const industry = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "JobIndustry" WHERE "id" = ${body.data.industryId} AND "active" = true LIMIT 1
    `
    if (!industry.length) return reply.code(400).send({ error: 'invalid_industry' })

    if (body.data.subIndustryId) {
      const sub = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "JobSubIndustry"
        WHERE "id" = ${body.data.subIndustryId} AND "industryId" = ${body.data.industryId} AND "active" = true
        LIMIT 1
      `
      if (!sub.length) return reply.code(400).send({ error: 'invalid_sub_industry' })
    }

    const location = parseStructuredJobLocation(body.data.location)
    const updated = await prisma.$executeRaw`
      UPDATE "JobPosting"
      SET
        "title" = ${body.data.title.trim()},
        "employmentType" = ${body.data.employmentType}::"JobEmploymentType",
        "salaryMin" = ${body.data.salaryMin ?? null},
        "salaryMax" = ${body.data.salaryMax ?? null},
        "salaryCurrency" = ${body.data.salaryCurrency.toUpperCase()},
        "salaryPeriod" = ${body.data.salaryPeriod ?? null},
        "duties" = ${body.data.duties.trim()},
        "roleRequirements" = ${body.data.roleRequirements.trim()},
        "description" = ${body.data.description?.trim() ?? null},
        "photoUrl" = ${body.data.photoUrl?.trim() ?? null},
        "locationType" = ${location.locationType}::"JobWorkplaceType",
        "locationProvinceCode" = ${location.locationProvinceCode},
        "locationCommunitySlug" = ${location.locationCommunitySlug},
        "locationLabel" = ${location.locationLabel},
        "industryId" = ${body.data.industryId},
        "subIndustryId" = ${body.data.subIndustryId ?? null},
        "expiresAt" = ${expiresAt},
        "updatedAt" = ${now}
      WHERE "id" = ${params.data.jobId}
        AND "businessId" = ${orgResult.org.id}
    `

    if (!updated) return reply.code(404).send({ error: 'job_not_found' })
    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/publish', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const now = new Date()
    const updated = await prisma.$executeRaw`
      UPDATE "JobPosting"
      SET "status" = 'active'::"JobStatus", "publishedAt" = COALESCE("publishedAt", ${now}), "updatedAt" = ${now}
      WHERE "id" = ${params.data.jobId}
        AND "businessId" = ${orgResult.org.id}
    `
    if (!updated) return reply.code(404).send({ error: 'job_not_found' })
    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/unpublish', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const now = new Date()
    const updated = await prisma.$executeRaw`
      UPDATE "JobPosting"
      SET "status" = 'draft'::"JobStatus", "publishedAt" = null, "updatedAt" = ${now}
      WHERE "id" = ${params.data.jobId}
        AND "businessId" = ${orgResult.org.id}
    `
    if (!updated) return reply.code(404).send({ error: 'job_not_found' })
    return reply.send({ ok: true })
  }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const deleted = await prisma.$executeRaw`
      DELETE FROM "JobPosting"
      WHERE "id" = ${params.data.jobId}
        AND "businessId" = ${orgResult.org.id}
    `
    if (!deleted) return reply.code(404).send({ error: 'job_not_found' })
    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/jobs', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CreateJobBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      if (orgResult.error === 'province_not_found' || orgResult.error === 'community_not_found' || orgResult.error === 'organization_not_found') {
        return reply.code(404).send({ error: orgResult.error })
      }
      return reply.code(400).send({ error: orgResult.error })
    }

    const now = new Date()
    const expiresAt = new Date(body.data.expiresAt)
    const maxExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return reply.code(400).send({ error: 'invalid_expiry' })
    }
    if (expiresAt > maxExpiresAt) {
      return reply.code(400).send({ error: 'expiry_exceeds_30_days' })
    }

    const industry = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "JobIndustry" WHERE "id" = ${body.data.industryId} AND "active" = true LIMIT 1
    `
    if (!industry.length) return reply.code(400).send({ error: 'invalid_industry' })

    if (body.data.subIndustryId) {
      const sub = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "JobSubIndustry"
        WHERE "id" = ${body.data.subIndustryId} AND "industryId" = ${body.data.industryId} AND "active" = true
        LIMIT 1
      `
      if (!sub.length) return reply.code(400).send({ error: 'invalid_sub_industry' })
    }

    const location = parseStructuredJobLocation(body.data.location)
    const baseSlug = trimSlugLength(slugifyText(body.data.title), 80) || 'job'

    const existingSlugRows = await prisma.$queryRaw<Array<{ slug: string }>>`
      SELECT "slug" FROM "JobPosting"
      WHERE "businessId" = ${orgResult.org.id} AND "slug" ILIKE ${`${baseSlug}%`}
      LIMIT 100
    `
    const existing = new Set(existingSlugRows.map((row: { slug: string }) => row.slug))
    let slug = baseSlug
    let suffix = 2
    while (existing.has(slug)) {
      slug = trimSlugLength(`${baseSlug}-${suffix}`, 80)
      suffix += 1
    }

    const inserted = (await prisma.$queryRaw(Prisma.sql`
      INSERT INTO "JobPosting" (
        "id", "businessId", "createdByUserId", "title", "slug", "employmentType",
        "salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod", "duties", "roleRequirements", "description",
        "locationType", "locationProvinceCode", "locationCommunitySlug", "locationLabel",
        "industryId", "subIndustryId", "status", "publishedAt", "expiresAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()}, ${orgResult.org.id}, ${userId}, ${body.data.title.trim()}, ${slug}, ${body.data.employmentType}::"JobEmploymentType",
        ${body.data.salaryMin ?? null}, ${body.data.salaryMax ?? null}, ${body.data.salaryCurrency.toUpperCase()}, ${body.data.salaryPeriod ?? null},
        ${body.data.duties.trim()}, ${body.data.roleRequirements.trim()}, ${body.data.description?.trim() ?? null},
        ${location.locationType}::"JobWorkplaceType", ${location.locationProvinceCode}, ${location.locationCommunitySlug}, ${location.locationLabel},
        ${body.data.industryId}, ${body.data.subIndustryId ?? null},
        ${body.data.publish ? Prisma.sql`'active'::"JobStatus"` : Prisma.sql`'draft'::"JobStatus"`},
        ${body.data.publish ? now : null}, ${expiresAt}, ${now}, ${now}
      )
      RETURNING "id"
    `)) as Array<{ id: string }>

    const createdJobId = inserted[0]?.id
    if (createdJobId) {
      try {
        await trackJobAnalyticsEvent({
          kind: 'job_added',
          businessId: orgResult.org.id,
          jobPostingId: createdJobId,
          actorUserId: userId,
          createdAt: now,
        })
      } catch (err) {
        req.log.warn({ err, jobId: createdJobId }, 'job_analytics_track_failed')
      }
    }

    return reply.code(201).send({ id: inserted[0]?.id, slug })
  }),
)

app.post('/work/jobs/:jobId/apply', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = JobIdParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = ApplyJobBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const now = new Date()
    const motivationHtml = sanitizeHtml(body.data.motivationHtml, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'img']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'alt'],
      },
    }).trim()

    if (!motivationHtml) return reply.code(400).send({ error: 'motivation_required' })

    const jobRows = await prisma.$queryRaw<Array<{ id: string; businessId: string; title: string; status: string; expiresAt: Date }>>`
      SELECT "id", "businessId", "title", "status", "expiresAt"
      FROM "JobPosting"
      WHERE "id" = ${params.data.jobId}
        AND "status" = 'active'::"JobStatus"
      LIMIT 1
    `
    const job = jobRows[0]
    if (!job) return reply.code(404).send({ error: 'job_not_found' })
    if (job.status !== 'active' || new Date(job.expiresAt).getTime() <= now.getTime()) {
      return reply.code(400).send({ error: 'job_not_open' })
    }

    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "JobApplication"
      WHERE "jobPostingId" = ${job.id} AND "applicantUserId" = ${userId}
      LIMIT 1
    `
    if (existing.length) return reply.code(409).send({ error: 'already_applied' })

    const thread = await prisma.messageThread.create({
      data: {
        type: MessageThreadType.job,
        uniqueKey: `job:${job.id}:applicant:${userId}`,
        contextType: 'job_application',
        contextId: job.id,
        lastMessageAt: now,
        participants: {
          create: [
            {
              userId,
              role: MessageParticipantRole.member,
              lastReadAt: now,
              lastActivityAt: now,
            },
          ],
        },
      },
      select: { id: true },
    })

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const insertedApplication = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "JobApplication" (
          "id", "jobPostingId", "applicantUserId", "motivationHtml", "status", "threadId", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${job.id}, ${userId}, ${motivationHtml}, 'submitted'::"JobApplicationStatus", ${thread.id}, ${now}, ${now}
        )
        RETURNING "id"
      `
      const applicationId = insertedApplication[0]?.id

      await tx.$executeRaw`
        UPDATE "JobPosting"
        SET "applicantCount" = "applicantCount" + 1, "updatedAt" = ${now}
        WHERE "id" = ${job.id}
      `

      if (applicationId) {
        await tx.$executeRaw`
          INSERT INTO "JobAnalyticsEvent" (
            "id", "kind", "businessId", "jobPostingId", "jobApplicationId", "actorUserId", "createdAt"
          )
          VALUES (
            ${randomUUID()},
            'applicant_submitted'::"JobAnalyticsEventKind",
            ${job.businessId},
            ${job.id},
            ${applicationId},
            ${userId},
            ${now}
          )
        `
      }

      const managerRows = await tx.businessMembership.findMany({
        where: { businessId: job.businessId, role: { in: [BusinessRole.OWNER, BusinessRole.MANAGER] } },
        select: { userId: true },
      })
      const managerIds = Array.from(new Set(managerRows.map((row) => row.userId).filter((id) => id && id !== userId)))

      if (managerIds.length > 0) {
        await tx.messageParticipant.createMany({
          data: managerIds.map((managerId) => ({
            threadId: thread.id,
            userId: managerId,
            role: MessageParticipantRole.admin,
            lastReadAt: null,
            lastActivityAt: now,
          })),
          skipDuplicates: true,
        })

        await tx.notification.createMany({
          data: managerIds.map((managerId) => ({
            userId: managerId,
            type: 'job_application_created',
            actorId: userId,
            payload: {
              jobId: job.id,
              jobTitle: job.title,
              threadId: thread.id,
            },
          })),
        })
      }
    })

    return reply.code(201).send({ ok: true, threadId: thread.id })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/applications', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        ja."id",
        ja."motivationHtml",
        ja."status",
        ja."threadId",
        ja."createdAt",
        u."id" as "applicantId",
        u."handle" as "applicantHandle",
        u."name" as "applicantName",
        u."avatarUrl" as "applicantAvatarUrl"
      FROM "JobApplication" ja
      JOIN "JobPosting" jp ON jp."id" = ja."jobPostingId"
      JOIN "User" u ON u."id" = ja."applicantUserId"
      WHERE jp."id" = ${params.data.jobId}
        AND jp."businessId" = ${orgResult.org.id}
      ORDER BY ja."createdAt" DESC
    `)) as Array<{
      id: string
      motivationHtml: string
      status: string
      threadId: string | null
      createdAt: Date
      applicantId: string
      applicantHandle: string
      applicantName: string | null
      applicantAvatarUrl: string | null
    }>

    try {
      await trackJobAnalyticsEvent({
        kind: 'applications_viewed',
        businessId: orgResult.org.id,
        jobPostingId: params.data.jobId,
        actorUserId: userId,
      })
    } catch (err) {
      req.log.warn({ err, jobId: params.data.jobId }, 'job_analytics_track_failed')
    }

    return reply.send({
      items: rows.map((row: {
        id: string
        motivationHtml: string
        status: string
        threadId: string | null
        createdAt: Date
        applicantId: string
        applicantHandle: string
        applicantName: string | null
        applicantAvatarUrl: string | null
      }) => ({
        id: row.id,
        motivationHtml: row.motivationHtml,
        status: row.status,
        threadId: row.threadId,
        createdAt: row.createdAt.toISOString(),
        applicant: {
          id: row.applicantId,
          handle: row.applicantHandle,
          name: row.applicantName,
          avatarUrl: normalizeMediaUrl(row.applicantAvatarUrl),
        },
      })),
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/applications/:applicationId/status', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobApplicationParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = UpdateJobApplicationStatusBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const applicationRows = await prisma.$queryRaw<Array<{ id: string; currentStatus: string; jobPostingId: string }>>`
      SELECT ja."id", ja."status"::text as "currentStatus", ja."jobPostingId"
      FROM "JobApplication" ja
      JOIN "JobPosting" jp ON jp."id" = ja."jobPostingId"
      WHERE ja."id" = ${params.data.applicationId}
        AND ja."jobPostingId" = ${params.data.jobId}
        AND jp."businessId" = ${orgResult.org.id}
      LIMIT 1
    `
    const application = applicationRows[0]
    if (!application) return reply.code(404).send({ error: 'application_not_found' })

    const now = new Date()
    await prisma.$executeRaw`
      UPDATE "JobApplication"
      SET "status" = ${body.data.status}::"JobApplicationStatus", "updatedAt" = ${now}
      WHERE "id" = ${application.id}
    `

    if (body.data.status === 'hired' && application.currentStatus !== 'hired') {
      try {
        await trackJobAnalyticsEvent({
          kind: 'applicant_hired',
          businessId: orgResult.org.id,
          jobPostingId: application.jobPostingId,
          jobApplicationId: application.id,
          actorUserId: userId,
          createdAt: now,
        })
      } catch (err) {
        req.log.warn({ err, applicationId: application.id }, 'job_analytics_track_failed')
      }
    }

    return reply.send({ ok: true, status: body.data.status })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/promote', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgJobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const orgResult = await resolveOrgManagerOrOwner({
      province: params.data.province,
      municipality: params.data.municipality,
      slug: params.data.slug,
      userId,
    })
    if ('error' in orgResult) {
      if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
      return reply.code(404).send({ error: orgResult.error })
    }

    const now = new Date()
    const active = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT prm."id"
      FROM "JobPromotion" prm
      JOIN "JobPosting" jp ON jp."id" = prm."jobPostingId"
      WHERE prm."status" = 'active'::"JobPromotionStatus"
        AND prm."jobPostingId" = ${params.data.jobId}
        AND jp."businessId" = ${orgResult.org.id}
        AND prm."startsAt" <= ${now}
        AND prm."endsAt" > ${now}
        AND prm."impressionsServed" < prm."impressionCap"
      LIMIT 1
    `
    if (active.length) return reply.send({ ok: true, promotionId: active[0].id, alreadyActive: true })

    const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const inserted = (await prisma.$queryRaw(Prisma.sql`
      INSERT INTO "JobPromotion" (
        "id", "jobPostingId", "createdByUserId", "status", "label", "startsAt", "endsAt", "impressionCap", "impressionsServed", "createdAt", "updatedAt"
      )
      SELECT ${randomUUID()}, jp."id", ${userId}, 'active'::"JobPromotionStatus", '$0 Limited time bonus', ${now}, ${endsAt}, 1000, 0, ${now}, ${now}
      FROM "JobPosting" jp
      WHERE jp."id" = ${params.data.jobId}
        AND jp."businessId" = ${orgResult.org.id}
        AND jp."status" = 'active'::"JobStatus"
        AND jp."expiresAt" > ${now}
      RETURNING "id"
    `)) as Array<{ id: string }>

    const promotionId = inserted[0]?.id
    if (!promotionId) return reply.code(400).send({ error: 'job_not_promotable' })
    return reply.code(201).send({ ok: true, promotionId, endsAt: endsAt.toISOString(), impressionCap: 1000 })
  }),
)

app.post('/work/jobs/:jobId/impression', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = JobIdParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const now = new Date()
    const updated = await prisma.$executeRaw`
      UPDATE "JobPromotion"
      SET "impressionsServed" = "impressionsServed" + 1,
          "status" = CASE
            WHEN ("impressionsServed" + 1) >= "impressionCap" OR "endsAt" <= ${now}
              THEN 'ended'::"JobPromotionStatus"
            ELSE "status"
          END,
          "updatedAt" = ${now}
      WHERE "jobPostingId" = ${params.data.jobId}
        AND "status" = 'active'::"JobPromotionStatus"
        AND "startsAt" <= ${now}
        AND "endsAt" > ${now}
        AND "impressionsServed" < "impressionCap"
    `

    return reply.send({ tracked: updated > 0 })
  }),
)

app.get('/work/industries', async (_req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(_req, reply, async () => {
    const rows = await prisma.$queryRaw<
      Array<{
        industryId: string
        industryName: string
        industrySlug: string
        industrySortOrder: number
        subIndustryId: string | null
        subIndustryName: string | null
        subIndustrySlug: string | null
        subIndustrySortOrder: number | null
      }>
    >`
      SELECT
        ji."id" as "industryId",
        ji."name" as "industryName",
        ji."slug" as "industrySlug",
        ji."sortOrder" as "industrySortOrder",
        jsi."id" as "subIndustryId",
        jsi."name" as "subIndustryName",
        jsi."slug" as "subIndustrySlug",
        jsi."sortOrder" as "subIndustrySortOrder"
      FROM "JobIndustry" ji
      LEFT JOIN "JobSubIndustry" jsi ON jsi."industryId" = ji."id" AND jsi."active" = true
      WHERE ji."active" = true
      ORDER BY ji."sortOrder" ASC, ji."name" ASC, jsi."sortOrder" ASC NULLS LAST, jsi."name" ASC NULLS LAST
    `

    const byIndustry = new Map<string, { id: string; name: string; slug: string; subIndustries: Array<{ id: string; name: string; slug: string }> }>()
    for (const row of rows) {
      if (!byIndustry.has(row.industryId)) {
        byIndustry.set(row.industryId, {
          id: row.industryId,
          name: row.industryName,
          slug: row.industrySlug,
          subIndustries: [],
        })
      }
      if (row.subIndustryId && row.subIndustryName && row.subIndustrySlug) {
        byIndustry.get(row.industryId)!.subIndustries.push({
          id: row.subIndustryId,
          name: row.subIndustryName,
          slug: row.subIndustrySlug,
        })
      }
    }

    return reply.send({ items: Array.from(byIndustry.values()) })
  }),
)

// Server startup code
const start = async () => {
  try {
    validatePushEnvironment(app.log)
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Server listening on port ${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
start()
