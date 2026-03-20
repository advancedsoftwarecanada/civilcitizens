'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import CivilCard from '../_components/CivilCard'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { DELIVERY_BID_OPTIONS, formatContractStatus, formatDistance, formatMoney, formatParticipantName, getDeliveryRequirementItems, type DeliveryOnboardingResponse, type DeliveryOpenContract } from './deliveryShared'

type OpenContractsResponse = {
  items?: DeliveryOpenContract[]
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

export default function DeliveryContractsPageClient() {
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<DeliveryOpenContract[]>([])
  const [onboarding, setOnboarding] = useState<DeliveryOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittingBid, setSubmittingBid] = useState<{ contractId: string; amountCents: number } | null>(null)

  const loadContracts = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/delivery/contracts/open'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      const payload = (await res.json().catch(() => null)) as (OpenContractsResponse & { error?: string; onboarding?: DeliveryOnboardingResponse }) | null

      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (res.status === 403 && payload?.error === 'driver_not_active') {
        setOnboarding(payload.onboarding ?? null)
        setContracts([])
        return
      }

      if (!res.ok) {
        setError('Unable to load delivery contracts right now.')
        setContracts([])
        return
      }

      setOnboarding(null)
      setContracts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (err) {
      console.error('Failed to load delivery contracts', err)
      setError('Unable to load delivery contracts right now.')
      setContracts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadContracts()
  }, [loadContracts])

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

  return (
    <DashboardShell rightRail={<RightRail mode="work" organizationLinkTarget="chat" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Civil Delivery</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-slate-900">Open Driver Contracts</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Review nearby buyer-selected contracts, place a flat bid, and get added to a shared buyer-seller delivery chat when your bid is accepted.</p>
            </div>
            <Link href="/delivery/my" className="inline-flex rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
              My deliveries
            </Link>
          </div>
        </section>

        {onboarding ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-amber-950">Activate your Civil Driver account first</h2>
            <p className="mt-2 text-sm text-amber-900">You need to complete every requirement below before you can bid on delivery contracts.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {requirementItems.map((item) => (
                <div key={item.key} className={`rounded-2xl border px-4 py-3 text-sm ${item.met ? 'border-emerald-200 bg-white text-emerald-800' : 'border-amber-200 bg-white text-amber-900'}`}>
                  <span className="font-semibold">{item.met ? 'Ready' : 'Needed'}</span>
                  <p className="mt-1">{item.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <Link href="/delivery/onboarding" className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95">
                Open onboarding
              </Link>
            </div>
          </section>
        ) : null}

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Loading delivery contracts…</div>
        ) : null}

        {!loading && !onboarding ? (
          <section className="space-y-4">
            {contracts.length ? (
              contracts.map((contract) => {
                const bidLocked = contract.bidPending
                return (
                  <article key={contract.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="grid gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
                      <div className="relative min-h-48 bg-slate-100">
                        {contract.listingPhotoUrl ? <img src={contract.listingPhotoUrl} alt={contract.listingTitle} className="absolute inset-0 h-full w-full object-cover" /> : null}
                      </div>

                      <div className="space-y-5 p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{formatContractStatus(contract.status)}</p>
                            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{contract.listingTitle}</h2>
                            <p className="mt-2 text-sm text-slate-600">{formatDistance(contract.distanceKm)}{contract.pickupCity || contract.pickupProvince ? ` • ${[contract.pickupCity, contract.pickupProvince].filter(Boolean).join(', ')}` : ''}</p>
                          </div>
                          {contract.bidPending && contract.bidAmountCents ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Bid pending at {formatMoney(contract.bidAmountCents)}</span> : null}
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Seller</p>
                              <div className="mt-2">
                                <CivilCard size="rail" name={formatParticipantName(contract.seller)} avatarAlt={formatParticipantName(contract.seller)} avatarInitials={formatParticipantName(contract.seller)} avatarSrc={contract.seller.avatarUrl} />
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Buyer</p>
                              <div className="mt-2">
                                <CivilCard size="rail" name={formatParticipantName(contract.buyer)} avatarAlt={formatParticipantName(contract.buyer)} avatarInitials={formatParticipantName(contract.buyer)} avatarSrc={contract.buyer.avatarUrl} />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Pickup instructions</p>
                              <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{contract.pickupInstructions?.trim() || 'No extra pickup notes were supplied.'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Item traits</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {contract.itemTraits.length ? contract.itemTraits.map((trait) => <span key={trait} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">{trait}</span>) : <span className="text-sm text-slate-500">No special handling notes.</span>}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Place your bid</p>
                          <div className="mt-3 flex flex-wrap gap-2">
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
                    </div>
                  </article>
                )
              })
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No delivery contracts are open right now. Check back after more market buyers select delivery.</div>
            )}
          </section>
        ) : null}
      </div>
    </DashboardShell>
  )
}