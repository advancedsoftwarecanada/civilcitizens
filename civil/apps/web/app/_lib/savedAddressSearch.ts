import { calculateDistanceKm } from './addressSearch'
import { isCanadianAddressPostalVerified, type SavedShippingAddress } from './canadianAddresses'

export type SavedAddressSearchAnchor = {
  latitude: number
  longitude: number
}

export type SavedAddressSearchResult = {
  address: SavedShippingAddress
  distanceKm: number | null
  score: number
  isHome: boolean
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSearchText(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactSearchText(value: string) {
  return value.replace(/\s+/g, '')
}

function tokenizeSearchText(value: string) {
  return value.split(' ').map((token) => token.trim()).filter(Boolean)
}

function hasCoordinates(address: SavedShippingAddress) {
  return typeof address.latitude === 'number' && Number.isFinite(address.latitude) && typeof address.longitude === 'number' && Number.isFinite(address.longitude)
}

function scoreTextField(value: string, query: string, weights: { exact: number; startsWith: number; includes: number }) {
  if (!value || !query) return 0
  if (value === query) return weights.exact
  if (value.startsWith(query)) return weights.startsWith
  if (value.includes(query)) return weights.includes
  return 0
}

function compareNullableDistance(left: number | null, right: number | null) {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

export function isHomeSavedShippingAddress(address: SavedShippingAddress | null | undefined) {
  if (!address) return false
  const combinedLabel = normalizeSearchText(`${normalizeText(address.label)} ${normalizeText(address.name)}`)
  return address.isDefault || tokenizeSearchText(combinedLabel).includes('home')
}

export function formatSavedShippingAddressTitle(address: SavedShippingAddress | null | undefined, fallback = 'Saved address') {
  return normalizeText(address?.label) || normalizeText(address?.name) || normalizeText(address?.line1) || fallback
}

export function formatSavedShippingAddressDetail(address: SavedShippingAddress | null | undefined, options?: { includeName?: boolean }) {
  if (!address) return ''
  const includeName = options?.includeName ?? true
  const lines = [includeName ? normalizeText(address.name) : '', normalizeText(address.line1), normalizeText(address.line2)].filter(Boolean)
  const locality = [
    normalizeText(address.city),
    normalizeText(address.province),
    isCanadianAddressPostalVerified(address) ? normalizeText(address.postalCode) : '',
  ]
    .filter(Boolean)
    .join(', ')
  if (locality) lines.push(locality)
  return lines.join(', ')
}

export function searchSavedShippingAddresses(
  addresses: SavedShippingAddress[],
  query: string,
  options?: { anchor?: SavedAddressSearchAnchor | null; limit?: number },
) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return [] as SavedAddressSearchResult[]

  const normalizedQueryCompact = compactSearchText(normalizedQuery)
  const queryTokens = tokenizeSearchText(normalizedQuery)
  const limit = typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 4

  return addresses
    .map((address) => {
      const isHome = isHomeSavedShippingAddress(address)
      const title = normalizeSearchText(formatSavedShippingAddressTitle(address))
      const label = normalizeSearchText(address.label)
      const name = normalizeSearchText(address.name)
      const line1 = normalizeSearchText(address.line1)
      const city = normalizeSearchText(address.city)
      const province = normalizeSearchText(address.province)
      const postalCode = normalizeSearchText(address.postalCode)
      const detail = normalizeSearchText(formatSavedShippingAddressDetail(address, { includeName: false }))
      const haystack = [title, label, name, line1, city, province, postalCode, detail].filter(Boolean).join(' ')
      const haystackCompact = compactSearchText(haystack)
      const tokenHits = queryTokens.filter((token) => haystack.includes(token)).length

      let score = 0
      score += scoreTextField(title, normalizedQuery, { exact: 2200, startsWith: 1600, includes: 1100 })
      score += scoreTextField(label, normalizedQuery, { exact: 2000, startsWith: 1500, includes: 1000 })
      score += scoreTextField(name, normalizedQuery, { exact: 1800, startsWith: 1300, includes: 900 })
      score += scoreTextField(line1, normalizedQuery, { exact: 1500, startsWith: 1000, includes: 760 })
      score += scoreTextField(detail, normalizedQuery, { exact: 900, startsWith: 640, includes: 420 })
      score += scoreTextField(city, normalizedQuery, { exact: 520, startsWith: 300, includes: 180 })
      score += scoreTextField(province, normalizedQuery, { exact: 420, startsWith: 220, includes: 120 })

      if (normalizedQueryCompact && haystackCompact.includes(normalizedQueryCompact)) {
        score += 220
      }

      if (tokenHits === queryTokens.length && queryTokens.length > 0) {
        score += 240
      } else if (tokenHits > 0) {
        score += tokenHits * 90
      }

      if (queryTokens.includes('home') && isHome) {
        score += 1600
      } else if (isHome) {
        score += 40
      }

      if (address.isDefault) {
        score += 30
      }

      if (score <= 0) return null

      const distanceKm = options?.anchor && hasCoordinates(address)
        ? calculateDistanceKm(options.anchor, {
            latitude: address.latitude as number,
            longitude: address.longitude as number,
          })
        : null

      return {
        address,
        distanceKm,
        score,
        isHome,
      } satisfies SavedAddressSearchResult
    })
    .filter((entry): entry is SavedAddressSearchResult => Boolean(entry))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      const distanceComparison = compareNullableDistance(left.distanceKm, right.distanceKm)
      if (distanceComparison !== 0) return distanceComparison
      if (left.isHome !== right.isHome) return Number(right.isHome) - Number(left.isHome)
      return formatSavedShippingAddressTitle(left.address).localeCompare(formatSavedShippingAddressTitle(right.address))
    })
    .slice(0, limit)
}
