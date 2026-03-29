"use client"
import { useCallback } from 'react'
import { NotificationCard } from './notifications/NotificationCard'
import { emitNotificationReadEvent } from './notifications/notificationEvents'
import { getStoredToken } from '../_lib/tokenStorage'
import { buildApiUrl } from '../_lib/api'
import { useToasts } from './useToasts'

export default function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const remove = useToasts((s) => s.remove)

  const markNotificationRead = useCallback(async (notificationId: string) => {
    const token = getStoredToken()
    if (!token) return false
    try {
      const response = await fetch(buildApiUrl('/notifications/ack'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids: [notificationId] }),
      })
      return response.ok
    } catch {
      return false
    }
  }, [])

  const handleToastOpen = useCallback(async (toastId: string, notificationId: string, targetUrl: string) => {
    const wasMarked = await markNotificationRead(notificationId)
    if (wasMarked) {
      emitNotificationReadEvent(notificationId, 'toast')
    }
    remove(toastId)
    window.location.assign(targetUrl)
  }, [markNotificationRead, remove])

  // Simple fade-in/out via Tailwind classes
  return (
    <div className="cc-safe-toast-viewport pointer-events-none fixed z-[60] flex justify-center md:justify-end">
      <div className="flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          t.notification ? (
            <div key={t.id} className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))]">
              <NotificationCard
                notification={t.notification}
                variant="toast"
                onOpen={(notification, targetUrl) => {
                  void handleToastOpen(t.id, notification.id, targetUrl)
                }}
              />
            </div>
          ) : (
            <div
              key={t.id}
              className={
                'pointer-events-auto rounded-md px-4 py-2 shadow-md text-sm text-white ' +
                (t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : t.type === 'warning' ? 'bg-yellow-600' : 'bg-gray-800')
              }
              role="status"
              aria-live="polite"
            >
              {t.message}
            </div>
          )
        ))}
      </div>
    </div>
  )
}
