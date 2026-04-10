'use client'

import { useEffect, useMemo, useState } from 'react'
import { AddressDirectionsMap } from './map/AddressDirectionsMap'
import DashboardShell from './DashboardShell'
import HomeRideRequestCard, { type HomeRideMapPreview } from './HomeRideRequestCard'
import { isNotificationPayload, subscribeToNotificationsStream } from './notifications/notificationStream'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveAcceptedRideTracker from '../drive/DriveAcceptedRideTracker'
import DriveActiveContractCard from '../drive/DriveActiveContractCard'
import { DriveRideTable } from '../drive/DriveTables'
import type { DriveFeedResponse, DriveRideOfferItem, DriveRideOffersResponse, DriveRideRequestItem } from '../drive/driveShared'

type RideFeedState = {
  items: DriveRideRequestItem[]
  total: number
  error: string | null
}

const TERMINAL_RIDE_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'])

function isTerminalRideStatus(value: string | null | undefined) {
  return TERMINAL_RIDE_STATUSES.has((value || '').trim().toLowerCase())
}

function getRideSortTime(item: DriveRideRequestItem) {
  const pickupTime = new Date(item.pickupAt).getTime()
  if (Number.isFinite(pickupTime)) return pickupTime
  const createdTime = new Date(item.createdAt).getTime()
  return Number.isFinite(createdTime) ? createdTime : 0
}

export default function HomeTripsDashboard() {
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [rides, setRides] = useState<RideFeedState>({ items: [], total: 0, error: null })
  const [activeAcceptedOffer, setActiveAcceptedOffer] = useState<DriveRideOfferItem | null>(null)
  const [mapPreview, setMapPreview] = useState<HomeRideMapPreview>({
    currentLocation: null,
    pickup: null,
    destination: null,
    routeCoordinates: null,
  })

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
        const response = await fetch(buildApiUrl('/drive/rides?scope=mine&limit=40'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveFeedResponse<DriveRideRequestItem> | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        setRides({
          items: response.ok && Array.isArray(payload?.items) ? payload.items : [],
          total: response.ok ? Number(payload?.total) || 0 : 0,
          error: response.ok ? null : 'Unable to load your ride activity right now.',
        })
      } catch (error) {
        console.error('Failed to load home ride activity', error)
        if (cancelled) return
        setRides({ items: [], total: 0, error: 'Unable to load your ride activity right now.' })
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
        return !isTerminalRideStatus(item.status)
      }) ?? null,
    [rides.items],
  )

  const activeDriverContracts = useMemo(
    () =>
      rides.items
        .filter((item) => item.viewerRole === 'driver' && item.acceptedOfferId && !isTerminalRideStatus(item.status))
        .sort((left, right) => getRideSortTime(left) - getRideSortTime(right)),
    [rides.items],
  )

  useEffect(() => {
    const rideId = activeAcceptedRide?.id
    if (!rideId) {
      setActiveAcceptedOffer(null)
      return
    }
    const activeRideId: string = rideId

    let cancelled = false
    let intervalId: number | null = null

    async function loadAcceptedOffer() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      try {
        const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(activeRideId)}/offers`), {
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
        console.error('Failed to load accepted ride offer details for home', error)
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

  const featuredRideIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeAcceptedRide?.id) ids.add(activeAcceptedRide.id)
    for (const item of activeDriverContracts) ids.add(item.id)
    return ids
  }, [activeAcceptedRide?.id, activeDriverContracts])

  const feedItems = useMemo(
    () =>
      rides.items
        .filter((item) => !featuredRideIds.has(item.id))
        .sort((left, right) => getRideSortTime(right) - getRideSortTime(left)),
    [featuredRideIds, rides.items],
  )

  const mapDestination = useMemo(
    () => mapPreview.destination ?? mapPreview.pickup ?? mapPreview.currentLocation,
    [mapPreview.currentLocation, mapPreview.destination, mapPreview.pickup],
  )

  const mapOrigin = useMemo(() => {
    if (mapPreview.destination && mapPreview.pickup) return mapPreview.pickup
    if (mapPreview.pickup && mapPreview.currentLocation) return mapPreview.currentLocation
    return null
  }, [mapPreview.currentLocation, mapPreview.destination, mapPreview.pickup])

  const mapViewportKey = useMemo(() => {
    const parts = [
      mapOrigin ? `${mapOrigin.latitude.toFixed(4)},${mapOrigin.longitude.toFixed(4)}` : 'origin:none',
      mapDestination ? `${mapDestination.latitude.toFixed(4)},${mapDestination.longitude.toFixed(4)}` : 'destination:none',
      mapPreview.routeCoordinates ? `route:${mapPreview.routeCoordinates.length}` : 'route:none',
    ]
    return parts.join('|')
  }, [mapDestination, mapOrigin, mapPreview.routeCoordinates])

  return (
    <DashboardShell registerRightRail={false} mainClassName="space-y-6 pb-12">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <HomeRideRequestCard
          onMapPreviewChange={setMapPreview}
          onRideRequested={(item) => {
            setRides((current) => {
              const nextItems = [item, ...current.items.filter((entry) => entry.id !== item.id)]
              return {
                items: nextItems,
                total: current.total + (current.items.some((entry) => entry.id === item.id) ? 0 : 1),
                error: null,
              }
            })
            setReloadKey((current) => current + 1)
          }}
        />

        <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          {mapDestination ? (
            <AddressDirectionsMap
              origin={mapOrigin}
              destination={mapDestination}
              routeCoordinates={mapPreview.routeCoordinates}
              pulseRouteLine
              idleCameraMode="fit-once-per-key"
              idleViewportKey={mapViewportKey}
            />
          ) : (
            <div className="flex h-[420px] items-center justify-center rounded-[28px] bg-slate-50 px-6 text-center text-sm text-slate-500">
              Allow location access or enter a pickup address to initialize the map.
            </div>
          )}
        </article>
      </section>

      {activeAcceptedRide ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-slate-950">Current ride</h2>
          </div>
          <DriveAcceptedRideTracker ride={activeAcceptedRide} acceptedOffer={activeAcceptedOffer} />
        </section>
      ) : null}

      {activeDriverContracts.length ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-slate-950">Live drive jobs</h2>
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
      ) : null}

      <DriveRideTable
        title="Recent ride activity"
        items={feedItems}
        loading={loading}
        error={rides.error}
        emptyMessage="Your rides and driving activity will show up here once you start using MapleRides."
        variant="mine"
        getEditHref={(item) => (item.viewerRole === 'requester' ? `/drive/ride/request/${item.id}` : null)}
        getOffersHref={(item) => (item.viewerRole === 'requester' && item.offerCount > 0 ? `/drive/myrides/${item.id}/offers` : null)}
      />
    </DashboardShell>
  )
}
