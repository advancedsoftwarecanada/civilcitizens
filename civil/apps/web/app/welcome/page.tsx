"use client"

import { useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { FaArrowRight, FaBriefcase, FaCarSide } from 'react-icons/fa'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildPwaInstallEntryUrl } from '../_lib/appleInstallGate'

type WelcomeChoiceCardProps = {
  title: string
  description: string
  ctaLabel: string
  href: string
  kind: 'rider' | 'driver'
}

function WelcomeChoiceCard({ title, description, ctaLabel, href, kind }: WelcomeChoiceCardProps) {
  const router = useRouter()
  const Icon = kind === 'rider' ? FaCarSide : FaBriefcase
  const accentClassName =
    kind === 'rider'
      ? 'border-red-200 bg-[linear-gradient(135deg,#fff7f6_0%,#ffffff_100%)]'
      : 'border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_100%)]'
  const iconClassName =
    kind === 'rider'
      ? 'bg-red-50 text-red-600'
      : 'bg-slate-900 text-white'
  const buttonClassName =
    kind === 'rider'
      ? 'bg-[#d9222a] text-white hover:bg-[#bd1d24]'
      : 'bg-slate-950 text-white hover:bg-slate-800'

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className={`group w-full rounded-[2rem] border p-6 text-left shadow-[0_24px_70px_rgba(15,23,42,0.08)] transition hover:-translate-y-1 hover:shadow-[0_28px_90px_rgba(15,23,42,0.12)] sm:p-8 ${accentClassName}`}
    >
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-xl ${iconClassName}`}>
        <Icon aria-hidden="true" />
      </div>
      <h2 className="mt-6 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-[2rem]">{title}</h2>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{description}</p>
      <div className={`mt-6 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${buttonClassName}`}>
        {ctaLabel}
        <FaArrowRight className="text-xs transition group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </button>
  )
}

export default function WelcomePage() {
  const router = useRouter()

  useEffect(() => {
    const installUrl = buildPwaInstallEntryUrl('/welcome', 'welcome')
    if (installUrl) {
      router.replace(installUrl)
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    void router.prefetch('/drive/ride')
    void router.prefetch('/drive/onboarding')
  }, [router])

  return (
    <main className="relative isolate min-h-[var(--cc-viewport-height)] overflow-hidden bg-[#f6f0ea] text-slate-950">
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,34,42,0.18),transparent_25%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.12),transparent_32%),linear-gradient(180deg,#f8f3ed_0%,#f5efe7_100%)]"
        aria-hidden="true"
      />
      <div className="absolute left-[-4rem] top-10 h-64 w-64 rounded-full bg-red-500/10 blur-3xl" aria-hidden="true" />
      <div className="absolute bottom-0 right-[-5rem] h-80 w-80 rounded-full bg-slate-900/10 blur-3xl" aria-hidden="true" />

      <section className="relative z-10 mx-auto flex min-h-[var(--cc-viewport-height)] max-w-5xl items-center px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="w-full rounded-[2.25rem] border border-white/80 bg-white/88 p-6 shadow-[0_32px_100px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8 lg:p-10">
          <div className="mx-auto max-w-3xl text-center">
            <div className="flex justify-center">
              <Image src="/Maple-Rides.png" alt="MapleRides" width={772} height={441} priority className="h-auto w-[190px] sm:w-[230px]" />
            </div>
            <div className="mt-5 inline-flex rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-red-600">
              Canadian owned rides platform
            </div>
            <h1 className="mt-6 text-3xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">What brings you to MapleRides?</h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Choose how you want to get started today. You can always come back and use both sides of the platform later.
            </p>
          </div>

          <div className="mt-10 grid gap-5">
            <WelcomeChoiceCard
              kind="rider"
              title="I Want a Ride"
              description="Book rides quickly with fair, transparent pricing."
              ctaLabel="Continue as Rider"
              href="/drive/ride"
            />
            <WelcomeChoiceCard
              kind="driver"
              title="I Want to Drive"
              description="Earn on your terms. Set your own prices. Keep more of every ride."
              ctaLabel="Continue as Driver"
              href="/drive/onboarding"
            />
          </div>
        </div>
      </section>
    </main>
  )
}
