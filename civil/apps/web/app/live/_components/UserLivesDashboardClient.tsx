'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import LinkedText from '../../_components/LinkedText'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'

type LiveItem = {
  id: string
  title?: string
  description?: string | null
  coverUrl?: string | null
  visibility?: 'PUBLIC' | 'PRIVATE'
  status?: 'ACTIVE' | 'ARCHIVED'
  launchMode?: 'SPACE' | 'INSTANT'
  requiresPassword?: boolean
  requiresManualAdmit?: boolean
  participantCount?: number | null
  canJoinNow?: boolean
}

type LivesResponse = {
  viewer?: {
    canManageMeetings?: boolean
    handle?: string | null
    name?: string | null
    avatarUrl?: string | null
  }
  items?: LiveItem[]
}

export default function UserLivesDashboardClient() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [data, setData] = useState<LivesResponse | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    const token = getStoredToken()
    if (!token) {
      setData({ viewer: { canManageMeetings: false }, items: [] })
      setStatus('ready')
      return
    }

    try {
      const res = await fetch(buildApiUrl('/live/spaces'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 401) {
        setData({ viewer: { canManageMeetings: false }, items: [] })
        setStatus('ready')
        return
      }
      const { json, text } = await parseApiResponse<LivesResponse & { error?: unknown }>(res)
      if (!res.ok) {
        console.warn('live_spaces_load_failed', json || text)
        setData({ viewer: { canManageMeetings: false }, items: [] })
        setStatus('ready')
        return
      }
      setData(json ?? { viewer: { canManageMeetings: false }, items: [] })
      setStatus('ready')
    } catch (error) {
      console.error('live_spaces_load_failed', error)
      setData({ viewer: { canManageMeetings: false }, items: [] })
      setStatus('ready')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo(() => (Array.isArray(data?.items) ? data.items.filter(Boolean) : []), [data?.items])
  const viewerHandle = data?.viewer?.handle?.trim() || null
  const canManage = Boolean(data?.viewer?.canManageMeetings)

  if (status !== 'ready') {
    return <p className="text-sm text-slate-500">Loading live spaces...</p>
  }

  if (!canManage) {
    return (
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Live feed</h1>
        <p className="text-sm text-slate-600">Sign in to open or create user-owned live rooms.</p>
        <button
          type="button"
          onClick={() => redirectToAuthModal('login')}
          className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          Sign in to go live
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        {items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-8 text-sm text-slate-600 shadow-sm">
            No live rooms yet. Use the right rail to go live or create a persistent space.
          </div>
        ) : null}
        {items.map((item) => {
          const publicHref = viewerHandle ? `/u/${encodeURIComponent(viewerHandle)}/live/${encodeURIComponent(item.id)}` : null
          return (
            <article key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-100">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt={`${item.title?.trim() || 'Live room'} cover`} className="h-44 w-full object-cover" />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(213,43,30,0.12),_transparent_38%),linear-gradient(135deg,_rgba(241,245,249,1),_rgba(226,232,240,0.92))] px-6 text-center text-sm text-slate-500">
                    No room cover yet.
                  </div>
                )}
              </div>
              <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <span>{item.launchMode === 'INSTANT' ? 'Instant' : 'Live Space'}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{item.visibility === 'PRIVATE' ? 'Private' : 'Public'}</span>
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-slate-900">{item.title?.trim() || 'Untitled live space'}</h2>
                  <LinkedText text={item.description} emptyFallback="No description yet." className="mt-3 text-sm text-slate-600" />
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {item.status === 'ACTIVE' ? 'Live' : 'Ended'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1">{item.participantCount ?? 0} participants</span>
                {item.requiresManualAdmit ? <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">Manual admit</span> : null}
                {item.requiresPassword ? <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">Password</span> : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href={`/live/manage/${encodeURIComponent(item.id)}`}
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Manage
                </Link>
                {publicHref ? (
                  <Link
                    href={publicHref}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    {item.status === 'ACTIVE' ? 'Open Room' : 'View Room'}
                  </Link>
                ) : null}
              </div>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}