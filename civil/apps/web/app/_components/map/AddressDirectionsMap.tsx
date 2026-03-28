'use client'

import type { IconType } from 'react-icons'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  HiOutlineArrowLongDown,
  HiOutlineArrowLongLeft,
  HiOutlineArrowLongRight,
  HiOutlineArrowLongUp,
  HiOutlineArrowPath,
  HiOutlineArrowUturnLeft,
  HiOutlineChartBar,
  HiOutlineClock,
  HiOutlineFlag,
  HiOutlineMapPin,
  HiOutlineXMark,
} from 'react-icons/hi2'
import { calculateDistanceKm, fetchDrivingRoute, type DrivingRoute, type DrivingRouteStep } from '../../_lib/addressSearch'
import { isLocationSupported, startLocationWatch } from '../../_lib/locationService'
import { createNavigationEngine, type NavigationEngineSnapshot } from '../../_lib/navigationEngine'
import { useViewerStore } from '../../_lib/viewerStore'

type MapPoint = {
  latitude: number
  longitude: number
  label: string
  kind?: 'pickup' | 'waypoint'
}

type AddressDirectionsMapProps = {
  destination: MapPoint | null
  origin?: MapPoint | null
  routeCoordinates?: Array<[number, number]> | null
  approachRouteCoordinates?: Array<[number, number]> | null
  riderRouteCoordinates?: Array<[number, number]> | null
  waypoints?: MapPoint[] | null
  showOriginAvatar?: boolean
  originAvatarUrl?: string | null
  originAvatarLabel?: string | null
  originAvatarFallbackLabel?: string | null
  avatarMarkers?: Array<{
    id: string
    point: MapPoint
    avatarUrl?: string | null
    label: string
    fallbackLabel: string
  }> | null
  pulseRouteLine?: boolean
  pulseApproachRoute?: boolean
  idleCameraMode?: 'always-fit' | 'fit-once-per-key'
  idleViewportKey?: string | null
  fullscreenOverlay?: ReactNode
  fullscreenModalOverlay?: ReactNode
  onNavigationOriginChange?: ((origin: MapPoint | null) => void) | undefined
}

export type AddressDirectionsMapHandle = {
  startNavigation: () => Promise<void>
}

type WakeLockSentinelLike = {
  released?: boolean
  release: () => Promise<void>
}

const ADDRESS_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
} as const

const ARRIVAL_DISTANCE_METERS = 40
const ROUTE_REFRESH_DISTANCE_METERS = 32
const ROUTE_REFRESH_MIN_INTERVAL_MS = 9000
const IDLE_ZOOM_WITH_ORIGIN = 14
const ACTIVE_NAV_ZOOM = 19.4
const ACTIVE_NAV_PITCH = 58
const ACTIVE_NAV_FOLLOW_DURATION_MS = 220
const LIVE_MARKER_ANIMATION_MS = 900
const ACTIVE_NAV_MARKER_ANIMATION_MS = 180
const ROUTE_LINE_PULSE_DURATION_MS = 2200
const ROUTE_LINE_BASE_RGB = { red: 37, green: 99, blue: 235 }
const ROUTE_LINE_PULSE_RGB = { red: 96, green: 165, blue: 250 }
const ROUTE_LINE_STATIC_COLOR = '#2563eb'
const ROUTE_LINE_WIDTH = 7
const RIDER_ROUTE_LINE_WIDTH = 5
const RIDER_ROUTE_LINE_COLOR = '#10b981'
const APPROACH_ROUTE_LINE_WIDTH = 6
const APPROACH_ROUTE_LINE_COLOR = '#f59e0b'
const AVATAR_OVERLAP_THRESHOLD_METERS = 20
const AVATAR_OVERLAP_SPACING_METERS = 18
const ACTIVE_NAV_CAMERA_PADDING = { top: 132, right: 40, bottom: 196, left: 40 } as const

function normalizeHeading(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function interpolateChannel(start: number, end: number, progress: number) {
  return Math.round(start + (end - start) * progress)
}

function resolveRouteLineColor(progress: number) {
  const red = interpolateChannel(ROUTE_LINE_BASE_RGB.red, ROUTE_LINE_PULSE_RGB.red, progress)
  const green = interpolateChannel(ROUTE_LINE_BASE_RGB.green, ROUTE_LINE_PULSE_RGB.green, progress)
  const blue = interpolateChannel(ROUTE_LINE_BASE_RGB.blue, ROUTE_LINE_PULSE_RGB.blue, progress)
  return `rgb(${red}, ${green}, ${blue})`
}

function resolveApproachRouteLineColor(progress: number) {
  const start = { red: 245, green: 158, blue: 11 }
  const end = { red: 250, green: 204, blue: 21 }
  const red = interpolateChannel(start.red, end.red, progress)
  const green = interpolateChannel(start.green, end.green, progress)
  const blue = interpolateChannel(start.blue, end.blue, progress)
  return `rgb(${red}, ${green}, ${blue})`
}

function renderLiveMarkerContents(
  element: HTMLDivElement,
  options: {
    avatarUrl: string | null
    alt: string
    fallbackLabel: string
  },
) {
  element.replaceChildren()

  if (options.avatarUrl) {
    const image = document.createElement('img')
    image.src = options.avatarUrl
    image.alt = options.alt
    image.className = 'h-full w-full object-cover'
    element.appendChild(image)
    return
  }

  const fallback = document.createElement('div')
  fallback.className = 'flex h-full w-full items-center justify-center bg-emerald-100 text-sm font-semibold text-slate-900'
  fallback.textContent = options.fallbackLabel
  element.appendChild(fallback)
}

function readHeadingFromOrientationEvent(event: Event) {
  const payload = event as DeviceOrientationEvent & { webkitCompassHeading?: number }
  if (typeof payload.webkitCompassHeading === 'number' && Number.isFinite(payload.webkitCompassHeading)) {
    return normalizeHeading(payload.webkitCompassHeading)
  }
  if (typeof payload.alpha === 'number' && Number.isFinite(payload.alpha)) {
    return normalizeHeading(360 - payload.alpha)
  }
  return null
}

function formatRemainingDistance(distanceMeters: number) {
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)} km`
  return `${Math.max(1, Math.round(distanceMeters))} m`
}

function formatRemainingDuration(durationSeconds: number) {
  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${totalMinutes} min`
}

function formatArrivalTime(durationSeconds: number) {
  const arrival = new Date(Date.now() + durationSeconds * 1000)
  return arrival.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function offsetPointByMeters(point: { latitude: number; longitude: number }, eastMeters: number, northMeters = 0) {
  const latitudeRadians = (point.latitude * Math.PI) / 180
  const metersPerDegreeLatitude = 111_320
  const metersPerDegreeLongitude = Math.max(1, Math.cos(latitudeRadians) * metersPerDegreeLatitude)

  return {
    latitude: point.latitude + northMeters / metersPerDegreeLatitude,
    longitude: point.longitude + eastMeters / metersPerDegreeLongitude,
  }
}

function blurActiveEditableElement() {
  if (typeof document === 'undefined') return
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return
  if (activeElement === document.body) return
  activeElement.blur()
}

function calculateDistanceMeters(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  return calculateDistanceKm(origin, destination) * 1000
}

function calculateTravelBearingDegrees(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
) {
  const phi1 = toRadians(latitude1)
  const phi2 = toRadians(latitude2)
  const deltaLambda = toRadians(longitude2 - longitude1)

  const y = Math.sin(deltaLambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda)
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI)
}

function offsetPointAlongBearing(point: { latitude: number; longitude: number }, bearing: number, distanceMeters: number) {
  const radians = toRadians(bearing)
  const eastMeters = Math.sin(radians) * distanceMeters
  const northMeters = Math.cos(radians) * distanceMeters
  return offsetPointByMeters(point, eastMeters, northMeters)
}

function resolveShortestMapBearing(currentBearing: number | null | undefined, targetBearing: number) {
  if (typeof currentBearing !== 'number' || !Number.isFinite(currentBearing)) return targetBearing
  return currentBearing + normalizeBearingDelta(currentBearing, targetBearing)
}

function resolveDisplayMarkerPoints(markers: Array<{ id: string; point: MapPoint }>) {
  const resolved = new Map<string, MapPoint>()
  const remaining = [...markers]

  while (remaining.length > 0) {
    const seed = remaining.shift()
    if (!seed) break

    const group = [seed]
    let changed = true

    while (changed) {
      changed = false
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index]
        if (!candidate) continue
        const isNearGroup = group.some(
          (member) => calculateDistanceMeters(member.point, candidate.point) <= AVATAR_OVERLAP_THRESHOLD_METERS,
        )
        if (!isNearGroup) continue
        group.push(candidate)
        remaining.splice(index, 1)
        changed = true
      }
    }

    if (group.length === 1) {
      resolved.set(seed.id, seed.point)
      continue
    }

    const middleIndex = (group.length - 1) / 2
    group.forEach((entry, index) => {
      const eastOffsetMeters = (index - middleIndex) * AVATAR_OVERLAP_SPACING_METERS
      const adjustedPoint = offsetPointByMeters(entry.point, eastOffsetMeters)
      resolved.set(entry.id, {
        ...entry.point,
        latitude: adjustedPoint.latitude,
        longitude: adjustedPoint.longitude,
      })
    })
  }

  return resolved
}

function pickNextStep(route: DrivingRoute | null) {
  if (!route?.steps.length) return null
  return route.steps.find((step) => step.maneuverType !== 'arrive') ?? route.steps[0] ?? null
}

function normalizeHeadingCardinalLabel(heading: number) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const normalized = normalizeHeading(heading)
  const index = Math.round(normalized / 45) % directions.length
  return directions[index] ?? 'N'
}

function normalizeBearingDelta(from: number, to: number) {
  const delta = (to - from + 540) % 360 - 180
  return delta
}

function blendBearing(from: number, to: number, factor: number) {
  return normalizeHeading(from + normalizeBearingDelta(from, to) * factor)
}

function resolveHeadingCardinalLabel(heading: number | null, routeCoordinates: Array<[number, number]> | null | undefined) {
  if (typeof heading === 'number' && Number.isFinite(heading)) {
    return normalizeHeadingCardinalLabel(heading)
  }
  if (routeCoordinates && routeCoordinates.length >= 2) {
    const start = routeCoordinates[0]
    const end = routeCoordinates[1]
    if (start && end) {
      return normalizeHeadingCardinalLabel(calculateTravelBearingDegrees(start[1], start[0], end[1], end[0]))
    }
  }
  return null
}

function summarizeTurnDirection(step: DrivingRouteStep) {
  const direction = step.direction.toLowerCase()
  if (direction.includes('left')) return 'Left'
  if (direction.includes('right')) return 'Right'
  if (direction.includes('u-turn')) return 'U-turn'
  if (step.maneuverType === 'merge') return 'Merge'
  if (step.maneuverType === 'on ramp') return 'Ramp'
  if (step.maneuverType === 'off ramp') return 'Exit'
  return 'Continue'
}

function isTurnPreviewStep(step: DrivingRouteStep) {
  if (step.maneuverType === 'arrive') return false
  return summarizeTurnDirection(step) !== 'Continue'
}

function resolveTurnUrgency(distanceMeters: number) {
  if (distanceMeters <= 80) {
    return {
      panelClassName: 'border-red-950 bg-red-600 text-white animate-pulse',
      textClassName: 'text-white',
      dividerClassName: 'border-white/70',
      labelClassName: 'text-white/85',
      iconClassName: 'text-white',
    }
  }

  if (distanceMeters <= 250) {
    return {
      panelClassName: 'border-amber-950 bg-amber-300 text-amber-950',
      textClassName: 'text-amber-950',
      dividerClassName: 'border-amber-950/60',
      labelClassName: 'text-amber-950/80',
      iconClassName: 'text-amber-950',
    }
  }

  return {
    panelClassName: 'border-emerald-950 bg-emerald-500 text-emerald-950',
    textClassName: 'text-emerald-950',
    dividerClassName: 'border-emerald-950/45',
    labelClassName: 'text-emerald-950/80',
    iconClassName: 'text-emerald-950',
  }
}

function resolveDirectionIcon(step: DrivingRouteStep | null): IconType {
  if (!step) return HiOutlineArrowLongUp

  if (step.turnModifier === 'uturn' || step.direction === 'U-turn') {
    return HiOutlineArrowUturnLeft
  }

  if (step.turnModifier?.includes('left') || step.direction.toLowerCase().includes('left')) {
    return HiOutlineArrowLongLeft
  }

  if (step.turnModifier?.includes('right') || step.direction.toLowerCase().includes('right')) {
    return HiOutlineArrowLongRight
  }

  if (step.maneuverType === 'arrive' || step.maneuverType === 'off ramp') {
    return HiOutlineArrowLongDown
  }

  return HiOutlineArrowLongUp
}

export const AddressDirectionsMap = forwardRef<AddressDirectionsMapHandle, AddressDirectionsMapProps>(function AddressDirectionsMap(
  {
    destination,
    origin,
    routeCoordinates,
    approachRouteCoordinates,
    riderRouteCoordinates,
    waypoints,
    showOriginAvatar = false,
    originAvatarUrl = null,
    originAvatarLabel = null,
    originAvatarFallbackLabel = null,
    avatarMarkers = null,
    pulseRouteLine = true,
    pulseApproachRoute = false,
    idleCameraMode = 'always-fit',
    idleViewportKey = null,
    fullscreenOverlay = null,
    fullscreenModalOverlay = null,
    onNavigationOriginChange,
  }: AddressDirectionsMapProps,
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const mapLibreRef = useRef<any>(null)
  const initialViewRef = useRef<{
    center: [number, number]
    zoom: number
  } | null>(null)
  const watchCleanupRef = useRef<(() => void) | null>(null)
  const routeAbortRef = useRef<AbortController | null>(null)
  const routeRequestAtRef = useRef<number>(0)
  const routePointRef = useRef<MapPoint | null>(null)
  const noticeTimeoutRef = useRef<number | null>(null)
  const liveMarkerRef = useRef<any>(null)
  const avatarMarkerRefs = useRef<Map<string, any>>(new Map())
  const liveMarkerAnimationRef = useRef<number | null>(null)
  const routeLinePulseAnimationRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const hasAppliedIdleFitRef = useRef(false)
  const lastIdleViewportKeyRef = useRef<string | null>(null)
  const navStatusRef = useRef<'idle' | 'starting' | 'active'>('idle')
  const routeOverviewActiveRef = useRef(false)
  const followZoomRef = useRef<number | null>(null)
  const hasAppliedFollowZoomRef = useRef(false)
  const pendingFollowResetRef = useRef(false)
  const navigationUpdateQueueRef = useRef<Promise<void>>(Promise.resolve())
  const navigationEngineRef = useRef(createNavigationEngine())
  const [mapReady, setMapReady] = useState(false)
  const [fullscreenActive, setFullscreenActive] = useState(false)
  const [navStatus, setNavStatus] = useState<'idle' | 'starting' | 'active'>('idle')
  const [navError, setNavError] = useState<string | null>(null)
  const [navigationOrigin, setNavigationOrigin] = useState<MapPoint | null>(null)
  const [navigationStartPoint, setNavigationStartPoint] = useState<MapPoint | null>(null)
  const [navigationRoute, setNavigationRoute] = useState<DrivingRoute | null>(null)
  const [initialNavigationDistanceMeters, setInitialNavigationDistanceMeters] = useState<number | null>(null)
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const [routeOverviewActive, setRouteOverviewActive] = useState(false)
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null)
  const [courseHeading, setCourseHeading] = useState<number | null>(null)
  const [navigationEngineState, setNavigationEngineState] = useState<NavigationEngineSnapshot | null>(null)
  const [confirmExitOpen, setConfirmExitOpen] = useState(false)
  const viewerAvatarUrl = useViewerStore((state) => state.me?.avatarUrl ?? null)
  const resolvedOriginAvatarUrl = originAvatarUrl ?? viewerAvatarUrl
  const resolvedOriginAvatarLabel = originAvatarLabel?.trim() || (originAvatarUrl ? 'Driver location' : 'Your location')
  const resolvedOriginAvatarFallbackLabel = originAvatarFallbackLabel?.trim() || 'You'

  if (!initialViewRef.current) {
    initialViewRef.current = {
      center: destination ? [destination.longitude, destination.latitude] : [-79.3832, 43.6532],
      zoom: destination ? (origin ? IDLE_ZOOM_WITH_ORIGIN : 13.4) : 5,
    }
  }

  useEffect(() => {
    navStatusRef.current = navStatus
  }, [navStatus])

  useEffect(() => {
    routeOverviewActiveRef.current = routeOverviewActive
  }, [routeOverviewActive])

  const navigationStep = useMemo(() => pickNextStep(navigationRoute), [navigationRoute])
  const activeOrigin = navStatus === 'active' || navStatus === 'starting' ? navigationOrigin : origin ?? null
  const startPoint = navigationStartPoint ?? (navStatus === 'idle' ? origin ?? null : null)
  const activeRouteCoordinates = (navStatus === 'active' || navStatus === 'starting') && navigationRoute?.geometry?.length
    ? navigationRoute.geometry
    : routeCoordinates ?? null
  const previewApproachRouteCoordinates = navStatus === 'idle' ? approachRouteCoordinates ?? null : null
  const activeCourseHeading = useMemo(() => {
    if (typeof courseHeading === 'number' && Number.isFinite(courseHeading)) {
      return normalizeHeading(courseHeading)
    }
    return null
  }, [courseHeading])
  const activeBearing = useMemo(() => {
    if (typeof navigationEngineState?.mapBearing === 'number' && Number.isFinite(navigationEngineState.mapBearing)) {
      return navigationEngineState.mapBearing
    }
    if (activeCourseHeading === null) return 0
    return activeCourseHeading
  }, [activeCourseHeading, navigationEngineState?.mapBearing])
  const followCameraCenter = useMemo(() => {
    if (!activeOrigin) return null
    if (typeof navigationEngineState?.correctedPoint?.latitude === 'number' && typeof navigationEngineState?.correctedPoint?.longitude === 'number') {
      return {
        latitude: navigationEngineState.correctedPoint.latitude,
        longitude: navigationEngineState.correctedPoint.longitude,
      }
    }
    return {
      latitude: activeOrigin.latitude,
      longitude: activeOrigin.longitude,
    }
  }, [activeOrigin, navigationEngineState?.correctedPoint?.latitude, navigationEngineState?.correctedPoint?.longitude])
  const headingCardinalLabel = useMemo(
    () => resolveHeadingCardinalLabel(activeCourseHeading ?? deviceHeading, activeRouteCoordinates),
    [activeCourseHeading, activeRouteCoordinates, deviceHeading],
  )
  const nextTurnPreview = useMemo(() => {
    if (!navigationRoute?.steps.length) return null

    let distanceUntilTurn = 0
    for (const step of navigationRoute.steps) {
      if (step.maneuverType === 'arrive') break
      distanceUntilTurn += step.distanceMeters
      if (isTurnPreviewStep(step)) {
        return {
          step,
          distanceMeters: distanceUntilTurn,
          label: summarizeTurnDirection(step),
        }
      }
    }

    return null
  }, [navigationRoute])
  const nextTurnIcon = useMemo(() => resolveDirectionIcon(nextTurnPreview?.step ?? null), [nextTurnPreview])
  const NextTurnIcon = nextTurnIcon
  const nextTurnUrgency = useMemo(
    () => (nextTurnPreview ? resolveTurnUrgency(nextTurnPreview.distanceMeters) : null),
    [nextTurnPreview],
  )
  const currentStreetLabel = navigationStep?.streetName || 'Current street'
  const refreshMapViewport = useCallback(() => {
    if (typeof window === 'undefined') return

    const scheduleRefresh = (delay: number) => {
      window.setTimeout(() => {
        const map = mapRef.current
        if (!map) return
        map.resize?.()
        map.triggerRepaint?.()
      }, delay)
    }

    window.requestAnimationFrame(() => {
      const map = mapRef.current
      if (!map) return
      map.resize?.()
      map.triggerRepaint?.()

      window.requestAnimationFrame(() => {
        const nextMap = mapRef.current
        if (!nextMap) return
        nextMap.resize?.()
        nextMap.triggerRepaint?.()
      })
    })

    scheduleRefresh(120)
    scheduleRefresh(320)
  }, [])

  const releaseWakeLock = useCallback(async () => {
    const wakeLock = wakeLockRef.current
    wakeLockRef.current = null
    if (!wakeLock) return

    try {
      await wakeLock.release()
    } catch {
      // ignore release errors
    }
  }, [])

  const requestWakeLock = useCallback(async () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState !== 'visible') return

    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request?: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }).wakeLock

    if (!wakeLockApi?.request) return
    if (wakeLockRef.current && !wakeLockRef.current.released) return

    try {
      wakeLockRef.current = await wakeLockApi.request('screen')
    } catch {
      wakeLockRef.current = null
    }
  }, [])

  const navigationProgressPercent = useMemo(() => {
    if (!navigationRoute) return null

    const baselineDistance = initialNavigationDistanceMeters ?? navigationRoute.distanceMeters
    if (!Number.isFinite(baselineDistance) || baselineDistance <= 0) return null

    const progress = ((baselineDistance - navigationRoute.distanceMeters) / baselineDistance) * 100
    return Math.max(0, Math.min(100, Math.round(progress)))
  }, [initialNavigationDistanceMeters, navigationRoute])

  const arrivalTimeLabel = useMemo(
    () => (navigationRoute ? formatArrivalTime(navigationRoute.durationSeconds) : null),
    [navigationRoute],
  )

  const handleViewRouteToggle = useCallback(() => {
    setRouteOverviewActive((current) => {
      if (current) {
        pendingFollowResetRef.current = true
        followZoomRef.current = ACTIVE_NAV_ZOOM
        hasAppliedFollowZoomRef.current = false
      }
      return !current
    })
  }, [])

  const clearNavigationNotice = useCallback(() => {
    if (noticeTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(noticeTimeoutRef.current)
      noticeTimeoutRef.current = null
    }
  }, [])

  const showNavigationNotice = useCallback((message: string) => {
    clearNavigationNotice()
    setNavigationNotice(message)
    if (typeof window !== 'undefined') {
      noticeTimeoutRef.current = window.setTimeout(() => {
        setNavigationNotice(null)
        noticeTimeoutRef.current = null
      }, 5000)
    }
  }, [clearNavigationNotice])

  const stopWatcher = useCallback(() => {
    const stopWatch = watchCleanupRef.current
    watchCleanupRef.current = null
    stopWatch?.()
  }, [])

  const stopNavigation = useCallback(async (options?: { arrived?: boolean }) => {
    stopWatcher()
    routeAbortRef.current?.abort()
    routeAbortRef.current = null
    routePointRef.current = null
    routeRequestAtRef.current = 0
    await releaseWakeLock()
    pendingFollowResetRef.current = false
    followZoomRef.current = null
    hasAppliedFollowZoomRef.current = false
    navigationUpdateQueueRef.current = Promise.resolve()
    navigationEngineRef.current.reset()
    setNavStatus('idle')
    setFullscreenActive(false)
    setNavigationOrigin(null)
    onNavigationOriginChange?.(null)
    setNavigationStartPoint(null)
    setNavigationRoute(null)
    setInitialNavigationDistanceMeters(null)
    setNavError(null)
    setRouteOverviewActive(false)
    setDeviceHeading(null)
    setCourseHeading(null)
    setNavigationEngineState(null)
    setConfirmExitOpen(false)

    if (options?.arrived) {
      showNavigationNotice(destination ? `Arrived at ${destination.label}.` : 'Arrived at destination.')
    }

    if (typeof document !== 'undefined' && document.fullscreenElement === wrapperRef.current) {
      try {
        await document.exitFullscreen()
      } catch {
        // ignore
      }
    }
  }, [destination, onNavigationOriginChange, releaseWakeLock, showNavigationNotice, stopWatcher])

  const refreshNavigationRoute = useCallback(async (nextOrigin: MapPoint, options?: { force?: boolean }) => {
    if (!destination) return

    const distanceToDestination = calculateDistanceMeters(nextOrigin, destination)
    if (distanceToDestination <= ARRIVAL_DISTANCE_METERS) {
      await stopNavigation({ arrived: true })
      return
    }

    const now = Date.now()
    const lastPoint = routePointRef.current
    const movedEnough = !lastPoint || calculateDistanceMeters(lastPoint, nextOrigin) >= ROUTE_REFRESH_DISTANCE_METERS
    const waitedLongEnough = now - routeRequestAtRef.current >= ROUTE_REFRESH_MIN_INTERVAL_MS

    if (!options?.force && !movedEnough && !waitedLongEnough) return

    routeAbortRef.current?.abort()
    const controller = new AbortController()
    routeAbortRef.current = controller
    routeRequestAtRef.current = now
    routePointRef.current = nextOrigin

    try {
      const route = await fetchDrivingRoute(nextOrigin, destination, controller.signal)
      if (!route || controller.signal.aborted) return

      if (route.distanceMeters <= ARRIVAL_DISTANCE_METERS) {
        await stopNavigation({ arrived: true })
        return
      }

      setNavigationRoute(route)
      setInitialNavigationDistanceMeters((current) => {
        if (typeof current === 'number' && Number.isFinite(current)) {
          return Math.max(current, route.distanceMeters)
        }
        return route.distanceMeters
      })
      setNavStatus('active')
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setNavError('Unable to update navigation right now.')
    }
  }, [destination, stopNavigation])

  const handlePositionUpdate = useCallback(async (position: {
    latitude: number
    longitude: number
    heading?: number | null
    accuracy?: number | null
    timestamp?: number
  }, options?: { forceRoute?: boolean }) => {
    const routeForEngine = navigationRoute?.geometry?.length ? navigationRoute.geometry : routeCoordinates ?? null
    const snapshot = await navigationEngineRef.current.ingestLocation({
      location: {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: typeof position.accuracy === 'number' && Number.isFinite(position.accuracy) ? position.accuracy : null,
        heading: typeof position.heading === 'number' && Number.isFinite(position.heading) ? position.heading : null,
        timestamp: typeof position.timestamp === 'number' && Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
      },
      routeCoordinates: routeForEngine,
    })

    const correctedOrigin = {
      latitude: snapshot.correctedPoint.latitude,
      longitude: snapshot.correctedPoint.longitude,
      label: 'Current Location',
    } satisfies MapPoint

    onNavigationOriginChange?.(correctedOrigin)
    setNavigationOrigin(correctedOrigin)
    setNavigationStartPoint((current) => current ?? correctedOrigin)
    setNavigationEngineState(snapshot)
    setNavError(null)
    setCourseHeading(typeof snapshot.heading === 'number' && Number.isFinite(snapshot.heading) ? snapshot.heading : null)

    if (typeof position.heading === 'number' && Number.isFinite(position.heading)) {
      setDeviceHeading(normalizeHeading(position.heading))
    }

    await refreshNavigationRoute(correctedOrigin, {
      force: Boolean(options?.forceRoute || snapshot.rerouteSuggested),
    })
  }, [navigationRoute?.geometry, onNavigationOriginChange, refreshNavigationRoute, routeCoordinates])

  const enqueueNavigationUpdate = useCallback((position: Parameters<typeof handlePositionUpdate>[0], options?: Parameters<typeof handlePositionUpdate>[1]) => {
    navigationUpdateQueueRef.current = navigationUpdateQueueRef.current
      .then(() => handlePositionUpdate(position, options))
      .catch((error) => {
        console.error('Failed to process navigation update', error)
      })
  }, [handlePositionUpdate])

  const handleStartNavigation = useCallback(async () => {
    if (!destination) return
    if (!isLocationSupported()) {
      setNavError('Live navigation is not available on this device.')
      return
    }

    blurActiveEditableElement()
    setNavError(null)
    setNavigationNotice(null)
    setNavStatus('starting')
    setFullscreenActive(true)
    setRouteOverviewActive(false)
    pendingFollowResetRef.current = true
    followZoomRef.current = null
    hasAppliedFollowZoomRef.current = false
    navigationUpdateQueueRef.current = Promise.resolve()
    navigationEngineRef.current.reset()
    setNavigationEngineState(null)
    setCourseHeading(null)

    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      const OrientationEventCtor = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<'granted' | 'denied'>
      }
      if (typeof OrientationEventCtor.requestPermission === 'function') {
        try {
          const permission = await OrientationEventCtor.requestPermission()
          if (permission !== 'granted') {
            setDeviceHeading(null)
          }
        } catch {
          setDeviceHeading(null)
        }
      }
    }

    if (wrapperRef.current?.requestFullscreen) {
      try {
        await wrapperRef.current.requestFullscreen()
      } catch {
        // ignore and continue without fullscreen if the browser blocks it
      }
    }

    let started = false
    let startError = 'Location permission was denied or unavailable.'
    const stopWatch = await startLocationWatch({
      reason: 'address-directions-navigation',
      userInitiated: true,
      highAccuracy: true,
      timeoutMs: 10000,
      maximumAgeMs: 2000,
      onLocation: (location) => {
        const forceRoute = !started
        started = true
        enqueueNavigationUpdate(
          {
            latitude: location.latitude,
            longitude: location.longitude,
            heading: location.heading,
            accuracy: location.accuracy,
            timestamp: location.timestamp,
          },
          { forceRoute },
        )
      },
      onError: (result) => {
        const message = result.errorMessage ?? (started ? 'Location updates were interrupted.' : 'Location permission was denied or unavailable.')
        if (started) {
          setNavError(message)
          return
        }
        startError = message
      },
    })

    if (!started) {
      await stopNavigation()
      setNavError(startError)
      return
    }

    watchCleanupRef.current = stopWatch
  }, [destination, enqueueNavigationUpdate, stopNavigation])

  useImperativeHandle(
    ref,
    () => ({
      startNavigation: handleStartNavigation,
    }),
    [handleStartNavigation],
  )

  useEffect(() => {
    if (navStatus !== 'active' && navStatus !== 'starting') return undefined
    if (typeof window === 'undefined') return undefined

    const handleOrientation = (event: Event) => {
      const nextHeading = readHeadingFromOrientationEvent(event)
      if (nextHeading !== null) {
        setDeviceHeading(nextHeading)
      }
    }

    window.addEventListener('deviceorientation', handleOrientation, true)
    return () => window.removeEventListener('deviceorientation', handleOrientation, true)
  }, [navStatus])

  useEffect(() => {
    let cancelled = false
    const storedAvatarMarkers = avatarMarkerRefs.current

    void (async () => {
      if (!containerRef.current || mapRef.current) return
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return
      mapLibreRef.current = maplibregl

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: ADDRESS_MAP_STYLE as any,
        center: initialViewRef.current?.center ?? [-79.3832, 43.6532],
        zoom: initialViewRef.current?.zoom ?? 5,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('zoomend', () => {
        if (navStatusRef.current === 'active' && !routeOverviewActiveRef.current) {
          const zoom = map.getZoom?.()
          followZoomRef.current = typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : followZoomRef.current
        }
      })

      map.on('load', () => {
        map.addSource('address-points', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })

        map.addSource('address-route', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })

        map.addSource('address-rider-route', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })

        map.addSource('address-approach-route', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        })

        map.addLayer({
          id: 'address-point-rings',
          type: 'circle',
          source: 'address-points',
          paint: {
            'circle-radius': 14,
            'circle-color': ['match', ['get', 'kind'], 'origin', 'rgba(2, 132, 199, 0.18)', 'start', 'rgba(37, 99, 235, 0.18)', 'pickup', 'rgba(16, 185, 129, 0.22)', 'rgba(213, 43, 30, 0.18)'],
          },
        })

        map.addLayer({
          id: 'address-point-cores',
          type: 'circle',
          source: 'address-points',
          paint: {
            'circle-radius': 7,
            'circle-color': ['match', ['get', 'kind'], 'origin', '#0284c7', 'start', '#2563eb', 'pickup', '#10b981', '#d52b1e'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        })

        map.addLayer({
          id: 'address-rider-route-line',
          type: 'line',
          source: 'address-rider-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': RIDER_ROUTE_LINE_COLOR,
            'line-width': RIDER_ROUTE_LINE_WIDTH,
            'line-opacity': 0.9,
          },
        })

        map.addLayer({
          id: 'address-route-line',
          type: 'line',
          source: 'address-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': ROUTE_LINE_STATIC_COLOR,
            'line-width': ROUTE_LINE_WIDTH,
            'line-opacity': 0.96,
          },
        })

        map.addLayer({
          id: 'address-approach-route-line',
          type: 'line',
          source: 'address-approach-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': APPROACH_ROUTE_LINE_COLOR,
            'line-width': APPROACH_ROUTE_LINE_WIDTH,
            'line-opacity': 0.92,
          },
        })

        setMapReady(true)
      })
    })()

    return () => {
      cancelled = true
      clearNavigationNotice()
      stopWatcher()
      void releaseWakeLock()
      routeAbortRef.current?.abort()
      routeAbortRef.current = null
      if (noticeTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(noticeTimeoutRef.current)
      }
      if (liveMarkerAnimationRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(liveMarkerAnimationRef.current)
        liveMarkerAnimationRef.current = null
      }
      if (routeLinePulseAnimationRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(routeLinePulseAnimationRef.current)
        routeLinePulseAnimationRef.current = null
      }
      liveMarkerRef.current?.remove?.()
      liveMarkerRef.current = null
      storedAvatarMarkers.forEach((marker) => marker?.remove?.())
      storedAvatarMarkers.clear()
      mapRef.current?.remove?.()
      mapRef.current = null
      mapLibreRef.current = null
    }
  }, [clearNavigationNotice, releaseWakeLock, stopWatcher])

  useEffect(() => {
    if (!mapReady || !mapRef.current || typeof window === 'undefined') return undefined

    const map = mapRef.current
    let cancelled = false

    map.setPaintProperty?.('address-route-line', 'line-color', ROUTE_LINE_STATIC_COLOR)
    map.setPaintProperty?.('address-route-line', 'line-width', ROUTE_LINE_WIDTH)
    map.setPaintProperty?.('address-route-line', 'line-opacity', 0.96)
    map.setPaintProperty?.('address-rider-route-line', 'line-color', RIDER_ROUTE_LINE_COLOR)
    map.setPaintProperty?.('address-rider-route-line', 'line-width', RIDER_ROUTE_LINE_WIDTH)
    map.setPaintProperty?.('address-rider-route-line', 'line-opacity', 0.9)
    map.setPaintProperty?.('address-approach-route-line', 'line-color', APPROACH_ROUTE_LINE_COLOR)
    map.setPaintProperty?.('address-approach-route-line', 'line-width', APPROACH_ROUTE_LINE_WIDTH)
    map.setPaintProperty?.('address-approach-route-line', 'line-opacity', 0.92)

    const animateRouteLine = (timestamp: number) => {
      if (cancelled) return

      const cycleProgress = (Math.sin((timestamp / ROUTE_LINE_PULSE_DURATION_MS) * Math.PI * 2) + 1) / 2
      if (pulseRouteLine) {
        map.setPaintProperty?.('address-route-line', 'line-color', resolveRouteLineColor(cycleProgress))
        map.setPaintProperty?.('address-route-line', 'line-opacity', 0.88 + cycleProgress * 0.12)
      } else {
        map.setPaintProperty?.('address-route-line', 'line-color', ROUTE_LINE_STATIC_COLOR)
        map.setPaintProperty?.('address-route-line', 'line-opacity', 0.96)
      }

      if (pulseApproachRoute) {
        map.setPaintProperty?.('address-approach-route-line', 'line-color', resolveApproachRouteLineColor(cycleProgress))
        map.setPaintProperty?.('address-approach-route-line', 'line-width', APPROACH_ROUTE_LINE_WIDTH + cycleProgress * 1.5)
        map.setPaintProperty?.('address-approach-route-line', 'line-opacity', 0.82 + cycleProgress * 0.18)
      } else {
        map.setPaintProperty?.('address-approach-route-line', 'line-color', APPROACH_ROUTE_LINE_COLOR)
        map.setPaintProperty?.('address-approach-route-line', 'line-width', APPROACH_ROUTE_LINE_WIDTH)
        map.setPaintProperty?.('address-approach-route-line', 'line-opacity', 0.92)
      }
      routeLinePulseAnimationRef.current = window.requestAnimationFrame(animateRouteLine)
    }

    routeLinePulseAnimationRef.current = window.requestAnimationFrame(animateRouteLine)

    return () => {
      cancelled = true
      if (routeLinePulseAnimationRef.current !== null) {
        window.cancelAnimationFrame(routeLinePulseAnimationRef.current)
        routeLinePulseAnimationRef.current = null
      }
    }
  }, [mapReady, pulseApproachRoute, pulseRouteLine])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const handleFullscreenChange = () => {
      const isActive = document.fullscreenElement === wrapperRef.current
      if (isActive) {
        blurActiveEditableElement()
        setFullscreenActive(true)
      }
      window.setTimeout(() => {
        mapRef.current?.resize?.()
      }, 0)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow

    if (fullscreenActive) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      window.setTimeout(() => {
        mapRef.current?.resize?.()
      }, 0)
    } else {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
    }
  }, [fullscreenActive])

  useEffect(() => {
    if (!fullscreenActive || (navStatus !== 'starting' && navStatus !== 'active')) return
    refreshMapViewport()
  }, [fullscreenActive, navStatus, refreshMapViewport])

  useEffect(() => {
    if (!fullscreenActive || (navStatus !== 'starting' && navStatus !== 'active')) {
      void releaseWakeLock()
      return
    }

    void requestWakeLock()

    if (typeof document === 'undefined') return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock()
      } else {
        void releaseWakeLock()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void releaseWakeLock()
    }
  }, [fullscreenActive, navStatus, releaseWakeLock, requestWakeLock])

  useEffect(() => {
    if (!pendingFollowResetRef.current) return
    if (!mapReady || !fullscreenActive || !activeOrigin || !followCameraCenter) return
    if (navStatus !== 'active' || routeOverviewActive) return

    pendingFollowResetRef.current = false
    followZoomRef.current = ACTIVE_NAV_ZOOM
    hasAppliedFollowZoomRef.current = true

    refreshMapViewport()

    if (typeof window === 'undefined') return

    window.requestAnimationFrame(() => {
      const map = mapRef.current
      if (!map) return
      map.stop?.()
      map.resize?.()
      map.easeTo({
        center: [followCameraCenter.longitude, followCameraCenter.latitude],
        zoom: ACTIVE_NAV_ZOOM,
        pitch: ACTIVE_NAV_PITCH,
        bearing: resolveShortestMapBearing(map.getBearing?.(), activeBearing),
        padding: ACTIVE_NAV_CAMERA_PADDING,
        duration: 0,
      })
      map.triggerRepaint?.()
    })
  }, [activeBearing, followCameraCenter, fullscreenActive, mapReady, navStatus, refreshMapViewport, routeOverviewActive])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !destination) return

    const map = mapRef.current
    const pointSource = map.getSource('address-points')
    const routeSource = map.getSource('address-route')
    const riderRouteSource = map.getSource('address-rider-route')
    const approachRouteSource = map.getSource('address-approach-route')
    if (!pointSource || !routeSource || !riderRouteSource || !approachRouteSource) return

    const showLiveProfileMarker = Boolean(activeOrigin) && (navStatus === 'active' || navStatus === 'starting' || showOriginAvatar)

    const features = [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [destination.longitude, destination.latitude] as [number, number],
        },
        properties: { kind: 'destination', label: destination.label },
      },
    ]

    if (!showLiveProfileMarker && startPoint) {
      features.push({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [startPoint.longitude, startPoint.latitude] as [number, number],
        },
        properties: { kind: 'start', label: startPoint.label },
      })
    } else if (activeOrigin && !showLiveProfileMarker) {
      features.push({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [activeOrigin.longitude, activeOrigin.latitude] as [number, number],
        },
        properties: { kind: 'origin', label: activeOrigin.label },
      })
    }

    if (Array.isArray(waypoints)) {
      waypoints.forEach((waypoint, index) => {
        features.push({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [waypoint.longitude, waypoint.latitude] as [number, number],
          },
          properties: { kind: waypoint.kind ?? 'waypoint', label: waypoint.label || `Waypoint ${index + 1}` },
        })
      })
    }

    pointSource.setData({
      type: 'FeatureCollection',
      features,
    })

    const routeFeature = activeOrigin && activeRouteCoordinates?.length
      ? [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: activeRouteCoordinates,
          },
          properties: {},
        }]
      : []

    routeSource.setData({
      type: 'FeatureCollection',
      features: routeFeature,
    })

    const riderRouteFeature = riderRouteCoordinates?.length
      ? [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: riderRouteCoordinates,
          },
          properties: {},
        }]
      : []

    riderRouteSource.setData({
      type: 'FeatureCollection',
      features: riderRouteFeature,
    })

    const approachRouteFeature = activeOrigin && previewApproachRouteCoordinates?.length
      ? [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: previewApproachRouteCoordinates,
          },
          properties: {},
        }]
      : []

    approachRouteSource.setData({
      type: 'FeatureCollection',
      features: approachRouteFeature,
    })

    const mapLibre = mapLibreRef.current
    if (!mapLibre) return

    const nextAvatarMarkers = Array.isArray(avatarMarkers) ? avatarMarkers : []
    const displayMarkerPoints = resolveDisplayMarkerPoints([
      ...(showLiveProfileMarker && activeOrigin ? [{ id: '__origin__', point: activeOrigin }] : []),
      ...nextAvatarMarkers.map((avatarMarker) => ({ id: avatarMarker.id, point: avatarMarker.point })),
    ])

    if (showLiveProfileMarker && activeOrigin) {
      let marker = liveMarkerRef.current
      if (!marker) {
        const element = document.createElement('div')
        element.className = 'h-14 w-14 overflow-hidden rounded-full border-4 border-black bg-white shadow-[0_10px_28px_rgba(15,23,42,0.24)]'
        element.style.zIndex = fullscreenActive ? '2' : '40'
        renderLiveMarkerContents(element, {
          avatarUrl: resolvedOriginAvatarUrl,
          alt: resolvedOriginAvatarLabel,
          fallbackLabel: resolvedOriginAvatarFallbackLabel,
        })

        marker = new mapLibre.Marker({ element, anchor: 'center' })
        marker.setLngLat([activeOrigin.longitude, activeOrigin.latitude])
        marker.addTo(map)
        liveMarkerRef.current = marker
      } else {
        const element = marker.getElement?.()
        if (element instanceof HTMLDivElement) {
          element.style.zIndex = fullscreenActive ? '2' : '40'
          renderLiveMarkerContents(element, {
            avatarUrl: resolvedOriginAvatarUrl,
            alt: resolvedOriginAvatarLabel,
            fallbackLabel: resolvedOriginAvatarFallbackLabel,
          })
        }
      }
      const displayOrigin = displayMarkerPoints.get('__origin__') ?? activeOrigin
      const targetLngLat: [number, number] = [displayOrigin.longitude, displayOrigin.latitude]
      const previousLngLat = marker.getLngLat?.()
      if (!previousLngLat) {
        marker.setLngLat(targetLngLat)
      } else {
        if (liveMarkerAnimationRef.current !== null && typeof window !== 'undefined') {
          window.cancelAnimationFrame(liveMarkerAnimationRef.current)
          liveMarkerAnimationRef.current = null
        }

        const startLng = previousLngLat.lng
        const startLat = previousLngLat.lat
        const markerDistanceMeters = calculateDistanceMeters(
          { latitude: startLat, longitude: startLng },
          { latitude: targetLngLat[1], longitude: targetLngLat[0] },
        )
        const animationDurationMs =
          navStatus === 'active' || navStatus === 'starting'
            ? markerDistanceMeters > 12
              ? 0
              : ACTIVE_NAV_MARKER_ANIMATION_MS
            : LIVE_MARKER_ANIMATION_MS
        if (animationDurationMs <= 0) {
          marker.setLngLat(targetLngLat)
          return
        }
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

        const animateMarker = (timestamp: number) => {
          const elapsed = timestamp - startedAt
          const progress = Math.max(0, Math.min(1, elapsed / animationDurationMs))
          const eased = 1 - Math.pow(1 - progress, 3)
          const nextLng = startLng + (targetLngLat[0] - startLng) * eased
          const nextLat = startLat + (targetLngLat[1] - startLat) * eased
          marker.setLngLat([nextLng, nextLat])

          if (progress < 1 && typeof window !== 'undefined') {
            liveMarkerAnimationRef.current = window.requestAnimationFrame(animateMarker)
          } else {
            liveMarkerAnimationRef.current = null
            marker.setLngLat(targetLngLat)
          }
        }

        if (typeof window !== 'undefined') {
          liveMarkerAnimationRef.current = window.requestAnimationFrame(animateMarker)
        } else {
          marker.setLngLat(targetLngLat)
        }
      }
    } else if (liveMarkerRef.current) {
      if (liveMarkerAnimationRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(liveMarkerAnimationRef.current)
        liveMarkerAnimationRef.current = null
      }
      liveMarkerRef.current.remove()
      liveMarkerRef.current = null
    }
    const seenAvatarMarkerIds = new Set<string>()

    nextAvatarMarkers.forEach((avatarMarker) => {
      seenAvatarMarkerIds.add(avatarMarker.id)
      let marker = avatarMarkerRefs.current.get(avatarMarker.id)
      const displayPoint = displayMarkerPoints.get(avatarMarker.id) ?? avatarMarker.point

      if (!marker) {
        const element = document.createElement('div')
        element.className = 'h-12 w-12 overflow-hidden rounded-full border-4 border-white bg-white shadow-[0_10px_24px_rgba(15,23,42,0.2)]'
        element.style.zIndex = fullscreenActive ? '1' : '30'
        renderLiveMarkerContents(element, {
          avatarUrl: avatarMarker.avatarUrl ?? null,
          alt: avatarMarker.label,
          fallbackLabel: avatarMarker.fallbackLabel,
        })

        marker = new mapLibre.Marker({ element, anchor: 'center' })
        marker.setLngLat([displayPoint.longitude, displayPoint.latitude])
        marker.addTo(map)
        avatarMarkerRefs.current.set(avatarMarker.id, marker)
        return
      }

      const element = marker.getElement?.()
      if (element instanceof HTMLDivElement) {
        element.style.zIndex = fullscreenActive ? '1' : '30'
        renderLiveMarkerContents(element, {
          avatarUrl: avatarMarker.avatarUrl ?? null,
          alt: avatarMarker.label,
          fallbackLabel: avatarMarker.fallbackLabel,
        })
      }
      marker.setLngLat([displayPoint.longitude, displayPoint.latitude])
    })

    avatarMarkerRefs.current.forEach((marker, markerId) => {
      if (seenAvatarMarkerIds.has(markerId)) return
      marker?.remove?.()
      avatarMarkerRefs.current.delete(markerId)
    })

    if (navStatus === 'active' || navStatus === 'starting') {
      if (routeOverviewActive) {
        const bounds = new mapLibre.LngLatBounds([destination.longitude, destination.latitude], [destination.longitude, destination.latitude])
        if (startPoint && !showLiveProfileMarker) bounds.extend([startPoint.longitude, startPoint.latitude])
        if (activeOrigin) bounds.extend([activeOrigin.longitude, activeOrigin.latitude])
        if (Array.isArray(avatarMarkers)) {
          avatarMarkers.forEach((avatarMarker) => bounds.extend([avatarMarker.point.longitude, avatarMarker.point.latitude]))
        }
        if (Array.isArray(waypoints)) {
          waypoints.forEach((waypoint) => bounds.extend([waypoint.longitude, waypoint.latitude]))
        }
        if (previewApproachRouteCoordinates?.length) {
          previewApproachRouteCoordinates.forEach((coordinate) => bounds.extend(coordinate))
        }
        if (riderRouteCoordinates?.length) {
          riderRouteCoordinates.forEach((coordinate) => bounds.extend(coordinate))
        }
        if (activeRouteCoordinates?.length) {
          activeRouteCoordinates.forEach((coordinate) => bounds.extend(coordinate))
        }
        map.fitBounds(bounds, {
          padding: { top: 116, right: 72, bottom: 156, left: 72 },
          duration: 700,
          maxZoom: 15.6,
        })
        map.triggerRepaint?.()
      } else if (activeOrigin) {
        const targetZoom = followZoomRef.current ?? (hasAppliedFollowZoomRef.current ? map.getZoom?.() ?? ACTIVE_NAV_ZOOM : ACTIVE_NAV_ZOOM)
        hasAppliedFollowZoomRef.current = true
        map.resize?.()
        const nextCenter = followCameraCenter ?? {
          latitude: activeOrigin.latitude,
          longitude: activeOrigin.longitude,
        }
        map.easeTo({
          center: [nextCenter.longitude, nextCenter.latitude],
          zoom: targetZoom,
          pitch: ACTIVE_NAV_PITCH,
          bearing: resolveShortestMapBearing(map.getBearing?.(), activeBearing),
          padding: ACTIVE_NAV_CAMERA_PADDING,
          duration: ACTIVE_NAV_FOLLOW_DURATION_MS,
        })
        map.triggerRepaint?.()
      }
      return
    }

    const shouldLockIdleCamera = idleCameraMode === 'fit-once-per-key'
    const nextIdleViewportKey = idleViewportKey ?? null
    const idleViewportChanged = nextIdleViewportKey !== lastIdleViewportKeyRef.current
    if (shouldLockIdleCamera && hasAppliedIdleFitRef.current && !idleViewportChanged) {
      return
    }

    const bounds = new mapLibre.LngLatBounds([destination.longitude, destination.latitude], [destination.longitude, destination.latitude])
    if (activeOrigin) bounds.extend([activeOrigin.longitude, activeOrigin.latitude])
    if (Array.isArray(avatarMarkers)) {
      avatarMarkers.forEach((avatarMarker) => bounds.extend([avatarMarker.point.longitude, avatarMarker.point.latitude]))
    }
    if (Array.isArray(waypoints)) {
      waypoints.forEach((waypoint) => bounds.extend([waypoint.longitude, waypoint.latitude]))
    }
    if (previewApproachRouteCoordinates?.length) {
      previewApproachRouteCoordinates.forEach((coordinate) => bounds.extend(coordinate))
    }
    if (riderRouteCoordinates?.length) {
      riderRouteCoordinates.forEach((coordinate) => bounds.extend(coordinate))
    }
    if (activeRouteCoordinates?.length) {
      activeRouteCoordinates.forEach((coordinate) => bounds.extend(coordinate))
    }
    map.fitBounds(bounds, {
      padding: 72,
      duration: 0,
      maxZoom: activeOrigin ? IDLE_ZOOM_WITH_ORIGIN : 14,
    })
    map.easeTo({
      pitch: 0,
      bearing: 0,
      duration: 0,
    })
    hasAppliedIdleFitRef.current = true
    lastIdleViewportKeyRef.current = nextIdleViewportKey
  }, [
    activeBearing,
    activeOrigin,
    activeRouteCoordinates,
    avatarMarkers,
    destination,
    followCameraCenter,
    idleCameraMode,
    idleViewportKey,
    mapReady,
    navStatus,
    originAvatarUrl,
    previewApproachRouteCoordinates,
    riderRouteCoordinates,
    resolvedOriginAvatarFallbackLabel,
    resolvedOriginAvatarLabel,
    resolvedOriginAvatarUrl,
    routeOverviewActive,
    showOriginAvatar,
    startPoint,
    viewerAvatarUrl,
    waypoints,
  ])

  return (
    <div
      ref={wrapperRef}
      className={fullscreenActive ? 'fixed inset-0 z-[90] bg-slate-950' : ''}
    >
      <div className={fullscreenActive ? 'relative h-full w-full' : 'relative'}>
        <div
          ref={containerRef}
          className={fullscreenActive ? 'h-full w-full overflow-hidden rounded-none bg-slate-100' : 'h-[420px] w-full overflow-hidden rounded-[28px] bg-slate-100 shadow-[0_20px_60px_rgba(15,23,42,0.08)]'}
        />

        <div className="pointer-events-none absolute inset-0 z-[60]">
          <div
            className="pointer-events-none absolute inset-x-0 flex flex-col gap-2 md:inset-x-4 md:gap-3"
            style={{
              top: fullscreenActive ? 'var(--cc-native-safe-top-offset)' : '1rem',
            }}
          >
            {navigationNotice ? (
              <div className="pointer-events-auto rounded-2xl border-4 border-black bg-emerald-50/95 px-4 py-3 text-sm font-semibold text-slate-900 shadow-lg backdrop-blur">
                {navigationNotice}
              </div>
            ) : null}

            {navError ? (
              <div className="pointer-events-auto rounded-2xl border-4 border-black bg-rose-50/95 px-4 py-3 text-sm text-slate-900 shadow-lg backdrop-blur">
                {navError}
              </div>
            ) : null}

            {navigationStep && navigationRoute ? (
              <div className="pointer-events-auto rounded-[24px] border-4 border-black bg-white/92 px-4 py-4 text-slate-900 shadow-2xl backdrop-blur">
                <div className={`grid gap-4 items-stretch ${nextTurnPreview ? 'grid-cols-[minmax(0,1fr)_132px]' : 'grid-cols-1'}`}>
                  <div className="flex flex-col justify-center text-center">
                    <p className="text-lg font-semibold text-slate-900">{headingCardinalLabel ? `Heading ${headingCardinalLabel} on` : 'Heading on'}</p>
                    <p className="text-lg font-semibold text-slate-900">{currentStreetLabel}</p>
                  </div>
                  {nextTurnPreview && nextTurnUrgency ? (
                    <div className={`rounded-[20px] border-2 px-4 py-3 text-center ${nextTurnUrgency.panelClassName}`}>
                      <div className="flex flex-col items-center gap-1">
                        <NextTurnIcon className={`h-6 w-6 ${nextTurnUrgency.iconClassName}`} />
                        <p className={`text-base font-semibold ${nextTurnUrgency.textClassName}`}>{nextTurnPreview.label}</p>
                      </div>
                      <p className={`mt-3 text-lg font-semibold ${nextTurnUrgency.textClassName}`}>{formatRemainingDistance(nextTurnPreview.distanceMeters)}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {fullscreenActive && fullscreenOverlay ? <div className="pointer-events-auto">{fullscreenOverlay}</div> : null}
          </div>
          {navigationRoute && activeOrigin ? (
            <div
              className="pointer-events-none absolute inset-x-0 md:inset-x-4"
              style={{
                bottom: fullscreenActive
                  ? 'max(env(safe-area-inset-bottom), var(--cc-runtime-bottom-inset))'
                  : '0.75rem',
              }}
            >
              <div className="pointer-events-auto grid gap-2 rounded-[24px] border-4 border-black bg-white/92 px-3 py-3 text-slate-900 shadow-2xl backdrop-blur md:grid-cols-[minmax(0,1fr)_auto] md:gap-3 md:px-4 md:py-4 md:items-end">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="flex items-center gap-2 rounded-[18px] border-2 border-black bg-white px-2.5 py-2.5 md:gap-3 md:rounded-[20px] md:px-3 md:py-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-900 md:h-10 md:w-10">
                      <HiOutlineClock className="h-4 w-4 md:h-5 md:w-5" />
                    </span>
                    <p className="text-sm font-semibold text-slate-900 md:text-base">{formatRemainingDuration(navigationRoute.durationSeconds)}</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-[18px] border-2 border-black bg-white px-2.5 py-2.5 md:gap-3 md:rounded-[20px] md:px-3 md:py-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-900 md:h-10 md:w-10">
                      <HiOutlineMapPin className="h-4 w-4 md:h-5 md:w-5" />
                    </span>
                    <p className="text-sm font-semibold text-slate-900 md:text-base">{formatRemainingDistance(navigationRoute.distanceMeters)}</p>
                  </div>
                  {arrivalTimeLabel ? (
                    <div className="flex items-center gap-2 rounded-[18px] border-2 border-black bg-white px-2.5 py-2.5 md:gap-3 md:rounded-[20px] md:px-3 md:py-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-900 md:h-10 md:w-10">
                        <HiOutlineFlag className="h-4 w-4 md:h-5 md:w-5" />
                      </span>
                      <p className="text-sm font-semibold text-slate-900 md:text-base">{arrivalTimeLabel}</p>
                    </div>
                  ) : null}
                  {navigationProgressPercent !== null ? (
                    <div className="flex items-center gap-2 rounded-[18px] border-2 border-black bg-white px-2.5 py-2.5 md:gap-3 md:rounded-[20px] md:px-3 md:py-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-900 md:h-10 md:w-10">
                        <HiOutlineChartBar className="h-4 w-4 md:h-5 md:w-5" />
                      </span>
                      <p className="text-sm font-semibold text-slate-900 md:text-base">{navigationProgressPercent}%</p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  {destination?.label ? (
                    <div className="inline-flex max-w-full items-center gap-2 rounded-full border-2 border-black bg-white px-3 py-2 text-[11px] font-semibold text-slate-900 md:text-xs">
                      <HiOutlineFlag className="h-4 w-4" />
                      <span className="truncate">{destination.label}</span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleViewRouteToggle}
                    className="pointer-events-auto inline-flex items-center rounded-full border-2 border-black bg-white px-3 py-2 text-[11px] font-semibold text-slate-900 transition hover:bg-slate-100 md:text-xs"
                  >
                    {routeOverviewActive ? 'Follow trip' : 'View route'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmExitOpen(true)}
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full border-2 border-black bg-red-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-red-700 md:text-xs"
                  >
                    <HiOutlineXMark className="h-4 w-4" />
                    Exit Full Screen
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {navStatus === 'starting' ? (
            <div
              className="pointer-events-none absolute inset-x-4 flex justify-end"
              style={{
                bottom: fullscreenActive
                  ? 'calc(max(env(safe-area-inset-bottom), var(--cc-runtime-bottom-inset)) + 1rem)'
                  : '1rem',
              }}
            >
              <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-950/85 px-5 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur">
                <HiOutlineArrowPath className="h-4 w-4 animate-spin" />
                Starting navigation…
              </div>
            </div>
          ) : null}

          {confirmExitOpen ? (
            <div className="pointer-events-auto absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[2px]">
              <div className="w-full max-w-sm rounded-[28px] border-4 border-black bg-white px-5 py-5 text-slate-900 shadow-2xl">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                    <HiOutlineXMark className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-lg font-semibold">Exit full screen?</p>
                    <p className="text-sm text-slate-600">This will stop live navigation and close fullscreen mode.</p>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmExitOpen(false)}
                    className="inline-flex items-center rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void stopNavigation()
                    }}
                    className="inline-flex items-center rounded-full border-2 border-black bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                  >
                    Exit Full Screen
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {fullscreenActive && fullscreenModalOverlay ? fullscreenModalOverlay : null}
        </div>
      </div>
    </div>
  )
})

AddressDirectionsMap.displayName = 'AddressDirectionsMap'
