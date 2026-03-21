import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { MessageType, Prisma } from '@prisma/client'
import { z } from 'zod'
import { readWalletSummary, walletHasConnectPayoutsEnabled } from '../walletHelpers.js'

type DeliveryDeps = Record<string, any>

const DELIVERY_BID_OPTIONS = new Set([500, 1000, 2000, 5000, 10000])
const DRIVER_VEHICLE_LIMIT = 10
const DRIVER_VEHICLE_PHOTO_LIMIT = 8
const DRIVER_MIN_RIDE_AMOUNT_CENTS_MIN = 500
const DRIVER_PER_KM_FEE_CENTS_MIN = 100
const DRIVER_PER_KM_FEE_CENTS_MAX = 300

const DeliveryContractParams = z.object({ contractId: z.string().trim().min(1).max(128) })

const DeliveryBidBody = z
  .object({
    amountCents: z.number().int().refine((value) => DELIVERY_BID_OPTIONS.has(value), 'invalid_bid_amount'),
  })
  .strict()

const DeliveryPickupBody = z
  .object({
    estimatedDeliveryAt: z.string().datetime(),
  })
  .strict()

const DeliveryDeliverBody = z
  .object({
    photoUrl: z.string().trim().url().max(2048),
  })
  .strict()

const DriverVehicleInput = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(120),
    photoUrls: z.array(z.string().trim().url().max(2048)).max(DRIVER_VEHICLE_PHOTO_LIMIT),
    minimumRideAmountCents: z.number().int().min(DRIVER_MIN_RIDE_AMOUNT_CENTS_MIN).max(100_000),
    perKmFeeCents: z.number().int().min(DRIVER_PER_KM_FEE_CENTS_MIN).max(DRIVER_PER_KM_FEE_CENTS_MAX),
    featured: z.boolean().optional(),
  })
  .strict()

const DriverManageBody = z
  .object({
    vehicles: z.array(DriverVehicleInput).max(DRIVER_VEHICLE_LIMIT),
  })
  .strict()

type DriverVehicle = {
  id: string
  name: string
  photoUrls: string[]
  minimumRideAmountCents: number
  perKmFeeCents: number
  featured: boolean
  createdAt: string
  updatedAt: string
}

type DriverAccountState = {
  activeAt: string | null
  vehicles: DriverVehicle[]
}

function readDriverAccountRecord(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const driver = (raw as Record<string, unknown>).deliveryDriver
  if (!driver || typeof driver !== 'object' || Array.isArray(driver)) return null
  return driver as Record<string, unknown>
}

function normalizeDriverVehiclePhotoUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, DRIVER_VEHICLE_PHOTO_LIMIT)
}

export function readDriverAccountState(raw: unknown): DriverAccountState {
  const driver = readDriverAccountRecord(raw)
  if (!driver) return { activeAt: null, vehicles: [] }
  const activeAt = typeof (driver as Record<string, unknown>).activeAt === 'string' && (driver as Record<string, unknown>).activeAt
    ? String((driver as Record<string, unknown>).activeAt)
    : null
  const vehicles = Array.isArray(driver.vehicles)
    ? driver.vehicles
        .map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
          const record = entry as Record<string, unknown>
          const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 64) : null
          const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 120) : null
          const minimumRideAmountCents = typeof record.minimumRideAmountCents === 'number' && Number.isInteger(record.minimumRideAmountCents)
            ? Math.max(DRIVER_MIN_RIDE_AMOUNT_CENTS_MIN, Math.min(100_000, record.minimumRideAmountCents))
            : null
          const perKmFeeCents = typeof record.perKmFeeCents === 'number' && Number.isInteger(record.perKmFeeCents)
            ? Math.max(DRIVER_PER_KM_FEE_CENTS_MIN, Math.min(DRIVER_PER_KM_FEE_CENTS_MAX, record.perKmFeeCents))
            : null
          if (!id || !name || minimumRideAmountCents === null || perKmFeeCents === null) return null

          return {
            id,
            name,
            photoUrls: normalizeDriverVehiclePhotoUrls(record.photoUrls),
            minimumRideAmountCents,
            perKmFeeCents,
            featured: record.featured === true,
            createdAt: typeof record.createdAt === 'string' && record.createdAt.trim() ? record.createdAt.trim() : new Date(0).toISOString(),
            updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.trim() ? record.updatedAt.trim() : new Date(0).toISOString(),
          } satisfies DriverVehicle
        })
        .filter((entry): entry is DriverVehicle => Boolean(entry))
        .slice(0, DRIVER_VEHICLE_LIMIT)
    : []

  const featuredIndex = vehicles.findIndex((vehicle) => vehicle.featured)
  const normalizedVehicles = vehicles.map((vehicle, index) => ({ ...vehicle, featured: featuredIndex >= 0 ? index === featuredIndex : index === 0 }))

  return { activeAt, vehicles: normalizedVehicles }
}

function normalizeDriverVehicleInputs(input: z.infer<typeof DriverManageBody>['vehicles'], existing: DriverVehicle[]) {
  const existingMap = new Map(existing.map((vehicle) => [vehicle.id, vehicle]))
  const now = new Date().toISOString()

  const normalized = input.slice(0, DRIVER_VEHICLE_LIMIT).map((vehicle) => {
    const existingVehicle = vehicle.id ? existingMap.get(vehicle.id) ?? null : null
    const id = vehicle.id?.trim() ? vehicle.id.trim().slice(0, 64) : existingVehicle?.id ?? randomUUID()
    const createdAt = existingVehicle?.createdAt ?? now
    return {
      id,
      name: vehicle.name.trim().slice(0, 120),
      photoUrls: [...new Set(vehicle.photoUrls.map((entry) => entry.trim()).filter(Boolean))].slice(0, DRIVER_VEHICLE_PHOTO_LIMIT),
      minimumRideAmountCents: Math.max(DRIVER_MIN_RIDE_AMOUNT_CENTS_MIN, Math.min(100_000, vehicle.minimumRideAmountCents)),
      perKmFeeCents: Math.max(DRIVER_PER_KM_FEE_CENTS_MIN, Math.min(DRIVER_PER_KM_FEE_CENTS_MAX, vehicle.perKmFeeCents)),
      featured: vehicle.featured === true,
      createdAt,
      updatedAt: now,
    } satisfies DriverVehicle
  })

  const firstFeaturedIndex = normalized.findIndex((vehicle) => vehicle.featured)
  return normalized.map((vehicle, index) => ({ ...vehicle, featured: firstFeaturedIndex >= 0 ? index === firstFeaturedIndex : index === 0 }))
}

function writeDriverAccountState(meta: Record<string, unknown>, next: { activeAt?: string | null; vehicles?: DriverVehicle[] }) {
  const current = readDriverAccountState(meta)
  const activeAt = next.activeAt !== undefined ? next.activeAt : current.activeAt
  const vehicles = next.vehicles !== undefined ? next.vehicles : current.vehicles
  if (!activeAt && !vehicles.length) {
    delete meta.deliveryDriver
    return meta
  }
  meta.deliveryDriver = {
    ...(activeAt ? { activeAt } : {}),
    ...(vehicles.length ? { vehicles } : {}),
  }
  return meta
}

export function readFeaturedDriverVehicle(raw: unknown) {
  const state = readDriverAccountState(raw)
  return state.vehicles.find((vehicle) => vehicle.featured) ?? state.vehicles[0] ?? null
}

function hasHomeAddress(user: {
  billingAddress1?: string | null
  billingCity?: string | null
  billingState?: string | null
  billingPostalCode?: string | null
}) {
  return Boolean(
    user.billingAddress1?.trim() &&
      user.billingCity?.trim() &&
      user.billingState?.trim() &&
      user.billingPostalCode?.trim(),
  )
}

function hasStructuredHomeAddress(address: {
  line1?: string | null
  city?: string | null
  province?: string | null
  postalCode?: string | null
} | null | undefined) {
  return Boolean(address?.line1?.trim() && address.city?.trim() && address.province?.trim() && address.postalCode?.trim())
}

function resolveDriverHomeAddress(
  user: {
    billingAddress1?: string | null
    billingCity?: string | null
    billingState?: string | null
    billingPostalCode?: string | null
    communityMeta?: unknown
  },
  deps: DeliveryDeps,
) {
  if (hasHomeAddress(user)) {
    return {
      line1: user.billingAddress1?.trim() ?? null,
      city: user.billingCity?.trim() ?? null,
      province: user.billingState?.trim() ?? null,
      postalCode: user.billingPostalCode?.trim() ?? null,
    }
  }

  const savedAddresses = typeof deps.readMarketShippingAddresses === 'function' ? deps.readMarketShippingAddresses(user.communityMeta ?? null) : []
  const preferred = savedAddresses.find((entry: Record<string, unknown>) => entry.isDefault === true) ?? savedAddresses[0] ?? null
  if (!preferred) return null

  const shippingAddress = {
    line1: typeof preferred.line1 === 'string' ? preferred.line1.trim() : null,
    city: typeof preferred.city === 'string' ? preferred.city.trim() : null,
    province: typeof preferred.province === 'string' ? preferred.province.trim() : null,
    postalCode: typeof preferred.postalCode === 'string' ? preferred.postalCode.trim() : null,
  }

  return hasStructuredHomeAddress(shippingAddress) ? shippingAddress : null
}

async function loadDriverEligibility(userId: string, deps: DeliveryDeps) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      avatarUrl: true,
      coverUrl: true,
      communityMeta: true,
      billingAddress1: true,
      billingCity: true,
      billingState: true,
      billingPostalCode: true,
    },
  })
  if (!user) return null

  const communityMeta = deps.parseCommunityMeta(user.communityMeta ?? null)
  const wallet = readWalletSummary(communityMeta)
  const homeAddress = resolveDriverHomeAddress(user, deps)

  const baseMeta = deps.readBaseCommunityMeta(user.communityMeta ?? null)
  const driverState = readDriverAccountState(baseMeta)

  return {
    activeAt: driverState.activeAt,
    requirements: {
      walletReady: Boolean(wallet.enabled && walletHasConnectPayoutsEnabled(wallet)),
      isCanadianCitizen: Boolean(deps.isSelfVerifiedCanadianCitizen(communityMeta)),
      hasProfilePhoto: Boolean(user.avatarUrl),
      hasCoverPhoto: Boolean(user.coverUrl),
      hasHomeAddress: Boolean(homeAddress),
    },
    homeAddress,
  }
}

async function ensureDriverActive(userId: string, deps: DeliveryDeps, reply: FastifyReply) {
  const eligibility = await loadDriverEligibility(userId, deps)
  if (!eligibility) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  if (!eligibility.activeAt) {
    reply.code(403).send({ error: 'driver_not_active', onboarding: eligibility })
    return null
  }
  return eligibility
}

export function registerDeliveryRoutes(app: FastifyInstance, deps: DeliveryDeps) {
  const loadOnboarding = async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const eligibility = await loadDriverEligibility(userId, deps)
      if (!eligibility) return reply.code(401).send({ error: 'unauthorized' })

      return reply.send({
        active: Boolean(eligibility.activeAt),
        activeAt: eligibility.activeAt,
        requirements: eligibility.requirements,
      })
    })

  const activateOnboarding = async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const eligibility = await loadDriverEligibility(userId, deps)
      if (!eligibility) return reply.code(401).send({ error: 'unauthorized' })

      const requirementsMet = Object.values(eligibility.requirements).every(Boolean)
      if (!requirementsMet) {
        return reply.code(400).send({ error: 'driver_requirements_not_met', requirements: eligibility.requirements })
      }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      const activeAt = eligibility.activeAt ?? new Date().toISOString()
      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta ?? null)
      await prisma.user.update({
        where: { id: userId },
        data: { communityMeta: writeDriverAccountState(baseMeta, { activeAt }) as Prisma.InputJsonValue },
      })

      return reply.send({ success: true, active: true, activeAt })
    })

  app.get('/delivery/onboarding', loadOnboarding)
  app.get('/drive/onboarding', loadOnboarding)

  app.post('/delivery/onboarding/activate', activateOnboarding)
  app.post('/drive/onboarding/activate', activateOnboarding)

  app.get('/drive/driver/manage', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const eligibility = await loadDriverEligibility(userId, deps)
      if (!eligibility?.activeAt) {
        return reply.code(403).send({ error: 'driver_not_active', onboarding: eligibility })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { communityMeta: true },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta ?? null)
      const state = readDriverAccountState(baseMeta)
      return reply.send({
        active: true,
        activeAt: state.activeAt,
        vehicles: state.vehicles,
      })
    }),
  )

  app.put('/drive/driver/manage', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const eligibility = await loadDriverEligibility(userId, deps)
      if (!eligibility?.activeAt) {
        return reply.code(403).send({ error: 'driver_not_active', onboarding: eligibility })
      }

      const body = DriverManageBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { communityMeta: true },
      })
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      const baseMeta = deps.readBaseCommunityMeta(user.communityMeta ?? null)
      const currentState = readDriverAccountState(baseMeta)
      const vehicles = normalizeDriverVehicleInputs(body.data.vehicles, currentState.vehicles)

      await prisma.user.update({
        where: { id: userId },
        data: {
          communityMeta: writeDriverAccountState(baseMeta, {
            activeAt: currentState.activeAt,
            vehicles,
          }) as Prisma.InputJsonValue,
        },
      })

      return reply.send({
        success: true,
        active: true,
        activeAt: currentState.activeAt,
        vehicles,
      })
    }),
  )

  app.get('/delivery/contracts/open', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      if (!(await ensureDriverActive(userId, deps, reply))) return

      await deps.ensureCitizenMarketplaceTables()

      const driver = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          billingAddress1: true,
          billingCity: true,
          billingState: true,
          billingPostalCode: true,
          communityMeta: true,
        },
      })
      const driverHomeAddress = driver ? resolveDriverHomeAddress(driver, deps) : null

      type OpenContractRow = {
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
        distance_meters: number | null
        seller_id: string
        seller_handle: string | null
        seller_name: string | null
        seller_avatar_url: string | null
        buyer_id: string
        buyer_handle: string | null
        buyer_name: string | null
        buyer_avatar_url: string | null
      }

      const rows = await prisma.$queryRaw<OpenContractRow[]>`
        WITH driver_origin AS (
          SELECT COALESCE(
            fsa."pointGeom",
            ST_Transform(ST_SetSRID(ST_MakePoint(fsa."centroidLng", fsa."centroidLat"), 3347), 4326)
          ) AS geom
          FROM "ForwardSortationArea" fsa
          WHERE fsa.code = LEFT(REGEXP_REPLACE(UPPER(COALESCE(${driverHomeAddress?.postalCode ?? ''}, '')), '[^A-Z0-9]', '', 'g'), 3)
          LIMIT 1
        )
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
          ST_DistanceSphere(
            COALESCE(
              fsa."pointGeom",
              ST_Transform(ST_SetSRID(ST_MakePoint(fsa."centroidLng", fsa."centroidLat"), 3347), 4326)
            ),
            driver_origin.geom
          ) AS distance_meters,
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
        LEFT JOIN "ForwardSortationArea" fsa
          ON fsa.code = LEFT(REGEXP_REPLACE(UPPER(COALESCE(l.pickup_postal_code, '')), '[^A-Z0-9]', '', 'g'), 3)
        LEFT JOIN driver_origin ON TRUE
        WHERE c.status IN ('open', 'bid_pending')
          AND c.driver_user_id IS NULL
          AND c.seller_user_id <> ${userId}
          AND c.buyer_user_id <> ${userId}
          AND l.is_active = TRUE
        ORDER BY distance_meters ASC NULLS LAST, c.updated_at DESC, c.id DESC
        LIMIT 50
      `

      return reply.send({
        items: rows.map((row: OpenContractRow) => ({
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
          bidDriverUserId: row.bid_driver_user_id,
          bidAmountCents: row.bid_amount_cents,
          distanceKm: typeof row.distance_meters === 'number' && Number.isFinite(row.distance_meters) ? Number((row.distance_meters / 1000).toFixed(1)) : null,
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
        })),
      })
    }),
  )

  app.get('/delivery/contracts/my', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      if (!(await ensureDriverActive(userId, deps, reply))) return

      await deps.ensureCitizenMarketplaceTables()

      type DriverContractRow = {
        id: string
        status: string
        listing_id: string
        listing_title: string
        listing_photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        pickup_instructions: string | null
        item_traits: unknown
        bid_amount_cents: number | null
        estimated_delivery_at: Date | null
        picked_up_at: Date | null
        delivered_at: Date | null
        group_thread_id: string | null
        buyer_id: string
        buyer_handle: string | null
        buyer_name: string | null
        buyer_avatar_url: string | null
        seller_id: string
        seller_handle: string | null
        seller_name: string | null
        seller_avatar_url: string | null
      }

      const rows = await prisma.$queryRaw<DriverContractRow[]>`
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
          c.bid_amount_cents,
          c.estimated_delivery_at,
          c.picked_up_at,
          c.delivered_at,
          c.group_thread_id,
          buyer.id AS buyer_id,
          buyer.handle AS buyer_handle,
          buyer.name AS buyer_name,
          buyer."avatarUrl" AS buyer_avatar_url,
          seller.id AS seller_id,
          seller.handle AS seller_handle,
          seller.name AS seller_name,
          seller."avatarUrl" AS seller_avatar_url
        FROM citizen_market_delivery_contract c
        INNER JOIN citizen_market_listing l ON l.id = c.listing_id
        INNER JOIN "User" buyer ON buyer.id = c.buyer_user_id
        INNER JOIN "User" seller ON seller.id = c.seller_user_id
        WHERE c.driver_user_id = ${userId}
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT 50
      `

      return reply.send({
        items: rows.map((row: DriverContractRow) => ({
          id: row.id,
          status: row.status,
          listingId: row.listing_id,
          listingTitle: row.listing_title,
          listingPhotoUrl: deps.readGalleryUrls(row.listing_photo_urls)[0] ?? null,
          pickupCity: row.pickup_city,
          pickupProvince: row.pickup_province,
          pickupInstructions: row.pickup_instructions,
          itemTraits: Array.isArray(row.item_traits) ? (row.item_traits as unknown[]).filter((entry: unknown): entry is string => typeof entry === 'string') : [],
          bidAmountCents: row.bid_amount_cents,
          estimatedDeliveryAt: row.estimated_delivery_at?.toISOString() ?? null,
          pickedUpAt: row.picked_up_at?.toISOString() ?? null,
          deliveredAt: row.delivered_at?.toISOString() ?? null,
          groupThreadId: row.group_thread_id,
          buyer: {
            id: row.buyer_id,
            handle: row.buyer_handle,
            name: row.buyer_name,
            avatarUrl: row.buyer_avatar_url,
          },
          seller: {
            id: row.seller_id,
            handle: row.seller_handle,
            name: row.seller_name,
            avatarUrl: row.seller_avatar_url,
          },
        })),
      })
    }),
  )

  app.get('/delivery/summary', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const eligibility = await loadDriverEligibility(userId, deps)
      if (!eligibility) return reply.code(401).send({ error: 'unauthorized' })
      if (!eligibility.activeAt) return reply.send({ active: false, items: [] })

      await deps.ensureCitizenMarketplaceTables()
      const rows = await prisma.$queryRaw<Array<{ id: string; status: string; listing_id: string; listing_title: string; listing_photo_urls: unknown }>>`
        SELECT c.id, c.status, c.listing_id, l.title AS listing_title, l.photo_urls AS listing_photo_urls
        FROM citizen_market_delivery_contract c
        INNER JOIN citizen_market_listing l ON l.id = c.listing_id
        WHERE c.driver_user_id = ${userId}
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT 4
      `

      return reply.send({
        active: true,
        items: rows.map((row: { id: string; status: string; listing_id: string; listing_title: string; listing_photo_urls: unknown }) => ({
          id: row.id,
          status: row.status,
          listingId: row.listing_id,
          listingTitle: row.listing_title,
          listingPhotoUrl: deps.readGalleryUrls(row.listing_photo_urls)[0] ?? null,
        })),
      })
    }),
  )

  app.post('/delivery/contracts/:contractId/bid', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      if (!(await ensureDriverActive(userId, deps, reply))) return

      const params = DeliveryContractParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const body = DeliveryBidBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await deps.ensureCitizenMarketplaceTables()

      const contractRows = await prisma.$queryRaw<Array<{
        id: string
        status: string
        listing_id: string
        seller_user_id: string
        buyer_user_id: string
        driver_user_id: string | null
        bid_driver_user_id: string | null
        listing_title: string
      }>>`
        SELECT c.id, c.status, c.listing_id, c.seller_user_id, c.buyer_user_id, c.driver_user_id, c.bid_driver_user_id, l.title AS listing_title
        FROM citizen_market_delivery_contract c
        INNER JOIN citizen_market_listing l ON l.id = c.listing_id
        WHERE c.id = ${params.data.contractId}
        LIMIT 1
      `

      const contract = contractRows[0]
      if (!contract) return reply.code(404).send({ error: 'contract_not_found' })
      if (contract.seller_user_id === userId || contract.buyer_user_id === userId) return reply.code(403).send({ error: 'forbidden' })
      if (contract.driver_user_id) return reply.code(409).send({ error: 'contract_already_assigned' })
      if (contract.status !== 'open' && contract.status !== 'bid_pending') return reply.code(409).send({ error: 'contract_not_open' })
      if (contract.bid_driver_user_id && contract.bid_driver_user_id !== userId) return reply.code(409).send({ error: 'contract_bid_pending' })

      await prisma.$executeRaw`
        UPDATE citizen_market_delivery_contract
        SET status = 'bid_pending',
            bid_driver_user_id = ${userId},
            bid_amount_cents = ${body.data.amountCents},
            bid_requested_at = NOW(),
            bid_responded_at = NULL,
            updated_at = NOW()
        WHERE id = ${contract.id}
      `

      await deps.createNotificationRecord({
        userId: contract.buyer_user_id,
        actorId: userId,
        type: deps.DELIVERY_NOTIFICATION_TYPES.BID,
        payload: {
          contractId: contract.id,
          listingId: contract.listing_id,
          listingTitle: contract.listing_title,
          amountCents: body.data.amountCents,
          status: 'pending',
          url: '/notifications',
        },
      })

      return reply.send({ success: true, amountCents: body.data.amountCents })
    }),
  )

  app.post('/delivery/contracts/:contractId/pickup', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      if (!(await ensureDriverActive(userId, deps, reply))) return

      const params = DeliveryContractParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const body = DeliveryPickupBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const estimatedDeliveryAt = new Date(body.data.estimatedDeliveryAt)
      const now = new Date()
      if (Number.isNaN(estimatedDeliveryAt.getTime()) || estimatedDeliveryAt <= now) return reply.code(400).send({ error: 'invalid_estimated_delivery_at' })
      if (estimatedDeliveryAt.getTime() - now.getTime() > 3 * 24 * 60 * 60 * 1000) return reply.code(400).send({ error: 'estimated_delivery_too_far' })

      const contractRows = await prisma.$queryRaw<Array<{ id: string; status: string; group_thread_id: string | null }>>`
        SELECT id, status, group_thread_id
        FROM citizen_market_delivery_contract
        WHERE id = ${params.data.contractId}
          AND driver_user_id = ${userId}
        LIMIT 1
      `

      const contract = contractRows[0]
      if (!contract) return reply.code(404).send({ error: 'contract_not_found' })
      if (contract.status !== 'assigned' && contract.status !== 'picked_up') return reply.code(409).send({ error: 'contract_not_assignable' })
      if (!contract.group_thread_id) return reply.code(409).send({ error: 'delivery_chat_not_ready' })

      const bodyText = deps.sanitizePlainText(`Picked up. Estimated delivery: ${estimatedDeliveryAt.toLocaleString('en-CA')}.`).trim()

      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`
          UPDATE citizen_market_delivery_contract
          SET status = 'picked_up',
              picked_up_at = COALESCE(picked_up_at, NOW()),
              estimated_delivery_at = ${estimatedDeliveryAt},
              updated_at = NOW()
          WHERE id = ${contract.id}
        `

        const message = await tx.message.create({
          data: {
            threadId: contract.group_thread_id,
            senderId: userId,
            body: bodyText || null,
            messageType: MessageType.text,
          },
          select: deps.MESSAGE_SELECT,
        })

        await tx.messageThread.update({ where: { id: contract.group_thread_id }, data: { lastMessageAt: message.createdAt } })
        await tx.messageParticipant.updateMany({ where: { threadId: contract.group_thread_id }, data: { lastActivityAt: message.createdAt } })
        await tx.messageParticipant.update({ where: { threadId_userId: { threadId: contract.group_thread_id, userId } }, data: { lastReadAt: message.createdAt, lastActivityAt: message.createdAt } })
        const participants = await tx.messageParticipant.findMany({ where: { threadId: contract.group_thread_id }, select: { userId: true, mutedUntil: true } })

        return { message, participants }
      })

      await Promise.all(
        created.participants.map((participant: { userId: string }) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'message.created',
            data: { threadId: contract.group_thread_id, message: deps.formatMessage(created.message, participant.userId) },
          }),
        ),
      )

      void deps.sendMobilePushForMessageCreated({
        threadId: contract.group_thread_id,
        message: created.message,
        participants: created.participants,
        pushUrl: `/messages?thread=${encodeURIComponent(contract.group_thread_id)}`,
      })

      return reply.send({ success: true, estimatedDeliveryAt: estimatedDeliveryAt.toISOString() })
    }),
  )

  app.post('/delivery/contracts/:contractId/deliver', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      if (!(await ensureDriverActive(userId, deps, reply))) return

      const params = DeliveryContractParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const body = DeliveryDeliverBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const contractRows = await prisma.$queryRaw<Array<{ id: string; listing_id: string; status: string; group_thread_id: string | null }>>`
        SELECT id, listing_id, status, group_thread_id
        FROM citizen_market_delivery_contract
        WHERE id = ${params.data.contractId}
          AND driver_user_id = ${userId}
        LIMIT 1
      `

      const contract = contractRows[0]
      if (!contract) return reply.code(404).send({ error: 'contract_not_found' })
      if (contract.status !== 'picked_up' && contract.status !== 'assigned') return reply.code(409).send({ error: 'contract_not_in_transit' })
      if (!contract.group_thread_id) return reply.code(409).send({ error: 'delivery_chat_not_ready' })

      const bodyText = deps.sanitizePlainText('Delivered. Proof of delivery attached.').trim()

      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`
          UPDATE citizen_market_delivery_contract
          SET status = 'delivered',
              delivered_at = NOW(),
              delivery_photo_url = ${body.data.photoUrl},
              updated_at = NOW()
          WHERE id = ${contract.id}
        `

        await tx.$executeRaw`
          UPDATE citizen_market_listing
          SET status = 'sold',
              updated_at = NOW()
          WHERE id = ${contract.listing_id}
        `

        const message = await tx.message.create({
          data: {
            threadId: contract.group_thread_id,
            senderId: userId,
            body: bodyText || null,
            attachments: [body.data.photoUrl],
            messageType: MessageType.text,
          },
          select: deps.MESSAGE_SELECT,
        })

        await tx.messageThread.update({ where: { id: contract.group_thread_id }, data: { lastMessageAt: message.createdAt } })
        await tx.messageParticipant.updateMany({ where: { threadId: contract.group_thread_id }, data: { lastActivityAt: message.createdAt } })
        await tx.messageParticipant.update({ where: { threadId_userId: { threadId: contract.group_thread_id, userId } }, data: { lastReadAt: message.createdAt, lastActivityAt: message.createdAt } })
        const participants = await tx.messageParticipant.findMany({ where: { threadId: contract.group_thread_id }, select: { userId: true, mutedUntil: true } })

        return { message, participants }
      })

      await Promise.all(
        created.participants.map((participant: { userId: string }) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'message.created',
            data: { threadId: contract.group_thread_id, message: deps.formatMessage(created.message, participant.userId) },
          }),
        ),
      )

      void deps.sendMobilePushForMessageCreated({
        threadId: contract.group_thread_id,
        message: created.message,
        participants: created.participants,
        pushUrl: `/messages?thread=${encodeURIComponent(contract.group_thread_id)}`,
      })

      return reply.send({ success: true })
    }),
  )

  app.post('/delivery/contracts/:contractId/accept-bid', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      return reply.code(404).send({ error: 'not_found' })
    }),
  )
}
