'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type ManagedOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
}

type OrganizationsResponse = {
  items?: Array<{
    id?: string
    name?: string
    slug?: string
    provinceCode?: string | null
    communitySlug?: string | null
    role?: string | null
  }>
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

export default function ManagedOrganizationsPanel() {
  const [items, setItems] = useState<ManagedOrganization[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const headers = getAuthHeaders()
        const [ownedRes, membershipsRes] = await Promise.all([
          fetch(buildApiUrl('/organizations/owned'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/organizations/memberships'), { headers, cache: 'no-store' }),
        ])

        const ownedPayload = (await ownedRes.json().catch(() => null)) as OrganizationsResponse | null
        const membershipsPayload = (await membershipsRes.json().catch(() => null)) as OrganizationsResponse | null
        if (cancelled) return

        const next = new Map<string, ManagedOrganization>()

        const ownedItems = Array.isArray(ownedPayload?.items) ? ownedPayload.items : []
        for (const item of ownedItems) {
          if (!item?.id || !item?.name || !item?.slug) continue
          next.set(item.id, {
            id: item.id,
            name: item.name,
            slug: item.slug,
            provinceCode: item.provinceCode ?? null,
            communitySlug: item.communitySlug ?? null,
          })
        }

        const membershipItems = Array.isArray(membershipsPayload?.items) ? membershipsPayload.items : []
        for (const item of membershipItems) {
          if (!item?.id || !item?.name || !item?.slug) continue
          const role = String(item.role ?? '').toUpperCase()
          if (role !== 'OWNER' && role !== 'MANAGER') continue
          if (next.has(item.id)) continue
          next.set(item.id, {
            id: item.id,
            name: item.name,
            slug: item.slug,
            provinceCode: item.provinceCode ?? null,
            communitySlug: item.communitySlug ?? null,
          })
        }

        setItems(Array.from(next.values()).slice(0, 8))
      } catch {
        if (cancelled) return
        setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const hasItems = useMemo(() => items.length > 0, [items.length])

  if (!loading && !hasItems) return null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Organizations You Manage</h3>
      </div>

      {loading ? <p className="mt-3 text-xs text-slate-500">Loading…</p> : null}

      {!loading && hasItems ? (
        <ul className="mt-3 space-y-2">
          {items.map((org) => {
            const province = String(org.provinceCode ?? '').trim().toLowerCase()
            const municipality = String(org.communitySlug ?? '').trim().toLowerCase()
            if (!province || !municipality) return null

            const href = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(org.slug)}/shop/new`

            return (
              <li key={org.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{org.name}</span>
                <Link href={href} className="shrink-0 text-xs font-semibold text-[var(--cc-primary)] hover:underline">
                  Create
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
