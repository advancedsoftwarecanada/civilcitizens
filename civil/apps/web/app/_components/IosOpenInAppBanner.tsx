'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { HiOutlineArrowTopRightOnSquare, HiOutlineXMark } from 'react-icons/hi2'
import { buildPwaInstallEntryUrl, shouldBlockForAppleInstall } from '../_lib/appleInstallGate'
import { pushToast } from './useToasts'

const DISMISS_STORAGE_KEY = 'cc:iosOpenInAppBanner:dismissedUntil'
const DISMISS_TTL_MS = 12 * 60 * 60 * 1000

const SKIP_PATH_PREFIXES = ['/install/', '/welcome', '/verify', '/login', '/register', '/forgot', '/reset', '/privacy', '/terms', '/safety', '/help']

function isContentPath(pathname: string): boolean {
  if (!pathname || pathname === '/') return false
  if (SKIP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false
  if (/\/posts\/[^/]+\/?$/i.test(pathname)) return true
  if (/\/events\/[^/]+\/?$/i.test(pathname)) return true
  if (/\/jobs\/[^/]+\/?$/i.test(pathname)) return true
  if (/^\/post\/[^/]+\/?$/i.test(pathname)) return true
  if (/^\/u\/[^/]+\/?$/i.test(pathname)) return true
  if (/^\/market\/products\/[^/]+\/?$/i.test(pathname)) return true
  if (/^\/com\/[^/]+\/[^/]+\/orgs\/[^/]+(?:\/.*)?$/i.test(pathname)) return true
  return false
}

function readDismissUntil(): number {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY)
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function IosOpenInAppBanner() {
  const pathname = usePathname()
  const [dismissUntil, setDismissUntil] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setDismissUntil(readDismissUntil())
    setReady(true)
  }, [])

  const showBanner = useMemo(() => {
    if (!ready) return false
    if (!pathname) return false
    if (!shouldBlockForAppleInstall()) return false
    if (!isContentPath(pathname)) return false
    return dismissUntil <= Date.now()
  }, [dismissUntil, pathname, ready])

  const handleDismiss = useCallback(() => {
    if (typeof window === 'undefined') return
    const nextUntil = Date.now() + DISMISS_TTL_MS
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(nextUntil))
    setDismissUntil(nextUntil)
  }, [])

  const handleOpenInApp = useCallback(() => {
    if (!pathname || typeof window === 'undefined') return
    const nextPath = `${pathname}${window.location.search || ''}${window.location.hash || ''}`
    const installUrl = buildPwaInstallEntryUrl(nextPath, 'open_in_app_banner')
    if (installUrl) {
      window.location.assign(installUrl)
      return
    }
    pushToast('Open Civil from your Home Screen icon to continue in-app.', 'info')
  }, [pathname])

  if (!showBanner) return null

  return (
    <div className="relative z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm md:mt-[4.5rem]">
      <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.45rem)] pb-2 sm:px-6">
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-700">Viewing in browser. Open in Civil App for the best experience.</p>
        <button
          type="button"
          onClick={handleOpenInApp}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
        >
          <HiOutlineArrowTopRightOnSquare className="h-4 w-4" />
          <span>Open in Civil App</span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Dismiss open in app banner"
        >
          <HiOutlineXMark className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
