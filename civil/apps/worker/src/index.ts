import { Worker, QueueEvents, Job } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import sharp from 'sharp'
import pino from 'pino'
import { prisma } from '@civil/db'
import type { MediaCategory } from '@civil/db'
import { MediaTranscodeJobKind, MediaTranscodeJobStatus, PoliticianScrapeJobSource, PoliticianScrapeJobStatus, Prisma } from '@prisma/client'
import { XMLParser } from 'fast-xml-parser'
import { chromium, type Browser } from 'playwright'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
const CIVIL_AI_API_KEY = (process.env.CIVIL_AI_API_KEY || '').trim()
const CIVIL_AI_MODEL = (process.env.CIVIL_AI_MODEL || '').trim()
const CIVIL_AI_API_VERSION = (process.env.CIVIL_AI_API_VERSION || '').trim()
const REDDIT_EPOCH_SECONDS = 1134028003
const REACTION_HOT_WINDOW_HOURS = 48
const OUR_COMMONS_XML_TIMEOUT_MS = 20_000
const OUR_COMMONS_HTML_TIMEOUT_MS = 30_000

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

type PoliticianScrapeJobPayload = { scrapeJobId: string }

const politicianScrapeWorker = new Worker<PoliticianScrapeJobPayload>(
  'politician-scrape',
  async (job) => processPoliticianScrapeJob(job),
  {
    ...workerConnectionOptions,
    concurrency: 1,
  },
)

const politicianScrapeEvents = new QueueEvents('politician-scrape', workerConnectionOptions)
politicianScrapeEvents.on('completed', ({ jobId }) => logger.info({ jobId }, 'politician scrape job completed'))
politicianScrapeEvents.on('failed', ({ jobId, failedReason }) => logger.error({ jobId, failedReason }, 'politician scrape job failed'))

const OUR_COMMONS_XML_PARSER = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
})

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
  post_video: [],
  attachment: [
    { name: 'attachment-lg', width: 1400, fit: 'inside', quality: 88 },
    { name: 'attachment-md', width: 900, fit: 'inside', quality: 88 },
  ],
}

const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable'

let contentAiScanTablesReady: Promise<void> | null = null
let commonsBrowserPromise: Promise<Browser> | null = null

const COMMONS_PROFILE_EVAL = String.raw`(() => {
  const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim()
  const linesFromText = (value) =>
    (value || '')
      .split(/\\n+/)
      .map((entry) => normalizeText(entry))
      .filter(Boolean)

  const collectSectionNodes = (headingText) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    const heading = headings.find((node) => normalizeText(node.textContent).toUpperCase() === headingText.toUpperCase())
    if (!heading) return []
    const level = Number(heading.tagName.slice(1))
    const nodes = []
    let current = heading.nextElementSibling
    while (current) {
      if (/^H[1-6]$/.test(current.tagName) && Number(current.tagName.slice(1)) <= level) break
      nodes.push(current)
      current = current.nextElementSibling
    }
    return nodes
  }

  const parseOfficeBlock = (label, blockText) => {
    const normalized = normalizeText(blockText)
      const telephoneMatch = normalized.match(/Telephone:\s*([0-9(). -]+)/i)
      const faxMatch = normalized.match(/Fax:\s*([0-9(). -]+)/i)
    const lines = linesFromText(blockText)
      .map((entry) => entry.replace(/^Telephone:\s*/i, '').replace(/^Fax:\s*/i, '').trim())
      .filter((entry) => entry && !/^Telephone:/i.test(entry) && !/^Fax:/i.test(entry))

    return {
      label,
      lines,
      telephone: telephoneMatch ? normalizeText(telephoneMatch[1]) : null,
      fax: faxMatch ? normalizeText(faxMatch[1]) : null,
    }
  }

  const contactNodes = collectSectionNodes('CONTACT DETAILS')
  const contactText = contactNodes.map((node) => node.textContent || '').join('\\n')
  const contactLinks = contactNodes.flatMap((node) => Array.from(node.querySelectorAll('a[href]')))
  const email =
    contactLinks
      .map((node) => node.href)
      .find((href) => /^mailto:/i.test(href))
      ?.replace(/^mailto:/i, '')
      .trim() || null
  const website =
    contactLinks
      .map((node) => node.href)
      .find((href) => /^https?:\/\//i.test(href) && !/ourcommons\.ca|parl\.gc\.ca|parl\.ca/i.test(href)) || null
  const photoUrl = document.querySelector('img[alt^="Photo -"]')?.src || null

  const offices = []
  let currentLabel = null
  let currentLines = []

  for (const node of contactNodes) {
    if (/^H[1-6]$/.test(node.tagName)) {
      const label = normalizeText(node.textContent)
      if (/^(Email|Website)$/i.test(label)) {
        currentLabel = null
        currentLines = []
        continue
      }
      if (label) {
        if (currentLabel && currentLines.length) {
          offices.push(parseOfficeBlock(currentLabel, currentLines.join('\\n')))
        }
        currentLabel = label
        currentLines = []
      }
      continue
    }

    if (currentLabel) {
      const text = node.textContent || ''
      if (text.trim()) currentLines.push(text)
    }
  }

  if (currentLabel && currentLines.length) {
    offices.push(parseOfficeBlock(currentLabel, currentLines.join('\\n')))
  }

  const hillOffice = offices.find((office) => /hill office/i.test(office.label)) || null
  const constituencyOffices = offices.filter((office) => /constituency office/i.test(office.label))
  const fallbackHillOffice = !hillOffice && /Hill Office/i.test(contactText) ? parseOfficeBlock('Hill Office', contactText) : null

  return {
    photoUrl,
    email,
    website,
    hillOffice: hillOffice || fallbackHillOffice,
    constituencyOffices,
  }
})()`

type CivilAiServerConfig = {
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

function normalizeCivilAiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

async function loadCivilAiServerConfig() {
  const envServer = resolveCivilAiEnvServerConfig()
  if (envServer) {
    return envServer
  }

  const configPath = resolveCivilAiServersPath()
  const fallback: CivilAiServerConfig = {
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

function buildCivilAiHeaders(server: CivilAiServerConfig, hasJsonBody = false) {
  const headers: Record<string, string> = {}
  if (hasJsonBody) headers['content-type'] = 'application/json'
  if (server.apiKey) {
    const normalizedProvider = (server.provider || '').trim().toLowerCase()
    if (normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')) {
      headers['api-key'] = server.apiKey
    } else {
      headers.authorization = server.apiKey.startsWith('Bearer ') ? server.apiKey : `Bearer ${server.apiKey}`
    }
  }
  return headers
}

function isAzureResponsesServer(server: CivilAiServerConfig) {
  const normalizedProvider = (server.provider || '').trim().toLowerCase()
  return (normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')) && Boolean(server.apiVersion?.trim())
}

function getCivilAiModelsUrl(server: CivilAiServerConfig) {
  if (isAzureResponsesServer(server)) {
    return `${server.baseUrl}/models?api-version=${encodeURIComponent(server.apiVersion!.trim())}`
  }
  return `${server.baseUrl}/v1/models`
}

function getCivilAiChatCompletionsUrl(server: CivilAiServerConfig) {
  if (isAzureResponsesServer(server)) {
    return `${server.baseUrl}/chat/completions?api-version=${encodeURIComponent(server.apiVersion!.trim())}`
  }
  return `${server.baseUrl}/v1/chat/completions`
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

function inferImageMimeTypeFromBytes(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'image/x-icon'

  const sniff = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8').trim().toLowerCase()
  if (sniff.startsWith('<svg') || sniff.startsWith('<?xml') || sniff.includes('<svg')) return 'image/svg+xml'
  return null
}

async function toVisionImageUrl(url: string) {
  if (/^data:image\//i.test(url)) return url

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`image_fetch_failed_${response.status}`)
  }

  const contentType = response.headers.get('content-type')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) {
    throw new Error('image_fetch_empty_response')
  }

  const normalizedContentType = (contentType || '').split(';')[0]?.trim().toLowerCase() || null
  const detectedMimeType = inferImageMimeTypeFromBytes(bytes)
  const effectiveMimeType = detectedMimeType || (normalizedContentType && normalizedContentType.startsWith('image/') ? normalizedContentType : null)
  if (!effectiveMimeType) {
    throw new Error(`image_fetch_not_image:${normalizedContentType || 'unknown'}`)
  }

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(bytes, { animated: false }).metadata()
  } catch {
    throw new Error(`image_decode_failed:${effectiveMimeType}`)
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width < 48 || height < 48) {
    throw new Error(`image_too_small:${width}x${height}`)
  }

  const normalizedBytes = await sharp(bytes, { animated: false })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer()

  const base64 = normalizedBytes.toString('base64')
  return `data:image/png;base64,${base64}`
}

async function resolveVisionModel(server: CivilAiServerConfig) {
  if (CIVIL_AI_VISION_MODEL) return CIVIL_AI_VISION_MODEL
  if (server.defaultModel?.trim()) return server.defaultModel.trim()
  try {
    const normalizedProvider = (server.provider || '').trim().toLowerCase()
    if (normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')) {
      return null
    }
    const response = await fetch(getCivilAiModelsUrl(server), {
      headers: Object.keys(buildCivilAiHeaders(server)).length ? buildCivilAiHeaders(server) : undefined,
    })
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

  const conversionResults = await Promise.allSettled(args.imageUrls.slice(0, 4).map(async (url) => ({ sourceUrl: url, dataUrl: await toVisionImageUrl(url) })))
  const visionImageUrls = conversionResults
    .filter((result): result is PromiseFulfilledResult<{ sourceUrl: string; dataUrl: string }> => result.status === 'fulfilled')
    .map((result) => result.value.dataUrl)
  const skippedImages = conversionResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)))

  if (!visionImageUrls.length && !args.sourceText?.trim()) {
    throw new Error(skippedImages[0] || 'no_valid_images_or_text_available')
  }

  const body = {
    model: args.model,
    temperature: 0.1,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...visionImageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  }

  const response = await fetch(getCivilAiChatCompletionsUrl(args.server), {
    method: 'POST',
    headers: buildCivilAiHeaders(args.server, true),
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

  return {
    parsed,
    raw: {
      skippedImages,
      imageCount: visionImageUrls.length,
      response: json ?? rawText,
    },
  }
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

function readXmlText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['@_xsi:nil'] === 'true') return null
  const text = record['#text']
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}

function jsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function parseIsoDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function fetchXmlDocument(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OUR_COMMONS_XML_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/xml,text/xml' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`commons_fetch_failed:${response.status}`)
    }

    const raw = await response.text()
    return OUR_COMMONS_XML_PARSER.parse(raw) as Record<string, unknown>
  } finally {
    clearTimeout(timeout)
  }
}

function extractOurCommonsProfileResult(doc: Record<string, unknown>) {
  const profile = readRecord(doc.Profile) ?? doc
  const memberRole = readRecord(profile.MemberOfParliamentRole)
  const caucusRolesContainer = readRecord(profile.CaucusMemberRoles)
  const committeeRolesContainer = readRecord(profile.CommitteeMemberRoles)
  const associationRolesContainer = readRecord(profile.ParliamentaryAssociationsandInterparliamentaryGroupRoles)

  return {
    memberRole: memberRole
      ? {
          personId: readXmlText(memberRole.PersonId),
          constituencyName: readXmlText(memberRole.ConstituencyName),
          provinceName: readXmlText(memberRole.ConstituencyProvinceTerritoryName),
          caucusShortName: readXmlText(memberRole.CaucusShortName),
          fromDateTime: readXmlText(memberRole.FromDateTime),
          toDateTime: readXmlText(memberRole.ToDateTime),
        }
      : null,
    caucusRoles: toArray(caucusRolesContainer?.CaucusMemberRole).map((role) => {
      const record = readRecord(role)
      return {
        caucusShortName: readXmlText(record?.CaucusShortName),
        title: readXmlText(record?.Title),
        fromDateTime: readXmlText(record?.FromDateTime),
        toDateTime: readXmlText(record?.ToDateTime),
      }
    }),
    committeeRoles: toArray(committeeRolesContainer?.CommitteeMemberRole).map((role) => {
      const record = readRecord(role)
      return {
        organization: readXmlText(record?.Organization),
        title: readXmlText(record?.Title),
      }
    }),
    associationRoles: toArray(associationRolesContainer?.ParliamentaryAssociationsandInterparliamentaryGroupRole).map((role) => {
      const record = readRecord(role)
      return {
        organization: readXmlText(record?.Organization),
        title: readXmlText(record?.Title),
        roleType: readXmlText(record?.AssociationMemberRoleType),
      }
    }),
    raw: doc,
  }
}

async function getCommonsBrowser() {
  if (!commonsBrowserPromise) {
    commonsBrowserPromise = chromium.launch({ headless: true }).then((browser) => {
      browser.on('disconnected', () => {
        commonsBrowserPromise = null
      })
      return browser
    }).catch((error) => {
      commonsBrowserPromise = null
      throw error
    })
  }

  return commonsBrowserPromise
}

function resetCommonsBrowser() {
  commonsBrowserPromise = null
}

function isRecoverableBrowserError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /Target page, context or browser has been closed|Browser has been closed|Execution context was destroyed/i.test(message)
}

type CommonsHtmlOffice = {
  label: string
  lines: string[]
  telephone: string | null
  fax: string | null
}

type CommonsHtmlProfileResult = {
  photoUrl: string | null
  email: string | null
  website: string | null
  hillOffice: CommonsHtmlOffice | null
  constituencyOffices: CommonsHtmlOffice[]
}

async function scrapeOurCommonsHtmlProfile(profileUrl: string): Promise<CommonsHtmlProfileResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null
    try {
      const browser = await getCommonsBrowser()
      page = await browser.newPage()
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: OUR_COMMONS_HTML_TIMEOUT_MS })
      await page.waitForLoadState('networkidle', { timeout: OUR_COMMONS_HTML_TIMEOUT_MS }).catch(() => null)
      return await page.evaluate(COMMONS_PROFILE_EVAL) as CommonsHtmlProfileResult
    } catch (error) {
      if (isRecoverableBrowserError(error) && attempt === 0) {
        resetCommonsBrowser()
        continue
      }
      throw error
    } finally {
      await page?.close().catch(() => null)
    }
  }

  throw new Error('commons_html_scrape_unreachable')
}

async function processPoliticianScrapeJob(job: Job<PoliticianScrapeJobPayload>) {
  const scrapeJob = await prisma.politicianScrapeJob.findUnique({
    where: { id: job.data.scrapeJobId },
    include: {
      politician: {
        select: {
          id: true,
          metadata: true,
          currentSeat: {
            select: { id: true, metadata: true },
          },
        },
      },
    },
  })

  if (!scrapeJob) {
    logger.warn({ scrapeJobId: job.data.scrapeJobId }, 'politician scrape job missing from database')
    return
  }

  await prisma.politicianScrapeJob.update({
    where: { id: scrapeJob.id },
    data: {
      status: PoliticianScrapeJobStatus.PROCESSING,
      startedAt: new Date(),
      attempts: { increment: 1 },
      lastError: null,
    },
  })

  try {
    const completedAt = new Date()
    let politicianMetadata: Record<string, unknown>
    let result: Prisma.InputJsonValue

    if (scrapeJob.source === PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_XML) {
      if (!scrapeJob.xmlUrl) {
        throw new Error('politician_scrape_missing_xml_url')
      }

      const document = await fetchXmlDocument(scrapeJob.xmlUrl)
      const parsed = extractOurCommonsProfileResult(document)
      politicianMetadata = {
        ...jsonObject(scrapeJob.politician.metadata),
        scrape: {
          ...jsonObject(jsonObject(scrapeJob.politician.metadata).scrape),
          lastScrapeAt: completedAt.toISOString(),
          lastXmlSyncAt: completedAt.toISOString(),
        },
        ourCommons: {
          ...jsonObject(jsonObject(scrapeJob.politician.metadata).ourCommons),
          personId: scrapeJob.personId,
          profileUrl: scrapeJob.profileUrl,
          xmlUrl: scrapeJob.xmlUrl,
          lastXmlSyncAt: completedAt.toISOString(),
          detail: {
            memberRole: parsed.memberRole,
            caucusRoles: parsed.caucusRoles,
            committeeRoles: parsed.committeeRoles,
            associationRoles: parsed.associationRoles,
          },
        },
      }
      result = parsed.raw as Prisma.InputJsonValue
    } else if (scrapeJob.source === PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_HTML) {
      if (!scrapeJob.profileUrl) {
        throw new Error('politician_scrape_missing_profile_url')
      }

      const parsed = await scrapeOurCommonsHtmlProfile(scrapeJob.profileUrl)
      politicianMetadata = {
        ...jsonObject(scrapeJob.politician.metadata),
        scrape: {
          ...jsonObject(jsonObject(scrapeJob.politician.metadata).scrape),
          lastScrapeAt: completedAt.toISOString(),
          lastHtmlSyncAt: completedAt.toISOString(),
        },
        ourCommons: {
          ...jsonObject(jsonObject(scrapeJob.politician.metadata).ourCommons),
          profileUrl: scrapeJob.profileUrl,
          lastHtmlSyncAt: completedAt.toISOString(),
          photoUrl: parsed.photoUrl,
          contact: {
            email: parsed.email,
            website: parsed.website,
            hillOffice: parsed.hillOffice,
            constituencyOffices: parsed.constituencyOffices,
          },
        },
      }
      result = parsed as Prisma.InputJsonValue
    } else {
      logger.warn({ scrapeJobId: scrapeJob.id, source: scrapeJob.source }, 'unsupported politician scrape source')
      return
    }

    await prisma.$transaction([
      prisma.politicianScrapeJob.update({
        where: { id: scrapeJob.id },
        data: {
          status: PoliticianScrapeJobStatus.COMPLETED,
          completedAt,
          nextRunAt: null,
          lastError: null,
          result,
        },
      }),
      prisma.politician.update({
        where: { id: scrapeJob.politicianId },
        data: {
          metadata: politicianMetadata as Prisma.InputJsonValue,
        },
      }),
      ...(scrapeJob.politician.currentSeat
        ? [
            prisma.politicalSeat.update({
              where: { id: scrapeJob.politician.currentSeat.id },
              data: {
                metadata: {
                  ...jsonObject(scrapeJob.politician.currentSeat.metadata),
                  scrape: {
                    lastScrapeAt: completedAt.toISOString(),
                  },
                } as Prisma.InputJsonValue,
              },
            }),
          ]
        : []),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.politicianScrapeJob.update({
      where: { id: scrapeJob.id },
      data: {
        status: PoliticianScrapeJobStatus.FAILED,
        completedAt: new Date(),
        nextRunAt: null,
        lastError: message.slice(0, 2000),
      },
    })
    throw error
  }
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
    if (asset.assetType === 'video') {
      await processVideoMediaAsset(asset, originalBuffer, job)
    } else {
      await processImageMediaAsset(asset, originalBuffer)
    }

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
    if (asset.assetType === 'video') {
      await prisma.mediaTranscodeJob.upsert({
        where: {
          assetId_kind: {
            assetId: asset.id,
            kind: MediaTranscodeJobKind.VIDEO_720P,
          },
        },
        create: {
          assetId: asset.id,
          kind: MediaTranscodeJobKind.VIDEO_720P,
          status: MediaTranscodeJobStatus.FAILED,
          queuedAt: asset.createdAt,
          startedAt: new Date(),
          completedAt: new Date(),
          attempts: job.attemptsMade + 1,
          lastError: message.slice(0, 500),
        },
        update: {
          status: MediaTranscodeJobStatus.FAILED,
          completedAt: new Date(),
          attempts: job.attemptsMade + 1,
          lastError: message.slice(0, 500),
        },
      })
    }
    logger.error({ assetId: job.data.assetId, err: error }, 'failed processing media asset')
    throw error
  }
}

async function processImageMediaAsset(asset: { id: string; ownerId: string; category: MediaCategory; width: number | null; height: number | null }, originalBuffer: Buffer) {
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
}

type VideoProbeResult = {
  width: number | null
  height: number | null
  durationMs: number | null
}

const FFMPEG_BINARY_CANDIDATES = buildBinaryCandidates(process.env.FFMPEG_PATH, 'ffmpeg', typeof ffmpegPath === 'string' ? ffmpegPath : null)
const FFPROBE_BINARY_CANDIDATES = buildBinaryCandidates(process.env.FFPROBE_PATH, 'ffprobe', typeof ffprobe.path === 'string' ? ffprobe.path : null)
const MAX_VIDEO_DURATION_MS = 5 * 60 * 1000

async function processVideoMediaAsset(
  asset: {
    id: string
    ownerId: string
    category: MediaCategory
    mime: string
    metadata: Prisma.JsonValue | null
  },
  originalBuffer: Buffer,
  job: Job<MediaJobPayload>,
) {
  await prisma.mediaTranscodeJob.upsert({
    where: {
      assetId_kind: {
        assetId: asset.id,
        kind: MediaTranscodeJobKind.VIDEO_720P,
      },
    },
    create: {
      assetId: asset.id,
      kind: MediaTranscodeJobKind.VIDEO_720P,
      status: MediaTranscodeJobStatus.PROCESSING,
      queuedAt: new Date(),
      startedAt: new Date(),
      attempts: job.attemptsMade + 1,
    },
    update: {
      status: MediaTranscodeJobStatus.PROCESSING,
      startedAt: new Date(),
      completedAt: null,
      attempts: job.attemptsMade + 1,
      lastError: null,
    },
  })

  if (!FFMPEG_BINARY_CANDIDATES.length || !FFPROBE_BINARY_CANDIDATES.length) {
    throw new Error('ffmpeg_binary_missing')
  }

  const workingDir = await fs.mkdtemp(join(tmpdir(), 'civil-video-'))
  const inputPath = join(workingDir, 'input')
  const outputVideoPath = join(workingDir, 'video-720p.mp4')
  const outputThumbPath = join(workingDir, 'video-thumb.jpg')

  try {
    await fs.writeFile(inputPath, originalBuffer)

    const sourceMetadata = await probeVideoFile(inputPath)
    if (!sourceMetadata.durationMs) {
      throw new Error('video_duration_missing')
    }
    if (sourceMetadata.durationMs > MAX_VIDEO_DURATION_MS) {
      throw new Error('video_too_long')
    }

    await runBinary(FFMPEG_BINARY_CANDIDATES, [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      'scale=w=1280:h=720:force_original_aspect_ratio=decrease',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      outputVideoPath,
    ])

    await runBinary(FFMPEG_BINARY_CANDIDATES, [
      '-y',
      '-ss',
      '0',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=w=1280:h=720:force_original_aspect_ratio=decrease',
      outputThumbPath,
    ])

    const [transcodedBuffer, thumbnailBuffer] = await Promise.all([fs.readFile(outputVideoPath), fs.readFile(outputThumbPath)])
    const outputMetadata = await probeVideoFile(outputVideoPath)

    const videoKey = buildVariantKey(asset.category, asset.ownerId, asset.id, 'video-720p', 'mp4')
    const thumbKey = buildVariantKey(asset.category, asset.ownerId, asset.id, 'video-thumb', 'jpg')
    await uploadVariant(videoKey, transcodedBuffer, 'video/mp4')
    await uploadVariant(thumbKey, thumbnailBuffer, 'image/jpeg')

    const variantEntries = {
      'video-720p': {
        key: videoKey,
        url: buildPublicUrl(videoKey),
        width: outputMetadata.width ?? sourceMetadata.width ?? undefined,
        height: outputMetadata.height ?? sourceMetadata.height ?? undefined,
        contentType: 'video/mp4',
      },
      'video-thumb': {
        key: thumbKey,
        url: buildPublicUrl(thumbKey),
        width: outputMetadata.width ?? sourceMetadata.width ?? undefined,
        height: outputMetadata.height ?? sourceMetadata.height ?? undefined,
        contentType: 'image/jpeg',
      },
    }

    const metadataBase =
      asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
        ? ({ ...(asset.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {}

    metadataBase.video = {
      durationMs: sourceMetadata.durationMs,
      sourceWidth: sourceMetadata.width,
      sourceHeight: sourceMetadata.height,
      playbackVariant: 'video-720p',
      thumbnailVariant: 'video-thumb',
      profile: '720p-h264',
    }

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        width: outputMetadata.width ?? sourceMetadata.width ?? null,
        height: outputMetadata.height ?? sourceMetadata.height ?? null,
        durationMs: sourceMetadata.durationMs,
        variants: variantEntries,
        metadata: metadataBase as Prisma.InputJsonValue,
        status: 'ready',
        readyAt: new Date(),
        failureReason: null,
      },
    })

    await prisma.mediaTranscodeJob.update({
      where: {
        assetId_kind: {
          assetId: asset.id,
          kind: MediaTranscodeJobKind.VIDEO_720P,
        },
      },
      data: {
        status: MediaTranscodeJobStatus.COMPLETED,
        completedAt: new Date(),
        result: {
          playbackUrl: variantEntries['video-720p'].url,
          thumbnailUrl: variantEntries['video-thumb'].url,
          durationMs: sourceMetadata.durationMs,
          width: outputMetadata.width ?? sourceMetadata.width ?? null,
          height: outputMetadata.height ?? sourceMetadata.height ?? null,
        },
      },
    })
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true }).catch(() => undefined)
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

function buildBinaryCandidates(...values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    candidates.push(normalized)
  }
  return candidates
}

async function runBinary(binaryPathOrCandidates: string | string[], args: string[]) {
  const candidates = Array.isArray(binaryPathOrCandidates) ? binaryPathOrCandidates : [binaryPathOrCandidates]
  let lastMissingBinaryError: unknown = null

  for (const binaryPath of candidates) {
    try {
      return await runSingleBinary(binaryPath, args)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        lastMissingBinaryError = error
        continue
      }
      throw error
    }
  }

  throw lastMissingBinaryError ?? new Error('ffmpeg_binary_missing')
}

async function runSingleBinary(binaryPath: string, args: string[]) {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      reject(new Error(stderr.trim() || `process_failed:${code ?? 'unknown'}`))
    })
  })
}

async function probeVideoFile(filePath: string): Promise<VideoProbeResult> {
  if (!FFPROBE_BINARY_CANDIDATES.length) throw new Error('ffprobe_binary_missing')
  const stdout = await runBinary(FFPROBE_BINARY_CANDIDATES, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath])
  const payload = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
    format?: { duration?: string }
  }
  const videoStream = Array.isArray(payload.streams) ? payload.streams.find((stream) => stream.codec_type === 'video') : null
  const streamDurationMs = videoStream?.duration ? Number.parseFloat(videoStream.duration) * 1000 : NaN
  const formatDurationMs = payload.format?.duration ? Number.parseFloat(payload.format.duration) * 1000 : NaN
  const durationMs = Number.isFinite(streamDurationMs) ? Math.round(streamDurationMs) : Number.isFinite(formatDurationMs) ? Math.round(formatDurationMs) : null
  return {
    width: typeof videoStream?.width === 'number' ? videoStream.width : null,
    height: typeof videoStream?.height === 'number' ? videoStream.height : null,
    durationMs,
  }
}

function buildVariantKey(category: MediaCategory, ownerId: string, assetId: string, variantName: string, extension = 'webp') {
  return `processed/${category}/${ownerId}/${assetId}/${variantName}.${extension}`
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
