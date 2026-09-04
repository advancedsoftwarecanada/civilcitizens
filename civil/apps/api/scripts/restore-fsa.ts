/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import unzipper from 'unzipper'
import { open as openShapefile } from 'shapefile'
import centroid from '@turf/centroid'
import { prisma, type Prisma } from '@civil/db'
import { PROVINCE_LABELS, type ProvinceCode } from '@civil/shared'
import { locateCommunityFromPoint } from '../src/geodata.js'
import { statsCanPointToWgs84 } from '../src/statscan.js'

const DEFAULT_FSA_ZIP = path.resolve(
  process.cwd(),
  '..',
  '..',
  '..',
  'civilcitizens_largefiles',
  '_geodata',
  'lfsa000b21a_e.zip',
)

const FSA_ZIP = path.resolve(process.env.STATSCAN_FSA_ZIP ?? DEFAULT_FSA_ZIP)
const CHUNK_SIZE = Math.max(25, Number.parseInt(process.env.RESTORE_FSA_CHUNK_SIZE ?? '100', 10))

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

type FsaRow = {
  code: string
  provinceCode: ProvinceCode
  divisionId: null
  subdivisionId: null
  subdivisionName: string | null
  centroidLat: number | null
  centroidLng: number | null
  bbox: Prisma.JsonValue | null
  geometry: null
  defaultCommunitySlug: string | null
  defaultCommunityName: string | null
}

async function main() {
  console.log(`Reading FSA archive: ${FSA_ZIP}`)
  await ensureProvinces()

  const archive = await fs.readFile(FSA_ZIP)
  const directory = await unzipper.Open.buffer(archive)
  const shpEntry = directory.files.find((file) => file.type === 'File' && file.path.toLowerCase().endsWith('.shp'))
  const dbfEntry = directory.files.find((file) => file.type === 'File' && file.path.toLowerCase().endsWith('.dbf'))
  if (!shpEntry || !dbfEntry) throw new Error('FSA archive is missing SHP or DBF content')

  const [shpBuffer, dbfBuffer] = await Promise.all([shpEntry.buffer(), dbfEntry.buffer()])
  const source = await openShapefile(shpBuffer, dbfBuffer, { encoding: 'utf-8' })

  console.log('Clearing existing FSA rows...')
  await prisma.forwardSortationArea.deleteMany()

  let total = 0
  const rows: FsaRow[] = []

  const flush = async () => {
    if (!rows.length) return
    await prisma.forwardSortationArea.createMany({ data: rows, skipDuplicates: true })
    total += rows.length
    rows.length = 0
    console.log(`Inserted ${total} FSAs so far...`)
  }

  try {
    while (true) {
      const { done, value } = await source.read()
      if (done) break
      const row = await mapFeature(value as any)
      if (!row) continue
      rows.push(row)
      if (rows.length >= CHUNK_SIZE) await flush()
    }
  } finally {
    if (typeof (source as { close?: () => Promise<void> }).close === 'function') {
      await (source as { close: () => Promise<void> }).close()
    }
  }

  await flush()
  await updatePointGeometries()
  console.log(`Restored ${total} FSA rows`)
  await prisma.$disconnect()
}

async function ensureProvinces() {
  for (const [code, name] of Object.entries(PROVINCE_LABELS)) {
    await prisma.province.upsert({
      where: { code },
      update: { name, shortName: name },
      create: { code, name, shortName: name },
    })
  }
}

async function mapFeature(feature: { properties?: Record<string, unknown>; geometry?: unknown }): Promise<FsaRow | null> {
  const props = feature.properties ?? {}
  const code = String(props.CFSAUID ?? props.FSAUID ?? props.FSA ?? '').trim().toUpperCase()
  const provinceCode = getProvinceCode(props.PRUID)
  if (!code || !provinceCode) return null

  const center = summarizeCentroid(feature)
  const wgs84 = statsCanPointToWgs84(center?.lat, center?.lng)
  const community = wgs84 ? await locateCommunityFromPoint(wgs84.lat, wgs84.lng, { limit: 1 }) : null
  const provinceName = PROVINCE_LABELS[provinceCode]

  return {
    code,
    provinceCode,
    divisionId: null,
    subdivisionId: null,
    subdivisionName: provinceName,
    centroidLat: center?.lat ?? null,
    centroidLng: center?.lng ?? null,
    bbox: computeBBox((feature.geometry as { coordinates?: unknown } | null)?.coordinates),
    geometry: null,
    defaultCommunitySlug: community?.primary?.communitySlug ?? null,
    defaultCommunityName: community?.primary?.communityName ?? provinceName,
  }
}

function summarizeCentroid(feature: unknown): { lat: number; lng: number } | null {
  try {
    const center = centroid(feature as any)
    const coords = center.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) return null
    const lng = Number(coords[0])
    const lat = Number(coords[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }
  } catch {
    return null
  }
}

function computeBBox(coords: unknown): Prisma.JsonValue | null {
  const bounds = {
    minLat: Number.POSITIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  }
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const lng = Number(value[0])
      const lat = Number(value[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        bounds.minLat = Math.min(bounds.minLat, lat)
        bounds.minLng = Math.min(bounds.minLng, lng)
        bounds.maxLat = Math.max(bounds.maxLat, lat)
        bounds.maxLng = Math.max(bounds.maxLng, lng)
      }
      return
    }
    for (const entry of value) visit(entry)
  }
  visit(coords)
  if (!Number.isFinite(bounds.minLat) || !Number.isFinite(bounds.minLng)) return null
  return {
    minLat: Number(bounds.minLat.toFixed(6)),
    minLng: Number(bounds.minLng.toFixed(6)),
    maxLat: Number(bounds.maxLat.toFixed(6)),
    maxLng: Number(bounds.maxLng.toFixed(6)),
  }
}

function getProvinceCode(value: unknown): ProvinceCode | null {
  if (value == null) return null
  const key = String(value).trim().replace(/[^0-9]/g, '').padStart(2, '0').slice(0, 2)
  return PROVINCE_CODE_BY_UID[key] ?? null
}

async function updatePointGeometries() {
  await prisma.$executeRaw`
    UPDATE "ForwardSortationArea"
    SET "pointGeom" = ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326)
    WHERE "centroidLat" IS NOT NULL
      AND "centroidLng" IS NOT NULL
  `
}

main().catch((error) => {
  console.error('Failed to restore FSA rows:', error)
  prisma.$disconnect().catch(() => {
    /* noop */
  })
  process.exitCode = 1
})
