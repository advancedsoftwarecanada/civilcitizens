"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { buildApiUrl } from '../_lib/api'
import VerifiedAvatar from './VerifiedAvatar'

type RightRailData = {
  friends: Array<{
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    newPosts: number
  }>
  communities: Array<{
    provinceCode: string
    communitySlug: string
    name: string
    newPosts: number
  }>
}

type Status = 'loading' | 'ready' | 'error' | 'unauthorized'

export function RightRail() {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<RightRailData | null>(null)

  const loadData = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setStatus('unauthorized')
      return
    }
    try {
      const res = await fetch(buildApiUrl('/home/right-rail'), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        setStatus('unauthorized')
        return
      }
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      setData(json)
      setStatus('ready')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (status === 'loading') {
    return (
      <div className="sticky top-8 space-y-6">
        <div className="surface-card h-48 animate-pulse p-5" />
        <div className="surface-card h-48 animate-pulse p-5" />
      </div>
    )
  }

  if (status === 'unauthorized') return null

  return (
    <div className="sticky top-8 space-y-6">
      {/* Friends Section */}
      <section className="surface-card p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Your Friends</h2>
        {data?.friends.length ? (
          <ul className="space-y-3">
            {data.friends.map((friend) => (
              <li key={friend.id} className="flex items-center justify-between">
                <Link href={`/u/${friend.handle}`} className="group flex items-center gap-2">
                  <VerifiedAvatar
                    src={friend.avatarUrl}
                    alt={friend.name || friend.handle}
                    initials={friend.name || friend.handle}
                    size={32}
                  />
                  <span className="max-w-[120px] truncate text-sm font-medium text-slate-700 group-hover:text-slate-900">
                    {friend.name || friend.handle}
                  </span>
                </Link>
                {friend.newPosts > 0 && (
                  <span className="text-xs font-semibold text-[var(--cc-primary)]">
                    {friend.newPosts} new
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No friends yet.</p>
        )}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <Link href="/friends" className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            View all friends
          </Link>
        </div>
      </section>

      {/* Communities Section */}
      <section className="surface-card p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Your Communities</h2>
        {data?.communities.length ? (
          <ul className="space-y-3">
            {data.communities.map((comm) => (
              <li key={`${comm.provinceCode}:${comm.communitySlug}`} className="flex items-center justify-between">
                <Link
                  href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                  className="max-w-[160px] truncate text-sm font-medium text-slate-700 hover:text-slate-900"
                >
                  {comm.name}
                </Link>
                {comm.newPosts > 0 && (
                  <span className="text-xs font-semibold text-[var(--cc-primary)]">
                    {comm.newPosts} new
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No communities followed.</p>
        )}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <Link href="/communities/settings" className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            View all communities
          </Link>
        </div>
      </section>
    </div>
  )
}
