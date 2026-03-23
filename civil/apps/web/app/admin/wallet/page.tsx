"use client"

import { useEffect, useState } from 'react'
import AdminWideShell from '../_components/AdminWideShell'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { clearAuthSession } from '../../_lib/authSession'
import { useAdminAccess } from '../_hooks/useAdminAccess'

type AdminWalletResponse = {
  wallet: {
    balanceCents: number
    inEscrowHoldingCents: number
    activeEscrowCount: number
  }
  generatedAt: string
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((Number(cents) || 0) / 100)
}

export default function AdminWalletPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [summary, setSummary] = useState<AdminWalletResponse | null>(null)
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    let cancelled = false

    const loadWallet = async () => {
      setStatus('loading')
      setError(null)
      try {
        const res = await fetch(buildApiUrl('/admin/wallet'), {
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
          setError('Unable to load wallet data. Try refreshing the page.')
          return
        }
        const payload = (await res.json()) as AdminWalletResponse
        if (!cancelled) {
          setSummary(payload)
          setStatus('ready')
        }
      } catch (err) {
        console.error('[admin/wallet] Failed to load wallet summary', err)
        if (!cancelled) {
          setStatus('error')
          setError('Unexpected error while loading wallet data.')
        }
      }
    }

    void loadWallet()
    return () => {
      cancelled = true
    }
  }, [isSuperAdmin, token])

  const renderMain = () => {
    if (accessLoading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading wallet summary…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }
    if (status === 'loading' || status === 'idle') {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading wallet summary…</div>
    }
    if (status === 'error') {
      return <div className="surface-card border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">{error}</div>
    }
    if (!summary) return null

    return (
      <>
        <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
          <header className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Wallet</p>
            <h1 className="text-xl font-semibold text-slate-900">Civil platform wallet</h1>
            <p className="text-sm text-slate-600">Review platform fee balance and active ride escrow holdings.</p>
          </header>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Balance</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{formatMoney(summary.wallet.balanceCents)}</p>
              <p className="mt-2 text-sm text-slate-500">Completed platform fees currently recorded in the ledger.</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">In Escrow Holding</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{formatMoney(summary.wallet.inEscrowHoldingCents)}</p>
              <p className="mt-2 text-sm text-slate-500">Customer funds currently being held for active drive rides.</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Active Escrows</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{summary.wallet.activeEscrowCount}</p>
              <p className="mt-2 text-sm text-slate-500">Ride escrow holds still waiting to be released.</p>
            </div>
          </div>
        </section>

        <section className="surface-card px-6 py-5 text-sm text-slate-500 shadow-subtle">
          <p className="font-semibold text-slate-700">Generated</p>
          <p className="mt-1">{new Date(summary.generatedAt).toLocaleString()}</p>
        </section>
      </>
    )
  }

  return (
    <AdminWideShell className="bg-slate-50" mainClassName="space-y-6">
      {renderMain()}
    </AdminWideShell>
  )
}