"use client"

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { buildApiUrl } from '../_lib/api'

const POST_ID_EVENT = 'cc:analytics:set-post'

type TrackPayload = {
  path: string
  postId?: string
  referrer?: string
}

async function sendTrack(payload: TrackPayload, token: string | null, lastKeyRef: MutableRefObject<string>) {
  const key = `${payload.path}|${payload.postId ?? ''}`
  if (lastKeyRef.current === key) return
  lastKeyRef.current = key

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`

  try {
    await fetch(buildApiUrl('/analytics/track'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('track_view_failed', err)
  }
}

export function useRegisterPageView(postId?: string | null) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__ccPostId = postId ?? null
    const event = new CustomEvent(POST_ID_EVENT, { detail: { postId: postId ?? null } })
    window.dispatchEvent(event)

    return () => {
      ;(window as any).__ccPostId = null
      const clearEvent = new CustomEvent(POST_ID_EVENT, { detail: { postId: null, silent: true } })
      window.dispatchEvent(clearEvent)
    }
  }, [postId])
}

export default function AnalyticsTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastKeyRef = useRef('')
  const activePostIdRef = useRef<string | null>(null)

  const path = useMemo(() => {
    const qs = searchParams?.toString()
    if (!pathname) return '/'
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    activePostIdRef.current = (window as any).__ccPostId ?? null
    const token = window.localStorage.getItem('token')
    const referrer = typeof document !== 'undefined' ? document.referrer : undefined

    const handlePostId = (evt: Event) => {
      const detail = (evt as CustomEvent<{ postId?: string | null; silent?: boolean }>).detail
      const nextPostId = detail?.postId ?? null
      if (activePostIdRef.current === nextPostId) return
      activePostIdRef.current = nextPostId
      if (detail?.silent) return
      void sendTrack(
        {
          path,
          ...(nextPostId ? { postId: nextPostId } : {}),
          ...(referrer ? { referrer } : {}),
        },
        token,
        lastKeyRef,
      )
    }

    window.addEventListener(POST_ID_EVENT, handlePostId)

    void sendTrack(
      {
        path,
        ...(activePostIdRef.current ? { postId: activePostIdRef.current } : {}),
        ...(referrer ? { referrer } : {}),
      },
      token,
      lastKeyRef,
    )

    return () => {
      window.removeEventListener(POST_ID_EVENT, handlePostId)
    }
  }, [path])

  return null
}
