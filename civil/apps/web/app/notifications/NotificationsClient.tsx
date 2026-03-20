'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession } from '../_lib/authSession'
import { NotificationCard } from '../_components/notifications/NotificationCard'
import type { FriendActionState, NotificationActionOptions, NotificationItem } from '../_components/notifications/notificationUtils'
import { getFriendshipId, isChatNotificationType } from '../_components/notifications/notificationUtils'
import { emitNotificationsMarkedReadEvent, NOTIFICATIONS_MARKED_READ_EVENT, type NotificationsMarkedReadDetail } from '../_components/notifications/notificationEvents'
import { isNotificationPayload, subscribeToNotificationsStream, type NotificationRealtimeData, type RealtimePayload } from '../_components/notifications/notificationStream'
import { pushToast } from '../_components/useToasts'

const PAGE_SIZE = 30

type NotificationResponse = {
  items?: NotificationItem[]
  nextCursor?: string | null
  unreadCount?: number
}

function getStoredToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('token')
}

export default function NotificationsClient() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [friendActionState, setFriendActionState] = useState<FriendActionState | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const markLocalNotificationsRead = useCallback(() => {
    const timestamp = new Date().toISOString()
    setNotifications((prev) => prev.map((notification) => (notification.unread ? { ...notification, unread: false, readAt: notification.readAt ?? timestamp } : notification)))
  }, [])

  const acknowledgeNotifications = useCallback(async () => {
    const token = getStoredToken()
    if (!token) return
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
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        return
      }
      markLocalNotificationsRead()
      emitNotificationsMarkedReadEvent('notifications-page')
    } catch (err) {
      console.error('Unable to acknowledge notifications', err)
    }
  }, [markLocalNotificationsRead])

  const handleRealtimeNotification = useCallback((payload: RealtimePayload) => {
    if (!isNotificationPayload(payload)) return
    const data: NotificationRealtimeData = payload.data
    if (isChatNotificationType(data.type)) return
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
    setNotifications((prev) => {
      const existing = prev.find((item) => item.id === incoming.id)
      const nextActor = data.actor ?? existing?.actor ?? null
      const merged: NotificationItem = {
        ...incoming,
        actor: nextActor,
      }
      const next = [merged, ...prev.filter((item) => item.id !== incoming.id)]
      return next
    })
  }, [])

  const loadNotifications = useCallback(
    async (cursor?: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      const isLoadMore = Boolean(cursor)
      if (isLoadMore) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
      }
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
        if (cursor) {
          params.set('cursor', cursor)
        }
        const res = await fetch(buildApiUrl(`/notifications?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (res.status === 401) {
          clearAuthSession()
          redirectToAuthModal('login')
          return
        }
        if (!res.ok) {
          setError('Unable to load notifications right now.')
          return
        }
        const data = (await res.json()) as NotificationResponse
        const items = Array.isArray(data.items) ? data.items : []
        const normalized = items
          .map((item) => ({ ...item, actor: item.actor ?? null }))
          .filter((item) => !isChatNotificationType(item.type))
        setNotifications((prev) => (isLoadMore ? [...prev, ...normalized] : normalized))
        setNextCursor(data.nextCursor ?? null)
      } catch (err) {
        console.error('Failed to fetch notifications', err)
        setError('Unable to load notifications right now.')
      } finally {
        if (isLoadMore) {
          setLoadingMore(false)
        } else {
          setLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    void (async () => {
      await loadNotifications()
      await acknowledgeNotifications()
    })()
  }, [loadNotifications, acknowledgeNotifications])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleMarkedRead = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsMarkedReadDetail>).detail
      if (detail?.source === 'notifications-page') return
      markLocalNotificationsRead()
    }
    window.addEventListener(NOTIFICATIONS_MARKED_READ_EVENT, handleMarkedRead as EventListener)
    return () => {
      window.removeEventListener(NOTIFICATIONS_MARKED_READ_EVENT, handleMarkedRead as EventListener)
    }
  }, [markLocalNotificationsRead])

  useEffect(() => {
    const unsubscribe = subscribeToNotificationsStream(handleRealtimeNotification)
    return unsubscribe
  }, [handleRealtimeNotification])

  useEffect(() => {
    if (!nextCursor) return undefined
    const node = loadMoreRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && !loadingMore && nextCursor) {
          void loadNotifications(nextCursor)
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [nextCursor, loadingMore, loadNotifications])

  const handleNotificationRequestAction = useCallback(
    async (notification: NotificationItem, action: 'accept' | 'reject', options?: NotificationActionOptions) => {
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
            pushToast('Request already resolved.', 'info')
            return true
          }
          if (res.status === 404) {
            setNotifications((prev) => prev.filter((item) => item.id !== notification.id))
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
        if (notification.type === 'event_guest_speaker_invite') {
          pushToast(action === 'accept' ? 'Guest speaker invite accepted.' : 'Guest speaker invite declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'event_sponsor_invite') {
          pushToast(action === 'accept' ? 'Sponsor invite accepted.' : 'Sponsor invite declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'delivery_contract_bid') {
          pushToast(action === 'accept' ? 'Delivery bid accepted.' : 'Delivery bid declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'profile_family_invite') {
          pushToast(action === 'accept' ? 'Family relationship accepted.' : 'Family relationship declined.', action === 'accept' ? 'success' : 'info')
        } else if (notification.type === 'family_child_friend_request') {
          pushToast(action === 'accept' ? 'Family friend request accepted.' : 'Family friend request dismissed.', action === 'accept' ? 'success' : 'info')
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

  const hasNotifications = notifications.length > 0

  return (
    <DashboardShell rightRail={<RightRail />} mainClassName="space-y-6">
      <section className="rounded-[32px] border border-white/60 bg-white/80 p-6 shadow-[0_35px_120px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Inbox</p>
            <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Notifications</h1>
            <p className="mt-2 text-sm text-slate-500">Stay on top of friend requests and civic activity.</p>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="mt-6 space-y-3">
          {loading && !hasNotifications ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading notifications…</div>
          ) : hasNotifications ? (
            notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onRequestAction={handleNotificationRequestAction}
                friendActionState={friendActionState}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">You&apos;re all caught up.</div>
          )}
        </div>

        {nextCursor ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-sm text-slate-500">
            <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" />
            <button
              type="button"
              className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              onClick={() => loadNotifications(nextCursor)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading more…' : 'Load more notifications'}
            </button>
          </div>
        ) : null}
      </section>
    </DashboardShell>
  )
}
