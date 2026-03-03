'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { buildIosPwaInstallUrl, isIosSafariBrowser, normalizeRelativePath, shouldBlockForAppleInstall } from '../../../_lib/appleInstallGate'

function buildSafariDeepLink(targetUrl: string): string {
  if (targetUrl.startsWith('https://')) return `x-safari-https://${targetUrl.slice('https://'.length)}`
  if (targetUrl.startsWith('http://')) return `x-safari-http://${targetUrl.slice('http://'.length)}`
  return targetUrl
}

export default function InstallIosSwitchToSafariPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])
  const [showFallbackHint, setShowFallbackHint] = useState(false)

  const safariInstallUrl = useMemo(() => buildIosPwaInstallUrl(nextPath, source || undefined), [nextPath, source])

  useEffect(() => {
    const blocked = shouldBlockForAppleInstall()
    if (!blocked) {
      router.replace(nextPath)
      return
    }
    if (isIosSafariBrowser()) {
      router.replace(safariInstallUrl)
    }
  }, [nextPath, router, safariInstallUrl])

  const handleOpenSafari = () => {
    if (typeof window === 'undefined') return
    const absoluteTarget = new URL(safariInstallUrl, window.location.origin).toString()
    const deepLink = buildSafariDeepLink(absoluteTarget)
    window.location.assign(deepLink)
    window.setTimeout(() => {
      setShowFallbackHint(true)
    }, 1200)
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
            <h1 className="text-2xl font-semibold leading-tight text-white">Open Safari to continue</h1>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-200">
            iPhone and iPad home-screen install is only supported from Safari. Open this page in Safari, then add Civil to your Home Screen.
          </p>

          <button
            type="button"
            onClick={handleOpenSafari}
            className="mt-5 w-full rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
          >
            Open Safari
          </button>

          <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">If Safari Did Not Open</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-100">
              <li>Tap your browser menu.</li>
              <li>Choose Open in Safari.</li>
              <li>Return here and continue installation.</li>
            </ol>
          </div>

          {showFallbackHint ? (
            <p className="mt-4 text-xs text-slate-300">
              If nothing happened, use your browser menu and choose Open in Safari.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
