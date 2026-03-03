'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import DashboardShell from '../../../_components/DashboardShell'
import { buildApiUrl, parseApiResponse } from '../../../_lib/api'
import { writeMarketCart } from '../../_lib/cart'

type Order = {
  id: string
  businessId: string
  status: string
  currency: string
  subtotalCents: number
  feeCents: number
  totalCents: number
  shippingAddress: unknown
  createdAt: string
}

type OrderItem = {
  id: string
  name: string
  priceCents: number
  quantity: number
  fulfillmentType: string
  digitalDeliveryUrl: string | null
}

type OrderResponse = {
  order: Order
  items: OrderItem[]
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

function formatShippingAddress(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const line1 = typeof obj.line1 === 'string' ? obj.line1.trim() : ''
  const line2 = typeof obj.line2 === 'string' ? obj.line2.trim() : ''
  const city = typeof obj.city === 'string' ? obj.city.trim() : ''
  const province = typeof obj.province === 'string' ? obj.province.trim() : ''
  const postalCode = typeof obj.postalCode === 'string' ? obj.postalCode.trim() : ''
  const country = typeof obj.country === 'string' ? obj.country.trim() : ''

  const lines: string[] = []
  if (name) lines.push(name)
  if (line1) lines.push(line1)
  if (line2) lines.push(line2)

  const cityLine = [city, province, postalCode].filter(Boolean).join(', ')
  if (cityLine) lines.push(cityLine)
  if (country) lines.push(country)
  return lines
}

export default function MarketOrderPageClient({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const refreshAttemptsRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const attempt = refreshAttemptsRef.current

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildApiUrl(`/market/orders/${encodeURIComponent(orderId)}`), {
          headers: getAuthHeaders(),
          cache: 'no-store',
        })

        const parsed = await parseApiResponse<OrderResponse & { error?: unknown }>(response)
        if (cancelled) return

        if (!response.ok || !parsed.json?.order) {
          setError('Failed to load order')
          return
        }

        setData(parsed.json)

        const status = (parsed.json.order.status || '').toLowerCase()
        if (status === 'paid' || status === 'fulfilled') {
          writeMarketCart([])
          refreshAttemptsRef.current = 0
          return
        }

        if (status === 'pending' && attempt < 20) {
          refreshAttemptsRef.current = attempt + 1
          setTimeout(() => {
            if (cancelled) return
            setRefreshTick((t) => t + 1)
          }, 3000)
        }
      } catch {
        if (cancelled) return
        setError('Failed to load order')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [orderId, refreshTick])

  const shippingLines = useMemo(() => formatShippingAddress(data?.order?.shippingAddress), [data?.order?.shippingAddress])

  return (
    <DashboardShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Order</h1>
            <div className="mt-1 text-sm text-slate-600">{orderId}</div>
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
        ) : data?.order ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-700">
                  Status: <span className="font-semibold text-slate-900">{data.order.status}</span>
                </div>
                <div className="text-sm font-semibold text-slate-900">{formatMoney(data.order.totalCents, data.order.currency)}</div>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <span className="font-semibold text-slate-900">{formatMoney(data.order.subtotalCents, data.order.currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Platform fee</span>
                  <span className="font-semibold text-slate-900">{formatMoney(data.order.feeCents, data.order.currency)}</span>
                </div>
              </div>
            </div>

            {shippingLines.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Shipping address</div>
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  {shippingLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100">
                {data.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        Qty {item.quantity} • {formatMoney(item.priceCents, data.order.currency)} each
                      </div>
                      {item.digitalDeliveryUrl ? (
                        <div className="mt-2">
                          <a
                            href={item.digitalDeliveryUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-semibold text-slate-900 underline"
                          >
                            Download
                          </a>
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-sm font-semibold text-slate-900">
                      {formatMoney(item.priceCents * item.quantity, data.order.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm text-slate-700">Order not found.</div>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
