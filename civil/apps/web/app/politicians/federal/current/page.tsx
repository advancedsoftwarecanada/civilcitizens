'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ElectoralDistrictBrowserResponse } from '@civil/shared'
import { PROVINCES } from '@civil/shared'
import DashboardShell from '../../../_components/DashboardShell'
import PoliticianContactCard from '../../../_components/PoliticianContactCard'
import { CivilDistrictBrowserMap } from '../../../_components/map/CivilDistrictBrowserMap'
import CivilMapLoadingState from '../../../_components/map/CivilMapLoadingState'
import { buildApiUrl } from '../../../_lib/api'
import { resolvePartyVisual } from '../../../_lib/politics'
import {
  FederalExplorerRightRail,
  type FederalExplorerPartyListItem,
  type FederalExplorerProvinceOption,
} from '../_components/FederalExplorerRightRail'

type CurrentFederalMemberResponse = {
  members?: Array<{
    id: string
    slug: string | null
    displayName: string
    officeType: string | null
    provinceCode: string | null
    communitySlug: string | null
    lastScrapeAt: string | null
    profileUrl: string | null
    xmlUrl: string | null
    photoUrl: string | null
    candidateWebsite: string | null
    lastXmlSyncAt: string | null
    lastHtmlSyncAt: string | null
    contact: {
      email: string | null
      website: string | null
    }
    party: {
      id: string
      slug: string
      name: string
      shortName: string | null
    } | null
    district: {
      name: string
      slug: string
      provinceCode: string
    } | null
  }>
}

type FederalPartyListResponse = {
  items?: FederalExplorerPartyListItem[]
}

const ALL_CANADA_CODE = 'all'
const provinceNameByCode = new Map<string, string>(PROVINCES.map((province) => [province.code, province.name]))

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

export default function CurrentFederalMembersPage() {
  const [payload, setPayload] = useState<CurrentFederalMemberResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [memberQuery, setMemberQuery] = useState('')
  const [selectedProvince, setSelectedProvince] = useState(ALL_CANADA_CODE)
  const [districtBrowser, setDistrictBrowser] = useState<ElectoralDistrictBrowserResponse | null>(null)
  const [districtBrowserStatus, setDistrictBrowserStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [selectedDistrictCode, setSelectedDistrictCode] = useState<number | null>(null)
  const [mapFocusRequestToken, setMapFocusRequestToken] = useState(0)
  const [pendingMapFocus, setPendingMapFocus] = useState<{ provinceCode: string; districtSlug: string } | null>(null)
  const [otherParties, setOtherParties] = useState<FederalExplorerPartyListItem[]>([])
  const [otherPartiesStatus, setOtherPartiesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [showActiveSeatsLayer, setShowActiveSeatsLayer] = useState(true)
  const [activePartyVisibility, setActivePartyVisibility] = useState<Record<string, boolean>>({})
  const mapSectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl('/politicians/federal/current'), { cache: 'no-store' })
        if (!res.ok) throw new Error('request_failed')
        const data = (await res.json().catch(() => null)) as CurrentFederalMemberResponse | null
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
  }, [])

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
  }, [])

  const provinceOptions = useMemo<FederalExplorerProvinceOption[]>(() => {
    const seenDistrictKeys = new Set<string>()
    const provinceCounts = new Map<string, number>()

    for (const member of payload?.members ?? []) {
      const provinceCode = member.district?.provinceCode?.trim().toLowerCase() || member.provinceCode?.trim().toLowerCase() || null
      const districtSlug = member.district?.slug?.trim().toLowerCase() || member.communitySlug?.trim().toLowerCase() || null
      if (!provinceCode || !districtSlug) continue

      const districtKey = `${provinceCode}:${districtSlug}`
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
  }, [payload?.members])

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
          ? buildApiUrl('/politicians/federal/current/districts?provinceCode=all')
          : buildApiUrl(`/politicians/federal/current/districts?provinceCode=${encodeURIComponent(selectedProvince)}`)
        const res = await fetch(districtUrl, { cache: 'no-store' })
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
  }, [selectedProvince])

  const filteredMembers = useMemo(() => {
    const normalizedQuery = memberQuery.trim().toLowerCase()

    return (payload?.members ?? []).filter((member) => {
      const provinceMatches = selectedProvince === ALL_CANADA_CODE
        || member.district?.provinceCode?.trim().toLowerCase() === selectedProvince
        || member.provinceCode?.trim().toLowerCase() === selectedProvince
      if (!provinceMatches) return false
      if (!normalizedQuery) return true

      const haystack = [
        member.displayName,
        member.officeType,
        member.party?.name,
        member.party?.shortName,
        member.district?.name,
        member.communitySlug,
        member.provinceCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [memberQuery, payload?.members, selectedProvince])

  const selectedProvinceName = selectedProvince === ALL_CANADA_CODE
    ? 'All of Canada'
    : provinceOptions.find((province) => province.code === selectedProvince)?.name ?? null
  const selectedDistrict = useMemo(() => {
    if (!districtBrowser) return null
    if (selectedDistrictCode == null) return selectedProvince === ALL_CANADA_CODE ? null : districtBrowser.districts[0] ?? null
    return districtBrowser.districts.find((district) => district.code === selectedDistrictCode) ?? null
  }, [districtBrowser, selectedDistrictCode, selectedProvince])
  const districtStatusByCode = useMemo(
    () =>
      (districtBrowser?.districts ?? []).reduce<Record<number, 'default'>>((acc, district) => {
        acc[district.code] = 'default'
        return acc
      }, {}),
    [districtBrowser],
  )
  const hasActiveSeatDistricts = useMemo(
    () => Boolean(districtBrowser?.districts.some((district) => district.partyStatus === 'seat')),
    [districtBrowser],
  )
  const activeSeatParties = useMemo(() => {
    const partyCounts = new Map<string, { slug: string; name: string; shortName: string | null; seatCount: number }>()

    for (const district of districtBrowser?.districts ?? []) {
      if (district.partyStatus !== 'seat' || !district.party) continue
      const current = partyCounts.get(district.party.slug)
      if (current) {
        current.seatCount += 1
        continue
      }

      partyCounts.set(district.party.slug, {
        slug: district.party.slug,
        name: district.party.name,
        shortName: district.party.shortName,
        seatCount: 1,
      })
    }

    return Array.from(partyCounts.values()).sort((left, right) => {
      const seatDelta = right.seatCount - left.seatCount
      if (seatDelta !== 0) return seatDelta
      return left.name.localeCompare(right.name)
    })
  }, [districtBrowser])
  const visiblePartySlugs = useMemo(
    () => activeSeatParties.filter((party) => activePartyVisibility[party.slug] ?? true).map((party) => party.slug),
    [activePartyVisibility, activeSeatParties],
  )

  const handleShowOnMap = useCallback((district: { provinceCode: string; slug: string }) => {
    const provinceCode = district.provinceCode.trim().toLowerCase()
    const districtSlug = district.slug.trim().toLowerCase()
    if (!provinceCode || !districtSlug) return

    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingMapFocus({ provinceCode, districtSlug })

    if (selectedProvince !== ALL_CANADA_CODE && selectedProvince !== provinceCode) {
      setSelectedProvince(provinceCode)
    }
  }, [selectedProvince])

  useEffect(() => {
    if (!pendingMapFocus || !districtBrowser) return
    if (selectedProvince !== ALL_CANADA_CODE && selectedProvince !== pendingMapFocus.provinceCode) return

    const match = districtBrowser.districts.find((district) => {
      return district.provinceCode.trim().toLowerCase() === pendingMapFocus.provinceCode
        && district.slug.trim().toLowerCase() === pendingMapFocus.districtSlug
    })

    if (!match) return

    setSelectedDistrictCode(match.code)
    setMapFocusRequestToken((current) => current + 1)
    setPendingMapFocus(null)
  }, [districtBrowser, pendingMapFocus, selectedProvince])

  useEffect(() => {
    setActivePartyVisibility((current) => {
      const next = { ...current }
      for (const party of activeSeatParties) {
        if (typeof next[party.slug] === 'undefined') {
          next[party.slug] = true
        }
      }
      return next
    })
  }, [activeSeatParties])

  return (
    <DashboardShell
      rightRail={
        <FederalExplorerRightRail
          provinceOptions={provinceOptions}
          selectedProvince={selectedProvince}
          onProvinceChange={setSelectedProvince}
          otherParties={otherParties}
          otherPartiesStatus={otherPartiesStatus}
          selectedPartySlug={null}
          showCurrentLinkAsSelected
        />
      }
      showMobileRightRail
      mainClassName="space-y-6"
    >
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Federal Members</p>
        <h1 className="text-2xl font-semibold text-slate-900">Current Members of Parliament</h1>
        <p className="text-sm text-slate-600">All current federal members, organized by electoral district and highlighted on the national map.</p>
      </section>

      <section ref={mapSectionRef} className="surface-card space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Federal riding map</h2>
            {selectedProvinceName ? <p className="mt-1 text-sm text-slate-600">{selectedProvinceName}</p> : null}
          </div>
          <p className="max-w-xl text-sm text-slate-600">Occupied ridings are highlighted using the current party colour for each seat.</p>
        </div>

        {hasActiveSeatDistricts || activeSeatParties.length ? (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            {hasActiveSeatDistricts ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowActiveSeatsLayer((current) => !current)}
                  aria-pressed={showActiveSeatsLayer}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    showActiveSeatsLayer
                      ? 'border-slate-300 bg-white text-slate-700 shadow-sm'
                      : 'border-slate-200 bg-slate-100 text-slate-400'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded-sm border border-transparent bg-slate-700"
                    style={{ opacity: showActiveSeatsLayer ? 1 : 0.35 }}
                  />
                  <span>Active Seats</span>
                </button>
              </div>
            ) : null}

            {activeSeatParties.length ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Party Filters</p>
                <div className="flex flex-wrap items-center gap-2">
                  {activeSeatParties.map((party) => {
                    const partyVisual = resolvePartyVisual(party)
                    const isVisible = activePartyVisibility[party.slug] ?? true

                    return (
                      <button
                        key={party.slug}
                        type="button"
                        onClick={() =>
                          setActivePartyVisibility((current) => ({
                            ...current,
                            [party.slug]: !(current[party.slug] ?? true),
                          }))
                        }
                        aria-pressed={isVisible}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          isVisible
                            ? 'border-slate-300 bg-white text-slate-700 shadow-sm'
                            : 'border-slate-200 bg-slate-100 text-slate-400'
                        } ${showActiveSeatsLayer ? '' : 'opacity-60'}`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 rounded-full border border-transparent"
                          style={{
                            backgroundColor: partyVisual?.mapFillColor ?? '#94a3b8',
                            opacity: isVisible && showActiveSeatsLayer ? 1 : 0.35,
                          }}
                        />
                        <span>{party.shortName?.trim() || party.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {provinceOptions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No current federal members are available yet.
          </div>
        ) : districtBrowser?.districts.length && canUseMapStyle(districtBrowser.styleUrl) ? (
          <CivilDistrictBrowserMap
            browser={districtBrowser}
            selectedDistrictCode={selectedDistrictCode}
            selectedDistrict={selectedDistrict}
            districtStatusByCode={districtStatusByCode}
            focusRequestToken={mapFocusRequestToken}
            isSelectedDistrictFollowing={false}
            isSelectedDistrictHome={false}
            isFollowPending={false}
            onSelectDistrict={setSelectedDistrictCode}
            onToggleSelectedDistrictFollow={() => undefined}
            showFollowAction={false}
            allowEmptySelection={selectedProvince === ALL_CANADA_CODE}
            popupMode="politicalExplorer"
            visitLabel="Visit Community"
            showActiveSeatsLayer={showActiveSeatsLayer}
            showRegisteredSeatsLayer={false}
            visiblePartySlugs={visiblePartySlugs}
          />
        ) : districtBrowser?.districts.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            District data is available, but the map preview is disabled because the configured tile server is not safe for this page.
          </div>
        ) : districtBrowserStatus === 'loading' ? (
          <CivilMapLoadingState />
        ) : districtBrowserStatus === 'error' ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">Unable to load the riding map right now.</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No current federal members are available in {selectedProvinceName ?? 'this province'}.
          </div>
        )}
      </section>

      <section className="surface-card space-y-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Members of Parliament</h2>
          <p className="mt-1 text-sm text-slate-600">Search the full current House roster and jump any member back to their riding on the map.</p>
        </div>

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Search members
          <input
            value={memberQuery}
            onChange={(event) => setMemberQuery(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Search by name, party, or community"
          />
        </label>

        {status === 'loading' ? <p className="text-sm text-slate-500">Loading federal members…</p> : null}
        {status === 'error' ? <p className="text-sm text-rose-600">Unable to load current federal members.</p> : null}

        {payload?.members?.length ? (
          <ul className="space-y-3">
            {filteredMembers.map((member) => (
              <li key={member.id} className="space-y-4">
                <PoliticianContactCard
                  displayName={member.displayName}
                  partyName={member.party?.shortName ?? member.party?.name ?? null}
                  officeType={member.officeType}
                  districtName={member.district?.name ?? (member.provinceCode && member.communitySlug ? `${member.provinceCode.toUpperCase()} · ${member.communitySlug}` : null)}
                  photoUrl={member.photoUrl}
                  profileUrl={member.profileUrl}
                  xmlUrl={member.xmlUrl}
                  candidateWebsite={member.candidateWebsite}
                  communityHref={member.district ? `/${encodeURIComponent(member.district.provinceCode.toLowerCase())}/${encodeURIComponent(member.district.slug)}` : null}
                  email={member.contact.email}
                  website={member.contact.website}
                  extraActions={
                    member.district ? (
                      <button
                        type="button"
                        onClick={() => handleShowOnMap(member.district!)}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-[var(--cc-primary)] hover:border-red-200 hover:bg-rose-50"
                      >
                        Show on Map
                      </button>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}

        {status === 'ready' && payload?.members?.length && filteredMembers.length === 0 ? (
          <p className="text-sm text-slate-500">No current members match that search.</p>
        ) : null}
      </section>
    </DashboardShell>
  )
}
