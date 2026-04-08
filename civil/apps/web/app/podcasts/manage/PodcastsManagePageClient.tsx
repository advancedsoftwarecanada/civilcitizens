'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Block from '../../_components/Block'
import Modal from '../../_components/Modal'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'

type PodcastDraftItem = {
  id: string
  coverMediaAssetId: string | null
  title: string
  description: string
  status: 'draft' | 'uploading' | 'processing' | 'ready' | 'published' | 'failed'
  failureReason: string | null
  createdAt: string
  updatedAt: string
  publishedPostId: string | null
  publishedPostPath: string | null
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

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const COVER_IMAGE_LIMIT = 20 * 1024 * 1024

function pickPhotoVariantUrl(variants?: Record<string, { url?: string | null } | null>) {
  if (!variants) return null
  const preference = ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md', 'avatar@2x', 'avatar@1x']
  for (const key of preference) {
    const candidate = variants[key]?.url
    if (candidate) return candidate
  }
  const fallback = Object.values(variants).find((variant) => variant?.url)
  return fallback?.url ?? null
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type PodcastDraftResponse = {
  items?: PodcastDraftItem[]
}

type PodcastAnalytics = {
  postId: string
  title: string
  publishedAt: string
  metrics: {
    impressions: number
    watches: number
    totalWatchTimeSeconds: number
    averageWatchTimeSeconds: number
    averageDropoffTimeSeconds: number
    completedWatches: number
    completionRatePercent: number
  }
  series: Array<{
    date: string
    label: string
    impressions: number
    watches: number
    completedWatches: number
  }>
}

const STATUS_LABELS: Record<PodcastDraftItem['status'], string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready to publish',
  published: 'Published',
  failed: 'Failed',
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDuration(durationMs: number | null | undefined) {
  if (!durationMs || durationMs <= 0) return null
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatSeconds(totalSeconds: number | null | undefined) {
  if (!totalSeconds || totalSeconds <= 0) return '0s'
  const rounded = Math.round(totalSeconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60
  if (hours > 0) return `${hours}h:${String(minutes).padStart(2, '0')}m:${String(seconds).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m:${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

function formatMetricNumber(value: number) {
  return new Intl.NumberFormat('en-CA').format(Math.round(value))
}

function PodcastAnalyticsChart({ series }: { series: PodcastAnalytics['series'] }) {
  const maxValue = Math.max(1, ...series.flatMap((point) => [point.impressions, point.watches]))
  const width = 640
  const height = 240
  const paddingX = 32
  const paddingTop = 18
  const paddingBottom = 34
  const innerWidth = width - paddingX * 2
  const innerHeight = height - paddingTop - paddingBottom
  const pointStep = series.length > 1 ? innerWidth / (series.length - 1) : 0
  const pointsFor = (key: 'impressions' | 'watches') =>
    series
      .map((point, index) => {
        const x = paddingX + pointStep * index
        const y = paddingTop + innerHeight - (Math.max(0, point[key]) / maxValue) * innerHeight
        return `${x},${y}`
      })
      .join(' ')

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-500" />Impressions</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[var(--cc-primary)]" />Watches</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-60 w-full overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = paddingTop + innerHeight - innerHeight * tick
          return <line key={tick} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="rgba(148,163,184,0.25)" strokeDasharray="4 4" />
        })}
        <polyline fill="none" stroke="#38bdf8" strokeWidth="3" points={pointsFor('impressions')} />
        <polyline fill="none" stroke="var(--cc-primary)" strokeWidth="3" points={pointsFor('watches')} />
        {series.map((point, index) => {
          const x = paddingX + pointStep * index
          return (
            <text key={point.date} x={x} y={height - 10} textAnchor="middle" className="fill-slate-500 text-[11px] font-medium">
              {point.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

function estimateProcessingProgress(item: PodcastDraftItem, now: number) {
  if (item.status === 'published' || item.status === 'ready') {
    return { percent: 100, label: item.status === 'published' ? 'Published' : 'Ready' }
  }
  if (item.status === 'failed') {
    return { percent: null, label: 'Failed' }
  }
  if (!item.mediaAsset) {
    return { percent: null, label: null }
  }

  const transcodeJob = item.mediaAsset.transcodeJob
  if (!transcodeJob) {
    if (item.status === 'uploading') return { percent: 5, label: 'Waiting for upload' }
    if (item.status === 'processing') return { percent: 18, label: 'Queued for processing' }
    return { percent: null, label: null }
  }

  if (transcodeJob.status === 'COMPLETED') return { percent: 100, label: 'Ready' }
  if (transcodeJob.status === 'FAILED') return { percent: null, label: 'Failed' }

  const queuedAt = parseDateValue(transcodeJob.queuedAt)
  const startedAt = parseDateValue(transcodeJob.startedAt)
  if (transcodeJob.status === 'QUEUED') {
    const elapsed = queuedAt ? Math.max(0, now - queuedAt) : 0
    const percent = Math.min(24, 6 + Math.round((elapsed / (12 * 60 * 1000)) * 18))
    return { percent, label: 'Queued for processing' }
  }

  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0
  const durationMs = item.mediaAsset.durationMs && item.mediaAsset.durationMs > 0 ? item.mediaAsset.durationMs : 45 * 60 * 1000
  const expectedMs = Math.min(Math.max(durationMs * 0.22, 10 * 60 * 1000), 150 * 60 * 1000)
  const percent = Math.min(96, 25 + Math.round((Math.min(elapsed, expectedMs) / expectedMs) * 71))
  return { percent, label: 'Estimated processing' }
}

export default function PodcastsManagePageClient() {
  const router = useRouter()
  const [items, setItems] = useState<PodcastDraftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({})
  const [draftDescriptions, setDraftDescriptions] = useState<Record<string, string>>({})
  const [coverUploadingId, setCoverUploadingId] = useState<string | null>(null)
  const [analyticsDraftId, setAnalyticsDraftId] = useState<string | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsData, setAnalyticsData] = useState<PodcastAnalytics | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const loadDrafts = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setItems([])
      setLoading(false)
      return
    }

    setLoading((current) => current || items.length === 0)
    try {
      const res = await fetch(buildApiUrl('/podcasts/drafts'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const { json, text } = await parseApiResponse<PodcastDraftResponse>(res)
      if (!res.ok) {
        pushToast(typeof text === 'string' && text ? text : 'Unable to load podcast drafts right now.', 'error')
        setItems([])
        return
      }
      const nextItems = Array.isArray(json?.items) ? json.items : []
      setItems(nextItems)
      setDraftTitles((current) => {
        const next = { ...current }
        for (const item of nextItems) {
          if (!(item.id in next)) next[item.id] = item.title ?? ''
        }
        return next
      })
      setDraftDescriptions((current) => {
        const next = { ...current }
        for (const item of nextItems) {
          if (!(item.id in next)) next[item.id] = item.description ?? ''
        }
        return next
      })
    } catch (error) {
      console.error('podcast_drafts_load_failed', error)
      pushToast('Unable to load podcast drafts right now.', 'error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [items.length])

  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts])

  useEffect(() => {
    const refreshHandle = window.setInterval(() => {
      void loadDrafts()
    }, 20000)
    const clockHandle = window.setInterval(() => {
      setNow(Date.now())
    }, 15000)
    return () => {
      window.clearInterval(refreshHandle)
      window.clearInterval(clockHandle)
    }
  }, [loadDrafts])

  const saveDescription = useCallback(async (id: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    setSavingId(id)
    try {
      const res = await fetch(buildApiUrl(`/podcasts/drafts/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: draftTitles[id] ?? '', description: draftDescriptions[id] ?? '' }),
      })
      const { json } = await parseApiResponse<{ draft?: PodcastDraftItem; publishedPostId?: string | null }>(res)
      if (!res.ok) {
        pushToast('Unable to save this podcast draft right now.', 'error')
        return
      }
      const nextDraft = json?.draft
      if (nextDraft) {
        setItems((current) => current.map((item) => (item.id === nextDraft.id ? nextDraft : item)))
        setDraftTitles((current) => ({ ...current, [nextDraft.id]: nextDraft.title ?? '' }))
        setDraftDescriptions((current) => ({ ...current, [nextDraft.id]: nextDraft.description ?? '' }))
      } else {
        await loadDrafts()
      }
      pushToast(json?.publishedPostId ? 'Podcast published.' : 'Podcast draft saved.', 'success')
      router.refresh()
    } catch (error) {
      console.error('podcast_draft_save_failed', error)
      pushToast('Unable to save this podcast draft right now.', 'error')
    } finally {
      setSavingId(null)
    }
  }, [draftDescriptions, draftTitles, loadDrafts, router])

  const publishDraft = useCallback(async (id: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    setPublishingId(id)
    try {
      const res = await fetch(buildApiUrl(`/podcasts/drafts/${encodeURIComponent(id)}/publish`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const { json } = await parseApiResponse<{ draft?: PodcastDraftItem }>(res)
      if (!res.ok) {
        pushToast('This podcast still needs processing, a title, or a description before it can publish.', 'error')
        return
      }
      const nextDraft = json?.draft
      if (nextDraft) {
        setItems((current) => current.map((item) => (item.id === nextDraft.id ? nextDraft : item)))
        setDraftTitles((current) => ({ ...current, [nextDraft.id]: nextDraft.title ?? '' }))
        setDraftDescriptions((current) => ({ ...current, [nextDraft.id]: nextDraft.description ?? '' }))
      } else {
        await loadDrafts()
      }
      pushToast('Podcast published.', 'success')
      router.refresh()
    } catch (error) {
      console.error('podcast_draft_publish_failed', error)
      pushToast('Unable to publish this podcast right now.', 'error')
    } finally {
      setPublishingId(null)
    }
  }, [loadDrafts, router])

  const uploadCoverImage = useCallback(async (id: string, file: File) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    if (file.size > COVER_IMAGE_LIMIT) {
      pushToast('That cover file is too large. Max size is 20MB.', 'error')
      return
    }
    if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
      pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
      return
    }

    setCoverUploadingId(id)
    try {
      const initRes = await fetch(buildApiUrl('/media/uploads'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          category: 'post_image',
          mime: file.type || 'application/octet-stream',
          byteSize: file.size,
          filename: file.name,
        }),
      })
      if (!initRes.ok) throw new Error('Upload failed.')

      const initPayload = (await initRes.json().catch(() => null)) as {
        assetId?: string
        upload?: { url?: string; method?: string; headers?: Record<string, string> }
        proxyPath?: string
      } | null
      const assetId = initPayload?.assetId
      if (!assetId) throw new Error('Upload failed.')

      let uploaded = false
      if (initPayload?.upload?.url) {
        try {
          const res = await fetch(initPayload.upload.url, {
            method: initPayload.upload.method || 'PUT',
            headers: initPayload.upload.headers,
            body: file,
          })
          uploaded = res.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded && initPayload?.proxyPath) {
        const proxyRes = await fetch(buildApiUrl(initPayload.proxyPath), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.type || 'application/octet-stream',
            'x-upload-byte-size': String(file.size),
          },
          body: file,
        })
        uploaded = proxyRes.ok
      }

      if (!uploaded) throw new Error('Upload failed.')

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ assetId }),
      })
      if (!completeRes.ok) throw new Error('Upload failed.')

      let coverUrl: string | null = null
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const pollRes = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(assetId)}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (pollRes.ok) {
          const payload = (await pollRes.json().catch(() => null)) as { asset?: { status?: string; variants?: Record<string, { url?: string | null } | null>; failureReason?: string | null } } | null
          if (payload?.asset?.status === 'ready') {
            coverUrl = pickPhotoVariantUrl(payload.asset.variants)
            break
          }
          if (payload?.asset?.status === 'failed') {
            throw new Error(payload.asset.failureReason || 'Cover processing failed.')
          }
        }
        await wait(2000)
      }

      const patchRes = await fetch(buildApiUrl(`/podcasts/drafts/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ coverMediaAssetId: assetId }),
      })
      const { json } = await parseApiResponse<{ draft?: PodcastDraftItem }>(patchRes)
      if (!patchRes.ok) throw new Error('Unable to save this cover photo right now.')
      const nextDraft = json?.draft
      if (nextDraft) {
        setItems((current) => current.map((item) => (item.id === nextDraft.id ? nextDraft : item)))
      } else {
        await loadDrafts()
      }
      pushToast(coverUrl ? 'Cover photo updated.' : 'Cover photo saved.', 'success')
    } catch (error) {
      console.error('podcast_draft_cover_upload_failed', error)
      pushToast(error instanceof Error ? error.message : 'Unable to upload a cover photo right now.', 'error')
    } finally {
      setCoverUploadingId(null)
    }
  }, [loadDrafts])

  const openAnalytics = useCallback(async (item: PodcastDraftItem) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    setAnalyticsDraftId(item.id)
    setAnalyticsLoading(true)
    setAnalyticsData(null)
    try {
      const res = await fetch(buildApiUrl(`/podcasts/drafts/${encodeURIComponent(item.id)}/analytics`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const { json, text } = await parseApiResponse<{ analytics?: PodcastAnalytics }>(res)
      if (!res.ok) {
        pushToast(typeof text === 'string' && text ? text : 'Unable to load podcast analytics right now.', 'error')
        return
      }
      setAnalyticsData(json?.analytics ?? null)
    } catch (error) {
      console.error('podcast_analytics_load_failed', error)
      pushToast('Unable to load podcast analytics right now.', 'error')
    } finally {
      setAnalyticsLoading(false)
    }
  }, [])

  const sortedItems = useMemo(() => [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [items])

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-950">Podcast Drafts</h1>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading podcast drafts…</p> : null}

      {!loading && !sortedItems.length ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm leading-6 text-slate-600 shadow-sm">
          No podcast drafts yet.
        </div>
      ) : null}

      <div className="space-y-4">
        {sortedItems.map((item) => {
          const durationLabel = formatDuration(item.mediaAsset?.durationMs)
          const progress = estimateProcessingProgress(item, now)
          const hasTitle = (draftTitles[item.id] ?? '').trim().length > 0
          const hasDescription = (draftDescriptions[item.id] ?? '').trim().length > 0
          const canPublish = item.status === 'ready' && hasTitle && hasDescription
          const playerPosterUrl = item.coverImageUrl ?? item.mediaAsset?.thumbnailUrl ?? null
          return (
            <section key={item.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-950">{draftTitles[item.id]?.trim() || 'Untitled podcast draft'}</h2>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Updated {formatDate(item.updatedAt)}</p>
                  {item.mediaAsset ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Asset {item.mediaAsset.id.slice(0, 8)}
                      {durationLabel ? ` • ${durationLabel}` : ''}
                      {item.mediaAsset.width && item.mediaAsset.height ? ` • ${item.mediaAsset.width}x${item.mediaAsset.height}` : ''}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">No media asset attached yet.</p>
                  )}
                  {typeof progress.percent === 'number' ? (
                    <div className="mt-4 max-w-xl">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <span>{progress.label ?? 'Processing'}</span>
                        <span>{progress.percent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-[var(--cc-primary)] transition-[width] duration-500"
                          style={{ width: `${Math.max(6, Math.min(100, progress.percent))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  {item.failureReason ? <p className="mt-3 text-sm text-rose-600">{item.failureReason}</p> : null}
                </div>
                <div className="flex flex-wrap gap-3">
                  {item.publishedPostPath ? (
                    <Link
                      href={item.publishedPostPath}
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                    >
                      Open Post
                    </Link>
                  ) : null}
                  {item.publishedPostId ? (
                    <button
                      type="button"
                      onClick={() => void openAnalytics(item)}
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                    >
                      Analytics
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={savingId === item.id}
                    onClick={() => void saveDescription(item.id)}
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingId === item.id ? 'Saving…' : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    disabled={!canPublish || publishingId === item.id}
                    onClick={() => void publishDraft(item.id)}
                    className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {publishingId === item.id ? 'Publishing…' : 'Publish'}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4">

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-700">Cover Photo</p>
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950">
                      <span>{coverUploadingId === item.id ? 'Uploading…' : item.coverMediaAssetId ? 'Replace Cover' : 'Upload Cover'}</span>
                      <input
                        type="file"
                        accept={ACCEPTED_IMAGE_TYPES}
                        className="hidden"
                        disabled={coverUploadingId === item.id}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file) {
                            void uploadCoverImage(item.id, file)
                          }
                        }}
                      />
                    </label>
                  </div>
                  {item.coverImageUrl ? (
                    <img src={item.coverImageUrl} alt={`${draftTitles[item.id]?.trim() || 'Podcast draft'} cover`} className="h-44 w-full rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-44 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                      No cover photo yet.
                    </div>
                  )}
                </div>

                {item.mediaAsset?.playbackUrl ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-slate-700">Episode Preview</p>
                    {item.mediaAsset.sourceType === 'audio' ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        {playerPosterUrl ? <img src={playerPosterUrl} alt="Podcast cover" className="mb-4 h-48 w-full rounded-xl object-cover" /> : null}
                        <audio controls preload="metadata" className="w-full">
                          <source src={item.mediaAsset.playbackUrl} type={item.mediaAsset.mime} />
                        </audio>
                      </div>
                    ) : (
                      <video controls preload="metadata" playsInline poster={playerPosterUrl ?? undefined} className="w-full rounded-2xl bg-slate-950">
                        <source src={item.mediaAsset.playbackUrl} type={item.mediaAsset.mime} />
                      </video>
                    )}
                  </div>
                ) : item.mediaAsset ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                    The episode player will appear here when processing finishes.
                  </div>
                ) : null}

                <label className="block text-sm font-medium text-slate-700">
                  Title
                  <input
                    type="text"
                    value={draftTitles[item.id] ?? ''}
                    onChange={(event) => setDraftTitles((current) => ({ ...current, [item.id]: event.target.value.slice(0, 180) }))}
                    placeholder="Add the podcast title"
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Description
                  <textarea
                    value={draftDescriptions[item.id] ?? ''}
                    onChange={(event) => setDraftDescriptions((current) => ({ ...current, [item.id]: event.target.value }))}
                    rows={4}
                    placeholder="Add the podcast description that should go live with the episode."
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  />
                </label>
              </div>
            </section>
          )
        })}
      </div>

      <Modal
        open={analyticsDraftId !== null}
        onClose={() => {
          setAnalyticsDraftId(null)
          setAnalyticsData(null)
        }}
        title="Podcast Analytics"
        maxWidthClassName="max-w-5xl"
        closeOnBackdrop
        closeOnEscape
      >
        {analyticsLoading ? <p className="text-sm text-slate-500">Loading analytics…</p> : null}
        {!analyticsLoading && analyticsData ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">{analyticsData.title}</h3>
              <p className="mt-1 text-sm text-slate-500">Published {formatDate(analyticsData.publishedAt)}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Impressions</p><p className="mt-2 text-3xl font-semibold text-slate-950">{formatMetricNumber(analyticsData.metrics.impressions)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Watches</p><p className="mt-2 text-3xl font-semibold text-slate-950">{formatMetricNumber(analyticsData.metrics.watches)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total Play Time</p><p className="mt-2 text-3xl font-semibold text-slate-950">{formatSeconds(analyticsData.metrics.totalWatchTimeSeconds)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Average Watch Time</p><p className="mt-2 text-3xl font-semibold text-slate-950">{formatSeconds(analyticsData.metrics.averageWatchTimeSeconds)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Average Drop Off</p><p className="mt-2 text-3xl font-semibold text-slate-950">{formatSeconds(analyticsData.metrics.averageDropoffTimeSeconds)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Completed Watches</p><p className="mt-2 text-3xl font-semibold text-slate-950">{formatMetricNumber(analyticsData.metrics.completedWatches)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Completion Rate</p><p className="mt-2 text-3xl font-semibold text-slate-950">{analyticsData.metrics.completionRatePercent.toFixed(1)}%</p></div>
            </div>
            <PodcastAnalyticsChart series={analyticsData.series} />
          </div>
        ) : null}
        {!analyticsLoading && !analyticsData ? <p className="text-sm text-slate-500">No analytics yet.</p> : null}
      </Modal>
    </div>
  )
}

export function PodcastsManagePageRail() {
  const router = useRouter()

  return (
    <div className="sticky top-24 space-y-5">
      <Block title="Manage Podcasts">
        <div className="space-y-3">
          <Link
            href="/podcasts"
            className="inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Upload Podcast
          </Link>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back()
                return
              }
              void router.push('/podcasts')
            }}
            className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
          >
            Return
          </button>
        </div>
      </Block>
    </div>
  )
}