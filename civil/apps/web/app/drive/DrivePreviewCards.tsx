'use client'

import type { ReactNode } from 'react'
import { HiOutlineCalendarDays, HiOutlineCube, HiOutlineMapPin, HiOutlineShieldCheck, HiOutlineTruck } from 'react-icons/hi2'
import CivilCard from '../_components/CivilCard'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import {
  formatDriveDate,
  formatDriveDateTime,
  formatDriveLocation,
  formatDriveMoney,
  formatDrivePersonName,
  formatDriveRecurrence,
  getAvatarInitials,
  type DriveDeliveryItem,
  type DriveDriverItem,
  type DriveRideRequestItem,
} from './driveShared'

export function DriveCardSkeleton() {
  return <div className="h-56 animate-pulse rounded-[1.7rem] border border-slate-200 bg-white/80 shadow-sm" aria-hidden="true" />
}

export function DriveRidePreviewCard({ item }: { item: DriveRideRequestItem }) {
  const requesterLabel = item.isOwner ? 'You' : formatDrivePersonName(item.requester)

  return (
    <article className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Ride request</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-950">{requesterLabel}</h3>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
          {formatDriveRecurrence(item.recurrence)}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup</p>
          <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900">
            {formatCanadianPhysicalAddressInline(item.pickupAddress) ?? 'Pickup pending'}
          </p>
        </div>
        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Dropoff</p>
          <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900">
            {formatCanadianPhysicalAddressInline(item.dropoffAddress) ?? 'Dropoff pending'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <HiOutlineCalendarDays className="h-4 w-4" />
          {formatDriveDateTime(item.pickupAt)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <HiOutlineMapPin className="h-4 w-4" />
          {item.routeDistanceKm.toFixed(1)} km
        </span>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Total cost</p>
          <p className="mt-1 text-sm text-emerald-900">Posted {formatDriveDate(item.createdAt)}</p>
        </div>
        <p className="text-2xl font-semibold text-emerald-950">{formatDriveMoney(item.totalCostCents)}</p>
      </div>
    </article>
  )
}

export function DriveDeliveryPreviewCard({ item }: { item: DriveDeliveryItem }) {
  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative h-40 w-full bg-slate-100">
        {item.listingPhotoUrl ? (
          <img src={item.listingPhotoUrl} alt={item.listingTitle} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            <HiOutlineCube className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Delivery request</p>
            <h3 className="mt-2 line-clamp-2 text-lg font-semibold text-slate-950">{item.listingTitle}</h3>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${item.bidPending ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {item.bidPending ? 'Bid pending' : 'Open'}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <HiOutlineMapPin className="h-4 w-4" />
            {formatDriveLocation(item.pickupCity, item.pickupProvince)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HiOutlineTruck className="h-4 w-4" />
            Posted {formatDriveDate(item.createdAt)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {item.itemTraits.length ? (
            item.itemTraits.slice(0, 3).map((trait) => (
              <span key={trait} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                {trait}
              </span>
            ))
          ) : (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              No handling notes
            </span>
          )}
        </div>

        <p className="line-clamp-3 text-sm leading-6 text-slate-600">
          {item.pickupInstructions?.trim() || `Buyer: ${formatDrivePersonName(item.buyer)}. Seller: ${formatDrivePersonName(item.seller)}.`}
        </p>
      </div>
    </article>
  )
}

export function DriveDriverPreviewCard({ item, actions }: { item: DriveDriverItem; actions?: ReactNode }) {
  const displayName = item.name?.trim() || item.handle?.trim() || 'Civil driver'

  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <CivilCard
        size="hero"
        name={displayName}
        avatarAlt={displayName}
        avatarInitials={getAvatarInitials(displayName)}
        avatarSrc={item.avatarUrl}
        coverUrl={item.coverUrl}
        interactive={false}
        titleLines={0}
        subtitleLines={0}
        className="rounded-none border-0 shadow-none"
      />

      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-wrap gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <HiOutlineMapPin className="h-4 w-4" />
            {formatDriveLocation(item.city, item.province)}
          </span>
        </div>
        <div className="mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <HiOutlineShieldCheck className="h-4 w-4" />
            Verified
          </span>
        </div>
        {item.featuredVehicle?.photoUrl ? (
          <div className="mt-4 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-slate-50">
            <img src={item.featuredVehicle.photoUrl} alt={item.featuredVehicle.name} className="h-40 w-full object-cover" />
            <div className="space-y-2 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{item.featuredVehicle.name}</p>
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                  Min {formatDriveMoney(item.featuredVehicle.minimumRideAmountCents)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                  {formatDriveMoney(item.featuredVehicle.perKmFeeCents)}/km
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">
            {item.bio?.trim() || 'Civil driver profile is active and available on Drive.'}
          </p>
        )}
        {actions ? <div className="mt-5">{actions}</div> : null}
      </div>
    </article>
  )
}
