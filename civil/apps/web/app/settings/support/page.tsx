'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { HiOutlineChatBubbleLeftRight, HiOutlineFlag, HiOutlineLightBulb } from 'react-icons/hi2'
import DashboardShell from '../../_components/DashboardShell'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'

type SupportRequestType = 'CUSTOMER_SERVICE' | 'FEATURE_REQUEST'
type RequestStatus = 'OPEN' | 'REVIEWED'

type SupportRequestItem = {
  id: string
  type: SupportRequestType
  subject: string
  body: string
  status: RequestStatus
  adminNotes: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  reviewedBy: { id: string; handle: string; name: string | null } | null
}

type ContentReportItem = {
  id: string
  targetType: 'POST' | 'COMMENT' | 'ORGANIZATION' | 'MARKET_LISTING' | 'MARKET_PRODUCT'
  targetId: string
  targetLabel: string | null
  targetUrl: string | null
  reasons: string[]
  details: string | null
  status: RequestStatus
  quarantineAppliedAt: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
  updatedAt: string
  reviewedBy: { id: string; handle: string; name: string | null } | null
}

type SupportOverviewResponse = {
  supportRequests?: SupportRequestItem[]
  contentReports?: ContentReportItem[]
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

function formatSupportType(value: SupportRequestType) {
  return value === 'FEATURE_REQUEST' ? 'Feature Request' : 'Customer Service Request'
}

function formatTargetType(value: ContentReportItem['targetType']) {
  switch (value) {
    case 'POST':
      return 'Post'
    case 'COMMENT':
      return 'Comment'
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

export default function SettingsSupportPage() {
  const [supportRequests, setSupportRequests] = useState<SupportRequestItem[]>([])
  const [contentReports, setContentReports] = useState<ContentReportItem[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [requestType, setRequestType] = useState<SupportRequestType>('CUSTOMER_SERVICE')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setStatus('loading')
    try {
      const response = await fetch(buildApiUrl('/support/overview'), {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
        signal,
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        setSupportRequests([])
        setContentReports([])
        setStatus('error')
        return
      }

      const payload = (await response.json().catch(() => null)) as SupportOverviewResponse | null
      setSupportRequests(Array.isArray(payload?.supportRequests) ? payload.supportRequests : [])
      setContentReports(Array.isArray(payload?.contentReports) ? payload.contentReports : [])
      setStatus('ready')
    } catch (error) {
      if (signal?.aborted) return
      console.error('[settings/support] Failed to load overview', error)
      setSupportRequests([])
      setContentReports([])
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadOverview(controller.signal)
    return () => controller.abort()
  }, [loadOverview])

  const openSupportCount = useMemo(() => supportRequests.filter((item) => item.status === 'OPEN').length, [supportRequests])
  const openReportCount = useMemo(() => contentReports.filter((item) => item.status === 'OPEN').length, [contentReports])

  const scrollToReportedContent = useCallback(() => {
    if (typeof window === 'undefined') return
    const target = document.getElementById('reported-content')
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmedSubject = subject.trim()
    const trimmedBody = body.trim()
    if (trimmedSubject.length < 3 || trimmedBody.length < 10 || submitting) return

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/support/requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: requestType,
          subject: trimmedSubject,
          body: trimmedBody,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to submit this request right now.', 'error')
        return
      }

      pushToast(requestType === 'FEATURE_REQUEST' ? 'Feature request submitted.' : 'Customer service request submitted.', 'success')
      setSubject('')
      setBody('')
      await loadOverview()
    } catch (error) {
      console.error('[settings/support] Failed to submit request', error)
      pushToast('Unable to submit this request right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [body, loadOverview, requestType, subject, submitting])

  return (
    <DashboardShell className="bg-slate-50" mainClassName="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Settings</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Customer Support</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Customer-service requests, feature requests, and your filed content reports all live here so support history stays in one place.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Settings
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Open Support</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{openSupportCount.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Open Content Reports</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{openReportCount.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Total Activity</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{(supportRequests.length + contentReports.length).toLocaleString()}</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setRequestType('CUSTOMER_SERVICE')}
            className={clsx(
              'rounded-2xl border px-4 py-4 text-left transition',
              requestType === 'CUSTOMER_SERVICE'
                ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5'
                : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span className="inline-flex rounded-xl bg-slate-100 p-2 text-slate-700">
              <HiOutlineChatBubbleLeftRight className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-900">Customer Service Request</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Account issues, billing problems, shipping trouble, or help using Civil.</p>
          </button>

          <button
            type="button"
            onClick={() => setRequestType('FEATURE_REQUEST')}
            className={clsx(
              'rounded-2xl border px-4 py-4 text-left transition',
              requestType === 'FEATURE_REQUEST'
                ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5'
                : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span className="inline-flex rounded-xl bg-slate-100 p-2 text-slate-700">
              <HiOutlineLightBulb className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-900">Feature Request</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Product ideas, workflow improvements, and missing tools you want Civil to add.</p>
          </button>

          <button
            type="button"
            onClick={scrollToReportedContent}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-slate-300"
          >
            <span className="inline-flex rounded-xl bg-slate-100 p-2 text-slate-700">
              <HiOutlineFlag className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-900">Reported Content</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Content reports start from the settings icon on the exact post, organization, listing, or product, then appear here.
            </p>
          </button>
        </div>

        <div className="mt-6 flex items-start gap-3">
          <span className="rounded-2xl bg-slate-100 p-3 text-slate-700">
            {requestType === 'FEATURE_REQUEST' ? <HiOutlineLightBulb className="h-5 w-5" /> : <HiOutlineChatBubbleLeftRight className="h-5 w-5" />}
          </span>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">New Request</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Open a support thread</h2>
            <p className="mt-2 text-sm text-slate-600">
              Report account problems, billing issues, or feature ideas. Content abuse reports still start from the settings icon on the content itself so Civil can preserve the exact context.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="support-subject" className="text-sm font-semibold text-slate-900">
              Subject
            </label>
            <input
              id="support-subject"
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={160}
              placeholder={requestType === 'FEATURE_REQUEST' ? 'What feature should Civil add?' : 'What do you need help with?'}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
            />
          </div>
          <div>
            <label htmlFor="support-body" className="text-sm font-semibold text-slate-900">
              Details
            </label>
            <textarea
              id="support-body"
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={4000}
              placeholder={
                requestType === 'FEATURE_REQUEST'
                  ? 'Describe the workflow, what is missing today, and how this should work.'
                  : 'Describe the issue, what you expected, and any useful context.'
              }
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                void handleSubmit()
              }}
              disabled={submitting || subject.trim().length < 3 || body.trim().length < 10}
              className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : requestType === 'FEATURE_REQUEST' ? 'Submit feature request' : 'Submit support request'}
            </button>
          </div>
        </div>
      </section>

      <section id="reported-content" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-slate-100 p-3 text-slate-700">
            <HiOutlineChatBubbleLeftRight className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">History</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Your Support Requests</h2>
          </div>
        </div>

        {status === 'loading' ? <p className="mt-6 text-sm text-slate-500">Loading your requests…</p> : null}
        {status === 'error' ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Unable to load your support history right now.
          </div>
        ) : null}
        {status === 'ready' && !supportRequests.length ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No support requests yet.
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {supportRequests.map((item) => {
            const reviewerName = item.reviewedBy ? item.reviewedBy.name?.trim() || `@${item.reviewedBy.handle}` : null
            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{formatSupportType(item.type)}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">{item.subject}</h3>
                    <p className="mt-1 text-sm text-slate-500">Submitted {formatDateTime(item.createdAt)}</p>
                  </div>
                  <span
                    className={clsx(
                      'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                      item.status === 'OPEN'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {item.status === 'OPEN' ? 'Open' : 'Reviewed'}
                  </span>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p>
                {item.adminNotes ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">Admin Notes</p>
                    <p className="mt-2 whitespace-pre-wrap">{item.adminNotes}</p>
                    {reviewerName ? <p className="mt-2 text-xs text-emerald-800/80">Reviewed by {reviewerName}</p> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-slate-100 p-3 text-slate-700">
            <HiOutlineFlag className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Moderation</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Reported Content</h2>
            <p className="mt-2 text-sm text-slate-600">
              These reports were filed from the settings icon on specific posts, organizations, listings, or products so the target context stays exact.
            </p>
          </div>
        </div>

        {status === 'ready' && !contentReports.length ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No content reports filed yet.
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {contentReports.map((item) => {
            const reviewerName = item.reviewedBy ? item.reviewedBy.name?.trim() || `@${item.reviewedBy.handle}` : null
            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{formatTargetType(item.targetType)}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">{item.targetLabel || 'Untitled target'}</h3>
                    <p className="mt-1 text-sm text-slate-500">Reported {formatDateTime(item.createdAt)}</p>
                  </div>
                  <span
                    className={clsx(
                      'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                      item.status === 'OPEN'
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {item.status === 'OPEN' ? 'Open' : 'Reviewed'}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.reasons.map((reason) => (
                    <span
                      key={`${item.id}:${reason}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                    >
                      {formatReasonLabel(reason)}
                    </span>
                  ))}
                </div>
                {item.details ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.details}</p> : null}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>Quarantined {formatDateTime(item.quarantineAppliedAt)}</span>
                  <span>Reviewed {formatDateTime(item.reviewedAt)}</span>
                  {item.targetUrl ? (
                    <a href={item.targetUrl} className="font-semibold text-[var(--cc-primary)] hover:underline">
                      Original route
                    </a>
                  ) : null}
                </div>
                {item.reviewNotes ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">Review Notes</p>
                    <p className="mt-2 whitespace-pre-wrap">{item.reviewNotes}</p>
                    {reviewerName ? <p className="mt-2 text-xs text-emerald-800/80">Reviewed by {reviewerName}</p> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>
    </DashboardShell>
  )
}
