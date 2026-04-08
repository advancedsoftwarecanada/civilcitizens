import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type PodcastPostRow = {
  id: string
  authorId: string
  createdAt: Date
  title: string | null
  video: Prisma.JsonValue | null
}

type PodcastDailyAnalyticsRow = {
  day: Date
  impressions: number | bigint | string | null
  watches: number | bigint | string | null
  completed_watches: number | bigint | string | null
  total_watch_seconds: number | string | null
  total_dropoff_seconds: number | string | null
  dropoff_count: number | bigint | string | null
}

let podcastAnalyticsTablesReady: Promise<void> | null = null

function coerceNumber(value: number | bigint | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function asDayKey(value: Date) {
  return value.toISOString().slice(0, 10)
}

function startOfUtcDay(value: Date) {
  return new Date(`${asDayKey(value)}T00:00:00.000Z`)
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000)
}

function isPodcastVideo(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (value as Record<string, unknown>).kind === 'podcast'
}

async function loadPodcastPosts(postIds: string[]) {
  if (!postIds.length) return []
  const rows = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: { id: true, authorId: true, createdAt: true, title: true, video: true },
  })
  return rows.filter((row: PodcastPostRow) => isPodcastVideo(row.video)) as PodcastPostRow[]
}

export async function ensurePodcastAnalyticsTables() {
  if (podcastAnalyticsTablesReady) return podcastAnalyticsTablesReady

  podcastAnalyticsTablesReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS civil_podcast_post_daily_analytics (
        post_id TEXT NOT NULL,
        creator_user_id TEXT NOT NULL,
        day DATE NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0,
        watches INTEGER NOT NULL DEFAULT 0,
        completed_watches INTEGER NOT NULL DEFAULT 0,
        total_watch_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_dropoff_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
        dropoff_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (post_id, day)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS civil_podcast_playback_session (
        session_id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        creator_user_id TEXT NOT NULL,
        viewer_user_id TEXT,
        watch_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
        max_position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_podcast_daily_creator_day_idx ON civil_podcast_post_daily_analytics (creator_user_id, day DESC)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_podcast_daily_post_day_idx ON civil_podcast_post_daily_analytics (post_id, day DESC)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS civil_podcast_session_post_created_idx ON civil_podcast_playback_session (post_id, created_at DESC)`)
  })().catch((error) => {
    podcastAnalyticsTablesReady = null
    throw error
  })

  return podcastAnalyticsTablesReady
}

export async function recordPodcastImpressionAggregates(postIds: string[], occurredAt = new Date()) {
  await ensurePodcastAnalyticsTables()
  const podcastPosts = await loadPodcastPosts(postIds)
  if (!podcastPosts.length) return 0

  const dayKey = asDayKey(occurredAt)
  for (const post of podcastPosts) {
    await prisma.$executeRaw`
      INSERT INTO civil_podcast_post_daily_analytics (post_id, creator_user_id, day, impressions, updated_at)
      VALUES (${post.id}, ${post.authorId}, ${dayKey}::date, 1, NOW())
      ON CONFLICT (post_id, day)
      DO UPDATE SET impressions = civil_podcast_post_daily_analytics.impressions + 1, updated_at = NOW()
    `
  }

  return podcastPosts.length
}

export async function recordPodcastPlaybackSession(args: {
  sessionId: string
  postId: string
  viewerUserId: string
  watchSeconds: number
  maxPositionSeconds: number
  completed: boolean
  occurredAt?: Date
}) {
  await ensurePodcastAnalyticsTables()
  const post = await prisma.post.findUnique({
    where: { id: args.postId },
    select: { id: true, authorId: true, video: true },
  })
  if (!post || !isPodcastVideo(post.video)) {
    return { tracked: false, reason: 'podcast_post_not_found' as const }
  }

  const watchSeconds = Math.max(0, Math.min(args.watchSeconds, 6 * 60 * 60))
  const maxPositionSeconds = Math.max(0, Math.min(args.maxPositionSeconds, 6 * 60 * 60))
  const completed = Boolean(args.completed)
  const occurredAt = args.occurredAt ?? new Date()
  const insertedRows = await prisma.$queryRaw<Array<{ session_id: string }>>`
    INSERT INTO civil_podcast_playback_session (
      session_id,
      post_id,
      creator_user_id,
      viewer_user_id,
      watch_seconds,
      max_position_seconds,
      completed,
      created_at
    )
    VALUES (
      ${args.sessionId},
      ${post.id},
      ${post.authorId},
      ${args.viewerUserId},
      ${watchSeconds},
      ${maxPositionSeconds},
      ${completed},
      ${occurredAt}
    )
    ON CONFLICT (session_id) DO NOTHING
    RETURNING session_id
  `

  if (!insertedRows.length) {
    return { tracked: false, reason: 'duplicate_session' as const }
  }

  const dayKey = asDayKey(occurredAt)
  const dropoffSeconds = completed ? 0 : maxPositionSeconds
  const dropoffCount = completed ? 0 : 1
  await prisma.$executeRaw`
    INSERT INTO civil_podcast_post_daily_analytics (
      post_id,
      creator_user_id,
      day,
      watches,
      completed_watches,
      total_watch_seconds,
      total_dropoff_seconds,
      dropoff_count,
      updated_at
    )
    VALUES (
      ${post.id},
      ${post.authorId},
      ${dayKey}::date,
      1,
      ${completed ? 1 : 0},
      ${watchSeconds},
      ${dropoffSeconds},
      ${dropoffCount},
      NOW()
    )
    ON CONFLICT (post_id, day)
    DO UPDATE SET
      watches = civil_podcast_post_daily_analytics.watches + 1,
      completed_watches = civil_podcast_post_daily_analytics.completed_watches + ${completed ? 1 : 0},
      total_watch_seconds = civil_podcast_post_daily_analytics.total_watch_seconds + ${watchSeconds},
      total_dropoff_seconds = civil_podcast_post_daily_analytics.total_dropoff_seconds + ${dropoffSeconds},
      dropoff_count = civil_podcast_post_daily_analytics.dropoff_count + ${dropoffCount},
      updated_at = NOW()
  `

  return { tracked: true, reason: null }
}

export async function loadPodcastAnalyticsForPost(args: { postId: string; creatorUserId: string }) {
  await ensurePodcastAnalyticsTables()
  const post = await prisma.post.findFirst({
    where: { id: args.postId, authorId: args.creatorUserId },
    select: { id: true, authorId: true, createdAt: true, title: true, video: true },
  })
  if (!post || !isPodcastVideo(post.video)) return null

  const totalsRows = await prisma.$queryRaw<Array<{
    impressions: number | bigint | string | null
    watches: number | bigint | string | null
    completed_watches: number | bigint | string | null
    total_watch_seconds: number | string | null
    total_dropoff_seconds: number | string | null
    dropoff_count: number | bigint | string | null
  }>>`
    SELECT
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(watches), 0) AS watches,
      COALESCE(SUM(completed_watches), 0) AS completed_watches,
      COALESCE(SUM(total_watch_seconds), 0) AS total_watch_seconds,
      COALESCE(SUM(total_dropoff_seconds), 0) AS total_dropoff_seconds,
      COALESCE(SUM(dropoff_count), 0) AS dropoff_count
    FROM civil_podcast_post_daily_analytics
    WHERE post_id = ${post.id}
  `

  const totals: (typeof totalsRows)[number] | null = totalsRows[0] ?? null
  const publishedDay = startOfUtcDay(post.createdAt)
  const seriesEnd = addUtcDays(publishedDay, 6)
  const seriesRows = await prisma.$queryRaw<PodcastDailyAnalyticsRow[]>`
    SELECT day, impressions, watches, completed_watches, total_watch_seconds, total_dropoff_seconds, dropoff_count
    FROM civil_podcast_post_daily_analytics
    WHERE post_id = ${post.id}
      AND day >= ${asDayKey(publishedDay)}::date
      AND day <= ${asDayKey(seriesEnd)}::date
    ORDER BY day ASC
  `

  const rowByDay = new Map<string, PodcastDailyAnalyticsRow>(seriesRows.map((row: PodcastDailyAnalyticsRow) => [asDayKey(new Date(row.day)), row]))
  const series = Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(publishedDay, index)
    const key = asDayKey(date)
    const row = rowByDay.get(key)
    return {
      date: key,
      label: date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      impressions: coerceNumber(row?.impressions),
      watches: coerceNumber(row?.watches),
      completedWatches: coerceNumber(row?.completed_watches),
    }
  })

  const impressions = coerceNumber(totals?.impressions)
  const watches = coerceNumber(totals?.watches)
  const completedWatches = coerceNumber(totals?.completed_watches)
  const totalWatchTimeSeconds = coerceNumber(totals?.total_watch_seconds)
  const totalDropoffSeconds = coerceNumber(totals?.total_dropoff_seconds)
  const dropoffCount = coerceNumber(totals?.dropoff_count)

  return {
    postId: post.id,
    title: post.title?.trim() || 'Untitled podcast',
    publishedAt: post.createdAt.toISOString(),
    metrics: {
      impressions,
      watches,
      totalWatchTimeSeconds,
      averageWatchTimeSeconds: watches > 0 ? totalWatchTimeSeconds / watches : 0,
      averageDropoffTimeSeconds: dropoffCount > 0 ? totalDropoffSeconds / dropoffCount : 0,
      completedWatches,
      completionRatePercent: watches > 0 ? (completedWatches / watches) * 100 : 0,
    },
    series,
  }
}