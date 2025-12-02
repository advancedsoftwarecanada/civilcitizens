"use client"

import Image from 'next/image'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../../_components/Sidebar'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import { buildApiUrl } from '../../_lib/api'
import { hasHomeChamber, type MeResponse } from '../../_lib/me'
import DashboardShell from '../../_components/DashboardShell'

const DEFAULT_RETURN_URL = 'https://app.civilcitizens.dev/settings/billing'

type BillingSummary = {
  stripeEnabled: boolean
  premiumStatus: string
  isPremium: boolean
  premiumSince: string | null
  premiumRenewsAt: string | null
  businessCount: number
  businessLimit: number
}

type BusinessStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED'

type BusinessSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  status: BusinessStatus
  isVerified: boolean
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  billingEmail: string | null
  createdAt: string
  updatedAt: string
}

type BusinessFormState = {
  name: string
  slug: string
  description: string
}

const BUSINESS_STATUS_LABEL: Record<BusinessStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CANCELED: 'Canceled',
}

const BUSINESS_STATUS_BADGE: Record<BusinessStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  CANCELED: 'bg-rose-100 text-rose-700',
}

const PREMIUM_STATUS_LABELS: Record<string, string> = {
  NONE: 'Unverified user',
}

function formatMonthYear(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatStatusLabel(value?: string | null) {
  if (!value) return 'Unknown'
  const normalized = value.toUpperCase()
  if (PREMIUM_STATUS_LABELS[normalized]) {
    return PREMIUM_STATUS_LABELS[normalized]
  }
  return normalized
    .toLowerCase()
    .replace(/_/g, ' ')
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function BillingSettingsPage() {
  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [bizForm, setBizForm] = useState<BusinessFormState>({ name: '', slug: '', description: '' })
  const [bizError, setBizError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const billingReturnUrl = useMemo(() => {
    if (typeof window === 'undefined') return DEFAULT_RETURN_URL
    return `${window.location.origin}/settings/billing`
  }, [])

  const handleUnauthorized = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('token')
      redirectToAuthModal('login')
    }
  }, [])

  const loadSummary = useCallback(
    async (authToken: string) => {
      const res = await fetch(buildApiUrl('/billing/summary'), {
        headers: { authorization: `Bearer ${authToken}` },
      })
      if (res.status === 401) {
        handleUnauthorized()
        return null
      }
      if (!res.ok) {
        throw new Error('summary_failed')
      }
      const data: BillingSummary = await res.json()
      setSummary(data)
      return data
    },
    [handleUnauthorized],
  )

  const loadBusinesses = useCallback(
    async (authToken: string) => {
      const res = await fetch(buildApiUrl('/businesses'), {
        headers: { authorization: `Bearer ${authToken}` },
      })
      if (res.status === 401) {
        handleUnauthorized()
        return null
      }
      if (!res.ok) {
        throw new Error('businesses_failed')
      }
      const data = (await res.json()) as { items: BusinessSummary[] }
      setBusinesses(Array.isArray(data.items) ? data.items : [])
      return data.items
    },
    [handleUnauthorized],
  )

  useEffect(() => {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!storedToken) {
      handleUnauthorized()
      return
    }

    let cancelled = false
    const bootstrap = async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${storedToken}` } })
        if (!res.ok) {
          handleUnauthorized()
          return
        }
        const data: MeResponse = await res.json()
        if (!hasHomeChamber(data)) {
          window.location.replace('/welcome')
          return
        }
        if (!cancelled) {
          setMe(data)
          setToken(storedToken)
          setLoading(true)
        }
        await Promise.all([loadSummary(storedToken), loadBusinesses(storedToken)])
      } catch (err) {
        console.error('Unable to bootstrap billing view', err)
        pushToast('Unable to load billing. Please try again.', 'error', 6000)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [handleUnauthorized, loadBusinesses, loadSummary])

  const refreshBilling = useCallback(async () => {
    if (!token) return
    try {
      await Promise.all([loadSummary(token), loadBusinesses(token)])
    } catch (err) {
      console.error('Unable to refresh billing', err)
    }
  }, [loadBusinesses, loadSummary, token])

  const handlePremiumCheckout = useCallback(async () => {
    if (!token) return
    if (!summary?.stripeEnabled) {
      pushToast('Billing is not available in this environment.', 'warning', 5000)
      return
    }
    try {
      setPendingAction('premium-checkout')
      const payload = {
        successUrl: `${billingReturnUrl}?result=premium_success`,
        cancelUrl: `${billingReturnUrl}?result=premium_cancel`,
      }
      const res = await fetch(buildApiUrl('/billing/premium/checkout'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      if (res.status === 401) {
        handleUnauthorized()
        return
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to start checkout.'
        pushToast(message, 'error', 6000)
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      pushToast('Checkout session missing URL.', 'error', 6000)
    } catch (err) {
      console.error('Premium checkout failed', err)
      pushToast('Unable to start checkout. Please try again.', 'error', 6000)
    } finally {
      setPendingAction(null)
    }
  }, [billingReturnUrl, handleUnauthorized, summary?.stripeEnabled, token])

  const handlePremiumPortal = useCallback(async () => {
    if (!token) return
    if (!summary?.stripeEnabled) {
      pushToast('Billing is not available in this environment.', 'warning', 5000)
      return
    }
    try {
      setPendingAction('premium-portal')
      const res = await fetch(buildApiUrl('/billing/portal'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ returnUrl: billingReturnUrl }),
      })
      if (res.status === 401) {
        handleUnauthorized()
        return
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to open billing portal.'
        pushToast(message, 'error', 6000)
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.portalUrl) {
        window.location.href = data.portalUrl
        return
      }
      pushToast('Billing portal missing URL.', 'error', 6000)
    } catch (err) {
      console.error('Billing portal failed', err)
      pushToast('Unable to open billing portal. Please try again.', 'error', 6000)
    } finally {
      setPendingAction(null)
    }
  }, [billingReturnUrl, handleUnauthorized, summary?.stripeEnabled, token])

  const handleBusinessCheckout = useCallback(
    async (businessId: string) => {
      if (!token) return
      if (!summary?.stripeEnabled) {
        pushToast('Billing is not available in this environment.', 'warning', 5000)
        return
      }
      try {
        setPendingAction(`biz-checkout-${businessId}`)
        const payload = {
          successUrl: `${billingReturnUrl}?result=business_success&business=${businessId}`,
          cancelUrl: `${billingReturnUrl}?result=business_cancel&business=${businessId}`,
        }
        const res = await fetch(buildApiUrl(`/businesses/${businessId}/checkout`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
        if (res.status === 401) {
          handleUnauthorized()
          return
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          const message = typeof payload?.error === 'string' ? payload.error : 'Unable to start business checkout.'
          pushToast(message, 'error', 6000)
          return
        }
        const data = await res.json().catch(() => null)
        if (data?.checkoutUrl) {
          window.location.href = data.checkoutUrl
          return
        }
        pushToast('Checkout session missing URL.', 'error', 6000)
      } catch (err) {
        console.error('Business checkout failed', err)
        pushToast('Unable to start checkout. Please try again.', 'error', 6000)
      } finally {
        setPendingAction(null)
      }
    },
    [billingReturnUrl, handleUnauthorized, summary?.stripeEnabled, token],
  )

  const handleBusinessPortal = useCallback(
    async (businessId: string) => {
      if (!token) return
      if (!summary?.stripeEnabled) {
        pushToast('Billing is not available in this environment.', 'warning', 5000)
        return
      }
      try {
        setPendingAction(`biz-portal-${businessId}`)
        const res = await fetch(buildApiUrl(`/businesses/${businessId}/portal`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ returnUrl: billingReturnUrl }),
        })
        if (res.status === 401) {
          handleUnauthorized()
          return
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          const message = typeof payload?.error === 'string' ? payload.error : 'Unable to open business portal.'
          pushToast(message, 'error', 6000)
          return
        }
        const data = await res.json().catch(() => null)
        if (data?.portalUrl) {
          window.location.href = data.portalUrl
          return
        }
        pushToast('Billing portal missing URL.', 'error', 6000)
      } catch (err) {
        console.error('Business portal failed', err)
        pushToast('Unable to open billing portal. Please try again.', 'error', 6000)
      } finally {
        setPendingAction(null)
      }
    },
    [billingReturnUrl, handleUnauthorized, summary?.stripeEnabled, token],
  )

  const handleCreateBusiness = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!token || !summary?.isPremium) {
        pushToast('Premium membership is required to create an organization or event.', 'warning', 5000)
        return
      }
      const reachedLimit = summary.businessCount >= summary.businessLimit
      if (reachedLimit) {
        pushToast('You have reached your organization limit.', 'warning', 5000)
        return
      }
      try {
        setPendingAction('biz-create')
        setBizError(null)
        const payload = {
          name: bizForm.name.trim(),
          slug: bizForm.slug.trim() || undefined,
          description: bizForm.description.trim() || undefined,
        }
        const res = await fetch(buildApiUrl('/businesses'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
        if (res.status === 401) {
          handleUnauthorized()
          return
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          const message = typeof payload?.error === 'string' ? payload.error : 'Unable to create business.'
          setBizError(message)
          return
        }
        pushToast('Organization created. Refreshing your data…', 'success', 5000)
        setBizForm({ name: '', slug: '', description: '' })
        await refreshBilling()
      } catch (err) {
        console.error('Business creation failed', err)
        pushToast('Unable to create organization. Please try again.', 'error', 6000)
      } finally {
        setPendingAction(null)
      }
    },
    [bizForm, handleUnauthorized, refreshBilling, summary?.businessCount, summary?.businessLimit, summary?.isPremium, token],
  )

  const premiumActive = summary?.isPremium ?? false
  const stripeReady = summary?.stripeEnabled ?? false
  const premiumSince = formatMonthYear(summary?.premiumSince)
  const premiumRenews = formatMonthYear(summary?.premiumRenewsAt)
  const isUnverifiedMember = premiumActive && summary?.premiumStatus === 'NONE'
  const businessSeats = summary?.businessLimit ?? '—'
  const businessUsage = summary ? `${summary.businessCount}/${summary.businessLimit}` : '—'
  const hasBusinesses = businesses.length > 0
  const atBusinessLimit = summary ? summary.businessCount >= summary.businessLimit : false
  const creatingBusiness = pendingAction === 'biz-create'

  const handleBusinessCta = useCallback(() => {
    const targetId = hasBusinesses ? 'businesses' : 'business-create'
    if (typeof document === 'undefined') return
    const section = document.getElementById(targetId)
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hasBusinesses])

  return (
    <>
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={me ?? undefined} active="billing" />
        </div>
      </div>

      <DashboardShell
        className="bg-slate-50"
        sidebar={<Sidebar me={me ?? undefined} active="billing" />}
        rightRail={
          <section className="surface-card space-y-2 px-5 py-4 shadow-subtle">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Need help?</h2>
            <p className="text-sm text-slate-600">
              Email <a href="mailto:billing@civilcitizens.com" className="font-semibold text-[var(--cc-primary)]">billing@civilcitizens.com</a>{' '}
              with your handle and we&apos;ll get back within one business day.
            </p>
          </section>
        }
        rightRailClassName="space-y-4"
        mainClassName="space-y-6"
      >
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="surface-card flex h-full flex-col justify-between gap-5 px-6 py-5 shadow-subtle">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Premium Membership</p>
              <h1 className="text-xl font-semibold text-slate-900">{premiumActive ? 'Premium is active' : 'Upgrade to Premium'}</h1>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-500">
                <li>Trust boosts on your profile, posts, and comments</li>
                <li>Non-profit, event, and civic organization pages</li>
                <li>Business slots with Stripe-powered billing seats</li>
                <li>Faster moderation plus hands-on verification</li>
              </ul>
              {summary ? (
                <div className="text-xs text-slate-500">
                  {premiumSince ? <p>Member since {premiumSince}</p> : null}
                  {premiumRenews ? <p>Renews {premiumRenews}</p> : null}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Loading membership details…</p>
              )}
              {isUnverifiedMember ? (
                <p className="text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <span>Verify to unlock the maple leaf beside your profile so people know you proudly support Canada.</span>
                    <Image src="/verified.png" alt="Verified maple badge" width={20} height={20} />
                  </span>
                </p>
              ) : null}
              {!stripeReady ? (
                <p className="text-xs font-semibold text-amber-600">Stripe billing is disabled in this workspace.</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 text-sm font-semibold text-slate-600">
              {premiumActive ? (
                <button
                  type="button"
                  onClick={handlePremiumPortal}
                  disabled={!stripeReady || pendingAction === 'premium-portal'}
                  className="rounded-full border border-slate-200 px-4 py-2 text-[var(--cc-primary)] transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingAction === 'premium-portal' ? 'Opening portal…' : 'Manage subscription'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePremiumCheckout}
                  disabled={!stripeReady || pendingAction === 'premium-checkout'}
                  className="rounded-full border border-[var(--cc-primary)] px-4 py-2 text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingAction === 'premium-checkout' ? 'Preparing checkout…' : 'Upgrade for $9.99/month'}
                </button>
              )}
              <button
                type="button"
                onClick={refreshBilling}
                disabled={loading}
                className="text-xs font-semibold text-slate-500 underline-offset-4 hover:underline disabled:opacity-50"
              >
                Refresh status
              </button>
            </div>
          </article>

          <article className="surface-card flex flex-col justify-between gap-4 px-6 py-5 shadow-subtle">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Business Membership</p>
              <h2 className="text-lg font-semibold text-slate-900">Business</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-500">
                <li>Post hiring calls, sponsors, and civic opportunities under your banner.</li>
                <li>Run non-profit outreach, town halls, and events with shared billing seats.</li>
                <li>
                  <span className="inline-flex items-center gap-2">
                    Unlock the gold verified badge for trusted organizations.
                    <Image src="/business.png" alt="Business verified badge" width={22} height={22} />
                  </span>
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <p>Seats included: {businessSeats}</p>
              <p>{businessUsage === '—' ? 'No seats in use yet.' : `${businessUsage} currently in use.`}</p>
              <p className="inline-flex items-center gap-2">
                Verified organizations display our gold civic badge
                <Image src="/business.png" alt="Gold badge" width={20} height={20} />
                so members know you support Canada.
              </p>
            </div>
            <div className="flex flex-col gap-2 text-sm font-semibold text-slate-600">
              <button
                type="button"
                onClick={handleBusinessCta}
                disabled={!premiumActive}
                className="rounded-full border border-[var(--cc-primary)] px-4 py-2 text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!premiumActive ? 'Upgrade to unlock' : hasBusinesses ? 'Manage organizations' : 'Create an organization'}
              </button>
              <p className="text-xs font-semibold text-slate-500">
                {!premiumActive
                  ? 'Premium membership is required before creating business pages.'
                  : hasBusinesses
                    ? 'Jump to the organizations you already manage.'
                    : 'We will guide you through verification and billing.'}
              </p>
            </div>
          </article>
        </section>

        {hasBusinesses ? (
          <section id="businesses" className="surface-card px-6 py-5 shadow-subtle">
            <header className="flex flex-col gap-2 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Business pages</p>
                <h2 className="text-lg font-semibold text-slate-900">Organizations you manage</h2>
                <p className="text-sm text-slate-500">Premium includes up to {businessSeats} business, non-profit, or event pages with billing seats.</p>
              </div>
              <div className="text-sm font-semibold text-slate-600">{businessUsage} in use</div>
            </header>

            {loading ? (
              <p className="py-6 text-sm text-slate-500">Loading businesses…</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {businesses.map((biz) => (
                  <div key={biz.id} className="py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{biz.name}</p>
                        <p className="text-xs text-slate-500">/@{biz.slug}</p>
                        {biz.description ? <p className="mt-1 text-sm text-slate-600">{biz.description}</p> : null}
                      </div>
                      <div className="flex flex-col gap-2 text-sm">
                        <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${BUSINESS_STATUS_BADGE[biz.status]}`}>
                          {BUSINESS_STATUS_LABEL[biz.status]}
                        </span>
                        {biz.stripeSubscriptionId ? (
                          <button
                            type="button"
                            onClick={() => handleBusinessPortal(biz.id)}
                            disabled={!stripeReady || pendingAction === `biz-portal-${biz.id}`}
                            className="rounded-full border border-slate-200 px-4 py-1 text-sm font-semibold text-[var(--cc-primary)] transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pendingAction === `biz-portal-${biz.id}` ? 'Opening portal…' : 'Manage subscription'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleBusinessCheckout(biz.id)}
                            disabled={!stripeReady || pendingAction === `biz-checkout-${biz.id}`}
                            className="rounded-full border border-[var(--cc-primary)] px-4 py-1 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pendingAction === `biz-checkout-${biz.id}` ? 'Preparing checkout…' : 'Activate $19.99/month'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {premiumActive ? (
          <section id="business-create" className="surface-card px-6 py-5 shadow-subtle">
            <div className="space-y-2 border-b border-slate-100 pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Organization setup</p>
              <h3 className="text-lg font-semibold text-slate-900">Create a new organization or event</h3>
              <p className="text-sm text-slate-500">
                Bring your civic organization, non-profit, or flagship event onto Civil to unlock hiring and sponsorship tools.
              </p>
            </div>
            {atBusinessLimit ? (
              <p className="mt-4 text-sm text-slate-500">You have reached your current organization limit.</p>
            ) : (
              <form onSubmit={handleCreateBusiness} className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Organization name
                  <input
                    type="text"
                    value={bizForm.name}
                    onChange={(event) => setBizForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    placeholder="Maple Ventures"
                    required
                    disabled={creatingBusiness}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  URL slug (optional)
                  <input
                    type="text"
                    value={bizForm.slug}
                    onChange={(event) => setBizForm((prev) => ({ ...prev, slug: event.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    placeholder="maple-ventures"
                    disabled={creatingBusiness}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Description (optional)
                  <textarea
                    value={bizForm.description}
                    onChange={(event) => setBizForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    rows={3}
                    placeholder="What does this organization do?"
                    disabled={creatingBusiness}
                  />
                </label>
                {bizError ? <p className="text-sm text-rose-600">{bizError}</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={creatingBusiness || !bizForm.name.trim()}
                    className="rounded-full border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {creatingBusiness ? 'Creating…' : 'Create organization'}
                  </button>
                  <p className="text-xs text-slate-500">We&apos;ll prompt you for billing once the page is ready.</p>
                </div>
              </form>
            )}
          </section>
        ) : null}
      </DashboardShell>
    </>
  )
}
