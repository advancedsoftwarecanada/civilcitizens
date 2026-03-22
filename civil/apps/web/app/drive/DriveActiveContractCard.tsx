'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HiOutlineCalendarDays, HiOutlineCheckCircle, HiOutlineClock, HiOutlineExclamationTriangle, HiOutlineMap, HiOutlineMapPin } from 'react-icons/hi2'
import CivilCard from '../_components/CivilCard'
import { fetchDrivingRoute } from '../_lib/addressSearch'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import {
  formatDriveDateTime,
  getDrivePickupTimingStatus,
  formatDrivePersonName,
  formatDriveRelativePickupTime,
  formatDriveStatus,
  getAvatarInitials,
  getDriveStatusTone,
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

export default function DriveActiveContractCard({ item }: { item: DriveRideRequestItem }) {
  const riderLabel = formatDrivePersonName(item.requester)
  const riderHandle = item.requester.handle?.trim() ?? ''
  const pickupLabel = formatCanadianPhysicalAddressInline(item.pickupAddress) || 'Pickup pending'
  const destinationLabel = formatCanadianPhysicalAddressInline(item.dropoffAddress) || 'Destination pending'
  const pickupTimingLabel = formatDriveRelativePickupTime(item.pickupAt)
  const pickupPoint = useMemo(() => buildMapPoint(item.pickupAddress, 'Pickup'), [item.pickupAddress])
  const driverPoint = useMemo(() => buildMapPoint(item.driverLocation, 'Your location'), [item.driverLocation])
  const [travelMinutesToPickup, setTravelMinutesToPickup] = useState<number | null>(null)

  useEffect(() => {
    if (!pickupPoint || !driverPoint) {
      setTravelMinutesToPickup(null)
      return
    }

    const controller = new AbortController()

    void fetchDrivingRoute(driverPoint, pickupPoint, controller.signal)
      .then((route) => {
        if (!route || controller.signal.aborted) {
          if (!controller.signal.aborted) setTravelMinutesToPickup(null)
          return
        }
        setTravelMinutesToPickup(Math.max(1, Math.round(route.durationSeconds / 60)))
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error('Failed to load active contract pickup timing', error)
        setTravelMinutesToPickup(null)
      })

    return () => controller.abort()
  }, [driverPoint, pickupPoint])

  const pickupTimingStatus = getDrivePickupTimingStatus(item.pickupAt, travelMinutesToPickup)
  const pickupTimingTone =
    pickupTimingStatus?.state === 'late'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : pickupTimingStatus?.state === 'early'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-sky-200 bg-sky-50 text-sky-700'
  const PickupTimingIcon = pickupTimingStatus?.state === 'late' ? HiOutlineExclamationTriangle : HiOutlineCheckCircle

  return (
    <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(19rem,0.88fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Assigned Ride</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-950">Active Contract</h3>
            </div>
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getDriveStatusTone(item.status)}`}>
              {formatDriveStatus(item.status)}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Pickup</p>
              <div className="mt-2 flex items-start gap-2">
                <HiOutlineMapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <p className="text-sm font-medium leading-6 text-slate-900">{pickupLabel}</p>
              </div>
            </div>
            <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Destination</p>
              <div className="mt-2 flex items-start gap-2">
                <HiOutlineMapPin className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <p className="text-sm font-medium leading-6 text-slate-900">{destinationLabel}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup time</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
              <HiOutlineClock className="h-4 w-4 text-slate-400" />
              {pickupTimingLabel}
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
              <HiOutlineCalendarDays className="h-4 w-4 text-slate-400" />
              {formatDriveDateTime(item.pickupAt)}
            </p>
          </div>

          {pickupTimingStatus ? (
            <div className={`rounded-[1.35rem] border px-4 py-3 ${pickupTimingTone}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Pickup timing</p>
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold">
                <PickupTimingIcon className="h-4 w-4" />
                {pickupTimingStatus.label}
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4 shadow-[0_18px_54px_rgba(14,165,233,0.10)]">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Rider</p>
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/85 px-3 py-1 text-xs font-semibold text-sky-700">
              Live
            </span>
          </div>

          <CivilCard
            size="md"
            name={riderLabel}
            avatarAlt={riderLabel}
            avatarSrc={item.requester.avatarUrl}
            avatarInitials={getAvatarInitials(riderLabel)}
            href={riderHandle ? `/u/${encodeURIComponent(riderHandle)}` : undefined}
            titleLines={0}
            subtitleLines={0}
            className="border-white/35 shadow-[0_16px_42px_rgba(15,23,42,0.12)]"
          />

          {!item.contractStartedAt ? (
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <p className="text-sm font-semibold">Contract not started yet.</p>
              <p className="mt-1 text-sm text-amber-800">Start the contract so the rider can see you are on the way.</p>
            </div>
          ) : null}

          <Link
            href={`/drive/${encodeURIComponent(item.id)}/contract`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
          >
            <HiOutlineMap className="h-4 w-4 shrink-0" />
            Start Contract
          </Link>
        </div>
      </div>
    </section>
  )
}
