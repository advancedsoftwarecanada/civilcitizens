'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'

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

export default function LiveLandingRail() {
  const router = useRouter()
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [creatingInstant, setCreatingInstant] = useState(false)

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
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Live Actions</p>
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={goInstantLive}
            disabled={creatingInstant || creatingSpace}
            className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
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
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Favorite Spaces</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">Soon</span>
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
          <p className="text-sm font-semibold text-slate-900">Follow people and catch them when they go live.</p>
          <p className="mt-2 text-sm text-slate-600">
            Favorite spaces will list the users you follow and send notifications when they start a live room.
          </p>
        </div>
      </section>
    </div>
  )
}