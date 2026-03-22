'use client'

import Link from 'next/link'
import { HiOutlineShieldCheck, HiOutlineTruck } from 'react-icons/hi2'
import Block from '../_components/Block'

export default function DriveModeRail({
  isDriverActive,
  isDriverMode,
  loading,
  rideRequestCount,
  deliveryRequestCount,
  onEnterDriverMode,
  onExitDriverMode,
}: {
  isDriverActive: boolean
  isDriverMode?: boolean
  loading: boolean
  rideRequestCount: number
  deliveryRequestCount: number
  onEnterDriverMode?: () => void
  onExitDriverMode?: () => void
}) {
  const driverModeEnabled = isDriverActive && (isDriverMode ?? true)
  const title = !isDriverActive ? 'Drive for Civil' : 'Driver Mode'
  const action = driverModeEnabled && onExitDriverMode ? { label: 'Exit Driver Mode', onClick: onExitDriverMode } : undefined

  return (
    <Block title={title} action={action}>
      {!isDriverActive ? (
        <div className="-mt-1 px-1 py-1">
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Earn money</li>
            <li>You keep the lion&apos;s share</li>
            <li>Create relationships with your Preferred Customers</li>
          </ul>
          <Link
            href="/drive/onboarding"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
          >
            <HiOutlineShieldCheck className="h-4 w-4 shrink-0" />
            Create Drive Account
          </Link>
        </div>
      ) : !driverModeEnabled ? (
        <div className="-mt-1 px-1 py-1">
          <button
            type="button"
            onClick={onEnterDriverMode}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
          >
            <HiOutlineTruck className="h-4 w-4 shrink-0" />
            Enter Driver Mode
          </button>
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
