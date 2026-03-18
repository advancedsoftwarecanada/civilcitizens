'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'

type FederalPartyListResponse = {
  items?: Array<{
    id: string
    slug: string
    name: string
    shortName: string | null
    associationCount: number
    politicianCount: number
    seatCount: number
    updatedAt: string
    previewPolitician: {
      slug: string
      displayName: string
      lastScrapeAt: string | null
      photoUrl: string | null
    } | null
  }>
}

function buildInitials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'MP'
  )
}

export default function FederalPoliticiansPage() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<FederalPartyListResponse['items']>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    params.set('limit', '100')
    return buildApiUrl(`/politicians/federal?${params.toString()}`)
  }, [query])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(apiUrl, { cache: 'no-store' })
        if (!res.ok) throw new Error('request_failed')
        const payload = (await res.json().catch(() => null)) as FederalPartyListResponse | null
        if (!cancelled) {
          setItems(payload?.items ?? [])
          setStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setItems([])
          setStatus('error')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [apiUrl])

  return (
    <DashboardShell mainClassName="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Politicians</p>
        <h1 className="text-2xl font-semibold text-slate-900">Federal Parties</h1>
        <p className="text-sm text-slate-600">Browse imported federal parties, district associations, and politician profiles.</p>
      </section>

      <section className="surface-card px-6 py-5">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Search parties
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Conservative, Liberal, Green…"
          />
        </label>
      </section>

      <section className="surface-card px-6 py-5">
        {status === 'loading' ? <p className="text-sm text-slate-500">Loading parties…</p> : null}
        {status === 'error' ? <p className="text-sm text-rose-600">Unable to load federal party data.</p> : null}
        {status === 'ready' && !items?.length ? <p className="text-sm text-slate-500">No federal parties found.</p> : null}

        {items?.length ? (
          <ul className="space-y-3">
            {items.map((party) => (
              <li key={party.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-start gap-3">
                      <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                        {party.previewPolitician?.photoUrl ? (
                          <img src={party.previewPolitician.photoUrl} alt={party.previewPolitician.displayName} className="h-full w-full object-cover" loading="lazy" />
                        ) : party.previewPolitician ? (
                          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500">
                            {buildInitials(party.previewPolitician.displayName)}
                          </div>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">Party</div>
                        )}
                      </div>

                      <div>
                        <Link href={`/politicians/federal/${encodeURIComponent(party.slug)}`} className="text-base font-semibold text-slate-900 hover:text-[var(--cc-primary)] hover:underline">
                          {party.shortName ?? party.name}
                        </Link>
                        <p className="mt-1 text-sm text-slate-600">{party.name}</p>
                        {party.previewPolitician ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Preview: {party.previewPolitician.displayName}
                            {party.previewPolitician.lastScrapeAt ? ` · Updated ${new Date(party.previewPolitician.lastScrapeAt).toLocaleString()}` : ''}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>{party.associationCount} associations</p>
                    <p>{party.politicianCount} politicians</p>
                    <p>{party.seatCount} seats</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </DashboardShell>
  )
}