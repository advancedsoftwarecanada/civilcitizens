'use client'

import { calculateCivilFeeCents } from '@civil/shared'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FaCreditCard, FaWallet } from 'react-icons/fa'
import DashboardShell from '../../_components/DashboardShell'
import Modal from '../../_components/Modal'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import {
  addressToCheckoutShipping,
  hasCanadianAddressValue,
  normalizeCanadianAddress,
  readStoredMarketShippingAddress,
  type CanadianAddress,
  type SavedShippingAddress,
  writeStoredMarketShippingAddress,
} from '../../_lib/canadianAddresses'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { useViewerStore } from '../../_lib/viewerStore'
import { getMarketCartItemKey, readMarketCart, writeMarketCart, type MarketCartItem } from '../_lib/cart'

type Product = {
  id: string
  name: string
  taxCollect?: boolean
  taxRatesByRegion?: Record<string, string>
  priceCents: number
  currency: string
  hasVariants?: boolean
  attributes?: Array<{ key: string; label: string; values: string[] }>
  variants?: Array<{
    id: string
    productId: string
    attributeValues: Record<string, string>
    priceCents: number | null
    sku: string | null
    imageUrl: string | null
    isActive: boolean
    inventoryTotal: number
  }>
  primaryImageUrl: string | null
  fulfillmentType: string
}

type ProductVariant = NonNullable<Product['variants']>[number]

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
  variant: ProductVariant | null
}

type PaymentMethod = 'civil_wallet' | 'credit_card'

type CheckoutTotals = {
  subtotalCents: number
  shippingCents: number
  taxCents: number
  civilFeeCents: number
  stripeCardFeeCents: number
  grandTotalCents: number
}

type CardCheckoutSession = {
  orderId: string
  clientSecret: string
  customerSessionClientSecret?: string | null
  paymentIntentId: string
  publishableKey: string
  totals: CheckoutTotals
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

function computeStripeCardFeeCents(amountCents: number) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
  return Math.max(0, Math.round(amountCents * 0.029) + 30)
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

function resolveSelectedVariant(product: Product, item: MarketCartItem) {
  if (!item.variantId || !Array.isArray(product.variants)) return null
  return product.variants.find((variant) => variant.id === item.variantId) ?? null
}

function resolveLineUnitPrice(line: CartLine) {
  return line.variant?.priceCents ?? line.product.priceCents ?? 0
}

function formatSelectedAttributes(item: MarketCartItem) {
  const entries = Object.entries(item.selectedAttributes ?? {}).filter(([, value]) => String(value || '').trim())
  return entries.map(([key, value]) => `${key}: ${value}`).join(' • ')
}

function CardCheckoutForm({
  session,
  token,
  onPaid,
}: {
  session: CardCheckoutSession
  token: string | null
  onPaid: (orderId: string) => Promise<void>
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmCardOrder = useCallback(
    async (orderId: string, paymentIntentId: string) => {
      const response = await fetch(buildApiUrl('/market/checkout/card/confirm'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderId, paymentIntentId }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      return {
        ok: response.ok,
        error: payload?.error ?? null,
      }
    },
    [token],
  )

  const submit = useCallback(async () => {
    if (!stripe || !elements) {
      setError('Stripe is still loading.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: typeof window !== 'undefined' ? `${window.location.origin}/market/orders/${encodeURIComponent(session.orderId)}` : undefined,
        },
      })

      if (result.error) {
        setError(result.error.message ?? 'Payment failed.')
        return
      }

      const paymentIntentId = result.paymentIntent?.id ?? session.paymentIntentId
      let confirmed = await confirmCardOrder(session.orderId, paymentIntentId)
      if (!confirmed.ok && confirmed.error === 'payment_not_completed') {
        for (let attempt = 0; attempt < 4 && !confirmed.ok; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 700))
          confirmed = await confirmCardOrder(session.orderId, paymentIntentId)
          if (confirmed.error !== 'payment_not_completed') break
        }
      }

      if (!confirmed.ok) {
        setError(
          confirmed.error === 'payment_not_completed'
            ? 'Payment is still processing. Please wait a moment and try again.'
            : 'Unable to confirm your payment right now.',
        )
        return
      }

      await onPaid(session.orderId)
    } catch {
      setError('Payment failed.')
    } finally {
      setSubmitting(false)
    }
  }, [confirmCardOrder, elements, onPaid, session.orderId, session.paymentIntentId, stripe])

  return (
    <div className="space-y-4">
      <PaymentElement id="market-checkout-payment-element" options={{ layout: 'tabs' }} />
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!stripe || !elements || submitting}
        className="w-full rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Processing payment…' : 'Place Order with Credit Card'}
      </button>
    </div>
  )
}

export default function MarketCheckoutPageClient() {
  const router = useRouter()
  const viewer = useViewerStore((state) => state.me)
  const viewerHydrated = useViewerStore((state) => state.hydrated)

  const [lines, setLines] = useState<CartLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [shippingAddress, setShippingAddress] = useState<CanadianAddress>({ country: 'CA' })
  const [rememberShippingAddress, setRememberShippingAddress] = useState(true)

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card')
  const [paymentMethodInitialized, setPaymentMethodInitialized] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [submittingWallet, setSubmittingWallet] = useState(false)
  const [preparingCard, setPreparingCard] = useState(false)
  const [cardSession, setCardSession] = useState<CardCheckoutSession | null>(null)

  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  const hasSession = Boolean(token)

  useEffect(() => {
    if (!token) return
    void ensureViewerMe({ token })
  }, [token])

  useEffect(() => {
    const fallback = readStoredMarketShippingAddress()
    if (fallback) setShippingAddress(fallback)

    if (!token) return

    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const parsed = await parseApiResponse<{ items?: SavedShippingAddress[] }>(response)
        if (cancelled || !response.ok) return
        const items = Array.isArray(parsed.json?.items) ? parsed.json.items : []
        const defaultAddress = items.find((entry) => entry.isDefault) ?? items[0] ?? null
        if (!defaultAddress) return
        const normalized = normalizeCanadianAddress(defaultAddress)
        setShippingAddress(normalized)
        writeStoredMarketShippingAddress(defaultAddress)
      } catch {
        // local fallback is enough
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

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
          return {
            ok: true as const,
            item,
            product: parsed.json.product,
            organization: parsed.json.organization,
            variant: resolveSelectedVariant(parsed.json.product, item),
          }
        }),
      )

      const nextLines: CartLine[] = []
      for (const result of results) {
        if (!result.ok) continue
        nextLines.push({ item: result.item, product: result.product, organization: result.organization, variant: result.variant })
      }
      setLines(nextLines)
    } catch {
      setError('Failed to load checkout items.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCheckoutLines()
  }, [loadCheckoutLines])

  const needsShipping = useMemo(() => {
    for (const line of lines) {
      if ((line.product.fulfillmentType || '').toLowerCase() === 'physical') return true
    }
    return false
  }, [lines])

  const currency = useMemo<string>(() => {
    const currencies = new Set(lines.map((line) => (line.product.currency || '').toUpperCase()).filter(Boolean))
    const [firstCurrency] = Array.from(currencies)
    return currencies.size === 1 && firstCurrency ? firstCurrency : 'CAD'
  }, [lines])

  const subtotalCents = useMemo(() => {
    let total = 0
    for (const line of lines) {
      total += resolveLineUnitPrice(line) * (line.item.quantity || 0)
    }
    return total
  }, [lines])

  const taxCents = useMemo(() => {
    const taxRegionCode = resolveTaxRegionCode(shippingAddress.province)
    if (!taxRegionCode) return 0

    let total = 0
    for (const line of lines) {
      if (!line.product.taxCollect) continue
      const rates = line.product.taxRatesByRegion
      if (!rates || typeof rates !== 'object') continue
      const ratePct = parseTaxRatePct((rates as Record<string, unknown>)[taxRegionCode])
      if (ratePct <= 0) continue
      const lineSubtotal = resolveLineUnitPrice(line) * (line.item.quantity || 0)
      total += Math.max(0, Math.round(lineSubtotal * (ratePct / 100)))
    }
    return total
  }, [lines, shippingAddress.province])

  const sellerAmountCents = subtotalCents + taxCents
  const walletCivilFeeCents = useMemo(() => calculateCivilFeeCents(subtotalCents), [subtotalCents])
  const cardStripeFeeCents = useMemo(() => computeStripeCardFeeCents(sellerAmountCents), [sellerAmountCents])
  const hasQuotedShipping = typeof cardSession?.totals?.shippingCents === 'number'

  const checkoutTotals = useMemo<CheckoutTotals>(() => {
    if (cardSession?.totals) return cardSession.totals

    return {
      subtotalCents,
      shippingCents: 0,
      taxCents,
      civilFeeCents: walletCivilFeeCents,
      stripeCardFeeCents: paymentMethod === 'credit_card' ? cardStripeFeeCents : 0,
      grandTotalCents:
        paymentMethod === 'credit_card'
          ? sellerAmountCents + walletCivilFeeCents + cardStripeFeeCents
          : sellerAmountCents + walletCivilFeeCents,
    }
  }, [cardSession?.totals, cardStripeFeeCents, paymentMethod, sellerAmountCents, subtotalCents, taxCents, walletCivilFeeCents])

  const walletBalanceCents = viewer?.wallet?.civilCreditsCents ?? 0
  const walletChargeCents = sellerAmountCents + walletCivilFeeCents
  const walletReady = hasSession && Boolean(viewer?.wallet?.enabled)
  const walletHasEnough = walletBalanceCents >= walletChargeCents
  const cardLocked = Boolean(cardSession)

  useEffect(() => {
    if (paymentMethodInitialized || cardLocked) return
    if (!hasSession) {
      setPaymentMethod('credit_card')
      setPaymentMethodInitialized(true)
      return
    }
    if (!viewerHydrated) return
    setPaymentMethod(walletBalanceCents > 0 ? 'civil_wallet' : 'credit_card')
    setPaymentMethodInitialized(true)
  }, [cardLocked, hasSession, paymentMethodInitialized, viewerHydrated, walletBalanceCents])

  const buildCheckoutPayload = useCallback(() => {
    const items = readMarketCart()
    if (!items.length) {
      throw new Error('Your cart is empty.')
    }

    const shipping = needsShipping ? addressToCheckoutShipping(shippingAddress) : null
    if (needsShipping) {
      if (!shipping?.line1 || !shipping?.city || !shipping?.province || !shipping?.postalCode || !shipping?.country) {
        throw new Error('Shipping address is required for physical items.')
      }
      if (rememberShippingAddress) {
        writeStoredMarketShippingAddress(shipping)
      }
    }

    return {
      items: items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        selectedAttributes: item.selectedAttributes ?? null,
        quantity: item.quantity,
      })),
      shippingAddress: shipping,
    }
  }, [needsShipping, rememberShippingAddress, shippingAddress])

  const persistShippingAddress = useCallback(async () => {
    if (!needsShipping || !rememberShippingAddress || !token || !hasCanadianAddressValue(shippingAddress)) return

    const normalized = normalizeCanadianAddress(shippingAddress)
    try {
      await fetch(buildApiUrl('/market/account/shipping-addresses'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...normalized,
          country: normalized.country || 'CA',
          isDefault: true,
        }),
      })
    } catch {
      // Local storage fallback is already in place.
    }
  }, [needsShipping, rememberShippingAddress, shippingAddress, token])

  const resolveCheckoutError = useCallback((payload: any, fallback = 'Unable to start checkout right now.') => {
    const code = typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.error === 'string' ? payload.error.error : null
    if (code === 'unauthorized') return 'Sign in to place your order.'
    if (code === 'single_seller_required') return 'Checkout supports items from a single seller. Remove items to continue.'
    if (code === 'single_currency_required') return 'Checkout supports a single currency per order.'
    if (code === 'shipping_address_required') return 'Shipping address is required for physical items.'
    if (code === 'variant_selection_required') return 'Choose product options before checkout.'
    if (code === 'invalid_variant_selection') return 'One of the selected product options is no longer available.'
    if (code === 'shipping_unavailable') return 'No shipping option is currently available for this destination.'
    if (code === 'insufficient_inventory') return 'One of these products no longer has enough inventory.'
    if (code === 'card_checkout_unavailable') return 'This organization is not ready for credit card checkout yet.'
    if (code === 'civil_wallet_unavailable') return 'This organization cannot receive Civil Wallet payments right now.'
    if (code === 'wallet_required') return 'Enable your Civil Wallet before using wallet checkout.'
    if (code === 'insufficient_wallet_balance') return 'Your Civil Wallet does not have enough funds for this order.'
    if (code === 'stripe_not_configured') return 'Credit card checkout is not configured right now.'
    return fallback
  }, [])

  const handlePaidOrder = useCallback(
    async (orderId: string) => {
      writeMarketCart([])
      window.dispatchEvent(new Event('civil:market-cart-changed'))
      if (token) {
        await ensureViewerMe({ token, refresh: true })
      }
      router.push(`/market/orders/${encodeURIComponent(orderId)}`)
    },
    [router, token],
  )

  const startCardCheckout = useCallback(async () => {
    if (!hasSession) {
      setAuthModalOpen(true)
      return
    }
    setPreparingCard(true)
    setError(null)
    try {
      const payload = buildCheckoutPayload()
      await persistShippingAddress()
      const response = await fetch(buildApiUrl('/market/checkout/card/intent'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      })
      const parsed = await parseApiResponse<CardCheckoutSession & { error?: unknown }>(response)
      if (!response.ok || !parsed.json?.clientSecret || !parsed.json?.paymentIntentId || !parsed.json?.publishableKey || !parsed.json?.orderId) {
        setError(resolveCheckoutError(parsed.json, 'Unable to prepare credit card checkout right now.'))
        return
      }

      setCardSession({
        orderId: parsed.json.orderId,
        clientSecret: parsed.json.clientSecret,
        customerSessionClientSecret: parsed.json.customerSessionClientSecret ?? null,
        paymentIntentId: parsed.json.paymentIntentId,
        publishableKey: parsed.json.publishableKey,
        totals: parsed.json.totals,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to prepare credit card checkout right now.')
    } finally {
      setPreparingCard(false)
    }
  }, [buildCheckoutPayload, hasSession, persistShippingAddress, resolveCheckoutError])

  const placeWalletOrder = useCallback(async () => {
    if (!hasSession) {
      setAuthModalOpen(true)
      return
    }

    setSubmittingWallet(true)
    setError(null)
    try {
      const payload = buildCheckoutPayload()
      await persistShippingAddress()
      const response = await fetch(buildApiUrl('/market/checkout/civil-wallet'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      })
      const parsed = await parseApiResponse<{ orderId?: string; error?: unknown }>(response)
      if (!response.ok || typeof parsed.json?.orderId !== 'string') {
        const nextError = resolveCheckoutError(parsed.json, 'Unable to place your Civil Wallet order right now.')
        setError(nextError)
        return
      }

      pushToast('Order placed with Civil Wallet.', 'success')
      await handlePaidOrder(parsed.json.orderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to place your Civil Wallet order right now.')
    } finally {
      setSubmittingWallet(false)
    }
  }, [buildCheckoutPayload, handlePaidOrder, hasSession, persistShippingAddress, resolveCheckoutError])

  const stripePromise = useMemo(() => (cardSession?.publishableKey ? loadStripe(cardSession.publishableKey) : null), [cardSession?.publishableKey])

  return (
    <DashboardShell rightRail={<div aria-hidden="true" />} registerRightRail={false}>
      <div className="space-y-6 pb-24">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Checkout</h1>
            <div className="mt-1 text-sm text-slate-600">Choose how you want to pay and place your order.</div>
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
                  <div key={getMarketCartItemKey(line.item)} className="flex items-center gap-4 p-4">
                    <Link
                      href={`/market/products/${encodeURIComponent(line.product.id)}`}
                      className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl transition hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]/30"
                    >
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                        {line.product.primaryImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={line.product.primaryImageUrl} alt={line.product.name} className="h-full w-full object-cover" />
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{line.product.name}</div>
                        <div className="mt-1 text-xs text-slate-600">{line.organization.name}</div>
                        {formatSelectedAttributes(line.item) ? <div className="mt-1 text-xs text-slate-600">{formatSelectedAttributes(line.item)}</div> : null}
                        <div className="mt-1 text-xs text-slate-600">Qty {line.item.quantity}</div>
                      </div>
                    </Link>

                    <div className="w-28 text-right text-sm font-semibold text-slate-900">
                      {formatMoney(resolveLineUnitPrice(line) * line.item.quantity, line.product.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {hasSession && needsShipping ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Shipping address</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Name"
                    disabled={submittingWallet || preparingCard || cardLocked}
                    value={shippingAddress.name ?? ''}
                    onChange={(e) => setShippingAddress((state) => ({ ...state, name: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Postal code"
                    disabled={submittingWallet || preparingCard || cardLocked}
                    value={shippingAddress.postalCode ?? ''}
                    onChange={(e) => setShippingAddress((state) => ({ ...state, postalCode: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Address line 1"
                    disabled={submittingWallet || preparingCard || cardLocked}
                    value={shippingAddress.line1 ?? ''}
                    onChange={(e) => setShippingAddress((state) => ({ ...state, line1: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="Address line 2 (optional)"
                    disabled={submittingWallet || preparingCard || cardLocked}
                    value={shippingAddress.line2 ?? ''}
                    onChange={(e) => setShippingAddress((state) => ({ ...state, line2: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="City"
                    disabled={submittingWallet || preparingCard || cardLocked}
                    value={shippingAddress.city ?? ''}
                    onChange={(e) => setShippingAddress((state) => ({ ...state, city: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="Province"
                    disabled={submittingWallet || preparingCard || cardLocked}
                    value={shippingAddress.province ?? ''}
                    onChange={(e) => setShippingAddress((state) => ({ ...state, province: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={rememberShippingAddress}
                    disabled={submittingWallet || preparingCard || cardLocked}
                    onChange={(e) => setRememberShippingAddress(e.target.checked)}
                  />
                  Remember this shipping address?
                </label>
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <div>Subtotal</div>
                  <div className="font-semibold text-slate-900">{formatMoney(checkoutTotals.subtotalCents, currency)}</div>
                </div>
                {needsShipping ? (
                  <div className="flex items-center justify-between">
                    <div>Shipping</div>
                    <div className="font-semibold text-slate-900">
                      {hasQuotedShipping ? formatMoney(checkoutTotals.shippingCents, currency) : 'Calculated at payment'}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <div>Taxes</div>
                  <div className="font-semibold text-slate-900">{formatMoney(checkoutTotals.taxCents, currency)}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div>Civil Fee</div>
                  <div className="font-semibold text-slate-900">{formatMoney(checkoutTotals.civilFeeCents, currency)}</div>
                </div>
                {checkoutTotals.stripeCardFeeCents > 0 ? (
                  <div className="flex items-center justify-between">
                    <div>Credit card fee</div>
                    <div className="font-semibold text-slate-900">{formatMoney(checkoutTotals.stripeCardFeeCents, currency)}</div>
                  </div>
                ) : null}
                <div className="mt-1 border-t border-slate-200 pt-2" />
                <div className="flex items-center justify-between text-base">
                  <div className="font-semibold text-slate-900">Total</div>
                  <div className="font-semibold text-slate-900">{formatMoney(checkoutTotals.grandTotalCents, currency)}</div>
                </div>
              </div>
              {needsShipping && !hasQuotedShipping ? (
                <p className="mt-3 text-xs text-slate-500">Shipping is finalized once checkout confirms the destination and available shipping policy.</p>
              ) : null}
            </div>

            {!hasSession ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-sm font-semibold text-slate-900">Sign in to checkout</div>
                <div className="mt-1 text-sm text-slate-600">Civil Market checkout requires a Civil account.</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => redirectToAuthModal('register')}
                    className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Join Civil
                  </button>
                  <button
                    type="button"
                    onClick={() => redirectToAuthModal('login')}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                  >
                    Login
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Payment method</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      disabled={cardLocked}
                      onClick={() => {
                        setPaymentMethod('civil_wallet')
                        setError(null)
                      }}
                      className={`rounded-2xl border p-4 text-left transition ${
                        paymentMethod === 'civil_wallet'
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${cardLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <FaWallet className="h-5 w-5" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Civil Wallet</div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-slate-700">
                        Wallet balance: <span className="font-semibold text-slate-900">{formatMoney(walletBalanceCents, currency)}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={cardLocked}
                      onClick={() => {
                        setPaymentMethod('credit_card')
                        setError(null)
                      }}
                      className={`rounded-2xl border p-4 text-left transition ${
                        paymentMethod === 'credit_card'
                          ? 'border-[var(--cc-primary)] bg-rose-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${cardLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-[var(--cc-primary)]">
                          <FaCreditCard className="h-5 w-5" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Credit Card</div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {cardSession && stripePromise ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Credit card payment</div>
                    <Elements
                      stripe={stripePromise as Promise<Stripe | null>}
                      options={{
                        clientSecret: cardSession.clientSecret,
                        customerSessionClientSecret: cardSession.customerSessionClientSecret ?? undefined,
                        appearance: {
                          theme: 'stripe',
                          variables: { colorPrimary: '#C8102E' },
                        },
                      }}
                    >
                      <CardCheckoutForm session={cardSession} token={token} onPaid={handlePaidOrder} />
                    </Elements>
                  </div>
                ) : paymentMethod === 'civil_wallet' ? (
                  <button
                    type="button"
                    onClick={() => void placeWalletOrder()}
                    disabled={submittingWallet || (viewerHydrated && !walletHasEnough)}
                    className="w-full rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submittingWallet ? 'Placing order…' : 'Place Order with Civil Wallet'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startCardCheckout()}
                    disabled={preparingCard}
                    className="w-full rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {preparingCard ? 'Preparing checkout…' : 'Continue to Credit Card'}
                  </button>
                )}
              </>
            )}
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

      <Modal open={authModalOpen} onClose={() => setAuthModalOpen(false)} title="Sign in to checkout" maxWidthClassName="max-w-lg">
        <div className="space-y-5">
          <p className="text-sm text-slate-600">Civil Market checkout requires a Civil account.</p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => redirectToAuthModal('register')}
              className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Join Civil
            </button>
            <button
              type="button"
              onClick={() => redirectToAuthModal('login')}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Login
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}
