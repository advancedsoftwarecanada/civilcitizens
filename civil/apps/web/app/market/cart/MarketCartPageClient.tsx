'use client'

import { PaymentElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { readMarketCart, setMarketCartQuantity, type MarketCartItem, writeMarketCart } from '../_lib/cart'

type Product = {
  id: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  primaryImageUrl: string | null
  fulfillmentType: string
}

type Organization = {
  id: string
  name: string
  slug: string
  province: string | null
  municipality: string | null
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

function CheckoutForm({ orderId, onPaid }: { orderId: string; onPaid: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)
    try {
      const returnUrl = `${window.location.origin}/market/orders/${encodeURIComponent(orderId)}`
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      })

      if (result.error) {
        setError(result.error.message ?? 'Payment failed')
        return
      }

      if (result.paymentIntent?.status === 'succeeded') {
        onPaid()
        return
      }

      // If Stripe handled a redirect, we won't reach this state.
      // For non-redirect flows, show a generic status message.
      if (result.paymentIntent?.status) {
        setError(`Payment status: ${result.paymentIntent.status}`)
      }
    } catch {
      setError('Payment failed')
    } finally {
      setSubmitting(false)
    }
  }, [elements, onPaid, orderId, stripe])

  return (
    <div className="space-y-3">
      <PaymentElement />
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <button
        type="button"
        onClick={submit}
        disabled={!stripe || !elements || submitting}
        className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300 disabled:opacity-60"
      >
        {submitting ? 'Processing…' : 'Pay now'}
      </button>
    </div>
  )
}

export default function MarketCartPageClient() {
  const router = useRouter()

  const [cart, setCart] = useState<MarketCartItem[]>([])
  const [lines, setLines] = useState<CartLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [shippingAddress, setShippingAddress] = useState<ShippingAddress>({ country: 'CA' })
  const [creatingPayment, setCreatingPayment] = useState(false)

  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)

  useEffect(() => {
    const initial = readMarketCart()
    setCart(initial)
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const current = readMarketCart()
        if (cancelled) return
        setCart(current)

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

        if (cancelled) return
        const nextLines: CartLine[] = []
        for (const r of results) {
          if (!r.ok) continue
          nextLines.push({ item: r.item, product: r.product, organization: r.organization })
        }
        setLines(nextLines)
      } catch {
        if (cancelled) return
        setError('Failed to load cart items')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

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

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (clientSecret) return
      const current = readMarketCart()
      const next = setMarketCartQuantity(current, productId, quantity)
      writeMarketCart(next)
      setCart(next)

      const nextLines: CartLine[] = []
      for (const line of lines) {
        if (line.product.id !== productId) {
          nextLines.push(line)
          continue
        }
        const updatedItem = next.find((i) => i.productId === productId)
        if (updatedItem) nextLines.push({ ...line, item: updatedItem })
      }
      setLines(nextLines)
    },
    [clientSecret, lines],
  )

  const createPayment = useCallback(async () => {
    setCreatingPayment(true)
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
      }

      const response = await fetch(buildApiUrl('/market/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ items, shippingAddress: shipping }),
      })

      const parsed = await parseApiResponse<
        | { clientSecret: string; publishableKey: string; orderId: string }
        | { error: unknown }
      >(response)

      if (response.status === 401) {
        setError('Please sign in to checkout.')
        return
      }

      if (!response.ok || !parsed.json || typeof (parsed.json as any).clientSecret !== 'string') {
        const err = (parsed.json as any)?.error
        const code = typeof err === 'string' ? err : typeof err?.error === 'string' ? err.error : null
        const productId = typeof err?.productId === 'string' ? err.productId : null

        if (code === 'seller_not_configured') {
          setError('This seller has not enabled payouts yet, so checkout is unavailable.')
          return
        }
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
        if (code === 'stripe_unconfigured') {
          setError('Payments are temporarily unavailable.')
          return
        }

        setError('Failed to start checkout')
        return
      }

      const ok = parsed.json as any
      setClientSecret(ok.clientSecret)
      setPublishableKey(ok.publishableKey)
      setOrderId(ok.orderId)
    } catch {
      setError('Failed to start checkout')
    } finally {
      setCreatingPayment(false)
    }
  }, [currency, needsShipping, sellerId, shippingAddress])

  const stripePromise = useMemo(() => {
    if (!publishableKey) return null
    return loadStripe(publishableKey)
  }, [publishableKey])

  const onPaid = useCallback(() => {
    if (typeof window !== 'undefined') {
      writeMarketCart([])
    }
    if (orderId) router.push(`/market/orders/${encodeURIComponent(orderId)}`)
  }, [orderId, router])

  return (
    <DashboardShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Cart</h1>
            <div className="mt-1 text-sm text-slate-600">Review your items and checkout.</div>
          </div>
          <Link
            href="/market"
            className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
          >
            Back to market
          </Link>
        </div>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Loading…</div>
        ) : lines.length ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
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
                      <div className="mt-1 text-xs text-slate-600">{formatMoney(line.product.priceCents, line.product.currency)} each</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600" htmlFor={`qty-${line.product.id}`}>
                        Qty
                      </label>
                      <input
                        id={`qty-${line.product.id}`}
                        type="number"
                        min={0}
                        max={99}
                        value={line.item.quantity}
                        disabled={Boolean(clientSecret)}
                        onChange={(e) => updateQuantity(line.product.id, Number(e.target.value))}
                        className="w-16 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </div>

                    <div className="w-28 text-right text-sm font-semibold text-slate-900">
                      {formatMoney(line.product.priceCents * line.item.quantity, line.product.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-sm text-slate-700">
                <div>Subtotal</div>
                <div className="font-semibold text-slate-900">{currency ? formatMoney(subtotalCents, currency) : '—'}</div>
              </div>
              <div className="mt-3 text-xs text-slate-600">Platform fee and taxes (if any) are handled at checkout.</div>
            </div>

            {needsShipping ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Shipping address</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Name"
                    disabled={Boolean(clientSecret)}
                    value={shippingAddress.name ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, name: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Postal code"
                    disabled={Boolean(clientSecret)}
                    value={shippingAddress.postalCode ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, postalCode: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Address line 1"
                    disabled={Boolean(clientSecret)}
                    value={shippingAddress.line1 ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, line1: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="Address line 2 (optional)"
                    disabled={Boolean(clientSecret)}
                    value={shippingAddress.line2 ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, line2: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="City"
                    disabled={Boolean(clientSecret)}
                    value={shippingAddress.city ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, city: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Province"
                    disabled={Boolean(clientSecret)}
                    value={shippingAddress.province ?? ''}
                    onChange={(e) => setShippingAddress((s) => ({ ...s, province: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>
            ) : null}

            {!clientSecret ? (
              <button
                type="button"
                onClick={createPayment}
                disabled={creatingPayment}
                className="w-full rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-300 disabled:opacity-60"
              >
                {creatingPayment ? 'Starting checkout…' : 'Checkout'}
              </button>
            ) : stripePromise && orderId ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Payment</div>
                <div className="mt-3">
                  <Elements
                    stripe={stripePromise as Promise<Stripe | null>}
                    options={{ clientSecret }}
                  >
                    <CheckoutForm orderId={orderId} onPaid={onPaid} />
                  </Elements>
                </div>
              </div>
            ) : null}
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
