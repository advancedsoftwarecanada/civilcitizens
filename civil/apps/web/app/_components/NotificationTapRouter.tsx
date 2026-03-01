'use client'

import { useEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { clearLastNativeNotificationTapUrl, getLastNativeNotificationTapUrl, isAppleNativeApp } from '../_lib/nativePush'

function normalizeDeepLinkUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Prefer relative in-app URLs.
  if (trimmed.startsWith('/')) return trimmed

  // Accept path-style links that omitted the leading slash (e.g. `messages?thread=...`).
  if (/^[a-zA-Z0-9_-]+(\/|\?|#|$)/.test(trimmed)) {
    return `/${trimmed}`
  }

  // If we receive an absolute URL (http(s) or custom scheme), strip it to a safe relative path.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      const relative = `${u.pathname}${u.search}${u.hash}`
      return relative.startsWith('/') ? relative : null
    } catch {
      return null
    }
  }

  return null
}

export default function NotificationTapRouter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUrl = useMemo(() => `${pathname}${searchParams ? `?${searchParams.toString()}` : ''}`, [pathname, searchParams])

  const isHandlingRef = useRef(false)

  useEffect(() => {
    if (!isAppleNativeApp()) return

    const handle = async () => {
      if (isHandlingRef.current) return
      isHandlingRef.current = true
      try {
        const rawUrl = await getLastNativeNotificationTapUrl()
        if (!rawUrl) return

        const nextUrl = normalizeDeepLinkUrl(rawUrl)
        if (!nextUrl) {
          await clearLastNativeNotificationTapUrl()
          return
        }

        // If we're already there, just clear and stop.
        if (nextUrl === currentUrl) {
          await clearLastNativeNotificationTapUrl()
          return
        }

        router.push(nextUrl)
        await clearLastNativeNotificationTapUrl()
      } finally {
        isHandlingRef.current = false
      }
    }

    void handle()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void handle()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', handle)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', handle)
    }
  }, [router, currentUrl])

  return null
}
