import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AiTaskRequestBody, getAiTaskDefinition, listAiTasks, loadAiTaskPrompt, parseAiTaskJsonResponse } from '../aiTasks.js'
import type { CivilAiServerConfig } from '../civilAiCore.js'

const AiTaskParams = z.object({
  namespace: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(120),
})

type AiTaskRoutesDeps = {
  buildCivilAiPromptInput: (systemPrompt: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => string
  callCivilAiServerWithPathFallback: (args: {
    server: CivilAiServerConfig
    paths: string[]
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    timeoutMs?: number | null
    signal?: AbortSignal
  }) => Promise<{ ok: boolean; status: number; text: string; json: unknown }>
  extractCivilAiMessageContent: (payload: unknown) => string
  loadViewerAuthContext: (req: FastifyRequest) => Promise<{ actor: 'family_member' | 'user' } | null>
  resolveCivilAiModel: (server: CivilAiServerConfig, preferredModel?: string | null) => Promise<string | null>
  resolveCivilAiServer: (serverId?: string | null) => Promise<{ server: CivilAiServerConfig | null }>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, action: () => Promise<unknown>) => Promise<unknown | FastifyReply>
}

const CIVIL_AI_TASK_TIMEOUT_MS = Math.max(
  Number(process.env.CIVIL_AI_TASK_TIMEOUT_MS || process.env.CIVIL_AI_JOB_TIMEOUT_MS || 90_000) || 90_000,
  15_000,
)

export function registerAiTaskRoutes(app: FastifyInstance, deps: AiTaskRoutesDeps) {
  app.get('/ai/tasks', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (authContext?.actor === 'family_member') {
        return reply.code(403).send({ error: 'family_mode_not_available' })
      }

      return reply.send({ items: listAiTasks() })
    }),
  )

  app.post('/ai/task/:namespace/:task', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (authContext?.actor === 'family_member') {
        return reply.code(403).send({ error: 'family_mode_not_available' })
      }

      const params = AiTaskParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const body = AiTaskRequestBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const taskId = `${params.data.namespace}/${params.data.task}`
      const definition = getAiTaskDefinition(taskId)
      if (!definition) return reply.code(404).send({ error: 'ai_task_not_found' })

      const parsedInput = definition.inputSchema.safeParse(body.data.input)
      if (!parsedInput.success) return reply.code(400).send({ error: parsedInput.error.flatten() })

      const resolved = await deps.resolveCivilAiServer(body.data.serverId)
      if (!resolved.server) return reply.code(503).send({ error: 'no_ai_server_available' })

      const resolvedModel = await deps.resolveCivilAiModel(resolved.server, body.data.model)
      if (!resolvedModel) return reply.code(503).send({ error: 'no_ai_model_available' })

      const prompt = await loadAiTaskPrompt(definition)
      const userInput = definition.buildInputText(parsedInput.data)
      const upstreamInput = deps.buildCivilAiPromptInput(prompt, [{ role: 'user', content: userInput }])
      const upstream = await deps.callCivilAiServerWithPathFallback({
        server: resolved.server,
        paths: ['/v1/responses', '/api/v1/chat'],
        method: 'POST',
        timeoutMs: CIVIL_AI_TASK_TIMEOUT_MS,
        body: {
          model: resolvedModel,
          input: upstreamInput,
          temperature: body.data.temperature,
          top_p: body.data.topP,
          max_tokens: body.data.maxTokens,
          stream: false,
        },
      })

      if (!upstream.ok) {
        return reply.code(502).send({
          error: 'ai_task_failed',
          detail: upstream.text || 'AI task request failed.',
        })
      }

      const rawText = deps.extractCivilAiMessageContent(upstream.json).trim()
      const parsedOutput = parseAiTaskJsonResponse(rawText)
      if (!parsedOutput) {
        return reply.code(502).send({
          error: 'ai_task_invalid_output',
          detail: rawText || 'AI task returned empty output.',
        })
      }

      const validatedOutput = definition.outputSchema.safeParse(parsedOutput)
      if (!validatedOutput.success) {
        return reply.code(502).send({
          error: 'ai_task_invalid_output',
          detail: rawText || 'AI task returned invalid JSON.',
          validation: validatedOutput.error.flatten(),
        })
      }

      const normalizedOutput = definition.normalizeOutput ? definition.normalizeOutput(validatedOutput.data) : validatedOutput.data
      if (!normalizedOutput) {
        return reply.code(502).send({
          error: 'ai_task_invalid_output',
          detail: rawText || 'AI task returned output that could not be matched to the task taxonomy.',
        })
      }

      return reply.send({
        task: {
          id: definition.id,
          promptFile: definition.promptFile,
        },
        result: normalizedOutput,
        rawText,
        server: {
          id: resolved.server.id,
          name: resolved.server.name,
        },
        model: resolvedModel,
      })
    }),
  )
}