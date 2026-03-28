'use client'

import { useEffect } from 'react'
import {
  hasAttemptedHomeNativePushPrompt,
  markHomeNativePushPromptAttempted,
} from '../_lib/homePushPromptState'
import { hasDeclaredCivilStatus, hasHomeCommunity } from '../_lib/me'
import { ensureNativePushRegistration, isNativeApp, isNativePushOptedOut } from '../_lib/nativePush'
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

    if (!isNativeApp()) return
    if (isNativePushOptedOut()) return
    if (hasAttemptedHomeNativePushPrompt()) return

    let cancelled = false
    void (async () => {
      const state = await ensureNativePushRegistration({ requestIfPrompt: true })
      if (cancelled) return
      if (state === 'granted' || state === 'denied' || state === 'prompt') {
        markHomeNativePushPromptAttempted()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hydrated, me])

  return null
}
