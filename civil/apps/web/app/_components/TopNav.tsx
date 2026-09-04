'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import {
  HiOutlineBell,
  HiOutlineChatBubbleOvalLeft,
} from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession } from '../_lib/authSession'
import { getStoredToken } from '../_lib/tokenStorage'
import { useViewerStore } from '../_lib/viewerStore'
import { NotificationCard } from './notifications/NotificationCard'
import type { FriendActionState, NotificationItem } from './notifications/notificationUtils'
import {
  getFriendshipId,
  isChatNotificationType,
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
  const viewer = useViewerStore((s) => s.me)
  const familyView = useViewerStore((s) => s.familyView)
  const isFamilyLockedSession = Boolean(familyView) || viewer?.accountType === 'family_member'
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [messageUnreadCount, setMessageUnreadCount] = useState(0)
  const [marketChatUnreadCount, setMarketChatUnreadCount] = useState(0)
  const [orgChannelUnreadCount, setOrgChannelUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const [friendActionState, setFriendActionState] = useState<FriendActionState | null>(null)
  const unifiedMessageUnreadCount = Math.max(messageUnreadCount, orgChannelUnreadCount) + marketChatUnreadCount

  const applyLocalReadState = useCallback(() => {
    const timestamp = new Date().toISOString()
    setNotifications((prev) => prev.map((notification) => (notification.unread ? { ...notification, unread: false, readAt: notification.readAt ?? timestamp } : notification)))
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (isFamilyLockedSession) {
      setNotifications([])
      setUnreadCount(0)
      return false
    }
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
      const visibleItems = normalizedItems.filter((item) => !isChatNotificationType(item.type))
      setNotifications(visibleItems)
      setUnreadCount(visibleItems.filter((n) => n.unread).length)
      return true
    } catch (err) {
      console.error('Failed to load notifications', err)
      setError('Unable to load notifications right now.')
      return false
    } finally {
      setLoading(false)
    }
  }, [isFamilyLockedSession])

  const fetchMessageUnreadCount = useCallback(async () => {
    if (isFamilyLockedSession) {
      setMessageUnreadCount(0)
      return
    }
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
  }, [isFamilyLockedSession])

  const fetchMarketChatUnreadCount = useCallback(async () => {
    if (isFamilyLockedSession) {
      setMarketChatUnreadCount(0)
      return
    }
    const token = getStoredToken()
    if (!token) return
    try {
      const res = await fetch(buildApiUrl('/market/chats/unread-count'), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { count: number }
        setMarketChatUnreadCount(data.count)
      }
    } catch (err) {
      console.error('Failed to load marketplace chat unread count', err)
    }
  }, [isFamilyLockedSession])

  const fetchOrgChannelUnreadCount = useCallback(async () => {
    if (isFamilyLockedSession) {
      setOrgChannelUnreadCount(0)
      return
    }
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
  }, [isFamilyLockedSession])

  const acknowledgeNotifications = useCallback(async () => {
    if (isFamilyLockedSession) {
      setUnreadCount(0)
      return false
    }
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
  }, [applyLocalReadState, isFamilyLockedSession])

  const handleRealtimeNotification = useCallback(
    (payload: RealtimePayload) => {
      if (isFamilyLockedSession) return
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
        void fetchMarketChatUnreadCount()
        void fetchOrgChannelUnreadCount()
        return
      }
      if (!isNotificationPayload(payload)) return
      const data: NotificationRealtimeData = payload.data
      if (isChatNotificationType(data.type)) {
        return
      }
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
    [fetchMarketChatUnreadCount, fetchMessageUnreadCount, fetchOrgChannelUnreadCount, isFamilyLockedSession, pathname],
  )

  useEffect(() => {
    if (isFamilyLockedSession) {
      setNotifications([])
      setUnreadCount(0)
      setMessageUnreadCount(0)
      setMarketChatUnreadCount(0)
      setOrgChannelUnreadCount(0)
      return
    }
    const token = getStoredToken()
    if (!token) return
    void fetchNotifications()
    void fetchMessageUnreadCount()
    void fetchMarketChatUnreadCount()
    void fetchOrgChannelUnreadCount()

    const handleMessageRead = () => {
      void fetchMessageUnreadCount()
      void fetchMarketChatUnreadCount()
      void fetchOrgChannelUnreadCount()
    }
    window.addEventListener('message.read', handleMessageRead)
    return () => {
      window.removeEventListener('message.read', handleMessageRead)
    }
  }, [fetchNotifications, fetchMessageUnreadCount, fetchMarketChatUnreadCount, fetchOrgChannelUnreadCount, isFamilyLockedSession])

  useEffect(() => {
    if (!dropdownOpen) return undefined
    const handleClick = (event: MouseEvent) => {
      if (!dropdownRef.current) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-cc-modal-root]')) {
        return
      }
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
    if (isFamilyLockedSession) {
      pushToast('Notifications are unavailable while this device is locked to a family account.', 'info')
      return
    }
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
  }, [acknowledgeNotifications, dropdownOpen, fetchNotifications, isFamilyLockedSession])

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
    if (isFamilyLockedSession) return undefined
    const unsubscribe = subscribeToNotificationsStream(handleRealtimeNotification)
    return unsubscribe
  }, [handleRealtimeNotification, isFamilyLockedSession])

  const handleNotificationRequestAction = useCallback(
    async (notification: NotificationItem, action: 'accept' | 'reject', options?: { reciprocalRelationship?: string }) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }
      setFriendActionState({ notificationId: notification.id, action })
      try {
        const isFriend = notification.type === 'friend_request'
        const friendshipId = isFriend ? getFriendshipId(notification) : null
        if (isFriend && !friendshipId) return false

        const res = await fetch(
          isFriend
            ? buildApiUrl(`/friends/requests/${friendshipId}/${action}`)
            : buildApiUrl(`/notifications/${encodeURIComponent(notification.id)}/respond`),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              ...(!isFriend ? { 'content-type': 'application/json' } : {}),
            },
            body: !isFriend ? JSON.stringify({ action, reciprocalRelationship: options?.reciprocalRelationship }) : undefined,
          },
        )
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          if (res.status === 409 && (payload?.error === 'friendship_not_pending' || payload?.error === 'invitation_not_pending')) {
            const timestamp = new Date().toISOString()
            setNotifications((prev) =>
              prev.map((item) => {
                if (item.id !== notification.id) return item
                const nextPayload = {
                  ...((item.payload ?? {}) as Record<string, unknown>),
                  status: action === 'accept' ? 'accepted' : 'rejected',
                  reciprocalCompleted: notification.type === 'profile_family_invite' ? Boolean(options?.reciprocalRelationship) : item.payload?.reciprocalCompleted,
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
            pushToast('Request already resolved.', 'info')
            return true
          }
          if (res.status === 404) {
            setNotifications((prev) => prev.filter((item) => item.id !== notification.id))
            if (notification.unread) {
              setUnreadCount((prev) => Math.max(0, prev - 1))
            }
            pushToast('That request is no longer available.', 'info')
            return true
          }
          pushToast(payload?.error ?? 'Unable to update request right now.', 'error')
          return false
        }
        const timestamp = new Date().toISOString()
        setNotifications((prev) =>
          prev.map((item) => {
            if (item.id !== notification.id) return item
            const nextPayload = {
              ...((item.payload ?? {}) as Record<string, unknown>),
              status:
                notification.type === 'drive_ride_complete_confirmation'
                  ? action === 'accept'
                    ? 'confirmed'
                    : 'reported_issue'
                  : action === 'accept'
                    ? 'accepted'
                    : 'rejected',
                  reciprocalCompleted: notification.type === 'profile_family_invite' ? Boolean(options?.reciprocalRelationship) : item.payload?.reciprocalCompleted,
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
        if (notification.type === 'event_guest_speaker_invite') {
          pushToast(action === 'accept' ? 'Guest speaker invite accepted.' : 'Guest speaker invite declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'event_sponsor_invite') {
          pushToast(action === 'accept' ? 'Sponsor invite accepted.' : 'Sponsor invite declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'delivery_contract_bid') {
          pushToast(action === 'accept' ? 'Delivery bid accepted.' : 'Delivery bid declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'drive_ride_complete_confirmation') {
          pushToast(action === 'accept' ? 'Ride completion confirmed.' : 'Ride issue reported to support.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'connection_request') {
          pushToast(action === 'accept' ? 'Connection request accepted.' : 'Connection request declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'profile_family_invite') {
          pushToast(action === 'accept' ? 'Family relationship accepted.' : 'Family relationship declined.', action === 'accept' ? 'success' : 'info')
        } else {
          pushToast(action === 'accept' ? 'Friend request accepted.' : 'Friend request dismissed.', action === 'accept' ? 'success' : 'info')
        }
        return true
      } catch (err) {
        console.error('Failed to respond to request', err)
        pushToast('Unable to update request right now.', 'error')
        return false
      } finally {
        setFriendActionState(null)
      }
    },
    [],
  )

  return (
    <header className="fixed left-0 right-0 top-0 z-30 hidden border-b border-white/50 bg-white/80 pt-[var(--cc-native-safe-top-offset)] backdrop-blur md:block">
      <div className="mx-auto flex w-full max-w-[1800px] items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6 xl:px-10">
        <Link
          href="/home"
          className="inline-flex items-center gap-2 text-slate-800 transition hover:opacity-90"
          aria-label="MapleRides home"
        >
          <Image src="/Maple-Rides.png" alt="MapleRides" width={164} height={52} className="h-10 w-auto lg:h-11" priority />
        </Link>

        <div className="flex-1" aria-hidden="true" />

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href="/messages"
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
            aria-label="Messages"
          >
            <HiOutlineChatBubbleOvalLeft className="text-xl" />
            {unifiedMessageUnreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1.5rem] rounded-full bg-[var(--cc-primary)] px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
                {unifiedMessageUnreadCount > 9 ? '9+' : unifiedMessageUnreadCount}
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
                        onRequestAction={handleNotificationRequestAction}
                        friendActionState={friendActionState}
                      />
                    ))
                  )}
                </div>
                <Link
                  href="/notifications"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/60"
                  onClick={() => {
                    setDropdownOpen(false)
                  }}
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
