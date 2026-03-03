'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { readMarketCart, writeMarketCart, type MarketCartItem } from '../_lib/cart'

type Product = {
  id: string
  name: string
  taxCollect?: boolean
  taxRatesByRegion?: Record<string, string>
  priceCents: number
  currency: string
  primaryImageUrl: string | null
  fulfillmentType: string
}

type Organization = {
  id: string
  name: string
}

type MarketProductDetailResponse = {
  product: Product
  organization: Organization
}

type CartLine = {
  item: MarketCartItem
  product: Product
  organization: Organization
}

type ShippingAddress = {
  name?: string
  line1?: string
  line2?: string | null
  city?: string
  province?: string
  postalCode?: string
  country?: string
}

const MARKET_SHIPPING_ADDRESS_KEY = 'civil_market_shipping_address'

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

function computeTaxCents(_subtotalCents: number) {
  return 0
}

function computeStripeConnectFeeCents(subtotalCents: number) {
  if (subtotalCents <= 0) return 0
  return Math.max(0, Math.round(subtotalCents * 0.029) + 30)
}

function computeCivilMarketFeeCents(subtotalCents: number) {
  if (subtotalCents <= 0) return 0
  return Math.max(0, Math.round(subtotalCents * 0.05))
}

const CANADA_TAX_REGION_CODES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'])
const CANADA_TAX_REGION_NAME_TO_CODE: Record<string, string> = {
  ALBERTA: 'AB',
  BRITISHCOLUMBIA: 'BC',
  MANITOBA: 'MB',
  NEWBRUNSWICK: 'NB',
  NEWFOUNDLANDANDLABRADOR: 'NL',
  NOVASCOTIA: 'NS',
  NORTHWESTTERRITORIES: 'NT',
  NUNAVUT: 'NU',
  ONTARIO: 'ON',
  PRINCEEDWARDISLAND: 'PE',
  QUEBEC: 'QC',
  SASKATCHEWAN: 'SK',
  YUKON: 'YT',
}

function parseTaxRatePct(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

function resolveTaxRegionCode(value: unknown): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  if (!normalized) return null
  if (CANADA_TAX_REGION_CODES.has(normalized)) return normalized
  const compact = normalized.replace(/[^A-Z]/g, '')
  return CANADA_TAX_REGION_NAME_TO_CODE[compact] ?? null
}

export default function MarketCheckoutPageClient() {
  const router = useRouter()
  const placeOrderEnabled = false

  const [lines, setLines] = useState<CartLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [shippingAddress, setShippingAddress] = useState<ShippingAddress>({ country: 'CA' })
  const [rememberShippingAddress, setRememberShippingAddress] = useState(true)

  const [placingOrder, setPlacingOrder] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(MARKET_SHIPPING_ADDRESS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as ShippingAddress | null
      if (!parsed || typeof parsed !== 'object') return
      setShippingAddress({
        name: typeof parsed.name === 'string' ? parsed.name : '',
        line1: typeof parsed.line1 === 'string' ? parsed.line1 : '',
        line2: typeof parsed.line2 === 'string' ? parsed.line2 : '',
        city: typeof parsed.city === 'string' ? parsed.city : '',
        province: typeof parsed.province === 'string' ? parsed.province : '',
        postalCode: typeof parsed.postalCode === 'string' ? parsed.postalCode : '',
        country: typeof parsed.country === 'string' && parsed.country.trim() ? parsed.country : 'CA',
      })
    } catch {
      // ignore invalid persisted value
    }
  }, [])

  const loadCheckoutLines = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = readMarketCart()

      if (!current.length) {
        setLines([])
        return
      }

      const results = await Promise.all(
        current.map(async (item) => {
          const response = await fetch(buildApiUrl(`/market/products/${encodeURIComponent(item.productId)}`), {
            cache: 'no-store',
          })
          const parsed = await parseApiResponse<MarketProductDetailResponse & { error?: unknown }>(response)
          if (!response.ok || !parsed.json?.product || !parsed.json?.organization) {
            return { ok: false as const, item }
          }
          return { ok: true as const, item, product: parsed.json.product, organization: parsed.json.organization }
        }),
      )

      const nextLines: CartLine[] = []
      for (const r of results) {
        if (!r.ok) continue
        nextLines.push({ item: r.item, product: r.product, organization: r.organization })
      }
      setLines(nextLines)
    } catch {
      setError('Failed to load checkout items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadCheckoutLines()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [loadCheckoutLines])

  useEffect(() => {
    const onFocus = () => {
      void loadCheckoutLines()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [loadCheckoutLines])

  const sellerId = useMemo(() => {
    const ids = new Set(lines.map((l) => l.organization.id))
    return ids.size === 1 ? Array.from(ids)[0] : null
  }, [lines])

  const needsShipping = useMemo(() => {
    for (const line of lines) {
      if ((line.product.fulfillmentType || '').toLowerCase() === 'physical') return true
    }
    return false
  }, [lines])

  const currency = useMemo(() => {
    const currencies = new Set(lines.map((l) => (l.product.currency || '').toUpperCase()).filter(Boolean))
    return currencies.size === 1 ? Array.from(currencies)[0] : null
  }, [lines])

  const subtotalCents = useMemo(() => {
    let total = 0
    for (const line of lines) {
      total += (line.product.priceCents || 0) * (line.item.quantity || 0)
    }
    return total
  }, [lines])

  const taxCents = useMemo(() => {
    const taxRegionCode = resolveTaxRegionCode(shippingAddress.province)
    if (!taxRegionCode) return computeTaxCents(subtotalCents)

    let total = 0
    for (const line of lines) {
      if (!line.product.taxCollect) continue
      const rates = line.product.taxRatesByRegion
      if (!rates || typeof rates !== 'object') continue
      const ratePct = parseTaxRatePct((rates as Record<string, unknown>)[taxRegionCode])
      if (ratePct <= 0) continue
      const lineSubtotal = (line.product.priceCents || 0) * (line.item.quantity || 0)
      total += Math.max(0, Math.round(lineSubtotal * (ratePct / 100)))
    }
    return total
  }, [lines, shippingAddress.province, subtotalCents])
  const stripeConnectFeeCents = useMemo(() => computeStripeConnectFeeCents(subtotalCents), [subtotalCents])
  const civilMarketFeeCents = useMemo(() => computeCivilMarketFeeCents(subtotalCents), [subtotalCents])
  const grandTotalCents = useMemo(() => subtotalCents + taxCents + stripeConnectFeeCents + civilMarketFeeCents, [subtotalCents, taxCents, stripeConnectFeeCents, civilMarketFeeCents])

  const placeOrder = useCallback(async () => {
    setPlacingOrder(true)
    setError(null)
    try {
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
      if (!token) {
        setError('Please sign in to checkout.')
        return
      }

      const items = readMarketCart()
      if (!items.length) {
        setError('Your cart is empty')
        return
      }

      if (!sellerId) {
        setError('Checkout supports items from a single seller. Remove items to continue.')
        return
      }

      if (!currency) {
        setError('Checkout supports a single currency per order.')
        return
      }

      const shipping = needsShipping
        ? {
            name: shippingAddress.name?.trim() || undefined,
            line1: shippingAddress.line1?.trim() || undefined,
            line2: shippingAddress.line2?.trim() || undefined,
            city: shippingAddress.city?.trim() || undefined,
            province: shippingAddress.province?.trim() || undefined,
            postalCode: shippingAddress.postalCode?.trim() || undefined,
            country: (shippingAddress.country?.trim() || 'CA').toUpperCase(),
          }
        : null

      if (needsShipping) {
        if (!shipping?.line1 || !shipping?.city || !shipping?.province || !shipping?.postalCode || !shipping?.country) {
          setError('Shipping address is required for physical items')
          return
        }

        if (rememberShippingAddress && typeof window !== 'undefined') {
          const toPersist: ShippingAddress = {
            name: shipping.name ?? '',
            line1: shipping.line1 ?? '',
            line2: shipping.line2 ?? '',
            city: shipping.city ?? '',
            province: shipping.province ?? '',
            postalCode: shipping.postalCode ?? '',
            country: shipping.country ?? 'CA',
          }
          window.localStorage.setItem(MARKET_SHIPPING_ADDRESS_KEY, JSON.stringify(toPersist))
        }
      }

      const response = await fetch(buildApiUrl('/market/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ items, shippingAddress: shipping }),
      })

      const parsed = await parseApiResponse<
        | { orderId: string }
        | { error: unknown }
      >(response)

      if (response.status === 401) {
        setError('Please sign in to checkout.')
        return
      }

      if (!response.ok || !parsed.json || typeof (parsed.json as any).orderId !== 'string') {
        const err = (parsed.json as any)?.error
        const code = typeof err === 'string' ? err : typeof err?.error === 'string' ? err.error : null
        const productId = typeof err?.productId === 'string' ? err.productId : null

        if (code === 'single_seller_required') {
          setError('Checkout supports items from a single seller. Remove items to continue.')
          return
        }
        if (code === 'single_currency_required') {
          setError('Checkout supports a single currency per order.')
          return
        }
        if (code === 'shipping_address_required') {
          setError('Shipping address is required for physical items.')
          return
        }
        if (code === 'insufficient_inventory') {
          setError(productId ? `Not enough inventory for product ${productId}.` : 'Not enough inventory for one of your items.')
          return
        }
        setError('Failed to place order')
        return
      }

      const ok = parsed.json as any
      writeMarketCart([])
      window.dispatchEvent(new Event('civil:market-cart-changed'))
      router.push(`/market/orders/${encodeURIComponent(ok.orderId)}`)
    } catch {
      setError('Failed to place order')
    } finally {
      setPlacingOrder(false)
    }
  }, [currency, needsShipping, rememberShippingAddress, router, sellerId, shippingAddress])

  return (
    <DashboardShell rightRail={<div aria-hidden="true" />}>
      <div className="space-y-6 pb-24">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Checkout</h1>
            <div className="mt-1 text-sm text-slate-600">Finalize your order and payment.</div>
          </div>
          <Link
            href="/market/cart"
            className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
          >
            Back to cart
          </Link>
        </div>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Loading…</div>
        ) : lines.length ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Items</div>
              <div className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <div key={line.product.id} className="flex items-center gap-4 p-4">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                      {line.product.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={line.product.primaryImageUrl} alt={line.product.name} className="h-full w-full object-cover" />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{line.product.name}</div>
                      <div className="mt-1 text-xs text-slate-600">{line.organization.name}</div>
                      <div className="mt-1 text-xs text-slate-600">Qty {line.item.quantity}</div>
                    </div>

                    <div className="w-28 text-right text-sm font-semibold text-slate-900">
                      {formatMoney(line.product.priceCents * line.item.quantity, line.product.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <div>Subtotal</div>
                  <div className="font-semibold text-slate-900">{currency ? formatMoney(subtotalCents, currency) : '—'}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div>Taxes</div>
                  <div className="font-semibold text-slate-900">{currency ? formatMoney(taxCents, currency) : '—'}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div>Stripe connect fee(s)</div>
                  <div className="font-semibold text-slate-900">{currency ? formatMoney(stripeConnectFeeCents, currency) : '—'}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div>Civil Market Fee (5%)</div>
                  <div className="font-semibold text-slate-900">{currency ? formatMoney(civilMarketFeeCents, currency) : '—'}</div>
                </div>
                <div className="mt-1 border-t border-slate-200 pt-2" />
                <div className="flex items-center justify-between text-base">
                  <div className="font-semibold text-slate-900">Grand total</div>
                  <div className="font-semibold text-slate-900">{currency ? formatMoney(grandTotalCents, currency) : '—'}</div>
                </div>
              </div>
            </div>

            {needsShipping ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Shipping address</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Name"
                    disabled={placingOrder}
                    value={shippingAddress.name ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, name: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Postal code"
                    disabled={placingOrder}
                    value={shippingAddress.postalCode ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, postalCode: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Address line 1"
                    disabled={placingOrder}
                    value={shippingAddress.line1 ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, line1: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="Address line 2 (optional)"
                    disabled={placingOrder}
                    value={shippingAddress.line2 ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, line2: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="City"
                    disabled={placingOrder}
                    value={shippingAddress.city ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, city: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Province"
                    disabled={placingOrder}
                    value={shippingAddress.province ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, province: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={rememberShippingAddress}
                    disabled={placingOrder}
                    onChange={(e) => setRememberShippingAddress(e.target.checked)}
                  />
                  Remember this shipping address?
                </label>
              </div>
            ) : null}

            <button
              type="button"
              onClick={placeOrder}
              disabled={!placeOrderEnabled || placingOrder}
              className="w-full rounded-full bg-slate-300 px-4 py-3 text-sm font-semibold text-slate-600"
            >
              {placingOrder ? 'Placing order…' : 'Place Order'}
            </button>
            <p className="text-center text-xs text-red-600">- Civil is currently working on this feature, please check back soon</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm text-slate-700">Your cart is empty.</div>
            <div className="mt-4">
              <Link
                href="/market"
                className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
              >
                Browse products
              </Link>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
