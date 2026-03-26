'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { calculateCivilFeeCents } from '@civil/shared'
import DashboardShell from '../../../../_components/DashboardShell'
import { pushToast } from '../../../../_components/useToasts'
import { redirectToAuthModal } from '../../../../_lib/authModal'
import { buildApiUrl } from '../../../../_lib/api'
import { getStoredToken } from '../../../../_lib/tokenStorage'
import { ensureViewerMe } from '../../../../_lib/viewerMe'
import { useViewerStore } from '../../../../_lib/viewerStore'
import MarketRightRail from '../../../_components/MarketRightRail'

type ListingPayload = {
  listing?: {
    id: string
    title: string
    priceCents: number
    currency: string
    photoUrls?: string[]
    pickupCity?: string | null
    pickupProvince?: string | null
    paymentTypes?: string[]
    status?: string | null
  }
}

type MarketThreadContextPayload = {
  listing?: {
    id: string
    title: string
    priceCents: number
    currency: string
    photoUrl?: string | null
    pickupCity?: string | null
    pickupProvince?: string | null
    paymentTypes?: string[]
    status?: string | null
  }
}

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: (currency || 'CAD').toUpperCase() }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

export default function MarketListingCivilPayPageClient({ listingId }: { listingId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const me = useViewerStore((state) => state.me)
  const [listing, setListing] = useState<ListingPayload['listing'] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [paying, setPaying] = useState(false)

  const threadId = searchParams?.get('thread')?.trim() ?? ''

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    void ensureViewerMe({ token, refresh: true })
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setStatus('loading')
      try {
        const token = getStoredToken()
        if (!token || !threadId) {
          setListing(null)
          setStatus('error')
          return
        }
        const res = await fetch(buildApiUrl(`/market/chats/${encodeURIComponent(threadId)}/context`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (cancelled) return
        if (res.status === 404) {
          setListing(null)
          setStatus('not-found')
          return
        }
        if (!res.ok) {
          setListing(null)
          setStatus('error')
          return
        }
        const payload = (await res.json().catch(() => null)) as MarketThreadContextPayload | null
        if (!payload?.listing) {
          setListing(null)
          setStatus('not-found')
          return
        }
        setListing({
          ...payload.listing,
          photoUrls: payload.listing.photoUrl ? [payload.listing.photoUrl] : [],
        })
        setStatus('ready')
      } catch {
        if (cancelled) return
        setListing(null)
        setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [listingId, threadId])

  const feeCents = useMemo(() => calculateCivilFeeCents(listing?.priceCents ?? 0), [listing?.priceCents])
  const totalChargeCents = (listing?.priceCents ?? 0) + feeCents
  const balanceCents = me?.wallet?.civilCreditsCents ?? 0
  const enoughBalance = balanceCents >= totalChargeCents
  const backHref = threadId ? `/messages?inbox=market&thread=${encodeURIComponent(threadId)}` : `/market/listings/${encodeURIComponent(listingId)}`

  const handlePay = async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setPaying(true)
    try {
      const res = await fetch(buildApiUrl(`/market/chats/item/${encodeURIComponent(listingId)}/civil-pay/complete`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; feeCents?: number; requiredAmountCents?: number; availableCreditsCents?: number } | null
      if (!res.ok) {
        if (payload?.error === 'insufficient_wallet_balance') {
          pushToast('Your Civil Wallet balance is too low for this purchase.', 'error')
        } else if (payload?.error === 'buyer_not_selected') {
          pushToast('This Civil Pay link is only available to the selected buyer.', 'error')
        } else if (payload?.error === 'civil_pay_already_completed') {
          pushToast('Civil Pay has already been completed for this listing.', 'error')
        } else {
          pushToast('Unable to complete Civil Pay right now.', 'error')
        }
        return
      }

      await ensureViewerMe({ token, refresh: true })
      pushToast('Civil Pay completed.', 'success')
      router.push(backHref)
    } catch {
      pushToast('Unable to complete Civil Pay right now.', 'error')
    } finally {
      setPaying(false)
    }
  }

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Complete Civil Pay</h1>
            <p className="mt-1 text-sm text-slate-600">Confirm the buyer payment for this marketplace listing.</p>
          </div>
          <Link href={backHref} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Back
          </Link>
        </div>
      </section>

      {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading listing…</div> : null}
      {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load this Civil Pay request.</div> : null}
      {status === 'not-found' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Listing not found.</div> : null}

      {status === 'ready' && listing ? (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex gap-4">
              <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {listing.photoUrls?.[0] ? <img src={listing.photoUrls[0]} alt={listing.title} className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-slate-900">{listing.title}</h2>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Civil Pay</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {listing.pickupCity ? `${listing.pickupCity}${listing.pickupProvince ? `, ${listing.pickupProvince}` : ''}` : 'Pickup location shared in chat'}
                </p>
                <p className="mt-3 text-lg font-semibold text-slate-900">{formatMoney(listing.priceCents, listing.currency)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-sm font-semibold text-slate-900">Payment summary</p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3 text-slate-700">
                <span>Item price</span>
                <span className="font-semibold text-slate-900">{formatMoney(listing.priceCents, listing.currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-slate-700">
                <span>Civil fee</span>
                <span className="font-semibold text-slate-900">{formatMoney(feeCents, listing.currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-slate-900">
                <span className="font-semibold">Total charge</span>
                <span className="text-lg font-semibold">{formatMoney(totalChargeCents, listing.currency)}</span>
              </div>
            </div>

            <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${enoughBalance ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              Civil Wallet balance: <span className="font-semibold">{formatMoney(balanceCents, listing.currency)}</span>
            </div>

            <p className="mt-4 text-sm text-slate-600">
              The seller receives the item price in Civil Wallet. Civil records the fee in the global ledger and keeps the platform funds in Stripe until later withdrawal.
            </p>

            <button
              type="button"
              onClick={() => void handlePay()}
              disabled={paying || !enoughBalance}
              className="mt-5 w-full rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {paying ? 'Processing Civil Pay…' : `Pay ${formatMoney(totalChargeCents, listing.currency)}`}
            </button>
            {!enoughBalance ? <p className="mt-3 text-sm text-amber-700">Add funds to Civil Wallet before completing this sale.</p> : null}
          </div>
        </section>
      ) : null}
    </DashboardShell>
  )
}