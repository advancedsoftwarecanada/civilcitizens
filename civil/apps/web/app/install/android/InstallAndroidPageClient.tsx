'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import clsx from 'clsx'
import {
  buildIosInstallEntryUrl,
  normalizeRelativePath,
  shouldBlockForAndroidInstall,
  shouldBlockForAppleInstall,
} from '../../_lib/appleInstallGate'
import { trackInstallFlowEvent } from '../../_lib/installFlowAnalytics'
import BackgroundVideo from '../../_components/BackgroundVideo'
import { buildApiUrl } from '../../_lib/api'

export default function InstallAndroidPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])
  const internalTestUrl = 'https://play.google.com/apps/internaltest/4701496163596226565'
  const directApkUrl = '/android/civil.apk'
  const [isBlocking, setIsBlocking] = useState(true)
  const [email, setEmail] = useState('')
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [submitMessage, setSubmitMessage] = useState('')
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

  const handleTesterClick = () => {
    void trackInstallFlowEvent({
      flow: 'android_apk',
      event: 'install_cta_clicked',
      source: source ? `${source}:tester` : 'tester',
      nextPath,
    })
  }

  const handleDirectApkClick = () => {
    void trackInstallFlowEvent({
      flow: 'android_apk',
      event: 'install_cta_clicked',
      source: source ? `${source}:direct-apk` : 'direct-apk',
      nextPath,
    })
  }

  const handleInviteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || submitState === 'submitting') return

    setSubmitState('submitting')
    setSubmitMessage('')
    try {
      const response = await fetch(buildApiUrl('/support/install-invite-request'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: trimmedEmail,
          source: source || undefined,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!response.ok) {
        setSubmitState('error')
        setSubmitMessage(payload?.error ?? 'Unable to submit your invitation request right now.')
        return
      }

      setSubmitState('success')
      setSubmitMessage(payload?.message ?? 'Your invitation request has been sent to the admin inbox.')
      setEmail('')
    } catch {
      setSubmitState('error')
      setSubmitMessage('Unable to submit your invitation request right now.')
    }
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
            <h1 className="text-2xl font-semibold leading-tight text-white">Get Civil for Android</h1>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-white/70">Test with Google Play</p>
              <a
                href={internalTestUrl}
                onClick={handleTesterClick}
                className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(213,43,30,0.35)] transition hover:bg-[var(--cc-primary-700)] focus:outline-none focus:ring-2 focus:ring-[var(--cc-primary)]/45"
              >
                Test with Google Play
              </a>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                If you have been invited to test, click here to download from Google Play.
              </p>
              {submitState === 'success' ? (
                <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-200/10 px-4 py-4">
                  <p className="text-sm font-semibold text-emerald-100">Thank you.</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50">{submitMessage || 'Your invitation request has been sent to the admin inbox.'}</p>
                </div>
              ) : (
                <>
                  <p className="mt-4 text-sm leading-6 text-slate-100">If you'd like to help test, enter your email below and we will email you a link.</p>
                  <form className="mt-4 space-y-3" onSubmit={handleInviteSubmit}>
                    <input
                      id="invite-request-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        if (submitState !== 'idle') {
                          setSubmitState('idle')
                          setSubmitMessage('')
                        }
                      }}
                      placeholder="you@example.com"
                      className="h-12 w-full rounded-2xl border border-white/20 bg-slate-950/45 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/20"
                      required
                    />
                    <button
                      type="submit"
                      disabled={submitState === 'submitting' || email.trim().length === 0}
                      className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_16px_40px_rgba(52,211,153,0.35)] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitState === 'submitting' ? 'Sending…' : 'Email me a link'}
                    </button>
                  </form>
                </>
              )}
              {submitMessage ? (
                <p
                  className={clsx(
                    'mt-3 text-sm leading-6',
                    submitState === 'success' ? 'hidden' : 'text-rose-200',
                  )}
                >
                  {submitMessage}
                </p>
              ) : null}
            </div>

            <a
              href={directApkUrl}
              onClick={handleDirectApkClick}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(15,23,42,0.2)] transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/25"
            >
              Download latest DEV Bundle
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}