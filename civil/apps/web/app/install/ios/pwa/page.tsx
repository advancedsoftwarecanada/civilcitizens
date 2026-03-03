'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { isIosSafariBrowser, normalizeRelativePath, shouldBlockForAppleInstall } from '../../../_lib/appleInstallGate'

export default function InstallIosPwaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const [isSafari, setIsSafari] = useState(true)
  const [isBlocking, setIsBlocking] = useState(true)

  useEffect(() => {
    setIsSafari(isIosSafariBrowser())
    const blocked = shouldBlockForAppleInstall()
    setIsBlocking(blocked)
    if (!blocked) router.replace(nextPath)
  }, [nextPath, router])

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
          <h1 className="text-2xl font-semibold leading-tight text-white">Install the Civil App to continue</h1>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-white/15 bg-black/40">
          <video
            className="h-auto max-h-[44dvh] w-full object-contain"
            autoPlay
            muted
            playsInline
            loop
            preload="metadata"
            disablePictureInPicture
          >
            <source src="/install-ios-pwa.mp4" type="video/mp4" />
          </video>
        </div>

        <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Install Steps</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-100">
            {isSafari ? (
              <>
                <li>Tap the Share button in Safari.</li>
                <li>Choose Add to Home Screen.</li>
                <li>Open Civil from the new Home Screen icon.</li>
              </>
            ) : (
              <>
                <li>Open this page in Safari.</li>
                <li>Tap Share then Add to Home Screen.</li>
                <li>Open Civil from your Home Screen icon.</li>
              </>
            )}
          </ol>
        </div>
      </div>
      </div>
    </div>
  )
}
