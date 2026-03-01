export const NOTIFICATIONS_MARKED_READ_EVENT = 'civil:notifications-marked-read'
export const NOTIFICATION_READ_EVENT = 'civil:notification-read'

export type NotificationsMarkedReadDetail = {
  source?: string
}

export type NotificationReadDetail = {
  id: string
  source?: string
}

export function emitNotificationsMarkedReadEvent(source?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NotificationsMarkedReadDetail>(NOTIFICATIONS_MARKED_READ_EVENT, { detail: { source } }))
}

export function emitNotificationReadEvent(id: string, source?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NotificationReadDetail>(NOTIFICATION_READ_EVENT, { detail: { id, source } }))
}
