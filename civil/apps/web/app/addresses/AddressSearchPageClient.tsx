'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { HiOutlineCheckBadge, HiOutlineHeart, HiOutlineSparkles } from 'react-icons/hi2'
import Block from '../_components/Block'
import CivilCard from '../_components/CivilCard'
import DashboardShell from '../_components/DashboardShell'
import Modal from '../_components/Modal'
import { AddressDirectionsMap, type AddressDirectionsMapHandle } from '../_components/map/AddressDirectionsMap'
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

type MarketPickupItem = {
  listingId: string
  threadId?: string | null
  role: 'seller' | 'buyer'
  title: string
  status: string
  priceCents: number
  currency: string
  photoUrl: string | null
  pickupCity?: string | null
  pickupProvince?: string | null
  pickupAddress?: SavedShippingAddress | null
}

type MarketPickupListResponse = {
  items?: MarketPickupItem[]
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

function formatCommunityLabel(value: string | null | undefined) {
  return (value ?? '')
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

const ADDRESS_FAVORITES_STORAGE_KEY = 'civil_address_favorites'

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

function formatOriginOptionLabel(address: SavedShippingAddress) {
  return address.label?.trim() || address.name?.trim() || formatSavedAddressDetail(address, { includeName: false }) || 'Saved address'
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
  marketPickups,
}: {
  homeAddress: SavedShippingAddress | null
  nextAddress: SavedShippingAddress | null
  favoriteAddresses: FavoriteAddress[]
  marketPickups: MarketPickupItem[]
}) {
  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/messages?inbox=market"
          className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/35 hover:bg-[var(--cc-primary)]/5"
        >
          Messages
        </Link>
      </div>

      <Block title="Market Pickups" className="mb-4">
        <div className="space-y-3">
          {marketPickups.length ? (
            marketPickups.map((pickup) => (
              <Link
                key={pickup.listingId}
                href={buildAddressesHrefFromAddress(pickup.pickupAddress ?? null, pickup.title)}
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-white"
              >
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {pickup.photoUrl ? <img src={pickup.photoUrl} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{pickup.title}</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{pickup.role}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatSavedAddressDetail(pickup.pickupAddress ?? {}, { includeName: false }) || 'Open directions'}</p>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">No pending pickups right now.</p>
          )}
        </div>
      </Block>

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
  const organizationId = normalizeQueryValue(searchParams.get('organizationId'))
  const organizationName = normalizeQueryValue(searchParams.get('organizationName'))
  const organizationSlug = normalizeQueryValue(searchParams.get('organizationSlug'))
  const organizationProvince = normalizeQueryValue(searchParams.get('organizationProvince')).toLowerCase()
  const organizationCommunity = normalizeQueryValue(searchParams.get('organizationCommunity')).toLowerCase()
  const organizationLogo = normalizeQueryValue(searchParams.get('organizationLogo'))
  const organizationCover = normalizeQueryValue(searchParams.get('organizationCover'))
  const query = initialQuery || initialLabel || initialAddress
  const organizationHref =
    organizationSlug && organizationProvince && organizationCommunity
      ? `/com/${encodeURIComponent(organizationProvince)}/${encodeURIComponent(organizationCommunity)}/orgs/${encodeURIComponent(organizationSlug)}`
      : null
  const communityHref =
    organizationProvince && organizationCommunity
      ? `/${encodeURIComponent(organizationProvince)}/${encodeURIComponent(organizationCommunity)}`
      : null

  const [results, setResults] = useState<NominatimAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [favoriteAddresses, setFavoriteAddresses] = useState<FavoriteAddress[]>([])
  const [marketPickups, setMarketPickups] = useState<MarketPickupItem[]>([])
  const [favoriteAddModalOpen, setFavoriteAddModalOpen] = useState(false)
  const [favoriteRemoveModalOpen, setFavoriteRemoveModalOpen] = useState(false)
  const [favoriteNickname, setFavoriteNickname] = useState('')
  const [selectedOriginId, setSelectedOriginId] = useState('current')
  const [originLoading, setOriginLoading] = useState(false)
  const [originError, setOriginError] = useState<string | null>(null)
  const [resolvedOrigin, setResolvedOrigin] = useState<ResolvedOrigin | null>(null)
  const [travelSummary, setTravelSummary] = useState<TravelSummary | null>(null)
  const [routeCoordinates, setRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const directionsMapRef = useRef<AddressDirectionsMapHandle | null>(null)

  useEffect(() => {
    setFavoriteAddresses(readFavoriteAddresses())
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadMarketPickups = async () => {
      const token = getStoredToken()
      if (!token) {
        if (!cancelled) setMarketPickups([])
        return
      }

      try {
        const response = await fetch(buildApiUrl('/market/pickups'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!response.ok) {
          if (!cancelled) setMarketPickups([])
          return
        }
        const payload = (await response.json().catch(() => null)) as MarketPickupListResponse | null
        if (cancelled) return
        setMarketPickups(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        if (!cancelled) setMarketPickups([])
      }
    }

    void loadMarketPickups()

    return () => {
      cancelled = true
    }
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

  const orderedSavedAddresses = useMemo(
    () => [...savedAddresses].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? '').localeCompare(String(right.label ?? ''))),
    [savedAddresses],
  )

  const originOptions = useMemo<OriginOption[]>(() => {
    const saved = orderedSavedAddresses.map((address) => ({
      id: address.id,
      label: formatOriginOptionLabel(address),
      detail: formatSavedAddressDetail(address, { includeName: false }),
      address,
      verified: isCanadianAddressPostalVerified(address),
    }))
    return [{ id: 'current', label: 'Current Location', detail: 'Use this device location', address: null, verified: false }, ...saved]
  }, [orderedSavedAddresses])

  const homeAddress = useMemo(() => orderedSavedAddresses.find((address) => isHomeAddress(address)) ?? null, [orderedSavedAddresses])
  const nextAddress = useMemo(
    () => orderedSavedAddresses.find((address) => !homeAddress || address.id !== homeAddress.id) ?? null,
    [homeAddress, orderedSavedAddresses],
  )

  const selectedOriginOption = useMemo(
    () => originOptions.find((option) => option.id === selectedOriginId) ?? originOptions[0] ?? null,
    [originOptions, selectedOriginId],
  )

  const resolveCurrentLocationOrigin = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setOriginError('Current location is not available on this device.')
      setResolvedOrigin(null)
      return
    }

    setOriginLoading(true)
    setOriginError(null)
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
        setResolvedOrigin(null)
        setOriginLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }, [])

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
        setResolvedOrigin(null)
        return
      }

      for (const geocodeQuery of geocodeQueries) {
        const geocoded = await fetchAddressSearchResults(geocodeQuery, undefined, 1)
        if (!geocoded[0]) continue

        setResolvedOrigin({
          id: option.id,
          label: option.label,
          latitude: geocoded[0].latitude,
          longitude: geocoded[0].longitude,
          detail: option.detail,
        })
        return
      }

      setOriginError('Unable to resolve that saved address on the map.')
      setResolvedOrigin(null)
    } catch {
      setOriginError('Unable to resolve that saved address right now.')
      setResolvedOrigin(null)
    } finally {
      setOriginLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedOriginId !== 'current') return
    resolveCurrentLocationOrigin()
  }, [resolveCurrentLocationOrigin, selectedOriginId])

  useEffect(() => {
    if (selectedOriginId === 'current' || !selectedOriginOption) return
    void resolveSavedOrigin(selectedOriginOption)
  }, [resolveSavedOrigin, selectedOriginId, selectedOriginOption])

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

  useEffect(() => {
    if (!favoriteAddModalOpen) {
      setFavoriteNickname(destinationLabel)
    }
  }, [destinationLabel, favoriteAddModalOpen])

  const handleGetDirections = useCallback(() => {
    void directionsMapRef.current?.startNavigation()
  }, [])

  const handleNavigationOriginChange = useCallback((origin: { latitude: number; longitude: number; label: string } | null) => {
    if (!origin) {
      if (selectedOriginId === 'current') {
        resolveCurrentLocationOrigin()
      } else if (selectedOriginOption) {
        void resolveSavedOrigin(selectedOriginOption)
      }
      return
    }

    setResolvedOrigin({
      id: 'current',
      label: origin.label,
      latitude: origin.latitude,
      longitude: origin.longitude,
      detail: 'Using this device location',
    })
    setOriginError(null)
  }, [resolveCurrentLocationOrigin, resolveSavedOrigin, selectedOriginId, selectedOriginOption])

  const handleFavoriteAddConfirm = useCallback(() => {
    const trimmedNickname = favoriteNickname.trim()
    if (!trimmedNickname) return

    setFavoriteAddresses((current) => {
      const nextFavorite = {
        id: currentFavoriteId,
        label: trimmedNickname,
        address: (selectedDestination?.displayName ?? initialAddress) || null,
        latitude: selectedDestination?.latitude ?? initialLatitude,
        longitude: selectedDestination?.longitude ?? initialLongitude,
        savedAt: new Date().toISOString(),
      } satisfies FavoriteAddress

      if (current.some((entry) => entry.id === nextFavorite.id)) return current
      const next = [nextFavorite, ...current].slice(0, 12)
      writeFavoriteAddresses(next)
      return next
    })
    setFavoriteAddModalOpen(false)
  }, [currentFavoriteId, favoriteNickname, initialAddress, initialLatitude, initialLongitude, selectedDestination])

  const handleFavoriteRemoveConfirm = useCallback(() => {
    setFavoriteAddresses((current) => {
      const next = current.filter((entry) => entry.id !== currentFavoriteId)
      writeFavoriteAddresses(next)
      return next
    })
    setFavoriteRemoveModalOpen(false)
  }, [currentFavoriteId])

  const handleFavoriteButtonClick = useCallback(() => {
    if (!canSaveFavorite) return
    if (isFavorite) {
      setFavoriteRemoveModalOpen(true)
      return
    }
    setFavoriteNickname(destinationLabel)
    setFavoriteAddModalOpen(true)
  }, [canSaveFavorite, destinationLabel, isFavorite])

  const rightRail = useMemo(
    () => <AddressPageRightRail homeAddress={homeAddress} nextAddress={nextAddress} favoriteAddresses={favoriteAddresses} marketPickups={marketPickups} />,
    [favoriteAddresses, homeAddress, marketPickups, nextAddress],
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
        {organizationId && organizationName && organizationHref ? (
          <CivilCard
            size="md"
            name={organizationName}
            avatarAlt={organizationName}
            avatarInitials={organizationName}
            avatarSrc={organizationLogo || null}
            avatarHref={organizationHref}
            titleHref={organizationHref}
            coverUrl={organizationCover || null}
            subtitle="Organization"
            details={
              communityHref ? (
                <Link href={communityHref} className="inline-flex text-sm font-medium text-white/90 hover:text-white hover:underline">
                  {formatCommunityLabel(organizationCommunity)} community
                </Link>
              ) : null
            }
            className="w-full"
          />
        ) : null}

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

          {originLoading ? <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Resolving route origin…</div> : null}
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
              onClick={handleFavoriteButtonClick}
              disabled={!canSaveFavorite}
              className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold shadow-sm transition ${!canSaveFavorite ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : isFavorite ? 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100' : 'border-slate-200 bg-white text-slate-700 hover:border-[var(--cc-primary)]/50 hover:text-[var(--cc-primary)]'}`}
            >
              <HiOutlineHeart className="h-4 w-4" />
              <span>{isFavorite ? 'Remove Favorite' : 'Save Favorite'}</span>
            </button>

            <label className="relative">
              <span className="sr-only">Route from</span>
              <select
                value={selectedOriginId}
                onChange={(event) => setSelectedOriginId(event.target.value)}
                className="min-w-[220px] appearance-none rounded-full border border-slate-200 bg-white px-5 py-2.5 pr-10 text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-[var(--cc-primary)]/50"
                aria-label="Route from"
              >
                {originOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-500">▾</span>
            </label>

            <button
              type="button"
              onClick={handleGetDirections}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-700 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            >
              <span>Start Trip</span>
            </button>
          </div>
        </section>

        <section>
          <AddressDirectionsMap
            ref={directionsMapRef}
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
            onNavigationOriginChange={handleNavigationOriginChange}
          />
        </section>
      </div>

      <Modal open={favoriteAddModalOpen} onClose={() => setFavoriteAddModalOpen(false)} title="Add To Favorites" maxWidthClassName="max-w-md">
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-900">Give a nickname?</span>
            <input
              type="text"
              value={favoriteNickname}
              onChange={(event) => setFavoriteNickname(event.target.value)}
              placeholder="Home, Mom, Cottage"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]/60"
            />
          </label>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setFavoriteAddModalOpen(false)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleFavoriteAddConfirm}
              disabled={!favoriteNickname.trim()}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${favoriteNickname.trim() ? 'bg-slate-950 text-white hover:bg-slate-800' : 'cursor-not-allowed bg-slate-200 text-slate-500'}`}
            >
              Add
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={favoriteRemoveModalOpen} onClose={() => setFavoriteRemoveModalOpen(false)} title="Remove Favorite" maxWidthClassName="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">Remove this address from your favorites?</p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setFavoriteRemoveModalOpen(false)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleFavoriteRemoveConfirm}
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
            >
              Remove
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}