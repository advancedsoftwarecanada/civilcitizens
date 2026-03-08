"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { useAdminAccess } from '../_hooks/useAdminAccess'
import AdminUserInspectModal from './AdminUserInspectModal'
import AdminWideShell from './AdminWideShell'

type SeriesPoint = { date: string; count: number }
type MetricSeries = { total: number; today: number; series: SeriesPoint[] }
type DetailMetric = 'users' | 'posts' | 'comments' | 'reactions' | 'follows' | 'jobsAdded' | 'applicants' | 'applicationsViewed' | 'hired'

type ReportSummary = {
  generatedAt: string
  users: MetricSeries
  posts: MetricSeries
  comments: MetricSeries
  reactions: MetricSeries
  follows: MetricSeries
  jobs: {
    added: MetricSeries
    applicants: MetricSeries
    applicationsViewed: {
      views: MetricSeries
      organizations: { total: number; today: number }
    }
    hired: MetricSeries
  }
  traffic: {
    routes: Array<{ path: string; views: number }>
    posts: Array<{ postId: string; title: string | null; views: number }>
  }
}

type AdminUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

type DetailResponse = {
  metric: DetailMetric
  generatedAt: string
  items: unknown[]
}

type UserRow = AdminUser & {
  createdAt: string
  lastLoginAt: string | null
  premiumStatus: string
  postCount: number
  commentCount: number
  organizationsOwned: number
  reportsFiled: number
  reportsAgainst: number
}

type PostRow = {
  id: string
  createdAt: string
  title: string | null
  preview: string
  url: string | null
  jurisdiction: string
  moderationStatus: string
  commentCount: number
  reactionCount: number
  score: number
  author: AdminUser
  organization: { id: string; name: string; slug: string; href: string | null } | null
  flags: {
    count: number
    reasons: string[]
    openCount: number
    reviewedCount: number
    latestReportedAt: string | null
  }
}

type CommentRow = {
  id: string
  createdAt: string
  body: string
  score: number
  author: AdminUser
  post: { id: string; title: string; url: string | null }
}

type ReactionRow = {
  createdAt: string
  type: string
  user: AdminUser
  post: { id: string; title: string; url: string | null }
}

type FollowRow = {
  id: string
  createdAt: string
  type: 'community' | 'organization'
  user: AdminUser
  label: string
  href: string | null
}

type JobRow = {
  id: string
  createdAt: string
  title: string
  status: string
  publishedAt: string | null
  applicantCount: number
  organization: { id: string; name: string; href: string | null }
  createdBy: AdminUser
}

type ApplicantRow = {
  id: string
  createdAt: string
  status: string
  applicant: AdminUser
  job: { id: string; title: string; status: string }
  organization: { id: string; name: string; href: string | null }
}

type ApplicationViewRow = {
  id: string
  createdAt: string
  viewer: AdminUser | null
  job: { id: string; title: string } | null
  organization: { id: string; name: string; href: string | null }
}

type HireRow = {
  id: string
  createdAt: string
  applicant: AdminUser | null
  job: { id: string; title: string } | null
  organization: { id: string; name: string; href: string | null }
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unauthorized' | 'forbidden'

const DAY_MS = 24 * 60 * 60 * 1000
const defaultStart = new Date(Date.now() - 29 * DAY_MS)
const defaultEnd = new Date()
const EMPTY_METRIC_SERIES: MetricSeries = { total: 0, today: 0, series: [] }
const FLAG_REASON_OPTIONS = [
  'ALL',
  'spam_or_scam',
  'hate_or_harassment',
  'violence_or_threats',
  'sexual_or_explicit',
  'child_safety',
  'impersonation',
  'misinformation',
  'illegal_goods_or_services',
  'copyright_or_ip',
  'other',
] as const

const METRIC_DEFINITIONS: Array<{ key: DetailMetric; title: string; description: string }> = [
  { key: 'users', title: 'Users', description: 'New accounts created in the selected range.' },
  { key: 'posts', title: 'Posts', description: 'Posts with moderation flags, author links, and engagement.' },
  { key: 'comments', title: 'Comments', description: 'Latest comments tied back to the source post.' },
  { key: 'reactions', title: 'Reactions', description: 'Recent reaction events and the users behind them.' },
  { key: 'follows', title: 'Follows', description: 'Community and organization follow activity.' },
  { key: 'jobsAdded', title: 'Jobs added', description: 'Job postings created by organizations.' },
  { key: 'applicants', title: 'Applicants', description: 'Submitted job applications and applicant accounts.' },
  { key: 'applicationsViewed', title: 'Org application views', description: 'Application view events by organization staff.' },
  { key: 'hired', title: 'Applicants hired', description: 'Hiring events tied to applicants and jobs.' },
]

function toSeriesPoints(value: unknown): SeriesPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((point) => {
      if (!point || typeof point !== 'object') return null
      const date = typeof (point as { date?: unknown }).date === 'string' ? (point as { date: string }).date : ''
      const countRaw = (point as { count?: unknown }).count
      const count = typeof countRaw === 'number' ? countRaw : Number(countRaw ?? 0)
      if (!date) return null
      return { date, count: Number.isFinite(count) ? count : 0 }
    })
    .filter((point): point is SeriesPoint => Boolean(point))
}

function toMetricSeries(value: unknown): MetricSeries {
  if (!value || typeof value !== 'object') return EMPTY_METRIC_SERIES
  const source = value as { total?: unknown; today?: unknown; series?: unknown }
  const total = typeof source.total === 'number' ? source.total : Number(source.total ?? 0)
  const today = typeof source.today === 'number' ? source.today : Number(source.today ?? 0)
  return {
    total: Number.isFinite(total) ? total : 0,
    today: Number.isFinite(today) ? today : 0,
    series: toSeriesPoints(source.series),
  }
}

function normalizeReportSummary(payload: unknown): ReportSummary | null {
  if (!payload || typeof payload !== 'object') return null
  const source = payload as Record<string, unknown>
  const jobsSource = source.jobs && typeof source.jobs === 'object' ? (source.jobs as Record<string, unknown>) : {}
  const applicationsViewedSource =
    jobsSource.applicationsViewed && typeof jobsSource.applicationsViewed === 'object'
      ? (jobsSource.applicationsViewed as Record<string, unknown>)
      : {}
  const orgSource =
    applicationsViewedSource.organizations && typeof applicationsViewedSource.organizations === 'object'
      ? (applicationsViewedSource.organizations as Record<string, unknown>)
      : {}
  const trafficSource = source.traffic && typeof source.traffic === 'object' ? (source.traffic as Record<string, unknown>) : {}

  return {
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : new Date().toISOString(),
    users: toMetricSeries(source.users),
    posts: toMetricSeries(source.posts),
    comments: toMetricSeries(source.comments),
    reactions: toMetricSeries(source.reactions),
    follows: toMetricSeries(source.follows),
    jobs: {
      added: toMetricSeries(jobsSource.added),
      applicants: toMetricSeries(jobsSource.applicants),
      applicationsViewed: {
        views: toMetricSeries(applicationsViewedSource.views),
        organizations: {
          total: Number.isFinite(Number(orgSource.total ?? 0)) ? Number(orgSource.total ?? 0) : 0,
          today: Number.isFinite(Number(orgSource.today ?? 0)) ? Number(orgSource.today ?? 0) : 0,
        },
      },
      hired: toMetricSeries(jobsSource.hired),
    },
    traffic: {
      routes: Array.isArray(trafficSource.routes)
        ? trafficSource.routes
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null
              const path = typeof (entry as { path?: unknown }).path === 'string' ? (entry as { path: string }).path : ''
              const views = Number((entry as { views?: unknown }).views ?? 0)
              if (!path) return null
              return { path, views: Number.isFinite(views) ? views : 0 }
            })
            .filter((entry): entry is { path: string; views: number } => Boolean(entry))
        : [],
      posts: Array.isArray(trafficSource.posts)
        ? trafficSource.posts
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null
              const postId = typeof (entry as { postId?: unknown }).postId === 'string' ? (entry as { postId: string }).postId : ''
              const titleRaw = (entry as { title?: unknown }).title
              const views = Number((entry as { views?: unknown }).views ?? 0)
              if (!postId) return null
              return {
                postId,
                title: typeof titleRaw === 'string' ? titleRaw : null,
                views: Number.isFinite(views) ? views : 0,
              }
            })
            .filter((entry): entry is { postId: string; title: string | null; views: number } => Boolean(entry))
        : [],
    },
  }
}

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatReasonLabel(value: string) {
  const labels: Record<string, string> = {
    spam_or_scam: 'Spam or scam',
    hate_or_harassment: 'Hate or harassment',
    violence_or_threats: 'Violence or threats',
    sexual_or_explicit: 'Sexual or explicit',
    child_safety: 'Child safety',
    impersonation: 'Impersonation',
    misinformation: 'Misinformation',
    illegal_goods_or_services: 'Illegal goods or services',
    copyright_or_ip: 'Copyright or IP',
    other: 'Other',
  }
  return labels[value] ?? value.replace(/_/g, ' ')
}

function formatReactionType(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatUserLabel(user: AdminUser) {
  return user.name?.trim() || `@${user.handle}`
}

function toCount(value: unknown) {
  const count = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(count) ? count : 0
}

function MetricCardButton({
  title,
  total,
  today,
  active,
  onClick,
}: {
  title: string
  total: number
  today: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-3xl border px-5 py-4 text-left shadow-subtle transition',
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white/90 text-slate-900 hover:border-slate-300 hover:shadow-lg',
      )}
    >
      <p className={clsx('text-xs font-semibold uppercase tracking-[0.3em]', active ? 'text-white/65' : 'text-slate-400')}>{title}</p>
      <div className="mt-2 flex items-baseline gap-3">
        <p className="text-4xl font-semibold">{total.toLocaleString()}</p>
        <span className={clsx('text-sm font-semibold', active ? 'text-emerald-300' : 'text-emerald-600')}>
          +{today.toLocaleString()} today
        </span>
      </div>
    </button>
  )
}

function UserInspectButton({ user, onInspect }: { user: AdminUser; onInspect: (userId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onInspect(user.id)}
      className="text-left text-sm font-semibold text-[var(--cc-primary)] hover:underline"
    >
      {formatUserLabel(user)}
      <span className="ml-2 text-xs font-normal text-slate-500">@{user.handle}</span>
    </button>
  )
}

function TrafficTable({ title, rows }: { title: string; rows: Array<{ key: string; label: string; views: number }> }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">{title}</p>
        <span className="text-xs text-slate-500">{rows.length.toLocaleString()} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3 text-right">Views</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100">
                <td className="px-4 py-3 text-xs text-slate-500">{row.key}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{row.label}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.views.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailStatus, setDetailStatus] = useState<Status>('idle')
  const [startDate, setStartDate] = useState(toDateInputValue(defaultStart))
  const [endDate, setEndDate] = useState(toDateInputValue(defaultEnd))
  const [csvStatus, setCsvStatus] = useState<'idle' | 'loading'>('idle')
  const [activeMetric, setActiveMetric] = useState<DetailMetric>('posts')
  const [flagReason, setFlagReason] = useState<(typeof FLAG_REASON_OPTIONS)[number]>('ALL')
  const [inspectUserId, setInspectUserId] = useState<string | null>(null)

  const activeMetricDefinition = useMemo(
    () => METRIC_DEFINITIONS.find((entry) => entry.key === activeMetric) ?? METRIC_DEFINITIONS[0],
    [activeMetric],
  )

  const loadSummary = useCallback(
    async (rangeStart: string, rangeEnd: string, signal?: AbortSignal) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        setSummaryStatus('unauthorized')
        return
      }

      setSummaryStatus('loading')

      const params = new URLSearchParams()
      if (rangeStart) params.set('start', rangeStart)
      if (rangeEnd) params.set('end', rangeEnd)

      try {
        const baseUrl = buildApiUrl('/admin/reports/summary')
        const requestUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl
        const response = await fetch(requestUrl, {
          headers: { authorization: `Bearer ${authToken}` },
          cache: 'no-store',
          signal,
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          setSummaryStatus('unauthorized')
          return
        }
        if (response.status === 403) {
          setSummaryStatus('forbidden')
          return
        }
        if (!response.ok) {
          setSummaryStatus('error')
          return
        }
        const data = normalizeReportSummary(await response.json().catch(() => null))
        if (!data) {
          setSummaryStatus('error')
          return
        }
        setSummary(data)
        setSummaryStatus('ready')
      } catch (error) {
        if (signal?.aborted) return
        console.error('[admin/analytics] failed to load summary', error)
        setSummaryStatus('error')
      }
    },
    [token],
  )

  const loadDetail = useCallback(
    async (metric: DetailMetric, rangeStart: string, rangeEnd: string, nextFlagReason: (typeof FLAG_REASON_OPTIONS)[number], signal?: AbortSignal) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        setDetailStatus('unauthorized')
        return
      }

      setDetailStatus('loading')
      setDetail(null)

      const params = new URLSearchParams({
        metric,
        limit: metric === 'posts' ? '150' : '100',
      })
      if (rangeStart) params.set('start', rangeStart)
      if (rangeEnd) params.set('end', rangeEnd)
      if (metric === 'posts' && nextFlagReason !== 'ALL') params.set('flagReason', nextFlagReason)

      try {
        const response = await fetch(`${buildApiUrl('/admin/reports/detail')}?${params.toString()}`, {
          headers: { authorization: `Bearer ${authToken}` },
          cache: 'no-store',
          signal,
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          setDetailStatus('unauthorized')
          return
        }
        if (response.status === 403) {
          setDetailStatus('forbidden')
          return
        }
        if (!response.ok) {
          setDetailStatus('error')
          setDetail(null)
          return
        }
        const payload = (await response.json().catch(() => null)) as DetailResponse | null
        if (!payload || !Array.isArray(payload.items)) {
          setDetailStatus('error')
          setDetail(null)
          return
        }
        setDetail(payload)
        setDetailStatus('ready')
      } catch (error) {
        if (signal?.aborted) return
        console.error('[admin/analytics] failed to load detail', error)
        setDetailStatus('error')
        setDetail(null)
      }
    },
    [token],
  )

  useEffect(() => {
    if (accessLoading || !isSuperAdmin) return
    const controller = new AbortController()
    void loadSummary(startDate, endDate, controller.signal)
    return () => controller.abort()
  }, [accessLoading, endDate, isSuperAdmin, loadSummary, startDate])

  useEffect(() => {
    if (accessLoading || !isSuperAdmin) return
    const controller = new AbortController()
    void loadDetail(activeMetric, startDate, endDate, flagReason, controller.signal)
    return () => controller.abort()
  }, [accessLoading, activeMetric, endDate, flagReason, isSuperAdmin, loadDetail, startDate])

  const handleExportCsv = useCallback(async () => {
    const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
    if (!authToken) {
      redirectToAuthModal('login')
      return
    }

    setCsvStatus('loading')
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate, format: 'csv' })
      const response = await fetch(`${buildApiUrl('/admin/reports/summary')}?${params.toString()}`, {
        headers: { authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) throw new Error('csv_failed')

      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `civil-report-${startDate}-to-${endDate}.csv`
      link.click()
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.error('[admin/analytics] csv export failed', error)
    } finally {
      setCsvStatus('idle')
    }
  }, [endDate, startDate, token])

  const renderDetailTable = () => {
    if (detailStatus === 'loading' || detailStatus === 'idle') {
      return <div className="rounded-3xl border border-slate-200 bg-slate-50 px-6 py-8 text-sm text-slate-500">Loading {activeMetricDefinition.title.toLowerCase()}…</div>
    }
    if (detailStatus === 'error') {
      return <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-600">Unable to load this detail view.</div>
    }
    if (!detail || detail.metric !== activeMetric || !detail.items.length) {
      return <div className="rounded-3xl border border-slate-200 bg-slate-50 px-6 py-8 text-sm text-slate-500">No rows match the current filters.</div>
    }

    if (activeMetric === 'users') {
      const rows = detail.items as UserRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3 text-right">Posts</th>
                <th className="px-4 py-3 text-right">Comments</th>
                <th className="px-4 py-3 text-right">Reports Filed</th>
                <th className="px-4 py-3 text-right">Reports Against</th>
                <th className="px-4 py-3 text-right">Organizations</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <UserInspectButton user={row} onInspect={setInspectUserId} />
                    <p className="mt-1 text-xs text-slate-500">{row.premiumStatus} · last login {formatDateTime(row.lastLoginAt)}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{toCount(row.postCount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{toCount(row.commentCount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{toCount(row.reportsFiled).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{toCount(row.reportsAgainst).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{toCount(row.organizationsOwned).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'posts') {
      const rows = detail.items as PostRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Posted</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Content</th>
                <th className="px-4 py-3">Jurisdiction</th>
                <th className="px-4 py-3 text-right">Engagement</th>
                <th className="px-4 py-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">
                    <p>{formatDateTime(row.createdAt)}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{row.moderationStatus}</p>
                  </td>
                  <td className="px-4 py-3">
                    <UserInspectButton user={row.author} onInspect={setInspectUserId} />
                    {row.organization ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {row.organization.href ? <Link href={row.organization.href} className="font-semibold hover:underline">{row.organization.name}</Link> : row.organization.name}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{row.title || 'Untitled post'}</p>
                    <p className="mt-1 max-w-xl text-slate-600">{row.preview || 'No body text.'}</p>
                    {row.url ? <Link href={row.url} className="mt-2 inline-flex text-xs font-semibold text-[var(--cc-primary)] hover:underline">Open post</Link> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.jurisdiction}</td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    <p className="font-semibold text-slate-900">Score {row.score.toLocaleString()}</p>
                    <p className="mt-1 text-xs">{row.commentCount.toLocaleString()} comments</p>
                    <p className="text-xs">{row.reactionCount.toLocaleString()} reactions</p>
                  </td>
                  <td className="px-4 py-3">
                    {row.flags.count ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {row.flags.reasons.map((reason) => (
                            <span key={`${row.id}:${reason}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                              {formatReasonLabel(reason)}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {row.flags.count.toLocaleString()} reports · {row.flags.openCount.toLocaleString()} open · latest {formatDateTime(row.flags.latestReportedAt)}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">No flags</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'comments') {
      const rows = detail.items as CommentRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Commented</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Comment</th>
                <th className="px-4 py-3">Post</th>
                <th className="px-4 py-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3"><UserInspectButton user={row.author} onInspect={setInspectUserId} /></td>
                  <td className="px-4 py-3 text-slate-600">{row.body}</td>
                  <td className="px-4 py-3">
                    {row.post.url ? <Link href={row.post.url} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.post.title}</Link> : <span className="font-semibold text-slate-900">{row.post.title}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'reactions') {
      const rows = detail.items as ReactionRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Reacted</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Post</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.createdAt}:${row.user.id}:${index}`} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3"><UserInspectButton user={row.user} onInspect={setInspectUserId} /></td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{formatReactionType(row.type)}</td>
                  <td className="px-4 py-3">
                    {row.post.url ? <Link href={row.post.url} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.post.title}</Link> : <span className="font-semibold text-slate-900">{row.post.title}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'follows') {
      const rows = detail.items as FollowRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Followed</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3"><UserInspectButton user={row.user} onInspect={setInspectUserId} /></td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.type === 'organization' ? 'Organization' : 'Community'}</td>
                  <td className="px-4 py-3">
                    {row.href ? <Link href={row.href} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.label}</Link> : <span className="font-semibold text-slate-900">{row.label}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'jobsAdded') {
      const rows = detail.items as JobRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Creator</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Applicants</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3"><UserInspectButton user={row.createdBy} onInspect={setInspectUserId} /></td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{row.title}</p>
                    <p className="mt-1 text-xs text-slate-500">Published {formatDateTime(row.publishedAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {row.organization.href ? <Link href={row.organization.href} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.organization.name}</Link> : <span className="font-semibold text-slate-900">{row.organization.name}</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.status}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.applicantCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'applicants') {
      const rows = detail.items as ApplicantRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Applied</th>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3"><UserInspectButton user={row.applicant} onInspect={setInspectUserId} /></td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{row.job.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.job.status}</p>
                  </td>
                  <td className="px-4 py-3">
                    {row.organization.href ? <Link href={row.organization.href} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.organization.name}</Link> : <span className="font-semibold text-slate-900">{row.organization.name}</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (activeMetric === 'applicationsViewed') {
      const rows = detail.items as ApplicationViewRow[]
      return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Viewed</th>
                <th className="px-4 py-3">Viewer</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Organization</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    {row.viewer ? <UserInspectButton user={row.viewer} onInspect={setInspectUserId} /> : <span className="text-sm text-slate-400">System or unknown</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.job?.title || 'Unknown job'}</td>
                  <td className="px-4 py-3">
                    {row.organization.href ? <Link href={row.organization.href} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.organization.name}</Link> : <span className="font-semibold text-slate-900">{row.organization.name}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    const rows = detail.items as HireRow[]
    return (
      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Hired</th>
              <th className="px-4 py-3">Applicant</th>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Organization</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                <td className="px-4 py-3">
                  {row.applicant ? <UserInspectButton user={row.applicant} onInspect={setInspectUserId} /> : <span className="text-sm text-slate-400">Unknown applicant</span>}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-900">{row.job?.title || 'Unknown job'}</td>
                <td className="px-4 py-3">
                  {row.organization.href ? <Link href={row.organization.href} className="font-semibold text-[var(--cc-primary)] hover:underline">{row.organization.name}</Link> : <span className="font-semibold text-slate-900">{row.organization.name}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderMain = () => {
    if (accessLoading) {
      return <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500">Authorizing admin access…</section>
    }
    if (!isSuperAdmin) {
      return (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-8 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </section>
      )
    }
    if (summaryStatus === 'loading' || summaryStatus === 'idle') {
      return <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500">Loading metrics…</section>
    }
    if (summaryStatus === 'error') {
      return <section className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-600">Unable to load reports. Check admin permissions or API availability.</section>
    }
    if (summaryStatus === 'forbidden') {
      return <section className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-600">Admin access denied for this account. Ensure your email is listed in CIVIL_ADMIN_EMAILS or sign in with a root operator.</section>
    }
    if (summaryStatus === 'unauthorized') {
      return <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600">Sign in as an admin to view reports.</section>
    }
    if (!summary) return null

    return (
      <>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Admin · Analytics</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Platform metrics</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Click any metric card to open a review table with raw rows, moderation state, and direct user inspection.
              </p>
            </div>
            <div className="text-xs text-slate-500">Last generated {formatDateTime(summary.generatedAt)}</div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Date range</p>
              <p className="mt-1 text-sm text-slate-600">The cards and tables below respect this window.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3 text-sm text-slate-700">
              <label className="space-y-1 text-xs uppercase tracking-wide text-slate-500">
                Start
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="space-y-1 text-xs uppercase tracking-wide text-slate-500">
                End
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={csvStatus === 'loading'}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {csvStatus === 'loading' ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MetricCardButton title="Users" total={summary.users.total} today={summary.users.today} active={activeMetric === 'users'} onClick={() => setActiveMetric('users')} />
          <MetricCardButton title="Posts" total={summary.posts.total} today={summary.posts.today} active={activeMetric === 'posts'} onClick={() => setActiveMetric('posts')} />
          <MetricCardButton title="Comments" total={summary.comments.total} today={summary.comments.today} active={activeMetric === 'comments'} onClick={() => setActiveMetric('comments')} />
          <MetricCardButton title="Reactions" total={summary.reactions.total} today={summary.reactions.today} active={activeMetric === 'reactions'} onClick={() => setActiveMetric('reactions')} />
          <MetricCardButton title="Follows" total={summary.follows.total} today={summary.follows.today} active={activeMetric === 'follows'} onClick={() => setActiveMetric('follows')} />
          <MetricCardButton title="Jobs added" total={summary.jobs.added.total} today={summary.jobs.added.today} active={activeMetric === 'jobsAdded'} onClick={() => setActiveMetric('jobsAdded')} />
          <MetricCardButton title="Applicants" total={summary.jobs.applicants.total} today={summary.jobs.applicants.today} active={activeMetric === 'applicants'} onClick={() => setActiveMetric('applicants')} />
          <MetricCardButton title="Org application views" total={summary.jobs.applicationsViewed.organizations.total} today={summary.jobs.applicationsViewed.organizations.today} active={activeMetric === 'applicationsViewed'} onClick={() => setActiveMetric('applicationsViewed')} />
          <MetricCardButton title="Applicants hired" total={summary.jobs.hired.total} today={summary.jobs.hired.today} active={activeMetric === 'hired'} onClick={() => setActiveMetric('hired')} />
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Review table</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{activeMetricDefinition.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{activeMetricDefinition.description}</p>
            </div>
            {activeMetric === 'posts' ? (
              <label className="space-y-1 text-xs uppercase tracking-wide text-slate-500">
                Flag type
                <select
                  value={flagReason}
                  onChange={(event) => setFlagReason(event.target.value as (typeof FLAG_REASON_OPTIONS)[number])}
                  className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  {FLAG_REASON_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === 'ALL' ? 'All posts' : formatReasonLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {renderDetailTable()}
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-subtle">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Traffic</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Top routes and post views</h2>
            <p className="mt-2 text-sm text-slate-600">These tables stay available for quick route-level sanity checks.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TrafficTable title="Routes" rows={summary.traffic.routes.map((entry) => ({ key: entry.path, label: entry.path, views: entry.views }))} />
            <TrafficTable title="Posts" rows={summary.traffic.posts.map((entry) => ({ key: entry.postId, label: entry.title ?? 'Untitled post', views: entry.views }))} />
          </div>
        </section>
      </>
    )
  }

  return (
    <AdminWideShell mainClassName="space-y-6">
      {renderMain()}
      <AdminUserInspectModal userId={inspectUserId} token={token} onClose={() => setInspectUserId(null)} />
    </AdminWideShell>
  )
}