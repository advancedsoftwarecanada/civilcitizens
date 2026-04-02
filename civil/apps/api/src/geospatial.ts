import { prisma, ByElectionStatus, PoliticalJurisdiction, PoliticalOfficeType, Prisma } from '@civil/db'
import { ensureGeoCache } from './geodata.js'
import { normalizePostalCodeInput } from './communityGeo.js'

const DEFAULT_MAP_TILE_SERVER = 'http://tileserver-gl:8080'
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

type DistrictGeometry = {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: unknown[]
}

type ResolvedDistrict = {
  code: number
  slug: string
  name: string
  provinceCode: string
  center: {
    lat: number
    lng: number
  }
  bounds: [number, number, number, number]
  geometry: DistrictGeometry
  matchMethod: 'contains' | 'nearest' | null
}

type ElectoralDistrictListRow = {
  code: number
  slug: string
  name: string
  provinceCode: string
  centroidLat: number
  centroidLng: number
  bbox: unknown
}

type DistrictStatsCount = {
  provinceCode: string
  communitySlug: string
  _count: {
    _all: number
  }
}

type DistrictPartySummary = {
  slug: string
  name: string
  shortName: string | null
}

type DistrictPartyStatus = 'seat' | 'registered'

type DistrictSeatPoliticianSummary = {
  slug: string
  displayName: string
  photoUrl: string | null
}

type DistrictSeatSummary = {
  title: string
  party: DistrictPartySummary | null
  politician: DistrictSeatPoliticianSummary | null
}

type DistrictSelectedPartyPoliticianSummary = {
  slug: string | null
  displayName: string
  photoUrl: string | null
  roleLabel: string | null
}

type DistrictByElectionSummary = {
  id: string
  status: 'draft' | 'published' | 'completed'
  title: string
  tagline: string | null
  electionsCanadaUrl: string | null
  electionDayAt: string | null
  electionDayLabel: string | null
  advanceVotingLabel: string | null
  electionDayHoursLabel: string | null
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

function isPoliticalStorageUnavailableError(error: unknown) {
  if (error && typeof error === 'object') {
    const maybeError = error as { code?: unknown; message?: unknown }
    if (maybeError.code === 'P2021' || maybeError.code === 'P2022') {
      return true
    }
    const message = typeof maybeError.message === 'string' ? maybeError.message : ''
    return /PoliticalParty|PoliticalDistrictAssociation|PoliticalSeat|Politician|PoliticianScrapeJob|PoliticalByElection|does not exist|doesn't exist|relation .* does not exist/i.test(message)
  }

  return false
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function readPoliticianPhotoUrl(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const record = metadata as Record<string, unknown>

  const ourCommons = record.ourCommons
  if (ourCommons && typeof ourCommons === 'object' && !Array.isArray(ourCommons)) {
    const photoUrl = (ourCommons as Record<string, unknown>).photoUrl
    if (typeof photoUrl === 'string' && photoUrl.trim()) {
      return photoUrl.trim()
    }
  }

  const ppc = record.ppc
  if (ppc && typeof ppc === 'object' && !Array.isArray(ppc)) {
    const photoUrl = (ppc as Record<string, unknown>).photoUrl
    if (typeof photoUrl === 'string' && photoUrl.trim()) {
      return photoUrl.trim()
    }
  }

  return null
}

function readAssociationRepresentative(metadata: unknown): { displayName: string; roleLabel: string } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const source = (metadata as Record<string, unknown>).source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const sourceRecord = source as Record<string, unknown>

  const ceoName = typeof sourceRecord.ceoName === 'string' ? sourceRecord.ceoName.trim() : ''
  if (ceoName) {
    return { displayName: ceoName, roleLabel: '' }
  }

  const financialAgentName = typeof sourceRecord.financialAgentName === 'string'
    ? sourceRecord.financialAgentName.trim()
    : ''
  if (financialAgentName) {
    return { displayName: financialAgentName, roleLabel: '' }
  }

  return null
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

async function findElectoralDistrict(lat: number, lng: number): Promise<ResolvedDistrict | null> {
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
    geometry: JSON.parse(row.geometryJson) as DistrictGeometry,
    matchMethod: row.matchMethod,
  }
}

async function loadDistrictActiveSeatByKey(districts: ResolvedDistrict[]) {
  const seatByKey = new Map<string, DistrictSeatSummary | null>()

  districts.forEach((district) => {
    seatByKey.set(`${district.provinceCode}:${district.slug}`, null)
  })

  if (districts.length === 0) {
    return seatByKey
  }

  try {
    const seats = await prisma.politicalSeat.findMany({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        officeType: PoliticalOfficeType.MP,
        OR: districts.map((district) => ({
          provinceCode: district.provinceCode,
          communitySlug: district.slug,
        })),
      },
      select: {
        provinceCode: true,
        communitySlug: true,
        title: true,
        currentParty: {
          select: {
            slug: true,
            name: true,
            shortName: true,
          },
        },
        currentPolitician: {
          select: {
            slug: true,
            displayName: true,
            metadata: true,
          },
        },
      },
    })

    seats.forEach((seat: (typeof seats)[number]) => {
      const key = `${seat.provinceCode}:${seat.communitySlug}`
      seatByKey.set(key, {
        title: seat.title,
        party: seat.currentParty
          ? {
              slug: seat.currentParty.slug,
              name: seat.currentParty.name,
              shortName: seat.currentParty.shortName,
            }
          : null,
        politician: seat.currentPolitician
          ? {
              slug: seat.currentPolitician.slug,
              displayName: seat.currentPolitician.displayName,
              photoUrl: readPoliticianPhotoUrl(seat.currentPolitician.metadata),
            }
          : null,
      })
    })
  } catch (error) {
    if (!isPoliticalStorageUnavailableError(error)) {
      throw error
    }
  }

  return seatByKey
}

async function loadSelectedPartyPoliticianByKey(args: {
  districts: ResolvedDistrict[]
  partyId: string
  provinceCode?: string | null
}) {
  const politicianByKey = new Map<string, DistrictSelectedPartyPoliticianSummary | null>()

  args.districts.forEach((district) => {
    politicianByKey.set(`${district.provinceCode}:${district.slug}`, null)
  })

  if (args.districts.length === 0) {
    return politicianByKey
  }

  try {
    const [politicians, associations] = await Promise.all([
      prisma.politician.findMany({
        where: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          partyId: args.partyId,
          ...(args.provinceCode ? { provinceCode: args.provinceCode } : {}),
          OR: args.districts.map((district) => ({
            provinceCode: district.provinceCode,
            communitySlug: district.slug,
          })),
        },
        orderBy: [{ displayName: 'asc' }],
        select: {
          provinceCode: true,
          communitySlug: true,
          slug: true,
          displayName: true,
          metadata: true,
        },
      }),
      prisma.politicalDistrictAssociation.findMany({
        where: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          partyId: args.partyId,
          ...(args.provinceCode ? { provinceCode: args.provinceCode } : {}),
          OR: args.districts.map((district) => ({
            provinceCode: district.provinceCode,
            communitySlug: district.slug,
          })),
          deregisteredAt: null,
          NOT: {
            registrationStatus: {
              contains: 'deregister',
              mode: 'insensitive',
            },
          },
        },
        orderBy: [{ associationName: 'asc' }],
        select: {
          provinceCode: true,
          communitySlug: true,
          metadata: true,
        },
      }),
    ])

    politicians.forEach((politician: (typeof politicians)[number]) => {
      if (!politician.provinceCode || !politician.communitySlug) return
      const key = `${politician.provinceCode}:${politician.communitySlug}`
      if (politicianByKey.get(key)) return
      politicianByKey.set(key, {
        slug: politician.slug,
        displayName: politician.displayName,
        photoUrl: readPoliticianPhotoUrl(politician.metadata),
        roleLabel: '',
      })
    })

    associations.forEach((association: (typeof associations)[number]) => {
      const key = `${association.provinceCode}:${association.communitySlug}`
      if (politicianByKey.get(key)) return
      const representative = readAssociationRepresentative(association.metadata)
      if (!representative) return
      politicianByKey.set(key, {
        slug: null,
        displayName: representative.displayName,
        photoUrl: null,
        roleLabel: representative.roleLabel,
      })
    })
  } catch (error) {
    if (!isPoliticalStorageUnavailableError(error)) {
      throw error
    }
  }

  return politicianByKey
}

async function loadPublishedByElectionByKey(districts: ResolvedDistrict[]) {
  const byElectionByKey = new Map<string, DistrictByElectionSummary | null>()

  districts.forEach((district) => {
    byElectionByKey.set(`${district.provinceCode}:${district.slug}`, null)
  })

  if (districts.length === 0) {
    return byElectionByKey
  }

  try {
    const byElections = await prisma.politicalByElection.findMany({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        status: ByElectionStatus.PUBLISHED,
        OR: districts.map((district) => ({
          provinceCode: district.provinceCode,
          communitySlug: district.slug,
        })),
      },
      orderBy: [{ electionDayAt: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        provinceCode: true,
        communitySlug: true,
        title: true,
        tagline: true,
        electionsCanadaUrl: true,
        electionDayAt: true,
        electionDayLabel: true,
        advanceVotingLabel: true,
        electionDayHoursLabel: true,
      },
    })

    byElections.forEach((byElection: (typeof byElections)[number]) => {
      const key = `${byElection.provinceCode}:${byElection.communitySlug}`
      if (byElectionByKey.get(key)) return
      byElectionByKey.set(key, {
        id: byElection.id,
        status: 'published',
        title: byElection.title,
        tagline: byElection.tagline ?? null,
        electionsCanadaUrl: byElection.electionsCanadaUrl ?? null,
        electionDayAt: byElection.electionDayAt?.toISOString() ?? null,
        electionDayLabel: byElection.electionDayLabel ?? null,
        advanceVotingLabel: byElection.advanceVotingLabel ?? null,
        electionDayHoursLabel: byElection.electionDayHoursLabel ?? null,
      })
    })
  } catch (error) {
    if (!isPoliticalStorageUnavailableError(error)) {
      throw error
    }
  }

  return byElectionByKey
}

async function findElectoralDistrictBySlug(provinceCode: string, communitySlug: string): Promise<ResolvedDistrict | null> {
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
    geometry: JSON.parse(row.geometryJson) as DistrictGeometry,
    matchMethod: null as 'contains' | 'nearest' | null,
  }
}

async function listElectoralDistrictsForProvince(args: {
  provinceCode: string
  lat?: number | null
  lng?: number | null
  selectedDistrictCode?: number | null
}): Promise<ResolvedDistrict[]> {
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

    return rows.map((row: DistrictQueryRow) => ({
      code: row.code,
      slug: row.slug,
      name: row.name,
      provinceCode: row.provinceCode,
      center: {
        lat: Number(row.centroidLat),
        lng: Number(row.centroidLng),
      },
      bounds: Array.isArray(row.bounds) ? row.bounds : (JSON.parse(row.bounds) as [number, number, number, number]),
      geometry: JSON.parse(row.geometryJson) as DistrictGeometry,
      matchMethod: row.matchMethod,
    }))
  }

  const rows = (await prisma.electoralDistrict.findMany({
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
  })) as ElectoralDistrictListRow[]

  const ordered = args.selectedDistrictCode
    ? rows.slice().sort((left: ElectoralDistrictListRow, right: ElectoralDistrictListRow) => {
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
  const geometryMap = new Map(geometries.map((row: { code: number; geometryJson: string }) => [row.code, JSON.parse(row.geometryJson) as DistrictGeometry]))

  return ordered.map((row: ElectoralDistrictListRow) => ({
    code: row.code,
    slug: row.slug,
    name: row.name,
    provinceCode: row.provinceCode,
    center: {
      lat: Number(row.centroidLat),
      lng: Number(row.centroidLng),
    },
    bounds: Array.isArray(row.bbox) ? (row.bbox as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]),
    geometry: geometryMap.get(row.code) ?? ({ type: 'Polygon', coordinates: [] } as DistrictGeometry),
    matchMethod: row.code === args.selectedDistrictCode ? ('contains' as const) : null,
  }))
}

async function listAllElectoralDistricts(): Promise<ResolvedDistrict[]> {
  const rows = (await prisma.electoralDistrict.findMany({
    orderBy: [{ provinceCode: 'asc' }, { name: 'asc' }],
    select: {
      code: true,
      slug: true,
      name: true,
      provinceCode: true,
      centroidLat: true,
      centroidLng: true,
      bbox: true,
    },
  })) as ElectoralDistrictListRow[]

  const selectedCodes = rows.map((row) => row.code)
  const geometries = selectedCodes.length
    ? ((await prisma.$queryRaw(Prisma.sql`
        SELECT
          district."code",
          ST_AsGeoJSON(district."boundaryGeom") AS "geometryJson"
        FROM "ElectoralDistrict" AS district
        WHERE district."code" IN (${Prisma.join(selectedCodes)})
      `)) as Array<{ code: number; geometryJson: string }>)
    : []
  const geometryMap = new Map(geometries.map((row: { code: number; geometryJson: string }) => [row.code, JSON.parse(row.geometryJson) as DistrictGeometry]))

  return rows.map((row: ElectoralDistrictListRow) => ({
    code: row.code,
    slug: row.slug,
    name: row.name,
    provinceCode: row.provinceCode,
    center: {
      lat: Number(row.centroidLat),
      lng: Number(row.centroidLng),
    },
    bounds: Array.isArray(row.bbox) ? (row.bbox as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]),
    geometry: geometryMap.get(row.code) ?? ({ type: 'Polygon', coordinates: [] } as DistrictGeometry),
    matchMethod: null,
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

export async function resolveCommunityElectoralDistrictContext(args: {
  provinceCode: string
  communitySlug: string
}) {
  await ensureSpatialDataReady()

  const district = await findElectoralDistrictBySlug(args.provinceCode.trim().toLowerCase(), args.communitySlug.trim())

  return {
    resolvedFrom: 'coordinates' as const,
    postalCode: null,
    tileServerBaseUrl: getPublicMapTileServerBaseUrl(),
    styleUrl: getMapStyleUrl(),
    userLocation: district?.center ?? { lat: 56.1304, lng: -106.3468 },
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
  let selectedDistrict: ResolvedDistrict | null = null

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

  const [followCounts, postCounts, activeSeatByKey, byElectionByKey] = await Promise.all([
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
    loadDistrictActiveSeatByKey(districts),
    loadPublishedByElectionByKey(districts),
  ])

  const followMap = new Map(followCounts.map((entry: DistrictStatsCount) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))
  const postMap = new Map(postCounts.map((entry: DistrictStatsCount) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))

  return {
    provinceCode,
    resolvedFrom,
    postalCode,
    tileServerBaseUrl: getPublicMapTileServerBaseUrl(),
    styleUrl: getMapStyleUrl(),
    userLocation,
    selectedDistrictCode: selectedDistrict?.code ?? districts[0]?.code ?? null,
    districts: districts.map((district: ResolvedDistrict) => {
      const key = `${district.provinceCode}:${district.slug}`
      const activeSeat = activeSeatByKey.get(key) ?? null
      const districtParty = activeSeat?.party ?? null
      return {
        ...district,
        party: districtParty,
        partyStatus: districtParty ? 'seat' : null,
        activeSeat,
        selectedPartyPolitician: null,
        byElection: byElectionByKey.get(key) ?? null,
        postsToday: postMap.get(key) ?? 0,
        followerCount: followMap.get(key) ?? 0,
      }
    }),
  }
}

export async function browseFederalPartyDistricts(args: {
  partySlug: string
  provinceCode?: string | null
}) {
  await ensureSpatialDataReady()

  const normalizedPartySlug = args.partySlug.trim().toLowerCase()
  const normalizedProvinceCode = args.provinceCode?.trim().toLowerCase() || null

  let party: {
    id: string
    slug: string
    name: string
    shortName: string | null
  } | null = null

  try {
    party = await prisma.politicalParty.findUnique({
      where: {
        jurisdiction_slug: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          slug: normalizedPartySlug,
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        shortName: true,
      },
    })
  } catch (error) {
    if (isPoliticalStorageUnavailableError(error)) {
      throw new Error('party_not_found')
    }
    throw error
  }

  if (!party) {
    throw new Error('party_not_found')
  }

  const districts = normalizedProvinceCode
    ? await listElectoralDistrictsForProvince({
        provinceCode: normalizedProvinceCode,
      })
    : await listAllElectoralDistricts()

  const districtKeys = districts.map((district) => ({
    provinceCode: district.provinceCode,
    communitySlug: district.slug,
  }))
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [followCounts, postCounts, activeSeatByKey, selectedPartyPoliticianByKey, byElectionByKey, selectedSeatKeys, selectedRegisteredAssociationKeys] = await Promise.all([
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
    loadDistrictActiveSeatByKey(districts),
    loadSelectedPartyPoliticianByKey({
      districts,
      partyId: party.id,
      provinceCode: normalizedProvinceCode,
    }),
    loadPublishedByElectionByKey(districts),
    prisma.politicalSeat.findMany({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        officeType: PoliticalOfficeType.MP,
        currentPartyId: party.id,
        ...(normalizedProvinceCode ? { provinceCode: normalizedProvinceCode } : {}),
      },
      select: {
        provinceCode: true,
        communitySlug: true,
      },
    }).catch((error: unknown) => {
      if (isPoliticalStorageUnavailableError(error)) return [] as Array<{ provinceCode: string; communitySlug: string }>
      throw error
    }),
    prisma.politicalDistrictAssociation.findMany({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        partyId: party.id,
        ...(normalizedProvinceCode ? { provinceCode: normalizedProvinceCode } : {}),
        deregisteredAt: null,
        NOT: {
          registrationStatus: {
            contains: 'deregister',
            mode: 'insensitive',
          },
        },
      },
      select: {
        provinceCode: true,
        communitySlug: true,
      },
    }).catch((error: unknown) => {
      if (isPoliticalStorageUnavailableError(error)) return [] as Array<{ provinceCode: string; communitySlug: string }>
      throw error
    }),
  ])

  const followMap = new Map(followCounts.map((entry: DistrictStatsCount) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))
  const postMap = new Map(postCounts.map((entry: DistrictStatsCount) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))
  const selectedSeatKeySet = new Set(selectedSeatKeys.map((entry: { provinceCode: string; communitySlug: string }) => `${entry.provinceCode}:${entry.communitySlug}`))
  const selectedRegisteredAssociationKeySet = new Set(selectedRegisteredAssociationKeys.map((entry: { provinceCode: string; communitySlug: string }) => `${entry.provinceCode}:${entry.communitySlug}`))

  selectedPartyPoliticianByKey.forEach((politician, key) => {
    if (!politician || selectedSeatKeySet.has(key)) return
    selectedRegisteredAssociationKeySet.add(key)
  })

  return {
    provinceCode: normalizedProvinceCode ?? 'ca',
    resolvedFrom: null,
    postalCode: null,
    tileServerBaseUrl: getPublicMapTileServerBaseUrl(),
    styleUrl: getMapStyleUrl(),
    userLocation: null,
    selectedDistrictCode:
      normalizedProvinceCode
        ? districts.find((district) => {
            const key = `${district.provinceCode}:${district.slug}`
            return selectedSeatKeySet.has(key) || selectedRegisteredAssociationKeySet.has(key)
          })?.code
          ?? districts[0]?.code
          ?? null
        : null,
    districts: districts.map((district: ResolvedDistrict) => {
      const key = `${district.provinceCode}:${district.slug}`
      const districtPartyStatus: DistrictPartyStatus | null = selectedSeatKeySet.has(key)
        ? 'seat'
        : selectedRegisteredAssociationKeySet.has(key)
          ? 'registered'
          : null
      return {
        ...district,
        party: districtPartyStatus
          ? {
              slug: party.slug,
              name: party.name,
              shortName: party.shortName,
            }
          : null,
        partyStatus: districtPartyStatus,
        activeSeat: activeSeatByKey.get(key) ?? null,
        selectedPartyPolitician: selectedPartyPoliticianByKey.get(key) ?? null,
        byElection: byElectionByKey.get(key) ?? null,
        postsToday: postMap.get(key) ?? 0,
        followerCount: followMap.get(key) ?? 0,
      }
    }),
  }
}

export async function browseCurrentFederalDistricts(args: {
  provinceCode?: string | null
}) {
  await ensureSpatialDataReady()

  const normalizedProvinceCode = args.provinceCode?.trim().toLowerCase() || null
  const districts = normalizedProvinceCode
    ? await listElectoralDistrictsForProvince({
        provinceCode: normalizedProvinceCode,
      })
    : await listAllElectoralDistricts()

  const districtKeys = districts.map((district) => ({
    provinceCode: district.provinceCode,
    communitySlug: district.slug,
  }))
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [followCounts, postCounts, activeSeatByKey, byElectionByKey] = await Promise.all([
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
    loadDistrictActiveSeatByKey(districts),
    loadPublishedByElectionByKey(districts),
  ])

  const followMap = new Map(followCounts.map((entry: DistrictStatsCount) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))
  const postMap = new Map(postCounts.map((entry: DistrictStatsCount) => [`${entry.provinceCode}:${entry.communitySlug}`, entry._count._all]))
  const selectedDistrict = districts.find((district) => {
    const key = `${district.provinceCode}:${district.slug}`
    return Boolean(activeSeatByKey.get(key))
  }) ?? null

  return {
    provinceCode: normalizedProvinceCode ?? 'ca',
    resolvedFrom: null,
    postalCode: null,
    tileServerBaseUrl: getPublicMapTileServerBaseUrl(),
    styleUrl: getMapStyleUrl(),
    userLocation: null,
    selectedDistrictCode: normalizedProvinceCode
      ? selectedDistrict?.code ?? districts[0]?.code ?? null
      : null,
    districts: districts.map((district: ResolvedDistrict) => {
      const key = `${district.provinceCode}:${district.slug}`
      const activeSeat = activeSeatByKey.get(key) ?? null
      const districtParty = activeSeat?.party ?? null

      return {
        ...district,
        party: districtParty,
        partyStatus: districtParty ? 'seat' : null,
        activeSeat,
        selectedPartyPolitician: null,
        byElection: byElectionByKey.get(key) ?? null,
        postsToday: postMap.get(key) ?? 0,
        followerCount: followMap.get(key) ?? 0,
      }
    }),
  }
}
