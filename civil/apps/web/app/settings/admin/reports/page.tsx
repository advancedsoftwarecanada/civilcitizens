'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  HiOutlineBuildingOffice2,
  HiOutlineChatBubbleLeftRight,
  HiOutlineCheckCircle,
  HiOutlineFlag,
  HiOutlineLightBulb,
  HiOutlineUserCircle,
} from 'react-icons/hi2'
import CivilCard from '../../../_components/CivilCard'
import DashboardShell from '../../../_components/DashboardShell'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { useAdminAccess } from '../../../admin/_hooks/useAdminAccess'

type ReportStatus = 'OPEN' | 'REVIEWED'
type ReportFilter = ReportStatus | 'ALL'

type ReportUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

type ReportBusiness = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  coverUrl: string | null
  provinceCode: string | null
  communitySlug: string | null
}

type ModerationReport = {
  id: string
  targetType: 'POST' | 'ORGANIZATION' | 'MARKET_LISTING' | 'MARKET_PRODUCT'
  targetId: string
  targetLabel: string | null
  targetUrl: string | null
  reasons: string[]
  details: string | null
  status: ReportStatus
  quarantineAppliedAt: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
  updatedAt: string
  reporter: ReportUser
  reviewedBy: { id: string; handle: string; name: string | null } | null
  reportedUser: ReportUser | null
  reportedBusiness: ReportBusiness | null
}

type ModerationReportResponse = {
  items?: ModerationReport[]
}

type SupportRequest = {
  id: string
  type: 'CUSTOMER_SERVICE' | 'FEATURE_REQUEST'
  subject: string
  body: string
  status: ReportStatus
  adminNotes: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  requester: ReportUser
  reviewedBy: { id: string; handle: string; name: string | null } | null
}

type SupportRequestResponse = {
  items?: SupportRequest[]
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

function formatTargetType(value: ModerationReport['targetType']) {
  switch (value) {
    case 'POST':
      return 'Post'
    case 'ORGANIZATION':
      return 'Organization'
    case 'MARKET_LISTING':
      return 'Marketplace listing'
    case 'MARKET_PRODUCT':
      return 'Marketplace product'
    default:
      return value
  }
}

function formatSupportType(value: SupportRequest['type']) {
  return value === 'FEATURE_REQUEST' ? 'Feature Request' : 'Customer Service Request'
}

function formatUserName(user: { name: string | null; handle: string }) {
  return user.name?.trim() || `@${user.handle}`
}

function buildUserHref(user: ReportUser) {
  return `/u/${encodeURIComponent(user.handle)}`
}

function buildBusinessHref(business: ReportBusiness) {
  if (!business.provinceCode || !business.communitySlug) return null
  return `/com/${encodeURIComponent(business.provinceCode.toLowerCase())}/${encodeURIComponent(business.communitySlug.toLowerCase())}/orgs/${encodeURIComponent(business.slug)}`
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'danger' | 'success'
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl border px-4 py-3',
        tone === 'danger'
          ? 'border-rose-200 bg-rose-50'
          : tone === 'success'
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-slate-200 bg-white',
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value.toLocaleString()}</p>
    </div>
  )
}

export default function AdminModerationReportsPage() {
  const { token, me, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [reports, setReports] = useState<ModerationReport[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [filter, setFilter] = useState<ReportFilter>('OPEN')
  const [notesById, setNotesById] = useState<Record<string, string>>({})
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([])
  const [supportStatus, setSupportStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [supportFilter, setSupportFilter] = useState<ReportFilter>('OPEN')
  const [supportNotesById, setSupportNotesById] = useState<Record<string, string>>({})
  const [reviewingSupportId, setReviewingSupportId] = useState<string | null>(null)

  const loadReports = useCallback(
    async (signal?: AbortSignal) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        return
      }

      setStatus('loading')
      try {
        const params = new URLSearchParams({
          status: 'ALL',
          limit: '200',
        })
        const response = await fetch(`${buildApiUrl('/admin/moderation/reports')}?${params.toString()}`, {
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          cache: 'no-store',
          signal,
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (!response.ok) {
          setStatus('error')
          setReports([])
          return
        }

        const payload = (await response.json().catch(() => null)) as ModerationReportResponse | null
        const nextReports = Array.isArray(payload?.items) ? payload.items : []
        setReports(nextReports)
        setNotesById((current) => {
          const next = { ...current }
          for (const report of nextReports) {
            if (!(report.id in next)) {
              next[report.id] = report.reviewNotes ?? ''
            }
          }
          return next
        })
        setStatus('ready')
      } catch (error) {
        if (signal?.aborted) return
        console.error('[admin/moderation/reports] Failed to load reports', error)
        setReports([])
        setStatus('error')
      }
    },
    [token],
  )

  const loadSupportRequests = useCallback(
    async (signal?: AbortSignal) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        return
      }

      setSupportStatus('loading')
      try {
        const params = new URLSearchParams({
          status: 'ALL',
          limit: '200',
        })
        const response = await fetch(`${buildApiUrl('/admin/support/requests')}?${params.toString()}`, {
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          cache: 'no-store',
          signal,
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (!response.ok) {
          setSupportStatus('error')
          setSupportRequests([])
          return
        }

        const payload = (await response.json().catch(() => null)) as SupportRequestResponse | null
        const nextRequests = Array.isArray(payload?.items) ? payload.items : []
        setSupportRequests(nextRequests)
        setSupportNotesById((current) => {
          const next = { ...current }
          for (const request of nextRequests) {
            if (!(request.id in next)) {
              next[request.id] = request.adminNotes ?? ''
            }
          }
          return next
        })
        setSupportStatus('ready')
      } catch (error) {
        if (signal?.aborted) return
        console.error('[admin/support/requests] Failed to load requests', error)
        setSupportRequests([])
        setSupportStatus('error')
      }
    },
    [token],
  )

  useEffect(() => {
    if (accessLoading || !isSuperAdmin) return
    const controller = new AbortController()
    void loadReports(controller.signal)
    void loadSupportRequests(controller.signal)
    return () => controller.abort()
  }, [accessLoading, isSuperAdmin, loadReports, loadSupportRequests])

  const openCount = useMemo(() => reports.filter((report) => report.status === 'OPEN').length, [reports])
  const reviewedCount = useMemo(() => reports.filter((report) => report.status === 'REVIEWED').length, [reports])
  const visibleReports = useMemo(
    () => (filter === 'ALL' ? reports : reports.filter((report) => report.status === filter)),
    [filter, reports],
  )
  const openSupportCount = useMemo(() => supportRequests.filter((request) => request.status === 'OPEN').length, [supportRequests])
  const reviewedSupportCount = useMemo(() => supportRequests.filter((request) => request.status === 'REVIEWED').length, [supportRequests])
  const visibleSupportRequests = useMemo(
    () => (supportFilter === 'ALL' ? supportRequests : supportRequests.filter((request) => request.status === supportFilter)),
    [supportFilter, supportRequests],
  )

  const handleReview = useCallback(
    async (reportId: string) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        return
      }

      setReviewingId(reportId)
      try {
        const response = await fetch(buildApiUrl(`/admin/moderation/reports/${encodeURIComponent(reportId)}/review`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            reviewNotes: notesById[reportId]?.trim() || null,
          }),
        })

        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          pushToast(payload?.error ?? 'Unable to update this report.', 'error')
          return
        }

        const reviewedAt = new Date().toISOString()
        setReports((current) =>
          current.map((report) =>
            report.id === reportId
              ? {
                  ...report,
                  status: 'REVIEWED',
                  reviewedAt,
                  reviewNotes: notesById[reportId]?.trim() || null,
                  reviewedBy: me
                    ? {
                        id: me.id,
                        handle: me.handle,
                        name: me.name ?? null,
                      }
                    : report.reviewedBy,
                }
              : report,
          ),
        )
        pushToast('Report marked reviewed.', 'success')
      } catch (error) {
        console.error('[admin/moderation/reports] Failed to review report', error)
        pushToast('Unable to update this report.', 'error')
      } finally {
        setReviewingId(null)
      }
    },
    [me, notesById, token],
  )

  const handleSupportReview = useCallback(
    async (requestId: string) => {
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
      if (!authToken) {
        redirectToAuthModal('login')
        return
      }

      setReviewingSupportId(requestId)
      try {
        const response = await fetch(buildApiUrl(`/admin/support/requests/${encodeURIComponent(requestId)}/review`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            adminNotes: supportNotesById[requestId]?.trim() || null,
          }),
        })

        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          pushToast(payload?.error ?? 'Unable to update this request.', 'error')
          return
        }

        const reviewedAt = new Date().toISOString()
        setSupportRequests((current) =>
          current.map((request) =>
            request.id === requestId
              ? {
                  ...request,
                  status: 'REVIEWED',
                  reviewedAt,
                  adminNotes: supportNotesById[requestId]?.trim() || null,
                  reviewedBy: me
                    ? {
                        id: me.id,
                        handle: me.handle,
                        name: me.name ?? null,
                      }
                    : request.reviewedBy,
                }
              : request,
          ),
        )
        pushToast('Support request marked reviewed.', 'success')
      } catch (error) {
        console.error('[admin/support/requests] Failed to review request', error)
        pushToast('Unable to update this request.', 'error')
      } finally {
        setReviewingSupportId(null)
      }
    },
    [me, supportNotesById, token],
  )

  if (accessLoading) {
    return (
      <DashboardShell className="bg-slate-50" mainClassName="space-y-6">
        <div className="surface-card p-6 text-sm text-slate-500">Authorizing moderation tools…</div>
      </DashboardShell>
    )
  }

  if (!isSuperAdmin) {
    return (
      <DashboardShell className="bg-slate-50" mainClassName="space-y-6">
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell className="bg-slate-50" mainClassName="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Admin · Safety</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Reports & Support</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review quarantined posts, organizations, and marketplace content, alongside customer-service and feature requests from members.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/settings"
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Account Settings
            </Link>
            <Link
              href="/admin"
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Admin Console
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Open Reports" value={openCount} tone="danger" />
        <SummaryCard label="Reviewed Reports" value={reviewedCount} tone="success" />
        <SummaryCard label="Open Support" value={openSupportCount} tone="danger" />
        <SummaryCard label="Reviewed Support" value={reviewedSupportCount} tone="success" />
        <SummaryCard label="Total Activity" value={reports.length + supportRequests.length} />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Queue</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Reported Content</h2>
          </div>
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {(['OPEN', 'REVIEWED', 'ALL'] as ReportFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={clsx(
                  'rounded-full px-4 py-1.5 transition',
                  filter === value ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {value === 'ALL' ? 'All' : value === 'OPEN' ? 'Open' : 'Reviewed'}
              </button>
            ))}
          </div>
        </div>

        {status === 'loading' ? <p className="mt-6 text-sm text-slate-500">Loading moderation reports…</p> : null}
        {status === 'error' ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Unable to load moderation reports right now.
          </div>
        ) : null}
        {status === 'ready' && !visibleReports.length ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No reports match this filter.
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {visibleReports.map((report) => {
            const reviewerName = report.reviewedBy ? (report.reviewedBy.name?.trim() || `@${report.reviewedBy.handle}`) : null
            const subjectBusinessHref = report.reportedBusiness ? buildBusinessHref(report.reportedBusiness) : null

            return (
              <article key={report.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-subtle">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{formatTargetType(report.targetType)}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">{report.targetLabel || 'Untitled target'}</h3>
                    <p className="mt-1 text-sm text-slate-500">Reported {formatDateTime(report.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                        report.status === 'OPEN'
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                      )}
                    >
                      {report.status === 'OPEN' ? 'Open' : 'Reviewed'}
                    </span>
                    {report.targetUrl ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-mono text-slate-500">
                        {report.targetUrl}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {report.reasons.map((reason) => (
                    <span
                      key={`${report.id}:${reason}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                    >
                      {formatReasonLabel(reason)}
                    </span>
                  ))}
                </div>

                {report.details ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                    {report.details}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <section className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reporter</p>
                    <CivilCard
                      size="rail"
                      name={formatUserName(report.reporter)}
                      subtitle={`@${report.reporter.handle}`}
                      avatarAlt={formatUserName(report.reporter)}
                      avatarInitials={formatUserName(report.reporter)}
                      avatarSrc={report.reporter.avatarUrl}
                      avatarHref={buildUserHref(report.reporter)}
                      titleHref={buildUserHref(report.reporter)}
                      coverUrl={report.reporter.coverUrl}
                      className="w-full"
                    />
                  </section>

                  {report.reportedUser ? (
                    <section className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reported User</p>
                      <CivilCard
                        size="rail"
                        name={formatUserName(report.reportedUser)}
                        subtitle={`@${report.reportedUser.handle}`}
                        avatarAlt={formatUserName(report.reportedUser)}
                        avatarInitials={formatUserName(report.reportedUser)}
                        avatarSrc={report.reportedUser.avatarUrl}
                        avatarHref={buildUserHref(report.reportedUser)}
                        titleHref={buildUserHref(report.reportedUser)}
                        coverUrl={report.reportedUser.coverUrl}
                        className="w-full"
                      />
                    </section>
                  ) : (
                    <section className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reported User</p>
                      <div className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 text-sm text-slate-500">
                        <HiOutlineUserCircle className="h-5 w-5 shrink-0 text-slate-400" />
                        <span>No direct user subject on this report.</span>
                      </div>
                    </section>
                  )}

                  {report.reportedBusiness ? (
                    <section className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reported Organization</p>
                      <CivilCard
                        size="rail"
                        name={report.reportedBusiness.name}
                        subtitle={report.reportedBusiness.slug}
                        avatarAlt={report.reportedBusiness.name}
                        avatarInitials={report.reportedBusiness.name}
                        avatarSrc={report.reportedBusiness.logoUrl}
                        avatarHref={subjectBusinessHref ?? undefined}
                        titleHref={subjectBusinessHref ?? undefined}
                        coverUrl={report.reportedBusiness.coverUrl}
                        isBusiness
                        className="w-full"
                      />
                    </section>
                  ) : (
                    <section className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reported Organization</p>
                      <div className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 text-sm text-slate-500">
                        <HiOutlineBuildingOffice2 className="h-5 w-5 shrink-0 text-slate-400" />
                        <span>No organization subject on this report.</span>
                      </div>
                    </section>
                  )}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Submitted</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(report.createdAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Quarantined</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(report.quarantineAppliedAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reviewed</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(report.reviewedAt)}</p>
                  </div>
                </div>

                {report.status === 'OPEN' ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Review</p>
                        <h4 className="mt-1 text-sm font-semibold text-slate-900">Close this report</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleReview(report.id)
                        }}
                        disabled={reviewingId === report.id}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        <HiOutlineCheckCircle className="h-4 w-4" />
                        <span>{reviewingId === report.id ? 'Saving…' : 'Mark reviewed'}</span>
                      </button>
                    </div>
                    <label htmlFor={`review-${report.id}`} className="mt-4 block text-sm font-semibold text-slate-900">
                      Review notes
                    </label>
                    <textarea
                      id={`review-${report.id}`}
                      rows={4}
                      value={notesById[report.id] ?? ''}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setNotesById((current) => ({ ...current, [report.id]: nextValue }))
                      }}
                      placeholder="Record what was reviewed or what follow-up is needed."
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
                    />
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">Reviewed</p>
                    <p className="mt-2">
                      {reviewerName ? `Reviewed by ${reviewerName}.` : 'Reviewed by an admin.'}
                    </p>
                    {report.reviewNotes ? <p className="mt-2 whitespace-pre-wrap text-emerald-900/90">{report.reviewNotes}</p> : null}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Queue</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Support Requests</h2>
          </div>
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {(['OPEN', 'REVIEWED', 'ALL'] as ReportFilter[]).map((value) => (
              <button
                key={`support-${value}`}
                type="button"
                onClick={() => setSupportFilter(value)}
                className={clsx(
                  'rounded-full px-4 py-1.5 transition',
                  supportFilter === value ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {value === 'ALL' ? 'All' : value === 'OPEN' ? 'Open' : 'Reviewed'}
              </button>
            ))}
          </div>
        </div>

        {supportStatus === 'loading' ? <p className="mt-6 text-sm text-slate-500">Loading support requests…</p> : null}
        {supportStatus === 'error' ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Unable to load support requests right now.
          </div>
        ) : null}
        {supportStatus === 'ready' && !visibleSupportRequests.length ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No support requests match this filter.
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {visibleSupportRequests.map((request) => {
            const reviewerName = request.reviewedBy ? (request.reviewedBy.name?.trim() || `@${request.reviewedBy.handle}`) : null

            return (
              <article key={request.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-subtle">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{formatSupportType(request.type)}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">{request.subject}</h3>
                    <p className="mt-1 text-sm text-slate-500">Submitted {formatDateTime(request.createdAt)}</p>
                  </div>
                  <span
                    className={clsx(
                      'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                      request.status === 'OPEN'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {request.status === 'OPEN' ? 'Open' : 'Reviewed'}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                  <section className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Requester</p>
                    <CivilCard
                      size="rail"
                      name={formatUserName(request.requester)}
                      subtitle={`@${request.requester.handle}`}
                      avatarAlt={formatUserName(request.requester)}
                      avatarInitials={formatUserName(request.requester)}
                      avatarSrc={request.requester.avatarUrl}
                      avatarHref={buildUserHref(request.requester)}
                      titleHref={buildUserHref(request.requester)}
                      coverUrl={request.requester.coverUrl}
                      className="w-full"
                    />
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="rounded-xl bg-white p-2 text-slate-700">
                        {request.type === 'FEATURE_REQUEST' ? <HiOutlineLightBulb className="h-5 w-5" /> : <HiOutlineChatBubbleLeftRight className="h-5 w-5" />}
                      </span>
                      <p className="whitespace-pre-wrap">{request.body}</p>
                    </div>
                  </section>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Submitted</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(request.createdAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reviewed</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(request.reviewedAt)}</p>
                  </div>
                </div>

                {request.status === 'OPEN' ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Review</p>
                        <h4 className="mt-1 text-sm font-semibold text-slate-900">Close this support request</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleSupportReview(request.id)
                        }}
                        disabled={reviewingSupportId === request.id}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        <HiOutlineCheckCircle className="h-4 w-4" />
                        <span>{reviewingSupportId === request.id ? 'Saving…' : 'Mark reviewed'}</span>
                      </button>
                    </div>
                    <label htmlFor={`support-review-${request.id}`} className="mt-4 block text-sm font-semibold text-slate-900">
                      Admin notes
                    </label>
                    <textarea
                      id={`support-review-${request.id}`}
                      rows={4}
                      value={supportNotesById[request.id] ?? ''}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setSupportNotesById((current) => ({ ...current, [request.id]: nextValue }))
                      }}
                      placeholder="Record the resolution or any follow-up promised to the user."
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
                    />
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">Reviewed</p>
                    <p className="mt-2">
                      {reviewerName ? `Reviewed by ${reviewerName}.` : 'Reviewed by an admin.'}
                    </p>
                    {request.adminNotes ? <p className="mt-2 whitespace-pre-wrap text-emerald-900/90">{request.adminNotes}</p> : null}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-rose-50 p-3 text-rose-600">
            <HiOutlineFlag className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Safety behavior</p>
            <p className="mt-1 text-sm text-slate-600">
              New content reports immediately quarantine the target. Support and feature requests flow through the same operator screen so moderation work and customer follow-up stay in one place.
            </p>
          </div>
        </div>
      </section>
    </DashboardShell>
  )
}
