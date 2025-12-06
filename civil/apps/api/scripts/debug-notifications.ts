import { prisma } from '@civil/db'

async function resolveUserByHandleLike(term: string) {
  const exact = await prisma.user.findUnique({ where: { handle: term }, select: { id: true, handle: true } })
  if (exact) return exact
  const approximate = await prisma.user.findFirst({
    where: { handle: { contains: term, mode: 'insensitive' } },
    select: { id: true, handle: true },
  })
  return approximate
}

async function listRecent(limit: number) {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  console.log(`Latest ${notifications.length} notifications overall`)
  for (const notification of notifications) {
    console.log(
      `${notification.createdAt.toISOString()} | user=${notification.userId} | type=${notification.type} | actor=${notification.actorId} | payload=${JSON.stringify(notification.payload)}`,
    )
  }
}

async function listForHandle(handle: string, limit: number) {
  const user = await resolveUserByHandleLike(handle)
  if (!user) {
    console.error(`User with handle containing "${handle}" not found`)
    process.exit(1)
  }
  console.log(`Notifications for ${user.handle} (${user.id})`)
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  for (const notification of notifications) {
    console.log(`${notification.createdAt.toISOString()} | ${notification.type} | actor=${notification.actorId} | payload=${JSON.stringify(notification.payload)}`)
  }
  console.log(`Total fetched: ${notifications.length}`)
}

async function main() {
  const first = process.argv[2]
  const limit = Number(process.argv[3] ?? 20)
  console.log('DB URL', process.env.DATABASE_URL)
  if (!first || first === '--latest') {
    await listRecent(limit)
    return
  }
  await listForHandle(first, limit)
}

main()
  .catch((err) => {
    console.error('Error querying notifications', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
