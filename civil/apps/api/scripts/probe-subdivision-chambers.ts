/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import unzipper from 'unzipper'
import { open as openShapefile } from 'shapefile'
import centroid from '@turf/centroid'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { locateChamberFromPoint, ensureGeoCache } from '../src/geodata.js'

const DEFAULT_ARCHIVE = path.resolve(
  process.env.STATSCAN_CSD_ZIP ?? path.join(process.cwd(), '..', '..', '_geodata', 'lcsd000b21a_e.zip'),
)
const SAMPLE_COUNT = Number.parseInt(process.env.PROBE_SAMPLE_COUNT ?? '20', 10)

async function main() {
  console.log('Preparing chamber cache…')
  await ensureGeoCache()

  console.log('Loading subdivision shapefile from', DEFAULT_ARCHIVE)
  const archive = await fs.readFile(DEFAULT_ARCHIVE)
  const directory = await unzipper.Open.buffer(archive)
  const shpEntry = directory.files.find((file) => file.type === 'File' && file.path.toLowerCase().endsWith('.shp'))
  const dbfEntry = directory.files.find((file) => file.type === 'File' && file.path.toLowerCase().endsWith('.dbf'))
  if (!shpEntry || !dbfEntry) {
    throw new Error('Archive missing SHP or DBF content')
  }
  const [shpBuffer, dbfBuffer] = await Promise.all([shpEntry.buffer(), dbfEntry.buffer()])
  const source = await openShapefile(shpBuffer, dbfBuffer, { encoding: 'utf-8' })

  const started = performance.now()
  let processed = 0
  try {
    while (processed < SAMPLE_COUNT) {
      const { done, value } = await source.read()
      if (done) break
      if (!value || !value.geometry) continue
      const feature = value as Feature<Polygon | MultiPolygon>
      const center = centroid(feature)
      const coords = center.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length !== 2) continue
      const [lng, lat] = coords
      const t0 = performance.now()
      await locateChamberFromPoint(lat, lng, { limit: 1 })
      const t1 = performance.now()
      processed += 1
      console.log(`Record ${processed} took ${((t1 - t0) / 1000).toFixed(2)}s`)
    }
  } finally {
    if (typeof (source as { close?: () => Promise<void> }).close === 'function') {
      await (source as { close: () => Promise<void> }).close()
    }
  }
  console.log(`Finished ${processed} samples in ${((performance.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
