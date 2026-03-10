'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ANDROID_PWA_INSTALL_ROUTE, IOS_PWA_INSTALL_ROUTE, isAndroidInstalledPwaContext, isIosInstalledPwaContext } from '../_lib/appleInstallGate'
import { canEnablePush as canEnableWebPush, enablePush as enableWebPush, isPushEnabled as isWebPushEnabled } from '../_lib/pushClient'
import {
  clearIosPwaPushPromptCompleted,
  clearIosPwaPushPromptPendingNextOpen,
  deferIosPwaPushPromptForSevenDays,
  getIosPwaPushPromptPendingNextOpenAt,
  hasIosPwaWelcomeBeenSeen,
  isIosPwaPushPromptDeferred,
  markIosPwaPushPromptCompleted,
  markIosPwaWelcomeLeft,
  markIosPwaWelcomeSeen,
} from '../_lib/iosPwaPushPromptState'

function hasAuthToken(): boolean {
  if (typeof window === 'undefined') return false
  const token = window.localStorage.getItem('token')
  return Boolean(token && token.trim())
}

export default function IosPwaPushPrompt() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enableSelected, setEnableSelected] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [openCheckTick, setOpenCheckTick] = useState(0)
  const [wasBackgroundedSinceMount, setWasBackgroundedSinceMount] = useState(false)
  const [sessionStartedAt] = useState(() => Date.now())

  const closeAndDefer = useCallback(() => {
    deferIosPwaPushPromptForSevenDays()
    clearIosPwaPushPromptPendingNextOpen()
    setErrorMessage(null)
    setOpen(false)
  }, [])

  const handleSavePreference = useCallback(async () => {
    if (busy) return
    setErrorMessage(null)

    if (!enableSelected) {
      closeAndDefer()
      return
    }

    setBusy(true)
    try {
      const result = await enableWebPush()
      if (result.ok) {
        markIosPwaPushPromptCompleted()
        clearIosPwaPushPromptPendingNextOpen()
        setOpen(false)
        return
      }
      setErrorMessage(result.message ?? 'Unable to enable notifications right now.')
    } finally {
      setBusy(false)
    }
  }, [busy, closeAndDefer, enableSelected])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const runCheck = () => setOpenCheckTick((value) => value + 1)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setWasBackgroundedSinceMount(true)
        return
      }
      if (document.visibilityState === 'visible') {
        runCheck()
      }
    }

    runCheck()
    window.addEventListener('focus', runCheck)
    window.addEventListener('pageshow', runCheck)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', runCheck)
      window.removeEventListener('pageshow', runCheck)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (openCheckTick <= 0) return
    if (!pathname) return
    if (!isIosInstalledPwaContext() && !isAndroidInstalledPwaContext()) return
    if (!hasAuthToken()) return
    if (!canEnableWebPush()) return
    if (pathname.startsWith(IOS_PWA_INSTALL_ROUTE) || pathname.startsWith(ANDROID_PWA_INSTALL_ROUTE)) return
    const pendingNextOpenAt = getIosPwaPushPromptPendingNextOpenAt()

    if (pathname.startsWith('/welcome')) {
      markIosPwaWelcomeSeen()
      if (pendingNextOpenAt === null) return
    }

    if (pendingNextOpenAt === null) {
      if (!hasIosPwaWelcomeBeenSeen()) return
      markIosPwaWelcomeLeft()
    }
    if (open) return

    let cancelled = false
    void (async () => {
      const pushEnabled = await isWebPushEnabled()
      if (cancelled) return
      if (pushEnabled) {
        markIosPwaPushPromptCompleted()
        clearIosPwaPushPromptPendingNextOpen()
        return
      }

      clearIosPwaPushPromptCompleted()

      const pendingEligible =
        pendingNextOpenAt !== null && (pendingNextOpenAt <= sessionStartedAt || wasBackgroundedSinceMount)

      if (pendingNextOpenAt !== null && !pendingEligible) return
      if (pendingNextOpenAt === null) {
        if (isIosPwaPushPromptDeferred()) return
      }

      setEnableSelected(true)
      setErrorMessage(null)
      setOpen(true)
      if (pendingNextOpenAt !== null) {
        clearIosPwaPushPromptPendingNextOpen()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, openCheckTick, pathname, sessionStartedAt, wasBackgroundedSinceMount])

  if (!open) return null

  return (
    <div className="cc-safe-modal-overlay fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/65 sm:items-center">
      <div className="cc-safe-modal-panel w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.35)]" role="dialog" aria-modal="true" aria-label="Enable notifications">
        <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          You can manage notifications in your Account Settings later.
        </p>

        <h2 className="mt-4 text-2xl font-semibold leading-tight text-slate-900">Enable notifications?</h2>
        <p className="mt-2 text-sm text-slate-600">Get chat replies, marketplace activity, and community updates right away.</p>

        <label className="mt-4 flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-[var(--cc-primary)]/25 bg-[var(--cc-primary)]/5 p-4">
          <input
            type="checkbox"
            checked={enableSelected}
            onChange={(event) => setEnableSelected(event.target.checked)}
            className="h-7 w-7 shrink-0 accent-[var(--cc-primary)]"
          />
          <div>
            <div className="text-base font-semibold text-slate-900">Enable notifications</div>
            <div className="text-sm text-slate-600">Recommended for timely alerts and direct replies.</div>
          </div>
        </label>

        {errorMessage ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div> : null}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSavePreference()}
            disabled={busy}
            className="flex-1 rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Saving…' : enableSelected ? 'Enable notifications' : 'Save choice'}
          </button>
          <button
            type="button"
            onClick={closeAndDefer}
            disabled={busy}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  )
}
