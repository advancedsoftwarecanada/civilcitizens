/* eslint-disable no-console */
import { ensureGeoCache, locateChamberFromPoint } from '../src/geodata'

async function main() {
  const cache = await ensureGeoCache()
  console.log('features cached:', cache.features.length)
  const slugs = ['york-durham', 'richmond-hill-south', 'thornhill']
  for (const slug of slugs) {
    const hit = cache.features.find((f) => f.slug === slug)
    console.log(
      slug,
      hit ? 'found' : 'missing',
      hit?.chamber.name,
      hit?.chamber.code,
      hit?.bbox
    )
  }

  const samples: Array<[number, number, string]> = [
    [43.95, -79.1, 'approx Goodwood'],
    [43.95, -79.28, 'Stouffville'],
    [44.04, -79.32, 'Uxbridge']
  ]

  for (const [lat, lng, label] of samples) {
    const res = await locateChamberFromPoint(lat, lng, { limit: 5 })
    console.log(label, res.primary, res.alternatives?.slice(0, 3))
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
