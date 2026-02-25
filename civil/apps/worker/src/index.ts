import { Worker, QueueEvents, Job } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import pino from 'pino'
import { prisma } from '@civil/db'
import type { MediaCategory } from '@civil/db'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const MEDIA_S3_ENDPOINT = process.env.MEDIA_S3_ENDPOINT || 'http://127.0.0.1:9000'
const MEDIA_S3_REGION = process.env.MEDIA_S3_REGION || 'us-east-1'
const MEDIA_S3_ACCESS_KEY = process.env.MEDIA_S3_ACCESS_KEY || 'minioadmin'
const MEDIA_S3_SECRET_KEY = process.env.MEDIA_S3_SECRET_KEY || 'minioadmin'
const MEDIA_BUCKET_PUBLIC = process.env.MEDIA_BUCKET_PUBLIC || 'civil-media'
const MEDIA_BUCKET_ORIGINAL = process.env.MEDIA_BUCKET_ORIGINAL || 'civil-media-raw'
const CIVIL_PUBLIC_HOST = process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca'
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || `https://${CIVIL_PUBLIC_HOST}/media`).replace(/\/$/, '')

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
  await Promise.all([fanoutWorker.close(), fanoutEvents.close(), mediaWorker.close(), mediaEvents.close()])
  await connection.quit()
  process.exit(0)
})
