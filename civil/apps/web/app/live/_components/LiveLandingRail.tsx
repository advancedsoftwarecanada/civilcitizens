'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'

type LiveRailItem = {
  id: string
  title?: string
  launchMode?: 'SPACE' | 'INSTANT'
  status?: 'ACTIVE' | 'ARCHIVED'
  schedule?: {
    startsAt?: string | null
  } | null
}

type LiveRailResponse = {
  items?: LiveRailItem[]
}

const DEFAULT_CREATE_BODY = {
  title: 'Untitled live space',
  description: null,
  visibility: 'PUBLIC',
  requiresPassword: false,
  password: null,
  requiresManualAdmit: false,
  maxParticipants: 100,
  moderatorHandles: [],
  status: 'ARCHIVED',
  launchMode: 'SPACE',
} as const

function formatStartsInLabel(startsAt: string | null | undefined) {
  if (!startsAt) return null
  const targetMs = Date.parse(startsAt)
  const nowMs = Date.now()
  if (!Number.isFinite(targetMs) || targetMs <= nowMs) return null

  const diffMinutes = Math.max(1, Math.ceil((targetMs - nowMs) / 60000))
  const days = Math.floor(diffMinutes / (60 * 24))
  const hours = Math.floor((diffMinutes % (60 * 24)) / 60)
  const minutes = diffMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
  return `Starts in ${parts.join(' ')}`
}

export default function LiveLandingRail() {
  const router = useRouter()
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [creatingInstant, setCreatingInstant] = useState(false)
  const [items, setItems] = useState<LiveRailItem[]>([])

  const loadSpaces = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setItems([])
      return
    }

    try {
      const res = await fetch(buildApiUrl('/live/spaces'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setItems([])
        return
      }
      const { json } = await parseApiResponse<LiveRailResponse>(res)
      const nextItems = Array.isArray(json?.items)
        ? json.items.filter((item) => item?.launchMode === 'SPACE').slice(0, 5)
        : []
      setItems(nextItems)
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  const createSpace = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setCreatingSpace(true)
    try {
      const res = await fetch(buildApiUrl('/live/spaces'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(DEFAULT_CREATE_BODY),
      })
      const { json, text } = await parseApiResponse<{ managePath?: string; error?: unknown }>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to create live space.', 'error')
        return
      }
      router.push(typeof json?.managePath === 'string' ? json.managePath : '/live')
      router.refresh()
      void loadSpaces()
    } catch (error) {
      console.error('live_space_create_failed', error)
      pushToast('Unable to create live space right now.', 'error')
    } finally {
      setCreatingSpace(false)
    }
  }, [router])

  const goInstantLive = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setCreatingInstant(true)
    try {
      const res = await fetch(buildApiUrl('/live/spaces/instant'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const { json, text } = await parseApiResponse<{ redirectPath?: string; error?: unknown }>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to start live broadcast.', 'error')
        return
      }
      router.push(typeof json?.redirectPath === 'string' ? json.redirectPath : '/live')
      router.refresh()
      void loadSpaces()
    } catch (error) {
      console.error('instant_live_create_failed', error)
      pushToast('Unable to start live broadcast right now.', 'error')
    } finally {
      setCreatingInstant(false)
    }
  }, [router])

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={goInstantLive}
            disabled={creatingInstant || creatingSpace}
            className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:opacity-60"
          >
            {creatingInstant ? 'Starting...' : 'Go Instant Live'}
          </button>
          <button
            type="button"
            onClick={createSpace}
            disabled={creatingSpace || creatingInstant}
            className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
          >
            {creatingSpace ? 'Creating...' : 'Create Live Space'}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Manage Live Spaces</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">Max 5</span>
        </div>
        <div className="mt-4 space-y-3">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
              <p className="text-sm font-semibold text-slate-900">No persistent live spaces yet.</p>
              <p className="mt-2 text-sm text-slate-600">Create a live space and it will show up here for quick management.</p>
            </div>
          ) : (
            items.map((item) => {
              const startsInLabel = formatStartsInLabel(item.schedule?.startsAt)
              return (
                <Link
                  key={item.id}
                  href={`/live/manage/${encodeURIComponent(item.id)}`}
                  className="block rounded-2xl border border-slate-200 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.title?.trim() || 'Untitled live space'}</p>
                      <p className="mt-1 text-xs text-slate-500">{startsInLabel || (item.status === 'ACTIVE' ? 'Live now' : 'Ended')}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">Manage</span>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}