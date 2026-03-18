'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type ListingItem = {
  id: string
  title: string
  status: string
  isDraft: boolean
}

type ListingsResponse = {
  items?: ListingItem[]
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

export default function YourListingsPanel() {
  const [items, setItems] = useState<ListingItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(buildApiUrl('/market/listings/mine?limit=3'), {
          headers: getAuthHeaders(),
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) {
          setItems([])
          setStatus('error')
          return
        }
        const payload = (await res.json().catch(() => null)) as ListingsResponse | null
        setItems(Array.isArray(payload?.items) ? payload.items : [])
        setStatus('ready')
      } catch {
        if (cancelled) return
        setItems([])
        setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Your listing</h3>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Link
            href="/market/listings"
            className="inline-flex items-center justify-center rounded-full bg-red-600 px-3 py-1.5 text-white transition hover:bg-red-500"
          >
            View all
          </Link>
        </div>
      </div>

      {status === 'ready' && items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/market/listings/new?listing=${encodeURIComponent(item.id)}`} className="block rounded-lg border border-slate-200 px-2 py-1.5 hover:bg-slate-50">
                <p className="truncate text-xs font-semibold text-slate-800">{item.title || 'Untitled listing'}</p>
                <p className="text-[11px] text-slate-500">{item.isDraft ? 'Draft' : item.status}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {status === 'ready' && !items.length ? (
        <p className="mt-3 text-xs text-slate-500">Post personal items peer-to-peer, or create through an organization shop if you manage one.</p>
      ) : null}

      {status === 'loading' ? <p className="mt-3 text-xs text-slate-500">Loading listings…</p> : null}
      {status === 'error' ? <p className="mt-3 text-xs text-slate-500">Unable to load listings right now.</p> : null}
    </section>
  )
}
