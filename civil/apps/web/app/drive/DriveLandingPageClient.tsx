'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { HiOutlineMap, HiOutlineTruck } from 'react-icons/hi2'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { isNotificationPayload, subscribeToNotificationsStream } from '../_components/notifications/notificationStream'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveAcceptedRideTracker from './DriveAcceptedRideTracker'
import DriveActiveContractCard from './DriveActiveContractCard'
import DriveContractHistoryRail from './DriveContractHistoryRail'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveRideRequestRail from './DriveRideRequestRail'
import DriveRouteNav from './DriveRouteNav'
import { DriveDeliveryTable, DriveRideTable } from './DriveTables'
import type { DriveDeliveryItem, DriveFeedResponse, DriveRideOfferItem, DriveRideOffersResponse, DriveRideRequestItem } from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

type FeedState<T> = {
  items: T[]
  total: number
  error: string | null
}

function DriverModeLandingNav({
  onOpenRideRequests,
  onOpenDeliveryRequests,
}: {
  onOpenRideRequests: () => void
  onOpenDeliveryRequests: () => void
}) {
  return (
    <nav className="w-full" aria-label="Driver dispatch sections">
      <div className="grid w-full gap-3 md:grid-cols-2">
        <Link
          href="/drive/ride"
          onClick={onOpenRideRequests}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)]/25 hover:text-[var(--cc-primary)]"
        >
          <HiOutlineMap className="h-4 w-4 shrink-0" />
          Open Ride Requests
        </Link>
        <Link
          href="/drive/delivery"
          onClick={onOpenDeliveryRequests}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)]/25 hover:text-[var(--cc-primary)]"
        >
          <HiOutlineTruck className="h-4 w-4 shrink-0" />
          Open Delivery Requests
        </Link>
      </div>
    </nav>
  )
}

type DriveLandingPageClientProps = {
  surfaceMode?: 'driver' | 'request'
}

export default function DriveLandingPageClient({ surfaceMode }: DriveLandingPageClientProps) {
  const router = useRouter()
  const {
    isDriverActive,
    isDriverMode,
    loading: viewerLoading,
    rideRequestCount,
    deliveryRequestCount,
    enterDriverMode,
    exitDriverMode,
  } = useDriveViewerState()
  const showDriverSurface = surfaceMode ? surfaceMode === 'driver' : isDriverMode
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [rides, setRides] = useState<FeedState<DriveRideRequestItem>>({ items: [], total: 0, error: null })
  const [delivery, setDelivery] = useState<FeedState<DriveDeliveryItem>>({ items: [], total: 0, error: null })
  const [activeAcceptedOffer, setActiveAcceptedOffer] = useState<DriveRideOfferItem | null>(null)
  const [cancelingRideId, setCancelingRideId] = useState<string | null>(null)
  const [completingRideId, setCompletingRideId] = useState<string | null>(null)
  const [cancelingDeliveryId, setCancelingDeliveryId] = useState<string | null>(null)

  const handleOpenRideRequests = () => {
    enterDriverMode()
    router.push('/drive/ride')
  }

  const handleOpenDeliveryRequests = () => {
    enterDriverMode()
    router.push('/drive/delivery')
  }

  const handleEnterDriverSurface = () => {
    enterDriverMode()
    if (surfaceMode === 'request') {
      router.push('/drive')
    }
  }

  const handleExitDriverSurface = () => {
    exitDriverMode()
    if (surfaceMode === 'driver') {
      router.push('/ride')
    }
  }

  useEffect(() => {
    return subscribeToNotificationsStream((payload) => {
      if (!isNotificationPayload(payload)) return
      if (!['drive_ride_offer', 'drive_ride_contract_update', 'drive_ride_complete_confirmation', 'drive_ride_complete_response'].includes(payload.data.type)) return
      setReloadKey((current) => current + 1)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    async function load(showLoading: boolean) {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      if (showLoading) setLoading(true)
      try {
        const [ridesRes, deliveryRes] = await Promise.all([
          fetch(buildApiUrl('/drive/rides?scope=mine&limit=24'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/delivery?scope=mine&limit=24'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ])

        const [ridesPayload, deliveryPayload] = await Promise.all([
          ridesRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveRideRequestItem> | null>,
          deliveryRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveDeliveryItem> | null>,
        ])

        if (ridesRes.status === 401 || deliveryRes.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        setRides({
          items: ridesRes.ok && Array.isArray(ridesPayload?.items) ? ridesPayload.items : [],
          total: ridesRes.ok ? Number(ridesPayload?.total) || 0 : 0,
          error: ridesRes.ok ? null : 'Unable to load your ride history right now.',
        })
        setDelivery({
          items: deliveryRes.ok && Array.isArray(deliveryPayload?.items) ? deliveryPayload.items : [],
          total: deliveryRes.ok ? Number(deliveryPayload?.total) || 0 : 0,
          error: deliveryRes.ok ? null : 'Unable to load your delivery history right now.',
        })
      } catch (error) {
        console.error('Failed to load Drive history', error)
        if (cancelled) return
        setRides({ items: [], total: 0, error: 'Unable to load your ride history right now.' })
        setDelivery({ items: [], total: 0, error: 'Unable to load your delivery history right now.' })
      } finally {
        if (!cancelled && showLoading) setLoading(false)
      }
    }

    void load(true)
    intervalId = window.setInterval(() => {
      void load(false)
    }, 10000)

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [reloadKey])

  const activeAcceptedRide = useMemo(
    () =>
      rides.items.find((item) => {
        if (item.viewerRole !== 'requester' || !item.acceptedOfferId) return false
        return !['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(item.status.trim().toLowerCase())
      }) ?? null,
    [rides.items],
  )
  const activeDriverContracts = useMemo(
    () =>
      rides.items
        .filter((item) => {
          if (item.viewerRole !== 'driver' || !item.acceptedOfferId) return false
          return !['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(item.status.trim().toLowerCase())
        })
        .sort((left, right) => {
          const leftDate = new Date(left.pickupAt)
          const rightDate = new Date(right.pickupAt)
          return leftDate.getTime() - rightDate.getTime()
        }),
    [rides.items],
  )

  useEffect(() => {
    if (!activeAcceptedRide?.id) {
      setActiveAcceptedOffer(null)
      return
    }

    let cancelled = false
    let intervalId: number | null = null
    const rideId = activeAcceptedRide.id

    async function loadAcceptedOffer() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      try {
        const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(rideId)}/offers`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveRideOffersResponse | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok) {
          setActiveAcceptedOffer(null)
          return
        }

        const acceptedOffer =
          (Array.isArray(payload?.offers) ? payload.offers : []).find(
            (offer) => offer.id === payload?.item?.acceptedOfferId || offer.status === 'accepted',
          ) ?? null

        setActiveAcceptedOffer(acceptedOffer)
      } catch (error) {
        console.error('Failed to load accepted ride offer details', error)
        if (cancelled) return
        setActiveAcceptedOffer(null)
      }
    }

    void loadAcceptedOffer()
    intervalId = window.setInterval(() => {
      void loadAcceptedOffer()
    }, 10000)

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [activeAcceptedRide?.id])

  async function handleCancelRide(item: DriveRideRequestItem) {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setCancelingRideId(item.id)

    try {
      const res = await fetch(buildApiUrl(`/drive/rides/${item.id}/cancel`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; item?: DriveRideRequestItem } | null

      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!res.ok) {
        pushToast(payload?.error === 'ride_not_cancellable' ? 'This ride can no longer be cancelled.' : 'Unable to cancel this ride right now.', 'error')
        return
      }

      setRides((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: payload?.item?.status ?? 'cancelled',
              }
            : entry,
        ),
      }))
      pushToast('Ride request cancelled.', 'success')
    } catch (error) {
      console.error('Failed to cancel ride request', error)
      pushToast('Unable to cancel this ride right now.', 'error')
    } finally {
      setCancelingRideId((current) => (current === item.id ? null : current))
    }
  }

  async function handleCompleteRide(item: DriveRideRequestItem) {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setCompletingRideId(item.id)

    try {
      const res = await fetch(buildApiUrl(`/drive/rides/${item.id}/complete`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; completionDueAt?: string } | null

      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!res.ok) {
        pushToast(
          payload?.error === 'ride_completion_already_requested'
            ? 'This ride has already been marked complete.'
            : payload?.error === 'ride_not_in_escrow'
              ? 'This ride is not holding customer funds anymore.'
              : 'Unable to mark this trip complete right now.',
          'error',
        )
        return
      }

      setRides((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: 'completed',
                completionRequestedAt: new Date().toISOString(),
                completionConfirmationDueAt: payload?.completionDueAt ?? entry.completionConfirmationDueAt,
              }
            : entry,
        ),
      }))
      pushToast('Trip marked complete. The rider has 30 minutes to confirm or report an issue.', 'success')
    } catch (error) {
      console.error('Failed to mark drive trip complete', error)
      pushToast('Unable to mark this trip complete right now.', 'error')
    } finally {
      setCompletingRideId((current) => (current === item.id ? null : current))
    }
  }

  async function handleCancelDelivery(item: DriveDeliveryItem) {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setCancelingDeliveryId(item.id)

    try {
      const res = await fetch(buildApiUrl(`/drive/delivery/${item.id}/cancel`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; status?: string } | null

      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!res.ok) {
        pushToast(payload?.error === 'contract_not_cancellable' ? 'This delivery can no longer be cancelled.' : 'Unable to cancel this delivery right now.', 'error')
        return
      }

      setDelivery((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: payload?.status ?? 'cancelled',
              }
            : entry,
        ),
      }))
      pushToast('Delivery cancelled.', 'success')
    } catch (error) {
      console.error('Failed to cancel delivery', error)
      pushToast('Unable to cancel this delivery right now.', 'error')
    } finally {
      setCancelingDeliveryId((current) => (current === item.id ? null : current))
    }
  }

  return (
    <DashboardShell
      rightRail={
        <div className="space-y-5">
          {!showDriverSurface ? <DriveRideRequestRail secondaryAction={isDriverActive ? { label: 'Enter Driver Mode', onClick: handleEnterDriverSurface } : undefined} /> : null}
          {!isDriverActive || showDriverSurface ? (
            <DriveModeRail
              isDriverActive={isDriverActive}
              isDriverMode={showDriverSurface && isDriverActive}
              loading={viewerLoading}
              rideRequestCount={rideRequestCount}
              deliveryRequestCount={deliveryRequestCount}
              onEnterDriverMode={handleEnterDriverSurface}
              onExitDriverMode={handleExitDriverSurface}
            />
          ) : null}
          <DriveDriverEarningsRail enabled={showDriverSurface} />
          {showDriverSurface ? <DriveContractHistoryRail rides={rides.items} delivery={delivery.items} activeRideIds={activeDriverContracts.map((item) => item.id)} /> : null}
          <RightRail mode="drive" organizationLinkTarget="chat" showDriveCallout={false} />
        </div>
      }
      showMobileRightRail
      mainClassName="space-y-8 pb-12"
      rightRailClassName="pb-12"
    >
      {showDriverSurface ? <DriverModeLandingNav onOpenRideRequests={handleOpenRideRequests} onOpenDeliveryRequests={handleOpenDeliveryRequests} /> : <DriveRouteNav />}

      {showDriverSurface ? (
        activeDriverContracts.length ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold text-slate-950">Active Contracts</h2>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                {activeDriverContracts.length} live
              </span>
            </div>
            <div className="space-y-4">
              {activeDriverContracts.map((item) => (
                <DriveActiveContractCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ) : (
          <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">
            No active contracts are assigned to you right now.
          </section>
        )
      ) : (
        <>
          {activeAcceptedRide ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold text-slate-950">Current Ride</h2>
              </div>
              <DriveAcceptedRideTracker ride={activeAcceptedRide} acceptedOffer={activeAcceptedOffer} />
            </section>
          ) : null}

          <DriveRideTable
            title="Ride History"
            items={rides.items}
            total={rides.total}
            loading={loading}
            error={rides.error}
            emptyMessage="You have not posted any ride requests yet."
            variant="mine"
            onCancel={handleCancelRide}
            cancelingId={cancelingRideId}
            onMarkComplete={handleCompleteRide}
            completingId={completingRideId}
            getEditHref={(item) => (item.viewerRole === 'requester' ? `/drive/ride/request/${item.id}` : null)}
            getOffersHref={(item) => (item.viewerRole === 'requester' && item.offerCount > 0 ? `/drive/myrides/${item.id}/offers` : null)}
          />

          <DriveDeliveryTable
            title="Delivery History"
            items={delivery.items}
            total={delivery.total}
            loading={loading}
            error={delivery.error}
            emptyMessage={isDriverActive ? 'No Drive delivery activity is showing up yet.' : 'You have not had any Drive deliveries yet.'}
            variant="mine"
            onCancel={handleCancelDelivery}
            cancelingId={cancelingDeliveryId}
          />
        </>
      )}
    </DashboardShell>
  )
}
