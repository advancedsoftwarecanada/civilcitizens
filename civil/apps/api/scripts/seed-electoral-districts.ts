/* eslint-disable no-console */
import { seedElectoralDistricts } from '../src/geospatial.js'

async function main() {
  const count = await seedElectoralDistricts({ force: true })
  console.log(`Seeded ${count} electoral districts into PostGIS.`)
}

main().catch((error) => {
  console.error('Failed to seed electoral districts:', error)
  process.exit(1)
})