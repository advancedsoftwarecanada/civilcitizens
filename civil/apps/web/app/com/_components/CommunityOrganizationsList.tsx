'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildApiUrl } from '../../_lib/api'

type CommunityOrganization = {
  id: string
  ownerId: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
  logoUrl: string | null
  coverUrl: string | null
  description: string | null
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED'
  isVerified: boolean
  followerCount: number
  viewerFollowed: boolean
}

type ListResponse = {
  items?: CommunityOrganization[]
}

export default function CommunityOrganizationsList({ province, municipality }: { province: string; municipality: string }) {
  const [orgs, setOrgs] = useState<CommunityOrganization[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

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
    <div className="grid gap-3 sm:grid-cols-2">
      {orgs.map((org) => (
        <Link
          key={org.id}
          href={`/com/${encodeURIComponent(org.provinceCode ?? province)}/${encodeURIComponent(org.communitySlug ?? municipality)}/orgs/${encodeURIComponent(org.slug)}`}
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-800 p-4 transition hover:border-slate-300"
        >
          {org.coverUrl ? <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
          <span className="absolute inset-0 bg-slate-900/60" aria-hidden="true" />

          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-9 w-9 overflow-hidden rounded-full border border-white/40 bg-white/20">
                  {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                </span>
                <p className="font-semibold text-white">{org.name}</p>
              </div>
                  {org.description ? <p className="mt-2 line-clamp-2 text-sm text-white/85">{org.description}</p> : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                {org.status === 'DRAFT' ? 'Draft' : 'Live'}
              </span>
                  <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                    {org.followerCount} followers
                  </span>
              {org.isVerified ? (
                <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Verified
                </span>
              ) : null}
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
