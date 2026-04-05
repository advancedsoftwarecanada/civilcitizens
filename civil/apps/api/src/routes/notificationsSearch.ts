import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Redis as IORedis } from 'ioredis'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { settleExpiredDriveRideEscrows } from './driveRides.js'

const NotificationAckInput = z
  .object({
    ids: z.array(z.string().cuid()).min(1).max(50).optional(),
    before: z.coerce.date().optional(),
  })
  .refine((value) => Boolean(value.ids?.length || value.before), {
    message: 'ids_or_before_required',
    path: ['ids'],
  })

const NotificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().cuid().optional(),
})

const UserSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

const SearchTypeEnum = z.enum(['all', 'people', 'communities', 'organizations', 'events', 'market', 'posts', 'videos', 'lives'])

const CombinedSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  type: SearchTypeEnum.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  peopleLimit: z.coerce.number().int().min(1).max(10).default(3),
  communityLimit: z.coerce.number().int().min(1).max(10).default(3),
  organizationLimit: z.coerce.number().int().min(1).max(10).default(3),
  eventLimit: z.coerce.number().int().min(1).max(10).default(3),
  liveLimit: z.coerce.number().int().min(1).max(10).default(3),
  marketLimit: z.coerce.number().int().min(1).max(10).default(3),
  postLimit: z.coerce.number().int().min(1).max(10).default(3),
  videoLimit: z.coerce.number().int().min(1).max(10).default(3),
})

const PlaceSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(10).default(10),
  lat: z.coerce.number().finite().min(-90).max(90).optional(),
  lng: z.coerce.number().finite().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().finite().min(1).max(500).optional(),
})

const POI_CLASSES = new Set(['amenity', 'tourism', 'shop', 'healthcare', 'leisure', 'historic', 'office', 'craft'])
const HEALTHCARE_TYPES = new Set(['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'healthcare', 'laboratory', 'midwife', 'veterinary'])
const FOOD_TYPES = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream'])
const TRANSPORT_TYPES = new Set(['parking', 'fuel', 'bus_station', 'charging_station', 'ferry_terminal', 'taxi'])
const GENERIC_NAME_VALUES = new Set(['yes', 'building'])
const MAX_PLACE_SEARCH_RADIUS_KM = 500
const LOW_SIGNAL_PLACE_TYPES = new Set([
  'stream',
  'river',
  'canal',
  'ditch',
  'drain',
  'residential',
  'footway',
  'path',
  'cycleway',
  'bridleway',
  'track',
  'steps',
  'corridor',
  'service',
  'living_street',
  'pedestrian',
])
const LOW_SIGNAL_PLACE_CLASSES = new Set(['waterway', 'landuse'])

type PlaceSearchResultPayload = {
  kind: 'place' | 'address'
  name: string
  typeName: string | null
  category: string | null
  lat: number
  lng: number
  address: string
  displayName: string
  className: string | null
  addressFields: Record<string, string>
  placeId: number | null
  osmType: string | null
  osmId: number | null
  importance: number | null
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeAddressRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, string>
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((accumulator, [key, entry]) => {
    const text = normalizeText(entry)
    if (text) accumulator[key] = text
    return accumulator
  }, {})
}

function readNotificationPayloadRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeNotificationRequestStatus(value: unknown): 'pending' | 'accepted' | 'rejected' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'pending') return 'pending'
  if (['accepted', 'accept', 'approved', 'confirmed', 'completed'].includes(normalized)) return 'accepted'
  if (['rejected', 'reject', 'declined', 'dismissed', 'denied', 'cancelled', 'canceled'].includes(normalized)) return 'rejected'
  return null
}

function readForwardedHeader(req: FastifyRequest, name: string) {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return raw[0]?.trim() || null
  return typeof raw === 'string' ? raw.split(',')[0]?.trim() || null : null
}

function readCloudflareScheme(req: FastifyRequest) {
  const raw = readForwardedHeader(req, 'cf-visitor')
  if (!raw) return null
  const match = raw.match(/"scheme":"(https|http)"/i)
  return match?.[1]?.toLowerCase() || null
}

function buildPublicOrigin(req: FastifyRequest, civilPublicHost: string) {
  const host = readForwardedHeader(req, 'x-forwarded-host') || readForwardedHeader(req, 'host') || civilPublicHost
  const forwardedProto = readForwardedHeader(req, 'x-forwarded-proto')
  const cloudflareProto = readCloudflareScheme(req)
  const inferredPublicProto = host.endsWith('civilcitizens.ca') ? 'https' : null
  const proto = forwardedProto || cloudflareProto || inferredPublicProto || req.protocol || 'http'
  return `${proto}://${host}`
}

function getNominatimBaseUrl(req: FastifyRequest, civilPublicHost: string) {
  const configured = normalizeText(process.env.NOMINATIM_SERVER)
  if (configured) return trimTrailingSlash(configured)
  return `${buildPublicOrigin(req, civilPublicHost)}/nominatim`
}

function buildBoundedViewbox(latitude: number, longitude: number, radiusKm: number) {
  const safeRadiusKm = Math.max(1, Math.min(MAX_PLACE_SEARCH_RADIUS_KM, radiusKm))
  const latitudeDelta = safeRadiusKm / 111
  const longitudeDelta = safeRadiusKm / (111 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)))

  const minLongitude = Math.max(-180, longitude - longitudeDelta)
  const maxLongitude = Math.min(180, longitude + longitudeDelta)
  const minLatitude = Math.max(-90, latitude - latitudeDelta)
  const maxLatitude = Math.min(90, latitude + latitudeDelta)

  return `${minLongitude},${maxLatitude},${maxLongitude},${minLatitude}`
}

function buildNominatimSearchUrl(
  req: FastifyRequest,
  civilPublicHost: string,
  query: string,
  limit: number,
  options?: {
    latitude?: number
    longitude?: number
    radiusKm?: number
  },
) {
  const url = new URL(`${getNominatimBaseUrl(req, civilPublicHost)}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('namedetails', '1')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('dedupe', '1')
  url.searchParams.set('countrycodes', 'ca')
  if (
    typeof options?.latitude === 'number' &&
    Number.isFinite(options.latitude) &&
    typeof options?.longitude === 'number' &&
    Number.isFinite(options.longitude) &&
    typeof options?.radiusKm === 'number' &&
    Number.isFinite(options.radiusKm) &&
    options.radiusKm > 0
  ) {
    url.searchParams.set('viewbox', buildBoundedViewbox(options.latitude, options.longitude, options.radiusKm))
    url.searchParams.set('bounded', '1')
  }
  return url.toString()
}

function pickLocalityRecord(address: Record<string, string>) {
  return (
    address.city ||
    address.municipality ||
    address.town ||
    address.village ||
    address.borough ||
    address.city_district ||
    address.township ||
    address.hamlet ||
    address.suburb ||
    address.county ||
    ''
  )
}

function buildStreetLabel(address: Record<string, string>) {
  const houseNumber = normalizeText(address.house_number)
  const road = normalizeText(address.road)
  if (houseNumber && road) return `${houseNumber} ${road}`
  return road
}

function buildAddressPrimaryLabel(address: Record<string, string>, displayName: string) {
  return buildStreetLabel(address) || displayName.split(',')[0]?.trim() || displayName
}

function buildAddressSummary(address: Record<string, string>, displayName: string, kind: PlaceSearchResultPayload['kind']) {
  const street = buildStreetLabel(address)
  const locality = normalizeText(pickLocalityRecord(address))
  const province = normalizeText(address.state || address.province)
  const pieces = [street, locality, province].filter(Boolean)
  if (pieces.length) return pieces.join(', ')

  if (kind === 'place') {
    const [, ...segments] = displayName.split(',')
    const remainder = segments.map((segment) => segment.trim()).filter(Boolean).join(', ')
    if (remainder) return remainder
  }

  return displayName
}

function isMeaningfulName(value: string) {
  return Boolean(value) && !GENERIC_NAME_VALUES.has(value.toLowerCase())
}

function readExplicitName(record: Record<string, unknown>, address: Record<string, string>) {
  const namedetails =
    record.namedetails && typeof record.namedetails === 'object' && !Array.isArray(record.namedetails)
      ? (record.namedetails as Record<string, unknown>)
      : null

  const candidates = [
    normalizeText(record.name),
    normalizeText(namedetails?.name),
    normalizeText(namedetails?.['name:en']),
    normalizeText(address.amenity),
    normalizeText(address.shop),
    normalizeText(address.tourism),
    normalizeText(address.healthcare),
    normalizeText(address.leisure),
    normalizeText(address.office),
  ]

  return candidates.find((candidate) => isMeaningfulName(candidate)) || ''
}

function inferCategory(className: string | null, typeName: string | null) {
  const normalizedType = normalizeText(typeName)
  if (HEALTHCARE_TYPES.has(normalizedType)) return 'healthcare'
  if (FOOD_TYPES.has(normalizedType)) return 'food'
  if (TRANSPORT_TYPES.has(normalizedType)) return 'transport'
  return className
}

function buildSearchScore(result: PlaceSearchResultPayload, query: string) {
  const normalizedQuery = query.toLowerCase()
  const normalizedName = result.name.toLowerCase()
  const normalizedDisplay = result.displayName.toLowerCase()
  let score = result.importance ?? 0

  if (result.kind === 'place') score += 5
  if (normalizedName === normalizedQuery) score += 10
  else if (normalizedName.startsWith(normalizedQuery)) score += 6
  else if (normalizedName.includes(normalizedQuery)) score += 3
  if (normalizedDisplay.includes(normalizedQuery)) score += 1

  return score
}

function dedupeResults(results: PlaceSearchResultPayload[]) {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = [
      result.kind,
      result.placeId ?? 'na',
      result.osmType ?? 'na',
      result.osmId ?? 'na',
      result.name.toLowerCase(),
      result.lat.toFixed(6),
      result.lng.toFixed(6),
    ].join('::')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mapPlaceSearchResult(record: Record<string, unknown>): PlaceSearchResultPayload | null {
  const displayName = normalizeText(record.display_name)
  const lat = normalizeNumber(record.lat)
  const lng = normalizeNumber(record.lon)
  if (!displayName || lat === null || lng === null) return null

  const className = normalizeText(record.class) || null
  const typeName = normalizeText(record.type) || null
  const addressFields = normalizeAddressRecord(record.address)
  const explicitName = readExplicitName(record, addressFields)
  const isPoi = Boolean(explicitName) || (className ? POI_CLASSES.has(className) : false)
  const kind: PlaceSearchResultPayload['kind'] = isPoi ? 'place' : 'address'
  const name = explicitName || (isPoi ? displayName.split(',')[0]?.trim() || displayName : buildAddressPrimaryLabel(addressFields, displayName))

  return {
    kind,
    name,
    typeName,
    category: inferCategory(className, typeName),
    lat,
    lng,
    address: buildAddressSummary(addressFields, displayName, kind),
    displayName,
    className,
    addressFields,
    placeId: normalizeNumber(record.place_id),
    osmType: normalizeText(record.osm_type) || null,
    osmId: normalizeNumber(record.osm_id),
    importance: normalizeNumber(record.importance),
  }
}

function shouldKeepPlaceSearchResult(result: PlaceSearchResultPayload) {
  if (result.kind !== 'place') return true
  const normalizedType = normalizeText(result.typeName).toLowerCase()
  const normalizedClass = normalizeText(result.className).toLowerCase()
  if (normalizedType && LOW_SIGNAL_PLACE_TYPES.has(normalizedType)) return false
  if (normalizedClass && LOW_SIGNAL_PLACE_CLASSES.has(normalizedClass)) return false
  return true
}

type NotificationsSearchDeps = {
  CIVIL_PUBLIC_HOST: string
  NOTIFICATION_CHANNEL_PREFIX: string
  NOTIFICATION_FEED_EXCLUDED_TYPES: readonly string[]
  REDIS_URL: string
  clearUserRealtimeOnline: (userId: string, connectionId: string) => Promise<void>
  formatFriendUser: (user: any) => any
  formatNotification: (record: any) => any
  loadNotificationActor: (record: any) => Promise<any | null>
  markUserRealtimeOnline: (userId: string, connectionId: string) => Promise<void>
  normalizeSearchTerm: (value: string) => string
  resolveStreamUserId: (req: FastifyRequest) => Promise<string | null>
  searchCommunitiesForQuery: (query: string, limit: number) => Promise<any[]>
  searchCommunityPostsForQuery: (query: string, limit: number) => Promise<any[]>
  searchEventsForQuery: (input: { viewerId: string; query: string; limit: number }) => Promise<any[]>
  searchLiveSpacesForQuery: (query: string, limit: number) => Promise<any[]>
  searchMarketListingsForQuery: (query: string, limit: number) => Promise<any[]>
  searchOrganizationsForQuery: (query: string, limit: number) => Promise<any[]>
  searchVideosForQuery: (query: string, limit: number) => Promise<any[]>
  searchUsersForQuery: (input: { viewerId: string; query: string; limit: number }) => Promise<any[]>
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, handler: () => Promise<any>) => Promise<any>
}

export function registerNotificationsSearchRoutes(app: FastifyInstance, deps: NotificationsSearchDeps) {
  app.get('/notifications', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = NotificationListQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { limit, cursor } = parse.data
      await settleExpiredDriveRideEscrows()
      const baseWhere: Prisma.NotificationWhereInput = {
        userId,
        type: { notIn: [...deps.NOTIFICATION_FEED_EXCLUDED_TYPES] },
      }

      const [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: baseWhere,
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }) as any,
        prisma.notification.count({
          where: {
            userId,
            readAt: null,
            type: { notIn: [...deps.NOTIFICATION_FEED_EXCLUDED_TYPES] },
          },
        }),
      ])

      const notifications = rows as Array<{
        id: string
        type: string
        actorId: string | null
        userId: string
        payload: Prisma.JsonValue | null
        readAt: Date | null
        createdAt: Date
      }>

      const friendRequestIds = Array.from(
        new Set(
          notifications.flatMap((notification) => {
            if (notification.type !== 'friend_request') return []
            const payload = readNotificationPayloadRecord(notification.payload)
            const status = normalizeNotificationRequestStatus(payload.status)
            if (status && status !== 'pending') return []
            const friendshipId = typeof payload.friendshipId === 'string' ? payload.friendshipId.trim() : ''
            return friendshipId ? [friendshipId] : []
          }),
        ),
      )

      const connectionRequestIds = Array.from(
        new Set(
          notifications.flatMap((notification) => {
            if (notification.type !== 'connection_request') return []
            const payload = readNotificationPayloadRecord(notification.payload)
            const status = normalizeNotificationRequestStatus(payload.status)
            if (status && status !== 'pending') return []
            const connectionId = typeof payload.connectionId === 'string' ? payload.connectionId.trim() : ''
            return connectionId ? [connectionId] : []
          }),
        ),
      )

      const friendshipStates: Array<{ id: string; status: string; respondedAt: Date | null }> = friendRequestIds.length
        ? await prisma.friendship.findMany({
            where: { id: { in: friendRequestIds } },
            select: { id: true, status: true, respondedAt: true },
          })
        : []

      let connectionStates: Array<{ id: string; status: string; respondedAt: Date | null }> = []
      if (connectionRequestIds.length) {
        try {
          connectionStates = await prisma.connection.findMany({
            where: { id: { in: connectionRequestIds } },
            select: { id: true, status: true, respondedAt: true },
          })
        } catch {
          connectionStates = []
        }
      }

      const friendshipStateMap = new Map<string, { id: string; status: string; respondedAt: Date | null }>(
        friendshipStates.map((entry: { id: string; status: string; respondedAt: Date | null }) => [entry.id, entry]),
      )
      const connectionStateMap = new Map<string, { id: string; status: string; respondedAt: Date | null }>(
        connectionStates.map((entry: { id: string; status: string; respondedAt: Date | null }) => [entry.id, entry]),
      )

      const staleNotificationUpdates: Array<{
        id: string
        payload: Record<string, unknown>
        readAt: Date
      }> = []

      notifications.forEach((notification) => {
        if (notification.type !== 'friend_request' && notification.type !== 'connection_request') return

        const payload = readNotificationPayloadRecord(notification.payload)
        const currentStatus = normalizeNotificationRequestStatus(payload.status)
        if (currentStatus && currentStatus !== 'pending') return

        if (notification.type === 'friend_request') {
          const friendshipId = typeof payload.friendshipId === 'string' ? payload.friendshipId.trim() : ''
          const friendship = friendshipId ? friendshipStateMap.get(friendshipId) : null
          if (!friendship || friendship.status === 'PENDING') return
          const nextStatus = friendship.status === 'ACCEPTED' ? 'accepted' : 'rejected'
          staleNotificationUpdates.push({
            id: notification.id,
            payload: {
              ...payload,
              friendshipId,
              status: nextStatus,
              respondedAt: (friendship.respondedAt ?? notification.createdAt).toISOString(),
            },
            readAt: notification.readAt ?? friendship.respondedAt ?? new Date(),
          })
          notification.payload = {
            ...payload,
            friendshipId,
            status: nextStatus,
            respondedAt: (friendship.respondedAt ?? notification.createdAt).toISOString(),
          } as Prisma.JsonValue
          notification.readAt = notification.readAt ?? friendship.respondedAt ?? new Date()
          return
        }

        const connectionId = typeof payload.connectionId === 'string' ? payload.connectionId.trim() : ''
        const connection = connectionId ? connectionStateMap.get(connectionId) : null
        if (!connection || connection.status === 'PENDING') return
        const nextStatus = connection.status === 'ACCEPTED' ? 'accepted' : 'rejected'
        staleNotificationUpdates.push({
          id: notification.id,
          payload: {
            ...payload,
            connectionId,
            status: nextStatus,
            respondedAt: (connection.respondedAt ?? notification.createdAt).toISOString(),
          },
          readAt: notification.readAt ?? connection.respondedAt ?? new Date(),
        })
        notification.payload = {
          ...payload,
          connectionId,
          status: nextStatus,
          respondedAt: (connection.respondedAt ?? notification.createdAt).toISOString(),
        } as Prisma.JsonValue
        notification.readAt = notification.readAt ?? connection.respondedAt ?? new Date()
      })

      if (staleNotificationUpdates.length) {
        await prisma.$transaction(
          staleNotificationUpdates.map((update) =>
            prisma.notification.update({
              where: { id: update.id },
              data: {
                payload: update.payload as Prisma.InputJsonValue,
                readAt: update.readAt,
              },
            }),
          ),
        )
      }

      const actors = await Promise.all(rows.map((row: any) => deps.loadNotificationActor(row)))

      let nextCursor: string | undefined
      if (rows.length > limit) {
        const next = rows.pop()!
        nextCursor = next.id
      }

      return reply.send({
        items: rows.map((record: any, index: number) => ({
          ...deps.formatNotification(record),
          actor: actors[index] ?? null,
        })),
        nextCursor,
        unreadCount,
      })
    }),
  )

  app.get('/search/users', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = UserSearchQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { q, limit } = parse.data
      const normalizedQuery = deps.normalizeSearchTerm(q)
      if (!normalizedQuery) {
        return reply.send({ items: [] })
      }

      const results = await deps.searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit })
      return reply.send({ items: results })
    }),
  )

  app.get('/search/places', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const parse = PlaceSearchQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { q, limit, lat, lng, radiusKm } = parse.data
      const normalizedQuery = deps.normalizeSearchTerm(q)
      if (!normalizedQuery) {
        return reply.send({
          query: q,
          places: [],
          addresses: [],
          meta: {
            total: 0,
            poiCount: 0,
            hasPois: false,
          },
        })
      }

      try {
        const upstreamResponse = await fetch(
          buildNominatimSearchUrl(req, deps.CIVIL_PUBLIC_HOST, normalizedQuery, limit, {
            latitude: typeof lat === 'number' ? lat : undefined,
            longitude: typeof lng === 'number' ? lng : undefined,
            radiusKm: typeof radiusKm === 'number' ? Math.min(radiusKm, MAX_PLACE_SEARCH_RADIUS_KM) : undefined,
          }),
          {
            method: 'GET',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          },
        )

        if (!upstreamResponse.ok) {
          req.log.warn({ query: normalizedQuery, statusCode: upstreamResponse.status }, 'search_places_upstream_failed')
          return reply.send({
            query: q,
            places: [],
            addresses: [],
            meta: {
              total: 0,
              poiCount: 0,
              hasPois: false,
              unavailable: true,
            },
          })
        }

        const payload = (await upstreamResponse.json().catch(() => [])) as unknown
        const normalizedResults = Array.isArray(payload)
          ? dedupeResults(
              payload.flatMap((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
                const mapped = mapPlaceSearchResult(entry as Record<string, unknown>)
                if (!mapped || !shouldKeepPlaceSearchResult(mapped)) return []
                return [mapped]
              }),
            )
          : []

        const rankedResults = [...normalizedResults].sort((left, right) => buildSearchScore(right, normalizedQuery) - buildSearchScore(left, normalizedQuery))
        const places = rankedResults.filter((result) => result.kind === 'place')
        const addresses = rankedResults.filter((result) => result.kind === 'address')

        req.log.info({
          query: normalizedQuery,
          radiusKm: typeof radiusKm === 'number' ? Math.min(radiusKm, MAX_PLACE_SEARCH_RADIUS_KM) : null,
          totalResults: rankedResults.length,
          poiCount: places.length,
          hasPois: places.length > 0,
        }, 'search_places_completed')

        return reply.send({
          query: normalizedQuery,
          places,
          addresses,
          meta: {
            total: rankedResults.length,
            poiCount: places.length,
            hasPois: places.length > 0,
          },
        })
      } catch (error) {
        req.log.error({ err: error, query: normalizedQuery }, 'search_places_request_failed')
        return reply.send({
          query: q,
          places: [],
          addresses: [],
          meta: {
            total: 0,
            poiCount: 0,
            hasPois: false,
            unavailable: true,
          },
        })
      }
    }),
  )

  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = CombinedSearchQuery.safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { q, type, limit, peopleLimit, communityLimit, organizationLimit, eventLimit, liveLimit, marketLimit, postLimit, videoLimit } = parse.data
      const normalizedQuery = deps.normalizeSearchTerm(q)
      if (!normalizedQuery) {
        return reply.send({ people: [], communities: [], organizations: [], events: [], lives: [], market: [], posts: [], videos: [], meta: { type } })
      }

      if (type === 'people') {
        const take = limit + 1
        const peopleResults = await deps.searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit: take })
        const peopleHasMore = peopleResults.length > limit
        return reply.send({ people: peopleHasMore ? peopleResults.slice(0, limit) : peopleResults, meta: { type, peopleHasMore } })
      }

      if (type === 'communities') {
        const take = limit + 1
        const communityResults = await deps.searchCommunitiesForQuery(normalizedQuery, take)
        const communitiesHasMore = communityResults.length > limit
        return reply.send({ communities: communitiesHasMore ? communityResults.slice(0, limit) : communityResults, meta: { type, communitiesHasMore } })
      }

      if (type === 'organizations') {
        const take = limit + 1
        const organizationResults = await deps.searchOrganizationsForQuery(normalizedQuery, take)
        const organizationsHasMore = organizationResults.length > limit
        return reply.send({ organizations: organizationsHasMore ? organizationResults.slice(0, limit) : organizationResults, meta: { type, organizationsHasMore } })
      }

      if (type === 'events') {
        const take = limit + 1
        const eventResults = await deps.searchEventsForQuery({ viewerId: userId, query: normalizedQuery, limit: take })
        const eventsHasMore = eventResults.length > limit
        return reply.send({ events: eventsHasMore ? eventResults.slice(0, limit) : eventResults, meta: { type, eventsHasMore } })
      }

      if (type === 'lives') {
        const take = limit + 1
        const liveResults = await deps.searchLiveSpacesForQuery(normalizedQuery, take)
        const livesHasMore = liveResults.length > limit
        return reply.send({ lives: livesHasMore ? liveResults.slice(0, limit) : liveResults, meta: { type, livesHasMore } })
      }

      if (type === 'market') {
        const take = limit + 1
        const marketResults = await deps.searchMarketListingsForQuery(normalizedQuery, take)
        const marketHasMore = marketResults.length > limit
        return reply.send({ market: marketHasMore ? marketResults.slice(0, limit) : marketResults, meta: { type, marketHasMore } })
      }

      if (type === 'posts') {
        const take = limit + 1
        const postResults = await deps.searchCommunityPostsForQuery(normalizedQuery, take)
        const postsHasMore = postResults.length > limit
        return reply.send({ posts: postsHasMore ? postResults.slice(0, limit) : postResults, meta: { type, postsHasMore } })
      }

      if (type === 'videos') {
        const take = limit + 1
        const videoResults = await deps.searchVideosForQuery(normalizedQuery, take)
        const videosHasMore = videoResults.length > limit
        return reply.send({ videos: videosHasMore ? videoResults.slice(0, limit) : videoResults, meta: { type, videosHasMore } })
      }

      const [peopleResults, communityResults, organizationResults, eventResults, liveResults, marketResults, postResults, videoResults] = await Promise.all([
        deps.searchUsersForQuery({ viewerId: userId, query: normalizedQuery, limit: peopleLimit + 1 }),
        deps.searchCommunitiesForQuery(normalizedQuery, communityLimit + 1),
        deps.searchOrganizationsForQuery(normalizedQuery, organizationLimit + 1),
        deps.searchEventsForQuery({ viewerId: userId, query: normalizedQuery, limit: eventLimit + 1 }),
        deps.searchLiveSpacesForQuery(normalizedQuery, liveLimit + 1),
        deps.searchMarketListingsForQuery(normalizedQuery, marketLimit + 1),
        deps.searchCommunityPostsForQuery(normalizedQuery, postLimit + 1),
        deps.searchVideosForQuery(normalizedQuery, videoLimit + 1),
      ])

      const peopleHasMore = peopleResults.length > peopleLimit
      const communitiesHasMore = communityResults.length > communityLimit
      const organizationsHasMore = organizationResults.length > organizationLimit
      const eventsHasMore = eventResults.length > eventLimit
      const livesHasMore = liveResults.length > liveLimit
      const marketHasMore = marketResults.length > marketLimit
      const postsHasMore = postResults.length > postLimit
      const videosHasMore = videoResults.length > videoLimit

      return reply.send({
        people: peopleHasMore ? peopleResults.slice(0, peopleLimit) : peopleResults,
        communities: communitiesHasMore ? communityResults.slice(0, communityLimit) : communityResults,
        organizations: organizationsHasMore ? organizationResults.slice(0, organizationLimit) : organizationResults,
        events: eventsHasMore ? eventResults.slice(0, eventLimit) : eventResults,
        lives: livesHasMore ? liveResults.slice(0, liveLimit) : liveResults,
        market: marketHasMore ? marketResults.slice(0, marketLimit) : marketResults,
        posts: postsHasMore ? postResults.slice(0, postLimit) : postResults,
        videos: videosHasMore ? videoResults.slice(0, videoLimit) : videoResults,
        meta: { type, peopleHasMore, communitiesHasMore, organizationsHasMore, eventsHasMore, livesHasMore, marketHasMore, postsHasMore, videosHasMore },
      })
    }),
  )

  app.post('/notifications/ack', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = NotificationAckInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { ids, before } = parse.data
      const where: Prisma.NotificationWhereInput = { userId }
      if (ids?.length) where.id = { in: ids }
      if (before) where.createdAt = { lte: before }

      const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } })
      return reply.send({ updated: result.count })
    }),
  )

  app.get('/notifications/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = await deps.resolveStreamUserId(req)
    if (!userId) {
      req.log.warn('notifications_stream_unauthorized')
      return reply.code(401).send({ error: 'unauthorized' })
    }
    req.log.info({ userId }, 'notifications_stream_connected')
    const sub = new IORedis(deps.REDIS_URL)
    const channel = `${deps.NOTIFICATION_CHANNEL_PREFIX}${userId}`
    const connectionId = randomUUID()
    await sub.subscribe(channel)
    await deps.markUserRealtimeOnline(userId, connectionId)
    reply.sse({ data: JSON.stringify({ type: 'connected' }) })

    const heartbeat = setInterval(() => {
      void deps.markUserRealtimeOnline(userId, connectionId).catch((err) => {
        req.log.warn({ err, userId }, 'notifications_stream_presence_refresh_failed')
      })
      reply.sse({ data: JSON.stringify({ type: 'ping' }) })
    }, 30000)

    sub.on('message', (_chan: string, message: string) => {
      req.log.debug({ userId, size: message.length }, 'notifications_stream_dispatch')
      reply.sse({ data: message })
    })
    req.raw.on('close', async () => {
      clearInterval(heartbeat)
      req.log.info({ userId }, 'notifications_stream_disconnected')
      await deps.clearUserRealtimeOnline(userId, connectionId).catch((err) => {
        req.log.warn({ err, userId }, 'notifications_stream_presence_clear_failed')
      })
      await sub.unsubscribe(channel)
      sub.disconnect()
    })
  })
}
