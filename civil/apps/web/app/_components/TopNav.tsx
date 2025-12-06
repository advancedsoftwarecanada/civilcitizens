'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { HiOutlineBell, HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { NotificationCard } from './notifications/NotificationCard'
import type { FriendActionState, NotificationItem } from './notifications/notificationUtils'
import { getFriendshipId } from './notifications/notificationUtils'
import { pushToast } from './useToasts'
import { SearchResults } from './search/SearchResults'
const MAX_VISIBLE_NOTIFICATIONS = 7


export default function TopNav() {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const searchBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [friendActionState, setFriendActionState] = useState<FriendActionState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const trimmedSearchQuery = searchQuery.trim()
  const showSearchResults = searchFocused && trimmedSearchQuery.length >= 2

  useEffect(() => () => {
    if (searchBlurTimeout.current) clearTimeout(searchBlurTimeout.current)
  }, [])

  const fetchNotifications = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      return false
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl(`/notifications?limit=${MAX_VISIBLE_NOTIFICATIONS}`), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        window.localStorage.removeItem('token')
        setNotifications([])
        setUnreadCount(0)
        setDropdownOpen(false)
        redirectToAuthModal('login')
        return false
      }
      if (!res.ok) {
        setError('Unable to load notifications right now.')
        return false
      }
      const data = (await res.json()) as { items?: NotificationItem[]; unreadCount?: number }
      const items = Array.isArray(data.items) ? data.items : []
      const normalizedItems = items.map((item) => ({
        ...item,
        actor: item.actor ?? null,
      }))
      setNotifications(normalizedItems)
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : normalizedItems.filter((n) => n.unread).length)
      return true
    } catch (err) {
      console.error('Failed to load notifications', err)
      setError('Unable to load notifications right now.')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) return
    void fetchNotifications()
  }, [fetchNotifications])

  useEffect(() => {
    if (!dropdownOpen) return undefined
    const handleClick = (event: MouseEvent) => {
      if (!dropdownRef.current) return
      if (!dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [dropdownOpen])

  const handleToggleDropdown = useCallback(() => {
    if (dropdownOpen) {
      setDropdownOpen(false)
      return
    }
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setDropdownOpen(true)
    void fetchNotifications()
  }, [dropdownOpen, fetchNotifications])

  const handleSearchFocus = useCallback(() => {
    if (searchBlurTimeout.current) {
      clearTimeout(searchBlurTimeout.current)
      searchBlurTimeout.current = null
    }
    setSearchFocused(true)
  }, [])

  const handleSearchBlur = useCallback(() => {
    if (searchBlurTimeout.current) clearTimeout(searchBlurTimeout.current)
    searchBlurTimeout.current = setTimeout(() => {
      setSearchFocused(false)
    }, 150)
  }, [])

  const handleFriendRequestAction = useCallback(
    async (notification: NotificationItem, action: 'accept' | 'reject') => {
      const friendshipId = getFriendshipId(notification)
      if (!friendshipId) return
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      setFriendActionState({ notificationId: notification.id, action })
      try {
        const res = await fetch(buildApiUrl(`/friends/requests/${friendshipId}/${action}`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to update friend request right now.', 'error')
          return
        }
        setNotifications((prev) => prev.filter((item) => item.id !== notification.id))
        setUnreadCount((prev) => Math.max(0, prev - (notification.unread ? 1 : 0)))
        pushToast(action === 'accept' ? 'Friend request accepted.' : 'Friend request dismissed.', action === 'accept' ? 'success' : 'info')
      } catch (err) {
        console.error('Failed to respond to friend request', err)
        pushToast('Unable to update friend request right now.', 'error')
      } finally {
        setFriendActionState(null)
      }
    },
    [],
  )

  return (
    <header className="sticky top-0 z-30 border-b border-white/50 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1800px] items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6 xl:px-10">
        <Link
          href="/home"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-2 py-2 text-slate-800 shadow-sm transition hover:border-slate-200"
          aria-label="Civil home"
        >
          <Image src="/favicon.png" alt="Civil" width={32} height={32} className="h-8 w-8 md:hidden" priority />
          <Image src="/logo.svg" alt="Civil" width={112} height={32} className="hidden h-7 w-auto md:block" priority />
        </Link>

        <div className="flex flex-1 justify-center px-2">
          <div className="relative w-full max-w-2xl">
            <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <form action="/search" method="GET">
              <input
                type="search"
                name="q"
                placeholder="Search"
                className="w-full bg-transparent py-2.5 pl-11 pr-4 text-sm text-slate-800 focus:outline-none placeholder:text-slate-500"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
              />
            </form>
            <SearchResults query={searchQuery} open={showSearchResults} />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={handleToggleDropdown}
              className={clsx(
                'relative inline-flex h-11 w-11 items-center justify-center rounded-full border bg-white text-slate-500 shadow-sm transition',
                dropdownOpen
                  ? 'border-[var(--cc-primary)] text-[var(--cc-primary)]'
                  : 'border-slate-200 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
              )}
              aria-label="Notifications"
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
            >
              <HiOutlineBell className="text-xl" />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-[1.5rem] rounded-full bg-[var(--cc-primary)] px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </button>
            {dropdownOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.75rem)] z-30 w-[min(90vw,22rem)] rounded-3xl border border-slate-100 bg-white/95 p-4 text-left shadow-2xl shadow-slate-900/10 backdrop-blur-lg">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Notifications</p>
                <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                  {loading ? (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Loading...</div>
                  ) : error ? (
                    <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
                  ) : notifications.length === 0 ? (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">You&apos;re all caught up.</div>
                  ) : (
                    notifications.map((notification) => (
                      <NotificationCard
                        key={notification.id}
                        notification={notification}
                        onFriendAction={handleFriendRequestAction}
                        friendActionState={friendActionState}
                      />
                    ))
                  )}
                </div>
                <Link
                  href="/notifications"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/60"
                  onClick={() => setDropdownOpen(false)}
                >
                  View all notifications
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
