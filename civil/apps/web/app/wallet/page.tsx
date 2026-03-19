'use client'

import Link from 'next/link'
import { PaymentElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FaWallet } from 'react-icons/fa'
import { HiOutlineCheckCircle } from 'react-icons/hi2'
import DashboardShell from '../_components/DashboardShell'
import Modal from '../_components/Modal'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

type WalletConnectStatus = {
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

type WalletDepositSession = {
  clientSecret: string
  customerSessionClientSecret?: string | null
  paymentIntentId: string
  publishableKey: string
}

type WalletRouteErrorPayload = {
  error?: string
}

type WalletSummaryPayload = {
  civilCreditsCents?: number
  enabled?: boolean
  eTransferEmail?: string | null
  stripeCustomerId?: string | null
  sharing?: {
    family?: boolean
    friends?: boolean
    market?: boolean
  } | null
  stripeConnect?: {
    accountId?: string | null
    chargesEnabled?: boolean
    payoutsEnabled?: boolean
    detailsSubmitted?: boolean
  } | null
} | null

const WALLET_TOP_UP_PRESETS = ['25.00', '50.00', '100.00', '250.00', '500.00', '1000.00'] as const

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

function parseMoneyInputToCents(value: string) {
  const amount = Number(String(value ?? '').replace(/[^0-9.]/g, '').trim())
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return Math.round(amount * 100)
}

function calculateStripeProcessingFeeCents(amountCents: number) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
  return Math.round(amountCents * 0.029) + 30
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function applyWalletSummaryToViewer(wallet: WalletSummaryPayload) {
  if (!wallet) return
  const store = useViewerStore.getState()
  if (!store.me) return
  store.setMe({
    ...store.me,
    wallet: {
      ...(store.me.wallet ?? {}),
      ...wallet,
    },
  })
}

function getWalletConnectErrorMessage(errorCode: string | null | undefined) {
  switch (errorCode) {
    case 'stripe_connect_not_enabled':
      return 'Stripe Connect is not enabled on this Stripe account yet. Enable Connect in the Stripe dashboard first.'
    case 'stripe_not_configured':
      return 'Stripe is not configured for payouts in this environment yet.'
    case 'wallet_connect_account_failed':
    case 'wallet_connect_onboard_failed':
      return 'Unable to start secure Stripe onboarding right now.'
    default:
      return 'Unable to start Stripe payout setup.'
  }
}

function normalizeConnectStatus(status: Partial<WalletConnectStatus> | null | undefined): WalletConnectStatus {
  return {
    accountId: typeof status?.accountId === 'string' ? status.accountId : null,
    chargesEnabled: Boolean(status?.chargesEnabled),
    payoutsEnabled: Boolean(status?.payoutsEnabled),
    detailsSubmitted: Boolean(status?.detailsSubmitted),
  }
}

export default function WalletPage() {
  const viewer = useViewerStore((state) => state.me)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectStatus, setConnectStatus] = useState<WalletConnectStatus | null>(null)
  const [topUpModalOpen, setTopUpModalOpen] = useState(false)
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
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
  const storedConnectStatus = useMemo<WalletConnectStatus>(
    () => ({
      accountId: wallet?.stripeConnect?.accountId ?? null,
      chargesEnabled: Boolean(wallet?.stripeConnect?.chargesEnabled),
      payoutsEnabled: Boolean(wallet?.stripeConnect?.payoutsEnabled),
      detailsSubmitted: Boolean(wallet?.stripeConnect?.detailsSubmitted),
    }),
    [wallet?.stripeConnect?.accountId, wallet?.stripeConnect?.chargesEnabled, wallet?.stripeConnect?.detailsSubmitted, wallet?.stripeConnect?.payoutsEnabled],
  )
  const civilCreditsLabel = useMemo(() => formatCredits(wallet?.civilCreditsCents ?? 0), [wallet?.civilCreditsCents])
  const balanceCents = wallet?.civilCreditsCents ?? 0
  const normalizedInput = normalizeEmail(eTransferEmail)
  const hasChanges =
    normalizedInput !== storedEmail ||
    enabled !== storedEnabled ||
    sharing.family !== storedSharing.family ||
    sharing.friends !== storedSharing.friends ||
    sharing.market !== storedSharing.market
  const emailIsValid = !normalizedInput || isValidEmail(normalizedInput)

  const loadConnectStatus = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? getAuthToken()
    if (!token) return null

    setConnectLoading(true)
    try {
      const response = await fetch(buildApiUrl('/auth/wallet/connect/status'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      if (!response.ok) {
        setConnectStatus(storedConnectStatus)
        return storedConnectStatus
      }

      const payload = (await response.json().catch(() => null)) as Partial<WalletConnectStatus> | null
      const nextStatus = normalizeConnectStatus(payload)
      setConnectStatus(nextStatus)
      await ensureViewerMe({ token, refresh: true })
      return nextStatus
    } catch {
      setConnectStatus(storedConnectStatus)
      return storedConnectStatus
    } finally {
      setConnectLoading(false)
    }
  }, [storedConnectStatus])

  const refreshWallet = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return
    await ensureViewerMe({ token, refresh: true })
    await loadConnectStatus(token)
  }, [loadConnectStatus])

  const startConnectOnboarding = useCallback(async () => {
    const token = getAuthToken()
    if (!token) {
      pushToast('Sign in to manage your wallet.', 'error')
      return
    }

    setConnectLoading(true)
    try {
      const accountRes = await fetch(buildApiUrl('/auth/wallet/connect/account'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!accountRes.ok) {
        const accountPayload = (await accountRes.json().catch(() => null)) as WalletRouteErrorPayload | null
        pushToast(getWalletConnectErrorMessage(accountPayload?.error), 'error', 7000)
        return
      }

      const onboardRes = await fetch(buildApiUrl('/auth/wallet/connect/onboard'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const onboardPayload = (await onboardRes.json().catch(() => null)) as ({ url?: unknown } & WalletRouteErrorPayload) | null
      const url = typeof onboardPayload?.url === 'string' ? onboardPayload.url : null
      if (!onboardRes.ok || !url) {
        pushToast(getWalletConnectErrorMessage(onboardPayload?.error), 'error', 7000)
        return
      }

      window.location.href = url
    } catch {
      pushToast('Unable to start Stripe payout setup.', 'error')
    } finally {
      setConnectLoading(false)
    }
  }, [])

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
        setConnectStatus({
          accountId: me?.wallet?.stripeConnect?.accountId ?? null,
          chargesEnabled: Boolean(me?.wallet?.stripeConnect?.chargesEnabled),
          payoutsEnabled: Boolean(me?.wallet?.stripeConnect?.payoutsEnabled),
          detailsSubmitted: Boolean(me?.wallet?.stripeConnect?.detailsSubmitted),
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
    setConnectStatus(storedConnectStatus)
  }, [loading, storedConnectStatus, storedEmail, storedEnabled, storedSharing.family, storedSharing.friends, storedSharing.market])

  useEffect(() => {
    if (loading) return
    const token = getAuthToken()
    if (!token) return
    void loadConnectStatus(token)
  }, [loadConnectStatus, loading])

  useEffect(() => {
    if (loading || typeof window === 'undefined') return
    const token = getAuthToken()
    if (!token) return

    const url = new URL(window.location.href)
    const connectAction = url.searchParams.get('connect')
    if (connectAction !== 'return' && connectAction !== 'refresh') return

    let cancelled = false
    void (async () => {
      const latestStatus = await loadConnectStatus(token)
      if (cancelled) return

      if (connectAction === 'return') {
        if (latestStatus?.payoutsEnabled) {
          pushToast('Stripe payouts are now enabled.', 'success')
        } else {
          pushToast('Stripe still needs a little more information before payouts can be enabled.', 'warning', 6000)
        }
      } else {
        pushToast('Stripe onboarding reopened.', 'info')
      }

      url.searchParams.delete('connect')
      const nextQuery = url.searchParams.toString()
      window.history.replaceState({}, '', `${url.pathname}${nextQuery ? `?${nextQuery}` : ''}${url.hash}`)
    })()

    return () => {
      cancelled = true
    }
  }, [loadConnectStatus, loading])

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
      setConnectStatus({
        accountId: refreshed?.wallet?.stripeConnect?.accountId ?? null,
        chargesEnabled: Boolean(refreshed?.wallet?.stripeConnect?.chargesEnabled),
        payoutsEnabled: Boolean(refreshed?.wallet?.stripeConnect?.payoutsEnabled),
        detailsSubmitted: Boolean(refreshed?.wallet?.stripeConnect?.detailsSubmitted),
      })
      pushToast('Wallet updated.', 'success')
    } catch {
      pushToast('Unable to save your wallet right now.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const stripeReady = Boolean(connectStatus?.payoutsEnabled)
  const needsMoreStripeDetails = Boolean(connectStatus?.accountId && !connectStatus?.payoutsEnabled)
  const bankActionLabel = connectLoading
    ? 'Working…'
    : stripeReady
      ? 'Deposit To Bank Account'
      : connectStatus?.accountId
        ? 'Finish Payout Setup'
        : 'Set Up Payouts'
  const bankActionHint = stripeReady
    ? 'Move Civil Credits back to your connected bank account through Stripe Connect.'
    : needsMoreStripeDetails
      ? 'Stripe still needs a few details before payouts can be enabled. Continue the secure setup to finish.'
      : 'First click opens Stripe-hosted onboarding. It is a secure setup flow, not a Stripe login.'
  const connectStatusTone = stripeReady
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : needsMoreStripeDetails
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  const connectStatusTitle = stripeReady
    ? 'Bank payouts are ready.'
    : needsMoreStripeDetails
      ? 'Your payout account needs more information.'
      : 'Set up Stripe payouts once to withdraw Civil Credits.'
  const connectStatusBody = stripeReady
    ? 'You can deposit Civil Credits to your connected bank account whenever you are ready.'
    : needsMoreStripeDetails
      ? 'Stripe Connect handles identity checks and bank details in a hosted flow, then brings the user back here.'
      : 'The setup is hosted by Stripe and usually takes a couple of minutes.'
  const manageStripeButtonLabel = connectLoading
    ? 'Working…'
    : stripeReady
      ? 'Manage Stripe Setup'
      : connectStatus?.accountId
        ? 'Continue Stripe Setup'
        : 'Start Stripe Setup'

  const rightRail = (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Wallet Use</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Add funds with Stripe, move balance back to your bank with Stripe Connect, and choose where your wallet eTransfer address can appear.
        </p>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Connected Areas</p>
        <div className="mt-3 space-y-2 text-sm text-slate-600">
          <p>Market listings read this email directly from your wallet.</p>
          <p>Send Money can transfer Civil Credits when the other person has Stripe Connect payouts enabled.</p>
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
            <h1 className="text-3xl font-semibold text-slate-900">Civil Wallet</h1>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Balance</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">Civil Credits: {civilCreditsLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTopUpModalOpen(true)}
              className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Add Funds
            </button>
            <button
              type="button"
              onClick={() => {
                if (!stripeReady) {
                  void startConnectOnboarding()
                  return
                }
                setPayoutModalOpen(true)
              }}
              disabled={connectLoading || (stripeReady && balanceCents < 100)}
              className="inline-flex items-center justify-center rounded-full border border-emerald-700 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bankActionLabel}
            </button>
          </div>
        </div>
        <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${connectStatusTone}`}>
          <p className="font-semibold">{connectStatusTitle}</p>
          <p className="mt-1 text-sm/6 opacity-90">{bankActionHint}</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Stripe Connect</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Bank payouts</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Stripe Connect handles identity verification and bank account collection in a hosted onboarding flow. Civil should feel like setup, not a Stripe login.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadConnectStatus()}
              disabled={connectLoading}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void startConnectOnboarding()}
              disabled={connectLoading}
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {manageStripeButtonLabel}
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${connectStatusTone}`}>
          <p className="font-semibold">{connectStatusTitle}</p>
          <p className="mt-1 leading-6 opacity-90">{connectStatusBody}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Account: {connectStatus?.accountId ? 'Connected' : 'Not connected'}</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Details: {connectStatus?.detailsSubmitted ? 'Submitted' : 'Missing'}</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Charges: {connectStatus?.chargesEnabled ? 'Enabled' : 'Disabled'}</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Payouts: {connectStatus?.payoutsEnabled ? 'Enabled' : 'Disabled'}</span>
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

      <WalletTopUpModal
        open={topUpModalOpen}
        token={getAuthToken()}
        initialBalanceCents={balanceCents}
        onClose={() => setTopUpModalOpen(false)}
        onComplete={async () => {
          await refreshWallet()
          setTopUpModalOpen(false)
        }}
      />

      <WalletPayoutModal
        open={payoutModalOpen}
        token={getAuthToken()}
        balanceCents={balanceCents}
        onClose={() => setPayoutModalOpen(false)}
        onComplete={async () => {
          await refreshWallet()
          setPayoutModalOpen(false)
        }}
      />
    </DashboardShell>
  )
}

function WalletTopUpModal({
  open,
  token,
  initialBalanceCents,
  onClose,
  onComplete,
}: {
  open: boolean
  token: string | null
  initialBalanceCents: number
  onClose: () => void
  onComplete: () => Promise<void>
}) {
  const [amount, setAmount] = useState<(typeof WALLET_TOP_UP_PRESETS)[number]>('100.00')
  const [creating, setCreating] = useState(false)
  const [session, setSession] = useState<WalletDepositSession | null>(null)

  useEffect(() => {
    if (!open) {
      setAmount('100.00')
      setCreating(false)
      setSession(null)
    }
  }, [open])

  const amountCents = parseMoneyInputToCents(amount)
  const processingFeeCents = calculateStripeProcessingFeeCents(amountCents)
  const stripePromise = useMemo(() => (session?.publishableKey ? loadStripe(session.publishableKey) : null), [session?.publishableKey])

  const createSession = async () => {
    if (!token) {
      pushToast('Sign in to add funds.', 'error')
      return
    }
    if (amountCents < 100) {
      pushToast('Enter at least $1.00 to add funds.', 'error')
      return
    }

    setCreating(true)
    try {
      const response = await fetch(buildApiUrl('/auth/wallet/deposits/intent'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amountCents }),
      })
      const payload = (await response.json().catch(() => null)) as Partial<WalletDepositSession> | null
      if (!response.ok || !payload?.clientSecret || !payload?.paymentIntentId || !payload?.publishableKey) {
        pushToast('Unable to start wallet funding right now.', 'error')
        return
      }

      setSession({
        clientSecret: payload.clientSecret,
        customerSessionClientSecret: typeof payload.customerSessionClientSecret === 'string' ? payload.customerSessionClientSecret : null,
        paymentIntentId: payload.paymentIntentId,
        publishableKey: payload.publishableKey,
      })
    } catch {
      pushToast('Unable to start wallet funding right now.', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Funds" maxWidthClassName="max-w-lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <p>Add money to your Civil Credits balance using Stripe.</p>
          <a
            href="https://stripe.com/"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 transition hover:border-emerald-300 hover:bg-emerald-100"
            aria-label="Learn more about Stripe security"
            title="Learn more about Stripe"
          >
            <img src="/stripe-secure-badge.png" alt="Stripe secure payments" className="h-5 w-auto" />
          </a>
        </div>

        {!session ? (
          <div className="space-y-3">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-800">Amount</span>
              <select
                value={amount}
                onChange={(event) => setAmount(event.target.value as (typeof WALLET_TOP_UP_PRESETS)[number])}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none"
              >
                {WALLET_TOP_UP_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    ${preset.replace(/\.00$/, '')}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-slate-500">Processing fee: {formatCredits(processingFeeCents)} (secure payment via Stripe)</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createSession()}
                disabled={creating || amountCents < 100}
                className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? 'Preparing…' : 'Continue to payment'}
              </button>
            </div>
          </div>
        ) : stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: session.clientSecret,
              customerSessionClientSecret: session.customerSessionClientSecret ?? undefined,
              appearance: {
                theme: 'stripe',
                variables: { colorPrimary: '#C8102E' },
              },
            }}
          >
            <WalletTopUpCheckoutForm
              session={session}
              token={token}
              initialBalanceCents={initialBalanceCents}
              depositAmountCents={amountCents}
              onClose={onClose}
              onComplete={onComplete}
            />
          </Elements>
        ) : null}
      </div>
    </Modal>
  )
}

function WalletTopUpCheckoutForm({
  session,
  token,
  initialBalanceCents,
  depositAmountCents,
  onClose,
  onComplete,
}: {
  session: WalletDepositSession
  token: string | null
  initialBalanceCents: number
  depositAmountCents: number
  onClose: () => void
  onComplete: () => Promise<void>
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncPendingSuccess, setSyncPendingSuccess] = useState(false)

  const confirmTopUp = useCallback(
    async (paymentIntentId: string) => {
      const response = await fetch(buildApiUrl('/auth/wallet/deposits/confirm'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paymentIntentId }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; wallet?: WalletSummaryPayload } | null
      return {
        ok: response.ok,
        status: response.status,
        error: payload?.error ?? null,
        wallet: payload?.wallet ?? null,
        walletBalanceCents:
          typeof payload?.wallet?.civilCreditsCents === 'number' && Number.isFinite(payload.wallet.civilCreditsCents)
            ? payload.wallet.civilCreditsCents
            : null,
      }
    },
    [token],
  )

  const waitForWalletRefresh = useCallback(
    async (minimumBalanceCents: number) => {
      for (let index = 0; index < 5; index += 1) {
        const me = await ensureViewerMe({ token, refresh: true })
        const currentBalanceCents = typeof me?.wallet?.civilCreditsCents === 'number' ? me.wallet.civilCreditsCents : 0
        if (currentBalanceCents >= minimumBalanceCents) {
          return true
        }
        await sleep(700)
      }
      return false
    },
    [token],
  )

  useEffect(() => {
    if (!syncPendingSuccess || !token) return

    let cancelled = false
    void (async () => {
      try {
        const refreshed = await waitForWalletRefresh(initialBalanceCents + depositAmountCents)
        if (!cancelled && refreshed) {
          pushToast('Funds added to your Civil Wallet.', 'success')
        }
      } finally {
      }
    })()

    return () => {
      cancelled = true
    }
  }, [depositAmountCents, initialBalanceCents, syncPendingSuccess, token, waitForWalletRefresh])

  const submit = async () => {
    if (!token) {
      setError('Sign in to add funds.')
      return
    }
    if (!stripe || !elements) {
      setError('Stripe is still loading.')
      return
    }

    setSubmitting(true)
    setError(null)
    setSyncPendingSuccess(false)
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: typeof window !== 'undefined' ? `${window.location.origin}/wallet` : undefined,
        },
      })

      if (result.error) {
        setError(result.error.message ?? 'Payment failed.')
        return
      }

      const paymentIntentId = result.paymentIntent?.id ?? session.paymentIntentId
      let confirmed = await confirmTopUp(paymentIntentId)
      if (confirmed.wallet) {
        applyWalletSummaryToViewer(confirmed.wallet)
      }
      if (!confirmed.ok && confirmed.error === 'payment_not_completed') {
        for (let attempt = 0; attempt < 4 && !confirmed.ok; attempt += 1) {
          await sleep(700)
          confirmed = await confirmTopUp(paymentIntentId)
          if (confirmed.wallet) {
            applyWalletSummaryToViewer(confirmed.wallet)
          }
          if (confirmed.error !== 'payment_not_completed') break
        }
      }

      const minimumBalanceCents = Math.max(confirmed.walletBalanceCents ?? 0, initialBalanceCents + depositAmountCents)
      if (!confirmed.ok) {
        const refreshed = await waitForWalletRefresh(minimumBalanceCents)
        if (!refreshed) {
          setSyncPendingSuccess(true)
          return
        }
      }

      pushToast('Funds added to your Civil Wallet.', 'success')
      await onComplete()
      onClose()
    } catch {
      setError('Payment failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (syncPendingSuccess) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <HiOutlineCheckCircle className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-emerald-900">Success!</p>
          <p className="mt-2 text-sm text-emerald-800">Funds are now being added to your Civil Wallet.</p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              void ensureViewerMe({ token, refresh: true })
              onClose()
            }}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!stripe || !elements || submitting}
          className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Processing…' : 'Add funds now'}
        </button>
      </div>
    </div>
  )
}

function WalletPayoutModal({
  open,
  token,
  balanceCents,
  onClose,
  onComplete,
}: {
  open: boolean
  token: string | null
  balanceCents: number
  onClose: () => void
  onComplete: () => Promise<void>
}) {
  const [amount, setAmount] = useState('25.00')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setAmount('25.00')
      setSubmitting(false)
    }
  }, [open])

  const amountCents = parseMoneyInputToCents(amount)

  const submit = async () => {
    if (!token) {
      pushToast('Sign in to move funds to your bank account.', 'error')
      return
    }
    if (amountCents < 100) {
      pushToast('Enter at least $1.00 to deposit to your bank account.', 'error')
      return
    }
    if (amountCents > balanceCents) {
      pushToast('That amount is larger than your Civil Credits balance.', 'error')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/auth/wallet/payouts'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amountCents }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        if (payload?.error === 'wallet_connect_required') {
          pushToast('Finish Stripe Connect before depositing to your bank account.', 'error')
        } else if (payload?.error === 'insufficient_wallet_balance') {
          pushToast('That amount is larger than your Civil Credits balance.', 'error')
        } else {
          pushToast('Unable to start the bank deposit right now.', 'error')
        }
        return
      }

      pushToast('Bank deposit started.', 'success')
      await onComplete()
      onClose()
    } catch {
      pushToast('Unable to start the bank deposit right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Deposit To Bank Account" maxWidthClassName="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Move Civil Credits from your wallet into the bank account connected through Stripe Connect.</p>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Available balance: <span className="font-semibold text-slate-900">{formatCredits(balanceCents)}</span>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-800">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="25.00"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || amountCents < 100 || amountCents > balanceCents}
            className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Starting…' : 'Deposit now'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
