'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  HiOutlineArrowUpOnSquare,
  HiOutlineChevronDown,
  HiOutlineEllipsisHorizontalCircle,
  HiOutlinePlus,
} from 'react-icons/hi2'
import { buildIosSwitchToSafariUrl, isIosSafariBrowser, normalizeRelativePath, shouldBlockForAppleInstall } from '../../../_lib/appleInstallGate'

export default function InstallIosPwaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])
  const [isBlocking, setIsBlocking] = useState(true)

  useEffect(() => {
    const safari = isIosSafariBrowser()
    const blocked = shouldBlockForAppleInstall()
    setIsBlocking(blocked)
    if (!blocked) {
      router.replace(nextPath)
      return
    }
    if (!safari) {
      router.replace(buildIosSwitchToSafariUrl(nextPath, source || undefined))
    }
  }, [nextPath, router, source])

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
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-yellow-300">Install Steps</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlineEllipsisHorizontalCircle className="h-5 w-5" />
                </span>
                <span>Tap (...) bottom right</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlineArrowUpOnSquare className="h-5 w-5" />
                </span>
                <span>Tap Share</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlineChevronDown className="h-5 w-5" />
                </span>
                <span>Tap View More</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-slate-100">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <HiOutlinePlus className="h-5 w-5" />
                </span>
                <span>Tap Add To Home Screen</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
