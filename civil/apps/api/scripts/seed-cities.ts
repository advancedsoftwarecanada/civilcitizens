/* eslint-disable no-console */
import unzipper from 'unzipper'
import { prisma } from '@civil/db'
import { locateChamberFromPoint, ensureGeoCache } from '../src/geodata.js'
import { slugifyChamberName, type ProvinceCode } from '@civil/shared'

type GeoNamesRow = {
  geonameId: string
  name: string
  latitude: number
  longitude: number
  featureClass: string
  featureCode: string
  provinceCode: ProvinceCode
  population: number
}

type CityCandidate = {
  provinceCode: ProvinceCode
  name: string
  slug: string
  latitude: number
  longitude: number
  population: number | null
  chamberSlug: string
  chamberName: string
  matchMethod: string
  matchConfidence: string
  matchDistanceKm: number | null
  featureClass: string | null
  featureCode: string | null
  source: string
  sourceId: string
}

const DATASET_URL = process.env.CITY_DATA_URL ?? 'https://download.geonames.org/export/dump/CA.zip'
const MIN_POPULATION = Number.parseInt(process.env.CITY_MIN_POP ?? '1000', 10)
const MAX_CITIES = Number.parseInt(process.env.CITY_MAX ?? '0', 10)
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.CITY_CONCURRENCY ?? '4', 10))
const SOURCE_ID = 'geonames_ca'

const FEATURE_CODE_ALLOWLIST = new Set<string>([
  'PPL',
  'PPLA',
  'PPLA2',
  'PPLA3',
  'PPLA4',
  'PPLC',
  'PPLF',
  'PPLG',
  'PPLH',
  'PPLL',
  'PPLQ',
  'PPLR',
  'PPLS',
  'PPLX',
])

const PROVINCE_BY_ADMIN1: Record<string, ProvinceCode> = {
  '01': 'ab',
  '02': 'bc',
  '03': 'mb',
  '04': 'nb',
  '05': 'nl',
  '07': 'ns',
  '08': 'on',
  '09': 'pe',
  '10': 'qc',
  '11': 'sk',
  '12': 'yt',
  '13': 'nt',
  '14': 'nu',
}

function slugifyCityName(name: string): string {
  return slugifyChamberName(name)
}

async function downloadGeoNamesFile(): Promise<string> {
  const res = await fetch(DATASET_URL)
  if (!res.ok) {
    throw new Error(`Failed to download GeoNames dataset (${res.status})`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const directory = await unzipper.Open.buffer(buffer)
  const entry = directory.files.find((file) => file.path.toLowerCase() === 'ca.txt')
  if (!entry) {
    throw new Error('GeoNames CA.txt file not found in archive')
  }
  const fileBuffer = await entry.buffer()
  return fileBuffer.toString('utf8')
}

function parseGeoNames(content: string): GeoNamesRow[] {
  const rows: GeoNamesRow[] = []
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 19) continue
    const [geonameId, name, , , latitudeRaw, longitudeRaw, featureClass, featureCode, countryCode, , admin1] = parts
    if (countryCode !== 'CA') continue
    const provinceCode = PROVINCE_BY_ADMIN1[admin1]
    if (!provinceCode) continue
    if (featureClass !== 'P') continue
    if (!FEATURE_CODE_ALLOWLIST.has(featureCode)) continue
    const latitude = Number.parseFloat(latitudeRaw)
    const longitude = Number.parseFloat(longitudeRaw)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    const populationValue = Number.parseInt(parts[14] ?? '0', 10)
    const population = Number.isNaN(populationValue) ? 0 : populationValue
    if (population < MIN_POPULATION) continue
    rows.push({
      geonameId,
      name,
      latitude,
      longitude,
      featureClass,
      featureCode,
      provinceCode,
      population,
    })
  }
  return rows
}

async function buildCityCandidate(row: GeoNamesRow): Promise<CityCandidate | null> {
  const match = await locateChamberFromPoint(row.latitude, row.longitude, { limit: 1 })
  if (!match.primary) return null
  return {
    provinceCode: row.provinceCode,
    name: row.name.trim(),
    slug: slugifyCityName(row.name),
    latitude: Number(row.latitude.toFixed(6)),
    longitude: Number(row.longitude.toFixed(6)),
    population: Number.isFinite(row.population) ? row.population : null,
    chamberSlug: match.primary.chamberSlug,
    chamberName: match.primary.chamberName,
    matchMethod: match.primary.method,
    matchConfidence: match.primary.confidence,
    matchDistanceKm: match.primary.distanceKm ?? null,
    featureClass: row.featureClass,
    featureCode: row.featureCode,
    source: SOURCE_ID,
    sourceId: row.geonameId,
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size))
  }
  return output
}

async function main() {
  console.log('Downloading GeoNames dataset…')
  const rawFile = await downloadGeoNamesFile()
  console.log('Parsing GeoNames entries…')
  const rows = parseGeoNames(rawFile)
  console.log(`Parsed ${rows.length} candidate cities (population >= ${MIN_POPULATION})`)

  console.log('Loading Elections Canada EDA boundaries…')
  const cache = await ensureGeoCache()
  console.log(`Loaded ${cache.features.length} districts from ${cache.sourceUrl}`)

  console.log(`Matching candidates to EDAs using ${CONCURRENCY} worker(s)…`)
  const deduped = new Map<string, CityCandidate>()
  let processed = 0
  let cursor = 0
  let shouldStop = false

  async function handleRow(row: GeoNamesRow) {
    const candidate = await buildCityCandidate(row)
    processed += 1
    if (processed % 250 === 0) {
      console.log(`Processed ${processed} rows → ${deduped.size} unique cities so far`)
    }
    if (!candidate) return
    const key = `${candidate.provinceCode}:${candidate.slug}`
    const existing = deduped.get(key)
    if (!existing || (candidate.population ?? 0) > (existing.population ?? 0)) {
      deduped.set(key, candidate)
    }
    if (MAX_CITIES > 0 && deduped.size >= MAX_CITIES) {
      shouldStop = true
    }
  }

  async function worker() {
    while (true) {
      if (shouldStop) break
      if (MAX_CITIES > 0 && deduped.size >= MAX_CITIES) {
        shouldStop = true
        break
      }
      const index = cursor
      if (index >= rows.length) break
      cursor += 1
      const row = rows[index]
      if (!row) break
      await handleRow(row)
    }
  }

  const workerCount = Math.min(CONCURRENCY, rows.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const cities = Array.from(deduped.values())
  console.log(`Resolved ${cities.length} city records mapped to EDAs`)

  await prisma.$transaction(async (tx) => {
    await tx.city.deleteMany()
    const chunks = chunkArray(cities, 500)
    for (const chunk of chunks) {
      await tx.city.createMany({
        data: chunk.map((entry) => ({
          provinceCode: entry.provinceCode,
          name: entry.name,
          slug: entry.slug,
          chamberSlug: entry.chamberSlug,
          chamberName: entry.chamberName,
          latitude: entry.latitude,
          longitude: entry.longitude,
          population: entry.population ?? null,
          source: entry.source,
          sourceId: entry.sourceId,
          featureClass: entry.featureClass,
          featureCode: entry.featureCode,
          matchMethod: entry.matchMethod,
          matchConfidence: entry.matchConfidence,
          matchDistanceKm: entry.matchDistanceKm ?? null,
        })),
      })
    }
  })

  console.log(`Seeded ${cities.length} cities into the database`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Failed to seed cities:', error)
  prisma.$disconnect().catch(() => {
    /* noop */
  })
  process.exitCode = 1
})
