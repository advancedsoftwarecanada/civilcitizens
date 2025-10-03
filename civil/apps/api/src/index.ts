import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sse from 'fastify-sse-v2'
import { z } from 'zod'
import { prisma } from '@civil/db'
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
  PROVINCES,
  getChambersByProvince,
  findChamber,
  normalizeProvinceCode,
  getProvinceDisplayName,
  buildHandleBase,
  JurisdictionEnum,
  ChamberGeolocateInput,
} from '@civil/shared'
import bcrypt from 'bcryptjs'
import { Redis as IORedis } from 'ioredis'
import { Prisma } from '@prisma/client'
type ExperienceModel = Prisma.ExperienceGetPayload<{ select: { id: true; title: true; organization: true; location: true; startDate: true; endDate: true; current: true; description: true; position: true } }>
import { randomUUID } from 'crypto'
import { locateChamberFromPoint } from './geodata.js'

const PORT = Number(process.env.PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

const app = Fastify({
  logger: true,
  trustProxy: true, // behind Nginx/Cloudflare
})

await app.register(cors, { origin: true, credentials: true })
await app.register(jwt, { secret: JWT_SECRET })
await app.register(sse as any)

const redis = new IORedis(REDIS_URL)
void redis

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

type PostStatsInput = {
  upvotes: number
  downvotes: number
  commentCount: number
  createdAt: Date
  lastActivityAt: Date
}

function calculateHotScore({ upvotes, downvotes, commentCount, createdAt, lastActivityAt }: PostStatsInput) {
  const voteScore = upvotes - downvotes
  const interactionScore = voteScore + Math.min(commentCount, 50)
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
  const [upvotes, downvotes, commentCount] = await Promise.all([
    tx.vote.count({ where: { postId, value: 1 } }),
    tx.vote.count({ where: { postId, value: -1 } }),
    tx.comment.count({ where: { postId } }),
  ])

  const nextLastActivityAt = options.bumpActivity ? new Date() : times.lastActivityAt
  const hotScore = calculateHotScore({
    upvotes,
    downvotes,
    commentCount,
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
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  }
  replies: CommentNode[]
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
    author: {
      id: row.user.id,
      handle: row.user.handle,
      name: row.user.name ?? null,
      avatarUrl: row.user.avatarUrl ?? null,
    },
    replies: [],
  }
}

function buildCommentTree(rows: CommentWithUser[], viewerVotes: Record<string, number> = {}): CommentNode[] {
  const nodeMap = new Map<string, CommentNode>()
  const roots: CommentNode[] = []

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
        parent.replies.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        return
      }
    }
    roots.push(node)
  })

  roots.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return roots
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
    mediaUrl: post.mediaUrl,
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
      avatarUrl: post.author.avatarUrl,
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
      votesByPost = votes.reduce<Record<string, number>>((acc, vote) => {
        acc[vote.postId] = vote.value
        return acc
      }, {})
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

  const { firstName, lastName, bio, experiences } = parse.data
  const fullName = `${firstName} ${lastName}`.trim()

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

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          name: fullName,
          bio: bio?.trim() ? bio.trim() : null,
          handle,
        },
        select: {
          id: true,
          name: true,
          bio: true,
          handle: true,
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

    return reply.send({ ok: true, user: result })
  } catch (err) {
    if (isExperienceTableMissing(err)) {
      return reply.code(503).send({ error: 'experiences_not_available' })
    }
    throw err
  }
})

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
      select: { id: true, email: true, handle: true, name: true, avatarUrl: true },
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

    return reply.send({ ...user, homeChamber })
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

    const commentRows = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    })

    let viewerCommentVotes: Record<string, number> = {}
    if (viewerId && commentRows.length) {
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: commentRows.map((row) => row.id) } },
        select: { commentId: true, value: true },
      })
      viewerCommentVotes = votes.reduce<Record<string, number>>((acc, vote) => {
        acc[vote.commentId] = vote.value
        return acc
      }, {})
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
      votesByPost = votes.reduce<Record<string, number>>((acc, vote) => {
        acc[vote.postId] = vote.value
        return acc
      }, {})
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

    await prisma.$transaction(async (tx) => {
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

    await prisma.$transaction(async (tx) => {
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
          },
        },
      },
    })

    return reply.code(201).send({
      comment: mapComment(createdComment, null),
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
      },
    })

    if (!comment) return reply.code(404).send({ error: 'comment_not_found' })

    let viewerVote: number | null = null
    let voteChanged = false

    await prisma.$transaction(async (tx) => {
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
          },
        },
      },
    })

    if (!updated) return reply.code(404).send({ error: 'comment_not_found' })

    return reply.send({ comment: mapComment(updated, viewerVote) })
  }),
)

app.get('/posts/:id/comments', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid id' })

    const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { id: true } })
    if (!post) return reply.code(404).send({ error: 'post_not_found' })

    const rows = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    })

    const viewerId = (req as any).user?.id as string | undefined
    let viewerVotes: Record<string, number> = {}
    if (viewerId && rows.length) {
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: rows.map((row) => row.id) } },
        select: { commentId: true, value: true },
      })
      viewerVotes = votes.reduce<Record<string, number>>((acc, vote) => {
        acc[vote.commentId] = vote.value
        return acc
      }, {})
    }

    return reply.send({ comments: buildCommentTree(rows, viewerVotes) })
  }),
)

app.get('/posts/slug/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = z.object({ slug: z.string().min(3).max(200) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_slug' })

    const post = await prisma.post.findUnique({
      where: { seoSlug: params.data.slug },
      include: {
        author: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
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

    const commentRows = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    })

    let viewerCommentVotes: Record<string, number> = {}
    if (viewerId && commentRows.length) {
      const votes = await prisma.commentVote.findMany({
        where: { userId: viewerId, commentId: { in: commentRows.map((row) => row.id) } },
        select: { commentId: true, value: true },
      })
      viewerCommentVotes = votes.reduce<Record<string, number>>((acc, vote) => {
        acc[vote.commentId] = vote.value
        return acc
      }, {})
    }

    return {
      post: formatPost(post, { viewerVote }),
      paths: getCanonicalPaths(post),
      comments: buildCommentTree(commentRows, viewerCommentVotes),
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
        createdAt: true,
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

    const user = {
      ...userRecord,
      experiences: mappedExperiences,
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
      votesByPost = votes.reduce<Record<string, number>>((acc, vote) => {
        acc[vote.postId] = vote.value
        return acc
      }, {})
    }

    return {
      user,
      items: posts.map((post) => formatPost(post, { viewerVote: votesByPost[post.id] ?? null })),
      nextCursor,
    }
  }),
)

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
