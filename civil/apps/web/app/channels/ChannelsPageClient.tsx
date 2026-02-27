'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import DashboardShell from '../_components/DashboardShell'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import { buildApiUrl } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'
import { redirectToAuthModal } from '../_lib/authModal'

type ChannelListItem = {
  id: string
  name: string
  slug: string
  visibility: 'public' | 'private'
  unread: boolean
  participantCount: number
  lastMessageAt: string
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
        window.localStorage.removeItem('token')
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
      const haystack = `${item.slug} ${item.name} ${item.organization.name}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [items, query])

  return (
    <DashboardShell>
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
                return (
                  <Link
                    key={item.id}
                    href={href}
                    className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">#{item.slug}</p>
                          {item.unread ? <span className="h-2 w-2 rounded-full bg-[var(--cc-primary)]" aria-hidden="true" /> : null}
                          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {item.visibility}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{item.name}</p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                          <VerifiedAvatar
                            src={item.organization.logoUrl}
                            alt={item.organization.name}
                            initials={item.organization.name}
                            size={20}
                            className="shrink-0"
                          />
                          <span className="truncate">{item.organization.name}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.participantCount} members</span>
                          {muted ? (
                            <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', 'border-slate-200 text-slate-500')}>
                              Muted
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="shrink-0 text-xs text-slate-400">{formatTimestamp(item.lastMessageAt)}</p>
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
