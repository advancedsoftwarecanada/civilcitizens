'use client'

import { useEffect, useMemo, useState } from 'react'

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

function formatAddressLines(address: ShippingAddress): string[] {
  const lines: string[] = []
  const name = String(address.name ?? '').trim()
  const line1 = String(address.line1 ?? '').trim()
  const line2 = String(address.line2 ?? '').trim()
  const city = String(address.city ?? '').trim()
  const province = String(address.province ?? '').trim()
  const postalCode = String(address.postalCode ?? '').trim()
  const country = String(address.country ?? '').trim()

  if (name) lines.push(name)
  if (line1) lines.push(line1)
  if (line2) lines.push(line2)

  const cityLine = [city, province, postalCode].filter(Boolean).join(', ')
  if (cityLine) lines.push(cityLine)
  if (country) lines.push(country)

  return lines
}

export default function ShippingAddressesPanel({ title = 'Shipping Addresses' }: { title?: string }) {
  const [address, setAddress] = useState<ShippingAddress | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(MARKET_SHIPPING_ADDRESS_KEY)
      if (!raw) {
        setAddress(null)
        return
      }
      const parsed = JSON.parse(raw) as ShippingAddress | null
      if (!parsed || typeof parsed !== 'object') {
        setAddress(null)
        return
      }
      setAddress(parsed)
    } catch {
      setAddress(null)
    }
  }, [])

  const lines = useMemo(() => (address ? formatAddressLines(address) : []), [address])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {lines.length ? (
        <div className="mt-3 space-y-1 text-xs text-slate-700">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Default</p>
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">No saved shipping addresses yet.</p>
      )}
    </section>
  )
}
