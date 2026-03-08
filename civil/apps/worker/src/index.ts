import { Worker, QueueEvents, Job } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import pino from 'pino'
import { prisma } from '@civil/db'
import type { MediaCategory } from '@civil/db'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const MEDIA_S3_ENDPOINT = process.env.MEDIA_S3_ENDPOINT || 'http://127.0.0.1:9000'
const MEDIA_S3_REGION = process.env.MEDIA_S3_REGION || 'us-east-1'
const MEDIA_S3_ACCESS_KEY = process.env.MEDIA_S3_ACCESS_KEY || 'minioadmin'
const MEDIA_S3_SECRET_KEY = process.env.MEDIA_S3_SECRET_KEY || 'minioadmin'
const MEDIA_BUCKET_PUBLIC = process.env.MEDIA_BUCKET_PUBLIC || 'civil-media'
const MEDIA_BUCKET_ORIGINAL = process.env.MEDIA_BUCKET_ORIGINAL || 'civil-media-raw'
const CIVIL_PUBLIC_HOST = process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca'
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || `https://${CIVIL_PUBLIC_HOST}/media`).replace(/\/$/, '')
const CIVIL_AI_VISION_MODEL = (process.env.CIVIL_AI_VISION_MODEL || '').trim()
const REDDIT_EPOCH_SECONDS = 1134028003
const REACTION_HOT_WINDOW_HOURS = 48

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const connection = new IORedis(REDIS_URL)
const workerConnectionOptions = { connection: { url: REDIS_URL } }

const s3Client = new S3Client({
  region: MEDIA_S3_REGION,
  endpoint: MEDIA_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: MEDIA_S3_ACCESS_KEY,
    secretAccessKey: MEDIA_S3_SECRET_KEY,
  },
})

type FanoutJob = Job<Record<string, unknown>>
const fanoutWorker = new Worker<FanoutJob>(
  'fanout',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'fanout placeholder job received')
  },
  workerConnectionOptions,
)

const fanoutEvents = new QueueEvents('fanout', workerConnectionOptions)
fanoutEvents.on('completed', ({ jobId }) => logger.info({ jobId }, 'fanout job completed'))
fanoutEvents.on('failed', ({ jobId, failedReason }) => logger.error({ jobId, failedReason }, 'fanout job failed'))

type MediaJobPayload = { assetId: string }

const mediaWorker = new Worker<MediaJobPayload>('media', async (job) => processMediaJob(job), {
  ...workerConnectionOptions,
  concurrency: 2,
})

const mediaEvents = new QueueEvents('media', workerConnectionOptions)
mediaEvents.on('completed', ({ jobId }) => logger.info({ jobId }, 'media job completed'))
mediaEvents.on('failed', ({ jobId, failedReason }) => logger.error({ jobId, failedReason }, 'media job failed'))

type ContentAiScanJobPayload = { targetType: 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization'; targetId: string }

const contentAiScanWorker = new Worker<ContentAiScanJobPayload>('content-ai-scan', async (job) => processContentAiScanJob(job), {
  ...workerConnectionOptions,
  concurrency: 1,
})

const contentAiScanEvents = new QueueEvents('content-ai-scan', workerConnectionOptions)
contentAiScanEvents.on('completed', ({ jobId }) => logger.info({ jobId }, 'content ai scan job completed'))
contentAiScanEvents.on('failed', ({ jobId, failedReason }) => logger.error({ jobId, failedReason }, 'content ai scan job failed'))

type SharpFit = keyof sharp.FitEnum
type VariantOptions = { width?: number; height?: number; fit?: SharpFit; quality?: number }
type VariantPreset = VariantOptions & { name: string }

const VARIANT_PRESETS: Record<MediaCategory, VariantPreset[]> = {
  avatar: [
    { name: 'avatar@2x', width: 512, height: 512, fit: 'cover', quality: 90 },
    { name: 'avatar@1x', width: 256, height: 256, fit: 'cover', quality: 90 },
    { name: 'avatar-thumb', width: 96, height: 96, fit: 'cover', quality: 90 },
  ],
  cover: [
    { name: 'cover-xl', width: 1920, height: 640, fit: 'cover', quality: 85 },
    { name: 'cover-lg', width: 1280, height: 480, fit: 'cover', quality: 85 },
    { name: 'cover-md', width: 960, height: 360, fit: 'cover', quality: 85 },
  ],
  business_logo: [
    { name: 'logo@2x', width: 512, height: 512, fit: 'cover', quality: 90 },
    { name: 'logo@1x', width: 256, height: 256, fit: 'cover', quality: 90 },
    { name: 'logo-thumb', width: 96, height: 96, fit: 'cover', quality: 90 },
  ],
  business_cover: [
    { name: 'cover-xl', width: 1920, height: 640, fit: 'cover', quality: 85 },
    { name: 'cover-lg', width: 1280, height: 480, fit: 'cover', quality: 85 },
    { name: 'cover-md', width: 960, height: 360, fit: 'cover', quality: 85 },
  ],
  post_image: [
    { name: 'post-xl', width: 1600, fit: 'inside', quality: 88 },
    { name: 'post-lg', width: 1200, fit: 'inside', quality: 88 },
    { name: 'post-md', width: 900, fit: 'inside', quality: 88 },
  ],
  attachment: [
    { name: 'attachment-lg', width: 1400, fit: 'inside', quality: 88 },
    { name: 'attachment-md', width: 900, fit: 'inside', quality: 88 },
  ],
}

const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable'

let contentAiScanTablesReady: Promise<void> | null = null

type CivilAiServerConfig = {
  id: string
  name: string
  baseUrl: string
  provider: string | null
  enabled: boolean
  default: boolean
}

type ContentAiScanRecord = {
  id: string
  target_type: 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization'
  target_id: string
  source_text: string | null
  image_urls: unknown
}

type OrganizationEventDefinition = {
  id: string
  status?: 'DRAFT' | 'PUBLISHED' | 'QUARANTINED'
  updatedAt?: string
}

type OrganizationSystemState = {
  version: 1
  events: OrganizationEventDefinition[]
}

function resolveCivilAiServersPath() {
  return (process.env.CIVIL_AI_SERVERS_FILE || '').trim() || resolve(process.cwd(), 'ai_servers.json')
}

function normalizeCivilAiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

async function loadCivilAiServerConfig() {
  const configPath = resolveCivilAiServersPath()
  const fallback: CivilAiServerConfig = {
    id: 'local-lm-studio',
    name: 'Local LM Studio',
    baseUrl: 'http://127.0.0.1:1234',
    provider: 'lm-studio',
    enabled: true,
    default: true,
  }

  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as { defaultServerId?: unknown; servers?: Array<Record<string, unknown>> }
    const configuredServers = Array.isArray(parsed.servers) ? parsed.servers : []
    const defaultServerId = typeof parsed.defaultServerId === 'string' ? parsed.defaultServerId.trim() : ''
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
        enabled: entry.enabled !== false,
        default: entry.default === true || defaultServerId === id,
      }
      if (server.enabled) servers.push(server)
    }
    return servers.find((entry) => entry.default) || servers[0] || fallback
  } catch {
    return fallback
  }
}

async function ensureContentAiScanTables() {
  if (!contentAiScanTablesReady) {
    contentAiScanTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS content_ai_scan (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          owner_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          source_text TEXT,
          image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'queued',
          moderation_state TEXT,
          label_summary TEXT,
          search_text TEXT,
          labels JSONB NOT NULL DEFAULT '[]'::jsonb,
          moderation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
          confidence_score DOUBLE PRECISION,
          server_id TEXT,
          model TEXT,
          error_text TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          raw_response JSONB
        )
      `)
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS content_ai_scan_target_idx
        ON content_ai_scan (target_type, target_id)
      `)
    })().catch((error) => {
      contentAiScanTablesReady = null
      throw error
    })
  }

  await contentAiScanTablesReady
}

function readStringList(raw: unknown) {
  if (!Array.isArray(raw)) return [] as string[]
  return raw.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
}

function normalizeSearchText(...parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractChatCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const body = payload as Record<string, unknown>
  const choices = Array.isArray(body.choices) ? body.choices : []
  const firstChoice = choices[0] as Record<string, unknown> | undefined
  const message = firstChoice?.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return ''
        const text = (entry as Record<string, unknown>).text
        return typeof text === 'string' ? text.trim() : ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1] ?? text
  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function resolveVisionModel(server: CivilAiServerConfig) {
  if (CIVIL_AI_VISION_MODEL) return CIVIL_AI_VISION_MODEL
  try {
    const response = await fetch(`${server.baseUrl}/v1/models`)
    if (!response.ok) return null
    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const models = Array.isArray(payload.data) ? payload.data : []
    const firstId = models.find((entry) => typeof entry.id === 'string' && entry.id.trim())?.id
    return typeof firstId === 'string' ? firstId.trim() : null
  } catch {
    return null
  }
}

async function analyzeImagesWithVision(args: { server: CivilAiServerConfig; model: string; imageUrls: string[]; sourceText: string | null }) {
  const prompt = [
    'Return JSON only.',
    'Analyze this user-generated content for moderation and searchable tags.',
    'Schema:',
    '{',
    '  "summary": string,',
    '  "detectedItems": string[],',
    '  "moderationFlags": string[],',
    '  "confidence": number,',
    '  "safeToShow": boolean',
    '}',
    'Allowed moderation flags: sexual_or_explicit, graphic_violence, hate_symbol, offensive_gesture, weapon, drugs.',
    args.sourceText ? `User text context: ${args.sourceText}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const body = {
    model: args.model,
    temperature: 0.1,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...args.imageUrls.slice(0, 4).map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  }

  const response = await fetch(`${args.server.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const rawText = await response.text()
  let json: unknown = null
  if (rawText) {
    try {
      json = JSON.parse(rawText)
    } catch {
      json = null
    }
  }

  if (!response.ok) {
    throw new Error(rawText || `vision_request_failed_${response.status}`)
  }

  const text = extractChatCompletionText(json)
  const parsed = extractJsonObject(text)
  if (!parsed) {
    throw new Error('vision_invalid_json_response')
  }

  return { parsed, raw: json ?? rawText }
}

function readOrganizationSystemState(metadata: unknown): OrganizationSystemState {
  const fallback: OrganizationSystemState = { version: 1, events: [] }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fallback
  const root = metadata as Record<string, unknown>
  const raw = root.orgSystem
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const typed = raw as Record<string, unknown>
  const events = Array.isArray(typed.events)
    ? typed.events.filter((event): event is OrganizationEventDefinition => Boolean(event && typeof event === 'object' && typeof (event as Record<string, unknown>).id === 'string'))
    : []
  return { version: 1, events }
}

function mergeOrganizationSystemStateIntoMetadata(metadata: unknown, system: OrganizationSystemState) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  base.orgSystem = { ...(base.orgSystem && typeof base.orgSystem === 'object' && !Array.isArray(base.orgSystem) ? (base.orgSystem as Record<string, unknown>) : {}), ...system }
  return base
}

function parseOrganizationEventScanTargetId(targetId: string) {
  const separatorIndex = targetId.indexOf(':')
  if (separatorIndex <= 0) return null
  const orgId = targetId.slice(0, separatorIndex).trim()
  const eventId = targetId.slice(separatorIndex + 1).trim()
  if (!orgId || !eventId) return null
  return { orgId, eventId }
}

async function markContentAiScanFailed(targetType: 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization', targetId: string, errorText: string) {
  await prisma.$executeRaw`
    UPDATE content_ai_scan
    SET status = ${'failed'},
        error_text = ${errorText.slice(0, 500)},
        completed_at = NOW(),
        updated_at = NOW()
    WHERE target_type = ${targetType}
      AND target_id = ${targetId}
  `
}

function calculateHotScore(args: { recentPositive: number; commentCount: number; commentScore: number; createdAt: Date; lastActivityAt: Date }) {
  const discussionWeight = Math.min(args.commentCount, 50)
  const commentScoreWeight = Math.max(Math.min(args.commentScore / 4, 75), -75)
  const interactionScore = args.recentPositive + discussionWeight + commentScoreWeight
  const order = Math.log10(Math.max(Math.abs(interactionScore), 1))
  const baseTime = Math.max(args.createdAt.getTime(), args.lastActivityAt.getTime())
  const seconds = baseTime / 1000 - REDDIT_EPOCH_SECONDS
  return Number((seconds + order).toFixed(6))
}

async function refreshVisibleCommentCountForPost(postId: string) {
  const reactionWindowStart = new Date(Date.now() - REACTION_HOT_WINDOW_HOURS * 60 * 60 * 1000)

  const [post, recentPositive, commentCount, commentScoreResult] = await Promise.all([
    prisma.post.findUnique({
      where: { id: postId },
      select: { createdAt: true, lastActivityAt: true },
    }),
    prisma.postReaction.count({
      where: {
        postId,
        createdAt: { gte: reactionWindowStart },
      },
    }),
    prisma.comment.count({ where: { postId, moderationStatus: 'VISIBLE' } }),
    prisma.comment.aggregate({ where: { postId, moderationStatus: 'VISIBLE' }, _sum: { score: true } }),
  ])

  if (!post) return

  const commentScore = commentScoreResult?._sum?.score ?? 0
  const hotScore = calculateHotScore({
    recentPositive,
    commentCount,
    commentScore,
    createdAt: post.createdAt,
    lastActivityAt: post.lastActivityAt,
  })

  await prisma.post.updateMany({
    where: { id: postId },
    data: { commentCount, hotScore, recentPositive },
  })
}

async function applyScanModeration(targetType: 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization', targetId: string, moderationState: string) {
  if (moderationState !== 'quarantined') return

  if (targetType === 'post') {
    await prisma.post.updateMany({ where: { id: targetId }, data: { moderationStatus: 'QUARANTINED' } })
    return
  }

  if (targetType === 'comment') {
    const existing = await prisma.comment.findUnique({
      where: { id: targetId },
      select: { id: true, postId: true },
    })
    if (!existing) return

    await prisma.comment.updateMany({
      where: { id: targetId },
      data: { moderationStatus: 'QUARANTINED' },
    })

    await refreshVisibleCommentCountForPost(existing.postId)
    return
  }

  if (targetType === 'market_product') {
    await prisma.$executeRaw`
      UPDATE organization_shop_product
      SET moderation_status = ${'quarantined'},
          is_draft = TRUE,
          updated_at = NOW()
      WHERE id = ${targetId}
    `
    return
  }

  if (targetType === 'organization_event') {
    const parsed = parseOrganizationEventScanTargetId(targetId)
    if (!parsed) return

    const org = await prisma.business.findUnique({ where: { id: parsed.orgId }, select: { id: true, metadata: true } })
    if (!org) return

    const system = readOrganizationSystemState(org.metadata)
    const eventIndex = system.events.findIndex((event) => event.id === parsed.eventId)
    if (eventIndex < 0) return

    const nextEvents = [...system.events]
    const previous = nextEvents[eventIndex]
    if (!previous) return
    nextEvents[eventIndex] = {
      ...previous,
      status: 'QUARANTINED',
      updatedAt: new Date().toISOString(),
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, { ...system, events: nextEvents }) as any },
    })
    return
  }

  if (targetType === 'organization') {
    await prisma.business.updateMany({
      where: { id: targetId },
      data: {
        moderationStatus: 'QUARANTINED',
        updatedAt: new Date(),
      },
    })
    return
  }

  await prisma.$executeRaw`
    UPDATE citizen_market_listing
    SET moderation_status = ${'quarantined'},
        is_draft = TRUE,
        updated_at = NOW()
    WHERE id = ${targetId}
  `
}

async function processContentAiScanJob(job: Job<ContentAiScanJobPayload>) {
  await ensureContentAiScanTables()

  const scanRows = await prisma.$queryRaw<ContentAiScanRecord[]>`
    SELECT id, target_type, target_id, source_text, image_urls
    FROM content_ai_scan
    WHERE target_type = ${job.data.targetType}
      AND target_id = ${job.data.targetId}
    LIMIT 1
  `

  const scan = scanRows[0]
  if (!scan) {
    logger.warn({ jobId: job.id, targetType: job.data.targetType, targetId: job.data.targetId }, 'content ai scan record missing')
    return
  }

  const imageUrls = readStringList(scan.image_urls)
  if (!imageUrls.length && !scan.source_text?.trim()) {
    await prisma.$executeRaw`
      UPDATE content_ai_scan
      SET status = ${'skipped'},
          moderation_state = ${'no_content'},
          error_text = ${'no_images_or_text_available'},
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${scan.id}
    `
    return
  }

  await prisma.$executeRaw`
    UPDATE content_ai_scan
    SET status = ${'processing'},
        attempts = attempts + 1,
        started_at = NOW(),
        error_text = NULL,
        updated_at = NOW()
    WHERE id = ${scan.id}
  `

  const server = await loadCivilAiServerConfig()
  const model = await resolveVisionModel(server)
  if (!model) {
    await markContentAiScanFailed(scan.target_type, scan.target_id, 'vision_model_unavailable')
    return
  }

  try {
    const analysis = await analyzeImagesWithVision({
      server,
      model,
      imageUrls,
      sourceText: scan.source_text,
    })

    const summary = typeof analysis.parsed.summary === 'string' ? analysis.parsed.summary.trim().slice(0, 240) : null
    const detectedItems = readStringList(analysis.parsed.detectedItems)
    const moderationFlags = readStringList(analysis.parsed.moderationFlags)
    const confidenceRaw = Number(analysis.parsed.confidence ?? 0)
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0
    const safeToShow = analysis.parsed.safeToShow === true
    const moderationState = moderationFlags.length
      ? confidence >= 0.7 || !safeToShow
        ? 'quarantined'
        : 'review'
      : 'safe'
    const searchText = normalizeSearchText(scan.source_text, summary, detectedItems.join(' ')) || null

    await prisma.$executeRaw`
      UPDATE content_ai_scan
      SET status = ${'completed'},
          moderation_state = ${moderationState},
          label_summary = ${summary},
          search_text = ${searchText},
          labels = ${JSON.stringify(detectedItems)}::jsonb,
          moderation_flags = ${JSON.stringify(moderationFlags)}::jsonb,
          confidence_score = ${confidence},
          server_id = ${server.id},
          model = ${model},
          error_text = NULL,
          completed_at = NOW(),
          updated_at = NOW(),
          raw_response = ${JSON.stringify(analysis.raw)}::jsonb
      WHERE id = ${scan.id}
    `

    await applyScanModeration(scan.target_type, scan.target_id, moderationState)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'vision_scan_failed'
    await markContentAiScanFailed(scan.target_type, scan.target_id, message)
    throw error
  }
}

async function processMediaJob(job: Job<MediaJobPayload>) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: job.data.assetId } })
  if (!asset) {
    logger.warn({ assetId: job.data.assetId }, 'media asset missing')
    return
  }

  if (asset.status === 'ready') {
    logger.info({ assetId: asset.id }, 'media asset already processed')
    return
  }

  try {
    const originalBuffer = await downloadOriginal(asset.originalKey)
    const baseMetadata = await sharp(originalBuffer).metadata()
    const variants = await renderVariants(asset.category, originalBuffer)

    const variantEntries: Record<string, { key: string; url: string; width?: number; height?: number; contentType: string }> = {}
    for (const variant of variants) {
      const key = buildVariantKey(asset.category, asset.ownerId, asset.id, variant.name)
      await uploadVariant(key, variant.buffer, variant.contentType)
      variantEntries[variant.name] = {
        key,
        url: buildPublicUrl(key),
        width: variant.width,
        height: variant.height,
        contentType: variant.contentType,
      }
    }

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        width: asset.width ?? baseMetadata.width ?? null,
        height: asset.height ?? baseMetadata.height ?? null,
        variants: variantEntries,
        status: 'ready',
        readyAt: new Date(),
        failureReason: null,
      },
    })

    await updateUserMediaReferences(asset.category, asset.id, asset.ownerId, variantEntries)
    logger.info({ assetId: asset.id }, 'media asset processed')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    await prisma.mediaAsset.update({
      where: { id: job.data.assetId },
      data: {
        status: 'failed',
        failureReason: message.slice(0, 500),
      },
    })
    logger.error({ assetId: job.data.assetId, err: error }, 'failed processing media asset')
    throw error
  }
}

async function downloadOriginal(key: string) {
  const command = new GetObjectCommand({ Bucket: MEDIA_BUCKET_ORIGINAL, Key: key })
  const response = await s3Client.send(command)
  const stream = response.Body
  if (!stream) throw new Error('missing_original_body')
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function renderVariants(category: MediaCategory, buffer: Buffer) {
  const presets = VARIANT_PRESETS[category] ?? []
  if (!presets.length) {
    return [await renderSingleVariant('original', buffer, { quality: 90 })]
  }
  const results = []
  for (const preset of presets) {
    results.push(await renderSingleVariant(preset.name, buffer, preset))
  }
  return results
}

async function renderSingleVariant(name: string, buffer: Buffer, preset: VariantOptions) {
  const image = sharp(buffer, { failOn: 'none' }).rotate()
  if (preset.width || preset.height) {
    image.resize({
      width: preset.width,
      height: preset.height,
      fit: preset.fit ?? 'inside',
      position: preset.fit === 'cover' ? 'attention' : undefined,
      withoutEnlargement: preset.fit !== 'cover',
    })
  }
  const { data, info } = await image.toFormat('webp', { quality: preset.quality ?? 90, effort: 4 }).toBuffer({ resolveWithObject: true })
  return {
    name,
    buffer: data,
    width: info.width,
    height: info.height,
    contentType: 'image/webp',
  }
}

async function uploadVariant(key: string, body: Buffer, contentType: string) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: MEDIA_BUCKET_PUBLIC,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: PUBLIC_CACHE_CONTROL,
    }),
  )
}

async function updateUserMediaReferences(
  category: MediaCategory,
  assetId: string,
  ownerId: string,
  variants: Record<string, { url: string }>,
) {
  if (category === 'avatar') {
    const url = variants['avatar@2x']?.url || variants['avatar@1x']?.url || variants['avatar-thumb']?.url
    if (url) {
      await prisma.user.updateMany({ where: { id: ownerId, avatarMediaId: assetId }, data: { avatarUrl: url } })
    }
  } else if (category === 'cover') {
    const url = variants['cover-xl']?.url || variants['cover-lg']?.url || variants['cover-md']?.url
    if (url) {
      await prisma.user.updateMany({ where: { id: ownerId, coverMediaId: assetId }, data: { coverUrl: url } })
    }
  } else if (category === 'business_logo') {
    const url = variants['logo@2x']?.url || variants['logo@1x']?.url || variants['logo-thumb']?.url
    if (url) {
      await prisma.business.updateMany({ where: { logoMediaId: assetId }, data: { logoUrl: url } })
    }
  } else if (category === 'business_cover') {
    const url = variants['cover-xl']?.url || variants['cover-lg']?.url || variants['cover-md']?.url
    if (url) {
      await prisma.business.updateMany({ where: { coverMediaId: assetId }, data: { coverUrl: url } })
    }
  }
}

function buildVariantKey(category: MediaCategory, ownerId: string, assetId: string, variantName: string) {
  return `processed/${category}/${ownerId}/${assetId}/${variantName}.webp`
}

function buildPublicUrl(key: string) {
  return `${MEDIA_PUBLIC_BASE_URL}/${key}`
}

process.on('SIGINT', async () => {
  await Promise.all([
    fanoutWorker.close(),
    fanoutEvents.close(),
    mediaWorker.close(),
    mediaEvents.close(),
    contentAiScanWorker.close(),
    contentAiScanEvents.close(),
  ])
  await connection.quit()
  process.exit(0)
})
