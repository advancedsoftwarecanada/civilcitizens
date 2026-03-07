'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ContentModerationMenu from '../_components/ContentModerationMenu'
import DashboardShell from '../_components/DashboardShell'
import { buildApiUrl } from '../_lib/api'
import MarketRightRail from './_components/MarketRightRail'

type MarketProduct = {
  id: string
  kind: 'organization_product' | 'citizen_listing'
  title: string
  description: string | null
  priceCents: number
  currency: string
  primaryImageUrl: string | null
  galleryImageUrls: string[]
  createdAt: string
  organization?: {
    id: string
    name: string
    slug: string
    province: string | null
    municipality: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
  pickupCity?: string | null
  pickupProvince?: string | null
  seller?: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
  }
}

type MarketProductsResponse = {
  items?: MarketProduct[]
  nextCursor?: string | null
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function buildProductHref(product: MarketProduct): string {
  if (product.kind !== 'organization_product') return '/market'
  const province = String(product.organization?.province ?? '').trim().toLowerCase()
  const municipality = String(product.organization?.municipality ?? '').trim().toLowerCase()
  const slug = String(product.organization?.slug ?? '').trim()
  if (province && municipality && slug) {
    const params = new URLSearchParams({ product: product.id })
    return `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop?${params.toString()}`
  }
  return `/market/products/${encodeURIComponent(product.id)}`
}

function buildListingHref(product: MarketProduct): string {
  if (product.kind === 'citizen_listing') return `/market/listings/${encodeURIComponent(product.id)}`
  return buildProductHref(product)
}

export default function MarketPageClient() {
  const router = useRouter()
  const [items, setItems] = useState<MarketProduct[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async (cursor?: string | null) => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '24')
      if (cursor) params.set('cursor', cursor)

      const res = await fetch(buildApiUrl(`/market/feed?${params.toString()}`), {
        headers: getAuthHeaders(),
        cache: 'no-store',
      })
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
          <p className="mt-1 text-sm text-slate-600">Browse listings from organizations and people in your communities.</p>
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

        {!hasItems && status === 'ready' ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            No market listings are available right now.
          </div>
        ) : null}

        {hasItems ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((product) => {
              const priceLabel = product.currency?.toUpperCase() === 'CAD' ? money.format((product.priceCents || 0) / 100) : `${(product.priceCents || 0) / 100}`

              const cardBody = (
                <>
                  <div className="aspect-[16/10] w-full bg-slate-50">
                    {product.primaryImageUrl ? (
                      <img src={product.primaryImageUrl} alt={product.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{product.title}</div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-slate-900">{priceLabel}</div>
                    </div>
                  </div>
                </>
              )
              return (
                <div key={`${product.kind}:${product.id}`} className="relative">
                  {product.kind === 'organization_product' && product.organization ? (
                    <div className="absolute right-3 top-3 z-20">
                      <ContentModerationMenu
                        reportTarget={{
                          targetType: 'MARKET_PRODUCT',
                          targetId: product.id,
                          targetLabel: product.title,
                        }}
                        blockTarget={{
                          type: 'organization',
                          id: product.organization.id,
                          label: product.organization.name,
                        }}
                        buttonClassName="h-9 w-9 border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur-md hover:border-[var(--cc-primary)] hover:bg-white"
                        onReported={() => {
                          setItems((prev) => prev.filter((item) => item.id !== product.id))
                          router.refresh()
                        }}
                        onBlocked={() => {
                          setItems((prev) => prev.filter((item) => item.organization?.id !== product.organization?.id))
                          router.refresh()
                        }}
                      />
                    </div>
                  ) : null}
                  {product.kind === 'citizen_listing' && product.seller ? (
                    <div className="absolute right-3 top-3 z-20">
                      <ContentModerationMenu
                        reportTarget={{
                          targetType: 'MARKET_LISTING',
                          targetId: product.id,
                          targetLabel: product.title,
                        }}
                        blockTarget={{
                          type: 'user',
                          id: product.seller.id,
                          label: product.seller.name || (product.seller.handle ? `@${product.seller.handle}` : 'Seller'),
                        }}
                        buttonClassName="h-9 w-9 border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur-md hover:border-[var(--cc-primary)] hover:bg-white"
                        onReported={() => {
                          setItems((prev) => prev.filter((item) => item.id !== product.id))
                          router.refresh()
                        }}
                        onBlocked={() => {
                          setItems((prev) => prev.filter((item) => item.seller?.id !== product.seller?.id))
                          router.refresh()
                        }}
                      />
                    </div>
                  ) : null}
                  <Link
                    href={buildListingHref(product)}
                    className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300"
                  >
                    {cardBody}
                  </Link>
                </div>
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
