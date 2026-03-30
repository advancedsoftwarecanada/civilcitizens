'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
  HiOutlineCheckBadge,
  HiOutlineDocumentText,
  HiOutlineMapPin,
  HiOutlineShoppingBag,
} from 'react-icons/hi2'
import {
  type CommunitySearchResult,
  type EventSearchResult,
  type MarketSearchResult,
  type OrganizationSearchResult,
  type PostSearchResult,
  type SearchResponse,
  type UserSearchResult,
} from './searchTypes'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import {
  calculateDistanceKm,
  buildAddressSearchQueries,
  buildAddressesHref,
  buildAddressesHrefFromPlaceResult,
  fetchPlaceSearchResults,
  isAddressPostalVerified,
  isUsableAddressQuery,
  formatPlaceSearchCategoryLabel,
  formatPlaceSearchPrimaryLabel,
  formatPlaceSearchSecondaryLabel,
  type CivilPlaceSearchResult,
  type CivilPlaceSearchResults,
} from '../../_lib/addressSearch'
import { redirectToAuthModal } from '../../_lib/authModal'
import {
  isCanadianAddressPostalVerified,
  normalizeCanadianAddress,
  normalizeSavedShippingAddress,
  readStoredMarketShippingAddress,
  type CanadianAddress,
  type SavedShippingAddress,
} from '../../_lib/canadianAddresses'
import { getCurrentLocation } from '../../_lib/locationService'
import { useMobileKeyboardState } from '../../_lib/mobileKeyboard'
import {
  formatSavedShippingAddressDetail,
  formatSavedShippingAddressTitle,
  searchSavedShippingAddresses,
  type SavedAddressSearchResult,
} from '../../_lib/savedAddressSearch'
import { formatUserDisplayName } from '../../_lib/text'
import { getStoredToken } from '../../_lib/tokenStorage'
import VerifiedAvatar from '../VerifiedAvatar'

const MIN_QUERY_LENGTH = 2
const PEOPLE_LIMIT = 3
const COMMUNITY_LIMIT = 3
const ORGANIZATION_LIMIT = 2
const EVENT_LIMIT = 2
const MARKET_LIMIT = 2
const POST_LIMIT = 2
const PLACE_FETCH_LIMIT = 8
const MAP_RESULT_DISTANCE_LIMIT_KM = 500
const PLACE_SEARCH_DEBOUNCE_MS = 300
const SEARCH_PANEL_MAX_HEIGHT_PX = 672
const SEARCH_PANEL_BOTTOM_GAP_PX = 12
const GENERAL_SEARCH_STEPS = [
  'Searching people',
  'Searching communities',
  'Searching organizations',
  'Searching events',
  'Searching market',
  'Searching posts',
] as const

type SearchResultsProps = {
  query: string
  open: boolean
  onResultSelect?: () => void
  onLoadingStateChange?: (state: SearchResultsLoadingState) => void
}

export type SearchResultsLoadingState = {
  active: boolean
  label: string
}

type SearchAnchor = {
  latitude: number
  longitude: number
}

type VisibleMapSearchResult = {
  result: CivilPlaceSearchResult
  distanceKm: number | null
}

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
}

function CompactSection({ title, href, children, onResultSelect }: { title: string; href: string; children: ReactNode; onResultSelect?: () => void }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{title}</p>
        <Link href={href} onClick={onResultSelect} className="text-[11px] font-semibold text-[var(--cc-primary)] hover:underline">
          View more
        </Link>
      </div>
      {children}
    </section>
  )
}

function hasCoordinates(value: SearchAnchor | CanadianAddress | null | undefined): value is SearchAnchor {
  return value != null && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
}

function formatDistanceBadge(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.max(100, Math.round(distanceKm * 1000 / 100) * 100)} m`
  }

  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`
  }

  return `${Math.round(distanceKm)} km`
}

export function SearchResults({ query, open, onResultSelect, onLoadingStateChange }: SearchResultsProps) {
  const trimmedQuery = query.trim()
  const keyboardState = useMobileKeyboardState()
  const [debouncedPlaceQuery, setDebouncedPlaceQuery] = useState(trimmedQuery)
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([])
  const [communityResults, setCommunityResults] = useState<CommunitySearchResult[]>([])
  const [organizationResults, setOrganizationResults] = useState<OrganizationSearchResult[]>([])
  const [eventResults, setEventResults] = useState<EventSearchResult[]>([])
  const [marketResults, setMarketResults] = useState<MarketSearchResult[]>([])
  const [postResults, setPostResults] = useState<PostSearchResult[]>([])
  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [savedAddressesLoaded, setSavedAddressesLoaded] = useState(false)
  const [placeResults, setPlaceResults] = useState<CivilPlaceSearchResults>({ places: [], addresses: [] })
  const [addressSearchAnchor, setAddressSearchAnchor] = useState<SearchAnchor | null>(null)
  const [loading, setLoading] = useState(false)
  const [placeLoading, setPlaceLoading] = useState(false)
  const [loadingStepIndex, setLoadingStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const placeAbortRef = useRef<AbortController | null>(null)
  const addressAnchorAttemptedRef = useRef(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) return
    addressAnchorAttemptedRef.current = false
    setAddressSearchAnchor(null)
  }, [open])

  useEffect(() => {
    if (!open) {
      setDebouncedPlaceQuery(trimmedQuery)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedPlaceQuery(trimmedQuery)
    }, PLACE_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [open, trimmedQuery])

  useEffect(() => {
    if (!open) return

    const token = getStoredToken()
    if (!token) {
      setSavedAddresses([])
      setSavedAddressesLoaded(true)
      return
    }

    let cancelled = false
    setSavedAddressesLoaded(false)

    void (async () => {
      try {
        const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const { json } = await parseApiResponse<ShippingAddressListResponse>(response)
        if (cancelled || !response.ok) {
          if (!cancelled) setSavedAddresses([])
          return
        }

        const items = Array.isArray(json?.items)
          ? json.items.map((item) => normalizeSavedShippingAddress(item)).filter((item): item is SavedShippingAddress => Boolean(item))
          : []
        setSavedAddresses(items)
      } catch {
        if (!cancelled) setSavedAddresses([])
      } finally {
        if (!cancelled) setSavedAddressesLoaded(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    const token = getStoredToken()
    if (!open || !isUsableAddressQuery(trimmedQuery) || addressAnchorAttemptedRef.current) return
    if (token && !savedAddressesLoaded) return

    addressAnchorAttemptedRef.current = true
    let cancelled = false

    const resolveAnchor = async () => {
      const locationResult = await getCurrentLocation({
        reason: 'search-address-anchor',
        highAccuracy: true,
        timeoutMs: 5000,
        maximumAgeMs: 300000,
        minIntervalMs: 10_000,
      })
      if (locationResult.ok && locationResult.location) {
        if (!cancelled) {
          setAddressSearchAnchor({
            latitude: locationResult.location.latitude,
            longitude: locationResult.location.longitude,
          })
        }
        return
      }

      const storedAddress = readStoredMarketShippingAddress()
      const normalizedStoredAddress = storedAddress ? normalizeCanadianAddress(storedAddress) : null
      if (hasCoordinates(normalizedStoredAddress)) {
        if (!cancelled) {
          setAddressSearchAnchor({
            latitude: normalizedStoredAddress.latitude,
            longitude: normalizedStoredAddress.longitude,
          })
        }
        return
      }

      const fallbackAddress = savedAddresses.find((entry) => entry.isDefault) ?? savedAddresses[0] ?? null
      const normalizedFallback = fallbackAddress ? normalizeCanadianAddress(fallbackAddress) : null
      if (hasCoordinates(normalizedFallback) && !cancelled) {
        setAddressSearchAnchor({
          latitude: normalizedFallback.latitude,
          longitude: normalizedFallback.longitude,
        })
      }
    }

    void resolveAnchor()

    return () => {
      cancelled = true
    }
  }, [open, savedAddresses, savedAddressesLoaded, trimmedQuery])

  useEffect(() => {
    if (!open || !isUsableAddressQuery(debouncedPlaceQuery)) {
      setPlaceResults({ places: [], addresses: [] })
      setPlaceLoading(false)
      if (placeAbortRef.current) {
        placeAbortRef.current.abort()
        placeAbortRef.current = null
      }
      return
    }

    const controller = new AbortController()
    placeAbortRef.current = controller
    setPlaceLoading(true)

    void fetchPlaceSearchResults(debouncedPlaceQuery, controller.signal, {
      limit: PLACE_FETCH_LIMIT,
      latitude: addressSearchAnchor?.latitude ?? null,
      longitude: addressSearchAnchor?.longitude ?? null,
      radiusKm: MAP_RESULT_DISTANCE_LIMIT_KM,
    })
      .then((results) => {
        setPlaceResults(results)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setPlaceResults({ places: [], addresses: [] })
      })
      .finally(() => {
        setPlaceLoading(false)
      })

    return () => controller.abort()
  }, [addressSearchAnchor, debouncedPlaceQuery, open])

  useEffect(() => {
    if (!open || trimmedQuery.length < MIN_QUERY_LENGTH) {
      setPeopleResults([])
      setCommunityResults([])
      setOrganizationResults([])
      setEventResults([])
      setMarketResults([])
      setPostResults([])
      setLoading(false)
      setError(null)
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      return
    }

    const token = getStoredToken()
    if (!token) {
      setPeopleResults([])
      setCommunityResults([])
      setOrganizationResults([])
      setEventResults([])
      setMarketResults([])
      setPostResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setPeopleResults([])
    setCommunityResults([])
    setOrganizationResults([])
    setEventResults([])
    setMarketResults([])
    setPostResults([])

    const controller = new AbortController()
    abortRef.current = controller

    const fetchResults = async () => {
      try {
        const params = new URLSearchParams({ q: trimmedQuery, type: 'all' })
        params.set('peopleLimit', String(PEOPLE_LIMIT))
        params.set('communityLimit', String(COMMUNITY_LIMIT))
        params.set('organizationLimit', String(ORGANIZATION_LIMIT))
        params.set('eventLimit', String(EVENT_LIMIT))
        params.set('marketLimit', String(MARKET_LIMIT))
        params.set('postLimit', String(POST_LIMIT))

        const response = await fetch(buildApiUrl(`/search?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          setError('Please sign in to keep searching.')
          return
        }

        if (!response.ok) {
          setError('Unable to search right now. Please try again later.')
          return
        }

        const payload = (await response.json()) as SearchResponse
        setPeopleResults(Array.isArray(payload.people) ? payload.people : [])
        setCommunityResults(Array.isArray(payload.communities) ? payload.communities : [])
        setOrganizationResults(Array.isArray(payload.organizations) ? payload.organizations : [])
        setEventResults(Array.isArray(payload.events) ? payload.events : [])
        setMarketResults(Array.isArray(payload.market) ? payload.market : [])
        setPostResults(Array.isArray(payload.posts) ? payload.posts : [])
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError('Unable to search right now. Please try again later.')
      } finally {
        setLoading(false)
      }
    }

    void fetchResults()

    return () => {
      controller.abort()
    }
  }, [open, trimmedQuery])

  const visiblePlaceResults = useMemo(() => {
    if (!placeResults.places.length) return []
    if (!hasCoordinates(addressSearchAnchor)) {
      return placeResults.places.slice(0, 4).map((result) => ({ result, distanceKm: null }))
    }

    return placeResults.places
      .map((result) => ({
        result,
        distanceKm: calculateDistanceKm(addressSearchAnchor, {
          latitude: result.latitude,
          longitude: result.longitude,
        }),
      }))
      .filter((entry) => entry.distanceKm <= MAP_RESULT_DISTANCE_LIMIT_KM)
      .sort((left, right) => left.distanceKm - right.distanceKm)
      .slice(0, 4)
  }, [addressSearchAnchor, placeResults.places]) satisfies VisibleMapSearchResult[]

  const visibleAddressResults = useMemo(() => {
    if (!placeResults.addresses.length) return []
    if (!hasCoordinates(addressSearchAnchor)) {
      return placeResults.addresses.slice(0, 4).map((result) => ({ result, distanceKm: null }))
    }

    return placeResults.addresses
      .map((result) => ({
        result,
        distanceKm: calculateDistanceKm(addressSearchAnchor, {
          latitude: result.latitude,
          longitude: result.longitude,
        }),
      }))
      .filter((entry) => entry.distanceKm <= MAP_RESULT_DISTANCE_LIMIT_KM)
      .sort((left, right) => left.distanceKm - right.distanceKm)
      .slice(0, 4)
  }, [addressSearchAnchor, placeResults.addresses]) satisfies VisibleMapSearchResult[]

  const visibleSavedAddressResults = useMemo(
    () =>
      searchSavedShippingAddresses(savedAddresses, trimmedQuery, {
        anchor: hasCoordinates(addressSearchAnchor) ? addressSearchAnchor : null,
        limit: 4,
      }),
    [addressSearchAnchor, savedAddresses, trimmedQuery],
  ) satisfies SavedAddressSearchResult[]

  const anyLoading = loading || placeLoading
  const loadingSteps = useMemo(() => {
    const steps = isUsableAddressQuery(trimmedQuery)
      ? ['Searching places', ...GENERAL_SEARCH_STEPS]
      : [...GENERAL_SEARCH_STEPS]
    return steps
  }, [trimmedQuery])

  const showPanel = open && trimmedQuery.length >= MIN_QUERY_LENGTH
  const hasAnyResults =
    peopleResults.length > 0 ||
    communityResults.length > 0 ||
    organizationResults.length > 0 ||
    eventResults.length > 0 ||
    marketResults.length > 0 ||
    postResults.length > 0 ||
    visibleSavedAddressResults.length > 0 ||
    visiblePlaceResults.length > 0 ||
    visibleAddressResults.length > 0

  const sectionHref = useMemo(
    () => ({
      savedAddresses: '/settings/addresses',
      people: `/search?q=${encodeURIComponent(trimmedQuery)}&type=people`,
      communities: `/search?q=${encodeURIComponent(trimmedQuery)}&type=communities`,
      organizations: `/search?q=${encodeURIComponent(trimmedQuery)}&type=organizations`,
      events: `/search?q=${encodeURIComponent(trimmedQuery)}&type=events`,
      market: `/search?q=${encodeURIComponent(trimmedQuery)}&type=market`,
      posts: `/search?q=${encodeURIComponent(trimmedQuery)}&type=posts`,
      addresses: `/addresses?q=${encodeURIComponent(trimmedQuery)}`,
    }),
    [trimmedQuery],
  )

  useEffect(() => {
    if (!anyLoading) {
      setLoadingStepIndex(0)
      return undefined
    }

    setLoadingStepIndex(0)
    const interval = window.setInterval(() => {
      setLoadingStepIndex((current) => {
        if (loadingSteps.length <= 1) return current
        return (current + 1) % loadingSteps.length
      })
    }, 950)

    return () => {
      window.clearInterval(interval)
    }
  }, [anyLoading, loadingSteps])

  const loadingLabel = loadingSteps[Math.min(loadingStepIndex, Math.max(loadingSteps.length - 1, 0))] ?? 'Searching Civil'

  useEffect(() => {
    if (!onLoadingStateChange) return
    onLoadingStateChange({ active: showPanel && anyLoading, label: loadingLabel })
  }, [anyLoading, loadingLabel, onLoadingStateChange, showPanel])

  useEffect(() => {
    if (!showPanel) {
      setPanelMaxHeight(null)
      return
    }

    let frameId = 0
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    const measure = () => {
      const panel = panelRef.current
      if (!panel || typeof window === 'undefined') return

      const viewportHeight = keyboardState.keyboardOpen
        ? keyboardState.viewportHeight
        : Math.max(keyboardState.layoutViewportHeight, keyboardState.viewportHeight, window.innerHeight)
      const availableHeight = Math.floor(viewportHeight - panel.getBoundingClientRect().top - SEARCH_PANEL_BOTTOM_GAP_PX)
      const nextHeight = Math.max(0, Math.min(SEARCH_PANEL_MAX_HEIGHT_PX, availableHeight))
      setPanelMaxHeight((current) => (current === nextHeight ? current : nextHeight))
    }
    const scheduleMeasure = () => {
      if (typeof window === 'undefined') return
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(measure)
    }

    scheduleMeasure()
    viewport?.addEventListener('resize', scheduleMeasure)
    viewport?.addEventListener('scroll', scheduleMeasure)
    window.addEventListener('resize', scheduleMeasure)

    return () => {
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameId)
        window.removeEventListener('resize', scheduleMeasure)
      }
      viewport?.removeEventListener('resize', scheduleMeasure)
      viewport?.removeEventListener('scroll', scheduleMeasure)
    }
  }, [
    anyLoading,
    hasAnyResults,
    keyboardState.keyboardOpen,
    keyboardState.layoutViewportHeight,
    keyboardState.viewportHeight,
    showPanel,
    trimmedQuery,
  ])

  if (!showPanel) return null

  const renderHomeCommunity = (home: UserSearchResult['homeCommunity']) => {
    if (!home) return 'No home chamber yet'
    const provinceLabel = home.provinceName ?? home.provinceCode.toUpperCase()
    const chamberLabel = home.communityName ?? home.communitySlug
    return `${provinceLabel} / ${chamberLabel}`
  }

  return (
    <div
      ref={panelRef}
      className="absolute left-0 top-[calc(100%+0.5rem)] z-40 max-h-[min(70vh,42rem)] w-full min-w-[18rem] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-2xl shadow-slate-900/12 [touch-action:pan-y]"
      style={{
        maxHeight: panelMaxHeight && panelMaxHeight > 0 ? `${panelMaxHeight}px` : undefined,
        WebkitOverflowScrolling: 'touch',
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {anyLoading ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
          <span className="inline-flex h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold leading-5">{loadingLabel}</p>
            <p className="text-xs text-sky-700/80">Civil is still fetching matches for "{trimmedQuery}".</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : anyLoading && !hasAnyResults ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Still working on this search…</div>
      ) : !hasAnyResults && !placeLoading ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">No Civil or map matches yet.</div>
      ) : (
        <div className="space-y-4">
          {visibleSavedAddressResults.length > 0 ? (
            <CompactSection title="My Addresses" href={sectionHref.savedAddresses} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {visibleSavedAddressResults.map(({ address, distanceKm, isHome }) => {
                  const title = formatSavedShippingAddressTitle(address)
                  const detail = formatSavedShippingAddressDetail(address, { includeName: false })
                  const geocodeQuery = buildAddressSearchQueries(address)[0] ?? detail ?? title
                  return (
                    <li key={address.id}>
                      <Link
                        href={buildAddressesHref({
                          query: geocodeQuery,
                          label: title,
                          address: detail || null,
                          latitude: typeof address.latitude === 'number' ? address.latitude : null,
                          longitude: typeof address.longitude === 'number' ? address.longitude : null,
                        })}
                        onClick={onResultSelect}
                        className="flex items-start gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
                      >
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isHome ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          <HiOutlineMapPin className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold leading-5 text-slate-900">{title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {isHome ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                Home
                              </span>
                            ) : address.isDefault ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                Default
                              </span>
                            ) : (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                Saved Address
                              </span>
                            )}
                            {distanceKm !== null ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                                {formatDistanceBadge(distanceKm)}
                              </span>
                            ) : null}
                            {isCanadianAddressPostalVerified(address) ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                                Verified Address
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 break-words text-xs leading-5 text-slate-500">{detail || 'Saved in Settings > Addresses'}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CompactSection>
          ) : null}

          {visiblePlaceResults.length > 0 ? (
            <CompactSection title="Places" href={sectionHref.addresses} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {visiblePlaceResults.map(({ result, distanceKm }) => {
                  const categoryLabel = formatPlaceSearchCategoryLabel(result)
                  return (
                    <li key={`${result.placeId ?? result.displayName}-${result.latitude}-${result.longitude}`}>
                      <Link href={buildAddressesHrefFromPlaceResult(result, trimmedQuery)} onClick={onResultSelect} className="flex items-start gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${result.category === 'shop' || result.category === 'food' ? 'bg-amber-50 text-amber-700' : result.category === 'healthcare' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {result.category === 'shop' || result.category === 'food' ? <HiOutlineShoppingBag className="h-5 w-5" /> : result.category === 'healthcare' ? <HiOutlineBuildingOffice2 className="h-5 w-5" /> : <HiOutlineMapPin className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold leading-5 text-slate-900">{formatPlaceSearchPrimaryLabel(result)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {categoryLabel ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                {categoryLabel}
                              </span>
                            ) : null}
                            {distanceKm !== null ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                                {formatDistanceBadge(distanceKm)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 break-words text-xs leading-5 text-slate-500">{formatPlaceSearchSecondaryLabel(result)}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CompactSection>
          ) : null}

          {visibleAddressResults.length > 0 ? (
            <CompactSection title="Addresses" href={sectionHref.addresses} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {visibleAddressResults.map(({ result, distanceKm }) => (
                  <li key={`${result.placeId ?? result.displayName}-${result.latitude}-${result.longitude}`}>
                    <Link href={buildAddressesHrefFromPlaceResult(result, trimmedQuery)} onClick={onResultSelect} className="flex items-start gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <HiOutlineMapPin className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold leading-5 text-slate-900">{formatPlaceSearchPrimaryLabel(result)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {distanceKm !== null ? (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                              {formatDistanceBadge(distanceKm)}
                            </span>
                          ) : null}
                          {isAddressPostalVerified(result) ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                              <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                              Verified Address
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 break-words text-xs leading-5 text-slate-500">{formatPlaceSearchSecondaryLabel(result)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {peopleResults.length > 0 ? (
            <CompactSection title="People" href={sectionHref.people} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {peopleResults.map((person) => {
                  const displayName = formatUserDisplayName(person.name, person.handle) || person.handle
                  return (
                    <li key={person.id}>
                      <Link href={`/u/${person.handle}`} onClick={onResultSelect} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                        <VerifiedAvatar
                          src={person.avatarUrl}
                          alt={displayName}
                          initials={displayName}
                          size={40}
                          isVerified={person.isVerified}
                          isBusiness={person.isPremium}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-slate-900">
                            <span className="truncate font-semibold">{displayName}</span>
                            <span className="truncate text-xs text-slate-500">@{person.handle}</span>
                          </div>
                          <p className="truncate text-xs text-slate-500">{renderHomeCommunity(person.homeCommunity ?? null)}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CompactSection>
          ) : null}

          {communityResults.length > 0 ? (
            <CompactSection title="Chambers" href={sectionHref.communities} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {communityResults.map((community) => (
                  <li key={`${community.provinceCode}:${community.slug}`}>
                    <Link
                      href={`/${community.provinceCode.toLowerCase()}/${encodeURIComponent(community.slug)}`}
                      onClick={onResultSelect}
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <HiOutlineMapPin className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{community.communityName}</span>
                        <p className="truncate text-xs text-slate-500">{community.provinceName} • {community.name}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {organizationResults.length > 0 ? (
            <CompactSection title="Organizations" href={sectionHref.organizations} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {organizationResults.map((organization) => (
                  <li key={organization.id}>
                    <Link href={organization.href} onClick={onResultSelect} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      {organization.logoUrl ? (
                        <img src={organization.logoUrl} alt={organization.name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <HiOutlineBuildingOffice2 className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{organization.name}</span>
                        <p className="truncate text-xs text-slate-500">{organization.communityName ?? organization.communitySlug} • {organization.provinceCode.toUpperCase()}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {eventResults.length > 0 ? (
            <CompactSection title="Events" href={sectionHref.events} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {eventResults.map((event) => (
                  <li key={event.id}>
                    <Link href={event.href} onClick={onResultSelect} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      {event.imageUrl ? (
                        <img src={event.imageUrl} alt={event.title} className="h-10 w-10 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          <HiOutlineCalendarDays className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{event.title}</span>
                        <p className="truncate text-xs text-slate-500">{event.organization.name}{event.startsAtLabel ? ` • ${event.startsAtLabel}` : ''}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {marketResults.length > 0 ? (
            <CompactSection title="Market" href={sectionHref.market} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {marketResults.map((listing) => (
                  <li key={listing.id}>
                    <Link href={listing.href} onClick={onResultSelect} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      {listing.imageUrl ? (
                        <img src={listing.imageUrl} alt={listing.title} className="h-10 w-10 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          <HiOutlineShoppingBag className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-slate-900">
                          <span className="truncate font-semibold">{listing.title}</span>
                          <span className="truncate text-xs font-semibold text-[var(--cc-primary)]">{listing.priceLabel}</span>
                        </div>
                        {listing.locationLabel ? <p className="truncate text-xs text-slate-500">{listing.locationLabel}</p> : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {postResults.length > 0 ? (
            <CompactSection title="Posts" href={sectionHref.posts} onResultSelect={onResultSelect}>
              <ul className="divide-y divide-slate-100">
                {postResults.map((post) => {
                  const displayName = formatUserDisplayName(post.author.name, post.author.handle) || post.author.handle
                  return (
                    <li key={post.id}>
                      <Link href={post.href} onClick={onResultSelect} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                        {post.imageUrl ? (
                          <img src={post.imageUrl} alt={post.title || 'Post'} className="h-10 w-10 rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                            <HiOutlineDocumentText className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-900">{post.title || post.excerpt || 'Community post'}</span>
                          <p className="truncate text-xs text-slate-500">{displayName} • {post.organization?.name ?? post.communityName ?? 'Community'}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CompactSection>
          ) : null}
        </div>
      )}
    </div>
  )
}
