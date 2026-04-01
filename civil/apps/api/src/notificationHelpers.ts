import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

import type { PushPayloadType } from './pushSender.js'

export const FRIEND_NOTIFICATION_TYPES = {
  REQUEST: 'friend_request',
  ACCEPT: 'friend_accept',
} as const

export const CONNECTION_NOTIFICATION_TYPES = {
  REQUEST: 'connection_request',
  ACCEPT: 'connection_accept',
} as const

export const COMMENT_NOTIFICATION_TYPES = {
  REPLY: 'comment_reply',
  POST_COMMENT: 'comment_post',
} as const

export const POST_NOTIFICATION_TYPES = {
  MENTION: 'post_mention',
} as const

export const NOTIFICATION_FEED_EXCLUDED_TYPES = [
  'message_created',
  'message',
  'message.created',
] as const

export const EVENT_NOTIFICATION_TYPES = {
  GUEST_SPEAKER_INVITE: 'event_guest_speaker_invite',
  SPONSOR_INVITE: 'event_sponsor_invite',
  GUEST_SPEAKER_RESPONSE: 'event_guest_speaker_response',
  SPONSOR_RESPONSE: 'event_sponsor_response',
} as const

export const ORG_NOTIFICATION_TYPES = {
  USER_INVITE: 'org_user_invite',
} as const

export const PROFILE_INVITE_NOTIFICATION_TYPES = {
  EVENT: 'profile_event_invite',
  ORGANIZATION: 'profile_organization_invite',
  FAMILY: 'profile_family_invite',
  FAMILY_RESPONSE: 'profile_family_invite_response',
} as const

export const DELIVERY_NOTIFICATION_TYPES = {
  BID: 'delivery_contract_bid',
  BID_RESPONSE: 'delivery_contract_bid_response',
  UPDATE: 'delivery_contract_update',
} as const

export const CAUSE_NOTIFICATION_TYPES = {
  CONTRIBUTION_RECEIVED_CREATOR: 'cause_contribution_received_creator',
  SUBSCRIPTION_STARTED_SUBSCRIBER: 'cause_subscription_started_subscriber',
  SUBSCRIPTION_STARTED_CREATOR: 'cause_subscription_started_creator',
  SUBSCRIPTION_CHARGED_SUBSCRIBER: 'cause_subscription_charged_subscriber',
  SUBSCRIPTION_CHARGED_CREATOR: 'cause_subscription_charged_creator',
} as const

export const PROFILE_FAMILY_RELATIONSHIP_LABELS = {
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
} as const

export const POLL_NOTIFICATION_TYPES = {
  RESULTS_AVAILABLE: 'poll_results_available',
} as const

export const FAMILY_NOTIFICATION_TYPES = {
  MEDIA_CHANGED: 'family_child_media_change',
  USERNAME_CHANGED: 'family_child_username_change',
  FRIEND_REQUEST: 'family_child_friend_request',
  FRIEND_REMOVED: 'family_child_friend_removed',
  USER_BLOCKED: 'family_child_blocked_user',
} as const

type NativePushPlatform = 'ios' | 'android'
type ProfileFamilyRelationship = keyof typeof PROFILE_FAMILY_RELATIONSHIP_LABELS

type NotificationRecord = {
  id: string
  userId: string
  actorId: string | null
  type: string
  postId: string | null
  payload: Prisma.JsonValue | null
  readAt: Date | null
  createdAt: Date
}

type FriendUserLike = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  isPremium: boolean
  isVerified: boolean
}

type MessageRecordLike = {
  senderId: string
  body: string | null
  attachments: Prisma.JsonValue | null
  sender?: {
    name?: string | null
    handle?: string | null
  } | null
}

type FamilyParentConversationRecordLike = {
  parentLastReadAt?: string | null
  messages: Array<{
    sender: 'child' | 'parent'
    createdAt: string
  }>
}

type CreateNotificationHelpersDeps = {
  dispatchRealtimeEvent: (userId: string, payload: { type: string; data: unknown }) => Promise<void>
  formatFriendUser: (user: any) => FriendUserLike
  formatNotification: (record: any) => unknown
  friendUserSelect: unknown
  getStoredFamilyParentConversations: (value: Prisma.JsonValue | null | undefined) => FamilyParentConversationRecordLike[]
  loadActiveAuthUserById: (userId: string) => Promise<{ id: string } | null>
  loadActiveNativePushTargets: (userId: string) => Promise<Array<{ platform: NativePushPlatform; token: string }>>
  loadFamilyMemberAuthViewerById: (memberId: string, parentId?: string | null) => Promise<{ parentId: string } | null>
  loadNotificationActor: (record: any) => Promise<FriendUserLike | null>
  normalizeAttachmentList: (value: Prisma.JsonValue | null | undefined) => string[]
  notificationSelect: unknown
  pushAdminSecret: string
  pushDeliveryUrl: string
  revokePushToken: (token: string, platform: string) => Promise<void>
  sendPushToUser: (userId: string, payload: { title: string; body: string; url: string; type: PushPayloadType; entityId?: string }) => Promise<unknown>
}

function readPayloadRecord(payload: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null
}

function parseApnsReason(payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText || '{}')
    return typeof parsed?.reason === 'string' ? parsed.reason : ''
  } catch {
    return ''
  }
}

function parseFcmErrorCode(payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText || '{}')
    const details = Array.isArray(parsed?.error?.details) ? (parsed.error.details as unknown[]) : []
    const typed = details.find(
      (item: unknown) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).errorCode === 'string',
    ) as Record<string, unknown> | undefined
    if (typed && typeof typed.errorCode === 'string') return typed.errorCode
    return typeof parsed?.error?.status === 'string' ? parsed.error.status : ''
  } catch {
    return ''
  }
}

function mapNotificationPushType(type: string): PushPayloadType {
  const normalized = type.trim().toLowerCase()
  if (
    normalized.startsWith('message') ||
    normalized === COMMENT_NOTIFICATION_TYPES.REPLY ||
    normalized === COMMENT_NOTIFICATION_TYPES.POST_COMMENT
  ) {
    return 'message'
  }
  if (normalized.includes('market')) return 'marketplace'
  if (normalized.startsWith('org_') || normalized.startsWith('event_')) return 'org'
  return 'system'
}

function getNativeNotificationSound(type: string, platform: NativePushPlatform): string {
  const normalized = type.trim().toLowerCase()
  if (normalized === 'drive_ride_contract_update' || normalized === 'delivery_contract_update') {
    return platform === 'android' ? 'honk_honk' : 'honk-honk.caf'
  }
  if (normalized === CAUSE_NOTIFICATION_TYPES.CONTRIBUTION_RECEIVED_CREATOR || normalized === 'market_order_received') {
    return platform === 'android' ? 'money' : 'money.caf'
  }
  return 'civil-general.caf'
}

function getNativeNotificationChannelId(type: string, platform: NativePushPlatform): string | undefined {
  if (platform !== 'android') return undefined
  const normalized = type.trim().toLowerCase()
  if (normalized === 'drive_ride_contract_update' || normalized === 'delivery_contract_update') {
    return 'drive_ride_updates'
  }
  return undefined
}

export function createNotificationHelpers(deps: CreateNotificationHelpersDeps) {
  async function deliverNativePushToToken(args: {
    platform: NativePushPlatform
    deviceToken: string
    title: string
    message: string
    badge?: number
    sound?: string
    channelId?: string
    data?: Record<string, unknown>
  }) {
    const response = await fetch(`${deps.pushDeliveryUrl}/send-test`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(deps.pushAdminSecret ? { 'x-admin-secret': deps.pushAdminSecret } : {}),
      },
      body: JSON.stringify({
        platform: args.platform,
        deviceToken: args.deviceToken,
        title: args.title,
        message: args.message,
        badge: args.badge,
        sound: args.sound,
        channelId: args.channelId,
        data: args.data,
      }),
    })

    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      console.error('push_delivery_failed', {
        platform: args.platform,
        status: response.status,
        deviceTokenSuffix: args.deviceToken.slice(-8),
        payload: raw,
      })
      return
    }

    try {
      const parsed = JSON.parse(raw || '{}')
      const deliveryStatus = Number(parsed?.result?.status || 0)
      const deliveryText = typeof parsed?.result?.text === 'string' ? parsed.result.text : ''
      if (deliveryStatus >= 200 && deliveryStatus < 300) return

      const reason = args.platform === 'ios' ? parseApnsReason(deliveryText) : parseFcmErrorCode(deliveryText)
      console.error('push_delivery_failed', {
        platform: args.platform,
        status: response.status,
        deliveryStatus,
        reason,
        deviceTokenSuffix: args.deviceToken.slice(-8),
      })

      if (
        (args.platform === 'ios' && (reason === 'BadDeviceToken' || reason === 'Unregistered')) ||
        (args.platform === 'android' && (reason === 'UNREGISTERED' || reason === 'INVALID_ARGUMENT' || reason === 'NOT_FOUND'))
      ) {
        void deps.revokePushToken(args.deviceToken, args.platform)
      }
    } catch {
      // ignore
    }
  }

  async function loadUnreadMessageCount(userId: string): Promise<number> {
    try {
      const [user, result] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
        prisma.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int as count
          FROM "Message" m
          JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
          WHERE mp."userId" = ${userId}
          AND m."senderId" != ${userId}
          AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
        `,
      ])
      const familyCount = deps
        .getStoredFamilyParentConversations(user?.communityMeta)
        .reduce((total, conversation) => {
          return (
            total +
            conversation.messages.filter((message) => {
              if (message.sender !== 'child') return false
              if (!conversation.parentLastReadAt) return true
              return message.createdAt > conversation.parentLastReadAt
            }).length
          )
        }, 0)
      const count = Number(result[0]?.count || 0) + familyCount
      return Number.isFinite(count) && count > 0 ? count : 0
    } catch {
      return 0
    }
  }

  function buildPushAlert(record: NotificationRecord, actor: FriendUserLike | null): { title: string; message: string } | null {
    const actorLabel = actor?.name || actor?.handle || 'Someone'
    if (record.type === FRIEND_NOTIFICATION_TYPES.REQUEST) {
      return { title: 'New friend request', message: `${actorLabel} sent you a friend request.` }
    }
    if (record.type === FRIEND_NOTIFICATION_TYPES.ACCEPT) {
      return { title: 'Friend request accepted', message: `${actorLabel} accepted your friend request.` }
    }
    if (record.type === COMMENT_NOTIFICATION_TYPES.REPLY) {
      const payload = readPayloadRecord(record.payload)
      const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
      return { title: 'New reply', message: preview ? `${actorLabel} replied: ${preview}` : `${actorLabel} replied to your comment.` }
    }
    if (record.type === COMMENT_NOTIFICATION_TYPES.POST_COMMENT) {
      const payload = readPayloadRecord(record.payload)
      const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
      return { title: 'New comment', message: preview ? `${actorLabel} commented: ${preview}` : `${actorLabel} commented on your post.` }
    }
    if (record.type === POST_NOTIFICATION_TYPES.MENTION) {
      const payload = readPayloadRecord(record.payload)
      const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
      return { title: 'New mention', message: preview ? `${actorLabel} mentioned you: ${preview}` : `${actorLabel} mentioned you in a post.` }
    }
    if (record.type === CONNECTION_NOTIFICATION_TYPES.REQUEST) {
      return { title: 'New connection request', message: `${actorLabel} sent you a connection request.` }
    }
    if (record.type === CONNECTION_NOTIFICATION_TYPES.ACCEPT) {
      return { title: 'Connection request accepted', message: `${actorLabel} accepted your connection request.` }
    }
    if (record.type === 'market_order_received') {
      const payload = readPayloadRecord(record.payload)
      const businessName = typeof payload?.businessName === 'string' ? payload.businessName.trim() : ''
      const itemCount = Number(payload?.itemCount || 0) || 0
      const countLabel = itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'an order'
      return {
        title: 'New shop order',
        message: businessName ? `${actorLabel} placed ${countLabel} with ${businessName}.` : `${actorLabel} placed ${countLabel}.`,
      }
    }
    if (record.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE) {
      const payload = readPayloadRecord(record.payload)
      const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
      return { title: 'Guest speaker invite', message: eventTitle ? `${actorLabel} invited you to speak at "${eventTitle}".` : `${actorLabel} invited you to be a guest speaker.` }
    }
    if (record.type === EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE) {
      const payload = readPayloadRecord(record.payload)
      const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
      return { title: 'Sponsor invite', message: eventTitle ? `${actorLabel} invited your organization to sponsor "${eventTitle}".` : `${actorLabel} invited your organization to sponsor an event.` }
    }
    if (record.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_RESPONSE) {
      const payload = readPayloadRecord(record.payload)
      const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
      const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
      const verb = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'responded to'
      return { title: 'Guest speaker response', message: eventTitle ? `${actorLabel} ${verb} your invite for "${eventTitle}".` : `${actorLabel} ${verb} your guest speaker invite.` }
    }
    if (record.type === EVENT_NOTIFICATION_TYPES.SPONSOR_RESPONSE) {
      const payload = readPayloadRecord(record.payload)
      const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
      const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
      const verb = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'responded to'
      return { title: 'Sponsor response', message: eventTitle ? `${actorLabel} ${verb} your sponsor invite for "${eventTitle}".` : `${actorLabel} ${verb} your sponsor invite.` }
    }
    if (record.type === ORG_NOTIFICATION_TYPES.USER_INVITE) {
      const payload = readPayloadRecord(record.payload)
      const organizationName = typeof payload?.organizationName === 'string' ? payload.organizationName.trim() : 'an organization'
      return { title: 'Organization invite', message: `${actorLabel} invited you to join ${organizationName}.` }
    }
    if (record.type === PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY) {
      const payload = readPayloadRecord(record.payload)
      const relationshipLabel = typeof payload?.relationshipLabel === 'string' ? payload.relationshipLabel.trim() : 'Family'
      return { title: 'Family request', message: `${actorLabel} wants to add you as ${relationshipLabel}.` }
    }
    if (record.type === PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY_RESPONSE) {
      const payload = readPayloadRecord(record.payload)
      const relationshipLabel = typeof payload?.relationshipLabel === 'string' ? payload.relationshipLabel.trim() : 'family'
      const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
      const verb = status === 'accepted' ? 'accepted' : status === 'rejected' ? 'declined' : 'responded to'
      return { title: 'Family request response', message: `${actorLabel} ${verb} your ${relationshipLabel} request.` }
    }
    if (record.type === POLL_NOTIFICATION_TYPES.RESULTS_AVAILABLE) {
      const payload = readPayloadRecord(record.payload)
      const questionPreview = typeof payload?.questionPreview === 'string' ? payload.questionPreview.trim() : ''
      return { title: 'Poll results available', message: questionPreview ? `${actorLabel}'s poll is ready: ${questionPreview}` : `${actorLabel}'s poll results are now available.` }
    }
    if (record.type === CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_STARTED_SUBSCRIBER) {
      const payload = readPayloadRecord(record.payload)
      const causeTitle = typeof payload?.postTitle === 'string' ? payload.postTitle.trim() : 'this Cause'
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel = typeof amountCents === 'number'
        ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
        : ''
      return {
        title: 'Monthly support started',
        message: amountLabel
          ? `You started ${amountLabel}/month for ${causeTitle}.`
          : `You started monthly support for ${causeTitle}.`,
      }
    }
    if (record.type === CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_STARTED_CREATOR) {
      const payload = readPayloadRecord(record.payload)
      const causeTitle = typeof payload?.postTitle === 'string' ? payload.postTitle.trim() : 'your Cause'
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel = typeof amountCents === 'number'
        ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
        : ''
      return {
        title: 'New monthly supporter',
        message: amountLabel
          ? `${actorLabel} started ${amountLabel}/month for ${causeTitle}.`
          : `${actorLabel} started monthly support for ${causeTitle}.`,
      }
    }
    if (record.type === CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_CHARGED_SUBSCRIBER) {
      const payload = readPayloadRecord(record.payload)
      const causeTitle = typeof payload?.postTitle === 'string' ? payload.postTitle.trim() : 'this Cause'
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel = typeof amountCents === 'number'
        ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
        : ''
      return {
        title: 'Monthly support charged',
        message: amountLabel
          ? `Your ${amountLabel} monthly support for ${causeTitle} was charged.`
          : `Your monthly support for ${causeTitle} was charged.`,
      }
    }
    if (record.type === CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_CHARGED_CREATOR) {
      const payload = readPayloadRecord(record.payload)
      const causeTitle = typeof payload?.postTitle === 'string' ? payload.postTitle.trim() : 'your Cause'
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel = typeof amountCents === 'number'
        ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
        : ''
      return {
        title: 'Monthly support received',
        message: amountLabel
          ? `${actorLabel}'s ${amountLabel} monthly support for ${causeTitle} was charged.`
          : `${actorLabel}'s monthly support for ${causeTitle} was charged.`,
      }
    }
    if (record.type === CAUSE_NOTIFICATION_TYPES.CONTRIBUTION_RECEIVED_CREATOR) {
      const payload = readPayloadRecord(record.payload)
      const causeTitle = typeof payload?.postTitle === 'string' ? payload.postTitle.trim() : 'your Cause'
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel = typeof amountCents === 'number'
        ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
        : ''
      return {
        title: 'Contribution received',
        message: amountLabel
          ? `${actorLabel} backed ${causeTitle} with ${amountLabel}.`
          : `${actorLabel} backed ${causeTitle}.`,
      }
    }
    if (record.type === 'drive_ride_offer') {
      const payload = readPayloadRecord(record.payload)
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel =
        typeof amountCents === 'number'
          ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
          : ''
      return {
        title: 'New ride offer',
        message: amountLabel ? `${actorLabel} offered you a ride for ${amountLabel}.` : `${actorLabel} offered you a ride.`,
      }
    }
    if (record.type === 'drive_ride_offer_accepted') {
      const payload = readPayloadRecord(record.payload)
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel =
        typeof amountCents === 'number'
          ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
          : ''
      return {
        title: 'Ride offer accepted',
        message: amountLabel ? `${actorLabel} accepted your ride offer for ${amountLabel}.` : `${actorLabel} accepted your ride offer.`,
      }
    }
    if (record.type === 'drive_ride_contract_update') {
      const payload = readPayloadRecord(record.payload)
      const action = typeof payload?.action === 'string' ? payload.action.trim().toLowerCase() : ''
      if (action === 'arrived_pickup') {
        return { title: 'Driver arrived', message: `${actorLabel} arrived for pickup.` }
      }
      if (action === 'cancel_arrival') {
        return { title: 'Pickup arrival updated', message: `${actorLabel} cancelled the pickup arrival update.` }
      }
      if (action === 'picked_up') {
        return { title: 'Passengers picked up', message: `${actorLabel} picked up the passengers.` }
      }
      if (action === 'cancel_pickup') {
        return { title: 'Pickup updated', message: `${actorLabel} cancelled the passenger pickup update.` }
      }
      if (action === 'dropped_off') {
        return { title: 'At dropoff', message: `${actorLabel} arrived at the dropoff.` }
      }
      if (action === 'cancel_dropoff') {
        return { title: 'Dropoff updated', message: `${actorLabel} cancelled the dropoff arrival update.` }
      }
      if (action === 'complete_contract') {
        return { title: 'Ride completed', message: `${actorLabel} completed your ride.` }
      }
      return { title: 'Ride update', message: `${actorLabel} updated the ride contract.` }
    }
    if (record.type === 'delivery_contract_update') {
      const payload = readPayloadRecord(record.payload)
      const action = typeof payload?.action === 'string' ? payload.action.trim().toLowerCase() : ''
      if (action === 'picked_up') {
        return { title: 'Item picked up', message: `${actorLabel} picked up your delivery item.` }
      }
      if (action === 'delivered') {
        return { title: 'Delivery completed', message: `${actorLabel} delivered your item.` }
      }
      return { title: 'Delivery update', message: `${actorLabel} updated your delivery.` }
    }
    if (record.type === 'drive_ride_tip_received') {
      const payload = readPayloadRecord(record.payload)
      const amountCents = typeof payload?.amountCents === 'number' ? payload.amountCents : null
      const amountLabel =
        typeof amountCents === 'number'
          ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountCents / 100)
          : ''
      return {
        title: 'Tip received',
        message: amountLabel ? `${actorLabel} sent you a ride tip of ${amountLabel}.` : `${actorLabel} sent you a ride tip.`,
      }
    }
    if (record.type === 'drive_ride_complete_confirmation') {
      return {
        title: 'Trip marked complete',
        message: `${actorLabel} marked your trip complete.`,
      }
    }
    if (record.type === 'drive_ride_complete_response') {
      const payload = readPayloadRecord(record.payload)
      const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
      if (status === 'confirmed') {
        return { title: 'Trip confirmed', message: `${actorLabel} confirmed the trip is complete.` }
      }
      if (status === 'reported_issue') {
        return { title: 'Trip issue reported', message: `${actorLabel} reported an issue with the trip.` }
      }
      if (status === 'auto_completed') {
        return { title: 'Trip auto-completed', message: `The trip auto-completed after ${actorLabel} did not report an issue.` }
      }
      return { title: 'Trip completion updated', message: `${actorLabel} responded to the trip completion request.` }
    }
    if (record.type === FAMILY_NOTIFICATION_TYPES.MEDIA_CHANGED) {
      const payload = readPayloadRecord(record.payload)
      const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
      const categoryLabel = payload?.category === 'cover' ? 'cover photo' : 'profile photo'
      return { title: 'Child photo updated', message: `${childDisplayName} changed their ${categoryLabel}.` }
    }
    if (record.type === FAMILY_NOTIFICATION_TYPES.USERNAME_CHANGED) {
      const payload = readPayloadRecord(record.payload)
      const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
      const username = typeof payload?.username === 'string' ? payload.username.trim() : ''
      return { title: 'Child username updated', message: username ? `${childDisplayName} changed their username to ${username}.` : `${childDisplayName} changed their username.` }
    }
    if (record.type === FAMILY_NOTIFICATION_TYPES.FRIEND_REQUEST) {
      const payload = readPayloadRecord(record.payload)
      const requesterChild = payload?.requesterChild && typeof payload.requesterChild === 'object' && !Array.isArray(payload.requesterChild)
        ? (payload.requesterChild as Record<string, unknown>)
        : null
      const childDisplayName = typeof requesterChild?.displayName === 'string' ? requesterChild.displayName.trim() : 'A child'
      return { title: 'Family friend request', message: `${childDisplayName} wants to connect with your child.` }
    }
    if (record.type === FAMILY_NOTIFICATION_TYPES.FRIEND_REMOVED) {
      const payload = readPayloadRecord(record.payload)
      const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
      const targetHandle = typeof payload?.targetHandle === 'string' ? payload.targetHandle.trim() : ''
      const targetName = typeof payload?.targetName === 'string' ? payload.targetName.trim() : ''
      const targetLabel = targetHandle ? `@${targetHandle}` : targetName || 'a friend'
      return { title: 'Family friend removed', message: `${childDisplayName} removed ${targetLabel} from Family friends.` }
    }
    if (record.type === FAMILY_NOTIFICATION_TYPES.USER_BLOCKED) {
      const payload = readPayloadRecord(record.payload)
      const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
      const targetHandle = typeof payload?.targetHandle === 'string' ? payload.targetHandle.trim() : ''
      const targetName = typeof payload?.targetName === 'string' ? payload.targetName.trim() : ''
      const targetLabel = targetHandle ? `@${targetHandle}` : targetName || 'a user'
      return { title: 'Family user blocked', message: `${childDisplayName} blocked ${targetLabel}.` }
    }
    return { title: 'Civil Citizens', message: `${actorLabel} sent you a notification.` }
  }

  function getNotificationDeepLink(record: NotificationRecord, actor?: FriendUserLike | null): string | null {
    const payload = readPayloadRecord(record.payload)
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    if (
      status === 'pending' &&
      (
        record.type === FRIEND_NOTIFICATION_TYPES.REQUEST ||
        record.type === CONNECTION_NOTIFICATION_TYPES.REQUEST ||
        record.type === PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY ||
        record.type === FAMILY_NOTIFICATION_TYPES.FRIEND_REQUEST
      )
    ) {
      return '/notifications'
    }

    if (record.type === 'drive_ride_contract_update') {
      return '/drive'
    }
    if (record.type === 'delivery_contract_update') {
      const url = typeof payload?.url === 'string' ? payload.url.trim() : ''
      return url.startsWith('/') ? url : '/delivery/my'
    }

    const candidates = record.type === COMMENT_NOTIFICATION_TYPES.REPLY
      ? [payload?.replyUrl, payload?.url, payload?.sourceUrl]
      : [payload?.url, payload?.sourceUrl, payload?.replyUrl]

    if (record.type === POLL_NOTIFICATION_TYPES.RESULTS_AVAILABLE) {
      const pollUrl = typeof payload?.url === 'string' ? payload.url.trim() : ''
      if (pollUrl.startsWith('/')) return pollUrl
    }

    for (const raw of candidates) {
      const url = typeof raw === 'string' ? raw.trim() : ''
      if (url.startsWith('/')) return url
    }

    const threadIdCandidates = [payload?.threadId, payload?.threadID, payload?.channelId, payload?.conversationId]
    for (const raw of threadIdCandidates) {
      const threadId = typeof raw === 'string' ? raw.trim() : ''
      if (threadId) {
        return `/messages?thread=${encodeURIComponent(threadId)}`
      }
    }

    if (record.postId) {
      const commentId = typeof payload?.commentId === 'string' ? payload.commentId.trim() : ''
      if (commentId) {
        const encodedCommentId = encodeURIComponent(commentId)
        return `/post/${encodeURIComponent(record.postId)}?comment=${encodedCommentId}#comment-${encodedCommentId}`
      }
      return `/post/${encodeURIComponent(record.postId)}`
    }

    const actorHandle = actor?.handle?.trim()
    if (actorHandle) {
      return `/u/${encodeURIComponent(actorHandle)}`
    }

    return null
  }

  function buildWebPushPayloadForNotification(
    record: NotificationRecord,
    actor: FriendUserLike | null,
  ): {
    title: string
    body: string
    url: string
    type: PushPayloadType
    entityId: string
  } | null {
    const alert = buildPushAlert(record, actor)
    if (!alert) return null
    return {
      title: alert.title,
      body: alert.message,
      url: getNotificationDeepLink(record, actor) ?? '/notifications',
      type: mapNotificationPushType(record.type),
      entityId: record.id,
    }
  }

  async function sendMobilePushNotification(record: NotificationRecord, actor: FriendUserLike | null) {
    if (!deps.pushDeliveryUrl) return

    const alert = buildPushAlert(record, actor)
    if (!alert) return

    const targets = await deps.loadActiveNativePushTargets(record.userId)
    if (!targets.length) return

    await Promise.allSettled(
      targets.map(({ platform, token }) =>
        deliverNativePushToToken({
          platform,
          deviceToken: token,
          title: alert.title,
          message: alert.message,
          sound: getNativeNotificationSound(record.type, platform),
          channelId: getNativeNotificationChannelId(record.type, platform),
          data: {
            kind: 'notification',
            url: getNotificationDeepLink(record, actor) ?? '/notifications',
          },
        }),
      ),
    )
  }

  function truncatePushBody(value: string, maxLen = 140): string {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    if (trimmed.length <= maxLen) return trimmed
    return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
  }

  function formatDisplayNameForPush(input: string | null | undefined): string {
    if (!input) return ''
    return input
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
      .join(' ')
  }

  function isThreadMuted(mutedUntil: Date | null | undefined): boolean {
    if (!mutedUntil) return false
    return new Date(mutedUntil).getTime() > Date.now()
  }

  const IOS_CALL_NOTIFICATION_SOUND = 'ringtone.caf'
  const ANDROID_CALL_NOTIFICATION_SOUND = 'ringtone'
  const ANDROID_CALL_NOTIFICATION_CHANNEL_ID = 'incoming_calls'

  async function sendNativePushForIncomingCall(args: {
    recipientUserId: string
    title: string
    message: string
    url: string
    callId: string
    mode: 'audio' | 'video'
    threadId?: string
    memberId?: string
  }) {
    if (!deps.pushDeliveryUrl) return

    const deviceTargets = await deps.loadActiveNativePushTargets(args.recipientUserId)
    if (!deviceTargets.length) return

    await Promise.allSettled(
      deviceTargets.map(({ platform, token }) =>
        deliverNativePushToToken({
          platform,
          deviceToken: token,
          title: args.title,
          message: args.message,
          sound: platform === 'android' ? ANDROID_CALL_NOTIFICATION_SOUND : IOS_CALL_NOTIFICATION_SOUND,
          ...(platform === 'android' ? { channelId: ANDROID_CALL_NOTIFICATION_CHANNEL_ID } : {}),
          data: {
            kind: 'call',
            callId: args.callId,
            mode: args.mode,
            url: args.url,
            ...(args.threadId ? { threadId: args.threadId } : {}),
            ...(args.memberId ? { memberId: args.memberId } : {}),
          },
        }),
      ),
    )
  }

  async function sendMobilePushForMessageCreated(args: {
    threadId: string
    message: MessageRecordLike
    participants: Array<{ userId: string; mutedUntil?: Date | null }>
    pushUrl?: string
  }) {
    const rawSenderLabel = args.message.sender?.name || args.message.sender?.handle || 'Someone'
    const senderLabel = formatDisplayNameForPush(rawSenderLabel) || rawSenderLabel
    const attachmentCount = deps.normalizeAttachmentList(args.message.attachments).length
    const rawPreview = (args.message.body || '').trim()
    const preview = rawPreview
      ? rawPreview
      : attachmentCount > 0
        ? 'Sent an attachment.'
        : 'Sent you a message.'

    const title = senderLabel
    const body = truncatePushBody(preview)
    if (!body) return
    const pushUrl = args.pushUrl?.trim() || `/messages?thread=${encodeURIComponent(args.threadId)}`

    const targets = args.participants
      .filter((participant) => participant.userId !== args.message.senderId)
      .filter((participant) => !isThreadMuted(participant.mutedUntil ?? null))

    await Promise.allSettled(
      targets.map((participant) =>
        deps.sendPushToUser(participant.userId, {
          title,
          body,
          url: pushUrl,
          type: 'message',
          entityId: args.threadId,
        }),
      ),
    )

    if (!deps.pushDeliveryUrl) return

    await Promise.allSettled(
      targets.map(async (participant) => {
        const deviceTargets = await deps.loadActiveNativePushTargets(participant.userId)
        if (!deviceTargets.length) return

        const badge = await loadUnreadMessageCount(participant.userId)

        await Promise.allSettled(
          deviceTargets.map(({ platform, token }) =>
            deliverNativePushToToken({
              platform,
              deviceToken: token,
              title,
              message: body,
              badge,
              sound: 'civil-message.caf',
              data: {
                kind: 'message',
                threadId: args.threadId,
                url: pushUrl,
              },
            }),
          ),
        )
      }),
    )
  }

  async function dispatchNotification(
    record: NotificationRecord,
    options?: {
      suppressMobilePush?: boolean
    },
  ) {
    const actor = await deps.loadNotificationActor(record)

    await deps.dispatchRealtimeEvent(record.userId, {
      type: 'notification',
      data: {
        ...((deps.formatNotification(record as any) as Record<string, unknown>) ?? {}),
        actor,
      },
    })

    if (!options?.suppressMobilePush) {
      void sendMobilePushNotification(record, actor)
      const payload = buildWebPushPayloadForNotification(record, actor)
      if (payload) {
        void deps.sendPushToUser(record.userId, payload)
      }
    }
  }

  async function createNotificationRecord(data: {
    userId: string
    actorId: string | null
    type: string
    postId?: string | null
    payload?: Prisma.InputJsonValue
    suppressMobilePush?: boolean
  }) {
    const notification = (await prisma.notification.create({
      data: {
        userId: data.userId,
        actorId: data.actorId,
        type: data.type,
        postId: data.postId ?? null,
        payload: data.payload ?? undefined,
      },
      select: deps.notificationSelect as any,
    })) as NotificationRecord
    await dispatchNotification(notification, { suppressMobilePush: Boolean(data.suppressMobilePush) })
    return notification
  }

  async function notifyFriendRequest(friendshipId: string, requesterId: string, addresseeId: string) {
    await createNotificationRecord({
      userId: addresseeId,
      actorId: requesterId,
      type: FRIEND_NOTIFICATION_TYPES.REQUEST,
      payload: { friendshipId, status: 'pending' },
    })
  }

  async function notifyFriendAcceptance(friendshipId: string, requesterId: string, addresseeId: string) {
    await createNotificationRecord({
      userId: requesterId,
      actorId: addresseeId,
      type: FRIEND_NOTIFICATION_TYPES.ACCEPT,
      payload: { friendshipId },
    })
  }

  async function notifyConnectionRequest(connectionId: string, requesterId: string, addresseeId: string) {
    await createNotificationRecord({
      userId: addresseeId,
      actorId: requesterId,
      type: CONNECTION_NOTIFICATION_TYPES.REQUEST,
      payload: {
        connectionId,
        status: 'pending',
        url: '/network/professionals',
      },
    })
  }

  async function notifyConnectionAcceptance(connectionId: string, requesterId: string, addresseeId: string) {
    await createNotificationRecord({
      userId: requesterId,
      actorId: addresseeId,
      type: CONNECTION_NOTIFICATION_TYPES.ACCEPT,
      payload: {
        connectionId,
        status: 'accepted',
        url: '/network/professionals',
      },
    })
  }

  async function notifyProfileEventInvite(args: {
    inviteeUserId: string
    actorUserId: string
    eventId: string
    eventTitle: string
    hostOrganizationId: string
    hostOrganizationName: string
    hostProvinceCode: string
    hostCommunitySlug: string
    hostOrganizationSlug: string
  }) {
    const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
    await createNotificationRecord({
      userId: args.inviteeUserId,
      actorId: args.actorUserId,
      type: PROFILE_INVITE_NOTIFICATION_TYPES.EVENT,
      payload: {
        eventId: args.eventId,
        title: args.eventTitle,
        organizationId: args.hostOrganizationId,
        organizationName: args.hostOrganizationName,
        url: eventUrl,
      },
    })
  }

  async function notifyProfileOrganizationInvite(args: {
    inviteeUserId: string
    actorUserId: string
    organizationId: string
    organizationName: string
    provinceCode: string
    communitySlug: string
    organizationSlug: string
  }) {
    const organizationUrl = `/com/${encodeURIComponent(args.provinceCode)}/${encodeURIComponent(args.communitySlug)}/orgs/${encodeURIComponent(args.organizationSlug)}`
    await createNotificationRecord({
      userId: args.inviteeUserId,
      actorId: args.actorUserId,
      type: PROFILE_INVITE_NOTIFICATION_TYPES.ORGANIZATION,
      payload: {
        organizationId: args.organizationId,
        title: args.organizationName,
        url: organizationUrl,
      },
    })
  }

  async function notifyProfileFamilyInvite(args: {
    inviteeUserId: string
    actorUserId: string
    actorHandle: string
    relationship: ProfileFamilyRelationship
  }) {
    const relationshipLabel = PROFILE_FAMILY_RELATIONSHIP_LABELS[args.relationship]
    const profileUrl = `/u/${encodeURIComponent(args.actorHandle)}`
    const requestedAt = new Date().toISOString()
    await createNotificationRecord({
      userId: args.inviteeUserId,
      actorId: args.actorUserId,
      type: PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY,
      payload: {
        relationship: args.relationship,
        relationshipLabel,
        status: 'pending',
        requestedAt,
        url: profileUrl,
        sourceUrl: profileUrl,
      },
    })
  }

  async function notifyProfileFamilyInviteResponse(args: {
    inviteeUserId: string
    actorUserId: string
    actorHandle: string
    relationship: ProfileFamilyRelationship
    status: 'accepted' | 'rejected'
  }) {
    const relationshipLabel = PROFILE_FAMILY_RELATIONSHIP_LABELS[args.relationship]
    const profileUrl = `/u/${encodeURIComponent(args.actorHandle)}`
    await createNotificationRecord({
      userId: args.inviteeUserId,
      actorId: args.actorUserId,
      type: PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY_RESPONSE,
      payload: {
        relationship: args.relationship,
        relationshipLabel,
        status: args.status,
        respondedAt: new Date().toISOString(),
        url: profileUrl,
        sourceUrl: profileUrl,
      },
    })
  }

  async function notifyEventGuestSpeakerInvite(args: {
    inviteeUserId: string
    actorUserId: string
    hostOrganizationId: string
    hostProvinceCode: string
    hostCommunitySlug: string
    hostOrganizationSlug: string
    eventId: string
    eventTitle: string
  }) {
    const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
    await createNotificationRecord({
      userId: args.inviteeUserId,
      actorId: args.actorUserId,
      type: EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE,
      payload: {
        status: 'pending',
        invitationKind: 'guest_speaker',
        hostOrganizationId: args.hostOrganizationId,
        eventId: args.eventId,
        eventTitle: args.eventTitle,
        url: eventUrl,
      },
    })
  }

  async function notifyEventSponsorInvite(args: {
    inviteeUserId: string
    actorUserId: string
    hostOrganizationId: string
    hostProvinceCode: string
    hostCommunitySlug: string
    hostOrganizationSlug: string
    targetOrganizationId: string
    eventId: string
    eventTitle: string
  }) {
    const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
    await createNotificationRecord({
      userId: args.inviteeUserId,
      actorId: args.actorUserId,
      type: EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE,
      payload: {
        status: 'pending',
        invitationKind: 'sponsor',
        hostOrganizationId: args.hostOrganizationId,
        targetOrganizationId: args.targetOrganizationId,
        eventId: args.eventId,
        eventTitle: args.eventTitle,
        url: eventUrl,
      },
    })
  }

  return {
    createNotificationRecord,
    deliverNativePushToToken,
    dispatchNotification,
    formatDisplayNameForPush,
    isThreadMuted,
    loadUnreadMessageCount,
    notifyConnectionAcceptance,
    notifyConnectionRequest,
    notifyEventGuestSpeakerInvite,
    notifyEventSponsorInvite,
    notifyFriendAcceptance,
    notifyFriendRequest,
    notifyProfileEventInvite,
    notifyProfileFamilyInvite,
    notifyProfileFamilyInviteResponse,
    notifyProfileOrganizationInvite,
    sendMobilePushForMessageCreated,
    sendNativePushForIncomingCall,
    truncatePushBody,
  }
}
