'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import MarketRightRail from '../_components/MarketRightRail'

type ListingItem = {
  id: string
  title: string
  description: string | null
  priceCents: number
  currency: string
  photoUrls: string[]
  pickupCity: string | null
  pickupProvince: string | null
  paymentTypes: string[]
  willingToDeliver: boolean
  status: string
  isDraft: boolean
  updatedAt: string
}

type ListingsResponse = {
  items?: ListingItem[]
}

type ListingBucket = 'draft' | 'active' | 'sold' | 'other'

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function getListingBucket(item: ListingItem): ListingBucket {
  if (item.isDraft || item.status === 'draft') return 'draft'
  if (item.status === 'sold') return 'sold'
  if (item.status === 'active' || item.status === 'pending' || item.status === 'pending_sale') return 'active'
  return 'other'
}

function getListingStatusLabel(item: ListingItem) {
  if (item.isDraft || item.status === 'draft') return 'Draft'
  if (item.status === 'active') return 'Active'
  if (item.status === 'pending' || item.status === 'pending_sale') return 'Pending sale'
  if (item.status === 'sold') return 'Sold'
  if (item.status === 'canceled') return 'Canceled'
  return item.status
}

function supportsCivilPay(paymentTypes: string[] | null | undefined) {
  return Array.isArray(paymentTypes) && paymentTypes.includes('civil_wallet')
}

function ListingSection({
  title,
  items,
}: {
  title: string
  items: ListingItem[]
}) {
  if (!items.length) return null

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          {items.length}
        </span>
      </div>
      <ul className="space-y-3">
        {items.map((item) => {
          const cover = item.photoUrls[0] ?? null
          const href = `/market/listings/new?listing=${encodeURIComponent(item.id)}`
          return (
            <li key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition hover:border-slate-300 hover:bg-slate-100">
              <Link href={href} className="grid gap-3 p-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:p-4">
                <div className="h-28 overflow-hidden rounded-xl bg-slate-200 sm:h-24">
                  {cover ? <img src={cover} alt={item.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate text-base font-semibold text-slate-900">{item.title}</p>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {getListingStatusLabel(item)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{formatMoney(item.priceCents, item.currency)}</p>
                    {supportsCivilPay(item.paymentTypes) ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Civil Pay</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">Pickup area: {item.pickupCity ? `${item.pickupCity}${item.pickupProvince ? `, ${item.pickupProvince}` : ''}` : 'Not set'}</p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function MarketListingsPageClient() {
  const [items, setItems] = useState<ListingItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl('/market/listings/mine?limit=40'), {
          headers: getAuthHeaders(),
          cache: 'no-store',
        })

        const payload = (await res.json().catch(() => null)) as ListingsResponse | null
        if (cancelled) return
        if (!res.ok) {
          setItems([])
          setStatus('error')
          return
        }

        setItems(Array.isArray(payload?.items) ? payload.items : [])
        setStatus('ready')
      } catch {
        if (cancelled) return
        setItems([])
        setStatus('error')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const hasItems = useMemo(() => items.length > 0, [items.length])
  const draftItems = useMemo(() => items.filter((item) => getListingBucket(item) === 'draft'), [items])
  const activeItems = useMemo(() => items.filter((item) => getListingBucket(item) === 'active'), [items])
  const soldItems = useMemo(() => items.filter((item) => getListingBucket(item) === 'sold'), [items])
  const otherItems = useMemo(() => items.filter((item) => getListingBucket(item) === 'other'), [items])

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Your Listings</h1>
              <p className="mt-1 text-sm text-slate-600">Manage your citizen marketplace listings.</p>
            </div>
            <Link
              href="/market/listings/new"
              className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Create listing
            </Link>
          </div>
        </section>

        {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load your listings.</div> : null}

        {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading your listings…</div> : null}

        {status === 'ready' && !hasItems ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
            <p className="text-sm text-slate-600">No listings yet. Create your first listing to start selling peer-to-peer.</p>
          </section>
        ) : null}

        {status === 'ready' && hasItems ? <ListingSection title="Draft" items={draftItems} /> : null}
        {status === 'ready' && hasItems ? <ListingSection title="Active" items={activeItems} /> : null}
        {status === 'ready' && hasItems ? <ListingSection title="Sold" items={soldItems} /> : null}
        {status === 'ready' && hasItems ? <ListingSection title="Other" items={otherItems} /> : null}
      </div>
    </DashboardShell>
  )
}
