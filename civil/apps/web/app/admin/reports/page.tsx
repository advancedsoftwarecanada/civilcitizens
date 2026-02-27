"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { useAdminAccess } from '../_hooks/useAdminAccess'

import type { ReactNode } from 'react'

type SeriesPoint = { date: string; count: number }
type MetricSeries = { total: number; today: number; series: SeriesPoint[] }

type ReportSummary = {
  generatedAt: string
  users: MetricSeries
  posts: MetricSeries
  comments: MetricSeries
  reactions: MetricSeries
  follows: MetricSeries
  pageViews: { series: SeriesPoint[] }
  traffic: { routes: Array<{ path: string; views: number }>; posts: Array<{ postId: string; title: string | null; views: number }> }
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unauthorized' | 'forbidden'

type MetricCardProps = {
  title: string
  total: number
  today: number
  footer?: ReactNode
  todayLabel?: string
}

type SeriesPanelProps = {
  label: string
  series: SeriesPoint[]
  highlight?: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const defaultStart = new Date(Date.now() - 29 * DAY_MS)
const defaultEnd = new Date()

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10)
}

function formatDateLabel(value: string) {
  const date = new Date(value)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function MetricCard({ title, total, today, footer, todayLabel = 'today' }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-subtle">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{title}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-3xl font-semibold text-slate-900">{total.toLocaleString()}</p>
        <span className="text-xs font-semibold text-emerald-600">+{today.toLocaleString()} {todayLabel}</span>
      </div>
      {footer ? <div className="mt-2 text-xs text-slate-500">{footer}</div> : null}
    </div>
  )
}

function Sparkline({ points }: { points: SeriesPoint[] }) {
  if (!points.length) {
    return <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">No data yet.</div>
  }

  const width = 220
  const height = 60
  const counts = points.map((p) => p.count)
  const max = Math.max(...counts, 1)
  const min = Math.min(...counts, 0)
  const span = Math.max(points.length - 1, 1)
  const coords = points
    .map((point, index) => {
      const x = (index / span) * (width - 2) + 1
      const ratio = max === min ? 0.5 : (point.count - min) / (max - min || 1)
      const y = height - ratio * (height - 2) - 1
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full" role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="#0284c7" strokeWidth="2" points={coords} vectorEffect="non-scaling-stroke" />
      <polyline
        fill="url(#spark)"
        stroke="none"
        points={`${coords} ${width},${height} 0,${height}`}
        opacity={0.2}
      />
    </svg>
  )
}

function SeriesPanel({ label, series, highlight }: SeriesPanelProps) {
  const latest = series.at(-1)?.count ?? 0
  const average = series.length ? Math.round(series.reduce((acc, point) => acc + point.count, 0) / series.length) : 0
  const first = series[0]?.date
  const last = series.at(-1)?.date

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-subtle">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">{label}</p>
          <div className="mt-1 text-lg font-semibold text-slate-900">{latest.toLocaleString()}</div>
          <p className="text-xs text-slate-500">{average.toLocaleString()} daily avg</p>
        </div>
        <div className="w-full max-w-[240px] sm:max-w-[280px]">
          <Sparkline points={series} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-400">
        {first ? <span>{formatDateLabel(first)}</span> : null}
        <span className="text-slate-300">→</span>
        {last ? <span className="text-slate-600">{formatDateLabel(last)}</span> : null}
        {highlight ? <span className="rounded-full bg-sky-50 px-2 py-[3px] text-[10px] font-semibold text-sky-700">{highlight}</span> : null}
      </div>
    </div>
  )
}

function TrafficTable({
  title,
  rows,
  renderKey,
}: {
  title: string
  rows: Array<{ key: string; label: ReactNode; views: number }>
  renderKey?: (key: string) => ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-100">
      <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">{title}</p>
        <span className="text-[11px] text-slate-500">{rows.length.toLocaleString()} rows</span>
      </header>
      <table className="min-w-full text-left text-sm text-slate-700">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">{renderKey ? 'Key' : 'Path'}</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2 text-right">Views</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-100">
              <td className="px-3 py-2 text-xs text-slate-500">{renderKey ? renderKey(row.key) : row.key}</td>
              <td className="px-3 py-2 font-semibold text-slate-800">{row.label}</td>
              <td className="px-3 py-2 text-right font-semibold">{row.views.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="px-3 py-2 text-xs text-slate-500">No traffic yet for this range.</p> : null}
    </div>
  )
}

export default function AdminReportsPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [startDate, setStartDate] = useState(toDateInputValue(defaultStart))
  const [endDate, setEndDate] = useState(toDateInputValue(defaultEnd))
  const [csvStatus, setCsvStatus] = useState<'idle' | 'loading'>('idle')

  const loadSummary = useCallback(
    async (rangeStart: string, rangeEnd: string, signal?: AbortSignal) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        setStatus('unauthorized')
        return
      }

      setStatus('loading')

      const params = new URLSearchParams()
      if (rangeStart) params.set('start', rangeStart)
      if (rangeEnd) params.set('end', rangeEnd)

      try {
        const baseUrl = buildApiUrl('/admin/reports/summary')
        const requestUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl
        const res = await fetch(requestUrl, {
          headers: { authorization: `Bearer ${authToken}` },
          signal,
        })
        if (res.status === 401) {
          redirectToAuthModal('login')
          setStatus('unauthorized')
          return
        }
        if (res.status === 403) {
          setStatus('forbidden')
          return
        }
        if (!res.ok) {
          setStatus('error')
          return
        }
        const data = (await res.json()) as ReportSummary
        setSummary(data)
        setStatus('ready')
      } catch (err) {
        if (signal?.aborted) return
        console.error('[admin/reports] failed to load', err)
        setStatus('error')
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

  const handleExportCsv = useCallback(async () => {
    const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
    if (!authToken) {
      redirectToAuthModal('login')
      return
    }

    setCsvStatus('loading')
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate, format: 'csv' })
      const baseUrl = buildApiUrl('/admin/reports/summary')
      const requestUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl
      const res = await fetch(requestUrl, {
        headers: { authorization: `Bearer ${authToken}` },
      })
      if (!res.ok) throw new Error('csv_failed')

      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `civil-report-${startDate}-to-${endDate}.csv`
      link.click()
      URL.revokeObjectURL(downloadUrl)
    } catch (err) {
      console.error('csv_export_failed', err)
    } finally {
      setCsvStatus('idle')
    }
  }, [endDate, startDate])

  const pageViewsTotal = summary?.pageViews.series.reduce((acc, point) => acc + point.count, 0) ?? 0
  const pageViewsLatest = summary?.pageViews.series.at(-1)?.count ?? 0

  const rightRail = summary ? (
    <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-xs text-slate-500">
      <p className="font-semibold text-slate-700">Last generated</p>
      <p>{new Date(summary.generatedAt).toLocaleString()}</p>
    </div>
  ) : null

  const renderMain = useMemo(() => {
    if (accessLoading) {
      return <section className="surface-card px-6 py-6 text-sm text-slate-500">Authorizing admin access…</section>
    }
    if (!isSuperAdmin) {
      return (
        <section className="surface-card px-6 py-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </section>
      )
    }

    if (status === 'loading' || status === 'idle') {
      return <section className="surface-card px-6 py-6 text-sm text-slate-500">Loading metrics…</section>
    }
    if (status === 'error') {
      return <section className="surface-card px-6 py-6 text-sm text-rose-600">Unable to load reports. Check admin permissions or API availability.</section>
    }
    if (status === 'forbidden') {
      return <section className="surface-card px-6 py-6 text-sm text-rose-600">Admin access denied for this account. Ensure your email is listed in CIVIL_ADMIN_EMAILS or sign in with a root operator.</section>
    }
    if (status === 'unauthorized') {
      return <section className="surface-card px-6 py-6 text-sm text-slate-600">Sign in as an admin to view reports.</section>
    }
    if (!summary) return null

    return (
      <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard title="Users" total={summary.users.total} today={summary.users.today} />
          <MetricCard title="Posts" total={summary.posts.total} today={summary.posts.today} />
          <MetricCard title="Comments" total={summary.comments.total} today={summary.comments.today} />
          <MetricCard title="Reactions" total={summary.reactions.total} today={summary.reactions.today} />
          <MetricCard title="Follows" total={summary.follows.total} today={summary.follows.today} />
          <MetricCard
            title="Page views"
            total={pageViewsTotal}
            today={pageViewsLatest}
            todayLabel="last day"
            footer="Totals respect the selected date range."
          />
        </section>

        <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Daily rollups</h2>
            <p className="text-sm text-slate-600">Series respect the selected start and end dates.</p>
          </header>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SeriesPanel label="Users" series={summary.users.series} highlight={`${summary.users.today.toLocaleString()} today`} />
            <SeriesPanel label="Posts" series={summary.posts.series} highlight={`${summary.posts.today.toLocaleString()} today`} />
            <SeriesPanel label="Comments" series={summary.comments.series} highlight={`${summary.comments.today.toLocaleString()} today`} />
            <SeriesPanel label="Reactions" series={summary.reactions.series} highlight={`${summary.reactions.today.toLocaleString()} today`} />
            <SeriesPanel label="Follows" series={summary.follows.series} highlight={`${summary.follows.today.toLocaleString()} today`} />
            <SeriesPanel label="Page views" series={summary.pageViews.series} highlight={`${pageViewsTotal.toLocaleString()} total`} />
          </div>
        </section>

        <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Traffic</h2>
            <p className="text-sm text-slate-600">Top routes and posts for this window.</p>
          </header>
          <div className="grid gap-4 lg:grid-cols-2">
            <TrafficTable
              title="Routes"
              rows={summary.traffic.routes.map((route) => ({ key: route.path, label: route.path, views: route.views }))}
            />
            <TrafficTable
              title="Posts"
              rows={summary.traffic.posts.map((post) => ({
                key: post.postId,
                label: post.title ?? 'Untitled post',
                views: post.views,
              }))}
              renderKey={(key) => <code className="rounded bg-slate-100 px-1 py-[1px] text-[11px] text-slate-600">{key.slice(0, 8)}…</code>}
            />
          </div>
          <p className="text-xs text-slate-500">Metrics include page hits and post impressions captured via /api/analytics/track.</p>
        </section>

        <section className="surface-card px-6 py-4 text-xs text-slate-500">
          <p className="font-semibold text-slate-700">Next steps</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Connect client-side tracking on feeds, profile pages, and post detail views.</li>
            <li>Track likes, comments, and follows to compare engagement against page impressions.</li>
            <li>Use CSV exports to blend with payment, referral, and activation data.</li>
          </ul>
        </section>
      </>
    )
  }, [accessError, accessLoading, isSuperAdmin, status, summary, pageViewsTotal, pageViewsLatest])

  return (
    <DashboardShell
      rightRail={rightRail}
      mainClassName="space-y-6"
      className="bg-slate-50"
    >
      <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Reports</p>
        <h1 className="text-xl font-semibold text-slate-900">Platform metrics</h1>
        <p className="text-sm text-slate-600">User growth, engagement, and route traffic for Civil.</p>
      </section>

      <section className="surface-card flex flex-wrap items-center justify-between gap-4 px-6 py-5 shadow-subtle">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Date range</p>
          <p className="text-sm text-slate-600">Pull rollups and exports for any custom window.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="space-y-1 text-xs uppercase tracking-wide text-slate-500">
            Start
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-inner"
            />
          </label>
          <label className="space-y-1 text-xs uppercase tracking-wide text-slate-500">
            End
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-inner"
            />
          </label>
          <button
            type="button"
            onClick={() => loadSummary(startDate, endDate)}
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-subtle transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status === 'loading' || accessLoading || !isSuperAdmin}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={csvStatus === 'loading' || status === 'loading' || accessLoading || !isSuperAdmin}
          >
            {csvStatus === 'loading' ? 'Preparing CSV…' : 'Download CSV'}
          </button>
        </div>
      </section>

      {renderMain}
    </DashboardShell>
  )
}
