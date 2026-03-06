'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import { RightRail } from '../../_components/RightRail'
import CivilCard from '../../_components/CivilCard'

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
  logoUrl?: string | null
  coverUrl?: string | null
  phone?: string | null
  websiteUrl?: string | null
  address?: string | null
  schedule?: string | null
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

function toWebsiteHref(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

export default function OrganizationDirectoryPageClient() {
  const [q, setQ] = useState('')
  const [type, setType] = useState<'' | OrgDirectoryItem['type']>('')
  const [items, setItems] = useState<OrgDirectoryItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (type) params.set('type', type)
    params.set('limit', '50')
    return buildApiUrl(`/organizations/directory?${params.toString()}`)
  }, [q, type])

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' })
      const payload = (await res.json().catch(() => null)) as (DirectoryResponse & { error?: unknown; message?: unknown }) | null
      if (!res.ok) {
        const errorCode = typeof payload?.error === 'string' ? payload.error : null
        const message = typeof payload?.message === 'string' ? payload.message : null
        setErrorMessage(
          message
            ? message
            : errorCode
              ? `Request failed (${res.status} ${errorCode}).`
              : `Request failed (${res.status}).`,
        )
        throw new Error('request_failed')
      }
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
    <DashboardShell
      rightRail={<RightRail mode="organizationsDirectory" />}
      mainClassName="space-y-6"
    >
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
        {status === 'error' ? (
          <p className="text-sm text-slate-500">{errorMessage ?? 'Unable to load directory.'}</p>
        ) : null}
        {status === 'ready' && !items.length ? <p className="text-sm text-slate-500">No organizations found.</p> : null}

        {items.length ? (
          <ul className="space-y-3">
            {items.map((org) => (
              <li key={org.id}>
                <CivilCard
                  size="lg"
                  name={org.name}
                  avatarAlt={org.name}
                  avatarInitials={org.name}
                  avatarSrc={org.logoUrl ?? null}
                  avatarHref={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                  titleHref={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                  coverUrl={org.coverUrl ?? null}
                  subtitle={`${formatTypeLabel(org.type)} · ${org.provinceCode.toUpperCase()} · ${org.communitySlug}`}
                  details={
                    <div className="space-y-1">
                      {org.phone ? <p className="truncate">{org.phone}</p> : null}
                      {org.websiteUrl ? (
                        <p className="truncate">
                          <a
                            href={toWebsiteHref(org.websiteUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {org.websiteUrl}
                          </a>
                        </p>
                      ) : null}
                      {org.address ? <p className="truncate">{org.address}</p> : null}
                      {org.schedule ? <p className="truncate">{org.schedule}</p> : null}
                    </div>
                  }
                  isVerified={org.isVerified}
                  trailing={
                    org.isVerified ? (
                      <span className="shrink-0 rounded-full border border-white/40 bg-white/10 px-2 py-1 text-xs font-semibold text-white">Verified</span>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DashboardShell>
  )
}
