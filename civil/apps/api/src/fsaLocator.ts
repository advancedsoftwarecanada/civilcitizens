import { prisma } from '@civil/db'
import { point, polygon, multiPolygon } from '@turf/helpers'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import pointToPolygonDistance from '@turf/point-to-polygon-distance'
import turfCentroid from '@turf/centroid'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { statsCanGeometryToWgs84, statsCanPointToWgs84 } from './statscan.js'

const DEFAULT_PADDING_DEGREES = 0.25
const BOUNDARY_TOLERANCE_KM = 1.25
const NEAREST_LIMIT_KM = 40

type CachedFsa = {
  code: string
  provinceCode: string | null
  subdivisionId: string | null
  subdivisionName: string | null
  defaultCommunitySlug: string | null
  defaultCommunityName: string | null
  centroid: { lat: number; lng: number } | null
  feature: Feature<Polygon | MultiPolygon>
  bbox: [number, number, number, number]
}

type FsaCache = {
  features: CachedFsa[]
  fetchedAt: string
  cached: boolean
}

type CacheHolder = {
  value: FsaCache | null
  promise: Promise<FsaCache> | null
}

const cache: CacheHolder = {
  value: null,
  promise: null,
}

type LocateOptions = {
  paddingDegrees?: number
  boundaryToleranceKm?: number
  nearestLimitKm?: number
}

type LocatedFsa = {
  code: string
  provinceCode: string | null
  subdivisionId: string | null
  subdivisionName: string | null
  centroidLat: number | null
  centroidLng: number | null
  defaultCommunitySlug: string | null
  defaultCommunityName: string | null
  distanceKm: number | null
  method: 'polygon' | 'nearest'
}

type LocateResult = {
  match: LocatedFsa | null
  meta: { cached: boolean; fetchedAt: string; totalFsas: number }
}

function extendBBox(coords: unknown, bbox?: [number, number, number, number]): [number, number, number, number] {
  if (Array.isArray(coords)) {
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = Number(coords[0])
      const lat = Number(coords[1])
      const next: [number, number, number, number] = bbox ?? [lng, lat, lng, lat]
      if (lng < next[0]) next[0] = lng
      if (lat < next[1]) next[1] = lat
      if (lng > next[2]) next[2] = lng
      if (lat > next[3]) next[3] = lat
      return next
    }
    return coords.reduce<[number, number, number, number]>((acc, value) => extendBBox(value, acc), bbox ?? [Infinity, Infinity, -Infinity, -Infinity])
  }
  return bbox ?? [Infinity, Infinity, -Infinity, -Infinity]
}

function normalizeBBox(bbox: [number, number, number, number]): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    throw new Error('Invalid bbox produced during FSA cache build')
  }
  return [Number(minLng.toFixed(6)), Number(minLat.toFixed(6)), Number(maxLng.toFixed(6)), Number(maxLat.toFixed(6))]
}

function pointWithinExpandedBBox(bbox: [number, number, number, number], lng: number, lat: number, padding: number) {
  const [minLng, minLat, maxLng, maxLat] = bbox
  return (
    lng >= minLng - padding &&
    lng <= maxLng + padding &&
    lat >= minLat - padding &&
    lat <= maxLat + padding
  )
}

async function buildFsaCache(): Promise<FsaCache> {
  const rows = await prisma.forwardSortationArea.findMany({
    select: {
      code: true,
      provinceCode: true,
      subdivisionId: true,
      subdivisionName: true,
      centroidLat: true,
      centroidLng: true,
      geometry: true,
      bbox: true,
      defaultCommunitySlug: true,
      defaultCommunityName: true,
    },
    orderBy: { code: 'asc' },
  })

  const features: CachedFsa[] = []

  for (const row of rows) {
    const reprojected = statsCanGeometryToWgs84(row.geometry as any)
    if (!reprojected) continue
    const geoFeature =
      reprojected.type === 'Polygon'
        ? (polygon(reprojected.coordinates) as Feature<Polygon>)
        : (multiPolygon(reprojected.coordinates) as Feature<MultiPolygon>)
    let bbox: [number, number, number, number]
    try {
      bbox = normalizeBBox(extendBBox(reprojected.coordinates))
    } catch {
      continue
    }
    let centroidPoint = statsCanPointToWgs84(row.centroidLat, row.centroidLng)
    if (!centroidPoint) {
      try {
        const derived = turfCentroid(geoFeature as any)
        const coords = derived.geometry?.coordinates
        if (Array.isArray(coords) && coords.length >= 2) {
          centroidPoint = { lat: Number(coords[1].toFixed(6)), lng: Number(coords[0].toFixed(6)) }
        }
      } catch {
        /* ignore */
      }
    }
    features.push({
      code: row.code,
      provinceCode: row.provinceCode ?? null,
      subdivisionId: row.subdivisionId ?? null,
      subdivisionName: row.subdivisionName ?? null,
      defaultCommunitySlug: row.defaultCommunitySlug ?? null,
      defaultCommunityName: row.defaultCommunityName ?? null,
      centroid: centroidPoint ?? null,
      feature: geoFeature,
      bbox,
    })
  }

  return {
    features,
    fetchedAt: new Date().toISOString(),
    cached: false,
  }
}

export async function ensureFsaCache(): Promise<FsaCache> {
  if (cache.value) {
    return { ...cache.value, cached: true }
  }
  if (!cache.promise) {
    cache.promise = buildFsaCache()
      .then((value) => {
        cache.value = value
        return value
      })
      .catch((error) => {
        cache.promise = null
        throw error
      })
  }
  return cache.promise
}

type Candidate = {
  feature: CachedFsa
  distanceKm: number
  inside: boolean
}

function formatDistance(value: number): number {
  return Number(value.toFixed(2))
}

export async function locateFsaFromPoint(lat: number, lng: number, options: LocateOptions = {}): Promise<LocateResult> {
  const { features, fetchedAt, cached } = await ensureFsaCache()
  const padding = options.paddingDegrees ?? DEFAULT_PADDING_DEGREES
  const tolerance = options.boundaryToleranceKm ?? BOUNDARY_TOLERANCE_KM
  const nearestLimit = options.nearestLimitKm ?? NEAREST_LIMIT_KM
  const targetPoint = point([lng, lat])

  let insideMatch: Candidate | null = null
  let nearestMatch: Candidate | null = null

  for (const entry of features) {
    if (!pointWithinExpandedBBox(entry.bbox, lng, lat, padding)) continue
    let distance = Number.POSITIVE_INFINITY
    let inside = false
    try {
      distance = pointToPolygonDistance(targetPoint as any, entry.feature as any, { units: 'kilometers' })
      inside = distance <= tolerance || booleanPointInPolygon(targetPoint as any, entry.feature as any)
    } catch {
      continue
    }
    const candidate: Candidate = {
      feature: entry,
      distanceKm: formatDistance(Math.max(0, distance)),
      inside,
    }
    if (candidate.inside) {
      if (!insideMatch || candidate.distanceKm < insideMatch.distanceKm) {
        insideMatch = candidate
      }
    } else if (!nearestMatch || candidate.distanceKm < nearestMatch.distanceKm) {
      nearestMatch = candidate
    }
  }

  let winner: Candidate | null = insideMatch
  if (!winner && nearestMatch && nearestMatch.distanceKm <= nearestLimit) {
    winner = nearestMatch
  }

  if (!winner) {
    return { match: null, meta: { cached, fetchedAt, totalFsas: features.length } }
  }

  const centroidLat = winner.feature.centroid?.lat ?? null
  const centroidLng = winner.feature.centroid?.lng ?? null

  const located: LocatedFsa = {
    code: winner.feature.code,
    provinceCode: winner.feature.provinceCode,
    subdivisionId: winner.feature.subdivisionId,
    subdivisionName: winner.feature.subdivisionName,
    centroidLat,
    centroidLng,
    defaultCommunitySlug: winner.feature.defaultCommunitySlug,
    defaultCommunityName: winner.feature.defaultCommunityName,
    distanceKm: winner.inside ? null : Number(winner.distanceKm.toFixed(2)),
    method: winner.inside ? 'polygon' : 'nearest',
  }

  return {
    match: located,
    meta: { cached, fetchedAt, totalFsas: features.length },
  }
}
