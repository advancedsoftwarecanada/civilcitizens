'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HiOutlineArrowDownTray, HiOutlineEllipsisVertical, HiOutlineHome } from 'react-icons/hi2'
import {
  buildIosInstallEntryUrl,
  normalizeRelativePath,
  shouldBlockForAndroidInstall,
  shouldBlockForAppleInstall,
} from '../../../_lib/appleInstallGate'
import { trackInstallFlowEvent } from '../../../_lib/installFlowAnalytics'

type BeforeInstallPromptChoice = {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<BeforeInstallPromptChoice>
}

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return typeof (event as { prompt?: unknown }).prompt === 'function'
}

export default function InstallAndroidPwaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])
  const [isBlocking, setIsBlocking] = useState(true)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPrompting, setIsPrompting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const trackedEventsRef = useRef<Set<string>>(new Set())

  const trackEvent = useCallback(
    (event: Parameters<typeof trackInstallFlowEvent>[0]['event']) => {
      const key = `${event}:${source}:${nextPath}`
      if (trackedEventsRef.current.has(key)) return
      trackedEventsRef.current.add(key)
      void trackInstallFlowEvent({
        flow: 'android_pwa',
        event,
        source: source || undefined,
        nextPath,
      })
    },
    [nextPath, source],
  )

  useEffect(() => {
    trackEvent('view')

    if (shouldBlockForAppleInstall()) {
      router.replace(buildIosInstallEntryUrl(nextPath, source || undefined))
      return
    }

    if (!shouldBlockForAndroidInstall()) {
      setIsBlocking(false)
      router.replace(nextPath)
      return
    }

    setIsBlocking(true)

    const handleBeforeInstallPrompt = (event: Event) => {
      if (!isBeforeInstallPromptEvent(event)) return
      event.preventDefault()
      setDeferredPrompt(event)
      setStatusMessage(null)
    }

    const handleInstalled = () => {
      setDeferredPrompt(null)
      setStatusMessage('Civil is installed. Open it from your Home Screen to continue.')
      trackEvent('installed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [nextPath, router, source, trackEvent])

  const handleInstall = async () => {
    if (isPrompting) return
    setStatusMessage(null)
    trackEvent('install_cta_clicked')

    if (!deferredPrompt) {
      setStatusMessage('Install prompt not available yet. Use the steps below from your browser menu.')
      return
    }

    setIsPrompting(true)
    try {
      trackEvent('install_prompt_opened')
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        trackEvent('install_prompt_accepted')
        setStatusMessage('Install accepted. Open Civil from your Home Screen to continue.')
      } else {
        trackEvent('install_prompt_dismissed')
        setStatusMessage('Install prompt dismissed. You can install any time from the browser menu.')
      }
    } catch {
      trackEvent('install_prompt_failed')
      setStatusMessage('Install prompt failed. Use the manual install steps below.')
    } finally {
      setDeferredPrompt(null)
      setIsPrompting(false)
    }
  }

  if (!isBlocking) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--cc-page-bg)] text-slate-500">Redirecting…</div>
  }

  return (
    <div className="fixed inset-0 overflow-y-auto overscroll-none bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-md px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-10 sm:pb-10">
        <div className="rounded-3xl border border-white/20 bg-slate-900/95 p-6 shadow-[0_30px_90px_rgba(2,6,23,0.65)]">
          <div className="flex items-center gap-3">
            <Image
              src="/PWA-ICON.jpg"
              alt="Civil app icon"
              width={52}
              height={52}
              className="h-12 w-12 rounded-xl border border-white/20 object-cover shadow-sm"
              priority
            />
            <h1 className="text-2xl font-semibold leading-tight text-white">Skip The App Store</h1>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-200">Help keep fees low by installing Civil directly</p>

          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={isPrompting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HiOutlineArrowDownTray className="h-5 w-5" />
            <span>{isPrompting ? 'Opening install prompt…' : 'Install Civil App'}</span>
          </button>

          {statusMessage ? <p className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200">{statusMessage}</p> : null}

          <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-yellow-300">Install Steps</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlineEllipsisVertical className="h-5 w-5" />
                </span>
                <span>Tap the browser menu (top-right)</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlineArrowDownTray className="h-5 w-5" />
                </span>
                <span>Tap Install app or Add to Home screen</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlineHome className="h-5 w-5" />
                </span>
                <span>Open Civil from your new Home Screen icon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
