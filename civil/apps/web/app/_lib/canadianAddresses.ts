export type CanadianAddress = {
  name?: string | null
  label?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  province?: string | null
  postalCode?: string | null
  originalPostalCode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  nominatimDisplayName?: string | null
  nominatimRaw?: unknown
}

export type SavedShippingAddress = CanadianAddress & {
  id: string
  isDefault: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export const MARKET_SHIPPING_ADDRESS_KEY = 'civil_market_shipping_address'

export const CANADIAN_PROVINCE_OPTIONS = [
  { code: 'AB', label: 'Alberta' },
  { code: 'BC', label: 'British Columbia' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'NB', label: 'New Brunswick' },
  { code: 'NL', label: 'Newfoundland and Labrador' },
  { code: 'NS', label: 'Nova Scotia' },
  { code: 'NT', label: 'Northwest Territories' },
  { code: 'NU', label: 'Nunavut' },
  { code: 'ON', label: 'Ontario' },
  { code: 'PE', label: 'Prince Edward Island' },
  { code: 'QC', label: 'Quebec' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'YT', label: 'Yukon' },
] as const

type CanadianProvinceCode = (typeof CANADIAN_PROVINCE_OPTIONS)[number]['code']

const PROVINCE_CODE_SET = new Set<CanadianProvinceCode>(CANADIAN_PROVINCE_OPTIONS.map((option) => option.code))

function isCanadianProvinceCode(value: string): value is CanadianProvinceCode {
  return PROVINCE_CODE_SET.has(value as CanadianProvinceCode)
}

export function createEmptyCanadianAddress(): CanadianAddress {
  return {
    name: '',
    label: '',
    line1: '',
    line2: '',
    city: '',
    province: '',
    postalCode: '',
    originalPostalCode: '',
    country: 'CA',
    latitude: null,
    longitude: null,
    nominatimDisplayName: '',
    nominatimRaw: null,
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shouldDisplayCountry(value: string | null | undefined) {
  const normalized = normalizeText(value).toUpperCase()
  return Boolean(normalized) && normalized !== 'CA' && normalized !== 'CANADA'
}

function readNominatimRawRecord(address: CanadianAddress | null | undefined): Record<string, unknown> | null {
  if (!address?.nominatimRaw || typeof address.nominatimRaw !== 'object' || Array.isArray(address.nominatimRaw)) return null
  return address.nominatimRaw as Record<string, unknown>
}

function normalizeCoordinate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function normalizeCanadianPostalCode(value?: string | null): string {
  const compact = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
  if (compact.length <= 3) return compact
  return `${compact.slice(0, 3)} ${compact.slice(3)}`
}

export function normalizeCanadianProvince(value?: string | null): string {
  const upper = String(value ?? '')
    .trim()
    .toUpperCase()
  if (isCanadianProvinceCode(upper)) return upper
  const match = CANADIAN_PROVINCE_OPTIONS.find((option) => option.label.toUpperCase() === upper)
  return match?.code ?? upper
}

export function normalizeCanadianAddress(value: unknown): CanadianAddress {
  if (!value || typeof value !== 'object') return createEmptyCanadianAddress()
  const record = value as Record<string, unknown>
  return {
    name: normalizeText(record.name),
    label: normalizeText(record.label),
    line1: normalizeText(record.line1),
    line2: normalizeText(record.line2),
    city: normalizeText(record.city),
    province: normalizeCanadianProvince(normalizeText(record.province)),
    postalCode: normalizeCanadianPostalCode(normalizeText(record.postalCode)),
    originalPostalCode: normalizeCanadianPostalCode(normalizeText(record.originalPostalCode)),
    country: normalizeText(record.country || 'CA').toUpperCase() || 'CA',
    latitude: normalizeCoordinate(record.latitude),
    longitude: normalizeCoordinate(record.longitude),
    nominatimDisplayName: normalizeText(record.nominatimDisplayName),
    nominatimRaw: record.nominatimRaw ?? null,
  }
}

export function getCanadianAddressSystemDisplayName(address: CanadianAddress | null | undefined): string | null {
  const normalized = normalizeCanadianAddress(address)
  if (normalized.nominatimDisplayName) return normalized.nominatimDisplayName
  const raw = readNominatimRawRecord(normalized)
  const fallback = normalizeText(raw?.display_name)
  return fallback || null
}

export function isCanadianAddressPostalVerified(address: CanadianAddress | null | undefined): boolean {
  if (!address) return false
  const normalized = normalizeCanadianAddress(address)
  if (!normalized.postalCode || !normalized.originalPostalCode) return false
  return normalized.postalCode !== normalized.originalPostalCode
}

export function normalizeSavedShippingAddress(value: unknown): SavedShippingAddress | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = normalizeText(record.id)
  if (!id) return null
  const address = normalizeCanadianAddress(record)
  return {
    ...address,
    id,
    isDefault: Boolean(record.isDefault),
    createdAt: normalizeText(record.createdAt) || null,
    updatedAt: normalizeText(record.updatedAt) || null,
  }
}

export function hasCanadianAddressValue(address: CanadianAddress | null | undefined): boolean {
  if (!address) return false
  return Boolean(
    normalizeText(address.name) ||
      normalizeText(address.label) ||
      normalizeText(address.line1) ||
      normalizeText(address.line2) ||
      normalizeText(address.city) ||
      normalizeText(address.province) ||
      normalizeText(address.postalCode) ||
      normalizeText(address.country) ||
      Number.isFinite(address.latitude) ||
      Number.isFinite(address.longitude),
  )
}

export function formatCanadianAddressLines(address: CanadianAddress | null | undefined): string[] {
  if (!address) return []
  const normalized = normalizeCanadianAddress(address)
  const lines: string[] = []
  const postalCode = isCanadianAddressPostalVerified(normalized) ? normalized.postalCode : ''
  if (normalized.label) lines.push(normalized.label)
  if (normalized.name) lines.push(normalized.name)
  if (normalized.line1) lines.push(normalized.line1)
  if (normalized.line2) lines.push(normalized.line2)
  const cityLine = [normalized.city, normalized.province, postalCode].filter(Boolean).join(', ')
  if (cityLine) lines.push(cityLine)
  if (shouldDisplayCountry(normalized.country)) lines.push(normalized.country as string)
  return lines
}

export function formatCanadianPhysicalAddressLines(address: CanadianAddress | null | undefined): string[] {
  if (!address) return []
  const normalized = normalizeCanadianAddress(address)
  const lines: string[] = []
  const postalCode = isCanadianAddressPostalVerified(normalized) ? normalized.postalCode : ''
  if (normalized.line1) lines.push(normalized.line1)
  if (normalized.line2) lines.push(normalized.line2)
  const cityLine = [normalized.city, normalized.province, postalCode].filter(Boolean).join(', ')
  if (cityLine) lines.push(cityLine)
  if (shouldDisplayCountry(normalized.country)) lines.push(normalized.country as string)
  return lines
}

export function formatCanadianAddressInline(address: CanadianAddress | null | undefined): string | null {
  const lines = formatCanadianAddressLines(address)
  return lines.length ? lines.join(', ') : null
}

export function formatCanadianPhysicalAddressInline(address: CanadianAddress | null | undefined): string | null {
  const lines = formatCanadianPhysicalAddressLines(address)
  return lines.length ? lines.join(', ') : null
}

export function addressToCheckoutShipping(address: CanadianAddress | null | undefined) {
  const normalized = normalizeCanadianAddress(address)
  return {
    name: normalized.name || undefined,
    line1: normalized.line1 || undefined,
    line2: normalized.line2 || undefined,
    city: normalized.city || undefined,
    province: normalized.province || undefined,
    postalCode: normalized.postalCode || undefined,
    country: normalized.country || 'CA',
    latitude: normalized.latitude ?? undefined,
    longitude: normalized.longitude ?? undefined,
  }
}

export function readStoredMarketShippingAddress(): CanadianAddress | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(MARKET_SHIPPING_ADDRESS_KEY)
    if (!raw) return null
    return normalizeCanadianAddress(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function writeStoredMarketShippingAddress(address: CanadianAddress | null | undefined) {
  if (typeof window === 'undefined') return
  if (!address || !hasCanadianAddressValue(address)) {
    window.localStorage.removeItem(MARKET_SHIPPING_ADDRESS_KEY)
    return
  }
  window.localStorage.setItem(MARKET_SHIPPING_ADDRESS_KEY, JSON.stringify(normalizeCanadianAddress(address)))
}