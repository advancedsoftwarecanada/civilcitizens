'use client'

type NavigatorWithStandalone = Navigator & { standalone?: boolean }
type CapacitorBridge = { getPlatform?: () => string }

export type CivilLocationPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported'
export type CivilLocationErrorCode =
  | 'not_supported'
  | 'not_granted'
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout'
  | 'throttled'

export type CivilLocation = {
  latitude: number
  longitude: number
  accuracy: number | null
  heading: number | null
  timestamp: number
}

export type CivilLocationResult = {
  ok: boolean
  state: CivilLocationPermissionState
  location: CivilLocation | null
  fromCache: boolean
  errorCode?: CivilLocationErrorCode
  errorMessage?: string
}

type LocationRequestOptions = {
  reason?: string
  userInitiated?: boolean
  highAccuracy?: boolean
  timeoutMs?: number
  maximumAgeMs?: number
  minIntervalMs?: number
}

type LocationWatchOptions = {
  reason?: string
  userInitiated?: boolean
  highAccuracy?: boolean
  timeoutMs?: number
  maximumAgeMs?: number
  onLocation: (location: CivilLocation) => void
  onError?: (result: CivilLocationResult) => void
}

type WatchSubscriber = {
  onLocation: (location: CivilLocation) => void
  onError?: (result: CivilLocationResult) => void
}

const LOCATION_PERMISSION_STORAGE_KEY = 'cc:location-permission-decision:v1'
const LOCATION_CACHE_STORAGE_KEY = 'cc:last-known-location:v1'
const DEFAULT_MIN_INTERVAL_MS = 7_500
const DEFAULT_MAXIMUM_AGE_MS = 60_000
const STORED_LOCATION_REUSE_MAX_AGE_MS = 15 * 60_000

let cachedLocation: CivilLocation | null = null
let pendingLocationRequest: Promise<CivilLocationResult> | null = null
let lastLocationFetchAt = 0
let activeWatchId: number | null = null
const watchSubscribers = new Set<WatchSubscriber>()
let hydratedStoredLocation = false

function logLocation(event: string, details: Record<string, unknown> = {}) {
  console.info(`[location] ${event}`, details)
}

function roundCoordinate(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(5)) : value
}

function getCapacitorPlatform(): string | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  if (!bridge || typeof bridge.getPlatform !== 'function') return null
  try {
    return bridge.getPlatform() ?? null
  } catch {
    return null
  }
}

function isAppleMobileOrTablet() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const touchPoints = navigator.maxTouchPoints || 0
  return /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
}

function isInstalledStandaloneDisplayMode() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const navStandalone = Boolean((navigator as NavigatorWithStandalone).standalone)
  const standaloneDisplay = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  const fullscreenDisplay = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: fullscreen)').matches
  return navStandalone || standaloneDisplay || fullscreenDisplay
}

export function isIosPwaLocationContext() {
  return isAppleMobileOrTablet() && getCapacitorPlatform() !== 'ios' && isInstalledStandaloneDisplayMode()
}

export function isLocationSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

function readStoredPermissionDecision(): Extract<CivilLocationPermissionState, 'granted' | 'denied'> | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(LOCATION_PERMISSION_STORAGE_KEY)
    if (value === 'granted' || value === 'denied') return value
  } catch {
    // ignore storage read failures
  }
  return null
}

function writeStoredPermissionDecision(state: Extract<CivilLocationPermissionState, 'granted' | 'denied'>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCATION_PERMISSION_STORAGE_KEY, state)
  } catch {
    // ignore storage write failures
  }
}

function readStoredLocation(): CivilLocation | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCATION_CACHE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CivilLocation> | null
    if (!parsed) return null
    if (
      typeof parsed.latitude !== 'number' ||
      !Number.isFinite(parsed.latitude) ||
      typeof parsed.longitude !== 'number' ||
      !Number.isFinite(parsed.longitude) ||
      typeof parsed.timestamp !== 'number' ||
      !Number.isFinite(parsed.timestamp)
    ) {
      return null
    }

    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracy: typeof parsed.accuracy === 'number' && Number.isFinite(parsed.accuracy) ? parsed.accuracy : null,
      heading: typeof parsed.heading === 'number' && Number.isFinite(parsed.heading) ? parsed.heading : null,
      timestamp: parsed.timestamp,
    }
  } catch {
    return null
  }
}

function writeStoredLocation(location: CivilLocation) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCATION_CACHE_STORAGE_KEY, JSON.stringify(location))
  } catch {
    // ignore storage write failures
  }
}

function clearStoredLocation() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LOCATION_CACHE_STORAGE_KEY)
  } catch {
    // ignore storage write failures
  }
}

function ensureHydratedStoredLocation() {
  if (hydratedStoredLocation) return
  hydratedStoredLocation = true
  const storedLocation = readStoredLocation()
  if (!storedLocation) return
  cachedLocation = storedLocation
  lastLocationFetchAt = storedLocation.timestamp
  logLocation('cache_hydrated', {
    latitude: roundCoordinate(storedLocation.latitude),
    longitude: roundCoordinate(storedLocation.longitude),
    ageMs: Date.now() - storedLocation.timestamp,
  })
}

function mapErrorMessage(code: CivilLocationErrorCode) {
  switch (code) {
    case 'permission_denied':
      return 'Location permission was denied. Enable it in your device settings to keep live GPS features working.'
    case 'timeout':
      return 'Location lookup timed out. Try again from a spot with better reception.'
    case 'position_unavailable':
      return 'Current location is unavailable on this device right now.'
    case 'throttled':
      return 'Location was requested too recently. Reusing the last known location.'
    case 'not_granted':
      return 'Location access has not been enabled yet.'
    default:
      return 'Location services are not available on this device.'
  }
}

function buildResult(args: {
  ok: boolean
  state: CivilLocationPermissionState
  location?: CivilLocation | null
  fromCache?: boolean
  errorCode?: CivilLocationErrorCode
  errorMessage?: string
}): CivilLocationResult {
  return {
    ok: args.ok,
    state: args.state,
    location: args.location ?? null,
    fromCache: Boolean(args.fromCache),
    ...(args.errorCode ? { errorCode: args.errorCode } : {}),
    ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
  }
}

function setCachedLocation(location: CivilLocation, reason?: string) {
  cachedLocation = location
  lastLocationFetchAt = Date.now()
  writeStoredPermissionDecision('granted')
  writeStoredLocation(location)
  logLocation('position_fetched', {
    reason,
    latitude: roundCoordinate(location.latitude),
    longitude: roundCoordinate(location.longitude),
    accuracy: location.accuracy,
    heading: location.heading,
    source: activeWatchId !== null ? 'watch' : 'request',
  })
}

function mapGeolocationError(
  error: GeolocationPositionError | null | undefined,
  state: CivilLocationPermissionState,
): CivilLocationResult {
  const code = error?.code
  if (code === 1) {
    writeStoredPermissionDecision('denied')
    clearStoredLocation()
    return buildResult({
      ok: false,
      state: 'denied',
      errorCode: 'permission_denied',
      errorMessage: mapErrorMessage('permission_denied'),
    })
  }
  if (code === 3) {
    return buildResult({
      ok: false,
      state,
      errorCode: 'timeout',
      errorMessage: mapErrorMessage('timeout'),
    })
  }
  return buildResult({
    ok: false,
    state,
    errorCode: 'position_unavailable',
    errorMessage: mapErrorMessage('position_unavailable'),
  })
}

async function queryPermissionState(reason?: string): Promise<CivilLocationPermissionState | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return null
  }

  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    if (status.state === 'granted' || status.state === 'denied') {
      writeStoredPermissionDecision(status.state)
    }
    logLocation('permission_state', { reason, state: status.state, source: 'permissions-api' })
    return status.state
  } catch (error) {
    logLocation('permission_state_unavailable', {
      reason,
      message: error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

export async function getLocationPermissionState(reason?: string): Promise<CivilLocationPermissionState> {
  ensureHydratedStoredLocation()
  if (!isLocationSupported()) {
    logLocation('permission_state', { reason, state: 'unsupported' })
    return 'unsupported'
  }

  const queried = await queryPermissionState(reason)
  const storedDecision = readStoredPermissionDecision() ?? (cachedLocation ? 'granted' : null)

  if (queried === 'granted' || queried === 'denied') return queried
  if (queried === 'prompt' && storedDecision === 'granted') {
    logLocation('permission_state', { reason, state: 'granted', source: 'stored-granted-override' })
    return 'granted'
  }
  if (queried === 'prompt') return queried

  const fallbackState = storedDecision ?? 'prompt'
  logLocation('permission_state', { reason, state: fallbackState, source: storedDecision ? 'local-storage' : 'fallback' })
  return fallbackState
}

function shouldUseCachedLocation(maximumAgeMs: number, minIntervalMs: number) {
  if (!cachedLocation) return false
  const ageMs = Date.now() - cachedLocation.timestamp
  if (ageMs <= maximumAgeMs) return true
  return Date.now() - lastLocationFetchAt <= minIntervalMs
}

function readBrowserLocation(options: Required<Pick<LocationRequestOptions, 'highAccuracy' | 'timeoutMs' | 'maximumAgeMs'>> & { reason?: string }) {
  return new Promise<CivilLocationResult>((resolve) => {
    if (!navigator.geolocation) {
      resolve(
        buildResult({
          ok: false,
          state: 'unsupported',
          errorCode: 'not_supported',
          errorMessage: mapErrorMessage('not_supported'),
        }),
      )
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation: CivilLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          heading: typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          timestamp: typeof position.timestamp === 'number' && Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
        }
        setCachedLocation(nextLocation, options.reason)
        resolve(
          buildResult({
            ok: true,
            state: 'granted',
            location: nextLocation,
          }),
        )
      },
      (error) => {
        const permissionState = readStoredPermissionDecision() ?? 'prompt'
        const result = mapGeolocationError(error, permissionState)
        logLocation('request_failed', {
          reason: options.reason,
          state: result.state,
          errorCode: result.errorCode,
          message: result.errorMessage,
        })
        resolve(result)
      },
      {
        enableHighAccuracy: options.highAccuracy,
        timeout: options.timeoutMs,
        maximumAge: options.maximumAgeMs,
      },
    )
  })
}

export function getCachedLocation() {
  ensureHydratedStoredLocation()
  return cachedLocation
}

export async function getCurrentLocation(options: LocationRequestOptions = {}): Promise<CivilLocationResult> {
  ensureHydratedStoredLocation()
  const reason = options.reason ?? 'unspecified'
  const maximumAgeMs = options.maximumAgeMs ?? DEFAULT_MAXIMUM_AGE_MS
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const permissionState = await getLocationPermissionState(reason)

  if (shouldUseCachedLocation(maximumAgeMs, minIntervalMs) && cachedLocation) {
    logLocation('cache_hit', {
      reason,
      ageMs: Date.now() - cachedLocation.timestamp,
      userInitiated: Boolean(options.userInitiated),
    })
    return buildResult({
      ok: true,
      state: permissionState === 'unsupported' ? 'unsupported' : 'granted',
      location: cachedLocation,
      fromCache: true,
    })
  }

  if (!options.userInitiated && permissionState === 'granted' && cachedLocation) {
    const ageMs = Date.now() - cachedLocation.timestamp
    if (ageMs <= STORED_LOCATION_REUSE_MAX_AGE_MS) {
      logLocation('cache_reused_after_reload', {
        reason,
        ageMs,
        latitude: roundCoordinate(cachedLocation.latitude),
        longitude: roundCoordinate(cachedLocation.longitude),
      })
      return buildResult({
        ok: true,
        state: 'granted',
        location: cachedLocation,
        fromCache: true,
      })
    }
  }

  if (permissionState === 'unsupported') {
    return buildResult({
      ok: false,
      state: 'unsupported',
      errorCode: 'not_supported',
      errorMessage: mapErrorMessage('not_supported'),
    })
  }

  if (!options.userInitiated && permissionState !== 'granted') {
    logLocation('request_skipped', {
      reason,
      userInitiated: false,
      state: permissionState,
      iosPwa: isIosPwaLocationContext(),
    })
    return buildResult({
      ok: false,
      state: permissionState,
      errorCode: 'not_granted',
      errorMessage: mapErrorMessage('not_granted'),
    })
  }

  if (pendingLocationRequest) {
    logLocation('request_joined', { reason, userInitiated: Boolean(options.userInitiated) })
    return pendingLocationRequest
  }

  const sinceLastFetchMs = Date.now() - lastLocationFetchAt
  if (sinceLastFetchMs < minIntervalMs && cachedLocation) {
    logLocation('request_throttled', { reason, sinceLastFetchMs, minIntervalMs })
    return buildResult({
      ok: true,
      state: 'granted',
      location: cachedLocation,
      fromCache: true,
      errorCode: 'throttled',
      errorMessage: mapErrorMessage('throttled'),
    })
  }

  if (options.userInitiated && permissionState !== 'granted') {
    logLocation('permission_requested', {
      reason,
      state: permissionState,
      iosPwa: isIosPwaLocationContext(),
    })
  }

  logLocation('request_started', {
    reason,
    userInitiated: Boolean(options.userInitiated),
    highAccuracy: options.highAccuracy ?? true,
    timeoutMs: options.timeoutMs ?? 10_000,
    maximumAgeMs,
  })

  pendingLocationRequest = readBrowserLocation({
    reason,
    highAccuracy: options.highAccuracy ?? true,
    timeoutMs: options.timeoutMs ?? 10_000,
    maximumAgeMs,
  }).finally(() => {
    pendingLocationRequest = null
  })

  return pendingLocationRequest
}

export async function requestLocationPermission(options: Omit<LocationRequestOptions, 'userInitiated'> = {}) {
  return getCurrentLocation({
    ...options,
    userInitiated: true,
    maximumAgeMs: options.maximumAgeMs ?? DEFAULT_MAXIMUM_AGE_MS,
  })
}

function ensureBrowserWatch(options: { reason?: string; highAccuracy: boolean; timeoutMs: number; maximumAgeMs: number }) {
  if (!navigator.geolocation || activeWatchId !== null) return

  logLocation('watch_started', {
    reason: options.reason,
    highAccuracy: options.highAccuracy,
    timeoutMs: options.timeoutMs,
    maximumAgeMs: options.maximumAgeMs,
  })

  activeWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const nextLocation: CivilLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        heading: typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        timestamp: typeof position.timestamp === 'number' && Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
      }
      setCachedLocation(nextLocation, options.reason)
      for (const subscriber of watchSubscribers) {
        subscriber.onLocation(nextLocation)
      }
    },
    (error) => {
      const result = mapGeolocationError(error, readStoredPermissionDecision() ?? 'prompt')
      logLocation('watch_failed', {
        reason: options.reason,
        state: result.state,
        errorCode: result.errorCode,
        message: result.errorMessage,
      })
      for (const subscriber of watchSubscribers) {
        subscriber.onError?.(result)
      }
    },
    {
      enableHighAccuracy: options.highAccuracy,
      timeout: options.timeoutMs,
      maximumAge: options.maximumAgeMs,
    },
  )
}

function stopBrowserWatchIfIdle() {
  if (activeWatchId === null || watchSubscribers.size > 0 || !navigator.geolocation) return
  navigator.geolocation.clearWatch(activeWatchId)
  logLocation('watch_stopped')
  activeWatchId = null
}

export async function startLocationWatch(options: LocationWatchOptions): Promise<() => void> {
  const permissionResult = options.userInitiated
    ? await requestLocationPermission({
        reason: options.reason,
        highAccuracy: options.highAccuracy,
        timeoutMs: options.timeoutMs,
        maximumAgeMs: options.maximumAgeMs,
      })
    : await getCurrentLocation({
        reason: options.reason,
        userInitiated: false,
        highAccuracy: options.highAccuracy,
        timeoutMs: options.timeoutMs,
        maximumAgeMs: options.maximumAgeMs,
      })

  if (!permissionResult.ok || !permissionResult.location) {
    options.onError?.(permissionResult)
    return () => {}
  }

  options.onLocation(permissionResult.location)

  const subscriber: WatchSubscriber = {
    onLocation: options.onLocation,
    onError: options.onError,
  }
  watchSubscribers.add(subscriber)

  ensureBrowserWatch({
    reason: options.reason,
    highAccuracy: options.highAccuracy ?? true,
    timeoutMs: options.timeoutMs ?? 10_000,
    maximumAgeMs: options.maximumAgeMs ?? 2_000,
  })

  return () => {
    watchSubscribers.delete(subscriber)
    stopBrowserWatchIfIdle()
  }
}
