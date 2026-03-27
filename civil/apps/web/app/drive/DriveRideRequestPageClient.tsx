'use client'

import { calculateCivilFeeCents } from '@civil/shared'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FaCarSide } from 'react-icons/fa'
import {
  HiChevronDown,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineInformationCircle,
  HiOutlineMapPin,
  HiOutlineMap,
} from 'react-icons/hi2'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { CanadianAddressEditor } from '../_components/address/CanadianAddressEditor'
import { AddressDirectionsMap } from '../_components/map/AddressDirectionsMap'
import { pushToast } from '../_components/useToasts'
import {
  buildCanadianAddressFromSearchResult,
  calculateDistanceKm,
  fetchDrivingRoute,
  fetchReverseGeocodeResult,
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
import { requestLocationPermission } from '../_lib/locationService'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveRouteNav from './DriveRouteNav'
import { canEditDriveRideStatus, formatDriveMoney, type DriveRideRequestItem } from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
  item?: SavedShippingAddress | null
  error?: string
}

type RideMutationResponse = {
  item?: DriveRideRequestItem | null
  error?: string
}

type DriveRideRequestPageClientProps = {
  mode?: 'create' | 'edit'
  rideId?: string
}

type RideTiming = 'now' | 'later_today'
type PickupSource = 'saved' | 'current' | 'search'

type RidePreview = {
  distanceKm: number
  travelMinutes: number | null
  routeCoordinates: Array<[number, number]> | null
}

const RIDE_DRIVER_FLAT_FEE_CENTS = 1000
const RIDE_FUEL_RATE_CENTS_PER_KM = 65
const RIDE_MIN_FUEL_CHARGE_CENTS = 500
const RIDE_TIME_STEP_MINUTES = 5
const RIDE_NOW_BUFFER_MINUTES = 5
const RIDE_LATER_TODAY_BUFFER_MINUTES = 60

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

function roundDateToStepMinutes(value: Date, stepMinutes = RIDE_TIME_STEP_MINUTES) {
  const next = new Date(value)
  next.setSeconds(0, 0)
  const remainder = next.getMinutes() % stepMinutes
  if (remainder !== 0) {
    next.setMinutes(next.getMinutes() + (stepMinutes - remainder))
  }
  return next
}

function toTimeInputValue(value: Date) {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function getImmediatePickupDate() {
  return roundDateToStepMinutes(new Date(Date.now() + RIDE_NOW_BUFFER_MINUTES * 60_000))
}

function getDefaultLaterTodayPickupDate() {
  const candidate = roundDateToStepMinutes(new Date(Date.now() + RIDE_LATER_TODAY_BUFFER_MINUTES * 60_000))
  const endOfDay = new Date()
  endOfDay.setHours(23, 55, 0, 0)
  return candidate.getTime() > endOfDay.getTime() ? endOfDay : candidate
}

function buildLaterTodayPickupDate(timeValue: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  const next = new Date()
  next.setHours(hours, minutes, 0, 0)
  return next
}

function formatSavedAddressTitle(address: SavedShippingAddress, fallback: string) {
  return address.label?.trim() || address.name?.trim() || address.line1?.trim() || fallback
}

function formatSavedAddressDetail(address: CanadianAddress | SavedShippingAddress | null | undefined) {
  return formatCanadianPhysicalAddressInline(address) || address?.nominatimDisplayName?.trim() || 'Address pending'
}

function matchesSavedAddress(current: CanadianAddress, candidate: SavedShippingAddress) {
  const normalizedCurrent = normalizeCanadianAddress(current)
  const normalizedCandidate = normalizeCanadianAddress(candidate)
  return (
    normalizedCurrent.line1 === normalizedCandidate.line1 &&
    normalizedCurrent.line2 === normalizedCandidate.line2 &&
    normalizedCurrent.city === normalizedCandidate.city &&
    normalizedCurrent.province === normalizedCandidate.province &&
    normalizedCurrent.postalCode === normalizedCandidate.postalCode
  )
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
  if (minutes === null || !Number.isFinite(minutes)) return 'Waiting'

  const roundedMinutes = Math.max(1, Math.round(minutes))
  if (roundedMinutes < 60) {
    return `${roundedMinutes} min`
  }

  const hours = Math.floor(roundedMinutes / 60)
  const remainingMinutes = roundedMinutes % 60
  if (remainingMinutes === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${remainingMinutes} min`
}

function estimateDropoffAt(pickupDate: Date, preview: RidePreview | null) {
  const travelMinutes = preview?.travelMinutes ?? (preview?.distanceKm ? Math.max(20, Math.round((preview.distanceKm / 40) * 60)) : 30)
  const bufferedMinutes = Math.max(30, travelMinutes + 15)
  return new Date(pickupDate.getTime() + bufferedMinutes * 60_000)
}

function sortSavedAddresses(items: SavedShippingAddress[]) {
  return [...items].sort(
    (left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? left.line1 ?? '').localeCompare(String(right.label ?? right.line1 ?? '')),
  )
}

function SavedAddressesDropdown({
  items,
  selectedId,
  selectedTitle,
  selectedDetail,
  open,
  disabled,
  onToggle,
  onSelect,
}: {
  items: SavedShippingAddress[]
  selectedId: string | null
  selectedTitle: string
  selectedDetail: string
  open: boolean
  disabled?: boolean
  onToggle: () => void
  onSelect: (address: SavedShippingAddress) => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-3 rounded-[1.35rem] border border-[var(--cc-primary)]/40 bg-white px-4 py-3 text-left transition hover:border-[var(--cc-primary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{selectedTitle}</p>
          <p className="truncate text-xs text-slate-500">{selectedDetail}</p>
        </div>
        <HiChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="max-h-80 overflow-y-auto p-2">
            {items.map((address, index) => {
              const active = selectedId === address.id
              return (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => onSelect(address)}
                  className={`flex w-full items-start justify-between gap-3 rounded-[1rem] px-3 py-3 text-left transition ${active ? 'bg-[var(--cc-primary)]/8' : 'hover:bg-slate-50'}`}
                >
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${active ? 'text-[var(--cc-primary)]' : 'text-slate-900'}`}>
                      {formatSavedAddressTitle(address, index === 0 ? 'Saved address' : `Saved address ${index + 1}`)}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">{formatSavedAddressDetail(address)}</p>
                  </div>
                  {address.isDefault ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Default
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function DriveRideRequestPageClient({ mode = 'create', rideId }: DriveRideRequestPageClientProps) {
  const isEditMode = mode === 'edit' && Boolean(rideId)
  const { isDriverActive, isDriverMode, loading: viewerLoading, rideRequestCount, deliveryRequestCount, enterDriverMode, exitDriverMode } = useDriveViewerState()
  const router = useRouter()
  const pickupDropdownRef = useRef<HTMLDivElement | null>(null)
  const initializedPickupRef = useRef(false)
  const initializedEditRideRef = useRef(false)

  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [pickupAddress, setPickupAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [destinationAddress, setDestinationAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [pickupSource, setPickupSource] = useState<PickupSource>('search')
  const [selectedPickupAddressId, setSelectedPickupAddressId] = useState<string | null>(null)
  const [pickupMenuOpen, setPickupMenuOpen] = useState(false)
  const [locatingPickup, setLocatingPickup] = useState(false)
  const [timing, setTiming] = useState<RideTiming>('now')
  const [pickupTime, setPickupTime] = useState(() => toTimeInputValue(getDefaultLaterTodayPickupDate()))
  const [preview, setPreview] = useState<RidePreview | null>(null)
  const [savedLoading, setSavedLoading] = useState(true)
  const [savingDestinationAddress, setSavingDestinationAddress] = useState(false)
  const [existingRide, setExistingRide] = useState<DriveRideRequestItem | null>(null)
  const [rideLoading, setRideLoading] = useState(isEditMode)
  const [rideLoadError, setRideLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const normalizedPickupAddress = useMemo(() => normalizeCanadianAddress(pickupAddress), [pickupAddress])
  const normalizedDestinationAddress = useMemo(() => normalizeCanadianAddress(destinationAddress), [destinationAddress])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!pickupDropdownRef.current?.contains(event.target as Node)) {
        setPickupMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
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

        if (!initializedPickupRef.current && !isEditMode) {
          initializedPickupRef.current = true
          const defaultPickup = items.find((item) => item.isDefault) ?? items[0] ?? null
          if (defaultPickup) {
            setPickupAddress(normalizeCanadianAddress(defaultPickup))
            setPickupSource('saved')
            setSelectedPickupAddressId(defaultPickup.id)
          }
        }
      } catch (loadError) {
        console.error('Failed to load saved addresses for ride request', loadError)
        if (!cancelled) setSavedAddresses([])
      } finally {
        if (!cancelled) setSavedLoading(false)
      }
    }

    void loadSavedAddresses()
    return () => {
      cancelled = true
    }
  }, [isEditMode])

  useEffect(() => {
    if (!isEditMode || !rideId) {
      setExistingRide(null)
      setRideLoadError(null)
      setRideLoading(false)
      initializedEditRideRef.current = false
      return
    }

    let cancelled = false

    async function loadRide() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setRideLoading(true)
      setRideLoadError(null)
      initializedEditRideRef.current = false

      try {
        const response = await fetch(buildApiUrl(`/drive/rides/${rideId}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as RideMutationResponse | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok || !payload?.item) {
          setRideLoadError(payload?.error === 'ride_not_found' ? 'That ride request could not be found.' : 'Unable to load that ride request right now.')
          setExistingRide(null)
          return
        }

        const nextRide = payload.item
        const nextPickupAddress = normalizeCanadianAddress(nextRide.pickupAddress ?? createEmptyCanadianAddress())
        const nextDestinationAddress = normalizeCanadianAddress(nextRide.dropoffAddress ?? createEmptyCanadianAddress())
        const scheduledPickupAt = new Date(nextRide.pickupAt)
        const isSameLocalDay = Number.isFinite(scheduledPickupAt.getTime()) && scheduledPickupAt.toDateString() === new Date().toDateString()
        const shouldUseLaterToday =
          Number.isFinite(scheduledPickupAt.getTime()) &&
          scheduledPickupAt.getTime() > Date.now() + RIDE_NOW_BUFFER_MINUTES * 60_000 &&
          isSameLocalDay

        setExistingRide(nextRide)
        setPickupAddress(nextPickupAddress)
        setDestinationAddress(nextDestinationAddress)
        setPickupSource('search')
        setSelectedPickupAddressId(null)
        setPickupMenuOpen(false)
        setTiming(shouldUseLaterToday ? 'later_today' : 'now')
        setPickupTime(shouldUseLaterToday ? toTimeInputValue(roundDateToStepMinutes(scheduledPickupAt)) : toTimeInputValue(getDefaultLaterTodayPickupDate()))
      } catch (loadError) {
        console.error('Failed to load ride request for editing', loadError)
        if (cancelled) return
        setRideLoadError('Unable to load that ride request right now.')
        setExistingRide(null)
      } finally {
        if (!cancelled) setRideLoading(false)
      }
    }

    void loadRide()
    return () => {
      cancelled = true
    }
  }, [isEditMode, rideId])

  useEffect(() => {
    if (!isEditMode || !existingRide || savedLoading || initializedEditRideRef.current) return

    initializedEditRideRef.current = true
    const ridePickupAddress = normalizeCanadianAddress(existingRide.pickupAddress ?? createEmptyCanadianAddress())
    const matchedSavedPickupAddress = savedAddresses.find((address) => matchesSavedAddress(ridePickupAddress, address))

    if (matchedSavedPickupAddress) {
      setPickupSource('saved')
      setSelectedPickupAddressId(matchedSavedPickupAddress.id)
      setPickupAddress(normalizeCanadianAddress(matchedSavedPickupAddress))
      return
    }

    setPickupSource('search')
    setSelectedPickupAddressId(null)
    setPickupAddress(ridePickupAddress)
  }, [existingRide, isEditMode, savedAddresses, savedLoading])

  useEffect(() => {
    if (!hasMappedAddress(normalizedPickupAddress) || !hasMappedAddress(normalizedDestinationAddress)) {
      setPreview(null)
      return
    }

    const fallbackDistanceKm = calculateDistanceKm(
      {
        latitude: normalizedPickupAddress.latitude as number,
        longitude: normalizedPickupAddress.longitude as number,
      },
      {
        latitude: normalizedDestinationAddress.latitude as number,
        longitude: normalizedDestinationAddress.longitude as number,
      },
    )

    setPreview({
      distanceKm: fallbackDistanceKm,
      travelMinutes: null,
      routeCoordinates: null,
    })

    const controller = new AbortController()
    void fetchDrivingRoute(
      {
        latitude: normalizedPickupAddress.latitude as number,
        longitude: normalizedPickupAddress.longitude as number,
      },
      {
        latitude: normalizedDestinationAddress.latitude as number,
        longitude: normalizedDestinationAddress.longitude as number,
      },
      controller.signal,
    )
      .then((route) => {
        if (!route) return
        setPreview((current) => ({
          distanceKm: current?.distanceKm ?? fallbackDistanceKm,
          travelMinutes: Math.max(1, Math.round(route.durationSeconds / 60)),
          routeCoordinates: route.geometry,
        }))
      })
      .catch((routeError) => {
        if ((routeError as Error).name === 'AbortError') return
      })

    return () => controller.abort()
  }, [normalizedDestinationAddress, normalizedPickupAddress])

  const estimate = useMemo(() => estimateRidePricing(preview?.distanceKm ?? 0), [preview?.distanceKm])
  const selectedPickupAddress = useMemo(
    () => savedAddresses.find((address) => address.id === selectedPickupAddressId) ?? null,
    [savedAddresses, selectedPickupAddressId],
  )

  const pickupSelectionTitle = useMemo(() => {
    if (pickupSource === 'saved' && selectedPickupAddress) {
      return formatSavedAddressTitle(selectedPickupAddress, 'Saved address')
    }
    if (pickupSource === 'current') return 'Current location'
    if (hasMappedAddress(normalizedPickupAddress)) {
      return normalizedPickupAddress.line1?.trim() || normalizedPickupAddress.nominatimDisplayName?.split(',')[0]?.trim() || 'Pickup address'
    }
    return savedAddresses.length ? 'Select a saved address' : 'No saved addresses yet'
  }, [normalizedPickupAddress, pickupSource, savedAddresses.length, selectedPickupAddress])

  const pickupSelectionDetail = useMemo(() => {
    if (pickupSource === 'saved' && selectedPickupAddress) {
      return formatSavedAddressDetail(selectedPickupAddress)
    }
    if (pickupSource === 'current') {
      return locatingPickup ? 'Finding your location…' : formatSavedAddressDetail(normalizedPickupAddress)
    }
    if (hasMappedAddress(normalizedPickupAddress)) return formatSavedAddressDetail(normalizedPickupAddress)
    return savedAddresses.length ? 'Choose a saved address or search for pickup' : 'Save one in Settings > Addresses or search for pickup'
  }, [locatingPickup, normalizedPickupAddress, pickupSource, savedAddresses.length, selectedPickupAddress])

  const destinationAlreadySaved = useMemo(
    () => savedAddresses.some((address) => matchesSavedAddress(normalizedDestinationAddress, address)),
    [normalizedDestinationAddress, savedAddresses],
  )
  const pickupSearchAnchor = useMemo(() => {
    if (
      typeof normalizedPickupAddress.latitude === 'number' &&
      Number.isFinite(normalizedPickupAddress.latitude) &&
      typeof normalizedPickupAddress.longitude === 'number' &&
      Number.isFinite(normalizedPickupAddress.longitude)
    ) {
      return {
        latitude: normalizedPickupAddress.latitude,
        longitude: normalizedPickupAddress.longitude,
      }
    }

    const fallbackSavedAddress = savedAddresses.find(
      (address) =>
        typeof address.latitude === 'number' &&
        Number.isFinite(address.latitude) &&
        typeof address.longitude === 'number' &&
        Number.isFinite(address.longitude),
    )

    return fallbackSavedAddress
      ? {
          latitude: fallbackSavedAddress.latitude as number,
          longitude: fallbackSavedAddress.longitude as number,
        }
      : null
  }, [normalizedPickupAddress, savedAddresses])
  const destinationSearchAnchor = pickupSearchAnchor

  const canSaveDestinationAddress = hasMappedAddress(normalizedDestinationAddress) && !destinationAlreadySaved && !savingDestinationAddress
  const rideCanBeEdited = !isEditMode || (existingRide ? canEditDriveRideStatus(existingRide.status) : false)
  const submitDisabled = submitting || (isEditMode && (rideLoading || !existingRide || !rideCanBeEdited))
  const pageTitle = isEditMode ? 'Edit Ride Request' : 'Request Ride'
  const submitLabel = submitting ? (isEditMode ? 'Saving…' : 'Requesting…') : isEditMode ? 'Save Changes' : 'Request Ride!'

  const applySavedPickupAddress = useCallback((address: SavedShippingAddress) => {
    setPickupSource('saved')
    setSelectedPickupAddressId(address.id)
    setPickupAddress(normalizeCanadianAddress(address))
    setPickupMenuOpen(false)
  }, [])

  const handlePickupAddressChange = useCallback(
    (nextAddress: CanadianAddress) => {
      const normalized = normalizeCanadianAddress(nextAddress)
      const matchingSavedAddress = savedAddresses.find((address) => matchesSavedAddress(normalized, address)) ?? null

      setPickupAddress(normalized)
      setPickupMenuOpen(false)

      if (matchingSavedAddress) {
        setPickupSource('saved')
        setSelectedPickupAddressId(matchingSavedAddress.id)
        return
      }

      setPickupSource('search')
      setSelectedPickupAddressId(null)
    },
    [savedAddresses],
  )

  const handleUseCurrentLocation = useCallback(async () => {
    setLocatingPickup(true)
    try {
      const locationResult = await requestLocationPermission({
        reason: 'drive-ride-request-pickup',
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

      setPickupAddress(buildCanadianAddressFromSearchResult(resolved))
      setPickupSource('current')
      setSelectedPickupAddressId(null)
      setPickupMenuOpen(false)
    } catch (locationError) {
      console.error('Failed to resolve current location for ride pickup', locationError)
      pushToast('Location permission was denied or unavailable.', 'error')
    } finally {
      setLocatingPickup(false)
    }
  }, [])

  const handleSaveDestinationAddress = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!hasMappedAddress(normalizedDestinationAddress) || destinationAlreadySaved) return

    setSavingDestinationAddress(true)
    try {
      const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: normalizedDestinationAddress.label || null,
          name: normalizedDestinationAddress.name || null,
          line1: normalizedDestinationAddress.line1,
          line2: normalizedDestinationAddress.line2 || null,
          city: normalizedDestinationAddress.city,
          province: normalizedDestinationAddress.province,
          postalCode: normalizedDestinationAddress.postalCode,
          originalPostalCode: normalizedDestinationAddress.originalPostalCode || null,
          country: normalizedDestinationAddress.country || 'CA',
          latitude: normalizedDestinationAddress.latitude,
          longitude: normalizedDestinationAddress.longitude,
          nominatimDisplayName: normalizedDestinationAddress.nominatimDisplayName || null,
          nominatimRaw: normalizedDestinationAddress.nominatimRaw ?? null,
          isDefault: false,
        }),
      })

      const payload = (await response.json().catch(() => null)) as ShippingAddressListResponse | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to save this address right now.', 'error')
        return
      }

      const items = Array.isArray(payload?.items)
        ? sortSavedAddresses(payload.items.map((item) => normalizeSavedShippingAddress(item)).filter((item): item is SavedShippingAddress => Boolean(item)))
        : savedAddresses
      setSavedAddresses(items)
      pushToast('Address saved to Settings > Addresses.', 'success')
    } catch (saveError) {
      console.error('Failed to save destination address from ride request', saveError)
      pushToast('Unable to save this address right now.', 'error')
    } finally {
      setSavingDestinationAddress(false)
    }
  }, [destinationAlreadySaved, normalizedDestinationAddress, savedAddresses])

  const handleSubmit = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (!hasMappedAddress(normalizedPickupAddress) || !hasMappedAddress(normalizedDestinationAddress)) {
      pushToast('Choose mapped pickup and destination addresses before posting.', 'error')
      return
    }

    const pickupDate = timing === 'later_today' ? buildLaterTodayPickupDate(pickupTime) : getImmediatePickupDate()
    if (!pickupDate || !Number.isFinite(pickupDate.getTime())) {
      pushToast('Choose a valid pickup time.', 'error')
      return
    }
    if (timing === 'later_today' && pickupDate.getTime() <= Date.now()) {
      pushToast('Choose a pickup time later today.', 'error')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl(isEditMode && rideId ? `/drive/rides/${rideId}` : '/drive/rides'), {
        method: isEditMode ? 'PUT' : 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickupAddress: normalizedPickupAddress,
          dropoffAddress: normalizedDestinationAddress,
          recurrence: existingRide?.recurrence ?? 'once',
          pickupAt: pickupDate.toISOString(),
          dropoffAt: estimateDropoffAt(pickupDate, preview).toISOString(),
        }),
      })
      const payload = (await response.json().catch(() => null)) as RideMutationResponse | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        pushToast(
          payload?.error === 'ride_not_editable'
            ? 'This ride can no longer be edited.'
            : payload?.error ?? (isEditMode ? 'Unable to save that ride request right now.' : 'Unable to post that ride request right now.'),
          'error',
        )
        return
      }

      pushToast(isEditMode ? 'Ride request updated.' : 'Ride request posted to Drive.', 'success')
      router.push('/drive')
    } catch (submitError) {
      console.error(`Failed to ${isEditMode ? 'update' : 'post'} ride request`, submitError)
      pushToast(isEditMode ? 'Unable to save that ride request right now.' : 'Unable to post that ride request right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [existingRide?.recurrence, isEditMode, normalizedDestinationAddress, normalizedPickupAddress, pickupTime, preview, rideId, router, timing])

  const mapOrigin = hasMappedAddress(normalizedPickupAddress)
    ? {
        latitude: normalizedPickupAddress.latitude as number,
        longitude: normalizedPickupAddress.longitude as number,
        label: formatCanadianPhysicalAddressInline(normalizedPickupAddress) ?? 'Pickup',
      }
    : null

  const mapDestination = hasMappedAddress(normalizedDestinationAddress)
    ? {
        latitude: normalizedDestinationAddress.latitude as number,
        longitude: normalizedDestinationAddress.longitude as number,
        label: formatCanadianPhysicalAddressInline(normalizedDestinationAddress) ?? 'Destination',
      }
    : null
  const showRideForm = !isEditMode || (!rideLoading && !rideLoadError && Boolean(existingRide))

  return (
    <DashboardShell
      rightRail={
        <div className="space-y-5">
          <DriveModeRail
            isDriverActive={isDriverActive}
            isDriverMode={isDriverMode}
            loading={viewerLoading}
            rideRequestCount={rideRequestCount}
            deliveryRequestCount={deliveryRequestCount}
            onEnterDriverMode={enterDriverMode}
            onExitDriverMode={exitDriverMode}
          />
          <DriveDriverEarningsRail enabled={isDriverMode} />
          <RightRail mode="drive" organizationLinkTarget="chat" showDriveCallout={false} />
        </div>
      }
      showMobileRightRail
      mainClassName="space-y-6 pb-12"
      rightRailClassName="pb-12"
    >
      <DriveRouteNav />

      <section className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-950">{pageTitle}</h1>
      </section>

      {isEditMode && rideLoadError ? (
        <section className="rounded-[1.8rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {rideLoadError}
        </section>
      ) : null}

      {isEditMode && !rideLoadError && rideLoading ? (
        <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">
          Loading ride request…
        </section>
      ) : null}

      {isEditMode && showRideForm && !rideCanBeEdited ? (
        <section className="rounded-[1.8rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          This ride can no longer be edited. If the details changed, cancel it and post a new request.
        </section>
      ) : null}

      {showRideForm ? (
        <section className="space-y-5">
          <article className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-950">Pickup Address</p>
              <Link href="/settings/addresses" className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">
                Manage Addresses
              </Link>
            </div>

            <div ref={pickupDropdownRef} className="space-y-3">
              <button
                type="button"
                onClick={() => void handleUseCurrentLocation()}
                disabled={locatingPickup}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <HiOutlineMap className="h-4 w-4" />
                {locatingPickup ? 'Finding location…' : 'Use My Current Location'}
              </button>

              <SavedAddressesDropdown
                items={savedAddresses}
                selectedId={pickupSource === 'saved' ? selectedPickupAddressId : null}
                selectedTitle={pickupSelectionTitle}
                selectedDetail={pickupSelectionDetail}
                open={pickupMenuOpen}
                disabled={savedLoading || locatingPickup}
                onToggle={() => setPickupMenuOpen((current) => !current)}
                onSelect={applySavedPickupAddress}
              />
            </div>

            <CanadianAddressEditor
              value={pickupAddress}
              onChange={handlePickupAddressChange}
              mode="organization"
              layout="stacked"
              display="search-only"
              searchLatitude={pickupSearchAnchor?.latitude ?? null}
              searchLongitude={pickupSearchAnchor?.longitude ?? null}
              searchRadiusKm={500}
              required
            />
          </div>
          </article>

          <article className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-950">Destination</p>
              <div className="flex flex-wrap items-center gap-3">
                {destinationAlreadySaved ? <span className="text-sm font-semibold text-emerald-700">Saved</span> : null}
                <button
                  type="button"
                  onClick={() => void handleSaveDestinationAddress()}
                  disabled={!canSaveDestinationAddress}
                  className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingDestinationAddress ? 'Saving…' : 'Save Address'}
                </button>
              </div>
            </div>

            <CanadianAddressEditor
              value={destinationAddress}
              onChange={setDestinationAddress}
              mode="organization"
              layout="stacked"
              display="search-only"
              searchLatitude={destinationSearchAnchor?.latitude ?? null}
              searchLongitude={destinationSearchAnchor?.longitude ?? null}
              searchRadiusKm={500}
              required
            />
          </div>
          </article>

          <article className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-950">Ride Timing</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTiming('now')}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${timing === 'now' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20' : 'border-[var(--cc-primary)]/25 bg-white text-[var(--cc-primary)] hover:border-[var(--cc-primary)]/45 hover:bg-[var(--cc-primary)]/5'}`}
                >
                  Now
                </button>
                <button
                  type="button"
                  onClick={() => setTiming('later_today')}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${timing === 'later_today' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20' : 'border-[var(--cc-primary)]/25 bg-white text-[var(--cc-primary)] hover:border-[var(--cc-primary)]/45 hover:bg-[var(--cc-primary)]/5'}`}
                >
                  Later Today
                </button>
              </div>
            </div>

            {timing === 'later_today' ? (
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pickup time</span>
                <input
                  type="time"
                  step={RIDE_TIME_STEP_MINUTES * 60}
                  min={toTimeInputValue(getImmediatePickupDate())}
                  max="23:55"
                  value={pickupTime}
                  onChange={(event) => setPickupTime(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                />
              </label>
            ) : null}
          </div>
          </article>

          <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-lg font-semibold text-slate-950">Mapped Preview</p>
          </div>

          <div className="space-y-4 p-5">
            {mapOrigin && mapDestination ? (
              <>
                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200">
                  <AddressDirectionsMap origin={mapOrigin} destination={mapDestination} routeCoordinates={preview?.routeCoordinates ?? null} />
                </div>

                <div className="grid gap-3">
                  <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{formatCanadianPhysicalAddressInline(normalizedPickupAddress) ?? 'Pickup pending'}</p>
                  </div>
                  <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Destination</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{formatCanadianPhysicalAddressInline(normalizedDestinationAddress) ?? 'Destination pending'}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Add a mapped pickup address and destination to preview the route.
              </div>
            )}

            <div className="grid gap-3">
              <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Distance</p>
                <p className="mt-2 inline-flex items-center gap-2 text-lg font-semibold text-slate-950">
                  <HiOutlineMapPin className="h-4 w-4 text-slate-500" />
                  {preview ? `${estimate.routeDistanceKm.toFixed(1)} km` : 'Waiting'}
                </p>
              </div>
              <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Estimate</p>
                <p className="mt-2 inline-flex items-center gap-2 text-lg font-semibold text-slate-950">
                  <HiOutlineClock className="h-4 w-4 text-slate-500" />
                  {formatRideTravelTime(preview?.travelMinutes ?? null)}
                </p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Estimated total</p>
                  <p className="mt-2 text-3xl font-semibold text-emerald-950">{formatDriveMoney(estimate.totalCostCents)}</p>
                </div>
                <div className="text-right text-sm text-emerald-900">
                  <p className="inline-flex items-center justify-end gap-1.5">
                    <HiOutlineCalendarDays className="h-4 w-4" />
                    {timing === 'later_today' ? 'Later Today' : 'Now'}
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-sm text-emerald-900">
                <div className="flex items-center justify-between gap-3">
                  <span>Fuel/service</span>
                  <span className="font-semibold">{formatDriveMoney(estimate.fuelChargeCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Driver fee</span>
                  <span className="font-semibold">{formatDriveMoney(estimate.driverFeeCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Civil Fee</span>
                  <span className="font-semibold">{formatDriveMoney(estimate.civilFeeCents)}</span>
                </div>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <HiOutlineInformationCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
              <span>Estimate only. Drivers will make their offer for you to accept.</span>
            </p>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitDisabled}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-5 py-3.5 text-base font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaCarSide className="h-5 w-5" />
              {submitLabel}
            </button>
          </div>
          </article>
        </section>
      ) : null}
    </DashboardShell>
  )
}
