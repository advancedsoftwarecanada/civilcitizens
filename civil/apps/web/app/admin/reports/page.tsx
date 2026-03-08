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
  jobs: {
    added: MetricSeries
    applicants: MetricSeries
    applicationsViewed: {
      views: MetricSeries
      organizations: { total: number; today: number }
    }
    hired: MetricSeries
  }
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
const EMPTY_METRIC_SERIES: MetricSeries = { total: 0, today: 0, series: [] }

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
  const pageViewsSource = source.pageViews && typeof source.pageViews === 'object' ? (source.pageViews as Record<string, unknown>) : {}
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
    pageViews: {
      series: toSeriesPoints(pageViewsSource.series),
    },
    traffic: {
      routes: Array.isArray(trafficSource.routes)
        ? trafficSource.routes
            .map((row) => {
              if (!row || typeof row !== 'object') return null
              const path = typeof (row as { path?: unknown }).path === 'string' ? (row as { path: string }).path : ''
              const views = Number((row as { views?: unknown }).views ?? 0)
              if (!path) return null
              return { path, views: Number.isFinite(views) ? views : 0 }
            })
            .filter((row): row is { path: string; views: number } => Boolean(row))
        : [],
      posts: Array.isArray(trafficSource.posts)
        ? trafficSource.posts
            .map((row) => {
              if (!row || typeof row !== 'object') return null
              const postId = typeof (row as { postId?: unknown }).postId === 'string' ? (row as { postId: string }).postId : ''
              const titleRaw = (row as { title?: unknown }).title
              const views = Number((row as { views?: unknown }).views ?? 0)
              if (!postId) return null
              return {
                postId,
                title: typeof titleRaw === 'string' ? titleRaw : null,
                views: Number.isFinite(views) ? views : 0,
              }
            })
            .filter((row): row is { postId: string; title: string | null; views: number } => Boolean(row))
        : [],
    },
  }
}

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
          "use client"

          import AdminAnalyticsPage from '../_components/AdminAnalyticsPage'

          export default function AdminReportsPage() {
            return <AdminAnalyticsPage />
          }
        {first ? <span>{formatDateLabel(first)}</span> : null}
