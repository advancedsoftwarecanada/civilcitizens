'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import DashboardShell from '../_components/DashboardShell'
import MessagesNavBlock from '../_components/MessagesNavBlock'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import {
  DEFAULT_MESSAGES_NAV_SECTION,
  readStoredMessagesNavSection,
  writeStoredMessagesNavSection,
  type MessagesNavSection,
} from '../_lib/messagesNav'
import type { MeResponse } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
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
}

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
  user: ThreadUser
}

type ConnectionListItem = {
  id: string
  status?: string
  since?: string | null
  user: ThreadUser
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

export default function MessagesPageClient({ initialThreadId, initialInboxSection }: MessagesPageClientProps) {
  const router = useRouter()
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
  const [manageMembersOpen, setManageMembersOpen] = useState(false)
  const [groupCandidatesLoading, setGroupCandidatesLoading] = useState(false)
  const [groupCandidates, setGroupCandidates] = useState<ThreadUser[]>([])
  const [groupCandidateFilter, setGroupCandidateFilter] = useState('')
  const [groupMemberFilter, setGroupMemberFilter] = useState('')
  const [memberActionLoadingId, setMemberActionLoadingId] = useState<string | null>(null)
  const [leavingGroup, setLeavingGroup] = useState(false)
  const [callActionMode, setCallActionMode] = useState<'audio' | 'video' | null>(null)
  const [activeInboxSection, setActiveInboxSection] = useState<MessagesNavSection>(
    initialInboxSection && initialInboxSection !== 'market' ? initialInboxSection : DEFAULT_MESSAGES_NAV_SECTION,
  )
  const [friendContactIds, setFriendContactIds] = useState<string[]>([])
  const [networkContactIds, setNetworkContactIds] = useState<string[]>([])
  const [marketUnreadCount, setMarketUnreadCount] = useState(0)
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
    if (initialInboxSection && initialInboxSection !== 'market') {
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
    if (!stored || stored === 'market') {
      setActiveInboxSection(DEFAULT_MESSAGES_NAV_SECTION)
      return
    }
    setActiveInboxSection(stored)
  }, [initialInboxSection, initialThreadId])

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
        await authedFetch(`/messages/threads/${threadId}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(messageId ? { messageId } : {}),
        })
        window.dispatchEvent(new CustomEvent('message.read'))
      } catch (err) {
        console.error('Failed to mark thread as read', err)
      }
    },
    [authedFetch],
  )

  const loadSupplementalUnreadCounts = useCallback(async () => {
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
  }, [authedFetch])

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
          const base = append ? [...prev] : []
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
        if (!selectedThreadRef.current && !isMobileMessagesViewport()) {
          const nextSelection = initialThreadIdRef.current ?? payload.items[0]?.id ?? null
          if (nextSelection) {
            setSelectedThreadId(nextSelection)
          }
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
  }, [authedFetch])

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
        setMessagesByThread((prev) => ({ ...prev, [threadId]: normalizedMessages }))
        setMessageCursors((prev) => ({ ...prev, [threadId]: payload.nextCursor ?? null }))
        if (lastMessage) {
          markThreadReadLocally(threadId, lastMessage.createdAt)
          void markThreadRead(threadId, lastMessage.id)
        }
        failedThreadDetailRef.current.delete(threadId)
        shownThreadDetailErrorRef.current.delete(threadId)
      } catch (err) {
        console.error('Failed to load thread detail', err)
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
    [authedFetch, markThreadRead, markThreadReadLocally, upsertThread],
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
    async (threadId: string) => {
      const trimmed = composerText.trim()
      if (!trimmed && attachments.length === 0) return
      setSending(true)
      try {
        const requestPayload: { body?: string; attachments?: string[] } = {}
        if (trimmed) requestPayload.body = trimmed
        if (attachments.length > 0) requestPayload.attachments = attachments

        const response = await authedFetch(`/messages/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestPayload),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
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
      } catch (err) {
        console.error('Failed to send message', err)
        pushToast('Unable to send this message. Please try again.', 'error')
      } finally {
        setSending(false)
      }
    },
    [authedFetch, composerText, attachments, markThreadRead, scrollMessagesToBottom],
  )

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      // Reset input
      event.target.value = ''

      if (file.size > 25 * 1024 * 1024) {
        pushToast('File is too large (max 25MB).', 'error')
        return
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
          setAttachments((prev) => [...prev, mediaUrl!])
        } else {
          throw new Error('Processing timeout')
        }
      } catch (err) {
        console.error('Upload error', err)
        const msg = err instanceof Error ? err.message : 'Failed to upload image.'
        pushToast(msg, 'error')
      } finally {
        setIsUploading(false)
      }
    },
    [],
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
  }, [authReady, loadMe, loadThreads, loadContactBuckets, loadSupplementalUnreadCounts])

  useEffect(() => {
    if (!authReady || typeof window === 'undefined') return undefined
    const refresh = () => {
      void loadSupplementalUnreadCounts()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener('message.read', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('message.read', refresh)
    }
  }, [authReady, loadSupplementalUnreadCounts])

  const orderedThreads = useMemo(() => sortThreadsForInbox(threads), [threads])
  const friendContactIdSet = useMemo(() => new Set(friendContactIds), [friendContactIds])
  const networkContactIdSet = useMemo(() => new Set(networkContactIds), [networkContactIds])
  const categorizedThreads = useMemo(() => {
    const groups = sortThreadsForInbox(orderedThreads.filter((thread) => thread.type === 'group'))
    const directThreads = orderedThreads.filter((thread) => thread.type !== 'group')
    if (!contactsBucketReady) {
      return {
        friends: sortThreadsForInbox(directThreads),
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
      network: sortThreadsForInbox(network),
      groups,
    }
  }, [contactsBucketReady, friendContactIdSet, me?.id, networkContactIdSet, orderedThreads])
  const messagesNavUnreadCounts = useMemo(
    () => ({
      friends: countUnreadInThreads(categorizedThreads.friends),
      network: countUnreadInThreads(categorizedThreads.network),
      groups: countUnreadInThreads(categorizedThreads.groups),
      market: Math.max(0, marketUnreadCount),
    }),
    [categorizedThreads.friends, categorizedThreads.groups, categorizedThreads.network, marketUnreadCount],
  )
  const filteredOrderedThreads = useMemo(() => {
    if (activeInboxSection === 'network') return categorizedThreads.network
    if (activeInboxSection === 'groups') return categorizedThreads.groups
    return categorizedThreads.friends
  }, [activeInboxSection, categorizedThreads.friends, categorizedThreads.groups, categorizedThreads.network])
  const activeThread = useMemo(
    () => filteredOrderedThreads.find((thread) => thread.id === selectedThreadId) ?? null,
    [filteredOrderedThreads, selectedThreadId],
  )
  const hideGlobalMobileDockInThread = isMobileViewport && Boolean(activeThread)

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
    const mobileHeightReduction = Math.max(72, Math.round(viewportHeight * 0.12))
    const visiblePanelHeight = Math.max(260, Math.floor(viewportBottom - panelRect.top - mobileHeightReduction))
    const listBottom = composerRect ? composerRect.top : viewportBottom
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
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (hideGlobalMobileDockInThread) {
      root.classList.add('cc-messages-thread-context')
    } else {
      root.classList.remove('cc-messages-thread-context')
    }
    return () => {
      root.classList.remove('cc-messages-thread-context')
    }
  }, [hideGlobalMobileDockInThread])

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
    if (filteredOrderedThreads.length === 0) {
      if (threadsLoading || threads.length === 0) return
      if (selectedThreadId) setSelectedThreadId(null)
      return
    }
    if (selectedThreadId && filteredOrderedThreads.some((thread) => thread.id === selectedThreadId)) {
      return
    }
    setSelectedThreadId(isMobileMessagesViewport() ? null : filteredOrderedThreads[0]?.id ?? null)
  }, [filteredOrderedThreads, selectedThreadId, threads.length, threadsLoading])

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
      failedThreadDetailRef.current.delete(threadId)
      shownThreadDetailErrorRef.current.delete(threadId)
      forceBottomScrollThreadRef.current = threadId
      smoothScrollPendingRef.current = false
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
      }
    },
    [fetchThreadDetail, markThreadRead, markThreadReadLocally, messagesByThread],
  )

  const activeViewerParticipant = useMemo(
    () => activeThread?.participants.find((participant) => participant.isViewer) ?? null,
    [activeThread],
  )
  const isActiveGroupThread = activeThread?.type === 'group'
  const isActiveGroupOwner = isActiveGroupThread && activeViewerParticipant?.role === 'admin'
  const activeThreadSupportsCalling = Boolean(
    activeThread && !activeThread.contextType && (activeThread.type === 'direct' || activeThread.type === 'group'),
  )
  const activeThreadCall = activeThread?.activeCall ?? null

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

  const startThreadCall = useCallback(
    async (mode: 'audio' | 'video') => {
      if (!activeThread) return
      if (activeThread.contextType) return
      if (activeThread.type !== 'direct' && activeThread.type !== 'group') return

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
    [activeThread, authedFetch, router],
  )

  const renderThreadList = () => {
    const mobileViewport = isMobileViewport
    if (threadsLoading && filteredOrderedThreads.length === 0) {
      return <p className="text-sm text-slate-500">Loading your conversations…</p>
    }
    if (threadsError && filteredOrderedThreads.length === 0) {
      return <p className="text-sm text-rose-600">{threadsError}</p>
    }
    if (filteredOrderedThreads.length === 0) {
      const emptyLabel =
        activeInboxSection === 'groups' ? 'No group chats yet.' : activeInboxSection === 'network' ? 'No network messages yet.' : 'No friend messages yet.'
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
          return (
            <li key={thread.id}>
              <button
                type="button"
                className={clsx(
                  'relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left transition',
                  active
                    ? 'border-[var(--cc-primary)] shadow-lg shadow-[var(--cc-primary)]/20'
                    : unread
                      ? 'border-red-300 bg-red-50/70 shadow-md shadow-red-100 hover:border-red-400'
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
    )
  }

  const renderMessages = () => {
    if (!activeThread) {
      return (
        <div className="flex h-full flex-col items-center justify-center rounded-[32px] border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
          <p className="text-lg font-semibold text-slate-700">Select a conversation</p>
          <p className="mt-2 text-sm text-slate-500">Choose a thread on the right to start messaging.</p>
        </div>
      )
    }

    const otherParticipant = getPrimaryOtherParticipant(activeThread, me?.id)
    const otherUser = otherParticipant?.user
    const title = getThreadTitle(activeThread)
    const headerGroupParticipants = getOtherParticipants(activeThread, me?.id).slice(0, 5)
    const showMobileDockComposer = isMobileViewport
    const composerKeyboardOffset = Math.max(0, Math.round(mobileKeyboardInset))
    const mobileComposerBottomSpacer = showMobileDockComposer ? `${MOBILE_THREAD_MESSAGE_CLEARANCE_PX}px` : undefined

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
        <header ref={threadHeaderRef} className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <button
            type="button"
            className="-ml-2 mr-1 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-sm transition hover:bg-[var(--cc-primary-700)] lg:hidden"
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
            <Link href={`/u/${otherUser.handle}`} className="shrink-0">
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
          <div className="flex-1 min-w-0">
            <p className="truncate text-lg font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">
              {activeThread.participants.length > 2 ? `${activeThread.participants.length} participants` : 'Direct message'}
              {activeThreadCall ? ` · ${activeThreadCall.mode === 'video' ? 'Video' : 'Audio'} call live` : ''}
            </p>
          </div>
          {activeThreadSupportsCalling ? (
            <div className="flex items-center gap-2">
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
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                title={activeThreadCall ? 'Join audio call' : 'Start audio call'}
              >
                <HiOutlinePhone className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void startThreadCall('video')
                }}
                disabled={callActionMode !== null}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                title={activeThreadCall ? 'Join video call' : 'Start video call'}
              >
                <HiOutlineVideoCamera className="h-5 w-5" />
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
              style={mobileComposerBottomSpacer ? { scrollPaddingBottom: mobileComposerBottomSpacer } : undefined}
            >
              <div
                className={clsx('flex min-h-full flex-col justify-end gap-4', showMobileDockComposer ? 'pb-0' : 'pb-1')}
              >
                {activeMessages.length === 0 && loadingThreadId === activeThread.id ? (
                  <p className="text-center text-sm text-slate-500">Loading messages…</p>
                ) : null}
                {activeMessages.map((message) => {
                  if (message.messageType === 'system' && message.systemMeta?.kind === 'call_ended') {
                    const callbackLabel = message.systemMeta.callbackLabel || 'Call Back'
                    return (
                      <div key={message.id} className="flex w-full justify-center">
                        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-center shadow-sm">
                          <p className="text-sm font-semibold text-slate-800">{message.body || 'Call ended.'}</p>
                          <div className="mt-3 flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void startThreadCall(message.systemMeta?.mode === 'audio' ? 'audio' : 'video')
                              }}
                              disabled={callActionMode !== null}
                              className="inline-flex items-center gap-2 rounded-full border border-[var(--cc-primary)] bg-white px-4 py-2 text-xs font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/5 disabled:opacity-50"
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
                className="fixed inset-x-0 z-[85] min-h-[var(--mobile-thread-composer-height)] border-t border-slate-200 bg-white/95 px-3 pb-[var(--mobile-dock-bottom-pad)] pt-[var(--mobile-bottom-bar-top-pad)] shadow-[0_-8px_20px_rgba(15,23,42,0.08)] lg:hidden"
                style={{
                  bottom: hideGlobalMobileDockInThread
                    ? `calc(var(--mobile-dock-bottom-offset) + ${composerKeyboardOffset}px)`
                    : `calc(var(--mobile-dock-clearance) + ${composerKeyboardOffset}px)`,
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

  const contextActions = useMemo(() => {
    if (activeInboxSection === 'network') {
      return {
        messagesHref: '/messages?inbox=network',
        messagesLabel: 'Network Messages',
        directoryHref: me?.handle ? `/u/${encodeURIComponent(me.handle)}/connections` : '/network/professionals',
        directoryLabel: 'All Connections',
        contextLabel: 'Network Inbox',
      }
    }
    if (activeInboxSection === 'groups') {
      return {
        messagesHref: '/messages?inbox=groups',
        messagesLabel: 'Group Messages',
        directoryHref: '/messages/groups',
        directoryLabel: 'All Group Chats',
        contextLabel: 'Groups Inbox',
      }
    }
    return {
      messagesHref: '/messages?inbox=friends',
      messagesLabel: 'Friend Messages',
      directoryHref: me?.handle ? `/u/${encodeURIComponent(me.handle)}/friends` : '/friends',
      directoryLabel: 'All Friends',
      contextLabel: 'Friends Inbox',
    }
  }, [activeInboxSection, me?.handle])
  const activeContextUnreadCount = activeInboxSection === 'network'
    ? messagesNavUnreadCounts.network
    : activeInboxSection === 'groups'
      ? messagesNavUnreadCounts.groups
      : messagesNavUnreadCounts.friends

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
            if (next === 'market') return
            setActiveInboxSection(next)
          }}
          unreadCounts={messagesNavUnreadCounts}
          className="border border-slate-200/90 bg-slate-50/70"
        />
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={contextActions.messagesHref}
            onClick={() => writeStoredMessagesNavSection(activeInboxSection)}
            className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] transition hover:brightness-95"
          >
            {contextActions.messagesLabel}
          </Link>
          <Link
            href={contextActions.directoryHref}
            onClick={() => writeStoredMessagesNavSection(activeInboxSection)}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
          >
            {contextActions.directoryLabel}
          </Link>
        </div>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{contextActions.contextLabel}</p>
          <p className="text-[11px] text-slate-400">
            {activeContextUnreadCount > 0 ? `${activeContextUnreadCount} unread` : 'All caught up'} · {filteredOrderedThreads.length}{' '}
            {filteredOrderedThreads.length === 1 ? 'thread' : 'threads'}
          </p>
        </div>
        {renderThreadList()}
        {threadsFooter}
      </div>
    </div>
  )

  const keyboardAwareViewportClass = hideGlobalMobileDockInThread
    ? 'min-h-0 h-[calc(var(--cc-viewport-height)-var(--cc-native-safe-top-offset)-var(--cc-native-shell-top-gap))] pb-2 md:sticky md:top-0 md:h-[calc(var(--cc-viewport-height)-var(--cc-top-nav-height))] md:pb-8'
    : 'min-h-0 h-[calc(var(--cc-viewport-height)-var(--cc-native-safe-top-offset)-var(--cc-native-shell-top-gap)-var(--mobile-dock-clearance))] pb-4 md:sticky md:top-0 md:h-[calc(var(--cc-viewport-height)-var(--cc-top-nav-height))] md:pb-8'

  return (
    <DashboardShell
      className="!min-h-0"
      rightRail={inboxPanel}
      mainTopClassName="pt-0"
      rightRailClassName={keyboardAwareViewportClass}
      rightRailTopClassName="pt-0"
      mainClassName={keyboardAwareViewportClass}
    >
      {isMobileViewport ? (
        <div className={clsx('h-full min-h-0', activeThread ? 'pt-2' : '')}>{activeThread ? renderMessages() : inboxPanel}</div>
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
