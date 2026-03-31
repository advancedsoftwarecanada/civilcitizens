'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { clearLastNativeNotificationTapUrl, ensureNativeNotificationTapListener, getLastNativeNotificationTapUrl, getNativePlatformName } from '../_lib/nativePush'
import { acknowledgePendingPushRedirect, markPendingPushRedirectAttempt, setPendingPushRedirect } from '../_lib/pendingPushRedirect'
import { emitPushNavigation, emitPushUiReset } from '../_lib/pushNavigation'
import { normalizePushDeepLinkUrl } from '../_lib/pushDeepLink'

const ROUTER_REPLACE_FALLBACK_MS = 900

export default function NotificationTapRouter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUrl = useMemo(() => `${pathname}${searchParams ? `?${searchParams.toString()}` : ''}`, [pathname, searchParams])

  const isHandlingRef = useRef(false)
  const replaceFallbackTimeoutRef = useRef<number | null>(null)
  const [nativePlatform, setNativePlatform] = useState<string | null>(() => getNativePlatformName())

  useEffect(() => {
    return () => {
      if (replaceFallbackTimeoutRef.current) {
        window.clearTimeout(replaceFallbackTimeoutRef.current)
      }
    }
  }, [])

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

    const clearReplaceFallback = () => {
      if (!replaceFallbackTimeoutRef.current) return
      window.clearTimeout(replaceFallbackTimeoutRef.current)
      replaceFallbackTimeoutRef.current = null
    }

    const scheduleReplaceFallback = (nextUrl: string) => {
      clearReplaceFallback()
      replaceFallbackTimeoutRef.current = window.setTimeout(() => {
        replaceFallbackTimeoutRef.current = null
        const liveUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
        if (liveUrl === nextUrl) return
        window.location.replace(nextUrl)
      }, ROUTER_REPLACE_FALLBACK_MS)
    }

    const handle = async () => {
      if (isHandlingRef.current) return
      isHandlingRef.current = true
      try {
        const rawUrl = await getLastNativeNotificationTapUrl()
        if (!rawUrl) return

        const nextUrl = normalizePushDeepLinkUrl(rawUrl)
        if (!nextUrl) {
          await clearLastNativeNotificationTapUrl()
          return
        }

        setPendingPushRedirect(nextUrl)
        emitPushUiReset(nextUrl)

        // If we're already there, just clear and stop.
        if (nextUrl === currentUrl) {
          clearReplaceFallback()
          emitPushNavigation(nextUrl)
          acknowledgePendingPushRedirect(currentUrl)
          await clearLastNativeNotificationTapUrl()
          return
        }

        if (!markPendingPushRedirectAttempt(nextUrl)) {
          return
        }

        router.replace(nextUrl)
        scheduleReplaceFallback(nextUrl)
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
      clearReplaceFallback()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', handle)
    }
  }, [router, currentUrl, nativePlatform])

  return null
}
