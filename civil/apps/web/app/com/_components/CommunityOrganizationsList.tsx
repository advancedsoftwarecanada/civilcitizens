'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildApiUrl } from '../../_lib/api'
import type { MeResponse } from '../../_lib/me'

type CommunityOrganization = {
  id: string
  ownerId: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
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
  const [me, setMe] = useState<MeResponse | null>(null)
  const [orgs, setOrgs] = useState<CommunityOrganization[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const endpoint = useMemo(() => {
    const qs = new URLSearchParams({ limit: '50' })
    return buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs?${qs.toString()}`)
  }, [municipality, province])

  const load = useCallback(async () => {
    if (!token) {
      setStatus('unauthorized')
      return
    }

    setStatus('loading')
    try {
      const [meRes, orgRes] = await Promise.all([
        fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }),
      ])

      if (meRes.status === 401 || orgRes.status === 401) {
        setStatus('unauthorized')
        return
      }

      if (!meRes.ok || !orgRes.ok) {
        setStatus('error')
        return
      }

      const meJson = (await meRes.json()) as MeResponse
      const orgJson = (await orgRes.json().catch(() => null)) as ListResponse | null
      const items = Array.isArray(orgJson?.items) ? orgJson.items : []

      setMe(meJson)
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

  if (status === 'unauthorized') {
    return <p className="text-sm text-slate-600">Sign in to see your organizations.</p>
  }

  if (status === 'error') {
    return <p className="text-sm text-slate-600">Unable to load organizations right now.</p>
  }

  const viewerId = me?.id
  const owned = viewerId ? orgs.filter((org) => org.ownerId === viewerId) : []

  if (!owned.length) {
    return <p className="text-sm text-slate-600">You have no organizations in this community yet.</p>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {owned.map((org) => (
        <Link
          key={org.id}
          href={`/com/${encodeURIComponent(org.provinceCode ?? province)}/${encodeURIComponent(org.communitySlug ?? municipality)}/orgs/${encodeURIComponent(org.slug)}`}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{org.name}</p>
              {org.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{org.description}</p> : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {org.status === 'DRAFT' ? 'Draft' : 'Live'}
              </span>
              {org.isVerified ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
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
