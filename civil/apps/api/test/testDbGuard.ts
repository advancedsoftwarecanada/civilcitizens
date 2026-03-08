import { prisma } from '@civil/db'

function describeDatabaseTarget(databaseUrl: string): { host: string; port: string; name: string } | null {
  try {
    const parsed = new URL(databaseUrl)
    return {
      host: parsed.hostname || 'unknown-host',
      port: parsed.port || 'default',
      name: parsed.pathname.replace(/^\//, '') || 'unknown-db',
    }
  } catch {
    return null
  }
}

function assertSafeTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('Refusing destructive API tests: DATABASE_URL is not set.')
  }

  const target = describeDatabaseTarget(databaseUrl)
  if (!target) {
    throw new Error(`Refusing destructive API tests: DATABASE_URL is not a valid URL: ${databaseUrl}`)
  }

  const dbName = target.name.toLowerCase()
  const looksLikeTestDb = dbName === 'civil_test' || dbName.endsWith('_test') || dbName.includes('test')
  if (!looksLikeTestDb) {
    throw new Error(
      `Refusing destructive API tests against ${target.host}:${target.port}/${target.name}. ` +
        'Point DATABASE_URL at a dedicated test database such as civil_test.',
    )
  }
}

export async function truncateTables(tables: string[]) {
  assertSafeTestDatabase()
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)
  }
}