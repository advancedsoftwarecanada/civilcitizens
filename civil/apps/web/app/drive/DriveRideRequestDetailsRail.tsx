'use client'

import Block from '../_components/Block'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import {
  canEditDriveRideStatus,
  formatDriveDateTime,
  formatDriveMoney,
  formatDriveStatus,
  getDriveStatusTone,
  type DriveRideRequestItem,
} from './driveShared'

export default function DriveRideRequestDetailsRail({ item }: { item: DriveRideRequestItem | null }) {
  if (!item) return null

  const pickupLabel = formatCanadianPhysicalAddressInline(item.pickupAddress) ?? 'Pickup pending'
  const destinationLabel = formatCanadianPhysicalAddressInline(item.dropoffAddress) ?? 'Destination pending'

  return (
    <Block
      title="Ride Request"
      action={canEditDriveRideStatus(item.status) ? { label: 'Edit', href: `/drive/ride/request/${item.id}` } : undefined}
      actionVariant="pill"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getDriveStatusTone(item.status)}`}>
            {formatDriveStatus(item.status)}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {item.offerCount} {item.offerCount === 1 ? 'offer' : 'offers'}
          </span>
        </div>

        <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50/70 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Pickup</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-950">{pickupLabel}</p>
        </div>

        <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50/70 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Destination</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-950">{destinationLabel}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup time</p>
            <p className="mt-2 text-sm font-semibold text-slate-950">{formatDriveDateTime(item.pickupAt)}</p>
          </div>
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Estimated cost</p>
            <p className="mt-2 text-sm font-semibold text-slate-950">{formatDriveMoney(item.totalCostCents)}</p>
          </div>
        </div>
      </div>
    </Block>
  )
}
