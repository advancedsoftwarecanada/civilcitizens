export type NotificationActor = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
}

export type NotificationItem = {
  id: string
  type: string
  actorId: string | null
  postId: string | null
  payload: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
  unread: boolean
  actor: NotificationActor | null
}

export type FriendActionState = {
  notificationId: string
  action: 'accept' | 'reject'
}

export function formatRelativeTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = date.getTime() - Date.now()
  const absSeconds = Math.round(Math.abs(diffMs) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absSeconds < 60) return formatter.format(Math.round(diffMs / 1000), 'second')
  const absMinutes = Math.round(absSeconds / 60)
  if (absMinutes < 60) return formatter.format(Math.round(diffMs / 60000), 'minute')
  const absHours = Math.round(absMinutes / 60)
  if (absHours < 24) return formatter.format(Math.round(diffMs / 3600000), 'hour')
  const absDays = Math.round(absHours / 24)
  if (absDays < 30) return formatter.format(Math.round(diffMs / 86400000), 'day')
  const absMonths = Math.round(absDays / 30)
  if (absMonths < 12) return formatter.format(Math.sign(diffMs) * absMonths, 'month')
  const absYears = Math.round(absMonths / 12)
  return formatter.format(Math.sign(diffMs) * absYears, 'year')
}

export function getFriendshipId(notification: NotificationItem) {
  const raw = notification.payload?.friendshipId
  return typeof raw === 'string' ? raw : null
}

export function getActorDisplayName(notification: NotificationItem) {
  if (notification.actor?.name?.trim()) return notification.actor.name
  if (notification.actor?.handle) return `@${notification.actor.handle}`
  return 'Someone'
}

export function getNotificationMessage(notification: NotificationItem) {
  const actorName = getActorDisplayName(notification)
  switch (notification.type) {
    case 'friend_request':
      return `${actorName} sent you a friend request`
    case 'friend_accept':
      return `${actorName} accepted your friend request`
    default:
      return 'New activity update'
  }
}
