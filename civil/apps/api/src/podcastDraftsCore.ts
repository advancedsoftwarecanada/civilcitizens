import { randomUUID } from 'node:crypto'
import { prisma } from '@civil/db'
import { MediaTranscodeJobKind, Prisma } from '@prisma/client'

export type PodcastDraftStatus = 'draft' | 'uploading' | 'processing' | 'ready' | 'published' | 'failed'

type PodcastDraftRow = {
  id: string
  creator_user_id: string
  media_asset_id: string | null
  cover_media_asset_id: string | null
  title: string
  description: string
  published_post_id: string | null
  ready_notification_sent_at: Date | null
  published_notification_sent_at: Date | null
  created_at: Date
  updated_at: Date
}

export type PodcastDraftSummary = {
  id: string
  creatorUserId: string
  mediaAssetId: string | null
  coverMediaAssetId: string | null
  title: string
  description: string
  publishedPostId: string | null
  status: PodcastDraftStatus
  failureReason: string | null
  createdAt: string
  updatedAt: string
  publishedPostPath: string | null
  managePath: string
  coverImageUrl: string | null
  mediaAsset: {
    id: string
    status: string
    durationMs: number | null
    width: number | null
    height: number | null
    mime: string
    updatedAt: string
    playbackUrl: string | null
    thumbnailUrl: string | null
    sourceType: 'video' | 'audio'
    transcodeJob: {
      status: string
      queuedAt: string
      startedAt: string | null
      completedAt: string | null
      attempts: number
      lastError: string | null
    } | null
  } | null
}

type PublishPodcastDraftDeps = {
  buildPostSlugBase: (input: { handle?: string | null; title?: string | null; body: string }) => string
  createNotificationRecord?: (data: {
    userId: string
    actorId: string | null
    type: string
    postId?: string | null
    payload?: Prisma.InputJsonValue
    suppressMobilePush?: boolean
  }) => Promise<unknown>
  generateUniquePostSlug: (slugBase: string, tx: Prisma.TransactionClient) => Promise<string>
  sanitizePlainText: (value: string) => string
}

export const PODCAST_NOTIFICATION_TYPES = {
  READY: 'podcast_draft_ready',
  PUBLISHED: 'podcast_draft_published',
} as const

function extractVideoVariantUrl(variants: Prisma.JsonValue | null | undefined, preferred: string[]) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return null
  const record = variants as Record<string, { url?: unknown } | null>
  for (const key of preferred) {
    const candidate = record[key]
    if (candidate && typeof candidate.url === 'string' && candidate.url.trim().length > 0) {
      return candidate.url
    }
  }
  return null
}

function extractImageVariantUrl(variants: Prisma.JsonValue | null | undefined, preferred: string[]) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return null
  const record = variants as Record<string, { url?: unknown } | null>
  for (const key of preferred) {
    const candidate = record[key]
    if (candidate && typeof candidate.url === 'string' && candidate.url.trim().length > 0) {
      return candidate.url
    }
  }
  const fallback = Object.values(record).find((value) => value && typeof value.url === 'string' && value.url.trim().length > 0)
  return fallback && typeof fallback.url === 'string' ? fallback.url : null
}

function buildReadyPodcastVideoPayload(asset: {
  id: string
  variants: Prisma.JsonValue | null
  mime: string | null
  metadata: Prisma.JsonValue | null
  width: number | null
  height: number | null
  durationMs: number | null
}) {
  const metadata =
    asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : {}
  const sourceType = metadata.sourceType === 'audio' ? 'audio' : 'video'
  const playbackUrl = extractVideoVariantUrl(asset.variants, sourceType === 'audio' ? ['audio-original'] : ['video-720p'])
  const thumbnailUrl = sourceType === 'audio' ? null : extractVideoVariantUrl(asset.variants, ['video-thumb'])
  if (!playbackUrl || (sourceType !== 'audio' && !thumbnailUrl)) return null
  return {
    assetId: asset.id,
    playbackUrl,
    thumbnailUrl,
    kind: 'podcast',
    sourceType,
    mime: asset.mime,
    durationMs: asset.durationMs ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    status: 'completed',
  }
}

function buildPublishedPostPath(post: { id: string; seoSlug: string | null }) {
  const slug = post.seoSlug?.trim() || post.id
  return `/post/${encodeURIComponent(slug)}`
}

function deriveStatus(args: { mediaAssetId: string | null; publishedPostId: string | null; assetStatus: string | null }): PodcastDraftStatus {
  if (args.publishedPostId) return 'published'
  if (!args.mediaAssetId) return 'draft'
  if (args.assetStatus === 'failed') return 'failed'
  if (args.assetStatus === 'ready') return 'ready'
  if (args.assetStatus === 'processing') return 'processing'
  return 'uploading'
}

async function queryDraftRows(whereSql: Prisma.Sql) {
  return prisma.$queryRaw<PodcastDraftRow[]>`
    SELECT id, creator_user_id, media_asset_id, cover_media_asset_id, title, description, published_post_id, ready_notification_sent_at, published_notification_sent_at, created_at, updated_at
    FROM civil_podcast_draft
    ${whereSql}
    ORDER BY updated_at DESC, created_at DESC
  `
}

async function hydrateRows(rows: PodcastDraftRow[]): Promise<PodcastDraftSummary[]> {
  if (!rows.length) return []
  const mediaAssetIds = rows.map((row) => row.media_asset_id).filter((value): value is string => Boolean(value))
  const coverAssetIds = rows.map((row) => row.cover_media_asset_id).filter((value): value is string => Boolean(value))
  const postIds = rows.map((row) => row.published_post_id).filter((value): value is string => Boolean(value))
  type HydratedAsset = {
    id: string
    status: string
    failureReason: string | null
    durationMs: number | null
    width: number | null
    height: number | null
    mime: string
    updatedAt: Date
    variants: Prisma.JsonValue | null
    metadata: Prisma.JsonValue | null
  }
  type HydratedTranscodeJob = {
    assetId: string
    status: string
    queuedAt: Date
    startedAt: Date | null
    completedAt: Date | null
    attempts: number
    lastError: string | null
  }
  type HydratedPost = { id: string; seoSlug: string | null }
  const assets: HydratedAsset[] = mediaAssetIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: mediaAssetIds } },
        select: { id: true, status: true, failureReason: true, durationMs: true, width: true, height: true, mime: true, updatedAt: true, variants: true, metadata: true },
      })
    : []
  const coverAssets: HydratedAsset[] = coverAssetIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: coverAssetIds } },
        select: { id: true, status: true, failureReason: true, durationMs: true, width: true, height: true, mime: true, updatedAt: true, variants: true, metadata: true },
      })
    : []
  const transcodeJobs: HydratedTranscodeJob[] = mediaAssetIds.length
    ? await prisma.mediaTranscodeJob.findMany({
        where: { assetId: { in: mediaAssetIds }, kind: MediaTranscodeJobKind.VIDEO_720P },
        select: { assetId: true, status: true, queuedAt: true, startedAt: true, completedAt: true, attempts: true, lastError: true },
      })
    : []
  const posts: HydratedPost[] = postIds.length
    ? await prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, seoSlug: true } })
    : []

  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const coverAssetById = new Map(coverAssets.map((asset) => [asset.id, asset]))
  const transcodeJobByAssetId = new Map(transcodeJobs.map((job) => [job.assetId, job]))
  const postById = new Map(posts.map((post) => [post.id, post]))

  return rows.map((row) => {
    const asset = row.media_asset_id ? assetById.get(row.media_asset_id) ?? null : null
    const coverAsset = row.cover_media_asset_id ? coverAssetById.get(row.cover_media_asset_id) ?? null : null
    const transcodeJob = row.media_asset_id ? transcodeJobByAssetId.get(row.media_asset_id) ?? null : null
    const post = row.published_post_id ? postById.get(row.published_post_id) ?? null : null
    const assetMetadata = asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : {}
    const sourceType = assetMetadata.sourceType === 'audio' ? 'audio' : 'video'
    const playbackUrl = asset ? extractVideoVariantUrl(asset.variants, sourceType === 'audio' ? ['audio-original'] : ['video-720p']) : null
    const thumbnailUrl = asset ? extractVideoVariantUrl(asset.variants, ['video-thumb']) : null
    const explicitCoverImageUrl = coverAsset?.status === 'ready'
      ? extractImageVariantUrl(coverAsset.variants, ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md'])
      : null
    const coverImageUrl = explicitCoverImageUrl ?? thumbnailUrl
    return {
      id: row.id,
      creatorUserId: row.creator_user_id,
      mediaAssetId: row.media_asset_id,
      coverMediaAssetId: row.cover_media_asset_id,
      title: row.title,
      description: row.description,
      publishedPostId: row.published_post_id,
      status: deriveStatus({ mediaAssetId: row.media_asset_id, publishedPostId: row.published_post_id, assetStatus: asset?.status ?? null }),
      failureReason: asset?.failureReason ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      publishedPostPath: post ? buildPublishedPostPath(post) : null,
      managePath: '/podcasts/manage',
      coverImageUrl,
      mediaAsset: asset
        ? {
            id: asset.id,
            status: asset.status,
            durationMs: asset.durationMs,
            width: asset.width,
            height: asset.height,
            mime: asset.mime,
            updatedAt: asset.updatedAt.toISOString(),
        playbackUrl,
        thumbnailUrl,
        sourceType,
            transcodeJob: transcodeJob
              ? {
                  status: transcodeJob.status,
                  queuedAt: transcodeJob.queuedAt.toISOString(),
                  startedAt: transcodeJob.startedAt?.toISOString() ?? null,
                  completedAt: transcodeJob.completedAt?.toISOString() ?? null,
                  attempts: transcodeJob.attempts,
                  lastError: transcodeJob.lastError,
                }
              : null,
          }
        : null,
    }
  })
}

export async function ensurePodcastDraftTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS civil_podcast_draft (
      id TEXT PRIMARY KEY,
      creator_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      media_asset_id TEXT UNIQUE REFERENCES "MediaAsset"(id) ON DELETE SET NULL,
      cover_media_asset_id TEXT REFERENCES "MediaAsset"(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      published_post_id TEXT UNIQUE,
      ready_notification_sent_at TIMESTAMPTZ,
      published_notification_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`ALTER TABLE civil_podcast_draft ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`)
  await prisma.$executeRawUnsafe(`ALTER TABLE civil_podcast_draft ADD COLUMN IF NOT EXISTS cover_media_asset_id TEXT`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_podcast_draft_creator_user_id_idx ON civil_podcast_draft (creator_user_id, updated_at DESC)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_podcast_draft_media_asset_id_idx ON civil_podcast_draft (media_asset_id)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_podcast_draft_cover_media_asset_id_idx ON civil_podcast_draft (cover_media_asset_id)`)
}

export async function createPodcastDraft(input: { creatorUserId: string; title?: string; description?: string; mediaAssetId?: string | null }) {
  await ensurePodcastDraftTables()
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO civil_podcast_draft (id, creator_user_id, media_asset_id, title, description)
    VALUES (${id}, ${input.creatorUserId}, ${input.mediaAssetId ?? null}, ${input.title?.trim() ?? ''}, ${input.description?.trim() ?? ''})
  `
  return loadPodcastDraftById(id, input.creatorUserId)
}

export async function attachMediaAssetToPodcastDraft(input: { creatorUserId: string; mediaAssetId: string; draftId?: string | null }) {
  await ensurePodcastDraftTables()
  if (input.draftId) {
    const rows = await prisma.$queryRaw<PodcastDraftRow[]>`
      UPDATE civil_podcast_draft
      SET media_asset_id = ${input.mediaAssetId}, updated_at = NOW()
      WHERE id = ${input.draftId} AND creator_user_id = ${input.creatorUserId}
      RETURNING id, creator_user_id, media_asset_id, cover_media_asset_id, title, description, published_post_id, ready_notification_sent_at, published_notification_sent_at, created_at, updated_at
    `
    if (rows[0]) {
      const hydrated = await hydrateRows(rows)
      return hydrated[0] ?? null
    }
  }
  return createPodcastDraft({ creatorUserId: input.creatorUserId, mediaAssetId: input.mediaAssetId })
}

export async function loadPodcastDraftById(id: string, creatorUserId?: string) {
  await ensurePodcastDraftTables()
  const rows = creatorUserId
    ? await queryDraftRows(Prisma.sql`WHERE id = ${id} AND creator_user_id = ${creatorUserId}`)
    : await queryDraftRows(Prisma.sql`WHERE id = ${id}`)
  const drafts = await hydrateRows(rows)
  return drafts[0] ?? null
}

export async function loadPodcastDraftByMediaAssetId(mediaAssetId: string) {
  await ensurePodcastDraftTables()
  const rows = await queryDraftRows(Prisma.sql`WHERE media_asset_id = ${mediaAssetId}`)
  const drafts = await hydrateRows(rows)
  return drafts[0] ?? null
}

export async function listPodcastDraftsForUser(creatorUserId: string) {
  await ensurePodcastDraftTables()
  const rows = await queryDraftRows(Prisma.sql`WHERE creator_user_id = ${creatorUserId}`)
  return hydrateRows(rows)
}

export async function updatePodcastDraftDetails(input: { id: string; creatorUserId: string; title?: string; description?: string; coverMediaAssetId?: string | null }) {
  await ensurePodcastDraftTables()
  const current = await loadPodcastDraftById(input.id, input.creatorUserId)
  if (!current) return null
  const nextTitle = typeof input.title === 'string' ? input.title.trim() : current.title
  const nextDescription = typeof input.description === 'string' ? input.description.trim() : current.description
  let nextCoverMediaAssetId = typeof input.coverMediaAssetId === 'undefined' ? current.coverMediaAssetId : input.coverMediaAssetId
  if (nextCoverMediaAssetId) {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: nextCoverMediaAssetId, ownerId: input.creatorUserId, category: 'post_image' },
      select: { id: true },
    })
    if (!asset) {
      throw new Error('invalid_cover_media')
    }
    nextCoverMediaAssetId = asset.id
  }
  const rows = await prisma.$queryRaw<PodcastDraftRow[]>`
    UPDATE civil_podcast_draft
    SET title = ${nextTitle}, description = ${nextDescription}, cover_media_asset_id = ${nextCoverMediaAssetId}, updated_at = NOW()
    WHERE id = ${input.id} AND creator_user_id = ${input.creatorUserId}
    RETURNING id, creator_user_id, media_asset_id, cover_media_asset_id, title, description, published_post_id, ready_notification_sent_at, published_notification_sent_at, created_at, updated_at
  `
  const drafts = await hydrateRows(rows)
  return drafts[0] ?? null
}

async function markReadyNotificationSent(id: string) {
  await prisma.$executeRaw`UPDATE civil_podcast_draft SET ready_notification_sent_at = NOW(), updated_at = NOW() WHERE id = ${id}`
}

async function markPublishedNotificationSent(id: string) {
  await prisma.$executeRaw`UPDATE civil_podcast_draft SET published_notification_sent_at = NOW(), updated_at = NOW() WHERE id = ${id}`
}

async function loadDraftRowForPublish(id: string) {
  const rows = await prisma.$queryRaw<PodcastDraftRow[]>`
    SELECT id, creator_user_id, media_asset_id, cover_media_asset_id, title, description, published_post_id, ready_notification_sent_at, published_notification_sent_at, created_at, updated_at
    FROM civil_podcast_draft
    WHERE id = ${id}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function publishPodcastDraftIfEligible(input: { draftId: string; deps: PublishPodcastDraftDeps; notifyReadyIfBlocked?: boolean }) {
  await ensurePodcastDraftTables()
  const draftRow = await loadDraftRowForPublish(input.draftId)
  if (!draftRow) return { draft: null, publishedPostId: null }
  if (!draftRow.media_asset_id) return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: null }

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: draftRow.media_asset_id, ownerId: draftRow.creator_user_id, category: 'post_video', assetType: 'video' },
    select: { id: true, status: true, failureReason: true, variants: true, metadata: true, mime: true, width: true, height: true, durationMs: true },
  })
  if (!asset) return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: null }
  if (draftRow.published_post_id) return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: draftRow.published_post_id }
  if (asset.status !== 'ready') return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: null }

  const title = input.deps.sanitizePlainText(draftRow.title)
  const description = input.deps.sanitizePlainText(draftRow.description)
  if (!title.trim() || !description.trim()) {
    if (input.notifyReadyIfBlocked && !draftRow.ready_notification_sent_at && input.deps.createNotificationRecord) {
      await input.deps.createNotificationRecord({
        userId: draftRow.creator_user_id,
        actorId: null,
        type: PODCAST_NOTIFICATION_TYPES.READY,
        payload: { draftId: draftRow.id, url: '/podcasts/manage', draftTitle: title.trim() || null },
      })
      await markReadyNotificationSent(draftRow.id)
    }
    return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: null }
  }

  const readyVideoPayload = buildReadyPodcastVideoPayload(asset)
  if (!readyVideoPayload) return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: null }

  const coverAsset = draftRow.cover_media_asset_id
    ? await prisma.mediaAsset.findFirst({
        where: { id: draftRow.cover_media_asset_id, ownerId: draftRow.creator_user_id, category: 'post_image' },
        select: { id: true, status: true, variants: true },
      })
    : null
  const coverImageUrl = coverAsset?.status === 'ready'
    ? extractImageVariantUrl(coverAsset.variants, ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md'])
    : null
  const postVideoPayload = {
    ...readyVideoPayload,
    thumbnailUrl: coverImageUrl ?? readyVideoPayload.thumbnailUrl,
  }

  const author = await prisma.user.findUnique({ where: { id: draftRow.creator_user_id }, select: { id: true, handle: true } })
  if (!author) return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: null }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const currentRows = await tx.$queryRaw<PodcastDraftRow[]>`
      SELECT id, creator_user_id, media_asset_id, cover_media_asset_id, title, description, published_post_id, ready_notification_sent_at, published_notification_sent_at, created_at, updated_at
      FROM civil_podcast_draft WHERE id = ${draftRow.id} LIMIT 1
    `
    const current = currentRows[0] ?? null
    if (!current || current.published_post_id) {
      return { postId: current?.published_post_id ?? null, postPath: null as string | null }
    }
    const slugBase = input.deps.buildPostSlugBase({ handle: author.handle, title, body: description })
    const seoSlug = await input.deps.generateUniquePostSlug(slugBase, tx)
    const post = await tx.post.create({
      data: {
        authorId: draftRow.creator_user_id,
        title,
        body: description,
        mediaUrl: coverImageUrl ?? readyVideoPayload.thumbnailUrl,
        video: postVideoPayload as Prisma.InputJsonValue,
        type: 'post',
        audience: 'network',
        visibility: 'public',
        jurisdiction: 'self',
        seoSlug,
      },
      select: { id: true, seoSlug: true },
    })
    await tx.$executeRaw`UPDATE civil_podcast_draft SET published_post_id = ${post.id}, updated_at = NOW() WHERE id = ${draftRow.id}`
    return { postId: post.id, postPath: buildPublishedPostPath(post) }
  })

  if (result.postId && input.deps.createNotificationRecord && !draftRow.published_notification_sent_at) {
    await input.deps.createNotificationRecord({
      userId: draftRow.creator_user_id,
      actorId: null,
      type: PODCAST_NOTIFICATION_TYPES.PUBLISHED,
      postId: result.postId,
      payload: { draftId: draftRow.id, postId: result.postId, postTitle: title, url: result.postPath ?? '/podcasts' },
    })
    await markPublishedNotificationSent(draftRow.id)
  }

  return { draft: await loadPodcastDraftById(draftRow.id, draftRow.creator_user_id), publishedPostId: result.postId }
}