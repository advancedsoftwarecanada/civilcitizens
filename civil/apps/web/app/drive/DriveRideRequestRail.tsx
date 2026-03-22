'use client'

import Link from 'next/link'
import { HiOutlineMapPin, HiOutlineTruck } from 'react-icons/hi2'

export default function DriveRideRequestRail({
  secondaryAction,
}: {
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}) {
  return (
    <section className="space-y-3">
      <Link
        href="/drive/ride/request"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
      >
        <HiOutlineMapPin className="h-4 w-4 shrink-0" />
        Request Ride
      </Link>
      {secondaryAction ? (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
        >
          <HiOutlineTruck className="h-4 w-4 shrink-0" />
          {secondaryAction.label}
        </button>
      ) : null}
    </section>
  )
}
