import { runDummySeed } from './dummy/index.js'

runDummySeed().catch((e) => {
  console.error(e)
  process.exit(1)
})
