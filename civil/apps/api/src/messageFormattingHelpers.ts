import { Prisma } from '@prisma/client'
import type { FamilyParentConversationRecord } from './familyMetaHelpers.js'

type MessageFormattingDeps = {
  buildFamilyParentThreadId: (parentId: string) => string
  buildParentFamilyThreadId: (memberId: string) => string
  formatFriendUser: (user: any) => any
  normalizeFamilyMemberSummary: (member: any) => any
  normalizeMediaUrl: (url?: string | null) => string | null
}

type MessageCallSystemMeta = {
  kind: 'call_ended'
  reason: 'hangup' | 'no_answer'
  mode: 'audio' | 'video'
  callId: string
  callbackThreadId: string
  callbackLabel: 'Call Back'
  actorUserId: string | null
  actorName: string | null
}

type MarketPaymentType = 'cash_pickup' | 'etransfer' | 'civil_wallet'

type MarketPaymentPromptSystemMeta = {
  kind: 'market_payment_prompt'
  listingId: string
  options: MarketPaymentType[]
  selectedOption: MarketPaymentType | null
}

type MarketPaymentSelectedSystemMeta = {
  kind: 'market_payment_selected'
  listingId: string
  selectedOption: MarketPaymentType
  selectedLabel: string
  civilPayUrl: string | null
  eTransferEmail: string | null
}

type MarketRelistPromptSystemMeta = {
  kind: 'market_relist_prompt'
  listingId: string
  relistLabel: string
}

type MessageSystemMeta = MessageCallSystemMeta | MarketPaymentPromptSystemMeta | MarketPaymentSelectedSystemMeta | MarketRelistPromptSystemMeta

type ParentConversationMember = {
  id: string
  createdAt: string
  updatedAt: string
  displayName: string
  username: string | null
  avatarUrl: string | null
  coverUrl: string | null
  relationshipLabel: string
  modeBand: string
  modeLabel: string
}

type FamilyAuthMemberLike = {
  id: string
  parentId: string
  createdAt: Date
  updatedAt: Date
  parent: {
    id: string
    name: string | null
    handle?: string
    avatarUrl: string | null
    coverUrl: string | null
  }
}

export function createMessageFormattingHelpers(deps: MessageFormattingDeps) {
  function normalizeAttachmentList(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is string => typeof entry === 'string')
  }

  function isMarketPaymentType(value: unknown): value is MarketPaymentType {
    return value === 'cash_pickup' || value === 'etransfer' || value === 'civil_wallet'
  }

  function extractMessageSystemMeta(value: Prisma.JsonValue | null | undefined): MessageSystemMeta | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const typed = value as Record<string, unknown>
    if (typed.kind === 'call_ended') {
      const reason = typed.reason
      const mode = typed.mode
      const callId = typed.callId
      const callbackThreadId = typed.callbackThreadId
      if ((reason !== 'hangup' && reason !== 'no_answer') || (mode !== 'audio' && mode !== 'video')) return null
      if (typeof callId !== 'string' || !callId.trim()) return null
      if (typeof callbackThreadId !== 'string' || !callbackThreadId.trim()) return null
      return {
        kind: 'call_ended',
        reason,
        mode,
        callId,
        callbackThreadId,
        callbackLabel: 'Call Back',
        actorUserId: typeof typed.actorUserId === 'string' && typed.actorUserId.trim() ? typed.actorUserId : null,
        actorName: typeof typed.actorName === 'string' && typed.actorName.trim() ? typed.actorName : null,
      }
    }

    if (typed.kind === 'market_payment_prompt') {
      const listingId = typed.listingId
      const rawOptions = typed.options
      const selectedOption = typed.selectedOption
      if (typeof listingId !== 'string' || !listingId.trim()) return null
      if (!Array.isArray(rawOptions)) return null
      const options = rawOptions.filter(isMarketPaymentType)
      if (options.length === 0) return null
      if (selectedOption !== null && selectedOption !== undefined && !isMarketPaymentType(selectedOption)) return null
      return {
        kind: 'market_payment_prompt',
        listingId,
        options,
        selectedOption: isMarketPaymentType(selectedOption) ? selectedOption : null,
      }
    }

    if (typed.kind === 'market_payment_selected') {
      const listingId = typed.listingId
      const selectedOption = typed.selectedOption
      const selectedLabel = typed.selectedLabel
      if (typeof listingId !== 'string' || !listingId.trim()) return null
      if (!isMarketPaymentType(selectedOption)) return null
      if (typeof selectedLabel !== 'string' || !selectedLabel.trim()) return null
      return {
        kind: 'market_payment_selected',
        listingId,
        selectedOption,
        selectedLabel: selectedLabel.trim(),
        civilPayUrl: typeof typed.civilPayUrl === 'string' && typed.civilPayUrl.trim() ? typed.civilPayUrl.trim() : null,
        eTransferEmail: typeof typed.eTransferEmail === 'string' && typed.eTransferEmail.trim() ? typed.eTransferEmail.trim() : null,
      }
    }

    if (typed.kind === 'market_relist_prompt') {
      const listingId = typed.listingId
      const relistLabel = typed.relistLabel
      if (typeof listingId !== 'string' || !listingId.trim()) return null
      if (typeof relistLabel !== 'string' || !relistLabel.trim()) return null
      return {
        kind: 'market_relist_prompt',
        listingId,
        relistLabel: relistLabel.trim(),
      }
    }

    return null
  }

  function formatMessage(record: any, viewerId: string) {
    return {
      id: record.id,
      threadId: record.threadId,
      body: record.body ?? null,
      attachments: normalizeAttachmentList(record.attachments),
      systemMeta: extractMessageSystemMeta(record.attachments),
      messageType: record.messageType,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt ?? null,
      senderId: record.senderId,
      sender: deps.formatFriendUser(record.sender),
      isMine: record.senderId === viewerId,
    }
  }

  function formatThreadParticipant(participant: any, viewerId: string) {
    return {
      userId: participant.userId,
      role: participant.role,
      joinedAt: participant.joinedAt,
      lastReadAt: participant.lastReadAt ?? null,
      mutedUntil: participant.mutedUntil ?? null,
      lastActivityAt: participant.lastActivityAt,
      user: deps.formatFriendUser(participant.user),
      isViewer: participant.userId === viewerId,
    }
  }

  function formatNormalizedFamilyMemberThreadUser(member: {
    id: string
    username: string | null
    displayName: string
    avatarUrl: string | null
    coverUrl: string | null
  }) {
    const username = member.username?.trim() || `family-${member.id.slice(0, 8)}`
    return {
      id: `family-member:${member.id}`,
      handle: username,
      name: member.displayName,
      avatarUrl: deps.normalizeMediaUrl(member.avatarUrl ?? null),
      coverUrl: deps.normalizeMediaUrl(member.coverUrl ?? null),
      isPremium: false,
      isVerified: false,
    }
  }

  function formatFamilyMemberThreadUser(member: FamilyAuthMemberLike) {
    const normalizedMember = deps.normalizeFamilyMemberSummary(member)
    return formatNormalizedFamilyMemberThreadUser(normalizedMember)
  }

  function formatParentFamilyConversationMessage(
    conversation: FamilyParentConversationRecord,
    member: ParentConversationMember,
    parent: any,
  ) {
    const threadId = deps.buildParentFamilyThreadId(member.id)
    return conversation.messages.map((message: FamilyParentConversationRecord['messages'][number]) => ({
      id: message.id,
      threadId,
      body: message.body,
      attachments: [],
      systemMeta: null,
      messageType: 'text',
      createdAt: new Date(message.createdAt),
      updatedAt: new Date(message.updatedAt),
      deletedAt: null,
      senderId: message.sender === 'child' ? `family-member:${member.id}` : parent.id,
      sender: message.sender === 'child' ? formatNormalizedFamilyMemberThreadUser(member) : deps.formatFriendUser(parent),
      isMine: message.sender === 'parent',
    }))
  }

  function buildParentFamilyConversationThread(args: {
    parent: any
    member: ParentConversationMember
    conversation: FamilyParentConversationRecord | null
  }) {
    const createdAt = new Date(args.conversation?.createdAt ?? args.member.createdAt)
    const updatedAt = new Date(args.conversation?.updatedAt ?? args.member.updatedAt)
    const messages = args.conversation
      ? formatParentFamilyConversationMessage(args.conversation, args.member, args.parent)
      : []
    const lastMessage = messages.at(-1) ?? null
    const unreadCount = args.conversation
      ? args.conversation.messages.filter((message: FamilyParentConversationRecord['messages'][number]) => {
          if (message.sender !== 'child') return false
          if (!args.conversation?.parentLastReadAt) return true
          return message.createdAt > args.conversation.parentLastReadAt
        }).length
      : 0

    return {
      id: deps.buildParentFamilyThreadId(args.member.id),
      type: 'direct',
      contextType: null,
      contextId: null,
      inboxSection: 'family' as const,
      createdAt,
      updatedAt,
      lastMessageAt: lastMessage?.createdAt ?? createdAt,
      lastMessage,
      unreadCount,
      unread: unreadCount > 0,
      activeCall: null,
      participants: [
        {
          userId: args.parent.id,
          role: 'member',
          joinedAt: createdAt,
          lastReadAt: args.conversation?.parentLastReadAt ? new Date(args.conversation.parentLastReadAt) : null,
          mutedUntil: null,
          lastActivityAt: updatedAt,
          user: deps.formatFriendUser(args.parent),
          isViewer: true,
        },
        {
          userId: `family-member:${args.member.id}`,
          role: 'member',
          joinedAt: createdAt,
          lastReadAt: args.conversation?.childLastReadAt ? new Date(args.conversation.childLastReadAt) : null,
          mutedUntil: null,
          lastActivityAt: updatedAt,
          user: formatNormalizedFamilyMemberThreadUser(args.member),
          isViewer: false,
        },
      ],
    }
  }

  function fetchParentFamilyConversationMessages(
    member: ParentConversationMember,
    parent: any,
    conversation: FamilyParentConversationRecord | null,
    limit: number,
    cursor?: string,
  ) {
    const rows = conversation ? formatParentFamilyConversationMessage(conversation, member, parent) : []
    const descending = [...rows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    const startIndex = cursor ? descending.findIndex((message) => message.id === cursor) + 1 : 0
    const paged = descending.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit + 1)

    let nextCursor: string | undefined
    if (paged.length > limit) {
      const next = paged.pop()!
      nextCursor = next.id
    }

    return {
      rows: paged.reverse(),
      nextCursor,
    }
  }

  function formatFamilyParentConversationMessage(
    conversation: FamilyParentConversationRecord,
    member: FamilyAuthMemberLike,
  ) {
    const threadId = deps.buildFamilyParentThreadId(member.parentId)
    return conversation.messages.map((message: FamilyParentConversationRecord['messages'][number]) => ({
      id: message.id,
      threadId,
      body: message.body,
      attachments: [],
      systemMeta: null,
      messageType: 'text',
      createdAt: new Date(message.createdAt),
      updatedAt: new Date(message.updatedAt),
      deletedAt: null,
      senderId: message.sender === 'child' ? `family-member:${member.id}` : member.parentId,
      sender: message.sender === 'child' ? formatFamilyMemberThreadUser(member) : deps.formatFriendUser(member.parent),
      isMine: message.sender === 'child',
    }))
  }

  function buildFamilyParentConversationThread(
    member: FamilyAuthMemberLike,
    conversation: FamilyParentConversationRecord | null,
  ) {
    const threadId = deps.buildFamilyParentThreadId(member.parentId)
    const createdAt = new Date(conversation?.createdAt ?? member.createdAt.toISOString())
    const updatedAt = new Date(conversation?.updatedAt ?? conversation?.createdAt ?? member.updatedAt.toISOString())
    const messages = conversation ? formatFamilyParentConversationMessage(conversation, member) : []
    const lastMessage = messages.at(-1) ?? null
    const unreadCount = conversation
      ? conversation.messages.filter((message: FamilyParentConversationRecord['messages'][number]) => {
          if (message.sender !== 'parent') return false
          if (!conversation.childLastReadAt) return true
          return message.createdAt > conversation.childLastReadAt
        }).length
      : 0

    return {
      id: threadId,
      type: 'direct',
      title: member.parent.name,
      imageUrl: deps.normalizeMediaUrl(member.parent.avatarUrl ?? null),
      contextType: null,
      contextId: null,
      inboxSection: 'friends' as const,
      createdAt,
      updatedAt,
      lastMessageAt: lastMessage?.createdAt ?? createdAt,
      lastMessage,
      unreadCount,
      unread: unreadCount > 0,
      activeCall: null,
      participants: [
        {
          userId: `family-member:${member.id}`,
          role: 'member',
          joinedAt: createdAt,
          lastReadAt: conversation?.childLastReadAt ? new Date(conversation.childLastReadAt) : null,
          mutedUntil: null,
          lastActivityAt: updatedAt,
          user: formatFamilyMemberThreadUser(member),
          isViewer: true,
        },
        {
          userId: member.parentId,
          role: 'member',
          joinedAt: createdAt,
          lastReadAt: conversation?.parentLastReadAt ? new Date(conversation.parentLastReadAt) : null,
          mutedUntil: null,
          lastActivityAt: updatedAt,
          user: deps.formatFriendUser(member.parent),
          isViewer: false,
        },
      ],
    }
  }

  function fetchFamilyParentConversationMessages(
    member: FamilyAuthMemberLike,
    conversation: FamilyParentConversationRecord | null,
    limit: number,
    cursor?: string,
  ) {
    const rows = conversation ? formatFamilyParentConversationMessage(conversation, member) : []
    const descending = [...rows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    const startIndex = cursor ? descending.findIndex((message) => message.id === cursor) + 1 : 0
    const paged = descending.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit + 1)

    let nextCursor: string | undefined
    if (paged.length > limit) {
      const next = paged.pop()!
      nextCursor = next.id
    }

    return {
      rows: paged.reverse(),
      nextCursor,
    }
  }

  return {
    extractMessageSystemMeta,
    fetchFamilyParentConversationMessages,
    fetchParentFamilyConversationMessages,
    formatFamilyMemberThreadUser,
    formatFamilyParentConversationMessage,
    formatMessage,
    formatNormalizedFamilyMemberThreadUser,
    formatParentFamilyConversationMessage,
    formatThreadParticipant,
    buildFamilyParentConversationThread,
    buildParentFamilyConversationThread,
    normalizeAttachmentList,
  }
}
