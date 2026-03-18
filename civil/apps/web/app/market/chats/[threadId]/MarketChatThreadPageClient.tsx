'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import CivilCard from '../../../_components/CivilCard'
import DashboardShell from '../../../_components/DashboardShell'
import { pushToast } from '../../../_components/useToasts'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { buildApiUrl } from '../../../_lib/api'
import { getStoredToken } from '../../../_lib/tokenStorage'

type ThreadUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
}

type ThreadParticipant = {
  userId: string
  user: ThreadUser
  isViewer: boolean
}

type ThreadBase = {
  id: string
  contextId: string | null
  participants: ThreadParticipant[]
}

type MessagePayload = {
  id: string
  threadId: string
  body: string | null
  createdAt: string
  senderId: string
  sender: ThreadUser
  isMine: boolean
}

type ThreadDetailResponse = {
  thread?: ThreadBase
  messages?: MessagePayload[]
}

type MarketInboxItem = {
  threadId: string
  listingId: string
  listingTitle: string
  listingStatus: string
  lastMessageAt: string
  counterpart?: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  } | null
}

type MarketInboxResponse = {
  activeItems?: MarketInboxItem[]
  inactiveItems?: MarketInboxItem[]
  soldItems?: MarketInboxItem[]
}

function formatTimestamp(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function MarketChatThreadPageClient({ threadId }: { threadId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [thread, setThread] = useState<ThreadBase | null>(null)
  const [messages, setMessages] = useState<MessagePayload[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [inboxStatus, setInboxStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [activeInbox, setActiveInbox] = useState<MarketInboxItem[]>([])
  const [inactiveInbox, setInactiveInbox] = useState<MarketInboxItem[]>([])
  const [soldInbox, setSoldInbox] = useState<MarketInboxItem[]>([])
  const [markingNotInterested, setMarkingNotInterested] = useState(false)
  const [isNotInterested, setIsNotInterested] = useState(false)

  const loadThread = async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setStatus('loading')
    try {
      const res = await fetch(buildApiUrl(`/market/chats/${encodeURIComponent(threadId)}?limit=50`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 404) {
        setStatus('not-found')
        setThread(null)
        setMessages([])
        return
      }
      if (!res.ok) {
        setStatus('error')
        return
      }
      const payload = (await res.json().catch(() => null)) as ThreadDetailResponse | null
      if (!payload?.thread) {
        setStatus('not-found')
        setThread(null)
        setMessages([])
        return
      }
      setThread(payload.thread)
      setMessages(Array.isArray(payload.messages) ? payload.messages : [])
      setStatus('ready')

      const newest = Array.isArray(payload.messages) && payload.messages.length ? payload.messages[payload.messages.length - 1] : null
      if (newest?.id) {
        fetch(buildApiUrl(`/market/chats/${encodeURIComponent(threadId)}/read`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId: newest.id }),
        })
          .then(() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('message.read'))
            }
          })
          .catch(() => {})
      }
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    void loadThread()
  }, [threadId])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setInboxStatus('loading')
      try {
        const res = await fetch(buildApiUrl('/market/chats'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) {
          setInboxStatus('error')
          return
        }
        const payload = (await res.json().catch(() => null)) as MarketInboxResponse | null
        setActiveInbox(Array.isArray(payload?.activeItems) ? payload!.activeItems! : [])
        setInactiveInbox(Array.isArray(payload?.inactiveItems) ? payload!.inactiveItems! : [])
        setSoldInbox(Array.isArray(payload?.soldItems) ? payload!.soldItems! : [])
        setIsNotInterested(Boolean((payload?.inactiveItems || []).some((item) => item.threadId === threadId)))
        setInboxStatus('ready')
      } catch {
        if (cancelled) return
        setInboxStatus('error')
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [])

  const counterpart = useMemo(() => thread?.participants.find((participant) => !participant.isViewer)?.user ?? null, [thread])

  const threadIsInBuyerInbox = useMemo(() => {
    return (
      activeInbox.some((item) => item.threadId === threadId) ||
      inactiveInbox.some((item) => item.threadId === threadId) ||
      soldInbox.some((item) => item.threadId === threadId)
    )
  }, [activeInbox, inactiveInbox, soldInbox, threadId])

  const inboxPanel = (
    <section className="sticky top-0 space-y-4 pb-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">Marketplace inbox</div>
        <div className="mt-1 text-xs text-slate-600">Active item chats and Sold item chats</div>
      </div>

      {inboxStatus === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading…</div> : null}
      {inboxStatus === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load inbox.</div> : null}

      {inboxStatus === 'ready' ? (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active item chats</div>
            <div className="mt-2 space-y-1">
              {activeInbox.length === 0 ? <div className="text-sm text-slate-600">No active chats.</div> : null}
              {activeInbox.map((item) => {
                const active = item.threadId === threadId
                return (
                  <Link
                    key={item.threadId}
                    href={`/market/chats/${encodeURIComponent(item.threadId)}`}
                    className={
                      'block rounded-2xl border px-3 py-2 text-sm transition ' +
                      (active ? 'border-blue-200 bg-blue-50 text-slate-900' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50')
                    }
                  >
                    <div className="truncate font-semibold">{item.listingTitle}</div>
                    <div className="truncate text-xs text-slate-600">
                      {item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Conversation')} • {item.listingStatus}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inactive chats</div>
            <div className="mt-2 space-y-1">
              {inactiveInbox.length === 0 ? <div className="text-sm text-slate-600">No inactive chats.</div> : null}
              {inactiveInbox.map((item) => {
                const active = item.threadId === threadId
                return (
                  <Link
                    key={item.threadId}
                    href={`/market/chats/${encodeURIComponent(item.threadId)}`}
                    className={
                      'block rounded-2xl border px-3 py-2 text-sm transition ' +
                      (active ? 'border-slate-300 bg-slate-100 text-slate-900' : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100')
                    }
                  >
                    <div className="truncate font-semibold">{item.listingTitle}</div>
                    <div className="truncate text-xs text-slate-600">
                      {item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Conversation')} • Not interested
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sold item chats</div>
            <div className="mt-2 space-y-1">
              {soldInbox.length === 0 ? <div className="text-sm text-slate-600">No sold chats.</div> : null}
              {soldInbox.map((item) => {
                const active = item.threadId === threadId
                return (
                  <Link
                    key={item.threadId}
                    href={`/market/chats/${encodeURIComponent(item.threadId)}`}
                    className={
                      'block rounded-2xl border px-3 py-2 text-sm transition ' +
                      (active ? 'border-blue-200 bg-blue-50 text-slate-900' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50')
                    }
                  >
                    <div className="truncate font-semibold">{item.listingTitle}</div>
                    <div className="truncate text-xs text-slate-600">
                      {item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Conversation')} • {item.listingStatus}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )

  const sendMessage = async () => {
    if (isNotInterested) return
    const body = draft.trim()
    if (!body) return

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSending(true)
    try {
      const res = await fetch(buildApiUrl(`/market/chats/${encodeURIComponent(threadId)}/messages`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      })
      const payload = (await res.json().catch(() => null)) as { message?: MessagePayload; error?: string } | null
      if (!res.ok || !payload?.message) {
        pushToast(payload?.error ?? 'Unable to send message right now.', 'error')
        return
      }
      setMessages((prev) => [...prev, payload.message!])
      setDraft('')
    } catch {
      pushToast('Unable to send message right now.', 'error')
    } finally {
      setSending(false)
    }
  }

  const markNoLongerInterested = async () => {
    if (!threadIsInBuyerInbox || isNotInterested) return

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setMarkingNotInterested(true)
    try {
      const res = await fetch(buildApiUrl(`/market/chats/${encodeURIComponent(threadId)}/no-longer-interested`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        pushToast(payload?.error ?? 'Unable to update interest right now.', 'error')
        return
      }

      setIsNotInterested(true)
      setActiveInbox((prev) => prev.filter((item) => item.threadId !== threadId))
      setSoldInbox((prev) => prev.filter((item) => item.threadId !== threadId))
      setInactiveInbox((prev) => {
        const existing = prev.find((item) => item.threadId === threadId)
        if (existing) return prev
        const moved =
          activeInbox.find((item) => item.threadId === threadId) ||
          soldInbox.find((item) => item.threadId === threadId) ||
          null
        return moved ? [moved, ...prev] : prev
      })
      pushToast('Marked as not interested.', 'success')
    } catch {
      pushToast('Unable to update interest right now.', 'error')
    } finally {
      setMarkingNotInterested(false)
    }
  }

  return (
    <DashboardShell rightRail={inboxPanel} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Marketplace Chat</h1>
            <p className="mt-1 text-sm text-slate-600">{counterpart?.name || (counterpart?.handle ? `@${counterpart.handle}` : 'Conversation')}</p>
          </div>
          <Link href="/messages?inbox=market" className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Back to market chats
          </Link>
        </div>
      </section>

      {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading chat…</div> : null}
      {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load this chat.</div> : null}
      {status === 'not-found' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Chat not found.</div> : null}

      {status === 'ready' ? (
        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
          {counterpart ? (
            <CivilCard
              size="rail"
              name={counterpart.name || (counterpart.handle ? `@${counterpart.handle}` : 'User')}
              subtitle={counterpart.handle ? `@${counterpart.handle}` : undefined}
              avatarAlt={counterpart.name || (counterpart.handle ? `@${counterpart.handle}` : 'User')}
              avatarInitials={counterpart.name || counterpart.handle}
              avatarSrc={counterpart.avatarUrl}
              avatarHref={counterpart.handle ? `/u/${encodeURIComponent(counterpart.handle)}` : undefined}
              titleHref={counterpart.handle ? `/u/${encodeURIComponent(counterpart.handle)}` : undefined}
              coverUrl={counterpart.coverUrl ?? null}
              isVerified={Boolean(counterpart.isVerified)}
              trailing={
                counterpart.handle ? (
                  <Link
                    href={`/u/${encodeURIComponent(counterpart.handle)}`}
                    className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
                  >
                    View profile
                  </Link>
                ) : null
              }
            />
          ) : null}

          {threadIsInBuyerInbox ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-medium text-slate-700">Interested in this item?</div>
              <div className="flex items-center gap-2">
                {isNotInterested ? <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700">Not interested</span> : null}
                {!isNotInterested ? (
                  <button
                    type="button"
                    onClick={() => void markNoLongerInterested()}
                    disabled={markingNotInterested}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {markingNotInterested ? 'Updating…' : 'No longer interested'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {messages.length === 0 ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No messages yet.</div> : null}
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${message.isMine ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'}`}>
                  <div className="whitespace-pre-wrap text-sm">{message.body || ''}</div>
                  <div className={`mt-1 text-[11px] ${message.isMine ? 'text-blue-100' : 'text-slate-500'}`}>{formatTimestamp(message.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type your message"
              disabled={isNotInterested}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-500"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                void sendMessage()
              }}
              disabled={isNotInterested || sending || !draft.trim()}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </section>
      ) : null}
    </DashboardShell>
  )
}
