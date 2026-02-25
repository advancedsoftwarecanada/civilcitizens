'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import VerifiedAvatar from './VerifiedAvatar'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { pushToast } from './useToasts'
import { formatDisplayName } from '../_lib/text'
import Block from './Block'

export type FriendListEntry = {
  id: string
  status: string
  since: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
    isPremium: boolean
    isVerified: boolean
  }
}

type FriendsResponse = {
  items?: FriendListEntry[]
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export default function FriendsRightRail() {
  const [friends, setFriends] = useState<FriendListEntry[]>([])
  const [state, setState] = useState<LoadState>('idle')

  const loadFriends = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setState('loading')
    try {
      const res = await fetch(buildApiUrl('/friends'), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        throw new Error('failed_friends')
      }
      const payload = (await res.json().catch(() => null)) as FriendsResponse | null
      const items = Array.isArray(payload?.items) ? payload.items : []
      setFriends(items)
      setState('ready')
    } catch (err) {
      console.error('Failed to load friends list', err)
      setState('error')
      pushToast('Unable to load your friends right now.', 'error')
    }
  }, [])

  useEffect(() => {
    loadFriends().catch(() => {
      /* noop */
    })
  }, [loadFriends])

  const sortedFriends = useMemo(() => {
    const entries = [...friends]
    entries.sort((a, b) => {
      const nameA = formatDisplayName(a.user.name ?? a.user.handle) || a.user.handle
      const nameB = formatDisplayName(b.user.name ?? b.user.handle) || b.user.handle
      return nameA.localeCompare(nameB)
    })
    return entries
  }, [friends])

  const renderContent = () => {
    if (state === 'loading' || state === 'idle') {
      return (
        <ul className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/60 px-3 py-2">
              <div className="h-10 w-10 rounded-full bg-slate-100" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-1/2 rounded bg-slate-100" />
                <div className="h-2 w-1/3 rounded bg-slate-50" />
              </div>
            </li>
          ))}
        </ul>
      )
    }

    if (state === 'error') {
      return (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          Unable to load your contacts right now.
          <button type="button" className="ml-2 font-semibold underline" onClick={loadFriends}>
            Retry
          </button>
        </div>
      )
    }

    if (sortedFriends.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No friends yet.
          <Link href="/search?type=people" className="ml-1 font-semibold text-[var(--cc-primary)] hover:underline">
            Find new contacts
          </Link>
          .
        </div>
      )
    }

    return (
      <ul className="space-y-3">
        {sortedFriends.map((friend) => {
          const displayName = formatDisplayName(friend.user.name ?? friend.user.handle) || friend.user.handle
          return (
            <li key={friend.id} className="flex items-center justify-between">
              <Link href={`/u/${friend.user.handle}`} className="group flex items-center gap-2">
                <span className="relative h-10 w-14 overflow-hidden rounded-lg bg-slate-100">
                  {friend.user.coverUrl ? (
                    <img src={friend.user.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </span>
                <VerifiedAvatar
                  src={friend.user.avatarUrl}
                  alt={displayName}
                  initials={displayName}
                  size={32}
                  isVerified={friend.user.isVerified}
                  isBusiness={friend.user.isPremium}
                />
                <div className="flex flex-col">
                  <span className="max-w-[120px] truncate text-sm font-medium text-slate-700 group-hover:text-slate-900">
                    {displayName}
                  </span>
                  <span className="max-w-[120px] truncate text-xs text-slate-400">
                    @{friend.user.handle}
                  </span>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="sticky top-8 space-y-6">
      <Block
        title="Contacts"
        action={sortedFriends.length ? { label: String(sortedFriends.length), href: '#' } : undefined}
      >
        {renderContent()}
      </Block>
    </div>
  )
}
