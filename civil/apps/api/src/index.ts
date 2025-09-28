import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sse from 'fastify-sse-v2'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { CreatePostInput, RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput } from '@civil/shared'
import bcrypt from 'bcryptjs'
import { Redis as IORedis } from 'ioredis'
import { Prisma } from '@prisma/client'

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

// Ensure DB schema fields exist for auth (dev convenience)
async function ensureSchema() {
  try {
    await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "User" (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  handle text UNIQUE NOT NULL,
  name text,
  bio text,
  avatarUrl text,
  passwordHash text NOT NULL,
  lastLoginAt timestamp,
  resetToken text UNIQUE,
  resetExpires timestamp,
  createdAt timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "Post" (
  id text PRIMARY KEY,
  authorId text NOT NULL,
  body text NOT NULL,
  mediaUrl text,
  createdAt timestamp DEFAULT now(),
  updatedAt timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "Comment" (
  id text PRIMARY KEY,
  postId text NOT NULL,
  userId text NOT NULL,
  body text NOT NULL,
  createdAt timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "Like" (
  userId text NOT NULL,
  postId text NOT NULL,
  createdAt timestamp DEFAULT now(),
  PRIMARY KEY (userId, postId)
);
CREATE TABLE IF NOT EXISTS "Follow" (
  followerId text NOT NULL,
  targetId text NOT NULL,
  createdAt timestamp DEFAULT now(),
  PRIMARY KEY (followerId, targetId)
);
CREATE TABLE IF NOT EXISTS "Hashtag" (
  tag text PRIMARY KEY,
  createdAt timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "PostHashtag" (
  postId text NOT NULL,
  tag text NOT NULL,
  PRIMARY KEY (postId, tag)
);
CREATE TABLE IF NOT EXISTS "Notification" (
  id text PRIMARY KEY,
  userId text NOT NULL,
  type text NOT NULL,
  actorId text NOT NULL,
  postId text,
  readAt timestamp,
  createdAt timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "FeedEntry" (
  userId text NOT NULL,
  postId text NOT NULL,
  createdAt timestamp DEFAULT now(),
  PRIMARY KEY (userId, postId)
);
`)
  } catch (e) {
    app.log.warn({ err: e }, 'ensureSchema skipped')
  }
}
await ensureSchema()

// Auth: register
app.post('/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
  const parse = RegisterInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { email, handle, firstName, lastName, password } = parse.data
  const normalizedHandle = handle.replace(/^@/, '').toLowerCase()
  const name = `${firstName.trim()} ${lastName.trim()}`.trim()
  const hash = await bcrypt.hash(password, 10)
  try {
    const user = await prisma.user.create({ data: { email, handle: normalizedHandle, name, passwordHash: hash } })
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
