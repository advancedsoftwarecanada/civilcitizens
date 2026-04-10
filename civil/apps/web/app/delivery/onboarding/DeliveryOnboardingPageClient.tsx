'use client'

import { useMemo } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { getDeliveryRequirementItems, type DeliveryOnboardingResponse } from '../deliveryShared'

export default function DeliveryOnboardingPageClient() {
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [data, setData] = useState<DeliveryOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/drive/onboarding'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await res.json().catch(() => null)) as (DeliveryOnboardingResponse & { error?: string }) | null
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        setError(payload?.error ?? 'Unable to load onboarding right now.')
        return
      }
      setData(payload)
    } catch (err) {
      console.error('Failed to load drive onboarding', err)
      setError('Unable to load onboarding right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const activate = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setActivating(true)
    try {
      const res = await fetch(buildApiUrl('/drive/onboarding/activate'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as (DeliveryOnboardingResponse & { error?: string; requirements?: DeliveryOnboardingResponse['requirements'] }) | null
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to activate your driver account.', 'error')
        if (payload?.requirements) {
          setData((prev) => ({ ...(prev ?? {}), requirements: payload.requirements }))
        }
        return
      }
      pushToast('Civil Driver account activated.', 'success')
      setData((prev) => ({ ...(prev ?? {}), active: true, activeAt: payload?.activeAt ?? new Date().toISOString() }))
    } catch (err) {
      console.error('Failed to activate drive onboarding', err)
      pushToast('Unable to activate your driver account.', 'error')
    } finally {
      setActivating(false)
    }
  }, [])

  const requirementItems = getDeliveryRequirementItems(data?.requirements)
  const allReady = requirementItems.every((item) => item.met)
  const missingActionItems = useMemo(() => {
    const requirements = data?.requirements ?? {}
    const items: Array<{ href: string; label: string }> = []

    if (requirements.walletReady !== true) {
      items.push({ href: '/wallet', label: 'Open wallet' })
    }
    if (requirements.isCanadianCitizen !== true) {
      items.push({ href: '/verify', label: 'Confirm citizenship' })
    }
    if (requirements.hasProfilePhoto !== true) {
      items.push({ href: '/profile/edit?photo=avatar', label: 'Open account settings' })
    }
    if (requirements.hasHomeAddress !== true) {
      items.push({ href: '/addresses', label: 'Open addresses' })
    }

    return items
  }, [data?.requirements])

  return (
    <DashboardShell rightRail={<RightRail mode="drive" organizationLinkTarget="chat" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Drive</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Driver Onboarding</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Civil only activates Drive drivers who have a funded wallet, verified Canadian citizenship status, a real profile photo, and a home address.</p>
        </section>

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Loading onboarding…</div>
        ) : (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Status</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">{data?.active ? 'Driver account active' : 'Activation pending'}</h2>
                  <p className="mt-2 text-sm text-slate-600">{data?.active ? 'You can now add vehicles and manage the cars you want to offer on Drive.' : 'Every checklist item below must be ready before you can activate your Civil Driver account.'}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {data?.active ? (
                    <Link href="/drive/driver/manage" className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95">
                      Add Vehicle
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={!allReady || activating}
                      onClick={() => void activate()}
                      className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {activating ? 'Activating…' : 'Activate my Civil Driver account'}
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {requirementItems.map((item) => (
                <article key={item.key} className={`rounded-3xl border p-5 shadow-sm ${item.met ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
                  <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${item.met ? 'text-emerald-700' : 'text-slate-400'}`}>{item.met ? 'Ready' : 'Incomplete'}</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.label}</h3>
                </article>
              ))}
            </section>

            {!data?.active && missingActionItems.length ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">Finish the missing pieces</h2>
                <p className="mt-2 text-sm text-slate-600">Only the requirements that are still incomplete are shown here.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {missingActionItems.map((item) => (
                    <Link key={item.href} href={item.href} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
                      {item.label}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </DashboardShell>
  )
}
