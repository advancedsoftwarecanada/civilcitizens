import { point, polygon, multiPolygon } from '@turf/helpers'
// Minimal local types to avoid importing from 'geojson' in Docker builds
type GeoJsonProperties = Record<string, any>
type GeoPoint = { type: 'Point'; coordinates: [number, number] }
type Polygon = { type: 'Polygon'; coordinates: any[] }
type MultiPolygon = { type: 'MultiPolygon'; coordinates: any[] }
type Feature<G = any, P = GeoJsonProperties> = { type: 'Feature'; geometry: G | null; properties: P }
type FeatureCollection = { type: 'FeatureCollection'; features: Array<Feature<Polygon | MultiPolygon, any>> }
import { findChamber, findChamberByCode, findChambersBySlug, slugifyChamberName } from '@civil/shared'
// Use local structural types to avoid cross-package type resolution issues in Docker builds
type ProvinceCodeLocal =
  | 'nl' | 'pe' | 'ns' | 'nb' | 'qc' | 'on' | 'mb' | 'sk' | 'ab' | 'bc' | 'yt' | 'nt' | 'nu'
type ChamberRecordLocal = { code: number; name: string; slug: string; province: ProvinceCodeLocal }
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const unzipper = require('unzipper') as typeof import('unzipper')
import { read as readShapefile } from 'shapefile'
import proj4 from 'proj4'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import turfCentroid from '@turf/centroid'
import turfDistance from '@turf/distance'
import pointToPolygonDistance from '@turf/point-to-polygon-distance'

const DEFAULT_SHP_URL = 'https://elections.ca/res/cir/mapsCorner/vector/FederalElectoralDistricts_2025_SHP.zip'

const MOJIBAKE_MAP: Record<string, string> = {
  'â€”': '—',
  'â€“': '–',
  'â€™': '’',
  'â€˜': '‘',
  'â€œ': '“',
  'â€\u009d': '”',
  'â€¢': '•',
  'Ã©': 'é',
  'Ã¨': 'è',
  'Ãª': 'ê',
  'Ã«': 'ë',
  'Ã´': 'ô',
  'Ã¶': 'ö',
  'Ã¢': 'â',
  'Ã¤': 'ä',
  'Ã®': 'î',
  'Ã¯': 'ï',
  'Ã‡': 'Ç',
  'Ã§': 'ç',
  'Ã¹': 'ù',
  'Ã»': 'û',
  'Ã¼': 'ü'
}

function fixMojibake(value: string): string {
  let output = value
  for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
    if (output.includes(bad)) {
      output = output.split(bad).join(good)
    }
  }
  return output
}

const PROVINCE_BY_PRUID: Record<string, ProvinceCodeLocal> = {
  '10': 'nl',
  '11': 'pe',
  '12': 'ns',
  '13': 'nb',
  '24': 'qc',
  '35': 'on',
  '46': 'mb',
  '47': 'sk',
  '48': 'ab',
  '59': 'bc',
  '60': 'yt',
  '61': 'nt',
  '62': 'nu',
}

type ProcessedFeature = {
  chamber: ChamberRecordLocal
  slug: string
  geometry: Polygon | MultiPolygon
  feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>
  centroid: { lat: number; lng: number }
  centroidPoint: Feature<GeoPoint>
  bbox: [number, number, number, number]
}

type GeoCache = {
  features: ProcessedFeature[]
  fetchedAt: string
  sourceUrl: string
  cached: boolean
}

type GeoCacheHolder = {
  promise: Promise<GeoCache> | null
  value: GeoCache | null
}

const cache: GeoCacheHolder = {
  promise: null,
  value: null,
}

const BOUNDARY_TOLERANCE_KM = 0.05
const DEFAULT_BBOX_PADDING_DEGREES = 0.2

function getConfiguredShapefileUrl(): string {
  return process.env.FEDERAL_SHP_URL?.trim() || DEFAULT_SHP_URL
}

function extendBBox(coords: any, bbox?: [number, number, number, number]): [number, number, number, number] {
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [lng, lat] = coords as [number, number]
    if (!bbox) return [lng, lat, lng, lat]
    if (lng < bbox[0]) bbox[0] = lng
    if (lat < bbox[1]) bbox[1] = lat
    if (lng > bbox[2]) bbox[2] = lng
    if (lat > bbox[3]) bbox[3] = lat
    return bbox
  }
  if (!Array.isArray(coords)) {
    throw new Error('Invalid coordinate structure while computing bbox')
  }
  return (coords as any[]).reduce<[number, number, number, number]>((acc, sub) => extendBBox(sub, acc), bbox ?? [Infinity, Infinity, -Infinity, -Infinity])
}

function pointWithinExpandedBBox(bbox: [number, number, number, number], lng: number, lat: number, paddingDegrees: number) {
  const [minLng, minLat, maxLng, maxLat] = bbox
  return (
    lng >= minLng - paddingDegrees &&
    lng <= maxLng + paddingDegrees &&
    lat >= minLat - paddingDegrees &&
    lat <= maxLat + paddingDegrees
  )
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return fixMojibake(value)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function reprojectCoords(coords: any, converter: proj4.Converter | null): any {
  if (!converter) return coords
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [x, y] = coords as [number, number]
    const [lng, lat] = converter.forward([x, y])
    return [lng, lat]
  }
  if (!Array.isArray(coords)) {
    throw new Error('Invalid coordinate structure while reprojecting geometry')
  }
  return coords.map((sub) => reprojectCoords(sub, converter))
}

async function fetchShapefileBuffers(sourceUrl: string) {
  const res = await fetch(sourceUrl)
  if (!res.ok) {
    throw new Error(`Failed to download shapefile ZIP (${res.status})`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const directory = await unzipper.Open.buffer(buffer)

  let shpBuffer: Buffer | null = null
  let dbfBuffer: Buffer | null = null
  let prjBuffer: Buffer | null = null

  for (const file of directory.files) {
    if (file.path.toLowerCase().endsWith('.shp')) {
      shpBuffer = await file.buffer()
    } else if (file.path.toLowerCase().endsWith('.dbf')) {
      dbfBuffer = await file.buffer()
    } else if (file.path.toLowerCase().endsWith('.prj')) {
      prjBuffer = await file.buffer()
    }
  }

  if (!shpBuffer || !dbfBuffer) {
    throw new Error('Shapefile archive did not contain .shp and .dbf files')
  }

  return { shpBuffer, dbfBuffer, prjString: prjBuffer?.toString('utf8') ?? null }
}

function provinceFromProperties(props: GeoJsonProperties | null | undefined): ProvinceCodeLocal | null {
  if (!props) return null
  const pruidRaw = props.PRUID ?? props.PRUID_FED ?? props.PRUID_E
  if (typeof pruidRaw === 'string' || typeof pruidRaw === 'number') {
    const key = typeof pruidRaw === 'number' ? pruidRaw.toString() : pruidRaw
    const normalized = key.padStart(2, '0').slice(0, 2)
    return PROVINCE_BY_PRUID[normalized] ?? null
  }
  return null
}

function resolveChamberForFeature(feature: Feature, slug: string): ChamberRecordLocal | null {
  const props = feature.properties ?? null
  const code = props ? parseNumeric(props.ED_UID ?? props.FEDUID ?? props.ED_CODE ?? props.FED_ID ?? props.EDNUMBER) : null
  if (code !== null) {
    const match = findChamberByCode(code)
    if (match) return match
  }

  const provinceFromFeature = provinceFromProperties(props)
  const normalizedSlug = slugifyChamberName(slug)
  if (provinceFromFeature) {
    const candidate = findChamber(provinceFromFeature, normalizedSlug)
    if (candidate) return candidate
  }

  const all = findChambersBySlug(normalizedSlug)
  if (all.length === 1) return all[0] ?? null
  if (all.length > 1 && provinceFromFeature) {
    return all.find((entry: ChamberRecordLocal) => entry.province === provinceFromFeature) ?? null
  }
  return all.length > 0 ? all[0]! : null
}

async function buildGeoCache(): Promise<GeoCache> {
  const sourceUrl = getConfiguredShapefileUrl()
  const { shpBuffer, dbfBuffer, prjString } = await fetchShapefileBuffers(sourceUrl)

  const geoJson = (await readShapefile(shpBuffer, dbfBuffer)) as FeatureCollection
  const converter = prjString ? proj4(prjString, 'EPSG:4326') : null

  const features: ProcessedFeature[] = []

  for (const feature of geoJson.features) {
    if (!feature || !feature.geometry) continue
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue

    const nameCandidate = normalizeName(feature.properties?.ED_NAMEE ?? feature.properties?.FEDENAME ?? feature.properties?.FEDENAMEE ?? feature.properties?.FEDENAMEF ?? feature.properties?.EDNAMEE)
    if (!nameCandidate) continue
    const slug = slugifyChamberName(nameCandidate)

    const chamber = resolveChamberForFeature(feature, slug)
    if (!chamber) {
      continue
    }

    const reprojectedCoordinates = converter ? reprojectCoords(feature.geometry.coordinates, converter) : feature.geometry.coordinates

    const geometry = feature.geometry.type === 'Polygon'
      ? ({ type: 'Polygon', coordinates: reprojectedCoordinates } as Polygon)
      : ({ type: 'MultiPolygon', coordinates: reprojectedCoordinates } as MultiPolygon)

    const turfFeature: Feature<Polygon | MultiPolygon, GeoJsonProperties> =
      geometry.type === 'Polygon'
        ? (polygon(geometry.coordinates) as unknown as Feature<Polygon, GeoJsonProperties>)
        : (multiPolygon(geometry.coordinates) as unknown as Feature<MultiPolygon, GeoJsonProperties>)

    let bbox: [number, number, number, number]
    try {
      bbox = extendBBox(geometry.coordinates)
    } catch (err) {
      // Skip malformed geometries
      continue
    }

  const centroidFeature = turfCentroid(turfFeature as any) as Feature<GeoPoint, GeoJsonProperties>
  const centroidGeometry = centroidFeature.geometry as GeoPoint
    if (!centroidGeometry || centroidGeometry.type !== 'Point') {
      continue
    }
  const [centroidLng, centroidLat] = centroidGeometry.coordinates as [number, number]

    features.push({
      chamber,
      slug,
      geometry,
      feature: turfFeature,
      centroid: { lat: centroidLat, lng: centroidLng },
  centroidPoint: point([centroidLng, centroidLat]) as Feature<GeoPoint>,
      bbox,
    })
  }

  return {
    features,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    cached: false,
  }
}

export async function ensureGeoCache(): Promise<GeoCache> {
  if (cache.value) {
    return { ...cache.value, cached: true }
  }
  if (!cache.promise) {
    cache.promise = buildGeoCache()
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

function confidenceFromDistance(distanceKm: number, method: 'geofenced' | 'nearest'): 'high' | 'medium' | 'low' {
  if (method === 'geofenced') return 'high'
  if (distanceKm <= 10) return 'high'
  if (distanceKm <= 40) return 'medium'
  return 'low'
}

type LocateOptions = {
  limit?: number
  paddingDegrees?: number
}

type GeoMatch = {
  province: ProvinceCodeLocal
  chamberSlug: string
  chamberName: string
  method: 'geofenced' | 'nearest'
  confidence: 'high' | 'medium' | 'low'
  distanceKm?: number
}

function buildMatch(feature: ProcessedFeature, method: 'geofenced' | 'nearest', distanceKm: number | undefined): GeoMatch {
  return {
    province: feature.chamber.province,
    chamberSlug: feature.chamber.slug,
    chamberName: feature.chamber.name,
    method,
    confidence: confidenceFromDistance(distanceKm ?? 0, method),
    distanceKm: distanceKm !== undefined ? Number(distanceKm.toFixed(1)) : undefined,
  }
}

export async function locateChamberFromPoint(lat: number, lng: number, options: LocateOptions = {}) {
  const { features, fetchedAt, sourceUrl, cached } = await ensureGeoCache()
  const limit = Math.max(1, Math.min(options.limit ?? 8, 25))
  const targetPoint = point([lng, lat])
  const paddingDegrees = options.paddingDegrees ?? DEFAULT_BBOX_PADDING_DEGREES

  type FeatureScore = {
    feature: ProcessedFeature
    centroidDistanceKm: number
    polygonDistanceKm: number
    inside: boolean
  }

  const scored: FeatureScore[] = []
  const insideMatches: FeatureScore[] = []

  for (const pf of features) {
    const centroidDistanceKm = turfDistance(targetPoint, pf.centroidPoint, { units: 'kilometers' })
    const polygonDistanceRaw = pointToPolygonDistance(targetPoint as any, pf.feature as any, { units: 'kilometers' })
    const polygonDistanceKm = Math.max(0, polygonDistanceRaw)
    let inside = false

    if (pointWithinExpandedBBox(pf.bbox, lng, lat, paddingDegrees)) {
      inside = booleanPointInPolygon(targetPoint as any, pf.feature as any)
      if (!inside && polygonDistanceRaw <= BOUNDARY_TOLERANCE_KM) {
        inside = true
      }
    }

    const entry: FeatureScore = { feature: pf, centroidDistanceKm, polygonDistanceKm, inside }
    scored.push(entry)
    if (inside) insideMatches.push(entry)
  }

  let primary: GeoMatch | null = null
  const alternatives: GeoMatch[] = []

  if (insideMatches.length) {
    insideMatches.sort((a, b) => a.polygonDistanceKm - b.polygonDistanceKm)
    const winner = insideMatches[0]
    if (winner) {
      primary = buildMatch(winner.feature, 'geofenced', winner.polygonDistanceKm)

      const altPool = scored
        .filter((entry) => entry.feature !== winner.feature)
        .sort((a, b) => a.centroidDistanceKm - b.centroidDistanceKm)

      for (const entry of altPool) {
        if (alternatives.length >= limit - 1) break
        const method: GeoMatch['method'] = entry.inside ? 'geofenced' : 'nearest'
        const distance = entry.inside ? entry.polygonDistanceKm : entry.centroidDistanceKm
        alternatives.push(buildMatch(entry.feature, method, distance))
      }
    }
  } else {
    const sortedFallback = scored.sort((a, b) => a.centroidDistanceKm - b.centroidDistanceKm)
    const winner = sortedFallback[0]
    if (winner) {
      primary = buildMatch(winner.feature, 'nearest', winner.centroidDistanceKm)
      for (let idx = 1; idx < sortedFallback.length && alternatives.length < limit - 1; idx += 1) {
        const entry = sortedFallback[idx]
        if (!entry) continue
        const method: GeoMatch['method'] = entry.inside ? 'geofenced' : 'nearest'
        const distance = entry.inside ? entry.polygonDistanceKm : entry.centroidDistanceKm
        alternatives.push(buildMatch(entry.feature, method, distance))
      }
    }
  }

  return {
    primary,
    alternatives,
    meta: {
      fetchedAt,
      source: sourceUrl,
      cached,
      features: features.length,
    },
  }
}
