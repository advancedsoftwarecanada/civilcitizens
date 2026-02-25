"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HiOutlineBell, HiOutlineChatBubbleLeftRight } from 'react-icons/hi2'
import Sidebar from '../../../_components/Sidebar'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'
import VerifiedAvatar from '../../../_components/VerifiedAvatar'
import DashboardShell from '../../../_components/DashboardShell'
import { formatDisplayName } from '../../../_lib/text'

type Friend = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  bio: string | null
  newPosts: number
  homeCommunity: {
    province: string
    community: string
    name: string
  } | null
}

type PageProps = {
  params: {
    handle: string
  }
}

export default function FriendsPage({ params }: PageProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<any>(null)

  const router = useRouter()

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    const load = async () => {
      try {
        // Fetch me to check if I am the owner of this page
        const meRes = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (!meRes.ok) throw new Error('unauthorized')
        const meData = await meRes.json()
        setMe(meData)

        if (meData.handle.toLowerCase() !== params.handle.toLowerCase()) {
          // Redirect to profile if not owner (since friends list is private for now)
          router.replace(`/u/${params.handle}`)
          return
        }

        const res = await fetch(buildApiUrl(`/users/${params.handle}/friends`), {
          headers: { authorization: `Bearer ${token}` },
        })
        
        if (res.status === 403) {
          setError('You are not authorized to view this list.')
          return
        }
        
        if (!res.ok) throw new Error('Failed to load friends')
        
        const data = await res.json()
        setFriends(data.items)
      } catch (err) {
        console.error(err)
        setError('Failed to load friends list.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [params.handle, router])

  if (loading) {
    return (
      <DashboardShell sidebar={<Sidebar active="friends" />} rightRail={<RightRail hideContacts />}>
        <div className="surface-card p-8 text-center text-slate-500">Loading contacts...</div>
      </DashboardShell>
    )
  }

  if (error) {
    return (
      <DashboardShell sidebar={<Sidebar active="friends" />} rightRail={<RightRail hideContacts />}>
        <div className="surface-card p-8 text-center text-red-500">{error}</div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell sidebar={<Sidebar active="friends" />} rightRail={<RightRail hideContacts />}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
            {friends.length}
          </span>
        </div>

        {friends.length === 0 ? (
          <div className="surface-card p-12 text-center">
            <p className="text-slate-500">You haven't added any contacts yet.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {friends.map((friend) => (
              <div key={friend.id} className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm">
                {friend.coverUrl ? (
                  <img src={friend.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                ) : null}
                <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />

                <div className="relative flex min-h-[96px] items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <Link href={`/u/${friend.handle}`}>
                      <VerifiedAvatar
                        src={friend.avatarUrl}
                        alt={friend.name || friend.handle}
                        initials={friend.name || friend.handle}
                        size={64}
                      />
                    </Link>
                    <div className="min-w-0">
                      <Link href={`/u/${friend.handle}`} className="block truncate text-2xl font-semibold text-white hover:underline">
                        {formatDisplayName(friend.name) || friend.handle}
                      </Link>
                      {friend.homeCommunity && (
                        <div className="mt-1 truncate text-sm text-white/80">
                          {friend.homeCommunity.name}, {friend.homeCommunity.province.toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {friend.newPosts > 0 && (
                      <Link
                        href={`/u/${friend.handle}`}
                        className="flex items-center gap-1 rounded-full border border-white/30 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/30"
                      >
                        <HiOutlineBell className="h-4 w-4" />
                        {friend.newPosts} new posts
                      </Link>
                    )}

                    <Link
                      href={`/messages?userId=${friend.id}`}
                      className="flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
                    >
                      <HiOutlineChatBubbleLeftRight className="h-4 w-4" />
                      Message
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
