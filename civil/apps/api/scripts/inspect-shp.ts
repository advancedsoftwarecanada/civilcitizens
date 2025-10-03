/* eslint-disable no-console */
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const unzipper = require('unzipper') as typeof import('unzipper')
import { read as readShapefile } from 'shapefile'

const DEFAULT_SHP_URL = 'https://elections.ca/res/cir/mapsCorner/vector/FederalElectoralDistricts_2025_SHP.zip'

async function downloadShapefile(url: string) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download shapefile: ${res.status} ${res.statusText}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function main() {
  const buffer = await downloadShapefile(DEFAULT_SHP_URL)
  const directory = await unzipper.Open.buffer(buffer)
  let shpBuffer: Buffer | null = null
  let dbfBuffer: Buffer | null = null
  for (const file of directory.files) {
    if (file.path.endsWith('.shp')) shpBuffer = await file.buffer()
    if (file.path.endsWith('.dbf')) dbfBuffer = await file.buffer()
  }
  if (!shpBuffer || !dbfBuffer) throw new Error('Missing required SHP/DBF entries')

  const geoJson = await readShapefile(shpBuffer, dbfBuffer) as {
    features: Array<{ properties?: Record<string, unknown> }>
  }
  console.log('total features', geoJson.features.length)
  const names = geoJson.features
    .map((f) => ({
      name: f.properties?.ED_NAMEE as unknown,
      code: (f.properties?.ED_UID ?? f.properties?.FEDUID ?? f.properties?.FED_ID) as unknown,
    }))

  const target = names.find((entry) => typeof entry.name === 'string' && entry.name.includes('York'))
  console.log('first York entry', target)
  const yorkEntries = names.filter((entry) => typeof entry.name === 'string' && entry.name.toLowerCase().includes('york'))
  console.log('york entries sample', yorkEntries.slice(0, 10))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
