'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2'
import { IOS_APP_STORE_URL, normalizeRelativePath, shouldBlockForAppleInstall } from '../../../_lib/appleInstallGate'
import { trackInstallFlowEvent } from '../../../_lib/installFlowAnalytics'
import BackgroundVideo from '../../../_components/BackgroundVideo'

export default function InstallIosPwaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])
  const [isBlocking, setIsBlocking] = useState(true)
  const trackedEventsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const blocked = shouldBlockForAppleInstall()
    setIsBlocking(blocked)
    const key = `view:${source}:${nextPath}`
    if (blocked && !trackedEventsRef.current.has(key)) {
      trackedEventsRef.current.add(key)
      void trackInstallFlowEvent({
        flow: 'ios_app_store',
        event: 'view',
        source: source || undefined,
        nextPath,
      })
    }
    if (!blocked) {
      router.replace(nextPath)
    }
  }, [nextPath, router, source])

  const handleAppStoreClick = () => {
    void trackInstallFlowEvent({
      flow: 'ios_app_store',
      event: 'install_cta_clicked',
      source: source || undefined,
      nextPath,
    })
  }

  if (!isBlocking) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--cc-page-bg)] text-slate-500">Redirecting…</div>
  }

  return (
    <div className="relative min-h-screen overflow-y-auto overscroll-none text-white">
      <BackgroundVideo fixed />
      <div className="fixed inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/70 to-slate-950/85" aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-md px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-10 sm:pb-10">
        <div className="rounded-3xl border border-white/20 bg-slate-900/80 p-6 shadow-[0_30px_90px_rgba(2,6,23,0.65)] backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Image
              src="/apple.webp"
              alt="Download on the App Store"
              width={52}
              height={52}
              className="h-12 w-12 rounded-xl border border-white/20 object-cover shadow-sm"
              priority
            />
            <h1 className="text-2xl font-semibold leading-tight text-white">Civil Is On The App Store</h1>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-200">Download the official iPhone and iPad app from Apple.</p>

          <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-300">Now Available</p>
            <p className="mt-3 text-sm leading-6 text-slate-100">Civil Citizens is officially live on the Canadian App Store.</p>
            <a
              href={IOS_APP_STORE_URL}
              onClick={handleAppStoreClick}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_16px_40px_rgba(52,211,153,0.35)] transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/70"
            >
              <HiOutlineArrowTopRightOnSquare className="h-5 w-5" />
              Download on the App Store
            </a>
          </div>

          <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-yellow-300">Install Steps</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-100">
              <li>Tap the App Store button above.</li>
              <li>Download Civil Citizens from Apple.</li>
              <li>Open the app and sign in with your Civil account.</li>
            </ol>
            <button
              type="button"
              onClick={() => router.replace(nextPath)}
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Continue in browser instead
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
