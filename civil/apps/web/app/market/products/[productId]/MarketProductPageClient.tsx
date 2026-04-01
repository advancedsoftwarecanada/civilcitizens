'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import ContentModerationMenu from '../../../_components/ContentModerationMenu'
import DashboardShell from '../../../_components/DashboardShell'
import { addMarketCartItem, readMarketCart, type MarketCartItem, writeMarketCart } from '../../_lib/cart'

type Product = {
  id: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  sku: string | null
  primaryImageUrl: string | null
  galleryImageUrls: string[]
  fulfillmentType: string
  inventoryTotal: number
}

type Organization = {
  id: string
  name: string
  slug: string
  province: string | null
  municipality: string | null
  logoUrl: string | null
  coverUrl: string | null
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

export default function MarketProductPageClient({
  product,
  organization,
}: {
  product: Product
  organization: Organization
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)

  const priceLabel = useMemo(() => {
    if (product.currency?.toUpperCase() === 'CAD') return money.format((product.priceCents || 0) / 100)
    return `${(product.priceCents || 0) / 100}`
  }, [product.currency, product.priceCents])

  const addToCart = useCallback(() => {
    setAdding(true)
    try {
      const current = readMarketCart()
      const next: MarketCartItem[] = addMarketCartItem(current, product.id, 1)
      writeMarketCart(next)
      window.dispatchEvent(new Event('civil:market-cart-changed'))
    } finally {
      setAdding(false)
    }
  }, [product.id])

  const orgLocation = [organization.province?.toUpperCase() ?? null, organization.municipality].filter(Boolean).join(' • ')

  return (
    <DashboardShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{organization.name}</div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{product.name}</h1>
            {orgLocation ? <div className="mt-1 text-sm text-slate-600">{orgLocation}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ContentModerationMenu
              reportTarget={{
                targetType: 'MARKET_PRODUCT',
                targetId: product.id,
                targetLabel: product.name,
              }}
              blockTarget={{
                type: 'organization',
                id: organization.id,
                label: organization.name,
              }}
              buttonClassName="border-slate-200 bg-white text-slate-700 shadow-none backdrop-blur-0 hover:bg-slate-50 hover:text-slate-900"
              onReported={() => router.push('/market')}
              onBlocked={() => router.push('/market')}
            />
            <Link
              href="/market/cart"
              className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
            >
              Cart
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="aspect-[16/9] w-full bg-slate-50">
            {product.primaryImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.primaryImageUrl} alt={product.name} className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-slate-900">{priceLabel}</div>
              <button
                type="button"
                onClick={addToCart}
                disabled={adding}
                className="rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:opacity-60"
              >
                {adding ? 'Adding…' : 'Add to cart'}
              </button>
            </div>

            {product.description ? (
              <div
                className="cc-article-rich-content text-sm text-slate-700"
                dangerouslySetInnerHTML={{ __html: product.description }}
              />
            ) : null}

            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{product.fulfillmentType}</span>
              {product.sku ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1">SKU: {product.sku}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
