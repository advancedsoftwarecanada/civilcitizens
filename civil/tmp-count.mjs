import { prisma } from './packages/db/dist/index.js'

const counts = {
  divisions: await prisma.censusDivision.count(),
  subdivisions: await prisma.censusSubdivision.count(),
  fsas: await prisma.forwardSortationArea.count(),
}

console.log(counts)
await prisma.$disconnect()
