'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  HiOutlineCheckCircle,
  HiOutlineClock,
  HiOutlineCube,
  HiOutlineMapPin,
  HiOutlineTruck,
  HiOutlineUserCircle,
  HiOutlineXCircle,
} from 'react-icons/hi2'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import {
  canEditDriveRideStatus,
  canCancelDriveStatus,
  formatDriveDate,
  formatDriveDateTime,
  formatDriveDeliveryViewerRole,
  formatDriveLocation,
  formatDriveMoney,
  formatDrivePersonName,
  formatDriveRelativePickupTime,
  formatDriveRecurrence,
  formatDriveStatus,
  getAvatarInitials,
  getDriveStatusTone,
  type DriveDeliveryItem,
  type DriveRideRequestItem,
} from './driveShared'

function DriveTableState({
  title,
  countLabel,
  loading,
  error,
  emptyMessage,
  children,
}: {
  title: string
  countLabel?: string | null
  loading: boolean
  error: string | null
  emptyMessage: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
        {countLabel ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{countLabel}</span> : null}
      </div>

      {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading…</div> : null}

      {!loading && !error ? children : null}

      {!loading && !error && !children ? (
        <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">{emptyMessage}</div>
      ) : null}
    </section>
  )
}

function PersonAvatar({
  name,
  avatarUrl,
}: {
  name: string
  avatarUrl?: string | null
}) {
  const initials = getAvatarInitials(name)

  return avatarUrl ? (
    <img src={avatarUrl} alt={name} className="h-12 w-12 rounded-2xl border border-white/80 object-cover shadow-sm" />
  ) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
      {initials}
    </div>
  )
}

function QueueFact({
  label,
  icon,
  value,
}: {
  label: string
  icon: ReactNode
  value: ReactNode
}) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className="mt-2 flex items-start gap-2">
        <span className="mt-0.5 text-slate-400">{icon}</span>
        <div className="text-sm font-medium leading-6 text-slate-900">{value}</div>
      </div>
    </div>
  )
}

function RouteStop({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'pickup' | 'dropoff'
}) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
      <div className="flex gap-3">
        <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${tone === 'pickup' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-2 text-base font-semibold leading-7 text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  )
}

function OpenQueueStack({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>
}

function HistorySquareMedia({
  imageUrl,
  alt,
  fallbackIcon,
}: {
  imageUrl?: string | null
  alt: string
  fallbackIcon: ReactNode
}) {
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-100 shadow-sm">
      {imageUrl ? <img src={imageUrl} alt={alt} className="h-full w-full object-cover" /> : <div className="text-slate-400">{fallbackIcon}</div>}
    </div>
  )
}

function HistoryCardFact({
  label,
  value,
  icon,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className="mt-2 flex items-start gap-2 text-sm font-medium leading-6 text-slate-900">
        <span className="mt-0.5 text-slate-400">{icon}</span>
        <div>{value}</div>
      </div>
    </div>
  )
}

function MineRideHistoryCard({
  item,
  onCancel,
  cancelingId,
  getEditHref,
  getOffersHref,
  onMarkComplete,
  completingId,
}: {
  item: DriveRideRequestItem
  onCancel?: (item: DriveRideRequestItem) => void
  cancelingId?: string | null
  getEditHref?: (item: DriveRideRequestItem) => string | null
  getOffersHref?: (item: DriveRideRequestItem) => string | null
  onMarkComplete?: (item: DriveRideRequestItem) => void
  completingId?: string | null
}) {
  const pickupLabel = formatCanadianPhysicalAddressInline(item.pickupAddress) ?? 'Pickup pending'
  const dropoffLabel = formatCanadianPhysicalAddressInline(item.dropoffAddress) ?? 'Destination pending'
  const canCancel = canCancelDriveStatus(item.status)
  const editHref = getEditHref?.(item) ?? null
  const canEdit = canEditDriveRideStatus(item.status) && Boolean(editHref)
  const offersHref = getOffersHref?.(item) ?? null
  const rideIsTerminal = isTerminalRideStatus(item.status)
  const hasAcceptedOffer = item.viewerRole === 'requester' && Boolean(item.acceptedOfferId) && Boolean(offersHref) && !rideIsTerminal
  const hasOffers = item.offerCount > 0 && Boolean(offersHref)
  const offersLabel = rideIsTerminal ? 'View Ride' : hasAcceptedOffer ? 'Accepted' : item.offerCount === 1 ? 'View 1 offer' : `View ${item.offerCount} offers`
  const riderHasFinalPrice = item.viewerRole === 'requester' && Boolean(item.acceptedOfferId || rideIsTerminal || item.acceptedOfferAmountCents)
  const costLabel = riderHasFinalPrice ? 'Paid' : item.viewerRole === 'driver' ? 'Payout' : 'Ride total'
  const costAmountCents = item.viewerRole === 'driver' ? item.acceptedOfferAmountCents ?? item.driverFeeCents ?? item.totalCostCents : item.totalCostCents
  const canMarkComplete =
    item.viewerRole === 'driver' &&
    Boolean(onMarkComplete) &&
    ['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route', 'driver_arrived', 'arrived', 'picked_up', 'in_progress'].includes(
      item.status.trim().toLowerCase(),
    )

  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <HistorySquareMedia
              imageUrl={item.driverVehicle?.photoUrl ?? null}
              alt={item.driverVehicle?.name || 'Driver vehicle'}
              fallbackIcon={<HiOutlineMapPin className="h-9 w-9" />}
            />
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-slate-950">{pickupLabel}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">To {dropoffLabel}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                  {item.viewerRole === 'driver' ? 'Drive job' : 'Your ride'}
                </span>
                <span>{item.driverVehicle?.name || 'Vehicle details'}</span>
                <span aria-hidden="true">•</span>
                <span>{formatDriveDateTime(item.pickupAt)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasOffers && offersHref ? (
              <Link
                href={offersHref}
                className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 ${
                  rideIsTerminal
                    ? 'bg-slate-900 shadow-[0_12px_26px_rgba(15,23,42,0.18)]'
                    : hasAcceptedOffer
                      ? 'bg-emerald-600 shadow-[0_12px_26px_rgba(5,150,105,0.22)]'
                      : 'bg-[var(--cc-primary)] shadow-[0_12px_26px_rgba(220,38,38,0.24)] motion-safe:animate-pulse'
                }`}
              >
                {offersLabel}
              </Link>
            ) : null}
            <StatusBadge value={item.status} />
            {item.viewerRole === 'requester' && rideIsTerminal && (item.tippedAmountCents ?? 0) > 0 ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Tipped {formatDriveMoney(item.tippedAmountCents)}
              </span>
            ) : null}
            {hasOffers && !hasAcceptedOffer ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                {item.offerCount} {item.offerCount === 1 ? 'offer received' : 'offers received'}
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <HistoryCardFact label="Pickup" icon={<HiOutlineMapPin className="h-4 w-4" />} value={pickupLabel} />
          <HistoryCardFact label="Destination" icon={<HiOutlineMapPin className="h-4 w-4" />} value={dropoffLabel} />
          <HistoryCardFact label="Distance" icon={<HiOutlineTruck className="h-4 w-4" />} value={`${item.routeDistanceKm.toFixed(1)} km`} />
          <HistoryCardFact
            label={costLabel}
            icon={<HiOutlineCheckCircle className="h-4 w-4" />}
            value={
              <div>
                <div>{formatDriveMoney(costAmountCents)}</div>
                {item.viewerRole === 'requester' && (item.tippedAmountCents ?? 0) > 0 ? (
                  <div className="mt-1 text-xs font-semibold text-emerald-700">Tip {formatDriveMoney(item.tippedAmountCents)}</div>
                ) : null}
              </div>
            }
          />
        </div>

        {(canMarkComplete && onMarkComplete) || canEdit || (canCancel && onCancel) ? (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-1">
            {canMarkComplete && onMarkComplete ? (
              <button
                type="button"
                onClick={() => onMarkComplete(item)}
                disabled={completingId === item.id}
                className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {completingId === item.id ? 'Marking…' : 'Mark Complete'}
              </button>
            ) : null}
            {canEdit && editHref ? (
              <Link
                href={editHref}
                className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
              >
                Edit
              </Link>
            ) : null}
            {canCancel && onCancel ? (
              <button
                type="button"
                onClick={() => onCancel(item)}
                disabled={cancelingId === item.id}
                className="inline-flex rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelingId === item.id ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function MineDeliveryHistoryCard({
  item,
  onCancel,
  cancelingId,
}: {
  item: DriveDeliveryItem
  onCancel?: (item: DriveDeliveryItem) => void
  cancelingId?: string | null
}) {
  const pickupLabel = [item.pickupCity?.trim(), item.pickupProvince?.trim()].filter(Boolean).join(', ') || 'Pickup pending'
  const canCancel = canCancelDriveStatus(item.status)

  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <HistorySquareMedia
              imageUrl={item.listingPhotoUrl}
              alt={item.listingTitle}
              fallbackIcon={<HiOutlineCube className="h-9 w-9" />}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Marketplace delivery</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950">{item.listingTitle}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{item.pickupInstructions?.trim() || 'Pickup details will appear here once handling notes are shared.'}</p>
              <div className="mt-3 text-xs text-slate-500">{formatDriveDateTime(item.createdAt)}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge value={item.status} />
            {item.bidPending ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Bid pending</span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <HistoryCardFact label="Pickup" icon={<HiOutlineMapPin className="h-4 w-4" />} value={pickupLabel} />
          <HistoryCardFact label="Role" icon={<HiOutlineUserCircle className="h-4 w-4" />} value={formatDriveDeliveryViewerRole(item.viewerRole)} />
          <HistoryCardFact label="Bid" icon={<HiOutlineTruck className="h-4 w-4" />} value={item.bidAmountCents ? formatDriveMoney(item.bidAmountCents) : 'No bid yet'} />
          <HistoryCardFact label="Posted" icon={<HiOutlineClock className="h-4 w-4" />} value={formatDriveDateTime(item.createdAt)} />
        </div>

        {item.itemTraits.length ? (
          <div className="flex flex-wrap gap-2">
            {item.itemTraits.slice(0, 5).map((trait) => (
              <span key={trait} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                {trait}
              </span>
            ))}
          </div>
        ) : null}

        {canCancel && onCancel ? (
          <div className="border-t border-slate-100 pt-1">
            <button
              type="button"
              onClick={() => onCancel(item)}
              disabled={cancelingId === item.id}
              className="inline-flex rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelingId === item.id ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function DriveRideQueueCard({
  item,
  onMakeOffer,
  submittingOfferId,
}: {
  item: DriveRideRequestItem
  onMakeOffer?: (item: DriveRideRequestItem) => void
  submittingOfferId?: string | null
}) {
  const requesterLabel = formatDrivePersonName(item.requester)
  const pickupLabel = formatCanadianPhysicalAddressInline(item.pickupAddress) ?? 'Pickup pending'
  const dropoffLabel = formatCanadianPhysicalAddressInline(item.dropoffAddress) ?? 'Destination pending'
  const pickupTimingLabel = formatDriveRelativePickupTime(item.pickupAt)
  const offerPending = item.bidPending && item.isBidByViewer
  const actionLabel = offerPending ? 'Edit Offer' : 'Make Offer'

  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(255,246,246,0.95),rgba(248,250,252,0.98))] px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PersonAvatar name={requesterLabel} avatarUrl={item.requester.avatarUrl} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Ride request</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950">{requesterLabel}</h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={item.status} />
            {offerPending && item.bidAmountCents ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                Offer pending at {formatDriveMoney(item.bidAmountCents)}
              </span>
            ) : null}
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
              {formatDriveRecurrence(item.recurrence)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]">
        <div className="space-y-3">
          <RouteStop label="Pickup" value={pickupLabel} tone="pickup" />
          <RouteStop label="Destination" value={dropoffLabel} tone="dropoff" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          <QueueFact
            label="Pickup time"
            icon={<HiOutlineClock className="h-4 w-4" />}
            value={
              <div>
                <p className="font-semibold text-slate-950">{pickupTimingLabel}</p>
                <p className="text-sm text-slate-500">{formatDriveDateTime(item.pickupAt)}</p>
              </div>
            }
          />
          <QueueFact
            label="Distance"
            icon={<HiOutlineMapPin className="h-4 w-4" />}
            value={`${item.routeDistanceKm.toFixed(1)} km`}
          />
          <QueueFact
            label="Posted"
            icon={<HiOutlineClock className="h-4 w-4" />}
            value={formatDriveDate(item.createdAt)}
          />
          <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Estimated cost</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-950">{formatDriveMoney(item.totalCostCents)}</p>
          </div>
          {onMakeOffer ? (
            <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4 sm:col-span-2 xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{offerPending ? 'Your offer is waiting on the customer.' : 'Set your per km offer for this route.'}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {offerPending && item.bidPerKmFeeCents
                      ? `${formatDriveMoney(item.bidPerKmFeeCents)}/km currently offered`
                      : 'The modal will show the route, pickup time, and what you earn.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onMakeOffer(item)}
                  disabled={submittingOfferId === item.id}
                  className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingOfferId === item.id ? 'Submitting…' : actionLabel}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function DriveDeliveryQueueCard({ item }: { item: DriveDeliveryItem }) {
  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="grid gap-0 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="relative min-h-[15rem] bg-slate-100">
          {item.listingPhotoUrl ? (
            <img src={item.listingPhotoUrl} alt={item.listingTitle} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-400">
              <HiOutlineCube className="h-12 w-12" />
            </div>
          )}
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Delivery request</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950">{item.listingTitle}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={item.status} />
              {item.bidPending ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                  Bid pending
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <QueueFact
              label="Pickup"
              icon={<HiOutlineMapPin className="h-4 w-4" />}
              value={formatDriveLocation(item.pickupCity, item.pickupProvince)}
            />
            <QueueFact
              label="Buyer"
              icon={<HiOutlineUserCircle className="h-4 w-4" />}
              value={formatDrivePersonName(item.buyer)}
            />
            <QueueFact
              label="Seller"
              icon={<HiOutlineUserCircle className="h-4 w-4" />}
              value={formatDrivePersonName(item.seller)}
            />
            <QueueFact
              label="Posted"
              icon={<HiOutlineClock className="h-4 w-4" />}
              value={formatDriveDate(item.createdAt)}
            />
            <QueueFact
              label="Bid"
              icon={<HiOutlineTruck className="h-4 w-4" />}
              value={item.bidAmountCents ? formatDriveMoney(item.bidAmountCents) : 'No bid yet'}
            />
          </div>

          {item.itemTraits.length ? (
            <div className="flex flex-wrap gap-2">
              {item.itemTraits.slice(0, 5).map((trait) => (
                <span key={trait} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  {trait}
                </span>
              ))}
            </div>
          ) : null}

          <p className="text-sm leading-6 text-slate-600">
            {item.pickupInstructions?.trim() || 'Pickup details will appear here once the buyer shares handling notes.'}
          </p>
        </div>
      </div>
    </article>
  )
}

function getStatusIcon(value: string | null | undefined) {
  switch ((value || '').trim().toLowerCase()) {
    case 'accepted':
    case 'assigned':
    case 'matched':
    case 'driver_selected':
      return HiOutlineUserCircle
    case 'driver_en_route':
    case 'en_route':
    case 'picked_up':
    case 'in_progress':
    case 'inprogress':
      return HiOutlineTruck
    case 'driver_arrived':
    case 'arrived':
      return HiOutlineMapPin
    case 'delivered':
    case 'completed':
      return HiOutlineCheckCircle
    case 'cancelled':
    case 'canceled':
    case 'rejected':
    case 'declined':
    case 'failed':
      return HiOutlineXCircle
    case 'open':
    case 'bid_pending':
    default:
      return HiOutlineClock
  }
}

function StatusBadge({ value }: { value: string | null | undefined }) {
  const Icon = getStatusIcon(value)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${getDriveStatusTone(value)}`}>
      <Icon className="h-4 w-4 shrink-0" />
      {formatDriveStatus(value)}
    </span>
  )
}

function isTerminalRideStatus(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return ['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(normalized)
}

export function DriveDriverAccessGate({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="max-w-2xl space-y-3">
        <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
        <p className="text-sm leading-6 text-slate-600">{description}</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/drive/onboarding" className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95">
            Drive and deliver for Civil
          </Link>
          <Link href="/drive" className="inline-flex rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900">
            Back to My Rides
          </Link>
        </div>
      </div>
    </section>
  )
}

export function DriveRideTable({
  title,
  items,
  total,
  loading,
  error,
  emptyMessage,
  variant,
  onCancel,
  cancelingId,
  onMakeOffer,
  submittingOfferId,
  getEditHref,
  getOffersHref,
  onMarkComplete,
  completingId,
}: {
  title: string
  items: DriveRideRequestItem[]
  total?: number
  loading: boolean
  error: string | null
  emptyMessage: string
  variant: 'mine' | 'open'
  onCancel?: (item: DriveRideRequestItem) => void
  cancelingId?: string | null
  onMakeOffer?: (item: DriveRideRequestItem) => void
  submittingOfferId?: string | null
  getEditHref?: (item: DriveRideRequestItem) => string | null
  getOffersHref?: (item: DriveRideRequestItem) => string | null
  onMarkComplete?: (item: DriveRideRequestItem) => void
  completingId?: string | null
}) {
  const countLabel = !loading ? `${typeof total === 'number' ? total : items.length} ${variant === 'open' ? 'live' : 'total'}` : null

  return (
    <DriveTableState title={title} countLabel={countLabel} loading={loading} error={error} emptyMessage={emptyMessage}>
      {variant === 'open' && items.length ? (
        <OpenQueueStack>
          {items.map((item) => (
            <DriveRideQueueCard key={item.id} item={item} onMakeOffer={onMakeOffer} submittingOfferId={submittingOfferId} />
          ))}
        </OpenQueueStack>
      ) : null}

      {variant === 'mine' && items.length ? (
        <OpenQueueStack>
          {items.map((item) => (
            <MineRideHistoryCard
              key={item.id}
              item={item}
              onCancel={onCancel}
              cancelingId={cancelingId}
              getEditHref={getEditHref}
              getOffersHref={getOffersHref}
              onMarkComplete={onMarkComplete}
              completingId={completingId}
            />
          ))}
        </OpenQueueStack>
      ) : null}
    </DriveTableState>
  )
}

export function DriveDeliveryTable({
  title,
  items,
  total,
  loading,
  error,
  emptyMessage,
  variant,
  onCancel,
  cancelingId,
}: {
  title: string
  items: DriveDeliveryItem[]
  total?: number
  loading: boolean
  error: string | null
  emptyMessage: string
  variant: 'mine' | 'open'
  onCancel?: (item: DriveDeliveryItem) => void
  cancelingId?: string | null
}) {
  const countLabel = !loading ? `${typeof total === 'number' ? total : items.length} ${variant === 'open' ? 'live' : 'total'}` : null

  return (
    <DriveTableState title={title} countLabel={countLabel} loading={loading} error={error} emptyMessage={emptyMessage}>
      {variant === 'open' && items.length ? (
        <OpenQueueStack>
          {items.map((item) => (
            <DriveDeliveryQueueCard key={item.id} item={item} />
          ))}
        </OpenQueueStack>
      ) : null}

      {variant === 'mine' && items.length ? (
        <OpenQueueStack>
          {items.map((item) => (
            <MineDeliveryHistoryCard key={item.id} item={item} onCancel={onCancel} cancelingId={cancelingId} />
          ))}
        </OpenQueueStack>
      ) : null}
    </DriveTableState>
  )
}
