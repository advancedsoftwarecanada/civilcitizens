import { prisma } from '@civil/db'

async function main() {
  const email = 'demo@civil.local'
  const handle = 'demo'
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, handle, name: 'Demo User' },
  })
  console.log('Seeded demo user')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
