'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import DashboardShell from '../_components/DashboardShell'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import {
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineCube,
  HiOutlineMapPin,
  HiOutlineShieldCheck,
  HiOutlineTruck,
  HiOutlineUserGroup,
} from 'react-icons/hi2'
import {
  DELIVERY_BID_OPTIONS,
  formatContractStatus,
  formatDistance,
  formatMoney,
  getDeliveryRequirementItems,
  type DeliveryDriverContract,
  type DeliveryOnboardingResponse,
  type DeliveryOpenContract,
} from './deliveryShared'
import { DriveRideRequestsRail, DriveRideRequestsSection } from './DriveRideRequestsSection'

type OpenContractsResponse = {
  items?: DeliveryOpenContract[]
}

type DriverContractsResponse = {
  items?: DeliveryDriverContract[]
}

type DriveStat = {
  id: string
  label: string
  value: string
  note: string
  toneClassName: string
}

type DriveSection = 'rides' | 'delivery' | 'drivers'

function normalizeDriveSection(value: string | null | undefined): DriveSection {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'rides') return 'rides'
  if (normalized === 'drivers') return 'drivers'
  return 'delivery'
}

function resolveDriveSectionHref(pathname: string, searchParams: URLSearchParams, section: DriveSection) {
  const nextParams = new URLSearchParams(searchParams.toString())
  if (section === 'delivery') nextParams.delete('section')
  else nextParams.set('section', section)
  const query = nextParams.toString()
  return query ? `${pathname}?${query}` : pathname
}

function DriveSectionButton({
  active,
  href,
  icon: Icon,
  label,
}: {
  active: boolean
  href: string
  icon: typeof HiOutlineCalendarDays
  label: string
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${active ? 'bg-slate-950 text-white hover:opacity-90' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  )
}

function DriveComingSoonRail() {
  return (
    <div className="space-y-5 xl:sticky xl:top-8">
      <section className="overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-sm font-semibold text-white/92">Drivers Near Me</p>
        </div>
        <div className="space-y-3 p-4 text-sm text-white/80">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-3">This section is reserved for nearby-driver discovery once the backend feed exists.</div>
        </div>
      </section>
    </div>
  )
}

function BidButton({ amountCents, disabled, busy, onClick }: { amountCents: number; disabled: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? 'Sending…' : formatMoney(amountCents)}
    </button>
  )
}

function DriveStatCard({ stat }: { stat: DriveStat }) {
  return (
    <article className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{stat.label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</p>
          <p className="mt-1 text-sm text-slate-500">{stat.note}</p>
        </div>
        <span className={`mt-1 inline-flex h-2.5 w-2.5 rounded-full ${stat.toneClassName}`} />
      </div>
    </article>
  )
}

function DriveDashboardRail({
  onboarding,
  openContractCount,
  activeDeliveryCount,
  pendingBidCount,
  queue,
  unmetRequirements,
}: {
  onboarding: DeliveryOnboardingResponse | null
  openContractCount: number
  activeDeliveryCount: number
  pendingBidCount: number
  queue: DeliveryDriverContract[]
  unmetRequirements: Array<{ key: string; label: string; met: boolean }>
}) {
  const isActive = onboarding?.active === true
  const driverActionHref = isActive ? '/drive/driver/manage' : '/drive/onboarding'
  const driverActionLabel = isActive ? 'Manage Driver Account' : 'Become a Civil Driver'

  return (
    <div className="space-y-5 xl:sticky xl:top-8">
      <section className="overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        <div className="border-b border-white/10 px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-white/92">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--cc-primary)]" />
            Quick Actions
          </p>
        </div>
        <div className="space-y-3 p-4">
          <Link href="/market" className="flex items-center justify-between rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-3.5 transition hover:bg-emerald-100">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                <HiOutlineCube className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-emerald-700">Request a Delivery</p>
                <p className="text-xs text-emerald-600">Open Market and choose delivery for an item</p>
              </div>
            </div>
          </Link>

          <Link href="/delivery/my" className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3.5 transition hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 shadow-sm">
                <HiOutlineTruck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">My Deliveries</p>
                <p className="text-xs text-slate-500">Track assigned contracts, ETAs, and proof</p>
              </div>
            </div>
          </Link>

          <Link href={driverActionHref} className="flex items-center justify-between rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-3.5 transition hover:bg-sky-100">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm">
                <HiOutlineShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-sky-700">{driverActionLabel}</p>
                <p className="text-xs text-sky-600">{isActive ? 'Your driver account is active' : 'Finish verification and setup requirements'}</p>
              </div>
            </div>
          </Link>
        </div>
      </section>

      <section className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Drive Pulse</p>
            <p className="mt-1 text-sm text-slate-500">A snapshot of your live delivery activity.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {isActive ? `${openContractCount} open` : 'setup'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Driver status</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{isActive ? 'Active and ready' : 'Onboarding needed'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Open contracts</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{isActive ? `${openContractCount} available nearby` : 'Available after activation'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Bid pending</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{isActive ? `${pendingBidCount} awaiting buyer response` : 'No bidding until active'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Your deliveries</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{isActive ? `${activeDeliveryCount} active contracts` : 'No assigned contracts yet'}</p>
          </div>
        </div>
      </section>

      {!isActive && unmetRequirements.length ? (
        <section className="rounded-[1.9rem] border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div>
            <p className="text-lg font-semibold text-amber-950">Activation Checklist</p>
            <p className="mt-1 text-sm text-amber-900">Complete these items to unlock bidding.</p>
          </div>
          <ul className="mt-4 space-y-3">
            {unmetRequirements.map((item) => (
              <li key={item.key} className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900">
                {item.label}
              </li>
            ))}
          </ul>
          <Link href="/drive/onboarding" className="mt-4 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
            Open onboarding
          </Link>
        </section>
      ) : null}

      {isActive ? (
        <section className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">Your Drive Queue</p>
              <p className="mt-1 text-sm text-slate-500">Recent contracts assigned to you.</p>
            </div>
            <Link href="/delivery/my" className="text-sm font-semibold text-slate-600 transition hover:text-[var(--cc-primary)]">
              View All
            </Link>
          </div>
          {queue.length ? (
            <ul className="mt-4 space-y-3">
              {queue.map((entry) => (
                <li key={entry.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{entry.listingTitle}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{formatContractStatus(entry.status)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No assigned deliveries yet.</p>
          )}
        </section>
      ) : null}
    </div>
  )
}

export default function DeliveryContractsPageClient() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<DeliveryOpenContract[]>([])
  const [myContracts, setMyContracts] = useState<DeliveryDriverContract[]>([])
  const [onboarding, setOnboarding] = useState<DeliveryOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittingBid, setSubmittingBid] = useState<{ contractId: string; amountCents: number } | null>(null)

  const activeSection = useMemo(() => normalizeDriveSection(searchParams.get('section')), [searchParams])

  const updateSection = useCallback(
    (section: DriveSection) => {
      const href = resolveDriveSectionHref(pathname, new URLSearchParams(searchParams.toString()), section)
      router.replace(href, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const loadDriveData = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const onboardingRes = await fetch(buildApiUrl('/drive/onboarding'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      const onboardingPayload = (await onboardingRes.json().catch(() => null)) as (DeliveryOnboardingResponse & { error?: string }) | null

      if (onboardingRes.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!onboardingRes.ok) {
        setError('Unable to load your driver account right now.')
        setOnboarding(null)
        setContracts([])
        setMyContracts([])
        return
      }

      const onboardingState: DeliveryOnboardingResponse = {
        active: onboardingPayload?.active === true,
        activeAt: onboardingPayload?.activeAt ?? null,
        requirements: onboardingPayload?.requirements ?? null,
      }
      setOnboarding(onboardingState)

      if (!onboardingState.active) {
        setContracts([])
        setMyContracts([])
        return
      }

      const [openRes, myRes] = await Promise.all([
        fetch(buildApiUrl('/delivery/contracts/open'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(buildApiUrl('/delivery/contracts/my'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ])

      const openPayload = (await openRes.json().catch(() => null)) as (OpenContractsResponse & { error?: string }) | null
      const myPayload = (await myRes.json().catch(() => null)) as (DriverContractsResponse & { error?: string }) | null

      if (openRes.status === 401 || myRes.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!openRes.ok) {
        setError('Unable to load delivery contracts right now.')
        setContracts([])
      } else {
        setContracts(Array.isArray(openPayload?.items) ? openPayload.items : [])
      }

      if (!myRes.ok) {
        setError((current) => current ?? 'Unable to load your delivery activity right now.')
        setMyContracts([])
      } else {
        setMyContracts(Array.isArray(myPayload?.items) ? myPayload.items : [])
      }
    } catch (err) {
      console.error('Failed to load drive data', err)
      setError('Unable to load Drive right now.')
      setContracts([])
      setMyContracts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'delivery') {
      setLoading(false)
      return
    }
    void loadDriveData()
  }, [activeSection, loadDriveData])

  const handleBid = useCallback(
    async (contractId: string, amountCents: number) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setSubmittingBid({ contractId, amountCents })
      try {
        const res = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(contractId)}/bid`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ amountCents }),
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to submit that bid right now.', 'error')
          return
        }

        pushToast('Delivery bid sent to the buyer.', 'success')
        setContracts((prev) =>
          prev.map((contract) =>
            contract.id === contractId
              ? { ...contract, status: 'bid_pending', bidPending: true, bidAmountCents: amountCents }
              : contract,
          ),
        )
      } catch (err) {
        console.error('Failed to submit delivery bid', err)
        pushToast('Unable to submit that bid right now.', 'error')
      } finally {
        setSubmittingBid(null)
      }
    },
    [],
  )

  const requirementItems = getDeliveryRequirementItems(onboarding?.requirements)
  const unmetRequirements = requirementItems.filter((item) => !item.met)
  const activeMyContracts = useMemo(
    () => myContracts.filter((entry) => entry.status !== 'delivered' && entry.status !== 'rejected'),
    [myContracts],
  )
  const pendingBidCount = useMemo(() => contracts.filter((entry) => entry.bidPending).length, [contracts])

  const filteredContracts = useMemo(() => {
    return contracts
  }, [contracts])

  const stats = useMemo<DriveStat[]>(() => {
    const driverActive = onboarding?.active === true
    return [
      {
        id: 'open-contracts',
        label: 'Open Contracts',
        value: driverActive ? String(filteredContracts.length) : 'Locked',
        note: driverActive ? 'Live contracts in the current filter' : 'Activate your driver account to browse contracts',
        toneClassName: 'bg-emerald-500',
      },
      {
        id: 'pending-bids',
        label: 'Bid Pending',
        value: driverActive ? String(pendingBidCount) : 'Locked',
        note: driverActive ? 'Buyer responses you are waiting on' : 'Bidding unlocks after activation',
        toneClassName: 'bg-amber-500',
      },
      {
        id: 'active-deliveries',
        label: 'Your Deliveries',
        value: driverActive ? String(activeMyContracts.length) : '0',
        note: driverActive ? 'Assigned contracts in progress' : 'Assigned work appears here once you are active',
        toneClassName: 'bg-sky-500',
      },
      {
        id: 'driver-status',
        label: 'Driver Status',
        value: driverActive ? 'Active' : 'Pending',
        note: driverActive ? 'Your account can bid on delivery work' : 'Finish the checklist to unlock Drive',
        toneClassName: 'bg-slate-400',
      },
    ]
  }, [activeMyContracts.length, filteredContracts.length, onboarding?.active, pendingBidCount])

  return (
    <DashboardShell
      rightRail={
        activeSection === 'rides' ? (
          <DriveRideRequestsRail />
        ) : activeSection === 'drivers' ? (
          <DriveComingSoonRail />
        ) : (
          <DriveDashboardRail
            onboarding={onboarding}
            openContractCount={contracts.length}
            activeDeliveryCount={activeMyContracts.length}
            pendingBidCount={pendingBidCount}
            queue={activeMyContracts.slice(0, 3)}
            unmetRequirements={unmetRequirements}
          />
        )
      }
      showMobileRightRail
      mainClassName="space-y-6 pb-12"
      rightRailClassName="pb-12"
    >
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(254,242,242,0.95),rgba(255,255,255,0.98)_38%,rgba(239,246,255,0.98)_100%)] p-5 shadow-[0_20px_70px_rgba(15,23,42,0.08)] sm:p-7">
          <div className="flex flex-wrap gap-2">
            <DriveSectionButton
              active={activeSection === 'rides'}
              href={resolveDriveSectionHref(pathname, new URLSearchParams(searchParams.toString()), 'rides')}
              icon={HiOutlineCalendarDays}
              label="Ride Request"
            />
            <DriveSectionButton
              active={activeSection === 'delivery'}
              href={resolveDriveSectionHref(pathname, new URLSearchParams(searchParams.toString()), 'delivery')}
              icon={HiOutlineCube}
              label="Delivery Requests"
            />
            <DriveSectionButton
              active={activeSection === 'drivers'}
              href={resolveDriveSectionHref(pathname, new URLSearchParams(searchParams.toString()), 'drivers')}
              icon={HiOutlineUserGroup}
              label="Drivers near me"
            />
          </div>
        </section>

        {activeSection === 'rides' ? <DriveRideRequestsSection /> : null}

        {activeSection === 'drivers' ? (
          <section className="rounded-[1.9rem] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-950">Drivers near me</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">This section stays reserved until the nearby-driver discovery API exists. Ride Requests and Delivery Requests are the live Drive surfaces right now.</p>
            <button
              type="button"
              onClick={() => updateSection('rides')}
              className="mt-4 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Open Ride Requests
            </button>
          </section>
        ) : null}

        {activeSection === 'delivery' ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {stats.map((stat) => (
                <DriveStatCard key={stat.id} stat={stat} />
              ))}
            </section>

            {onboarding && onboarding.active !== true ? (
              <section className="rounded-[1.8rem] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,1),rgba(255,247,237,0.88))] p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Driver onboarding</p>
                    <h2 className="mt-2 text-2xl font-semibold text-amber-950">Finish activating your Civil Driver account</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-amber-900">Your Drive page is now live, but open contracts and bidding stay locked until every requirement is complete.</p>
                  </div>
                  <Link href="/drive/onboarding" className="inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
                    Open onboarding
                  </Link>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {requirementItems.map((item) => (
                    <div key={item.key} className={`rounded-2xl border px-4 py-3 text-sm ${item.met ? 'border-emerald-200 bg-white text-emerald-800' : 'border-amber-200 bg-white text-amber-900'}`}>
                      <span className="font-semibold">{item.met ? 'Ready' : 'Needed'}</span>
                      <p className="mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-950">Delivery Requests</h2>
                  <p className="mt-1 text-sm text-slate-500">Live contracts from the current delivery API, sorted and filtered for Drive.</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {onboarding?.active ? `${contracts.length} open` : 'activation required'}
                </span>
              </div>

              {loading ? <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading Drive…</div> : null}

              {!loading && onboarding?.active !== true ? (
                <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Activate your driver account to unlock live delivery contracts and bidding.</div>
              ) : null}

              {!loading && onboarding?.active ? (
                filteredContracts.length ? (
                  filteredContracts.map((contract) => {
                    const bidLocked = contract.bidPending
                    const locationLabel = [contract.pickupCity, contract.pickupProvince].filter(Boolean).join(', ')
                    return (
                      <article key={contract.id} className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                          <div className="flex min-w-0 gap-4">
                            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                              {contract.listingPhotoUrl ? (
                                <img src={contract.listingPhotoUrl} alt={contract.listingTitle} className="h-full w-full object-cover" />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center text-slate-400">
                                  <HiOutlineTruck className="h-7 w-7" />
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-xl font-semibold text-slate-900">{contract.listingTitle}</h3>
                                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${contract.bidPending ? 'border-amber-200 bg-amber-50 text-amber-800' : typeof contract.distanceKm === 'number' && contract.distanceKm <= 8 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                  {contract.bidPending && contract.bidAmountCents ? `Bid pending at ${formatMoney(contract.bidAmountCents)}` : typeof contract.distanceKm === 'number' && contract.distanceKm <= 8 ? 'Recommended' : 'Open for bids'}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                                <span className="inline-flex items-center gap-1.5"><HiOutlineClock className="h-4 w-4" />{contract.bidPending ? 'Waiting for buyer approval' : 'Ready for bids'}</span>
                                <span className="inline-flex items-center gap-1.5"><HiOutlineMapPin className="h-4 w-4" />{locationLabel || 'Location available after assignment'}</span>
                                <span className="inline-flex items-center gap-1.5"><HiOutlineTruck className="h-4 w-4" />{formatDistance(contract.distanceKm)}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {contract.itemTraits.length ? contract.itemTraits.map((trait) => <span key={trait} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{trait}</span>) : <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">No handling notes</span>}
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-600">{contract.pickupInstructions?.trim() || 'Pickup notes will appear here when the buyer provides them.'}</p>
                            </div>
                          </div>

                          <div className="w-full max-w-full xl:max-w-sm xl:text-right">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Bid from</p>
                            <p className="mt-1 text-3xl font-semibold text-slate-950">{formatMoney(DELIVERY_BID_OPTIONS[0])}</p>
                            <p className="mt-1 text-sm text-slate-500">Buyer: {contract.buyer.name ?? contract.buyer.handle ?? 'Civil citizen'} · Seller: {contract.seller.name ?? contract.seller.handle ?? 'Civil citizen'}</p>
                            <div className="mt-4 flex flex-wrap gap-2 xl:justify-end">
                              {DELIVERY_BID_OPTIONS.map((amountCents) => (
                                <BidButton
                                  key={amountCents}
                                  amountCents={amountCents}
                                  disabled={bidLocked}
                                  busy={submittingBid?.contractId === contract.id && submittingBid.amountCents === amountCents}
                                  onClick={() => void handleBid(contract.id, amountCents)}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  })
                ) : (
                  <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No delivery contracts match this search right now.</div>
                )
              ) : null}
            </section>

            {onboarding?.active ? (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-950">Your Active Deliveries</h2>
                    <p className="mt-1 text-sm text-slate-500">Assigned contracts currently in your queue.</p>
                  </div>
                  <Link href="/delivery/my" className="text-sm font-semibold text-slate-600 transition hover:text-[var(--cc-primary)]">
                    Open My Deliveries
                  </Link>
                </div>

                {activeMyContracts.length ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {activeMyContracts.slice(0, 4).map((entry) => (
                      <article key={entry.id} className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                            {entry.listingPhotoUrl ? <img src={entry.listingPhotoUrl} alt={entry.listingTitle} className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-lg font-semibold text-slate-900">{entry.listingTitle}</h3>
                            <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{formatContractStatus(entry.status)}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
                          {entry.bidAmountCents ? <span className="inline-flex items-center gap-1.5"><HiOutlineTruck className="h-4 w-4" />{formatMoney(entry.bidAmountCents)}</span> : null}
                          <span className="inline-flex items-center gap-1.5"><HiOutlineMapPin className="h-4 w-4" />{[entry.pickupCity, entry.pickupProvince].filter(Boolean).join(', ') || 'Pickup on file'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">You do not have any active deliveries yet.</div>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </DashboardShell>
  )
}
