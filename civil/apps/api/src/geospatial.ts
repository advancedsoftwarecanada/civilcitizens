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

type DistrictStatsCount = {
  provinceCode: string
  communitySlug: string
  _count: {
    _all: number
  }
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
  }, {
    maxWait: 30_000,
    timeout: 10 * 60 * 1000,
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

async function findElectoralDistrictBySlug(provinceCode: string, communitySlug: string) {
  const rows = (await prisma.$queryRaw(Prisma.sql`
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
      ) AS bounds
    FROM "ElectoralDistrict" AS district
    WHERE district."provinceCode" = ${provinceCode}
      AND district."slug" = ${communitySlug}
    LIMIT 1
  `)) as Array<Omit<DistrictQueryRow, 'matchMethod'> & { bounds: [number, number, number, number] | string }>

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
    matchMethod: null as 'contains' | 'nearest' | null,
  }
}

async function listElectoralDistrictsForProvince(args: {
  provinceCode: string
  lat?: number | null
  lng?: number | null
  selectedDistrictCode?: number | null
}) {
  const hasPoint = Number.isFinite(args.lat) && Number.isFinite(args.lng)

  if (hasPoint) {
    const rows = (await prisma.$queryRaw(Prisma.sql`
      WITH reference_point AS (
        SELECT ST_SetSRID(ST_MakePoint(${Number(args.lng)}, ${Number(args.lat)}), 4326) AS geom
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
          WHEN ST_Covers(district."boundaryGeom", reference_point.geom) THEN 'contains'
          ELSE 'nearest'
        END AS "matchMethod"
      FROM "ElectoralDistrict" AS district
      CROSS JOIN reference_point
      WHERE district."provinceCode" = ${args.provinceCode}
      ORDER BY
        CASE WHEN district."code" = ${args.selectedDistrictCode ?? -1} THEN 0 ELSE 1 END ASC,
        CASE WHEN ST_Covers(district."boundaryGeom", reference_point.geom) THEN 0 ELSE 1 END ASC,
        district."centroidGeom" <-> reference_point.geom ASC
    `)) as DistrictQueryRow[]

    return rows.map((row) => ({
      code: row.code,
      slug: row.slug,
      name: row.name,
      provinceCode: row.provinceCode,
      center: {
        lat: Number(row.centroidLat),
        lng: Number(row.centroidLng),
      },
      bounds: Array.isArray(row.bounds) ? row.bounds : (JSON.parse(row.bounds) as [number, number, number, number]),
      geometry: JSON.parse(row.geometryJson) as { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] },
      matchMethod: row.matchMethod,
    }))
  }

  const rows = await prisma.electoralDistrict.findMany({
    where: { provinceCode: args.provinceCode },
    orderBy: [{ name: 'asc' }],
    select: {
      code: true,
      slug: true,
      name: true,
      provinceCode: true,
      centroidLat: true,
      centroidLng: true,
      bbox: true,
    },
  })

  const ordered = args.selectedDistrictCode
    ? rows.slice().sort((left, right) => {
        if (left.code === args.selectedDistrictCode) return -1
        if (right.code === args.selectedDistrictCode) return 1
        return left.name.localeCompare(right.name)
      })
    : rows

  const selectedCodes = ordered.map((row) => row.code)
  const geometries = selectedCodes.length
    ? ((await prisma.$queryRaw(Prisma.sql`
        SELECT
          district."code",
          ST_AsGeoJSON(district."boundaryGeom") AS "geometryJson"
        FROM "ElectoralDistrict" AS district
        WHERE district."code" IN (${Prisma.join(selectedCodes)})
      `)) as Array<{ code: number; geometryJson: string }>)
    : []
  const geometryMap = new Map(geometries.map((row) => [row.code, JSON.parse(row.geometryJson) as { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] }]))

  return ordered.map((row) => ({
    code: row.code,
    slug: row.slug,
    name: row.name,
    provinceCode: row.provinceCode,
    center: {
      lat: Number(row.centroidLat),
      lng: Number(row.centroidLng),
    },
    bounds: Array.isArray(row.bbox) ? (row.bbox as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]),
    geometry: geometryMap.get(row.code) ?? ({ type: 'Polygon', coordinates: [] } as { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] }),
    matchMethod: row.code === args.selectedDistrictCode ? ('contains' as const) : null,
  }))
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

export async function browseElectoralDistricts(args: {
  userId: string
  provinceCode?: string | null
  communitySlug?: string | null
  postalCode?: string | null
  lat?: number | null
  lng?: number | null
  limit?: number | null
}) {
  await ensureSpatialDataReady()

  const normalizedProvinceCode = args.provinceCode?.trim().toLowerCase() || null

  let resolvedFrom: 'coordinates' | 'postal_code' | null = null
  let postalCode: string | null = null
  let userLocation: { lat: number; lng: number } | null = null
  let selectedDistrict: Awaited<ReturnType<typeof findElectoralDistrict>> | Awaited<ReturnType<typeof findElectoralDistrictBySlug>> | null = null

  if (Number.isFinite(args.lat) && Number.isFinite(args.lng)) {
    resolvedFrom = 'coordinates'
    userLocation = { lat: Number(args.lat), lng: Number(args.lng) }
    postalCode = args.postalCode?.trim() || null
    selectedDistrict = await findElectoralDistrict(userLocation.lat, userLocation.lng)
  } else if (args.postalCode?.trim()) {
    resolvedFrom = 'postal_code'
    const postalPoint = await resolvePointFromPostalCode(args.postalCode)
    postalCode = postalPoint.postalCode
    userLocation = { lat: postalPoint.lat, lng: postalPoint.lng }
    selectedDistrict = await findElectoralDistrict(postalPoint.lat, postalPoint.lng)
  }

  if (!selectedDistrict && normalizedProvinceCode && args.communitySlug?.trim()) {
    selectedDistrict = await findElectoralDistrictBySlug(normalizedProvinceCode, args.communitySlug.trim())
  }

  const provinceCode = normalizedProvinceCode || selectedDistrict?.provinceCode || null
  if (!provinceCode) {
    throw new Error('province_or_location_required')
  }

  const anchorLat = userLocation?.lat ?? selectedDistrict?.center.lat ?? null
  const anchorLng = userLocation?.lng ?? selectedDistrict?.center.lng ?? null

  const districts = await listElectoralDistrictsForProvince({
    provinceCode,
    lat: anchorLat,
    lng: anchorLng,
    selectedDistrictCode: selectedDistrict?.code ?? null,
  })

  const districtKeys = districts.map((district) => ({ provinceCode: district.provinceCode, communitySlug: district.slug }))
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [followCounts, postCounts] = await Promise.all([
    districtKeys.length
      ? prisma.communityFollow.groupBy({
          by: ['provinceCode', 'communitySlug'],
          where: { OR: districtKeys },
          _count: { _all: true },
        })
      : Promise.resolve([] as DistrictStatsCount[]),
    districtKeys.length
      ? prisma.post.groupBy({
          by: ['provinceCode', 'communitySlug'],
          where: {
            OR: districtKeys,
            createdAt: { gte: startOfToday },
          },
          _count: { _all: true },
        })
      : Promise.resolve([] as DistrictStatsCount[]),
  ])

  const followMap = new Map(followCounts.map((entry) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))
  const postMap = new Map(postCounts.map((entry) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))

  return {
    provinceCode,
    resolvedFrom,
    postalCode,
    tileServerBaseUrl: getPublicMapTileServerBaseUrl(),
    styleUrl: getMapStyleUrl(),
    userLocation,
    selectedDistrictCode: selectedDistrict?.code ?? districts[0]?.code ?? null,
    districts: districts.map((district) => {
      const key = `${district.provinceCode}:${district.slug}`
      return {
        ...district,
        postsToday: postMap.get(key) ?? 0,
        followerCount: followMap.get(key) ?? 0,
      }
    }),
  }
}