'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { HiOutlineCalendarDays, HiOutlineClock, HiOutlineMapPin, HiOutlineTruck } from 'react-icons/hi2'
import { CanadianAddressEditor } from '../_components/address/CanadianAddressEditor'
import { AddressDirectionsMap } from '../_components/map/AddressDirectionsMap'
import { pushToast } from '../_components/useToasts'
import { fetchDrivingRoute, calculateDistanceKm } from '../_lib/addressSearch'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import {
  createEmptyCanadianAddress,
  formatCanadianPhysicalAddressInline,
  normalizeCanadianAddress,
  type CanadianAddress,
} from '../_lib/canadianAddresses'
import { getStoredToken } from '../_lib/tokenStorage'
import { formatMoney } from './deliveryShared'

const RIDE_DRIVER_FLAT_FEE_CENTS = 1000
const RIDE_FUEL_RATE_CENTS_PER_KM = 65
const RIDE_MIN_FUEL_CHARGE_CENTS = 500

type RideRequestItem = {
  id: string
  status: string
  recurrence: 'once' | 'recurring'
  pickupAddress: CanadianAddress | null
  dropoffAddress: CanadianAddress | null
  pickupAt: string
  dropoffAt: string
  routeDistanceKm: number
  fuelChargeCents: number
  driverFeeCents: number
  totalCostCents: number
  createdAt: string
  requester: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  isOwner: boolean
}

type RideRequestsResponse = {
  items?: RideRequestItem[]
}

type RideCreateResponse = {
  item?: RideRequestItem
  error?: string
}

type RidePreview = {
  distanceKm: number
  travelMinutes: number | null
  routeCoordinates: Array<[number, number]> | null
}

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

function toDateTimeLocalValue(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Not scheduled'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRecurrence(value: 'once' | 'recurring') {
  return value === 'recurring' ? 'Recurring' : 'One time'
}

function RideStatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{note}</p>
    </article>
  )
}

export function DriveRideRequestsRail() {
  return (
    <div className="space-y-5 xl:sticky xl:top-8">
      <section className="overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-sm font-semibold text-white/92">Ride Request Pricing</p>
        </div>
        <div className="space-y-3 p-4 text-sm text-white/80">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-3">
            <p className="font-semibold text-white">Estimated fuel/service</p>
            <p className="mt-1">$0.65 per km with a $5 minimum.</p>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-3">
            <p className="font-semibold text-white">Driver flat rate</p>
            <p className="mt-1">A fixed $10 is added to every ride request.</p>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-3">
            <p className="font-semibold text-white">Mapping</p>
            <p className="mt-1">Choose mapped pickup and dropoff addresses so the request renders correctly on Drive.</p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold text-slate-900">What posts now</p>
        <ul className="mt-4 space-y-3 text-sm text-slate-600">
          <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Pickup address and dropoff address</li>
          <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">One-time or recurring schedule</li>
          <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Pickup and dropoff date windows</li>
          <li className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Calculated ride cost shown to everyone on Drive</li>
        </ul>
      </section>
    </div>
  )
}

export function DriveRideRequestsSection() {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<RideRequestItem[]>([])
  const [pickupAddress, setPickupAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [dropoffAddress, setDropoffAddress] = useState<CanadianAddress>(() => createEmptyCanadianAddress())
  const [recurrence, setRecurrence] = useState<'once' | 'recurring'>('once')
  const [pickupAt, setPickupAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)))
  const [dropoffAt, setDropoffAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000)))
  const [preview, setPreview] = useState<RidePreview | null>(null)

  const normalizedPickupAddress = useMemo(() => normalizeCanadianAddress(pickupAddress), [pickupAddress])
  const normalizedDropoffAddress = useMemo(() => normalizeCanadianAddress(dropoffAddress), [dropoffAddress])

  const loadItems = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(buildApiUrl('/drive/rides'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as RideRequestsResponse | { error?: string } | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        setError('Unable to load ride requests right now.')
        setItems([])
        return
      }
      setItems(payload && 'items' in payload && Array.isArray(payload.items) ? payload.items : [])
    } catch (loadError) {
      console.error('Failed to load ride requests', loadError)
      setError('Unable to load ride requests right now.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  useEffect(() => {
    if (!hasMappedAddress(normalizedPickupAddress) || !hasMappedAddress(normalizedDropoffAddress)) {
      setPreview(null)
      return
    }

    const fallbackDistanceKm = calculateDistanceKm(
      {
        latitude: normalizedPickupAddress.latitude as number,
        longitude: normalizedPickupAddress.longitude as number,
      },
      {
        latitude: normalizedDropoffAddress.latitude as number,
        longitude: normalizedDropoffAddress.longitude as number,
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
        latitude: normalizedDropoffAddress.latitude as number,
        longitude: normalizedDropoffAddress.longitude as number,
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
  }, [normalizedDropoffAddress, normalizedPickupAddress])

  const estimate = useMemo(() => estimateRidePricing(preview?.distanceKm ?? 0), [preview?.distanceKm])

  const stats = useMemo(() => {
    const yourItems = items.filter((item) => item.isOwner)
    return [
      {
        label: 'Open requests',
        value: String(items.length),
        note: 'Live ride requests on Drive right now',
      },
      {
        label: 'Your requests',
        value: String(yourItems.length),
        note: 'Requests you posted from this account',
      },
      {
        label: 'Current estimate',
        value: formatMoney(estimate.totalCostCents),
        note: preview ? `${estimate.routeDistanceKm.toFixed(1)} km mapped ride total` : 'Updates once both addresses are mapped',
      },
    ]
  }, [estimate.routeDistanceKm, estimate.totalCostCents, items, preview])

  const handlePost = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (!hasMappedAddress(normalizedPickupAddress) || !hasMappedAddress(normalizedDropoffAddress)) {
      pushToast('Choose mapped pickup and dropoff addresses before posting.', 'error')
      return
    }

    const pickupDate = new Date(pickupAt)
    const dropoffDate = new Date(dropoffAt)
    if (!Number.isFinite(pickupDate.getTime()) || !Number.isFinite(dropoffDate.getTime()) || dropoffDate.getTime() <= pickupDate.getTime()) {
      pushToast('Dropoff time must be later than pickup time.', 'error')
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
          dropoffAddress: normalizedDropoffAddress,
          recurrence,
          pickupAt: pickupDate.toISOString(),
          dropoffAt: dropoffDate.toISOString(),
        }),
      })
      const payload = (await response.json().catch(() => null)) as RideCreateResponse | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok || !payload?.item) {
        pushToast(payload?.error ?? 'Unable to post that ride request right now.', 'error')
        return
      }

      setItems((current) => [payload.item as RideRequestItem, ...current])
      setPickupAddress(createEmptyCanadianAddress())
      setDropoffAddress(createEmptyCanadianAddress())
      setRecurrence('once')
      setPickupAt(toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)))
      setDropoffAt(toDateTimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000)))
      setPreview(null)
      pushToast('Ride request posted to Drive.', 'success')
    } catch (submitError) {
      console.error('Failed to post ride request', submitError)
      pushToast('Unable to post that ride request right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [dropoffAt, normalizedDropoffAddress, normalizedPickupAddress, pickupAt, recurrence])

  const mapOrigin = hasMappedAddress(normalizedPickupAddress)
    ? {
        latitude: normalizedPickupAddress.latitude as number,
        longitude: normalizedPickupAddress.longitude as number,
        label: formatCanadianPhysicalAddressInline(normalizedPickupAddress) ?? 'Pickup',
      }
    : null

  const mapDestination = hasMappedAddress(normalizedDropoffAddress)
    ? {
        latitude: normalizedDropoffAddress.latitude as number,
        longitude: normalizedDropoffAddress.longitude as number,
        label: formatCanadianPhysicalAddressInline(normalizedDropoffAddress) ?? 'Dropoff',
      }
    : null

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-3">
        {stats.map((stat) => (
          <RideStatCard key={stat.label} label={stat.label} value={stat.value} note={stat.note} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <article className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">Post a Ride Request</h2>
              <p className="mt-1 text-sm text-slate-500">Create a simple mapped request that shows up immediately in Drive.</p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Live</span>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Pickup address</p>
                <div className="mt-3">
                  <CanadianAddressEditor value={pickupAddress} onChange={setPickupAddress} mode="shipping" required />
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Dropoff address</p>
                <div className="mt-3">
                  <CanadianAddressEditor value={dropoffAddress} onChange={setDropoffAddress} mode="shipping" required />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Schedule</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Frequency</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setRecurrence('once')}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${recurrence === 'once' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'}`}
                      >
                        Once
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecurrence('recurring')}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${recurrence === 'recurring' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'}`}
                      >
                        Recurring
                      </button>
                    </div>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pickup date and time</span>
                    <input
                      type="datetime-local"
                      value={pickupAt}
                      onChange={(event) => setPickupAt(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Dropoff date and time</span>
                    <input
                      type="datetime-local"
                      value={dropoffAt}
                      onChange={(event) => setDropoffAt(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Ride cost</p>
                    <p className="mt-1 text-xs text-slate-500">Estimated fuel/service plus the fixed driver fee.</p>
                  </div>
                  <p className="text-3xl font-semibold text-slate-950">{formatMoney(estimate.totalCostCents)}</p>
                </div>
                <div className="mt-4 space-y-3 rounded-[1.35rem] border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-4">
                    <span>Fuel/service estimate</span>
                    <span className="font-semibold text-slate-900">{formatMoney(estimate.fuelChargeCents)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Driver flat fee</span>
                    <span className="font-semibold text-slate-900">{formatMoney(estimate.driverFeeCents)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3">
                    <span>Mapped distance</span>
                    <span className="font-semibold text-slate-900">{preview ? `${estimate.routeDistanceKm.toFixed(1)} km` : 'Add both addresses'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handlePost()}
                  className="mt-4 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Posting…' : 'Post ride request'}
                </button>
              </div>
            </div>
          </div>
        </article>

        <article className="overflow-hidden rounded-[1.9rem] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-lg font-semibold text-slate-900">Mapped preview</p>
            <p className="mt-1 text-sm text-slate-500">Your route preview updates once both addresses resolve on the map.</p>
          </div>
          <div className="space-y-4 p-5">
            {mapOrigin && mapDestination ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <AddressDirectionsMap origin={mapOrigin} destination={mapDestination} routeCoordinates={preview?.routeCoordinates ?? null} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Distance</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{estimate.routeDistanceKm.toFixed(1)} km</p>
                  </div>
                  <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Travel time</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{preview?.travelMinutes ? `${preview.travelMinutes} min` : 'Estimating…'}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Select a mapped pickup and dropoff address to preview the route.
              </div>
            )}
          </div>
        </article>
      </section>

      {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Ride Requests</h2>
            <p className="mt-1 text-sm text-slate-500">Posted requests appear here for everyone browsing Drive.</p>
          </div>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{items.length} live</span>
        </div>

        {loading ? <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading ride requests…</div> : null}

        {!loading && !items.length ? (
          <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No ride requests have been posted yet.</div>
        ) : null}

        {!loading
          ? items.map((item) => {
              const requesterLabel = item.isOwner ? 'You' : item.requester.name?.trim() || item.requester.handle?.trim() || 'Civil citizen'
              return (
                <article key={item.id} className="rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-semibold text-slate-900">{requesterLabel}&rsquo;s ride request</h3>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{formatRecurrence(item.recurrence)}</span>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup</p>
                          <p className="mt-2 text-sm font-medium text-slate-900">{formatCanadianPhysicalAddressInline(item.pickupAddress) ?? 'Pickup pending'}</p>
                        </div>
                        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Dropoff</p>
                          <p className="mt-2 text-sm font-medium text-slate-900">{formatCanadianPhysicalAddressInline(item.dropoffAddress) ?? 'Dropoff pending'}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
                        <span className="inline-flex items-center gap-1.5"><HiOutlineCalendarDays className="h-4 w-4" />{formatDateTime(item.pickupAt)}</span>
                        <span className="inline-flex items-center gap-1.5"><HiOutlineClock className="h-4 w-4" />Dropoff by {formatDateTime(item.dropoffAt)}</span>
                        <span className="inline-flex items-center gap-1.5"><HiOutlineMapPin className="h-4 w-4" />{item.routeDistanceKm.toFixed(1)} km</span>
                        <span className="inline-flex items-center gap-1.5"><HiOutlineTruck className="h-4 w-4" />Posted {formatDateTime(item.createdAt)}</span>
                      </div>
                    </div>

                    <div className="w-full max-w-full rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-4 xl:max-w-xs">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Ride cost</p>
                      <p className="mt-2 text-3xl font-semibold text-emerald-950">{formatMoney(item.totalCostCents)}</p>
                      <div className="mt-3 space-y-2 text-sm text-emerald-900">
                        <div className="flex items-center justify-between gap-3">
                          <span>Fuel/service</span>
                          <span className="font-semibold">{formatMoney(item.fuelChargeCents)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Driver fee</span>
                          <span className="font-semibold">{formatMoney(item.driverFeeCents)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })
          : null}
      </section>
    </div>
  )
}
