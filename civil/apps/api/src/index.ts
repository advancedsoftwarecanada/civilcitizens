import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sse from 'fastify-sse-v2'
import { z } from 'zod'
import { prisma } from '@civil/db'
import {
  CreatePostInput,
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  SetHomeChamberInput,
  FollowChamberInput,
  UnfollowChamberInput,
  PROVINCES,
  getChambersByProvince,
  findChamber,
  normalizeProvinceCode,
} from '@civil/shared'
import bcrypt from 'bcryptjs'
import { Redis as IORedis } from 'ioredis'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'

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
  const parse = RegisterInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { email, handle, firstName, lastName, password } = parse.data
  const normalizedHandle = handle.replace(/^@/, '').toLowerCase()
  const name = `${firstName.trim()} ${lastName.trim()}`.trim()
  const hash = await bcrypt.hash(password, 10)
  try {
    const user = await prisma.user.create({ data: { id: randomUUID(), email, handle: normalizedHandle, name, passwordHash: hash } })
    const token = await (app as any).jwt.sign({ sub: user.id })
    return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
  } catch (e: any) {
    if (e.code === 'P2002') return reply.code(409).send({ error: 'email_or_handle_exists' })
    throw e
  }
})

// Auth: login
app.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = LoginInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { emailOrHandle, password } = parse.data
  const user = await prisma.user.findFirst({ where: {
    OR: [{ email: emailOrHandle }, { handle: emailOrHandle }]
  } })
  if (!user) return reply.code(401).send({ error: 'invalid_credentials' })
  const ok = await bcrypt.compare(password, (user as any).passwordHash)
  if (!ok) return reply.code(401).send({ error: 'invalid_credentials' })
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  const token = await (app as any).jwt.sign({ sub: user.id })
  return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
})

// Auth: me
app.get('/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const payload = await (req as any).jwtVerify()
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, handle: true, name: true, avatarUrl: true } })
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return user
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }
})

// Auth: logout (client discards token; endpoint for symmetry)
app.post('/auth/logout', async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.send({ ok: true })
})

// Auth: forgot password (no SMTP yet; generate token and return it for manual testing)
app.post('/auth/forgot', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = ForgotPasswordInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { emailOrHandle } = parse.data
  const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrHandle }, { handle: emailOrHandle }] } })
  if (!user) return reply.send({ ok: true }) // don't reveal existing accounts
  const token = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 48)
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
  await prisma.user.update({ where: { id: user.id }, data: { resetToken: token, resetExpires: expires } })
  // Normally send email here
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
app.get('/chambers/provinces', async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.send({ items: PROVINCES })
})

// Chambers - list within a province
app.get('/chambers', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = z.object({ province: z.string().min(2) }).safeParse(req.query)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const province = normalizeProvinceCode(parse.data.province)
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

  await prisma.$transaction(async (tx) => {
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

  const items = follows.map((follow) => {
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

  const follow = await prisma.$transaction(async (tx) => {
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

// Basic auth hook (placeholder)
app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
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

// Create post
app.post('/posts', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = CreatePostInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const { body, mediaUrl, hashtags } = parse.data

  const result = await prisma.$transaction(async (tx: any) => {
    const post = await tx.post.create({
      data: { authorId: userId, body, mediaUrl },
    })

    if (hashtags?.length) {
      const tags = hashtags.map((t: string) => t.replace(/^#/, ''))
      await tx.hashtag.createMany({ data: [...new Set(tags)].map((tag) => ({ tag })) , skipDuplicates: true })
      await tx.postHashtag.createMany({ data: [...new Set(tags)].map((tag) => ({ postId: post.id, tag })) })
    }

    return post
  })

  return reply.code(201).send(result)
})

// Get post by id
app.get('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: 'invalid id' })
  const post = await prisma.post.findUnique({ where: { id: params.data.id }, include: { author: true } })
  if (!post) return reply.code(404).send({ error: 'not found' })
  return post
})

// List posts (newest first) with cursor pagination
app.get('/posts', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { cursor, limit } = parse.data
  const items = await prisma.post.findMany({
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
    include: { author: true, likes: true, comments: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  let nextCursor: string | undefined = undefined
  if (items.length > limit) {
    const next = items.pop()!
    nextCursor = next.id
  }
  return { items, nextCursor }
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
