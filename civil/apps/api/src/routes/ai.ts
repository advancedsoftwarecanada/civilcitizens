import { prisma } from '@civil/db'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { CivilAiServerConfig } from '../civilAiCore.js'

const CivilAiModelsQuery = z.object({
  serverId: z.string().trim().min(1).optional(),
})

const CivilAiCommunityIdParams = z.object({
  communityId: z.string().trim().min(3).max(80),
})

const CivilAiScopedDataQuery = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(6),
  when: z.enum(['today', 'upcoming']).default('upcoming'),
})

const CivilAiSearchableDataQuery = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(6),
  q: z.string().trim().min(1).max(120).optional(),
})

const CivilAiJobIdParams = z.object({
  jobId: z.string().trim().min(1).max(120),
})

type CivilAiCardReferenceLike = Record<string, unknown>

type CivilAiChatRouteInput = {
  conversationId?: string
  serverId?: string
  model?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
}

type CivilAiChatJobLike = {
  id: string
  conversation_id: string
  user_id: string | null
  status: string
}

type RouteActionResult = Promise<unknown | FastifyReply>

type AiRoutesDeps = {
  authorizeCivilAiDataRequest: (req: FastifyRequest) => Promise<{ error: 'family_mode_not_available' } | { userId: string | null } | null>
  buildCivilAiApiCatalog: (viewerContext: unknown) => unknown
  buildCivilAiEffectiveQuestion: (messages: CivilAiChatRouteInput['messages']) => string
  callCivilAiServer: (args: {
    server: unknown
    path: string
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  }) => Promise<{ ok: boolean; status: number; text: string; json: unknown }>
  callCivilAiServerWithPathFallback: (args: {
    server: unknown
    paths: string[]
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  }) => Promise<{ ok: boolean; status: number; text: string; json: unknown }>
  cancelCivilAiChatJob: (jobId: string) => Promise<CivilAiChatJobLike | null>
  createCivilAiChatJob: (args: {
    conversationId: string
    userId: string | null
    body: CivilAiChatRouteInput
    latestUserMessage: string
  }) => Promise<string>
  formatCivilAiChatJobPayload: (job: CivilAiChatJobLike) => unknown
  loadActiveCivilAiChatJobForUser: (userId: string) => Promise<CivilAiChatJobLike | null>
  loadCivilAiChatJob: (jobId: string) => Promise<CivilAiChatJobLike | null>
  loadCivilAiCommunityCauses: (communityId: string, limit: number, query?: string) => Promise<{ error: string } | { community: unknown; items: unknown[] }>
  loadCivilAiCommunityEvents: (communityId: string, when: 'today' | 'upcoming', limit: number) => Promise<{ error: string } | { community: unknown; items: unknown[] }>
  loadCivilAiCommunityJobs: (communityId: string, limit: number) => Promise<{ error: string } | { community: unknown; items: unknown[] }>
  loadCivilAiCommunityOrganizations: (communityId: string, limit: number, query?: string) => Promise<{ error: string } | { community: unknown; items: unknown[] }>
  loadCivilAiCommunityPosts: (communityId: string, limit: number, query?: string, viewerFeedContext?: unknown | null) => Promise<{ error: string } | { community: unknown; items: unknown[] }>
  loadCivilAiCommunityTopics: (communityId: string, limit: number, query?: string) => Promise<{ error: string } | { community: unknown; items: unknown[] }>
  loadCivilAiServersConfig: () => Promise<{
    defaultServerId: string | null
    servers: CivilAiServerConfig[]
    configPath: string
  }>
  loadCivilAiViewerContext: (userId: string) => Promise<{ feedContext?: unknown | null } | null>
  loadViewerAuthContext: (req: FastifyRequest) => Promise<{ actor: 'family_member' | 'user' } | null>
  parseCivilAiChatInput: (value: unknown) => { success: true; data: CivilAiChatRouteInput } | { success: false; error: { flatten: () => unknown } }
  parseCivilAiCommunityId: (value: string) => unknown | null
  readCivilAiHistory: (meta: unknown) => unknown[]
  readCivilAiInstructions: () => Promise<{ instructionsPath: string }>
  resolveCivilAiServer: (serverId?: string) => Promise<{ server: CivilAiServerConfig | null }>
  resolveUserId: (req: FastifyRequest) => Promise<string | null>
  scheduleCivilAiChatJob: (jobId: string) => void
  searchMarketListingsForQuery: (query: string, limit: number) => Promise<unknown[]>
  toCivilAiCauseReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiCommunityReference: (community: unknown) => unknown
  toCivilAiEventReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiJobReference: (item: unknown) => CivilAiCardReferenceLike | null
  toCivilAiMarketReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiOrganizationReference: (item: unknown) => CivilAiCardReferenceLike | null
  toCivilAiPostReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiTopicReference: (item: unknown) => CivilAiCardReferenceLike
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, action: () => Promise<unknown>) => RouteActionResult
}

function readCivilAiBody(req: FastifyRequest) {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

export function registerAiRoutes(app: FastifyInstance, deps: AiRoutesDeps) {
  app.get('/ai/servers', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const config = await deps.loadCivilAiServersConfig()
      const instructions = await deps.readCivilAiInstructions()
      return reply.send({
        defaultServerId: config.defaultServerId,
        servers: config.servers,
        configPath: config.configPath,
        instructionsPath: instructions.instructionsPath,
      })
    }),
  )

  app.get('/ai/history', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (authContext?.actor === 'family_member') {
        return reply.code(403).send({ error: 'family_mode_not_available' })
      }

      const userId = await deps.resolveUserId(req)
      if (!userId) return reply.send({ items: [] })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
      return reply.send({ items: deps.readCivilAiHistory(user?.communityMeta ?? null) })
    }),
  )

  app.get('/ai/context', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access?.userId) return reply.code(401).send({ error: 'unauthorized' })

      const viewerContext = await deps.loadCivilAiViewerContext(access.userId)
      if (!viewerContext) return reply.code(404).send({ error: 'user_not_found' })

      return reply.send({
        viewer: viewerContext,
        availableApis: deps.buildCivilAiApiCatalog(viewerContext),
      })
    }),
  )

  app.get('/ai/communities/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const community = deps.parseCivilAiCommunityId(params.data.communityId)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      return reply.send({
        community,
        card: deps.toCivilAiCommunityReference(community),
      })
    }),
  )

  app.get('/ai/events/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      const query = CivilAiScopedDataQuery.safeParse(req.query ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const result = await deps.loadCivilAiCommunityEvents(params.data.communityId, query.data.when, query.data.limit)
      if ('error' in result) return reply.code(404).send({ error: result.error })

      return reply.send({
        community: result.community,
        when: query.data.when,
        items: result.items,
        cards: result.items.map((item) => deps.toCivilAiEventReference(item)),
      })
    }),
  )

  app.get('/ai/jobs/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      const query = CivilAiScopedDataQuery.safeParse(req.query ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const result = await deps.loadCivilAiCommunityJobs(params.data.communityId, query.data.limit)
      if ('error' in result) return reply.code(404).send({ error: result.error })

      return reply.send({
        community: result.community,
        items: result.items,
        cards: result.items.map((item) => deps.toCivilAiJobReference(item)).filter((entry): entry is CivilAiCardReferenceLike => Boolean(entry)),
      })
    }),
  )

  app.get('/ai/causes/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      const query = CivilAiSearchableDataQuery.safeParse(req.query ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const result = await deps.loadCivilAiCommunityCauses(params.data.communityId, query.data.limit, query.data.q)
      if ('error' in result) return reply.code(404).send({ error: result.error })

      return reply.send({
        community: result.community,
        query: query.data.q ?? null,
        items: result.items,
        cards: result.items.map((item) => deps.toCivilAiCauseReference(item)),
      })
    }),
  )

  app.get('/ai/market', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const query = CivilAiSearchableDataQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const normalizedQuery = typeof query.data.q === 'string' ? query.data.q.trim() : ''
      if (!normalizedQuery) return reply.send({ query: null, items: [], cards: [] })

      const items = await deps.searchMarketListingsForQuery(normalizedQuery, query.data.limit)
      return reply.send({
        query: normalizedQuery,
        items,
        cards: items.map((item) => deps.toCivilAiMarketReference(item)),
      })
    }),
  )

  app.get('/ai/organizations/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      const query = CivilAiSearchableDataQuery.safeParse(req.query ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const result = await deps.loadCivilAiCommunityOrganizations(params.data.communityId, query.data.limit, query.data.q)
      if ('error' in result) return reply.code(404).send({ error: result.error })

      const cards: CivilAiCardReferenceLike[] = []
      for (const item of result.items) {
        const card = deps.toCivilAiOrganizationReference(item)
        if (card) cards.push(card)
      }

      return reply.send({
        community: result.community,
        query: query.data.q ?? null,
        items: result.items,
        cards,
      })
    }),
  )

  app.get('/ai/posts/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      const query = CivilAiSearchableDataQuery.safeParse(req.query ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const viewerContext = access.userId ? await deps.loadCivilAiViewerContext(access.userId) : null
      const result = await deps.loadCivilAiCommunityPosts(params.data.communityId, query.data.limit, query.data.q, viewerContext?.feedContext ?? null)
      if ('error' in result) return reply.code(404).send({ error: result.error })

      return reply.send({
        community: result.community,
        query: query.data.q ?? null,
        items: result.items,
        cards: result.items.map((item) => deps.toCivilAiPostReference(item)),
      })
    }),
  )

  app.get('/ai/topics/:communityId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const access = await deps.authorizeCivilAiDataRequest(req)
      if (access && 'error' in access) return reply.code(403).send({ error: access.error })
      if (!access) return reply.code(401).send({ error: 'unauthorized' })

      const params = CivilAiCommunityIdParams.safeParse(req.params)
      const query = CivilAiSearchableDataQuery.safeParse(req.query ?? {})
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const result = await deps.loadCivilAiCommunityTopics(params.data.communityId, query.data.limit, query.data.q)
      if ('error' in result) return reply.code(404).send({ error: result.error })

      return reply.send({
        community: result.community,
        query: query.data.q ?? null,
        items: result.items,
        cards: result.items.map((item) => deps.toCivilAiTopicReference(item)),
      })
    }),
  )

  app.get('/ai/models', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = CivilAiModelsQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const resolved = await deps.resolveCivilAiServer(query.data.serverId)
      if (!resolved.server) return reply.code(503).send({ error: 'no_ai_server_available' })

      if (resolved.server.defaultModel?.trim()) {
        return reply.send({
          items: [
            {
              id: resolved.server.defaultModel.trim(),
              name: resolved.server.defaultModel.trim(),
              loaded: true,
            },
          ],
        })
      }

      const upstream = await deps.callCivilAiServerWithPathFallback({ server: resolved.server, paths: ['/v1/models', '/api/v1/models'], method: 'GET' })
      if (!upstream.ok) {
        return reply.code(upstream.status || 502).send({ error: upstream.text || 'ai_models_failed' })
      }

      const payload = upstream.json as Record<string, unknown> | null
      const rawItems = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : Array.isArray(upstream.json)
            ? upstream.json
            : []

      const items = rawItems
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const model = entry as Record<string, unknown>
          const id = typeof model.id === 'string' ? model.id : typeof model.model === 'string' ? model.model : ''
          if (!id) return null
          return {
            id,
            name: typeof model.name === 'string' ? model.name : id,
            loaded: model.loaded === true || model.state === 'loaded',
          }
        })
        .filter((entry): entry is { id: string; name: string; loaded: boolean } => Boolean(entry))

      return reply.send({ items, raw: upstream.json })
    }),
  )

  app.post('/ai/models/load', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const body = readCivilAiBody(req)
      if (!body) return reply.code(400).send({ error: 'invalid_body' })

      const serverId = typeof body.serverId === 'string' ? body.serverId : undefined
      const resolved = await deps.resolveCivilAiServer(serverId)
      if (!resolved.server) return reply.code(503).send({ error: 'no_ai_server_available' })

      const payload = { ...body }
      delete payload.serverId

      const upstream = await deps.callCivilAiServer({
        server: resolved.server,
        path: '/api/v1/models/load',
        method: 'POST',
        body: payload,
      })

      if (!upstream.ok) {
        return reply.code(upstream.status || 502).send({ error: upstream.text || 'ai_model_load_failed' })
      }

      return reply.send(upstream.json ?? { ok: true })
    }),
  )

  app.post('/ai/models/download', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const body = readCivilAiBody(req)
      if (!body) return reply.code(400).send({ error: 'invalid_body' })

      const serverId = typeof body.serverId === 'string' ? body.serverId : undefined
      const resolved = await deps.resolveCivilAiServer(serverId)
      if (!resolved.server) return reply.code(503).send({ error: 'no_ai_server_available' })

      const payload = { ...body }
      delete payload.serverId

      const upstream = await deps.callCivilAiServer({
        server: resolved.server,
        path: '/api/v1/models/download',
        method: 'POST',
        body: payload,
      })

      if (!upstream.ok) {
        return reply.code(upstream.status || 502).send({ error: upstream.text || 'ai_model_download_failed' })
      }

      return reply.send(upstream.json ?? { ok: true })
    }),
  )

  app.get('/ai/models/download/status/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = CivilAiJobIdParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const query = CivilAiModelsQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const resolved = await deps.resolveCivilAiServer(query.data.serverId)
      if (!resolved.server) return reply.code(503).send({ error: 'no_ai_server_available' })

      const upstream = await deps.callCivilAiServer({
        server: resolved.server,
        path: `/api/v1/models/download/status/${encodeURIComponent(params.data.jobId)}`,
        method: 'GET',
      })

      if (!upstream.ok) {
        return reply.code(upstream.status || 502).send({ error: upstream.text || 'ai_model_download_status_failed' })
      }

      return reply.send(upstream.json ?? { ok: true })
    }),
  )

  app.get('/ai/chat', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () =>
      reply.code(405).send({
        error: 'method_not_allowed',
        message: 'Use POST /ai/chat to create an AI job, then GET /ai/chat/jobs/:jobId to poll for completion.',
      }),
    ),
  )

  app.get('/ai/chat/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (authContext?.actor === 'family_member') {
        return reply.code(403).send({ error: 'family_mode_not_available' })
      }

      const params = CivilAiJobIdParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const job = await deps.loadCivilAiChatJob(params.data.jobId)
      if (!job) return reply.code(404).send({ error: 'ai_job_not_found' })

      const userId = await deps.resolveUserId(req)
      if (job.user_id && job.user_id !== userId) {
        return reply.code(404).send({ error: 'ai_job_not_found' })
      }

      if (job.status === 'queued') {
        deps.scheduleCivilAiChatJob(job.id)
      }

      return reply.send(deps.formatCivilAiChatJobPayload(job))
    }),
  )

  app.delete('/ai/chat/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (authContext?.actor === 'family_member') {
        return reply.code(403).send({ error: 'family_mode_not_available' })
      }

      const params = CivilAiJobIdParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const job = await deps.loadCivilAiChatJob(params.data.jobId)
      if (!job) return reply.code(404).send({ error: 'ai_job_not_found' })

      const userId = await deps.resolveUserId(req)
      if (job.user_id && job.user_id !== userId) {
        return reply.code(404).send({ error: 'ai_job_not_found' })
      }

      const cancelled = await deps.cancelCivilAiChatJob(job.id)
      return reply.send(deps.formatCivilAiChatJobPayload(cancelled ?? job))
    }),
  )

  app.post('/ai/chat', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (authContext?.actor === 'family_member') {
        return reply.code(403).send({ error: 'family_mode_not_available' })
      }

      const body = deps.parseCivilAiChatInput(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      const userId = await deps.resolveUserId(req)
      if (userId) {
        const activeJob = await deps.loadActiveCivilAiChatJobForUser(userId)
        if (activeJob) {
          if (activeJob.status === 'queued') {
            deps.scheduleCivilAiChatJob(activeJob.id)
          }
          return reply.code(202).send({
            jobId: activeJob.id,
            conversationId: activeJob.conversation_id,
            status: activeJob.status,
          })
        }
      }

      const conversationId = body.data.conversationId?.trim() || randomUUID()
      const latestUserMessage = deps.buildCivilAiEffectiveQuestion(body.data.messages)
      const jobId = await deps.createCivilAiChatJob({
        conversationId,
        userId,
        body: {
          ...body.data,
          conversationId,
          stream: false,
        },
        latestUserMessage,
      })

      deps.scheduleCivilAiChatJob(jobId)
      return reply.code(202).send({
        jobId,
        conversationId,
        status: 'queued',
      })
    }),
  )
}
