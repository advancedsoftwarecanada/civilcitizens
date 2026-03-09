"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

import Modal from '../../_components/Modal'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'

type InspectUserSummary = {
  id: string
  handle: string
  name: string | null
  email: string
  bio: string | null
  avatarUrl: string | null
  coverUrl: string | null
  createdAt: string
  lastLoginAt: string | null
  premiumStatus: string
  communities: {
    count: number
    items: Array<{
      provinceCode: string
      communitySlug: string
      home: boolean
      label: string
      href: string | null
    }>
  }
}

type InspectReport = {
  id: string
  targetType: 'POST' | 'COMMENT' | 'ORGANIZATION' | 'MARKET_LISTING' | 'MARKET_PRODUCT'
  targetLabel: string | null
  targetUrl: string | null
  reasons: string[]
  status: 'OPEN' | 'REVIEWED'
  createdAt: string
}

type InspectPayload = {
  user: InspectUserSummary
  stats: {
    posts: number
    comments: number
    organizationsOwned: number
    reportsFiled: number
    reportsAgainst: number
    jobApplications: number
    jobsCreated: number
    communities: number
  }
  recentPosts: Array<{
    id: string
    title: string
    createdAt: string
    moderationStatus: string
    url: string | null
  }>
  recentComments: Array<{
    id: string
    body: string
    createdAt: string
    post: {
      id: string
      title: string
      url: string | null
    }
  }>
  recentReports: InspectReport[]
}

type AdminUserInspectModalProps = {
  userId: string | null
  token: string | null
  onClose: () => void
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
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

function formatTargetType(value: InspectReport['targetType']) {
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

function formatPremiumStatus(value: string) {
  if (!value || value === 'NONE') return 'No premium membership'
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase())
}

export default function AdminUserInspectModal({ userId, token, onClose }: AdminUserInspectModalProps) {
  const [payload, setPayload] = useState<InspectPayload | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!userId) {
      setPayload(null)
      setStatus('idle')
      return
    }

    const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('token') : null)
    if (!authToken) {
      redirectToAuthModal('login')
      return
    }

    const controller = new AbortController()

    const load = async () => {
      setStatus('loading')
      try {
        const response = await fetch(buildApiUrl(`/admin/users/${encodeURIComponent(userId)}/inspect`), {
          headers: { authorization: `Bearer ${authToken}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) {
          setStatus('error')
          setPayload(null)
          return
        }
        const nextPayload = (await response.json().catch(() => null)) as InspectPayload | null
        if (!nextPayload) {
          setStatus('error')
          setPayload(null)
          return
        }
        setPayload(nextPayload)
        setStatus('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('[admin/user-inspect] failed to load', error)
        setStatus('error')
        setPayload(null)
      }
    }

    void load()
    return () => controller.abort()
  }, [token, userId])

  return (
    <Modal open={Boolean(userId)} onClose={onClose} title="Inspect account" maxWidthClassName="max-w-4xl">
      {status === 'loading' || status === 'idle' ? <p className="text-sm text-slate-500">Loading account details…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Unable to load this user right now.</p> : null}
      {status === 'ready' && payload ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Account</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">{payload.user.name?.trim() || `@${payload.user.handle}`}</h2>
                <p className="mt-1 text-sm text-slate-600">@{payload.user.handle} · {payload.user.email}</p>
              </div>
              <Link
                href={`/u/${encodeURIComponent(payload.user.handle)}`}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Open profile
              </Link>
            </div>
            {payload.user.bio ? <p className="mt-4 text-sm leading-6 text-slate-700">{payload.user.bio}</p> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Joined</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(payload.user.createdAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Last login</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(payload.user.lastLoginAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Premium</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{formatPremiumStatus(payload.user.premiumStatus)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reports against</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{payload.stats.reportsAgainst.toLocaleString()}</p>
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Posts</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{payload.stats.posts.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Comments</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{payload.stats.comments.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Organizations</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{payload.stats.organizationsOwned.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reports filed</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{payload.stats.reportsFiled.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Communities</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{payload.stats.communities.toLocaleString()}</p>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Posts</h3>
              <div className="mt-3 space-y-3">
                {payload.recentPosts.length ? payload.recentPosts.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(entry.createdAt)} · {entry.moderationStatus}</p>
                    {entry.url ? <Link href={entry.url} className="mt-2 inline-flex text-xs font-semibold text-[var(--cc-primary)] hover:underline">Open post</Link> : null}
                  </div>
                )) : <p className="text-sm text-slate-500">No recent posts.</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Communities</h3>
              <div className="mt-3 space-y-3">
                {payload.user.communities.items.length ? payload.user.communities.items.map((entry) => (
                  <div key={`${entry.provinceCode}:${entry.communitySlug}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    {entry.href ? <Link href={entry.href} className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">{entry.label}</Link> : <p className="text-sm font-semibold text-slate-900">{entry.label}</p>}
                  </div>
                )) : <p className="text-sm text-slate-500">No community follows.</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Recent comments</h3>
              <div className="mt-3 space-y-3">
                {payload.recentComments.length ? payload.recentComments.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-700">{entry.body}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-900">{entry.post.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(entry.createdAt)}</p>
                    {entry.post.url ? <Link href={entry.post.url} className="mt-2 inline-flex text-xs font-semibold text-[var(--cc-primary)] hover:underline">Open thread</Link> : null}
                  </div>
                )) : <p className="text-sm text-slate-500">No recent comments.</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Recent reports against</h3>
              <div className="mt-3 space-y-3">
                {payload.recentReports.length ? payload.recentReports.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">{formatTargetType(entry.targetType)}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{entry.targetLabel || 'Untitled target'}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {entry.reasons.map((reason) => (
                        <span key={`${entry.id}:${reason}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          {formatReasonLabel(reason)}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(entry.createdAt)} · {entry.status}</p>
                    {entry.targetUrl ? <Link href={entry.targetUrl} className="mt-2 inline-flex text-xs font-semibold text-[var(--cc-primary)] hover:underline">Open target</Link> : null}
                  </div>
                )) : <p className="text-sm text-slate-500">No reports targeting this user.</p>}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  )
}