'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FaWallet } from 'react-icons/fa'
import DashboardShell from '../_components/DashboardShell'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

function getAuthToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('token')
}

function normalizeEmail(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function formatCredits(cents: number) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`
}

export default function WalletPage() {
  const viewer = useViewerStore((state) => state.me)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [eTransferEmail, setETransferEmail] = useState('')
  const [sharing, setSharing] = useState({ family: false, friends: false, market: false })

  const wallet = viewer?.wallet ?? null
  const storedEmail = normalizeEmail(wallet?.eTransferEmail)
  const storedEnabled = Boolean(wallet?.enabled)
  const storedSharing = {
    family: Boolean(wallet?.sharing?.family),
    friends: Boolean(wallet?.sharing?.friends),
    market: Boolean(wallet?.sharing?.market),
  }
  const civilCreditsLabel = useMemo(() => formatCredits(wallet?.civilCreditsCents ?? 0), [wallet?.civilCreditsCents])
  const normalizedInput = normalizeEmail(eTransferEmail)
  const hasChanges =
    normalizedInput !== storedEmail ||
    enabled !== storedEnabled ||
    sharing.family !== storedSharing.family ||
    sharing.friends !== storedSharing.friends ||
    sharing.market !== storedSharing.market
  const emailIsValid = !normalizedInput || isValidEmail(normalizedInput)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const me = await ensureViewerMe({ refresh: true })
        if (cancelled) return
        setETransferEmail(normalizeEmail(me?.wallet?.eTransferEmail))
        setEnabled(Boolean(me?.wallet?.enabled))
        setSharing({
          family: Boolean(me?.wallet?.sharing?.family),
          friends: Boolean(me?.wallet?.sharing?.friends),
          market: Boolean(me?.wallet?.sharing?.market),
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    setETransferEmail(storedEmail)
    setEnabled(storedEnabled)
    setSharing(storedSharing)
  }, [loading, storedEmail, storedEnabled, storedSharing.family, storedSharing.friends, storedSharing.market])

  const handleSave = async () => {
    if (enabled && !normalizedInput) {
      pushToast('Add an eTransfer email address before enabling it.', 'error')
      return
    }
    if (!emailIsValid) {
      pushToast('Enter a valid eTransfer email address.', 'error')
      return
    }

    const token = getAuthToken()
    if (!token) {
      pushToast('Sign in to manage your wallet.', 'error')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(buildApiUrl('/auth/wallet'), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled,
          eTransferEmail: normalizedInput || null,
          sharing,
        }),
      })

      if (!response.ok) {
        pushToast('Unable to save your wallet right now.', 'error')
        return
      }

      const refreshed = await ensureViewerMe({ token, refresh: true })
      setETransferEmail(normalizeEmail(refreshed?.wallet?.eTransferEmail))
      setEnabled(Boolean(refreshed?.wallet?.enabled))
      setSharing({
        family: Boolean(refreshed?.wallet?.sharing?.family),
        friends: Boolean(refreshed?.wallet?.sharing?.friends),
        market: Boolean(refreshed?.wallet?.sharing?.market),
      })
      pushToast('Wallet updated.', 'success')
    } catch {
      pushToast('Unable to save your wallet right now.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const rightRail = (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Wallet Use</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Choose where your wallet eTransfer address can appear. Market only reveals it after you select a buyer.
        </p>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Connected Areas</p>
        <div className="mt-3 space-y-2 text-sm text-slate-600">
          <p>Market listings read this email directly from your wallet.</p>
          <Link href="/market/listings" className="inline-flex rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
            Open Market listings
          </Link>
        </div>
      </section>
    </div>
  )

  return (
    <DashboardShell rightRail={rightRail} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-3xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <FaWallet className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Wallet</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-900">Civil Wallet</h1>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Balance</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">Civil Credits: {civilCreditsLabel}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Payouts</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Etransfer Address</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              This address stays private until you choose a buyer. Civil will then automatically show your eTransfer email address to the buyer.
            </p>
          </div>
        </div>

        <div className="mt-5 max-w-xl space-y-2">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={eTransferEmail}
            onChange={(event) => setETransferEmail(event.target.value)}
            placeholder="you@example.ca"
            className={`w-full rounded-2xl border px-4 py-3 text-sm text-slate-900 focus:outline-none ${emailIsValid ? 'border-slate-200 focus:border-[var(--cc-primary)]' : 'border-rose-300 focus:border-rose-500'}`}
            disabled={loading || saving}
          />
          {!emailIsValid ? <p className="text-sm text-rose-600">Enter a valid email address.</p> : null}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={loading || saving}
            />
            Enable ETransfer email address
          </label>

          <div className="mt-4 space-y-3 pl-1">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sharing.family}
                onChange={(event) => setSharing((prev) => ({ ...prev, family: event.target.checked }))}
                disabled={loading || saving || !enabled}
              />
              <span>
                <span className="font-semibold">Shared with</span>
                <span className="block text-slate-600">Family</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sharing.friends}
                onChange={(event) => setSharing((prev) => ({ ...prev, friends: event.target.checked }))}
                disabled={loading || saving || !enabled}
              />
              <span>
                <span className="font-semibold">Shared with</span>
                <span className="block text-slate-600">Friends</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sharing.market}
                onChange={(event) => setSharing((prev) => ({ ...prev, market: event.target.checked }))}
                disabled={loading || saving || !enabled}
              />
              <span>
                <span className="font-semibold">Shared with</span>
                <span className="block text-slate-600">Market (only revealed once a buyer is selected)</span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving || !hasChanges || !emailIsValid}
            className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save wallet'}
          </button>
        </div>
      </section>
    </DashboardShell>
  )
}
