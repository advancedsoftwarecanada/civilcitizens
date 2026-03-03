'use client'

import Link from 'next/link'

export default function YourListingsPanel() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Your Listings</h3>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <Link href="/market/listings" className="hover:text-slate-900">
            View all
          </Link>
          <span className="text-slate-300">|</span>
          <Link href="/market/listings/new" className="hover:text-slate-900">
            Create
          </Link>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">Post personal items peer-to-peer, or create through an organization shop if you manage one.</p>
    </section>
  )
}
