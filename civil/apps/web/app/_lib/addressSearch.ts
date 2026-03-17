import { CANADIAN_PROVINCE_OPTIONS, formatCanadianAddressInline, type CanadianAddress } from './canadianAddresses'

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

function formatAddressStreetLabel(address: CanadianAddress | null | undefined) {
  return normalizeAddressDisplayText(normalizeText(address?.line1))
}

function formatAddressQueryInline(address: CanadianAddress | null | undefined) {
  const line1 = formatAddressStreetLabel(address)
  const line2 = normalizeAddressDisplayText(normalizeText(address?.line2))
  const city = normalizeAddressDisplayText(normalizeText(address?.city))
  const province = normalizeProvinceDisplay(normalizeText(address?.province))
  const postalCode = normalizePostalDisplay(normalizeText(address?.postalCode))

  const locality = [city, province, postalCode].filter(Boolean).join(', ')
  const pieces = [line1, line2, locality].filter(Boolean)
  return pieces.join(', ')
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

  return payload
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const record = entry as Record<string, unknown>
      const displayName = normalizeText(record.display_name)
      const latitude = normalizeNumber(record.lat)
      const longitude = normalizeNumber(record.lon)
      if (!displayName || latitude === null || longitude === null) return null
      return {
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
      } satisfies NominatimAddress
    })
    .filter((entry): entry is NominatimAddress => Boolean(entry))
}

export function formatAddressPrimaryLabel(result: NominatimAddress) {
  const houseNumber = normalizeText(result.address.house_number)
  const road = normalizeText(result.address.road)
  if (houseNumber && road) return `${houseNumber} ${road}`
  if (road) return road
  return result.displayName.split(',')[0]?.trim() || result.displayName
}

export function formatAddressSecondaryLabel(result: NominatimAddress) {
  const locality = normalizeText(result.address.city) || normalizeText(result.address.town) || normalizeText(result.address.village) || normalizeText(result.address.hamlet)
  const province = normalizeText(result.address.state)
  const postcode = normalizeText(result.address.postcode)
  const pieces = [locality, province, postcode].filter(Boolean)
  if (pieces.length) return pieces.join(' • ')
  return result.displayName
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
  const inline = formatAddressQueryInline(address) || formatCanadianAddressInline(address)
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

export function isUsableAddressQuery(value: string | null | undefined) {
  return normalizeText(value).length >= MIN_ADDRESS_QUERY_LENGTH
}