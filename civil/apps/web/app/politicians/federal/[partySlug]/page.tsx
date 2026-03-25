'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ElectoralDistrictBrowserResponse } from '@civil/shared'
import { PROVINCES } from '@civil/shared'
import DashboardShell from '../../../_components/DashboardShell'
import PoliticianContactCard from '../../../_components/PoliticianContactCard'
import { CivilDistrictBrowserMap } from '../../../_components/map/CivilDistrictBrowserMap'
import PartyChip from '../../../_components/politics/PartyChip'
import { buildApiUrl } from '../../../_lib/api'
import { resolvePartyVisual } from '../../../_lib/politics'

type PageProps = {
  params: {
    partySlug: string
  }
}

type FederalPartyDetailResponse = {
  party?: {
    id: string
    slug: string
    name: string
    shortName: string | null
    updatedAt: string
  }
  politicians?: Array<{
    id: string
    slug: string
    displayName: string
    officeType: string | null
    provinceCode: string | null
    communitySlug: string | null
    lastScrapeAt: string | null
    profileUrl: string | null
    xmlUrl: string | null
    photoUrl: string | null
    lastXmlSyncAt: string | null
    lastHtmlSyncAt: string | null
    contact: {
      email: string | null
      website: string | null
    }
    district: {
      name: string
      slug: string
      provinceCode: string
    } | null
  }>
  associations?: Array<{
    id: string
    associationName: string
    registrationStatus: string | null
    provinceCode: string
    communitySlug: string
    registeredAt: string | null
    deregisteredAt: string | null
  }>
}

type ProvinceOption = {
  code: string
  name: string
  label: string
  count: number
}

type FederalPartyListItem = {
  id: string
  slug: string
  name: string
  shortName: string | null
  seatCount?: number
  registeredAssociationCount?: number
}

type FederalPartyListResponse = {
  items?: FederalPartyListItem[]
}

const ALL_CANADA_CODE = 'all'
const provinceNameByCode = new Map<string, string>(PROVINCES.map((province) => [province.code, province.name]))

function isAssociationActive(association: {
  registrationStatus: string | null
  deregisteredAt: string | null
}) {
  if (association.deregisteredAt) return false
  const normalizedStatus = association.registrationStatus?.trim().toLowerCase() ?? ''
  if (!normalizedStatus) return true
  return !normalizedStatus.includes('deregister')
}

function canUseMapStyle(styleUrl: string | null | undefined) {
  if (!styleUrl) return false
  if (typeof window === 'undefined') return true

  const pageProtocol = window.location.protocol
  const resolved = (() => {
    try {
      return new URL(styleUrl, window.location.href)
    } catch {
      return null
    }
  })()

  if (!resolved) return false
  if (pageProtocol === 'https:' && resolved.protocol === 'http:') return false
  return true
}

function FederalPartyRightRail({
  provinceOptions,
  selectedProvince,
  onProvinceChange,
  otherParties,
  otherPartiesStatus,
  selectedPartySlug,
}: {
  provinceOptions: ProvinceOption[]
  selectedProvince: string
  onProvinceChange: (value: string) => void
  otherParties: FederalPartyListItem[]
  otherPartiesStatus: 'idle' | 'loading' | 'ready' | 'error'
  selectedPartySlug: string
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
                      <PartyChip party={party} jurisdiction="federal" className="transition group-hover:brightness-95" />
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

export default function FederalPartyPage({ params }: PageProps) {
  const [payload, setPayload] = useState<FederalPartyDetailResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [memberQuery, setMemberQuery] = useState('')
  const [selectedProvince, setSelectedProvince] = useState(ALL_CANADA_CODE)
  const [districtBrowser, setDistrictBrowser] = useState<ElectoralDistrictBrowserResponse | null>(null)
  const [districtBrowserStatus, setDistrictBrowserStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [selectedDistrictCode, setSelectedDistrictCode] = useState<number | null>(null)
  const [otherParties, setOtherParties] = useState<FederalPartyListItem[]>([])
  const [otherPartiesStatus, setOtherPartiesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl(`/politicians/federal/${encodeURIComponent(params.partySlug)}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as FederalPartyDetailResponse | null
        if (!cancelled) {
          setPayload(data)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setPayload(null)
          setStatus('error')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [params.partySlug])

  useEffect(() => {
    let cancelled = false

    const loadOtherParties = async () => {
      setOtherPartiesStatus('loading')
      try {
        const res = await fetch(buildApiUrl('/politicians/federal?limit=24'), { cache: 'no-store' })
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as FederalPartyListResponse | null
        if (!cancelled) {
          setOtherParties(
            (data?.items ?? [])
              .filter((party) => (party.seatCount ?? 0) > 0 || (party.registeredAssociationCount ?? 0) > 0)
              .sort((left, right) => {
                const seatDelta = (right.seatCount ?? 0) - (left.seatCount ?? 0)
                if (seatDelta !== 0) return seatDelta
                const registeredDelta = (right.registeredAssociationCount ?? 0) - (left.registeredAssociationCount ?? 0)
                if (registeredDelta !== 0) return registeredDelta
                return left.name.localeCompare(right.name)
              }),
          )
          setOtherPartiesStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setOtherParties([])
          setOtherPartiesStatus('error')
        }
      }
    }

    void loadOtherParties()
    return () => {
      cancelled = true
    }
  }, [params.partySlug])

  const provinceOptions = useMemo<ProvinceOption[]>(() => {
    const seenDistrictKeys = new Set<string>()
    const provinceCounts = new Map<string, number>()

    for (const politician of payload?.politicians ?? []) {
      const provinceCode = politician.district?.provinceCode?.trim().toLowerCase() || politician.provinceCode?.trim().toLowerCase() || null
      const districtSlug = politician.district?.slug?.trim().toLowerCase() || politician.communitySlug?.trim().toLowerCase() || null
      if (!provinceCode || !districtSlug) continue

      const districtKey = `${provinceCode}:${districtSlug}`
      if (seenDistrictKeys.has(districtKey)) continue
      seenDistrictKeys.add(districtKey)
      provinceCounts.set(provinceCode, (provinceCounts.get(provinceCode) ?? 0) + 1)
    }

    for (const association of payload?.associations ?? []) {
      if (!isAssociationActive(association)) continue
      const provinceCode = association.provinceCode.trim().toLowerCase()
      const communitySlug = association.communitySlug.trim().toLowerCase()
      if (!provinceCode || !communitySlug) continue

      const districtKey = `${provinceCode}:${communitySlug}`
      if (seenDistrictKeys.has(districtKey)) continue
      seenDistrictKeys.add(districtKey)
      provinceCounts.set(provinceCode, (provinceCounts.get(provinceCode) ?? 0) + 1)
    }

    const totalCount = seenDistrictKeys.size

    return [
      { code: ALL_CANADA_CODE, name: 'All of Canada', label: `All of Canada (${totalCount})`, count: totalCount },
      ...PROVINCES.map((province) => ({
        code: province.code,
        name: provinceNameByCode.get(province.code) ?? province.code.toUpperCase(),
        label: `${provinceNameByCode.get(province.code) ?? province.code.toUpperCase()} (${provinceCounts.get(province.code) ?? 0})`,
        count: provinceCounts.get(province.code) ?? 0,
      })),
    ]
  }, [payload?.associations, payload?.politicians])

  useEffect(() => {
    if (provinceOptions.length === 0) {
      setSelectedProvince(ALL_CANADA_CODE)
      return
    }

    setSelectedProvince((current) => (provinceOptions.some((province) => province.code === current) ? current : ALL_CANADA_CODE))
  }, [provinceOptions])

  useEffect(() => {
    let cancelled = false

    const loadDistrictBrowser = async () => {
      setDistrictBrowserStatus('loading')
      try {
        const districtUrl = selectedProvince === ALL_CANADA_CODE
          ? buildApiUrl(`/politicians/federal/${encodeURIComponent(params.partySlug)}/districts?provinceCode=all`)
          : buildApiUrl(`/politicians/federal/${encodeURIComponent(params.partySlug)}/districts?provinceCode=${encodeURIComponent(selectedProvince)}`)
        const res = await fetch(
          districtUrl,
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as ElectoralDistrictBrowserResponse | null
        if (!cancelled) {
          setDistrictBrowser(data)
          setSelectedDistrictCode(data?.selectedDistrictCode ?? (selectedProvince === ALL_CANADA_CODE ? null : data?.districts[0]?.code ?? null))
          setDistrictBrowserStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setDistrictBrowser(null)
          setSelectedDistrictCode(null)
          setDistrictBrowserStatus('error')
        }
      }
    }

    void loadDistrictBrowser()
    return () => {
      cancelled = true
    }
  }, [params.partySlug, selectedProvince])

  const filteredPoliticians = useMemo(() => {
    const politicians = payload?.politicians ?? []
    const normalizedQuery = memberQuery.trim().toLowerCase()
    if (!normalizedQuery) return politicians

    return politicians.filter((politician) => {
      const haystack = [
        politician.displayName,
        politician.officeType,
        politician.district?.name,
        politician.communitySlug,
        politician.provinceCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [memberQuery, payload?.politicians])

  const filteredAssociations = useMemo(() => {
    const associations = payload?.associations ?? []
    if (!selectedProvince || selectedProvince === ALL_CANADA_CODE) return associations
    return associations.filter((association) => association.provinceCode.trim().toLowerCase() === selectedProvince)
  }, [payload?.associations, selectedProvince])
  const currentParty = useMemo(
    () =>
      payload?.party
        ? {
            slug: payload.party.slug,
            name: payload.party.name,
            shortName: payload.party.shortName,
          }
        : null,
    [payload?.party],
  )
  const currentPartyVisual = useMemo(() => resolvePartyVisual(currentParty), [currentParty])
  const activeAssociations = useMemo(
    () =>
      filteredAssociations
        .filter((association) => isAssociationActive(association))
        .slice()
        .sort((left, right) => left.associationName.localeCompare(right.associationName)),
    [filteredAssociations],
  )
  const inactiveAssociations = useMemo(
    () =>
      filteredAssociations
        .filter((association) => !isAssociationActive(association))
        .slice()
        .sort((left, right) => left.associationName.localeCompare(right.associationName)),
    [filteredAssociations],
  )

  const selectedProvinceName = selectedProvince === ALL_CANADA_CODE
    ? 'All of Canada'
    : provinceOptions.find((province) => province.code === selectedProvince)?.name ?? null
  const selectedDistrict = useMemo(
    () => {
      if (!districtBrowser) return null
      if (selectedDistrictCode == null) return selectedProvince === ALL_CANADA_CODE ? null : districtBrowser.districts[0] ?? null
      return districtBrowser.districts.find((district) => district.code === selectedDistrictCode) ?? null
    },
    [districtBrowser, selectedDistrictCode, selectedProvince],
  )
  const districtStatusByCode = useMemo(
    () =>
      (districtBrowser?.districts ?? []).reduce<Record<number, 'default'>>((acc, district) => {
        acc[district.code] = 'default'
        return acc
      }, {}),
    [districtBrowser],
  )

  return (
    <DashboardShell
      rightRail={
        <FederalPartyRightRail
          provinceOptions={provinceOptions}
          selectedProvince={selectedProvince}
          onProvinceChange={setSelectedProvince}
          otherParties={otherParties}
          otherPartiesStatus={otherPartiesStatus}
          selectedPartySlug={params.partySlug}
        />
      }
      showMobileRightRail
      mainClassName="space-y-6"
    >
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Party</p>
        {currentParty ? <PartyChip party={currentParty} jurisdiction="federal" /> : null}
        <h1 className="text-2xl font-semibold text-slate-900">{payload?.party?.shortName ?? payload?.party?.name ?? params.partySlug}</h1>
        <p className="text-sm text-slate-600">Federal party directory and imported riding associations.</p>
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Federal riding map</h2>
            {selectedProvinceName ? <p className="mt-1 text-sm text-slate-600">{selectedProvinceName}</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            {currentPartyVisual ? (
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded-sm border border-transparent"
                    style={{ backgroundColor: currentPartyVisual.mapFillColor }}
                  />
                  <span>Active Seats</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded-sm border"
                    style={{
                      borderColor: currentPartyVisual.mapLineColor,
                      backgroundColor: '#e2e8f0',
                      backgroundImage: `repeating-linear-gradient(135deg, ${currentPartyVisual.mapFillColor} 0 2px, transparent 2px 6px)`,
                    }}
                  />
                  <span>Registered Seats</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {provinceOptions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No district associations are available for this party yet.
          </div>
        ) : districtBrowser?.districts.length && canUseMapStyle(districtBrowser.styleUrl) ? (
          <CivilDistrictBrowserMap
            browser={districtBrowser}
            selectedDistrictCode={selectedDistrictCode}
            selectedDistrict={selectedDistrict}
            districtStatusByCode={districtStatusByCode}
            focusRequestToken={0}
            isSelectedDistrictFollowing={false}
            isSelectedDistrictHome={false}
            isFollowPending={false}
            onSelectDistrict={setSelectedDistrictCode}
            onToggleSelectedDistrictFollow={() => undefined}
            showFollowAction={false}
            allowEmptySelection={selectedProvince === ALL_CANADA_CODE}
            popupMode="politicalExplorer"
            visitLabel="Visit Community"
          />
        ) : districtBrowser?.districts.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            District data is available, but the map preview is disabled because the configured tile server is not safe for this page.
          </div>
        ) : districtBrowserStatus === 'loading' ? (
          <div className="relative flex h-[460px] w-full items-center justify-center overflow-hidden rounded-[24px] border border-[var(--cc-border)] bg-slate-100 shadow-subtle">
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="inline-flex h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[var(--cc-primary)]" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-600">Loading district boundaries…</p>
            </div>
          </div>
        ) : districtBrowserStatus === 'error' ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">Unable to load the riding map right now.</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No district associations are available in {selectedProvinceName ?? 'this province'}.
          </div>
        )}
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Politicians</h2>
          <p className="mt-1 text-sm text-slate-600">Member cards with direct links back to Commons and public contact details.</p>
        </div>

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Search members
          <input
            value={memberQuery}
            onChange={(event) => setMemberQuery(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Search by name or community"
          />
        </label>

        {status === 'loading' ? <p className="text-sm text-slate-500">Loading party data…</p> : null}
        {status === 'error' ? <p className="text-sm text-rose-600">Unable to load this party.</p> : null}

        {payload?.politicians?.length ? (
          <ul className="space-y-3">
            {filteredPoliticians.map((politician) => (
              <li key={politician.id} className="space-y-4">
                <PoliticianContactCard
                  displayName={politician.displayName}
                  partyName={payload?.party?.shortName ?? payload?.party?.name ?? null}
                  officeType={politician.officeType}
                  districtName={politician.district?.name ?? (politician.provinceCode && politician.communitySlug ? `${politician.provinceCode.toUpperCase()} · ${politician.communitySlug}` : null)}
                  photoUrl={politician.photoUrl}
                  profileUrl={politician.profileUrl}
                  xmlUrl={politician.xmlUrl}
                  communityHref={politician.district ? `/${encodeURIComponent(politician.district.provinceCode.toLowerCase())}/${encodeURIComponent(politician.district.slug)}` : null}
                  email={politician.contact.email}
                  website={politician.contact.website}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {status === 'ready' && payload?.politicians?.length && filteredPoliticians.length === 0 ? (
          <p className="text-sm text-slate-500">No members match that search.</p>
        ) : null}
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">District associations</h2>
          {selectedProvinceName ? <p className="mt-1 text-sm text-slate-600">{selectedProvinceName}</p> : null}
        </div>

        {filteredAssociations.length ? (
          <div className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Active District Associations</h3>
              {activeAssociations.length ? (
                <ul className="space-y-3">
                  {activeAssociations.map((association) => (
                    <li key={association.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <p className="text-base font-semibold text-slate-900">{association.associationName}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        <Link href={`/${encodeURIComponent(association.provinceCode.toLowerCase())}/${encodeURIComponent(association.communitySlug)}/politicians`} className="font-semibold text-[var(--cc-primary)] hover:underline">
                          {association.provinceCode.toUpperCase()} / {association.communitySlug}
                        </Link>
                        {association.registrationStatus ? ` · ${association.registrationStatus}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No active district associations{selectedProvinceName ? ` in ${selectedProvinceName}` : ''}.</p>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Inactive District Associations</h3>
              {inactiveAssociations.length ? (
                <ul className="space-y-3">
                  {inactiveAssociations.map((association) => (
                    <li key={association.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 opacity-80">
                      <p className="text-base font-semibold text-slate-800">{association.associationName}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        <Link href={`/${encodeURIComponent(association.provinceCode.toLowerCase())}/${encodeURIComponent(association.communitySlug)}/politicians`} className="font-semibold text-slate-500 hover:text-slate-700 hover:underline">
                          {association.provinceCode.toUpperCase()} / {association.communitySlug}
                        </Link>
                        {association.registrationStatus ? ` · ${association.registrationStatus}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No inactive district associations{selectedProvinceName ? ` in ${selectedProvinceName}` : ''}.</p>
              )}
            </div>
          </div>
        ) : status === 'ready' ? (
          <p className="text-sm text-slate-500">
            No district associations found{selectedProvinceName ? ` in ${selectedProvinceName}` : ''}.
          </p>
        ) : null}
      </section>
    </DashboardShell>
  )
}
