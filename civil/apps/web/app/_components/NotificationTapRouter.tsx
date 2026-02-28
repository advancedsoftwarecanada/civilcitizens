'use client'

import { useEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { clearLastNativeNotificationTapUrl, getLastNativeNotificationTapUrl, isAppleNativeApp } from '../_lib/nativePush'

function normalizeDeepLinkUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Prefer relative in-app URLs.
  if (trimmed.startsWith('/')) return trimmed

  // If we ever accidentally send an absolute URL, strip it to a safe relative path.
  if (/^https?:\/\//i.test(trimmed)) {
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
