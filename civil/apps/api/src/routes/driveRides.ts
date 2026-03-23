import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { computeCivilPayFeeCents } from '../civilPayFees.js'
import { buildWalletMetaValue, ensureCitizenWalletTables, insertCivilCreditLedgerEntry, readWalletSummary } from '../walletHelpers.js'
import { readDriverAccountState, readFeaturedDriverVehicle } from './delivery.js'

type DriveRideDeps = Record<string, any>

const RIDE_DRIVER_FLAT_FEE_CENTS = 1000
const RIDE_FUEL_RATE_CENTS_PER_KM = 65
const RIDE_MIN_FUEL_CHARGE_CENTS = 500
const RIDE_CIVIL_FEE_CENTS = 50
const RIDE_AUTO_COMPLETE_MINUTES = 30
const RIDE_OFFER_PER_KM_FEE_CENTS_MIN = 100
const RIDE_OFFER_PER_KM_FEE_CENTS_MAX = 500
const DRIVE_RIDE_NOTIFICATION_TYPES = {
  OFFER: 'drive_ride_offer',
  OFFER_ACCEPTED: 'drive_ride_offer_accepted',
  CONTRACT_UPDATE: 'drive_ride_contract_update',
  TIP_RECEIVED: 'drive_ride_tip_received',
  COMPLETE_CONFIRMATION: 'drive_ride_complete_confirmation',
  COMPLETE_RESPONSE: 'drive_ride_complete_response',
} as const

const DriveFeedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.enum(['open', 'mine']).default('open'),
})

const RideRequestParams = z.object({
  rideId: z.string().trim().min(1).max(128),
})

const RideOfferParams = RideRequestParams.extend({
  offerId: z.string().trim().min(1).max(256),
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

const RideOfferBody = z
  .object({
    perKmFeeCents: z.number().int().min(RIDE_OFFER_PER_KM_FEE_CENTS_MIN).max(RIDE_OFFER_PER_KM_FEE_CENTS_MAX),
  })
  .strict()

const RideLocationUpdateBody = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict()

const RideContractActionBody = z
  .object({
    action: z.enum(['arrived_pickup', 'cancel_arrival', 'picked_up', 'cancel_pickup', 'dropped_off', 'cancel_dropoff']),
  })
  .strict()

const RideTipBody = z
  .object({
    amountCents: z.number().int().min(100).max(100000),
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

type DriveConnectionRow = {
  id: string
  requesterId: string
  addresseeId: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED'
  requestedAt: Date
  respondedAt: Date | null
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
  driver_user_id?: string | null
  contract_started_at?: Date | null
  driver_location_latitude?: number | null
  driver_location_longitude?: number | null
  driver_location_recorded_at?: Date | null
  requester_location_latitude?: number | null
  requester_location_longitude?: number | null
  requester_location_recorded_at?: Date | null
  accepted_offer_id?: string | null
  accepted_offer_amount_cents?: number | null
  accepted_offer_per_km_fee_cents?: number | null
  accepted_offer_at?: Date | null
  escrow_status?: string | null
  wallet_transaction_id?: string | null
  completion_requested_at?: Date | null
  completion_confirmation_due_at?: Date | null
  rider_confirmed_complete_at?: Date | null
  rider_reported_issue_at?: Date | null
  auto_completed_at?: Date | null
  support_request_id?: string | null
  bid_driver_user_id: string | null
  bid_amount_cents: number | null
  bid_per_km_fee_cents: number | null
  bid_requested_at: Date | null
  created_at: Date
  requester_handle: string | null
  requester_name: string | null
  requester_avatar_url: string | null
  requester_cover_url?: string | null
  driver_community_meta?: unknown
  offer_count: number | null
  viewer_offer_amount_cents: number | null
  viewer_offer_per_km_fee_cents: number | null
  viewer_offer_requested_at: Date | null
  viewer_tipped_amount_cents?: number | null
}

type CountRow = {
  count: number
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
  driver_user_id: string | null
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

type DriveRideOfferRow = {
  id: string
  ride_request_id: string
  driver_user_id: string
  status: string
  amount_cents: number
  per_km_fee_cents: number
  created_at: Date
  updated_at: Date
  driver_handle: string | null
  driver_name: string | null
  driver_avatar_url: string | null
  driver_cover_url: string | null
  driver_community_meta: unknown
}

type DriveRideSettlementRow = {
  id: string
  requester_user_id: string
  driver_user_id: string | null
  status: string
  escrow_status: string | null
  wallet_transaction_id: string | null
  total_cost_cents: number
  accepted_offer_amount_cents: number | null
  accepted_offer_id: string | null
  completion_requested_at: Date | null
  completion_confirmation_due_at: Date | null
  rider_confirmed_complete_at: Date | null
  rider_reported_issue_at: Date | null
  auto_completed_at: Date | null
}

function readBaseCommunityMetaRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function calculateRideCustomerChargeCents(driverAmountCents: number) {
  return Math.max(0, Math.round(driverAmountCents || 0)) + RIDE_CIVIL_FEE_CENTS
}

function formatDriveActorLabel(user: { name: string | null; handle: string | null } | null | undefined) {
  const name = typeof user?.name === 'string' ? user.name.trim() : ''
  if (name) return name
  const handle = typeof user?.handle === 'string' ? user.handle.trim() : ''
  if (handle) return handle
  return 'Civil citizen'
}

function readNotificationPayloadRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function isConnectionTableMissingError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021' || error.code === 'P2010') return true
  }
  const message = typeof (error as { message?: unknown })?.message === 'string' ? (error as { message: string }).message : ''
  return /"Connection"|ConnectionStatus|relation .*Connection.* does not exist/i.test(message)
}

async function ensureAcceptedDriveConnection(
  db: typeof prisma | Prisma.TransactionClient,
  userId: string,
  targetUserId: string,
) {
  if (!userId || !targetUserId || userId === targetUserId) return

  try {
    const rows = await db.$queryRaw<DriveConnectionRow[]>`
      SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
      FROM "Connection"
      WHERE ("requesterId" = ${userId} AND "addresseeId" = ${targetUserId})
         OR ("requesterId" = ${targetUserId} AND "addresseeId" = ${userId})
      LIMIT 1
    `

    const existing = rows[0] ?? null
    if (existing) {
      if (existing.status === 'ACCEPTED' || existing.status === 'BLOCKED') return

      await db.$executeRaw`
        UPDATE "Connection"
        SET "status" = 'ACCEPTED',
            "respondedAt" = ${new Date()}
        WHERE "id" = ${existing.id}
      `
      return
    }

    const now = new Date()
    await db.$executeRaw`
      INSERT INTO "Connection" ("id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt")
      VALUES (${randomUUID()}, ${userId}, ${targetUserId}, 'ACCEPTED', ${now}, ${now})
    `
  } catch (error) {
    if (isConnectionTableMissingError(error)) return
    throw error
  }
}

export async function releaseDriveRideEscrow(
  db: typeof prisma | Prisma.TransactionClient,
  rideId: string,
  mode: 'confirmed' | 'auto',
  settledAt: Date = new Date(),
) {
  const rows = await db.$queryRaw<DriveRideSettlementRow[]>`
    SELECT
      r.id,
      r.requester_user_id,
      r.driver_user_id,
      r.status,
      r.escrow_status,
      r.wallet_transaction_id,
      r.total_cost_cents,
      r.accepted_offer_amount_cents,
      r.accepted_offer_id,
      r.completion_requested_at,
      r.completion_confirmation_due_at,
      r.rider_confirmed_complete_at,
      r.rider_reported_issue_at,
      r.auto_completed_at
    FROM citizen_drive_ride_request r
    WHERE r.id = ${rideId}
    FOR UPDATE
  `
  const ride = rows[0] ?? null
  if (!ride || !ride.driver_user_id || ride.escrow_status !== 'held') {
    return { settled: false, ride }
  }

  const driverPayoutCents = Math.max(0, Number(ride.accepted_offer_amount_cents) || 0)
  const customerChargeCents = Math.max(driverPayoutCents + RIDE_CIVIL_FEE_CENTS, Number(ride.total_cost_cents) || 0)
  if (driverPayoutCents <= 0 || !ride.wallet_transaction_id) {
    return { settled: false, ride }
  }

  const [requester, driver] = await Promise.all([
    db.user.findUnique({
      where: { id: ride.requester_user_id },
      select: { id: true, handle: true, name: true, communityMeta: true },
    }),
    db.user.findUnique({
      where: { id: ride.driver_user_id },
      select: { id: true, handle: true, name: true, communityMeta: true },
    }),
  ])

  if (!requester || !driver) {
    return { settled: false, ride }
  }

  const driverWallet = readWalletSummary(driver.communityMeta ?? null)
  const driverMeta = readBaseCommunityMetaRecord(driver.communityMeta ?? null)
  driverMeta.wallet = buildWalletMetaValue({
    ...driverWallet,
    civilCreditsCents: driverWallet.civilCreditsCents + driverPayoutCents,
  })

  await db.user.update({
    where: { id: driver.id },
    data: { communityMeta: driverMeta as Prisma.InputJsonValue },
  })

  await db.$executeRaw`
    UPDATE citizen_wallet_transaction
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = ${ride.wallet_transaction_id}
  `

  await db.$executeRaw`
    UPDATE civil_credit_ledger
    SET status = 'completed',
        updated_at = NOW()
    WHERE source_type = ${'drive_ride_escrow_hold'}
      AND source_reference_id = ${ride.id}
  `

  await db.$executeRaw`
    UPDATE citizen_drive_ride_request
    SET escrow_status = 'released',
        rider_confirmed_complete_at = CASE WHEN ${mode === 'confirmed'} THEN ${settledAt} ELSE rider_confirmed_complete_at END,
        auto_completed_at = CASE WHEN ${mode === 'auto'} THEN ${settledAt} ELSE auto_completed_at END,
        updated_at = NOW()
    WHERE id = ${ride.id}
      AND escrow_status = 'held'
  `

  await insertCivilCreditLedgerEntry(db, {
    id: `${ride.wallet_transaction_id}:driver-payout`,
    eventId: `${ride.wallet_transaction_id}:driver-payout`,
    entryType: 'transfer',
    status: 'completed',
    amountCents: driverPayoutCents,
    currency: 'cad',
    from: {
      entityType: 'ride_escrow',
      entityLabel: 'Drive ride escrow',
    },
    to: {
      userId: driver.id,
      handle: driver.handle,
      name: driver.name,
      entityType: 'user',
      entityLabel: formatDriveActorLabel(driver),
    },
    sourceType: 'drive_ride_driver_payout',
    sourceReferenceId: ride.id,
    description: `Drive ride payout for ${formatDriveActorLabel(requester)}`,
    metadata: {
      kind: 'drive_ride_driver_payout',
      rideRequestId: ride.id,
      requesterUserId: requester.id,
      driverUserId: driver.id,
      customerChargeCents,
      civilFeeCents: RIDE_CIVIL_FEE_CENTS,
    },
    occurredAt: settledAt,
  })

  await insertCivilCreditLedgerEntry(db, {
    id: `${ride.wallet_transaction_id}:civil-fee`,
    eventId: `${ride.wallet_transaction_id}:civil-fee`,
    entryType: 'adjustment',
    status: 'completed',
    amountCents: RIDE_CIVIL_FEE_CENTS,
    currency: 'cad',
    from: {
      entityType: 'ride_escrow',
      entityLabel: 'Drive ride escrow',
    },
    to: {
      entityType: 'platform',
      entityLabel: 'Civil fee',
    },
    sourceType: 'drive_ride_civil_fee',
    sourceReferenceId: ride.id,
    description: `Civil fee for drive ride ${ride.id}`,
    metadata: {
      kind: 'drive_ride_civil_fee',
      rideRequestId: ride.id,
      requesterUserId: requester.id,
      driverUserId: driver.id,
      customerChargeCents,
      civilFeeCents: RIDE_CIVIL_FEE_CENTS,
    },
    occurredAt: settledAt,
  })

  return { settled: true, ride }
}

export async function settleExpiredDriveRideEscrows() {
  await ensureCitizenWalletTables()

  const dueRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM citizen_drive_ride_request
    WHERE escrow_status = 'held'
      AND completion_confirmation_due_at IS NOT NULL
      AND completion_confirmation_due_at <= NOW()
      AND rider_confirmed_complete_at IS NULL
      AND rider_reported_issue_at IS NULL
    ORDER BY completion_confirmation_due_at ASC
    LIMIT 25
  `

  let settledCount = 0
  for (const row of dueRows) {
    const settledAt = new Date()
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const result = await releaseDriveRideEscrow(tx, row.id, 'auto', settledAt)
        if (!result.settled || !result.ride) return

        const notifications = await tx.notification.findMany({
          where: {
            userId: result.ride.requester_user_id,
            type: DRIVE_RIDE_NOTIFICATION_TYPES.COMPLETE_CONFIRMATION,
          },
          select: {
            id: true,
            payload: true,
            readAt: true,
          },
        })

        for (const notification of notifications) {
          const payload = readNotificationPayloadRecord(notification.payload)
          if (payload.rideRequestId !== result.ride.id) continue
          await tx.notification.update({
            where: { id: notification.id },
            data: {
              payload: {
                ...payload,
                status: 'auto_completed',
                respondedAt: settledAt.toISOString(),
                url: `/drive/myrides/${result.ride.id}/offers`,
                sourceUrl: `/drive/myrides/${result.ride.id}/offers`,
              } as Prisma.InputJsonValue,
            },
          })
        }

        settledCount += 1
      })
    } catch (error) {
      console.error('settle_expired_drive_ride_escrow_failed', { rideId: row.id, error })
    }
  }

  return settledCount
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

function isDriveStatusCancellable(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return ![
    'accepted',
    'assigned',
    'matched',
    'driver_selected',
    'driver_en_route',
    'en_route',
    'driver_arrived',
    'arrived',
    'picked_up',
    'in_progress',
    'inprogress',
    'delivered',
    'completed',
    'cancelled',
    'canceled',
    'rejected',
    'declined',
    'failed',
  ].includes(normalized)
}

function isDriveStatusLocationTrackable(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return ['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route', 'driver_arrived', 'arrived', 'picked_up', 'in_progress'].includes(normalized)
}

function resolveDriveRideContractStatusAction(
  currentStatus: string | null | undefined,
  action: z.infer<typeof RideContractActionBody>['action'],
) {
  const normalized = (currentStatus || '').trim().toLowerCase()

  switch (action) {
    case 'arrived_pickup':
      return ['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route'].includes(normalized)
        ? 'driver_arrived'
        : null
    case 'cancel_arrival':
      return normalized === 'driver_arrived' ? 'driver_en_route' : null
    case 'picked_up':
      return normalized === 'driver_arrived' ? 'picked_up' : null
    case 'cancel_pickup':
      return normalized === 'picked_up' || normalized === 'in_progress' ? 'driver_arrived' : null
    case 'dropped_off':
      return normalized === 'picked_up' || normalized === 'in_progress' ? 'arrived' : null
    case 'cancel_dropoff':
      return normalized === 'arrived' ? 'picked_up' : null
    default:
      return null
  }
}

function formatDriveRideContractNotificationActionLabel(action: z.infer<typeof RideContractActionBody>['action'] | 'complete_contract') {
  switch (action) {
    case 'arrived_pickup':
      return 'Arrived for pickup'
    case 'cancel_arrival':
      return 'Cancelled pickup arrival'
    case 'picked_up':
      return 'Picked up the passengers'
    case 'cancel_pickup':
      return 'Cancelled passenger pickup'
    case 'dropped_off':
      return 'Arrived at the dropoff'
    case 'cancel_dropoff':
      return 'Cancelled dropoff arrival'
    case 'complete_contract':
      return 'Completed the ride'
    default:
      return 'Updated the contract'
  }
}

function buildDriveRideContractUpdatePayload(args: {
  rideId: string
  action: z.infer<typeof RideContractActionBody>['action'] | 'complete_contract'
  status: string
  vehicleImageUrl?: string | null
  vehicleLabel?: string | null
  tipEligible?: boolean
}) {
  return {
    rideRequestId: args.rideId,
    action: args.action,
    status: args.status,
    url: `/drive/${args.rideId}/contract`,
    sourceUrl: `/drive/${args.rideId}/contract`,
    message: formatDriveRideContractNotificationActionLabel(args.action),
    vehicleImageUrl: args.vehicleImageUrl ?? null,
    vehicleLabel: args.vehicleLabel ?? null,
    tipEligible: args.tipEligible === true,
  } satisfies Prisma.InputJsonValue
}

function buildDriveRideTipReceivedPayload(args: {
  rideId: string
  tipAmountCents: number
}) {
  return {
    rideRequestId: args.rideId,
    amountCents: Math.max(0, Math.round(args.tipAmountCents || 0)),
    url: '/drive',
    sourceUrl: '/drive',
  } satisfies Prisma.InputJsonValue
}

function mapRideRequestRow(row: RideRequestRow, viewerUserId: string | null) {
  const pickupAddress = readStoredRideAddress(row.pickup_address)
  const dropoffAddress = readStoredRideAddress(row.dropoff_address)
  const driverLocation =
    typeof row.driver_location_latitude === 'number' &&
    Number.isFinite(row.driver_location_latitude) &&
    typeof row.driver_location_longitude === 'number' &&
    Number.isFinite(row.driver_location_longitude)
      ? {
          latitude: row.driver_location_latitude,
          longitude: row.driver_location_longitude,
          recordedAt: row.driver_location_recorded_at ? row.driver_location_recorded_at.toISOString() : null,
        }
      : null
  const requesterLocation =
    typeof row.requester_location_latitude === 'number' &&
    Number.isFinite(row.requester_location_latitude) &&
    typeof row.requester_location_longitude === 'number' &&
    Number.isFinite(row.requester_location_longitude)
      ? {
          latitude: row.requester_location_latitude,
          longitude: row.requester_location_longitude,
          recordedAt: row.requester_location_recorded_at ? row.requester_location_recorded_at.toISOString() : null,
        }
      : null
  const offerCount = Math.max(0, Number(row.offer_count) || 0 || (row.accepted_offer_id ? 1 : row.bid_driver_user_id ? 1 : 0))
  const viewerBidAmountCents =
    typeof row.viewer_offer_amount_cents === 'number'
      ? Number(row.viewer_offer_amount_cents)
      : viewerUserId && (row.driver_user_id === viewerUserId || row.bid_driver_user_id === viewerUserId) && typeof row.bid_amount_cents === 'number'
        ? Number(row.bid_amount_cents)
        : null
  const viewerBidPerKmFeeCents =
    typeof row.viewer_offer_per_km_fee_cents === 'number'
      ? Number(row.viewer_offer_per_km_fee_cents)
      : viewerUserId && (row.driver_user_id === viewerUserId || row.bid_driver_user_id === viewerUserId) && typeof row.bid_per_km_fee_cents === 'number'
        ? Number(row.bid_per_km_fee_cents)
        : null
  const viewerBidRequestedAt =
    row.viewer_offer_requested_at
      ? row.viewer_offer_requested_at.toISOString()
      : viewerUserId && (row.driver_user_id === viewerUserId || row.bid_driver_user_id === viewerUserId) && row.bid_requested_at
        ? row.bid_requested_at.toISOString()
        : null
  const mappedStatus = row.status === 'open' && offerCount > 0 ? 'bid_pending' : row.status
  const driverVehicle = readFeaturedDriverVehicle(row.driver_community_meta)
  const viewerRole =
    viewerUserId && viewerUserId === row.requester_user_id
      ? 'requester'
      : viewerUserId && row.driver_user_id === viewerUserId
        ? 'driver'
        : null

  return {
    id: row.id,
    status: mappedStatus,
    recurrence: row.recurrence,
    pickupAddress,
    dropoffAddress,
    pickupAt: row.pickup_at.toISOString(),
    dropoffAt: row.dropoff_at.toISOString(),
    routeDistanceKm: typeof row.route_distance_km === 'number' && Number.isFinite(row.route_distance_km) ? Number(row.route_distance_km.toFixed(1)) : 0,
    fuelChargeCents: Number(row.fuel_charge_cents) || 0,
    driverFeeCents: Number(row.driver_fee_cents) || RIDE_DRIVER_FLAT_FEE_CENTS,
    totalCostCents: Number(row.total_cost_cents) || 0,
    bidPending: mappedStatus === 'bid_pending',
    bidAmountCents: viewerBidAmountCents,
    bidPerKmFeeCents: viewerBidPerKmFeeCents,
    bidRequestedAt: viewerBidRequestedAt,
    isBidByViewer: Boolean(viewerUserId && (typeof row.viewer_offer_amount_cents === 'number' || row.bid_driver_user_id === viewerUserId || row.driver_user_id === viewerUserId)),
    offerCount,
    createdAt: row.created_at.toISOString(),
    viewerRole,
    driverUserId: row.driver_user_id ?? null,
    acceptedOfferId: row.accepted_offer_id ?? null,
    acceptedOfferAmountCents: typeof row.accepted_offer_amount_cents === 'number' ? Number(row.accepted_offer_amount_cents) : null,
    acceptedOfferPerKmFeeCents:
      typeof row.accepted_offer_per_km_fee_cents === 'number' ? Number(row.accepted_offer_per_km_fee_cents) : null,
    acceptedOfferAt: row.accepted_offer_at ? row.accepted_offer_at.toISOString() : null,
    tippedAmountCents: typeof row.viewer_tipped_amount_cents === 'number' ? Number(row.viewer_tipped_amount_cents) : null,
    contractStartedAt: row.contract_started_at ? row.contract_started_at.toISOString() : null,
    escrowStatus: row.escrow_status ?? 'none',
    walletTransactionId: row.wallet_transaction_id ?? null,
    completionRequestedAt: row.completion_requested_at ? row.completion_requested_at.toISOString() : null,
    completionConfirmationDueAt: row.completion_confirmation_due_at ? row.completion_confirmation_due_at.toISOString() : null,
    riderConfirmedCompleteAt: row.rider_confirmed_complete_at ? row.rider_confirmed_complete_at.toISOString() : null,
    riderReportedIssueAt: row.rider_reported_issue_at ? row.rider_reported_issue_at.toISOString() : null,
    autoCompletedAt: row.auto_completed_at ? row.auto_completed_at.toISOString() : null,
    supportRequestId: row.support_request_id ?? null,
    driverLocation,
    requesterLocation,
    requester: {
      id: row.requester_user_id,
      handle: row.requester_handle,
      name: row.requester_name,
      avatarUrl: row.requester_avatar_url,
      coverUrl: row.requester_cover_url ?? null,
    },
    driverVehicle: driverVehicle
      ? {
          id: driverVehicle.id,
          name: driverVehicle.name,
          photoUrl: driverVehicle.photoUrls[0] ?? null,
          minimumRideAmountCents: driverVehicle.minimumRideAmountCents,
          perKmFeeCents: driverVehicle.perKmFeeCents,
        }
      : null,
    isOwner: Boolean(viewerUserId && viewerUserId === row.requester_user_id),
  }
}

function mapDriveRideOfferRow(row: DriveRideOfferRow) {
  const featuredVehicle = readFeaturedDriverVehicle(row.driver_community_meta)

  return {
    id: row.id,
    rideId: row.ride_request_id,
    status: row.status,
    amountCents: Number(row.amount_cents) || 0,
    perKmFeeCents: Number(row.per_km_fee_cents) || 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    driver: {
      id: row.driver_user_id,
      handle: row.driver_handle,
      name: row.driver_name,
      avatarUrl: row.driver_avatar_url,
      coverUrl: row.driver_cover_url,
    },
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

function mapDeliveryRequestRow(row: DriveDeliveryRow, deps: DriveRideDeps, viewerUserId: string | null) {
  const viewerRole =
    viewerUserId && row.driver_user_id === viewerUserId
      ? 'driver'
      : viewerUserId && row.seller_id === viewerUserId
        ? 'seller'
        : viewerUserId && row.buyer_id === viewerUserId
          ? 'buyer'
          : null

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
    viewerRole,
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
  app.get('/drive/contacts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      await deps.ensureCitizenMarketplaceTables()

      const rows = await prisma.$queryRaw<Array<{
        id: string
        handle: string | null
        name: string | null
        avatar_url: string | null
        cover_url: string | null
      }>>`
        SELECT DISTINCT
          counterpart.id,
          counterpart.handle,
          counterpart.name,
          counterpart."avatarUrl" AS avatar_url,
          counterpart."coverUrl" AS cover_url
        FROM citizen_drive_ride_request r
        INNER JOIN "User" counterpart
          ON counterpart.id = CASE
            WHEN r.requester_user_id = ${userId} THEN r.driver_user_id
            ELSE r.requester_user_id
          END
        WHERE (r.requester_user_id = ${userId} AND r.driver_user_id IS NOT NULL)
           OR r.driver_user_id = ${userId}
        ORDER BY counterpart.name NULLS LAST, counterpart.handle NULLS LAST
      `

      const items = rows.map((row: { id: string; handle: string | null; name: string | null; avatar_url: string | null; cover_url: string | null }) => ({
        id: row.id,
        handle: row.handle,
        name: row.name,
        avatarUrl: row.avatar_url ?? null,
        coverUrl: row.cover_url ?? null,
      }))

      return reply.send({
        ids: items.map((item: { id: string }) => item.id),
        items,
      })
    }),
  )

  app.get('/drive/rides', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = DriveFeedQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      await deps.ensureCitizenMarketplaceTables()
      await settleExpiredDriveRideEscrows().catch((error) => {
        req.log.error({ err: error }, 'settle_expired_drive_ride_escrows_failed_before_complete')
      })

      const rows =
        query.data.scope === 'mine'
          ? await prisma.$queryRaw<RideRequestRow[]>`
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
                r.driver_user_id,
                r.contract_started_at,
                r.driver_location_latitude,
                r.driver_location_longitude,
                r.driver_location_recorded_at,
                r.requester_location_latitude,
                r.requester_location_longitude,
                r.requester_location_recorded_at,
                r.accepted_offer_id,
                r.accepted_offer_amount_cents,
                r.accepted_offer_per_km_fee_cents,
                r.accepted_offer_at,
                r.escrow_status,
                r.wallet_transaction_id,
                r.completion_requested_at,
                r.completion_confirmation_due_at,
                r.rider_confirmed_complete_at,
                r.rider_reported_issue_at,
                r.auto_completed_at,
                r.support_request_id,
                r.bid_driver_user_id,
                r.bid_amount_cents,
                r.bid_per_km_fee_cents,
                r.bid_requested_at,
                r.created_at,
                COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
                viewer_offer.amount_cents AS viewer_offer_amount_cents,
                viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
                viewer_offer.created_at AS viewer_offer_requested_at,
                tip_summary.tipped_amount_cents AS viewer_tipped_amount_cents,
                requester.handle AS requester_handle,
                requester.name AS requester_name,
                requester."avatarUrl" AS requester_avatar_url,
                requester."coverUrl" AS requester_cover_url,
                driver."communityMeta" AS driver_community_meta
              FROM citizen_drive_ride_request r
              INNER JOIN "User" requester ON requester.id = r.requester_user_id
              LEFT JOIN "User" driver ON driver.id = r.driver_user_id
              LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS offer_count
                FROM citizen_drive_ride_offer o
                WHERE o.ride_request_id = r.id
                  AND o.status IN ('pending', 'accepted')
              ) offer_summary ON TRUE
              LEFT JOIN LATERAL (
                SELECT
                  o.amount_cents,
                  o.per_km_fee_cents,
                  o.created_at
                FROM citizen_drive_ride_offer o
                WHERE o.ride_request_id = r.id
                  AND o.driver_user_id = ${userId}
                  AND o.status IN ('pending', 'accepted')
                ORDER BY o.updated_at DESC, o.id DESC
                LIMIT 1
              ) viewer_offer ON TRUE
              LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(l.amount_cents), 0)::int AS tipped_amount_cents
                FROM civil_credit_ledger l
                WHERE l.source_type = ${'drive_ride_tip'}
                  AND l.status = ${'completed'}
                  AND l.from_user_id = ${userId}
                  AND COALESCE(l.metadata->>'rideRequestId', '') = r.id
              ) tip_summary ON TRUE
              WHERE r.requester_user_id = ${userId}
                 OR r.driver_user_id = ${userId}
              ORDER BY r.created_at DESC, r.id DESC
              LIMIT ${query.data.limit}
            `
          : await prisma.$queryRaw<RideRequestRow[]>`
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
                r.driver_user_id,
                r.contract_started_at,
                r.driver_location_latitude,
                r.driver_location_longitude,
                r.driver_location_recorded_at,
                r.requester_location_latitude,
                r.requester_location_longitude,
                r.requester_location_recorded_at,
                r.accepted_offer_id,
                r.accepted_offer_amount_cents,
                r.accepted_offer_per_km_fee_cents,
                r.accepted_offer_at,
                r.escrow_status,
                r.wallet_transaction_id,
                r.completion_requested_at,
                r.completion_confirmation_due_at,
                r.rider_confirmed_complete_at,
                r.rider_reported_issue_at,
                r.auto_completed_at,
                r.support_request_id,
                r.bid_driver_user_id,
                r.bid_amount_cents,
                r.bid_per_km_fee_cents,
                r.bid_requested_at,
                r.created_at,
                COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
                viewer_offer.amount_cents AS viewer_offer_amount_cents,
                viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
                viewer_offer.created_at AS viewer_offer_requested_at,
                NULL::int AS viewer_tipped_amount_cents,
                requester.handle AS requester_handle,
                requester.name AS requester_name,
                requester."avatarUrl" AS requester_avatar_url
              FROM citizen_drive_ride_request r
              INNER JOIN "User" requester ON requester.id = r.requester_user_id
              LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS offer_count
                FROM citizen_drive_ride_offer o
                WHERE o.ride_request_id = r.id
                  AND o.status IN ('pending', 'accepted')
              ) offer_summary ON TRUE
              LEFT JOIN LATERAL (
                SELECT
                  o.amount_cents,
                  o.per_km_fee_cents,
                  o.created_at
                FROM citizen_drive_ride_offer o
                WHERE o.ride_request_id = r.id
                  AND o.driver_user_id = ${userId}
                  AND o.status IN ('pending', 'accepted')
                ORDER BY o.updated_at DESC, o.id DESC
                LIMIT 1
              ) viewer_offer ON TRUE
              WHERE (
                r.status IN ('open', 'bid_pending')
              )
                AND r.requester_user_id <> ${userId}
              ORDER BY r.created_at DESC, r.id DESC
              LIMIT ${query.data.limit}
            `

      const countRows =
        query.data.scope === 'mine'
          ? await prisma.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::int AS count
              FROM citizen_drive_ride_request r
              WHERE r.requester_user_id = ${userId}
                 OR r.driver_user_id = ${userId}
            `
          : await prisma.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::int AS count
              FROM citizen_drive_ride_request r
              WHERE (
                r.status IN ('open', 'bid_pending')
              )
                AND r.requester_user_id <> ${userId}
            `

      return reply.send({
        total: countRows[0]?.count ?? 0,
        items: rows
          .map((row: RideRequestRow) => mapRideRequestRow(row, userId))
          .filter((item: ReturnType<typeof mapRideRequestRow>) => item.pickupAddress && item.dropoffAddress),
      })
    }),
  )

  app.get('/drive/rides/:rideId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()
      await settleExpiredDriveRideEscrows()

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
          r.driver_user_id,
          r.contract_started_at,
          r.driver_location_latitude,
          r.driver_location_longitude,
          r.driver_location_recorded_at,
          r.requester_location_latitude,
          r.requester_location_longitude,
          r.requester_location_recorded_at,
          r.accepted_offer_id,
          r.accepted_offer_amount_cents,
          r.accepted_offer_per_km_fee_cents,
          r.accepted_offer_at,
          r.escrow_status,
          r.wallet_transaction_id,
          r.completion_requested_at,
          r.completion_confirmation_due_at,
          r.rider_confirmed_complete_at,
          r.rider_reported_issue_at,
          r.auto_completed_at,
          r.support_request_id,
          r.bid_driver_user_id,
          r.bid_amount_cents,
          r.bid_per_km_fee_cents,
          r.bid_requested_at,
          r.created_at,
          COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
          viewer_offer.amount_cents AS viewer_offer_amount_cents,
          viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
          viewer_offer.created_at AS viewer_offer_requested_at,
          requester.handle AS requester_handle,
          requester.name AS requester_name,
          requester."avatarUrl" AS requester_avatar_url,
          requester."coverUrl" AS requester_cover_url,
          driver."communityMeta" AS driver_community_meta
        FROM citizen_drive_ride_request r
        INNER JOIN "User" requester ON requester.id = r.requester_user_id
        LEFT JOIN "User" driver ON driver.id = r.driver_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS offer_count
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.status IN ('pending', 'accepted')
        ) offer_summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            o.amount_cents,
            o.per_km_fee_cents,
            o.created_at
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.driver_user_id = ${userId}
            AND o.status IN ('pending', 'accepted')
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 1
        ) viewer_offer ON TRUE
        WHERE r.id = ${params.data.rideId}
          AND (
            r.requester_user_id = ${userId}
            OR r.driver_user_id = ${userId}
          )
        LIMIT 1
      `

      const current = rows[0]
      if (!current) return reply.code(404).send({ error: 'ride_not_found' })

      return reply.send({
        item: mapRideRequestRow(current, userId),
      })
    }),
  )

  app.get('/drive/rides/:rideId/offers', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()
      await settleExpiredDriveRideEscrows()

      const rideRows = await prisma.$queryRaw<RideRequestRow[]>`
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
          r.driver_user_id,
          r.contract_started_at,
          r.driver_location_latitude,
          r.driver_location_longitude,
          r.driver_location_recorded_at,
          r.requester_location_latitude,
          r.requester_location_longitude,
          r.requester_location_recorded_at,
          r.accepted_offer_id,
          r.accepted_offer_amount_cents,
          r.accepted_offer_per_km_fee_cents,
          r.accepted_offer_at,
          r.escrow_status,
          r.wallet_transaction_id,
          r.completion_requested_at,
          r.completion_confirmation_due_at,
          r.rider_confirmed_complete_at,
          r.rider_reported_issue_at,
          r.auto_completed_at,
          r.support_request_id,
          r.bid_driver_user_id,
          r.bid_amount_cents,
          r.bid_per_km_fee_cents,
          r.bid_requested_at,
          r.created_at,
          COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
          viewer_offer.amount_cents AS viewer_offer_amount_cents,
          viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
          viewer_offer.created_at AS viewer_offer_requested_at,
          tip_summary.tipped_amount_cents AS viewer_tipped_amount_cents,
          requester.handle AS requester_handle,
          requester.name AS requester_name,
          requester."avatarUrl" AS requester_avatar_url,
          requester."coverUrl" AS requester_cover_url,
          driver."communityMeta" AS driver_community_meta
        FROM citizen_drive_ride_request r
        INNER JOIN "User" requester ON requester.id = r.requester_user_id
        LEFT JOIN "User" driver ON driver.id = r.driver_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS offer_count
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.status IN ('pending', 'accepted')
        ) offer_summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            o.amount_cents,
            o.per_km_fee_cents,
            o.created_at
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.driver_user_id = ${userId}
            AND o.status IN ('pending', 'accepted')
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 1
        ) viewer_offer ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(l.amount_cents), 0)::int AS tipped_amount_cents
          FROM civil_credit_ledger l
          WHERE l.source_type = ${'drive_ride_tip'}
            AND l.status = ${'completed'}
            AND l.from_user_id = ${userId}
            AND COALESCE(l.metadata->>'rideRequestId', '') = r.id
        ) tip_summary ON TRUE
        WHERE r.id = ${params.data.rideId}
          AND r.requester_user_id = ${userId}
        LIMIT 1
      `

      const ride = rideRows[0]
      if (!ride) return reply.code(404).send({ error: 'ride_not_found' })

      const offerRows = await prisma.$queryRaw<DriveRideOfferRow[]>`
        SELECT
          o.id,
          o.ride_request_id,
          o.driver_user_id,
          o.status,
          o.amount_cents,
          o.per_km_fee_cents,
          o.created_at,
          o.updated_at,
          driver.handle AS driver_handle,
          driver.name AS driver_name,
          driver."avatarUrl" AS driver_avatar_url,
          driver."coverUrl" AS driver_cover_url,
          driver."communityMeta" AS driver_community_meta
        FROM citizen_drive_ride_offer o
        INNER JOIN "User" driver ON driver.id = o.driver_user_id
        WHERE o.ride_request_id = ${ride.id}
          AND o.status IN ('pending', 'accepted')
        ORDER BY CASE WHEN o.status = 'accepted' THEN 0 ELSE 1 END ASC, o.amount_cents ASC, o.created_at DESC, o.id DESC
      `

      return reply.send({
        item: mapRideRequestRow(ride, userId),
        offers: offerRows.map((row: DriveRideOfferRow) => mapDriveRideOfferRow(row)),
      })
    }),
  )

  app.get('/drive/delivery', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = DriveFeedQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      await deps.ensureCitizenMarketplaceTables()

      const rows =
        query.data.scope === 'mine'
          ? await prisma.$queryRaw<DriveDeliveryRow[]>`
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
                c.driver_user_id,
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
              WHERE c.seller_user_id = ${userId}
                 OR c.buyer_user_id = ${userId}
                 OR c.driver_user_id = ${userId}
              ORDER BY c.updated_at DESC, c.id DESC
              LIMIT ${query.data.limit}
            `
          : await prisma.$queryRaw<DriveDeliveryRow[]>`
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
                c.driver_user_id,
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

      const countRows =
        query.data.scope === 'mine'
          ? await prisma.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::int AS count
              FROM citizen_market_delivery_contract c
              WHERE c.seller_user_id = ${userId}
                 OR c.buyer_user_id = ${userId}
                 OR c.driver_user_id = ${userId}
            `
          : await prisma.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::int AS count
              FROM citizen_market_delivery_contract c
              INNER JOIN citizen_market_listing l ON l.id = c.listing_id
              WHERE c.status IN ('open', 'bid_pending')
                AND c.driver_user_id IS NULL
                AND l.is_active = TRUE
            `

      return reply.send({
        total: countRows[0]?.count ?? 0,
        items: rows.map((row: DriveDeliveryRow) => mapDeliveryRequestRow(row, deps, userId)),
      })
    }),
  )

  app.get('/drive/drivers', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = DriveFeedQuery.safeParse(req.query ?? {})
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
          bidPending: false,
          bidAmountCents: null,
          bidPerKmFeeCents: null,
          bidRequestedAt: null,
          isBidByViewer: false,
          offerCount: 0,
          createdAt: new Date().toISOString(),
          viewerRole: 'requester',
          driverUserId: null,
          acceptedOfferId: null,
          acceptedOfferAmountCents: null,
          acceptedOfferPerKmFeeCents: null,
          acceptedOfferAt: null,
          contractStartedAt: null,
          escrowStatus: 'none',
          walletTransactionId: null,
          completionRequestedAt: null,
          completionConfirmationDueAt: null,
          riderConfirmedCompleteAt: null,
          riderReportedIssueAt: null,
          autoCompletedAt: null,
          supportRequestId: null,
          driverLocation: null,
          requesterLocation: null,
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

  app.put('/drive/rides/:rideId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = RideCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

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
          r.bid_driver_user_id,
          r.bid_amount_cents,
          r.bid_per_km_fee_cents,
          r.bid_requested_at,
          r.created_at,
          COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
          viewer_offer.amount_cents AS viewer_offer_amount_cents,
          viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
          viewer_offer.created_at AS viewer_offer_requested_at,
          requester.handle AS requester_handle,
          requester.name AS requester_name,
          requester."avatarUrl" AS requester_avatar_url
        FROM citizen_drive_ride_request r
        INNER JOIN "User" requester ON requester.id = r.requester_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS offer_count
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.status = 'pending'
        ) offer_summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            o.amount_cents,
            o.per_km_fee_cents,
            o.created_at
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.driver_user_id = ${userId}
            AND o.status = 'pending'
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 1
        ) viewer_offer ON TRUE
        WHERE r.id = ${params.data.rideId}
          AND r.requester_user_id = ${userId}
        LIMIT 1
      `

      const current = rows[0]
      if (!current) return reply.code(404).send({ error: 'ride_not_found' })
      if (current.status !== 'open' && current.status !== 'bid_pending') {
        return reply.code(409).send({ error: 'ride_not_editable' })
      }

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

      await prisma.$executeRaw`
        DELETE FROM citizen_drive_ride_offer
        WHERE ride_request_id = ${current.id}
      `

      await prisma.$executeRaw`
        UPDATE citizen_drive_ride_request
        SET status = 'open',
            recurrence = ${body.data.recurrence},
            pickup_address = ${JSON.stringify(pickupAddress)}::jsonb,
            pickup_city = ${pickupAddress.city},
            pickup_province = ${pickupAddress.province},
            pickup_postal_code = ${pickupAddress.postalCode},
            pickup_latitude = ${pickupAddress.latitude},
            pickup_longitude = ${pickupAddress.longitude},
            dropoff_address = ${JSON.stringify(dropoffAddress)}::jsonb,
            dropoff_city = ${dropoffAddress.city},
            dropoff_province = ${dropoffAddress.province},
            dropoff_postal_code = ${dropoffAddress.postalCode},
            dropoff_latitude = ${dropoffAddress.latitude},
            dropoff_longitude = ${dropoffAddress.longitude},
            pickup_at = ${pickupAt.toISOString()}::timestamptz,
            dropoff_at = ${dropoffAt.toISOString()}::timestamptz,
            route_distance_km = ${estimate.routeDistanceKm},
            fuel_charge_cents = ${estimate.fuelChargeCents},
            driver_fee_cents = ${estimate.driverFeeCents},
            total_cost_cents = ${estimate.totalCostCents},
            bid_driver_user_id = NULL,
            bid_amount_cents = NULL,
            bid_per_km_fee_cents = NULL,
            bid_requested_at = NULL,
            bid_responded_at = NULL,
            updated_at = NOW()
        WHERE id = ${current.id}
          AND requester_user_id = ${userId}
      `

      return reply.send({
        success: true,
        item: mapRideRequestRow(
          {
            ...current,
            status: 'open',
            recurrence: body.data.recurrence,
            pickup_address: pickupAddress,
            dropoff_address: dropoffAddress,
            pickup_at: pickupAt,
            dropoff_at: dropoffAt,
            route_distance_km: estimate.routeDistanceKm,
            fuel_charge_cents: estimate.fuelChargeCents,
            driver_fee_cents: estimate.driverFeeCents,
            total_cost_cents: estimate.totalCostCents,
            bid_driver_user_id: null,
            bid_amount_cents: null,
            bid_per_km_fee_cents: null,
            bid_requested_at: null,
            offer_count: 0,
            viewer_offer_amount_cents: null,
            viewer_offer_per_km_fee_cents: null,
            viewer_offer_requested_at: null,
          },
          userId,
        ),
      })
    }),
  )

  app.post('/drive/rides/:rideId/offer', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = RideOfferBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

      await deps.ensureCitizenMarketplaceTables()

      const driver = await prisma.user.findUnique({
        where: { id: userId },
        select: { communityMeta: true },
      })
      if (!driver) return reply.code(401).send({ error: 'unauthorized' })

      const baseMeta = typeof deps.readBaseCommunityMeta === 'function' ? deps.readBaseCommunityMeta(driver.communityMeta ?? null) : {}
      const driverState = readDriverAccountState(baseMeta)
      if (!driverState.activeAt) return reply.code(403).send({ error: 'driver_not_active' })

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
          r.bid_driver_user_id,
          r.bid_amount_cents,
          r.bid_per_km_fee_cents,
          r.bid_requested_at,
          r.created_at,
          COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
          viewer_offer.amount_cents AS viewer_offer_amount_cents,
          viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
          viewer_offer.created_at AS viewer_offer_requested_at,
          requester.handle AS requester_handle,
          requester.name AS requester_name,
          requester."avatarUrl" AS requester_avatar_url
        FROM citizen_drive_ride_request r
        INNER JOIN "User" requester ON requester.id = r.requester_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS offer_count
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.status = 'pending'
        ) offer_summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            o.amount_cents,
            o.per_km_fee_cents,
            o.created_at
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.driver_user_id = ${userId}
            AND o.status = 'pending'
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 1
        ) viewer_offer ON TRUE
        WHERE r.id = ${params.data.rideId}
        LIMIT 1
      `

      const current = rows[0]
      if (!current) return reply.code(404).send({ error: 'ride_not_found' })
      if (current.requester_user_id === userId) return reply.code(403).send({ error: 'forbidden' })
      if (current.status !== 'open' && current.status !== 'bid_pending') return reply.code(409).send({ error: 'ride_not_open' })

      const bidAmountCents = Math.max(body.data.perKmFeeCents, Math.round((Number(current.route_distance_km) || 0) * body.data.perKmFeeCents))
      const existingOfferRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM citizen_drive_ride_offer
        WHERE ride_request_id = ${current.id}
          AND driver_user_id = ${userId}
        LIMIT 1
      `
      const hadExistingOffer = Boolean(existingOfferRows[0]?.id)
      const offerId = existingOfferRows[0]?.id ?? `${current.id}:${userId}`

      await prisma.$executeRaw`
        INSERT INTO citizen_drive_ride_offer (
          id,
          ride_request_id,
          driver_user_id,
          status,
          amount_cents,
          per_km_fee_cents,
          created_at,
          updated_at
        )
        VALUES (
          ${offerId},
          ${current.id},
          ${userId},
          ${'pending'},
          ${bidAmountCents},
          ${body.data.perKmFeeCents},
          NOW(),
          NOW()
        )
        ON CONFLICT (ride_request_id, driver_user_id) DO UPDATE
        SET status = 'pending',
            amount_cents = EXCLUDED.amount_cents,
            per_km_fee_cents = EXCLUDED.per_km_fee_cents,
            updated_at = NOW()
      `

      await prisma.$executeRaw`
        UPDATE citizen_drive_ride_request
        SET status = 'bid_pending',
            bid_driver_user_id = ${userId},
            bid_amount_cents = ${bidAmountCents},
            bid_per_km_fee_cents = ${body.data.perKmFeeCents},
            bid_requested_at = NOW(),
            bid_responded_at = NULL,
            updated_at = NOW()
        WHERE id = ${current.id}
      `

      await deps.createNotificationRecord({
        userId: current.requester_user_id,
        actorId: userId,
        type: DRIVE_RIDE_NOTIFICATION_TYPES.OFFER,
        payload: {
          rideRequestId: current.id,
          amountCents: bidAmountCents,
          perKmFeeCents: body.data.perKmFeeCents,
          status: 'pending',
          url: `/drive/myrides/${current.id}/offers`,
          sourceUrl: `/drive/myrides/${current.id}/offers`,
        },
      })

      return reply.send({
        success: true,
        item: {
          ...mapRideRequestRow(
            {
              ...current,
              status: 'bid_pending',
              bid_driver_user_id: userId,
              bid_amount_cents: bidAmountCents,
              bid_per_km_fee_cents: body.data.perKmFeeCents,
              bid_requested_at: new Date(),
              offer_count: hadExistingOffer ? current.offer_count : (Number(current.offer_count) || 0) + 1,
              viewer_offer_amount_cents: bidAmountCents,
              viewer_offer_per_km_fee_cents: body.data.perKmFeeCents,
              viewer_offer_requested_at: new Date(),
            },
            userId,
          ),
        },
      })
    }),
  )

  app.post('/drive/rides/:rideId/offers/:offerId/accept', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideOfferParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()
      await ensureCitizenWalletTables()
      await settleExpiredDriveRideEscrows()

      const rideRows = await prisma.$queryRaw<Array<{
        id: string
        requester_user_id: string
        status: string
        driver_user_id: string | null
        escrow_status: string | null
      }>>`
        SELECT id, requester_user_id, status, driver_user_id, escrow_status
        FROM citizen_drive_ride_request
        WHERE id = ${params.data.rideId}
        LIMIT 1
      `

      const ride = rideRows[0]
      if (!ride || ride.requester_user_id !== userId) return reply.code(404).send({ error: 'ride_not_found' })
      if (ride.driver_user_id || ride.escrow_status === 'held' || (ride.status !== 'open' && ride.status !== 'bid_pending')) {
        return reply.code(409).send({ error: 'ride_offer_not_accepting' })
      }

      const offerRows = await prisma.$queryRaw<Array<{
        id: string
        ride_request_id: string
        driver_user_id: string
        status: string
        amount_cents: number
        per_km_fee_cents: number
        driver_handle: string | null
        driver_name: string | null
      }>>`
        SELECT
          o.id,
          o.ride_request_id,
          o.driver_user_id,
          o.status,
          o.amount_cents,
          o.per_km_fee_cents,
          driver.handle AS driver_handle,
          driver.name AS driver_name
        FROM citizen_drive_ride_offer o
        INNER JOIN "User" driver ON driver.id = o.driver_user_id
        WHERE o.id = ${params.data.offerId}
          AND o.ride_request_id = ${ride.id}
        LIMIT 1
      `

      const offer = offerRows[0]
      if (!offer || offer.status !== 'pending') return reply.code(404).send({ error: 'offer_not_found' })

      const [requester, driver] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, handle: true, name: true, communityMeta: true },
        }),
        prisma.user.findUnique({
          where: { id: offer.driver_user_id },
          select: { id: true, handle: true, name: true, communityMeta: true },
        }),
      ])

      if (!requester || !driver) return reply.code(404).send({ error: 'user_not_found' })

      const requesterWallet = readWalletSummary(requester.communityMeta ?? null)
      const customerChargeCents = calculateRideCustomerChargeCents(offer.amount_cents)
      if (!requesterWallet.enabled) {
        return reply.code(400).send({ error: 'wallet_required', requiredAmountCents: customerChargeCents })
      }
      if (requesterWallet.civilCreditsCents < customerChargeCents) {
        return reply.code(400).send({
          error: 'insufficient_wallet_balance',
          availableCreditsCents: requesterWallet.civilCreditsCents,
          requiredAmountCents: customerChargeCents,
        })
      }

      const requesterMeta = readBaseCommunityMetaRecord(requester.communityMeta ?? null)
      requesterMeta.wallet = buildWalletMetaValue({
        ...requesterWallet,
        civilCreditsCents: requesterWallet.civilCreditsCents - customerChargeCents,
      })

      const walletTransactionId = `drive-ride:${ride.id}:escrow`

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.user.update({
          where: { id: requester.id },
          data: { communityMeta: requesterMeta as Prisma.InputJsonValue },
        })

        await tx.$executeRaw`
          INSERT INTO citizen_wallet_transaction (
            id,
            kind,
            status,
            user_id,
            counterparty_user_id,
            amount_cents,
            currency,
            metadata,
            created_at,
            updated_at
          )
          VALUES (
            ${walletTransactionId},
            ${'drive_ride_escrow'},
            ${'pending'},
            ${requester.id},
            ${driver.id},
            ${customerChargeCents},
            ${'cad'},
            ${JSON.stringify({
              kind: 'drive_ride_escrow',
              rideRequestId: ride.id,
              requesterUserId: requester.id,
              driverUserId: driver.id,
              acceptedOfferId: offer.id,
              customerChargeCents,
              civilFeeCents: RIDE_CIVIL_FEE_CENTS,
              driverPayoutCents: offer.amount_cents,
            })}::jsonb,
            NOW(),
            NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `

        await insertCivilCreditLedgerEntry(tx, {
          id: `${walletTransactionId}:hold`,
          eventId: walletTransactionId,
          entryType: 'transfer',
          status: 'pending',
          amountCents: customerChargeCents,
          currency: 'cad',
          from: {
            userId: requester.id,
            handle: requester.handle,
            name: requester.name,
            entityType: 'user',
            entityLabel: formatDriveActorLabel(requester),
          },
          to: {
            entityType: 'ride_escrow',
            entityLabel: 'Drive ride escrow',
          },
          sourceType: 'drive_ride_escrow_hold',
          sourceReferenceId: ride.id,
          description: `Drive ride escrow hold for ${formatDriveActorLabel(driver)}`,
          metadata: {
            kind: 'drive_ride_escrow_hold',
            rideRequestId: ride.id,
            requesterUserId: requester.id,
            driverUserId: driver.id,
            acceptedOfferId: offer.id,
            customerChargeCents,
            civilFeeCents: RIDE_CIVIL_FEE_CENTS,
            driverPayoutCents: offer.amount_cents,
          },
        })

        await tx.$executeRaw`
          UPDATE citizen_drive_ride_offer
          SET status = CASE WHEN id = ${offer.id} THEN ${'accepted'} ELSE ${'declined'} END,
              updated_at = NOW()
          WHERE ride_request_id = ${ride.id}
            AND status = 'pending'
        `

        await tx.$executeRaw`
          UPDATE citizen_drive_ride_request
          SET status = ${'driver_selected'},
              driver_user_id = ${driver.id},
              accepted_offer_id = ${offer.id},
              accepted_offer_amount_cents = ${offer.amount_cents},
              accepted_offer_per_km_fee_cents = ${offer.per_km_fee_cents},
              accepted_offer_at = NOW(),
              contract_started_at = NULL,
              escrow_status = ${'held'},
              wallet_transaction_id = ${walletTransactionId},
              fuel_charge_cents = ${RIDE_CIVIL_FEE_CENTS},
              driver_fee_cents = ${offer.amount_cents},
              total_cost_cents = ${customerChargeCents},
              bid_driver_user_id = ${driver.id},
              bid_amount_cents = ${offer.amount_cents},
              bid_per_km_fee_cents = ${offer.per_km_fee_cents},
              bid_responded_at = NOW(),
              updated_at = NOW()
          WHERE id = ${ride.id}
            AND requester_user_id = ${requester.id}
        `

        await ensureAcceptedDriveConnection(tx, requester.id, driver.id)
      })

      await deps.createNotificationRecord?.({
        userId: driver.id,
        actorId: requester.id,
        type: DRIVE_RIDE_NOTIFICATION_TYPES.OFFER_ACCEPTED,
        payload: {
          rideRequestId: ride.id,
          offerId: offer.id,
          amountCents: offer.amount_cents,
          customerPaysCents: customerChargeCents,
          status: 'accepted',
          url: '/drive',
          sourceUrl: '/drive',
        },
      })

      return reply.send({ success: true, status: 'driver_selected' })
    }),
  )

  app.post('/drive/rides/:rideId/start', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()
      await settleExpiredDriveRideEscrows()

      const rows = await prisma.$queryRaw<Array<{
        id: string
        driver_user_id: string | null
        status: string
        accepted_offer_id: string | null
        contract_started_at: Date | null
      }>>`
        SELECT
          id,
          driver_user_id,
          status,
          accepted_offer_id,
          contract_started_at
        FROM citizen_drive_ride_request
        WHERE id = ${params.data.rideId}
        LIMIT 1
      `

      const ride = rows[0]
      if (!ride || ride.driver_user_id !== userId) return reply.code(404).send({ error: 'ride_not_found' })
      if (!ride.accepted_offer_id) return reply.code(409).send({ error: 'ride_not_startable' })
      if (!['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route', 'driver_arrived', 'arrived', 'picked_up', 'in_progress'].includes(ride.status)) {
        return reply.code(409).send({ error: 'ride_not_startable' })
      }

      const nextStatus =
        ['accepted', 'assigned', 'matched', 'driver_selected'].includes(ride.status) ? 'driver_en_route' : ride.status
      const contractStartedAt = ride.contract_started_at ? ride.contract_started_at.toISOString() : new Date().toISOString()

      await prisma.$executeRaw`
        UPDATE citizen_drive_ride_request
        SET contract_started_at = COALESCE(contract_started_at, NOW()),
            status = ${nextStatus},
            updated_at = NOW()
        WHERE id = ${ride.id}
          AND driver_user_id = ${userId}
      `

      return reply.send({
        success: true,
        status: nextStatus,
        contractStartedAt,
      })
    }),
  )

  app.post('/drive/rides/:rideId/contract-action', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = RideContractActionBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

      await deps.ensureCitizenMarketplaceTables()

      const rows = await prisma.$queryRaw<Array<{
        id: string
        requester_user_id: string
        driver_user_id: string | null
        status: string
        accepted_offer_id: string | null
        contract_started_at: Date | null
      }>>`
        SELECT
          id,
          requester_user_id,
          driver_user_id,
          status,
          accepted_offer_id,
          contract_started_at
        FROM citizen_drive_ride_request
        WHERE id = ${params.data.rideId}
        LIMIT 1
      `

      const ride = rows[0]
      if (!ride || ride.driver_user_id !== userId) return reply.code(404).send({ error: 'ride_not_found' })
      if (!ride.accepted_offer_id) return reply.code(409).send({ error: 'ride_not_startable' })

      const nextStatus = resolveDriveRideContractStatusAction(ride.status, body.data.action)
      if (!nextStatus) return reply.code(409).send({ error: 'invalid_contract_action' })

      const contractStartedAt = ride.contract_started_at ? ride.contract_started_at.toISOString() : new Date().toISOString()

      await prisma.$executeRaw`
        UPDATE citizen_drive_ride_request
        SET status = ${nextStatus},
            contract_started_at = COALESCE(contract_started_at, NOW()),
            updated_at = NOW()
        WHERE id = ${ride.id}
          AND driver_user_id = ${userId}
      `

      try {
        await deps.createNotificationRecord({
          userId: ride.requester_user_id,
          actorId: userId,
          type: DRIVE_RIDE_NOTIFICATION_TYPES.CONTRACT_UPDATE,
          payload: buildDriveRideContractUpdatePayload({
            rideId: ride.id,
            action: body.data.action,
            status: nextStatus,
          }),
        })
      } catch (notificationError) {
        req.log.error({ err: notificationError, rideId: ride.id, action: body.data.action }, 'drive_ride_contract_update_notification_failed')
      }

      return reply.send({
        success: true,
        status: nextStatus,
        contractStartedAt,
      })
    }),
  )

  app.post('/drive/rides/:rideId/location', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = RideLocationUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

      await deps.ensureCitizenMarketplaceTables()

      const rows = await prisma.$queryRaw<Array<{
        id: string
        requester_user_id: string
        driver_user_id: string | null
        status: string
      }>>`
        SELECT id, requester_user_id, driver_user_id, status
        FROM citizen_drive_ride_request
        WHERE id = ${params.data.rideId}
        LIMIT 1
      `

      const ride = rows[0]
      if (!ride || (ride.driver_user_id !== userId && ride.requester_user_id !== userId)) return reply.code(404).send({ error: 'ride_not_found' })
      if (!isDriveStatusLocationTrackable(ride.status)) return reply.code(409).send({ error: 'ride_not_trackable' })

      if (ride.driver_user_id === userId) {
        await prisma.$executeRaw`
          UPDATE citizen_drive_ride_request
          SET driver_location_latitude = ${body.data.latitude},
              driver_location_longitude = ${body.data.longitude},
              driver_location_recorded_at = NOW(),
              updated_at = NOW()
          WHERE id = ${ride.id}
            AND driver_user_id = ${userId}
        `
      } else {
        await prisma.$executeRaw`
          UPDATE citizen_drive_ride_request
          SET requester_location_latitude = ${body.data.latitude},
              requester_location_longitude = ${body.data.longitude},
              requester_location_recorded_at = NOW(),
              updated_at = NOW()
          WHERE id = ${ride.id}
            AND requester_user_id = ${userId}
        `
      }

      return reply.send({
        success: true,
        recordedAt: new Date().toISOString(),
      })
    }),
  )

  app.post('/drive/rides/:rideId/complete', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()
      await ensureCitizenWalletTables()
      await settleExpiredDriveRideEscrows()

      try {
        const result = await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<Array<{
            id: string
            requester_user_id: string
            driver_user_id: string | null
            status: string
            escrow_status: string | null
            completion_requested_at: Date | null
            accepted_offer_id: string | null
            accepted_offer_amount_cents: number | null
            driver_fee_cents: number
          }>>`
            SELECT
              id,
              requester_user_id,
              driver_user_id,
              status,
              escrow_status,
              completion_requested_at,
              accepted_offer_id,
              accepted_offer_amount_cents,
              driver_fee_cents
            FROM citizen_drive_ride_request
            WHERE id = ${params.data.rideId}
            LIMIT 1
            FOR UPDATE
          `

          const ride = rows[0]
          if (!ride || ride.driver_user_id !== userId) throw new Error('ride_not_found')
          if (ride.escrow_status !== 'held') throw new Error('ride_not_in_escrow')
          if (!['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route', 'driver_arrived', 'arrived', 'picked_up', 'in_progress'].includes(ride.status)) {
            throw new Error('ride_not_completable')
          }
          if (ride.completion_requested_at) throw new Error('ride_completion_already_requested')

          const completedAt = new Date()

          await tx.$executeRaw`
            UPDATE citizen_drive_ride_request
            SET status = ${'completed'},
                contract_started_at = COALESCE(contract_started_at, NOW()),
                completion_requested_at = ${completedAt},
                completion_confirmation_due_at = NULL,
                updated_at = NOW()
            WHERE id = ${ride.id}
              AND driver_user_id = ${userId}
          `

          const settlement = await releaseDriveRideEscrow(tx, ride.id, 'confirmed', completedAt)
          if (!settlement.settled) throw new Error('ride_not_in_escrow')

          return {
            requesterUserId: ride.requester_user_id,
            status: 'completed',
            completedAt: completedAt.toISOString(),
            earningsCreditedCents: Math.max(0, Number(ride.accepted_offer_amount_cents) || Number(ride.driver_fee_cents) || 0),
          }
        })

        const driver = await prisma.user.findUnique({
          where: { id: userId },
          select: { communityMeta: true },
        })
        const driverVehicle = readFeaturedDriverVehicle(driver?.communityMeta ?? null)

        try {
          await deps.createNotificationRecord({
            userId: result.requesterUserId,
            actorId: userId,
            type: DRIVE_RIDE_NOTIFICATION_TYPES.CONTRACT_UPDATE,
            payload: buildDriveRideContractUpdatePayload({
              rideId: params.data.rideId,
              action: 'complete_contract',
              status: 'completed',
              vehicleImageUrl: driverVehicle?.photoUrls[0] ?? null,
              vehicleLabel: driverVehicle?.name ?? null,
              tipEligible: true,
            }),
          })
        } catch (notificationError) {
          req.log.error({ err: notificationError, rideId: params.data.rideId, action: 'complete_contract' }, 'drive_ride_contract_update_notification_failed')
        }

        const { requesterUserId: _requesterUserId, ...response } = result

        return reply.send({ success: true, ...response })
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'ride_not_found') return reply.code(404).send({ error: 'ride_not_found' })
          if (error.message === 'ride_not_in_escrow') return reply.code(409).send({ error: 'ride_not_in_escrow' })
          if (error.message === 'ride_not_completable') return reply.code(409).send({ error: 'ride_not_completable' })
          if (error.message === 'ride_completion_already_requested') return reply.code(409).send({ error: 'ride_completion_already_requested' })
        }
        req.log.error({ err: error, rideId: params.data.rideId, userId }, 'drive_ride_complete_failed')
        return reply.code(500).send({ error: 'ride_complete_failed' })
      }
    }),
  )

  app.post('/drive/rides/:rideId/tip', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = RideTipBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

      await deps.ensureCitizenMarketplaceTables()
      await ensureCitizenWalletTables()

      try {
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const rideRows = await tx.$queryRaw<Array<{
            id: string
            requester_user_id: string
            driver_user_id: string | null
            status: string
            escrow_status: string | null
          }>>`
            SELECT id, requester_user_id, driver_user_id, status, escrow_status
            FROM citizen_drive_ride_request
            WHERE id = ${params.data.rideId}
            LIMIT 1
            FOR UPDATE
          `

          const ride = rideRows[0] ?? null
          if (!ride || ride.requester_user_id !== userId || !ride.driver_user_id) throw new Error('ride_not_found')
          if (ride.status !== 'completed' || ride.escrow_status !== 'released') throw new Error('ride_not_tippable')

          const tipSourceReferenceId = `${ride.id}:${userId}`
          const existingTip = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM civil_credit_ledger
            WHERE source_type = ${'drive_ride_tip'}
              AND source_reference_id = ${tipSourceReferenceId}
            LIMIT 1
          `
          if (existingTip[0]) throw new Error('tip_already_sent')

          const [requester, driver] = await Promise.all([
            tx.user.findUnique({
              where: { id: userId },
              select: { id: true, handle: true, name: true, communityMeta: true },
            }),
            tx.user.findUnique({
              where: { id: ride.driver_user_id },
              select: { id: true, handle: true, name: true, communityMeta: true },
            }),
          ])

          if (!requester || !driver) throw new Error('user_not_found')

          const tipAmountCents = Math.max(0, Math.round(body.data.amountCents || 0))
          const feeCents = computeCivilPayFeeCents(tipAmountCents)
          const totalChargeCents = tipAmountCents + feeCents
          const requesterWallet = readWalletSummary(requester.communityMeta ?? null)
          if (!requesterWallet.enabled) throw new Error('wallet_required')
          if (requesterWallet.civilCreditsCents < totalChargeCents) throw new Error('insufficient_wallet_balance')

          const requesterMeta = readBaseCommunityMetaRecord(requester.communityMeta ?? null)
          requesterMeta.wallet = buildWalletMetaValue({
            ...requesterWallet,
            civilCreditsCents: requesterWallet.civilCreditsCents - totalChargeCents,
          })

          const driverWallet = readWalletSummary(driver.communityMeta ?? null)
          const driverMeta = readBaseCommunityMetaRecord(driver.communityMeta ?? null)
          driverMeta.wallet = buildWalletMetaValue({
            ...driverWallet,
            civilCreditsCents: driverWallet.civilCreditsCents + tipAmountCents,
          })

          await Promise.all([
            tx.user.update({
              where: { id: requester.id },
              data: { communityMeta: requesterMeta as Prisma.InputJsonValue },
            }),
            tx.user.update({
              where: { id: driver.id },
              data: { communityMeta: driverMeta as Prisma.InputJsonValue },
            }),
          ])

          const transactionId = `drive-ride-tip:${ride.id}:${requester.id}`
          await tx.$executeRaw`
            INSERT INTO citizen_wallet_transaction (
              id,
              kind,
              status,
              user_id,
              counterparty_user_id,
              amount_cents,
              currency,
              metadata,
              updated_at
            )
            VALUES (
              ${transactionId},
              ${'drive_ride_tip'},
              ${'completed'},
              ${requester.id},
              ${driver.id},
              ${totalChargeCents},
              ${'cad'},
              ${JSON.stringify({
                kind: 'drive_ride_tip',
                rideRequestId: ride.id,
                requesterUserId: requester.id,
                driverUserId: driver.id,
                tipAmountCents,
                feeCents,
                totalChargeCents,
              })}::jsonb,
              NOW()
            )
            ON CONFLICT (id) DO NOTHING
          `

          await insertCivilCreditLedgerEntry(tx, {
            id: `${transactionId}:driver`,
            eventId: `${transactionId}:driver`,
            entryType: 'transfer',
            status: 'completed',
            amountCents: tipAmountCents,
            currency: 'cad',
            from: {
              entityType: 'user_wallet',
              userId: requester.id,
              handle: requester.handle ?? null,
              name: requester.name ?? null,
              entityLabel: 'Civil Wallet',
            },
            to: {
              entityType: 'user_wallet',
              userId: driver.id,
              handle: driver.handle ?? null,
              name: driver.name ?? null,
              entityLabel: 'Civil Wallet',
            },
            sourceType: 'drive_ride_tip',
            sourceReferenceId: tipSourceReferenceId,
            description: `Ride tip for ${formatDriveActorLabel(driver)}`,
            metadata: {
              kind: 'drive_ride_tip',
              rideRequestId: ride.id,
              requesterUserId: requester.id,
              driverUserId: driver.id,
              tipAmountCents,
              feeCents,
              totalChargeCents,
            },
          })

          await insertCivilCreditLedgerEntry(tx, {
            id: `${transactionId}:fee`,
            eventId: `${transactionId}:fee`,
            entryType: 'adjustment',
            status: 'completed',
            amountCents: feeCents,
            currency: 'cad',
            from: {
              entityType: 'user_wallet',
              userId: requester.id,
              handle: requester.handle ?? null,
              name: requester.name ?? null,
              entityLabel: 'Civil Wallet',
            },
            to: {
              entityType: 'platform',
              entityLabel: 'Civil fee',
            },
            sourceType: 'drive_ride_tip_civil_fee',
            sourceReferenceId: tipSourceReferenceId,
            description: `Civil fee for ride tip ${ride.id}`,
            metadata: {
              kind: 'drive_ride_tip_civil_fee',
              rideRequestId: ride.id,
              requesterUserId: requester.id,
              driverUserId: driver.id,
              tipAmountCents,
              feeCents,
              totalChargeCents,
            },
          })

          const driverVehicle = readFeaturedDriverVehicle(driver.communityMeta ?? null)
          await tx.$executeRaw`
            UPDATE "Notification"
            SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'tipEligible', false,
              'tippedAmountCents', ${tipAmountCents},
              'vehicleImageUrl', ${driverVehicle?.photoUrls[0] ?? null},
              'vehicleLabel', ${driverVehicle?.name ?? null}
            )
            WHERE "userId" = ${requester.id}
              AND type = ${DRIVE_RIDE_NOTIFICATION_TYPES.CONTRACT_UPDATE}
              AND COALESCE(payload->>'rideRequestId', '') = ${ride.id}
              AND COALESCE(payload->>'action', '') = ${'complete_contract'}
          `

          return {
            rideId: ride.id,
            driverUserId: driver.id,
            tipAmountCents,
            feeCents,
            totalChargeCents,
            remainingBalanceCents: requesterWallet.civilCreditsCents - totalChargeCents,
          }
        })

        try {
          await deps.createNotificationRecord({
            userId: result.driverUserId,
            actorId: userId,
            type: DRIVE_RIDE_NOTIFICATION_TYPES.TIP_RECEIVED,
            payload: buildDriveRideTipReceivedPayload({
              rideId: result.rideId,
              tipAmountCents: result.tipAmountCents,
            }),
          })
        } catch (notificationError) {
          req.log.error({ err: notificationError, rideId: result.rideId, userId }, 'drive_ride_tip_notification_failed')
        }

        const { driverUserId: _driverUserId, ...response } = result
        return reply.send({ success: true, ...response })
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'ride_not_found') return reply.code(404).send({ error: 'ride_not_found' })
          if (error.message === 'ride_not_tippable') return reply.code(409).send({ error: 'ride_not_tippable' })
          if (error.message === 'tip_already_sent') return reply.code(409).send({ error: 'tip_already_sent' })
          if (error.message === 'user_not_found') return reply.code(404).send({ error: 'user_not_found' })
          if (error.message === 'wallet_required') return reply.code(400).send({ error: 'wallet_required' })
          if (error.message === 'insufficient_wallet_balance') return reply.code(400).send({ error: 'insufficient_wallet_balance' })
        }
        req.log.error({ err: error, rideId: params.data.rideId, userId }, 'drive_ride_tip_failed')
        return reply.code(500).send({ error: 'ride_tip_failed' })
      }
    }),
  )

  app.get('/drive/driver/earnings-summary', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      await deps.ensureCitizenMarketplaceTables()
      await ensureCitizenWalletTables()

      const rows = await prisma.$queryRaw<Array<{
        today_earnings_cents: number | null
        today_tips_cents: number | null
        today_hourly_earnings_cents: number | null
        this_week_earnings_cents: number | null
        this_week_tips_cents: number | null
        this_week_hourly_earnings_cents: number | null
        today_km: number | null
        this_week_km: number | null
      }>>`
        WITH completed_rides AS (
          SELECT
            COALESCE(NULLIF(r.accepted_offer_amount_cents, 0), NULLIF(r.driver_fee_cents, 0), 0)::int AS payout_cents,
            COALESCE(r.route_distance_km, 0)::numeric AS distance_km,
            COALESCE(r.rider_confirmed_complete_at, r.auto_completed_at, r.completion_requested_at, r.updated_at) AS completed_at,
            GREATEST(
              EXTRACT(
                EPOCH FROM (
                  COALESCE(r.rider_confirmed_complete_at, r.auto_completed_at, r.completion_requested_at, r.updated_at) -
                  COALESCE(r.contract_started_at, r.accepted_offer_at, r.created_at)
                )
              ) / 3600.0,
              0
            )::numeric AS active_hours
          FROM citizen_drive_ride_request r
          WHERE r.driver_user_id = ${userId}
            AND r.status = ${'completed'}
            AND r.escrow_status = ${'released'}
            AND r.accepted_offer_id IS NOT NULL
        ),
        tip_earnings AS (
          SELECT
            COALESCE(amount_cents, 0)::int AS tip_cents,
            occurred_at
          FROM civil_credit_ledger
          WHERE source_type = ${'drive_ride_tip'}
            AND status = ${'completed'}
            AND to_user_id = ${userId}
        )
        SELECT
          (
            COALESCE((SELECT SUM(CASE WHEN completed_at >= date_trunc('day', NOW()) THEN payout_cents ELSE 0 END) FROM completed_rides), 0)
            +
            COALESCE((SELECT SUM(CASE WHEN occurred_at >= date_trunc('day', NOW()) THEN tip_cents ELSE 0 END) FROM tip_earnings), 0)
          )::int AS today_earnings_cents,
          COALESCE((SELECT SUM(CASE WHEN occurred_at >= date_trunc('day', NOW()) THEN tip_cents ELSE 0 END) FROM tip_earnings), 0)::int AS today_tips_cents,
          CASE
            WHEN COALESCE((SELECT SUM(CASE WHEN completed_at >= date_trunc('day', NOW()) THEN active_hours ELSE 0 END) FROM completed_rides), 0) > 0
              THEN ROUND(
                (
                  COALESCE((SELECT SUM(CASE WHEN completed_at >= date_trunc('day', NOW()) THEN payout_cents ELSE 0 END) FROM completed_rides), 0)
                  +
                  COALESCE((SELECT SUM(CASE WHEN occurred_at >= date_trunc('day', NOW()) THEN tip_cents ELSE 0 END) FROM tip_earnings), 0)
                )::numeric /
                (SELECT SUM(CASE WHEN completed_at >= date_trunc('day', NOW()) THEN active_hours ELSE 0 END) FROM completed_rides)
              )::int
            ELSE 0
          END AS today_hourly_earnings_cents,
          (
            COALESCE((SELECT SUM(CASE WHEN completed_at >= date_trunc('week', NOW()) THEN payout_cents ELSE 0 END) FROM completed_rides), 0)
            +
            COALESCE((SELECT SUM(CASE WHEN occurred_at >= date_trunc('week', NOW()) THEN tip_cents ELSE 0 END) FROM tip_earnings), 0)
          )::int AS this_week_earnings_cents,
          COALESCE((SELECT SUM(CASE WHEN occurred_at >= date_trunc('week', NOW()) THEN tip_cents ELSE 0 END) FROM tip_earnings), 0)::int AS this_week_tips_cents,
          CASE
            WHEN COALESCE((SELECT SUM(CASE WHEN completed_at >= date_trunc('week', NOW()) THEN active_hours ELSE 0 END) FROM completed_rides), 0) > 0
              THEN ROUND(
                (
                  COALESCE((SELECT SUM(CASE WHEN completed_at >= date_trunc('week', NOW()) THEN payout_cents ELSE 0 END) FROM completed_rides), 0)
                  +
                  COALESCE((SELECT SUM(CASE WHEN occurred_at >= date_trunc('week', NOW()) THEN tip_cents ELSE 0 END) FROM tip_earnings), 0)
                )::numeric /
                (SELECT SUM(CASE WHEN completed_at >= date_trunc('week', NOW()) THEN active_hours ELSE 0 END) FROM completed_rides)
              )::int
            ELSE 0
          END AS this_week_hourly_earnings_cents,
          COALESCE((SELECT ROUND(SUM(CASE WHEN completed_at >= date_trunc('day', NOW()) THEN distance_km ELSE 0 END), 1) FROM completed_rides), 0)::float8 AS today_km,
          COALESCE((SELECT ROUND(SUM(CASE WHEN completed_at >= date_trunc('week', NOW()) THEN distance_km ELSE 0 END), 1) FROM completed_rides), 0)::float8 AS this_week_km
      `

      const summary = rows[0] ?? null

      return reply.send({
        todayEarningsCents: Math.max(0, Number(summary?.today_earnings_cents) || 0),
        todayTipsCents: Math.max(0, Number(summary?.today_tips_cents) || 0),
        todayHourlyEarningsCents: Math.max(0, Number(summary?.today_hourly_earnings_cents) || 0),
        thisWeekEarningsCents: Math.max(0, Number(summary?.this_week_earnings_cents) || 0),
        thisWeekTipsCents: Math.max(0, Number(summary?.this_week_tips_cents) || 0),
        thisWeekHourlyEarningsCents: Math.max(0, Number(summary?.this_week_hourly_earnings_cents) || 0),
        todayKm: Number(summary?.today_km) || 0,
        thisWeekKm: Number(summary?.this_week_km) || 0,
      })
    }),
  )

  app.post('/drive/rides/:rideId/cancel', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = RideRequestParams.safeParse(req.params ?? {})
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

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
          r.bid_driver_user_id,
          r.bid_amount_cents,
          r.bid_per_km_fee_cents,
          r.bid_requested_at,
          r.created_at,
          COALESCE(offer_summary.offer_count, 0)::int AS offer_count,
          viewer_offer.amount_cents AS viewer_offer_amount_cents,
          viewer_offer.per_km_fee_cents AS viewer_offer_per_km_fee_cents,
          viewer_offer.created_at AS viewer_offer_requested_at,
          requester.handle AS requester_handle,
          requester.name AS requester_name,
          requester."avatarUrl" AS requester_avatar_url
        FROM citizen_drive_ride_request r
        INNER JOIN "User" requester ON requester.id = r.requester_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS offer_count
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.status = 'pending'
        ) offer_summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            o.amount_cents,
            o.per_km_fee_cents,
            o.created_at
          FROM citizen_drive_ride_offer o
          WHERE o.ride_request_id = r.id
            AND o.driver_user_id = ${userId}
            AND o.status = 'pending'
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 1
        ) viewer_offer ON TRUE
        WHERE r.id = ${params.data.rideId}
          AND r.requester_user_id = ${userId}
        LIMIT 1
      `

      const current = rows[0]
      if (!current) return reply.code(404).send({ error: 'ride_not_found' })
      if (!isDriveStatusCancellable(current.status)) return reply.code(409).send({ error: 'ride_not_cancellable' })

      await prisma.$executeRaw`
        DELETE FROM citizen_drive_ride_offer
        WHERE ride_request_id = ${current.id}
      `

      await prisma.$executeRaw`
        UPDATE citizen_drive_ride_request
        SET status = 'cancelled',
            bid_driver_user_id = NULL,
            bid_amount_cents = NULL,
            bid_per_km_fee_cents = NULL,
            bid_requested_at = NULL,
            bid_responded_at = NULL,
            updated_at = NOW()
        WHERE id = ${current.id}
          AND requester_user_id = ${userId}
      `

      return reply.send({
        success: true,
        item: {
          ...mapRideRequestRow(
            {
              ...current,
              offer_count: 0,
              viewer_offer_amount_cents: null,
              viewer_offer_per_km_fee_cents: null,
              viewer_offer_requested_at: null,
            },
            userId,
          ),
          status: 'cancelled',
        },
      })
    }),
  )
}
