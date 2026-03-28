'use client'

import { calculateDistanceKm, type RoutePoint } from './addressSearch'

export type NavigationGpsSample = {
  latitude: number
  longitude: number
  accuracy: number | null
  heading: number | null
  timestamp: number
}

type RouteProjection = {
  point: RoutePoint
  segmentIndex: number
  fraction: number
  distanceMeters: number
  alongRouteMeters: number
}

type RouteAnalysis = {
  coordinates: Array<[number, number]>
  cumulativeDistances: number[]
  totalDistanceMeters: number
}

export type NavigationTurnAnticipation = {
  distanceMeters: number
  deltaDegrees: number
  currentBearing: number
  targetBearing: number
  anticipatedBearing: number
  strength: 'turn' | 'strong'
}

export type NavigationEngineSnapshot = {
  rawPoint: NavigationGpsSample
  matchedPoint: RoutePoint | null
  correctedPoint: NavigationGpsSample
  projectedPoint: RouteProjection | null
  usedMatch: boolean
  heading: number | null
  mapBearing: number
  cameraCenter: RoutePoint
  predictiveLeadMeters: number
  deviationMeters: number | null
  rerouteSuggested: boolean
  rerouteReason: 'off_route' | 'gps_accuracy' | null
  turnAnticipation: NavigationTurnAnticipation | null
}

type NavigationEngineOptions = {
  gpsBufferSize?: number
  correctedBufferSize?: number
  cameraLookaheadMeters?: number
  maxMatchIntervalMs?: number
  forcedMatchIntervalMs?: number
  rerouteDistanceMeters?: number
  snapDistanceMeters?: number
  headingBlendFactor?: number
}

const DEFAULT_GPS_BUFFER_SIZE = 8
const DEFAULT_CORRECTED_BUFFER_SIZE = 6
const DEFAULT_CAMERA_LOOKAHEAD_METERS = 22
const DEFAULT_MATCH_INTERVAL_MS = 2_500
const DEFAULT_FORCED_MATCH_INTERVAL_MS = 1_200
const DEFAULT_REROUTE_DISTANCE_METERS = 28
const DEFAULT_SNAP_DISTANCE_METERS = 32
const DEFAULT_HEADING_BLEND_FACTOR = 0.18
const MIN_HEADING_DISTANCE_METERS = 5
const MAX_USABLE_ACCURACY_METERS = 65
const MAX_SPEED_SAMPLE_AGE_MS = 6_000
const MIN_SAMPLE_INTERVAL_MS = 650
const MIN_SAMPLE_MOVEMENT_METERS = 3
const MATCH_DEVIATION_DISTANCE_METERS = 12
const MATCH_MIN_MOVEMENT_METERS = 8
const MIN_PREDICTIVE_LEAD_METERS = 2
const MAX_PREDICTIVE_LEAD_METERS = 5
const TURN_LOOKAHEAD_DISTANCE_METERS = 50
const TURN_BLEND_START_DISTANCE_METERS = 48
const TURN_BLEND_END_DISTANCE_METERS = 16
const TURN_DEGREES_THRESHOLD = 20
const STRONG_TURN_DEGREES_THRESHOLD = 45
const LOCAL_ROUTE_SEARCH_BACKTRACK_SEGMENTS = 24
const LOCAL_ROUTE_SEARCH_FORWARD_SEGMENTS = 96
const MAP_BEARING_LOOKAHEAD_METERS = 8

function logNavigation(event: string, details: Record<string, unknown>) {
  console.debug(`[navigation] ${event}`, details)
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(6))
}

function roundDistance(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeHeading(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function normalizeBearingDelta(from: number, to: number) {
  return (to - from + 540) % 360 - 180
}

function blendBearing(from: number, to: number, factor: number) {
  return normalizeHeading(from + normalizeBearingDelta(from, to) * factor)
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function calculateDistanceMeters(origin: RoutePoint, destination: RoutePoint) {
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

function averageBearingDegrees(bearings: number[]) {
  if (!bearings.length) return null

  const vector = bearings.reduce(
    (accumulator, bearing) => ({
      x: accumulator.x + Math.cos(toRadians(bearing)),
      y: accumulator.y + Math.sin(toRadians(bearing)),
    }),
    { x: 0, y: 0 },
  )

  if (Math.abs(vector.x) < 0.000001 && Math.abs(vector.y) < 0.000001) {
    return null
  }

  return normalizeHeading((Math.atan2(vector.y, vector.x) * 180) / Math.PI)
}

function isAccuracyUsable(sample: NavigationGpsSample) {
  return sample.accuracy === null || sample.accuracy <= MAX_USABLE_ACCURACY_METERS
}

function pointToXY(point: RoutePoint, referenceLatitude: number) {
  const metersPerDegreeLatitude = 111_320
  const metersPerDegreeLongitude = Math.max(1, Math.cos(toRadians(referenceLatitude)) * metersPerDegreeLatitude)

  return {
    x: point.longitude * metersPerDegreeLongitude,
    y: point.latitude * metersPerDegreeLatitude,
    metersPerDegreeLatitude,
    metersPerDegreeLongitude,
  }
}

function interpolateRoutePoint(start: RoutePoint, end: RoutePoint, fraction: number): RoutePoint {
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * fraction,
    longitude: start.longitude + (end.longitude - start.longitude) * fraction,
  }
}

function buildRouteAnalysis(routeCoordinates: Array<[number, number]>) {
  const cumulativeDistances = [0]
  let totalDistanceMeters = 0

  for (let index = 1; index < routeCoordinates.length; index += 1) {
    const previous = routeCoordinates[index - 1]
    const current = routeCoordinates[index]
    if (!previous || !current) continue

    totalDistanceMeters += calculateDistanceMeters(
      { latitude: previous[1], longitude: previous[0] },
      { latitude: current[1], longitude: current[0] },
    )
    cumulativeDistances.push(totalDistanceMeters)
  }

  return {
    coordinates: routeCoordinates,
    cumulativeDistances,
    totalDistanceMeters,
  } satisfies RouteAnalysis
}

function projectPointOntoRoute(
  routeAnalysis: RouteAnalysis,
  point: RoutePoint,
  lastSegmentIndex: number | null,
): RouteProjection | null {
  if (routeAnalysis.coordinates.length < 2) return null

  const segmentCount = routeAnalysis.coordinates.length - 1
  const referenceIndex = typeof lastSegmentIndex === 'number' ? clamp(lastSegmentIndex, 0, segmentCount - 1) : null
  const startIndex = referenceIndex === null ? 0 : Math.max(0, referenceIndex - LOCAL_ROUTE_SEARCH_BACKTRACK_SEGMENTS)
  const endIndex = referenceIndex === null ? segmentCount - 1 : Math.min(segmentCount - 1, referenceIndex + LOCAL_ROUTE_SEARCH_FORWARD_SEGMENTS)
  const searchRanges: Array<[number, number]> =
    referenceIndex === null || (startIndex === 0 && endIndex === segmentCount - 1)
      ? [[0, segmentCount - 1]]
      : [[startIndex, endIndex], [0, segmentCount - 1]]

  let bestProjection: RouteProjection | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const [rangeStart, rangeEnd] of searchRanges) {
    for (let index = rangeStart; index <= rangeEnd; index += 1) {
      const start = routeAnalysis.coordinates[index]
      const end = routeAnalysis.coordinates[index + 1]
      if (!start || !end) continue

      const startPoint = { latitude: start[1], longitude: start[0] }
      const endPoint = { latitude: end[1], longitude: end[0] }
      const referenceLatitude = (startPoint.latitude + endPoint.latitude + point.latitude) / 3
      const startXY = pointToXY(startPoint, referenceLatitude)
      const endXY = pointToXY(endPoint, referenceLatitude)
      const pointXY = pointToXY(point, referenceLatitude)

      const segmentX = endXY.x - startXY.x
      const segmentY = endXY.y - startXY.y
      const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
      const rawFraction =
        segmentLengthSquared <= 0
          ? 0
          : ((pointXY.x - startXY.x) * segmentX + (pointXY.y - startXY.y) * segmentY) / segmentLengthSquared
      const fraction = clamp(rawFraction, 0, 1)
      const projectedX = startXY.x + segmentX * fraction
      const projectedY = startXY.y + segmentY * fraction
      const distanceMeters = Math.hypot(pointXY.x - projectedX, pointXY.y - projectedY)

      if (distanceMeters >= bestDistance) continue

      const projectedPoint = interpolateRoutePoint(startPoint, endPoint, fraction)
      const segmentLengthMeters = calculateDistanceMeters(startPoint, endPoint)
      bestDistance = distanceMeters
      bestProjection = {
        point: projectedPoint,
        segmentIndex: index,
        fraction,
        distanceMeters,
        alongRouteMeters: (routeAnalysis.cumulativeDistances[index] ?? 0) + segmentLengthMeters * fraction,
      }
    }

    if (bestProjection) break
  }

  return bestProjection
}

function pointAlongRoute(routeAnalysis: RouteAnalysis, alongRouteMeters: number): RoutePoint {
  if (routeAnalysis.coordinates.length === 0) {
    return { latitude: 0, longitude: 0 }
  }

  if (routeAnalysis.coordinates.length === 1) {
    const first = routeAnalysis.coordinates[0]
    return { latitude: first?.[1] ?? 0, longitude: first?.[0] ?? 0 }
  }

  const clampedDistance = clamp(alongRouteMeters, 0, routeAnalysis.totalDistanceMeters)

  for (let index = 0; index < routeAnalysis.coordinates.length - 1; index += 1) {
    const segmentStartDistance = routeAnalysis.cumulativeDistances[index] ?? 0
    const segmentEndDistance = routeAnalysis.cumulativeDistances[index + 1] ?? segmentStartDistance
    if (clampedDistance > segmentEndDistance && index < routeAnalysis.coordinates.length - 2) continue

    const start = routeAnalysis.coordinates[index]
    const end = routeAnalysis.coordinates[index + 1]
    if (!start || !end) break

    const startPoint = { latitude: start[1], longitude: start[0] }
    const endPoint = { latitude: end[1], longitude: end[0] }
    const segmentDistance = Math.max(1, segmentEndDistance - segmentStartDistance)
    const fraction = clamp((clampedDistance - segmentStartDistance) / segmentDistance, 0, 1)
    return interpolateRoutePoint(startPoint, endPoint, fraction)
  }

  const fallback = routeAnalysis.coordinates[routeAnalysis.coordinates.length - 1]
  return { latitude: fallback?.[1] ?? 0, longitude: fallback?.[0] ?? 0 }
}

function bearingAlongRoute(routeAnalysis: RouteAnalysis, alongRouteMeters: number, lookaheadMeters: number) {
  if (routeAnalysis.coordinates.length < 2) return null
  const startPoint = pointAlongRoute(routeAnalysis, alongRouteMeters)
  const endPoint = pointAlongRoute(routeAnalysis, Math.min(routeAnalysis.totalDistanceMeters, alongRouteMeters + lookaheadMeters))
  const distanceMeters = calculateDistanceMeters(startPoint, endPoint)
  if (distanceMeters < 1) return null
  return calculateTravelBearingDegrees(startPoint.latitude, startPoint.longitude, endPoint.latitude, endPoint.longitude)
}

function estimateSpeedMetersPerSecond(samples: NavigationGpsSample[]) {
  if (samples.length < 2) return 0

  const segments: number[] = []

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (!previous || !current) continue

    const elapsedMs = current.timestamp - previous.timestamp
    if (elapsedMs <= 0 || elapsedMs > MAX_SPEED_SAMPLE_AGE_MS) continue

    const distanceMeters = calculateDistanceMeters(previous, current)
    if (distanceMeters < MIN_HEADING_DISTANCE_METERS) continue

    segments.push(distanceMeters / (elapsedMs / 1000))
  }

  if (!segments.length) return 0
  return segments.reduce((sum, value) => sum + value, 0) / segments.length
}

function detectUpcomingTurn(routeAnalysis: RouteAnalysis, projection: RouteProjection): NavigationTurnAnticipation | null {
  if (routeAnalysis.coordinates.length < 3) return null

  const baseBearing = bearingAlongRoute(routeAnalysis, projection.alongRouteMeters, 12)
  if (baseBearing === null) return null

  for (let index = projection.segmentIndex + 1; index < routeAnalysis.coordinates.length - 1; index += 1) {
    const previousDistance = routeAnalysis.cumulativeDistances[index] ?? 0
    const distanceMeters = Math.max(0, previousDistance - projection.alongRouteMeters)
    if (distanceMeters > TURN_LOOKAHEAD_DISTANCE_METERS) break

    const current = routeAnalysis.coordinates[index]
    const next = routeAnalysis.coordinates[index + 1]
    if (!current || !next) continue

    const targetBearing = calculateTravelBearingDegrees(current[1], current[0], next[1], next[0])
    const deltaDegrees = Math.abs(normalizeBearingDelta(baseBearing, targetBearing))
    if (deltaDegrees < TURN_DEGREES_THRESHOLD) continue

    const strength = deltaDegrees >= STRONG_TURN_DEGREES_THRESHOLD ? 'strong' : 'turn'
    const anticipationFactor = clamp(
      1 - (distanceMeters - TURN_BLEND_END_DISTANCE_METERS) / Math.max(1, TURN_BLEND_START_DISTANCE_METERS - TURN_BLEND_END_DISTANCE_METERS),
      0.2,
      strength === 'strong' ? 0.92 : 0.75,
    )

    return {
      distanceMeters,
      deltaDegrees,
      currentBearing: baseBearing,
      targetBearing,
      anticipatedBearing: blendBearing(baseBearing, targetBearing, anticipationFactor),
      strength,
    }
  }

  return null
}

function buildMatchRequestKey(samples: NavigationGpsSample[]) {
  return samples.map((sample) => `${sample.timestamp}:${sample.latitude.toFixed(5)}:${sample.longitude.toFixed(5)}`).join('|')
}

async function fetchMatchedPoint(samples: NavigationGpsSample[], signal: AbortSignal): Promise<RoutePoint | null> {
  if (samples.length < 2) return null

  const coordinates = samples.map((sample) => `${sample.longitude},${sample.latitude}`).join(';')
  const radiuses = samples
    .map((sample) => {
      const accuracy = typeof sample.accuracy === 'number' && Number.isFinite(sample.accuracy) ? sample.accuracy : 20
      return String(Math.round(clamp(accuracy, 5, 50)))
    })
    .join(';')
  const timestamps = samples.map((sample) => String(Math.max(1, Math.round(sample.timestamp / 1000)))).join(';')
  const params = new URLSearchParams({
    overview: 'false',
    geometries: 'geojson',
    radiuses,
    timestamps,
  })

  const response = await fetch(`/osrm/match/v1/driving/${coordinates}?${params.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`osrm_match_failed:${response.status}`)
  }

  const payload = (await response.json().catch(() => null)) as {
    code?: string
    tracepoints?: Array<{ location?: [number, number] | null; distance?: number | null } | null>
  } | null
  if (!payload || payload.code !== 'Ok' || !Array.isArray(payload.tracepoints)) return null

  const tracepoints = payload.tracepoints.filter(
    (tracepoint): tracepoint is { location: [number, number]; distance?: number | null } =>
      Array.isArray(tracepoint?.location) &&
      tracepoint.location.length === 2 &&
      tracepoint.location.every((value) => typeof value === 'number' && Number.isFinite(value)),
  )

  const lastTracepoint = tracepoints[tracepoints.length - 1]
  if (!lastTracepoint) return null

  return {
    latitude: lastTracepoint.location[1],
    longitude: lastTracepoint.location[0],
  }
}

export function createNavigationEngine(options: NavigationEngineOptions = {}) {
  const gpsBufferSize = options.gpsBufferSize ?? DEFAULT_GPS_BUFFER_SIZE
  const correctedBufferSize = options.correctedBufferSize ?? DEFAULT_CORRECTED_BUFFER_SIZE
  const cameraLookaheadMeters = options.cameraLookaheadMeters ?? DEFAULT_CAMERA_LOOKAHEAD_METERS
  const maxMatchIntervalMs = options.maxMatchIntervalMs ?? DEFAULT_MATCH_INTERVAL_MS
  const forcedMatchIntervalMs = options.forcedMatchIntervalMs ?? DEFAULT_FORCED_MATCH_INTERVAL_MS
  const rerouteDistanceMeters = options.rerouteDistanceMeters ?? DEFAULT_REROUTE_DISTANCE_METERS
  const snapDistanceMeters = options.snapDistanceMeters ?? DEFAULT_SNAP_DISTANCE_METERS
  const headingBlendFactor = options.headingBlendFactor ?? DEFAULT_HEADING_BLEND_FACTOR
  let gpsBuffer: NavigationGpsSample[] = []
  let correctedHistory: NavigationGpsSample[] = []
  let lastSnapshot: NavigationEngineSnapshot | null = null
  let lastRouteSignature = ''
  let routeAnalysis: RouteAnalysis | null = null
  let lastProjectionSegmentIndex: number | null = null
  let lastMatchAt = 0
  let lastMatchAnchor: RoutePoint | null = null
  let lastMatchRequestKey = ''
  let activeMatchController: AbortController | null = null
  let lastTurnLogKey = ''
  let lastRerouteLogKey = ''

  function reset() {
    gpsBuffer = []
    correctedHistory = []
    lastSnapshot = null
    routeAnalysis = null
    lastRouteSignature = ''
    lastProjectionSegmentIndex = null
    lastMatchAt = 0
    lastMatchAnchor = null
    lastMatchRequestKey = ''
    lastTurnLogKey = ''
    lastRerouteLogKey = ''
    activeMatchController?.abort()
    activeMatchController = null
  }

  function ensureRouteAnalysis(routeCoordinates: Array<[number, number]> | null | undefined) {
    const normalizedCoordinates = Array.isArray(routeCoordinates) ? routeCoordinates.filter((coordinate) => Array.isArray(coordinate) && coordinate.length === 2) : []
    if (normalizedCoordinates.length < 2) {
      routeAnalysis = null
      lastRouteSignature = ''
      lastProjectionSegmentIndex = null
      return null
    }

    const signature = `${normalizedCoordinates.length}:${normalizedCoordinates[0]?.join(',')}:${normalizedCoordinates[normalizedCoordinates.length - 1]?.join(',')}`
    if (routeAnalysis && signature === lastRouteSignature) return routeAnalysis

    routeAnalysis = buildRouteAnalysis(normalizedCoordinates)
    lastRouteSignature = signature
    lastProjectionSegmentIndex = null
    return routeAnalysis
  }

  async function maybeMatchPoint(rawPoint: NavigationGpsSample, baseDeviationMeters: number | null) {
    if (gpsBuffer.length < 2) return null

    const now = rawPoint.timestamp
    const intervalMs =
      typeof baseDeviationMeters === 'number' && baseDeviationMeters >= MATCH_DEVIATION_DISTANCE_METERS
        ? forcedMatchIntervalMs
        : maxMatchIntervalMs

    const movedSinceLastMatchMeters = lastMatchAnchor ? calculateDistanceMeters(lastMatchAnchor, rawPoint) : Number.POSITIVE_INFINITY
    if (now - lastMatchAt < intervalMs && movedSinceLastMatchMeters < MATCH_MIN_MOVEMENT_METERS) {
      return null
    }

    const samples = gpsBuffer.slice(-Math.min(gpsBufferSize, 6))
    const requestKey = buildMatchRequestKey(samples)
    if (requestKey === lastMatchRequestKey) return null

    activeMatchController?.abort()
    const controller = new AbortController()
    activeMatchController = controller

    try {
      const matchedPoint = await fetchMatchedPoint(samples, controller.signal)
      if (!matchedPoint) return null

      lastMatchAt = now
      lastMatchAnchor = matchedPoint
      lastMatchRequestKey = requestKey
      logNavigation('matched_position', {
        rawLatitude: roundCoordinate(rawPoint.latitude),
        rawLongitude: roundCoordinate(rawPoint.longitude),
        matchedLatitude: roundCoordinate(matchedPoint.latitude),
        matchedLongitude: roundCoordinate(matchedPoint.longitude),
        rawVsMatchedMeters: roundDistance(calculateDistanceMeters(rawPoint, matchedPoint)),
      })
      return matchedPoint
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logNavigation('match_failed', {
          error: (error as Error).message,
        })
      }
      return null
    } finally {
      if (activeMatchController === controller) {
        activeMatchController = null
      }
    }
  }

  async function ingestLocation(input: {
    location: NavigationGpsSample
    routeCoordinates?: Array<[number, number]> | null
  }): Promise<NavigationEngineSnapshot> {
    const route = ensureRouteAnalysis(input.routeCoordinates)
    const rawPoint = input.location
    const previousRawPoint = gpsBuffer[gpsBuffer.length - 1] ?? null
    if (previousRawPoint) {
      const elapsedMs = rawPoint.timestamp - previousRawPoint.timestamp
      const movedMeters = calculateDistanceMeters(previousRawPoint, rawPoint)
      if (elapsedMs > 0 && elapsedMs < MIN_SAMPLE_INTERVAL_MS && movedMeters < MIN_SAMPLE_MOVEMENT_METERS && lastSnapshot) {
        return lastSnapshot
      }
    }

    gpsBuffer = [...gpsBuffer, rawPoint].slice(-gpsBufferSize)

    const rawProjection = route ? projectPointOntoRoute(route, rawPoint, lastProjectionSegmentIndex) : null
    const matchedPoint = await maybeMatchPoint(rawPoint, rawProjection?.distanceMeters ?? null)
    const correctedBasePoint = matchedPoint ?? rawPoint
    const correctedProjection = route ? projectPointOntoRoute(route, correctedBasePoint, rawProjection?.segmentIndex ?? lastProjectionSegmentIndex) : null
    if (correctedProjection) {
      lastProjectionSegmentIndex = correctedProjection.segmentIndex
    }

    const deviationMeters = correctedProjection?.distanceMeters ?? rawProjection?.distanceMeters ?? null
    const rerouteSuggested =
      (typeof deviationMeters === 'number' && deviationMeters > rerouteDistanceMeters) ||
      (rawPoint.accuracy !== null && rawPoint.accuracy > MAX_USABLE_ACCURACY_METERS * 1.4)
    const rerouteReason =
      typeof deviationMeters === 'number' && deviationMeters > rerouteDistanceMeters
        ? 'off_route'
        : rawPoint.accuracy !== null && rawPoint.accuracy > MAX_USABLE_ACCURACY_METERS * 1.4
          ? 'gps_accuracy'
          : null

    const speedMetersPerSecond = estimateSpeedMetersPerSecond(correctedHistory)
    const predictiveLeadMeters =
      speedMetersPerSecond >= 1
        ? clamp(speedMetersPerSecond * 0.9, MIN_PREDICTIVE_LEAD_METERS, MAX_PREDICTIVE_LEAD_METERS)
        : 0

    const correctedPointSource = correctedProjection && correctedProjection.distanceMeters <= snapDistanceMeters
      ? pointAlongRoute(route as RouteAnalysis, correctedProjection.alongRouteMeters + predictiveLeadMeters)
      : correctedBasePoint

    const correctedPoint = {
      latitude: correctedPointSource.latitude,
      longitude: correctedPointSource.longitude,
      accuracy: rawPoint.accuracy,
      heading: rawPoint.heading,
      timestamp: rawPoint.timestamp,
    } satisfies NavigationGpsSample

    correctedHistory = [...correctedHistory, correctedPoint].slice(-correctedBufferSize)

    const segmentBearings: number[] = []
    for (let index = 1; index < correctedHistory.length; index += 1) {
      const previous = correctedHistory[index - 1]
      const current = correctedHistory[index]
      if (!previous || !current) continue
      if (!isAccuracyUsable(previous) || !isAccuracyUsable(current)) continue

      const distanceMeters = calculateDistanceMeters(previous, current)
      if (distanceMeters < MIN_HEADING_DISTANCE_METERS) continue

      segmentBearings.push(
        calculateTravelBearingDegrees(previous.latitude, previous.longitude, current.latitude, current.longitude),
      )
    }

    const averagedBearing = averageBearingDegrees(segmentBearings.slice(-3))
    const heading =
      averagedBearing === null
        ? lastSnapshot?.heading ?? rawPoint.heading ?? null
        : typeof lastSnapshot?.heading === 'number'
          ? blendBearing(lastSnapshot.heading, averagedBearing, headingBlendFactor)
          : averagedBearing

    const turnAnticipation =
      route && correctedProjection
        ? detectUpcomingTurn(
            route,
            correctedProjection.distanceMeters <= snapDistanceMeters
              ? { ...correctedProjection, alongRouteMeters: correctedProjection.alongRouteMeters + predictiveLeadMeters }
              : correctedProjection,
          )
        : null

    const anticipatedHeading =
      turnAnticipation?.anticipatedBearing ??
      (route && correctedProjection
        ? bearingAlongRoute(route, correctedProjection.alongRouteMeters + predictiveLeadMeters, 18) ?? heading
        : heading)
    const resolvedHeading = typeof anticipatedHeading === 'number' && Number.isFinite(anticipatedHeading) ? normalizeHeading(anticipatedHeading) : null
    const routeAheadBearing =
      route && correctedProjection
        ? bearingAlongRoute(route, correctedProjection.alongRouteMeters + predictiveLeadMeters, MAP_BEARING_LOOKAHEAD_METERS)
        : null
    const targetMapBearing =
      typeof routeAheadBearing === 'number' && Number.isFinite(routeAheadBearing)
        ? normalizeHeading(routeAheadBearing)
        : resolvedHeading
    const mapBearing = typeof targetMapBearing === 'number' && Number.isFinite(targetMapBearing) ? targetMapBearing : 0
    const cameraCenter = route && correctedProjection && resolvedHeading !== null
      ? pointAlongRoute(route, correctedProjection.alongRouteMeters + predictiveLeadMeters + cameraLookaheadMeters)
      : resolvedHeading !== null
        ? {
            latitude: correctedPoint.latitude + (Math.cos(toRadians(resolvedHeading)) * cameraLookaheadMeters) / 111_320,
            longitude:
              correctedPoint.longitude +
              (Math.sin(toRadians(resolvedHeading)) * cameraLookaheadMeters) /
                Math.max(1, Math.cos(toRadians(correctedPoint.latitude)) * 111_320),
          }
        : {
            latitude: correctedPoint.latitude,
            longitude: correctedPoint.longitude,
          }

    const nextSnapshot = {
      rawPoint,
      matchedPoint,
      correctedPoint,
      projectedPoint: correctedProjection,
      usedMatch: Boolean(matchedPoint),
      heading: resolvedHeading,
      mapBearing,
      cameraCenter,
      predictiveLeadMeters,
      deviationMeters,
      rerouteSuggested,
      rerouteReason,
      turnAnticipation,
    } satisfies NavigationEngineSnapshot

    logNavigation('position_update', {
      rawLatitude: roundCoordinate(rawPoint.latitude),
      rawLongitude: roundCoordinate(rawPoint.longitude),
      correctedLatitude: roundCoordinate(correctedPoint.latitude),
      correctedLongitude: roundCoordinate(correctedPoint.longitude),
      usedMatch: nextSnapshot.usedMatch,
      predictiveLeadMeters: roundDistance(nextSnapshot.predictiveLeadMeters),
      deviationMeters: roundDistance(nextSnapshot.deviationMeters),
      heading: roundDistance(nextSnapshot.heading),
      mapBearing: roundDistance(nextSnapshot.mapBearing),
    })

    if (turnAnticipation) {
      const nextTurnLogKey = `${Math.round(turnAnticipation.distanceMeters / 5)}:${Math.round(turnAnticipation.deltaDegrees)}:${turnAnticipation.strength}`
      if (nextTurnLogKey !== lastTurnLogKey) {
        lastTurnLogKey = nextTurnLogKey
        logNavigation('turn_anticipation', {
          distanceMeters: roundDistance(turnAnticipation.distanceMeters),
          deltaDegrees: roundDistance(turnAnticipation.deltaDegrees),
          strength: turnAnticipation.strength,
          currentBearing: roundDistance(turnAnticipation.currentBearing),
          targetBearing: roundDistance(turnAnticipation.targetBearing),
          anticipatedBearing: roundDistance(turnAnticipation.anticipatedBearing),
        })
      }
    } else {
      lastTurnLogKey = ''
    }

    if (rerouteSuggested && rerouteReason) {
      const rerouteLogKey = `${rerouteReason}:${Math.round(deviationMeters ?? 0)}`
      if (rerouteLogKey !== lastRerouteLogKey) {
        lastRerouteLogKey = rerouteLogKey
        logNavigation('reroute_needed', {
          reason: rerouteReason,
          deviationMeters: roundDistance(deviationMeters),
          accuracy: rawPoint.accuracy,
        })
      }
    } else {
      lastRerouteLogKey = ''
    }

    lastSnapshot = nextSnapshot
    return nextSnapshot
  }

  return {
    ingestLocation,
    reset,
  }
}

export type NavigationEngine = ReturnType<typeof createNavigationEngine>
