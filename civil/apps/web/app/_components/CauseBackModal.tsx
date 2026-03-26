'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { LuRepeat2, LuWallet } from 'react-icons/lu'
import {
  CAUSE_MAXIMUM_CONTRIBUTION_CENTS,
  CAUSE_MINIMUM_CONTRIBUTION_CENTS,
  calculateCausePlatformFeeCents,
} from '@civil/shared'
import type { ApiPost } from './PostComposer'
import Modal from './Modal'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { pushToast } from './useToasts'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format((amountCents || 0) / 100)
}

function readAmountCents(value: string) {
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * 100)
}

function buildCauseLabel(post: ApiPost) {
  const title = post.title?.trim()
  return title ? title : 'this Cause'
}

export default function CauseBackModal({
  post,
  initialAmountInput = '25',
  preferredMode = 'one-time',
  onClose,
  onComplete,
}: {
  post: ApiPost
  initialAmountInput?: string
  preferredMode?: 'one-time' | 'monthly'
  onClose: () => void
  onComplete: (post: ApiPost) => void
}) {
  const viewer = useViewerStore((state) => state.me)
  const [amountInput, setAmountInput] = useState(initialAmountInput)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<'one-time' | 'monthly' | null>(null)

  const amountCents = useMemo(() => readAmountCents(amountInput), [amountInput])
  const feeCents = useMemo(() => calculateCausePlatformFeeCents(amountCents), [amountCents])
  const totalChargeCents = amountCents + feeCents
  const walletBalanceCents = viewer?.wallet?.civilCreditsCents ?? 0
  const currentSubscription = viewer?.wallet?.causeSubscriptions?.find((item) => item.postId === post.id && item.status !== 'canceled') ?? null

  const submit = async (mode: 'one-time' | 'monthly') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (amountCents < CAUSE_MINIMUM_CONTRIBUTION_CENTS || amountCents > CAUSE_MAXIMUM_CONTRIBUTION_CENTS) {
      setError(`Enter an amount between ${formatCurrency(CAUSE_MINIMUM_CONTRIBUTION_CENTS)} and ${formatCurrency(CAUSE_MAXIMUM_CONTRIBUTION_CENTS)}.`)
      return
    }
    if (walletBalanceCents < totalChargeCents) {
      setError('Your Civil Wallet does not have enough funds for this support amount.')
      return
    }

    setSubmitting(mode)
    setError(null)
    try {
      const path = mode === 'monthly' ? `/causes/${post.id}/subscriptions` : `/causes/${post.id}/wallet-contributions`
      const response = await fetch(buildApiUrl(path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amountCents }),
      })
      const payload = (await response.json().catch(() => null)) as { post?: ApiPost; error?: string } | null
      if (!response.ok || !payload?.post) {
        const errorCode = payload && 'error' in payload ? payload.error : null
        if (errorCode === 'insufficient_wallet_balance') {
          setError('Your Civil Wallet balance is too low. Add funds and try again.')
        } else if (errorCode === 'cause_payout_unavailable') {
          setError('This Cause cannot receive Civil Wallet support right now.')
        } else if (errorCode === 'cause_inactive') {
          setError('This Cause is no longer accepting support.')
        } else {
          setError(mode === 'monthly' ? 'Unable to start monthly support.' : 'Unable to send support.')
        }
        return
      }

      await ensureViewerMe({ token, refresh: true })
      const causeLabel = buildCauseLabel(post)
      pushToast(
        mode === 'monthly' ? `Started monthly support for ${causeLabel}` : `Donated to ${causeLabel}`,
        'success',
      )
      onComplete(payload.post)
      onClose()
    } catch {
      setError(mode === 'monthly' ? 'Unable to start monthly support.' : 'Unable to send support.')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Modal open onClose={onClose} title="Confirm your support" maxWidthClassName="max-w-xl">
      <div className="space-y-5 p-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-900">{post.title ?? 'Civil Cause'}</p>
          <p className="text-sm text-slate-600">Review your amount and confirm the payment from your Civil Wallet. The creator receives the support amount and Civil adds a transfer fee between $0.50 and $2.00.</p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex items-center justify-between gap-3">
            <span>Wallet balance</span>
            <span className="font-semibold">{formatCurrency(walletBalanceCents)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-emerald-800">
            <span>Need more Civil Credits?</span>
            <Link href="/wallet" className="font-semibold underline underline-offset-4">
              Open wallet
            </Link>
          </div>
        </div>

        {currentSubscription ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Existing monthly support</p>
            <p className="mt-1">
              {formatCurrency(currentSubscription.amountCents)} monthly
              {currentSubscription.nextChargeAt ? ` • next charge ${new Date(currentSubscription.nextChargeAt).toLocaleDateString()}` : ''}
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="cause-amount" className="block text-sm font-semibold text-slate-700">
            Support amount (CAD)
          </label>
          <input
            id="cause-amount"
            type="number"
            min={CAUSE_MINIMUM_CONTRIBUTION_CENTS / 100}
            max={CAUSE_MAXIMUM_CONTRIBUTION_CENTS / 100}
            step="1"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-base text-slate-900 shadow-inner focus:border-[var(--cc-primary)] focus:outline-none"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div className="flex items-center justify-between gap-3">
            <span>Support amount</span>
            <span className="font-semibold text-slate-900">{formatCurrency(amountCents)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span>Civil fee</span>
            <span className="font-semibold text-slate-900">{formatCurrency(feeCents)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-base">
            <span className="font-semibold text-slate-900">Total wallet charge</span>
            <span className="font-semibold text-slate-900">{formatCurrency(totalChargeCents)}</span>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(submitting)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          {preferredMode === 'monthly' ? (
            <button
              type="button"
              onClick={() => void submit('monthly')}
              disabled={Boolean(submitting)}
              className={clsx(
                'inline-flex items-center justify-center rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <LuRepeat2 className="mr-2 h-4 w-4" />
              {submitting === 'monthly' ? 'Starting…' : 'Donate Monthly'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit('one-time')}
              disabled={Boolean(submitting)}
              className={clsx(
                'inline-flex items-center justify-center rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <LuWallet className="mr-2 h-4 w-4" />
              {submitting === 'one-time' ? 'Sending…' : 'Donate Once'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}