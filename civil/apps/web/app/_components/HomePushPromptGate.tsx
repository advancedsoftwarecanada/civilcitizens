'use client'

import { useEffect } from 'react'
import { isAndroidInstalledPwaContext, isIosInstalledPwaContext } from '../_lib/appleInstallGate'
import {
  hasAttemptedHomeNativePushPrompt,
  hasAttemptedHomeWebPushPrompt,
  markHomeNativePushPromptAttempted,
  markHomeWebPushPromptAttempted,
} from '../_lib/homePushPromptState'
import { hasDeclaredCivilStatus, hasHomeCommunity } from '../_lib/me'
import { ensureNativePushRegistration, isNativeApp, isNativePushOptedOut } from '../_lib/nativePush'
import { canEnablePush as canEnableWebPush, enablePush as enableWebPush } from '../_lib/pushClient'
import { useViewerStore } from '../_lib/viewerStore'

function hasAuthToken(): boolean {
  if (typeof window === 'undefined') return false
  const token = window.localStorage.getItem('token')
  return Boolean(token && token.trim())
}

export default function HomePushPromptGate() {
  const hydrated = useViewerStore((state) => state.hydrated)
  const me = useViewerStore((state) => state.me)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!hydrated) return
    if (!hasAuthToken()) return
    if (!hasHomeCommunity(me) || !hasDeclaredCivilStatus(me)) return

    const nativeContext = isNativeApp()
    const webPwaContext = !nativeContext && (isIosInstalledPwaContext() || isAndroidInstalledPwaContext())

    if (!nativeContext && !webPwaContext) return

    if (nativeContext) {
      if (isNativePushOptedOut()) return
      if (hasAttemptedHomeNativePushPrompt()) return
    }

    if (webPwaContext) {
      if (!canEnableWebPush()) return
      if (hasAttemptedHomeWebPushPrompt()) return
    }

    let cancelled = false
    void (async () => {
      if (nativeContext) {
        const state = await ensureNativePushRegistration({ requestIfPrompt: true })
        if (cancelled) return
        if (state === 'granted' || state === 'denied' || state === 'prompt') {
          markHomeNativePushPromptAttempted()
        }
        return
      }

      const result = await enableWebPush()
      if (cancelled) return

      if (
        result.ok ||
        result.status === 'permission-denied' ||
        result.status === 'permission-dismissed' ||
        result.status === 'already-enabled'
      ) {
        markHomeWebPushPromptAttempted()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hydrated, me])

  return null
}
