import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { Prisma, ModerationStatus } from '@prisma/client'
import { findCommunity, getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'crypto'

export type CivilAiServerConfig = {
  id: string
  name: string
  baseUrl: string
  provider: string | null
  apiKey: string | null
  defaultModel: string | null
  apiVersion: string | null
  enabled: boolean
  default: boolean
}

export const CivilAiChatInput = z.object({
  conversationId: z.string().trim().min(1).max(120).optional(),
  serverId: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().trim().min(1),
      }),
    )
    .min(1),
  temperature: z.coerce.number().min(0).max(2).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  maxTokens: z.coerce.number().int().min(1).max(8192).optional(),
  stream: z.boolean().optional(),
})

export type CivilAiChatInputPayload = z.infer<typeof CivilAiChatInput>

export type CivilAiCardReference = {
  kind: 'cause' | 'community' | 'event' | 'feature' | 'job' | 'market' | 'organization' | 'post' | 'topic'
  id: string
  title: string
  subtitle: string | null
  summary: string | null
  href: string
  imageUrl: string | null
  badge: string | null
}

export type CivilAiHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  references?: CivilAiCardReference[]
}

export type CivilAiDebugConversationSummary = {
  id: string
  userId: string | null
  userHandle: string | null
  userName: string | null
  startedAt: string
  lastActivityAt: string
  turnCount: number
  firstUserMessage: string | null
  lastUserMessage: string | null
  status: string | null
  lastModel: string | null
  lastServer: string | null
  lastServerBaseUrl: string | null
  lastError: string | null
}

export type CivilAiDebugTurnRecord = {
  id: string
  conversationId: string
  userId: string | null
  createdAt: string
  latestUserMessage: string | null
  status: string
  durationMs: number | null
  serverName: string | null
  serverBaseUrl: string | null
  model: string | null
  errorMessage: string | null
  assistantContent: string | null
  requestMessages: unknown
  viewerContext: unknown
  retrievalDebug: unknown
  references: unknown
  upstreamInput: string | null
  rawResponse: unknown
}

export type CivilAiViewerFeedContext = {
  viewerId: string
  homeCommunityKey: string | null
  friendIds: Set<string>
  connectionIds: Set<string>
  followedBusinessIds: Set<string>
  memberBusinessIds: Set<string>
  nearbyCommunityKeys: Set<string>
  regionalCommunityKeys: Set<string>
  followedCommunityKeys: Set<string>
}

export type CivilAiViewerContext = {
  user: {
    id: string
    handle: string
    firstName: string | null
    lastName: string | null
    name: string | null
    bio: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isVerified: boolean
    isPremium: boolean
    experiences: Array<{
      id: string
      title: string
      organization: string
      location: string | null
      startDate: string
      endDate: string | null
      current: boolean
      description: string | null
      organizationProfile: {
        id: string
        name: string
        slug: string
        href: string | null
        logoUrl: string | null
        coverUrl: string | null
      } | null
    }>
  }
  homeCommunity: {
    id: string
    provinceCode: string
    provinceName: string
    communitySlug: string
    communityName: string
    href: string
  } | null
  nearbyCommunities: Array<{
    id: string
    provinceCode: string
    provinceName: string
    communitySlug: string
    communityName: string
    href: string
  }>
  followedCommunities: Array<{
    id: string
    provinceCode: string
    provinceName: string
    communitySlug: string
    communityName: string
    href: string
    isHome: boolean
  }>
  organizations: Array<{
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    role: 'owner' | 'member' | 'followed'
    href: string | null
    logoUrl: string | null
    coverUrl: string | null
  }>
  feedContext: CivilAiViewerFeedContext
}

export type CivilAiChatResponsePayload = {
  conversationId: string
  message: {
    role: 'assistant'
    content: string
    references: CivilAiCardReference[]
  }
  model: string | null
  server: CivilAiServerConfig | null
  viewerContext: CivilAiViewerContext | null
  history: CivilAiHistoryEntry[] | null
  raw: unknown
}

export type CivilAiJobRow = {
  id: string
  conversation_id: string
  user_id: string | null
  status: string
  request_body_text: string
  latest_user_message: string | null
  response_text: string | null
  error_text: string | null
  server_name: string | null
  model: string | null
  created_at: Date
  started_at: Date | null
  completed_at: Date | null
  updated_at: Date
}

export const CIVIL_AI_MEMORY_USER_TURN_LIMIT = 5
export const CIVIL_AI_HISTORY_LIMIT = CIVIL_AI_MEMORY_USER_TURN_LIMIT * 2
export const CIVIL_AI_SERVER_TIMEOUT_MS = 45000
export const CIVIL_AI_MAX_REFERENCE_CARDS = 2

const CIVIL_AI_DATA_KEY = (process.env.CIVIL_AI_DATA_KEY || '').trim()
const CIVIL_AI_API_KEY = (process.env.CIVIL_AI_API_KEY || '').trim()
const CIVIL_AI_MODEL = (process.env.CIVIL_AI_MODEL || '').trim()
const CIVIL_AI_API_VERSION = (process.env.CIVIL_AI_API_VERSION || '').trim()
const CIVIL_AI_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const CIVIL_AI_MAX_PROMPT_CHARS = 12000
const CIVIL_AI_MAX_SYSTEM_PROMPT_CHARS = 8500
const CIVIL_AI_MAX_TRANSCRIPT_CHARS = 2800
const CIVIL_AI_MAX_MESSAGE_CHARS = 700
const DEFAULT_CIVIL_AI_PROMPT = `Civil AI is a practical Canadian civic assistant inside Civil Citizens.
Help users understand communities, public life, and constructive next steps.
Be concise, grounded, civic-minded, and clear about uncertainty.`

let civilAiDebugTablesReady: Promise<void> | null = null
let civilAiJobTablesReady: Promise<void> | null = null
const civilAiResolvedModelCache = new Map<string, { model: string | null; expiresAt: number }>()

type ExperienceModel = Prisma.ExperienceGetPayload<{
  select: {
    id: true
    title: true
    organization: true
    location: true
    startDate: true
    endDate: true
    current: true
    description: true
    position: true
  }
}>

type CivilAiPromptMessage = { role: 'system' | 'user' | 'assistant'; content: string }
type CivilAiActivePromptMessage = { role: 'user' | 'assistant'; content: string }

type CivilAiRuntimeDeps = {
  civilPublicHost: string
  normalizeSearchTerm: (value: string) => string
  loadViewerAuthContext: (req: FastifyRequest) => Promise<{ actor?: string } | null | undefined>
  resolveUserId: (req: FastifyRequest) => Promise<string | null>
  loadViewerFeedContext: (userId: string) => Promise<CivilAiViewerFeedContext>
  parseCommunityMeta: (value: Prisma.JsonValue | null | undefined) => unknown
  normalizeMediaUrl: (value: string | null) => string | null
  isSelfVerifiedCanadianCitizen: (meta: unknown) => boolean
  isExperienceTableMissing: (error: unknown) => boolean
  sanitizePlainText: (value: string) => string
}

export function getDefaultCivilPublicHost() {
  return process.env.NODE_ENV === 'production' ? 'civilcitizens.ca' : 'dev.civilcitizens.ca'
}

export function readBaseCommunityMeta(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>
  return { ...(value as Record<string, unknown>) } as Record<string, unknown>
}

export function safeJsonStringify(value: unknown) {
  if (value === undefined) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
}

export function parseLoggedJsonText<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function formatCivilAiShortDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

export function createCivilAiCoreHelpers(deps: CivilAiRuntimeDeps) {
  function getCivilPublicBaseUrl() {
    return `https://${deps.civilPublicHost}`.replace(/\/+$/, '')
  }

  function getCivilApiBaseUrl() {
    return `${getCivilPublicBaseUrl()}/api`
  }

  function normalizeCivilAiBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, '')
  }

  function resolveCivilAiServersPath() {
    return (process.env.CIVIL_AI_SERVERS_FILE || '').trim() || resolve(process.cwd(), 'ai_servers.json')
  }

  function resolveCivilAiEnvServerConfig(): CivilAiServerConfig | null {
    const baseUrl = normalizeCivilAiBaseUrl((process.env.CIVIL_AI_BASE_URL || '').trim())
    if (!baseUrl) return null

    return {
      id: (process.env.CIVIL_AI_SERVER_ID || '').trim() || 'civil-ai-env',
      name: (process.env.CIVIL_AI_SERVER_NAME || '').trim() || 'Civil AI Env Server',
      baseUrl,
      provider: (process.env.CIVIL_AI_PROVIDER || '').trim() || 'lm-studio',
      apiKey: CIVIL_AI_API_KEY || null,
      defaultModel: CIVIL_AI_MODEL || null,
      apiVersion: CIVIL_AI_API_VERSION || null,
      enabled: true,
      default: true,
    }
  }

  function resolveCivilAiInstructionsPath() {
    return (process.env.CIVIL_AI_INSTRUCTIONS_FILE || '').trim() || resolve(process.cwd(), 'CIVIL_AI.md')
  }

  function trimCivilAiConversationEntries<T extends { role: 'user' | 'assistant' }>(entries: T[], maxUserTurns = CIVIL_AI_MEMORY_USER_TURN_LIMIT) {
    const next: T[] = []
    let userTurnsSeen = 0

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry) continue
      next.unshift(entry)
      if (entry.role === 'user') {
        userTurnsSeen += 1
        if (userTurnsSeen >= maxUserTurns) break
      }
    }

    return next
  }

  function getCivilAiLatestUserMessage(messages: CivilAiPromptMessage[]) {
    return [...messages].reverse().find((message) => message.role === 'user') ?? null
  }

  function getCivilAiPreviousUserMessage(messages: CivilAiPromptMessage[]) {
    let foundLatest = false
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message) continue
      if (message.role !== 'user') continue
      if (!foundLatest) {
        foundLatest = true
        continue
      }
      return message
    }
    return null
  }

  function isCivilAiContinuationMessage(message: string) {
    const normalized = deps.normalizeSearchTerm(message).toLowerCase()
    if (!normalized) return false

    if (/^(yes|yeah|yep|sure|ok|okay|continue|go on|keep going|try again|broaden|broaden it|widen it|more|another|another one)$/.test(normalized)) {
      return true
    }

    if (/[?]/.test(normalized)) return false

    const tokens = normalized.split(' ').filter(Boolean)
    if (!tokens.length || tokens.length > 4) return false
    if (/^(what|who|when|where|why|how|is|are|do|does|did|can|could|would|should|will|show|find|search|look|tell|explain|summarize|list|help|i want|i need|i am|i'm)/.test(normalized)) {
      return false
    }

    return true
  }

  function selectCivilAiActiveMessages(messages: CivilAiPromptMessage[]): CivilAiActivePromptMessage[] {
    const nonSystemMessages = messages.filter((message): message is CivilAiActivePromptMessage => message.role !== 'system')
    return trimCivilAiConversationEntries(nonSystemMessages, CIVIL_AI_MEMORY_USER_TURN_LIMIT)
  }

  function buildCivilAiEffectiveQuestion(messages: CivilAiPromptMessage[]) {
    const latestUser = getCivilAiLatestUserMessage(messages)
    if (!latestUser) return ''
    if (!isCivilAiContinuationMessage(latestUser.content)) return latestUser.content.trim()

    const previousUser = getCivilAiPreviousUserMessage(messages)
    if (!previousUser) return latestUser.content.trim()

    return `${previousUser.content.trim()} ${latestUser.content.trim()}`.trim()
  }

  function readCivilAiHistory(meta: Prisma.JsonValue | null | undefined): CivilAiHistoryEntry[] {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return []
    const payload = meta as Record<string, unknown>
    const raw = payload.civilAiHistory
    if (!Array.isArray(raw)) return []

    const normalized = raw
      .map<CivilAiHistoryEntry | null>((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const item = entry as Record<string, unknown>
        const role = item.role === 'user' || item.role === 'assistant' ? item.role : null
        const content = typeof item.content === 'string' ? item.content.trim() : ''
        const createdAt = typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
        const references = Array.isArray(item.references)
          ? item.references
              .map((reference) => {
                if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return null
                const candidate = reference as Record<string, unknown>
                const kind =
                  candidate.kind === 'cause' ||
                  candidate.kind === 'community' ||
                  candidate.kind === 'event' ||
                  candidate.kind === 'feature' ||
                  candidate.kind === 'job' ||
                  candidate.kind === 'market' ||
                  candidate.kind === 'organization' ||
                  candidate.kind === 'post' ||
                  candidate.kind === 'topic'
                    ? candidate.kind
                    : null
                const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
                const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
                const href = typeof candidate.href === 'string' ? candidate.href.trim() : ''
                if (!kind || !id || !title || !href) return null
                return {
                  kind,
                  id,
                  title,
                  subtitle: typeof candidate.subtitle === 'string' ? candidate.subtitle : null,
                  summary: typeof candidate.summary === 'string' ? candidate.summary : null,
                  href,
                  imageUrl: typeof candidate.imageUrl === 'string' ? candidate.imageUrl : null,
                  badge: typeof candidate.badge === 'string' ? candidate.badge : null,
                } satisfies CivilAiCardReference
              })
              .filter((reference): reference is CivilAiCardReference => Boolean(reference))
          : undefined
        if (!role || !content) return null
        return references?.length ? { role, content, createdAt, references } : { role, content, createdAt }
      })
      .filter((entry): entry is CivilAiHistoryEntry => Boolean(entry))

    return trimCivilAiConversationEntries(normalized, CIVIL_AI_MEMORY_USER_TURN_LIMIT).slice(-CIVIL_AI_HISTORY_LIMIT)
  }

  async function persistCivilAiHistory(userId: string, appendedEntries: CivilAiHistoryEntry[]) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
    if (!user) return [] as CivilAiHistoryEntry[]

    const baseMeta = readBaseCommunityMeta(user.communityMeta)
    const current = readCivilAiHistory(baseMeta as Prisma.JsonValue)
    const next = trimCivilAiConversationEntries([...current, ...appendedEntries], CIVIL_AI_MEMORY_USER_TURN_LIMIT).slice(-CIVIL_AI_HISTORY_LIMIT)
    baseMeta.civilAiHistory = next

    await prisma.user.update({ where: { id: userId }, data: { communityMeta: baseMeta } })
    return next
  }

  async function loadCivilAiServersConfig() {
    const envServer = resolveCivilAiEnvServerConfig()
    if (envServer) {
      return {
        configPath: 'env:CIVIL_AI_BASE_URL',
        defaultServerId: envServer.id,
        servers: [envServer],
      }
    }

    const configPath = resolveCivilAiServersPath()
    const fallbackServer: CivilAiServerConfig = {
      id: 'local-lm-studio',
      name: 'Local LM Studio',
      baseUrl: 'http://127.0.0.1:1234',
      provider: 'lm-studio',
      apiKey: CIVIL_AI_API_KEY || null,
      defaultModel: CIVIL_AI_MODEL || null,
      apiVersion: CIVIL_AI_API_VERSION || null,
      enabled: true,
      default: true,
    }

    try {
      const raw = await fs.readFile(configPath, 'utf8')
      const parsed = JSON.parse(raw) as { defaultServerId?: string; servers?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      const configuredServers = Array.isArray(parsed) ? parsed : parsed.servers ?? []
      const defaultServerId = Array.isArray(parsed) ? null : parsed.defaultServerId ?? null

      const servers: CivilAiServerConfig[] = []
      for (const entry of configuredServers) {
        const id = typeof entry.id === 'string' ? entry.id.trim() : ''
        const name = typeof entry.name === 'string' ? entry.name.trim() : id
        const baseUrl = typeof entry.baseUrl === 'string' ? normalizeCivilAiBaseUrl(entry.baseUrl) : ''
        if (!id || !name || !baseUrl) continue

        const server: CivilAiServerConfig = {
          id,
          name,
          baseUrl,
          provider: typeof entry.provider === 'string' ? entry.provider.trim() : null,
          apiKey: typeof entry.apiKey === 'string' && entry.apiKey.trim() ? entry.apiKey.trim() : CIVIL_AI_API_KEY || null,
          defaultModel:
            typeof entry.defaultModel === 'string' && entry.defaultModel.trim()
              ? entry.defaultModel.trim()
              : typeof entry.model === 'string' && entry.model.trim()
                ? entry.model.trim()
                : CIVIL_AI_MODEL || null,
          apiVersion:
            typeof entry.apiVersion === 'string' && entry.apiVersion.trim()
              ? entry.apiVersion.trim()
              : CIVIL_AI_API_VERSION || null,
          enabled: entry.enabled !== false,
          default: entry.default === true || defaultServerId === id,
        }
        if (!server.enabled) continue
        servers.push(server)
      }

      if (!servers.length) {
        return { configPath, defaultServerId: fallbackServer.id, servers: [fallbackServer] }
      }

      const resolvedDefaultServerId = defaultServerId || servers.find((server) => server.default)?.id || servers[0]?.id || fallbackServer.id
      return { configPath, defaultServerId: resolvedDefaultServerId, servers }
    } catch {
      return { configPath, defaultServerId: fallbackServer.id, servers: [fallbackServer] }
    }
  }

  async function readCivilAiInstructions() {
    const instructionsPath = resolveCivilAiInstructionsPath()
    try {
      const raw = await fs.readFile(instructionsPath, 'utf8')
      return { instructionsPath, content: raw.trim() || DEFAULT_CIVIL_AI_PROMPT }
    } catch {
      return { instructionsPath, content: DEFAULT_CIVIL_AI_PROMPT }
    }
  }

  function extractCivilAiText(value: unknown): string {
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) {
      return value
        .map((entry) => extractCivilAiText(entry))
        .filter(Boolean)
        .join('\n')
        .trim()
    }
    if (value && typeof value === 'object') {
      const candidate = value as Record<string, unknown>
      if ('text' in candidate) return extractCivilAiText(candidate.text)
      if ('content' in candidate) return extractCivilAiText(candidate.content)
      if ('message' in candidate) return extractCivilAiText(candidate.message)
    }
    return ''
  }

  function extractCivilAiMessageContent(payload: unknown): string {
    if (typeof payload === 'string') return payload.trim()
    if (!payload || typeof payload !== 'object') return ''
    const body = payload as Record<string, unknown>

    if (Array.isArray(body.choices) && body.choices.length > 0) {
      const firstChoice = body.choices[0] as Record<string, unknown>
      const fromChoice = extractCivilAiText(firstChoice?.message ?? firstChoice?.delta ?? firstChoice?.text ?? null)
      if (fromChoice) return fromChoice
    }

    const directContent = extractCivilAiText(body.message ?? body.content ?? body.reply ?? null)
    if (directContent) return directContent

    const responseContent = extractCivilAiText(body.response ?? body.generated_text ?? body.output ?? body.answer ?? null)
    if (responseContent) return responseContent

    return ''
  }

  function truncateCivilAiText(value: string, maxChars: number, keepTail = false) {
    const normalized = value.trim()
    if (normalized.length <= maxChars) return normalized
    if (maxChars <= 32) return normalized.slice(0, maxChars)
    return keepTail ? `[earlier content truncated]\n${normalized.slice(-(maxChars - 28))}` : `${normalized.slice(0, maxChars - 22).trimEnd()}\n[truncated]`
  }

  function truncateCivilAiMessageText(value: string, maxChars: number) {
    const normalized = value.trim()
    if (normalized.length <= maxChars) return normalized
    if (maxChars <= 48) return normalized.slice(0, maxChars)
    const headLength = Math.min(Math.ceil(maxChars * 0.45), maxChars - 24)
    const tailLength = Math.max(0, maxChars - headLength - 19)
    return `${normalized.slice(0, headLength).trimEnd()}\n[truncated]\n${normalized.slice(-tailLength).trimStart()}`
  }

  function buildCivilAiPromptInput(systemPrompt: string, messages: CivilAiPromptMessage[]) {
    const transcriptMessages = selectCivilAiActiveMessages(messages).map(
      (message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${truncateCivilAiMessageText(message.content.trim(), CIVIL_AI_MAX_MESSAGE_CHARS)}`,
    )
    let boundedSystemPrompt = truncateCivilAiText(systemPrompt.trim(), CIVIL_AI_MAX_SYSTEM_PROMPT_CHARS)
    let transcript = truncateCivilAiText(transcriptMessages.join('\n\n'), CIVIL_AI_MAX_TRANSCRIPT_CHARS, true)

    let prompt = ['System Instructions:', boundedSystemPrompt, '', 'Conversation:', transcript, '', 'Assistant:']
      .filter(Boolean)
      .join('\n')

    if (prompt.length > CIVIL_AI_MAX_PROMPT_CHARS) {
      const overflow = prompt.length - CIVIL_AI_MAX_PROMPT_CHARS
      boundedSystemPrompt = truncateCivilAiText(boundedSystemPrompt, Math.max(1200, boundedSystemPrompt.length - overflow))
      prompt = ['System Instructions:', boundedSystemPrompt, '', 'Conversation:', transcript, '', 'Assistant:']
        .filter(Boolean)
        .join('\n')
    }

    if (prompt.length > CIVIL_AI_MAX_PROMPT_CHARS) {
      const overflow = prompt.length - CIVIL_AI_MAX_PROMPT_CHARS
      transcript = truncateCivilAiText(transcript, Math.max(600, transcript.length - overflow), true)
      prompt = ['System Instructions:', boundedSystemPrompt, '', 'Conversation:', transcript, '', 'Assistant:']
        .filter(Boolean)
        .join('\n')
    }

    return prompt
  }

  async function ensureCivilAiDebugTables() {
    if (!civilAiDebugTablesReady) {
      civilAiDebugTablesReady = (async () => {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS civil_ai_conversation (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            user_handle TEXT,
            user_name TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            turn_count INTEGER NOT NULL DEFAULT 0,
            first_user_message TEXT,
            last_user_message TEXT,
            status TEXT,
            last_model TEXT,
            last_server TEXT,
            last_error TEXT
          )
        `)
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS civil_ai_conversation_id_uidx ON civil_ai_conversation (id)`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_conversation_last_activity_idx ON civil_ai_conversation (last_activity_at DESC)`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_conversation_user_id_idx ON civil_ai_conversation (user_id)`)
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS civil_ai_turn (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES civil_ai_conversation(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            latest_user_message TEXT,
            status TEXT NOT NULL,
            duration_ms INTEGER,
            server_name TEXT,
            model TEXT,
            error_message TEXT,
            assistant_content TEXT,
            request_messages_text TEXT,
            viewer_context_text TEXT,
            retrieval_debug_text TEXT,
            references_text TEXT,
            upstream_input_text TEXT,
            raw_response_text TEXT
          )
        `)
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS civil_ai_turn_id_uidx ON civil_ai_turn (id)`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_turn_conversation_idx ON civil_ai_turn (conversation_id, created_at DESC)`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_turn_user_id_idx ON civil_ai_turn (user_id, created_at DESC)`)
      })().catch((error) => {
        civilAiDebugTablesReady = null
        throw error
      })
    }

    await civilAiDebugTablesReady
  }

  async function ensureCivilAiJobTables() {
    if (!civilAiJobTablesReady) {
      civilAiJobTablesReady = (async () => {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS civil_ai_job (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            request_body_text TEXT NOT NULL,
            latest_user_message TEXT,
            response_text TEXT,
            error_text TEXT,
            server_name TEXT,
            model TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_job_status_created_idx ON civil_ai_job (status, created_at DESC)`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_job_user_id_idx ON civil_ai_job (user_id, created_at DESC)`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_ai_job_conversation_idx ON civil_ai_job (conversation_id, created_at DESC)`)
      })().catch((error) => {
        civilAiJobTablesReady = null
        throw error
      })
    }

    await civilAiJobTablesReady
  }

  function serializeCivilAiViewerContext(viewerContext: CivilAiViewerContext | null) {
    if (!viewerContext) return null
    return {
      user: viewerContext.user,
      homeCommunity: viewerContext.homeCommunity,
      nearbyCommunities: viewerContext.nearbyCommunities,
      followedCommunities: viewerContext.followedCommunities,
      organizations: viewerContext.organizations,
      feedContext: {
        viewerId: viewerContext.feedContext.viewerId,
        homeCommunityKey: viewerContext.feedContext.homeCommunityKey,
        friendIds: Array.from(viewerContext.feedContext.friendIds),
        connectionIds: Array.from(viewerContext.feedContext.connectionIds),
        followedBusinessIds: Array.from(viewerContext.feedContext.followedBusinessIds),
        memberBusinessIds: Array.from(viewerContext.feedContext.memberBusinessIds),
        nearbyCommunityKeys: Array.from(viewerContext.feedContext.nearbyCommunityKeys),
        regionalCommunityKeys: Array.from(viewerContext.feedContext.regionalCommunityKeys),
        followedCommunityKeys: Array.from(viewerContext.feedContext.followedCommunityKeys),
      },
    }
  }

  async function persistCivilAiDebugTurn(args: {
    conversationId: string
    userId: string | null
    latestUserMessage: string
    requestMessages: CivilAiPromptMessage[]
    viewerContext: CivilAiViewerContext | null
    retrievalDebug: unknown
    references: CivilAiCardReference[]
    serverName: string | null
    model: string | null
    upstreamInput: string | null
    assistantContent: string | null
    rawResponse: unknown
    status: string
    errorMessage: string | null
    durationMs: number | null
  }) {
    await ensureCivilAiDebugTables()

    const userHandle = args.viewerContext?.user.handle ?? null
    const userName = args.viewerContext?.user.name ?? null
    const now = new Date()

    await prisma.$executeRaw`
      INSERT INTO civil_ai_conversation (
        id, user_id, user_handle, user_name, started_at, last_activity_at, turn_count, first_user_message, last_user_message, status, last_model, last_server, last_error
      )
      VALUES (
        ${args.conversationId}, ${args.userId}, ${userHandle}, ${userName}, ${now}, ${now}, 1, ${args.latestUserMessage || null}, ${args.latestUserMessage || null}, ${args.status}, ${args.model}, ${args.serverName}, ${args.errorMessage}
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id = COALESCE(civil_ai_conversation.user_id, EXCLUDED.user_id),
        user_handle = COALESCE(EXCLUDED.user_handle, civil_ai_conversation.user_handle),
        user_name = COALESCE(EXCLUDED.user_name, civil_ai_conversation.user_name),
        last_activity_at = EXCLUDED.last_activity_at,
        turn_count = civil_ai_conversation.turn_count + 1,
        first_user_message = COALESCE(civil_ai_conversation.first_user_message, EXCLUDED.first_user_message),
        last_user_message = EXCLUDED.last_user_message,
        status = EXCLUDED.status,
        last_model = EXCLUDED.last_model,
        last_server = EXCLUDED.last_server,
        last_error = EXCLUDED.last_error
    `

    await prisma.$executeRaw`
      INSERT INTO civil_ai_turn (
        id, conversation_id, user_id, created_at, latest_user_message, status, duration_ms, server_name, model, error_message, assistant_content,
        request_messages_text, viewer_context_text, retrieval_debug_text, references_text, upstream_input_text, raw_response_text
      )
      VALUES (
        ${randomUUID()}, ${args.conversationId}, ${args.userId}, ${now}, ${args.latestUserMessage || null}, ${args.status}, ${args.durationMs}, ${args.serverName}, ${args.model}, ${args.errorMessage}, ${args.assistantContent},
        ${safeJsonStringify(args.requestMessages)}, ${safeJsonStringify(serializeCivilAiViewerContext(args.viewerContext))}, ${safeJsonStringify(args.retrievalDebug)}, ${safeJsonStringify(args.references)}, ${args.upstreamInput}, ${typeof args.rawResponse === 'string' ? args.rawResponse : safeJsonStringify(args.rawResponse)}
      )
    `
  }

  async function callCivilAiServer(args: {
    server: CivilAiServerConfig
    path: string
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    timeoutMs?: number | null
    signal?: AbortSignal
  }) {
    const headers: Record<string, string> = {}
    if (args.body) {
      headers['content-type'] = 'application/json'
    }
    if (args.server.apiKey) {
      const normalizedProvider = (args.server.provider || '').trim().toLowerCase()
      if (normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')) {
        headers['api-key'] = args.server.apiKey
      } else {
        headers.authorization = args.server.apiKey.startsWith('Bearer ') ? args.server.apiKey : `Bearer ${args.server.apiKey}`
      }
    }

    const timeoutMs = args.timeoutMs === undefined ? CIVIL_AI_SERVER_TIMEOUT_MS : args.timeoutMs
    const controller = new AbortController()
    const onAbort = () => controller.abort(args.signal?.reason)
    const timeout = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
    if (args.signal) {
      if (args.signal.aborted) {
        controller.abort(args.signal.reason)
      } else {
        args.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    let response: Response
    try {
      response = await fetch(`${args.server.baseUrl}${args.path}`, {
        method: args.method ?? (args.body ? 'POST' : 'GET'),
        headers: Object.keys(headers).length ? headers : undefined,
        body: args.body ? JSON.stringify(args.body) : undefined,
        signal: controller.signal,
      })
    } catch (error) {
      if (timeout) clearTimeout(timeout)
      if (args.signal) args.signal.removeEventListener('abort', onAbort)
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? args.signal?.aborted
            ? 'ai_upstream_cancelled'
            : 'ai_upstream_timeout'
          : error instanceof Error
            ? error.message
            : 'ai_upstream_request_failed'
      return { ok: false, status: 504, text: message, json: null }
    }
    if (timeout) clearTimeout(timeout)
    if (args.signal) args.signal.removeEventListener('abort', onAbort)

    const rawText = await response.text()
    let json: unknown = null
    if (rawText) {
      try {
        json = JSON.parse(rawText)
      } catch {
        json = null
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      text: rawText,
      json,
    }
  }

  async function callCivilAiServerWithPathFallback(args: {
    server: CivilAiServerConfig
    paths: string[]
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    timeoutMs?: number | null
    signal?: AbortSignal
  }) {
    let lastResponse: Awaited<ReturnType<typeof callCivilAiServer>> | null = null

    for (const path of args.paths) {
      const response = await callCivilAiServer({
        server: args.server,
        path,
        method: args.method,
        body: args.body,
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      })
      if (response.ok || response.status !== 404) return response
      lastResponse = response
    }

    return lastResponse ?? { ok: false, status: 404, text: 'ai_upstream_not_found', json: null }
  }

  async function resolveCivilAiServer(serverId?: string | null) {
    const config = await loadCivilAiServersConfig()
    const server =
      config.servers.find((entry) => entry.id === serverId) ||
      config.servers.find((entry) => entry.id === config.defaultServerId) ||
      config.servers[0] ||
      null
    return { ...config, server }
  }

  async function resolveCivilAiModel(server: CivilAiServerConfig, preferredModel?: string | null) {
    if (preferredModel?.trim()) return preferredModel.trim()
    if (server.defaultModel?.trim()) return server.defaultModel.trim()

    const cached = civilAiResolvedModelCache.get(server.id)
    if (cached && cached.expiresAt > Date.now()) return cached.model

    const normalizedProvider = (server.provider || '').trim().toLowerCase()
    if (normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')) {
      // Azure v1 model catalogs do not guarantee deployed model names; require an explicit deployment/model.
      civilAiResolvedModelCache.set(server.id, { model: null, expiresAt: Date.now() + 10_000 })
      return null
    }

    const upstream = await callCivilAiServerWithPathFallback({ server, paths: ['/v1/models', '/api/v1/models'], method: 'GET' })
    if (!upstream.ok) {
      civilAiResolvedModelCache.set(server.id, { model: null, expiresAt: Date.now() + 10_000 })
      return null
    }

    const payload = upstream.json as Record<string, unknown> | null
    const rawItems = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(upstream.json)
          ? upstream.json
          : []

    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const model = entry as Record<string, unknown>
      if (model.type && model.type !== 'llm') continue

      const loadedInstances = Array.isArray(model.loaded_instances) ? model.loaded_instances : []
      const loadedInstance = loadedInstances.find((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string') as
        | Record<string, unknown>
        | undefined
      if (typeof loadedInstance?.id === 'string' && loadedInstance.id.trim()) {
        const selectedModel = loadedInstance.id.trim()
        civilAiResolvedModelCache.set(server.id, { model: selectedModel, expiresAt: Date.now() + CIVIL_AI_MODEL_CACHE_TTL_MS })
        return selectedModel
      }

      if (typeof model.selected_variant === 'string' && model.selected_variant.trim()) {
        const selectedModel = model.selected_variant.trim()
        civilAiResolvedModelCache.set(server.id, { model: selectedModel, expiresAt: Date.now() + CIVIL_AI_MODEL_CACHE_TTL_MS })
        return selectedModel
      }
      if (typeof model.id === 'string' && model.id.trim()) {
        const selectedModel = model.id.trim()
        civilAiResolvedModelCache.set(server.id, { model: selectedModel, expiresAt: Date.now() + CIVIL_AI_MODEL_CACHE_TTL_MS })
        return selectedModel
      }
      if (typeof model.key === 'string' && model.key.trim()) {
        const selectedModel = model.key.trim()
        civilAiResolvedModelCache.set(server.id, { model: selectedModel, expiresAt: Date.now() + CIVIL_AI_MODEL_CACHE_TTL_MS })
        return selectedModel
      }
    }

    civilAiResolvedModelCache.set(server.id, { model: null, expiresAt: Date.now() + 10_000 })
    return null
  }

  function buildCivilCommunityHref(provinceCode: string, communitySlug: string) {
    return `${getCivilPublicBaseUrl()}/${provinceCode.toLowerCase()}/${communitySlug.toLowerCase()}`
  }

  function buildCivilOrganizationHref(args: { provinceCode: string | null; communitySlug: string | null; slug: string }) {
    if (!args.provinceCode || !args.communitySlug) return null
    return `${getCivilPublicBaseUrl()}/com/${args.provinceCode.toLowerCase()}/${args.communitySlug.toLowerCase()}/orgs/${args.slug}`
  }

  function buildCivilEventHref(args: { organizationId: string; eventId: string; provinceCode: string | null; communitySlug: string | null; slug: string }) {
    if (args.provinceCode && args.communitySlug) {
      return `${getCivilPublicBaseUrl()}/com/${args.provinceCode.toLowerCase()}/${args.communitySlug.toLowerCase()}/orgs/${args.slug}/events/${args.eventId}`
    }
    return `${getCivilPublicBaseUrl()}/events/${args.organizationId}/${args.eventId}`
  }

  function buildCivilJobHref(args: { jobId: string; provinceCode: string | null; communitySlug: string | null; slug: string }) {
    if (!args.provinceCode || !args.communitySlug) return null
    return `${getCivilPublicBaseUrl()}/com/${args.provinceCode.toLowerCase()}/${args.communitySlug.toLowerCase()}/orgs/${args.slug}/jobs/${args.jobId}`
  }

  function buildCivilPostHref(path: string | null) {
    if (!path) return null
    if (/^https?:\/\//i.test(path)) return path
    return `${getCivilPublicBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  }

  function parseCivilAiCommunityId(value: string) {
    const trimmed = value.trim()
    const [provinceCode, communitySlug] = trimmed.split(':')
    if (!provinceCode || !communitySlug) return null
    const normalizedProvince = normalizeProvinceCode(provinceCode)
    if (!normalizedProvince) return null
    const community = findCommunity(normalizedProvince, communitySlug.trim().toLowerCase())
    if (!community) return null
    return {
      id: `${community.province}:${community.slug}`,
      provinceCode: community.province,
      communitySlug: community.slug,
      communityName: community.name ?? community.slug,
      provinceName: getProvinceDisplayName(community.province as never) ?? community.province.toUpperCase(),
      href: buildCivilCommunityHref(community.province, community.slug),
    }
  }

  async function authorizeCivilAiDataRequest(req: FastifyRequest) {
    const authContext = await deps.loadViewerAuthContext(req)
    if (authContext?.actor === 'family_member') {
      return { error: 'family_mode_not_available' as const }
    }

    const userId = await deps.resolveUserId(req)
    if (userId) return { userId }

    const providedKey = typeof req.headers['x-civil-ai-key'] === 'string' ? req.headers['x-civil-ai-key'].trim() : ''
    if (CIVIL_AI_DATA_KEY && providedKey === CIVIL_AI_DATA_KEY) return { userId: null }
    return null
  }

  async function loadCivilAiViewerContext(userId: string): Promise<CivilAiViewerContext | null> {
    const [user, follows, businessFollows, memberships, ownedOrganizations, feedContext] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          handle: true,
          name: true,
          bio: true,
          avatarUrl: true,
          coverUrl: true,
          premiumStatus: true,
          communityMeta: true,
        },
      }),
      prisma.communityFollow.findMany({
        where: { userId },
        orderBy: [{ home: 'desc' }, { createdAt: 'asc' }],
        take: 30,
        select: { provinceCode: true, communitySlug: true, home: true },
      }),
      prisma.businessFollow.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 30,
        select: {
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
              logoUrl: true,
              coverUrl: true,
            },
          },
        },
      }),
      prisma.businessMembership.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 30,
        select: {
          role: true,
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
              logoUrl: true,
              coverUrl: true,
            },
          },
        },
      }),
      prisma.business.findMany({
        where: { ownerId: userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 30,
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          logoUrl: true,
          coverUrl: true,
        },
      }),
      deps.loadViewerFeedContext(userId),
    ])

    if (!user) return null

    let experienceItems: CivilAiViewerContext['user']['experiences'] = []
    try {
      const experiences = await prisma.experience.findMany({
        where: { userId },
        orderBy: [{ position: 'asc' }, { startDate: 'desc' }],
      })

      const normalizedExperienceOrganizationNames = Array.from(
        new Set(
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
          href: string | null
          logoUrl: string | null
          coverUrl: string | null
        }
      >()

      if (normalizedExperienceOrganizationNames.length > 0) {
        const linkedOrganizations = await prisma.business.findMany({
          where: {
            status: 'ACTIVE',
            moderationStatus: ModerationStatus.VISIBLE,
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
          const key = org.name.trim().toLowerCase()
          if (!key || organizationByName.has(key)) continue
          organizationByName.set(key, {
            id: org.id,
            name: org.name,
            slug: org.slug,
            href: buildCivilOrganizationHref({ provinceCode: org.provinceCode, communitySlug: org.communitySlug, slug: org.slug }),
            logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
          })
        }
      }

      experienceItems = experiences.map((exp: ExperienceModel) => ({
        id: exp.id,
        title: exp.title,
        organization: exp.organization,
        location: exp.location ?? null,
        startDate: exp.startDate.toISOString(),
        endDate: exp.endDate ? exp.endDate.toISOString() : null,
        current: exp.current,
        description: exp.description ?? null,
        organizationProfile: organizationByName.get(exp.organization.trim().toLowerCase()) ?? null,
      }))
    } catch (err) {
      if (!deps.isExperienceTableMissing(err)) throw err
    }

    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] ?? null
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null

    const typedFollows = follows as Array<{ provinceCode: string; communitySlug: string; home: boolean }>
    const homeFollow = typedFollows.find((entry) => entry.home) ?? typedFollows[0] ?? null
    const homeCommunity = homeFollow ? parseCivilAiCommunityId(`${homeFollow.provinceCode}:${homeFollow.communitySlug}`) : null

    const communityMeta = deps.parseCommunityMeta(user.communityMeta ?? null) as { nearbyCommunities?: Array<{ provinceCode: string; communitySlug: string }> } | null
    const nearbyCommunities = (communityMeta?.nearbyCommunities ?? [])
      .map((entry) => parseCivilAiCommunityId(`${entry.provinceCode}:${entry.communitySlug}`))
      .filter((entry): entry is NonNullable<typeof homeCommunity> => Boolean(entry))
      .slice(0, 8)

    const followedCommunities = typedFollows
      .map((follow) => {
        const parsed = parseCivilAiCommunityId(`${follow.provinceCode}:${follow.communitySlug}`)
        if (!parsed) return null
        return { ...parsed, isHome: Boolean(follow.home) }
      })
      .filter(
        (entry): entry is {
          id: string
          provinceCode: string
          provinceName: string
          communitySlug: string
          communityName: string
          href: string
          isHome: boolean
        } => Boolean(entry),
      )

    const organizationsMap = new Map<string, CivilAiViewerContext['organizations'][number]>()
    for (const org of ownedOrganizations) {
      organizationsMap.set(org.id, {
        id: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        role: 'owner',
        href: buildCivilOrganizationHref({ provinceCode: org.provinceCode, communitySlug: org.communitySlug, slug: org.slug }),
        logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
      })
    }
    for (const row of memberships) {
      if (!row.business || organizationsMap.has(row.business.id)) continue
      organizationsMap.set(row.business.id, {
        id: row.business.id,
        name: row.business.name,
        slug: row.business.slug,
        provinceCode: row.business.provinceCode,
        communitySlug: row.business.communitySlug,
        role: 'member',
        href: buildCivilOrganizationHref({ provinceCode: row.business.provinceCode, communitySlug: row.business.communitySlug, slug: row.business.slug }),
        logoUrl: deps.normalizeMediaUrl(row.business.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(row.business.coverUrl ?? null),
      })
    }
    for (const row of businessFollows) {
      if (!row.business || organizationsMap.has(row.business.id)) continue
      organizationsMap.set(row.business.id, {
        id: row.business.id,
        name: row.business.name,
        slug: row.business.slug,
        provinceCode: row.business.provinceCode,
        communitySlug: row.business.communitySlug,
        role: 'followed',
        href: buildCivilOrganizationHref({ provinceCode: row.business.provinceCode, communitySlug: row.business.communitySlug, slug: row.business.slug }),
        logoUrl: deps.normalizeMediaUrl(row.business.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(row.business.coverUrl ?? null),
      })
    }

    return {
      user: {
        id: user.id,
        handle: user.handle,
        firstName,
        lastName,
        name: user.name,
        bio: user.bio ? deps.sanitizePlainText(user.bio) : null,
        avatarUrl: deps.normalizeMediaUrl(user.avatarUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(user.coverUrl ?? null),
        isVerified: deps.isSelfVerifiedCanadianCitizen(deps.parseCommunityMeta(user.communityMeta ?? null)),
        isPremium: Boolean(user.premiumStatus),
        experiences: experienceItems,
      },
      homeCommunity,
      nearbyCommunities,
      followedCommunities,
      organizations: Array.from(organizationsMap.values()).slice(0, 12),
      feedContext,
    }
  }

  return {
    authorizeCivilAiDataRequest,
    buildCivilAiEffectiveQuestion,
    buildCivilAiPromptInput,
    buildCivilCommunityHref,
    buildCivilEventHref,
    buildCivilJobHref,
    buildCivilOrganizationHref,
    buildCivilPostHref,
    callCivilAiServer,
    callCivilAiServerWithPathFallback,
    ensureCivilAiDebugTables,
    ensureCivilAiJobTables,
    extractCivilAiMessageContent,
    getCivilApiBaseUrl,
    getCivilPublicBaseUrl,
    loadCivilAiServersConfig,
    loadCivilAiViewerContext,
    parseCivilAiCommunityId,
    persistCivilAiDebugTurn,
    persistCivilAiHistory,
    readCivilAiHistory,
    readCivilAiInstructions,
    resolveCivilAiModel,
    resolveCivilAiServer,
    truncateCivilAiText,
  }
}
