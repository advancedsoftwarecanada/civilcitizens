'use client'

import Image from 'next/image'
import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { ensureViewerMe } from '../_lib/viewerMe'
import {
  getAuthedEntryPath,
  hasDeclaredCivilStatus,
  hasHomeCommunity,
  type CivicStatusValue,
  type MeResponse,
  type WorkAuthorizationValue,
} from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'

const wallpaperBackground: CSSProperties = {
  backgroundImage: "url('/canadawallpapercivil.jpg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed',
}

function workAuthorizationNeeded(civicStatus: CivicStatusValue | '') {
  return civicStatus !== '' && civicStatus !== 'citizen' && civicStatus !== 'permanent_resident'
}

function civicStatusLabel(value: CivicStatusValue) {
  if (value === 'citizen') return 'Canadian Citizen'
  if (value === 'permanent_resident') return 'Permanent Resident of Canada'
  if (value === 'work_permit') return 'Valid Work Permit'
  if (value === 'study_permit') return 'Valid Study Permit'
  return 'Other / Prefer not to say'
}

export default function VerifyPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cachedMe = useViewerStore((state) => state.me)
  const setViewerMe = useViewerStore((state) => state.setMe)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [me, setMe] = useState<MeResponse | null>(cachedMe)
  const [civicStatus, setCivicStatus] = useState<CivicStatusValue | ''>('')
  const [workAuthorization, setWorkAuthorization] = useState<WorkAuthorizationValue | ''>('')
  const [affirmed, setAffirmed] = useState(false)
  const isEditMode = searchParams.get('mode') === 'edit'

  useEffect(() => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      setLoading(false)
      return
    }

    if (cachedMe) {
      if (!hasHomeCommunity(cachedMe)) {
        router.replace('/welcome')
        return
      }
      if (hasDeclaredCivilStatus(cachedMe) && !isEditMode) {
        router.replace('/home')
        return
      }
      setMe(cachedMe)
      setLoading(false)
      return
    }

    let cancelled = false

    ensureViewerMe({ token })
      .then((viewer) => {
        if (cancelled) return
        if (!viewer) {
          setLoading(false)
          return
        }
        if (!hasHomeCommunity(viewer)) {
          router.replace('/welcome')
          return
        }
        if (hasDeclaredCivilStatus(viewer) && !isEditMode) {
          router.replace('/home')
          return
        }
        setMe(viewer)
      })
      .catch(() => {
        pushToast('Unable to load your account right now.', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [cachedMe, isEditMode, router])

  useEffect(() => {
    if (!me) return

    setCivicStatus(me.civicStatus ?? '')
    if (workAuthorizationNeeded(me.civicStatus ?? '')) {
      setWorkAuthorization(me.workAuthorization ?? '')
    } else {
      setWorkAuthorization('authorized')
    }
    setAffirmed(false)
  }, [me])

  const needsWorkAuthorization = workAuthorizationNeeded(civicStatus)
  const canContinue = civicStatus !== '' && (!needsWorkAuthorization || workAuthorization !== '') && affirmed && !submitting

  const submit = async () => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!canContinue || !civicStatus) return

    setSubmitting(true)
    try {
      const res = await fetch(buildApiUrl('/auth/status-declaration'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          civicStatus,
          workAuthorization: needsWorkAuthorization ? workAuthorization : 'authorized',
          affirmed: true,
        }),
      })

      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        pushToast(typeof payload?.error === 'string' ? payload.error : 'Unable to save your status.', 'error')
        return
      }

      const nextMe = await ensureViewerMe({ token, force: true, refresh: true })
      if (nextMe) {
        setViewerMe(nextMe)
        router.replace(isEditMode ? '/profile/edit' : getAuthedEntryPath(nextMe))
        return
      }

      router.replace(isEditMode ? '/profile/edit' : '/home')
    } catch {
      pushToast('Unable to save your status.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen" style={wallpaperBackground}>
      <div className="absolute inset-0 bg-slate-950/45" aria-hidden />
      <div className="relative mx-auto w-full max-w-4xl px-4 py-10">
        <div className="mb-6 flex justify-center">
          <Image src="/logo-white.svg" alt="Civil Citizens" width={160} height={44} className="h-auto w-[160px]" priority />
        </div>

        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-8">
          <div className="space-y-2 border-b border-slate-200 pb-5">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              {isEditMode ? 'Update your status for Civil' : 'Verify your status for Civil'}
            </h1>
            <p className="max-w-xl text-sm leading-6 text-slate-600">
              Civil is a Canadian civic and economic network.
              <br />
              Your status helps communities, employers, and organizations operate properly within Canada.
            </p>
          </div>

          {loading ? <p className="py-8 text-sm text-slate-500">Loading verification…</p> : null}

          {!loading ? (
            <div className="space-y-8 pt-6">
              <section className="space-y-4">
                <p className="text-sm font-semibold text-slate-900">Canadian Status &amp; Work Authorization</p>
                <div className="space-y-2">
                  {(['citizen', 'permanent_resident', 'work_permit', 'study_permit', 'unspecified'] as CivicStatusValue[]).map((value) => {
                    const checked = civicStatus === value
                    return (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${checked ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                        <input
                          type="radio"
                          name="civicStatus"
                          className="mt-1 h-4 w-4"
                          checked={checked}
                          onChange={() => {
                            setCivicStatus(value)
                            if (!workAuthorizationNeeded(value)) {
                              setWorkAuthorization('authorized')
                            } else {
                              setWorkAuthorization('')
                            }
                          }}
                        />
                        <span className="text-sm font-medium text-slate-800">{civicStatusLabel(value)}</span>
                      </label>
                    )
                  })}
                </div>
              </section>

              {needsWorkAuthorization ? (
                <section className="space-y-4">
                  <p className="text-sm font-semibold text-slate-900">Are you legally authorized to work in Canada?</p>
                  <div className="space-y-2">
                    {([
                      ['authorized', 'Yes'],
                      ['not_authorized', 'No'],
                      ['unspecified', 'Prefer not to say'],
                    ] as Array<[WorkAuthorizationValue, string]>).map(([value, label]) => {
                      const checked = workAuthorization === value
                      return (
                        <label
                          key={value}
                          className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${checked ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5' : 'border-slate-200 hover:border-slate-300'}`}
                        >
                          <input
                            type="radio"
                            name="workAuthorization"
                            className="mt-1 h-4 w-4"
                            checked={checked}
                            onChange={() => setWorkAuthorization(value)}
                          />
                          <span className="text-sm font-medium text-slate-800">{label}</span>
                        </label>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={affirmed} onChange={(event) => setAffirmed(event.target.checked)} />
                  <span>I affirm that the information above is accurate to the best of my knowledge.</span>
                </label>
                <p className="mt-3 text-xs text-slate-500">Providing false information may result in account restrictions.</p>
              </section>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canContinue}
                  className="rounded-full bg-[var(--cc-primary)] px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : isEditMode ? 'Save status' : 'Continue to Civil'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}