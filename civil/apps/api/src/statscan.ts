import proj4 from 'proj4'
import type { MultiPolygon, Polygon } from 'geojson'

type CoordinateTuple = [number, number]

type LambertGeometry = (Polygon | MultiPolygon) & { coordinates: any }

const STATS_CAN_LAMBERT =
  '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=63.390675 +lon_0=-91.8666666666667 +x_0=6200000 +y_0=3000000 +ellps=GRS80 +units=m +no_defs'

const statsCanToWgs84 = proj4(STATS_CAN_LAMBERT, 'EPSG:4326')

function formatCoordinate(value: number): number {
  return Number(value.toFixed(6))
}

function isTuple(value: unknown): value is CoordinateTuple {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function reprojectCoordinates(coords: unknown): unknown {
  if (isTuple(coords)) {
    const [x, y] = coords
    const [lng, lat] = statsCanToWgs84.forward([x, y])
    return [formatCoordinate(lng), formatCoordinate(lat)]
  }
  if (!Array.isArray(coords)) {
    return coords
  }
  return coords.map((entry) => reprojectCoordinates(entry))
}

export function statsCanPointToWgs84(lat?: number | null, lng?: number | null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  try {
    const [convertedLng, convertedLat] = statsCanToWgs84.forward([Number(lng), Number(lat)])
    if (!Number.isFinite(convertedLat) || !Number.isFinite(convertedLng)) return null
    return {
      lat: formatCoordinate(convertedLat),
      lng: formatCoordinate(convertedLng),
    }
  } catch {
    return null
  }
}

export function statsCanGeometryToWgs84(
  geometry: LambertGeometry | null | undefined,
): (Polygon | MultiPolygon) | null {
  if (!geometry || !geometry.type || !geometry.coordinates) return null
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }
  const converted = reprojectCoordinates(geometry.coordinates)
  if (!converted) return null
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: converted as Polygon['coordinates'] }
  }
  return { type: 'MultiPolygon', coordinates: converted as MultiPolygon['coordinates'] }
}

export { STATS_CAN_LAMBERT }
