'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { HiOutlineCheckBadge, HiOutlineChevronDown, HiOutlineHeart, HiOutlineSparkles } from 'react-icons/hi2'
import Block from '../_components/Block'
import DashboardShell from '../_components/DashboardShell'
import { AddressDirectionsMap } from '../_components/map/AddressDirectionsMap'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import {
  buildAddressSearchQueries,
  buildAddressesHref,
  buildAddressesHrefFromAddress,
  calculateDistanceKm,
  estimateTravelMinutes,
  fetchDrivingRoute,
  fetchAddressSearchResults,
  formatAddressPrimaryLabel,
  formatAddressSecondaryLabel,
  isAddressPostalVerified,
  isUsableAddressQuery,
  type NominatimAddress,
} from '../_lib/addressSearch'
import {
  isCanadianAddressPostalVerified,
  normalizeSavedShippingAddress,
  type SavedShippingAddress,
} from '../_lib/canadianAddresses'
import { getStoredToken } from '../_lib/tokenStorage'

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
}

type FavoriteAddress = {
  id: string
  label: string
  address: string | null
  latitude: number | null
  longitude: number | null
  savedAt: string
}

type OriginOption = {
  id: string
  label: string
  detail: string | null
  address: SavedShippingAddress | null
  verified: boolean
}

type ResolvedOrigin = {
  id: string
  label: string
  latitude: number
  longitude: number
  detail: string | null
}

type TravelSummary = {
  distanceKm: number
  travelMinutes: number
  label: string
  sourcedFromRoute: boolean
}

function normalizeQueryValue(value: string | null) {
  return value?.trim() ?? ''
}

function parseCoordinate(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeAddressCompareText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function extractPostalCodeToken(value: string | null | undefined) {
  const match = (value ?? '').toUpperCase().match(/[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d/)
  return match ? match[0].replace(/\s+/g, '') : ''
}

function formatEstimate(distanceKm: number, travelMinutes: number) {
  const hours = Math.floor(travelMinutes / 60)
  const minutes = travelMinutes % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m • ${distanceKm.toFixed(1)} km`
  }
  return `${travelMinutes} min • ${distanceKm.toFixed(1)} km`
}

const ADDRESS_FAVORITES_STORAGE_KEY = 'civil_address_favorites'

function formatSavedOriginFailureReason(attempts: Array<{ query: string; reason: string }>) {
  if (!attempts.length) return 'Unable to resolve that saved address on the map.'

  const lines = attempts.map((attempt) => `Tried "${attempt.query}": ${attempt.reason}.`)
  return ['Unable to resolve that saved address on the map.', ...lines].join(' ')
}

function readFavoriteAddresses() {
  if (typeof window === 'undefined') return [] as FavoriteAddress[]
  try {
    const raw = window.localStorage.getItem(ADDRESS_FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const record = entry as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        if (!id || !label) return null
        return {
          id,
          label,
          address: typeof record.address === 'string' ? record.address.trim() || null : null,
          latitude: typeof record.latitude === 'number' && Number.isFinite(record.latitude) ? record.latitude : null,
          longitude: typeof record.longitude === 'number' && Number.isFinite(record.longitude) ? record.longitude : null,
          savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
        } satisfies FavoriteAddress
      })
      .filter((entry): entry is FavoriteAddress => Boolean(entry))
  } catch {
    return []
  }
}

function writeFavoriteAddresses(items: FavoriteAddress[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ADDRESS_FAVORITES_STORAGE_KEY, JSON.stringify(items))
}

function normalizeFavoriteId(label: string, latitude: number | null, longitude: number | null) {
  return `${label.trim().toLowerCase()}::${latitude ?? 'na'}::${longitude ?? 'na'}`
}

function isHomeAddress(address: SavedShippingAddress) {
  const label = `${address.label ?? ''} ${address.name ?? ''}`.trim().toLowerCase()
  return address.isDefault || label.includes('home')
}

function formatSavedAddressTitle(address: SavedShippingAddress, fallback: string) {
  return address.label?.trim() || address.name?.trim() || fallback
}

function formatSavedAddressDetail(address: SavedShippingAddress, options?: { includeName?: boolean }) {
  const includeName = options?.includeName ?? true
  const lines = [includeName ? address.name?.trim() : '', address.line1?.trim(), address.line2?.trim()].filter(Boolean)
  const locality = [
    address.city?.trim(),
    address.province?.trim(),
    isCanadianAddressPostalVerified(address) ? address.postalCode?.trim() : '',
  ]
    .filter(Boolean)
    .join(', ')
  if (locality) lines.push(locality)
  return lines.join(', ')
}

function formatHomeAddressTitle(address: SavedShippingAddress) {
  const nickname = address.name?.trim()
  return nickname ? `Home, ${nickname}` : 'Home'
}

function AddressPageRightRail({
  homeAddress,
  nextAddress,
  favoriteAddresses,
}: {
  homeAddress: SavedShippingAddress | null
  nextAddress: SavedShippingAddress | null
  favoriteAddresses: FavoriteAddress[]
}) {
  return (
    <>
      <Block title="My Addresses" action={{ label: 'Manage', href: '/market/account' }} className="mb-4">
        <div className="space-y-3">
          {homeAddress ? (
            <Link
              href={buildAddressesHrefFromAddress(homeAddress, 'Home')}
              className="block rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 transition hover:border-emerald-300 hover:bg-emerald-100/70"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-emerald-900">{formatHomeAddressTitle(homeAddress)}</p>
                {isCanadianAddressPostalVerified(homeAddress) ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                    <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                    Verified Address
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-emerald-800">{formatSavedAddressDetail(homeAddress, { includeName: false })}</p>
            </Link>
          ) : null}
          {nextAddress ? (
            <Link
              href={buildAddressesHrefFromAddress(nextAddress, nextAddress.label?.trim() || nextAddress.name?.trim() || 'Next address')}
              className="block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-white"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{formatSavedAddressTitle(nextAddress, 'Next Address')}</p>
                {isCanadianAddressPostalVerified(nextAddress) ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                    <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                    Verified Address
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">{formatSavedAddressDetail(nextAddress)}</p>
            </Link>
          ) : null}
          {!homeAddress && !nextAddress ? <p className="text-sm text-slate-500">No saved addresses yet.</p> : null}
        </div>
      </Block>

      <Block title="My Favorites">
        <div className="space-y-3">
          {favoriteAddresses.length ? (
            favoriteAddresses.map((favorite) => (
              <Link
                key={favorite.id}
                href={buildAddressesHref({
                  query: favorite.address || favorite.label,
                  label: favorite.label,
                  address: favorite.address,
                  latitude: favorite.latitude,
                  longitude: favorite.longitude,
                })}
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-white"
              >
                <p className="text-sm font-semibold text-slate-900">{favorite.label}</p>
                {favorite.address ? <p className="mt-1 text-xs text-slate-500">{favorite.address}</p> : null}
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">No favorite addresses saved yet.</p>
          )}
        </div>
      </Block>
    </>
  )
}

export default function AddressSearchPageClient() {
  const searchParams = useSearchParams()
  const initialQuery = normalizeQueryValue(searchParams.get('q'))
  const initialLabel = normalizeQueryValue(searchParams.get('label'))
  const initialAddress = normalizeQueryValue(searchParams.get('address'))
  const initialLatitude = parseCoordinate(searchParams.get('lat'))
  const initialLongitude = parseCoordinate(searchParams.get('lon'))
  const query = initialQuery || initialLabel || initialAddress

  const [results, setResults] = useState<NominatimAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [favoriteAddresses, setFavoriteAddresses] = useState<FavoriteAddress[]>([])
  const [originMenuOpen, setOriginMenuOpen] = useState(false)
  const [originLoading, setOriginLoading] = useState(false)
  const [originError, setOriginError] = useState<string | null>(null)
  const [resolvedOrigin, setResolvedOrigin] = useState<ResolvedOrigin | null>(null)
  const [travelSummary, setTravelSummary] = useState<TravelSummary | null>(null)
  const [routeCoordinates, setRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setFavoriteAddresses(readFavoriteAddresses())
  }, [])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      setSavedAddresses([])
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const { json } = await parseApiResponse<ShippingAddressListResponse>(response)
        if (!response.ok || cancelled) return
        const items = Array.isArray(json?.items) ? json.items.map((item) => normalizeSavedShippingAddress(item)).filter((item): item is SavedShippingAddress => Boolean(item)) : []
        setSavedAddresses(items)
      } catch {
        if (!cancelled) setSavedAddresses([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (!isUsableAddressQuery(trimmedQuery)) {
      setResults([])
      setLoading(false)
      setError(null)
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      return
    }

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)

    void fetchAddressSearchResults(trimmedQuery, controller.signal, 8)
      .then((nextResults) => {
        setResults(nextResults)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setError('Unable to search addresses right now.')
      })
      .finally(() => {
        setLoading(false)
      })

    return () => controller.abort()
  }, [query])

  const selectedDestination = useMemo(() => {
    const matchedByCoordinates =
      initialLatitude !== null && initialLongitude !== null
        ? results.find((entry) => Math.abs(entry.latitude - initialLatitude) < 0.00001 && Math.abs(entry.longitude - initialLongitude) < 0.00001) ?? null
        : null

    const initialPostalToken = extractPostalCodeToken(initialAddress)
    const initialStreetToken = normalizeAddressCompareText(initialLabel || initialQuery || initialAddress.split(',')[0] || '')
    const matchedBySavedAddress =
      !matchedByCoordinates && (initialPostalToken || initialStreetToken)
        ? results.find((entry) => {
            const entryPostalToken = extractPostalCodeToken(entry.address.postcode || entry.displayName)
            const entryStreetToken = normalizeAddressCompareText(formatAddressPrimaryLabel(entry))
            if (initialPostalToken && entryPostalToken && initialPostalToken !== entryPostalToken) return false
            if (initialStreetToken && entryStreetToken && initialStreetToken !== entryStreetToken) return false
            return Boolean((initialPostalToken && entryPostalToken) || (initialStreetToken && entryStreetToken))
          }) ?? null
        : null

    if (matchedByCoordinates) return matchedByCoordinates
    if (matchedBySavedAddress) return matchedBySavedAddress
    if (results[0]) return results[0]
    if (initialLatitude !== null && initialLongitude !== null && (initialLabel || initialAddress || initialQuery)) {
      return {
        placeId: null,
        osmType: null,
        osmId: null,
        displayName: initialAddress || initialLabel || initialQuery,
        latitude: initialLatitude,
        longitude: initialLongitude,
        className: null,
        typeName: null,
        importance: null,
        address: {},
        originalPostalCode: null,
        postalCodeVerified: false,
        nominatimRaw: {},
      } satisfies NominatimAddress
    }
    return null
  }, [initialAddress, initialLabel, initialLatitude, initialLongitude, initialQuery, results])

  const destinationLabel = selectedDestination ? formatAddressPrimaryLabel(selectedDestination) : initialLabel || initialQuery || 'Address'
  const destinationDetail = selectedDestination ? formatAddressSecondaryLabel(selectedDestination) : initialAddress || null

  const originOptions = useMemo<OriginOption[]>(() => {
    const items = savedAddresses.map((item) => ({
      id: item.id,
      label: item.label?.trim() || item.name?.trim() || 'Saved address',
      detail: buildAddressSearchQueries(item)[0] || null,
      address: item,
      verified: isCanadianAddressPostalVerified(item),
    }))
    return [{ id: 'current', label: 'Current Location', detail: 'Use this device location', address: null, verified: false }, ...items]
  }, [savedAddresses])

  const orderedSavedAddresses = useMemo(
    () => [...savedAddresses].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? '').localeCompare(String(right.label ?? ''))),
    [savedAddresses],
  )

  const homeAddress = useMemo(() => orderedSavedAddresses.find((address) => isHomeAddress(address)) ?? null, [orderedSavedAddresses])
  const nextAddress = useMemo(
    () => orderedSavedAddresses.find((address) => !homeAddress || address.id !== homeAddress.id) ?? null,
    [homeAddress, orderedSavedAddresses],
  )

  useEffect(() => {
    if (!selectedDestination || !resolvedOrigin) {
      setTravelSummary(null)
      setRouteCoordinates(null)
      return
    }

    const controller = new AbortController()
    const fallbackDistanceKm = calculateDistanceKm(
      { latitude: resolvedOrigin.latitude, longitude: resolvedOrigin.longitude },
      { latitude: selectedDestination.latitude, longitude: selectedDestination.longitude },
    )
    const fallbackTravelMinutes = estimateTravelMinutes(fallbackDistanceKm)

    setTravelSummary({
      distanceKm: fallbackDistanceKm,
      travelMinutes: fallbackTravelMinutes,
      label: formatEstimate(fallbackDistanceKm, fallbackTravelMinutes),
      sourcedFromRoute: false,
    })
    setRouteCoordinates(null)

    void fetchDrivingRoute(
      { latitude: resolvedOrigin.latitude, longitude: resolvedOrigin.longitude },
      { latitude: selectedDestination.latitude, longitude: selectedDestination.longitude },
      controller.signal,
    )
      .then((route) => {
        if (!route) return
        const distanceKm = route.distanceMeters / 1000
        const travelMinutes = Math.max(1, Math.round(route.durationSeconds / 60))
        setRouteCoordinates(route.geometry)
        setTravelSummary({
          distanceKm,
          travelMinutes,
          label: formatEstimate(distanceKm, travelMinutes),
          sourcedFromRoute: true,
        })
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return
      })

    return () => controller.abort()
  }, [resolvedOrigin, selectedDestination])

  const currentFavoriteId = useMemo(
    () => normalizeFavoriteId(destinationLabel, selectedDestination?.latitude ?? initialLatitude, selectedDestination?.longitude ?? initialLongitude),
    [destinationLabel, initialLatitude, initialLongitude, selectedDestination?.latitude, selectedDestination?.longitude],
  )

  const isFavorite = useMemo(() => favoriteAddresses.some((entry) => entry.id === currentFavoriteId), [currentFavoriteId, favoriteAddresses])
  const canSaveFavorite = Boolean(
    selectedDestination ||
      (initialLatitude !== null && initialLongitude !== null && (initialLabel || initialAddress || initialQuery)),
  )

  const resolveSavedOrigin = useCallback(async (option: OriginOption) => {
    if (!option.address) return
    setOriginLoading(true)
    setOriginError(null)

    try {
      if (typeof option.address.latitude === 'number' && typeof option.address.longitude === 'number') {
        setResolvedOrigin({
          id: option.id,
          label: option.label,
          latitude: option.address.latitude,
          longitude: option.address.longitude,
          detail: option.detail,
        })
        return
      }

      const geocodeQueries = buildAddressSearchQueries(option.address)
      if (!geocodeQueries.length) {
        setOriginError('That saved address does not have enough detail to geocode.')
        return
      }

      let firstResult: NominatimAddress | null = null
      const attempts: Array<{ query: string; reason: string }> = []
      for (const geocodeQuery of geocodeQueries) {
        try {
          const geocoded = await fetchAddressSearchResults(geocodeQuery, undefined, 1)
          if (geocoded[0]) {
            firstResult = geocoded[0]
            break
          }
          attempts.push({ query: geocodeQuery, reason: 'no address match returned' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown lookup failure'
          attempts.push({ query: geocodeQuery, reason: message.replace(/^nominatim_search_failed:/, 'lookup failed with status ') })
        }
      }

      if (!firstResult) {
        setOriginError(formatSavedOriginFailureReason(attempts))
        return
      }

      setResolvedOrigin({
        id: option.id,
        label: option.label,
        latitude: firstResult.latitude,
        longitude: firstResult.longitude,
        detail: option.detail,
      })
    } catch {
      setOriginError('Unable to resolve that saved address right now.')
    } finally {
      setOriginLoading(false)
    }
  }, [])

  const handleOriginSelect = useCallback(
    async (option: OriginOption) => {
      setOriginMenuOpen(false)
      setOriginError(null)

      if (option.id === 'current') {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setOriginError('Current location is not available on this device.')
          return
        }

        setOriginLoading(true)
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setResolvedOrigin({
              id: 'current',
              label: 'Current Location',
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              detail: 'Using this device location',
            })
            setOriginLoading(false)
          },
          () => {
            setOriginError('Location permission was denied or unavailable.')
            setOriginLoading(false)
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        )
        return
      }

      await resolveSavedOrigin(option)
    },
    [resolveSavedOrigin],
  )

  const handleSaveFavorite = useCallback(() => {
    const nextFavorite = {
      id: currentFavoriteId,
      label: destinationLabel,
      address: (selectedDestination?.displayName ?? initialAddress) || null,
      latitude: selectedDestination?.latitude ?? initialLatitude,
      longitude: selectedDestination?.longitude ?? initialLongitude,
      savedAt: new Date().toISOString(),
    } satisfies FavoriteAddress

    setFavoriteAddresses((current) => {
      if (current.some((entry) => entry.id === nextFavorite.id)) return current
      const next = [nextFavorite, ...current].slice(0, 12)
      writeFavoriteAddresses(next)
      return next
    })
  }, [currentFavoriteId, destinationLabel, initialAddress, initialLatitude, initialLongitude, selectedDestination])

  const rightRail = useMemo(
    () => <AddressPageRightRail homeAddress={homeAddress} nextAddress={nextAddress} favoriteAddresses={favoriteAddresses} />,
    [favoriteAddresses, homeAddress, nextAddress],
  )

  return (
    <DashboardShell rightRail={rightRail} mainClassName="space-y-6">
      {error ? <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {!loading && !error && !selectedDestination && isUsableAddressQuery(query) ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">No address matches found yet.</div>
      ) : null}

      {!isUsableAddressQuery(query) ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">Use the main search bar to look up an address.</div>
      ) : null}

      <div className="space-y-6">
        <section className="space-y-4 rounded-[28px] border border-white/60 bg-white/85 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-900">{destinationLabel}</h2>
              {isAddressPostalVerified(selectedDestination) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  <HiOutlineCheckBadge className="h-4 w-4" />
                  Verified Address
                </span>
              ) : null}
            </div>
            {destinationDetail ? <p className="mt-1 text-sm text-slate-500">{destinationDetail}</p> : null}
          </div>

          {loading ? <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Searching…</div> : null}

          {originLoading ? <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Resolving origin…</div> : null}
          {originError ? <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{originError}</div> : null}

          {travelSummary && resolvedOrigin ? (
            <div className="grid gap-3 rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Estimated travel</p>
                <p className="mt-1 text-lg font-semibold text-emerald-900">{travelSummary.label}</p>
                <p className="mt-1 text-sm text-emerald-800">From {resolvedOrigin.label} to {destinationLabel}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                <HiOutlineSparkles className="h-4 w-4 text-emerald-600" />
                <span>{travelSummary.sourcedFromRoute ? 'Driving route' : 'Straight-line estimate'}</span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="relative flex justify-center">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleSaveFavorite}
              disabled={!canSaveFavorite || isFavorite}
              className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold shadow-sm transition ${!canSaveFavorite ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : isFavorite ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-700 hover:border-[var(--cc-primary)]/50 hover:text-[var(--cc-primary)]'}`}
            >
              <HiOutlineHeart className="h-4 w-4" />
              <span>{isFavorite ? 'Saved Favorite' : 'Save Favorite'}</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setOriginMenuOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--cc-primary)]/50 hover:text-[var(--cc-primary)]"
              >
                <span>Get Directions</span>
                <HiOutlineChevronDown className={`h-4 w-4 transition ${originMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {originMenuOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.75rem)] z-20 w-[min(calc(100vw-2rem),24rem)] max-w-[calc(100vw-2rem)] rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-2xl shadow-slate-900/10 backdrop-blur sm:left-1/2 sm:right-auto sm:w-[min(92vw,24rem)] sm:max-w-none sm:-translate-x-1/2">
                  <p className="px-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Choose origin</p>
                  <div className="mt-3 space-y-2">
                    {originOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => void handleOriginSelect(option)}
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-left transition hover:border-[var(--cc-primary)]/30 hover:bg-white"
                      >
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                          {option.verified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                              <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                              Verified Address
                            </span>
                          ) : null}
                        </div>
                        {option.detail ? <p className="mt-1 text-xs text-slate-500">{option.detail}</p> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section>
          <AddressDirectionsMap
            destination={
              selectedDestination
                ? {
                    latitude: selectedDestination.latitude,
                    longitude: selectedDestination.longitude,
                    label: destinationLabel,
                  }
                : null
            }
            origin={
              resolvedOrigin
                ? {
                    latitude: resolvedOrigin.latitude,
                    longitude: resolvedOrigin.longitude,
                    label: resolvedOrigin.label,
                  }
                : null
            }
            routeCoordinates={routeCoordinates}
          />
        </section>
      </div>
    </DashboardShell>
  )
}