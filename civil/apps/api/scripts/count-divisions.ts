/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import unzipper from 'unzipper'
import { open as openShapefile } from 'shapefile'

const archivePath = path.resolve(
  process.env.STATSCAN_CD_ZIP ?? path.join(process.cwd(), '..', '..', '..', '_geodata', 'lcd_000b21a_e.zip'),
)

async function main() {
  console.log('Reading', archivePath)
  const archive = await fs.readFile(archivePath)
  const directory = await unzipper.Open.buffer(archive)
  const shpEntry = directory.files.find((file) => file.type === 'File' && file.path.toLowerCase().endsWith('.shp'))
  const dbfEntry = directory.files.find((file) => file.type === 'File' && file.path.toLowerCase().endsWith('.dbf'))
  if (!shpEntry || !dbfEntry) throw new Error('missing shp/dbf')
  const [shpBuffer, dbfBuffer] = await Promise.all([shpEntry.buffer(), dbfEntry.buffer()])
  const source = await openShapefile(shpBuffer, dbfBuffer, { encoding: 'utf-8' })
  const counts: Record<string, number> = {}
  while (true) {
    const { done, value } = await source.read()
    if (done) break
    if (!value || !value.properties) continue
    const props = value.properties as Record<string, unknown>
    const pruid = props.PRUID ?? props.PRUID_E ?? props.PRUID_F
    const code = typeof pruid === 'number' ? pruid.toString().padStart(2, '0') : String(pruid ?? '').padStart(2, '0')
    if (!counts[code]) counts[code] = 0
    counts[code] += 1
  }
  const entries = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))
  for (const [code, count] of entries) {
    console.log(code, count)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
