'use client'

import Link from 'next/link'
import Block from '../_components/Block'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import { formatDriveLocation, formatDriveMoney, type DriveDeliveryItem, type DriveRideRequestItem } from './driveShared'

type ContractHistoryEntry =
  | {
      id: string
      type: 'ride'
      href: string
      title: string
      pickup: string
      earningsCents: number
      sortAt: number
    }
  | {
      id: string
      type: 'delivery'
      href: string
      title: string
      pickup: string
      earningsCents: number
      sortAt: number
    }

function buildRideHistoryEntry(item: DriveRideRequestItem): ContractHistoryEntry | null {
  if (item.viewerRole !== 'driver' || !item.acceptedOfferId) return null

  const pickup = formatCanadianPhysicalAddressInline(item.pickupAddress) || 'Pickup pending'
  const earningsCents = item.acceptedOfferAmountCents ?? item.bidAmountCents ?? 0
  const pickupAt = new Date(item.pickupAt)
  const createdAt = new Date(item.createdAt)

  return {
    id: item.id,
    type: 'ride',
    href: `/drive/${encodeURIComponent(item.id)}/contract`,
    title: 'Ride Contract',
    pickup,
    earningsCents,
    sortAt: Number.isFinite(pickupAt.getTime()) ? pickupAt.getTime() : createdAt.getTime(),
  }
}

function buildDeliveryHistoryEntry(item: DriveDeliveryItem): ContractHistoryEntry | null {
  if (item.viewerRole !== 'driver') return null

  const pickup = formatDriveLocation(item.pickupCity, item.pickupProvince)
  const createdAt = new Date(item.createdAt)

  return {
    id: item.id,
    type: 'delivery',
    href: '/delivery/my',
    title: item.listingTitle || 'Delivery Contract',
    pickup,
    earningsCents: item.bidAmountCents ?? 0,
    sortAt: Number.isFinite(createdAt.getTime()) ? createdAt.getTime() : 0,
  }
}

export default function DriveContractHistoryRail({
  rides,
  delivery,
  activeRideIds,
}: {
  rides: DriveRideRequestItem[]
  delivery: DriveDeliveryItem[]
  activeRideIds?: string[]
}) {
  const activeRideIdSet = new Set(activeRideIds ?? [])

  const items = [
    ...rides
      .filter((item) => !activeRideIdSet.has(item.id))
      .map(buildRideHistoryEntry)
      .filter((item): item is ContractHistoryEntry => Boolean(item)),
    ...delivery.map(buildDeliveryHistoryEntry).filter((item): item is ContractHistoryEntry => Boolean(item)),
  ]
    .sort((left, right) => right.sortAt - left.sortAt)
    .slice(0, 5)

  return (
    <Block title="Contract History" action={{ label: 'View all', href: '/delivery/my' }}>
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <Link
              key={`${item.type}-${item.id}`}
              href={item.href}
              className="block rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3 transition hover:border-[var(--cc-primary)]/20 hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {item.type === 'ride' ? 'Ride' : 'Delivery'}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Review
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup</p>
                  <p className="mt-1 text-sm font-medium leading-6 text-slate-900">{item.pickup}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Earnings</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-700">{formatDriveMoney(item.earningsCents)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No recent contract history yet.</p>
      )}
    </Block>
  )
}
