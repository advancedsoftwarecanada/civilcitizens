'use client'

import type { IconType } from 'react-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HiOutlineArrowLongDown,
  HiOutlineArrowLongLeft,
  HiOutlineArrowLongRight,
  HiOutlineArrowLongUp,
  HiOutlineArrowPath,
  HiOutlineArrowUturnLeft,
  HiOutlineTruck,
  HiOutlineXMark,
} from 'react-icons/hi2'
import { calculateDistanceKm, fetchDrivingRoute, type DrivingRoute, type DrivingRouteStep } from '../../_lib/addressSearch'
import { useViewerStore } from '../../_lib/viewerStore'
import { MapZoomControls } from './MapZoomControls'

type MapPoint = {
  latitude: number
  longitude: number
  label: string
}

type AddressDirectionsMapProps = {
  destination: MapPoint | null
  origin?: MapPoint | null
  routeCoordinates?: Array<[number, number]> | null
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
const ROUTE_REFRESH_DISTANCE_METERS = 20
const ROUTE_REFRESH_MIN_INTERVAL_MS = 5000
const IDLE_ZOOM_WITH_ORIGIN = 14
const ACTIVE_NAV_ZOOM = 19.4
const ACTIVE_NAV_PITCH = 58
const ACTIVE_NAV_FALLBACK_BEARING = -18
const ACTIVE_NAV_LOOKAHEAD_POINTS = 6
const LIVE_MARKER_ANIMATION_MS = 900

function normalizeHeading(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
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

function calculateDistanceMeters(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  return calculateDistanceKm(origin, destination) * 1000
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

function calculateBearingDegrees(start: [number, number], end: [number, number]) {
  const startLat = (start[1] * Math.PI) / 180
  const startLng = (start[0] * Math.PI) / 180
  const endLat = (end[1] * Math.PI) / 180
  const endLng = (end[0] * Math.PI) / 180
  const deltaLng = endLng - startLng

  const y = Math.sin(deltaLng) * Math.cos(endLat)
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng)
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI)
}

function normalizeBearingDelta(from: number, to: number) {
  const delta = (to - from + 540) % 360 - 180
  return delta
}

function blendBearing(from: number, to: number, factor: number) {
  return normalizeHeading(from + normalizeBearingDelta(from, to) * factor)
}

function findClosestRouteCoordinateIndex(routeCoordinates: Array<[number, number]>, point: { latitude: number; longitude: number }) {
  let closestIndex = 0
  let closestDistance = Number.POSITIVE_INFINITY

  routeCoordinates.forEach((coordinate, index) => {
    const distance = calculateDistanceMeters(
      { latitude: coordinate[1], longitude: coordinate[0] },
      { latitude: point.latitude, longitude: point.longitude },
    )
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  })

  return closestIndex
}

function resolveRouteFollowBearing(point: { latitude: number; longitude: number }, routeCoordinates: Array<[number, number]> | null | undefined) {
  if (!routeCoordinates || routeCoordinates.length < 2) return null

  const closestIndex = findClosestRouteCoordinateIndex(routeCoordinates, point)
  const startIndex = Math.min(closestIndex, routeCoordinates.length - 2)
  const endIndex = Math.min(startIndex + ACTIVE_NAV_LOOKAHEAD_POINTS, routeCoordinates.length - 1)
  const startCoordinate = routeCoordinates[startIndex]
  const endCoordinate = routeCoordinates[endIndex]
  if (!startCoordinate || !endCoordinate) return null

  return calculateBearingDegrees(startCoordinate, endCoordinate)
}

function resolveHeadingCardinalLabel(heading: number | null, routeCoordinates: Array<[number, number]> | null | undefined) {
  if (typeof heading === 'number' && Number.isFinite(heading)) {
    return normalizeHeadingCardinalLabel(heading)
  }
  if (routeCoordinates && routeCoordinates.length >= 2) {
    return normalizeHeadingCardinalLabel(calculateBearingDegrees(routeCoordinates[0]!, routeCoordinates[1]!))
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

export function AddressDirectionsMap({ destination, origin, routeCoordinates }: AddressDirectionsMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const mapLibreRef = useRef<any>(null)
  const watchIdRef = useRef<number | null>(null)
  const routeAbortRef = useRef<AbortController | null>(null)
  const routeRequestAtRef = useRef<number>(0)
  const routePointRef = useRef<MapPoint | null>(null)
  const noticeTimeoutRef = useRef<number | null>(null)
  const liveMarkerRef = useRef<any>(null)
  const liveMarkerAnimationRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const navStatusRef = useRef<'idle' | 'starting' | 'active'>('idle')
  const routeOverviewActiveRef = useRef(false)
  const followZoomRef = useRef<number | null>(null)
  const hasAppliedFollowZoomRef = useRef(false)
  const pendingFollowResetRef = useRef(false)
  const roadBearingRef = useRef<number | null>(null)
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
  const viewerAvatarUrl = useViewerStore((state) => state.me?.avatarUrl ?? null)

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
  const activeBearing = useMemo(() => {
    if (typeof activeOrigin?.latitude === 'number' && typeof activeOrigin.longitude === 'number') {
      const routeBearing = resolveRouteFollowBearing(activeOrigin, activeRouteCoordinates)
      if (typeof routeBearing === 'number' && Number.isFinite(routeBearing)) {
        const blendedBearing = roadBearingRef.current === null ? routeBearing : blendBearing(roadBearingRef.current, routeBearing, 0.28)
        roadBearingRef.current = blendedBearing
        return -blendedBearing
      }
    }
    if (typeof deviceHeading === 'number' && Number.isFinite(deviceHeading)) {
      const normalized = normalizeHeading(deviceHeading)
      roadBearingRef.current = normalized
      return -normalized
    }
    roadBearingRef.current = null
    return ACTIVE_NAV_FALLBACK_BEARING
  }, [activeOrigin, activeRouteCoordinates, deviceHeading])
  const headingCardinalLabel = useMemo(() => resolveHeadingCardinalLabel(deviceHeading, activeRouteCoordinates), [activeRouteCoordinates, deviceHeading])
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
  const currentStreetLabel = navigationStep?.streetName || 'Current street'
  const currentSegmentDistance = nextTurnPreview?.distanceMeters ?? navigationRoute?.distanceMeters ?? navigationStep?.distanceMeters ?? 0

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

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn?.({ duration: 180 })
  }, [])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut?.({ duration: 180 })
  }, [])

  const navigationProgressPercent = useMemo(() => {
    if (!navigationRoute || initialNavigationDistanceMeters === null) return null
    const baselineDistance = Math.max(initialNavigationDistanceMeters, navigationRoute.distanceMeters)
    if (baselineDistance <= 0) return null
    const progress = ((baselineDistance - navigationRoute.distanceMeters) / baselineDistance) * 100
    return Math.max(0, Math.min(100, Math.round(progress)))
  }, [initialNavigationDistanceMeters, navigationRoute])

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
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
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
    roadBearingRef.current = null
    setNavStatus('idle')
    setFullscreenActive(false)
    setNavigationOrigin(null)
    setNavigationStartPoint(null)
    setNavigationRoute(null)
    setInitialNavigationDistanceMeters(null)
    setNavError(null)
    setRouteOverviewActive(false)
    setDeviceHeading(null)

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
  }, [destination, releaseWakeLock, showNavigationNotice, stopWatcher])

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

  const handlePositionUpdate = useCallback((position: GeolocationPosition, options?: { forceRoute?: boolean }) => {
    const nextOrigin = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      label: 'Current Location',
    } satisfies MapPoint

    setNavigationOrigin(nextOrigin)
    setNavigationStartPoint((current) => current ?? nextOrigin)
    setNavError(null)
    if (typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading)) {
      setDeviceHeading(normalizeHeading(position.coords.heading))
    }
    void refreshNavigationRoute(nextOrigin, { force: options?.forceRoute })
  }, [refreshNavigationRoute])

  const handleStartNavigation = useCallback(async () => {
    if (!destination) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNavError('Live navigation is not available on this device.')
      return
    }

    setNavError(null)
    setNavigationNotice(null)
    setNavStatus('starting')
    setFullscreenActive(true)
    setRouteOverviewActive(false)
    pendingFollowResetRef.current = true
    followZoomRef.current = null
    hasAppliedFollowZoomRef.current = false

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

    navigator.geolocation.getCurrentPosition(
      (position) => {
        handlePositionUpdate(position, { forceRoute: true })
        const watchId = navigator.geolocation.watchPosition(
          (nextPosition) => {
            handlePositionUpdate(nextPosition)
          },
          () => {
            setNavError('Location updates were interrupted.')
          },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
        )
        watchIdRef.current = watchId
      },
      () => {
        setNavStatus('idle')
        setNavError('Location permission was denied or unavailable.')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    )
  }, [destination, handlePositionUpdate])

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

    void (async () => {
      if (!containerRef.current || mapRef.current) return
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return
      mapLibreRef.current = maplibregl

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: ADDRESS_MAP_STYLE as any,
        center: destination ? [destination.longitude, destination.latitude] : [-79.3832, 43.6532],
        zoom: destination ? (origin ? IDLE_ZOOM_WITH_ORIGIN : 13.4) : 5,
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

        map.addLayer({
          id: 'address-point-rings',
          type: 'circle',
          source: 'address-points',
          paint: {
            'circle-radius': 14,
            'circle-color': ['match', ['get', 'kind'], 'origin', 'rgba(2, 132, 199, 0.18)', 'start', 'rgba(37, 99, 235, 0.18)', 'rgba(213, 43, 30, 0.18)'],
          },
        })

        map.addLayer({
          id: 'address-point-cores',
          type: 'circle',
          source: 'address-points',
          paint: {
            'circle-radius': 7,
            'circle-color': ['match', ['get', 'kind'], 'origin', '#0284c7', 'start', '#2563eb', '#d52b1e'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        })

        map.addLayer({
          id: 'address-point-start-label',
          type: 'symbol',
          source: 'address-points',
          filter: ['==', ['get', 'kind'], 'start'],
          layout: {
            'text-field': 'S',
            'text-size': 11,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          },
          paint: {
            'text-color': '#ffffff',
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
            'line-color': '#16a34a',
            'line-width': 5,
            'line-opacity': 0.92,
            'line-dasharray': [2, 2],
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
      liveMarkerRef.current?.remove?.()
      liveMarkerRef.current = null
      mapRef.current?.remove?.()
      mapRef.current = null
      mapLibreRef.current = null
    }
  }, [clearNavigationNotice, releaseWakeLock, stopWatcher])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const handleFullscreenChange = () => {
      const isActive = document.fullscreenElement === wrapperRef.current
      if (isActive) setFullscreenActive(true)
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
    if (!mapReady || !fullscreenActive || !activeOrigin) return
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
        center: [activeOrigin.longitude, activeOrigin.latitude],
        zoom: ACTIVE_NAV_ZOOM,
        pitch: ACTIVE_NAV_PITCH,
        bearing: activeBearing,
        duration: 0,
      })
      map.triggerRepaint?.()
    })
  }, [activeBearing, activeOrigin, fullscreenActive, mapReady, navStatus, refreshMapViewport, routeOverviewActive])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !destination) return

    const map = mapRef.current
    const pointSource = map.getSource('address-points')
    const routeSource = map.getSource('address-route')
    if (!pointSource || !routeSource) return

    const showLiveProfileMarker = Boolean(activeOrigin) && (navStatus === 'active' || navStatus === 'starting')

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

    if (startPoint) {
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

    map.setPaintProperty('address-route-line', 'line-dasharray', navStatus === 'active' || navStatus === 'starting' ? [1, 0] : [2, 2])

    const mapLibre = mapLibreRef.current
    if (!mapLibre) return

    if (showLiveProfileMarker && activeOrigin) {
      let marker = liveMarkerRef.current
      if (!marker) {
        const element = document.createElement('div')
        element.className = 'h-14 w-14 overflow-hidden rounded-full border-4 border-black bg-white shadow-[0_10px_28px_rgba(15,23,42,0.24)]'

        if (viewerAvatarUrl) {
          const image = document.createElement('img')
          image.src = viewerAvatarUrl
          image.alt = 'Your location'
          image.className = 'h-full w-full object-cover'
          element.appendChild(image)
        } else {
          const fallback = document.createElement('div')
          fallback.className = 'flex h-full w-full items-center justify-center bg-emerald-100 text-sm font-semibold text-slate-900'
          fallback.textContent = 'You'
          element.appendChild(fallback)
        }

        marker = new mapLibre.Marker({ element, anchor: 'center' })
        marker.setLngLat([activeOrigin.longitude, activeOrigin.latitude])
        marker.addTo(map)
        liveMarkerRef.current = marker
      }
      const targetLngLat: [number, number] = [activeOrigin.longitude, activeOrigin.latitude]
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
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

        const animateMarker = (timestamp: number) => {
          const elapsed = timestamp - startedAt
          const progress = Math.max(0, Math.min(1, elapsed / LIVE_MARKER_ANIMATION_MS))
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

    if (navStatus === 'active' || navStatus === 'starting') {
      if (routeOverviewActive) {
        const bounds = new mapLibre.LngLatBounds([destination.longitude, destination.latitude], [destination.longitude, destination.latitude])
        if (startPoint) bounds.extend([startPoint.longitude, startPoint.latitude])
        if (activeOrigin) bounds.extend([activeOrigin.longitude, activeOrigin.latitude])
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
        map.easeTo({
          center: [activeOrigin.longitude, activeOrigin.latitude],
          zoom: targetZoom,
          pitch: ACTIVE_NAV_PITCH,
          bearing: activeBearing,
          duration: 800,
        })
        map.triggerRepaint?.()
      }
      return
    }

    const bounds = new mapLibre.LngLatBounds([destination.longitude, destination.latitude], [destination.longitude, destination.latitude])
    if (activeOrigin) bounds.extend([activeOrigin.longitude, activeOrigin.latitude])
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
  }, [activeBearing, activeOrigin, activeRouteCoordinates, destination, mapReady, navStatus, routeOverviewActive, startPoint, viewerAvatarUrl])

  const showStartButton = Boolean(destination && origin) && navStatus === 'idle'

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

        <div className="pointer-events-none absolute inset-0">
          <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-col gap-3">
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

            {navigationRoute && activeOrigin ? (
              <div className="pointer-events-auto grid gap-3 rounded-[24px] border-4 border-black bg-white/92 px-4 py-4 text-slate-900 shadow-2xl backdrop-blur md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatRemainingDuration(navigationRoute.durationSeconds)} • {formatRemainingDistance(navigationRoute.distanceMeters)}
                    {navigationProgressPercent !== null ? ` • ${navigationProgressPercent}%` : ''}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">Destination: {destination?.label}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleViewRouteToggle}
                    className="pointer-events-auto inline-flex items-center rounded-full border-2 border-black bg-white px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
                  >
                    {routeOverviewActive ? 'Follow trip' : 'View route'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void stopNavigation()
                    }}
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full border-2 border-black bg-rose-100 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-rose-200"
                  >
                    <HiOutlineXMark className="h-4 w-4" />
                    End trip
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <MapZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} className="md:top-[6.5rem]" />

          {showStartButton ? (
            <div className="pointer-events-none absolute left-4 top-4 flex justify-start md:top-20">
              <button
                type="button"
                onClick={() => {
                  void handleStartNavigation()
                }}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full border-2 border-emerald-950 bg-emerald-500 px-5 py-3 text-sm font-semibold text-emerald-950 shadow-lg transition hover:bg-emerald-400"
              >
                <HiOutlineTruck className="h-4 w-4" />
                Start
              </button>
            </div>
          ) : null}

          {navigationStep && navigationRoute ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4">
              <div className="pointer-events-auto rounded-[24px] border-4 border-black bg-white/92 px-4 py-4 text-slate-900 shadow-2xl backdrop-blur">
                <div className={`grid gap-4 items-stretch ${nextTurnPreview ? 'grid-cols-[minmax(0,1fr)_132px]' : 'grid-cols-1'}`}>
                  <div className="flex flex-col justify-center text-center">
                    <p className="text-lg font-semibold text-slate-900">{headingCardinalLabel ? `Heading ${headingCardinalLabel} on` : 'Heading on'}</p>
                    <p className="text-lg font-semibold text-slate-900">{currentStreetLabel}</p>
                  </div>
                  {nextTurnPreview ? (
                    <div className="border-l-2 border-black/70 pl-4 text-center">
                      <p className="text-lg font-semibold text-slate-900">Next turn</p>
                      <div className="mt-2 flex flex-col items-center gap-1">
                        <NextTurnIcon className="h-6 w-6 text-slate-900" />
                        <p className="text-base font-semibold text-slate-900">{nextTurnPreview.label}</p>
                      </div>
                      <p className="mt-4 text-base font-semibold text-slate-900">{formatRemainingDistance(nextTurnPreview.distanceMeters)}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {navStatus === 'starting' ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-end">
              <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-950/85 px-5 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur">
                <HiOutlineArrowPath className="h-4 w-4 animate-spin" />
                Starting navigation…
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}