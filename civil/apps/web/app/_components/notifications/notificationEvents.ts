export const NOTIFICATIONS_MARKED_READ_EVENT = 'civil:notifications-marked-read'

export type NotificationsMarkedReadDetail = {
  source?: string
}

export function emitNotificationsMarkedReadEvent(source?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NotificationsMarkedReadDetail>(NOTIFICATIONS_MARKED_READ_EVENT, { detail: { source } }))
}
