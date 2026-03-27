'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Modal from '../_components/Modal'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { ensureViewerMe } from '../_lib/viewerMe'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveAcceptedRideTracker from './DriveAcceptedRideTracker'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveRideRequestDetailsRail from './DriveRideRequestDetailsRail'
import DriveRouteNav from './DriveRouteNav'
import {
  formatDriveDateTime,
  formatDriveMoney,
  formatDrivePersonName,
  formatDriveStatus,
  getAvatarInitials,
  getDriveStatusTone,
  type DriveRideOfferItem,
  type DriveRideOffersResponse,
  type DriveRideRequestItem,
} from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

type WalletPromptState = {
  open: boolean
  availableCreditsCents: number | null
  requiredAmountCents: number | null
  walletRequired: boolean
}

function DriverAvatar({ offer }: { offer: DriveRideOfferItem }) {
  const label = formatDrivePersonName(offer.driver)
  const initials = getAvatarInitials(label)

  if (offer.driver.avatarUrl) {
    return <img src={offer.driver.avatarUrl} alt={label} className="h-14 w-14 rounded-2xl border border-white/80 object-cover shadow-sm" />
  }

  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
      {initials}
    </div>
  )
}

export default function DriveRideOffersPageClient({ rideId }: { rideId: string }) {
  const { isDriverActive, isDriverMode, loading: viewerLoading, rideRequestCount, deliveryRequestCount, enterDriverMode, exitDriverMode } = useDriveViewerState()
  const [loading, setLoading] = useState(true)
  const [ride, setRide] = useState<DriveRideRequestItem | null>(null)
  const [offers, setOffers] = useState<DriveRideOfferItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null)
  const [walletPrompt, setWalletPrompt] = useState<WalletPromptState>({
    open: false,
    availableCreditsCents: null,
    requiredAmountCents: null,
    walletRequired: false,
  })

  useEffect(() => {
    let cancelled = false

    async function load(showLoading: boolean) {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      if (showLoading) setLoading(true)
      try {
        const response = await fetch(buildApiUrl(`/drive/rides/${rideId}/offers`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveRideOffersResponse | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok || !payload?.item) {
          setRide(null)
          setOffers([])
          setError(payload?.error === 'ride_not_found' ? 'That ride request could not be found.' : 'Unable to load ride offers right now.')
          return
        }

        setRide(payload.item)
        setOffers(Array.isArray(payload.offers) ? payload.offers : [])
        setError(null)
      } catch (loadError) {
        console.error('Failed to load ride offers', loadError)
        if (cancelled) return
        setRide(null)
        setOffers([])
        setError('Unable to load ride offers right now.')
      } finally {
        if (!cancelled && showLoading) {
          setLoading(false)
        }
      }
    }

    void load(true)

    const intervalId = window.setInterval(() => {
      void load(false)
    }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [reloadKey, rideId])

  async function handleAcceptOffer(offer: DriveRideOfferItem) {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setAcceptingOfferId(offer.id)
    try {
      const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(rideId)}/offers/${encodeURIComponent(offer.id)}/accept`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await response.json().catch(() => null)) as DriveRideOffersResponse | {
        error?: string
        availableCreditsCents?: number
        requiredAmountCents?: number
      } | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        if (payload?.error === 'wallet_required' || payload?.error === 'insufficient_wallet_balance') {
          setWalletPrompt({
            open: true,
            availableCreditsCents: typeof payload?.availableCreditsCents === 'number' ? payload.availableCreditsCents : null,
            requiredAmountCents: typeof payload?.requiredAmountCents === 'number' ? payload.requiredAmountCents : null,
            walletRequired: payload?.error === 'wallet_required',
          })
          return
        }

        pushToast(
          payload?.error === 'ride_offer_not_accepting'
            ? 'This ride is no longer accepting offers.'
            : payload?.error === 'offer_not_found'
              ? 'That offer is no longer available.'
              : 'Unable to accept this offer right now.',
          'error',
        )
        return
      }

      await ensureViewerMe({ token, refresh: true })
      setReloadKey((current) => current + 1)
      pushToast('Offer accepted. Civil is now holding the fare in escrow until the trip is completed.', 'success')
    } catch (acceptError) {
      console.error('Failed to accept ride offer', acceptError)
      pushToast('Unable to accept this offer right now.', 'error')
    } finally {
      setAcceptingOfferId((current) => (current === offer.id ? null : current))
    }
  }

  const rideAccepted = Boolean(ride?.acceptedOfferId)
  const acceptedOffer = rideAccepted ? offers.find((offer) => offer.id === ride?.acceptedOfferId || offer.status === 'accepted') ?? null : null
  const rideStatusNormalized = (ride?.status || '').trim().toLowerCase()
  const rideCompleted = rideStatusNormalized === 'completed'
  const rideTerminal = ['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(rideStatusNormalized)
  const completedAt = ride?.riderConfirmedCompleteAt ?? ride?.autoCompletedAt ?? ride?.completionRequestedAt ?? null

  return (
    <>
      <DashboardShell
        rightRail={
          <div className="space-y-5">
            <DriveRideRequestDetailsRail item={ride} />
            <DriveModeRail
              isDriverActive={isDriverActive}
              isDriverMode={isDriverMode}
              loading={viewerLoading}
              rideRequestCount={rideRequestCount}
              deliveryRequestCount={deliveryRequestCount}
              onEnterDriverMode={enterDriverMode}
              onExitDriverMode={exitDriverMode}
            />
            <DriveDriverEarningsRail enabled={isDriverMode} />
            <RightRail mode="drive" organizationLinkTarget="chat" showDriveCallout={false} />
        </div>
        }
        showMobileRightRail
        mainClassName="space-y-6 pb-12"
        rightRailClassName="pb-12"
      >
        <DriveRouteNav />

        <section className="space-y-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-slate-950">Ride Offers</h1>
            {ride ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getDriveStatusTone(ride.status)}`}>
                  {formatDriveStatus(ride.status)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  {offers.length} {offers.length === 1 ? 'offer' : 'offers'}
                </span>
              </div>
            ) : null}
          </div>

          {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          {loading ? (
            <div className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">Loading ride offers…</div>
          ) : null}

          {!loading && ride && acceptedOffer && !rideTerminal ? <DriveAcceptedRideTracker ride={ride} acceptedOffer={acceptedOffer} /> : null}

          {!loading && ride && acceptedOffer && rideCompleted ? (
            <section className="rounded-[1.8rem] border border-emerald-200 bg-emerald-50 px-5 py-5 shadow-sm sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Ride Completed</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">This trip has been completed.</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {completedAt
                      ? `Completed ${formatDriveDateTime(completedAt)}.`
                      : 'The ride is finished and no further contract actions are required.'}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700">
                  Completed
                </span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.35rem] border border-emerald-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Driver</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{formatDrivePersonName(acceptedOffer.driver)}</p>
                </div>
                <div className="rounded-[1.35rem] border border-emerald-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Vehicle</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{acceptedOffer.featuredVehicle?.name || 'Vehicle pending'}</p>
                </div>
                <div className="rounded-[1.35rem] border border-emerald-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Final Cost</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{formatDriveMoney((acceptedOffer.amountCents || 0) + 50)}</p>
                </div>
                {typeof ride.tippedAmountCents === 'number' && ride.tippedAmountCents > 0 ? (
                  <div className="rounded-[1.35rem] border border-emerald-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Tip</p>
                    <p className="mt-2 text-lg font-semibold text-emerald-700">{formatDriveMoney(ride.tippedAmountCents)}</p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {!loading && ride && !offers.length ? (
            <div className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">No drivers have offered on this ride yet.</div>
          ) : null}

          {!loading && offers.length ? (
            <div className="space-y-4">
              {offers.map((offer) => {
                const driverLabel = formatDrivePersonName(offer.driver)
                const customerPaysCents = offer.amountCents + 50
                const isAcceptedOffer = (ride?.acceptedOfferId === offer.id || offer.status === 'accepted') && !rideTerminal
                const canAccept = Boolean(ride && !rideAccepted && offer.status === 'pending' && ride.viewerRole === 'requester')

                return (
                  <article
                    key={offer.id}
                    className={`overflow-hidden rounded-[1.8rem] border bg-white shadow-sm ${
                      isAcceptedOffer ? 'border-emerald-200 shadow-[0_22px_60px_rgba(16,185,129,0.12)]' : 'border-slate-200'
                    }`}
                  >
                    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="space-y-5 px-5 py-5 sm:px-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <DriverAvatar offer={offer} />
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Driver</p>
                              <h2 className="mt-1 text-xl font-semibold text-slate-950">{driverLabel}</h2>
                              {offer.featuredVehicle?.name ? (
                                <p className="mt-1 text-sm text-slate-500">{offer.featuredVehicle.name}</p>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {rideCompleted && (ride?.acceptedOfferId === offer.id || offer.status === 'accepted') ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                Completed
                              </span>
                            ) : isAcceptedOffer ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                Accepted
                              </span>
                            ) : null}
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                              Offered {formatDriveDateTime(offer.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Customer pays</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatDriveMoney(customerPaysCents)}</p>
                          </div>
                          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Driver earns</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatDriveMoney(offer.amountCents)}</p>
                          </div>
                          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Per km</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatDriveMoney(offer.perKmFeeCents)}</p>
                          </div>
                        </div>

                        {canAccept ? (
                          <button
                            type="button"
                            onClick={() => handleAcceptOffer(offer)}
                            disabled={acceptingOfferId === offer.id}
                            className="inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {acceptingOfferId === offer.id ? 'Accepting…' : 'Accept Offer'}
                          </button>
                        ) : rideCompleted && (ride?.acceptedOfferId === offer.id || offer.status === 'accepted') ? (
                          <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                            This ride has been completed.
                          </div>
                        ) : isAcceptedOffer ? (
                          <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                            Civil is holding {formatDriveMoney(customerPaysCents)} in escrow until the driver marks the trip complete and you confirm it.
                          </div>
                        ) : rideAccepted ? (
                          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                            Another driver has already been selected for this ride.
                          </div>
                        ) : null}
                      </div>

                      <div className="border-t border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,246,246,0.98))] px-5 py-5 lg:border-l lg:border-t-0">
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Featured vehicle</p>
                          <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
                            {offer.featuredVehicle?.photoUrl ? (
                              <img
                                src={offer.featuredVehicle.photoUrl}
                                alt={offer.featuredVehicle.name || driverLabel}
                                className="h-40 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-40 items-center justify-center bg-slate-100 text-sm font-semibold text-slate-400">
                                No vehicle photo
                              </div>
                            )}
                            <div className="space-y-2 px-4 py-4">
                              <p className="text-sm font-semibold text-slate-950">{offer.featuredVehicle?.name || 'Vehicle pending'}</p>
                              <p className="text-sm text-slate-500">
                                {offer.featuredVehicle
                                  ? `Driver minimum ${formatDriveMoney(offer.featuredVehicle.minimumRideAmountCents)}`
                                  : 'Vehicle details are not available yet.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      </DashboardShell>

      <Modal
        open={walletPrompt.open}
        onClose={() => setWalletPrompt({ open: false, availableCreditsCents: null, requiredAmountCents: null, walletRequired: false })}
        title={walletPrompt.walletRequired ? 'Add Civil Wallet funds' : 'Not enough Civil Wallet funds'}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">
            {walletPrompt.walletRequired
              ? 'Accepting a ride offer charges your Civil Wallet first. Add funds to continue.'
              : 'You need more Civil Wallet funds before you can accept this driver’s offer.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Available</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatDriveMoney(walletPrompt.availableCreditsCents)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Needed</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatDriveMoney(walletPrompt.requiredAmountCents)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/wallet"
              className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
            >
              Add Funds
            </Link>
            <button
              type="button"
              onClick={() => setWalletPrompt({ open: false, availableCreditsCents: null, requiredAmountCents: null, walletRequired: false })}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
