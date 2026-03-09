'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HiOutlineArrowDownTray } from 'react-icons/hi2'
import {
  buildIosInstallEntryUrl,
  normalizeRelativePath,
  shouldBlockForAndroidInstall,
  shouldBlockForAppleInstall,
} from '../../../_lib/appleInstallGate'
import { trackInstallFlowEvent } from '../../../_lib/installFlowAnalytics'
import BackgroundVideo from '../../../_components/BackgroundVideo'

export default function InstallAndroidPwaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])
  const apkDownloadUrl = '/android/civil.apk'
  const internalTestUrl = 'https://play.google.com/apps/internaltest/4701496163596226565'
  const [isBlocking, setIsBlocking] = useState(true)
  const trackedEventsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const key = `view:${source}:${nextPath}`
    if (!trackedEventsRef.current.has(key)) {
      trackedEventsRef.current.add(key)
      void trackInstallFlowEvent({
        flow: 'android_apk',
        event: 'view',
        source: source || undefined,
        nextPath,
      })
    }

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
  }, [nextPath, router, source])

  if (!isBlocking) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--cc-page-bg)] text-slate-500">Redirecting…</div>
  }

  const handleApkDownloadClick = () => {
    void trackInstallFlowEvent({
      flow: 'android_apk',
      event: 'install_cta_clicked',
      source: source || undefined,
      nextPath,
    })
  }

  const handleTesterClick = () => {
    void trackInstallFlowEvent({
      flow: 'android_apk',
      event: 'install_cta_clicked',
      source: source ? `${source}:tester` : 'tester',
      nextPath,
    })
  }

  return (
    <div className="relative min-h-screen overflow-y-auto overscroll-none text-white">
      <BackgroundVideo fixed />
      <div className="fixed inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/70 to-slate-950/85" aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-md px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-10 sm:pb-10">
        <div className="rounded-3xl border border-white/20 bg-slate-900/80 p-6 shadow-[0_30px_90px_rgba(2,6,23,0.65)] backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Image
              src="/PWA-ICON.png"
              alt="Civil app icon"
              width={52}
              height={52}
              className="h-12 w-12 rounded-xl border border-white/20 object-cover shadow-sm"
              priority
            />
            <h1 className="text-2xl font-semibold leading-tight text-white">Get Android App</h1>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-200">We need testers!</p>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-300">Download the Android app</p>
              <p className="mt-3 text-sm leading-6 text-slate-100">I am NOT a tester.</p>
              <a
                href={apkDownloadUrl}
                onClick={handleApkDownloadClick}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_16px_40px_rgba(52,211,153,0.35)] transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/70"
              >
                <HiOutlineArrowDownTray className="h-5 w-5" />
                Download the Civil Android App
              </a>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-white/70">I have been invited to test Civil</p>
              <a
                href={internalTestUrl}
                onClick={handleTesterClick}
                className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(213,43,30,0.35)] transition hover:bg-[var(--cc-primary-700)] focus:outline-none focus:ring-2 focus:ring-[var(--cc-primary)]/45"
              >
                I have been invited to test Civil
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
