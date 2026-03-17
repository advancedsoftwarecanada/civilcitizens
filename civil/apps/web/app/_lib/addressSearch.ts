import { buildApiUrl } from './api'
import {
  CANADIAN_PROVINCE_OPTIONS,
  formatCanadianPhysicalAddressInline,
  getCanadianAddressSystemDisplayName,
  normalizeCanadianPostalCode,
  type CanadianAddress,
} from './canadianAddresses'

export type NominatimAddress = {
  placeId: number | null
  osmType: string | null
  osmId: number | null
  displayName: string
  latitude: number
  longitude: number
  className: string | null
  typeName: string | null
  importance: number | null
  address: Record<string, string>
  originalPostalCode: string | null
  postalCodeVerified: boolean
  nominatimRaw: Record<string, unknown>
}

export type RoutePoint = {
  latitude: number
  longitude: number
}

export type DrivingRoute = {
  distanceMeters: number
  durationSeconds: number
  geometry: Array<[number, number]>
}

type AddressCorrectionResolveResponse = {
  items?: Array<{
    latitude: number
    longitude: number
    originalPostal: string | null
    correctedPostal: string | null
    source?: string | null
  }>
}

type OsrmRouteResponse = {
  code?: string
  routes?: Array<{
    distance?: number
    duration?: number
    geometry?: {
      type?: string
      coordinates?: Array<[number, number]>
    }
  }>
}

const MIN_ADDRESS_QUERY_LENGTH = 3

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeAddressRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, string>
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((accumulator, [key, entry]) => {
    const text = normalizeText(entry)
    if (text) accumulator[key] = text
    return accumulator
  }, {})
}

function readNominatimSavedAddress(address: CanadianAddress | null | undefined) {
  if (!address?.nominatimRaw || typeof address.nominatimRaw !== 'object' || Array.isArray(address.nominatimRaw)) {
    return {} as Record<string, string>
  }
  const raw = address.nominatimRaw as Record<string, unknown>
  return normalizeAddressRecord(raw.address)
}

function inferStreetLabelFromText(value: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return ''
  const segments = trimmed
    .split(',')
    .map((segment) => normalizeAddressDisplayText(segment))
    .filter(Boolean)

  if (!segments.length) return ''
  const firstSegment = segments[0] ?? ''
  const secondSegment = segments[1] ?? ''

  if (segments.length >= 2 && /^\d+[A-Za-z-]*$/.test(firstSegment)) {
    return `${firstSegment} ${secondSegment}`.trim()
  }
  return firstSegment
}

function normalizeAddressDisplayText(value: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return ''
  const lettersOnly = trimmed.replace(/[^A-Za-z]+/g, '')
  const isAllUppercase = Boolean(lettersOnly) && lettersOnly === lettersOnly.toUpperCase()
  if (!isAllUppercase) return trimmed

  return trimmed
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
}

function normalizeProvinceDisplay(value: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  const matchingProvince = CANADIAN_PROVINCE_OPTIONS.find((option) => option.code === upper)
  return matchingProvince?.label ?? normalizeAddressDisplayText(trimmed)
}

function normalizePostalDisplay(value: string) {
  return normalizeText(value).toUpperCase()
}

export function pickAddressLocalityRecord(address: Record<string, string>) {
  return (
    address.city ||
    address.municipality ||
    address.town ||
    address.village ||
    address.borough ||
    address.city_district ||
    address.township ||
    address.hamlet ||
    address.suburb ||
    address.county ||
    ''
  )
}

function normalizeCountryDisplay(value: string) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  const upper = normalized.toUpperCase()
  if (upper === 'CA' || upper === 'CANADA') return ''
  return normalizeAddressDisplayText(normalized)
}

function formatAddressStreetLabel(address: CanadianAddress | null | undefined) {
  const nominatimAddress = readNominatimSavedAddress(address)
  const houseNumber = normalizeText(nominatimAddress.house_number)
  const road = normalizeText(nominatimAddress.road)
  if (houseNumber && road) return `${houseNumber} ${road}`
  if (road) return road

  const line1 = normalizeAddressDisplayText(normalizeText(address?.line1))
  if (!line1) return ''
  if (!line1.includes(',')) return line1
  return inferStreetLabelFromText(line1)
}

function formatAddressQueryInline(address: CanadianAddress | null | undefined) {
  const nominatimAddress = readNominatimSavedAddress(address)
  const line1 = formatAddressStreetLabel(address)
  const line2 = normalizeAddressDisplayText(normalizeText(address?.line2 || nominatimAddress.suburb || nominatimAddress.neighbourhood || nominatimAddress.city_district))
  const city = normalizeAddressDisplayText(normalizeText(address?.city || nominatimAddress.city || nominatimAddress.town || nominatimAddress.village || nominatimAddress.hamlet))
  const province = normalizeProvinceDisplay(normalizeText(address?.province || nominatimAddress.state || nominatimAddress.province || nominatimAddress.region))
  const postalCode = normalizePostalDisplay(normalizeText(address?.postalCode || nominatimAddress.postcode))
  const country = normalizeCountryDisplay(normalizeText(address?.country || nominatimAddress.country || 'CA'))

  const locality = [city, province, postalCode].filter(Boolean).join(', ')
  const pieces = [line1, line2, locality, country].filter(Boolean)
  return pieces.join(', ')
}

export function buildAddressSearchQueries(address: CanadianAddress | null | undefined) {
  if (!address) return [] as string[]

  const line1 = formatAddressStreetLabel(address)
  const line2 = normalizeAddressDisplayText(normalizeText(address.line2))
  const city = normalizeAddressDisplayText(normalizeText(address.city))
  const province = normalizeProvinceDisplay(normalizeText(address.province))
  const postalCode = normalizePostalDisplay(normalizeText(address.postalCode))
  const systemDisplayName = normalizeText(getCanadianAddressSystemDisplayName(address))
  const physicalInline = formatCanadianPhysicalAddressInline(address) || ''

  const candidates = [
    systemDisplayName,
    [line1, line2, [city, province, postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    [line1, [city, province, postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    [line1, [city, province].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    [line1, city].filter(Boolean).join(', '),
    physicalInline,
  ]

  return candidates.filter((candidate, index, values) => {
    const normalized = normalizeText(candidate)
    if (normalized.length < MIN_ADDRESS_QUERY_LENGTH) return false
    return values.findIndex((value) => normalizeText(value).toLowerCase() === normalized.toLowerCase()) === index
  })
}

export function buildNominatimSearchUrl(query: string, limit = 5) {
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    dedupe: '1',
    countrycodes: 'ca',
  })
  return `/nominatim/search?${params.toString()}`
}

export async function fetchAddressSearchResults(query: string, signal?: AbortSignal, limit = 5): Promise<NominatimAddress[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < MIN_ADDRESS_QUERY_LENGTH) return []

  const response = await fetch(buildNominatimSearchUrl(trimmedQuery, limit), {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`nominatim_search_failed:${response.status}`)
  }

  const payload = (await response.json().catch(() => [])) as unknown
  if (!Array.isArray(payload)) return []

    const results = payload.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const record = entry as Record<string, unknown>
      const displayName = normalizeText(record.display_name)
      const latitude = normalizeNumber(record.lat)
      const longitude = normalizeNumber(record.lon)
      if (!displayName || latitude === null || longitude === null) return []
      return [{
        placeId: normalizeNumber(record.place_id),
        osmType: normalizeText(record.osm_type) || null,
        osmId: normalizeNumber(record.osm_id),
        displayName,
        latitude,
        longitude,
        className: normalizeText(record.class) || null,
        typeName: normalizeText(record.type) || null,
        importance: normalizeNumber(record.importance),
        address: normalizeAddressRecord(record.address),
        originalPostalCode: normalizeCanadianPostalCode(normalizeText((record.address as Record<string, unknown> | undefined)?.postcode)) || null,
        postalCodeVerified: false,
        nominatimRaw: record,
      } satisfies NominatimAddress]
    })

  if (!results.length) return results

  try {
    const response = await fetch(buildApiUrl('/address-corrections/resolve'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        points: results.map((result) => ({
          latitude: result.latitude,
          longitude: result.longitude,
          postalCode: result.address.postcode ?? null,
        })),
      }),
      signal,
    })

    if (!response.ok) return results
    const payload = (await response.json().catch(() => null)) as AddressCorrectionResolveResponse | null
    const corrections = Array.isArray(payload?.items) ? payload.items : []
    if (!corrections.length) return results

    return results.map((result, index) => {
      const correction = corrections[index]
      if (!correction?.correctedPostal) return result
      return {
        ...result,
        postalCodeVerified: true,
        address: {
          ...result.address,
          postcode: correction.correctedPostal,
        },
      }
    })
  } catch {
    return results
  }
}

export function formatAddressPrimaryLabel(result: NominatimAddress) {
  const houseNumber = normalizeText(result.address.house_number)
  const road = normalizeText(result.address.road)
  if (houseNumber && road) return `${houseNumber} ${road}`
  if (road) return road
  return result.displayName.split(',')[0]?.trim() || result.displayName
}

export function formatAddressSecondaryLabel(result: NominatimAddress) {
  const locality = normalizeText(pickAddressLocalityRecord(result.address))
  const province = normalizeText(result.address.state)
  const postcode = result.postalCodeVerified ? normalizeText(result.address.postcode) : ''
  const pieces = [locality, province, postcode].filter(Boolean)
  if (pieces.length) return pieces.join(' • ')
  return result.displayName
}

export function isAddressPostalVerified(result: NominatimAddress | null | undefined) {
  return Boolean(result?.postalCodeVerified)
}

export function buildAddressesHref(options: {
  query?: string | null
  label?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}) {
  const params = new URLSearchParams()
  const query = normalizeText(options.query)
  const label = normalizeText(options.label)
  const address = normalizeText(options.address)

  if (query) params.set('q', query)
  if (label) params.set('label', label)
  if (address) params.set('address', address)
  if (typeof options.latitude === 'number' && Number.isFinite(options.latitude)) params.set('lat', String(options.latitude))
  if (typeof options.longitude === 'number' && Number.isFinite(options.longitude)) params.set('lon', String(options.longitude))

  const search = params.toString()
  return `/addresses${search ? `?${search}` : ''}`
}

export function buildAddressesHrefFromResult(result: NominatimAddress, query?: string | null) {
  return buildAddressesHref({
    query: query ?? formatAddressPrimaryLabel(result),
    label: formatAddressPrimaryLabel(result),
    address: result.displayName,
    latitude: result.latitude,
    longitude: result.longitude,
  })
}

export function buildAddressesHrefFromAddress(address: CanadianAddress | null | undefined, label?: string | null) {
  const systemDisplayName = getCanadianAddressSystemDisplayName(address)
  const inline = systemDisplayName || formatAddressQueryInline(address) || formatCanadianPhysicalAddressInline(address)
  const streetLabel = formatAddressStreetLabel(address) || normalizeText(label) || inline
  return buildAddressesHref({
    query: streetLabel,
    label: streetLabel,
    address: inline,
    latitude: typeof address?.latitude === 'number' ? address.latitude : null,
    longitude: typeof address?.longitude === 'number' ? address.longitude : null,
  })
}

export function calculateDistanceKm(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  const earthRadiusKm = 6371
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(destination.latitude - origin.latitude)
  const deltaLon = toRadians(destination.longitude - origin.longitude)
  const originLat = toRadians(origin.latitude)
  const destinationLat = toRadians(destination.latitude)

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2) * Math.cos(originLat) * Math.cos(destinationLat)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

export function estimateTravelMinutes(distanceKm: number) {
  const averageUrbanSpeedKmH = 45
  return Math.max(5, Math.round((distanceKm / averageUrbanSpeedKmH) * 60))
}

export async function fetchDrivingRoute(origin: RoutePoint, destination: RoutePoint, signal?: AbortSignal): Promise<DrivingRoute | null> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'false',
  })

  const response = await fetch(`/osrm/route/v1/driving/${coordinates}?${params.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`osrm_route_failed:${response.status}`)
  }

  const payload = (await response.json().catch(() => null)) as OsrmRouteResponse | null
  if (!payload || payload.code !== 'Ok') return null
  const route = Array.isArray(payload.routes) ? payload.routes[0] : null
  const distanceMeters = typeof route?.distance === 'number' && Number.isFinite(route.distance) ? route.distance : null
  const durationSeconds = typeof route?.duration === 'number' && Number.isFinite(route.duration) ? route.duration : null
  const coordinatesList = Array.isArray(route?.geometry?.coordinates)
    ? route.geometry.coordinates.filter(
        (coordinate): coordinate is [number, number] =>
          Array.isArray(coordinate) && coordinate.length === 2 && coordinate.every((value) => typeof value === 'number' && Number.isFinite(value)),
      )
    : []

  if (distanceMeters === null || durationSeconds === null || coordinatesList.length < 2) return null

  return {
    distanceMeters,
    durationSeconds,
    geometry: coordinatesList,
  }
}

export function isUsableAddressQuery(value: string | null | undefined) {
  return normalizeText(value).length >= MIN_ADDRESS_QUERY_LENGTH
}