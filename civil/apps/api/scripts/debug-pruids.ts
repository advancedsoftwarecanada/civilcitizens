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
  let idx = 0
  while (true) {
    const { done, value } = await source.read()
    if (done) break
    if (!value || !value.properties) continue
    const record = value.properties as Record<string, unknown>
    const pruid = record.PRUID ?? record.PRUID_E ?? record.PRUID_F
    const name = record.CDNAME ?? record.NAME
    console.log(idx.toString().padStart(4, '0'), pruid, name)
    idx += 1
    if (idx >= 25) break
  }
  if (typeof (source as { close?: () => Promise<void> }).close === 'function') {
    await (source as { close: () => Promise<void> }).close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
