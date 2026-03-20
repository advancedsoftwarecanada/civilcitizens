'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import clsx from 'clsx'
import DashboardShell from '../_components/DashboardShell'
import MessagesNavBlock from '../_components/MessagesNavBlock'
import Modal from '../_components/Modal'
import CivilCard from '../_components/CivilCard'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { buildAddressesHrefFromAddress } from '../_lib/addressSearch'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildFamilyAvatarDataUrl } from '../_lib/familyIdentity'
import {
  DEFAULT_MESSAGES_NAV_SECTION,
  readStoredMessagesNavSection,
  writeStoredMessagesNavSection,
  type MessagesNavSection,
} from '../_lib/messagesNav'
import { hasFamilyModeEnabled, hasFamilyProfilesAvailable, type MeResponse } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'
import { formatUserDisplayName } from '../_lib/text'
import { getStoredToken } from '../_lib/tokenStorage'
import {
  HiOutlineArrowPath,
  HiOutlinePaperAirplane,
  HiOutlineChevronLeft,
  HiOutlinePhoto,
  HiOutlineXMark,
  HiOutlineCog6Tooth,
  HiOutlinePhone,
  HiOutlineVideoCamera,
} from 'react-icons/hi2'

const THREAD_PAGE_LIMIT = 20
const MESSAGE_PAGE_LIMIT = 20
const MOBILE_MORE_DRAWER_CLOSE_EVENT = 'civil:mobile-more-close'

function isFamilyConversationThreadId(threadId: string) {
  return threadId.startsWith('family-parent-') || threadId.startsWith('family-member-')
}

type ThreadUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
  isPremium: boolean
  isVerified: boolean
}

type ThreadParticipant = {
  userId: string
  role: string
  joinedAt: string
  lastReadAt: string | null
  mutedUntil: string | null
  lastActivityAt: string
  user: ThreadUser
  isViewer: boolean
}

type MessageSystemMeta = {
  kind: 'call_ended'
  reason: 'hangup' | 'no_answer'
  mode: 'audio' | 'video'
  callId: string
  callbackThreadId: string
  callbackLabel: string
  actorUserId: string | null
  actorName: string | null
} | {
  kind: 'market_payment_prompt'
  listingId: string
  options: MarketPaymentType[]
  selectedOption: MarketPaymentType | null
} | {
  kind: 'market_payment_selected'
  listingId: string
  selectedOption: MarketPaymentType
  selectedLabel: string
  civilPayUrl: string | null
  eTransferEmail: string | null
}

type MarketPaymentType = 'cash_pickup' | 'etransfer' | 'civil_wallet'

type MessagePayload = {
  id: string
  threadId: string
  body: string | null
  attachments: string[]
  systemMeta?: MessageSystemMeta | null
  messageType: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  senderId: string
  sender: ThreadUser
  isMine: boolean
}

type PendingAttachmentMessage = {
  id: string
  threadId: string
  body: string
  createdAt: string
}

type ThreadCall = {
  id: string
  threadId: string
  initiatorId: string
  endedByUserId: string | null
  roomId: string
  mode: 'audio' | 'video'
  status: 'ringing' | 'active' | 'ended'
  createdAt: string
  updatedAt: string
  startedAt: string | null
  lastJoinedAt: string | null
  endedAt: string | null
  initiator: ThreadUser
  isInitiator: boolean
}

type ThreadSummary = {
  id: string
  type: string
  contextType: string | null
  contextId: string | null
  inboxSection?: MessagesNavSection | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  participants: ThreadParticipant[]
  lastMessage: MessagePayload | null
  activeCall?: ThreadCall | null
  unreadCount?: number
  unread?: boolean
}

type ThreadListResponse = {
  items: ThreadSummary[]
  nextCursor?: string
}

type ThreadDetailResponse = {
  thread: Omit<ThreadSummary, 'lastMessage'>
  messages: MessagePayload[]
  nextCursor?: string
}

type MarketListingHeaderSummary = {
  id: string
  title: string
  status: string
  priceCents: number
  currency: string
  photoUrl: string | null
  pickupCity?: string | null
  pickupProvince?: string | null
  paymentTypes?: string[]
  selectedPaymentType?: MarketPaymentType | null
  civilPayStatus?: string | null
  civilPayAmountCents?: number | null
  civilPayFeeCents?: number | null
  civilPayPaidAt?: string | null
}

type MarketThreadContext = {
  listing: MarketListingHeaderSummary
  viewerIsSeller: boolean
  viewerIsSelectedBuyer?: boolean
  viewerCanAccessPickupAddress?: boolean
  pickupCompletedAt?: string | null
  buyerPickedUpAt?: string | null
  sellerPickedUpAt?: string | null
  pickupAddress?: {
    name?: string | null
    line1?: string | null
    line2?: string | null
    city?: string | null
    province?: string | null
    postalCode?: string | null
    country?: string | null
    latitude?: number | null
    longitude?: number | null
  } | null
  deliveryContract?: {
    id: string
    buyerUserId: string
    status: string
    bidAmountCents: number | null
    pickupInstructions: string | null
    itemTraits: string[]
    estimatedDeliveryAt: string | null
    pickedUpAt: string | null
    deliveredAt: string | null
    groupThreadId: string | null
    driver: {
      id: string
      handle: string | null
      name: string | null
      avatarUrl: string | null
    } | null
  } | null
  selectedBuyerUserId: string | null
  selectedThreadId: string | null
}

function formatMarketDeliveryStatus(status?: string | null) {
  switch ((status || '').trim().toLowerCase()) {
    case 'open':
      return 'Open for driver bids'
    case 'bid_pending':
      return 'Waiting for buyer approval'
    case 'assigned':
      return 'Driver assigned'
    case 'picked_up':
      return 'Picked up'
    case 'delivered':
      return 'Delivered'
    default:
      return 'Delivery requested'
  }
}

type MarketDeliveryDriver = NonNullable<NonNullable<MarketThreadContext['deliveryContract']>['driver']> | null | undefined

function formatMarketDeliveryDriverName(driver?: MarketDeliveryDriver) {
  if (!driver) return 'Civil driver'
  return driver.name?.trim() || (driver.handle ? `@${driver.handle}` : 'Civil driver')
}

type MarketInboxCounterpart = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
}

type MarketInboxItem = {
  threadId: string
  unreadCount?: number
  listingId: string
  listingTitle: string
  listingStatus: string
  listingPriceCents: number
  listingCurrency: string
  listingPhotoUrl: string | null
  listingPickupCity?: string | null
  listingPickupProvince?: string | null
  seller?: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
  } | null
  counterpart?: MarketInboxCounterpart | null
  lastMessageAt: string
  lastMessage?: {
    body: string | null
    senderId: string
    isMine: boolean
  } | null
}

type MarketInboxResponse = {
  yourListingChats?: MarketInboxItem[]
  activeItems?: MarketInboxItem[]
  inactiveItems?: MarketInboxItem[]
  soldItems?: MarketInboxItem[]
}

type MessageListResponse = {
  items: MessagePayload[]
  nextCursor?: string
}

type RealtimePayload = {
  type?: string
  data?: Record<string, unknown>
}

type FriendListItem = {
  id: string
  status?: string
  since?: string | null
  locked?: boolean
  specialKind?: 'family_sponsor' | 'family_child_friend'
  user: ThreadUser
}

type ConnectionListItem = {
  id: string
  status?: string
  since?: string | null
  user: ThreadUser
}

type FamilyProfileListItem = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  relationshipLabel: string
}

type PublicFamilyListResponse = {
  immediateFamily?: FamilyProfileListItem[]
  extendedFamily?: FamilyProfileListItem[]
}

type FamilyResponse = {
  profileRelationships?: Array<{
    id: string
    handle: string
    displayName: string
    relationshipLabel: string
    avatarUrl?: string | null
    coverUrl?: string | null
    latestPostAt?: string | null
  }>
}

type CreateDirectThreadResponse = {
  thread?: ThreadSummary
  error?: string
}

type MessageLinkPreview = {
  kind: string
  title: string
  description: string | null
  url: string
  imageUrl: string | null
  meta: string | null
}

type MessageLinkPreviewResponse = {
  preview?: MessageLinkPreview | null
}

type MessagesPageClientProps = {
  initialThreadId?: string
  initialInboxSection?: MessagesNavSection
}

function sortMessagesChronologically(messages: MessagePayload[]): MessagePayload[] {
  return [...messages].sort((a, b) => {
    const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    if (timeDelta !== 0) return timeDelta
    return a.id.localeCompare(b.id)
  })
}

function normalizeHeaders(input?: HeadersInit): Record<string, string> {
  if (!input) return {}
  if (input instanceof Headers) {
    const next: Record<string, string> = {}
    input.forEach((value, key) => {
      next[key] = value
    })
    return next
  }
  if (Array.isArray(input)) {
    return input.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
  }
  return { ...(input as Record<string, string>) }
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diffMs = now - date.getTime()
  const oneDayMs = 24 * 60 * 60 * 1000
  if (diffMs < oneDayMs) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: (currency || 'CAD').toUpperCase() }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

function formatPickupLocation(city?: string | null, province?: string | null) {
  const parts = [city?.trim(), province?.trim()].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Location unavailable'
}

function formatMarketListingStatus(status?: string | null) {
  const normalized = (status || '').trim().toLowerCase()
  if (!normalized) return 'Active'
  if (normalized === 'pending') return 'Pending pickup/delivery'
  if (normalized === 'sold') return 'Sold'
  if (normalized === 'canceled') return 'Canceled'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, ' ')
}

function supportsCivilPay(paymentTypes: string[] | null | undefined) {
  return Array.isArray(paymentTypes) && paymentTypes.includes('civil_wallet')
}

function formatMarketPaymentTypeLabel(value: MarketPaymentType) {
  switch (value) {
    case 'cash_pickup':
      return 'Cash on pickup'
    case 'etransfer':
      return 'eTransfer'
    case 'civil_wallet':
      return 'Civil Pay'
    default:
      return 'Payment'
  }
}

function resolveSelectedMarketPaymentType(messages: MessagePayload[], listingId?: string | null) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = messages[index]?.systemMeta
    if (!meta) continue
    if (listingId && 'listingId' in meta && meta.listingId !== listingId) continue
    if (meta.kind === 'market_payment_selected') return meta.selectedOption
    if (meta.kind === 'market_payment_prompt' && meta.selectedOption) return meta.selectedOption
  }
  return null
}

const getThreadTitle = (thread: ThreadSummary) => {
  const others = thread.participants.filter((participant) => !participant.isViewer)
  if (others.length === 0) return 'You'
  return others
    .map((participant) => formatUserDisplayName(participant.user.name, participant.user.handle) || `@${participant.user.handle}`)
    .join(', ')
}

function dismissMobileKeyboard() {
  if (typeof window === 'undefined') return
  if (!window.matchMedia('(max-width: 1023px)').matches) return
  const activeElement = document.activeElement as HTMLElement | null
  activeElement?.blur()
}

function isMobileMessagesViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 1023px)').matches
}

const MOBILE_KEYBOARD_OPEN_MIN_INSET = 90
const MOBILE_KEYBOARD_OPEN_MIN_DELTA = 140
const MOBILE_THREAD_MESSAGE_CLEARANCE_PX = 20

const threadHasUnreadFallback = (thread: ThreadSummary) => {
  const viewer = thread.participants.find((participant) => participant.isViewer)
  if (!viewer?.lastReadAt || !thread.lastMessage) return Boolean(thread.lastMessage)
  return new Date(thread.lastMessage.createdAt).getTime() > new Date(viewer.lastReadAt).getTime()
}

const threadHasUnread = (thread: ThreadSummary) => {
  if (typeof thread.unread === 'boolean') return thread.unread
  if (typeof thread.unreadCount === 'number' && Number.isFinite(thread.unreadCount)) return thread.unreadCount > 0
  return threadHasUnreadFallback(thread)
}

const threadUnreadCount = (thread: ThreadSummary) => {
  if (typeof thread.unreadCount === 'number' && Number.isFinite(thread.unreadCount)) {
    return Math.max(0, Math.floor(thread.unreadCount))
  }
  return threadHasUnread(thread) ? 1 : 0
}

function sortThreadsForInbox(threads: ThreadSummary[]) {
  return [...threads].sort((a, b) => {
    const unreadDelta = Number(threadHasUnread(b)) - Number(threadHasUnread(a))
    if (unreadDelta !== 0) return unreadDelta
    return new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime()
  })
}

function countUnreadInThreads(threads: ThreadSummary[]) {
  return threads.reduce((total, thread) => total + threadUnreadCount(thread), 0)
}

function getOtherParticipants(thread: ThreadSummary, viewerId?: string | null) {
  const byFlag = thread.participants.filter((participant) => !participant.isViewer)
  if (byFlag.length > 0) return byFlag
  if (viewerId) {
    const byId = thread.participants.filter((participant) => participant.userId !== viewerId)
    if (byId.length > 0) return byId
  }
  return thread.participants
}

function getPrimaryOtherParticipant(thread: ThreadSummary, viewerId?: string | null) {
  return getOtherParticipants(thread, viewerId)[0]
}

const HTTP_URL_REGEX = /https?:\/\/[^\s<>"']+/gi
const TRAILING_URL_PUNCTUATION = /[)\],.!?:;]+$/
const CIVIL_LINK_HOSTS = new Set([
  'dev.civilcitizens.ca',
  'civilcitizens.ca',
  'www.civilcitizens.ca',
  'civilvitizens.ca',
  'www.civilvitizens.ca',
])

function trimUrlPunctuation(raw: string): string {
  let value = raw.trim()
  while (TRAILING_URL_PUNCTUATION.test(value)) {
    const next = value.replace(TRAILING_URL_PUNCTUATION, '')
    if (next === value) break
    value = next
  }
  return value
}

function normalizeHttpUrl(raw: string): string | null {
  const trimmed = trimUrlPunctuation(raw)
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function isCivilUrl(rawUrl: string): boolean {
  const normalized = normalizeHttpUrl(rawUrl)
  if (!normalized) return false
  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase()
    if (CIVIL_LINK_HOSTS.has(host)) return true
    if (host.endsWith('.civilcitizens.ca') || host.endsWith('.civilvitizens.ca')) return true
    if (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase()) return true
    return false
  } catch {
    return false
  }
}

function extractUrlsFromMessage(body: string): string[] {
  const matches = body.match(HTTP_URL_REGEX)
  if (!matches) return []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const normalized = normalizeHttpUrl(match)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }
  return urls
}

function extractCivilUrlsFromMessage(body: string): string[] {
  return extractUrlsFromMessage(body).filter((url) => isCivilUrl(url))
}

function stripSuppressedUrlsFromBody(body: string, suppressedUrls: Set<string>): string {
  if (!body || suppressedUrls.size === 0) return body

  let output = ''
  const regex = new RegExp(HTTP_URL_REGEX.source, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(body)) !== null) {
    const rawMatch = match[0] ?? ''
    const matchStart = match.index
    const matchEnd = matchStart + rawMatch.length
    const displayUrl = trimUrlPunctuation(rawMatch)
    const normalizedUrl = normalizeHttpUrl(displayUrl)

    if (matchStart > lastIndex) {
      output += body.slice(lastIndex, matchStart)
    }

    if (!normalizedUrl || !suppressedUrls.has(normalizedUrl)) {
      output += rawMatch
    }

    lastIndex = matchEnd
  }

  if (lastIndex < body.length) {
    output += body.slice(lastIndex)
  }

  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function FamilyMemberMessagesShell({ viewer }: { viewer: MeResponse }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const familySession = viewer.familyMemberSession
  const parentHandle = familySession?.parentHandle?.trim() ?? ''
  const parentName = familySession?.parentName?.trim() || parentHandle || 'your parent or guardian'
  const parentProfileHref = parentHandle ? `/u/${encodeURIComponent(parentHandle)}` : '/friends'
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [activeThread, setActiveThread] = useState<Omit<ThreadSummary, 'lastMessage'> | null>(null)
  const [messagesByThreadId, setMessagesByThreadId] = useState<Record<string, MessagePayload[]>>({})
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [callActionMode, setCallActionMode] = useState<'audio' | 'video' | null>(null)
  const selectedThreadId = searchParams?.get('thread')?.trim() ?? ''
  const parentThreadId = `family-parent-${familySession?.parentId ?? 'parent'}`
  const selectedMessages = selectedThreadId ? messagesByThreadId[selectedThreadId] ?? [] : []
  const selectedIsParentThread = selectedThreadId === parentThreadId
  const callPermissions = {
    audio: familySession?.allowChildAudioCalls == null ? true : Boolean(familySession.allowChildAudioCalls),
    video: familySession?.allowChildVideoCalls == null ? true : Boolean(familySession.allowChildVideoCalls),
  }

  const loadThreads = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(buildApiUrl('/messages/threads?limit=40'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as ThreadListResponse | null
      if (!response.ok) {
        throw new Error('family_messages_threads_load_failed')
      }
      setThreads(Array.isArray(payload?.items) ? payload.items : [])
    } catch (error) {
      console.error('Failed to load family child message threads', error)
      pushToast('Unable to load messages right now.', 'error')
      setThreads([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const parentProfiles = useMemo(
    () => [{ id: familySession?.parentId ?? 'parent', handle: parentHandle, name: parentName, href: `/messages?thread=${encodeURIComponent(parentThreadId)}` }],
    [familySession?.parentId, parentHandle, parentName, parentThreadId],
  )

  const loadSelectedThread = useCallback(async () => {
    if (!selectedThreadId || selectedThreadId === parentThreadId) {
      setActiveThread(null)
      return
    }

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setThreadLoading(true)
    try {
      const response = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(selectedThreadId)}?limit=50`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as ThreadDetailResponse | { error?: string } | null
      if (!response.ok || !payload || !('thread' in payload) || !payload.thread) {
        setActiveThread(null)
        return
      }
      setActiveThread(payload.thread)
      setMessagesByThreadId((prev) => ({
        ...prev,
        [selectedThreadId]: sortMessagesChronologically(Array.isArray(payload.messages) ? payload.messages : []),
      }))
    } catch (error) {
      console.error('Failed to load family message thread', error)
      pushToast('Unable to open this conversation right now.', 'error')
      setActiveThread(null)
    } finally {
      setThreadLoading(false)
    }
  }, [parentThreadId, selectedThreadId])

  useEffect(() => {
    void loadSelectedThread()
  }, [loadSelectedThread])

  const handleSendMessage = useCallback(async () => {
    if (!activeThread || !selectedThreadId || selectedIsParentThread) return
    const body = composerText.trim()
    if (!body) return

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSending(true)
    try {
      const response = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(activeThread.id)}/messages`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as { message?: MessagePayload; error?: string } | null
      if (!response.ok || !payload?.message) {
        pushToast(payload?.error ?? 'Unable to send this message right now.', 'error')
        return
      }
      const message = payload.message

      setComposerText('')
      setMessagesByThreadId((prev) => ({
        ...prev,
        [activeThread.id]: sortMessagesChronologically([...(prev[activeThread.id] ?? []), message]),
      }))
      setThreads((prev) => {
        const nextThread = prev.find((thread) => thread.id === activeThread.id)
        if (!nextThread) return prev
        const updatedThread: ThreadSummary = {
          ...nextThread,
          lastMessage: message,
          lastMessageAt: message.createdAt,
          updatedAt: message.createdAt,
          unread: false,
          unreadCount: 0,
        }
        return [updatedThread, ...prev.filter((thread) => thread.id !== activeThread.id)]
      })
    } catch (error) {
      console.error('Failed to send family message', error)
      pushToast('Unable to send this message right now.', 'error')
    } finally {
      setSending(false)
    }
  }, [activeThread, composerText, selectedIsParentThread, selectedThreadId])

  const handleStartCall = useCallback(async (mode: 'audio' | 'video') => {
    if (selectedIsParentThread) {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      if ((mode === 'audio' && !callPermissions.audio) || (mode === 'video' && !callPermissions.video)) return
      if (!viewer.id) return

      setCallActionMode(mode)
      try {
        const response = await fetch(buildApiUrl('/family/calls/start'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ memberId: viewer.id, mode }),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        const payload = (await response.json().catch(() => null)) as { call?: { id?: string | null } | null; error?: string } | null
        if (!response.ok || !payload?.call?.id) {
          pushToast(payload?.error ?? 'Unable to start this Family call right now.', 'error')
          return
        }
        router.push(`/family/call/${encodeURIComponent(viewer.id)}?call=${encodeURIComponent(payload.call.id)}`)
      } catch (error) {
        console.error('Failed to start parent Family call', error)
        pushToast('Unable to start this Family call right now.', 'error')
      } finally {
        setCallActionMode(null)
      }
      return
    }

    if (!activeThread) return
    if ((mode === 'audio' && !callPermissions.audio) || (mode === 'video' && !callPermissions.video)) return

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setCallActionMode(mode)
    try {
      const response = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(activeThread.id)}/call/start`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as { call?: ThreadCall; error?: string } | null
      if (!response.ok || !payload?.call?.id) {
        pushToast(payload?.error ?? 'Unable to start this call right now.', 'error')
        return
      }
      router.push(`/messages/call/${encodeURIComponent(activeThread.id)}?call=${encodeURIComponent(payload.call.id)}`)
    } catch (error) {
      console.error('Failed to start family call', error)
      pushToast('Unable to start this call right now.', 'error')
    } finally {
      setCallActionMode(null)
    }
  }, [activeThread, callPermissions.audio, callPermissions.video, router, selectedIsParentThread, viewer.id])

  const activeThreadTitle = activeThread ? getThreadTitle({ ...activeThread, lastMessage: null } as ThreadSummary) : ''
  const activeThreadPrimaryUser = activeThread?.participants.find((participant) => !participant.isViewer)?.user ?? null
  const activeThreadProfileHref = activeThreadPrimaryUser?.handle ? `/u/${encodeURIComponent(activeThreadPrimaryUser.handle)}` : null

  const rightRail = (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Your Parents</p>
        <div className="mt-4 space-y-3">
          {parentProfiles.map((parent) => {
            const parentDisplayName = formatUserDisplayName(parent.name, parent.handle) || parent.name || parent.handle || 'Parent'
            return (
              <CivilCard
                key={parent.id}
                href={parent.href}
                size="rail"
                name={parentDisplayName}
                avatarAlt={parentDisplayName}
                avatarInitials={parentDisplayName}
                subtitle={parent.handle ? `@${parent.handle}` : 'Parent profile'}
              />
            )
          })}
        </div>
      </section>
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">Add Friends</p>
        <p className="mt-2 text-sm text-slate-600">Find friends and send a request from your Family account.</p>
        <div className="mt-4">
          <Link href="/friends" className="inline-flex w-full items-center justify-center rounded-full border border-[var(--cc-primary)] bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]">
            Add Friends
          </Link>
        </div>
      </section>
    </div>
  )

  return (
    <DashboardShell rightRail={rightRail} rightRailClassName="pt-0" rightRailTopClassName="pt-0">
      <div className="space-y-5 pb-8">
        <section className="rounded-[32px] border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Messages</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950">Your Messages</h1>
              <p className="mt-1 text-sm text-slate-600">Messages between you and your approved friends appear here.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {threads.length} {threads.length === 1 ? 'conversation' : 'conversations'}
            </div>
          </div>

          {loading ? (
            <div className="mt-5 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-[84px] animate-pulse rounded-[1.45rem] border border-slate-200 bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              <div className="space-y-3">
                <Link
                  href={`/messages?thread=${encodeURIComponent(parentThreadId)}`}
                  className={clsx(
                    'flex items-center gap-3 rounded-[1.6rem] border px-4 py-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50/70',
                    selectedIsParentThread ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5' : 'border-[var(--cc-primary)]/25 bg-[var(--cc-primary)]/5',
                  )}
                >
                  <VerifiedAvatar
                    src={null}
                    alt={parentName}
                    initials={parentName}
                    size={48}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{parentName}</p>
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cc-primary)]">Parent</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-600">Open your parent profile details.</p>
                    <p className="mt-1 truncate text-xs text-slate-400">{parentHandle ? `@${parentHandle}` : 'Parent profile'}</p>
                  </div>
                </Link>

                <ul className="space-y-3">
                  {threads.length === 0 ? (
                    <li>
                      <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 shadow-sm">
                        No messages yet. Add friends to start building this inbox.
                      </div>
                    </li>
                  ) : null}
                  {threads.map((thread) => {
                    const otherParticipants = thread.participants.filter((participant) => !participant.isViewer)
                    const title = getThreadTitle(thread)
                    const primaryUser = otherParticipants[0]?.user ?? null
                    const avatarSrc = primaryUser?.avatarUrl ?? buildFamilyAvatarDataUrl(title, familySession?.modeBand ?? 'JUNIOR')
                    const lastMessage = thread.lastMessage
                    const lastSnippet = lastMessage?.body?.trim() || (lastMessage?.attachments.length ? 'Attachment' : 'No messages yet.')
                    const isSelected = selectedThreadId === thread.id
                    return (
                      <li key={thread.id}>
                        <Link
                          href={`/messages?thread=${encodeURIComponent(thread.id)}`}
                          className={clsx(
                            'flex items-center gap-3 rounded-[1.6rem] border bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50/70',
                            isSelected ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5' : 'border-slate-200',
                          )}
                        >
                          <VerifiedAvatar
                            src={avatarSrc}
                            alt={title}
                            initials={title}
                            size={48}
                            isVerified={Boolean(primaryUser?.isVerified)}
                            isBusiness={Boolean(primaryUser?.isPremium)}
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
                              <span className="shrink-0 text-xs text-slate-400">{formatTimestamp(thread.lastMessageAt || thread.updatedAt)}</span>
                            </div>
                            <p className="mt-1 truncate text-sm text-slate-600">{lastSnippet}</p>
                            <p className="mt-1 truncate text-xs text-slate-400">{thread.type === 'group' ? `${thread.participants.length} participants` : primaryUser?.handle ? `@${primaryUser.handle}` : 'Direct conversation'}</p>
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <section className="min-h-[24rem] rounded-[1.8rem] border border-slate-200 bg-slate-50/80 p-4 shadow-inner">
                {selectedIsParentThread ? (
                  <div className="flex h-full flex-col justify-between gap-4 rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--cc-primary)]">Parent</p>
                      <h2 className="mt-2 text-xl font-semibold text-slate-950">{parentName}</h2>
                      <p className="mt-2 text-sm text-slate-600">
                        Your parent profile is available here from the Family shell. Friend conversations stay separate and only show threads created for this child account.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleStartCall('audio')}
                        disabled={callActionMode !== null || !callPermissions.audio}
                        className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {callActionMode === 'audio' ? 'Calling...' : 'Audio Call'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStartCall('video')}
                        disabled={callActionMode !== null || !callPermissions.video}
                        className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {callActionMode === 'video' ? 'Starting video...' : 'Video Call'}
                      </button>
                      <Link href={parentProfileHref} className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900">
                        View Parent Profile
                      </Link>
                    </div>
                  </div>
                ) : !selectedThreadId ? (
                  <div className="flex h-full items-center justify-center rounded-[1.4rem] border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
                    Select a conversation to open it.
                  </div>
                ) : threadLoading ? (
                  <div className="space-y-3">
                    <div className="h-16 animate-pulse rounded-[1.2rem] bg-white" />
                    <div className="h-24 animate-pulse rounded-[1.2rem] bg-white" />
                    <div className="h-24 animate-pulse rounded-[1.2rem] bg-white" />
                  </div>
                ) : !activeThread ? (
                  <div className="flex h-full items-center justify-center rounded-[1.4rem] border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
                    This conversation is not available for this child account.
                  </div>
                ) : (
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        {activeThread.type === 'group' || !activeThreadProfileHref ? (
                          <>
                            <VerifiedAvatar
                              src={activeThreadPrimaryUser?.avatarUrl ?? buildFamilyAvatarDataUrl(activeThreadTitle, familySession?.modeBand ?? 'JUNIOR')}
                              alt={activeThreadTitle}
                              initials={activeThreadTitle}
                              size={48}
                              isVerified={Boolean(activeThreadPrimaryUser?.isVerified)}
                              isBusiness={Boolean(activeThreadPrimaryUser?.isPremium)}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{activeThreadTitle}</p>
                              <p className="truncate text-xs text-slate-500">
                                {activeThread.type === 'group'
                                  ? `${activeThread.participants.length} participants`
                                  : activeThreadPrimaryUser?.handle
                                    ? `@${activeThreadPrimaryUser.handle}`
                                    : 'Direct conversation'}
                              </p>
                            </div>
                          </>
                        ) : (
                          <Link href={activeThreadProfileHref} className="flex min-w-0 items-center gap-3 rounded-full transition hover:opacity-80">
                            <VerifiedAvatar
                              src={activeThreadPrimaryUser?.avatarUrl ?? buildFamilyAvatarDataUrl(activeThreadTitle, familySession?.modeBand ?? 'JUNIOR')}
                              alt={activeThreadTitle}
                              initials={activeThreadTitle}
                              size={48}
                              isVerified={Boolean(activeThreadPrimaryUser?.isVerified)}
                              isBusiness={Boolean(activeThreadPrimaryUser?.isPremium)}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{activeThreadTitle}</p>
                              <p className="truncate text-xs text-slate-500">
                                {activeThreadPrimaryUser?.handle ? `@${activeThreadPrimaryUser.handle}` : 'Direct conversation'}
                              </p>
                            </div>
                          </Link>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleStartCall('audio')}
                          disabled={callActionMode !== null || !callPermissions.audio}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {callActionMode === 'audio' ? 'Calling...' : 'Audio Call'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStartCall('video')}
                          disabled={callActionMode !== null || !callPermissions.video}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {callActionMode === 'video' ? 'Starting video...' : 'Video Call'}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto rounded-[1.4rem] border border-slate-200 bg-white p-4 shadow-sm">
                      {selectedMessages.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-slate-500">No messages yet. Say hello to start the conversation.</div>
                      ) : (
                        selectedMessages.map((message) => (
                          <div key={message.id} className={clsx('flex', message.isMine ? 'justify-end' : 'justify-start')}>
                            <div
                              className={clsx(
                                'max-w-[85%] rounded-[1.35rem] px-4 py-3 text-sm shadow-sm',
                                message.isMine ? 'bg-[var(--cc-primary)] text-white' : 'bg-slate-100 text-slate-800',
                              )}
                            >
                              {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                              {message.attachments.length ? (
                                <div className={clsx('space-y-1', message.body ? 'mt-2' : '')}>
                                  {message.attachments.map((attachmentUrl) => (
                                    <a
                                      key={attachmentUrl}
                                      href={attachmentUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={clsx(
                                        'block break-all underline underline-offset-2',
                                        message.isMine ? 'text-white/90' : 'text-[var(--cc-primary)]',
                                      )}
                                    >
                                      {attachmentUrl}
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                              <p className={clsx('mt-2 text-[11px]', message.isMine ? 'text-white/80' : 'text-slate-500')}>
                                {formatTimestamp(message.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <form
                      className="flex items-end gap-3 rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void handleSendMessage()
                      }}
                    >
                      <textarea
                        value={composerText}
                        onChange={(event) => setComposerText(event.target.value)}
                        rows={3}
                        placeholder="Write a message"
                        className="min-h-[5.5rem] flex-1 resize-none rounded-[1.1rem] border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                      />
                      <button
                        type="submit"
                        disabled={sending || !composerText.trim()}
                        className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {sending ? 'Sending...' : 'Send'}
                      </button>
                    </form>
                  </div>
                )}
              </section>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  )
}

function StandardMessagesPageClient({ initialThreadId, initialInboxSection, viewer }: MessagesPageClientProps & { viewer?: MeResponse | null }) {
  const router = useRouter()
  const isFamilySession = viewer?.accountType === 'family_member'
  const showFamilyInbox = !isFamilySession && hasFamilyProfilesAvailable(viewer)
  const familySession = viewer?.familyMemberSession ?? null
  const familyParentThreadId = isFamilySession ? `family-parent-${viewer?.familyMemberSession?.parentId ?? 'parent'}` : null
  const familyParentHandle = viewer?.familyMemberSession?.parentHandle?.trim() ?? ''
  const familyParentName = viewer?.familyMemberSession?.parentName?.trim() || familyParentHandle || 'Parent account'
  const familyCallPermissions = {
    audio: familySession?.allowChildAudioCalls == null ? true : Boolean(familySession.allowChildAudioCalls),
    video: familySession?.allowChildVideoCalls == null ? true : Boolean(familySession.allowChildVideoCalls),
  }
  const tokenRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const mobileComposerLastTouchAtRef = useRef(0)
  const threadPanelRef = useRef<HTMLDivElement | null>(null)
  const threadHeaderRef = useRef<HTMLElement | null>(null)
  const mobileComposerShellRef = useRef<HTMLDivElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const bottomSettleTimeoutsRef = useRef<number[]>([])
  const smoothScrollPendingRef = useRef(false)
  const preserveScrollRef = useRef<{
    threadId: string
    scrollTop: number
    scrollHeight: number
  } | null>(null)
  const selectedThreadRef = useRef<string | null>(initialThreadId ?? null)
  const initialThreadIdRef = useRef<string | null>(initialThreadId ?? null)
  const explicitThreadOpenRef = useRef<string | null>(null)
  const forceBottomScrollThreadRef = useRef<string | null>(initialThreadId ?? null)
  const failedThreadDetailRef = useRef<Set<string>>(new Set())
  const shownThreadDetailErrorRef = useRef<Set<string>>(new Set())
  const pendingLinkPreviewUrlsRef = useRef<Set<string>>(new Set())
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messagesViewportRef.current
    if (!container) return
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior })
      container.scrollTo({ top: container.scrollHeight, behavior })
      // Run a second frame in case async layout (images/preview cards) shifts height right after render.
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      })
      window.setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      }, 180)
    })
  }, [])

  const scheduleMessagesBottomSettle = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      if (typeof window === 'undefined') return
      for (const timeoutId of bottomSettleTimeoutsRef.current) {
        window.clearTimeout(timeoutId)
      }
      bottomSettleTimeoutsRef.current = []

      scrollMessagesToBottom(behavior)

      for (const delay of [60, 140, 260, 420]) {
        const timeoutId = window.setTimeout(() => {
          scrollMessagesToBottom('auto')
        }, delay)
        bottomSettleTimeoutsRef.current.push(timeoutId)
      }
    },
    [scrollMessagesToBottom],
  )

  const handleMobileComposerPressStart = useCallback((event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const markMobileComposerTouch = useCallback(() => {
    mobileComposerLastTouchAtRef.current = Date.now()
  }, [])

  const shouldIgnoreMobileComposerClick = useCallback(() => Date.now() - mobileComposerLastTouchAtRef.current < 750, [])

  useEffect(() => {
    if (!initialThreadId) return
    initialThreadIdRef.current = initialThreadId
    if (selectedThreadRef.current === initialThreadId) return
    forceBottomScrollThreadRef.current = initialThreadId
    smoothScrollPendingRef.current = false
    setSelectedThreadId(initialThreadId)
  }, [initialThreadId])

  useEffect(() => {
    if (lightboxUrl) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [lightboxUrl])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return
      for (const timeoutId of bottomSettleTimeoutsRef.current) {
        window.clearTimeout(timeoutId)
      }
      bottomSettleTimeoutsRef.current = []
    }
  }, [])
  const [me, setMe] = useState<MeResponse | null>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [threadCursor, setThreadCursor] = useState<string | null>(null)
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId ?? null)
  const [messagesByThread, setMessagesByThread] = useState<Record<string, MessagePayload[]>>({})
  const [messageCursors, setMessageCursors] = useState<Record<string, string | null>>({})
  const [messageLinkPreviews, setMessageLinkPreviews] = useState<Record<string, MessageLinkPreview | null>>({})
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null)
  const [loadingOlderThreadId, setLoadingOlderThreadId] = useState<string | null>(null)
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [streamKey, setStreamKey] = useState(0)
  const [attachments, setAttachments] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [pendingAttachmentMessagesByThread, setPendingAttachmentMessagesByThread] = useState<Record<string, PendingAttachmentMessage[]>>({})
  const [manageMembersOpen, setManageMembersOpen] = useState(false)
  const [groupCandidatesLoading, setGroupCandidatesLoading] = useState(false)
  const [groupCandidates, setGroupCandidates] = useState<ThreadUser[]>([])
  const [groupCandidateFilter, setGroupCandidateFilter] = useState('')
  const [groupMemberFilter, setGroupMemberFilter] = useState('')
  const [memberActionLoadingId, setMemberActionLoadingId] = useState<string | null>(null)
  const [leavingGroup, setLeavingGroup] = useState(false)
  const [callActionMode, setCallActionMode] = useState<'audio' | 'video' | null>(null)
  const [callPermissionModalOpen, setCallPermissionModalOpen] = useState(false)
  const [activeInboxSection, setActiveInboxSection] = useState<MessagesNavSection>(
    initialInboxSection && (initialInboxSection !== 'family' || showFamilyInbox)
      ? initialInboxSection
      : DEFAULT_MESSAGES_NAV_SECTION,
  )
  const [friendContactIds, setFriendContactIds] = useState<string[]>([])
  const [networkContactIds, setNetworkContactIds] = useState<string[]>([])
  const [familyProfileContacts, setFamilyProfileContacts] = useState<FamilyProfileListItem[]>([])
  const [startingFamilyThreadUserId, setStartingFamilyThreadUserId] = useState<string | null>(null)
  const [marketUnreadCount, setMarketUnreadCount] = useState(0)
  const [marketInboxItemsByThreadId, setMarketInboxItemsByThreadId] = useState<Record<string, MarketInboxItem>>({})
  const [marketInboxLoading, setMarketInboxLoading] = useState(false)
  const [marketInboxError, setMarketInboxError] = useState<string | null>(null)
  const [marketThreadContext, setMarketThreadContext] = useState<MarketThreadContext | null>(null)
  const [marketThreadContextLoading, setMarketThreadContextLoading] = useState(false)
  const [marketHeaderActionError, setMarketHeaderActionError] = useState<string | null>(null)
  const [marketPaymentSelectionSubmitting, setMarketPaymentSelectionSubmitting] = useState<MarketPaymentType | null>(null)
  const [marketSelectBuyerConfirmOpen, setMarketSelectBuyerConfirmOpen] = useState(false)
  const [marketSelectBuyerSubmitting, setMarketSelectBuyerSubmitting] = useState(false)
  const [marketUnselectBuyerConfirmOpen, setMarketUnselectBuyerConfirmOpen] = useState(false)
  const [marketUnselectBuyerSubmitting, setMarketUnselectBuyerSubmitting] = useState(false)
  const [marketMarkSoldConfirmOpen, setMarketMarkSoldConfirmOpen] = useState(false)
  const [marketMarkSoldSubmitting, setMarketMarkSoldSubmitting] = useState(false)
  const [contactsBucketReady, setContactsBucketReady] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerTextareaRef = useRef<HTMLInputElement | null>(null)
  const composerInputRef = useRef<HTMLInputElement | null>(null)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0)
  const [mobileThreadPanelHeight, setMobileThreadPanelHeight] = useState<string | null>(null)
  const [mobileMessagesViewportHeight, setMobileMessagesViewportHeight] = useState<string | null>(null)
  const isNativeIosRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    isNativeIosRef.current = document.documentElement.classList.contains('cc-native-ios')
    const mediaQuery = window.matchMedia('(max-width: 1023px)')
    const syncMobileViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncMobileViewport()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncMobileViewport)
    } else {
      mediaQuery.addListener(syncMobileViewport)
    }
    window.addEventListener('resize', syncMobileViewport)
    window.addEventListener('orientationchange', syncMobileViewport)

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncMobileViewport)
      } else {
        mediaQuery.removeListener(syncMobileViewport)
      }
      window.removeEventListener('resize', syncMobileViewport)
      window.removeEventListener('orientationchange', syncMobileViewport)
    }
  }, [])

  const syncMobileKeyboardState = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!isMobileViewport || !composerFocused) {
      setMobileKeyboardInset(0)
      return
    }

    const viewport = window.visualViewport
    const viewportHeight = viewport?.height ?? window.innerHeight
    const viewportOffsetTop = viewport?.offsetTop ?? 0
    const keyboardInset = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop)
    const heightDelta = Math.max(0, window.innerHeight - viewportHeight)
    const keyboardOpen = keyboardInset > MOBILE_KEYBOARD_OPEN_MIN_INSET || heightDelta > MOBILE_KEYBOARD_OPEN_MIN_DELTA

    setMobileKeyboardInset(keyboardOpen ? keyboardInset : 0)
  }, [composerFocused, isMobileViewport])

  useEffect(() => {
    syncMobileKeyboardState()
  }, [syncMobileKeyboardState])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleViewportChange = () => {
      syncMobileKeyboardState()
    }
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', handleViewportChange)
    viewport?.addEventListener('scroll', handleViewportChange)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)

    return () => {
      viewport?.removeEventListener('resize', handleViewportChange)
      viewport?.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [syncMobileKeyboardState])

  useEffect(() => {
    if (initialInboxSection && (initialInboxSection !== 'family' || showFamilyInbox)) {
      setActiveInboxSection(initialInboxSection)
      writeStoredMessagesNavSection(initialInboxSection)
      return
    }
    if (initialThreadId) {
      setActiveInboxSection(DEFAULT_MESSAGES_NAV_SECTION)
      writeStoredMessagesNavSection(DEFAULT_MESSAGES_NAV_SECTION)
      return
    }
    const stored = readStoredMessagesNavSection()
    if (!stored) {
      setActiveInboxSection(DEFAULT_MESSAGES_NAV_SECTION)
      return
    }
    if (stored === 'family' && !showFamilyInbox) {
      setActiveInboxSection(DEFAULT_MESSAGES_NAV_SECTION)
      return
    }
    setActiveInboxSection(stored)
  }, [initialInboxSection, initialThreadId, showFamilyInbox])

  useEffect(() => {
    selectedThreadRef.current = selectedThreadId
    if (!selectedThreadId) return
    forceBottomScrollThreadRef.current = selectedThreadId
    smoothScrollPendingRef.current = false
    scrollMessagesToBottom('auto')
  }, [selectedThreadId, scrollMessagesToBottom])

  useEffect(() => {
    if (!isMobileMessagesViewport()) return

    // Mobile layout normally starts with the thread list.
    // But if we were deep-linked into a specific thread (push tap), keep it selected.
    if (initialThreadIdRef.current) return

    setSelectedThreadId(null)
    selectedThreadRef.current = null
    initialThreadIdRef.current = null
  }, [])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    tokenRef.current = token
    setAuthReady(true)
  }, [])

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = tokenRef.current
      if (!token) {
        redirectToAuthModal('login')
        throw new Error('unauthenticated')
      }
      const headers = normalizeHeaders(init?.headers)
      headers.authorization = `Bearer ${token}`
      return fetch(buildApiUrl(path), { ...init, headers })
    },
    [],
  )

  const markThreadRead = useCallback(
    async (threadId: string, messageId?: string) => {
      try {
        const payload = isFamilyConversationThreadId(threadId) || !messageId ? {} : { messageId }
        await authedFetch(`/messages/threads/${threadId}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        window.dispatchEvent(new CustomEvent('message.read'))
      } catch (err) {
        console.error('Failed to mark thread as read', err)
      }
    },
    [authedFetch],
  )

  const loadSupplementalUnreadCounts = useCallback(async () => {
    if (isFamilySession) {
      setMarketUnreadCount(0)
      return
    }

    try {
      const marketRes = await authedFetch('/market/chats/unread-count')
      if (marketRes.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (marketRes.ok) {
        const payload = (await marketRes.json().catch(() => null)) as { count?: number } | null
        setMarketUnreadCount(Number(payload?.count) || 0)
      }
    } catch (error) {
      console.error('Failed to load supplemental message unread counts', error)
      setMarketUnreadCount(0)
    }
  }, [authedFetch, isFamilySession])

  const loadMarketInbox = useCallback(async () => {
    if (isFamilySession) {
      setMarketInboxItemsByThreadId({})
      setMarketInboxError(null)
      setMarketInboxLoading(false)
      return
    }

    setMarketInboxLoading(true)
    setMarketInboxError(null)
    try {
      const response = await authedFetch('/market/chats', { cache: 'no-store' })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        throw new Error('failed_market_inbox')
      }

      const payload = (await response.json().catch(() => null)) as MarketInboxResponse | null
      const items = [
        ...(Array.isArray(payload?.yourListingChats) ? payload.yourListingChats : []),
        ...(Array.isArray(payload?.activeItems) ? payload.activeItems : []),
        ...(Array.isArray(payload?.inactiveItems) ? payload.inactiveItems : []),
        ...(Array.isArray(payload?.soldItems) ? payload.soldItems : []),
      ]
      const nextByThreadId = items.reduce<Record<string, MarketInboxItem>>((acc, item) => {
        if (item?.threadId) acc[item.threadId] = item
        return acc
      }, {})
      setMarketInboxItemsByThreadId(nextByThreadId)
    } catch (error) {
      console.error('Failed to load market inbox', error)
      setMarketInboxError('Unable to load marketplace chats.')
    } finally {
      setMarketInboxLoading(false)
    }
  }, [authedFetch, isFamilySession])

  const upsertThread = useCallback((incoming: ThreadSummary) => {
    setThreads((prev) => {
      const next = [...prev]
      const index = next.findIndex((thread) => thread.id === incoming.id)
      if (index >= 0) {
        next[index] = { ...next[index], ...incoming }
      } else {
        next.push(incoming)
      }
      next.sort((a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime())
      return next
    })
  }, [])

  const markThreadReadLocally = useCallback((threadId: string, readAtIso: string) => {
    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id !== threadId) return thread
        return {
          ...thread,
          unread: false,
          unreadCount: 0,
          participants: thread.participants.map((participant) =>
            participant.isViewer ? { ...participant, lastReadAt: readAtIso } : participant,
          ),
        }
      }),
    )
  }, [])

  const handleRealtime = useCallback(
    (payload: RealtimePayload) => {
      if (!payload?.type) return
      if (payload.type === 'thread.created') {
        const thread = payload.data?.thread as ThreadSummary | undefined
        if (thread) {
          upsertThread(thread)
        }
        return
      }
      if (payload.type === 'thread.updated') {
        const thread = payload.data?.thread as ThreadSummary | undefined
        if (thread) {
          upsertThread(thread)
        }
        return
      }
      if (payload.type === 'thread.removed') {
        const threadId = typeof payload.data?.threadId === 'string' ? payload.data.threadId : null
        if (!threadId) return
        setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
        setMessagesByThread((prev) => {
          const next = { ...prev }
          delete next[threadId]
          return next
        })
        setMessageCursors((prev) => {
          const next = { ...prev }
          delete next[threadId]
          return next
        })
        setSelectedThreadId((prev) => (prev === threadId ? null : prev))
        return
      }
      if (payload.type === 'message.created') {
        const threadId = typeof payload.data?.threadId === 'string' ? (payload.data?.threadId as string) : null
        const message = payload.data?.message as MessagePayload | undefined
        if (!threadId || !message) return
        setMessagesByThread((prev) => {
          const existing = prev[threadId] ?? []
          if (existing.some((item) => item.id === message.id)) return prev
          const next = [...existing, message]
          next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          return { ...prev, [threadId]: next }
        })
        setThreads((prev) => {
          const next = [...prev]
          const index = next.findIndex((thread) => thread.id === threadId)
          if (index === -1) return prev
          const existing = next[index]
          if (!existing) return prev
          const isActiveThread = selectedThreadRef.current === threadId
          const shouldMarkRead = isActiveThread || message.isMine
          const nextUnreadCount = shouldMarkRead ? 0 : threadUnreadCount(existing) + 1
          next[index] = {
            ...existing,
            lastMessage: message,
            lastMessageAt: message.createdAt,
            unread: nextUnreadCount > 0,
            unreadCount: nextUnreadCount,
            participants: existing.participants.map((participant) =>
              participant.isViewer && shouldMarkRead ? { ...participant, lastReadAt: message.createdAt } : participant,
            ),
          }
          next.sort((a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime())
          return next
        })
        if (selectedThreadRef.current === threadId) {
          forceBottomScrollThreadRef.current = threadId
          smoothScrollPendingRef.current = false
          scheduleMessagesBottomSettle('auto')
          markThreadReadLocally(threadId, message.createdAt)
          void markThreadRead(threadId, message.id)
          // Dispatch event to update TopNav count immediately
          window.dispatchEvent(new CustomEvent('message.read'))
        }
        void loadSupplementalUnreadCounts()
      }
    },
    [loadSupplementalUnreadCounts, markThreadRead, markThreadReadLocally, scrollMessagesToBottom, upsertThread],
  )

  useEffect(() => {
    if (!authReady) return
    const token = tokenRef.current
    if (!token) return
    const streamUrl = `${buildApiUrl('/notifications/stream')}?token=${encodeURIComponent(token)}`
    const source = new EventSource(streamUrl)
    eventSourceRef.current = source
    source.onmessage = (event) => {
      if (!event.data) return
      try {
        const payload = JSON.parse(event.data) as RealtimePayload
        if (payload.type === 'connected') return
        handleRealtime(payload)
      } catch (err) {
        console.error('Failed to parse realtime payload', err)
      }
    }
    source.onerror = () => {
      source.close()
      eventSourceRef.current = null
      setTimeout(() => setStreamKey((key) => key + 1), 3000)
    }
    return () => {
      source.close()
      eventSourceRef.current = null
    }
  }, [authReady, handleRealtime, streamKey])

  const loadMe = useCallback(async () => {
    try {
      const token = tokenRef.current
      const payload = await ensureViewerMe({ token })

      if (!payload) {
        const tokenStillPresent = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : Boolean(token)
        if (!tokenStillPresent) {
          redirectToAuthModal('login')
          return
        }
        throw new Error('failed_me')
      }

      setMe(payload)
    } catch (err) {
      console.error('Failed to load viewer profile', err)
      pushToast('Unable to load your profile right now.', 'error')
    }
  }, [])

  const loadThreads = useCallback(
    async (cursor?: string, append = false) => {
      setThreadsLoading(true)
      setThreadsError(null)
      try {
        const params = new URLSearchParams({ limit: String(THREAD_PAGE_LIMIT) })
        if (cursor) params.set('cursor', cursor)
        const response = await authedFetch(`/messages/threads?${params.toString()}`)
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) {
          throw new Error('failed_threads')
        }
        const payload = (await response.json()) as ThreadListResponse
        setThreadCursor(payload.nextCursor ?? null)
        setThreads((prev) => {
          const base = append ? [...prev] : prev.filter((thread) => thread.contextType === 'market_listing')
          payload.items.forEach((thread) => {
            const index = base.findIndex((item) => item.id === thread.id)
            if (index >= 0) {
              base[index] = { ...base[index], ...thread }
            } else {
              base.push(thread)
            }
          })
          base.sort((a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime())
          return base
        })
        if (!selectedThreadRef.current && initialThreadIdRef.current) {
          setSelectedThreadId(initialThreadIdRef.current)
          initialThreadIdRef.current = null
        }
      } catch (err) {
        console.error('Failed to load threads', err)
        setThreadsError('Unable to load your conversations right now.')
      } finally {
        setThreadsLoading(false)
      }
    },
    [authedFetch],
  )

  const loadContactBuckets = useCallback(async () => {
    if (isFamilySession) {
      setFriendContactIds([])
      setNetworkContactIds([])
      setContactsBucketReady(true)
      return
    }

    setContactsBucketReady(false)
    try {
      const [friendsRes, connectionsRes] = await Promise.all([authedFetch('/friends'), authedFetch('/connections')])
      if (friendsRes.status === 401 || connectionsRes.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!friendsRes.ok || !connectionsRes.ok) {
        throw new Error('failed_contact_buckets')
      }
      const friendsPayload = (await friendsRes.json().catch(() => null)) as { items?: FriendListItem[] } | null
      const connectionsPayload = (await connectionsRes.json().catch(() => null)) as { items?: ConnectionListItem[] } | null

      const friendIds = (Array.isArray(friendsPayload?.items) ? friendsPayload.items : [])
        .map((entry) => entry.user?.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      const networkIds = (Array.isArray(connectionsPayload?.items) ? connectionsPayload.items : [])
        .map((entry) => entry.user?.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)

      setFriendContactIds(Array.from(new Set(friendIds)))
      setNetworkContactIds(Array.from(new Set(networkIds)))
    } catch (error) {
      console.error('Failed to load message contact buckets', error)
      setFriendContactIds([])
      setNetworkContactIds([])
    } finally {
      setContactsBucketReady(true)
    }
  }, [authedFetch, isFamilySession])

  const loadFamilyProfileContacts = useCallback(async () => {
    if (isFamilySession) {
      setFamilyProfileContacts([])
      return
    }

    const viewerHandle = me?.handle?.trim()
    if (!viewerHandle) {
      setFamilyProfileContacts([])
      return
    }

    try {
      const response = await authedFetch('/family', { cache: 'no-store' })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as FamilyResponse | null
        const nextRelationships = Array.isArray(payload?.profileRelationships)
          ? payload.profileRelationships.map((entry) => ({
              id: entry.id,
              handle: entry.handle,
              name: entry.displayName,
              avatarUrl: entry.avatarUrl ?? null,
              coverUrl: entry.coverUrl ?? null,
              relationshipLabel: entry.relationshipLabel,
            }))
          : []

        if (nextRelationships.length > 0) {
          setFamilyProfileContacts(Array.from(new Map(nextRelationships.map((entry) => [entry.id, entry])).values()))
          return
        }
      }

      const publicResponse = await fetch(buildApiUrl(`/users/${encodeURIComponent(viewerHandle)}/family`), {
        cache: 'no-store',
      })
      if (!publicResponse.ok) {
        throw new Error('failed_family_profiles')
      }
      const publicPayload = (await publicResponse.json().catch(() => null)) as PublicFamilyListResponse | null
      const combinedEntries = [
        ...(Array.isArray(publicPayload?.immediateFamily) ? publicPayload.immediateFamily : []),
        ...(Array.isArray(publicPayload?.extendedFamily) ? publicPayload.extendedFamily : []),
      ]
      setFamilyProfileContacts(Array.from(new Map(combinedEntries.map((entry) => [entry.id, entry])).values()))
    } catch (error) {
      console.error('Failed to load family profile contacts', error)
      setFamilyProfileContacts([])
    }
  }, [authedFetch, isFamilySession, me?.handle])

  const fetchThreadDetail = useCallback(
    async (threadId: string) => {
      setLoadingThreadId(threadId)
      try {
        const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_LIMIT) })
        const response = await authedFetch(`/messages/threads/${threadId}?${params.toString()}`)
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) {
          throw new Error('failed_thread_detail')
        }
        const payload = (await response.json()) as ThreadDetailResponse
        const normalizedMessages = sortMessagesChronologically(payload.messages)
        const lastMessage = normalizedMessages[normalizedMessages.length - 1] ?? null
        upsertThread({ ...payload.thread, lastMessage, lastMessageAt: lastMessage?.createdAt ?? payload.thread.lastMessageAt })
        forceBottomScrollThreadRef.current = threadId
        smoothScrollPendingRef.current = false
        setMessagesByThread((prev) => ({ ...prev, [threadId]: normalizedMessages }))
        setMessageCursors((prev) => ({ ...prev, [threadId]: payload.nextCursor ?? null }))
        if (selectedThreadRef.current === threadId) {
          scheduleMessagesBottomSettle('auto')
        }
        if (lastMessage && explicitThreadOpenRef.current === threadId) {
          markThreadReadLocally(threadId, lastMessage.createdAt)
          void markThreadRead(threadId, lastMessage.id)
        }
        if (explicitThreadOpenRef.current === threadId) {
          explicitThreadOpenRef.current = null
        }
        failedThreadDetailRef.current.delete(threadId)
        shownThreadDetailErrorRef.current.delete(threadId)
      } catch (err) {
        console.error('Failed to load thread detail', err)
        if (explicitThreadOpenRef.current === threadId) {
          explicitThreadOpenRef.current = null
        }
        failedThreadDetailRef.current.add(threadId)
        setSelectedThreadId((prev) => (prev === threadId ? null : prev))
        if (!shownThreadDetailErrorRef.current.has(threadId)) {
          pushToast('Unable to open that conversation right now.', 'error')
          shownThreadDetailErrorRef.current.add(threadId)
        }
      } finally {
        setLoadingThreadId(null)
      }
    },
    [authedFetch, markThreadRead, markThreadReadLocally, scheduleMessagesBottomSettle, upsertThread],
  )

  const loadOlderMessages = useCallback(
    async (threadId: string) => {
      const cursor = messageCursors[threadId]
      if (!cursor) return
      setLoadingOlderThreadId(threadId)
      try {
        const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_LIMIT), cursor })
        const response = await authedFetch(`/messages/threads/${threadId}/messages?${params.toString()}`)
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) {
          throw new Error('failed_messages_page')
        }
        const payload = (await response.json()) as MessageListResponse

        const container = messagesViewportRef.current
        if (container) {
          preserveScrollRef.current = {
            threadId,
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
          }
        }

        setMessagesByThread((prev) => ({
          ...prev,
          [threadId]: sortMessagesChronologically(payload.items.concat(prev[threadId] ?? [])),
        }))
        setMessageCursors((prev) => ({ ...prev, [threadId]: payload.nextCursor ?? null }))
      } catch (err) {
        console.error('Failed to load more messages', err)
        pushToast('Unable to load older messages right now.', 'error')
      } finally {
        setLoadingOlderThreadId(null)
      }
    },
    [authedFetch, messageCursors],
  )

  useEffect(() => {
    if (!selectedThreadId) return
    if (messagesByThread[selectedThreadId]) return
    if (failedThreadDetailRef.current.has(selectedThreadId)) return
    if (loadingThreadId === selectedThreadId) return
    void fetchThreadDetail(selectedThreadId)
  }, [selectedThreadId, messagesByThread, loadingThreadId, fetchThreadDetail])

  const sendMessage = useCallback(
    async (
      threadId: string,
      options?: {
        body?: string
        attachments?: string[]
      },
    ) => {
      const trimmed = (options?.body ?? composerText).trim()
      const nextAttachments = options?.attachments ?? attachments
      if (!trimmed && nextAttachments.length === 0) return false
      setSending(true)
      try {
        const requestPayload: { body?: string; attachments?: string[] } = {}
        if (trimmed) requestPayload.body = trimmed
        if (nextAttachments.length > 0) requestPayload.attachments = nextAttachments

        const response = await authedFetch(`/messages/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestPayload),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return false
        }
        if (!response.ok) {
          throw new Error('failed_send')
        }
        const payload = (await response.json()) as { message: MessagePayload }
        smoothScrollPendingRef.current = false
        forceBottomScrollThreadRef.current = threadId
        setMessagesByThread((prev) => {
          const existing = prev[threadId] ?? []
          if (existing.some((item) => item.id === payload.message.id)) return prev
          return { ...prev, [threadId]: sortMessagesChronologically([...existing, payload.message]) }
        })
        scheduleMessagesBottomSettle('auto')
        setComposerText('')
        setAttachments([])
        void markThreadRead(threadId, payload.message.id)
        return true
      } catch (err) {
        console.error('Failed to send message', err)
        pushToast('Unable to send this message. Please try again.', 'error')
        return false
      } finally {
        setSending(false)
      }
    },
    [authedFetch, composerText, attachments, markThreadRead],
  )

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      const threadId = selectedThreadRef.current
      const bodyText = composerText
      const pendingMessageId = threadId ? `pending-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null

      // Reset input
      event.target.value = ''

      if (file.size > 25 * 1024 * 1024) {
        pushToast('File is too large (max 25MB).', 'error')
        return
      }

      if (threadId && pendingMessageId) {
        setPendingAttachmentMessagesByThread((prev) => ({
          ...prev,
          [threadId]: [
            ...(prev[threadId] ?? []),
            {
              id: pendingMessageId,
              threadId,
              body: bodyText.trim(),
              createdAt: new Date().toISOString(),
            },
          ],
        }))
      }

      setIsUploading(true)
      try {
        const token = getStoredToken()
        if (!token) throw new Error('unauthenticated')

        // 1. Init upload
        const initRes = await fetch(buildApiUrl('/media/uploads'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            category: 'post_image',
            mime: file.type || 'application/octet-stream',
            byteSize: file.size,
            filename: file.name,
          }),
        })

        if (!initRes.ok) {
          const errData = await initRes.json().catch(() => ({}))
          console.error('Upload init failed', errData)
          throw new Error(errData.error || 'Upload init failed')
        }
        const initPayload = await initRes.json()
        const assetId = initPayload.assetId
        const upload = initPayload.upload || {}
        const proxyPath = initPayload.proxyPath

        // 2. Upload file
        let uploaded = false
        if (upload.url) {
          try {
            const res = await fetch(upload.url, {
              method: upload.method || 'PUT',
              headers: upload.headers,
              body: file,
            })
            if (res.ok) uploaded = true
          } catch (e) {
            console.warn('Direct upload failed', e)
          }
        }

        if (!uploaded && proxyPath) {
          // Ensure we have a valid mime type for the proxy upload
          const contentType = file.type || 'application/octet-stream'
          const res = await fetch(buildApiUrl(proxyPath), {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': contentType,
              'x-upload-byte-size': String(file.size),
            },
            body: file,
          })
          if (res.ok) uploaded = true
        }

        if (!uploaded) throw new Error('Upload failed')

        // 3. Complete upload
        const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ assetId }),
        })

        if (!completeRes.ok) {
          const errData = await completeRes.json().catch(() => ({}))
          console.error('Completion failed', errData)
          throw new Error(errData.error || 'Completion failed')
        }

        // 4. Poll for readiness
        let mediaUrl: string | null = null
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          const pollRes = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
            headers: { authorization: `Bearer ${token}` },
          })
          if (pollRes.ok) {
            const pollData = await pollRes.json()
            if (pollData.asset?.status === 'ready') {
              // Pick a variant
              const rawVariants = pollData.asset.variants || []
              const variants = Object.values(rawVariants)
              // Prefer 'public' or 'large' or just the first one
              const v = variants.find((v: any) => v.variant === 'public') || variants[0]
              if (v) {
                mediaUrl = (v as any).url
                break
              }
            } else if (pollData.asset?.status === 'failed') {
              throw new Error('Processing failed')
            }
          }
        }

        if (mediaUrl) {
          if (!threadId) {
            setAttachments((prev) => [...prev, mediaUrl])
            return
          }

          const sent = await sendMessage(threadId, {
            body: bodyText,
            attachments: [mediaUrl],
          })

          if (!sent) {
            setAttachments((prev) => [...prev, mediaUrl])
          }
        } else {
          throw new Error('Processing timeout')
        }
      } catch (err) {
        console.error('Upload error', err)
        const msg = err instanceof Error ? err.message : 'Failed to upload image.'
        pushToast(msg, 'error')
      } finally {
        if (threadId && pendingMessageId) {
          setPendingAttachmentMessagesByThread((prev) => {
            const nextItems = (prev[threadId] ?? []).filter((item) => item.id !== pendingMessageId)
            if (nextItems.length === 0) {
              const next = { ...prev }
              delete next[threadId]
              return next
            }
            return {
              ...prev,
              [threadId]: nextItems,
            }
          })
        }
        setIsUploading(false)
      }
    },
    [composerText, sendMessage],
  )

  const removeAttachment = useCallback(
    (index: number) => {
      setAttachments((prev) => prev.filter((_, i) => i !== index))
    },
    [],
  )

  useEffect(() => {
    if (!authReady) return
    void loadMe()
    void loadThreads()
    void loadContactBuckets()
    void loadSupplementalUnreadCounts()
    void loadMarketInbox()
  }, [authReady, loadContactBuckets, loadMarketInbox, loadMe, loadSupplementalUnreadCounts, loadThreads])

  useEffect(() => {
    if (!authReady) return
    void loadFamilyProfileContacts()
  }, [authReady, loadFamilyProfileContacts])

  useEffect(() => {
    if (!isFamilySession) return
    setActiveInboxSection('friends')
    writeStoredMessagesNavSection('friends')
  }, [isFamilySession])

  useEffect(() => {
    if (!authReady || typeof window === 'undefined') return undefined
    const refresh = () => {
      void loadSupplementalUnreadCounts()
      void loadMarketInbox()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener('message.read', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('message.read', refresh)
    }
  }, [authReady, loadMarketInbox, loadSupplementalUnreadCounts])

  const orderedThreads = useMemo(() => sortThreadsForInbox(threads), [threads])
  const friendContactIdSet = useMemo(() => new Set(friendContactIds), [friendContactIds])
  const networkContactIdSet = useMemo(() => new Set(networkContactIds), [networkContactIds])
  const familyProfileContactIdSet = useMemo(() => new Set(familyProfileContacts.map((entry) => entry.id)), [familyProfileContacts])
  const categorizedThreads = useMemo(() => {
    const groups = sortThreadsForInbox(orderedThreads.filter((thread) => thread.type === 'group'))
    const family = showFamilyInbox
      ? sortThreadsForInbox(
          orderedThreads.filter(
            (thread) =>
              thread.contextType !== 'market_listing' &&
              thread.type !== 'group' &&
              (thread.inboxSection === 'family' ||
                getOtherParticipants(thread, me?.id).some((participant) => familyProfileContactIdSet.has(participant.userId))),
          ),
        )
      : ([] as ThreadSummary[])
    const directThreads = orderedThreads.filter(
      (thread) =>
        thread.contextType !== 'market_listing' &&
        thread.type !== 'group' &&
        thread.inboxSection !== 'family' &&
        !getOtherParticipants(thread, me?.id).some((participant) => familyProfileContactIdSet.has(participant.userId)),
    )
    if (isFamilySession) {
      return {
        friends: sortThreadsForInbox(directThreads),
        family: [] as ThreadSummary[],
        network: [] as ThreadSummary[],
        groups,
      }
    }
    if (!contactsBucketReady) {
      return {
        friends: sortThreadsForInbox(directThreads),
        family,
        network: [] as ThreadSummary[],
        groups,
      }
    }
    const friends = directThreads.filter((thread) =>
      getOtherParticipants(thread, me?.id).some((participant) => friendContactIdSet.has(participant.userId)),
    )
    const network = directThreads.filter((thread) =>
      getOtherParticipants(thread, me?.id).some(
        (participant) => networkContactIdSet.has(participant.userId) && !friendContactIdSet.has(participant.userId),
      ),
    )
    return {
      friends: sortThreadsForInbox(friends),
      family,
      network: sortThreadsForInbox(network),
      groups,
    }
  }, [contactsBucketReady, familyProfileContactIdSet, friendContactIdSet, isFamilySession, me?.id, networkContactIdSet, orderedThreads, showFamilyInbox])
  const messagesNavUnreadCounts = useMemo(
    () => ({
      friends: countUnreadInThreads(categorizedThreads.friends),
      family: countUnreadInThreads(categorizedThreads.family),
      network: countUnreadInThreads(categorizedThreads.network),
      groups: countUnreadInThreads(categorizedThreads.groups),
      market: Math.max(0, marketUnreadCount),
    }),
    [categorizedThreads.family, categorizedThreads.friends, categorizedThreads.groups, categorizedThreads.network, marketUnreadCount],
  )
  const filteredOrderedThreads = useMemo(() => {
    if (activeInboxSection === 'market') return [] as ThreadSummary[]
    if (activeInboxSection === 'family') return categorizedThreads.family
    if (activeInboxSection === 'network') return categorizedThreads.network
    if (activeInboxSection === 'groups') return categorizedThreads.groups
    return categorizedThreads.friends
  }, [activeInboxSection, categorizedThreads.family, categorizedThreads.friends, categorizedThreads.groups, categorizedThreads.network])
  const familyContactsWithoutThreads = useMemo(() => {
    if (!showFamilyInbox) return []
    const threadedUserIds = new Set(
      categorizedThreads.family.flatMap((thread) => getOtherParticipants(thread, me?.id).map((participant) => participant.userId)),
    )
    return familyProfileContacts.filter((entry) => !threadedUserIds.has(entry.id))
  }, [categorizedThreads.family, familyProfileContacts, me?.id, showFamilyInbox])
  const activeThread = useMemo(() => {
    if (!selectedThreadId) return null
    if (activeInboxSection === 'market') {
      return threads.find((thread) => thread.id === selectedThreadId) ?? null
    }
    return filteredOrderedThreads.find((thread) => thread.id === selectedThreadId) ?? null
  }, [activeInboxSection, filteredOrderedThreads, selectedThreadId, threads])
  const isFamilyParentThreadSelected = Boolean(familyParentThreadId && selectedThreadId === familyParentThreadId)
  const marketThreads = useMemo(
    () => sortThreadsForInbox(threads.filter((thread) => thread.contextType === 'market_listing')),
    [threads],
  )
  const marketThreadById = useMemo(() => new Map(marketThreads.map((thread) => [thread.id, thread])), [marketThreads])
  const marketUnreadCountByThreadId = useMemo(() => {
    const next = new Map<string, number>()
    for (const thread of marketThreads) {
      next.set(thread.id, threadUnreadCount(thread))
    }
    return next
  }, [marketThreads])
  const marketInboxEntries = useMemo(() => {
    const items = Object.values(marketInboxItemsByThreadId)
    const itemByThreadId = new Map(items.map((item) => [item.threadId, item]))

    for (const thread of marketThreads) {
      if (itemByThreadId.has(thread.id)) continue
      const primaryParticipant = getPrimaryOtherParticipant(thread, me?.id)
      itemByThreadId.set(thread.id, {
        threadId: thread.id,
        unreadCount: threadUnreadCount(thread),
        listingId: thread.contextId ?? thread.id,
        listingTitle: 'Marketplace item',
        listingStatus: '',
        listingPriceCents: 0,
        listingCurrency: 'CAD',
        listingPhotoUrl: null,
        counterpart: primaryParticipant
          ? {
              id: primaryParticipant.user.id,
              handle: primaryParticipant.user.handle,
              name: primaryParticipant.user.name,
              avatarUrl: primaryParticipant.user.avatarUrl,
              coverUrl: primaryParticipant.user.coverUrl,
            }
          : null,
        lastMessageAt: thread.lastMessageAt,
        lastMessage: thread.lastMessage
          ? {
              body: thread.lastMessage.body,
              senderId: thread.lastMessage.senderId,
              isMine: thread.lastMessage.isMine,
            }
          : null,
      })
    }

    return Array.from(itemByThreadId.values()).sort(
      (left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime(),
    )
  }, [marketInboxItemsByThreadId, marketThreads, me?.id])
  const marketUnreadEntries = useMemo(
    () => marketInboxEntries.filter((item) => Math.max(item.unreadCount ?? 0, marketUnreadCountByThreadId.get(item.threadId) ?? 0) > 0),
    [marketInboxEntries, marketUnreadCountByThreadId],
  )
  const unreadOverviewGroups = useMemo(
    () => [
      { key: 'family', label: 'Family', threads: categorizedThreads.family.filter((thread) => threadHasUnread(thread)) },
      { key: 'friends', label: 'Friends', threads: categorizedThreads.friends.filter((thread) => threadHasUnread(thread)) },
      { key: 'network', label: 'Network', threads: categorizedThreads.network.filter((thread) => threadHasUnread(thread)) },
      { key: 'groups', label: 'Groups', threads: categorizedThreads.groups.filter((thread) => threadHasUnread(thread)) },
      { key: 'market', label: 'Market', items: marketUnreadEntries },
    ],
    [categorizedThreads.family, categorizedThreads.friends, categorizedThreads.groups, categorizedThreads.network, marketUnreadEntries],
  )

  const loadActiveMarketThreadContext = useCallback(async () => {
    if (!activeThread || activeThread.contextType !== 'market_listing') {
      setMarketThreadContext(null)
      setMarketThreadContextLoading(false)
      return
    }

    setMarketThreadContextLoading(true)
    try {
      const response = await authedFetch(`/market/chats/${encodeURIComponent(activeThread.id)}/context`, { cache: 'no-store' })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        setMarketThreadContext(null)
        return
      }

      const payload = (await response.json().catch(() => null)) as MarketThreadContext | null
      if (!payload?.listing) {
        setMarketThreadContext(null)
        return
      }

      setMarketThreadContext(payload)
    } catch (error) {
      console.error('Failed to load market thread context', error)
      setMarketThreadContext(null)
    } finally {
      setMarketThreadContextLoading(false)
    }
  }, [activeThread, authedFetch])

  useEffect(() => {
    void loadActiveMarketThreadContext()
  }, [loadActiveMarketThreadContext])

  const syncMobileThreadLayout = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!isMobileViewport || !activeThread) {
      setMobileThreadPanelHeight(null)
      setMobileMessagesViewportHeight(null)
      return
    }

    const panel = threadPanelRef.current
    const header = threadHeaderRef.current
    if (!panel || !header) return

    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportHeight = viewport?.height ?? window.innerHeight
    const viewportBottom = viewportTop + viewportHeight
    const panelRect = panel.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const composerRect = mobileComposerShellRef.current?.getBoundingClientRect() ?? null
    const listBottom = composerRect ? composerRect.top : viewportBottom
    const visiblePanelHeight = Math.max(260, Math.floor(listBottom - panelRect.top))
    const availableListHeight = Math.max(140, Math.floor(listBottom - headerRect.bottom - 16))

    setMobileThreadPanelHeight((prev) => {
      const next = `${visiblePanelHeight}px`
      return prev === next ? prev : next
    })
    setMobileMessagesViewportHeight((prev) => {
      const next = `${availableListHeight}px`
      return prev === next ? prev : next
    })
  }, [activeThread, isMobileViewport])

  useEffect(() => {
    syncMobileThreadLayout()
  }, [syncMobileThreadLayout])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleLayoutChange = () => {
      syncMobileThreadLayout()
    }

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', handleLayoutChange)
    viewport?.addEventListener('scroll', handleLayoutChange)
    window.addEventListener('resize', handleLayoutChange)
    window.addEventListener('orientationchange', handleLayoutChange)
    window.addEventListener('focusin', handleLayoutChange)
    window.addEventListener('focusout', handleLayoutChange)

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleLayoutChange) : null
    if (resizeObserver) {
      if (threadPanelRef.current) resizeObserver.observe(threadPanelRef.current)
      if (threadHeaderRef.current) resizeObserver.observe(threadHeaderRef.current)
      if (mobileComposerShellRef.current) resizeObserver.observe(mobileComposerShellRef.current)
    }

    return () => {
      viewport?.removeEventListener('resize', handleLayoutChange)
      viewport?.removeEventListener('scroll', handleLayoutChange)
      window.removeEventListener('resize', handleLayoutChange)
      window.removeEventListener('orientationchange', handleLayoutChange)
      window.removeEventListener('focusin', handleLayoutChange)
      window.removeEventListener('focusout', handleLayoutChange)
      resizeObserver?.disconnect()
    }
  }, [syncMobileThreadLayout])

  useEffect(() => {
    if (activeInboxSection === 'market') {
      return
    }
    if (filteredOrderedThreads.length === 0) {
      if (familyParentThreadId && selectedThreadId === familyParentThreadId) return
      if (threadsLoading || threads.length === 0) return
      if (selectedThreadId) setSelectedThreadId(null)
      return
    }
    if (familyParentThreadId && selectedThreadId === familyParentThreadId) {
      return
    }
    if (selectedThreadId && filteredOrderedThreads.some((thread) => thread.id === selectedThreadId)) {
      return
    }
    if (selectedThreadId) {
      setSelectedThreadId(null)
    }
  }, [activeInboxSection, familyParentThreadId, filteredOrderedThreads, selectedThreadId, threads.length, threadsLoading])

  useEffect(() => {
    if (!selectedThreadId) return
    const container = messagesViewportRef.current
    if (!container) return
    const messageCount = messagesByThread[selectedThreadId]?.length ?? 0
    const shouldForceToBottom = forceBottomScrollThreadRef.current === selectedThreadId
    if (messageCount === 0 && !shouldForceToBottom) return

    const preserve = preserveScrollRef.current
    if (preserve?.threadId === selectedThreadId) {
      const delta = container.scrollHeight - preserve.scrollHeight
      container.scrollTop = preserve.scrollTop + delta
      preserveScrollRef.current = null
      smoothScrollPendingRef.current = false
      return
    }

    if (shouldForceToBottom) {
      const behavior: ScrollBehavior = smoothScrollPendingRef.current ? 'smooth' : 'auto'
      container.scrollTo({ top: container.scrollHeight, behavior })
      forceBottomScrollThreadRef.current = null
      smoothScrollPendingRef.current = false
      return
    }

    const behavior: ScrollBehavior = smoothScrollPendingRef.current ? 'smooth' : 'auto'
    container.scrollTo({ top: container.scrollHeight, behavior })
    smoothScrollPendingRef.current = false
  }, [messagesByThread, selectedThreadId])
  const activeMessages = useMemo(() => {
    if (!selectedThreadId) return []
    const messages = messagesByThread[selectedThreadId] ?? []
    return sortMessagesChronologically(messages)
  }, [messagesByThread, selectedThreadId])
  const activeMarketSelectedPaymentType = useMemo(
    () =>
      marketThreadContext?.listing?.selectedPaymentType ??
      resolveSelectedMarketPaymentType(activeMessages, marketThreadContext?.listing?.id ?? activeThread?.contextId ?? null),
    [activeMessages, activeThread?.contextId, marketThreadContext?.listing?.id, marketThreadContext?.listing?.selectedPaymentType],
  )
  const activePendingAttachmentMessages = useMemo(() => {
    if (!selectedThreadId) return []
    return pendingAttachmentMessagesByThread[selectedThreadId] ?? []
  }, [pendingAttachmentMessagesByThread, selectedThreadId])
  const latestActiveMessageId = activeMessages[activeMessages.length - 1]?.id ?? null
  const activeThreadHasMore = selectedThreadId ? Boolean(messageCursors[selectedThreadId]) : false

  useEffect(() => {
    if (!isMobileViewport || !selectedThreadId || !latestActiveMessageId) return
    if (preserveScrollRef.current?.threadId === selectedThreadId) return
    scheduleMessagesBottomSettle('auto')
  }, [isMobileViewport, latestActiveMessageId, scheduleMessagesBottomSettle, selectedThreadId])

  useEffect(() => {
    if (!isMobileViewport || !selectedThreadId || !activeThread) return
    scheduleMessagesBottomSettle('auto')
  }, [activeThread, isMobileViewport, mobileKeyboardInset, mobileMessagesViewportHeight, scheduleMessagesBottomSettle, selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId || activePendingAttachmentMessages.length === 0) return
    scheduleMessagesBottomSettle('auto')
  }, [activePendingAttachmentMessages.length, scheduleMessagesBottomSettle, selectedThreadId])

  useEffect(() => {
    const candidates = new Set<string>()
    for (const message of activeMessages) {
      if (!message.body) continue
      for (const url of extractCivilUrlsFromMessage(message.body)) {
        candidates.add(url)
      }
    }

    for (const url of candidates) {
      if (Object.prototype.hasOwnProperty.call(messageLinkPreviews, url)) continue
      if (pendingLinkPreviewUrlsRef.current.has(url)) continue
      pendingLinkPreviewUrlsRef.current.add(url)

      void (async () => {
        try {
          const response = await authedFetch(`/messages/link-preview?url=${encodeURIComponent(url)}`)
          if (response.status === 401) {
            redirectToAuthModal('login')
            return
          }
          if (!response.ok) {
            setMessageLinkPreviews((prev) =>
              Object.prototype.hasOwnProperty.call(prev, url) ? prev : { ...prev, [url]: null },
            )
            return
          }
          const payload = (await response.json().catch(() => null)) as MessageLinkPreviewResponse | null
          setMessageLinkPreviews((prev) => ({ ...prev, [url]: payload?.preview ?? null }))
        } catch (error) {
          console.error('Failed to load message link preview', error)
          setMessageLinkPreviews((prev) =>
            Object.prototype.hasOwnProperty.call(prev, url) ? prev : { ...prev, [url]: null },
          )
        } finally {
          pendingLinkPreviewUrlsRef.current.delete(url)
        }
      })()
    }
  }, [activeMessages, authedFetch, messageLinkPreviews])

  const renderMessageBodyWithLinks = useCallback((body: string, isMine: boolean, suppressedUrls?: Set<string>) => {
    const bodyForDisplay = stripSuppressedUrlsFromBody(body, suppressedUrls ?? new Set<string>())
    if (!bodyForDisplay) return null

    const parts: Array<string | JSX.Element> = []
    const regex = new RegExp(HTTP_URL_REGEX.source, 'gi')
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(bodyForDisplay)) !== null) {
      const rawMatch = match[0] ?? ''
      const matchStart = match.index
      const matchEnd = matchStart + rawMatch.length

      if (matchStart > lastIndex) {
        parts.push(bodyForDisplay.slice(lastIndex, matchStart))
      }

      const displayUrl = trimUrlPunctuation(rawMatch)
      const normalizedUrl = normalizeHttpUrl(displayUrl)
      const trailing = rawMatch.slice(displayUrl.length)

      if (normalizedUrl) {
        const internal = isCivilUrl(normalizedUrl)
        parts.push(
          <a
            key={`${normalizedUrl}-${matchStart}`}
            href={normalizedUrl}
            target={internal ? undefined : '_blank'}
            rel={internal ? undefined : 'noopener noreferrer'}
            className={clsx(
              'break-words underline underline-offset-2 transition',
              isMine ? 'text-white/95 hover:text-white' : 'text-[var(--cc-primary)] hover:text-[var(--cc-primary-700)]',
            )}
          >
            {displayUrl}
          </a>,
        )
      } else {
        parts.push(rawMatch)
      }

      if (trailing) {
        parts.push(trailing)
      }

      lastIndex = matchEnd
    }

    if (lastIndex < bodyForDisplay.length) {
      parts.push(bodyForDisplay.slice(lastIndex))
    }

    return <p className="whitespace-pre-wrap break-words">{parts}</p>
  }, [])

  const renderMessageLinkPreviewCard = useCallback(
    (url: string, isMine: boolean) => {
      const preview = messageLinkPreviews[url]
      if (!preview) return null
      const targetUrl = (preview.url || '').trim() || url

      const cardBody = (
        <div
          className={clsx(
            'mt-2 overflow-hidden rounded-xl border transition',
            isMine ? 'border-white/25 bg-white/10 hover:bg-white/15' : 'border-slate-200 bg-slate-50 hover:bg-slate-100',
          )}
        >
          <div className="flex items-start gap-3 p-2.5">
            {preview.imageUrl ? (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200/70 bg-white/80">
                <img src={preview.imageUrl} alt={preview.title} className="h-full w-full object-cover" loading="lazy" />
              </div>
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <p className={clsx('line-clamp-1 text-sm font-semibold', isMine ? 'text-white' : 'text-slate-900')}>{preview.title}</p>
              {preview.description ? (
                <p className={clsx('line-clamp-2 text-xs', isMine ? 'text-white/85' : 'text-slate-600')}>{preview.description}</p>
              ) : null}
              <p className={clsx('truncate text-[11px]', isMine ? 'text-white/70' : 'text-slate-500')}>{preview.meta || targetUrl}</p>
            </div>
          </div>
        </div>
      )

      if (targetUrl.startsWith('/')) {
        return (
          <Link key={`${url}-preview`} href={targetUrl} className="block">
            {cardBody}
          </Link>
        )
      }

      return (
        <a key={`${url}-preview`} href={targetUrl} target="_blank" rel="noopener noreferrer" className="block">
          {cardBody}
        </a>
      )
    },
    [messageLinkPreviews],
  )

  const handleThreadSelect = useCallback(
    (threadId: string) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(MOBILE_MORE_DRAWER_CLOSE_EVENT))
      }
      failedThreadDetailRef.current.delete(threadId)
      shownThreadDetailErrorRef.current.delete(threadId)
      forceBottomScrollThreadRef.current = threadId
      smoothScrollPendingRef.current = false
      explicitThreadOpenRef.current = threadId
      setSelectedThreadId(threadId)
      const threadMessages = messagesByThread[threadId]
      if (!threadMessages) {
        void fetchThreadDetail(threadId)
      } else {
        const lastMessage = threadMessages[threadMessages.length - 1]
        if (lastMessage) {
          markThreadReadLocally(threadId, lastMessage.createdAt)
          void markThreadRead(threadId, lastMessage.id)
        }
        if (explicitThreadOpenRef.current === threadId) {
          explicitThreadOpenRef.current = null
        }
      }
    },
    [fetchThreadDetail, markThreadRead, markThreadReadLocally, messagesByThread],
  )

  const activeViewerParticipant = useMemo(
    () => activeThread?.participants.find((participant) => participant.isViewer) ?? null,
    [activeThread],
  )
  const activeThreadPrimaryUser = useMemo(
    () => activeThread?.participants.find((participant) => !participant.isViewer)?.user ?? null,
    [activeThread],
  )
  const activeThreadProfileHref = activeThreadPrimaryUser?.handle ? `/u/${encodeURIComponent(activeThreadPrimaryUser.handle)}` : null
  const isActiveGroupThread = activeThread?.type === 'group'
  const isActiveGroupOwner = isActiveGroupThread && activeViewerParticipant?.role === 'admin'
  const activeThreadSupportsCalling = Boolean(
    activeThread &&
      !activeThread.contextType &&
      (activeThread.type === 'direct' || activeThread.type === 'group') &&
      activeThread.id !== familyParentThreadId,
  )
  const activeThreadCall = activeThread?.activeCall ?? null
  const activeMarketListingHref = useMemo(() => {
    if (!marketThreadContext?.listing) return null
    if (marketThreadContext.viewerIsSeller) {
      return `/market/chats/item/${encodeURIComponent(marketThreadContext.listing.id)}`
    }
    return `/market/listings/${encodeURIComponent(marketThreadContext.listing.id)}`
  }, [marketThreadContext])
  const activeMarketCivilPayHref = useMemo(() => {
    if (!marketThreadContext?.listing?.id || !activeThread) return null
    return `/market/listings/${encodeURIComponent(marketThreadContext.listing.id)}/civil-pay?thread=${encodeURIComponent(activeThread.id)}`
  }, [activeThread, marketThreadContext])
  const activeMarketListingStatus = (marketThreadContext?.listing.status || '').trim().toLowerCase()
  const activeMarketSupportsCivilPay = supportsCivilPay(marketThreadContext?.listing?.paymentTypes)
  const activeMarketThreadIsSelectedBuyer = Boolean(
    activeThread && marketThreadContext?.selectedThreadId && marketThreadContext.selectedThreadId === activeThread.id,
  )
  const canSelectActiveMarketBuyer = Boolean(
    activeThread &&
      marketThreadContext?.viewerIsSeller &&
      !marketThreadContext.selectedThreadId &&
      activeMarketListingStatus !== 'sold' &&
      activeMarketListingStatus !== 'canceled',
  )
  const canUnselectActiveMarketBuyer = Boolean(
    marketThreadContext?.viewerIsSeller && activeMarketThreadIsSelectedBuyer && activeMarketListingStatus === 'pending',
  )
  const showMarkSoldFromActiveMarketThread = Boolean(
    marketThreadContext?.viewerIsSeller && activeMarketThreadIsSelectedBuyer && activeMarketListingStatus === 'pending',
  )
  const canMarkSoldFromActiveMarketThread = Boolean(
    marketThreadContext?.viewerIsSeller &&
      activeMarketThreadIsSelectedBuyer &&
      activeMarketListingStatus === 'pending' &&
      marketThreadContext?.buyerPickedUpAt,
  )
  const canAccessActiveMarketPickupDirections = Boolean(
    marketThreadContext?.viewerCanAccessPickupAddress && marketThreadContext.pickupAddress && !marketThreadContext.pickupCompletedAt,
  )
  const canMarkActiveMarketPickupComplete = Boolean(
    ((marketThreadContext?.viewerIsSeller && !marketThreadContext?.sellerPickedUpAt) ||
      (marketThreadContext?.viewerIsSelectedBuyer && !marketThreadContext?.buyerPickedUpAt)) &&
      activeMarketThreadIsSelectedBuyer &&
      activeMarketListingStatus === 'pending',
  )
  const canCompleteActiveMarketCivilPay = Boolean(
    marketThreadContext?.viewerIsSelectedBuyer &&
      activeMarketThreadIsSelectedBuyer &&
      activeMarketSupportsCivilPay &&
      activeMarketSelectedPaymentType === 'civil_wallet' &&
      activeMarketListingStatus === 'pending' &&
      marketThreadContext?.listing?.civilPayStatus !== 'completed' &&
      activeMarketCivilPayHref,
  )
  const activeMarketDeliveryVisible = Boolean(marketThreadContext?.deliveryContract && activeMarketThreadIsSelectedBuyer)
  const activeMarketDeliveryChatHref = marketThreadContext?.deliveryContract?.groupThreadId
    ? `/messages?thread=${encodeURIComponent(marketThreadContext.deliveryContract.groupThreadId)}`
    : null
  const activeMarketPickupDirectionsHref = useMemo(() => {
    if (!marketThreadContext?.pickupAddress) return null
    return buildAddressesHrefFromAddress(marketThreadContext.pickupAddress, marketThreadContext.listing.title)
  }, [marketThreadContext])
  const [marketPickupCompleteSubmitting, setMarketPickupCompleteSubmitting] = useState(false)

  const handleMarkActiveMarketPickupComplete = useCallback(async () => {
    if (!marketThreadContext?.listing.id) return

    setMarketPickupCompleteSubmitting(true)
    setMarketHeaderActionError(null)
    try {
      const response = await authedFetch(`/market/chats/item/${encodeURIComponent(marketThreadContext.listing.id)}/pickup-complete`, {
        method: 'POST',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setMarketHeaderActionError(payload?.error || 'Unable to mark this pickup complete right now.')
        return
      }

      await Promise.all([loadActiveMarketThreadContext(), loadMarketInbox()])
    } catch (error) {
      console.error('Failed to mark market pickup complete', error)
      setMarketHeaderActionError('Unable to mark this pickup complete right now.')
    } finally {
      setMarketPickupCompleteSubmitting(false)
    }
  }, [authedFetch, loadActiveMarketThreadContext, loadMarketInbox, marketThreadContext?.listing.id])

  const handleSelectActiveMarketBuyer = useCallback(async () => {
    if (!activeThread || !marketThreadContext?.listing.id) return

    setMarketSelectBuyerSubmitting(true)
    setMarketHeaderActionError(null)
    try {
      const response = await authedFetch(`/market/chats/item/${encodeURIComponent(marketThreadContext.listing.id)}/select-buyer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: activeThread.id }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setMarketHeaderActionError(payload?.error || 'Unable to select this buyer right now.')
        return
      }

      setMarketSelectBuyerConfirmOpen(false)
      await Promise.all([loadActiveMarketThreadContext(), loadThreads(), loadSupplementalUnreadCounts(), loadMarketInbox()])
    } catch (error) {
      console.error('Failed to select market buyer', error)
      setMarketHeaderActionError('Unable to select this buyer right now.')
    } finally {
      setMarketSelectBuyerSubmitting(false)
    }
  }, [activeThread, authedFetch, loadActiveMarketThreadContext, loadMarketInbox, loadSupplementalUnreadCounts, loadThreads, marketThreadContext?.listing.id])

  const handleChooseActiveMarketPayment = useCallback(
    async (paymentType: MarketPaymentType) => {
      if (!activeThread || !marketThreadContext?.listing.id) return

      setMarketPaymentSelectionSubmitting(paymentType)
      setMarketHeaderActionError(null)
      try {
        const response = await authedFetch(`/market/chats/${encodeURIComponent(activeThread.id)}/payment-selection`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paymentType }),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        const payload = (await response.json().catch(() => null)) as { error?: string; selectedPaymentType?: MarketPaymentType; message?: MessagePayload } | null
        if (!response.ok) {
          setMarketHeaderActionError(payload?.error || 'Unable to save that payment choice right now.')
          return
        }

        if (payload?.message) {
          setMessagesByThread((prev) => {
            const existing = prev[activeThread.id] ?? []
            if (existing.some((message) => message.id === payload.message!.id)) return prev
            return { ...prev, [activeThread.id]: sortMessagesChronologically([...existing, payload.message!]) }
          })
          upsertThread({ ...activeThread, lastMessage: payload.message, lastMessageAt: payload.message.createdAt })
        }

        setMarketThreadContext((prev) =>
          prev?.listing
            ? {
                ...prev,
                listing: {
                  ...prev.listing,
                  selectedPaymentType: payload?.selectedPaymentType ?? paymentType,
                },
              }
            : prev,
        )
        await loadMarketInbox()
      } catch (error) {
        console.error('Failed to choose market payment', error)
        setMarketHeaderActionError('Unable to save that payment choice right now.')
      } finally {
        setMarketPaymentSelectionSubmitting(null)
      }
    },
    [activeThread, authedFetch, loadMarketInbox, marketThreadContext?.listing.id, upsertThread],
  )

  const handleUnselectActiveMarketBuyer = useCallback(async () => {
    if (!marketThreadContext?.listing.id) return

    setMarketUnselectBuyerSubmitting(true)
    setMarketHeaderActionError(null)
    try {
      const response = await authedFetch(`/market/chats/item/${encodeURIComponent(marketThreadContext.listing.id)}/relist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notify: false }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setMarketHeaderActionError(payload?.error || 'Unable to relist this item right now.')
        return
      }

      setMarketUnselectBuyerConfirmOpen(false)
      await Promise.all([loadActiveMarketThreadContext(), loadThreads(), loadSupplementalUnreadCounts(), loadMarketInbox()])
    } catch (error) {
      console.error('Failed to unselect market buyer', error)
      setMarketHeaderActionError('Unable to relist this item right now.')
    } finally {
      setMarketUnselectBuyerSubmitting(false)
    }
  }, [authedFetch, loadActiveMarketThreadContext, loadMarketInbox, loadSupplementalUnreadCounts, loadThreads, marketThreadContext?.listing.id])

  const handleMarkSoldFromActiveMarketThread = useCallback(async () => {
    if (!marketThreadContext?.listing.id) return

    setMarketMarkSoldSubmitting(true)
    setMarketHeaderActionError(null)
    try {
      const response = await authedFetch(`/market/listings/${encodeURIComponent(marketThreadContext.listing.id)}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: 'sold' }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null
        setMarketHeaderActionError(payload?.detail || payload?.error || 'Unable to mark this item sold right now.')
        return
      }

      setMarketMarkSoldConfirmOpen(false)
      setSelectedThreadId(null)
      await Promise.all([loadThreads(), loadSupplementalUnreadCounts(), loadMarketInbox()])
      router.replace('/messages?inbox=market')
    } catch (error) {
      console.error('Failed to mark market item sold', error)
      setMarketHeaderActionError('Unable to mark this item sold right now.')
    } finally {
      setMarketMarkSoldSubmitting(false)
    }
  }, [authedFetch, loadMarketInbox, loadSupplementalUnreadCounts, loadThreads, marketThreadContext?.listing.id, router])

  const filteredGroupCandidates = useMemo(() => {
    const q = groupCandidateFilter.trim().toLowerCase()
    if (!q) return groupCandidates
    return groupCandidates.filter((contact) => {
      const display = (contact.name || contact.handle).toLowerCase()
      return display.includes(q) || contact.handle.toLowerCase().includes(q)
    })
  }, [groupCandidateFilter, groupCandidates])

  const filteredCurrentMembers = useMemo(() => {
    const source = activeThread?.participants.filter((participant) => !participant.isViewer) ?? []
    const q = groupMemberFilter.trim().toLowerCase()
    if (!q) return source
    return source.filter((participant) => {
      const display = (participant.user.name || participant.user.handle).toLowerCase()
      return display.includes(q) || participant.user.handle.toLowerCase().includes(q)
    })
  }, [activeThread?.participants, groupMemberFilter])

  const loadGroupCandidates = useCallback(async () => {
    if (!activeThread || !isActiveGroupOwner) return
    setGroupCandidatesLoading(true)
    try {
      const response = await authedFetch(`/messages/threads/${activeThread.id}/candidates`)
      if (!response.ok) {
        throw new Error('failed_candidates')
      }
      const payload = (await response.json()) as { items?: ThreadUser[] }
      setGroupCandidates(Array.isArray(payload.items) ? payload.items : [])
    } catch (err) {
      console.error('Failed to load group candidates', err)
      setGroupCandidates([])
      pushToast('Unable to load addable contacts right now.', 'error')
    } finally {
      setGroupCandidatesLoading(false)
    }
  }, [activeThread, authedFetch, isActiveGroupOwner])

  const openManageMembersModal = useCallback(() => {
    if (!activeThread || !isActiveGroupOwner) return
    setManageMembersOpen(true)
    setGroupCandidateFilter('')
    setGroupMemberFilter('')
    void loadGroupCandidates()
  }, [activeThread, isActiveGroupOwner, loadGroupCandidates])

  const addGroupMember = useCallback(
    async (targetUserId: string) => {
      if (!activeThread) return
      setMemberActionLoadingId(targetUserId)
      try {
        const response = await authedFetch(`/messages/threads/${activeThread.id}/participants`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: targetUserId }),
        })
        const payload = (await response.json().catch(() => null)) as { thread?: ThreadSummary; error?: string } | null
        if (!response.ok || !payload?.thread) {
          pushToast(payload?.error ?? 'Unable to add member right now.', 'error')
          return
        }
        upsertThread(payload.thread)
        await loadGroupCandidates()
        pushToast('Member added.', 'success')
      } catch (err) {
        console.error('Failed to add group member', err)
        pushToast('Unable to add member right now.', 'error')
      } finally {
        setMemberActionLoadingId(null)
      }
    },
    [activeThread, authedFetch, loadGroupCandidates, upsertThread],
  )

  const removeGroupMember = useCallback(
    async (targetUserId: string) => {
      if (!activeThread) return
      setMemberActionLoadingId(targetUserId)
      try {
        const response = await authedFetch(`/messages/threads/${activeThread.id}/participants/${targetUserId}`, {
          method: 'DELETE',
        })
        const payload = (await response.json().catch(() => null)) as { thread?: ThreadSummary; error?: string } | null
        if (!response.ok || !payload?.thread) {
          pushToast(payload?.error ?? 'Unable to remove member right now.', 'error')
          return
        }
        upsertThread(payload.thread)
        await loadGroupCandidates()
        pushToast('Member removed.', 'info')
      } catch (err) {
        console.error('Failed to remove group member', err)
        pushToast('Unable to remove member right now.', 'error')
      } finally {
        setMemberActionLoadingId(null)
      }
    },
    [activeThread, authedFetch, loadGroupCandidates, upsertThread],
  )

  const leaveActiveGroup = useCallback(async () => {
    if (!activeThread || !isActiveGroupThread) return
    setLeavingGroup(true)
    try {
      const response = await authedFetch(`/messages/threads/${activeThread.id}/leave`, {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!response.ok || !payload?.success) {
        pushToast(payload?.error ?? 'Unable to leave group right now.', 'error')
        return
      }
      setThreads((prev) => prev.filter((thread) => thread.id !== activeThread.id))
      setSelectedThreadId(null)
      setManageMembersOpen(false)
      pushToast('You left the group chat.', 'info')
    } catch (err) {
      console.error('Failed to leave group', err)
      pushToast('Unable to leave group right now.', 'error')
    } finally {
      setLeavingGroup(false)
    }
  }, [activeThread, authedFetch, isActiveGroupThread])

  const startFamilyParentCall = useCallback(
    async (mode: 'audio' | 'video') => {
      if (!isFamilySession || !viewer?.id) return
      if ((mode === 'audio' && !familyCallPermissions.audio) || (mode === 'video' && !familyCallPermissions.video)) {
        setCallPermissionModalOpen(true)
        return
      }

      setCallActionMode(mode)
      try {
        const response = await authedFetch('/family/calls/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ memberId: viewer.id, mode }),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        const payload = (await response.json().catch(() => null)) as { call?: { id?: string | null } | null; error?: string } | null
        if (!response.ok || !payload?.call?.id) {
          pushToast(payload?.error ?? 'Unable to start this Family call right now.', 'error')
          return
        }
        router.push(`/family/call/${encodeURIComponent(viewer.id)}?call=${encodeURIComponent(payload.call.id)}`)
      } catch (error) {
        console.error('Failed to start parent Family call', error)
        pushToast('Unable to start this Family call right now.', 'error')
      } finally {
        setCallActionMode(null)
      }
    },
    [authedFetch, familyCallPermissions.audio, familyCallPermissions.video, isFamilySession, router, viewer?.id],
  )

  const isFamilyCallBlocked = useCallback(
    (mode: 'audio' | 'video') => isFamilySession && !familyCallPermissions[mode],
    [familyCallPermissions, isFamilySession],
  )

  const startThreadCall = useCallback(
    async (mode: 'audio' | 'video') => {
      if (!activeThread) return
      if (activeThread.contextType) return
      if (activeThread.type !== 'direct' && activeThread.type !== 'group') return
      if (isFamilyCallBlocked(mode)) {
        setCallPermissionModalOpen(true)
        return
      }

      setCallActionMode(mode)
      try {
        const response = await authedFetch(`/messages/threads/${activeThread.id}/call/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode }),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        const payload = (await response.json().catch(() => null)) as { call?: ThreadCall; error?: string } | null
        if (!response.ok || !payload?.call) {
          pushToast(payload?.error ?? 'Unable to start this call right now.', 'error')
          return
        }
        router.push(`/messages/call/${encodeURIComponent(activeThread.id)}?call=${encodeURIComponent(payload.call.id)}`)
      } catch (error) {
        console.error('Failed to start thread call', error)
        pushToast('Unable to start this call right now.', 'error')
      } finally {
        setCallActionMode(null)
      }
    },
    [activeThread, authedFetch, isFamilyCallBlocked, router],
  )

  const handleStartFamilyDirectThread = useCallback(
    async (targetUser: FamilyProfileListItem) => {
      setStartingFamilyThreadUserId(targetUser.id)
      try {
        const response = await authedFetch('/messages/threads/direct', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: targetUser.id }),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        const payload = (await response.json().catch(() => null)) as CreateDirectThreadResponse | null
        if (!response.ok || !payload?.thread) {
          pushToast(payload?.error ?? 'Unable to start this Family conversation right now.', 'error')
          return
        }

        upsertThread(payload.thread)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(MOBILE_MORE_DRAWER_CLOSE_EVENT))
        }
        setSelectedThreadId(payload.thread.id)
        writeStoredMessagesNavSection('family')
      } catch (error) {
        console.error('Failed to start family direct thread', error)
        pushToast('Unable to start this Family conversation right now.', 'error')
      } finally {
        setStartingFamilyThreadUserId(null)
      }
    },
    [authedFetch, upsertThread],
  )

  const renderThreadList = () => {
    const mobileViewport = isMobileViewport
    const familyThreadStarters =
      activeInboxSection === 'family' && familyContactsWithoutThreads.length > 0 ? (
        <div className="space-y-3">
          {filteredOrderedThreads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-sm text-slate-500">
              <p>No family messages yet.</p>
              <p className="mt-1">Start a conversation with someone from your Family.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Start a Family chat
            </div>
          )}
          <ul className="space-y-2">
            {familyContactsWithoutThreads.map((entry) => {
              const displayName = entry.name?.trim() || entry.handle
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => void handleStartFamilyDirectThread(entry)}
                    disabled={startingFamilyThreadUserId === entry.id}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/5 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <VerifiedAvatar
                      src={entry.avatarUrl ?? null}
                      alt={displayName}
                      initials={displayName}
                      size={44}
                      isVerified={false}
                      isBusiness={false}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
                      <p className="truncate text-xs text-slate-500">{entry.relationshipLabel}</p>
                    </div>
                    <span className="text-xs font-semibold text-[var(--cc-primary)]">
                      {startingFamilyThreadUserId === entry.id ? 'Opening...' : 'Open'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null

    if (threadsLoading && filteredOrderedThreads.length === 0) {
      return <p className="text-sm text-slate-500">Loading your conversations…</p>
    }
    if (threadsError && filteredOrderedThreads.length === 0) {
      return <p className="text-sm text-rose-600">{threadsError}</p>
    }
    if (filteredOrderedThreads.length === 0) {
      if (isFamilySession && activeInboxSection === 'friends') {
        return null
      }
      if (familyThreadStarters) {
        return familyThreadStarters
      }
      const emptyLabel =
        activeInboxSection === 'groups'
          ? 'No group chats yet.'
          : activeInboxSection === 'network'
            ? 'No network messages yet.'
            : activeInboxSection === 'family'
              ? 'No family messages yet.'
              : 'No friend messages yet.'
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-sm text-slate-500">
          <p>{emptyLabel}</p>
          <p className="mt-1">
            <Link href="/search?type=people" className="font-semibold text-[var(--cc-primary)]">
              Find friends
            </Link>{' '}
            to start a conversation.
          </p>
        </div>
      )
    }
    return (
      <div className="space-y-3">
        {familyThreadStarters}
        <ul className="space-y-2">
          {filteredOrderedThreads.map((thread) => {
          const title = getThreadTitle(thread)
          const isGroupThread = thread.type === 'group'
          const active = thread.id === selectedThreadId
          const unread = threadHasUnread(thread)
          const unreadCount = threadUnreadCount(thread)
          const lastMessage = thread.lastMessage
          const lastSnippetBody = lastMessage?.body?.trim() || (lastMessage?.attachments.length ? 'Attachment' : 'Say hello!')
          const senderLabel = lastMessage
            ? lastMessage.isMine
              ? 'You'
              : formatUserDisplayName(lastMessage.sender.name, lastMessage.sender.handle) || lastMessage.sender.handle
            : null
          const lastSnippet = senderLabel ? `${senderLabel}: ${lastSnippetBody}` : lastSnippetBody
          const primaryParticipant = getPrimaryOtherParticipant(thread, me?.id)
          const threadCoverUrl = isGroupThread ? null : primaryParticipant?.user.coverUrl ?? null
          const groupParticipants = getOtherParticipants(thread, me?.id).slice(0, 4)
          const isFamilyThread = thread.inboxSection === 'family'
          return (
            <li key={thread.id}>
              <button
                type="button"
                className={clsx(
                  'relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left transition',
                  active
                    ? isFamilyThread
                      ? 'border-emerald-500 bg-emerald-50/70 shadow-lg shadow-emerald-200'
                      : 'border-[var(--cc-primary)] shadow-lg shadow-[var(--cc-primary)]/20'
                    : unread
                      ? isFamilyThread
                        ? 'border-emerald-300 bg-emerald-50/70 shadow-md shadow-emerald-100 hover:border-emerald-400'
                        : 'border-red-300 bg-red-50/70 shadow-md shadow-red-100 hover:border-red-400'
                    : isFamilyThread
                      ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
                      : 'border-slate-200 bg-white/70 hover:border-slate-300',
                )}
                onClick={() => handleThreadSelect(thread.id)}
              >
                {threadCoverUrl ? <img src={threadCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                {threadCoverUrl ? <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" /> : null}
                <div className="relative flex items-start gap-3">
                  <div className="relative">
                    {isGroupThread ? (
                      <div className="relative h-12 w-14">
                        {groupParticipants.map((participant, index) => {
                          const participantName = formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle
                          return (
                            <div key={participant.userId} className="absolute" style={{ left: `${index * 12}px`, zIndex: groupParticipants.length - index }}>
                              <VerifiedAvatar
                                src={participant.user.avatarUrl}
                                alt={participantName}
                                initials={participantName}
                                size={34}
                                isVerified={participant.user.isVerified}
                                isBusiness={participant.user.isPremium}
                                className="border-2 border-white"
                              />
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <VerifiedAvatar
                        src={primaryParticipant?.user.avatarUrl ?? null}
                        alt={title}
                        initials={title}
                        size={48}
                        isVerified={Boolean(primaryParticipant?.user.isVerified)}
                        isBusiness={Boolean(primaryParticipant?.user.isPremium)}
                      />
                    )}
                    {unread ? <span className={clsx('absolute -right-1 -top-1 inline-flex h-2.5 w-2.5 rounded-full', mobileViewport ? 'bg-red-500' : 'bg-[var(--cc-primary)]')} /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={clsx('truncate text-sm font-semibold', threadCoverUrl ? 'text-white' : 'text-slate-900')}>{title}</p>
                      <div className="flex items-center gap-2">
                        {isFamilyThread ? (
                          <span className={clsx('hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline-flex', threadCoverUrl ? 'bg-emerald-400/90 text-slate-950' : 'bg-emerald-100 text-emerald-800')}>
                            Family
                          </span>
                        ) : null}
                        {unreadCount > 0 ? (
                          <span className={clsx('inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold', threadCoverUrl ? 'bg-rose-500/90 text-white' : 'bg-rose-500 text-white')}>
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        ) : null}
                        <span className={clsx('text-xs', threadCoverUrl ? 'text-white/80' : 'text-slate-400')}>{formatTimestamp(thread.lastMessageAt)}</span>
                      </div>
                    </div>
                    <p className={clsx('mt-1 line-clamp-2 text-xs', threadCoverUrl ? 'text-white/80' : 'text-slate-500')}>{lastSnippet}</p>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
        </ul>
      </div>
    )
  }

  const renderMarketThreadList = () => {
    if (marketInboxLoading && marketInboxEntries.length === 0) {
      return <p className="text-sm text-slate-500">Loading marketplace chats…</p>
    }
    if (marketInboxError && marketInboxEntries.length === 0) {
      return <p className="text-sm text-rose-600">{marketInboxError}</p>
    }
    if (marketInboxEntries.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-sm text-slate-500">
          <p>No marketplace messages yet.</p>
          <p className="mt-1">Open a listing chat to start a marketplace conversation.</p>
        </div>
      )
    }

    return (
      <ul className="space-y-2">
        {marketInboxEntries.map((marketItem) => {
          const thread = marketThreadById.get(marketItem.threadId) ?? null
          const active = marketItem.threadId === selectedThreadId
          const unreadCount = Math.max(marketItem.unreadCount ?? 0, marketUnreadCountByThreadId.get(marketItem.threadId) ?? 0)
          const unread = unreadCount > 0
          const primaryParticipant = thread ? getPrimaryOtherParticipant(thread, me?.id) : null
          const counterpart = marketItem.counterpart ?? primaryParticipant?.user ?? null
          const counterpartName = counterpart
            ? formatUserDisplayName(counterpart.name, counterpart.handle) || `@${counterpart.handle}`
            : thread
              ? getThreadTitle(thread)
              : 'Marketplace contact'
          const lastMessage = thread?.lastMessage
          const lastSnippetBody = lastMessage?.body?.trim() || marketItem.lastMessage?.body?.trim() || (lastMessage?.attachments.length ? 'Attachment' : 'Say hello!')
          const senderLabel = lastMessage
            ? lastMessage.isMine
              ? 'You'
              : formatUserDisplayName(lastMessage.sender.name, lastMessage.sender.handle) || lastMessage.sender.handle
            : marketItem.lastMessage
              ? marketItem.lastMessage.isMine
                ? 'You'
                : counterpartName
            : null
          const lastSnippet = senderLabel ? `${senderLabel}: ${lastSnippetBody}` : lastSnippetBody

          return (
            <li key={marketItem.threadId}>
              <button
                type="button"
                onClick={() => handleThreadSelect(marketItem.threadId)}
                className={clsx(
                  'w-full rounded-2xl border p-3 text-left transition',
                  active
                    ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5 shadow-lg shadow-[var(--cc-primary)]/10'
                    : unread
                      ? 'border-red-300 bg-red-50/40 hover:border-red-400'
                      : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="relative h-16 w-16 shrink-0">
                    <div className="h-16 w-16 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                      {marketItem?.listingPhotoUrl ? (
                        <img src={marketItem.listingPhotoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">No photo</div>
                      )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-white p-[1px] shadow-sm">
                      <VerifiedAvatar
                        src={counterpart?.avatarUrl ?? null}
                        alt={counterpartName}
                        initials={counterpartName}
                        size={26}
                        isVerified={Boolean(primaryParticipant?.user.isVerified)}
                        isBusiness={Boolean(primaryParticipant?.user.isPremium)}
                      />
                    </div>
                    {unreadCount > 0 ? (
                      <span className="absolute bottom-7 right-0 z-10 inline-flex min-h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{marketItem.listingTitle || 'Marketplace item'}</p>
                        <p className="truncate text-xs text-slate-500">{counterpartName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{formatTimestamp(thread?.lastMessageAt ?? marketItem.lastMessageAt)}</span>
                      </div>
                    </div>
                    {marketItem.listingPriceCents > 0 || marketItem.listingPickupCity || marketItem.listingPickupProvince ? (
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {formatMoney(marketItem.listingPriceCents, marketItem.listingCurrency)} • {formatPickupLocation(marketItem.listingPickupCity, marketItem.listingPickupProvince)}
                      </p>
                    ) : null}
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">{lastSnippet}</p>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const renderUnreadOverview = () => {
    const hasUnreadConversations = unreadOverviewGroups.some((group) => {
      const threadItems = 'threads' in group ? group.threads ?? [] : []
      const marketItems = 'items' in group ? group.items ?? [] : []
      return threadItems.length + marketItems.length > 0
    })

    if (!hasUnreadConversations) {
      return (
        <div className="flex h-full flex-col items-center justify-center rounded-[32px] border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
          <p className="text-lg font-semibold text-slate-700">Unread messages</p>
          <p className="mt-2 text-sm text-slate-500">All caught up right now.</p>
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-0 flex-col rounded-[32px] border border-white/70 bg-white/90 p-5 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-lg font-semibold text-slate-900">Unread messages</p>
          <p className="mt-1 text-sm text-slate-500">Conversations waiting for your reply, grouped by inbox.</p>
        </div>
        <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {unreadOverviewGroups.map((group) => {
            const threadItems = 'threads' in group ? group.threads ?? [] : []
            const marketItems = 'items' in group ? group.items ?? [] : []
            const count = threadItems.length + marketItems.length
            if (count === 0) return null

            return (
              <section key={group.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">{count}</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {threadItems.map((thread) => {
                    const title = getThreadTitle(thread)
                    const primaryParticipant = getPrimaryOtherParticipant(thread, me?.id)
                    const lastMessage = thread.lastMessage
                    const lastSnippetBody = lastMessage?.body?.trim() || (lastMessage?.attachments.length ? 'Attachment' : 'Say hello!')
                    const senderLabel = lastMessage
                      ? lastMessage.isMine
                        ? 'You'
                        : formatUserDisplayName(lastMessage.sender.name, lastMessage.sender.handle) || lastMessage.sender.handle
                      : null
                    const lastSnippet = senderLabel ? `${senderLabel}: ${lastSnippetBody}` : lastSnippetBody
                    const unreadCount = threadUnreadCount(thread)

                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => handleThreadSelect(thread.id)}
                        className="flex min-w-[240px] max-w-[240px] items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300"
                      >
                        <div className="relative shrink-0">
                          <VerifiedAvatar
                            src={primaryParticipant?.user.avatarUrl ?? null}
                            alt={title}
                            initials={title}
                            size={46}
                            isVerified={Boolean(primaryParticipant?.user.isVerified)}
                            isBusiness={Boolean(primaryParticipant?.user.isPremium)}
                          />
                          {unreadCount > 0 ? (
                            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
                            <span className="text-xs text-slate-400">{formatTimestamp(thread.lastMessageAt)}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{lastSnippet}</p>
                        </div>
                      </button>
                    )
                  })}
                  {marketItems.map((marketItem) => {
                    const unreadCount = Math.max(marketItem.unreadCount ?? 0, marketUnreadCountByThreadId.get(marketItem.threadId) ?? 0)
                    const counterpartName = marketItem.counterpart
                      ? formatUserDisplayName(marketItem.counterpart.name, marketItem.counterpart.handle) || `@${marketItem.counterpart.handle}`
                      : 'Marketplace contact'
                    const lastSnippetBody = marketItem.lastMessage?.body?.trim() || 'Say hello!'
                    const lastSnippet = `${marketItem.lastMessage?.isMine ? 'You' : counterpartName}: ${lastSnippetBody}`

                    return (
                      <button
                        key={marketItem.threadId}
                        type="button"
                        onClick={() => handleThreadSelect(marketItem.threadId)}
                        className="flex min-w-[280px] max-w-[280px] items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300"
                      >
                        <div className="relative h-16 w-16 shrink-0">
                          <div className="h-16 w-16 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            {marketItem.listingPhotoUrl ? (
                              <img src={marketItem.listingPhotoUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">No photo</div>
                            )}
                          </div>
                          <div className="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-white p-[1px] shadow-sm">
                            <VerifiedAvatar
                              src={marketItem.counterpart?.avatarUrl ?? null}
                              alt={counterpartName}
                              initials={counterpartName}
                              size={26}
                            />
                          </div>
                          {unreadCount > 0 ? (
                            <span className="absolute bottom-7 right-0 z-10 inline-flex min-h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{marketItem.listingTitle || 'Marketplace item'}</p>
                            <span className="text-xs text-slate-400">{formatTimestamp(marketItem.lastMessageAt)}</span>
                          </div>
                          <p className="truncate text-xs text-slate-500">{counterpartName}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {formatMoney(marketItem.listingPriceCents, marketItem.listingCurrency)} • {formatPickupLocation(marketItem.listingPickupCity, marketItem.listingPickupProvince)}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{lastSnippet}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    )
  }

  const renderMessages = () => {
    if (!activeThread && isFamilyParentThreadSelected) {
      return (
        <div className="flex h-full flex-col justify-between rounded-[32px] border border-white/70 bg-white/90 px-6 py-6 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Parent</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">{familyParentName}</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              Your parent account is available from the Family shell here, but it does not appear as a normal direct-message thread inside the child inbox.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void startFamilyParentCall('audio')
              }}
              disabled={callActionMode !== null}
              className={clsx(
                'inline-flex h-10 w-10 items-center justify-center rounded-full border transition',
                familyCallPermissions.audio
                  ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  : 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-100',
                callActionMode !== null ? 'cursor-not-allowed opacity-50' : '',
              )}
              title={familyCallPermissions.audio ? 'Start audio call' : 'Audio calling disabled'}
              aria-label={familyCallPermissions.audio ? 'Start audio call with parent' : 'Audio calling disabled'}
            >
              <HiOutlinePhone className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                void startFamilyParentCall('video')
              }}
              disabled={callActionMode !== null}
              className={clsx(
                'inline-flex h-10 w-10 items-center justify-center rounded-full border transition',
                familyCallPermissions.video
                  ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  : 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-100',
                callActionMode !== null ? 'cursor-not-allowed opacity-50' : '',
              )}
              title={familyCallPermissions.video ? 'Start video call' : 'Video calling disabled'}
              aria-label={familyCallPermissions.video ? 'Start video call with parent' : 'Video calling disabled'}
            >
              <HiOutlineVideoCamera className="h-5 w-5" />
            </button>
            <Link
              href={familyParentHandle ? `/u/${encodeURIComponent(familyParentHandle)}` : '/settings/guardian'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
            >
              View Parent Profile
            </Link>
          </div>
        </div>
      )
    }

    if (!activeThread && selectedThreadId) {
      return (
        <div className="flex h-full flex-col items-center justify-center rounded-[32px] border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
          <p className="text-lg font-semibold text-slate-700">Opening conversation…</p>
          <p className="mt-2 text-sm text-slate-500">Loading the selected thread.</p>
        </div>
      )
    }

    if (!activeThread) {
      return renderUnreadOverview()
    }

    const otherParticipant = getPrimaryOtherParticipant(activeThread, me?.id)
    const otherUser = otherParticipant?.user
    const title = getThreadTitle(activeThread)
    const threadProfileHref = otherUser?.handle ? `/u/${encodeURIComponent(otherUser.handle)}` : null
    const headerGroupParticipants = getOtherParticipants(activeThread, me?.id).slice(0, 5)
    const showMobileDockComposer = isMobileViewport
    const composerKeyboardOffset = Math.max(0, Math.round(mobileKeyboardInset))
    const mobileComposerBottomSpacer = showMobileDockComposer ? 'var(--mobile-thread-composer-height)' : undefined

    const sendActiveThreadMessage = () => {
      if (activeThread) {
        void sendMessage(activeThread.id)
      }
    }

    const composerNode = showMobileDockComposer ? (
      <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-2" role="group" aria-label="Message composer">
        <input
          ref={composerInputRef}
          type="text"
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onFocus={() => {
            setComposerFocused(true)
            requestAnimationFrame(() => syncMobileKeyboardState())
            scheduleMessagesBottomSettle('auto')
          }}
          onBlur={() => {
            setComposerFocused(false)
            setTimeout(() => syncMobileKeyboardState(), 80)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              sendActiveThreadMessage()
            }
          }}
          placeholder="Write a message"
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          enterKeyHint="send"
          inputMode="text"
          className="h-11 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
        />
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          accept="image/jpeg,image/png,image/webp,image/heic"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onPointerDown={handleMobileComposerPressStart}
          onMouseDown={handleMobileComposerPressStart}
          onTouchStart={handleMobileComposerPressStart}
          onTouchEnd={(event) => {
            event.preventDefault()
            event.stopPropagation()
            markMobileComposerTouch()
            fileInputRef.current?.click()
          }}
          onClick={(event) => {
            if (shouldIgnoreMobileComposerClick()) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            fileInputRef.current?.click()
          }}
          disabled={isUploading}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-50"
          title="Add photo"
        >
          <HiOutlinePhoto className={clsx('h-5 w-5', isUploading ? 'animate-pulse' : '')} />
        </button>
        <button
          type="button"
          onPointerDown={handleMobileComposerPressStart}
          onMouseDown={handleMobileComposerPressStart}
          onTouchStart={handleMobileComposerPressStart}
          onTouchEnd={(event) => {
            event.preventDefault()
            event.stopPropagation()
            markMobileComposerTouch()
            sendActiveThreadMessage()
          }}
          onClick={(event) => {
            if (shouldIgnoreMobileComposerClick()) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            sendActiveThreadMessage()
          }}
          disabled={(!composerText.trim() && attachments.length === 0) || sending || isUploading}
          className={clsx(
            'inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition',
            (!composerText.trim() && attachments.length === 0) || sending || isUploading
              ? 'cursor-not-allowed bg-slate-300'
              : 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]',
          )}
        >
          <HiOutlinePaperAirplane className="h-5 w-5" />
        </button>
      </div>
    ) : (
      <form
        className="flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          sendActiveThreadMessage()
        }}
      >
        {attachments.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-2 pb-2">
            {attachments.map((url, i) => (
              <div key={i} className="relative h-16 w-16 shrink-0">
                <img src={url} alt="Attachment" className="h-full w-full rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-0.5 text-white shadow-sm hover:bg-slate-700"
                >
                  <HiOutlineXMark className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <input
          ref={composerTextareaRef}
          type="text"
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onFocus={() => {
            setComposerFocused(true)
            requestAnimationFrame(() => syncMobileKeyboardState())
            scheduleMessagesBottomSettle('auto')
          }}
          onBlur={() => {
            setComposerFocused(false)
            setTimeout(() => syncMobileKeyboardState(), 80)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              sendActiveThreadMessage()
            }
          }}
          placeholder="Write a message"
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          enterKeyHint="send"
          inputMode="text"
          className="h-12 w-full border-none bg-transparent px-2 text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={handleFileSelect}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-[var(--cc-primary)] disabled:opacity-50"
              title="Add photo"
            >
              <HiOutlinePhoto className={clsx('h-6 w-6', isUploading ? 'animate-pulse' : '')} />
            </button>
          </div>
          <button
            type="submit"
            disabled={(!composerText.trim() && attachments.length === 0) || sending || isUploading}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white transition',
              (!composerText.trim() && attachments.length === 0) || sending || isUploading
                ? 'cursor-not-allowed bg-slate-300'
                : 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-dark, #0d5)]',
            )}
          >
            <HiOutlinePaperAirplane className="h-4 w-4" />
            Send
          </button>
        </div>
      </form>
    )

    return (
      <div
        ref={threadPanelRef}
        className="flex h-full min-h-0 flex-col rounded-[32px] border border-white/70 bg-white/90 px-4 pb-4 pt-5 shadow-[0_25px_70px_rgba(15,23,42,0.08)] sm:p-4"
        style={isMobileViewport && mobileThreadPanelHeight ? { height: mobileThreadPanelHeight } : undefined}
      >
        <header ref={threadHeaderRef} className="border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="-ml-2 mr-1 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-sm transition hover:bg-[var(--cc-primary-700)] xl:hidden"
              onClick={() => setSelectedThreadId(null)}
            >
              <HiOutlineChevronLeft className="h-5 w-5" />
            </button>
            {isActiveGroupThread ? (
              <div className="relative h-10 w-20 shrink-0">
                {headerGroupParticipants.map((participant, index) => {
                  const participantName = formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle
                  return (
                    <div key={participant.userId} className="absolute" style={{ left: `${index * 12}px`, zIndex: headerGroupParticipants.length - index }}>
                      <VerifiedAvatar
                        src={participant.user.avatarUrl}
                        alt={participantName}
                        initials={participantName}
                        size={36}
                        isVerified={participant.user.isVerified}
                        isBusiness={participant.user.isPremium}
                        className="border-2 border-white"
                      />
                    </div>
                  )
                })}
              </div>
            ) : otherUser ? (
              <Link href={threadProfileHref ?? `/u/${encodeURIComponent(otherUser.handle)}`} className="shrink-0 transition hover:opacity-80">
                <VerifiedAvatar
                  src={otherUser.avatarUrl}
                  alt={title}
                  initials={title}
                  size={40}
                  isVerified={otherUser.isVerified}
                  isBusiness={otherUser.isPremium}
                />
              </Link>
            ) : (
              <div className="shrink-0">
                <VerifiedAvatar src={null} alt={title} initials={title} size={40} />
              </div>
            )}
            {isActiveGroupThread || !threadProfileHref ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500">
                  {activeThread.participants.length > 2 ? `${activeThread.participants.length} participants` : 'Direct message'}
                  {activeThreadCall ? ` · ${activeThreadCall.mode === 'video' ? 'Video' : 'Audio'} call live` : ''}
                </p>
              </div>
            ) : (
              <Link href={threadProfileHref} className="min-w-0 flex-1 rounded-2xl transition hover:opacity-80">
                <p className="truncate text-lg font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500">
                  Direct message
                  {activeThreadCall ? ` · ${activeThreadCall.mode === 'video' ? 'Video' : 'Audio'} call live` : ''}
                </p>
              </Link>
            )}
            {activeThreadSupportsCalling ? (
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {activeThreadCall ? (
                  <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 sm:inline-flex">
                    Active call
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void startThreadCall('audio')
                  }}
                  disabled={callActionMode !== null}
                  className={clsx(
                    'inline-flex h-8 w-8 items-center justify-center rounded-full border transition disabled:opacity-50 sm:h-9 sm:w-9',
                    isFamilyCallBlocked('audio')
                      ? 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                  title={activeThreadCall ? 'Join audio call' : 'Start audio call'}
                >
                  <HiOutlinePhone className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void startThreadCall('video')
                  }}
                  disabled={callActionMode !== null}
                  className={clsx(
                    'inline-flex h-8 w-8 items-center justify-center rounded-full border transition disabled:opacity-50 sm:h-9 sm:w-9',
                    isFamilyCallBlocked('video')
                      ? 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                  title={activeThreadCall ? 'Join video call' : 'Start video call'}
                >
                  <HiOutlineVideoCamera className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
              </div>
            ) : null}
            {isActiveGroupThread ? (
              <details className="group relative">
                <summary className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <HiOutlineCog6Tooth className="h-5 w-5" />
                </summary>
                <div className="absolute right-0 top-full z-20 mt-2 min-w-[190px] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                  {isActiveGroupOwner ? (
                    <button
                      type="button"
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      onClick={openManageMembersModal}
                    >
                      Manage members
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      onClick={leaveActiveGroup}
                      disabled={leavingGroup}
                    >
                      {leavingGroup ? 'Leaving…' : 'Leave group'}
                    </button>
                  )}
                </div>
              </details>
            ) : null}
          </div>
          {activeThread.contextType === 'market_listing' ? (
            <div className="mt-3">
              {marketThreadContextLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">Loading item…</div>
              ) : marketThreadContext?.listing && activeMarketListingHref ? (
                <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92)_0%,rgba(255,255,255,0.98)_100%)] p-3 sm:p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:justify-between">
                    <Link href={activeMarketListingHref} className="min-w-0 flex-1 rounded-[20px] border border-transparent p-2 transition hover:border-slate-200 hover:bg-white/90">
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:h-[76px] sm:w-[76px]">
                          {marketThreadContext.listing.photoUrl ? (
                            <img src={marketThreadContext.listing.photoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">No photo</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{marketThreadContext.listing.title}</p>
                            <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
                              {formatMarketListingStatus(marketThreadContext.listing.status)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-600">
                            {formatMoney(marketThreadContext.listing.priceCents, marketThreadContext.listing.currency)} •{' '}
                            {formatPickupLocation(marketThreadContext.listing.pickupCity, marketThreadContext.listing.pickupProvince)}
                          </p>
                          {marketThreadContext.listing.civilPayStatus === 'completed' ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700 shadow-sm">Paid</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                    <div className="rounded-[20px] border border-slate-200 bg-white/90 p-2.5 shadow-sm xl:w-[420px] xl:self-center">
                      <div className="flex flex-wrap items-center gap-2">
                      {canCompleteActiveMarketCivilPay && activeMarketCivilPayHref ? (
                        <Link
                          href={activeMarketCivilPayHref}
                          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                        >
                          Complete Civil Pay
                        </Link>
                      ) : null}
                      {canSelectActiveMarketBuyer ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMarketHeaderActionError(null)
                            setMarketSelectBuyerConfirmOpen(true)
                          }}
                          disabled={marketSelectBuyerSubmitting || marketUnselectBuyerSubmitting || marketMarkSoldSubmitting}
                          className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Select This Buyer
                        </button>
                      ) : null}
                      {canUnselectActiveMarketBuyer ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMarketHeaderActionError(null)
                            setMarketUnselectBuyerConfirmOpen(true)
                          }}
                          disabled={marketSelectBuyerSubmitting || marketUnselectBuyerSubmitting || marketMarkSoldSubmitting}
                          className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Relist
                        </button>
                      ) : null}
                      {showMarkSoldFromActiveMarketThread ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!canMarkSoldFromActiveMarketThread) return
                            setMarketHeaderActionError(null)
                            setMarketMarkSoldConfirmOpen(true)
                          }}
                          disabled={!canMarkSoldFromActiveMarketThread || marketSelectBuyerSubmitting || marketUnselectBuyerSubmitting || marketMarkSoldSubmitting}
                          className={clsx(
                            'rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70',
                            canMarkSoldFromActiveMarketThread
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'border border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-100',
                          )}
                        >
                          Mark sold
                        </button>
                      ) : null}
                      {canAccessActiveMarketPickupDirections && activeMarketPickupDirectionsHref ? (
                        <Link
                          href={activeMarketPickupDirectionsHref}
                          className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Directions for pickup
                        </Link>
                      ) : null}
                      {canMarkActiveMarketPickupComplete ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleMarkActiveMarketPickupComplete()
                          }}
                          disabled={marketPickupCompleteSubmitting}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {marketPickupCompleteSubmitting ? 'Marking…' : 'Mark picked up'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  </div>
                  {marketThreadContext.viewerIsSeller && marketThreadContext.selectedThreadId && !activeMarketThreadIsSelectedBuyer ? (
                    <p className="mt-3 text-xs font-medium text-slate-500">A different buyer is currently selected for this item.</p>
                  ) : null}
                  {marketHeaderActionError ? <p className="mt-3 text-sm text-rose-700">{marketHeaderActionError}</p> : null}
                  {activeMarketDeliveryVisible && marketThreadContext.deliveryContract ? (
                    <div className="mt-3 rounded-[20px] border border-emerald-200 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(14,165,233,0.08))] p-3.5 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Civil Driver</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{formatMarketDeliveryStatus(marketThreadContext.deliveryContract.status)}</p>
                            {marketThreadContext.deliveryContract.bidAmountCents ? <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[11px] font-semibold text-emerald-700">Bid {formatMoney(marketThreadContext.deliveryContract.bidAmountCents, 'CAD')}</span> : null}
                            {marketThreadContext.deliveryContract.estimatedDeliveryAt ? <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">ETA {new Date(marketThreadContext.deliveryContract.estimatedDeliveryAt).toLocaleString()}</span> : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-700">
                            {(() => {
                              const contract = marketThreadContext.deliveryContract
                              const driverName = formatMarketDeliveryDriverName(contract.driver)
                              const status = (contract.status || '').trim().toLowerCase()
                              if (status === 'open') return 'The selected buyer requested Civil delivery. Drivers can place bids now.'
                              if (status === 'bid_pending') return `${driverName} placed a delivery bid${contract.bidAmountCents ? ` for ${formatMoney(contract.bidAmountCents, 'CAD')}` : ''}.`
                              if (status === 'assigned') return `${driverName} is assigned and the delivery chat is ready.`
                              if (status === 'picked_up') return `${driverName} picked up the item and delivery is in progress.`
                              if (status === 'delivered') return `${driverName} marked the delivery complete with proof.`
                              return 'Civil delivery is active for this item.'
                            })()}
                          </p>
                          {marketThreadContext.deliveryContract.itemTraits.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {marketThreadContext.deliveryContract.itemTraits.map((trait) => (
                                <span key={trait} className="rounded-full border border-white/80 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">{trait}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="w-full max-w-sm rounded-2xl border border-white/80 bg-white/90 p-3">
                          {marketThreadContext.deliveryContract.driver ? (
                            <CivilCard
                              size="rail"
                              name={formatMarketDeliveryDriverName(marketThreadContext.deliveryContract.driver)}
                              avatarAlt={formatMarketDeliveryDriverName(marketThreadContext.deliveryContract.driver)}
                              avatarInitials={formatMarketDeliveryDriverName(marketThreadContext.deliveryContract.driver)}
                              avatarSrc={marketThreadContext.deliveryContract.driver.avatarUrl || undefined}
                              subtitle={marketThreadContext.deliveryContract.driver.handle ? `@${marketThreadContext.deliveryContract.driver.handle}` : 'Driver'}
                            />
                          ) : (
                            <p className="text-sm text-slate-600">No driver is assigned yet.</p>
                          )}
                          {marketThreadContext.deliveryContract.pickupInstructions?.trim() ? <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">{marketThreadContext.deliveryContract.pickupInstructions.trim()}</p> : null}
                          {activeMarketDeliveryChatHref ? (
                            <Link
                              href={activeMarketDeliveryChatHref}
                              className="mt-3 inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
                            >
                              Open delivery chat
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </header>
        <div className="mt-4 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            {activeThreadHasMore ? (
              <button
                type="button"
                className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
                onClick={() => loadOlderMessages(activeThread.id)}
                disabled={loadingOlderThreadId === activeThread.id}
              >
                <HiOutlineArrowPath className={clsx('h-4 w-4', loadingOlderThreadId === activeThread.id ? 'animate-spin' : '')} />
                Load previous
              </button>
            ) : null}
            <div
              ref={messagesViewportRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2"
              style={
                mobileComposerBottomSpacer || mobileMessagesViewportHeight
                  ? {
                      scrollPaddingBottom: mobileComposerBottomSpacer,
                      height: mobileMessagesViewportHeight ?? undefined,
                      maxHeight: mobileMessagesViewportHeight ?? undefined,
                    }
                  : undefined
              }
            >
              <div
                className={clsx('flex min-h-full flex-col justify-end gap-4', showMobileDockComposer ? 'pb-0' : 'pb-1')}
              >
                {activeMessages.length === 0 && loadingThreadId === activeThread.id ? (
                  <p className="text-center text-sm text-slate-500">Loading messages…</p>
                ) : null}
                {activeMessages.map((message) => {
                  if (message.messageType === 'system' && message.systemMeta?.kind === 'call_ended') {
                    const callMeta = message.systemMeta
                    const callMode = callMeta.mode === 'audio' ? 'audio' : 'video'
                    const callbackLabel = callMeta.callbackLabel || 'Call Back'
                    return (
                      <div key={message.id} className="flex w-full justify-center">
                        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-center shadow-sm">
                          <p className="text-sm font-semibold text-slate-800">{message.body || 'Call ended.'}</p>
                          <div className="mt-3 flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void startThreadCall(callMode)
                              }}
                              disabled={callActionMode !== null}
                              className={clsx(
                                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition disabled:opacity-50',
                                isFamilyCallBlocked(callMode)
                                  ? 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-100'
                                  : 'border-[var(--cc-primary)] bg-white text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/5',
                              )}
                            >
                              {message.systemMeta.mode === 'audio' ? <HiOutlinePhone className="h-4 w-4" /> : <HiOutlineVideoCamera className="h-4 w-4" />}
                              {callbackLabel}
                            </button>
                          </div>
                          <span className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400">{formatTimestamp(message.createdAt)}</span>
                        </div>
                      </div>
                    )
                  }

                  if (message.messageType === 'system' && message.systemMeta?.kind === 'market_payment_prompt') {
                    const resolvedSelectedOption =
                      message.systemMeta.selectedOption ??
                      (marketThreadContext?.listing?.id === message.systemMeta.listingId ? activeMarketSelectedPaymentType : null)
                    const canChoosePayment = Boolean(
                      marketThreadContext?.viewerIsSelectedBuyer &&
                        activeMarketThreadIsSelectedBuyer &&
                        marketThreadContext.listing.id === message.systemMeta.listingId &&
                        !resolvedSelectedOption,
                    )
                    return (
                      <div key={message.id} className="flex w-full justify-center">
                        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4 text-center shadow-sm">
                          <p className="text-sm font-semibold text-slate-900">{message.body || 'How would you like to pay?'}</p>
                          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                            {message.systemMeta.options.map((option) => {
                              const active = resolvedSelectedOption === option
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => {
                                    if (!canChoosePayment || marketPaymentSelectionSubmitting) return
                                    void handleChooseActiveMarketPayment(option)
                                  }}
                                  disabled={!canChoosePayment || Boolean(marketPaymentSelectionSubmitting)}
                                  className={clsx(
                                    'rounded-full border px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                                    active
                                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
                                  )}
                                >
                                  {marketPaymentSelectionSubmitting === option ? 'Saving…' : formatMarketPaymentTypeLabel(option)}
                                </button>
                              )
                            })}
                          </div>
                          <p className="mt-3 text-xs text-slate-500">
                            {resolvedSelectedOption
                              ? `${formatMarketPaymentTypeLabel(resolvedSelectedOption)} selected.`
                              : canChoosePayment
                                ? 'Choose one payment option to continue.'
                                : 'Waiting for the buyer to choose a payment option.'}
                          </p>
                          <span className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400">{formatTimestamp(message.createdAt)}</span>
                        </div>
                      </div>
                    )
                  }

                  if (message.messageType === 'system' && message.systemMeta?.kind === 'market_payment_selected') {
                    const canCompleteCivilPayFromMessage = Boolean(
                      message.systemMeta.selectedOption === 'civil_wallet' &&
                        marketThreadContext?.viewerIsSelectedBuyer &&
                        activeMarketThreadIsSelectedBuyer &&
                        activeMarketCivilPayHref,
                    )
                    return (
                      <div key={message.id} className="flex w-full justify-center">
                        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4 text-center shadow-sm">
                          <p className="text-sm font-semibold text-slate-900">{message.body || `${message.systemMeta.selectedLabel} selected.`}</p>
                          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                            <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                              {message.systemMeta.selectedLabel}
                            </span>
                            {message.systemMeta.selectedOption === 'etransfer' && message.systemMeta.eTransferEmail ? (
                              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                                {message.systemMeta.eTransferEmail}
                              </span>
                            ) : null}
                            {canCompleteCivilPayFromMessage ? (
                              <Link
                                href={activeMarketCivilPayHref!}
                                className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                              >
                                Complete Civil Pay
                              </Link>
                            ) : null}
                          </div>
                          <span className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400">{formatTimestamp(message.createdAt)}</span>
                        </div>
                      </div>
                    )
                  }

                  const isMine = message.isMine
                  const senderDisplayName = formatUserDisplayName(message.sender.name, message.sender.handle) || message.sender.handle
                  const viewerDisplayName = formatUserDisplayName(me?.name, me?.handle) || me?.handle || 'You'
                  const civilUrls = message.body ? extractCivilUrlsFromMessage(message.body).slice(0, 3) : []
                  const civilUrlsWithPreview = civilUrls.filter((url) => Boolean(messageLinkPreviews[url]))
                  const suppressedUrls = civilUrlsWithPreview.length ? new Set(civilUrlsWithPreview) : undefined
                  const bubbleClasses = clsx(
                    'w-fit min-w-[5.5rem] max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow transition',
                    isMine
                      ? 'ml-auto bg-[var(--cc-primary)] text-white'
                      : 'mr-auto border border-slate-100 bg-white text-slate-800',
                  )
                  return (
                    <div key={message.id} className={clsx('flex w-full', isMine ? 'justify-end' : 'justify-start')}>
                      {!isMine ? (
                        <Link href={`/u/${encodeURIComponent(message.sender.handle)}`} className="mr-2 mt-5 shrink-0">
                          <VerifiedAvatar
                            src={message.sender.avatarUrl}
                            alt={senderDisplayName}
                            initials={senderDisplayName}
                            size={30}
                            isVerified={message.sender.isVerified}
                            isBusiness={message.sender.isPremium}
                          />
                        </Link>
                      ) : null}
                      <div className={clsx('flex flex-col', isMine ? 'items-end' : 'items-start')}>
                        <p className="mb-1 text-xs font-semibold text-slate-500">{isMine ? 'You' : senderDisplayName}</p>
                        <div className={bubbleClasses}>
                          {message.deletedAt ? (
                            <p className="italic text-slate-400">Message removed.</p>
                          ) : (
                            <>
                              {message.body ? renderMessageBodyWithLinks(message.body, isMine, suppressedUrls) : null}
                              {civilUrls.map((url) => renderMessageLinkPreviewCard(url, isMine))}
                              {message.attachments.length > 0 ? (
                                <div className={clsx('mt-2 grid gap-2', message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                                  {message.attachments.map((url, i) => (
                                    <img
                                      key={i}
                                      src={url}
                                      alt="Attachment"
                                      className="max-h-60 w-full cursor-pointer rounded-lg object-cover transition hover:opacity-90"
                                      onClick={() => setLightboxUrl(url)}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                        <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{formatTimestamp(message.createdAt)}</span>
                      </div>
                      {isMine ? (
                        <Link href={me?.handle ? `/u/${encodeURIComponent(me.handle)}` : '/profile'} className="ml-2 mt-5 shrink-0">
                          <VerifiedAvatar
                            src={me?.avatarUrl ?? null}
                            alt={viewerDisplayName}
                            initials={viewerDisplayName}
                            size={30}
                            isVerified={Boolean(me?.isVerified)}
                            isBusiness={Boolean(me?.isPremium)}
                          />
                        </Link>
                      ) : null}
                    </div>
                  )
                })}
                {activePendingAttachmentMessages.map((message) => {
                  const viewerDisplayName = formatUserDisplayName(me?.name, me?.handle) || me?.handle || 'You'
                  return (
                    <div key={message.id} className="flex w-full justify-end">
                      <div className="flex flex-col items-end">
                        <p className="mb-1 text-xs font-semibold text-slate-500">You</p>
                        <div className="ml-auto flex min-w-[10rem] max-w-[80%] items-center gap-2 rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm text-white shadow opacity-85">
                          <HiOutlineArrowPath className="h-4 w-4 shrink-0 animate-spin" />
                          <div className="min-w-0">
                            <p className="font-medium">Uploading image…</p>
                            {message.body ? <p className="mt-1 truncate text-xs text-white/85">{message.body}</p> : null}
                          </div>
                        </div>
                        <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Sending…</span>
                      </div>
                      <Link href={me?.handle ? `/u/${encodeURIComponent(me.handle)}` : '/profile'} className="ml-2 mt-5 shrink-0">
                        <VerifiedAvatar
                          src={me?.avatarUrl ?? null}
                          alt={viewerDisplayName}
                          initials={viewerDisplayName}
                          size={30}
                          isVerified={Boolean(me?.isVerified)}
                          isBusiness={Boolean(me?.isPremium)}
                        />
                      </Link>
                    </div>
                  )
                })}
                <div
                  ref={messagesEndRef}
                  aria-hidden="true"
                  className="w-full shrink-0"
                  style={mobileComposerBottomSpacer ? { height: mobileComposerBottomSpacer } : { height: `${MOBILE_THREAD_MESSAGE_CLEARANCE_PX}px` }}
                />
              </div>
            </div>
            {showMobileDockComposer ? null : (
              <div className="mt-4">{composerNode}</div>
            )}
          </div>
        </div>
        {showMobileDockComposer && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={mobileComposerShellRef}
                className="fixed inset-x-0 z-[85] min-h-[var(--mobile-thread-composer-height)] border-t border-slate-200 bg-white/95 px-3 pb-[var(--mobile-dock-bottom-pad)] pt-[var(--mobile-bottom-bar-top-pad)] shadow-[0_-8px_20px_rgba(15,23,42,0.08)] xl:hidden"
                style={{
                  bottom: `calc(var(--mobile-dock-clearance) + ${composerKeyboardOffset}px)`,
                }}
              >
                {composerNode}
              </div>,
              document.body,
            )
          : null}
      </div>
    )
  }

  const activeContextLabel = isFamilySession
    ? 'Friends Inbox'
    : activeInboxSection === 'family'
      ? 'Family Inbox'
      : activeInboxSection === 'market'
        ? 'Market Inbox'
      : activeInboxSection === 'network'
        ? 'Network Inbox'
        : activeInboxSection === 'groups'
          ? 'Groups Inbox'
          : 'Friends Inbox'
  const activeContextUnreadCount = activeInboxSection === 'family'
    ? messagesNavUnreadCounts.family
    : activeInboxSection === 'market'
    ? messagesNavUnreadCounts.market
    : activeInboxSection === 'network'
    ? messagesNavUnreadCounts.network
    : activeInboxSection === 'groups'
      ? messagesNavUnreadCounts.groups
      : messagesNavUnreadCounts.friends
  const contactsHref = me?.handle ? `/u/${encodeURIComponent(me.handle)}/contacts` : '/friends'

  const threadsFooter = threadCursor ? (
    <button
      type="button"
      onClick={() => loadThreads(threadCursor, true)}
      className="mt-3 w-full rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
      disabled={threadsLoading}
    >
      Load more conversations
    </button>
  ) : null

  const inboxPanel = (
    <div className="flex h-full min-h-0 flex-col rounded-[32px] border border-white/70 bg-white/90 p-4 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
      <div className="space-y-3 border-b border-slate-100 pb-4">
        <MessagesNavBlock
          active={activeInboxSection}
          onActiveChange={(next) => {
            setActiveInboxSection(next)
          }}
          unreadCounts={messagesNavUnreadCounts}
          visibleItems={isFamilySession ? ['friends', 'groups'] : showFamilyInbox ? ['friends', 'family', 'network', 'groups', 'market'] : undefined}
          footerAction={!isFamilySession && me?.handle ? { label: 'My Contacts', href: contactsHref } : undefined}
          className="border border-slate-200/90 bg-slate-50/70"
        />
      </div>
      {activeInboxSection === 'market' ? (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{activeContextLabel}</p>
            <p className="text-[11px] text-slate-400">
              {activeContextUnreadCount > 0 ? `${activeContextUnreadCount} unread` : 'All caught up'} · {marketInboxEntries.length}{' '}
              {marketInboxEntries.length === 1 ? 'chat' : 'chats'}
            </p>
          </div>
          {renderMarketThreadList()}
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{activeContextLabel}</p>
            <p className="text-[11px] text-slate-400">
              {activeContextUnreadCount > 0 ? `${activeContextUnreadCount} unread` : 'All caught up'} · {filteredOrderedThreads.length}{' '}
              {filteredOrderedThreads.length === 1 ? 'thread' : 'threads'}
            </p>
          </div>
          {renderThreadList()}
          {threadsFooter}
        </div>
      )}
    </div>
  )

  const keyboardAwareViewportClass =
    'min-h-0 h-[calc(var(--cc-viewport-height)-var(--cc-native-safe-top-offset)-var(--cc-native-shell-top-gap)-var(--mobile-dock-clearance))] pb-4 md:sticky md:top-0 md:h-[calc(var(--cc-viewport-height)-var(--cc-top-nav-height))] md:pb-8'

  return (
    <DashboardShell
      className="!min-h-0"
      rightRail={inboxPanel}
      mainTopClassName="pt-0"
      rightRailClassName={keyboardAwareViewportClass}
      rightRailTopClassName="pt-0"
      mainClassName={keyboardAwareViewportClass}
    >
      {activeInboxSection === 'market' ? (
        selectedThreadId && activeThread ? (
          <div className="h-full min-h-0">{renderMessages()}</div>
        ) : (
          <div className="h-full min-h-0">{renderMessages()}</div>
        )
      ) : isMobileViewport ? (
        <div className={clsx('h-full min-h-0', activeThread || isFamilyParentThreadSelected ? 'pt-2' : '')}>{activeThread || isFamilyParentThreadSelected ? renderMessages() : inboxPanel}</div>
      ) : (
        <div className="h-full min-h-0">{renderMessages()}</div>
      )}
      {lightboxUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
              onClick={() => setLightboxUrl(null)}
            >
              <button
                type="button"
                className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                onClick={() => setLightboxUrl(null)}
              >
                <HiOutlineXMark className="h-6 w-6" />
              </button>
              <img
                src={lightboxUrl}
                alt="Full size"
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
      <Modal open={callPermissionModalOpen} onClose={() => setCallPermissionModalOpen(false)} title="Call permissions" maxWidthClassName="max-w-md">
        <p className="text-sm leading-6 text-slate-600">You don't have permission from your parent or guardian for this feature</p>
      </Modal>
      <Modal
        open={marketSelectBuyerConfirmOpen}
        onClose={() => {
          if (marketSelectBuyerSubmitting) return
          setMarketSelectBuyerConfirmOpen(false)
        }}
        title="Select This Buyer"
        maxWidthClassName="max-w-lg"
      >
        <p className="text-sm text-slate-700">The pickup address will now be shared with the buyer.</p>
        {marketHeaderActionError ? <p className="mt-3 text-sm text-rose-700">{marketHeaderActionError}</p> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setMarketSelectBuyerConfirmOpen(false)}
            disabled={marketSelectBuyerSubmitting}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSelectActiveMarketBuyer()
            }}
            disabled={marketSelectBuyerSubmitting}
            className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {marketSelectBuyerSubmitting ? 'Selecting…' : 'Select This Buyer'}
          </button>
        </div>
      </Modal>
      <Modal
        open={marketUnselectBuyerConfirmOpen}
        onClose={() => {
          if (marketUnselectBuyerSubmitting) return
          setMarketUnselectBuyerConfirmOpen(false)
        }}
        title="Relist item?"
        maxWidthClassName="max-w-lg"
      >
        <p className="text-sm text-slate-700">This will put the item back on the market so you can continue with other buyers or start over.</p>
        {marketHeaderActionError ? <p className="mt-3 text-sm text-rose-700">{marketHeaderActionError}</p> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setMarketUnselectBuyerConfirmOpen(false)}
            disabled={marketUnselectBuyerSubmitting}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleUnselectActiveMarketBuyer()
            }}
            disabled={marketUnselectBuyerSubmitting}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {marketUnselectBuyerSubmitting ? 'Relisting…' : 'Relist'}
          </button>
        </div>
      </Modal>
      <Modal
        open={marketMarkSoldConfirmOpen}
        onClose={() => {
          if (marketMarkSoldSubmitting) return
          setMarketMarkSoldConfirmOpen(false)
        }}
        title="Mark item sold?"
        maxWidthClassName="max-w-lg"
      >
        <p className="text-sm text-slate-700">This will remove the listing, send active buyer chats a message saying the item has been sold, and send a push notification to those buyers.</p>
        {marketHeaderActionError ? <p className="mt-3 text-sm text-rose-700">{marketHeaderActionError}</p> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setMarketMarkSoldConfirmOpen(false)}
            disabled={marketMarkSoldSubmitting}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleMarkSoldFromActiveMarketThread()
            }}
            disabled={marketMarkSoldSubmitting}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {marketMarkSoldSubmitting ? 'Marking sold…' : 'Mark sold'}
          </button>
        </div>
      </Modal>
      {manageMembersOpen && activeThread && isActiveGroupOwner
        ? createPortal(
            <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/45 p-4" onClick={() => setManageMembersOpen(false)}>
              <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Manage Group Members</h3>
                    <p className="text-xs text-slate-500">Add or remove members for this group chat.</p>
                  </div>
                  <button type="button" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100" onClick={() => setManageMembersOpen(false)}>
                    <HiOutlineXMark className="h-5 w-5" />
                  </button>
                </div>

                <div className="min-h-0 grid flex-1 gap-5 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add Members</p>
                    <input
                      type="text"
                      value={groupCandidateFilter}
                      onChange={(event) => setGroupCandidateFilter(event.target.value)}
                      placeholder="Filter addable contacts"
                      className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-300"
                    />
                    <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                      {groupCandidatesLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
                      {!groupCandidatesLoading && filteredGroupCandidates.length === 0 ? <p className="text-sm text-slate-500">No available contacts to add.</p> : null}
                      {filteredGroupCandidates.map((contact) => (
                        <div key={contact.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <VerifiedAvatar
                              src={contact.avatarUrl}
                              alt={formatUserDisplayName(contact.name, contact.handle) || contact.handle}
                              initials={formatUserDisplayName(contact.name, contact.handle) || contact.handle}
                              size={34}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{formatUserDisplayName(contact.name, contact.handle) || contact.handle}</p>
                              <p className="truncate text-xs text-slate-500">@{contact.handle}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
                            onClick={() => addGroupMember(contact.id)}
                            disabled={memberActionLoadingId === contact.id}
                          >
                            {memberActionLoadingId === contact.id ? 'Adding…' : 'Add'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Current Members</p>
                    <input
                      type="text"
                      value={groupMemberFilter}
                      onChange={(event) => setGroupMemberFilter(event.target.value)}
                      placeholder="Filter current members"
                      className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-300"
                    />
                    <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                      {filteredCurrentMembers.map((participant) => {
                          const removable = participant.role !== 'admin'
                          return (
                            <div key={participant.userId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <VerifiedAvatar
                                  src={participant.user.avatarUrl}
                                  alt={formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle}
                                  initials={formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle}
                                  size={34}
                                  isVerified={participant.user.isVerified}
                                  isBusiness={participant.user.isPremium}
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900">{formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle}</p>
                                  <p className="truncate text-xs text-slate-500">{participant.role === 'admin' ? 'Owner' : 'Member'}</p>
                                </div>
                              </div>
                              {removable ? (
                                <button
                                  type="button"
                                  className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                                  onClick={() => removeGroupMember(participant.userId)}
                                  disabled={memberActionLoadingId === participant.userId}
                                >
                                  {memberActionLoadingId === participant.userId ? 'Removing…' : 'Remove'}
                                </button>
                              ) : (
                                <span className="text-xs font-semibold text-slate-400">Owner</span>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </DashboardShell>
  )
}

export default function MessagesPageClient(props: MessagesPageClientProps) {
  const cachedViewer = useViewerStore((state) => state.me)
  const [resolvedViewer, setResolvedViewer] = useState<MeResponse | null | undefined>(() => cachedViewer ?? undefined)

  useEffect(() => {
    if (cachedViewer) {
      setResolvedViewer(cachedViewer)
      return
    }

    const token = getStoredToken()
    if (!token) {
      setResolvedViewer(null)
      return
    }

    let cancelled = false

    void ensureViewerMe({ token }).then((viewer) => {
      if (!cancelled) {
        setResolvedViewer(viewer ?? null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [cachedViewer])

  if (resolvedViewer === undefined) {
    return (
      <DashboardShell>
        <div className="rounded-[32px] border border-slate-200 bg-white/90 p-6 text-sm text-slate-600 shadow-sm">
          Loading messages…
        </div>
      </DashboardShell>
    )
  }

  return <StandardMessagesPageClient {...props} viewer={resolvedViewer} />
}
