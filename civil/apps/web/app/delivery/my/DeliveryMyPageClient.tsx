'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import CivilCard from '../../_components/CivilCard'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import DriveRideRequestRail from '../../drive/DriveRideRequestRail'
import DriveRouteNav from '../../drive/DriveRouteNav'
import { useDriveViewerState } from '../../drive/useDriveViewerState'
import { formatContractStatus, formatMoney, formatParticipantName, type DeliveryRequestedContract } from '../deliveryShared'

type RequestedContractsResponse = {
  items?: DeliveryRequestedContract[]
}

function DeliveryFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className="mt-2 text-sm font-medium leading-6 text-slate-900">{value}</div>
    </div>
  )
}

export default function DeliveryMyPageClient() {
  const { isDriverActive, enterDriverMode } = useDriveViewerState()
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<DeliveryRequestedContract[]>([])
  const [error, setError] = useState<string | null>(null)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [respondingAction, setRespondingAction] = useState<'accept' | 'reject' | null>(null)

  const loadContracts = useCallback(async (options?: { silent?: boolean }) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/delivery/contracts/requested'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await res.json().catch(() => null)) as (RequestedContractsResponse & { error?: string }) | null
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        setError('Unable to load your requested deliveries right now.')
        setContracts([])
        return
      }
      setContracts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (err) {
      console.error('Failed to load requested deliveries', err)
      setError('Unable to load your requested deliveries right now.')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadContracts()
  }, [loadContracts])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadContracts({ silent: true })
    }, 15_000)
    return () => window.clearInterval(intervalId)
  }, [loadContracts])

  const handleBidResponse = useCallback(
    async (contractId: string, action: 'accept' | 'reject') => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setRespondingId(contractId)
      setRespondingAction(action)
      setError(null)

      try {
        const response = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(contractId)}/${action === 'accept' ? 'accept-bid' : 'reject-bid'}`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) throw new Error('delivery_bid_response_failed')

        await loadContracts()
      } catch (responseError) {
        console.error('Failed to respond to delivery bid', responseError)
        setError('Unable to update that delivery bid right now.')
      } finally {
        setRespondingId(null)
        setRespondingAction(null)
      }
    },
    [loadContracts],
  )
  const rightRail = (
    <div className="space-y-5">
      <DriveRideRequestRail secondaryAction={isDriverActive ? { label: 'Enter Driver Mode', onClick: enterDriverMode } : undefined} />
      <RightRail mode="drive" organizationLinkTarget="chat" showDriveCallout={false} />
    </div>
  )

  return (
    <DashboardShell rightRail={rightRail} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <DriveRouteNav />

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Loading your requested deliveries…</div>
        ) : null}

        {!loading ? (
          <section className="space-y-4">
            {contracts.length ? (
              contracts.map((contract) => {
                const pickupLabel = contract.pickupAddressLabel?.trim() || [contract.pickupCity?.trim(), contract.pickupProvince?.trim()].filter(Boolean).join(', ') || 'Pickup pending'
                const dropoffLabel = contract.dropoffAddressLabel?.trim() || 'Dropoff pending'
                const requesterRoleLabel = contract.requesterRole === 'buyer' ? 'You requested this as the buyer' : 'You requested this as the seller'
                const canRespondToBid = contract.requesterRole === 'buyer' && contract.status === 'bid_pending' && Boolean(contract.driver)
                return (
                  <article key={contract.id} className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="space-y-5 p-5 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-100 shadow-sm">
                            {contract.listingPhotoUrl ? (
                              <img src={contract.listingPhotoUrl} alt={contract.listingTitle} className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <h2 className="text-xl font-semibold text-slate-950">{contract.listingTitle}</h2>
                            <p className="mt-2 text-sm text-slate-600">{requesterRoleLabel}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                                {formatContractStatus(contract.status)}
                              </span>
                              <span>{contract.driver ? `Driver: ${formatParticipantName(contract.driver)}` : 'Waiting for driver'}</span>
                            </div>
                          </div>
                        </div>
                        {contract.groupThreadId ? (
                          <Link href={`/messages?thread=${encodeURIComponent(contract.groupThreadId)}`} className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
                            Open delivery chat
                          </Link>
                        ) : null}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DeliveryFact label="Pickup" value={pickupLabel} />
                        <DeliveryFact label="Dropoff" value={dropoffLabel} />
                        <DeliveryFact
                          label="Delivery fee"
                          value={
                            contract.bidAmountCents ? (
                              <div>
                                <div>{formatMoney(contract.bidAmountCents)}</div>
                                {contract.bidPerKmFeeCents ? <div className="mt-1 text-xs font-semibold text-slate-500">{formatMoney(contract.bidPerKmFeeCents)}/km</div> : null}
                              </div>
                            ) : (
                              'Pending'
                            )
                          }
                        />
                        <DeliveryFact label="ETA" value={contract.estimatedDeliveryAt ? new Date(contract.estimatedDeliveryAt).toLocaleString() : 'Waiting for driver update'} />
                        <DeliveryFact label="Delivered" value={contract.deliveredAt ? new Date(contract.deliveredAt).toLocaleString() : 'Not yet'} />
                      </div>

                      {canRespondToBid ? (
                        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-1">
                          <button
                            type="button"
                            onClick={() => handleBidResponse(contract.id, 'accept')}
                            disabled={respondingId === contract.id}
                            className="inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {respondingId === contract.id && respondingAction === 'accept' ? 'Accepting…' : 'Accept Bid'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBidResponse(contract.id, 'reject')}
                            disabled={respondingId === contract.id}
                            className="inline-flex rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {respondingId === contract.id && respondingAction === 'reject' ? 'Declining…' : 'Decline Bid'}
                          </button>
                        </div>
                      ) : null}

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Driver</p>
                            <div className="mt-2">
                              {contract.driver ? (
                                <CivilCard size="rail" name={formatParticipantName(contract.driver)} avatarAlt={formatParticipantName(contract.driver)} avatarInitials={formatParticipantName(contract.driver)} avatarSrc={contract.driver.avatarUrl} />
                              ) : (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No driver has been assigned yet.</div>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Pickup instructions</p>
                            <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{contract.pickupInstructions?.trim() || 'No extra pickup notes were supplied.'}</p>
                          </div>
                        </div>

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
                          <div className="flex flex-wrap gap-2">
                            {contract.itemTraits.length ? contract.itemTraits.map((trait) => <span key={trait} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">{trait}</span>) : <span className="text-sm text-slate-500">No special handling notes.</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">You have not requested any deliveries yet.</div>
            )}
          </section>
        ) : null}
      </div>
    </DashboardShell>
  )
}
