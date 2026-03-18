'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'
import type { CommunityOrganization } from '../../_lib/organizations'
import CivilCard from '../../_components/CivilCard'
import OrganizationDirectoryMap from './OrganizationDirectoryMap'

type ListResponse = {
  items?: CommunityOrganization[]
}

export default function CommunityOrganizationsList({ province, municipality }: { province: string; municipality: string }) {
  const [orgs, setOrgs] = useState<CommunityOrganization[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [specialization, setSpecialization] = useState('')

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const endpoint = useMemo(() => {
    const qs = new URLSearchParams({ limit: '50' })
    return buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs?${qs.toString()}`)
  }, [municipality, province])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const headers = token ? { authorization: `Bearer ${token}` } : undefined
      const orgRes = await fetch(endpoint, { headers, cache: 'no-store' })

      if (!orgRes.ok) {
        setStatus('error')
        return
      }

      const orgJson = (await orgRes.json().catch(() => null)) as ListResponse | null
      const items = Array.isArray(orgJson?.items) ? orgJson.items : []

      setOrgs(items)
      setStatus('ready')
    } catch (err) {
      console.error('Unable to load community organizations', err)
      setStatus('error')
    }
  }, [endpoint, token])

  useEffect(() => {
    void load()
  }, [load])

  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(orgs.map((org) => org.category).filter((value): value is string => typeof value === 'string' && value.trim().length > 0))).sort(),
    [orgs],
  )

  const specializationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          orgs
            .filter((org) => !category || org.category === category)
            .map((org) => org.specialization)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
        ),
      ).sort(),
    [category, orgs],
  )

  const filteredOrgs = useMemo(() => {
    const trimmedQuery = q.trim().toLowerCase()
    return orgs.filter((org) => {
      if (trimmedQuery) {
        const haystack = [org.name, org.description ?? '', org.address ?? ''].join(' ').toLowerCase()
        if (!haystack.includes(trimmedQuery)) return false
      }
      if (category && org.category !== category) return false
      if (specialization && org.specialization !== specialization) return false
      return true
    })
  }, [category, orgs, q, specialization])

  const formatDirectoryLabel = useCallback((value: string | null | undefined) => {
    if (!value) return null
    return value
      .split('_')
      .map((segment) => (segment ? segment[0] + segment.slice(1).toLowerCase() : segment))
      .join(' ')
  }, [])

  const formatTypeLabel = useCallback((value: CommunityOrganization['type']) => {
    switch (value) {
      case 'INDIVIDUAL':
        return 'Individual'
      case 'SOLE_PROPRIETORSHIP':
        return 'Sole Proprietorship'
      case 'CORPORATION':
        return 'Corporation'
      case 'NON_PROFIT':
        return 'Non Profit'
      case 'CHARITY':
        return 'Charity'
      case 'COMMUNITY_GROUP':
        return 'Community Group'
      case 'RELIGIOUS_ORGANIZATION':
        return 'Religious Organization'
      case 'GOVERNMENT':
        return 'Government'
      default:
        return value
    }
  }, [])

  if (status === 'loading') {
    return <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
  }

  if (status === 'error') {
    return <p className="text-sm text-slate-600">Unable to load organizations right now.</p>
  }

  if (!orgs.length) {
    return <p className="text-sm text-slate-600">No organizations in this community yet.</p>
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Search
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Search by name"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Category
            <select
              value={category}
              onChange={(event) => {
                const nextCategory = event.target.value
                setCategory(nextCategory)
                if (!nextCategory) {
                  setSpecialization('')
                  return
                }
                const nextSpecializations = Array.from(
                  new Set(
                    orgs
                      .filter((org) => org.category === nextCategory)
                      .map((org) => org.specialization)
                      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
                  ),
                )
                if (!nextSpecializations.includes(specialization)) {
                  setSpecialization('')
                }
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {formatDirectoryLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Specialization
            <select
              value={specialization}
              onChange={(event) => setSpecialization(event.target.value)}
              disabled={!category}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            >
              <option value="">{category ? 'All specializations' : 'Select a category first'}</option>
              {specializationOptions.map((option) => (
                <option key={option} value={option}>
                  {formatDirectoryLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <OrganizationDirectoryMap organizations={filteredOrgs} />

      <div className="surface-card p-5">
        {!filteredOrgs.length ? <p className="text-sm text-slate-500">No organizations found.</p> : null}

        {filteredOrgs.length ? (
          <ul className="space-y-3">
            {filteredOrgs.map((org) => (
              <li key={org.id}>
                <CivilCard
                  href={`/com/${encodeURIComponent(org.provinceCode ?? province)}/${encodeURIComponent(org.communitySlug ?? municipality)}/orgs/${encodeURIComponent(org.slug)}`}
                  size="lg"
                  name={org.name}
                  avatarAlt={org.name}
                  avatarInitials={org.name}
                  avatarSrc={org.logoUrl}
                  coverUrl={org.coverUrl}
                  subtitle={[
                    formatTypeLabel(org.type),
                    formatDirectoryLabel(org.category),
                    formatDirectoryLabel(org.specialization),
                    `${org.followerCount} followers`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  details={org.description ? <p className="line-clamp-2">{org.description}</p> : null}
                  isVerified={org.isVerified}
                  className="transition hover:border-slate-300"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
