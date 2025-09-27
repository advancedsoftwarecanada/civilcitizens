import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sse from 'fastify-sse-v2'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { CreatePostInput } from '@civil/shared'
import { Redis as IORedis } from 'ioredis'

const PORT = Number(process.env.PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

const app = Fastify({ logger: true })

await app.register(cors, { origin: true, credentials: true })
await app.register(jwt, { secret: JWT_SECRET })
await app.register(sse as any)

const redis = new IORedis(REDIS_URL)

app.get('/health', async () => ({ ok: true }))

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
app.post('/api/posts', async (req: FastifyRequest, reply: FastifyReply) => {
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
app.get('/api/posts/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: 'invalid id' })
  const post = await prisma.post.findUnique({ where: { id: params.data.id }, include: { author: true } })
  if (!post) return reply.code(404).send({ error: 'not found' })
  return post
})

// SSE notifications (skeleton)
app.get('/api/notifications/stream', async (req: FastifyRequest, reply: FastifyReply) => {
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
  process.exit(1)
}
