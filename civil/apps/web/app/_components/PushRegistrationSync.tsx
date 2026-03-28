'use client'

import { useEffect, useRef, useState } from 'react'
import { isAndroidInstalledPwaContext, isIosInstalledPwaContext } from '../_lib/appleInstallGate'
import { AUTH_SESSION_CHANGED_EVENT } from '../_lib/authSession'
import { ensureNativePushRegistration, getNativePlatformName, isNativePushOptedOut } from '../_lib/nativePush'
import { canEnablePush as canEnableWebPush, getPermissionState as getWebPushPermissionState, syncExistingPushSubscription } from '../_lib/pushClient'
import { writeWebPushDebugState } from '../_lib/webPushDebug'

function hasAuthToken(): boolean {
  if (typeof window === 'undefined') return false
  const token = window.localStorage.getItem('token')
  return Boolean(token && token.trim())
}

async function syncPushRegistration(): Promise<void> {
  if (!hasAuthToken()) {
    writeWebPushDebugState({ source: 'syncPushRegistration', result: 'skipped_no_auth_token', error: 'no_auth_token' })
    return
  }

  if (getNativePlatformName()) {
    if (isNativePushOptedOut()) return
    await ensureNativePushRegistration({ requestIfPrompt: false })
    return
  }

  const webPwaContext = isIosInstalledPwaContext() || isAndroidInstalledPwaContext()
  if (!webPwaContext) {
    writeWebPushDebugState({ source: 'syncPushRegistration', result: 'skipped_not_pwa', error: 'not_installed_pwa' })
    return
  }
  if (!canEnableWebPush()) {
    writeWebPushDebugState({ source: 'syncPushRegistration', result: 'skipped_cannot_enable', error: 'cannot_enable_web_push' })
    return
  }
  if (getWebPushPermissionState() !== 'granted') {
    writeWebPushDebugState({
      source: 'syncPushRegistration',
      result: 'skipped_permission_not_granted',
      error: String(getWebPushPermissionState()),
    })
    return
  }

  await syncExistingPushSubscription()
}

export default function PushRegistrationSync() {
  const syncInFlightRef = useRef<Promise<void> | null>(null)
  const syncTimeoutRef = useRef<number | null>(null)
  const lastSyncAtRef = useRef(0)
  const [nativePlatform, setNativePlatform] = useState<string | null>(() => getNativePlatformName())

  useEffect(() => {
    if (nativePlatform) return undefined

    const intervalId = window.setInterval(() => {
      const platform = getNativePlatformName()
      if (!platform) return
      setNativePlatform(platform)
      window.clearInterval(intervalId)
    }, 300)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [nativePlatform])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const runSync = () => {
      if (syncInFlightRef.current) return
      if (Date.now() - lastSyncAtRef.current < 1500) return

      syncInFlightRef.current = syncPushRegistration()
        .catch((error) => {
          writeWebPushDebugState({
            source: 'syncPushRegistration',
            result: 'sync_failed',
            error: error instanceof Error ? error.message : String(error),
          })
          console.warn('push_registration_sync_failed', error)
        })
        .finally(() => {
          lastSyncAtRef.current = Date.now()
          syncInFlightRef.current = null
        })
    }

    const scheduleSync = (delayMs = 0) => {
      if (syncTimeoutRef.current !== null) {
        window.clearTimeout(syncTimeoutRef.current)
      }
      syncTimeoutRef.current = window.setTimeout(() => {
        syncTimeoutRef.current = null
        runSync()
      }, delayMs)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleSync(100)
    }

    scheduleSync(300)
    window.addEventListener('focus', runSync)
    window.addEventListener('pageshow', runSync)
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, runSync)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (syncTimeoutRef.current !== null) {
        window.clearTimeout(syncTimeoutRef.current)
      }
      window.removeEventListener('focus', runSync)
      window.removeEventListener('pageshow', runSync)
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, runSync)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!nativePlatform) return
    if (syncInFlightRef.current) return

    syncInFlightRef.current = syncPushRegistration()
      .catch((error) => {
        writeWebPushDebugState({
          source: 'syncPushRegistration:nativePlatformEffect',
          result: 'sync_failed',
          error: error instanceof Error ? error.message : String(error),
        })
        console.warn('push_registration_sync_failed', error)
      })
      .finally(() => {
        lastSyncAtRef.current = Date.now()
        syncInFlightRef.current = null
      })
  }, [nativePlatform])

  return null
}
