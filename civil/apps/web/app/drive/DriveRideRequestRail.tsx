'use client'

import Link from 'next/link'
import Block from '../_components/Block'

export default function DriveRideRequestRail() {
  return (
    <Block title="Rides">
      <Link
        href="/drive/ride/request"
        className="inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
      >
        Request Ride
      </Link>
    </Block>
  )
}
