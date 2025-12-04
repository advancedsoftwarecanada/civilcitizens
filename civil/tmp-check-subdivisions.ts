import { prisma } from '@civil/db'

async function main() {
  try {
    const rows = await prisma.censusSubdivision.findMany({
      take: 1,
      select: { id: true, name: true, geometry: true },
    })
    console.log(JSON.stringify(rows))
  } catch (error) {
    console.error('query failed', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
