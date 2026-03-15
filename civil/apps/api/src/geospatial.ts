import { prisma, Prisma } from '@civil/db'
import { ensureGeoCache } from './geodata.js'
import { normalizePostalCodeInput } from './communityGeo.js'

const DEFAULT_MAP_TILE_SERVER = 'http://192.168.2.254:8080'
const PUBLIC_MAP_PROXY_BASE = '/maps'

type DistrictQueryRow = {
  code: number
  slug: string
  name: string
  provinceCode: string
  centroidLat: number
  centroidLng: number
  geometryJson: string
  bounds: [number, number, number, number] | string
  matchMethod: 'contains' | 'nearest'
}

type PostalPointRow = {
  code: string
  lat: number | null
  lng: number | null
}

type ExtensionRow = {
  installed: boolean
}

let spatialDataReady: Promise<void> | null = null

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getMapTileServerBaseUrl() {
  const configured = (process.env.MAP_TILE_SERVER || '').trim()
  return trimTrailingSlash(configured || DEFAULT_MAP_TILE_SERVER)
}

export function getPublicMapTileServerBaseUrl() {
  return PUBLIC_MAP_PROXY_BASE
}

export function getMapStyleUrl() {
  return `${getPublicMapTileServerBaseUrl()}/styles/basic-preview/style.json`
}

async function assertPostgisEnabled() {
  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT EXISTS(
      SELECT 1
      FROM pg_extension
      WHERE extname = 'postgis'
    ) AS installed
  `)) as ExtensionRow[]

  if (!rows[0]?.installed) {
    throw new Error('postgis_not_enabled')
  }
}

export async function seedElectoralDistricts(options: { force?: boolean } = {}): Promise<number> {
  await assertPostgisEnabled()

  const existing = await prisma.electoralDistrict.count()
  if (existing > 0 && !options.force) {
    return existing
  }

  const cache = await ensureGeoCache()

  await prisma.$transaction(async (tx: any) => {
    if (options.force && existing > 0) {
      await tx.$executeRawUnsafe('DELETE FROM "ElectoralDistrict"')
    }

    for (const feature of cache.features) {
      const geometryJson = JSON.stringify(feature.geometry)
      const bboxJson = JSON.stringify(feature.bbox)

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ElectoralDistrict" (
          "code",
          "slug",
          "name",
          "provinceCode",
          "centroidLat",
          "centroidLng",
          "bbox",
          "boundaryGeom",
          "centroidGeom",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${feature.community.code},
          ${feature.slug},
          ${feature.community.name},
          ${feature.community.province},
          ${feature.centroid.lat},
          ${feature.centroid.lng},
          CAST(${bboxJson} AS jsonb),
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}), 4326)),
          ST_SetSRID(ST_MakePoint(${feature.centroid.lng}, ${feature.centroid.lat}), 4326),
          NOW(),
          NOW()
        )
        ON CONFLICT ("code") DO UPDATE
        SET
          "slug" = EXCLUDED."slug",
          "name" = EXCLUDED."name",
          "provinceCode" = EXCLUDED."provinceCode",
          "centroidLat" = EXCLUDED."centroidLat",
          "centroidLng" = EXCLUDED."centroidLng",
          "bbox" = EXCLUDED."bbox",
          "boundaryGeom" = EXCLUDED."boundaryGeom",
          "centroidGeom" = EXCLUDED."centroidGeom",
          "updatedAt" = NOW()
      `)
    }
  })

  return cache.features.length
}

export async function ensureSpatialDataReady(): Promise<void> {
  if (spatialDataReady) return spatialDataReady

  spatialDataReady = (async () => {
    await assertPostgisEnabled()
    await seedElectoralDistricts()
  })().catch((error) => {
    spatialDataReady = null
    throw error
  })

  return spatialDataReady
}

async function resolvePointFromPostalCode(postalCode: string) {
  const normalized = normalizePostalCodeInput(postalCode)
  if (!normalized) {
    throw new Error('invalid_postal_code')
  }

  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT
      "code",
      COALESCE(ST_Y("pointGeom"), ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326))) AS lat,
      COALESCE(ST_X("pointGeom"), ST_X(ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326))) AS lng
    FROM "ForwardSortationArea"
    WHERE "code" = ${normalized.fsa}
    LIMIT 1
  `)) as PostalPointRow[]

  const row = rows[0]
  if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
    throw new Error('fsa_not_found')
  }

  return {
    postalCode: normalized.postal,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }
}

async function findElectoralDistrict(lat: number, lng: number) {
  const rows = (await prisma.$queryRaw(Prisma.sql`
    WITH user_point AS (
      SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326) AS geom
    )
    SELECT
      district."code",
      district."slug",
      district."name",
      district."provinceCode",
      district."centroidLat",
      district."centroidLng",
      ST_AsGeoJSON(district."boundaryGeom") AS "geometryJson",
      json_build_array(
        ST_XMin(ST_Envelope(district."boundaryGeom")),
        ST_YMin(ST_Envelope(district."boundaryGeom")),
        ST_XMax(ST_Envelope(district."boundaryGeom")),
        ST_YMax(ST_Envelope(district."boundaryGeom"))
      ) AS bounds,
      CASE
        WHEN ST_Covers(district."boundaryGeom", user_point.geom) THEN 'contains'
        ELSE 'nearest'
      END AS "matchMethod"
    FROM "ElectoralDistrict" AS district
    CROSS JOIN user_point
    WHERE ST_Covers(district."boundaryGeom", user_point.geom)
       OR ST_DWithin(district."boundaryGeom"::geography, user_point.geom::geography, 50000)
    ORDER BY
      CASE WHEN ST_Covers(district."boundaryGeom", user_point.geom) THEN 0 ELSE 1 END ASC,
      district."centroidGeom" <-> user_point.geom ASC
    LIMIT 1
  `)) as DistrictQueryRow[]

  const row = rows[0]
  if (!row) return null

  const parsedBounds = Array.isArray(row.bounds) ? row.bounds : (JSON.parse(row.bounds) as [number, number, number, number])

  return {
    code: row.code,
    slug: row.slug,
    name: row.name,
    provinceCode: row.provinceCode,
    center: {
      lat: Number(row.centroidLat),
      lng: Number(row.centroidLng),
    },
    bounds: parsedBounds,
    geometry: JSON.parse(row.geometryJson) as { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] },
    matchMethod: row.matchMethod,
  }
}

async function upsertUserLocation(args: {
  userId: string
  lat: number
  lng: number
  source: 'coordinates' | 'postal_code'
  postalCode?: string | null
  electoralDistrictCode?: number | null
}) {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "UserLocation" (
      "id",
      "userId",
      "postalCode",
      "latitude",
      "longitude",
      "source",
      "electoralDistrictCode",
      "pointGeom",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${args.userId},
      ${args.postalCode ?? null},
      ${args.lat},
      ${args.lng},
      ${args.source},
      ${args.electoralDistrictCode ?? null},
      ST_SetSRID(ST_MakePoint(${args.lng}, ${args.lat}), 4326),
      NOW(),
      NOW()
    )
    ON CONFLICT ("userId") DO UPDATE
    SET
      "postalCode" = EXCLUDED."postalCode",
      "latitude" = EXCLUDED."latitude",
      "longitude" = EXCLUDED."longitude",
      "source" = EXCLUDED."source",
      "electoralDistrictCode" = EXCLUDED."electoralDistrictCode",
      "pointGeom" = EXCLUDED."pointGeom",
      "updatedAt" = NOW()
  `)
}

export async function resolveElectoralDistrictContext(args: {
  userId: string
  postalCode?: string | null
  lat?: number | null
  lng?: number | null
}) {
  await ensureSpatialDataReady()

  let resolvedFrom: 'coordinates' | 'postal_code'
  let postalCode: string | null = null
  let lat: number
  let lng: number

  if (Number.isFinite(args.lat) && Number.isFinite(args.lng)) {
    resolvedFrom = 'coordinates'
    lat = Number(args.lat)
    lng = Number(args.lng)
    postalCode = args.postalCode?.trim() || null
  } else if (args.postalCode?.trim()) {
    resolvedFrom = 'postal_code'
    const postalPoint = await resolvePointFromPostalCode(args.postalCode)
    postalCode = postalPoint.postalCode
    lat = postalPoint.lat
    lng = postalPoint.lng
  } else {
    throw new Error('postal_or_coordinates_required')
  }

  const district = await findElectoralDistrict(lat, lng)

  await upsertUserLocation({
    userId: args.userId,
    lat,
    lng,
    source: resolvedFrom,
    postalCode,
    electoralDistrictCode: district?.code ?? null,
  })

  return {
    resolvedFrom,
    postalCode,
    tileServerBaseUrl: getPublicMapTileServerBaseUrl(),
    styleUrl: getMapStyleUrl(),
    userLocation: { lat, lng },
    district,
  }
}