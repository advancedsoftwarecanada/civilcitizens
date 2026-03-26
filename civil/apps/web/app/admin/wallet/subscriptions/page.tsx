"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import AdminWideShell from '../../_components/AdminWideShell'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { clearAuthSession } from '../../../_lib/authSession'
import { useAdminAccess } from '../../_hooks/useAdminAccess'

type AdminWalletSubscriptionsResponse = {
  summary: {
    activeCount: number
    pausedCount: number
    canceledCount: number
    activeAmountCents: number
    dueCount: number
  }
  items: Array<{
    id: string
    amountCents: number
    intervalUnit: string
    status: 'active' | 'paused' | 'canceled'
    nextChargeAt: string | null
    lastChargeAt: string | null
    pausedAt: string | null
    canceledAt: string | null
    createdAt: string
    updatedAt: string
    post: {
      id: string
      title: string | null
      slug: string | null
      path: string | null
    }
    subscriber: {
      id: string
      handle: string | null
      name: string | null
      email: string | null
    }
    recipient: {
      id: string
      handle: string | null
      name: string | null
      email: string | null
    }
  }>
  generatedAt: string
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
type FilterStatus = 'all' | 'active' | 'paused' | 'canceled'

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((Number(cents) || 0) / 100)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatPerson(name: string | null, handle: string | null) {
  return name?.trim() || (handle ? `@${handle}` : 'Unknown user')
}

export default function AdminWalletSubscriptionsPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('active')
  const [payload, setPayload] = useState<AdminWalletSubscriptionsResponse | null>(null)
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    let cancelled = false

    const loadSubscriptions = async () => {
      setStatus('loading')
      setError(null)
      try {
        const search = new URLSearchParams({ status: statusFilter, limit: '150' })
        const res = await fetch(buildApiUrl(`/admin/wallet/subscriptions?${search.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (res.status === 401) {
          clearAuthSession()
          redirectToAuthModal('login')
          return
        }
        if (res.status === 403) {
          setStatus('error')
          setError('Admin access denied for this account.')
          return
        }
        if (!res.ok) {
          setStatus('error')
          setError('Unable to load subscription data. Try refreshing the page.')
          return
        }
        const nextPayload = (await res.json()) as AdminWalletSubscriptionsResponse
        if (!cancelled) {
          setPayload(nextPayload)
          setStatus('ready')
        }
      } catch (err) {
        console.error('[admin/wallet/subscriptions] Failed to load subscriptions', err)
        if (!cancelled) {
          setStatus('error')
          setError('Unexpected error while loading subscriptions.')
        }
      }
    }

    void loadSubscriptions()
    return () => {
      cancelled = true
    }
  }, [isSuperAdmin, statusFilter, token])

  const filterButtons = useMemo(
    () => [
      { key: 'active', label: 'Active' },
      { key: 'paused', label: 'Paused' },
      { key: 'canceled', label: 'Canceled' },
      { key: 'all', label: 'All' },
    ] as Array<{ key: FilterStatus; label: string }>,
    [],
  )

  const renderMain = () => {
    if (accessLoading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading subscription data…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }
    if (status === 'loading' || status === 'idle') {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading subscription data…</div>
    }
    if (status === 'error') {
      return <div className="surface-card border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">{error}</div>
    }
    if (!payload) return null

    return (
      <>
        <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
          <header className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Wallet</p>
            <h1 className="text-xl font-semibold text-slate-900">Cause subscriptions</h1>
            <p className="text-sm text-slate-600">Review active, paused, and canceled recurring Cause support billed from Civil Wallet balances.</p>
          </header>

          <div className="flex flex-wrap gap-2">
            <Link href="/admin/wallet" className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              Back to wallet
            </Link>
            {filterButtons.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={clsx(
                  'inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition',
                  statusFilter === item.key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Active</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{payload.summary.activeCount}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Paused</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{payload.summary.pausedCount}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Canceled</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{payload.summary.canceledCount}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Active Monthly Volume</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{formatMoney(payload.summary.activeAmountCents)}</p>
              <p className="mt-2 text-sm text-slate-500">Due now: {payload.summary.dueCount}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          {payload.items.length ? (
            payload.items.map((item) => (
              <article key={item.id} className="surface-card space-y-4 px-6 py-5 shadow-subtle">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Cause</p>
                    {item.post.path ? (
                      <Link href={item.post.path} className="text-lg font-semibold text-slate-900 hover:underline">
                        {item.post.title ?? item.post.slug ?? 'Untitled Cause'}
                      </Link>
                    ) : (
                      <p className="text-lg font-semibold text-slate-900">{item.post.title ?? item.post.slug ?? 'Untitled Cause'}</p>
                    )}
                  </div>
                  <span
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]',
                      item.status === 'active'
                        ? 'bg-emerald-100 text-emerald-800'
                        : item.status === 'paused'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 text-slate-700',
                    )}
                  >
                    {item.status}
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Amount</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">{formatMoney(item.amountCents)} {item.intervalUnit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Subscriber</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{formatPerson(item.subscriber.name, item.subscriber.handle)}</p>
                    <p className="text-sm text-slate-500">{item.subscriber.email ?? 'No email'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Cause owner</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{formatPerson(item.recipient.name, item.recipient.handle)}</p>
                    <p className="text-sm text-slate-500">{item.recipient.email ?? 'No email'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Timeline</p>
                    <p className="mt-1 text-sm text-slate-700">Next: {formatDateTime(item.nextChargeAt)}</p>
                    <p className="text-sm text-slate-500">Last: {formatDateTime(item.lastChargeAt)}</p>
                  </div>
                </div>

                <div className="grid gap-3 text-sm text-slate-500 md:grid-cols-3">
                  <p>Created: {formatDateTime(item.createdAt)}</p>
                  <p>Updated: {formatDateTime(item.updatedAt)}</p>
                  <p>
                    {item.status === 'paused'
                      ? `Paused: ${formatDateTime(item.pausedAt)}`
                      : item.status === 'canceled'
                        ? `Canceled: ${formatDateTime(item.canceledAt)}`
                        : `Next attempt: ${formatDateTime(item.nextChargeAt)}`}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <div className="surface-card p-6 text-sm text-slate-500 shadow-subtle">No subscriptions matched this filter.</div>
          )}
        </section>

        <section className="surface-card px-6 py-5 text-sm text-slate-500 shadow-subtle">
          <p className="font-semibold text-slate-700">Generated</p>
          <p className="mt-1">{new Date(payload.generatedAt).toLocaleString()}</p>
        </section>
      </>
    )
  }

  return <AdminWideShell className="bg-slate-50" mainClassName="space-y-6">{renderMain()}</AdminWideShell>
}