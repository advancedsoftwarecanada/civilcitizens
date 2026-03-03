'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../_components/DashboardShell'
import { buildApiUrl } from '../_lib/api'
import MarketRightRail from './_components/MarketRightRail'

type MarketProduct = {
  id: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  primaryImageUrl: string | null
  galleryImageUrls: string[]
  fulfillmentType: string
  createdAt: string
  organization: {
    id: string
    name: string
    slug: string
    province: string | null
    municipality: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
}

type MarketProductsResponse = {
  items?: MarketProduct[]
  nextCursor?: string | null
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function previewText(input: string | null, max = 140): string | null {
  if (!input) return null
  const clean = stripHtml(input)
  if (!clean) return null
  if (clean.length <= max) return clean
  return `${clean.slice(0, max).trim()}…`
}

function buildProductHref(product: MarketProduct): string {
  const province = String(product.organization?.province ?? '').trim().toLowerCase()
  const municipality = String(product.organization?.municipality ?? '').trim().toLowerCase()
  const slug = String(product.organization?.slug ?? '').trim()
  if (province && municipality && slug) {
    const params = new URLSearchParams({ product: product.id })
    return `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop?${params.toString()}`
  }
  return `/market/products/${encodeURIComponent(product.id)}`
}

export default function MarketPageClient() {
  const [items, setItems] = useState<MarketProduct[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async (cursor?: string | null) => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '24')
      if (cursor) params.set('cursor', cursor)

      const res = await fetch(buildApiUrl(`/market/products?${params.toString()}`), { cache: 'no-store' })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const payload = (await res.json().catch(() => null)) as MarketProductsResponse | null
      const nextItems = Array.isArray(payload?.items) ? payload!.items! : []
      const next = typeof payload?.nextCursor === 'string' ? payload.nextCursor : null

      setItems((prev) => (cursor ? [...prev, ...nextItems] : nextItems))
      setNextCursor(next)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load(null)
  }, [load])

  const hasItems = items.length > 0
  const header = useMemo(
    () => (
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Market</h1>
          <p className="mt-1 text-sm text-slate-600">Browse items from organizations across Civil.</p>
        </div>
        <Link
          href="/market/cart"
          className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
        >
          Cart
        </Link>
      </div>
    ),
    [],
  )

  return (
    <DashboardShell
      rightRail={<MarketRightRail />}
      showMobileRightRail
      mainClassName="space-y-5 pb-12"
    >
      <div className="space-y-5">
        {header}

        {status === 'error' ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Unable to load market items.</div>
        ) : null}

        {!hasItems && status === 'loading' ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading…</div>
        ) : null}

        {hasItems ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((product) => {
              const description = previewText(product.description)
              const priceLabel = product.currency?.toUpperCase() === 'CAD' ? money.format((product.priceCents || 0) / 100) : `${(product.priceCents || 0) / 100}`
              return (
                <Link
                  key={product.id}
                  href={buildProductHref(product)}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300"
                >
                  <div className="aspect-[16/10] w-full bg-slate-50">
                    {product.primaryImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.primaryImageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                        <div className="truncate text-xs text-slate-600">{product.organization?.name ?? 'Organization'}</div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-slate-900">{priceLabel}</div>
                    </div>
                    {description ? <div className="text-sm text-slate-700">{description}</div> : null}
                  </div>
                </Link>
              )
            })}
            </div>
          </section>
        ) : null}

        {nextCursor && status === 'ready' ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
              onClick={() => void load(nextCursor)}
            >
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
