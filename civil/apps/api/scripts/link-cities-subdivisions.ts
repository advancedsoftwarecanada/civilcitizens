/* eslint-disable no-console */
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import proj4 from 'proj4'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { prisma, type Prisma, type City } from '@civil/db'
import type { ProvinceCode } from '@civil/shared'

const STATS_CAN_LAMBERT =
  '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=63.390675 +lon_0=-91.8666666666667 +x_0=6200000 +y_0=3000000 +ellps=GRS80 +units=m +no_defs'
const projectToStatsCan = proj4('EPSG:4326', STATS_CAN_LAMBERT)
const BBOX_PADDING_DEGREES = Number.parseFloat(process.env.CITY_LINK_BBOX_PADDING ?? '0.05')
const BBOX_PADDING_METERS = (() => {
  const override = Number.parseFloat(process.env.CITY_LINK_BBOX_PADDING_METERS ?? '')
  if (Number.isFinite(override) && override > 0) {
    return override
  }
  if (Number.isFinite(BBOX_PADDING_DEGREES) && BBOX_PADDING_DEGREES > 0) {
    return BBOX_PADDING_DEGREES * 111_000
  }
  return 5_000
})()
const SUMMARY_INTERVAL = Math.max(1, Number.parseInt(process.env.CITY_LINK_LOG_INTERVAL ?? '250', 10) || 250)

type StoredBbox = {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

type NormalizedSubdivision = {
  id: string
  provinceCode: ProvinceCode
  name: string
  geometry: Polygon | MultiPolygon | null
  bbox: StoredBbox | null
  centroidLat: number | null
  centroidLng: number | null
  defaultChamberSlug: string | null
  defaultChamberName: string | null
}

type MatchStrategy = 'polygon' | 'centroid'

type CitySelection = Pick<
  City,
  'id' | 'provinceCode' | 'name' | 'latitude' | 'longitude' | 'censusSubdivisionId' | 'chamberSlug' | 'chamberName'
>

type CityMatch = {
  city: CitySelection
  subdivision: NormalizedSubdivision
  strategy: MatchStrategy
}

type ProjectedPoint = {
  x: number
  y: number
}

type SubdivisionSelection = {
  id: string
  provinceCode: ProvinceCode
  name: string
  geometry: Prisma.JsonValue | null
  bbox: Prisma.JsonValue | null
  centroidLat: number | null
  centroidLng: number | null
  defaultChamberSlug: string | null
  defaultChamberName: string | null
}

async function main() {
  console.log('Loading census subdivisions in province batches…')
  const provinces = await prisma.province.findMany({
    select: { code: true },
    orderBy: { code: 'asc' },
  })
  if (!provinces.length) {
    throw new Error('No provinces found. Run seed:admin before linking cities.')
  }

  const subdivisionsByProvince = new Map<ProvinceCode, NormalizedSubdivision[]>()
  let normalizedCount = 0
  for (const province of provinces as { code: ProvinceCode }[]) {
    const rows = await prisma.censusSubdivision.findMany({
      where: { provinceCode: province.code },
      select: {
        id: true,
        provinceCode: true,
        name: true,
        geometry: true,
        bbox: true,
        centroidLat: true,
        centroidLng: true,
        defaultChamberSlug: true,
        defaultChamberName: true,
      },
    })
    if (!rows.length) continue
    const list = subdivisionsByProvince.get(province.code) ?? []
    for (const row of rows as SubdivisionSelection[]) {
      const normalized = normalizeSubdivision(row)
      if (!normalized) continue
      normalizedCount += 1
      list.push(normalized)
    }
    subdivisionsByProvince.set(province.code, list)
    console.log(`Prepared ${list.length} subdivisions for ${province.code}`)
  }
  if (!normalizedCount) {
    throw new Error('No census subdivisions found. Run seed:admin before linking cities.')
  }
  console.log(`Prepared ${normalizedCount} subdivisions across ${subdivisionsByProvince.size} provinces/territories`)

  console.log('Loading cities…')
  const cities = await prisma.city.findMany({
    select: {
      id: true,
      name: true,
      provinceCode: true,
      latitude: true,
      longitude: true,
      censusSubdivisionId: true,
      chamberSlug: true,
      chamberName: true,
    },
    orderBy: { provinceCode: 'asc' },
  })
  if (!cities.length) {
    console.log('No cities found; nothing to link.')
    await prisma.$disconnect()
    return
  }
  console.log(`Loaded ${cities.length} cities`)

  const matches: CityMatch[] = []
  const alreadyLinked: CitySelection[] = []
  const unmatched: CitySelection[] = []
  let polygonMatches = 0
  let centroidMatches = 0

  for (const city of cities as CitySelection[]) {
    const projected = projectCity(city)
    if (!projected) {
      unmatched.push(city)
      continue
    }
    const subdivisions = subdivisionsByProvince.get(city.provinceCode as ProvinceCode)
    if (!subdivisions || subdivisions.length === 0) {
      unmatched.push(city)
      continue
    }
    const match = findSubdivisionForCity(city, subdivisions, projected)
    if (!match) {
      unmatched.push(city)
      continue
    }
    if (city.censusSubdivisionId === match.subdivision.id) {
      alreadyLinked.push(city as City)
      continue
    }
    matches.push({ city, subdivision: match.subdivision, strategy: match.strategy })
    if (match.strategy === 'polygon') polygonMatches += 1
    else centroidMatches += 1

    if (matches.length > 0 && matches.length % SUMMARY_INTERVAL === 0) {
      console.log(
        `Matched ${matches.length} cities so far… (${polygonMatches} polygon / ${centroidMatches} centroid)`,
      )
    }
  }

  console.log(`Matched ${matches.length} cities (${polygonMatches} polygon hits, ${centroidMatches} centroid fallbacks).`)
  console.log(`${alreadyLinked.length} cities already pointed at the correct subdivision.`)
  console.log(`${unmatched.length} cities still unlinked.`)

  if (!matches.length) {
    console.log('Nothing to update; exiting.')
    await prisma.$disconnect()
    return
  }

  console.log('Persisting city updates in batches…')
  const BATCH_SIZE = 200
  for (let i = 0; i < matches.length; i += BATCH_SIZE) {
    const chunk = matches.slice(i, i + BATCH_SIZE)
    await prisma.$transaction(async (tx) => {
      for (const entry of chunk) {
        await tx.city.update({
          where: { id: entry.city.id },
          data: buildCityUpdate(entry),
        })
      }
    })
  }

  console.log('City linking complete.')
  if (unmatched.length) {
    console.warn('Remaining unmatched cities:')
    for (const city of unmatched) {
      console.warn(` - ${city.name} (${city.provinceCode}) @ ${city.latitude},${city.longitude}`)
    }
  }

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Failed to link cities to subdivisions:', error)
  prisma.$disconnect().catch(() => {
    /* noop */
  })
  process.exitCode = 1
})

function buildCityUpdate(entry: CityMatch): Prisma.CityUpdateInput {
  const data: Prisma.CityUpdateInput = {
    censusSubdivisionId: entry.subdivision.id,
  }
  if (
    entry.subdivision.defaultChamberSlug &&
    entry.subdivision.defaultChamberName &&
    entry.subdivision.defaultChamberSlug !== entry.city.chamberSlug
  ) {
    data.chamberSlug = entry.subdivision.defaultChamberSlug
    data.chamberName = entry.subdivision.defaultChamberName
    data.matchMethod = 'geofenced'
    data.matchConfidence = 'high'
    data.matchDistanceKm = null
  }
  return data
}

type MatchResult = {
  subdivision: NormalizedSubdivision
  strategy: MatchStrategy
}

function findSubdivisionForCity(
  city: CitySelection,
  subdivisions: NormalizedSubdivision[],
  projected: ProjectedPoint,
): MatchResult | null {
  const cityPoint = point([projected.x, projected.y]) as Feature
  return (
    attemptSubdivisionMatch(cityPoint, projected, subdivisions, true) ??
    attemptSubdivisionMatch(cityPoint, projected, subdivisions, false)
  )
}

function attemptSubdivisionMatch(
  cityPoint: Feature,
  projected: ProjectedPoint,
  subdivisions: NormalizedSubdivision[],
  respectBbox: boolean,
): MatchResult | null {
  let closest: NormalizedSubdivision | null = null
  let closestScore = Number.POSITIVE_INFINITY
  for (const subdivision of subdivisions) {
    if (
      respectBbox &&
      subdivision.bbox &&
      !pointWithinBbox(subdivision.bbox, projected.y, projected.x, BBOX_PADDING_METERS)
    ) {
      continue
    }
    if (subdivision.geometry && booleanPointInPolygon(cityPoint, subdivision.geometry)) {
      return { subdivision, strategy: 'polygon' }
    }
    if (subdivision.centroidLat != null && subdivision.centroidLng != null) {
      const score = distanceScore(
        projected.y,
        projected.x,
        subdivision.centroidLat,
        subdivision.centroidLng,
      )
      if (score < closestScore) {
        closest = subdivision
        closestScore = score
      }
    }
  }
  if (closest) {
    return { subdivision: closest, strategy: 'centroid' }
  }
  return null
}

function projectCity(city: CitySelection): ProjectedPoint | null {
  if (!Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) {
    return null
  }
  try {
    const [x, y] = projectToStatsCan.forward([city.longitude, city.latitude])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }
    return { x, y }
  } catch (error) {
    console.warn(`Failed to project city ${city.name} (${city.id})`, error)
    return null
  }
}

function normalizeSubdivision(row: SubdivisionSelection): NormalizedSubdivision | null {
  const geometry = toGeometry(row.geometry)
  const bbox = toBbox(row.bbox)
  if (!geometry && !bbox) {
    // Without geometry we cannot safely match; skip record
    return null
  }
  return {
    id: row.id,
    provinceCode: row.provinceCode,
    name: row.name,
    geometry,
    bbox,
    centroidLat: row.centroidLat,
    centroidLng: row.centroidLng,
    defaultChamberSlug: row.defaultChamberSlug,
    defaultChamberName: row.defaultChamberName,
  }
}

function toGeometry(value: Prisma.JsonValue | null): Polygon | MultiPolygon | null {
  if (!value || typeof value !== 'object') return null
  const maybe = value as { type?: unknown; coordinates?: unknown }
  if (maybe.type === 'Polygon') {
    return maybe as Polygon
  }
  if (maybe.type === 'MultiPolygon') {
    return maybe as MultiPolygon
  }
  return null
}

function toBbox(value: Prisma.JsonValue | null): StoredBbox | null {
  if (!value || typeof value !== 'object') return null
  const maybe = value as Partial<StoredBbox>
  if (
    typeof maybe.minLat === 'number' &&
    typeof maybe.minLng === 'number' &&
    typeof maybe.maxLat === 'number' &&
    typeof maybe.maxLng === 'number'
  ) {
    return {
      minLat: maybe.minLat,
      minLng: maybe.minLng,
      maxLat: maybe.maxLat,
      maxLng: maybe.maxLng,
    }
  }
  return null
}

function pointWithinBbox(bbox: StoredBbox, lat: number, lng: number, padding: number): boolean {
  return (
    lat >= bbox.minLat - padding &&
    lat <= bbox.maxLat + padding &&
    lng >= bbox.minLng - padding &&
    lng <= bbox.maxLng + padding
  )
}

function distanceScore(latA: number, lngA: number, latB: number, lngB: number): number {
  const dLat = latA - latB
  const dLng = lngA - lngB
  return dLat * dLat + dLng * dLng
}
