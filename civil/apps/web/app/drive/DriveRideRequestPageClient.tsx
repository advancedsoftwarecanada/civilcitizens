'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HiChevronDown,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineMapPin,
  HiOutlineMap,
} from 'react-icons/hi2'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { CanadianAddressEditor } from '../_components/address/CanadianAddressEditor'
import { AddressDirectionsMap } from '../_components/map/AddressDirectionsMap'
import { pushToast } from '../_components/useToasts'
import {
  calculateDistanceKm,
  fetchDrivingRoute,
  fetchReverseGeocodeResult,
  formatAddressPrimaryLabel,
  pickAddressLocalityRecord,
  type NominatimAddress,
} from '../_lib/addressSearch'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import {
  createEmptyCanadianAddress,
  formatCanadianPhysicalAddressInline,
  normalizeCanadianAddress,
  normalizeCanadianPostalCode,
  normalizeCanadianProvince,
  normalizeSavedShippingAddress,
  type CanadianAddress,
  type SavedShippingAddress,
} from '../_lib/canadianAddresses'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveRouteNav from './DriveRouteNav'
import { formatDriveMoney } from './driveShared'

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
  item?: SavedShippingAddress | null
  error?: string
}

type RideCreateResponse = {
  error?: string
}

type RideTiming = 'once' | 'scheduled'
type PickupSource = 'saved' | 'current' | 'manual'

type RidePreview = {
  distanceKm: number
  travelMinutes: number | null
  routeCoordinates: Array<[number, number]> | null
}

const RIDE_DRIVER_FLAT_FEE_CENTS = 1000
const RIDE_FUEL_RATE_CENTS_PER_KM = 65
const RIDE_MIN_FUEL_CHARGE_CENTS = 500

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

function toDateTimeLocalValue(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
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
  return {
    routeDistanceKm: Number(safeDistanceKm.toFixed(1)),
    fuelChargeCents,
    driverFeeCents: RIDE_DRIVER_FLAT_FEE_CENTS,
    totalCostCents: fuelChargeCents + RIDE_DRIVER_FLAT_FEE_CENTS,
  }
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

function buildAddressFromSearchResult(result: NominatimAddress, current?: CanadianAddress | null): CanadianAddress {
  const existing = normalizeCanadianAddress(current ?? createEmptyCanadianAddress())
  const nextPostal = normalizeCanadianPostalCode(result.address.postcode || result.originalPostalCode)
  const originalPostal = normalizeCanadianPostalCode(result.originalPostalCode || result.address.postcode)

  return {
    ...existing,
    line1: formatAddressPrimaryLabel(result),
    line2: existing.line2 ?? '',
    city: pickAddressLocalityRecord(result.address),
    province: normalizeCanadianProvince(result.address.state || result.address.province || result.address.region || ''),
    postalCode: nextPostal,
    originalPostalCode: originalPostal,
    country: (result.address.country_code || result.address.country || 'CA').toUpperCase(),
    latitude: result.latitude,
    longitude: result.longitude,
    nominatimDisplayName: result.displayName,
    nominatimRaw: result.nominatimRaw,
  }
}

function SavedAddressesDropdown({
  items,
  selectedId,
  manualActive,
  selectedTitle,
  selectedDetail,
  open,
  disabled,
  onToggle,
  onSelect,
  onManual,
}: {
  items: SavedShippingAddress[]
  selectedId: string | null
  manualActive: boolean
  selectedTitle: string
  selectedDetail: string
  open: boolean
  disabled?: boolean
  onToggle: () => void
  onSelect: (address: SavedShippingAddress) => void
  onManual: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-3 rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
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

            <button
              type="button"
              onClick={onManual}
              className={`mt-1 flex w-full items-start rounded-[1rem] px-3 py-3 text-left transition ${manualActive ? 'bg-slate-100 text-slate-900' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <div>
                <p className="text-sm font-semibold">Enter new address</p>
                <p className="mt-1 text-xs text-slate-500">Search for another pickup location</p>
              </div>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function DriveRideRequestPageClient() {
  const router = useRouter()
  const pickupDropdownRef = useRef<HTMLDivElement | null>(null)
  const initializedPickupRef = useRef(false)

  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [pickupAddress, setPickupAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [destinationAddress, setDestinationAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [pickupSource, setPickupSource] = useState<PickupSource>('manual')
  const [selectedPickupAddressId, setSelectedPickupAddressId] = useState<string | null>(null)
  const [pickupMenuOpen, setPickupMenuOpen] = useState(false)
  const [locatingPickup, setLocatingPickup] = useState(false)
  const [timing, setTiming] = useState<RideTiming>('once')
  const [pickupAt, setPickupAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)))
  const [preview, setPreview] = useState<RidePreview | null>(null)
  const [savedLoading, setSavedLoading] = useState(true)
  const [savingDestinationAddress, setSavingDestinationAddress] = useState(false)
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

        if (!initializedPickupRef.current) {
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
  }, [])

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
    if (hasMappedAddress(normalizedPickupAddress)) return 'Custom pickup address'
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
    return savedAddresses.length ? 'Choose a saved address or enter a new one' : 'Save one in Settings > Addresses or enter a new one'
  }, [locatingPickup, normalizedPickupAddress, pickupSource, savedAddresses.length, selectedPickupAddress])

  const destinationAlreadySaved = useMemo(
    () => savedAddresses.some((address) => matchesSavedAddress(normalizedDestinationAddress, address)),
    [normalizedDestinationAddress, savedAddresses],
  )

  const canSaveDestinationAddress = hasMappedAddress(normalizedDestinationAddress) && !destinationAlreadySaved && !savingDestinationAddress

  const applySavedPickupAddress = useCallback((address: SavedShippingAddress) => {
    setPickupSource('saved')
    setSelectedPickupAddressId(address.id)
    setPickupAddress(normalizeCanadianAddress(address))
    setPickupMenuOpen(false)
  }, [])

  const selectManualPickupAddress = useCallback(() => {
    setPickupSource('manual')
    setSelectedPickupAddressId(null)
    setPickupMenuOpen(false)
  }, [])

  const handleUseCurrentLocation = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      pushToast('Current location is not available on this device.', 'error')
      return
    }

    setLocatingPickup(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        })
      })

      const resolved = await fetchReverseGeocodeResult(position.coords.latitude, position.coords.longitude)
      if (!resolved) {
        pushToast('Unable to resolve your current location as an address.', 'error')
        return
      }

      setPickupAddress(buildAddressFromSearchResult(resolved))
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

    const pickupDate = new Date(pickupAt)
    if (!Number.isFinite(pickupDate.getTime())) {
      pushToast('Choose a valid pickup date and time.', 'error')
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
          recurrence: timing === 'scheduled' ? 'recurring' : 'once',
          pickupAt: pickupDate.toISOString(),
          dropoffAt: estimateDropoffAt(pickupDate, preview).toISOString(),
        }),
      })
      const payload = (await response.json().catch(() => null)) as RideCreateResponse | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to post that ride request right now.', 'error')
        return
      }

      pushToast('Ride request posted to Drive.', 'success')
      router.push('/drive/ride')
    } catch (submitError) {
      console.error('Failed to post ride request', submitError)
      pushToast('Unable to post that ride request right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [normalizedDestinationAddress, normalizedPickupAddress, pickupAt, preview, router, timing])

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

  return (
    <DashboardShell
      rightRail={<RightRail mode="drive" organizationLinkTarget="chat" />}
      showMobileRightRail
      mainClassName="space-y-6 pb-12"
      rightRailClassName="pb-12"
    >
      <DriveRouteNav />

      <section className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-950">Request Ride</h1>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Posting…' : 'Post Request'}
        </button>
      </section>

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
              <SavedAddressesDropdown
                items={savedAddresses}
                selectedId={pickupSource === 'saved' ? selectedPickupAddressId : null}
                manualActive={pickupSource === 'manual'}
                selectedTitle={pickupSelectionTitle}
                selectedDetail={pickupSelectionDetail}
                open={pickupMenuOpen}
                disabled={savedLoading || locatingPickup}
                onToggle={() => setPickupMenuOpen((current) => !current)}
                onSelect={applySavedPickupAddress}
                onManual={selectManualPickupAddress}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleUseCurrentLocation()}
                  disabled={locatingPickup}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <HiOutlineMap className="h-4 w-4" />
                  {locatingPickup ? 'Finding location…' : 'Use My Current Location'}
                </button>
              </div>
            </div>

            {pickupSource === 'manual' ? (
              <CanadianAddressEditor value={pickupAddress} onChange={setPickupAddress} mode="shipping" layout="stacked" required />
            ) : (
              <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">{pickupSelectionTitle}</p>
                <p className="mt-1 text-sm text-slate-600">{pickupSelectionDetail}</p>
              </div>
            )}
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

            <CanadianAddressEditor value={destinationAddress} onChange={setDestinationAddress} mode="organization" layout="stacked" required />
          </div>
        </article>

        <article className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-950">Ride Timing</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTiming('once')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${timing === 'once' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'}`}
                >
                  One Time
                </button>
                <button
                  type="button"
                  onClick={() => setTiming('scheduled')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${timing === 'scheduled' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'}`}
                >
                  Scheduled
                </button>
              </div>
            </div>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pickup date and time</span>
              <input
                type="datetime-local"
                value={pickupAt}
                onChange={(event) => setPickupAt(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
              />
            </label>
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
                  {preview?.travelMinutes ? `${preview.travelMinutes} min` : 'Waiting'}
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
                    {timing === 'scheduled' ? 'Scheduled' : 'One Time'}
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
              </div>
            </div>
          </div>
        </article>
      </section>
    </DashboardShell>
  )
}
