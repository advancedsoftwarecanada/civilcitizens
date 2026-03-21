import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { z } from 'zod'
import { readFeaturedDriverVehicle } from './delivery.js'

type DriveRideDeps = Record<string, any>

const RIDE_DRIVER_FLAT_FEE_CENTS = 1000
const RIDE_FUEL_RATE_CENTS_PER_KM = 65
const RIDE_MIN_FUEL_CHARGE_CENTS = 500

const RideRequestQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const RideAddressSchema = z
  .object({
    name: z.string().trim().max(120).optional().nullable(),
    label: z.string().trim().max(80).optional().nullable(),
    line1: z.string().trim().min(1).max(180),
    line2: z.string().trim().max(180).optional().nullable(),
    city: z.string().trim().min(1).max(120),
    province: z.string().trim().min(2).max(64),
    postalCode: z.string().trim().min(3).max(32),
    originalPostalCode: z.string().trim().max(32).optional().nullable(),
    country: z.string().trim().max(2).optional().nullable(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    nominatimDisplayName: z.string().trim().max(500).optional().nullable(),
    nominatimRaw: z.unknown().optional().nullable(),
  })
  .strict()

const RideCreateBody = z
  .object({
    pickupAddress: RideAddressSchema,
    dropoffAddress: RideAddressSchema,
    recurrence: z.enum(['once', 'recurring']),
    pickupAt: z.string().datetime(),
    dropoffAt: z.string().datetime(),
  })
  .strict()

type RideAddress = {
  name: string | null
  label: string | null
  line1: string
  line2: string | null
  city: string
  province: string
  postalCode: string
  originalPostalCode: string | null
  country: string
  latitude: number
  longitude: number
  nominatimDisplayName: string | null
  nominatimRaw: unknown
}

type RideRequestRow = {
  id: string
  requester_user_id: string
  status: string
  recurrence: string
  pickup_address: unknown
  dropoff_address: unknown
  pickup_at: Date
  dropoff_at: Date
  route_distance_km: number
  fuel_charge_cents: number
  driver_fee_cents: number
  total_cost_cents: number
  created_at: Date
  requester_handle: string | null
  requester_name: string | null
  requester_avatar_url: string | null
}

type DriveDeliveryRow = {
  id: string
  status: string
  listing_id: string
  listing_title: string
  listing_photo_urls: unknown
  pickup_city: string | null
  pickup_province: string | null
  pickup_instructions: string | null
  item_traits: unknown
  bid_driver_user_id: string | null
  bid_amount_cents: number | null
  created_at: Date
  seller_id: string
  seller_handle: string | null
  seller_name: string | null
  seller_avatar_url: string | null
  buyer_id: string
  buyer_handle: string | null
  buyer_name: string | null
  buyer_avatar_url: string | null
}

type DriveDriverRow = {
  id: string
  handle: string | null
  name: string | null
  bio: string | null
  avatar_url: string | null
  cover_url: string | null
  billing_city: string | null
  billing_state: string | null
  community_meta: unknown
  active_at: string | null
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function normalizePostalCode(value: string) {
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
  if (compact.length <= 3) return compact
  return `${compact.slice(0, 3)} ${compact.slice(3)}`
}

function normalizeProvince(value: string) {
  return value.trim().toUpperCase().slice(0, 64)
}

function normalizeRideAddress(value: z.infer<typeof RideAddressSchema>): RideAddress {
  return {
    name: normalizeText(value.name, 120),
    label: normalizeText(value.label, 80),
    line1: value.line1.trim().slice(0, 180),
    line2: normalizeText(value.line2, 180),
    city: value.city.trim().slice(0, 120),
    province: normalizeProvince(value.province),
    postalCode: normalizePostalCode(value.postalCode),
    originalPostalCode: normalizeText(value.originalPostalCode, 32),
    country: normalizeText(value.country, 2)?.toUpperCase() ?? 'CA',
    latitude: value.latitude,
    longitude: value.longitude,
    nominatimDisplayName: normalizeText(value.nominatimDisplayName, 500),
    nominatimRaw: value.nominatimRaw ?? null,
  }
}

function readStoredRideAddress(value: unknown): RideAddress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const line1 = normalizeText(record.line1, 180)
  const city = normalizeText(record.city, 120)
  const province = normalizeText(record.province, 64)
  const postalCode = normalizeText(record.postalCode, 32)
  const latitude = typeof record.latitude === 'number' && Number.isFinite(record.latitude) ? record.latitude : null
  const longitude = typeof record.longitude === 'number' && Number.isFinite(record.longitude) ? record.longitude : null
  if (!line1 || !city || !province || !postalCode || latitude === null || longitude === null) return null

  return {
    name: normalizeText(record.name, 120),
    label: normalizeText(record.label, 80),
    line1,
    line2: normalizeText(record.line2, 180),
    city,
    province: normalizeProvince(province),
    postalCode: normalizePostalCode(postalCode),
    originalPostalCode: normalizeText(record.originalPostalCode, 32),
    country: normalizeText(record.country, 2)?.toUpperCase() ?? 'CA',
    latitude,
    longitude,
    nominatimDisplayName: normalizeText(record.nominatimDisplayName, 500),
    nominatimRaw: record.nominatimRaw ?? null,
  }
}

function calculateDistanceKm(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  const earthRadiusKm = 6371
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(destination.latitude - origin.latitude)
  const deltaLon = toRadians(destination.longitude - origin.longitude)
  const originLat = toRadians(origin.latitude)
  const destinationLat = toRadians(destination.latitude)

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2) * Math.cos(originLat) * Math.cos(destinationLat)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function buildRideEstimate(distanceKm: number) {
  const safeDistanceKm = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0
  const fuelChargeCents = Math.max(RIDE_MIN_FUEL_CHARGE_CENTS, Math.round(safeDistanceKm * RIDE_FUEL_RATE_CENTS_PER_KM))
  const routeDistanceKm = Number(safeDistanceKm.toFixed(1))
  return {
    routeDistanceKm,
    fuelChargeCents,
    driverFeeCents: RIDE_DRIVER_FLAT_FEE_CENTS,
    totalCostCents: fuelChargeCents + RIDE_DRIVER_FLAT_FEE_CENTS,
  }
}

function mapRideRequestRow(row: RideRequestRow, viewerUserId: string | null) {
  const pickupAddress = readStoredRideAddress(row.pickup_address)
  const dropoffAddress = readStoredRideAddress(row.dropoff_address)

  return {
    id: row.id,
    status: row.status,
    recurrence: row.recurrence,
    pickupAddress,
    dropoffAddress,
    pickupAt: row.pickup_at.toISOString(),
    dropoffAt: row.dropoff_at.toISOString(),
    routeDistanceKm: typeof row.route_distance_km === 'number' && Number.isFinite(row.route_distance_km) ? Number(row.route_distance_km.toFixed(1)) : 0,
    fuelChargeCents: Number(row.fuel_charge_cents) || 0,
    driverFeeCents: Number(row.driver_fee_cents) || RIDE_DRIVER_FLAT_FEE_CENTS,
    totalCostCents: Number(row.total_cost_cents) || 0,
    createdAt: row.created_at.toISOString(),
    requester: {
      id: row.requester_user_id,
      handle: row.requester_handle,
      name: row.requester_name,
      avatarUrl: row.requester_avatar_url,
    },
    isOwner: Boolean(viewerUserId && viewerUserId === row.requester_user_id),
  }
}

function mapDeliveryRequestRow(row: DriveDeliveryRow, deps: DriveRideDeps) {
  return {
    id: row.id,
    status: row.status,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    listingPhotoUrl: deps.readGalleryUrls(row.listing_photo_urls)[0] ?? null,
    pickupCity: row.pickup_city,
    pickupProvince: row.pickup_province,
    pickupInstructions: row.pickup_instructions,
    itemTraits: Array.isArray(row.item_traits) ? (row.item_traits as unknown[]).filter((entry: unknown): entry is string => typeof entry === 'string') : [],
    bidPending: Boolean(row.bid_driver_user_id),
    bidAmountCents: row.bid_amount_cents,
    createdAt: row.created_at.toISOString(),
    seller: {
      id: row.seller_id,
      handle: row.seller_handle,
      name: row.seller_name,
      avatarUrl: row.seller_avatar_url,
    },
    buyer: {
      id: row.buyer_id,
      handle: row.buyer_handle,
      name: row.buyer_name,
      avatarUrl: row.buyer_avatar_url,
    },
  }
}

function readPreferredShippingAddress(value: unknown, deps: DriveRideDeps) {
  const savedAddresses = typeof deps.readMarketShippingAddresses === 'function' ? deps.readMarketShippingAddresses(value ?? null) : []
  return savedAddresses.find((entry: Record<string, unknown>) => entry.isDefault === true) ?? savedAddresses[0] ?? null
}

function resolveDriveDriverLocation(row: DriveDriverRow, deps: DriveRideDeps) {
  const billingCity = normalizeText(row.billing_city, 120)
  const billingProvince = normalizeText(row.billing_state, 64)

  if (billingCity || billingProvince) {
    return {
      city: billingCity,
      province: billingProvince ? normalizeProvince(billingProvince) : null,
    }
  }

  const preferred = readPreferredShippingAddress(row.community_meta, deps)
  const city = normalizeText(preferred?.city, 120)
  const province = normalizeText(preferred?.province, 64)

  return {
    city,
    province: province ? normalizeProvince(province) : null,
  }
}

function mapDriveDriverRow(row: DriveDriverRow, deps: DriveRideDeps) {
  const location = resolveDriveDriverLocation(row, deps)
  const featuredVehicle = readFeaturedDriverVehicle(row.community_meta)
  const bio =
    typeof row.bio === 'string' && row.bio.trim()
      ? String(typeof deps.sanitizePlainText === 'function' ? deps.sanitizePlainText(row.bio) : row.bio)
          .replace(/\s+/g, ' ')
          .trim() || null
      : null

  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    bio,
    avatarUrl: row.avatar_url,
    coverUrl: row.cover_url,
    activeAt: row.active_at,
    city: location.city,
    province: location.province,
    featuredVehicle: featuredVehicle
      ? {
          id: featuredVehicle.id,
          name: featuredVehicle.name,
          photoUrl: featuredVehicle.photoUrls[0] ?? null,
          minimumRideAmountCents: featuredVehicle.minimumRideAmountCents,
          perKmFeeCents: featuredVehicle.perKmFeeCents,
        }
      : null,
  }
}

export function registerDriveRideRoutes(app: FastifyInstance, deps: DriveRideDeps) {
  app.get('/drive/rides', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = RideRequestQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      await deps.ensureCitizenMarketplaceTables()

      const rows = await prisma.$queryRaw<RideRequestRow[]>`
        SELECT
          r.id,
          r.requester_user_id,
          r.status,
          r.recurrence,
          r.pickup_address,
          r.dropoff_address,
          r.pickup_at,
          r.dropoff_at,
          r.route_distance_km,
          r.fuel_charge_cents,
          r.driver_fee_cents,
          r.total_cost_cents,
          r.created_at,
          requester.handle AS requester_handle,
          requester.name AS requester_name,
          requester."avatarUrl" AS requester_avatar_url
        FROM citizen_drive_ride_request r
        INNER JOIN "User" requester ON requester.id = r.requester_user_id
        WHERE r.status = 'open'
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${query.data.limit}
      `

      return reply.send({
        items: rows
          .map((row: RideRequestRow) => mapRideRequestRow(row, userId))
          .filter((item: ReturnType<typeof mapRideRequestRow>) => item.pickupAddress && item.dropoffAddress),
      })
    }),
  )

  app.get('/drive/delivery', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = RideRequestQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      await deps.ensureCitizenMarketplaceTables()

      const rows = await prisma.$queryRaw<DriveDeliveryRow[]>`
        SELECT
          c.id,
          c.status,
          c.listing_id,
          l.title AS listing_title,
          l.photo_urls AS listing_photo_urls,
          l.pickup_city,
          l.pickup_province,
          c.pickup_instructions,
          c.item_traits,
          c.bid_driver_user_id,
          c.bid_amount_cents,
          c.created_at,
          seller.id AS seller_id,
          seller.handle AS seller_handle,
          seller.name AS seller_name,
          seller."avatarUrl" AS seller_avatar_url,
          buyer.id AS buyer_id,
          buyer.handle AS buyer_handle,
          buyer.name AS buyer_name,
          buyer."avatarUrl" AS buyer_avatar_url
        FROM citizen_market_delivery_contract c
        INNER JOIN citizen_market_listing l ON l.id = c.listing_id
        INNER JOIN "User" seller ON seller.id = c.seller_user_id
        INNER JOIN "User" buyer ON buyer.id = c.buyer_user_id
        WHERE c.status IN ('open', 'bid_pending')
          AND c.driver_user_id IS NULL
          AND l.is_active = TRUE
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT ${query.data.limit}
      `

      return reply.send({
        items: rows.map((row: DriveDeliveryRow) => mapDeliveryRequestRow(row, deps)),
      })
    }),
  )

  app.get('/drive/drivers', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = RideRequestQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      const rows = await prisma.$queryRaw<DriveDriverRow[]>`
        SELECT
          u.id,
          u.handle,
          u.name,
          u.bio,
          u."avatarUrl" AS avatar_url,
          u."coverUrl" AS cover_url,
          u."billingCity" AS billing_city,
          u."billingState" AS billing_state,
          u."communityMeta" AS community_meta,
          NULLIF(u."communityMeta" -> 'deliveryDriver' ->> 'activeAt', '') AS active_at
        FROM "User" u
        WHERE NULLIF(u."communityMeta" -> 'deliveryDriver' ->> 'activeAt', '') IS NOT NULL
        ORDER BY NULLIF(u."communityMeta" -> 'deliveryDriver' ->> 'activeAt', '') DESC, u.id DESC
        LIMIT ${query.data.limit}
      `

      return reply.send({
        items: rows
          .map((row: DriveDriverRow) => mapDriveDriverRow(row, deps))
          .filter((item: ReturnType<typeof mapDriveDriverRow>) => item.activeAt),
      })
    }),
  )

  app.post('/drive/rides', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const body = RideCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

      await deps.ensureCitizenMarketplaceTables()

      const pickupAddress = normalizeRideAddress(body.data.pickupAddress)
      const dropoffAddress = normalizeRideAddress(body.data.dropoffAddress)
      const pickupAt = new Date(body.data.pickupAt)
      const dropoffAt = new Date(body.data.dropoffAt)

      if (!Number.isFinite(pickupAt.getTime()) || !Number.isFinite(dropoffAt.getTime()) || dropoffAt.getTime() <= pickupAt.getTime()) {
        return reply.code(400).send({ error: 'invalid_schedule' })
      }

      const distanceKm = calculateDistanceKm(
        { latitude: pickupAddress.latitude, longitude: pickupAddress.longitude },
        { latitude: dropoffAddress.latitude, longitude: dropoffAddress.longitude },
      )
      const estimate = buildRideEstimate(distanceKm)
      const rideRequestId = randomUUID()

      await prisma.$executeRaw`
        INSERT INTO citizen_drive_ride_request (
          id,
          requester_user_id,
          status,
          recurrence,
          pickup_address,
          pickup_city,
          pickup_province,
          pickup_postal_code,
          pickup_latitude,
          pickup_longitude,
          dropoff_address,
          dropoff_city,
          dropoff_province,
          dropoff_postal_code,
          dropoff_latitude,
          dropoff_longitude,
          pickup_at,
          dropoff_at,
          route_distance_km,
          fuel_charge_cents,
          driver_fee_cents,
          total_cost_cents,
          created_at,
          updated_at
        )
        VALUES (
          ${rideRequestId},
          ${userId},
          ${'open'},
          ${body.data.recurrence},
          ${JSON.stringify(pickupAddress)}::jsonb,
          ${pickupAddress.city},
          ${pickupAddress.province},
          ${pickupAddress.postalCode},
          ${pickupAddress.latitude},
          ${pickupAddress.longitude},
          ${JSON.stringify(dropoffAddress)}::jsonb,
          ${dropoffAddress.city},
          ${dropoffAddress.province},
          ${dropoffAddress.postalCode},
          ${dropoffAddress.latitude},
          ${dropoffAddress.longitude},
          ${pickupAt.toISOString()}::timestamptz,
          ${dropoffAt.toISOString()}::timestamptz,
          ${estimate.routeDistanceKm},
          ${estimate.fuelChargeCents},
          ${estimate.driverFeeCents},
          ${estimate.totalCostCents},
          NOW(),
          NOW()
        )
      `

      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, handle: true, name: true, avatarUrl: true },
      })

      return reply.code(201).send({
        item: {
          id: rideRequestId,
          status: 'open',
          recurrence: body.data.recurrence,
          pickupAddress,
          dropoffAddress,
          pickupAt: pickupAt.toISOString(),
          dropoffAt: dropoffAt.toISOString(),
          routeDistanceKm: estimate.routeDistanceKm,
          fuelChargeCents: estimate.fuelChargeCents,
          driverFeeCents: estimate.driverFeeCents,
          totalCostCents: estimate.totalCostCents,
          createdAt: new Date().toISOString(),
          requester: {
            id: requester?.id ?? userId,
            handle: requester?.handle ?? null,
            name: requester?.name ?? null,
            avatarUrl: requester?.avatarUrl ?? null,
          },
          isOwner: true,
        },
      })
    }),
  )
}
