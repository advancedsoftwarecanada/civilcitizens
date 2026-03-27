'use client'

import Link from 'next/link'
import { FaCanadianMapleLeaf } from 'react-icons/fa'
import PartyChip from '../../../_components/politics/PartyChip'

export type FederalExplorerProvinceOption = {
  code: string
  name: string
  label: string
  count: number
}

export type FederalExplorerPartyListItem = {
  id: string
  slug: string
  name: string
  shortName: string | null
  seatCount?: number
  registeredAssociationCount?: number
}

export function FederalExplorerRightRail({
  provinceOptions,
  selectedProvince,
  onProvinceChange,
  otherParties,
  otherPartiesStatus,
  selectedPartySlug,
  showCurrentLinkAsSelected = false,
}: {
  provinceOptions: FederalExplorerProvinceOption[]
  selectedProvince: string
  onProvinceChange: (value: string) => void
  otherParties: FederalExplorerPartyListItem[]
  otherPartiesStatus: 'idle' | 'loading' | 'ready' | 'error'
  selectedPartySlug?: string | null
  showCurrentLinkAsSelected?: boolean
}) {
  return (
    <div className="space-y-4">
      <section className="surface-card space-y-4 p-5 shadow-subtle">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Map</p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">Province Filter</h2>
        </div>

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Province or territory
          <select
            value={selectedProvince}
            onChange={(event) => onProvinceChange(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
          >
            {provinceOptions.map((province) => (
              <option key={province.code} value={province.code}>
                {province.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="surface-card space-y-4 p-5 shadow-subtle">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Directory</p>
        </div>

        <Link
          href="/politicians/federal/current"
          className={`inline-flex items-center gap-3 rounded-full border px-4 py-3 text-sm font-semibold uppercase tracking-[0.24em] transition ${
            showCurrentLinkAsSelected
              ? 'border-red-200 bg-rose-50 text-[var(--cc-primary)] hover:border-red-300 hover:bg-rose-100'
              : 'border-slate-200 bg-white text-slate-900 hover:border-red-200 hover:bg-rose-50 hover:text-[var(--cc-primary)]'
          }`}
        >
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${showCurrentLinkAsSelected ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>
            <FaCanadianMapleLeaf className="h-4 w-4" />
          </span>
          <span>Federal View</span>
        </Link>
      </section>

      <section className="surface-card space-y-4 p-5 shadow-subtle">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Parties</p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">All Federal Parties</h2>
        </div>

        {otherParties.length ? (
          <div className="space-y-3">
            {otherParties.map((party) => {
              const isSelected = party.slug === selectedPartySlug
              return (
                <Link
                  key={party.id}
                  href={`/politicians/federal/${encodeURIComponent(party.slug)}`}
                  className={`group block rounded-2xl border px-3 py-3 transition ${
                    isSelected
                      ? 'border-red-200 bg-rose-50 hover:border-red-300 hover:bg-rose-100'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="w-full">
                    <div className="w-full">
                      <PartyChip party={party} jurisdiction="federal" className="transition group-hover:brightness-95" linkable={false} />
                    </div>
                    <p className={`mt-3 whitespace-normal break-words text-sm font-semibold leading-5 ${isSelected ? 'text-[var(--cc-primary)]' : 'text-slate-900'}`}>
                      {party.name}
                    </p>
                    <div className={`mt-2 space-y-1 text-xs ${isSelected ? 'text-red-700' : 'text-slate-500'}`}>
                      <p>Active Seats: {(party.seatCount ?? 0).toLocaleString()}</p>
                      <p>Registered Seats: {(party.registeredAssociationCount ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : otherPartiesStatus === 'loading' ? (
          <p className="text-sm text-slate-500">Loading parties…</p>
        ) : (
          <Link href="/politicians/federal" className="inline-flex text-sm font-semibold text-[var(--cc-primary)] hover:underline">
            Browse federal parties
          </Link>
        )}
      </section>
    </div>
  )
}