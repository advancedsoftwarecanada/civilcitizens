/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import unzipper from 'unzipper'
import { open as openShapefile } from 'shapefile'
import centroid from '@turf/centroid'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { prisma, type Prisma } from '@civil/db'
import { PROVINCE_LABELS, slugifyChamberName, type ProvinceCode } from '@civil/shared'
import { ensureGeoCache, locateCommunityFromPoint } from '../src/geodata.js'

const DEFAULT_DATASET_BASE =
  'https://www12.statcan.gc.ca/census-recensement/2021/geo/bound-limit/files/ZIP'

const DATASETS = {
  divisions: {
    filename: 'lcd000b21a_e.zip',
    url: `${DEFAULT_DATASET_BASE}/lcd000b21a_e.zip`,
    envVar: 'STATSCAN_CD_ZIP',
  },
  subdivisions: {
    filename: 'lcsd000b21a_e.zip',
    url: `${DEFAULT_DATASET_BASE}/lcsd000b21a_e.zip`,
    envVar: 'STATSCAN_CSD_ZIP',
  },
  fsas: {
    filename: 'lfsa000b21a_e.zip',
    url: `${DEFAULT_DATASET_BASE}/lfsa000b21a_e.zip`,
    envVar: 'STATSCAN_FSA_ZIP',
  },
} as const

type DatasetKey = keyof typeof DATASETS

type StatsCanFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>

const CACHE_DIR = path.resolve(process.env.STATSCAN_CACHE_DIR ?? path.join(process.cwd(), 'tmp', 'statscan'))
const REFERER_HEADER = process.env.STATSCAN_REFERER ?? 'https://www12.statcan.gc.ca/'
const DIVISION_CHUNK_SIZE = Math.max(50, Number.parseInt(process.env.ADMIN_DIVISION_CHUNK ?? '150', 10))
const SUBDIVISION_CHUNK_SIZE = Math.max(10, Number.parseInt(process.env.ADMIN_SUBDIVISION_CHUNK ?? '40', 10))
const FSA_CHUNK_SIZE = Math.max(25, Number.parseInt(process.env.ADMIN_FSA_CHUNK ?? '80', 10))
const ADMIN_SKIP_RESET = ['1', 'true', 'yes'].includes((process.env.ADMIN_SKIP_RESET ?? '').toLowerCase())
const ENABLED_PHASES = parsePhaseFilter(process.env.ADMIN_PHASES)
const PRUID_FILTER = parsePruidFilter(process.env.ADMIN_PRUID_FILTER)

const PROVINCE_CODE_BY_UID: Record<string, ProvinceCode> = {
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

type DivisionRecord = {
  id: string
  provinceCode: ProvinceCode
  name: string
  type: string | null
  population: number | null
  areaKm2: number | null
  centroidLat: number | null
  centroidLng: number | null
  bbox: Prisma.JsonValue | null
  geometry: Prisma.JsonValue | null
}

type SubdivisionRecord = {
  id: string
  provinceCode: ProvinceCode
  divisionId: string
  name: string
  type: string | null
  slug: string
  officialName: string | null
  population: number | null
  areaKm2: number | null
  centroidLat: number | null
  centroidLng: number | null
  bbox: Prisma.JsonValue | null
  geometry: Prisma.JsonValue | null
  defaultChamberSlug: string | null
  defaultChamberName: string | null
}

type FsaRecord = {
  code: string
  provinceCode: ProvinceCode | null
  divisionId: string | null
  subdivisionId: string | null
  subdivisionName: string | null
  centroidLat: number | null
  centroidLng: number | null
  bbox: Prisma.JsonValue | null
  geometry: Prisma.JsonValue | null
  defaultChamberSlug: string | null
  defaultChamberName: string | null
}

type GeometrySummary = {
  centroidLat: number | null
  centroidLng: number | null
  bbox: Prisma.JsonValue | null
}

async function main() {
  console.log('Ensuring province rows exist…')
  await ensureProvinces()

  console.log('Downloading StatsCan boundary archives (or using cache overrides)…')
  const [divisionArchive, subdivisionArchive, fsaArchive] = await Promise.all([
    resolveDatasetArchive('divisions'),
    resolveDatasetArchive('subdivisions'),
    resolveDatasetArchive('fsas'),
  ])

  console.log('Preparing Elections Canada geodata cache for chamber matching…')
  const cache = await ensureGeoCache()
  console.log(`Loaded ${cache.features.length} chamber features from ${cache.sourceUrl}`)

  if (PRUID_FILTER && PRUID_FILTER.size) {
    console.log(`Filtering ingestion to PRUIDs: ${Array.from(PRUID_FILTER).join(', ')}`)
  }

  if (!ADMIN_SKIP_RESET) {
    console.log('Resetting city subdivision references…')
    await prisma.city.updateMany({ data: { censusSubdivisionId: null } })

    console.log('Clearing administrative tables before ingest…')
    await prisma.$transaction(async (tx) => {
      await tx.forwardSortationArea.deleteMany()
      await tx.censusSubdivision.deleteMany()
      await tx.censusDivision.deleteMany()
    })
  } else {
    console.log('ADMIN_SKIP_RESET enabled; existing administrative rows will be preserved')
  }

  let divisionCount = 0
  if (phaseEnabled('divisions')) {
    console.log('Streaming census divisions into the database…')
    divisionCount = await ingestDataset(divisionArchive, {
      label: 'census divisions',
      chunkSize: DIVISION_CHUNK_SIZE,
      map: mapDivisionFeature,
      shouldSkipFeature: shouldSkipByPruid,
      insert: (chunk) => prisma.censusDivision.createMany({ data: chunk, skipDuplicates: true }),
    })
  } else {
    console.log('Skipping census divisions ingestion (phase disabled)')
  }

  let subdivisionCount = 0
  if (phaseEnabled('subdivisions')) {
    console.log('Streaming census subdivisions into the database…')
    subdivisionCount = await ingestDataset(subdivisionArchive, {
      label: 'census subdivisions',
      chunkSize: SUBDIVISION_CHUNK_SIZE,
      map: mapSubdivisionFeature,
      beforeInsert: assignDefaultChamberForRecords,
      shouldSkipFeature: shouldSkipByPruid,
      insert: (chunk) => prisma.censusSubdivision.createMany({ data: chunk, skipDuplicates: true }),
    })
  } else {
    console.log('Skipping census subdivisions ingestion (phase disabled)')
  }

  let fsaCount = 0
  if (phaseEnabled('fsas')) {
    console.log('Streaming FSAs into the database…')
    fsaCount = await ingestDataset(fsaArchive, {
      label: 'FSAs',
      chunkSize: FSA_CHUNK_SIZE,
      map: mapFsaFeature,
      beforeInsert: assignDefaultChamberForRecords,
      shouldSkipFeature: shouldSkipByPruid,
      insert: (chunk) => prisma.forwardSortationArea.createMany({ data: chunk, skipDuplicates: true }),
    })
  } else {
    console.log('Skipping FSA ingestion (phase disabled)')
  }

  console.log(`Seeded ${divisionCount} divisions, ${subdivisionCount} subdivisions, and ${fsaCount} FSAs`)

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Failed to seed administrative areas:', error)
  prisma.$disconnect().catch(() => {
    /* noop */
  })
  process.exitCode = 1
})

async function ensureProvinces() {
  await prisma.$transaction(async (tx) => {
    for (const [code, name] of Object.entries(PROVINCE_LABELS)) {
      await tx.province.upsert({
        where: { code },
        update: { name, shortName: name },
        create: { code, name, shortName: name },
      })
    }
  })
}

async function resolveDatasetArchive(key: DatasetKey): Promise<Buffer> {
  const config = DATASETS[key]
  const overridePath = process.env[config.envVar]
  if (overridePath) {
    const resolved = path.resolve(overridePath)
    console.log(`Using ${config.envVar} override at ${resolved}`)
    return fs.readFile(resolved)
  }
  const cachePath = path.join(CACHE_DIR, config.filename)
  if (await pathExists(cachePath)) {
    return fs.readFile(cachePath)
  }
  console.log(`Downloading ${config.filename} from StatsCan…`)
  const buffer = await downloadArchive(config.url)
  if (!(await pathExists(CACHE_DIR))) {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  }
  await fs.writeFile(cachePath, buffer)
  return buffer
}

async function downloadArchive(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'civil-admin-seeder/1.0 (+https://civil.app)',
      Referer: REFERER_HEADER,
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (status ${res.status})`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!isZip) {
    const preview = buffer.toString('utf8', 0, 120)
    throw new Error(
      `Expected a zip archive from ${url} but received non-binary content. Preview: ${preview}`,
    )
  }
  return buffer
}

type ChamberAssignable = {
  centroidLat: number | null
  centroidLng: number | null
  defaultChamberSlug: string | null
  defaultChamberName: string | null
}

type IngestOptions<T extends object> = {
  label: string
  chunkSize: number
  map: (feature: StatsCanFeature) => T | null
  insert: (records: T[]) => Promise<unknown>
  beforeInsert?: (records: T[]) => Promise<void>
  shouldSkipFeature?: (feature: StatsCanFeature) => boolean
}

async function ingestDataset<T extends object>(archive: Buffer, options: IngestOptions<T>) {
  const { label, chunkSize, map, insert, beforeInsert, shouldSkipFeature } = options
  const records: T[] = []
  let total = 0

  const flush = async () => {
    if (!records.length) return
    if (beforeInsert) await beforeInsert(records)
    await insert(records)
    total += records.length
    records.length = 0
    console.log(`Inserted ${total} ${label} so far…`)
  }

  await iterateFeaturesFromArchive(archive, async (feature) => {
    if (shouldSkipFeature?.(feature)) return
    const record = map(feature)
    if (!record) return
    records.push(record)
    if (records.length >= chunkSize) {
      await flush()
    }
  })

  if (records.length) {
    await flush()
  }

  console.log(`Finished streaming ${total} ${label}`)
  return total
}

async function iterateFeaturesFromArchive(
  archive: Buffer,
  handler: (feature: StatsCanFeature) => Promise<void>,
): Promise<void> {
  const directory = await unzipper.Open.buffer(archive)
  const shpEntry = directory.files.find(
    (file) => file.type === 'File' && file.path.toLowerCase().endsWith('.shp'),
  )
  const dbfEntry = directory.files.find(
    (file) => file.type === 'File' && file.path.toLowerCase().endsWith('.dbf'),
  )
  if (!shpEntry || !dbfEntry) {
    throw new Error('Archive is missing SHP or DBF content')
  }
  const [shpBuffer, dbfBuffer] = await Promise.all([shpEntry.buffer(), dbfEntry.buffer()])
  const source = await openShapefile(shpBuffer, dbfBuffer, { encoding: 'utf-8' })
  try {
    while (true) {
      const { done, value } = await source.read()
      if (done) break
      if (value && value.geometry) {
        await handler(value as StatsCanFeature)
      }
    }
  } finally {
    if (typeof (source as { close?: () => Promise<void> }).close === 'function') {
      await (source as { close: () => Promise<void> }).close()
    }
  }
}

async function assignDefaultChamberForRecords<T extends ChamberAssignable>(records: T[]) {
  for (const record of records) {
    if (record.centroidLat == null || record.centroidLng == null) continue
    const match = await locateCommunityFromPoint(record.centroidLat, record.centroidLng, { limit: 1 })
    if (match.primary) {
      record.defaultChamberSlug = match.primary.communitySlug
      record.defaultChamberName = match.primary.communityName
    }
  }
}

function mapDivisionFeature(feature: StatsCanFeature): DivisionRecord | null {
  const props = feature.properties ?? {}
  const id = sanitizeId(props.CDUID ?? props.DGUID)
  const provinceCode = getProvinceCode(props.PRUID)
  if (!id || !provinceCode) return null
  const summary = summarizeGeometry(feature)
  return {
    id,
    provinceCode,
    name: pickName(props.CDNAME ?? props.NAME, `CD ${id}`),
    type: pickOptional(props.CDTYPE ?? props.TYPE),
    population: parseOptionalInt(props.POP2021 ?? props.POP_CNT ?? props.POPULATION),
    areaKm2: parseAreaKm2(props.AREA_SQKM ?? props.LANDAREA ?? props.Shape_Area),
    centroidLat: summary?.centroidLat ?? null,
    centroidLng: summary?.centroidLng ?? null,
    bbox: summary?.bbox ?? null,
    geometry: feature.geometry ?? null,
  }
}

function mapSubdivisionFeature(feature: StatsCanFeature): SubdivisionRecord | null {
  const props = feature.properties ?? {}
  const id = sanitizeId(props.CSDUID ?? props.DGUID)
  const divisionId = sanitizeId(props.CDUID) ?? deriveDivisionIdFromSubdivision(id)
  const provinceCode = getProvinceCode(props.PRUID)
  const name = pickName(props.CSDNAME ?? props.NAME, id ? `CSD ${id}` : 'Unknown CSD')
  if (!id || !divisionId || !provinceCode) return null
  const slug = slugifyMunicipalityName(name)
  const summary = summarizeGeometry(feature)
  return {
    id,
    provinceCode,
    divisionId,
    name,
    type: pickOptional(props.CSDTYPE ?? props.TYPE),
    slug,
    officialName: pickOptional(props.CSDNAMEFR ?? props.OFFICIAL_NM ?? props.CSDNAME),
    population: parseOptionalInt(props.POP2021 ?? props.POP_CNT ?? props.POPULATION),
    areaKm2: parseAreaKm2(props.AREA_SQKM ?? props.LANDAREA ?? props.Shape_Area),
    centroidLat: summary?.centroidLat ?? null,
    centroidLng: summary?.centroidLng ?? null,
    bbox: summary?.bbox ?? null,
    geometry: feature.geometry ?? null,
    defaultChamberSlug: null,
    defaultChamberName: null,
  }
}

function deriveDivisionIdFromSubdivision(csdUid: string | null): string | null {
  if (!csdUid) return null
  const digits = csdUid.replace(/[^0-9]/g, '')
  if (digits.length < 4) return null
  return digits.slice(0, 4)
}

function mapFsaFeature(feature: StatsCanFeature): FsaRecord | null {
  const props = feature.properties ?? {}
  const codeRaw = props.CFSAUID ?? props.FSAUID ?? props.FSA
  if (!codeRaw) return null
  const code = String(codeRaw).trim().toUpperCase()
  if (!code) return null
  const provinceCode = getProvinceCode(props.PRUID)
  const summary = summarizeGeometry(feature)
  return {
    code,
    provinceCode: provinceCode ?? null,
    divisionId: sanitizeId(props.CDUID),
    subdivisionId: sanitizeId(props.CSDUID),
    subdivisionName: pickOptional(props.CSDNAME ?? props.NAME),
    centroidLat: summary?.centroidLat ?? null,
    centroidLng: summary?.centroidLng ?? null,
    bbox: summary?.bbox ?? null,
    geometry: feature.geometry ?? null,
    defaultChamberSlug: null,
    defaultChamberName: null,
  }
}

function summarizeGeometry(feature: StatsCanFeature): GeometrySummary | null {
  if (!feature.geometry) return null
  const bbox = computeBBox(feature.geometry)
  let centroidLat: number | null = null
  let centroidLng: number | null = null
  try {
    const center = centroid(feature as Feature)
    const coords = center.geometry?.coordinates
    if (Array.isArray(coords) && coords.length === 2) {
      centroidLng = Number(coords[0].toFixed(6))
      centroidLat = Number(coords[1].toFixed(6))
    }
  } catch {
    // ignore centroid errors
  }
  return {
    centroidLat,
    centroidLng,
    bbox,
  }
}

function computeBBox(geometry: Polygon | MultiPolygon): Prisma.JsonValue | null {
  const bounds = {
    minLat: Number.POSITIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  }
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords)) {
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lng = Number(coords[0])
        const lat = Number(coords[1])
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          bounds.minLat = Math.min(bounds.minLat, lat)
          bounds.minLng = Math.min(bounds.minLng, lng)
          bounds.maxLat = Math.max(bounds.maxLat, lat)
          bounds.maxLng = Math.max(bounds.maxLng, lng)
        }
        return
      }
      for (const value of coords) {
        visit(value)
      }
    }
  }
  visit(geometry.coordinates)
  if (!Number.isFinite(bounds.minLat) || !Number.isFinite(bounds.minLng)) {
    return null
  }
  return {
    minLat: Number(bounds.minLat.toFixed(6)),
    minLng: Number(bounds.minLng.toFixed(6)),
    maxLat: Number(bounds.maxLat.toFixed(6)),
    maxLng: Number(bounds.maxLng.toFixed(6)),
  }
}

function pickName(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return text || fallback
}

function pickOptional(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim()
  return text || null
}

function parseOptionalInt(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(num) ? Number(num) : null
}

function parseAreaKm2(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(num)) return null
  const km2 = num > 10_000 ? num / 1_000_000 : num
  return Number(km2.toFixed(3))
}

function sanitizeId(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function getProvinceCode(value: unknown): ProvinceCode | null {
  if (value == null) return null
  const digits = String(value)
    .trim()
    .replace(/[^0-9]/g, '')
  if (!digits) return null
  const key = digits.length > 2 ? digits.slice(0, 2) : digits.padStart(2, '0')
  return PROVINCE_CODE_BY_UID[key] ?? null
}

function slugifyMunicipalityName(name: string): string {
  return slugifyChamberName(name)
}

type PhaseName = 'divisions' | 'subdivisions' | 'fsas'

function parsePhaseFilter(value: string | undefined): Set<PhaseName> | null {
  if (!value) return null
  const entries = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is PhaseName => entry === 'divisions' || entry === 'subdivisions' || entry === 'fsas')
  if (!entries.length) return null
  return new Set(entries)
}

function phaseEnabled(phase: PhaseName): boolean {
  if (!ENABLED_PHASES || !ENABLED_PHASES.size) return true
  return ENABLED_PHASES.has(phase)
}

function parsePruidFilter(value: string | undefined): Set<string> | null {
  if (!value) return null
  const codes = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.padStart(2, '0').slice(0, 2))
  if (!codes.length) return null
  return new Set(codes)
}

function shouldSkipByPruid(feature: StatsCanFeature): boolean {
  if (!PRUID_FILTER || !PRUID_FILTER.size) return false
  const raw = feature.properties?.PRUID ?? feature.properties?.PRUID_E ?? feature.properties?.PRUID_F
  if (raw == null) return true
  const normalized = typeof raw === 'number' ? raw.toString().padStart(2, '0') : String(raw).trim().padStart(2, '0')
  return !PRUID_FILTER.has(normalized.slice(0, 2))
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function createManyInChunks<T>(
  rows: T[],
  size: number,
  handler: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size)
    await handler(chunk)
  }
}
