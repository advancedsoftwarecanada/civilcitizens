"use client"

import { useMemo, useState } from 'react'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'

export type ManageSubscriptionSummary = {
  premiumStatus: string
  premiumSince: string | null
  premiumRenewsAt: string | null
  isPremium: boolean
}

type ManageSubscriptionModalProps = {
  open: boolean
  token: string
  summary: ManageSubscriptionSummary
  onClose: () => void
  onUpdated: () => Promise<void> | void
}

function formatFullDate(iso?: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function ManageSubscriptionModal({ open, token, summary, onClose, onUpdated }: ManageSubscriptionModalProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formattedSince = useMemo(() => formatFullDate(summary.premiumSince), [summary.premiumSince])
  const formattedRenewal = useMemo(() => formatFullDate(summary.premiumRenewsAt), [summary.premiumRenewsAt])

  if (!open) {
    return null
  }

  async function handleCancel() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/billing/cancel'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const message = typeof body?.error === 'string' ? body.error : 'Unable to cancel the subscription right now.'
        setError(message)
        setSubmitting(false)
        return
      }
      pushToast('Subscription canceled. You remain premium until the current period ends.', 'success', 6000)
      await onUpdated()
    } catch (err) {
      console.error('manage-subscription-cancel', err)
      setError('Unexpected error cancelling your membership. Please try again.')
      setSubmitting(false)
    }
  }

  function closeModal() {
    if (submitting) return
    setConfirmingCancel(false)
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-8">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Premium membership</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Manage your subscription</h2>
            <p className="mt-2 text-sm text-slate-600">
              Stay in Civil without leaving the app. Cancel or return anytime — no external billing portal required.
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="rounded-full border border-slate-200 p-2 text-slate-500 hover:border-slate-300 hover:text-slate-700"
            disabled={submitting}
            aria-label="Close manage subscription modal"
          >
            ✕
          </button>
        </div>

        <dl className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-6 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="mt-2 text-base font-semibold text-slate-900">{summary.premiumStatus ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Member since</dt>
            <dd className="mt-2 text-base text-slate-900">{formattedSince ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Renews</dt>
            <dd className="mt-2 text-base text-slate-900">{formattedRenewal ?? '—'}</dd>
          </div>
        </dl>

        <div className="mt-8 rounded-3xl border border-rose-200 bg-rose-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Need a break?</p>
          <h3 className="mt-2 text-xl font-semibold text-rose-900">Cancel membership</h3>
          <p className="mt-2 text-sm text-rose-700">
            Cancelling stops future renewals immediately. You keep access for the remainder of this billing period and can restart premium at any time.
          </p>

          {confirmingCancel ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-white p-4 text-sm text-slate-700">
              <p>Are you sure you want to cancel your premium membership?</p>
              {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={submitting}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300"
                >
                  Keep membership
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={submitting}
                  className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Cancelling…' : 'Yes, cancel premium'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                disabled={!summary.isPremium || submitting}
                className="w-full rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel subscription
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
