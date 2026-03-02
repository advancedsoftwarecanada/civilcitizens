'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import { buildApiUrl } from '../_lib/api'
import { clearAuthSession } from '../_lib/authSession'
import { getStoredToken } from '../_lib/tokenStorage'
import { redirectToAuthModal } from '../_lib/authModal'

type ChannelListItem = {
  id: string
  name: string
  slug: string
  visibility: 'public' | 'private'
  unread: boolean
  unreadCount?: number
  participantCount: number
  lastMessageAt: string
  lastMessage?: {
    body: string | null
    attachments: string[]
    isMine: boolean
    sender: {
      handle: string
      name: string | null
      avatarUrl?: string | null
      isPremium?: boolean
      isVerified?: boolean
    }
  } | null
  notification?: {
    muteServer?: boolean
    muteChannel?: boolean
    mentionsOnly?: boolean
  }
  organization: {
    id: string
    name: string
    slug: string
    province: string
    municipality: string
    logoUrl: string | null
    coverUrl: string | null
  }
}

function formatTimestamp(value?: string | null) {
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

function getChannelLastMessagePreview(item: ChannelListItem) {
  const lastMessage = item.lastMessage
  if (!lastMessage) return 'No messages yet.'

  const trimmedBody = (lastMessage.body ?? '').trim()
  const attachmentCount = Array.isArray(lastMessage.attachments) ? lastMessage.attachments.length : 0
  const content =
    trimmedBody ||
    (attachmentCount > 0
      ? attachmentCount === 1
        ? 'sent an attachment'
        : `sent ${attachmentCount} attachments`
      : 'sent a message')

  const senderLabel = lastMessage.isMine
    ? 'You'
    : (lastMessage.sender.name?.trim() || `@${lastMessage.sender.handle}`)

  return `${senderLabel}: ${content}`
}

function getUnreadLabel(unreadCount: number) {
  if (unreadCount <= 0) return null
  return `(${unreadCount > 99 ? '99+' : unreadCount})`
}

export default function ChannelsPageClient() {
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ChannelListItem[]>([])

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(buildApiUrl('/org-channels'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 401) {
        clearAuthSession()
        redirectToAuthModal('login')
        setItems([])
        return
      }
      if (!res.ok) {
        setItems([])
        return
      }
      const payload = (await res.json().catch(() => null)) as { items?: ChannelListItem[] } | null
      setItems(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => {
      const haystack = `${item.slug} ${item.name} ${item.organization.name} ${item.lastMessage?.body ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [items, query])

  return (
    <DashboardShell rightRail={<RightRail mode="organizations" organizationLinkTarget="chat" />}>
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold text-slate-900">Channels</h1>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search joined channels"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none sm:max-w-xs"
            />
          </div>

          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Loading channels…</div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No joined channels yet.
              </div>
            ) : (
              filteredItems.map((item) => {
                const href = `/com/${item.organization.province}/${item.organization.municipality}/orgs/${item.organization.slug}/chat-channels?channel=${encodeURIComponent(item.id)}`
                const muted = item.notification?.muteServer || item.notification?.muteChannel
                const unreadCount = item.unreadCount ?? 0
                const unreadLabel = getUnreadLabel(unreadCount)
                const sender = item.lastMessage?.sender
                return (
                  <Link
                    key={item.id}
                    href={href}
                    className="relative block overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm transition hover:brightness-105"
                  >
                    {item.organization.coverUrl ? (
                      <img
                        src={item.organization.coverUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />

                    <div className="relative space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <VerifiedAvatar
                          src={item.organization.logoUrl}
                          alt={item.organization.name}
                          initials={item.organization.name}
                          size={64}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-2xl font-semibold text-white">#{item.slug}</p>
                          <p className="mt-1 truncate text-sm text-white/80">{item.organization.name}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <p className="text-xs text-white/70">{formatTimestamp(item.lastMessageAt)}</p>
                          {unreadLabel ? (
                            <span className="rounded-full bg-[var(--cc-primary)]/90 px-2 py-0.5 text-xs font-semibold text-white">
                              {unreadLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/95 px-3 py-2 text-slate-800">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <VerifiedAvatar
                            src={sender?.avatarUrl ?? null}
                            alt={sender?.name || sender?.handle || 'User'}
                            initials={sender?.name || sender?.handle || 'U'}
                            size={24}
                            isVerified={Boolean(sender?.isVerified)}
                            isBusiness={Boolean(sender?.isPremium)}
                          />
                          <p className="line-clamp-1 text-xs text-slate-700">{getChannelLastMessagePreview(item)}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
