const STORAGE_PREFIX = 'cc:homePostal:'
export const GEOLOCATION_POSTAL_SENTINEL = '__GEOLOCATION__'
const GEOLOCATION_POSTAL_SENTINEL_NORMALIZED = GEOLOCATION_POSTAL_SENTINEL.replace(/[^A-Z0-9]/g, '').toUpperCase()

function normalizePostal(value: string | null | undefined) {
  if (!value) return ''
  return value.replace(/[^A-Z0-9]/g, '').toUpperCase()
}

function isGeolocationSentinel(value: string | null | undefined) {
  if (!value) return false
  if (value === GEOLOCATION_POSTAL_SENTINEL) return true
  return normalizePostal(value) === GEOLOCATION_POSTAL_SENTINEL_NORMALIZED
}

export function isGeolocationPostalSentinel(value: string | null | undefined) {
  return isGeolocationSentinel(value)
}

function getStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function buildKey(userId?: string | null) {
  if (!userId) return null
  return `${STORAGE_PREFIX}${userId}`
}

export function readStoredPostalCode(userId?: string | null): string | null {
  const storage = getStorage()
  if (!storage) return null
  const key = buildKey(userId)
  if (!key) return null
  const raw = storage.getItem(key)
  if (!raw) return null
  return raw
}

export function writeStoredPostalCode(userId: string | null | undefined, postalCode: string | null | undefined) {
  const storage = getStorage()
  if (!storage) return
  const key = buildKey(userId)
  if (!key) return
  if (!postalCode) {
    storage.removeItem(key)
    return
  }
  if (isGeolocationSentinel(postalCode)) {
    storage.setItem(key, GEOLOCATION_POSTAL_SENTINEL)
    return
  }
  const normalized = normalizePostal(postalCode)
  if (!normalized) {
    storage.removeItem(key)
    return
  }
  storage.setItem(key, normalized)
}

export function hasStoredPostalCode(userId?: string | null): boolean {
  return Boolean(readStoredPostalCode(userId))
}

export function formatStoredPostalCode(value?: string | null): string {
  if (!value) return ''
  if (isGeolocationSentinel(value)) {
    return 'Detected automatically'
  }
  const normalized = normalizePostal(value)
  if (normalized.length === 6) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`
  }
  return normalized
}

export function clearStoredPostalCode(userId?: string | null) {
  const storage = getStorage()
  if (!storage) return
  const key = buildKey(userId)
  if (!key) return
  storage.removeItem(key)
}
