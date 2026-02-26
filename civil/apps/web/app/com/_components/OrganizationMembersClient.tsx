'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
import { formatUserDisplayName } from '../../_lib/text'

type MemberRow = {
  userId: string
  role: 'OWNER' | 'MANAGER' | 'FOLLOWER'
  joinedAt: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
  }
}

type MembersResponse = {
  members?: MemberRow[]
  followers?: MemberRow[]
}

function roleLabel(role: MemberRow['role']) {
  if (role === 'OWNER') return 'Owner'
  if (role === 'MANAGER') return 'Manager'
  return 'Member'
}

export default function OrganizationMembersClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MemberRow[]>([])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/members`,
          ),
          { cache: 'no-store' },
        )

        if (!res.ok) {
          setError(res.status === 404 ? 'Organization not found.' : 'Unable to load members right now.')
          setItems([])
          return
        }

        const payload = (await res.json().catch(() => null)) as MembersResponse | null
        const members = Array.isArray(payload?.members) ? payload.members : []
        const followers = Array.isArray(payload?.followers) ? payload.followers : []

        const merged = [...members, ...followers]
        const uniqueByUserId = new Map<string, MemberRow>()
        merged.forEach((entry) => {
          if (!uniqueByUserId.has(entry.userId)) {
            uniqueByUserId.set(entry.userId, entry)
          }
        })

        setItems(Array.from(uniqueByUserId.values()))
      } catch (err) {
        console.error('Failed to load organization members', err)
        setError('Unable to load members right now.')
        setItems([])
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [municipality, province, slug])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const order = { OWNER: 0, MANAGER: 1, FOLLOWER: 2 }
      const roleDelta = order[a.role] - order[b.role]
      if (roleDelta !== 0) return roleDelta
      const aName = (formatUserDisplayName(a.user.name, a.user.handle) || a.user.handle).toLowerCase()
      const bName = (formatUserDisplayName(b.user.name, b.user.handle) || b.user.handle).toLowerCase()
      return aName.localeCompare(bName)
    })
  }, [items])

  if (loading) {
    return <p className="text-sm text-slate-500">Loading members…</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  if (!sortedItems.length) {
    return <p className="text-sm text-slate-500">No members yet.</p>
  }

  return (
    <div className="grid gap-4">
      {sortedItems.map((entry) => {
        const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
        return (
        <Link
          key={entry.userId}
          href={`/u/${entry.user.handle}`}
          className="relative block overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm transition hover:brightness-105"
        >
          {entry.user.coverUrl ? (
            <img src={entry.user.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          ) : null}
          <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />

          <div className="relative flex min-h-[96px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <VerifiedAvatar
                src={entry.user.avatarUrl}
                alt={displayName}
                initials={displayName}
                size={64}
              />
              <div className="min-w-0">
                <p className="truncate text-2xl font-semibold text-white">{displayName}</p>
                <p className="mt-1 truncate text-sm text-white/80">@{entry.user.handle}</p>
              </div>
            </div>
            <span className="rounded-full border border-white/40 bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              {roleLabel(entry.role)}
            </span>
          </div>
        </Link>
        )
      })}
    </div>
  )
}
