'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type CommunityFollowItem = {
  province?: string | null
  communitySlug?: string | null
  home?: boolean
  community?: {
    name?: string | null
    cityName?: string | null
    province?: string | null
    slug?: string | null
  } | null
}

type CommunityFollowsResponse = {
  items?: CommunityFollowItem[]
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function toCommunityLabel(item: CommunityFollowItem) {
  const fromApi = item.community?.name ?? item.community?.cityName
  if (fromApi && fromApi.trim()) return fromApi.trim()
  const slug = (item.communitySlug ?? item.community?.slug ?? '').trim()
  if (!slug) return 'Chamber'
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default function MarketCommunitiesPanel() {
  const [communities, setCommunities] = useState<CommunityFollowItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const response = await fetch(buildApiUrl('/communities/follows'), {
          headers: getAuthHeaders(),
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as CommunityFollowsResponse | null
        if (cancelled) return
        if (!response.ok) {
          setCommunities([])
          return
        }
        setCommunities(Array.isArray(payload?.items) ? payload.items.slice(0, 8) : [])
      } catch {
        if (cancelled) return
        setCommunities([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const hasCommunities = useMemo(() => communities.length > 0, [communities.length])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Chambers of Citizens</h3>
        <Link href="/chambers/settings" className="text-xs font-semibold text-slate-600 hover:text-slate-900">
          View all
        </Link>
      </div>

      {loading ? <p className="mt-3 text-xs text-slate-500">Loading…</p> : null}
      {!loading && !hasCommunities ? <p className="mt-3 text-xs text-slate-500">No chambers of citizens followed.</p> : null}

      {!loading && hasCommunities ? (
        <ul className="mt-3 space-y-2">
          {communities.map((community) => {
            const province = String(community.province ?? community.community?.province ?? '').toLowerCase().trim()
            const communitySlug = String(community.communitySlug ?? community.community?.slug ?? '').toLowerCase().trim()
            if (!province || !communitySlug) return null
            return (
              <li key={`${province}:${communitySlug}`}>
                <Link
                  href={`/${encodeURIComponent(province)}/${encodeURIComponent(communitySlug)}`}
                  className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-white"
                >
                  {toCommunityLabel(community)}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
