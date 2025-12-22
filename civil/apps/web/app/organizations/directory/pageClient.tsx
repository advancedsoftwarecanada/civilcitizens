'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../_components/DashboardShell'
import Sidebar from '../../_components/Sidebar'
import { buildApiUrl } from '../../_lib/api'

type OrgDirectoryItem = {
  id: string
  name: string
  slug: string
  type:
    | 'LOCAL_BUSINESS'
    | 'NON_PROFIT'
    | 'COMMUNITY_GROUP'
    | 'EDUCATIONAL'
    | 'RELIGIOUS'
    | 'GOVERNMENT'
    | 'ARTS_CULTURE'
    | 'SPORTS_RECREATION'
  provinceCode: string
  communitySlug: string
  isVerified: boolean
}

type DirectoryResponse = {
  items?: OrgDirectoryItem[]
}

const TYPE_OPTIONS: Array<{ value: '' | OrgDirectoryItem['type']; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'LOCAL_BUSINESS', label: 'Local Business' },
  { value: 'NON_PROFIT', label: 'Non-Profit / Charity' },
  { value: 'COMMUNITY_GROUP', label: 'Community Group' },
  { value: 'EDUCATIONAL', label: 'Educational Organization' },
  { value: 'RELIGIOUS', label: 'Religious / Spiritual Organization' },
  { value: 'GOVERNMENT', label: 'Government / Civic Body' },
  { value: 'ARTS_CULTURE', label: 'Arts & Culture Organization' },
  { value: 'SPORTS_RECREATION', label: 'Sports & Recreation Organization' },
]

function formatTypeLabel(value: OrgDirectoryItem['type']) {
  return TYPE_OPTIONS.find((opt) => opt.value === value)?.label ?? value
}

export default function OrganizationDirectoryPageClient() {
  const [q, setQ] = useState('')
  const [type, setType] = useState<'' | OrgDirectoryItem['type']>('')
  const [items, setItems] = useState<OrgDirectoryItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (type) params.set('type', type)
    params.set('limit', '50')
    return buildApiUrl(`/organizations/directory?${params.toString()}`)
  }, [q, type])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error('request_failed')
      const payload = (await res.json().catch(() => null)) as DirectoryResponse | null
      setItems(Array.isArray(payload?.items) ? payload!.items! : [])
      setStatus('ready')
    } catch {
      setItems([])
      setStatus('error')
    }
  }, [apiUrl])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <DashboardShell sidebar={<Sidebar active="organizations" />} mainClassName="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Organizations Directory</h1>
        <p className="text-sm text-slate-600">Search and browse organizations by type.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Search by name"
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as '' | OrgDirectoryItem['type'])}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="surface-card p-5">
        {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {status === 'error' ? <p className="text-sm text-slate-500">Unable to load directory.</p> : null}
        {status === 'ready' && !items.length ? <p className="text-sm text-slate-500">No organizations found.</p> : null}

        {items.length ? (
          <ul className="divide-y divide-slate-100">
            {items.map((org) => (
              <li key={org.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                      className="block truncate text-sm font-semibold text-slate-900 hover:underline"
                    >
                      {org.name}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTypeLabel(org.type)} · {org.provinceCode.toUpperCase()} · {org.communitySlug}
                    </p>
                  </div>
                  {org.isVerified ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">Verified</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DashboardShell>
  )
}
