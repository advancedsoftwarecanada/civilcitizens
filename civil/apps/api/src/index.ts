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
import { Prisma, MediaCategory, PremiumStatus, BusinessStatus, StripeWebhookStatus } from '@prisma/client'
import {
  CreatePostInput,
  CreateCommentInput,
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  SetHomeChamberInput,
  FollowChamberInput,
  UnfollowChamberInput,
  UpdateProfileInput,
  CursorQuery,
  HandleParam,
  VotePostInput,
  VoteCommentInput,
  PostSortEnum,
  CommentSortEnum,
  PROVINCES,
  getChambersByProvince,
  findChamber,
  normalizeProvinceCode,
  getProvinceDisplayName,
  buildHandleBase,
  JurisdictionEnum,
  ChamberGeolocateInput,
  RequestMediaUploadInput,
  CompleteMediaUploadInput,
  MediaAssetIdSchema,
} from '@civil/shared'
import bcrypt from 'bcryptjs'
import { Redis as IORedis } from 'ioredis'
import Stripe from 'stripe'
type ExperienceModel = Prisma.ExperienceGetPayload<{ select: { id: true; title: true; organization: true; location: true; startDate: true; endDate: true; current: true; description: true; position: true } }>
import { createHash, randomUUID } from 'crypto'
import { locateChamberFromPoint } from './geodata.js'

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

const app = Fastify({
  logger: true,
  trustProxy: true, // behind Nginx/Cloudflare
})

for (const mime of BINARY_UPLOAD_MIME_TYPES) {
  app.addContentTypeParser(mime, { parseAs: 'buffer' }, (request, payload, done) => {
    done(null, payload)
  })
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

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient
type Jurisdiction = z.infer<typeof JurisdictionEnum>
const DEFAULT_JURISDICTION: Jurisdiction = 'citizen'
const REDDIT_EPOCH_SECONDS = 1134028003

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
  upvotes: number
  downvotes: number
  commentCount: number
  commentScore: number
  createdAt: Date
  lastActivityAt: Date
}

function calculateHotScore({ upvotes, downvotes, commentCount, commentScore, createdAt, lastActivityAt }: PostStatsInput) {
  const voteScore = upvotes - downvotes
  const discussionWeight = Math.min(commentCount, 50)
  const commentScoreWeight = Math.max(Math.min(commentScore / 4, 75), -75)
  const interactionScore = voteScore + discussionWeight + commentScoreWeight
  const order = Math.log10(Math.max(Math.abs(interactionScore), 1))
  const sign = interactionScore > 0 ? 1 : interactionScore < 0 ? -1 : 0
  const baseTime = Math.max(createdAt.getTime(), lastActivityAt.getTime())
  const seconds = baseTime / 1000 - REDDIT_EPOCH_SECONDS
  return Number((sign * seconds + order).toFixed(6))
}

async function refreshPostAggregates(
  tx: Prisma.TransactionClient,
  postId: string,
  times: { createdAt: Date; lastActivityAt: Date },
  options: { bumpActivity?: boolean } = {},
) {
  const [upvotes, downvotes, commentCount, commentScoreResult] = await Promise.all([
    tx.vote.count({ where: { postId, value: 1 } }),
    tx.vote.count({ where: { postId, value: -1 } }),
    tx.comment.count({ where: { postId } }),
    tx.comment.aggregate({ where: { postId }, _sum: { score: true } }),
  ])

  const commentScore = commentScoreResult?._sum?.score ?? 0

  const nextLastActivityAt = options.bumpActivity ? new Date() : times.lastActivityAt
  const hotScore = calculateHotScore({
    upvotes,
    downvotes,
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
      score: upvotes - downvotes,
      commentCount,
      hotScore,
      lastActivityAt: nextLastActivityAt,
    },
  })

  return {
    upvotes,
    downvotes,
    commentCount,
    commentScore,
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
  downvotes,
  replyCount,
  replyScore,
  createdAt,
  updatedAt,
}: {
  upvotes: number
  downvotes: number
  replyCount: number
  replyScore: number
  createdAt: Date
  updatedAt: Date
}) {
  return calculateHotScore({
    upvotes,
    downvotes,
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
    downvotes: node.downvotes,
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
  const combined = [handlePart, contentPart].filter(Boolean).join('-') || 'post'
  const normalized = combined.replace(/-+/g, '-')
  const trimmed = trimSlugLength(normalized, POST_SLUG_BASE_LIMIT)
  return trimmed || 'post'
}

function randomSlugSuffix() {
  return randomUUID().replace(/-/g, '').slice(0, 6)
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

type PostWithAuthor = Prisma.PostGetPayload<{
  include: {
    author: {
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

function formatPost(post: PostWithAuthor, options: { viewerVote?: number | null } = {}) {
  const chamber = post.provinceCode && post.chamberSlug ? findChamber(post.provinceCode, post.chamberSlug) : null
  const provinceName = chamber ? getProvinceDisplayName(chamber.province as any) : null
  return {
    id: post.id,
    seoSlug: post.seoSlug,
    type: post.type,
    title: post.title,
    body: post.body,
    mediaUrl: normalizeMediaUrl(post.mediaUrl ?? null),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  jurisdiction: post.jurisdiction,
    provinceCode: post.provinceCode,
    chamberSlug: post.chamberSlug,
    chamberName: chamber?.name ?? null,
    provinceName,
    author: {
      id: post.author.id,
      handle: post.author.handle,
      name: post.author.name,
      avatarUrl: normalizeMediaUrl(post.author.avatarUrl ?? null),
      isPremium: isPremium(post.author.premiumStatus),
      isVerified: isPremium(post.author.premiumStatus),
    },
    counts: {
      upvotes: post.upvotes,
      downvotes: post.downvotes,
      score: post.score,
      commentCount: post.commentCount,
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
    chamber: post.provinceCode && post.chamberSlug ? `/${post.provinceCode}/${post.chamberSlug}/posts/${slug}` : null,
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
  const name = `${firstName.trim()} ${lastName.trim()}`.trim()
  const baseHandle = buildHandleBase(firstName, lastName)
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
app.get('/chambers/:province/:chamber/posts', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z
      .object({
        province: z.string().min(2).max(64),
        chamber: z.string().min(1).max(160),
      })
      .safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    const chamberRecord = findChamber(province, params.data.chamber)
    if (!chamberRecord) return reply.code(404).send({ error: 'chamber_not_found' })

    const query = CursorQuery.extend({
      jurisdiction: JurisdictionEnum.optional(),
      sort: PostSortEnum.optional(),
    }).safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const { cursor, limit, jurisdiction, sort } = query.data
    const viewerId = (req as any).user?.id as string | undefined
    const sortMode = sort ?? 'new'

    const where: Prisma.PostWhereInput = {
      provinceCode: chamberRecord.province,
      chamberSlug: chamberRecord.slug,
      ...(jurisdiction ? { jurisdiction } : {}),
    }

    let items: PostWithAuthor[] = []
    let nextCursor: string | undefined

    if (sortMode === 'hot') {
      items = await prisma.post.findMany({
        where,
        take: limit,
        orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
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
    } else {
      const queryResult = await prisma.post.findMany({
        where,
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
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

    return {
      chamber: chamberRecord,
      items: items.map((item) => formatPost(item, { viewerVote: votesByPost[item.id] ?? null })),
      nextCursor,
    }
  }),
)

app.get('/chambers/:province', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z.object({ province: z.string().min(2).max(64) }).safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

  const province = normalizeProvinceCode(params.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })

  const chambers = getChambersByProvince(province)
  return reply.send({ items: chambers })
})

// Chambers - get current home chamber
app.get('/chambers/home', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  const follow = await prisma.chamberFollow.findFirst({ where: { userId, home: true } })
  if (!follow) return reply.send({ home: null })
  const chamber = findChamber(follow.provinceCode, follow.chamberSlug)
  return reply.send({
    home: chamber ? { ...chamber } : { province: follow.provinceCode, slug: follow.chamberSlug },
  })
})

// Chambers - set home chamber
app.post('/chambers/home', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = SetHomeChamberInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const chamber = findChamber(province, parse.data.chamberSlug)
  if (!chamber) return reply.code(404).send({ error: 'chamber_not_found' })

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.chamberFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
    await tx.chamberFollow.upsert({
      where: {
        userId_provinceCode_chamberSlug: {
          userId,
          provinceCode: province,
          chamberSlug: chamber.slug,
        },
      },
      create: {
        userId,
        provinceCode: province,
        chamberSlug: chamber.slug,
        home: true,
      },
      update: {
        home: true,
        provinceCode: province,
        chamberSlug: chamber.slug,
      },
    })
  })

  return reply.send({ ok: true, home: chamber })
})

// Chambers - get follows list
app.get('/chambers/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const follows = await prisma.chamberFollow.findMany({
    where: { userId },
    orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
  })

  const items = follows.map((follow: { provinceCode: string; chamberSlug: string; home: boolean; createdAt: Date }) => {
    const chamber = findChamber(follow.provinceCode, follow.chamberSlug)
    return {
      province: follow.provinceCode,
      chamberSlug: follow.chamberSlug,
      home: follow.home,
      followedAt: follow.createdAt,
      chamber,
    }
  })

  return reply.send({ items })
})

// Chambers - follow additional chamber
app.post('/chambers/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = FollowChamberInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const chamber = findChamber(province, parse.data.chamberSlug)
  if (!chamber) return reply.code(404).send({ error: 'chamber_not_found' })

  const setAsHome = parse.data.setAsHome === true

  const follow = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (setAsHome) {
      await tx.chamberFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
    }

    return tx.chamberFollow.upsert({
      where: {
        userId_provinceCode_chamberSlug: {
          userId,
          provinceCode: province,
          chamberSlug: chamber.slug,
        },
      },
      create: {
        userId,
        provinceCode: province,
        chamberSlug: chamber.slug,
        home: setAsHome,
      },
      update: {
        provinceCode: province,
        chamberSlug: chamber.slug,
        home: setAsHome ? true : undefined,
      },
    })
  })

  return reply.send({
    ok: true,
    follow: {
      province: follow.provinceCode,
      chamberSlug: follow.chamberSlug,
      home: follow.home,
      chamber,
    },
  })
})

// Chambers - unfollow
app.delete('/chambers/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = UnfollowChamberInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const existing = await prisma.chamberFollow.findUnique({
    where: {
      userId_provinceCode_chamberSlug: {
        userId,
        provinceCode: province,
        chamberSlug: parse.data.chamberSlug,
      },
    },
  })

  if (!existing) {
    return reply.code(404).send({ error: 'not_following' })
  }

  await prisma.chamberFollow.delete({
    where: {
      userId_provinceCode_chamberSlug: {
        userId,
        provinceCode: province,
        chamberSlug: parse.data.chamberSlug,
      },
    },
  })

  return reply.send({ ok: true })
})

app.post('/chambers/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = ChamberGeolocateInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  try {
    const { lat, lng, limit, bboxPaddingDegrees } = parse.data
    const { primary, alternatives, meta } = await locateChamberFromPoint(lat, lng, {
      limit: limit ?? undefined,
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    return reply.send({ primary, alternatives, meta })
  } catch (error) {
    req.log.error({ err: error }, 'chamber_geolocate_failed')
    return reply.code(500).send({ error: 'geolocation_failed' })
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
      createdAt: true,
    },
  })

  if (!user) return reply.code(404).send({ error: 'not_found' })

  const [followers, following, chambersFollowing, homeFollow] = await Promise.all([
    prisma.follow.count({ where: { targetId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
    prisma.chamberFollow.count({ where: { userId } }),
    prisma.chamberFollow.findFirst({ where: { userId, home: true } }),
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

  let homeChamber: Record<string, any> | null = null
  if (homeFollow) {
    const chamber = findChamber(homeFollow.provinceCode, homeFollow.chamberSlug)
    const provinceName = getProvinceDisplayName(homeFollow.provinceCode as any)
    homeChamber = {
      provinceCode: homeFollow.provinceCode,
      provinceName,
      chamberSlug: homeFollow.chamberSlug,
      chamberName: chamber?.name ?? homeFollow.chamberSlug,
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
      createdAt: user.createdAt,
      experiences: experienceItems,
    },
    stats: {
      followers,
      following,
      chambersFollowing,
    },
    homeChamber,
  })
})

// Profile - update current user
app.put('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = UpdateProfileInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const { firstName, lastName, bio, experiences, avatarMediaId, coverMediaId } = parse.data
  const fullName = `${firstName} ${lastName}`.trim()

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
      const baseHandle = buildHandleBase(firstName, lastName)
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
    let chamberSlug: string | null = null
    if (parse.data.chamberProvince && parse.data.chamberSlug) {
      const normalizedProvince = normalizeProvinceCode(parse.data.chamberProvince)
      if (!normalizedProvince) {
        return reply.code(400).send({ error: 'invalid_province' })
      }
      const chamber = findChamber(normalizedProvince, parse.data.chamberSlug)
      if (!chamber) {
        return reply.code(404).send({ error: 'chamber_not_found' })
      }
      provinceCode = chamber.province
      chamberSlug = chamber.slug
    }

    const { body, mediaUrl, hashtags, type, title, jurisdiction } = parse.data

    const slugBase = buildPostSlugBase({ handle: author.handle, title, body })
    const normalizedJurisdiction: Jurisdiction = jurisdiction ?? (provinceCode ? 'federal' : DEFAULT_JURISDICTION)

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const seoSlug = await generateUniquePostSlug(slugBase, tx)

      const post = await tx.post.create({
        data: {
          authorId: userId,
          body,
          mediaUrl,
          type,
          title,
          provinceCode,
          chamberSlug,
          seoSlug,
          jurisdiction: normalizedJurisdiction,
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

    const homeFollow = await prisma.chamberFollow.findFirst({ where: { userId: payload.sub, home: true } })
    let homeChamber: null | {
      provinceCode: string
      provinceName: string
      chamberSlug: string
      chamberName: string
    } = null

    if (homeFollow) {
      const chamber = findChamber(homeFollow.provinceCode, homeFollow.chamberSlug)
      const normalizedProvince = normalizeProvinceCode(homeFollow.provinceCode)
      homeChamber = {
        provinceCode: normalizedProvince ?? homeFollow.provinceCode,
        provinceName: normalizedProvince
          ? getProvinceDisplayName(normalizedProvince)
          : homeFollow.provinceCode.toUpperCase(),
        chamberSlug: homeFollow.chamberSlug,
        chamberName: chamber?.name ?? homeFollow.chamberSlug,
      }
    }

    const normalizedUser = normalizeUserMedia(user)
    return reply.send({
      ...normalizedUser,
      homeChamber,
      isPremium: isPremium(user.premiumStatus),
      isVerified: isPremium(user.premiumStatus),
      premiumSince: user.premiumSince ?? null,
      premiumRenewsAt: user.premiumRenewsAt ?? null,
    })
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }
})

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

// Chambers - provinces list
app.get('/chambers/provinces', async (_req: FastifyRequest, reply: FastifyReply) => reply.send({ items: PROVINCES }))

// Chambers - list within a province
app.get('/chambers', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = z.object({ province: z.string().min(2) }).safeParse(req.query)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const province = normalizeProvinceCode(parse.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })
  const chambers = getChambersByProvince(province)
  return reply.send({ items: chambers })
})

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
      })
      .safeParse(req.query)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
    const { cursor, limit, jurisdiction, sort } = parse.data
    const where: Prisma.PostWhereInput = {}
    if (jurisdiction) {
      where.jurisdiction = jurisdiction
    }
    const viewerId = (req as any).user?.id as string | undefined
    const sortMode = sort ?? 'new'

    let items: PostWithAuthor[] = []
    let nextCursor: string | undefined = undefined

    if (sortMode === 'hot') {
      items = await prisma.post.findMany({
        take: limit,
        orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
        where,
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
    } else {
      const query = await prisma.post.findMany({
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
        where,
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
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (query.length > limit) {
        const next = query.pop()!
        nextCursor = next.id
      }
      items = query
    }

    let votesByPost: Record<string, number> = {}
    if (viewerId && items.length) {
      const votes = await prisma.vote.findMany({
        where: { postId: { in: items.map((item) => item.id) }, userId: viewerId },
        select: { postId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.postId] = vote.value
      }
      votesByPost = voteMap
    }

    return {
      items: items.map((item) => formatPost(item, { viewerVote: votesByPost[item.id] ?? null })),
      nextCursor,
    }
  }),
)

app.post('/posts/vote', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = VotePostInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { postId, value } = parse.data

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        createdAt: true,
        lastActivityAt: true,
        authorId: true,
      },
    })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    let currentVote: number | null = null

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.vote.findUnique({
        where: {
          userId_postId: {
            userId,
            postId,
          },
        },
        select: { value: true },
      })

      currentVote = existing?.value ?? null
      let voteChanged = false

      if (value === 0) {
        if (existing) {
          await tx.vote.delete({
            where: {
              userId_postId: {
                userId,
                postId,
              },
            },
          })
          currentVote = null
          voteChanged = true
        }
      } else if (!existing) {
        await tx.vote.create({ data: { userId, postId, value } })
        currentVote = value
        voteChanged = true
      } else if (existing.value !== value) {
        await tx.vote.update({
          where: {
            userId_postId: {
              userId,
              postId,
            },
          },
          data: { value },
        })
        currentVote = value
        voteChanged = true
      }

      if (voteChanged) {
        await refreshPostAggregates(
          tx,
          postId,
          {
            createdAt: post.createdAt,
            lastActivityAt: post.lastActivityAt,
          },
          { bumpActivity: true },
        )
      }
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
      },
    })

    if (!updatedPost) return reply.code(404).send({ error: 'post_not_found' })

    return reply.send({ post: formatPost(updatedPost, { viewerVote: currentVote }) })
  }),
)

app.post('/comments', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CreateCommentInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { postId, body, parentId } = parse.data

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        createdAt: true,
        lastActivityAt: true,
      },
    })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    if (parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentId }, select: { id: true, postId: true } })
      if (!parent || parent.postId !== postId) {
        return reply.code(400).send({ error: 'invalid_parent' })
      }
    }

    let createdComment: CommentWithUser | null = null

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      createdComment = await tx.comment.create({
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
              premiumStatus: true,
            },
          },
        },
      })

      await refreshPostAggregates(
        tx,
        postId,
        {
          createdAt: post.createdAt,
          lastActivityAt: post.lastActivityAt,
        },
        { bumpActivity: true },
      )
    })

    if (!createdComment) return reply.code(500).send({ error: 'comment_failed' })

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
      },
    })

    const createdPayload = attachCommentHotScore(mapComment(createdComment, null), { replyCount: 0, replyScore: 0 })

    return reply.code(201).send({
      comment: createdPayload,
      post: updatedPost ? formatPost(updatedPost, { viewerVote: null }) : null,
    })
  }),
)

app.post('/comments/vote', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = VoteCommentInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { commentId, value } = parse.data

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        postId: true,
        post: {
          select: {
            id: true,
            createdAt: true,
            lastActivityAt: true,
          },
        },
      },
    })

    if (!comment) return reply.code(404).send({ error: 'comment_not_found' })

    let viewerVote: number | null = null
    let voteChanged = false

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.commentVote.findUnique({
        where: {
          userId_commentId: {
            userId,
            commentId,
          },
        },
        select: { value: true },
      })

      if (value === 0) {
        if (existing) {
          await tx.commentVote.delete({
            where: {
              userId_commentId: {
                userId,
                commentId,
              },
            },
          })
          voteChanged = true
        }
        viewerVote = null
      } else if (!existing) {
        await tx.commentVote.create({ data: { userId, commentId, value } })
        voteChanged = true
        viewerVote = value
      } else if (existing.value !== value) {
        await tx.commentVote.update({
          where: {
            userId_commentId: {
              userId,
              commentId,
            },
          },
          data: { value },
        })
        voteChanged = true
        viewerVote = value
      } else {
        viewerVote = existing.value
      }

      if (voteChanged) {
        await refreshCommentAggregates(tx, commentId)

        if (comment.post) {
          await refreshPostAggregates(
            tx,
            comment.postId,
            {
              createdAt: comment.post.createdAt,
              lastActivityAt: comment.post.lastActivityAt,
            },
            { bumpActivity: true },
          )
        }
      }
    })

    const updated = await prisma.comment.findUnique({
      where: { id: commentId },
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

    if (!updated) return reply.code(404).send({ error: 'comment_not_found' })

    const [directReplyCount, replyScoreAggregate] = await Promise.all([
      prisma.comment.count({ where: { parentId: commentId } }),
      prisma.comment.aggregate({ where: { parentId: commentId }, _sum: { score: true } }),
    ])

    const formatted = attachCommentHotScore(mapComment(updated, viewerVote), {
      replyCount: directReplyCount,
      replyScore: replyScoreAggregate._sum?.score ?? 0,
    })

    return reply.send({ comment: formatted })
  }),
)

app.get('/posts/:id/comments', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid id' })

    const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { id: true } })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    const sortQuery = z
      .object({
        sort: CommentSortEnum.optional(),
      })
      .safeParse(req.query)
    if (!sortQuery.success) return reply.code(400).send({ error: sortQuery.error.flatten() })

    const sortMode = sortQuery.data.sort ?? 'hot'

    const rows: CommentWithUser[] = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'desc' },
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

    const viewerId = (req as any).user?.id as string | undefined
    let viewerVotes: Record<string, number> = {}
    if (viewerId && rows.length) {
      const commentIds = rows.map((comment) => comment.id)
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: commentIds } },
        select: { commentId: true, value: true },
      })
      const voteMap: Record<string, number> = {}
      for (const vote of votes) {
        voteMap[vote.commentId] = vote.value
      }
      viewerVotes = voteMap
    }

    return reply.send({ comments: buildCommentTree(rows, viewerVotes, { sort: sortMode }) })
  }),
)

app.get('/posts/slug/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ slug: z.string().min(3).max(200) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_slug' })

    const commentSortQuery = z
      .object({
        commentSort: CommentSortEnum.optional(),
      })
      .safeParse(req.query)
    if (!commentSortQuery.success) return reply.code(400).send({ error: commentSortQuery.error.flatten() })

    const commentSort = commentSortQuery.data.commentSort ?? 'hot'

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

    if (!post) return reply.code(404).send({ error: 'not_found' })

    const viewerId = (req as any).user?.id as string | undefined
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
      orderBy: { createdAt: 'desc' },
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
      post: formatPost(post, { viewerVote }),
      paths: getCanonicalPaths(post),
      comments: buildCommentTree(commentRows, viewerCommentVotes, { sort: commentSort }),
    }
  }),
)

app.get('/users/:handle/posts', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
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
        createdAt: true,
        premiumStatus: true,
      },
    })

    if (!userRecord) return reply.code(404).send({ error: 'user_not_found' })

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
      position: exp.position,
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
    }

    const query = CursorQuery.extend({
      jurisdiction: JurisdictionEnum.optional(),
      sort: PostSortEnum.optional(),
    }).safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const { cursor, limit, jurisdiction, sort } = query.data
    const viewerId = (req as any).user?.id as string | undefined
    const sortMode = sort ?? 'new'

    const where: Prisma.PostWhereInput = {
      authorId: user.id,
      ...(jurisdiction ? { jurisdiction } : {}),
    }

    let posts: PostWithAuthor[] = []
    let nextCursor: string | undefined

    if (sortMode === 'hot') {
      posts = await prisma.post.findMany({
        where,
        take: limit,
        orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
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
    } else {
      const queryResult = await prisma.post.findMany({
        where,
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
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

    return {
      user,
      items: posts.map((post) => formatPost(post, { viewerVote: votesByPost[post.id] ?? null })),
      nextCursor,
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

  const stripe = getStripeClient()
  const { customerId } = await ensureStripeCustomer(userId)
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: body.data.returnUrl ?? BILLING_PORTAL_RETURN_FALLBACK,
  })
  return reply.send({ portalUrl: session.url })
})

app.post('/billing/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeSubscriptionId: true, premiumStatus: true },
  })
  if (!user?.stripeSubscriptionId) {
    return reply.code(400).send({ error: 'no_active_subscription' })
  }

  const stripe = getStripeClient()
  try {
    await stripe.subscriptions.cancel(user.stripeSubscriptionId, { invoice_now: false, prorate: false })
  } catch (err) {
    req.log.error({ err, subscriptionId: user.stripeSubscriptionId }, 'stripe_cancel_failed')
    return reply.code(502).send({ error: 'stripe_cancel_failed' })
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      premiumStatus: 'CANCELED',
      premiumRenewsAt: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    },
  })

  return reply.send({ ok: true })
})

app.get('/businesses', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const businesses = await prisma.business.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    select: BUSINESS_SUMMARY_SELECT,
  })

  return reply.send({
    items: businesses,
    limit: MAX_BUSINESSES_PER_USER,
  })
})

app.post('/businesses', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

  const body = CreateBusinessInput.safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const { user } = await ensureStripeCustomer(userId)
  if (!isPremium(user.premiumStatus)) {
    return reply.code(403).send({ error: 'premium_required' })
  }

  const existingCount = await prisma.business.count({ where: { ownerId: userId } })
  if (existingCount >= MAX_BUSINESSES_PER_USER) {
    return reply.code(422).send({ error: 'business_limit_reached' })
  }

  const slugBase = body.data.slug ? slugifyText(body.data.slug).slice(0, 80) : body.data.name
  const slug = await generateUniqueBusinessSlug(userId, slugBase)

  const business = await prisma.business.create({
    data: {
      ownerId: userId,
      name: body.data.name.trim(),
      slug,
      description: body.data.description?.trim() || null,
      memberships: {
        create: { userId, role: 'OWNER' },
      },
    },
    select: BUSINESS_SUMMARY_SELECT,
  })

  return reply.code(201).send({ business, remaining: MAX_BUSINESSES_PER_USER - (existingCount + 1) })
})

app.post('/businesses/:businessId/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

  const params = BusinessParam.safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
  const body = BusinessCheckoutSchema.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const { user, customerId } = await ensureStripeCustomer(userId)
  if (!isPremium(user.premiumStatus)) {
    return reply.code(403).send({ error: 'premium_required' })
  }
  const billingProfile = buildBillingProfileResponse(user)
  if (!billingProfileIsComplete(billingProfile)) {
    return reply.code(412).send(buildBillingProfileIncompleteError(billingProfile))
  }
  const billingDetails = convertProfileToBillingDetails(billingProfile)

  const business = await loadOwnedBusiness(userId, params.data.businessId)
  if (!business) return reply.code(404).send({ error: 'business_not_found' })

  const priceId = ensurePriceAvailable(STRIPE_PRICE_BUSINESS, 'business')
  const stripe = getStripeClient()
  if ('paymentMethodId' in body.data) {
    try {
      await ensurePaymentMethodForCustomer(stripe, customerId, body.data.paymentMethodId)
    } catch (error) {
      if (error instanceof PaymentMethodOwnershipError) {
        return reply.code(error.statusCode).send({ error: error.message })
      }
      throw error
    }

    const customerUpdate: Stripe.CustomerUpdateParams = {
      name: billingDetails?.name || business.name,
      invoice_settings: { default_payment_method: body.data.paymentMethodId },
    }
    if (billingDetails?.email) customerUpdate.email = billingDetails.email
    if (billingDetails?.phone) customerUpdate.phone = billingDetails.phone
    if (billingDetails?.address) {
      customerUpdate.address = billingDetails.address
    }
    await stripe.customers.update(customerId, customerUpdate)

    const metadata: Record<string, string> = {
      kind: 'business',
      businessId: business.id,
      ownerId: userId,
    }
    if (body.data.setupIntentId) {
      metadata.setupIntentId = body.data.setupIntentId
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata,
    })

    const { invoice, paymentIntent } = resolveSubscriptionInvoice(subscription)
    if (!paymentIntent) {
      return reply.code(502).send({ error: 'payment_intent_missing' })
    }
    const requiresAction = paymentIntentRequiresAction(paymentIntent)
    const paymentSucceeded = paymentIntentSucceeded(paymentIntent)

    if (paymentSucceeded) {
      await syncBusinessSubscription(subscription)
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
    await syncBusinessSubscription(stripeSubscription)
  }

  return reply.send({
    subscriptionId: stripeSubscription.id,
    paymentIntentStatus: paymentIntent?.status ?? null,
    requiresAction: paymentIntentRequiresAction(paymentIntent),
    planApplied: paymentSucceeded,
  })
})

app.post('/businesses/:businessId/portal', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  if (!isStripeConfigured()) return reply.code(503).send({ error: 'stripe_unconfigured' })

  const params = BusinessParam.safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
  const body = PortalSessionSchema.safeParse(req.body ?? {})
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

  const business = await loadOwnedBusiness(userId, params.data.businessId)
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

// SSE notifications (skeleton)
app.get('/notifications/stream', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  const sub = new IORedis(REDIS_URL)
  const channel = `chan:notify:${userId}`
  await sub.subscribe(channel)
  reply.sse({ data: JSON.stringify({ hello: 'world' }) })
  sub.on('message', (_chan: string, message: string) => {
    reply.sse({ data: message })
  })
  req.raw.on('close', async () => {
    await sub.unsubscribe(channel)
    sub.disconnect()
  })
})

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  ;(globalThis as any)?.process?.exit(1)
}
