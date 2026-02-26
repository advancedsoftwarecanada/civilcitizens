"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Sidebar from '../../../_components/Sidebar'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'
import DashboardShell from '../../../_components/DashboardShell'
import VerifiedAvatar from '../../../_components/VerifiedAvatar'
import { formatDisplayName } from '../../../_lib/text'

type UserListItem = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  bio?: string | null
  since?: string
}

type CommunityListItem = {
  id: string
  provinceCode: string
  communitySlug: string
  name: string
  home?: boolean
  since?: string
}

type OrganizationListItem = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  logoUrl: string | null
  coverUrl: string | null
}

type RelationshipKind = 'friends' | 'followers' | 'following' | 'connections' | 'communities' | 'organizations'

type Props = {
  handle: string
  kind: RelationshipKind
  title: string
}

function itemCountText(count: number, title: string) {
  return `${count.toLocaleString()} ${title}`
}

export default function UserRelationshipListPage({ handle, kind, title }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<any>(null)
  const [items, setItems] = useState<Array<UserListItem | CommunityListItem | OrganizationListItem>>([])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
        if (token) {
          const meRes = await fetch(buildApiUrl('/auth/me'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          })
          if (meRes.ok) {
            const meJson = await meRes.json()
            setMe(meJson)
          }
        }

        const endpoint = `/users/${encodeURIComponent(handle)}/${kind}`
        const res = await fetch(buildApiUrl(endpoint), { cache: 'no-store' })
        if (!res.ok) {
          setError(res.status === 404 ? 'User not found.' : 'Unable to load this list right now.')
          setItems([])
          return
        }

        const json = (await res.json().catch(() => null)) as { items?: unknown[] } | null
        setItems(Array.isArray(json?.items) ? (json?.items as Array<UserListItem | CommunityListItem | OrganizationListItem>) : [])
      } catch (err) {
        console.error('Unable to load profile relationship list', err)
        setError('Unable to load this list right now.')
        setItems([])
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [handle, kind])

  const emptyText = useMemo(() => {
    if (kind === 'connections') return 'No business connections yet.'
    if (kind === 'communities') return 'No communities yet.'
    if (kind === 'organizations') return 'No organizations yet.'
    return `No ${kind} yet.`
  }, [kind])

  return (
    <DashboardShell sidebar={<Sidebar me={me ?? undefined} />} rightRail={<RightRail hideContacts />}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">{itemCountText(items.length, title)}</span>
        </div>

        {loading ? <div className="surface-card p-8 text-center text-slate-500">Loading…</div> : null}
        {!loading && error ? <div className="surface-card p-8 text-center text-red-500">{error}</div> : null}

        {!loading && !error && items.length === 0 ? (
          <div className="surface-card p-12 text-center">
            <p className="text-slate-500">{emptyText}</p>
          </div>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <div className="grid gap-4">
            {items.map((entry) => {
              if ('handle' in entry) {
                const displayName = formatDisplayName(entry.name) || formatDisplayName(entry.handle) || entry.handle
                return (
                  <div key={`user-${entry.id}`} className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm">
                    {entry.coverUrl ? <img src={entry.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />

                    <div className="relative flex min-h-[96px] items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-4">
                        <Link href={`/u/${entry.handle}`}>
                          <VerifiedAvatar src={entry.avatarUrl} alt={displayName} initials={displayName} size={64} />
                        </Link>
                        <div className="min-w-0">
                          <Link href={`/u/${entry.handle}`} className="block truncate text-2xl font-semibold text-white hover:underline">
                            {displayName}
                          </Link>
                          <div className="mt-1 truncate text-sm text-white/80">@{entry.handle}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              if ('logoUrl' in entry) {
                const organizationHref =
                  entry.provinceCode && entry.communitySlug
                    ? `/com/${encodeURIComponent(entry.provinceCode)}/${encodeURIComponent(entry.communitySlug)}/orgs/${encodeURIComponent(entry.slug)}`
                    : '/organizations'

                return (
                  <Link key={`org-${entry.id}`} href={organizationHref} className="relative block overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm transition hover:brightness-105">
                    {entry.coverUrl ? <img src={entry.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                    <div className="relative flex min-h-[96px] items-center gap-4">
                      <VerifiedAvatar src={entry.logoUrl} alt={entry.name} initials={entry.name} size={64} />
                      <div className="min-w-0">
                        <p className="truncate text-2xl font-semibold text-white">{entry.name}</p>
                        <p className="mt-1 truncate text-sm text-white/80">Organization</p>
                      </div>
                    </div>
                  </Link>
                )
              }

              return (
                <Link
                  key={`community-${entry.id}`}
                  href={`/${encodeURIComponent(entry.provinceCode.toLowerCase())}/${encodeURIComponent(entry.communitySlug.toLowerCase())}`}
                  className="relative block overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm transition hover:brightness-105"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-700 via-slate-800 to-slate-900" aria-hidden="true" />
                  <span className="absolute inset-0 bg-slate-900/35" aria-hidden="true" />
                  <div className="relative flex min-h-[96px] items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/40 bg-white/10 text-sm font-semibold uppercase text-white">
                      {entry.provinceCode}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-2xl font-semibold text-white">{entry.name}</p>
                      <p className="mt-1 truncate text-sm text-white/80">{entry.provinceCode.toUpperCase()} · {entry.communitySlug}</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
