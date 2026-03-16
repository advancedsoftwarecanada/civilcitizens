'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { formatCanadianAddressLines, type SavedShippingAddress, writeStoredMarketShippingAddress } from '../../_lib/canadianAddresses'

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
}

function getToken() {
  return typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
}

export default function ShippingAddressesPanel({ title = 'Shipping Addresses' }: { title?: string }) {
  const [items, setItems] = useState<SavedShippingAddress[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setItems([])
      setLoading(false)
      return
    }

    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const { json } = await parseApiResponse<ShippingAddressListResponse>(response)
        if (cancelled) return
        const nextItems = Array.isArray(json?.items) ? json.items : []
        setItems(nextItems)
        const defaultAddress = nextItems.find((entry) => entry.isDefault) ?? nextItems[0] ?? null
        if (defaultAddress) writeStoredMarketShippingAddress(defaultAddress)
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const orderedItems = useMemo(
    () => [...items].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || String(a.label ?? '').localeCompare(String(b.label ?? ''))),
    [items],
  )

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <Link
          href="/market/account/shipping-addresses/new"
          className="inline-flex items-center justify-center rounded-full border border-sky-600 bg-sky-600 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:border-sky-700 hover:bg-sky-700"
        >
          Add address
        </Link>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-slate-500">Loading saved addresses…</p>
      ) : orderedItems.length ? (
        <div className="mt-3 space-y-3">
          {orderedItems.map((item) => {
            const lines = formatCanadianAddressLines(item)
            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-slate-900">{item.label || item.name || 'Shipping address'}</p>
                      {item.isDefault ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-700">
                      {lines.map((line) => (
                        <div key={`${item.id}-${line}`}>{line}</div>
                      ))}
                    </div>
                  </div>
                  <Link
                    href={`/market/account/shipping-addresses/${encodeURIComponent(item.id)}`}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-50"
                  >
                    Edit
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
          No saved shipping addresses yet.
        </div>
      )}
    </section>
  )
}