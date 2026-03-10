'use client'

import { useEffect } from 'react'
import { ensureNativePushRegistration, isNativeApp, isNativePushOptedOut } from '../_lib/nativePush'

const HOME_PUSH_PROMPT_KEY = 'cc:homePushPromptAttempted'

export default function HomePushPromptGate() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isNativeApp()) return
    if (isNativePushOptedOut()) return

    const attempted = window.localStorage.getItem(HOME_PUSH_PROMPT_KEY)
    if (attempted === '1') return

    let cancelled = false
    void (async () => {
      const state = await ensureNativePushRegistration({ requestIfPrompt: true })
      if (cancelled) return
      if (state === 'granted' || state === 'denied' || state === 'prompt') {
        window.localStorage.setItem(HOME_PUSH_PROMPT_KEY, '1')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
