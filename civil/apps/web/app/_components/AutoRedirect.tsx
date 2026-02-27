"use client"
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { hasHomeCommunity } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

export default function AutoRedirect() {
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)
  const hydrated = useViewerStore((s) => s.hydrated)
  const didNavigateRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = window.localStorage.getItem('token')
    if (!token) return
    void router.prefetch('/home')
    void router.prefetch('/welcome')
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (didNavigateRef.current) return

    const token = window.localStorage.getItem('token')
    if (!token) return

    if (cachedMe) {
      didNavigateRef.current = true
      router.replace(hasHomeCommunity(cachedMe) ? '/home' : '/welcome')
      return
    }

    // Let ViewerBootstrap populate the store first (from local cache and/or a deduped viewer refresh)
    // to avoid duplicate requests. If it hasn't after a short delay, fall back to ensuring viewer.
    if (!hydrated) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      if (didNavigateRef.current) return

      ensureViewerMe({ token })
        .then((data) => {
          if (cancelled) return
          if (didNavigateRef.current) return
          if (!data) return
          didNavigateRef.current = true
          router.replace(hasHomeCommunity(data) ? '/home' : '/welcome')
        })
        .catch(() => {})
    }, 800)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cachedMe, hydrated, router])
  return null
}
