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
import { prisma } from '@civil/db'
import {
  Prisma,
  MediaCategory,
  PremiumStatus,
  BusinessStatus,
  BusinessType,
  StripeWebhookStatus,
  FriendshipStatus,
  ReactionType,
  MessageThreadType,
  MessageType,
  MessageParticipantRole,
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
  ReactPostInput,
  ReactionTypeEnum,
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

const METRIC_TABLES = {
  users: { table: '"User"', column: '"createdAt"' },
  posts: { table: '"Post"', column: '"createdAt"' },
  comments: { table: '"Comment"', column: '"createdAt"' },
  reactions: { table: '"PostReaction"', column: '"createdAt"' },
  follows: { table: '"Follow"', column: '"createdAt"' },
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

const PORT = Number(process.env.PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const MEDIA_S3_ENDPOINT = process.env.MEDIA_S3_ENDPOINT || 'http://127.0.0.1:9000'
const MEDIA_S3_REGION = process.env.MEDIA_S3_REGION || 'us-east-1'
const MEDIA_S3_ACCESS_KEY = process.env.MEDIA_S3_ACCESS_KEY || 'minioadmin'
const MEDIA_S3_SECRET_KEY = process.env.MEDIA_S3_SECRET_KEY || 'minioadmin'
const MEDIA_BUCKET_PUBLIC = process.env.MEDIA_BUCKET_PUBLIC || 'civil-media'
const MEDIA_BUCKET_ORIGINAL = process.env.MEDIA_BUCKET_ORIGINAL || 'civil-media-raw'
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || `http://127.0.0.1:9000/${MEDIA_BUCKET_PUBLIC}`).replace(/\/$/, '')
const MEDIA_SIGNED_URL_TTL = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || 900)
const LEGACY_MEDIA_BASE_URLS = [
  'http://localhost:9000/civil-media',
  'http://127.0.0.1:9000/civil-media',
  'http://minio:9000/civil-media',
]

const STRIPE_API_VERSION = '2024-06-20'
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const STRIPE_PRICE_PREMIUM = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || ''
const STRIPE_PRICE_BUSINESS = process.env.STRIPE_PRICE_BUSINESS_MONTHLY || ''
const STRIPE_PUBLISHABLE_KEY = (process.env.STRIPE_PUBLIC_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
const BILLING_PORTAL_RETURN_FALLBACK = process.env.BILLING_RETURN_URL || 'http://localhost:3001/settings/billing'
const MAX_BUSINESSES_PER_USER = 5
const DEFAULT_SUPER_ADMINS = ['andrewnormore@gmail.com']
const COMMUNITY_FOLLOW_TARGET = 3
const COMMUNITY_SUGGESTION_CACHE_LIMIT = 10
const NOTIFICATION_CHANNEL_PREFIX = 'chan:notify:'

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
  post_image: 25 * MB,
  attachment: 40 * MB,
}
const MEDIA_PROXY_UPLOAD_LIMIT = 50 * MB

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
  premiumStatus: true,
} satisfies Prisma.UserSelect

type FriendUser = Prisma.UserGetPayload<{ select: typeof FRIEND_USER_SELECT }>

function formatFriendUser(user: FriendUser) {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
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

async function dispatchNotification(record: NotificationRecord) {
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
}

async function createNotificationRecord(data: {
  userId: string
  actorId: string
  type: string
  postId?: string | null
  payload?: Prisma.InputJsonValue
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
  await dispatchNotification(notification)
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

async function loadFollowingTargetIds(userId: string): Promise<string[]> {
  const rows: Pick<Prisma.FollowGetPayload<{ select: { targetId: true } }>, 'targetId'>[] = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { targetId: true },
  })
  return rows.map((row) => row.targetId)
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

async function loadThreadForUser(threadId: string, userId: string) {
  return prisma.messageThread.findFirst({
    where: {
      id: threadId,
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
const POSITIVE_REACTIONS: ReactionType[] = ['maple', 'heart', 'haha', 'wow', 'fire']
const SUPPORT_REACTIONS: ReactionType[] = ['sad']

const SCHEMA_MISMATCH_MESSAGE =
  'Database schema is missing the social feed columns. Apply the latest Prisma migration (pnpm --filter @civil/db prisma migrate deploy) and restart the API.'

function isSchemaOutOfDateError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2021' || err.code === 'P2022' || err.code === 'P2010'
  }
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : ''
  return /does not exist|unknown column|undefined table|undefined column/i.test(message)
}

const MediaAssetParam = z.object({ id: MediaAssetIdSchema })
const FriendRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const FriendshipIdParam = z.object({ id: z.string().cuid() })
const MessageThreadIdParam = z.object({ id: z.string().cuid() })
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
  premiumStatus: PremiumStatus | null
}

type UserSearchResultPayload = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
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

  return cities.map((city: CityModel) => formatCitySummary(city))
}

async function loadAuthenticatedUser(req: FastifyRequest) {
  const payload = await (req as any).jwtVerify()
  return prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, name: true } })
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
      return reply.code(503).send({ error: 'schema_out_of_date', message: SCHEMA_MISMATCH_MESSAGE })
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

  const [reactionGroups, recentPositive, commentCount, commentScoreResult] = await Promise.all([
    tx.postReaction.groupBy({
      by: ['type'],
      where: { postId },
      _count: true,
    }),
    tx.postReaction.count({
      where: {
        postId,
        type: { in: POSITIVE_REACTIONS },
        createdAt: { gte: reactionWindowStart },
      },
    }),
    tx.comment.count({ where: { postId } }),
    tx.comment.aggregate({ where: { postId }, _sum: { score: true } }),
  ])

  const reactionCounts: Record<ReactionType, number> = {
    maple: 0,
    heart: 0,
    haha: 0,
    wow: 0,
    sad: 0,
    fire: 0,
  }

  for (const group of reactionGroups) {
    reactionCounts[group.type] = group._count
  }

  const positiveReactions = POSITIVE_REACTIONS.reduce((sum, type) => sum + (reactionCounts[type] ?? 0), 0)
  const supportReactions = SUPPORT_REACTIONS.reduce((sum, type) => sum + (reactionCounts[type] ?? 0), 0)
  const commentScore = commentScoreResult?._sum?.score ?? 0

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
      upvotes: positiveReactions + supportReactions,
      downvotes: 0,
      score: positiveReactions,
      commentCount,
      hotScore,
      reactionMaple: reactionCounts.maple,
      reactionHeart: reactionCounts.heart,
      reactionHaha: reactionCounts.haha,
      reactionWow: reactionCounts.wow,
      reactionSad: reactionCounts.sad,
      reactionFire: reactionCounts.fire,
      reactionTotal: positiveReactions + supportReactions,
      recentPositive,
      lastActivityAt: nextLastActivityAt,
    },
  })

  return {
    positiveReactions,
    supportReactions,
    reactionCounts,
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

const POST_INCLUDE = {
  author: {
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
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
    provinceCode: string | null
    communitySlug: string | null
  } | null
  sharedPost: FormattedPost | null
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
  counts: {
    commentCount: number
    reactions: number
    recentPositive: number
  }
  reactions: {
    maple: number
    heart: number
    haha: number
    wow: number
    sad: number
    fire: number
    total: number
    positive: number
  }
  metrics: {
    hotScore: number
  }
  viewer: {
    reaction: ReactionType | null
  }
}

function formatPost(post: PostWithAuthor, options: { viewerReaction?: ReactionType | null } = {}): FormattedPost {
  const community = post.provinceCode && post.communitySlug ? findCommunity(post.provinceCode, post.communitySlug) : null
  const provinceName = community ? getProvinceDisplayName(community.province as any) : null

  const reactionCounts = {
    maple: post.reactionMaple ?? 0,
    heart: post.reactionHeart ?? 0,
    haha: post.reactionHaha ?? 0,
    wow: post.reactionWow ?? 0,
    sad: post.reactionSad ?? 0,
    fire: post.reactionFire ?? 0,
  }
  const positiveTotal = reactionCounts.maple + reactionCounts.heart + reactionCounts.haha + reactionCounts.wow + reactionCounts.fire
  const totalReactions = positiveTotal + reactionCounts.sad

  let sharedPost: FormattedPost | null = null
  if (post.sharedPost) {
    sharedPost = formatPost(post.sharedPost as any)
  }

  return {
    id: post.id,
    seoSlug: post.seoSlug,
    type: post.type,
    title: post.title,
    body: post.body,
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
      isPremium: isPremium(post.author.premiumStatus),
      isVerified: isPremium(post.author.premiumStatus),
    },
    counts: {
      commentCount: post.commentCount,
      reactions: totalReactions,
      recentPositive: post.recentPositive ?? 0,
    },
    reactions: {
      ...reactionCounts,
      total: totalReactions,
      positive: positiveTotal,
    },
    metrics: {
      hotScore: post.hotScore,
    },
    viewer: {
      reaction: options.viewerReaction ?? null,
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

// Auth: register
app.post('/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
  // Accept both shapes: shared RegisterInput and our local variant with optional handle
  let parse = RegisterInput.safeParse(req.body)
  if (!parse.success) {
    parse = RegisterInputApi.safeParse(req.body)
  }
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { email, firstName, lastName, password } = parse.data
  const normalizedFirstName = firstName.trim().toLowerCase()
  const normalizedLastName = lastName.trim().toLowerCase()
  const name = `${normalizedFirstName} ${normalizedLastName}`.trim()
  const baseHandle = buildHandleBase(normalizedFirstName, normalizedLastName)
  const handle = await generateUniqueHandle(baseHandle, prisma)
  const hash = await bcrypt.hash(password, 10)
  try {
    const user = await prisma.user.create({ data: { id: randomUUID(), email, handle, name, passwordHash: hash } })
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

      let reactionsByPost: Record<string, ReactionType> = {}
      if (viewerId && items.length) {
        const reactions = await prisma.postReaction.findMany({
          where: { userId: viewerId, postId: { in: items.map((item) => item.id) } },
          select: { postId: true, type: true },
        })
        const reactionMap: Record<string, ReactionType> = {}
        for (const reaction of reactions) {
          reactionMap[reaction.postId] = reaction.type
        }
        reactionsByPost = reactionMap
      }

      return {
        community: communityRecord,
        items: items.map((item) => formatPost(item, { viewerReaction: reactionsByPost[item.id] ?? null })),
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

  const [followers, following, communitiesFollowing, homeFollow] = await Promise.all([
    prisma.follow.count({ where: { targetId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
    prisma.communityFollow.count({ where: { userId } }),
    prisma.communityFollow.findFirst({ where: { userId, home: true } }),
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
  }> = []

  try {
    const experiences = await prisma.experience.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { startDate: 'desc' }],
    })
  experienceItems = experiences.map((exp: ExperienceModel) => ({
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
      bio: user.bio ?? '',
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
      followers,
      following,
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
        bio: bio?.trim() ? bio.trim() : null,
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

    return reply.send({
      assetId: asset.id,
      upload: {
        url: uploadUrl,
        method: 'PUT',
        headers: {
          'content-type': mime,
        },
      },
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

    let provinceCode: string | null = null
    let communitySlug: string | null = null
    if (parse.data.communityProvince && parse.data.communitySlug) {
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

    const { body, mediaUrl, images, hashtags, type, title, jurisdiction, sharedPostId } = parse.data

    if (sharedPostId && (!body || body.trim().length === 0)) {
      return reply.code(400).send({ error: 'Commentary is required when sharing a post.' })
    }

    const slugBase = buildPostSlugBase({ handle: author.handle, title, body })
    const normalizedJurisdiction: Jurisdiction = jurisdiction ?? (provinceCode ? 'federal' : DEFAULT_JURISDICTION)

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const seoSlug = await generateUniquePostSlug(slugBase, tx)

      const post = await tx.post.create({
        data: {
          authorId: userId,
          body,
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
          sharedPost: {
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
          },
        },
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

app.post('/posts/react', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = ReactPostInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { postId, reaction } = parse.data

    const post = await prisma.post.findUnique({ where: { id: postId } })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (reaction) {
        await tx.postReaction.upsert({
          where: {
            userId_postId: {
              userId,
              postId,
            },
          },
          create: {
            userId,
            postId,
            type: reaction,
          },
          update: {
            type: reaction,
          },
        })
      } else {
        await tx.postReaction.deleteMany({
          where: {
            userId,
            postId,
          },
        })
      }

      await refreshPostAggregates(tx, postId, { createdAt: post.createdAt, lastActivityAt: post.updatedAt }, { bumpActivity: false })
    })

    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
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
        sharedPost: {
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
        },
      },
    })

    if (!updatedPost) return reply.code(404).send({ error: 'post_not_found' })

    return reply.send({ post: formatPost(updatedPost, { viewerReaction: reaction }) })
  }),
)

app.delete('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

    const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { authorId: true } })
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

    const { title, body, mediaUrl, hashtags } = parse.data

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
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: emailOrHandle }, { handle: emailOrHandle }],
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

app.get('/messages/threads', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = MessageThreadListQuery.safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { limit, cursor } = parse.data
    const rows: ThreadSummaryRecord[] = await prisma.messageThread.findMany({
      where: { participants: { some: { userId } } },
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
        participants: { some: { userId } },
      },
      select: {
        id: true,
        participants: { select: { userId: true } },
      },
    })
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })

    const messageRecord = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.message.create({
        data: {
          threadId: thread.id,
          senderId: userId,
          body: parse.data.body ?? null,
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
      WHERE mp."userId" = ${userId}
      AND m."senderId" != ${userId}
      AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
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
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()
    const target = await prisma.user.findUnique({ where: { handle }, select: { id: true } })
    if (!target) return reply.code(404).send({ error: 'user_not_found' })
    if (target.id === userId) return reply.code(400).send({ error: 'cannot_follow_self' })

    const existing = await prisma.follow.findUnique({
      where: {
        followerId_targetId: {
          followerId: userId,
          targetId: target.id,
        },
      },
    })

    if (existing) {
      return reply.send({ ok: true })
    }

    await prisma.follow.create({ data: { followerId: userId, targetId: target.id } })
    return reply.code(201).send({ ok: true })
  }),
)

app.delete('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = HandleParam.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const handle = params.data.handle.replace(/^@/, '').toLowerCase()
    const target = await prisma.user.findUnique({ where: { handle }, select: { id: true } })
    if (!target) return reply.code(404).send({ error: 'user_not_found' })
    if (target.id === userId) return reply.code(400).send({ error: 'cannot_follow_self' })

    await prisma.follow
      .delete({
        where: {
          followerId_targetId: {
            followerId: userId,
            targetId: target.id,
          },
        },
      })
      .catch(() => null)

    return reply.send({ ok: true })
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
  logoMediaId: z.string().trim().min(3).optional(),
  coverMediaId: z.string().trim().min(3).optional(),
})

type CommunityOrgRecord = {
  id: string
  ownerId: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
  type: BusinessType
  description: string | null
  status: BusinessStatus
  isVerified: boolean
  logoUrl?: string | null
  coverUrl?: string | null
  createdAt: Date
  updatedAt: Date
  _count?: { follows?: number }
}

function buildCommunityOrgPayload(org: CommunityOrgRecord, viewerFollowed: boolean) {
  return {
    id: org.id,
    ownerId: org.ownerId,
    provinceCode: org.provinceCode,
    communitySlug: org.communitySlug,
    name: org.name,
    slug: org.slug,
    type: org.type,
    description: org.description,
    status: org.status,
    isVerified: org.isVerified,
    logoUrl: org.logoUrl ?? null,
    coverUrl: org.coverUrl ?? null,
    followerCount: org._count?.follows ?? 0,
    viewerFollowed,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  }
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
      },
    })

    return reply.send({
      items: items
        .filter((row: DirectoryOrgRow) => Boolean(row.provinceCode) && Boolean(row.communitySlug))
        .map((row: DirectoryOrgRow) => ({
          logoUrl: row.logoUrl ?? null,
          coverUrl: row.coverUrl ?? null,
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
    const viewerFollowed = viewerId
      ? Boolean(
          await prisma.businessFollow.findUnique({
            where: { businessId_userId: { businessId: org.id, userId: viewerId } },
            select: { id: true },
          }),
        )
      : false

    return reply.send({ org: buildCommunityOrgPayload(org, viewerFollowed) })
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

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { premiumStatus: true } })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })
    if (!isPremium(user.premiumStatus)) return reply.code(403).send({ error: 'premium_required' })

    const ownedCount = await prisma.business.count({ where: { ownerId: userId } })
    if (ownedCount >= MAX_BUSINESSES_PER_USER) {
      return reply.code(403).send({ error: 'business_limit_reached' })
    }

    const desiredSlugRaw = body.data.slug?.trim() || ''
    const desiredSlug = desiredSlugRaw ? trimSlugLength(slugifyText(desiredSlugRaw.toLowerCase()), 80) : null

    const baseSlug = desiredSlug || trimSlugLength(slugifyText(body.data.name), 80) || 'organization'
    const slug = await ensureUniqueCommunityOrgSlug({ provinceCode: province, communitySlug: community.slug, baseSlug })

    const type = (body.data.type ?? 'LOCAL_BUSINESS') as BusinessType

    const org = (await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.business.create({
        data: {
          ownerId: userId,
          provinceCode: province,
          communitySlug: community.slug,
          name: body.data.name.trim(),
          slug,
          type,
          description: body.data.description?.trim() || null,
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
      select: { id: true },
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
      select: { id: true, ownerId: true },
    })

    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (org.ownerId !== userId) return reply.code(403).send({ error: 'forbidden' })

    const nextData: Prisma.BusinessUpdateInput = {}

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
        status: true,
        isVerified: true,
        logoUrl: true,
        coverUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { follows: true } },
      },
    })) as CommunityOrgRecord

    return reply.send({ org: buildCommunityOrgPayload(updated, true) })
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
      },
    })) as Array<{
      id: string
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      isVerified: boolean
      status: BusinessStatus
    }>

    const items = organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      provinceCode: org.provinceCode,
      communitySlug: org.communitySlug,
      isVerified: org.isVerified,
      status: org.status,
    }))

    return reply.send({ items })
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
      select: { id: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const { cursor, limit, jurisdiction, sort } = query.data
    const sortMode = sort ?? 'new'

    const where: Prisma.PostWhereInput = {
      businessId: org.id,
      ...(jurisdiction ? { jurisdiction } : {}),
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

    const viewerId = (req as any).user?.id as string | undefined
    let reactionsByPost: Record<string, ReactionType> = {}
    if (viewerId && posts.length) {
      const reactions = await prisma.postReaction.findMany({
        where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } },
        select: { postId: true, type: true },
      })
      const reactionMap: Record<string, ReactionType> = {}
      for (const reaction of reactions) {
        reactionMap[reaction.postId] = reaction.type
      }
      reactionsByPost = reactionMap
    }

    return reply.send({
      items: posts.map((post) => formatPost(post, { viewerReaction: reactionsByPost[post.id] ?? null })),
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

    if (!post) return reply.code(404).send({ error: 'not found' })

    const viewerId = (req as any).user?.id as string | undefined
    let viewerReaction: ReactionType | null = null
    if (viewerId) {
      const reaction = await prisma.postReaction.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId: post.id,
          },
        },
        select: { type: true },
      })
      viewerReaction = reaction?.type ?? null
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
      post: formatPost(post, { viewerReaction }),
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
    if (!post) return reply.code(404).send({ error: 'not found' })
    const viewerId = (req as any).user?.id as string | undefined
    let viewerReaction: ReactionType | null = null
    if (viewerId) {
      const reaction = await prisma.postReaction.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId: post.id,
          },
        },
        select: { type: true },
      })
      viewerReaction = reaction?.type ?? null
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
      post: formatPost(post, { viewerReaction }),
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
        scope: z.enum(['all', 'friends', 'communities', 'organizations']).optional(),
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

    if (viewerId && !province && !community) {
      const includeFriends = scope === 'all' || scope === 'friends'
      const includeCommunities = scope === 'all' || scope === 'communities'
      const includeOrganizations = scope === 'all' || scope === 'organizations'

      const accessibleFilters: Prisma.PostWhereInput[] = []

      if (includeFriends) {
        const friendIds = await loadAcceptedFriendIds(viewerId)
        const allowedAuthorIds = new Set<string>([viewerId, ...friendIds])
        if (allowedAuthorIds.size) {
          // If scope is strictly 'friends', we only want posts that are NOT targeted at a community
          // unless the user specifically wants to see everything their friends posted.
          // The requirement is: "When viewing /friends we should only see posts with the context of the post subtype of friend; not a community post."
          // This implies we should filter out posts that have a communitySlug set, OR we should only include posts where audience is 'friends' or 'public' but not community-specific.
          // However, the current schema might not have an explicit 'audience' field that distinguishes this easily other than provinceCode/communitySlug being null.
          // Let's check if we can filter by provinceCode: null.
          
          if (scope === 'friends') {
             accessibleFilters.push({ 
               authorId: { in: [...allowedAuthorIds] },
               communitySlug: null 
             })
          } else {
             accessibleFilters.push({ authorId: { in: [...allowedAuthorIds] } })
          }
        }
      }

      if (includeCommunities) {
        const follows = await prisma.communityFollow.findMany({
          where: { userId: viewerId },
          select: { provinceCode: true, communitySlug: true },
        })

        const seenKeys = new Set<string>()
        for (const follow of follows) {
          if (!follow.provinceCode || !follow.communitySlug) continue
          const key = `${follow.provinceCode}:${follow.communitySlug}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          accessibleFilters.push({ provinceCode: follow.provinceCode, communitySlug: follow.communitySlug })
        }
      }

      if (includeOrganizations) {
        const businessFollows: Array<{ businessId: string }> = await prisma.businessFollow.findMany({
          where: { userId: viewerId },
          select: { businessId: true },
        })

        const businessIds = Array.from(new Set(businessFollows.map((follow) => follow.businessId)))
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

    let reactionsByPost: Record<string, ReactionType> = {}
    if (viewerId && items.length) {
      const reactions = await prisma.postReaction.findMany({
        where: { userId: viewerId, postId: { in: items.map((post) => post.id) } },
        select: { postId: true, type: true },
      })
      const reactionMap: Record<string, ReactionType> = {}
      for (const reaction of reactions) {
        reactionMap[reaction.postId] = reaction.type
      }
      reactionsByPost = reactionMap
    }

    return {
      items: items.map((item) => formatPost(item, { viewerReaction: reactionsByPost[item.id] ?? null })),
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
    try {
      const [followers, following] = await Promise.all([
        prisma.follow.count({ where: { targetId: userRecord.id } }),
        prisma.follow.count({ where: { followerId: userRecord.id } }),
      ])
      followersCount = followers
      followingCount = following
    } catch (error) {
      // Ignore
    }

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

    const mappedExperiences = experiences.map((exp) => ({
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
      followerCount: followersCount,
      followingCount,
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
      following: boolean
    } = {
      friendshipStatus: 'none',
      friendshipId: null,
      friendshipSince: null,
      following: false,
    }

    if (viewerId) {
      if (viewerId === user.id) {
        relationship.friendshipStatus = 'self'
      } else {
        try {
          const [friendship, followRecord] = await Promise.all([
            prisma.friendship.findFirst({
              where: {
                OR: [
                  { initiatorId: viewerId, recipientId: user.id },
                  { initiatorId: user.id, recipientId: viewerId },
                ],
              },
            }),
            prisma.follow.findUnique({
              where: {
                followerId_targetId: {
                  followerId: viewerId,
                  targetId: user.id,
                },
              },
            }),
          ])

          let friendshipStatus: 'none' | 'friends' | 'incoming' | 'outgoing' = 'none'
          let friendshipId: string | null = null
          let friendshipSince: Date | null = null

          if (friendship) {
            friendshipId = friendship.id
            if (friendship.status === FriendshipStatus.ACCEPTED) {
              friendshipStatus = 'friends'
              friendshipSince = friendship.createdAt // or updatedAt? usually createdAt of acceptance if tracked, but here just createdAt
            } else if (friendship.status === FriendshipStatus.PENDING) {
              if (friendship.initiatorId === viewerId) {
                friendshipStatus = 'outgoing'
              } else {
                friendshipStatus = 'incoming'
              }
            }
          }

          relationship = {
            friendshipStatus,
            friendshipId,
            friendshipSince,
            following: Boolean(followRecord),
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

    // Privacy: If not self and not friends, only show community posts
    if (relationship.friendshipStatus !== 'self' && relationship.friendshipStatus !== 'friends') {
      where.communitySlug = { not: null }
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

    let reactionsByPost: Record<string, ReactionType> = {}
    if (viewerId && posts.length) {
      const reactions = await prisma.postReaction.findMany({
        where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } },
        select: { postId: true, type: true },
      })
      const reactionMap: Record<string, ReactionType> = {}
      for (const reaction of reactions) {
        reactionMap[reaction.postId] = reaction.type
      }
      reactionsByPost = reactionMap
    }

    return {
      user,
      relationship,
      items: posts.map((post) => formatPost(post, { viewerReaction: reactionsByPost[post.id] ?? null })),
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

async function processStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<StripeProcessResult> {
  switch (event.type) {
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
    totalFollows,
    followsToday,
    userSeries,
    postSeries,
    commentSeries,
    reactionSeries,
    followSeries,
    pageViewSeries,
    routeTraffic,
    topPostViews,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.post.count(),
    prisma.post.count({ where: { createdAt: { gte: today } } }),
    prisma.comment.count(),
    prisma.comment.count({ where: { createdAt: { gte: today } } }),
    prisma.postReaction.count(),
    prisma.postReaction.count({ where: { createdAt: { gte: today } } }),
    prisma.follow.count(),
    prisma.follow.count({ where: { createdAt: { gte: today } } }),
    queryDailyCounts('users', range),
    queryDailyCounts('posts', range),
    queryDailyCounts('comments', range),
    queryDailyCounts('reactions', range),
    queryDailyCounts('follows', range),
    queryPageViewSeries(range),
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
  ])

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
    follows: {
      total: totalFollows,
      today: followsToday,
      series: followSeries,
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
    const dateMap = new Map<string, { users?: number; posts?: number; comments?: number; reactions?: number; views?: number; follows?: number }>()
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
    ingest(followSeries, 'follows')

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
        entry.follows ?? 0,
      ].join(',')
    })

    const csv = ['date,users,posts,comments,reactions,pageViews,follows', ...rows].join('\n')
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
  const friendsThreshold = [
    user.lastViewedFriendsAt,
    user.lastViewedHomeAt
  ]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

  // Get new post counts
  const activeFriendCounts = await prisma.post.groupBy({
    by: ['authorId'],
    where: {
      authorId: { in: friendIds },
      createdAt: { gt: friendsThreshold },
    },
    _count: { id: true },
  })

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
  
  const friends = await prisma.user.findMany({
    where: { id: { in: selectedIds } },
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      bio: true,
      communityMeta: true, // To get home community
    },
  })

  const friendsWithCounts = friends.map((friend: any) => ({
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

  const communitiesWithCounts = await Promise.all(
    follows.map(async (follow: any) => {
      // If the user has viewed the home feed more recently than this specific community,
      // we can consider posts "seen" if they are older than the home feed view time.
      // However, this is a heuristic. The user might not have scrolled down far enough.
      // But per user request: "if my user sees the post in the /home feed... technically, we saw it"
      // So we will use the MAX of community lastViewedAt and user.lastViewedHomeAt (and maybe lastViewedCommunitiesAt)
      
      const lastViewed = [
        follow.lastViewedAt,
        user?.lastViewedHomeAt,
        // user?.lastViewedCommunitiesAt // Optional: include if we want the "Communities" tab to also clear it
      ]
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

      const newPosts = await prisma.post.count({
        where: {
          provinceCode: follow.provinceCode,
          communitySlug: follow.communitySlug,
          createdAt: { gt: lastViewed },
        },
      })

      const city = await prisma.city.findFirst({
        where: { provinceCode: follow.provinceCode, communitySlug: follow.communitySlug },
        select: { name: true, communityName: true },
      })

      return {
        provinceCode: follow.provinceCode,
        communitySlug: follow.communitySlug,
        name: city?.communityName ?? city?.name ?? follow.communitySlug,
        newPosts,
      }
    }),
  )

  // Limit 5, sort by new posts desc
  const topCommunities = communitiesWithCounts.sort((a: any, b: any) => b.newPosts - a.newPosts).slice(0, 5)

  return {
    userHandle: user?.handle,
    totalFriends: friendIds.length,
    friends: finalFriends,
    communities: topCommunities,
  }
})

// Restore the missing /users/:handle/friends endpoint.
app.get('/users/:handle/friends', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const { handle } = req.params as { handle: string }
    const viewerId = (req as any).user?.id

    if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true, lastViewedFriendsAt: true, lastViewedHomeAt: true },
    })

    if (!user) return reply.code(404).send({ error: 'not_found' })

    // Privacy check: only the user can view their own full friends list (for now)
    if (user.id !== viewerId) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const friendIds = await loadAcceptedFriendIds(user.id)
    
    // Determine threshold for new posts
    const friendsThreshold = [
      user.lastViewedFriendsAt,
      user.lastViewedHomeAt
    ]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)

    // Get new post counts
    const activeFriendCounts = await prisma.post.groupBy({
      by: ['authorId'],
      where: {
        authorId: { in: friendIds },
        createdAt: { gt: friendsThreshold },
      },
      _count: { id: true },
    })

    const friendCountMap = new Map<string, number>()
    activeFriendCounts.forEach((row: { authorId: string; _count: { id: number } }) => {
      friendCountMap.set(row.authorId, row._count.id)
    })

    const friends = await prisma.user.findMany({
      where: { id: { in: friendIds } },
      select: {
        id: true,
        handle: true,
        name: true,
        avatarUrl: true,
        bio: true,
        communityMeta: true, // To get home community
      },
    })

    const items = friends.map((friend: any) => {
      // Extract home community from communityMeta if available
      // communityMeta structure: { home: { province: 'on', community: 'york-durham' } }
      let homeCommunity = null
      if (friend.communityMeta?.home) {
        const { province, community } = friend.communityMeta.home
        const city = findCommunity(province, community)
        if (city) {
          homeCommunity = {
            province,
            community,
            name: city.name,
          }
        }
      }

      return {
        id: friend.id,
        handle: friend.handle,
        name: friend.name,
        avatarUrl: friend.avatarUrl,
        bio: friend.bio,
        newPosts: friendCountMap.get(friend.id) ?? 0,
        homeCommunity,
      }
    })

    // Sort by new posts desc, then name
    items.sort((a: any, b: any) => {
      if (b.newPosts !== a.newPosts) return b.newPosts - a.newPosts
      return (a.name || a.handle).localeCompare(b.name || b.handle)
    })

    return { items }
  }),
)

// Server startup code
const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' })
    console.log('Server listening on port 3000')
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
start()

