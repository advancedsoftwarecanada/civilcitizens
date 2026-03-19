'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import YourListingsPanel from './YourListingsPanel'
import YourOrdersPanel from './YourOrdersPanel'

export default function MarketRightRail({ filterBlock }: { filterBlock?: ReactNode }) {
  return (
    <div className="space-y-6">
      <Link
        href="/market/listings/new"
        className="inline-flex w-full items-center justify-center rounded-full bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500"
      >
        Create Listing
      </Link>
      {filterBlock}
      <YourListingsPanel />
      <YourOrdersPanel title="Your Orders" limit={8} />
    </div>
  )
}
