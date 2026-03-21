'use client'

import Link from 'next/link'
import Block from '../_components/Block'

export default function DriveModeRail({
  isDriverActive,
  loading,
  rideRequestCount,
  deliveryRequestCount,
}: {
  isDriverActive: boolean
  loading: boolean
  rideRequestCount: number
  deliveryRequestCount: number
}) {
  const action = isDriverActive ? { label: 'Manage', href: '/drive/driver/manage' } : undefined

  return (
    <Block title="Drive for Civil" action={action}>
      {!isDriverActive ? (
        <div className="-mt-1 px-1 py-1">
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Earn money</li>
            <li>You keep the lion&apos;s share</li>
            <li>Create relationships with your Preferred Customers</li>
          </ul>
          <Link
            href="/drive/onboarding"
            className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Create Drive Account
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <Link
            href="/drive/ride"
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:bg-slate-50"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">Ride Requests</p>
              <p className="text-xs text-slate-500">Browse live pickup requests</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {loading ? '…' : rideRequestCount}
            </span>
          </Link>

          <Link
            href="/drive/delivery"
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:bg-slate-50"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">Delivery Requests</p>
              <p className="text-xs text-slate-500">Browse live delivery requests</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {loading ? '…' : deliveryRequestCount}
            </span>
          </Link>
        </div>
      )}
    </Block>
  )
}
