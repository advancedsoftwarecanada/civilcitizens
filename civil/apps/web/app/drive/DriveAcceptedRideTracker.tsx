'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HiOutlineCalendarDays, HiOutlineChatBubbleOvalLeft, HiOutlineClock, HiOutlineExclamationTriangle, HiOutlineMapPin } from 'react-icons/hi2'
import CivilCard from '../_components/CivilCard'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { AddressDirectionsMap } from '../_components/map/AddressDirectionsMap'
import { calculateDistanceKm, fetchDrivingRoute } from '../_lib/addressSearch'
import { redirectToAuthModal } from '../_lib/authModal'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import { getStoredToken } from '../_lib/tokenStorage'
import {
  formatDriveDateTime,
  formatDrivePersonName,
  getAvatarInitials,
  type DriveRideOfferItem,
  type DriveRideRequestItem,
} from './driveShared'

type MapPoint = {
  latitude: number
  longitude: number
  label: string
}

function buildMapPoint(
  address:
    | DriveRideRequestItem['pickupAddress']
    | DriveRideRequestItem['dropoffAddress']
    | DriveRideRequestItem['driverLocation']
    | null
    | undefined,
  fallbackLabel: string,
): MapPoint | null {
  if (
    !address ||
    typeof address.latitude !== 'number' ||
    !Number.isFinite(address.latitude) ||
    typeof address.longitude !== 'number' ||
    !Number.isFinite(address.longitude)
  ) {
    return null
  }

  return {
    latitude: address.latitude,
    longitude: address.longitude,
    label: 'line1' in address ? formatCanadianPhysicalAddressInline(address) || fallbackLabel : fallbackLabel,
  }
}

function formatTripTimeLabel(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return 'Unavailable'
  const roundedMinutes = Math.max(1, Math.round(minutes))
  if (roundedMinutes < 60) {
    return `${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'}`
  }

  const hours = Math.floor(roundedMinutes / 60)
  const remainingMinutes = roundedMinutes % 60
  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }

  return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`
}

function formatDistanceLabel(km: number | null) {
  if (km === null || !Number.isFinite(km)) return 'Unavailable'
  return `${km.toFixed(1)} km`
}

function formatNearbyDistanceLabel(meters: number | null) {
  if (meters === null || !Number.isFinite(meters)) return 'Unavailable'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatDriverUpdatedLabel(value: string | null) {
  if (!value) return null
  const updatedAt = new Date(value)
  if (!Number.isFinite(updatedAt.getTime())) return null

  const diffMinutes = Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 60_000))
  if (diffMinutes < 1) return 'Updated just now'
  if (diffMinutes === 1) return 'Updated 1 minute ago'
  if (diffMinutes < 60) return `Updated ${diffMinutes} minutes ago`

  const hours = Math.floor(diffMinutes / 60)
  if (hours === 1) return 'Updated 1 hour ago'
  return `Updated ${hours} hours ago`
}

export default function DriveAcceptedRideTracker({
  ride,
  acceptedOffer,
}: {
  ride: DriveRideRequestItem
  acceptedOffer: DriveRideOfferItem | null
}) {
  const router = useRouter()
  const [localRequesterPoint, setLocalRequesterPoint] = useState<MapPoint | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)
  const pickupPoint = useMemo(() => buildMapPoint(ride.pickupAddress, 'Pickup'), [ride.pickupAddress])
  const destinationPoint = useMemo(() => buildMapPoint(ride.dropoffAddress, 'Destination'), [ride.dropoffAddress])
  const driverPoint = useMemo(
    () =>
      ride.driverLocation
        ? {
            latitude: ride.driverLocation.latitude,
            longitude: ride.driverLocation.longitude,
            label: 'Driver location',
          }
        : null,
    [ride.driverLocation],
  )
  const requesterPoint = useMemo(
    () =>
      ride.requesterLocation
        ? {
            latitude: ride.requesterLocation.latitude,
            longitude: ride.requesterLocation.longitude,
            label: 'Rider location',
          }
        : localRequesterPoint,
    [localRequesterPoint, ride.requesterLocation],
  )
  const [routeLoading, setRouteLoading] = useState(false)
  const [tripRouteCoordinates, setTripRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [approachRouteCoordinates, setApproachRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [riderRouteCoordinates, setRiderRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [travelMinutesToPickup, setTravelMinutesToPickup] = useState<number | null>(null)
  const [travelMinutesTrip, setTravelMinutesTrip] = useState<number | null>(null)
  const [distanceKmToPickup, setDistanceKmToPickup] = useState<number | null>(null)
  const [distanceKmTrip, setDistanceKmTrip] = useState<number | null>(null)

  useEffect(() => {
    if (ride.viewerRole !== 'requester' || ride.requesterLocation || typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocalRequesterPoint(null)
      return
    }

    let cancelled = false

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setLocalRequesterPoint({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: 'Your location',
        })
      },
      () => {
        if (cancelled) return
        setLocalRequesterPoint(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    )

    return () => {
      cancelled = true
    }
  }, [ride.requesterLocation, ride.viewerRole])

  useEffect(() => {
    if (!pickupPoint || !destinationPoint) {
      setTripRouteCoordinates(null)
      setApproachRouteCoordinates(null)
      setRiderRouteCoordinates(null)
      setTravelMinutesToPickup(null)
      setTravelMinutesTrip(null)
      setDistanceKmToPickup(null)
      setDistanceKmTrip(null)
      setRouteLoading(false)
      return
    }

    const controller = new AbortController()
    const pickup = pickupPoint
    const destination = destinationPoint
    const driver = driverPoint
    const rider = requesterPoint
    setRouteLoading(true)

    async function loadRoute() {
      const tripRoute = await fetchDrivingRoute(pickup, destination, controller.signal)
      if (!tripRoute) {
        setTripRouteCoordinates(null)
        setApproachRouteCoordinates(null)
        setRiderRouteCoordinates(null)
        setTravelMinutesTrip(null)
        setDistanceKmTrip(null)
        setTravelMinutesToPickup(null)
        setDistanceKmToPickup(null)
        return
      }

      setTripRouteCoordinates(tripRoute.geometry)
      setTravelMinutesTrip(Math.max(1, Math.round(tripRoute.durationSeconds / 60)))
      setDistanceKmTrip(tripRoute.distanceMeters / 1000)

      if (rider && calculateDistanceKm(rider, pickup) > 0.05) {
        const riderRoute = await fetchDrivingRoute(rider, pickup, controller.signal).catch(() => null)
        if (riderRoute) {
          setRiderRouteCoordinates(riderRoute.geometry)
        } else {
          setRiderRouteCoordinates(null)
        }
      } else {
        setRiderRouteCoordinates(null)
      }

      if (!driver) {
        setApproachRouteCoordinates(null)
        setTravelMinutesToPickup(null)
        setDistanceKmToPickup(null)
        return
      }

      const approachRoute = await fetchDrivingRoute(driver, pickup, controller.signal).catch(() => null)
      if (!approachRoute) {
        setApproachRouteCoordinates(null)
        setTravelMinutesToPickup(null)
        setDistanceKmToPickup(null)
        return
      }

      setApproachRouteCoordinates(approachRoute.geometry)
      setTravelMinutesToPickup(Math.max(1, Math.round(approachRoute.durationSeconds / 60)))
      setDistanceKmToPickup(approachRoute.distanceMeters / 1000)
    }

    void loadRoute()
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error('Failed to load accepted ride tracking route', error)
        setTripRouteCoordinates(null)
        setApproachRouteCoordinates(null)
        setRiderRouteCoordinates(null)
        setTravelMinutesToPickup(null)
        setTravelMinutesTrip(null)
        setDistanceKmToPickup(null)
        setDistanceKmTrip(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRouteLoading(false)
        }
      })

    return () => controller.abort()
  }, [destinationPoint, driverPoint, pickupPoint, requesterPoint])

  if (!pickupPoint || !destinationPoint) return null

  const driverLabel = acceptedOffer ? formatDrivePersonName(acceptedOffer.driver) : 'Your driver'
  const riderLabel = formatDrivePersonName(ride.requester)
  const pickupLabel = formatCanadianPhysicalAddressInline(ride.pickupAddress) || 'Pickup pending'
  const destinationLabel = formatCanadianPhysicalAddressInline(ride.dropoffAddress) || 'Destination pending'
  const isRequesterView = ride.viewerRole !== 'driver'
  const requesterMapPoint = requesterPoint ?? pickupPoint
  const counterpartyLabel = isRequesterView ? driverLabel : riderLabel
  const counterpartyRoleLabel = isRequesterView ? 'Accepted Driver' : 'Passenger'
  const counterpartyHandle = isRequesterView ? acceptedOffer?.driver.handle?.trim() ?? '' : ride.requester.handle?.trim() ?? ''
  const counterpartyAvatarUrl = isRequesterView ? acceptedOffer?.driver.avatarUrl ?? null : ride.requester.avatarUrl ?? null
  const counterpartyCoverUrl = isRequesterView ? acceptedOffer?.driver.coverUrl ?? null : null
  const counterpartyProfileHref = counterpartyHandle ? `/u/${encodeURIComponent(counterpartyHandle)}` : undefined
  const messageTargetUserId = isRequesterView ? acceptedOffer?.driver.id ?? ride.driverUserId ?? null : ride.requester.id
  const idleViewportKey = [
    ride.id,
    ride.pickupAt,
    ride.pickupAddress?.latitude ?? 'pickup-lat',
    ride.pickupAddress?.longitude ?? 'pickup-lng',
    ride.dropoffAddress?.latitude ?? 'dropoff-lat',
    ride.dropoffAddress?.longitude ?? 'dropoff-lng',
  ].join(':')
  const totalTripMinutes = travelMinutesToPickup !== null && travelMinutesTrip !== null ? travelMinutesToPickup + travelMinutesTrip : travelMinutesTrip
  const totalTripDistanceKm = distanceKmToPickup !== null && distanceKmTrip !== null ? distanceKmToPickup + distanceKmTrip : distanceKmTrip
  const requesterDistanceFromPickupMeters =
    isRequesterView && requesterPoint && pickupPoint ? calculateDistanceKm(requesterPoint, pickupPoint) * 1000 : null
  const showPickupDistanceWarning = typeof requesterDistanceFromPickupMeters === 'number' && requesterDistanceFromPickupMeters > 50
  const updateLabel = formatDriverUpdatedLabel(ride.driverLocation?.recordedAt ?? null)
  const summaryHeadline =
    driverPoint && travelMinutesToPickup !== null && distanceKmToPickup !== null
      ? `Your driver will arrive in ${formatTripTimeLabel(travelMinutesToPickup)} and is ${formatDistanceLabel(distanceKmToPickup)} away.`
      : 'We are waiting for your driver to share live location.'
  const counterpartySummary = isRequesterView ? summaryHeadline : 'This rider selected your offer for this trip.'

  async function handleStartMessage() {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!messageTargetUserId || messageLoading) return

    setMessageLoading(true)
    try {
      const response = await fetch(buildApiUrl('/messages/threads/direct'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: messageTargetUserId }),
      })

      const payload = (await response.json().catch(() => null)) as { thread?: { id?: string | null } | null; error?: string } | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok || !payload?.thread?.id) {
        pushToast(
          payload?.error === 'not_friends'
            ? 'Messaging opens once the Drive relationship is connected.'
            : payload?.error ?? 'Unable to open that conversation right now.',
          'error',
        )
        return
      }

      router.push(`/messages?inbox=drivers&thread=${encodeURIComponent(payload.thread.id)}`)
    } finally {
      setMessageLoading(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(19rem,0.82fr)]">
        <div className="space-y-4">
          {showPickupDistanceWarning ? (
            <div className="rounded-[1.35rem] border border-amber-200 bg-amber-50 px-4 py-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <HiOutlineExclamationTriangle className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-950">You are too far away from the pickup location!</p>
                  <p className="mt-1 text-sm text-amber-800">
                    Your current location is {formatNearbyDistanceLabel(requesterDistanceFromPickupMeters)} from pickup.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-[1.6rem] border border-slate-200">
            <AddressDirectionsMap
              origin={driverPoint ?? requesterPoint ?? pickupPoint}
              destination={destinationPoint}
              routeCoordinates={tripRouteCoordinates}
              approachRouteCoordinates={driverPoint ? approachRouteCoordinates : null}
              riderRouteCoordinates={isRequesterView ? riderRouteCoordinates : null}
              waypoints={requesterPoint ? [{ ...pickupPoint, kind: 'pickup' }] : driverPoint ? [{ ...pickupPoint, kind: 'pickup' }] : null}
              showOriginAvatar={Boolean(driverPoint)}
              originAvatarUrl={isRequesterView ? acceptedOffer?.featuredVehicle?.photoUrl ?? acceptedOffer?.driver.avatarUrl ?? null : acceptedOffer?.driver.avatarUrl ?? null}
              originAvatarLabel={`${driverLabel} location`}
              originAvatarFallbackLabel={getAvatarInitials(driverLabel)}
              pulseRouteLine={!isRequesterView}
              pulseApproachRoute={isRequesterView && Boolean(driverPoint)}
              idleCameraMode="fit-once-per-key"
              idleViewportKey={idleViewportKey}
              avatarMarkers={
                requesterMapPoint
                  ? [
                      {
                        id: 'requester',
                        point: requesterMapPoint,
                        avatarUrl: ride.requester.avatarUrl ?? null,
                        label: `${riderLabel} location`,
                        fallbackLabel: getAvatarInitials(riderLabel),
                      },
                    ]
                  : null
              }
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Pickup</p>
              <div className="mt-2 flex items-start gap-2">
                <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500" />
                <p className="text-sm font-medium leading-6 text-slate-900">{pickupLabel}</p>
              </div>
            </div>
            <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Destination</p>
              <div className="mt-2 flex items-start gap-2">
                <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-rose-500" />
                <p className="text-sm font-medium leading-6 text-slate-900">{destinationLabel}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-4 shadow-[0_18px_54px_rgba(16,185,129,0.12)]">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">{counterpartyRoleLabel}</p>
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold text-emerald-700">
                Accepted
              </span>
            </div>
            <CivilCard
              size="md"
              name={counterpartyLabel}
              avatarAlt={counterpartyLabel}
              avatarSrc={counterpartyAvatarUrl}
              avatarInitials={getAvatarInitials(counterpartyLabel)}
              coverUrl={counterpartyCoverUrl}
              href={counterpartyProfileHref}
              titleLines={0}
              className="mt-3 border-white/35 shadow-[0_16px_42px_rgba(15,23,42,0.16)]"
            />
            <button
              type="button"
              onClick={() => void handleStartMessage()}
              disabled={!messageTargetUserId || messageLoading}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <HiOutlineChatBubbleOvalLeft className="h-4 w-4" />
              {messageLoading ? 'Opening…' : 'Message'}
            </button>
            <p className="mt-3 text-sm font-medium leading-6 text-emerald-950">{counterpartySummary}</p>
            {isRequesterView && updateLabel ? <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700/80">{updateLabel}</p> : null}
          </div>

          {isRequesterView && acceptedOffer?.featuredVehicle ? (
            <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
              <p className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Look for this vehicle at pickup</p>
              {acceptedOffer.featuredVehicle.photoUrl ? (
                <img
                  src={acceptedOffer.featuredVehicle.photoUrl}
                  alt={acceptedOffer.featuredVehicle.name || driverLabel}
                  className="mt-3 h-40 w-full object-cover"
                />
              ) : (
                <div className="mt-3 flex h-40 items-center justify-center bg-slate-100 text-sm font-semibold text-slate-400">
                  No vehicle photo
                </div>
              )}
              <div className="space-y-2 px-4 py-4">
                <p className="text-base font-semibold text-slate-950">{acceptedOffer.featuredVehicle.name}</p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3">
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup time</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                <HiOutlineCalendarDays className="h-4 w-4 text-slate-400" />
                {formatDriveDateTime(ride.pickupAt)}
              </p>
            </div>
            <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Live route</p>
              <div className="mt-3 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-slate-600">
                    <HiOutlineClock className="h-4 w-4 text-slate-400" />
                    Time to pickup
                  </span>
                  <span className="font-semibold text-slate-950">
                    {routeLoading ? 'Loading driver route…' : driverPoint ? formatTripTimeLabel(travelMinutesToPickup) : 'Waiting for driver'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-slate-600">
                    <HiOutlineMapPin className="h-4 w-4 text-slate-400" />
                    Driver distance
                  </span>
                  <span className="font-semibold text-slate-950">
                    {routeLoading ? 'Loading driver route…' : driverPoint ? formatDistanceLabel(distanceKmToPickup) : 'Waiting for driver'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-600">Pickup to destination</span>
                  <span className="font-semibold text-slate-950">{routeLoading ? 'Loading route…' : formatTripTimeLabel(travelMinutesTrip)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-amber-200 pt-3">
                  <span className="text-slate-600">Total trip time</span>
                  <span className="font-semibold text-slate-950">{routeLoading ? 'Loading route…' : formatTripTimeLabel(totalTripMinutes)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-600">Total distance</span>
                  <span className="font-semibold text-slate-950">{routeLoading ? 'Loading route…' : formatDistanceLabel(totalTripDistanceKm)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
