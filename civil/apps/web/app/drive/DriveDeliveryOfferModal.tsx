'use client'

import { useEffect, useState } from 'react'
import { HiOutlineClock, HiOutlineCube, HiOutlineMapPin, HiOutlineTruck } from 'react-icons/hi2'
import Modal from '../_components/Modal'
import { formatDriveDateTime, formatDriveMoney, type DriveDeliveryItem } from './driveShared'

const DELIVERY_PER_KM_MIN_CENTS = 100
const DELIVERY_PER_KM_MAX_CENTS = 500
const DELIVERY_QUICK_BID_OPTIONS = [100, 150, 200, 250, 300, 350] as const

function clampPerKmFeeCents(value: number) {
  return Math.max(DELIVERY_PER_KM_MIN_CENTS, Math.min(DELIVERY_PER_KM_MAX_CENTS, Math.round(value || DELIVERY_PER_KM_MIN_CENTS)))
}

function calculateBidAmountCents(item: DriveDeliveryItem, perKmFeeCents: number) {
  const routeDistanceKm = typeof item.routeDistanceKm === 'number' && Number.isFinite(item.routeDistanceKm) && item.routeDistanceKm > 0 ? item.routeDistanceKm : 1
  return Math.max(perKmFeeCents, Math.round(routeDistanceKm * perKmFeeCents))
}

export default function DriveDeliveryOfferModal({
  open,
  item,
  defaultPerKmFeeCents,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean
  item: DriveDeliveryItem | null
  defaultPerKmFeeCents: number
  submitting: boolean
  onClose: () => void
  onSubmit: (item: DriveDeliveryItem, perKmFeeCents: number) => void | Promise<void>
}) {
  const [perKmFeeCents, setPerKmFeeCents] = useState(clampPerKmFeeCents(defaultPerKmFeeCents))

  useEffect(() => {
    if (!item) return
    const nextPerKmFee = item.isBidByViewer && item.bidPerKmFeeCents ? item.bidPerKmFeeCents : defaultPerKmFeeCents
    setPerKmFeeCents(clampPerKmFeeCents(nextPerKmFee))
  }, [defaultPerKmFeeCents, item])

  if (!open || !item) return null

  const pickupLabel = item.pickupAddressLabel?.trim() || [item.pickupCity?.trim(), item.pickupProvince?.trim()].filter(Boolean).join(', ') || 'Pickup pending'
  const dropoffLabel = item.dropoffAddressLabel?.trim() || 'Dropoff shared after acceptance'
  const projectedAmountCents = calculateBidAmountCents(item, perKmFeeCents)
  const submitLabel = item.isBidByViewer ? 'Update Bid' : 'Submit Bid'

  return (
    <Modal open={open} onClose={onClose} title="Place Delivery Bid" maxWidthClassName="max-w-3xl">
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Listing</p>
            <div className="mt-3 flex items-start gap-3">
              <span className="mt-0.5 text-slate-400">
                <HiOutlineCube className="h-5 w-5" />
              </span>
              <div>
                <p className="text-base font-semibold text-slate-950">{item.listingTitle}</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">{item.pickupInstructions?.trim() || 'No extra pickup notes yet.'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Projected payout</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-950">{formatDriveMoney(projectedAmountCents)}</p>
            {item.routeDistanceKm ? <p className="mt-2 text-sm text-emerald-900/80">Based on {item.routeDistanceKm.toFixed(1)} km from pickup to dropoff.</p> : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup</p>
            <div className="mt-3 flex items-start gap-3 text-sm text-slate-900">
              <HiOutlineMapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
              <span>{pickupLabel}</span>
            </div>
          </div>
          <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Dropoff</p>
            <div className="mt-3 flex items-start gap-3 text-sm text-slate-900">
              <HiOutlineTruck className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
              <span>{dropoffLabel}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Your rate</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{formatDriveMoney(perKmFeeCents)}/km</p>
          </div>
          <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current bid</p>
            <p className="mt-3 text-lg font-semibold text-slate-950">{item.bidAmountCents ? formatDriveMoney(item.bidAmountCents) : 'No bid yet'}</p>
          </div>
          <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Posted</p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
              <HiOutlineClock className="h-4 w-4 text-slate-400" />
              {formatDriveDateTime(item.createdAt)}
            </p>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">Per km rate</p>
              <p className="mt-1 text-sm text-slate-500">The total bid is calculated from your rate and the estimated route.</p>
            </div>
            <input
              type="number"
              min={DELIVERY_PER_KM_MIN_CENTS}
              max={DELIVERY_PER_KM_MAX_CENTS}
              step={5}
              value={perKmFeeCents}
              onChange={(event) => setPerKmFeeCents(clampPerKmFeeCents(Number(event.target.value) || DELIVERY_PER_KM_MIN_CENTS))}
              className="w-32 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {DELIVERY_QUICK_BID_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPerKmFeeCents(option)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${perKmFeeCents === option ? 'bg-[var(--cc-primary)] text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
              >
                {formatDriveMoney(option)}/km
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(item, perKmFeeCents)}
            disabled={submitting}
            className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : submitLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}