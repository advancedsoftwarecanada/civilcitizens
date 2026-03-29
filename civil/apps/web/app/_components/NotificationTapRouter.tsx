'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { clearLastNativeNotificationTapUrl, ensureNativeNotificationTapListener, getLastNativeNotificationTapUrl, getNativePlatformName } from '../_lib/nativePush'
import { acknowledgePendingPushRedirect, markPendingPushRedirectAttempt, setPendingPushRedirect } from '../_lib/pendingPushRedirect'
import { emitPushNavigation } from '../_lib/pushNavigation'

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
  const [nativePlatform, setNativePlatform] = useState<string | null>(() => getNativePlatformName())

  useEffect(() => {
    if (nativePlatform) return undefined

    const intervalId = window.setInterval(() => {
      const platform = getNativePlatformName()
      if (platform) {
        setNativePlatform(platform)
        window.clearInterval(intervalId)
      }
    }, 300)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [nativePlatform])

  useEffect(() => {
    if (!nativePlatform) return

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

        setPendingPushRedirect(nextUrl)

        // If we're already there, just clear and stop.
        if (nextUrl === currentUrl) {
          emitPushNavigation(nextUrl)
          acknowledgePendingPushRedirect(currentUrl)
          await clearLastNativeNotificationTapUrl()
          return
        }

        if (!markPendingPushRedirectAttempt(nextUrl)) {
          return
        }

        router.replace(nextUrl)
      } finally {
        isHandlingRef.current = false
      }
    }

    void ensureNativeNotificationTapListener()
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
  }, [router, currentUrl, nativePlatform])

  return null
}
