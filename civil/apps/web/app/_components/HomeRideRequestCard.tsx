'use client'

import { calculateCivilFeeCents } from '@civil/shared'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HiChevronDown,
  HiOutlineArrowRight,
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineMap,
  HiOutlineMapPin,
  HiOutlineSparkles,
  HiOutlineStar,
  HiOutlineXMark,
} from 'react-icons/hi2'
import type { DriveRideRequestItem } from '../drive/driveShared'
import { formatDriveMoney } from '../drive/driveShared'
import {
  buildCanadianAddressFromSearchResult,
  calculateDistanceKm,
  fetchDrivingRoute,
  fetchPlaceSearchResults,
  fetchReverseGeocodeResult,
  formatPlaceSearchCategoryLabel,
  formatPlaceSearchPrimaryLabel,
  formatPlaceSearchSecondaryLabel,
  isUsableAddressQuery,
  type CivilPlaceSearchResults,
} from '../_lib/addressSearch'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import {
  createEmptyCanadianAddress,
  formatCanadianPhysicalAddressInline,
  normalizeCanadianAddress,
  normalizeSavedShippingAddress,
  type CanadianAddress,
  type SavedShippingAddress,
} from '../_lib/canadianAddresses'
import { getCurrentLocation, requestLocationPermission } from '../_lib/locationService'
import {
  formatSavedShippingAddressDetail,
  formatSavedShippingAddressTitle,
  isHomeSavedShippingAddress,
  searchSavedShippingAddresses,
} from '../_lib/savedAddressSearch'
import { getStoredToken } from '../_lib/tokenStorage'
import Modal from './Modal'
import { pushToast } from './useToasts'

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
}

type RideMutationResponse = {
  item?: DriveRideRequestItem | null
  error?: string
}

type RideTimingMode = 'now' | 'scheduled'

type RidePreview = {
  distanceKm: number
  travelMinutes: number | null
}

export type HomeRideMapPoint = {
  latitude: number
  longitude: number
  label: string
}

export type HomeRideMapPreview = {
  currentLocation: HomeRideMapPoint | null
  pickup: HomeRideMapPoint | null
  destination: HomeRideMapPoint | null
  routeCoordinates: Array<[number, number]> | null
}

const RIDE_DRIVER_FLAT_FEE_CENTS = 1000
const RIDE_FUEL_RATE_CENTS_PER_KM = 65
const RIDE_MIN_FUEL_CHARGE_CENTS = 500
const RIDE_TIME_STEP_MINUTES = 5
const RIDE_NOW_BUFFER_MINUTES = 5
const RIDE_SCHEDULE_BUFFER_MINUTES = 60

function hasMappedAddress(address: CanadianAddress | null | undefined) {
  return Boolean(
    address?.line1?.trim() &&
      address.city?.trim() &&
      address.province?.trim() &&
      address.postalCode?.trim() &&
      typeof address.latitude === 'number' &&
      Number.isFinite(address.latitude) &&
      typeof address.longitude === 'number' &&
      Number.isFinite(address.longitude),
  )
}

function hasCoordinates(address: CanadianAddress | SavedShippingAddress | null | undefined) {
  return Boolean(
    typeof address?.latitude === 'number' &&
      Number.isFinite(address.latitude) &&
      typeof address?.longitude === 'number' &&
      Number.isFinite(address.longitude),
  )
}

function roundDateToStepMinutes(value: Date, stepMinutes = RIDE_TIME_STEP_MINUTES) {
  const next = new Date(value)
  next.setSeconds(0, 0)
  const remainder = next.getMinutes() % stepMinutes
  if (remainder !== 0) {
    next.setMinutes(next.getMinutes() + (stepMinutes - remainder))
  }
  return next
}

function getImmediatePickupDate() {
  return roundDateToStepMinutes(new Date(Date.now() + RIDE_NOW_BUFFER_MINUTES * 60_000))
}

function getDefaultScheduledPickupDate() {
  return roundDateToStepMinutes(new Date(Date.now() + RIDE_SCHEDULE_BUFFER_MINUTES * 60_000))
}

function toDateTimeLocalValue(value: Date) {
  const next = new Date(value)
  next.setSeconds(0, 0)
  const timezoneOffsetMs = next.getTimezoneOffset() * 60_000
  return new Date(next.getTime() - timezoneOffsetMs).toISOString().slice(0, 16)
}

function parseDateTimeLocalValue(value: string) {
  if (!value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function formatPickupTimingLabel(mode: RideTimingMode, scheduledAtValue: string) {
  if (mode === 'now') return 'Pickup now'

  const scheduledDate = parseDateTimeLocalValue(scheduledAtValue)
  if (!scheduledDate) return 'Schedule later'

  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(scheduledDate)
}

function sortSavedAddresses(items: SavedShippingAddress[]) {
  return [...items].sort(
    (left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? left.line1 ?? '').localeCompare(String(right.label ?? right.line1 ?? '')),
  )
}

function formatAddressInputValue(address: CanadianAddress | null | undefined, fallback = '') {
  return formatCanadianPhysicalAddressInline(address) || address?.nominatimDisplayName?.trim() || fallback
}

function estimateRidePricing(distanceKm: number) {
  const safeDistanceKm = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0
  const fuelChargeCents = Math.max(RIDE_MIN_FUEL_CHARGE_CENTS, Math.round(safeDistanceKm * RIDE_FUEL_RATE_CENTS_PER_KM))
  const subtotalCents = fuelChargeCents + RIDE_DRIVER_FLAT_FEE_CENTS
  const civilFeeCents = calculateCivilFeeCents(subtotalCents)
  return {
    routeDistanceKm: Number(safeDistanceKm.toFixed(1)),
    fuelChargeCents,
    driverFeeCents: RIDE_DRIVER_FLAT_FEE_CENTS,
    civilFeeCents,
    totalCostCents: subtotalCents + civilFeeCents,
  }
}

function formatRideTravelTime(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return 'Estimating'

  const roundedMinutes = Math.max(1, Math.round(minutes))
  if (roundedMinutes < 60) return `${roundedMinutes} min`

  const hours = Math.floor(roundedMinutes / 60)
  const remainingMinutes = roundedMinutes % 60
  if (!remainingMinutes) return `${hours} hr`
  return `${hours} hr ${remainingMinutes} min`
}

function estimateDropoffAt(pickupDate: Date, preview: RidePreview | null) {
  const travelMinutes = preview?.travelMinutes ?? (preview?.distanceKm ? Math.max(20, Math.round((preview.distanceKm / 40) * 60)) : 30)
  const bufferedMinutes = Math.max(30, travelMinutes + 15)
  return new Date(pickupDate.getTime() + bufferedMinutes * 60_000)
}

function buildHomeRideMapPoint(address: CanadianAddress | null | undefined, fallbackLabel: string) {
  if (
    !address ||
    typeof address.latitude !== 'number' ||
    !Number.isFinite(address.latitude) ||
    typeof address.longitude !== 'number' ||
    !Number.isFinite(address.longitude)
  ) {
    return null
  }

  return {
    latitude: address.latitude,
    longitude: address.longitude,
    label: formatCanadianPhysicalAddressInline(address) || fallbackLabel,
  }
}

function LocationField({
  label,
  value,
  placeholder,
  active,
  onFocus,
  onBlur,
  onChange,
  onClear,
  icon,
  children,
}: {
  label: string
  value: string
  placeholder: string
  active: boolean
  onFocus: () => void
  onBlur: () => void
  onChange: (next: string) => void
  onClear: () => void
  icon: React.ComponentType<{ className?: string }>
  children?: React.ReactNode
}) {
  const Icon = icon

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-3 rounded-[1.35rem] border bg-slate-50 px-4 py-3 transition ${
          active ? 'border-slate-900 shadow-[0_16px_40px_rgba(15,23,42,0.08)]' : 'border-slate-200'
        }`}
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
          <Icon className="h-5 w-5" />
        </span>
        <label className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</span>
          <input
            value={value}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 w-full bg-transparent text-base text-slate-950 outline-none placeholder:text-slate-400"
            placeholder={placeholder}
          />
        </label>
        {value ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClear}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:border-slate-300 hover:text-slate-600"
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            <HiOutlineXMark className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {children}
    </div>
  )
}

export default function HomeRideRequestCard({
  onRideRequested,
  onMapPreviewChange,
}: {
  onRideRequested?: (item: DriveRideRequestItem) => void
  onMapPreviewChange?: (preview: HomeRideMapPreview) => void
}) {
  const pickupBlurTimeoutRef = useRef<number | null>(null)
  const destinationBlurTimeoutRef = useRef<number | null>(null)
  const pickupResolvedQueryRef = useRef('')
  const destinationResolvedQueryRef = useRef('')
  const router = useRouter()

  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [pickupAddress, setPickupAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [destinationAddress, setDestinationAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [pickupQuery, setPickupQuery] = useState('')
  const [destinationQuery, setDestinationQuery] = useState('')
  const [pickupFocused, setPickupFocused] = useState(false)
  const [destinationFocused, setDestinationFocused] = useState(false)
  const [pickupSearchLoading, setPickupSearchLoading] = useState(false)
  const [destinationSearchLoading, setDestinationSearchLoading] = useState(false)
  const [pickupSearchResults, setPickupSearchResults] = useState<CivilPlaceSearchResults>({ places: [], addresses: [] })
  const [destinationSearchResults, setDestinationSearchResults] = useState<CivilPlaceSearchResults>({ places: [], addresses: [] })
  const [pickupSearchError, setPickupSearchError] = useState<string | null>(null)
  const [destinationSearchError, setDestinationSearchError] = useState<string | null>(null)
  const [locatingPickup, setLocatingPickup] = useState(false)
  const [pickupTimingMode, setPickupTimingMode] = useState<RideTimingMode>('now')
  const [scheduledPickupAt, setScheduledPickupAt] = useState(() => toDateTimeLocalValue(getDefaultScheduledPickupDate()))
  const [timingModalOpen, setTimingModalOpen] = useState(false)
  const [timingDraftMode, setTimingDraftMode] = useState<RideTimingMode>('now')
  const [timingDraftScheduledAt, setTimingDraftScheduledAt] = useState(() => toDateTimeLocalValue(getDefaultScheduledPickupDate()))
  const [preview, setPreview] = useState<RidePreview | null>(null)
  const [currentLocationPoint, setCurrentLocationPoint] = useState<HomeRideMapPoint | null>(null)
  const [routeCoordinates, setRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const normalizedPickupAddress = useMemo(() => normalizeCanadianAddress(pickupAddress), [pickupAddress])
  const normalizedDestinationAddress = useMemo(() => normalizeCanadianAddress(destinationAddress), [destinationAddress])
  const sortedSavedAddresses = useMemo(() => sortSavedAddresses(savedAddresses), [savedAddresses])

  useEffect(() => {
    return () => {
      if (pickupBlurTimeoutRef.current) window.clearTimeout(pickupBlurTimeoutRef.current)
      if (destinationBlurTimeoutRef.current) window.clearTimeout(destinationBlurTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void getCurrentLocation({
      reason: 'home-ride-request-map-preview',
      userInitiated: false,
      highAccuracy: true,
      timeoutMs: 8000,
      maximumAgeMs: 5 * 60_000,
    }).then((locationResult) => {
      if (cancelled || !locationResult.ok || !locationResult.location) return
      setCurrentLocationPoint({
        latitude: locationResult.location.latitude,
        longitude: locationResult.location.longitude,
        label: 'Current location',
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSavedAddresses() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setSavedLoading(true)
      try {
        const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as ShippingAddressListResponse | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return
        const items = Array.isArray(payload?.items)
          ? sortSavedAddresses(payload.items.map((item) => normalizeSavedShippingAddress(item)).filter((item): item is SavedShippingAddress => Boolean(item)))
          : []
        setSavedAddresses(items)
      } catch (error) {
        console.error('Failed to load saved addresses for home ride request', error)
        if (!cancelled) setSavedAddresses([])
      } finally {
        if (!cancelled) setSavedLoading(false)
      }
    }

    void loadSavedAddresses()

    return () => {
      cancelled = true
    }
  }, [])

  const searchAnchor = useMemo(() => {
    if (hasCoordinates(normalizedPickupAddress)) {
      return {
        latitude: normalizedPickupAddress.latitude as number,
        longitude: normalizedPickupAddress.longitude as number,
      }
    }

    const savedAnchor = sortedSavedAddresses.find((address) => hasCoordinates(address))
    return savedAnchor
      ? {
          latitude: savedAnchor.latitude as number,
          longitude: savedAnchor.longitude as number,
        }
      : null
  }, [normalizedPickupAddress, sortedSavedAddresses])

  useEffect(() => {
    if (!pickupFocused || !isUsableAddressQuery(pickupQuery)) {
      setPickupSearchResults({ places: [], addresses: [] })
      setPickupSearchLoading(false)
      setPickupSearchError(null)
      return
    }

    const controller = new AbortController()
    setPickupSearchLoading(true)
    setPickupSearchError(null)

    void fetchPlaceSearchResults(pickupQuery.trim(), controller.signal, {
      limit: 4,
      latitude: searchAnchor?.latitude ?? null,
      longitude: searchAnchor?.longitude ?? null,
      radiusKm: 500,
    })
      .then((results) => {
        setPickupSearchResults(results)
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return
        setPickupSearchError('Unable to search pickup addresses right now.')
      })
      .finally(() => {
        setPickupSearchLoading(false)
      })

    return () => controller.abort()
  }, [pickupFocused, pickupQuery, searchAnchor])

  useEffect(() => {
    if (!destinationFocused || !isUsableAddressQuery(destinationQuery)) {
      setDestinationSearchResults({ places: [], addresses: [] })
      setDestinationSearchLoading(false)
      setDestinationSearchError(null)
      return
    }

    const controller = new AbortController()
    setDestinationSearchLoading(true)
    setDestinationSearchError(null)

    void fetchPlaceSearchResults(destinationQuery.trim(), controller.signal, {
      limit: 6,
      latitude: searchAnchor?.latitude ?? null,
      longitude: searchAnchor?.longitude ?? null,
      radiusKm: 500,
    })
      .then((results) => {
        setDestinationSearchResults(results)
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return
        setDestinationSearchError('Unable to search destination addresses right now.')
      })
      .finally(() => {
        setDestinationSearchLoading(false)
      })

    return () => controller.abort()
  }, [destinationFocused, destinationQuery, searchAnchor])

  const pickupMapPoint = useMemo(() => buildHomeRideMapPoint(normalizedPickupAddress, 'Pickup'), [normalizedPickupAddress])
  const destinationMapPoint = useMemo(() => buildHomeRideMapPoint(normalizedDestinationAddress, 'Destination'), [normalizedDestinationAddress])
  const routeOriginPoint = pickupMapPoint ?? currentLocationPoint

  useEffect(() => {
    if (!pickupMapPoint || !destinationMapPoint) {
      setPreview(null)
      return
    }

    const fallbackDistanceKm = calculateDistanceKm(
      {
        latitude: pickupMapPoint.latitude,
        longitude: pickupMapPoint.longitude,
      },
      {
        latitude: destinationMapPoint.latitude,
        longitude: destinationMapPoint.longitude,
      },
    )

    setPreview({
      distanceKm: fallbackDistanceKm,
      travelMinutes: null,
    })

    const controller = new AbortController()
    void fetchDrivingRoute(
      {
        latitude: pickupMapPoint.latitude,
        longitude: pickupMapPoint.longitude,
      },
      {
        latitude: destinationMapPoint.latitude,
        longitude: destinationMapPoint.longitude,
      },
      controller.signal,
    )
      .then((route) => {
        if (!route) return
        setPreview((current) => ({
          distanceKm: current?.distanceKm ?? fallbackDistanceKm,
          travelMinutes: Math.max(1, Math.round(route.durationSeconds / 60)),
        }))
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return
      })

    return () => controller.abort()
  }, [destinationMapPoint, pickupMapPoint])

  useEffect(() => {
    if (!routeOriginPoint || !destinationMapPoint) {
      setRouteCoordinates(null)
      return
    }

    const isSamePoint =
      Math.abs(routeOriginPoint.latitude - destinationMapPoint.latitude) < 0.000001 &&
      Math.abs(routeOriginPoint.longitude - destinationMapPoint.longitude) < 0.000001

    if (isSamePoint) {
      setRouteCoordinates(null)
      return
    }

    const controller = new AbortController()

    void fetchDrivingRoute(routeOriginPoint, destinationMapPoint, controller.signal)
      .then((route) => {
        if (!route) {
          setRouteCoordinates(null)
          return
        }
        setRouteCoordinates(route.geometry)
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return
        setRouteCoordinates(null)
      })

    return () => controller.abort()
  }, [destinationMapPoint, routeOriginPoint])

  useEffect(() => {
    onMapPreviewChange?.({
      currentLocation: currentLocationPoint,
      pickup: pickupMapPoint,
      destination: destinationMapPoint,
      routeCoordinates,
    })
  }, [currentLocationPoint, destinationMapPoint, onMapPreviewChange, pickupMapPoint, routeCoordinates])

  useEffect(() => {
    if (!timingModalOpen) return
    setTimingDraftMode(pickupTimingMode)
    setTimingDraftScheduledAt(scheduledPickupAt)
  }, [pickupTimingMode, scheduledPickupAt, timingModalOpen])

  const pickupSavedSuggestions = useMemo(() => {
    const trimmedQuery = pickupQuery.trim()
    if (!trimmedQuery) {
      return sortedSavedAddresses.slice(0, 4).map((address) => ({
        address,
        distanceKm:
          searchAnchor && hasCoordinates(address)
            ? calculateDistanceKm(searchAnchor, {
                latitude: address.latitude as number,
                longitude: address.longitude as number,
              })
            : null,
        isHome: isHomeSavedShippingAddress(address),
      }))
    }

    return searchSavedShippingAddresses(sortedSavedAddresses, trimmedQuery, {
      anchor: searchAnchor,
      limit: 4,
    }).map((entry) => ({
      address: entry.address,
      distanceKm: entry.distanceKm,
      isHome: entry.isHome,
    }))
  }, [pickupQuery, searchAnchor, sortedSavedAddresses])

  const estimate = useMemo(() => estimateRidePricing(preview?.distanceKm ?? 0), [preview?.distanceKm])
  const canRequestRide = hasMappedAddress(normalizedPickupAddress) && hasMappedAddress(normalizedDestinationAddress)
  const pickupTimingLabel = useMemo(() => formatPickupTimingLabel(pickupTimingMode, scheduledPickupAt), [pickupTimingMode, scheduledPickupAt])

  const applyPickupAddress = useCallback((address: CanadianAddress, query: string) => {
    const normalized = normalizeCanadianAddress(address)
    setPickupAddress(normalized)
    setPickupQuery(query)
    pickupResolvedQueryRef.current = query
    setPickupFocused(false)
  }, [])

  const applyDestinationAddress = useCallback((address: CanadianAddress, query: string) => {
    const normalized = normalizeCanadianAddress(address)
    setDestinationAddress(normalized)
    setDestinationQuery(query)
    destinationResolvedQueryRef.current = query
    setDestinationFocused(false)
  }, [])

  const handlePickupChange = useCallback((next: string) => {
    setPickupQuery(next)
    if (next.trim() !== pickupResolvedQueryRef.current.trim()) {
      setPickupAddress(createEmptyCanadianAddress())
    }
  }, [])

  const handleDestinationChange = useCallback((next: string) => {
    setDestinationQuery(next)
    if (next.trim() !== destinationResolvedQueryRef.current.trim()) {
      setDestinationAddress(createEmptyCanadianAddress())
    }
  }, [])

  const handleUseCurrentLocation = useCallback(async () => {
    setLocatingPickup(true)
    try {
      const locationResult = await requestLocationPermission({
        reason: 'home-ride-request-pickup',
        highAccuracy: true,
        timeoutMs: 10000,
        maximumAgeMs: 60000,
      })

      if (!locationResult.ok || !locationResult.location) {
        pushToast(locationResult.errorMessage ?? 'Location permission was denied or unavailable.', 'error')
        return
      }

      const resolved = await fetchReverseGeocodeResult(locationResult.location.latitude, locationResult.location.longitude)
      if (!resolved) {
        pushToast('Unable to resolve your current location as an address.', 'error')
        return
      }

      const reverseGeocodedAddress = buildCanadianAddressFromSearchResult(resolved)
      const nextAddress = {
        ...reverseGeocodedAddress,
        latitude:
          typeof reverseGeocodedAddress.latitude === 'number' && Number.isFinite(reverseGeocodedAddress.latitude)
            ? reverseGeocodedAddress.latitude
            : locationResult.location.latitude,
        longitude:
          typeof reverseGeocodedAddress.longitude === 'number' && Number.isFinite(reverseGeocodedAddress.longitude)
            ? reverseGeocodedAddress.longitude
            : locationResult.location.longitude,
      }
      setCurrentLocationPoint({
        latitude: nextAddress.latitude,
        longitude: nextAddress.longitude,
        label: formatAddressInputValue(nextAddress, 'Current location'),
      })
      applyPickupAddress(nextAddress, formatAddressInputValue(nextAddress, 'My location'))
    } catch (error) {
      console.error('Failed to resolve current location from home ride request', error)
      pushToast('Location permission was denied or unavailable.', 'error')
    } finally {
      setLocatingPickup(false)
    }
  }, [applyPickupAddress])

  const handleApplyTiming = useCallback(() => {
    if (timingDraftMode === 'now') {
      setPickupTimingMode('now')
      setTimingModalOpen(false)
      return
    }

    const scheduledDate = parseDateTimeLocalValue(timingDraftScheduledAt)
    if (!scheduledDate) {
      pushToast('Choose a valid scheduled pickup time.', 'error')
      return
    }

    const roundedDate = roundDateToStepMinutes(scheduledDate)
    if (roundedDate.getTime() <= Date.now()) {
      pushToast('Choose a pickup time in the future.', 'error')
      return
    }

    setPickupTimingMode('scheduled')
    setScheduledPickupAt(toDateTimeLocalValue(roundedDate))
    setTimingModalOpen(false)
  }, [timingDraftMode, timingDraftScheduledAt])

  const handleSubmit = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (!hasMappedAddress(normalizedPickupAddress) || !hasMappedAddress(normalizedDestinationAddress)) {
      pushToast('Choose a mapped pickup and destination before continuing.', 'error')
      return
    }

    const pickupDate =
      pickupTimingMode === 'now'
        ? getImmediatePickupDate()
        : parseDateTimeLocalValue(scheduledPickupAt)

    if (!pickupDate || !Number.isFinite(pickupDate.getTime())) {
      pushToast('Choose a valid pickup time.', 'error')
      return
    }

    if (pickupTimingMode === 'scheduled' && pickupDate.getTime() <= Date.now()) {
      pushToast('Choose a pickup time in the future.', 'error')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/drive/rides'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickupAddress: normalizedPickupAddress,
          dropoffAddress: normalizedDestinationAddress,
          recurrence: 'once',
          pickupAt: pickupDate.toISOString(),
          dropoffAt: estimateDropoffAt(pickupDate, preview).toISOString(),
        }),
      })
      const payload = (await response.json().catch(() => null)) as RideMutationResponse | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok || !payload?.item) {
        pushToast(payload?.error ?? 'Unable to post that ride request right now.', 'error')
        return
      }

      pushToast('Ride request posted to MapleRides.', 'success')
      onRideRequested?.(payload.item)
      setDestinationAddress(createEmptyCanadianAddress())
      setDestinationQuery('')
      destinationResolvedQueryRef.current = ''
      setPickupTimingMode('now')
      setScheduledPickupAt(toDateTimeLocalValue(getDefaultScheduledPickupDate()))
      setPreview(null)
      router.push(`/drive/ride/request/${encodeURIComponent(payload.item.id)}`)
    } catch (error) {
      console.error('Failed to post home ride request', error)
      pushToast('Unable to post that ride request right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [normalizedDestinationAddress, normalizedPickupAddress, onRideRequested, pickupTimingMode, preview, router, scheduledPickupAt])

  return (
    <>
      <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2.5rem]">Request a ride</h2>
          </div>
          <button
            type="button"
            onClick={() => setTimingModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-300 hover:bg-white"
          >
            <HiOutlineClock className="h-4 w-4" />
            {pickupTimingLabel}
            <HiChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-500">
          Pickup now or schedule later. Use saved places, your current location, and MapleRides address lookup to book faster.
        </p>

        <div className="mt-6 space-y-3">
          <LocationField
            label="Pickup"
            value={pickupQuery}
            placeholder="Enter pickup"
            active={pickupFocused}
            onFocus={() => {
              if (pickupBlurTimeoutRef.current) window.clearTimeout(pickupBlurTimeoutRef.current)
              setPickupFocused(true)
            }}
            onBlur={() => {
              pickupBlurTimeoutRef.current = window.setTimeout(() => setPickupFocused(false), 150)
            }}
            onChange={handlePickupChange}
            onClear={() => {
              setPickupAddress(createEmptyCanadianAddress())
              setPickupQuery('')
              pickupResolvedQueryRef.current = ''
            }}
            icon={HiOutlineMapPin}
          >
            {pickupFocused ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-20 max-h-[min(65vh,28rem)] overflow-y-auto rounded-[1.35rem] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleUseCurrentLocation()}
                  className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white">
                    <HiOutlineMap className={`h-5 w-5 ${locatingPickup ? 'animate-spin' : ''}`} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-950">{locatingPickup ? 'Finding My Location…' : 'My Location'}</span>
                    <span className="block text-xs text-slate-500">Use your current GPS location for pickup.</span>
                  </span>
                </button>

                <div className="mt-1 border-t border-slate-100 pt-3">
                  <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Saved places</p>
                  <div className="space-y-1">
                    {pickupSavedSuggestions.map(({ address, distanceKm, isHome }) => (
                      <button
                        key={address.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          applyPickupAddress(
                            normalizeCanadianAddress(address),
                            formatAddressInputValue(address, formatSavedShippingAddressTitle(address)),
                          )
                        }
                        className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-3 text-left transition hover:bg-slate-50"
                      >
                        <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isHome ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                          {isHome ? <HiOutlineStar className="h-5 w-5" /> : <HiOutlineMapPin className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-950">
                            <span className="truncate">{formatSavedShippingAddressTitle(address)}</span>
                            {isHome ? (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-600">
                                Home
                              </span>
                            ) : null}
                            {distanceKm !== null ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {distanceKm < 10 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`}
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-xs text-slate-500">{formatSavedShippingAddressDetail(address, { includeName: false })}</span>
                        </span>
                      </button>
                    ))}

                    {!savedLoading && !pickupSavedSuggestions.length ? (
                      <div className="px-3 py-3 text-sm text-slate-500">
                        No saved places yet.{' '}
                        <Link href="/settings/addresses" className="font-semibold text-red-500 hover:underline">
                          Add one in Account
                        </Link>
                        .
                      </div>
                    ) : null}
                    {savedLoading ? <p className="px-3 py-2 text-sm text-slate-500">Loading saved places…</p> : null}
                  </div>
                </div>

                {isUsableAddressQuery(pickupQuery) ? (
                  <div className="mt-1 border-t border-slate-100 pt-3">
                    {pickupSearchLoading ? <p className="px-3 py-2 text-sm text-slate-500">Searching pickup addresses…</p> : null}
                    {!pickupSearchLoading && pickupSearchError ? <p className="px-3 py-2 text-sm text-rose-700">{pickupSearchError}</p> : null}

                    {!pickupSearchLoading && !pickupSearchError && pickupSearchResults.places.length ? (
                      <section>
                        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Places</p>
                        <div className="space-y-1">
                          {pickupSearchResults.places.map((result) => (
                            <button
                              key={`${result.placeId ?? 'pickup-place'}-${result.latitude}-${result.longitude}`}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() =>
                                applyPickupAddress(
                                  buildCanadianAddressFromSearchResult(result),
                                  formatAddressInputValue(buildCanadianAddressFromSearchResult(result), formatPlaceSearchPrimaryLabel(result)),
                                )
                              }
                              className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-3 text-left transition hover:bg-slate-50"
                            >
                              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                                <HiOutlineBuildingOffice2 className="h-5 w-5" />
                              </span>
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-950">
                                  <span className="truncate">{formatPlaceSearchPrimaryLabel(result)}</span>
                                  {formatPlaceSearchCategoryLabel(result) ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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

                    {!pickupSearchLoading && !pickupSearchError && pickupSearchResults.addresses.length ? (
                      <section className="mt-3">
                        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Addresses</p>
                        <div className="space-y-1">
                          {pickupSearchResults.addresses.map((result) => (
                            <button
                              key={`${result.placeId ?? 'pickup-address'}-${result.latitude}-${result.longitude}`}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() =>
                                applyPickupAddress(
                                  buildCanadianAddressFromSearchResult(result),
                                  formatAddressInputValue(buildCanadianAddressFromSearchResult(result), formatPlaceSearchPrimaryLabel(result)),
                                )
                              }
                              className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-3 text-left transition hover:bg-slate-50"
                            >
                              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                                <HiOutlineMapPin className="h-5 w-5" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-slate-950">{formatPlaceSearchPrimaryLabel(result)}</span>
                                <span className="block text-xs text-slate-500">{formatPlaceSearchSecondaryLabel(result)}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {!pickupSearchLoading &&
                    !pickupSearchError &&
                    !pickupSearchResults.places.length &&
                    !pickupSearchResults.addresses.length ? (
                      <p className="px-3 py-2 text-sm text-slate-500">No mapped pickup results found yet.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </LocationField>

          <LocationField
            label="Destination"
            value={destinationQuery}
            placeholder="Enter destination"
            active={destinationFocused}
            onFocus={() => {
              if (destinationBlurTimeoutRef.current) window.clearTimeout(destinationBlurTimeoutRef.current)
              setDestinationFocused(true)
            }}
            onBlur={() => {
              destinationBlurTimeoutRef.current = window.setTimeout(() => setDestinationFocused(false), 150)
            }}
            onChange={handleDestinationChange}
            onClear={() => {
              setDestinationAddress(createEmptyCanadianAddress())
              setDestinationQuery('')
              destinationResolvedQueryRef.current = ''
            }}
            icon={HiOutlineSparkles}
          >
            {destinationFocused ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-20 max-h-[min(65vh,28rem)] overflow-y-auto rounded-[1.35rem] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
                {!isUsableAddressQuery(destinationQuery) ? (
                  <p className="px-3 py-3 text-sm text-slate-500">Search by address, intersection, landmark, or business.</p>
                ) : null}
                {destinationSearchLoading ? <p className="px-3 py-2 text-sm text-slate-500">Searching destination addresses…</p> : null}
                {!destinationSearchLoading && destinationSearchError ? <p className="px-3 py-2 text-sm text-rose-700">{destinationSearchError}</p> : null}

                {!destinationSearchLoading && !destinationSearchError && destinationSearchResults.places.length ? (
                  <section>
                    <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Places</p>
                    <div className="space-y-1">
                      {destinationSearchResults.places.map((result) => (
                        <button
                          key={`${result.placeId ?? 'destination-place'}-${result.latitude}-${result.longitude}`}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            applyDestinationAddress(
                              buildCanadianAddressFromSearchResult(result),
                              formatAddressInputValue(buildCanadianAddressFromSearchResult(result), formatPlaceSearchPrimaryLabel(result)),
                            )
                          }
                          className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-3 text-left transition hover:bg-slate-50"
                        >
                          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                            <HiOutlineBuildingOffice2 className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-950">
                              <span className="truncate">{formatPlaceSearchPrimaryLabel(result)}</span>
                              {formatPlaceSearchCategoryLabel(result) ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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

                {!destinationSearchLoading && !destinationSearchError && destinationSearchResults.addresses.length ? (
                  <section className="mt-3">
                    <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Addresses</p>
                    <div className="space-y-1">
                      {destinationSearchResults.addresses.map((result) => (
                        <button
                          key={`${result.placeId ?? 'destination-address'}-${result.latitude}-${result.longitude}`}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            applyDestinationAddress(
                              buildCanadianAddressFromSearchResult(result),
                              formatAddressInputValue(buildCanadianAddressFromSearchResult(result), formatPlaceSearchPrimaryLabel(result)),
                            )
                          }
                          className="flex w-full items-start gap-3 rounded-[1rem] px-3 py-3 text-left transition hover:bg-slate-50"
                        >
                          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                            <HiOutlineMapPin className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-slate-950">{formatPlaceSearchPrimaryLabel(result)}</span>
                            <span className="block text-xs text-slate-500">{formatPlaceSearchSecondaryLabel(result)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {!destinationSearchLoading &&
                !destinationSearchError &&
                isUsableAddressQuery(destinationQuery) &&
                !destinationSearchResults.places.length &&
                !destinationSearchResults.addresses.length ? (
                  <p className="px-3 py-2 text-sm text-slate-500">No mapped destination results found yet.</p>
                ) : null}
              </div>
            ) : null}
          </LocationField>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] bg-red-600 px-5 py-4 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(220,38,38,0.28)] transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Requesting…' : canRequestRide ? 'Request ride' : 'See prices'}
            <HiOutlineArrowRight className="h-4 w-4" />
          </button>

          {canRequestRide ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Ride total</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{formatDriveMoney(estimate.totalCostCents)}</p>
              </div>
              <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Travel time</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{formatRideTravelTime(preview?.travelMinutes ?? null)}</p>
              </div>
              <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Distance</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{estimate.routeDistanceKm.toFixed(1)} km</p>
              </div>
            </div>
          ) : (
            <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Choose a mapped pickup and destination to see the trip estimate.
            </div>
          )}
        </div>
      </article>

      <Modal
        open={timingModalOpen}
        onClose={() => setTimingModalOpen(false)}
        title="Choose pickup time"
        maxWidthClassName="max-w-lg"
        closeOnBackdrop
        closeOnEscape
      >
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setTimingDraftMode('now')}
            className={`flex w-full items-start justify-between gap-4 rounded-[1.35rem] border px-4 py-4 text-left transition ${
              timingDraftMode === 'now' ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
            }`}
          >
            <span>
              <span className="block text-base font-semibold">Pickup now</span>
              <span className={`mt-1 block text-sm ${timingDraftMode === 'now' ? 'text-white/75' : 'text-slate-500'}`}>
                We will treat this as the next available pickup window.
              </span>
            </span>
            <HiOutlineClock className={`h-5 w-5 shrink-0 ${timingDraftMode === 'now' ? 'text-white' : 'text-slate-400'}`} />
          </button>

          <button
            type="button"
            onClick={() => setTimingDraftMode('scheduled')}
            className={`flex w-full items-start justify-between gap-4 rounded-[1.35rem] border px-4 py-4 text-left transition ${
              timingDraftMode === 'scheduled' ? 'border-red-500 bg-red-50 text-slate-950' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
            }`}
          >
            <span>
              <span className="block text-base font-semibold">Schedule later</span>
              <span className="mt-1 block text-sm text-slate-500">Choose a future pickup date and time.</span>
            </span>
            <HiOutlineCalendarDays className={`h-5 w-5 shrink-0 ${timingDraftMode === 'scheduled' ? 'text-red-500' : 'text-slate-400'}`} />
          </button>

          {timingDraftMode === 'scheduled' ? (
            <label className="grid gap-2 rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Scheduled pickup</span>
              <input
                type="datetime-local"
                min={toDateTimeLocalValue(getImmediatePickupDate())}
                step={RIDE_TIME_STEP_MINUTES * 60}
                value={timingDraftScheduledAt}
                onChange={(event) => setTimingDraftScheduledAt(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-red-400"
              />
            </label>
          ) : null}

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setTimingModalOpen(false)}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyTiming}
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
            >
              Apply pickup time
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
