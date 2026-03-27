'use client'

import type { ElectoralDistrictContextResponse } from '@civil/shared'
import { useEffect, useRef, useState } from 'react'
import { HiOutlineBuildingOffice2, HiOutlineCheckBadge, HiOutlineMagnifyingGlass, HiOutlineMapPin } from 'react-icons/hi2'
import Modal from '../Modal'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import {
  createEmptyCanadianAddress,
  formatCanadianPhysicalAddressInline,
  getCanadianAddressSystemDisplayName,
  hasCanadianAddressValue,
  isCanadianAddressPostalVerified,
  normalizeCanadianAddress,
  normalizeCanadianPostalCode,
  type CanadianAddress,
  type SavedShippingAddress,
  normalizeSavedShippingAddress,
} from '../../_lib/canadianAddresses'
import {
  buildCanadianAddressFromSearchResult,
  fetchPlaceSearchResults,
  formatPlaceSearchCategoryLabel,
  formatPlaceSearchPrimaryLabel,
  formatPlaceSearchSecondaryLabel,
  isAddressPostalVerified,
  isUsableAddressQuery,
  type CivilPlaceSearchResults,
} from '../../_lib/addressSearch'
import {
  formatSavedShippingAddressDetail,
  formatSavedShippingAddressTitle,
  searchSavedShippingAddresses,
  type SavedAddressSearchResult,
} from '../../_lib/savedAddressSearch'
import { CivilDistrictMap } from '../map/CivilDistrictMap'
import CivilMapLoadingState from '../map/CivilMapLoadingState'
import { pushToast } from '../useToasts'

type CanadianAddressEditorProps = {
  value: CanadianAddress | null | undefined
  onChange: (next: CanadianAddress) => void
  onSearchQueryChange?: (next: string) => void
  disabled?: boolean
  mode?: 'shipping' | 'organization'
  layout?: 'default' | 'stacked'
  display?: 'full' | 'search-only'
  searchLatitude?: number | null
  searchLongitude?: number | null
  searchRadiusKm?: number | null
  isDefault?: boolean
  onDefaultChange?: (next: boolean) => void
  required?: boolean
}

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
}

function readToken() {
  return typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readNominatimMetadata(address: CanadianAddress) {
  if (!address.nominatimRaw || typeof address.nominatimRaw !== 'object' || Array.isArray(address.nominatimRaw)) return null
  return address.nominatimRaw as Record<string, unknown>
}

function formatAddressSeedLine(address: CanadianAddress) {
  const showPostalCode = Boolean(address.postalCode && address.originalPostalCode && address.postalCode !== address.originalPostalCode)
  const locality = [address.city, address.province, showPostalCode ? address.postalCode : ''].filter(Boolean).join(', ')
  return [address.line1, address.line2, locality].filter(Boolean).join(', ')
}

function hasStructuredAddressCore(address: CanadianAddress) {
  return Boolean(address.line1 && address.city && address.province)
}

function formatSearchSeed(address: CanadianAddress) {
  const nominatimMetadata = readNominatimMetadata(address)
  const rawKind = normalizeText(nominatimMetadata?.kind)
  const rawName = normalizeText(nominatimMetadata?.name)
  const systemDisplayName = normalizeText(getCanadianAddressSystemDisplayName(address))
  if (rawKind === 'place') {
    return rawName || systemDisplayName.split(',')[0]?.trim() || systemDisplayName
  }
  if (hasStructuredAddressCore(address)) {
    return formatAddressSeedLine(address) || formatCanadianPhysicalAddressInline(address) || address.line1 || ''
  }
  return systemDisplayName || formatAddressSeedLine(address) || formatCanadianPhysicalAddressInline(address) || address.line1 || ''
}

function clearResolvedAddressFields(address: CanadianAddress): CanadianAddress {
  return {
    ...address,
    line1: '',
    line2: '',
    city: '',
    province: '',
    postalCode: '',
    originalPostalCode: '',
    latitude: null,
    longitude: null,
    nominatimDisplayName: '',
    nominatimRaw: null,
  }
}

export function CanadianAddressEditor({
  value,
  onChange,
  onSearchQueryChange,
  disabled = false,
  mode = 'organization',
  layout = 'default',
  display = 'full',
  searchLatitude = null,
  searchLongitude = null,
  searchRadiusKm = null,
  isDefault = false,
  onDefaultChange,
  required = false,
}: CanadianAddressEditorProps) {
  const displayValue: CanadianAddress = {
    ...createEmptyCanadianAddress(),
    ...(value && typeof value === 'object' ? value : {}),
  }
  const normalizedValue = normalizeCanadianAddress(value ?? createEmptyCanadianAddress())
  const [preview, setPreview] = useState<ElectoralDistrictContextResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState(() => formatSearchSeed(normalizedValue))
  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [savedAddressesLoaded, setSavedAddressesLoaded] = useState(false)
  const [searchResults, setSearchResults] = useState<CivilPlaceSearchResults>({ places: [], addresses: [] })
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const [postalInput, setPostalInput] = useState(normalizedValue.postalCode ?? '')
  const [postalVerifyModalOpen, setPostalVerifyModalOpen] = useState(false)
  const [savingCorrection, setSavingCorrection] = useState(false)
  const blurTimeoutRef = useRef<number | null>(null)
  const lastResolvedSearchSeedRef = useRef(formatSearchSeed(normalizedValue))

  useEffect(() => {
    setPostalInput(normalizedValue.postalCode ?? '')
  }, [normalizedValue.postalCode])

  useEffect(() => {
    const nextSeed = formatSearchSeed(normalizedValue)
    const lastSeed = lastResolvedSearchSeedRef.current
    if (nextSeed === lastSeed) return
    lastResolvedSearchSeedRef.current = nextSeed
    if (!searchFocused) {
      setSearchQuery(nextSeed)
    }
  }, [normalizedValue, searchFocused])

  useEffect(() => {
    onSearchQueryChange?.(searchQuery)
  }, [onSearchQueryChange, searchQuery])

  useEffect(() => {
    const token = readToken()
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
  }, [])

  useEffect(() => () => {
    if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (!searchFocused) {
      setSearchResults({ places: [], addresses: [] })
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    const trimmedQuery = searchQuery.trim()
    if (!isUsableAddressQuery(trimmedQuery)) {
      setSearchResults({ places: [], addresses: [] })
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    const controller = new AbortController()
    setSearchLoading(true)
    setSearchError(null)

    void fetchPlaceSearchResults(trimmedQuery, controller.signal, {
      limit: 5,
      latitude: searchLatitude,
      longitude: searchLongitude,
      radiusKm: searchRadiusKm,
    })
      .then((results) => {
        setSearchResults(results)
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return
        setSearchError('Unable to search places right now.')
      })
      .finally(() => {
        setSearchLoading(false)
      })

    return () => controller.abort()
  }, [searchFocused, searchLatitude, searchLongitude, searchQuery, searchRadiusKm])

  useEffect(() => {
    if (display === 'search-only') {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    const token = readToken()
    if (!token) {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    const postalCode = normalizeCanadianPostalCode(normalizedValue.postalCode)
    const hasCoordinates = Number.isFinite(normalizedValue.latitude) && Number.isFinite(normalizedValue.longitude)
    if (!postalCode && !hasCoordinates) {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const response = await fetch(buildApiUrl('/geography/district-context'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            hasCoordinates
              ? { lat: normalizedValue.latitude, lng: normalizedValue.longitude, postalCode: postalCode || undefined }
              : { postalCode },
          ),
        })
        const { json } = await parseApiResponse<ElectoralDistrictContextResponse & { error?: unknown }>(response)
        if (cancelled) return
        if (!response.ok || !json?.userLocation) {
          setPreview(null)
          setPreviewError('Map preview unavailable for this address yet.')
          return
        }
        setPreview(json)
      } catch {
        if (cancelled) return
        setPreview(null)
        setPreviewError('Map preview unavailable for this address yet.')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [display, normalizedValue.latitude, normalizedValue.longitude, normalizedValue.postalCode])

  function patchAddress(patch: Partial<CanadianAddress>) {
    onChange({ ...displayValue, ...patch })
  }

  function handleSearchQueryChange(nextQuery: string) {
    setSearchQuery(nextQuery)

    const normalizedNextQuery = nextQuery.trim()
    const normalizedResolvedSeed = lastResolvedSearchSeedRef.current.trim()
    if (!normalizedNextQuery || normalizedNextQuery === normalizedResolvedSeed) return

    const clearedAddress = clearResolvedAddressFields(displayValue)
    setPostalInput('')
    onChange(clearedAddress)
  }

  async function confirmPostalCorrection() {
    const token = readToken()
    const correctedPostal = normalizeCanadianPostalCode(postalInput)
    const originalPostal = normalizeCanadianPostalCode(normalizedValue.originalPostalCode || normalizedValue.postalCode)
    if (!correctedPostal) {
      pushToast('Enter a corrected postal code first.', 'error')
      return false
    }

    patchAddress({
      postalCode: correctedPostal,
      originalPostalCode: normalizedValue.originalPostalCode || originalPostal || null,
    })

    if (
      !token ||
      typeof normalizedValue.latitude !== 'number' ||
      typeof normalizedValue.longitude !== 'number'
    ) {
      return true
    }

    setSavingCorrection(true)
    try {
      const response = await fetch(buildApiUrl('/address-corrections'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          latitude: normalizedValue.latitude,
          longitude: normalizedValue.longitude,
          originalPostal: originalPostal || null,
          correctedPostal,
        }),
      })
      if (!response.ok) {
        pushToast('Unable to save that postal correction right now.', 'error')
        return false
      }
      pushToast('Postal correction saved.', 'success')
      return true
    } catch {
      pushToast('Unable to save that postal correction right now.', 'error')
      return false
    } finally {
      setSavingCorrection(false)
    }
  }

  const canSearch = isUsableAddressQuery(searchQuery)
  const isSearchOnly = display === 'search-only'
  const showShippingFields = mode === 'shipping' && !isSearchOnly
  const hasAnyAddress = hasCanadianAddressValue(displayValue)
  const hasCivilPostalVerification = isCanadianAddressPostalVerified(normalizedValue)
  const postalActionLabel = hasCivilPostalVerification ? 'Update Verification' : 'Verify Postal'
  const isStackedLayout = layout === 'stacked'
  const searchAnchor =
    typeof searchLatitude === 'number' &&
    Number.isFinite(searchLatitude) &&
    typeof searchLongitude === 'number' &&
    Number.isFinite(searchLongitude)
      ? { latitude: searchLatitude, longitude: searchLongitude }
      : null
  const savedSearchResults = searchSavedShippingAddresses(savedAddresses, searchQuery, {
    anchor: searchAnchor,
    limit: 4,
  }) satisfies SavedAddressSearchResult[]
  const hasSearchResults = savedSearchResults.length > 0 || searchResults.places.length > 0 || searchResults.addresses.length > 0

  function handleSavedAddressSelect(address: SavedShippingAddress) {
    const nextValue = normalizeCanadianAddress(address)
    const nextSeed = formatSearchSeed(nextValue)
    onChange(nextValue)
    lastResolvedSearchSeedRef.current = nextSeed
    setSearchQuery(nextSeed)
    setSearchResults({ places: [], addresses: [] })
    setSearchFocused(false)
    setPostalVerifyModalOpen(false)
    setPostalInput(nextValue.postalCode ?? '')
  }

  function handleSearchResultSelect(result: CivilPlaceSearchResults['places'][number] | CivilPlaceSearchResults['addresses'][number]) {
    const nextValue = buildCanadianAddressFromSearchResult(result, displayValue)
    const nextSeed = formatSearchSeed(nextValue)
    onChange(nextValue)
    lastResolvedSearchSeedRef.current = nextSeed
    setSearchQuery(nextSeed)
    setSearchResults({ places: [], addresses: [] })
    setSearchFocused(false)
    setPostalVerifyModalOpen(false)
    setPostalInput(nextValue.postalCode ?? '')
  }

  return (
    <div className="space-y-4">
      <div className="hidden" aria-hidden="true">
        <input type="hidden" name="addressLine1" value={displayValue.line1 ?? ''} readOnly />
        <input type="hidden" name="addressLine2" value={displayValue.line2 ?? ''} readOnly />
        <input type="hidden" name="addressCity" value={displayValue.city ?? ''} readOnly />
        <input type="hidden" name="addressProvince" value={displayValue.province ?? ''} readOnly />
        <input type="hidden" name="addressPostalCode" value={displayValue.postalCode ?? ''} readOnly />
        <input type="hidden" name="addressOriginalPostalCode" value={displayValue.originalPostalCode ?? ''} readOnly />
        <input type="hidden" name="addressCountry" value={displayValue.country ?? ''} readOnly />
        <input type="hidden" name="addressLatitude" value={displayValue.latitude ?? ''} readOnly />
        <input type="hidden" name="addressLongitude" value={displayValue.longitude ?? ''} readOnly />
        <input type="hidden" name="addressNominatimDisplayName" value={displayValue.nominatimDisplayName ?? ''} readOnly />
      </div>

      {showShippingFields ? (
        <div className={isStackedLayout ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Nickname (optional, eg: Home, Work, School)
            <input
              value={displayValue.label ?? ''}
              onChange={(event) => patchAddress({ label: event.target.value })}
              disabled={disabled}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="Home"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Recipient name (optional)
            <input
              value={displayValue.name ?? ''}
              onChange={(event) => patchAddress({ name: event.target.value })}
              disabled={disabled}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="Full name"
            />
          </label>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="relative">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Search place or address{required ? ' *' : ''}
            <div className="relative">
              <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => handleSearchQueryChange(event.target.value)}
                onFocus={() => {
                  if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current)
                  setSearchFocused(true)
                }}
                onBlur={() => {
                  blurTimeoutRef.current = window.setTimeout(() => setSearchFocused(false), 150)
                }}
                disabled={disabled}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 pl-10 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
                placeholder="Search for a place or address"
              />
            </div>
          </label>

          {searchFocused && (searchLoading || searchError || hasSearchResults || canSearch) ? (
            <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-[min(70vh,28rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
              {searchLoading ? <p className="px-3 py-2 text-sm text-slate-500">Searching places and addresses…</p> : null}
              {!searchLoading && searchError ? <p className="px-3 py-2 text-sm text-rose-700">{searchError}</p> : null}
              {!searchLoading && !searchError && !canSearch ? <p className="px-3 py-2 text-sm text-slate-500">Enter at least three characters.</p> : null}
              {!searchLoading && !searchError && canSearch && !hasSearchResults ? <p className="px-3 py-2 text-sm text-slate-500">No place or address matches found yet.</p> : null}
              {!searchLoading && !searchError && hasSearchResults ? (
                <div className="space-y-3">
                  {savedSearchResults.length ? (
                    <section>
                      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                        My Addresses
                      </p>
                      <div className="space-y-1">
                        {savedSearchResults.map(({ address, distanceKm, isHome }) => (
                          <button
                            key={address.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSavedAddressSelect(address)}
                            className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
                          >
                            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isHome ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              <HiOutlineMapPin className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                                <span className="truncate">{formatSavedShippingAddressTitle(address)}</span>
                                {isHome ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                    Home
                                  </span>
                                ) : address.isDefault ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                    Default
                                  </span>
                                ) : null}
                                {distanceKm !== null ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                                    {distanceKm < 10 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`}
                                  </span>
                                ) : null}
                                {isCanadianAddressPostalVerified(address) ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                    <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                                    Verified Address
                                  </span>
                                ) : null}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {formatSavedShippingAddressDetail(address, { includeName: false }) || 'Saved in Settings > Addresses'}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {searchResults.places.length ? (
                    <section>
                      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                        Places
                      </p>
                      <div className="space-y-1">
                        {searchResults.places.map((result) => (
                          <button
                            key={`${result.placeId ?? 'place'}-${result.latitude}-${result.longitude}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSearchResultSelect(result)}
                            className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
                          >
                            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                              <HiOutlineBuildingOffice2 className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                                <span className="truncate">{formatPlaceSearchPrimaryLabel(result)}</span>
                                {formatPlaceSearchCategoryLabel(result) ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                    {formatPlaceSearchCategoryLabel(result)}
                                  </span>
                                ) : null}
                              </span>
                              <span className="block text-xs text-slate-500">{formatPlaceSearchSecondaryLabel(result)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {searchResults.addresses.length ? (
                    <section>
                      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                        Addresses
                      </p>
                      <div className="space-y-1">
                        {searchResults.addresses.map((result) => (
                          <button
                            key={`${result.placeId ?? 'addr'}-${result.latitude}-${result.longitude}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSearchResultSelect(result)}
                            className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
                          >
                            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                              <HiOutlineMapPin className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                                <span className="truncate">{formatPlaceSearchPrimaryLabel(result)}</span>
                                {isAddressPostalVerified(result) ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                    <HiOutlineCheckBadge className="h-3.5 w-3.5" />
                                    Verified Address
                                  </span>
                                ) : null}
                              </span>
                              <span className="block text-xs text-slate-500">{formatPlaceSearchSecondaryLabel(result)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}
              {!savedAddressesLoaded && !searchLoading ? <p className="px-3 py-1 text-xs text-slate-400">Loading saved addresses…</p> : null}
            </div>
          ) : null}
        </div>

        {!isSearchOnly ? (
          <>
            <div className={isStackedLayout ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Street
                <input
                  value={displayValue.line1 ?? ''}
                  disabled
                  readOnly
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 disabled:opacity-100"
                  placeholder="Resolved from address search"
                />
              </label>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Apt / Suite
                <input
                  value={displayValue.line2 ?? ''}
                  disabled
                  readOnly
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 disabled:opacity-100"
                  placeholder="Optional secondary line"
                />
              </label>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                City
                <input
                  value={displayValue.city ?? ''}
                  disabled
                  readOnly
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 disabled:opacity-100"
                  placeholder="Resolved from address search"
                />
              </label>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Province
                <input
                  value={displayValue.province ?? ''}
                  disabled
                  readOnly
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 disabled:opacity-100"
                  placeholder="Resolved from address search"
                />
              </label>
            </div>

            <div className={isStackedLayout ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end'}>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Postal code{required ? ' *' : ''}
                <input
                  value={postalInput}
                  onChange={(event) => {
                    const nextPostalCode = normalizeCanadianPostalCode(event.target.value)
                    setPostalInput(nextPostalCode)
                    patchAddress({ postalCode: nextPostalCode })
                  }}
                  disabled={disabled}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase tracking-[0.08em] focus:border-[var(--cc-primary)] focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
                  placeholder="A1A 1A1"
                />
              </label>

              <button
                type="button"
                onClick={() => setPostalVerifyModalOpen(true)}
                disabled={disabled || !normalizeCanadianPostalCode(postalInput)}
                className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${hasCivilPostalVerification ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700' : 'border-slate-200 bg-white text-slate-700 hover:border-[var(--cc-primary)]/40 hover:text-[var(--cc-primary)]'}`}
              >
                {postalActionLabel}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {showShippingFields && onDefaultChange ? (
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => onDefaultChange(event.target.checked)}
              disabled={disabled}
              className="h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
            />
            Set as default shipping address
          </label>
        ) : null}
      </div>

      {!isSearchOnly ? (
        <section>
          {preview ? (
            <CivilDistrictMap context={preview} />
          ) : previewLoading ? (
            <CivilMapLoadingState className="h-[220px]" />
          ) : (
            <div className="flex h-[220px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">
              {hasAnyAddress
                ? previewError ?? 'Map preview will appear here once we can resolve the location.'
                : 'Add an address to preview the map.'}
            </div>
          )}
        </section>
      ) : null}

      {!isSearchOnly ? (
        <Modal open={postalVerifyModalOpen} onClose={() => setPostalVerifyModalOpen(false)} title={postalActionLabel} maxWidthClassName="max-w-lg">
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-700">
              Civil needs its users to verify postal codes before shipping can be received.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setPostalVerifyModalOpen(false)}
                disabled={savingCorrection}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void confirmPostalCorrection().then((verified) => {
                    if (verified) setPostalVerifyModalOpen(false)
                  })
                }}
                disabled={disabled || savingCorrection || !normalizeCanadianPostalCode(postalInput)}
                className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${hasCivilPostalVerification ? 'border-sky-600 bg-sky-600 hover:bg-sky-700' : 'border-[var(--cc-primary)] bg-[var(--cc-primary)] hover:brightness-95'}`}
              >
                {savingCorrection ? `${postalActionLabel}…` : postalActionLabel}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
