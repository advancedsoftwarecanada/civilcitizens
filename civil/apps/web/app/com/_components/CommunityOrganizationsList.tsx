'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'
import CivilCard from '../../_components/CivilCard'

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
        <CivilCard
          key={org.id}
          href={`/com/${encodeURIComponent(org.provinceCode ?? province)}/${encodeURIComponent(org.communitySlug ?? municipality)}/orgs/${encodeURIComponent(org.slug)}`}
          size="lg"
          name={org.name}
          avatarAlt={org.name}
          avatarInitials={org.name}
          avatarSrc={org.logoUrl}
          coverUrl={org.coverUrl}
          details={org.description ? <p className="line-clamp-2">{org.description}</p> : null}
          isVerified={org.isVerified}
          trailing={
            <div className="flex flex-col items-end gap-1">
              <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                {org.status === 'DRAFT' ? 'Draft' : 'Live'}
              </span>
              <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                {org.followerCount} joined
              </span>
              {org.isVerified ? (
                <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Verified
                </span>
              ) : null}
            </div>
          }
          className="transition hover:border-slate-300"
        />
      ))}
    </div>
  )
}
