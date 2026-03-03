'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'

type OrderListItem = {
  id: string
  businessId: string
  businessName: string
  status: string
  currency: string
  subtotalCents: number
  feeCents: number
  totalCents: number
  itemCount: number
  createdAt: string
}

type OrdersResponse = {
  items?: OrderListItem[]
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

export default function YourOrdersPanel({ title = 'Your Orders', limit = 8 }: { title?: string; limit?: number }) {
  const [orders, setOrders] = useState<OrderListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const response = await fetch(buildApiUrl(`/market/orders?limit=${encodeURIComponent(String(limit))}`), {
          headers: getAuthHeaders(),
          cache: 'no-store',
        })
        const parsed = await parseApiResponse<OrdersResponse & { error?: unknown }>(response)
        if (cancelled) return
        if (!response.ok) {
          setOrders([])
          return
        }
        setOrders(Array.isArray(parsed.json?.items) ? parsed.json!.items! : [])
      } catch {
        if (cancelled) return
        setOrders([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [limit])

  const hasOrders = useMemo(() => orders.length > 0, [orders.length])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>

      {loading ? <p className="mt-3 text-xs text-slate-500">Loading…</p> : null}
      {!loading && !hasOrders ? <p className="mt-3 text-xs text-slate-500">You haven&apos;t placed any orders yet.</p> : null}

      {!loading && hasOrders ? (
        <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
          {orders.map((order) => (
            <Link key={order.id} href={`/market/orders/${encodeURIComponent(order.id)}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-white">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">{order.businessName}</div>
                <div className="mt-0.5 text-[11px] text-slate-600">
                  {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} • {order.status}
                </div>
              </div>
              <div className="text-right text-xs font-semibold text-slate-900">{formatMoney(order.totalCents, order.currency)}</div>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
