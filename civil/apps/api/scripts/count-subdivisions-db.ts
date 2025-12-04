/* eslint-disable no-console */
import { prisma } from '@civil/db'

async function main() {
  const rows = await prisma.censusSubdivision.groupBy({
    by: ['provinceCode'],
    _count: { provinceCode: true },
    orderBy: { provinceCode: 'asc' },
  })
  for (const row of rows) {
    console.log(row.provinceCode, row._count.provinceCode)
  }
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  prisma.$disconnect().catch(() => {})
  process.exitCode = 1
})
