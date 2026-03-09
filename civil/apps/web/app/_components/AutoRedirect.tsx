"use client"
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthedEntryPath } from '../_lib/me'
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
    void router.prefetch('/verify')
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (didNavigateRef.current) return

    const token = window.localStorage.getItem('token')
    if (!token) {
      document.documentElement.classList.remove('cc-launch-pending')
      return
    }

    if (cachedMe) {
      didNavigateRef.current = true
      router.replace(getAuthedEntryPath(cachedMe))
      return
    }

    // Let ViewerBootstrap start the viewer request first, then attach to the same deduped ensureViewerMe call
    // so the launch overlay can stay up until we know whether to route into the app or show the public landing page.
    if (!hydrated) return

    let cancelled = false

    ensureViewerMe({ token })
      .then((data) => {
        if (cancelled) return
        if (didNavigateRef.current) return
        if (!data) {
          document.documentElement.classList.remove('cc-launch-pending')
          return
        }
        didNavigateRef.current = true
        router.replace(getAuthedEntryPath(data))
      })
      .catch(() => {
        if (!cancelled) {
          document.documentElement.classList.remove('cc-launch-pending')
        }
      })

    return () => {
      cancelled = true
    }
  }, [cachedMe, hydrated, router])
  return null
}
