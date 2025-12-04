import { prisma } from "@civil/db";

const [divisions, subdivisions, fsas] = await prisma.$transaction([
  prisma.censusDivision.count(),
  prisma.censusSubdivision.count(),
  prisma.forwardSortationArea.count(),
]);

console.log({ divisions, subdivisions, fsas });
await prisma.$disconnect();
