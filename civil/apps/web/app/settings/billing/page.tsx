"use client"

import Image from 'next/image'
import Link from 'next/link'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../../_components/Sidebar'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import { buildApiUrl } from '../../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../../_lib/me'
import DashboardShell from '../../_components/DashboardShell'
import { CheckoutModal, type CheckoutSessionConfig } from './CheckoutModal'
import { ManageSubscriptionModal } from './ManageSubscriptionModal'

const DEFAULT_RETURN_URL = 'https://app.civilcitizens.dev/settings/billing'

type BillingProfile = {
  firstName: string
  lastName: string
  companyName: string
  email: string
  phone: string
  country: string
  state: string
  city: string
  address1: string
  address2: string
  postalCode: string
  taxId: string
  notes: string
}

type BillingSummary = {
  stripeEnabled: boolean
  premiumStatus: string
  isPremium: boolean
  premiumSince: string | null
  premiumRenewsAt: string | null
  businessCount: number
  businessLimit: number
  billingProfile: BillingProfile
  billingProfileComplete: boolean
  billingProfileMissing: Array<keyof BillingProfile>
}

const EMPTY_BILLING_PROFILE: BillingProfile = {
  firstName: '',
  lastName: '',
  companyName: '',
  email: '',
  phone: '',
  country: 'CA',
  state: '',
  city: '',
  address1: '',
  address2: '',
  postalCode: '',
  taxId: '',
  notes: '',
}

const BILLING_REQUIRED_FIELDS: Array<keyof BillingProfile> = [
  'firstName',
  'lastName',
  'email',
  'country',
  'state',
  'city',
  'address1',
  'postalCode',
]

const COUNTRY_OPTIONS = [
  { code: 'CA', label: 'Canada' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
]

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

function formatMonthYear(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
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
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSessionConfig | null>(null)
  const [manageModalOpen, setManageModalOpen] = useState(false)
  const [profileForm, setProfileForm] = useState<BillingProfile>(EMPTY_BILLING_PROFILE)
  const [profileDirty, setProfileDirty] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true)

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
      if (res.status === 401 || res.status === 403) {
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
      if (res.status === 401 || res.status === 403) {
        handleUnauthorized()
        return null
      }
      if (res.status === 404) {
        // Some environments may not ship the businesses API yet.
        setBusinesses([])
        return []
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
        setToken(storedToken)

        // Best-effort viewer fetch: don't block billing data on transient /auth/me issues.
        try {
          const res = await fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${storedToken}` } })
          if (res.status === 401 || res.status === 403) {
            handleUnauthorized()
            return
          }
          if (res.ok) {
            const data: MeResponse = await res.json()
            if (!hasHomeCommunity(data)) {
              window.location.replace('/welcome')
              return
            }
            if (!cancelled) {
              setMe(data)
            }
          } else {
            console.warn('Billing bootstrap: /auth/me failed', { status: res.status })
          }
        } catch (err) {
          console.warn('Billing bootstrap: /auth/me request failed', err)
        }

        const nextSummary = await loadSummary(storedToken)
        if (!nextSummary) return

        // Avoid calling /businesses unless there are businesses to load.
        if (nextSummary.businessCount > 0) {
          await loadBusinesses(storedToken)
        } else {
          setBusinesses([])
        }
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

  useEffect(() => {
    if (!summary?.billingProfile || profileDirty) {
      return
    }
    setProfileForm({
      ...EMPTY_BILLING_PROFILE,
      ...summary.billingProfile,
      country: summary.billingProfile.country || 'CA',
    })
  }, [profileDirty, summary])

  const refreshBilling = useCallback(async () => {
    if (!token) return
    try {
      const nextSummary = await loadSummary(token)
      if (!nextSummary) return

      if (nextSummary.businessCount > 0) {
        await loadBusinesses(token)
      } else {
        setBusinesses([])
      }
    } catch (err) {
      console.error('Unable to refresh billing', err)
    }
  }, [loadBusinesses, loadSummary, token])

  const scrollToBillingProfile = useCallback(() => {
    if (typeof document === 'undefined') return
    const section = document.getElementById('billing-profile')
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleProfileFieldChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const field = event.target.name as keyof BillingProfile
      const value = event.target.value
      setProfileForm((prev) => ({
        ...prev,
        [field]: value,
      }))
      setProfileDirty(true)
      setProfileError(null)
    },
    [],
  )

  const handleProfileSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!token) {
        handleUnauthorized()
        return
      }
      setProfileSaving(true)
      setProfileError(null)
      try {
        const payload = {
          ...profileForm,
          country: profileForm.country.trim().toUpperCase(),
        }
        const res = await fetch(buildApiUrl('/billing/profile'), {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => null)
        if (res.status === 401 || res.status === 403) {
          handleUnauthorized()
          return
        }
        if (!res.ok || !data?.profile) {
          const message = typeof data?.error === 'string' ? data.error : 'Unable to save billing details.'
          setProfileError(message)
          return
        }
        setProfileForm({
          ...EMPTY_BILLING_PROFILE,
          ...data.profile,
        })
        setProfileDirty(false)
        setSummary((prev) =>
          prev
            ? {
                ...prev,
                billingProfile: data.profile,
                billingProfileComplete: Boolean(data.complete),
                billingProfileMissing: Array.isArray(data.missingFields) ? data.missingFields : [],
              }
            : prev,
        )
        pushToast('Billing details saved.', 'success', 5000)
      } catch (err) {
        console.error('Unable to save billing profile', err)
        setProfileError('Unable to save billing details. Please try again.')
      } finally {
        setProfileSaving(false)
      }
    },
    [handleUnauthorized, profileForm, token],
  )

  const handleProfileReset = useCallback(() => {
    const source = summary?.billingProfile ?? EMPTY_BILLING_PROFILE
    setProfileForm({
      ...EMPTY_BILLING_PROFILE,
      ...source,
    })
    setProfileDirty(false)
    setProfileError(null)
  }, [summary])

  const handleShippingToggle = useCallback(() => {
    setShippingSameAsBilling((prev) => !prev)
  }, [])

  const startCheckout = useCallback(
    async (mode: 'premium' | 'business', business?: BusinessSummary | null) => {
      if (!token) return
      if (!summary?.stripeEnabled) {
        pushToast('Billing is not available in this environment.', 'warning', 5000)
        return
      }

      const actionKey = mode === 'premium' ? 'premium-checkout' : `biz-checkout-${business?.id ?? 'unknown'}`
      try {
        setPendingAction(actionKey)
        const res = await fetch(buildApiUrl('/billing/setup-intent'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(business ? { businessId: business.id } : {}),
        })
        const payload = (await res.json().catch(() => null)) as {
          clientSecret?: string | null
          publishableKey?: string | null
          error?: string
        } | null
        if (res.status === 401 || res.status === 403) {
          handleUnauthorized()
          return
        }
        if (!res.ok) {
          if (payload?.error === 'billing_profile_incomplete') {
            pushToast('Add your billing information before continuing to checkout.', 'warning', 6000)
            scrollToBillingProfile()
            return
          }
          const message = typeof payload?.error === 'string' ? payload.error : 'Unable to prepare checkout.'
          pushToast(message, 'error', 6000)
          return
        }
        if (!payload?.clientSecret || !payload?.publishableKey) {
          pushToast('Stripe did not return a checkout client secret.', 'error', 6000)
          return
        }
        setCheckoutSession({
          mode,
          business: business ? { id: business.id, name: business.name } : null,
          clientSecret: payload.clientSecret,
          publishableKey: payload.publishableKey,
        })
      } catch (err) {
        console.error('Unable to start checkout', err)
        pushToast('Unable to start checkout. Please try again.', 'error', 6000)
      } finally {
        setPendingAction(null)
      }
    },
    [handleUnauthorized, summary?.stripeEnabled, token, scrollToBillingProfile],
  )

  const handleCheckoutComplete = useCallback(async () => {
    await refreshBilling()
    setCheckoutSession(null)
  }, [refreshBilling])

  const handlePremiumCheckout = useCallback(() => {
    if (!summary?.billingProfileComplete) {
      pushToast('Add your billing information before upgrading.', 'warning', 5000)
      scrollToBillingProfile()
      return
    }
    void startCheckout('premium', null)
  }, [scrollToBillingProfile, startCheckout, summary?.billingProfileComplete])

  const handlePremiumManage = useCallback(() => {
    if (!token) {
      handleUnauthorized()
      return
    }
    if (!summary?.isPremium) {
      pushToast('Activate premium before managing your subscription.', 'warning', 5000)
      return
    }
    setManageModalOpen(true)
  }, [handleUnauthorized, summary?.isPremium, token])

  const handleManageComplete = useCallback(async () => {
    await refreshBilling()
    setManageModalOpen(false)
  }, [refreshBilling])

  const handleBusinessCheckout = useCallback(
    (business: BusinessSummary) => {
      if (!summary?.billingProfileComplete) {
        pushToast('Add your billing information before activating an organization.', 'warning', 5000)
        scrollToBillingProfile()
        return
      }
      void startCheckout('business', business)
    },
    [scrollToBillingProfile, startCheckout, summary?.billingProfileComplete],
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
        if (res.status === 401 || res.status === 403) {
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
        if (res.status === 401 || res.status === 403) {
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
  const billingComplete = summary?.billingProfileComplete ?? false
  const computedProfileMissing = useMemo(() => {
    return BILLING_REQUIRED_FIELDS.filter((field) => !profileForm[field]?.trim())
  }, [profileForm])
  const activeMissingFields = useMemo(() => {
    const source = profileDirty ? computedProfileMissing : summary?.billingProfileMissing ?? []
    return new Set(source)
  }, [computedProfileMissing, profileDirty, summary?.billingProfileMissing])
  const profileSaveDisabled = profileSaving || !profileDirty || activeMissingFields.size > 0
  const billingStatusBadge = billingComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
  const billingStatusLabel = billingComplete ? 'Complete' : 'Needs info'
  const billingStatusMessage = profileDirty
    ? 'Save your edits to keep billing info current.'
    : billingComplete
      ? 'Your billing profile is ready for checkout.'
      : 'Complete these required details before upgrading.'
  const billingInputClass = (field: keyof BillingProfile) =>
    `mt-1 w-full rounded border px-3 py-2 text-sm focus:outline-none ${activeMissingFields.has(field) ? 'border-rose-300 focus:border-rose-500' : 'border-slate-200 focus:border-[var(--cc-primary)]'}`
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
        <div>
          <Link href="/settings" className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">
            Back
          </Link>
        </div>
        <section id="billing-profile" className="surface-card px-6 py-5 shadow-subtle">
          <header className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Billing information</p>
              <h1 className="text-lg font-semibold text-slate-900">Billing details</h1>
              <p className="text-sm text-slate-500">{billingStatusMessage}</p>
            </div>
            <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${billingStatusBadge}`}>
              {billingStatusLabel}
            </span>
          </header>

          <form onSubmit={handleProfileSubmit} className="mt-4 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                First name
                <input
                  type="text"
                  name="firstName"
                  value={profileForm.firstName}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('firstName')}
                  placeholder="Alex"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Last name
                <input
                  type="text"
                  name="lastName"
                  value={profileForm.lastName}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('lastName')}
                  placeholder="Laurent"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Company (optional)
                <input
                  type="text"
                  name="companyName"
                  value={profileForm.companyName}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('companyName')}
                  placeholder="Maple Ventures"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Billing email
                <input
                  type="email"
                  name="email"
                  value={profileForm.email}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('email')}
                  placeholder="billing@maple.com"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Phone (optional)
                <input
                  type="tel"
                  name="phone"
                  value={profileForm.phone}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('phone')}
                  placeholder="+1 416 555 1234"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Country
                <select
                  name="country"
                  value={profileForm.country}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('country')}
                  required
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Province / State
                <input
                  type="text"
                  name="state"
                  value={profileForm.state}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('state')}
                  placeholder="Ontario"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                City
                <input
                  type="text"
                  name="city"
                  value={profileForm.city}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('city')}
                  placeholder="Toronto"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Address line 1
                <input
                  type="text"
                  name="address1"
                  value={profileForm.address1}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('address1')}
                  placeholder="123 King Street W"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Address line 2 (optional)
                <input
                  type="text"
                  name="address2"
                  value={profileForm.address2}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('address2')}
                  placeholder="Suite 1200"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Postal / ZIP code
                <input
                  type="text"
                  name="postalCode"
                  value={profileForm.postalCode}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('postalCode')}
                  placeholder="M5H 2N2"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Tax ID (optional)
                <input
                  type="text"
                  name="taxId"
                  value={profileForm.taxId}
                  onChange={handleProfileFieldChange}
                  className={billingInputClass('taxId')}
                  placeholder="BN 12345"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Notes for invoices (optional)
                <textarea
                  name="notes"
                  value={profileForm.notes}
                  onChange={handleProfileFieldChange}
                  className={`${billingInputClass('notes')} min-h-[80px] resize-y`}
                  placeholder="PO numbers, internal cost centres, or reminders for your finance team."
                />
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={shippingSameAsBilling}
                  onChange={handleShippingToggle}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                />
                Shipping matches billing
              </label>
              <p className="mt-2 text-xs text-slate-500">
                Shipping addresses are coming soon. Toggle this if you want a reminder that merch or fulfillment should use a different
                destination later.
              </p>
            </div>

            {profileError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{profileError}</p> : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={profileSaveDisabled}
                className="rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {profileSaving ? 'Saving…' : profileDirty ? 'Save billing details' : 'Billing saved'}
              </button>
              <button
                type="button"
                onClick={handleProfileReset}
                disabled={profileSaving || !profileDirty}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset
              </button>
              <p className="text-xs text-slate-500">
                {activeMissingFields.size
                  ? 'Fill the highlighted fields to continue.'
                  : profileDirty
                    ? 'Save to sync billing with Stripe before checkout.'
                    : 'We will reuse these details for every premium or business checkout.'}
              </p>
            </div>
          </form>
        </section>

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
                  onClick={handlePremiumManage}
                  className="rounded-full border border-slate-200 px-4 py-2 text-[var(--cc-primary)] transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Manage subscription
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
                            onClick={() => handleBusinessCheckout(biz)}
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
        {checkoutSession && token ? (
          <CheckoutModal
            session={checkoutSession}
            token={token}
            me={me}
            billingProfile={summary?.billingProfile}
            onClose={() => setCheckoutSession(null)}
            onComplete={handleCheckoutComplete}
          />
        ) : null}
        {manageModalOpen && summary && token ? (
          <ManageSubscriptionModal
            open={manageModalOpen}
            token={token}
            summary={{
              premiumStatus: summary.premiumStatus,
              premiumSince: summary.premiumSince,
              premiumRenewsAt: summary.premiumRenewsAt,
              isPremium: summary.isPremium,
            }}
            onClose={() => setManageModalOpen(false)}
            onUpdated={handleManageComplete}
          />
        ) : null}
      </DashboardShell>
    </>
  )
}
