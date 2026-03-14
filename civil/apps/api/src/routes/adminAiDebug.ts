import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { parseLoggedJsonText, type CivilAiDebugConversationSummary, type CivilAiDebugTurnRecord } from '../civilAiCore.js'

type AdminAiDebugDeps = {
  civilPublicHost: string
  ensureCivilAiDebugTables: () => Promise<void>
  getCivilPublicBaseUrl: () => string
  isSuperAdminEmail: (email?: string | null) => boolean
  loadAuthenticatedUser: (req: FastifyRequest) => Promise<{ id: string; email: string | null; name: string | null } | null>
  loadCivilAiServersConfig: () => Promise<{
    configPath: string
    defaultServerId: string
    servers: Array<{ id: string; name: string; baseUrl: string; provider: string | null; enabled: boolean; default: boolean }>
  }>
}

export function registerAdminAiDebugRoutes(app: FastifyInstance, deps: AdminAiDebugDeps) {
  app.get('/admin/ai/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    let user: { id: string; email: string | null; name: string | null } | null
    try {
      user = await deps.loadAuthenticatedUser(req)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (!user || !deps.isSuperAdminEmail(user.email)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await deps.ensureCivilAiDebugTables()
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const civilAiServerConfig = await deps.loadCivilAiServersConfig()
    const serverBaseUrlByName = new Map(civilAiServerConfig.servers.map((server) => [server.name, server.baseUrl]))

    type AdminAiConversationRow = {
      id: string
      user_id: string | null
      user_handle: string | null
      user_name: string | null
      started_at: Date
      last_activity_at: Date
      turn_count: number | bigint
      first_user_message: string | null
      last_user_message: string | null
      status: string | null
      last_model: string | null
      last_server: string | null
      last_error: string | null
    }

    const rows = await prisma.$queryRaw<AdminAiConversationRow[]>`
      SELECT
        id,
        user_id,
        user_handle,
        user_name,
        started_at,
        last_activity_at,
        turn_count,
        first_user_message,
        last_user_message,
        status,
        last_model,
        last_server,
        last_error
      FROM civil_ai_conversation
      ORDER BY last_activity_at DESC
      LIMIT ${query.data.limit}
    `

    const items: CivilAiDebugConversationSummary[] = rows.map((row: AdminAiConversationRow) => ({
      id: row.id,
      userId: row.user_id,
      userHandle: row.user_handle,
      userName: row.user_name,
      startedAt: row.started_at.toISOString(),
      lastActivityAt: row.last_activity_at.toISOString(),
      turnCount: Number(row.turn_count) || 0,
      firstUserMessage: row.first_user_message,
      lastUserMessage: row.last_user_message,
      status: row.status,
      lastModel: row.last_model,
      lastServer: row.last_server,
      lastServerBaseUrl: row.last_server ? serverBaseUrlByName.get(row.last_server) ?? null : null,
      lastError: row.last_error,
    }))

    return reply.send({ items })
  })

  app.get('/admin/ai/conversations/:conversationId', async (req: FastifyRequest, reply: FastifyReply) => {
    let user: { id: string; email: string | null; name: string | null } | null
    try {
      user = await deps.loadAuthenticatedUser(req)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (!user || !deps.isSuperAdminEmail(user.email)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await deps.ensureCivilAiDebugTables()
    const params = z.object({ conversationId: z.string().trim().min(1).max(120) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const civilAiServerConfig = await deps.loadCivilAiServersConfig()
    const serverBaseUrlByName = new Map(civilAiServerConfig.servers.map((server) => [server.name, server.baseUrl]))
    const activeServer =
      civilAiServerConfig.servers.find((server) => server.id === civilAiServerConfig.defaultServerId) ?? civilAiServerConfig.servers[0] ?? null

    const summaryRows = await prisma.$queryRaw<Array<{
      id: string
      user_id: string | null
      user_handle: string | null
      user_name: string | null
      started_at: Date
      last_activity_at: Date
      turn_count: number | bigint
      first_user_message: string | null
      last_user_message: string | null
      status: string | null
      last_model: string | null
      last_server: string | null
      last_error: string | null
    }>>`
      SELECT
        id,
        user_id,
        user_handle,
        user_name,
        started_at,
        last_activity_at,
        turn_count,
        first_user_message,
        last_user_message,
        status,
        last_model,
        last_server,
        last_error
      FROM civil_ai_conversation
      WHERE id = ${params.data.conversationId}
      LIMIT 1
    `

    const summary = summaryRows[0]
    if (!summary) return reply.code(404).send({ error: 'conversation_not_found' })

    type AdminAiTurnRow = {
      id: string
      conversation_id: string
      user_id: string | null
      created_at: Date
      latest_user_message: string | null
      status: string
      duration_ms: number | null
      server_name: string | null
      model: string | null
      error_message: string | null
      assistant_content: string | null
      request_messages_text: string | null
      viewer_context_text: string | null
      retrieval_debug_text: string | null
      references_text: string | null
      upstream_input_text: string | null
      raw_response_text: string | null
    }

    const turnRows = await prisma.$queryRaw<AdminAiTurnRow[]>`
      SELECT
        id,
        conversation_id,
        user_id,
        created_at,
        latest_user_message,
        status,
        duration_ms,
        server_name,
        model,
        error_message,
        assistant_content,
        request_messages_text,
        viewer_context_text,
        retrieval_debug_text,
        references_text,
        upstream_input_text,
        raw_response_text
      FROM civil_ai_turn
      WHERE conversation_id = ${params.data.conversationId}
      ORDER BY created_at DESC
      LIMIT 100
    `

    const turns: CivilAiDebugTurnRecord[] = turnRows.map((row: AdminAiTurnRow) => {
      const retrievalDebug = parseLoggedJsonText(row.retrieval_debug_text)
      const retrievalServerTarget =
        retrievalDebug && typeof retrievalDebug === 'object' && !Array.isArray(retrievalDebug)
          ? (retrievalDebug as { serverTarget?: { baseUrl?: unknown } }).serverTarget
          : null

      return {
        id: row.id,
        conversationId: row.conversation_id,
        userId: row.user_id,
        createdAt: row.created_at.toISOString(),
        latestUserMessage: row.latest_user_message,
        status: row.status,
        durationMs: row.duration_ms,
        serverName: row.server_name,
        serverBaseUrl:
          retrievalServerTarget && typeof retrievalServerTarget.baseUrl === 'string'
            ? retrievalServerTarget.baseUrl
            : row.server_name
              ? serverBaseUrlByName.get(row.server_name) ?? null
              : null,
        model: row.model,
        errorMessage: row.error_message,
        assistantContent: row.assistant_content,
        requestMessages: parseLoggedJsonText(row.request_messages_text),
        viewerContext: parseLoggedJsonText(row.viewer_context_text),
        retrievalDebug,
        references: parseLoggedJsonText(row.references_text),
        upstreamInput: row.upstream_input_text,
        rawResponse: parseLoggedJsonText(row.raw_response_text) ?? row.raw_response_text,
      }
    })

    return reply.send({
      aiConfig: {
        publicHost: deps.civilPublicHost,
        publicBaseUrl: deps.getCivilPublicBaseUrl(),
        defaultServerId: civilAiServerConfig.defaultServerId,
        configPath: civilAiServerConfig.configPath,
        activeServer,
        servers: civilAiServerConfig.servers,
      },
      conversation: {
        id: summary.id,
        userId: summary.user_id,
        userHandle: summary.user_handle,
        userName: summary.user_name,
        startedAt: summary.started_at.toISOString(),
        lastActivityAt: summary.last_activity_at.toISOString(),
        turnCount: Number(summary.turn_count) || 0,
        firstUserMessage: summary.first_user_message,
        lastUserMessage: summary.last_user_message,
        status: summary.status,
        lastModel: summary.last_model,
        lastServer: summary.last_server,
        lastServerBaseUrl: summary.last_server ? serverBaseUrlByName.get(summary.last_server) ?? null : null,
        lastError: summary.last_error,
      } satisfies CivilAiDebugConversationSummary,
      turns,
    })
  })
}
