'use client'

import { useEffect, useMemo, useState } from 'react'
import { HiOutlineCalendarDays, HiOutlineClock } from 'react-icons/hi2'
import Modal from '../_components/Modal'
import { AddressDirectionsMap } from '../_components/map/AddressDirectionsMap'
import { fetchDrivingRoute } from '../_lib/addressSearch'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import { formatDriveDateTime, formatDriveMoney, type DriveRideRequestItem } from './driveShared'

const RIDE_OFFER_CIVIL_FEE_CENTS = 50
const RIDE_OFFER_PER_KM_MIN_CENTS = 100
const RIDE_OFFER_PER_KM_MAX_CENTS = 500

type MapPoint = {
  latitude: number
  longitude: number
  label: string
}

function clampPerKmFeeCents(value: number) {
  return Math.max(RIDE_OFFER_PER_KM_MIN_CENTS, Math.min(RIDE_OFFER_PER_KM_MAX_CENTS, value))
}

function buildMapPoint(
  address: DriveRideRequestItem['pickupAddress'] | DriveRideRequestItem['dropoffAddress'],
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
    label: formatCanadianPhysicalAddressInline(address) || fallbackLabel,
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

function formatFareSharePercent(value: number) {
  return `${value.toFixed(1)}%`
}

function formatHourlyEarningsLabel(centsPerHour: number | null) {
  if (centsPerHour === null || !Number.isFinite(centsPerHour)) return 'Unavailable'
  return `${new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(centsPerHour / 100)}/hour`
}

export default function DriveRideOfferModal({
  open,
  item,
  defaultPerKmFeeCents,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean
  item: DriveRideRequestItem | null
  defaultPerKmFeeCents: number
  submitting: boolean
  onClose: () => void
  onSubmit: (item: DriveRideRequestItem, perKmFeeCents: number) => void | Promise<void>
}) {
  const [perKmFeeCents, setPerKmFeeCents] = useState(clampPerKmFeeCents(defaultPerKmFeeCents))
  const [driverOrigin, setDriverOrigin] = useState<MapPoint | null>(null)
  const [tripRouteCoordinates, setTripRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [approachRouteCoordinates, setApproachRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [travelMinutesToPickup, setTravelMinutesToPickup] = useState<number | null>(null)
  const [travelMinutesTrip, setTravelMinutesTrip] = useState<number | null>(null)
  const [distanceKmToPickup, setDistanceKmToPickup] = useState<number | null>(null)
  const [distanceKmTrip, setDistanceKmTrip] = useState<number | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())

  useEffect(() => {
    if (!item) return
    const nextPerKmFeeCents = item.isBidByViewer && item.bidPerKmFeeCents ? item.bidPerKmFeeCents : defaultPerKmFeeCents
    setPerKmFeeCents(clampPerKmFeeCents(nextPerKmFeeCents))
  }, [defaultPerKmFeeCents, item])

  const pickupPoint = useMemo(() => buildMapPoint(item?.pickupAddress ?? null, 'Pickup'), [item?.pickupAddress])
  const destinationPoint = useMemo(() => buildMapPoint(item?.dropoffAddress ?? null, 'Destination'), [item?.dropoffAddress])

  useEffect(() => {
    if (!open) {
      setDriverOrigin(null)
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setDriverOrigin(null)
      return
    }

    let cancelled = false

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setDriverOrigin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: 'Your current location',
        })
      },
      () => {
        if (cancelled) return
        setDriverOrigin(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    )

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return

    setCurrentTimeMs(Date.now())
    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, 30_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [open])

  useEffect(() => {
    if (!open || !pickupPoint || !destinationPoint) {
      setTripRouteCoordinates(null)
      setApproachRouteCoordinates(null)
      setTravelMinutesToPickup(null)
      setTravelMinutesTrip(null)
      setDistanceKmToPickup(null)
      setDistanceKmTrip(null)
      setRouteLoading(false)
      return
    }

    const controller = new AbortController()
    setRouteLoading(true)
    const pickup = pickupPoint
    const destination = destinationPoint

    async function loadRoute() {
      const tripRoute = await fetchDrivingRoute(pickup, destination, controller.signal)
      if (!tripRoute) {
        setTripRouteCoordinates(null)
        setApproachRouteCoordinates(null)
        setTravelMinutesToPickup(null)
        setTravelMinutesTrip(null)
        setDistanceKmToPickup(null)
        setDistanceKmTrip(null)
        return
      }

      setTravelMinutesTrip(Math.max(1, Math.round(tripRoute.durationSeconds / 60)))
      setDistanceKmTrip(tripRoute.distanceMeters / 1000)
      setTripRouteCoordinates(tripRoute.geometry)

      const currentOrigin = driverOrigin
      if (currentOrigin) {
        const toPickupRoute = await fetchDrivingRoute(currentOrigin, pickup, controller.signal).catch(() => null)
        if (toPickupRoute) {
          setTravelMinutesToPickup(Math.max(1, Math.round(toPickupRoute.durationSeconds / 60)))
          setDistanceKmToPickup(toPickupRoute.distanceMeters / 1000)
          setApproachRouteCoordinates(toPickupRoute.geometry)
          return
        }
      }

      setTravelMinutesToPickup(null)
      setDistanceKmToPickup(null)
      setApproachRouteCoordinates(null)
    }

    void loadRoute()
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error('Failed to load ride offer route preview', error)
        setTripRouteCoordinates(null)
        setApproachRouteCoordinates(null)
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
  }, [destinationPoint, driverOrigin, open, pickupPoint])

  if (!open || !item || !pickupPoint || !destinationPoint) {
    return null
  }

  const distanceKm = Number(item.routeDistanceKm) || 0
  const yourOfferCents = Math.max(perKmFeeCents, Math.round(distanceKm * perKmFeeCents))
  const customerPaysCents = yourOfferCents + RIDE_OFFER_CIVIL_FEE_CENTS
  const driverKeepPercent = customerPaysCents > 0 ? (yourOfferCents / customerPaysCents) * 100 : 0
  const pickupLabel = formatCanadianPhysicalAddressInline(item.pickupAddress) || 'Pickup pending'
  const destinationLabel = formatCanadianPhysicalAddressInline(item.dropoffAddress) || 'Destination pending'
  const pickupAtMs = new Date(item.pickupAt).getTime()
  const pickupInLabel = !Number.isFinite(pickupAtMs)
    ? 'Unavailable'
    : pickupAtMs <= currentTimeMs + 15 * 60_000
      ? 'As soon as possible'
      : formatTripTimeLabel((pickupAtMs - currentTimeMs) / 60_000)
  const totalTripMinutes = travelMinutesToPickup !== null && travelMinutesTrip !== null ? travelMinutesToPickup + travelMinutesTrip : null
  const totalTripDistanceKm = distanceKmToPickup !== null && distanceKmTrip !== null ? distanceKmToPickup + distanceKmTrip : distanceKmTrip
  const effectiveTripMinutes = totalTripMinutes ?? travelMinutesTrip
  const hourlyEarningsCents = effectiveTripMinutes && effectiveTripMinutes > 0 ? Math.round((yourOfferCents * 60) / effectiveTripMinutes) : null
  const submitLabel = item.isBidByViewer ? 'Update Offer' : 'Submit Offer'

  return (
    <Modal open={open} onClose={onClose} title="Make Offer" maxWidthClassName="max-w-5xl">
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[1.6rem] border border-slate-200">
              <AddressDirectionsMap
                origin={driverOrigin ?? pickupPoint}
                destination={destinationPoint}
                routeCoordinates={tripRouteCoordinates}
                approachRouteCoordinates={approachRouteCoordinates}
                waypoints={driverOrigin ? [{ ...pickupPoint, kind: 'pickup' }] : null}
                showOriginAvatar={Boolean(driverOrigin)}
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
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-950">Route Planning</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup time</p>
                  <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <HiOutlineCalendarDays className="h-4 w-4 text-slate-400" />
                    {formatDriveDateTime(item.pickupAt)}
                  </p>
                </div>
                <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup in</p>
                  <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <HiOutlineClock className="h-4 w-4 text-slate-400" />
                    {pickupInLabel}
                  </p>
                </div>
                <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">To pickup</p>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-600">Time to pickup</span>
                      <span className="font-semibold text-slate-950">
                        {routeLoading ? 'Loading current location…' : driverOrigin ? formatTripTimeLabel(travelMinutesToPickup) : 'Location unavailable'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-600">Pickup to Dropoff</span>
                      <span className="font-semibold text-slate-950">{routeLoading ? 'Loading route…' : formatTripTimeLabel(travelMinutesTrip)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-amber-200 pt-3">
                      <span className="text-slate-600">Total trip time</span>
                      <span className="font-semibold text-slate-950">
                        {routeLoading ? 'Loading route…' : driverOrigin ? formatTripTimeLabel(totalTripMinutes) : 'Location unavailable'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-600">Total distance</span>
                      <span className="font-semibold text-slate-950">{routeLoading ? 'Loading route…' : formatDistanceLabel(totalTripDistanceKm)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4">
              <div className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-950">Your Offer</span>
                  <span className="text-2xl font-semibold text-slate-950">
                    {formatDriveMoney(perKmFeeCents)}
                    <span className="ml-1 text-sm font-medium text-slate-500">/ km</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={RIDE_OFFER_PER_KM_MIN_CENTS}
                  max={RIDE_OFFER_PER_KM_MAX_CENTS}
                  step={5}
                  value={perKmFeeCents}
                  onChange={(event) => setPerKmFeeCents(clampPerKmFeeCents(Number(event.target.value) || RIDE_OFFER_PER_KM_MIN_CENTS))}
                  className="h-3 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[var(--cc-primary)]"
                />
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>$1.00 / km</span>
                  <span>$5.00 / km</span>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-emerald-900">Customer pays</span>
                  <span className="text-lg font-semibold text-emerald-950">{formatDriveMoney(customerPaysCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-emerald-900">Civil Fee</span>
                  <span className="font-semibold text-emerald-950">{formatDriveMoney(RIDE_OFFER_CIVIL_FEE_CENTS)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-emerald-900">You Keep</span>
                  <span className="font-semibold text-emerald-950">{formatFareSharePercent(driverKeepPercent)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-emerald-200 pt-3">
                  <span className="text-sm font-semibold text-emerald-950">You earn</span>
                  <span className="text-2xl font-semibold text-emerald-950">{formatDriveMoney(yourOfferCents)}</span>
                </div>
                <div className="text-right text-sm font-semibold text-emerald-800">{formatHourlyEarningsLabel(hourlyEarningsCents)}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void onSubmit(item, perKmFeeCents)
              }}
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
