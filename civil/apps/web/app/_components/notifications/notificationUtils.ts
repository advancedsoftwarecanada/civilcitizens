import { formatDisplayName } from '../../_lib/text'

export type ProfileFamilyRelationshipValue =
  | 'husband'
  | 'wife'
  | 'spouse'
  | 'partner'
  | 'common_law_partner'
  | 'fiance'
  | 'ex_husband'
  | 'ex_wife'
  | 'widowed_spouse'
  | 'mother'
  | 'father'
  | 'parent'
  | 'stepfather'
  | 'stepmother'
  | 'adoptive_father'
  | 'adoptive_mother'
  | 'foster_parent'
  | 'son'
  | 'daughter'
  | 'child'
  | 'stepson'
  | 'stepdaughter'
  | 'adopted_son'
  | 'adopted_daughter'
  | 'foster_child'
  | 'grandmother'
  | 'grandfather'
  | 'grandparent'
  | 'grandson'
  | 'granddaughter'
  | 'grandchild'
  | 'sister'
  | 'brother'
  | 'sibling'
  | 'half_brother'
  | 'half_sister'
  | 'step_brother'
  | 'step_sister'
  | 'aunt'
  | 'uncle'
  | 'cousin'
  | 'second_cousin'
  | 'niece'
  | 'nephew'
  | 'great_uncle'
  | 'great_aunt'
  | 'mother_in_law'
  | 'father_in_law'
  | 'sister_in_law'
  | 'brother_in_law'
  | 'daughter_in_law'
  | 'son_in_law'
  | 'other'

const PROFILE_FAMILY_RELATIONSHIP_LABELS: Record<ProfileFamilyRelationshipValue, string> = {
  husband: 'Husband',
  wife: 'Wife',
  spouse: 'Spouse',
  partner: 'Partner',
  common_law_partner: 'Common Law Partner',
  fiance: 'Fiance / Fiancee',
  ex_husband: 'Ex Husband',
  ex_wife: 'Ex Wife',
  widowed_spouse: 'Widowed Spouse',
  mother: 'Mother',
  father: 'Father',
  parent: 'Parent',
  stepfather: 'Stepfather',
  stepmother: 'Stepmother',
  adoptive_father: 'Adoptive Father',
  adoptive_mother: 'Adoptive Mother',
  foster_parent: 'Foster Parent',
  son: 'Son',
  daughter: 'Daughter',
  child: 'Child',
  stepson: 'Stepson',
  stepdaughter: 'Stepdaughter',
  adopted_son: 'Adopted Son',
  adopted_daughter: 'Adopted Daughter',
  foster_child: 'Foster Child',
  grandmother: 'Grandmother',
  grandfather: 'Grandfather',
  grandparent: 'Grandparent',
  grandson: 'Grandson',
  granddaughter: 'Granddaughter',
  grandchild: 'Grandchild',
  sister: 'Sister',
  brother: 'Brother',
  sibling: 'Sibling',
  half_brother: 'Half Brother',
  half_sister: 'Half Sister',
  step_brother: 'Step Brother',
  step_sister: 'Step Sister',
  aunt: 'Aunt',
  uncle: 'Uncle',
  cousin: 'Cousin',
  second_cousin: 'Second Cousin',
  niece: 'Niece',
  nephew: 'Nephew',
  great_uncle: 'Great Uncle',
  great_aunt: 'Great Aunt',
  mother_in_law: 'Mother-in-law',
  father_in_law: 'Father-in-law',
  sister_in_law: 'Sister-in-law',
  brother_in_law: 'Brother-in-law',
  daughter_in_law: 'Daughter-in-law',
  son_in_law: 'Son-in-law',
  other: 'Other',
}

const PROFILE_FAMILY_RECIPROCAL_OPTIONS_BY_RELATION: Partial<Record<ProfileFamilyRelationshipValue, ProfileFamilyRelationshipValue[]>> = {
  husband: ['wife', 'husband', 'spouse', 'partner', 'common_law_partner'],
  wife: ['husband', 'wife', 'spouse', 'partner', 'common_law_partner'],
  spouse: ['spouse', 'husband', 'wife', 'partner', 'common_law_partner'],
  partner: ['partner', 'spouse', 'husband', 'wife', 'common_law_partner'],
  common_law_partner: ['common_law_partner', 'partner', 'spouse', 'husband', 'wife'],
  fiance: ['fiance', 'partner', 'spouse'],
  ex_husband: ['ex_wife', 'ex_husband'],
  ex_wife: ['ex_husband', 'ex_wife'],
  widowed_spouse: ['widowed_spouse'],
  mother: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'adopted_son', 'adopted_daughter', 'foster_child'],
  father: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'adopted_son', 'adopted_daughter', 'foster_child'],
  parent: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'adopted_son', 'adopted_daughter', 'foster_child'],
  stepfather: ['stepson', 'stepdaughter'],
  stepmother: ['stepson', 'stepdaughter'],
  adoptive_father: ['adopted_son', 'adopted_daughter'],
  adoptive_mother: ['adopted_son', 'adopted_daughter'],
  foster_parent: ['foster_child'],
  son: ['parent', 'mother', 'father', 'stepmother', 'stepfather', 'adoptive_mother', 'adoptive_father', 'foster_parent'],
  daughter: ['parent', 'mother', 'father', 'stepmother', 'stepfather', 'adoptive_mother', 'adoptive_father', 'foster_parent'],
  child: ['parent', 'mother', 'father', 'stepmother', 'stepfather', 'adoptive_mother', 'adoptive_father', 'foster_parent'],
  stepson: ['stepmother', 'stepfather'],
  stepdaughter: ['stepmother', 'stepfather'],
  adopted_son: ['adoptive_mother', 'adoptive_father'],
  adopted_daughter: ['adoptive_mother', 'adoptive_father'],
  foster_child: ['foster_parent'],
  grandmother: ['grandchild', 'grandson', 'granddaughter'],
  grandfather: ['grandchild', 'grandson', 'granddaughter'],
  grandparent: ['grandchild', 'grandson', 'granddaughter'],
  grandson: ['grandparent', 'grandmother', 'grandfather'],
  granddaughter: ['grandparent', 'grandmother', 'grandfather'],
  grandchild: ['grandparent', 'grandmother', 'grandfather'],
  sister: ['sibling', 'sister', 'brother', 'half_sister', 'half_brother', 'step_sister', 'step_brother'],
  brother: ['sibling', 'brother', 'sister', 'half_brother', 'half_sister', 'step_brother', 'step_sister'],
  sibling: ['sibling', 'brother', 'sister', 'half_brother', 'half_sister', 'step_brother', 'step_sister'],
  half_brother: ['half_brother', 'half_sister', 'brother', 'sister', 'sibling'],
  half_sister: ['half_sister', 'half_brother', 'sister', 'brother', 'sibling'],
  step_brother: ['step_brother', 'step_sister', 'brother', 'sister', 'sibling'],
  step_sister: ['step_sister', 'step_brother', 'sister', 'brother', 'sibling'],
  aunt: ['niece', 'nephew'],
  uncle: ['nephew', 'niece'],
  great_aunt: ['niece', 'nephew'],
  great_uncle: ['nephew', 'niece'],
  niece: ['aunt', 'uncle'],
  nephew: ['uncle', 'aunt'],
  mother_in_law: ['daughter_in_law', 'son_in_law'],
  father_in_law: ['son_in_law', 'daughter_in_law'],
  sister_in_law: ['sister_in_law', 'brother_in_law'],
  brother_in_law: ['brother_in_law', 'sister_in_law'],
  daughter_in_law: ['mother_in_law', 'father_in_law'],
  son_in_law: ['father_in_law', 'mother_in_law'],
  cousin: ['cousin'],
  second_cousin: ['second_cousin'],
  other: ['other'],
}
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

export type NotificationActionOptions = {
  reciprocalRelationship?: ProfileFamilyRelationshipValue
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected'

function normalizeFriendRequestStatus(value: unknown): FriendRequestStatus | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (['accepted', 'accept', 'approved', 'complete', 'completed', 'resolved', 'confirmed', 'auto_completed', 'yes', 'true'].includes(normalized)) {
      return 'accepted'
    }
    if (['rejected', 'reject', 'declined', 'dismissed', 'denied', 'cancelled', 'canceled', 'reported_issue', 'no', 'false'].includes(normalized)) {
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
  return (
    notification.type === 'friend_request' ||
    notification.type === 'profile_family_invite' ||
    notification.type === 'family_child_friend_request' ||
    notification.type === 'delivery_contract_bid' ||
    notification.type === 'drive_ride_complete_confirmation' ||
    notification.type === 'event_guest_speaker_invite' ||
    notification.type === 'event_sponsor_invite'
  )
}

export function getActorDisplayName(notification: NotificationItem) {
  if (
    notification.type === 'family_child_media_change' ||
    notification.type === 'family_child_username_change' ||
    notification.type === 'family_child_friend_removed' ||
    notification.type === 'family_child_blocked_user'
  ) {
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
  const inviteTitle = typeof notification.payload?.title === 'string' ? notification.payload.title.trim() : ''
  const deliveryListingTitle = typeof notification.payload?.listingTitle === 'string' ? notification.payload.listingTitle.trim() : ''
  const deliveryAmountCents = typeof notification.payload?.amountCents === 'number' ? notification.payload.amountCents : null
  const deliveryAmountLabel =
    typeof deliveryAmountCents === 'number'
      ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(deliveryAmountCents / 100)
      : null
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
    case 'profile_event_invite':
      return inviteTitle ? `invited you to event: ${inviteTitle}` : 'invited you to an event'
    case 'profile_organization_invite':
      return inviteTitle ? `invited you to organization: ${inviteTitle}` : 'invited you to an organization'
    case 'profile_family_invite': {
      const relationshipLabel = typeof notification.payload?.relationshipLabel === 'string' ? notification.payload.relationshipLabel.trim() : ''
      return relationshipLabel ? `has added you as their ${relationshipLabel}` : 'has added you as family'
    }
    case 'delivery_contract_bid':
      if (deliveryListingTitle && deliveryAmountLabel) return `wants to deliver your ${deliveryListingTitle} for ${deliveryAmountLabel}`
      if (deliveryListingTitle) return `wants to deliver your ${deliveryListingTitle}`
      if (deliveryAmountLabel) return `wants to deliver your item for ${deliveryAmountLabel}`
      return 'wants to deliver your item'
    case 'drive_ride_offer':
      if (deliveryAmountLabel) return `offered you a ride for ${deliveryAmountLabel}`
      return 'offered you a ride'
    case 'drive_ride_offer_accepted':
      return deliveryAmountLabel ? `accepted your ride offer for ${deliveryAmountLabel}` : 'accepted your ride offer'
    case 'drive_ride_complete_confirmation': {
      const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
      if (status === 'confirmed') return 'trip completion was confirmed'
      if (status === 'reported_issue') return 'trip issue was reported to support'
      if (status === 'auto_completed') return 'trip auto-completed after no issue was reported'
      return 'marked trip complete'
    }
    case 'drive_ride_complete_response': {
      const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
      if (status === 'confirmed') return 'confirmed the trip is complete'
      if (status === 'reported_issue') return 'reported an issue with the trip'
      if (status === 'auto_completed') return 'did not report an issue, so the trip auto-completed'
      return 'responded to the trip completion request'
    }
    case 'delivery_contract_bid_response': {
      const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
      if (status === 'accepted') {
        if (deliveryListingTitle && deliveryAmountLabel) return `accepted your delivery bid for ${deliveryListingTitle} at ${deliveryAmountLabel}`
        if (deliveryListingTitle) return `accepted your delivery bid for ${deliveryListingTitle}`
        return 'accepted your delivery bid'
      }
      if (status === 'rejected') {
        if (deliveryListingTitle && deliveryAmountLabel) return `declined your delivery bid for ${deliveryListingTitle} at ${deliveryAmountLabel}`
        if (deliveryListingTitle) return `declined your delivery bid for ${deliveryListingTitle}`
        return 'declined your delivery bid'
      }
      return 'responded to your delivery bid'
    }
    case 'profile_family_invite_response': {
      const relationshipLabel = typeof notification.payload?.relationshipLabel === 'string' ? notification.payload.relationshipLabel.trim() : 'family'
      const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
      return status === 'accepted'
        ? `accepted your ${relationshipLabel} request`
        : status === 'rejected'
          ? `declined your ${relationshipLabel} request`
          : `responded to your ${relationshipLabel} request`
    }
    case 'poll_results_available': {
      const questionPreview = typeof notification.payload?.questionPreview === 'string' ? notification.payload.questionPreview.trim() : ''
      return questionPreview ? `poll results are ready: "${questionPreview}"` : 'poll results are now available'
    }
    case 'family_child_media_change': {
      const categoryLabel = notification.payload?.category === 'cover' ? 'cover photo' : 'profile photo'
      return `changed their ${categoryLabel}`
    }
    case 'family_child_username_change': {
      const username = typeof notification.payload?.username === 'string' ? notification.payload.username.trim() : ''
      return username ? `changed their username to ${username}` : 'changed their username'
    }
    case 'family_child_friend_request': {
      const requesterChild = notification.payload?.requesterChild
      const childDisplayName = requesterChild && typeof requesterChild === 'object' && !Array.isArray(requesterChild)
        ? typeof (requesterChild as Record<string, unknown>).displayName === 'string'
          ? ((requesterChild as Record<string, unknown>).displayName as string).trim()
          : ''
        : ''
      return childDisplayName ? `${childDisplayName} wants to connect with your child` : 'wants to connect with your child'
    }
    case 'family_child_friend_removed': {
      const targetHandle = typeof notification.payload?.targetHandle === 'string' ? notification.payload.targetHandle.trim() : ''
      const targetName = typeof notification.payload?.targetName === 'string' ? notification.payload.targetName.trim() : ''
      const targetLabel = targetHandle ? `@${targetHandle}` : targetName || 'a friend'
      return `removed ${targetLabel} from Family friends`
    }
    case 'family_child_blocked_user': {
      const targetHandle = typeof notification.payload?.targetHandle === 'string' ? notification.payload.targetHandle.trim() : ''
      const targetName = typeof notification.payload?.targetName === 'string' ? notification.payload.targetName.trim() : ''
      const targetLabel = targetHandle ? `@${targetHandle}` : targetName || 'a user'
      return `blocked ${targetLabel}`
    }
    default:
      return 'shared an update'
  }
}

export function getProfileFamilyRelationshipLabel(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim() as ProfileFamilyRelationshipValue
  return PROFILE_FAMILY_RELATIONSHIP_LABELS[normalized] ?? null
}

export function getNotificationFamilyInviteOptions(notification: NotificationItem) {
  const relationship = typeof notification.payload?.relationship === 'string'
    ? (notification.payload.relationship.trim() as ProfileFamilyRelationshipValue)
    : null
  if (!relationship) return []

  const optionValues = PROFILE_FAMILY_RECIPROCAL_OPTIONS_BY_RELATION[relationship] ?? [relationship]
  return optionValues.map((value) => ({ value, label: PROFILE_FAMILY_RELATIONSHIP_LABELS[value] ?? value }))
}

export function getNotificationOpenLabel(notification: NotificationItem): string | null {
  if (notification.type === 'profile_event_invite') return 'View event'
  if (notification.type === 'profile_organization_invite') return 'View organization'
  if (notification.type === 'profile_family_invite') return 'View profile'
  if (notification.type === 'profile_family_invite_response') return 'View profile'
  if (notification.type === 'drive_ride_offer') return 'View Details'
  if (notification.type === 'drive_ride_offer_accepted') return 'View ride'
  if (notification.type === 'drive_ride_complete_confirmation') return 'View ride'
  if (notification.type === 'drive_ride_complete_response') return 'View ride'
  if (notification.type === 'delivery_contract_bid_response') {
    const status = typeof notification.payload?.status === 'string' ? notification.payload.status.toLowerCase() : ''
    return status === 'accepted' ? 'Open chat' : 'View delivery'
  }
  return null
}

export function getNotificationActionLabels(notification: NotificationItem): { acceptLabel: string; rejectLabel: string } {
  if (notification.type === 'drive_ride_complete_confirmation') {
    return {
      acceptLabel: 'Confirm',
      rejectLabel: 'Report issue',
    }
  }

  return {
    acceptLabel: 'Accept',
    rejectLabel: notification.type === 'delivery_contract_bid' ? 'Decline' : 'Decline',
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
