'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Modal from './Modal'
import { clearLastNativeNotificationTapUrl, getLastNativeNotificationTapUrl, getNativePlatformName, getStoredNativeNotificationTapUrl } from '../_lib/nativePush'
import { clearPendingPushRedirect, getPendingPushRedirectDebugRecord } from '../_lib/pendingPushRedirect'

const DISPLAY_DELAY_MS = 5000

type DebugState = {
  platform: string | null
  currentUrl: string
  storedTapUrl: string | null
  resolvedTapUrl: string | null
  pendingRedirect: ReturnType<typeof getPendingPushRedirectDebugRecord>
  hasToken: boolean
}

function readDebugState(currentUrl: string): DebugState {
  return {
    platform: getNativePlatformName(),
    currentUrl,
    storedTapUrl: getStoredNativeNotificationTapUrl(),
    resolvedTapUrl: null,
    pendingRedirect: getPendingPushRedirectDebugRecord(),
    hasToken: typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : false,
  }
}

export default function PushRedirectDebugModal() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUrl = useMemo(() => `${pathname}${searchParams ? `?${searchParams.toString()}` : ''}${typeof window !== 'undefined' ? window.location.hash || '' : ''}`, [pathname, searchParams])
  const [dismissed, setDismissed] = useState(false)
  const [displayReady, setDisplayReady] = useState(false)
  const [debugState, setDebugState] = useState<DebugState>(() => readDebugState(currentUrl))
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
    if (!nativePlatform) return undefined

    let cancelled = false

    const refresh = async () => {
      const nextState = readDebugState(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      const resolvedTapUrl = await getLastNativeNotificationTapUrl().catch(() => null)
      if (cancelled) return
      setDebugState({ ...nextState, resolvedTapUrl })
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, 1000)

    const onFocus = () => {
      void refresh()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [currentUrl, nativePlatform])

  useEffect(() => {
    setDismissed(false)
  }, [debugState.pendingRedirect?.url, debugState.storedTapUrl, debugState.resolvedTapUrl, debugState.currentUrl])

  const shouldOpen = !dismissed && (
    Boolean(debugState.pendingRedirect) ||
    Boolean(debugState.storedTapUrl) ||
    Boolean(debugState.resolvedTapUrl)
  )

  const retryTarget = debugState.pendingRedirect?.url ?? debugState.resolvedTapUrl ?? debugState.storedTapUrl
  const waitingOnRedirect = Boolean(retryTarget) && retryTarget !== debugState.currentUrl

  useEffect(() => {
    if (!shouldOpen || !waitingOnRedirect) {
      setDisplayReady(false)
      return
    }

    setDisplayReady(false)
    const timeoutId = window.setTimeout(() => {
      setDisplayReady(true)
    }, DISPLAY_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shouldOpen, waitingOnRedirect, retryTarget])

  if (!nativePlatform) return null

  return (
    <Modal
      open={shouldOpen && waitingOnRedirect && displayReady}
      onClose={() => {
        setDismissed(true)
        setDisplayReady(false)
      }}
      title="Push Redirect Debug"
      maxWidthClassName="max-w-lg"
      closeOnBackdrop={false}
    >
      <div className="space-y-4 text-sm text-slate-700">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="font-semibold">Redirecting you</div>
          <div>Why? Push notification</div>
          <div>Where? {retryTarget ?? 'No target captured yet'}</div>
        </div>

        <div className="grid gap-3">
          <div><span className="font-semibold">Platform:</span> {debugState.platform ?? 'unknown'}</div>
          <div><span className="font-semibold">Current URL:</span> {debugState.currentUrl}</div>
          <div><span className="font-semibold">Auth token present:</span> {debugState.hasToken ? 'yes' : 'no'}</div>
          <div><span className="font-semibold">Stored native tap URL:</span> {debugState.storedTapUrl ?? 'none'}</div>
          <div><span className="font-semibold">Resolved native tap URL:</span> {debugState.resolvedTapUrl ?? 'none'}</div>
          <div>
            <span className="font-semibold">Pending redirect:</span>{' '}
            {debugState.pendingRedirect
              ? `${debugState.pendingRedirect.url} | attempts=${debugState.pendingRedirect.attempts} | createdAt=${new Date(debugState.pendingRedirect.createdAt).toLocaleTimeString()}`
              : 'none'}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              if (!retryTarget) return
              router.replace(retryTarget)
            }}
            className="rounded-xl bg-[var(--cc-primary)] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!retryTarget}
          >
            Retry redirect
          </button>
          <button
            type="button"
            onClick={async () => {
              clearPendingPushRedirect()
              await clearLastNativeNotificationTapUrl()
              setDismissed(true)
            }}
            className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700"
          >
            Clear debug state
          </button>
        </div>
      </div>
    </Modal>
  )
}
