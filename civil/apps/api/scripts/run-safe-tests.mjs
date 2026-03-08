import { spawn } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

function isTestDatabaseName(name) {
  const normalized = String(name || '').toLowerCase()
  return normalized === 'civil_test' || normalized.endsWith('_test') || normalized.includes('test')
}

function toSafeTestDatabaseUrl() {
  const explicitTestUrl = process.env.API_TEST_DATABASE_URL?.trim()
  const cyPort = process.env.CYBERTRON_POSTGRES_PORT?.trim() || '5542'
  const fallbackUrl = `postgresql://postgres:postgres@localhost:${cyPort}/civil_test`

  if (explicitTestUrl) {
    const parsed = new URL(explicitTestUrl)
    const dbName = parsed.pathname.replace(/^\//, '')
    if (!isTestDatabaseName(dbName)) {
      throw new Error(`API_TEST_DATABASE_URL must point at a test database, received: ${explicitTestUrl}`)
    }
    return parsed.toString()
  }

  return fallbackUrl
}

function redactDatabaseUrl(rawUrl) {
  const parsed = new URL(rawUrl)
  if (parsed.password) parsed.password = '***'
  return parsed.toString()
}

function spawnAndWait(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: true,
    })

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`))
        return
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`${command} exited with code ${code}`))
        return
      }
      resolve()
    })
  })
}

async function ensureDatabaseExists(databaseUrl) {
  const target = new URL(databaseUrl)
  const dbName = target.pathname.replace(/^\//, '')
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Unsafe test database name: ${dbName}`)
  }

  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'

  const admin = new PrismaClient({
    datasources: {
      db: {
        url: adminUrl.toString(),
      },
    },
  })

  try {
    const existing = await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${dbName}' LIMIT 1`)
    if (Array.isArray(existing) && existing.length > 0) return
    console.log(`[safe-test] Creating database ${dbName}`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.$disconnect()
  }
}

async function prepareTestDatabase(databaseUrl) {
  await ensureDatabaseExists(databaseUrl)
  console.log(`[safe-test] Applying migrations to ${redactDatabaseUrl(databaseUrl)}`)
  await spawnAndWait(
    'pnpm',
    ['--filter', '@civil/db', 'exec', 'prisma', 'migrate', 'deploy', '--schema', 'schema.prisma'],
    {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  )
}

const vitestArgs = process.argv.slice(2)
const safeDatabaseUrl = toSafeTestDatabaseUrl()

console.log(`[safe-test] Using DATABASE_URL=${redactDatabaseUrl(safeDatabaseUrl)}`)

try {
  await prepareTestDatabase(safeDatabaseUrl)
  await spawnAndWait('vitest', ['run', ...vitestArgs], {
    ...process.env,
    DATABASE_URL: safeDatabaseUrl,
  })
} catch (error) {
  console.error(`[safe-test] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
