import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

const POSTAL_SANITIZE_RE = /[^A-Z0-9]/g
const EARTH_RADIUS_METERS = 6371000
let ensureAddressCorrectionInfraPromise: Promise<void> | null = null

const ResolveAddressCorrectionsBody = z.object({
  points: z.array(z.object({
    latitude: z.coerce.number().finite().min(-90).max(90),
    longitude: z.coerce.number().finite().min(-180).max(180),
    postalCode: z.string().trim().max(32).optional().nullable(),
  })).min(1).max(20),
  radiusMeters: z.coerce.number().finite().min(1).max(200).optional().default(50),
})

const CreateAddressCorrectionBody = z.object({
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
  originalPostal: z.string().trim().max(32).optional().nullable(),
  correctedPostal: z.string().trim().min(3).max(32),
})

const ListAddressCorrectionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
})

async function ensureAddressCorrectionInfra() {
  if (!ensureAddressCorrectionInfraPromise) {
    ensureAddressCorrectionInfraPromise = (async () => {
      let hasPostgis = false
      try {
        const extensionRows = await prisma.$queryRaw<Array<{ installed: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'postgis'
          ) AS installed
        `
        hasPostgis = Boolean(extensionRows[0]?.installed)
      } catch {
        hasPostgis = false
      }

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type
            WHERE typname = 'AddressCorrectionSource'
          ) THEN
            CREATE TYPE "AddressCorrectionSource" AS ENUM ('USER');
          END IF;
        END $$;
      `)

      if (hasPostgis) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "AddressCorrection" (
            "id" TEXT NOT NULL,
            "latitude" DOUBLE PRECISION NOT NULL,
            "longitude" DOUBLE PRECISION NOT NULL,
            "originalPostal" TEXT,
            "correctedPostal" TEXT NOT NULL,
            "source" "AddressCorrectionSource" NOT NULL DEFAULT 'USER',
            "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            "createdByUserId" TEXT,
            "pointGeom" geometry(Point, 4326),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "AddressCorrection_pkey" PRIMARY KEY ("id")
          )
        `)
      } else {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "AddressCorrection" (
            "id" TEXT NOT NULL,
            "latitude" DOUBLE PRECISION NOT NULL,
            "longitude" DOUBLE PRECISION NOT NULL,
            "originalPostal" TEXT,
            "correctedPostal" TEXT NOT NULL,
            "source" "AddressCorrectionSource" NOT NULL DEFAULT 'USER',
            "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            "createdByUserId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "AddressCorrection_pkey" PRIMARY KEY ("id")
          )
        `)
      }

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "AddressCorrection_createdByUserId_idx"
        ON "AddressCorrection" ("createdByUserId")
      `)
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "AddressCorrection_latitude_longitude_idx"
        ON "AddressCorrection" ("latitude", "longitude")
      `)
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "AddressCorrection_correctedPostal_idx"
        ON "AddressCorrection" ("correctedPostal")
      `)

      if (hasPostgis) {
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "AddressCorrection_pointGeom_gist"
          ON "AddressCorrection" USING GIST ("pointGeom")
        `)
      }

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'AddressCorrection_createdByUserId_fkey'
          ) THEN
            ALTER TABLE "AddressCorrection"
              ADD CONSTRAINT "AddressCorrection_createdByUserId_fkey"
              FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
              ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END $$;
      `)
    })().catch((error) => {
      ensureAddressCorrectionInfraPromise = null
      throw error
    })
  }

  await ensureAddressCorrectionInfraPromise
}

function normalizePostalCode(value: string | null | undefined) {
  const compact = String(value ?? '').toUpperCase().replace(POSTAL_SANITIZE_RE, '').slice(0, 6)
  if (compact.length <= 3) return compact
  return `${compact.slice(0, 3)} ${compact.slice(3)}`
}

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(lat2 - lat1)
  const deltaLng = toRadians(lng2 - lng1)
  const originLat = toRadians(lat1)
  const destinationLat = toRadians(lat2)
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2) * Math.cos(originLat) * Math.cos(destinationLat)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_METERS * c
}

type CorrectionMatch = {
  id: string
  correctedPostal: string
  originalPostal: string | null
  source: string
  confidenceScore: number
  distanceMeters: number
}

type AddressCorrectionAuditRow = {
  id: string
  latitude: number
  longitude: number
  originalPostal: string | null
  correctedPostal: string
  source: string
  confidenceScore: number
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
  createdByHandle: string | null
  createdByName: string | null
  createdBySuspendedAt: Date | null
}

async function findNearestCorrection(latitude: number, longitude: number, radiusMeters: number): Promise<CorrectionMatch | null> {
  await ensureAddressCorrectionInfra()
  try {
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`
    const rows = await prisma.$queryRaw<CorrectionMatch[]>`
      SELECT
        ac."id",
        ac."correctedPostal",
        ac."originalPostal",
        ac."source"::text AS "source",
        ac."confidenceScore",
        ST_DistanceSphere(ac."pointGeom", ${point}) AS "distanceMeters"
      FROM "AddressCorrection" ac
      WHERE ac."pointGeom" IS NOT NULL
        AND ST_DWithin(ac."pointGeom"::geography, ${point}::geography, ${radiusMeters})
      ORDER BY "distanceMeters" ASC, ac."confidenceScore" DESC, ac."createdAt" DESC
      LIMIT 1
    `
    return rows[0] ?? null
  } catch {
    const candidates = await prisma.$queryRaw<Array<{
      id: string
      latitude: number
      longitude: number
      correctedPostal: string
      originalPostal: string | null
      source: string
      confidenceScore: number
      createdAt: Date
    }>>`
      SELECT
        ac."id",
        ac."latitude",
        ac."longitude",
        ac."correctedPostal",
        ac."originalPostal",
        ac."source"::text AS "source",
        ac."confidenceScore",
        ac."createdAt"
      FROM "AddressCorrection" ac
      WHERE ac."latitude" BETWEEN ${latitude - 0.002} AND ${latitude + 0.002}
        AND ac."longitude" BETWEEN ${longitude - 0.002} AND ${longitude + 0.002}
      ORDER BY ac."confidenceScore" DESC, ac."createdAt" DESC
      LIMIT 25
    `

    let best: CorrectionMatch | null = null
    for (const candidate of candidates) {
      const distanceMeters = haversineDistanceMeters(latitude, longitude, candidate.latitude, candidate.longitude)
      if (distanceMeters > radiusMeters) continue
      if (!best || distanceMeters < best.distanceMeters || (distanceMeters === best.distanceMeters && candidate.confidenceScore > best.confidenceScore)) {
        best = {
          id: candidate.id,
          correctedPostal: candidate.correctedPostal,
          originalPostal: candidate.originalPostal,
          source: candidate.source,
          confidenceScore: candidate.confidenceScore,
          distanceMeters,
        }
      }
    }
    return best
  }
}

async function createAddressCorrection(input: {
  latitude: number
  longitude: number
  originalPostal: string | null
  correctedPostal: string
  createdByUserId: string
}) {
  await ensureAddressCorrectionInfra()
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "AddressCorrection" (
        "id",
        "latitude",
        "longitude",
        "originalPostal",
        "correctedPostal",
        "source",
        "confidenceScore",
        "createdByUserId",
        "pointGeom",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${randomUUID()},
        ${input.latitude},
        ${input.longitude},
        ${input.originalPostal},
        ${input.correctedPostal},
        ${'USER'}::"AddressCorrectionSource",
        ${1.0},
        ${input.createdByUserId},
        ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
        NOW(),
        NOW()
      )
      RETURNING "id"
    `
    return rows[0]?.id ?? null
  } catch {
    const id = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "AddressCorrection" (
        "id",
        "latitude",
        "longitude",
        "originalPostal",
        "correctedPostal",
        "source",
        "confidenceScore",
        "createdByUserId",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${input.latitude},
        ${input.longitude},
        ${input.originalPostal},
        ${input.correctedPostal},
        ${'USER'}::"AddressCorrectionSource",
        ${1.0},
        ${input.createdByUserId},
        NOW(),
        NOW()
      )
    `
    return id
  }
}

export function registerAddressCorrectionRoutes(app: FastifyInstance) {
  app.post('/address-corrections/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    await ensureAddressCorrectionInfra()
    const body = ResolveAddressCorrectionsBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const items = await Promise.all(body.data.points.map(async (point) => {
      const match = await findNearestCorrection(point.latitude, point.longitude, body.data.radiusMeters)
      return {
        latitude: point.latitude,
        longitude: point.longitude,
        originalPostal: normalizePostalCode(point.postalCode),
        correctedPostal: match?.correctedPostal ?? null,
        source: match?.source ?? null,
        confidenceScore: match?.confidenceScore ?? null,
        distanceMeters: match?.distanceMeters ?? null,
      }
    }))

    return reply.send({ items })
  })

  app.post('/address-corrections', async (req: FastifyRequest, reply: FastifyReply) => {
    await ensureAddressCorrectionInfra()
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const body = CreateAddressCorrectionBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const correctedPostal = normalizePostalCode(body.data.correctedPostal)
    const originalPostal = normalizePostalCode(body.data.originalPostal)
    if (!correctedPostal) return reply.code(400).send({ error: 'invalid_corrected_postal' })
    if (correctedPostal === originalPostal) {
      return reply.code(200).send({ ok: true, skipped: true })
    }

    const id = await createAddressCorrection({
      latitude: body.data.latitude,
      longitude: body.data.longitude,
      originalPostal: originalPostal || null,
      correctedPostal,
      createdByUserId: userId,
    })

    return reply.code(201).send({
      item: {
        id,
        latitude: body.data.latitude,
        longitude: body.data.longitude,
        originalPostal: originalPostal || null,
        correctedPostal,
        source: 'USER',
        confidenceScore: 1,
      },
    })
  })

  app.get('/address-corrections', async (req: FastifyRequest, reply: FastifyReply) => {
    await ensureAddressCorrectionInfra()
    const userId = (req as any).user?.id as string | undefined
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const query = ListAddressCorrectionsQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const rows = await prisma.$queryRaw<AddressCorrectionAuditRow[]>`
      SELECT
        ac."id",
        ac."latitude",
        ac."longitude",
        ac."originalPostal",
        ac."correctedPostal",
        ac."source"::text AS "source",
        ac."confidenceScore",
        ac."createdByUserId",
        ac."createdAt",
        ac."updatedAt",
        u."handle" AS "createdByHandle",
        u."name" AS "createdByName",
        u."suspendedAt" AS "createdBySuspendedAt"
      FROM "AddressCorrection" ac
      LEFT JOIN "User" u ON u."id" = ac."createdByUserId"
      ORDER BY ac."createdAt" DESC
      LIMIT ${query.data.limit}
    `

    return reply.send({
      items: rows.map((row: AddressCorrectionAuditRow) => ({
        id: row.id,
        latitude: row.latitude,
        longitude: row.longitude,
        originalPostal: row.originalPostal,
        correctedPostal: row.correctedPostal,
        source: row.source,
        confidenceScore: row.confidenceScore,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        createdBy: row.createdByUserId
          ? {
              id: row.createdByUserId,
              handle: row.createdByHandle,
              name: row.createdByName,
              suspendedAt: row.createdBySuspendedAt?.toISOString() ?? null,
            }
          : null,
      })),
    })
  })
}
