'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import DashboardShell from '../_components/DashboardShell'
import Sidebar from '../_components/Sidebar'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import type { MeResponse } from '../_lib/me'
import { getStoredToken } from '../_lib/tokenStorage'
import { HiOutlineArrowPath, HiOutlinePaperAirplane, HiOutlinePlusCircle } from 'react-icons/hi2'

const THREAD_PAGE_LIMIT = 20
const MESSAGE_PAGE_LIMIT = 40

type ThreadUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
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

type MessagePayload = {
  id: string
  threadId: string
  body: string | null
  attachments: string[]
  messageType: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  senderId: string
  sender: ThreadUser
  isMine: boolean
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

type MessagesPageClientProps = {
  initialThreadId?: string
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
    .map((participant) => participant.user.name || `@${participant.user.handle}`)
    .join(', ')
}

const threadHasUnread = (thread: ThreadSummary) => {
  const viewer = thread.participants.find((participant) => participant.isViewer)
  if (!viewer?.lastReadAt || !thread.lastMessage) return Boolean(thread.lastMessage)
  return new Date(thread.lastMessage.createdAt).getTime() > new Date(viewer.lastReadAt).getTime()
}

export default function MessagesPageClient({ initialThreadId }: MessagesPageClientProps) {
  const tokenRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const selectedThreadRef = useRef<string | null>(initialThreadId ?? null)
  const initialThreadIdRef = useRef<string | null>(initialThreadId ?? null)
  const [authReady, setAuthReady] = useState(false)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [threadCursor, setThreadCursor] = useState<string | null>(null)
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId ?? null)
  const [messagesByThread, setMessagesByThread] = useState<Record<string, MessagePayload[]>>({})
  const [messageCursors, setMessageCursors] = useState<Record<string, string | null>>({})
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null)
  const [loadingOlderThreadId, setLoadingOlderThreadId] = useState<string | null>(null)
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [streamKey, setStreamKey] = useState(0)

  useEffect(() => {
    selectedThreadRef.current = selectedThreadId
  }, [selectedThreadId])

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
      } catch (err) {
        console.error('Failed to mark thread as read', err)
      }
    },
    [authedFetch],
  )

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
          next[index] = {
            ...existing,
            lastMessage: message,
            lastMessageAt: message.createdAt,
          }
          next.sort((a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime())
          return next
        })
        if (selectedThreadRef.current === threadId) {
          void markThreadRead(threadId, message.id)
        }
      }
    },
    [markThreadRead, upsertThread],
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
      const response = await authedFetch('/auth/me')
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        throw new Error('failed_me')
      }
      const payload = (await response.json()) as MeResponse
      setMe(payload)
    } catch (err) {
      console.error('Failed to load viewer profile', err)
      pushToast('Unable to load your profile right now.', 'error')
    }
  }, [authedFetch])

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
        if (!selectedThreadRef.current) {
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
        const lastMessage = payload.messages[payload.messages.length - 1] ?? null
        upsertThread({ ...payload.thread, lastMessage, lastMessageAt: lastMessage?.createdAt ?? payload.thread.lastMessageAt })
        setMessagesByThread((prev) => ({ ...prev, [threadId]: payload.messages }))
        setMessageCursors((prev) => ({ ...prev, [threadId]: payload.nextCursor ?? null }))
        if (lastMessage) {
          void markThreadRead(threadId, lastMessage.id)
        }
      } catch (err) {
        console.error('Failed to load thread detail', err)
        pushToast('Unable to open that conversation right now.', 'error')
      } finally {
        setLoadingThreadId(null)
      }
    },
    [authedFetch, markThreadRead, upsertThread],
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
        setMessagesByThread((prev) => ({
          ...prev,
          [threadId]: payload.items.concat(prev[threadId] ?? []),
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
    if (loadingThreadId === selectedThreadId) return
    void fetchThreadDetail(selectedThreadId)
  }, [selectedThreadId, messagesByThread, loadingThreadId, fetchThreadDetail])

  const sendMessage = useCallback(
    async (threadId: string) => {
      const trimmed = composerText.trim()
      if (!trimmed) return
      setSending(true)
      try {
        const response = await authedFetch(`/messages/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        })
        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) {
          throw new Error('failed_send')
        }
        const payload = (await response.json()) as { message: MessagePayload }
        setMessagesByThread((prev) => {
          const existing = prev[threadId] ?? []
          return { ...prev, [threadId]: [...existing, payload.message] }
        })
        setComposerText('')
        void markThreadRead(threadId, payload.message.id)
      } catch (err) {
        console.error('Failed to send message', err)
        pushToast('Unable to send this message. Please try again.', 'error')
      } finally {
        setSending(false)
      }
    },
    [authedFetch, composerText, markThreadRead],
  )

  useEffect(() => {
    if (!authReady) return
    void loadMe()
    void loadThreads()
  }, [authReady, loadMe, loadThreads])

  useEffect(() => {
    if (!selectedThreadId) return
    const messageCount = messagesByThread[selectedThreadId]?.length ?? 0
    if (messageCount === 0) return
    const container = messagesViewportRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [messagesByThread, selectedThreadId])

  const activeThread = useMemo(() => threads.find((thread) => thread.id === selectedThreadId) ?? null, [threads, selectedThreadId])
  const activeMessages = selectedThreadId ? messagesByThread[selectedThreadId] ?? [] : []
  const activeThreadHasMore = selectedThreadId ? Boolean(messageCursors[selectedThreadId]) : false

  const handleThreadSelect = useCallback(
    (threadId: string) => {
      setSelectedThreadId(threadId)
      const threadMessages = messagesByThread[threadId]
      if (!threadMessages) {
        void fetchThreadDetail(threadId)
      } else {
        const lastMessage = threadMessages[threadMessages.length - 1]
        if (lastMessage) {
          void markThreadRead(threadId, lastMessage.id)
        }
      }
    },
    [fetchThreadDetail, markThreadRead, messagesByThread],
  )

  const renderThreadList = () => {
    if (threadsLoading && threads.length === 0) {
      return <p className="text-sm text-slate-500">Loading your conversations…</p>
    }
    if (threadsError && threads.length === 0) {
      return <p className="text-sm text-rose-600">{threadsError}</p>
    }
    if (threads.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-sm text-slate-500">
          <p>No messages yet.</p>
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
        {threads.map((thread) => {
          const title = getThreadTitle(thread)
          const active = thread.id === selectedThreadId
          const unread = threadHasUnread(thread)
          const lastSnippet = thread.lastMessage?.body?.trim() || (thread.lastMessage?.attachments.length ? 'Attachment' : 'Say hello!')
          return (
            <li key={thread.id}>
              <button
                type="button"
                className={clsx(
                  'w-full rounded-2xl border px-4 py-3 text-left transition',
                  active ? 'border-[var(--cc-primary)] bg-white shadow-lg shadow-[var(--cc-primary)]/10' : 'border-slate-200 bg-white/70 hover:border-slate-300',
                )}
                onClick={() => handleThreadSelect(thread.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <VerifiedAvatar
                      src={thread.participants.find((p) => !p.isViewer)?.user.avatarUrl ?? null}
                      alt={title}
                      initials={title}
                      size={48}
                      isVerified={thread.participants.some((p) => !p.isViewer && p.user.isVerified)}
                      isBusiness={thread.participants.some((p) => !p.isViewer && p.user.isPremium)}
                    />
                    {unread ? <span className="absolute -right-1 -top-1 inline-flex h-2 w-2 rounded-full bg-[var(--cc-primary)]" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
                      <span className="text-xs text-slate-400">{formatTimestamp(thread.lastMessageAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{lastSnippet}</p>
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
        <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
          <p className="text-lg font-semibold text-slate-700">Select a conversation</p>
          <p className="mt-2 text-sm text-slate-500">Choose a thread on the left to start messaging.</p>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col rounded-3xl border border-white/60 bg-white/90 p-4 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
        <header className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{getThreadTitle(activeThread)}</p>
            <p className="text-xs text-slate-500">{activeThread.participants.length > 2 ? `${activeThread.participants.length} participants` : 'Direct message'}</p>
          </div>
          <Link href="/search?type=people" className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
            <HiOutlinePlusCircle className="h-4 w-4" />
            New chat
          </Link>
        </header>
        <div className="mt-4 flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
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
            <div ref={messagesViewportRef} className="flex-1 space-y-4 overflow-y-auto pr-2">
              {activeMessages.length === 0 && loadingThreadId === activeThread.id ? (
                <p className="text-center text-sm text-slate-500">Loading messages…</p>
              ) : null}
              {activeMessages.map((message) => {
                const isMine = message.isMine
                const bubbleClasses = clsx(
                  'max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow transition',
                  isMine
                    ? 'ml-auto bg-[var(--cc-primary)] text-white'
                    : 'mr-auto border border-slate-100 bg-white text-slate-800',
                )
                return (
                  <div key={message.id} className={clsx('flex flex-col', isMine ? 'items-end' : 'items-start')}>
                    <p className="mb-1 text-xs font-semibold text-slate-500">{isMine ? 'You' : message.sender.name || `@${message.sender.handle}`}</p>
                    <div className={bubbleClasses}>
                      {message.deletedAt ? (
                        <p className="italic text-slate-400">Message removed.</p>
                      ) : (
                        <>
                          {message.body ? <p>{message.body}</p> : null}
                          {!message.body && message.attachments.length ? (
                            <p className="text-xs italic">{message.attachments.length} attachment(s)</p>
                          ) : null}
                        </>
                      )}
                    </div>
                    <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{formatTimestamp(message.createdAt)}</span>
                  </div>
                )
              })}
            </div>
            <form
              className="mt-4 flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-inner"
              onSubmit={(event) => {
                event.preventDefault()
                if (activeThread) {
                  void sendMessage(activeThread.id)
                }
              }}
            >
              <textarea
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                placeholder="Write a message"
                className="h-12 flex-1 resize-none border-none bg-transparent text-sm text-slate-800 outline-none"
              />
              <button
                type="submit"
                disabled={!composerText.trim() || sending}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white transition',
                  !composerText.trim() || sending
                    ? 'cursor-not-allowed bg-slate-300'
                    : 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-dark, #0d5)]',
                )}
              >
                <HiOutlinePaperAirplane className="h-4 w-4" />
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

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

  return (
    <DashboardShell sidebar={<Sidebar me={me ?? undefined} active="messages" />} mainClassName="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="flex flex-col rounded-[32px] border border-white/70 bg-white/90 p-4 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Inbox</p>
              <h2 className="text-xl font-semibold text-slate-900">Messages</h2>
            </div>
            <Link
              href="/search?type=people"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
            >
              <HiOutlinePlusCircle className="h-4 w-4" />
              Start chat
            </Link>
          </div>
          <div className="mt-4 flex-1 overflow-y-auto pr-1">
            {renderThreadList()}
            {threadsFooter}
          </div>
        </div>
        <div className="min-h-[60vh]">{renderMessages()}</div>
      </section>
    </DashboardShell>
  )
}
