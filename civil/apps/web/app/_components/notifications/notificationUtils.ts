import { formatDisplayName } from '../../_lib/text'
export type NotificationActor = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
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

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected'

function normalizeFriendRequestStatus(value: unknown): FriendRequestStatus | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (['accepted', 'accept', 'approved', 'complete', 'completed', 'resolved', 'yes', 'true'].includes(normalized)) {
      return 'accepted'
    }
    if (['rejected', 'reject', 'declined', 'dismissed', 'denied', 'cancelled', 'canceled', 'no', 'false'].includes(normalized)) {
      return 'rejected'
    }
    if (['pending', 'awaiting', 'waiting', 'open'].includes(normalized)) {
      return 'pending'
    }
    return null
  }
  if (typeof value === 'boolean') {
    return value ? 'accepted' : 'rejected'
  }
  return null
}

function extractFriendRequestStatusFromPayload(payload: Record<string, unknown>): FriendRequestStatus | null {
  const candidateValues: unknown[] = []

  const directKeys = ['status', 'friendshipStatus', 'friendship_status', 'friendshipState', 'friendship_state', 'state', 'resolution', 'outcome']
  for (const key of directKeys) {
    if (key in payload) {
      candidateValues.push(payload[key])
    }
  }

  const nestedFriendship = payload.friendship
  if (nestedFriendship && typeof nestedFriendship === 'object' && !Array.isArray(nestedFriendship)) {
    candidateValues.push((nestedFriendship as Record<string, unknown>).status)
  }

  // Prefer definitively resolved statuses first.
  for (const candidate of candidateValues) {
    const normalized = normalizeFriendRequestStatus(candidate)
    if (normalized === 'accepted' || normalized === 'rejected') {
      return normalized
    }
  }

  for (const candidate of candidateValues) {
    const normalized = normalizeFriendRequestStatus(candidate)
    if (normalized) {
      return normalized
    }
  }

  const acceptedAt = payload.acceptedAt ?? payload.respondedAt
  if (typeof acceptedAt === 'string' && acceptedAt.trim()) {
    const resolution = normalizeFriendRequestStatus(payload.resolution ?? payload.outcome)
    return resolution && resolution !== 'pending' ? resolution : 'accepted'
  }

  const rejectedAt = payload.rejectedAt ?? payload.dismissedAt
  if (typeof rejectedAt === 'string' && rejectedAt.trim()) {
    return 'rejected'
  }

  return null
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

const CHAT_NOTIFICATION_TYPES = new Set(['message', 'message_created', 'message.created', 'comment_reply', 'comment_post'])

export function isChatNotificationType(type: string): boolean {
  return CHAT_NOTIFICATION_TYPES.has((type || '').trim().toLowerCase())
}

export function getFriendRequestStatus(notification: NotificationItem): FriendRequestStatus {
  const basePayload = notification.payload
  if (basePayload && typeof basePayload === 'object' && !Array.isArray(basePayload)) {
    const resolved = extractFriendRequestStatusFromPayload(basePayload as Record<string, unknown>)
    if (resolved) {
      return resolved
    }
  }
  return 'pending'
}

export function getNotificationRequestStatus(notification: NotificationItem): FriendRequestStatus {
  return getFriendRequestStatus(notification)
}

export function isActionableNotification(notification: NotificationItem): boolean {
  return notification.type === 'friend_request' || notification.type === 'event_guest_speaker_invite' || notification.type === 'event_sponsor_invite'
}

export function getActorDisplayName(notification: NotificationItem) {
  if (notification.type === 'family_child_media_change') {
    const childDisplayName = typeof notification.payload?.childDisplayName === 'string' ? notification.payload.childDisplayName.trim() : ''
    if (childDisplayName) return childDisplayName
  }
  if (notification.actor?.name?.trim()) return formatDisplayName(notification.actor.name)
  if (notification.actor?.handle) return notification.actor.handle
  return 'Civil citizen'
}

function formatReplySnippet(notification: NotificationItem, maxLength = 50): string | null {
  const raw = notification.payload?.bodyPreview
  if (typeof raw !== 'string') return null
  const normalized = raw.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function getNotificationMessage(notification: NotificationItem) {
  switch (notification.type) {
    case 'friend_request':
      return 'sent you a friend request'
    case 'friend_accept':
      return 'accepted your friend request'
    case 'connection_request':
      return 'sent you a connection request'
    case 'connection_accept':
      return 'accepted your connection request'
    case 'comment_reply': {
      const snippet = formatReplySnippet(notification)
      return snippet ? `replied: "${snippet}"` : 'replied to your comment'
    }
    case 'comment_post': {
      const snippet = formatReplySnippet(notification)
      return snippet ? `commented: "${snippet}"` : 'commented on your post'
    }
    case 'message':
    case 'message_created':
    case 'message.created': {
      const snippet = formatReplySnippet(notification, 65)
      return snippet ? `sent a message: "${snippet}"` : 'sent you a message'
    }
    case 'event_guest_speaker_invite':
      return 'has invited you to be a guest speaker at an event'
    case 'event_sponsor_invite':
      return 'invited your organization to sponsor an event'
    case 'event_guest_speaker_response': {
      const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
      return status === 'accepted' ? 'accepted your guest speaker invite' : status === 'declined' ? 'declined your guest speaker invite' : 'responded to your guest speaker invite'
    }
    case 'event_sponsor_response': {
      const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
      return status === 'accepted' ? 'accepted your sponsor invite' : status === 'declined' ? 'declined your sponsor invite' : 'responded to your sponsor invite'
    }
    case 'poll_results_available': {
      const questionPreview = typeof notification.payload?.questionPreview === 'string' ? notification.payload.questionPreview.trim() : ''
      return questionPreview ? `poll results are ready: "${questionPreview}"` : 'poll results are now available'
    }
    case 'family_child_media_change': {
      const categoryLabel = notification.payload?.category === 'cover' ? 'cover photo' : 'profile photo'
      return `changed their ${categoryLabel}`
    }
    default:
      return 'shared an update'
  }
}

export function getNotificationTargetUrl(notification: NotificationItem): string | null {
  const threadIdCandidates = [
    notification.payload?.threadId,
    notification.payload?.threadID,
    notification.payload?.channelId,
    notification.payload?.conversationId,
  ]

  const candidates = notification.type === 'comment_reply'
    ? [
        notification.payload?.replyUrl,
        notification.payload?.url,
        notification.payload?.sourceUrl,
      ]
    : [
        notification.payload?.sourceUrl,
        notification.payload?.url,
        notification.payload?.replyUrl,
      ]
  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const normalized = raw.trim()
      if (normalized.startsWith('/')) {
        return normalized
      }
    }
  }
  for (const raw of threadIdCandidates) {
    if (typeof raw === 'string') {
      const normalized = raw.trim()
      if (normalized) {
        return `/messages?thread=${encodeURIComponent(normalized)}`
      }
    }
  }
  if (notification.postId) {
    return `/post/${notification.postId}`
  }
  return null
}
