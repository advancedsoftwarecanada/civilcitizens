'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { HiOutlineBell, HiOutlineMagnifyingGlass, HiOutlineChatBubbleOvalLeft, HiOutlineHashtag } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession } from '../_lib/authSession'
import { getStoredToken } from '../_lib/tokenStorage'
import { NotificationCard } from './notifications/NotificationCard'
import type { FriendActionState, NotificationItem } from './notifications/notificationUtils'
import {
  getFriendshipId,
  getNotificationMessage,
  getActorDisplayName,
} from './notifications/notificationUtils'
import {
  emitNotificationsMarkedReadEvent,
  NOTIFICATION_READ_EVENT,
  NOTIFICATIONS_MARKED_READ_EVENT,
  type NotificationReadDetail,
  type NotificationsMarkedReadDetail,
} from './notifications/notificationEvents'
import { isNotificationPayload, subscribeToNotificationsStream, type NotificationRealtimeData, type RealtimePayload } from './notifications/notificationStream'
import { pushNotificationToast, pushToast } from './useToasts'
import { SearchResults } from './search/SearchResults'
const MAX_VISIBLE_NOTIFICATIONS = 7

const NOTIFICATION_TOAST_DEDUPE_WINDOW_MS = 5000

function shouldShowNotificationToast(notificationId: string): boolean {
  if (typeof window === 'undefined') return true
  const globalKey = '__ccNotificationToastHistory'
  const now = Date.now()
  const history = ((window as any)[globalKey] ?? {}) as Record<string, number>
  const lastShownAt = history[notificationId] ?? 0
  if (now - lastShownAt < NOTIFICATION_TOAST_DEDUPE_WINDOW_MS) {
    ;(window as any)[globalKey] = history
    return false
  }
  history[notificationId] = now
  ;(window as any)[globalKey] = history
  return true
}


export default function TopNav() {
  const pathname = usePathname()
  const showSearch = !pathname?.startsWith('/welcome')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [messageUnreadCount, setMessageUnreadCount] = useState(0)
  const [orgChannelUnreadCount, setOrgChannelUnreadCount] = useState(0)
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

  const applyLocalReadState = useCallback(() => {
    const timestamp = new Date().toISOString()
    setNotifications((prev) => prev.map((notification) => (notification.unread ? { ...notification, unread: false, readAt: notification.readAt ?? timestamp } : notification)))
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
        clearAuthSession()
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

  const fetchMessageUnreadCount = useCallback(async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const res = await fetch(buildApiUrl('/messages/unread-count'), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { count: number }
        setMessageUnreadCount(data.count)
      }
    } catch (err) {
      console.error('Failed to load message unread count', err)
    }
  }, [])

  const fetchOrgChannelUnreadCount = useCallback(async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const res = await fetch(buildApiUrl('/org-channels/unread-count'), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { count: number }
        setOrgChannelUnreadCount(data.count)
      }
    } catch (err) {
      console.error('Failed to load organization channel unread count', err)
    }
  }, [])

  const acknowledgeNotifications = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      return false
    }
    try {
      const res = await fetch(buildApiUrl('/notifications/ack'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ before: new Date().toISOString() }),
      })
      if (res.status === 401) {
        clearAuthSession()
        setNotifications([])
        setUnreadCount(0)
        setDropdownOpen(false)
        redirectToAuthModal('login')
        return false
      }
      if (!res.ok) {
        return false
      }
      setUnreadCount(0)
      applyLocalReadState()
      emitNotificationsMarkedReadEvent('top-nav')
      return true
    } catch (err) {
      console.error('Unable to acknowledge notifications', err)
      return false
    }
  }, [applyLocalReadState])

  const handleRealtimeNotification = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'message.created') {
        if (pathname?.startsWith('/messages')) {
          // If we are on the messages page, we let the page handle the read status
          // But we still update the count just in case, though it might be redundant if the page marks it read immediately
          // Actually, if we are on /messages, we might not want to show a toast or increment unread count if it's the active thread
          // But TopNav doesn't know the active thread.
          // However, the user asked to suppress the notification.
          // We will still fetch the count, but maybe suppress a toast if we were to add one for messages.
          // Currently TopNav doesn't show toasts for messages, only for notifications.
          // But it does update the badge.
        }
        void fetchMessageUnreadCount()
        void fetchOrgChannelUnreadCount()
        return
      }
      if (!isNotificationPayload(payload)) return
      const data: NotificationRealtimeData = payload.data
      const payloadValue = data.payload
      const normalizedPayload =
        payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
          ? (payloadValue as Record<string, unknown>)
          : null
      const incoming = {
        id: data.id,
        type: data.type,
        actorId: data.actorId,
        postId: data.postId,
        payload: normalizedPayload,
        readAt: data.readAt,
        createdAt: data.createdAt,
        unread: data.unread,
      }
      let unreadDelta = 0
      setNotifications((prev) => {
        const existing = prev.find((item) => item.id === incoming.id)
        const nextActor = data.actor ?? existing?.actor ?? null
        const merged: NotificationItem = {
          ...incoming,
          actor: nextActor,
        }
        if (merged.unread && (!existing || !existing.unread)) {
          unreadDelta = 1
          if (shouldShowNotificationToast(merged.id)) {
            pushNotificationToast(merged)
          }
        }
        const next = [merged, ...prev.filter((item) => item.id !== incoming.id)]
        return next.slice(0, MAX_VISIBLE_NOTIFICATIONS)
      })
      if (unreadDelta > 0) {
        setUnreadCount((prev) => prev + unreadDelta)
      }
    },
    [fetchMessageUnreadCount, fetchOrgChannelUnreadCount, pathname],
  )

  useEffect(() => {
    const token = getStoredToken()
    if (!token) return
    void fetchNotifications()
    void fetchMessageUnreadCount()
    void fetchOrgChannelUnreadCount()

    const handleMessageRead = () => {
      void fetchMessageUnreadCount()
      void fetchOrgChannelUnreadCount()
    }
    window.addEventListener('message.read', handleMessageRead)
    return () => {
      window.removeEventListener('message.read', handleMessageRead)
    }
  }, [fetchNotifications, fetchMessageUnreadCount, fetchOrgChannelUnreadCount])

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
    void (async () => {
      await fetchNotifications()
      await acknowledgeNotifications()
    })()
  }, [dropdownOpen, fetchNotifications, acknowledgeNotifications])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleMarkedRead = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsMarkedReadDetail>).detail
      if (detail?.source === 'top-nav') return
      setUnreadCount(0)
      applyLocalReadState()
    }
    window.addEventListener(NOTIFICATIONS_MARKED_READ_EVENT, handleMarkedRead as EventListener)
    return () => {
      window.removeEventListener(NOTIFICATIONS_MARKED_READ_EVENT, handleMarkedRead as EventListener)
    }
  }, [applyLocalReadState])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleNotificationRead = (event: Event) => {
      const detail = (event as CustomEvent<NotificationReadDetail>).detail
      const notificationId = detail?.id
      if (!notificationId) return

      const readAt = new Date().toISOString()
      setNotifications((prev) =>
        prev.map((notification) => {
          if (notification.id !== notificationId || !notification.unread) return notification
          return {
            ...notification,
            unread: false,
            readAt: notification.readAt ?? readAt,
          }
        }),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }

    window.addEventListener(NOTIFICATION_READ_EVENT, handleNotificationRead as EventListener)
    return () => {
      window.removeEventListener(NOTIFICATION_READ_EVENT, handleNotificationRead as EventListener)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeToNotificationsStream(handleRealtimeNotification)
    return unsubscribe
  }, [handleRealtimeNotification])

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
          if (res.status === 409 && payload?.error === 'friendship_not_pending') {
            const timestamp = new Date().toISOString()
            setNotifications((prev) =>
              prev.map((item) => {
                if (item.id !== notification.id) return item
                const nextPayload = {
                  ...((item.payload ?? {}) as Record<string, unknown>),
                  status: action === 'accept' ? 'accepted' : 'rejected',
                }
                return {
                  ...item,
                  unread: false,
                  readAt: item.readAt ?? timestamp,
                  payload: nextPayload,
                }
              }),
            )
            if (notification.unread) {
              setUnreadCount((prev) => Math.max(0, prev - 1))
            }
            pushToast('Friend request already resolved.', 'info')
            return
          }
          if (res.status === 404) {
            setNotifications((prev) => prev.filter((item) => item.id !== notification.id))
            if (notification.unread) {
              setUnreadCount((prev) => Math.max(0, prev - 1))
            }
            pushToast('That friend request is no longer available.', 'info')
            return
          }
          pushToast(payload?.error ?? 'Unable to update friend request right now.', 'error')
          return
        }
        const timestamp = new Date().toISOString()
        setNotifications((prev) =>
          prev.map((item) => {
            if (item.id !== notification.id) return item
            const nextPayload = {
              ...((item.payload ?? {}) as Record<string, unknown>),
              status: action === 'accept' ? 'accepted' : 'rejected',
            }
            return {
              ...item,
              unread: false,
              readAt: item.readAt ?? timestamp,
              payload: nextPayload,
            }
          }),
        )
        if (notification.unread) {
          setUnreadCount((prev) => Math.max(0, prev - 1))
        }
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
    <header className="fixed left-0 right-0 top-0 z-30 hidden border-b border-white/50 bg-white/80 backdrop-blur md:block">
      <div className="mx-auto flex w-full max-w-[1800px] items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6 xl:px-10">
        <Link
          href="/home"
          className="inline-flex items-center gap-2 text-slate-800 transition hover:opacity-90"
          aria-label="Civil home"
        >
          <Image src="/favicon.png" alt="Civil" width={32} height={32} className="h-8 w-8 md:hidden" priority />
          <Image src="/logo.svg" alt="Civil" width={112} height={32} className="hidden h-7 w-auto md:block" priority />
        </Link>

        {showSearch ? (
          <div className="flex flex-1 justify-center px-2">
            <div className="relative w-full max-w-2xl rounded-full border border-slate-200 bg-white/90 shadow-sm transition focus-within:border-[var(--cc-primary)] focus-within:bg-white">
              <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <form action="/search" method="GET" autoComplete="off">
                <input
                  type="search"
                  name="q"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
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
        ) : (
          <div className="flex-1" aria-hidden="true" />
        )}

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href="/messages"
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
            aria-label="Messages"
          >
            <HiOutlineChatBubbleOvalLeft className="text-xl" />
            {messageUnreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1.5rem] rounded-full bg-[var(--cc-primary)] px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
                {messageUnreadCount > 9 ? '9+' : messageUnreadCount}
              </span>
            ) : null}
          </Link>
          <Link
            href="/channels"
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
            aria-label="Organization channel activity"
          >
            <HiOutlineHashtag className="text-xl" />
            {orgChannelUnreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1.5rem] rounded-full bg-[var(--cc-primary)] px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
                {orgChannelUnreadCount > 9 ? '9+' : orgChannelUnreadCount}
              </span>
            ) : null}
          </Link>
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
