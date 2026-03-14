import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'

type MarketListingDeps = Record<string, any>

export function registerMarketListingRoutes(app: FastifyInstance, deps: MarketListingDeps) {
  app.post('/market/listings/draft', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      await deps.ensureCitizenMarketplaceTables()

      const userScopeFollows = await deps.readViewerCommunityFollows(userId)
      const listingScope = userScopeFollows[0] ?? null

      const listingId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO citizen_market_listing (
          id,
          seller_user_id,
          title,
          description,
          price_cents,
          currency,
          photo_urls,
          listing_province_code,
          listing_community_slug,
          payment_types,
          willing_to_deliver,
          delivery_options,
          status,
          is_draft,
          is_active,
          created_by
        )
        VALUES (
          ${listingId},
          ${userId},
          ${'Draft Listing'},
          ${null},
          ${0},
          ${'CAD'},
          ${JSON.stringify([])}::jsonb,
          ${listingScope?.provinceCode ?? null},
          ${listingScope?.communitySlug ?? null},
          ${JSON.stringify(['cash_pickup'])}::jsonb,
          ${false},
          ${JSON.stringify({})}::jsonb,
          ${'draft'},
          ${true},
          ${true},
          ${userId}
        )
      `

      return reply.code(201).send({ listing: { id: listingId, isDraft: true } })
    }),
  )

  app.get('/market/listings/mine', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = deps.MarketListingsQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      await deps.ensureCitizenMarketplaceTables()

      type ListingRow = {
        id: string
        title: string
        description: string | null
        price_cents: number
        currency: string
        photo_urls: unknown
        listing_province_code: string | null
        listing_community_slug: string | null
        pickup_city: string | null
        pickup_province: string | null
        payment_types: unknown
        willing_to_deliver: boolean
        delivery_options: unknown
        status: string
        is_draft: boolean
        updated_at: Date
        created_at: Date
      }

      const rows = await prisma.$queryRaw<ListingRow[]>`
        SELECT
          id,
          title,
          description,
          price_cents,
          currency,
          photo_urls,
          listing_province_code,
          listing_community_slug,
          pickup_city,
          pickup_province,
          payment_types,
          willing_to_deliver,
          delivery_options,
          status,
          is_draft,
          updated_at,
          created_at
        FROM citizen_market_listing
        WHERE seller_user_id = ${userId}
          AND is_active = TRUE
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ${query.data.limit}
      `

      return reply.send({
        items: rows.map((row: ListingRow) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          photoUrls: deps.readGalleryUrls(row.photo_urls),
          listingProvinceCode: row.listing_province_code,
          listingCommunitySlug: row.listing_community_slug,
          pickupCity: row.pickup_city,
          pickupProvince: row.pickup_province,
          paymentTypes: deps.readStringList(row.payment_types),
          willingToDeliver: Boolean(row.willing_to_deliver),
          deliveryOptions: deps.readDeliveryOptions(row.delivery_options),
          status: row.status,
          isDraft: Boolean(row.is_draft),
          updatedAt: row.updated_at.toISOString(),
          createdAt: row.created_at.toISOString(),
        })),
      })
    }),
  )

  app.get('/market/listings/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()

      type ListingDetailRow = {
        id: string
        title: string
        description: string | null
        price_cents: number
        currency: string
        photo_urls: unknown
        listing_province_code: string | null
        listing_community_slug: string | null
        pickup_city: string | null
        pickup_province: string | null
        pickup_address_line1: string | null
        pickup_address_line2: string | null
        pickup_postal_code: string | null
        payment_types: unknown
        willing_to_deliver: boolean
        delivery_options: unknown
        e_transfer_email: string | null
        status: string
        is_draft: boolean
        updated_at: Date
        created_at: Date
      }

      const rows = await prisma.$queryRaw<ListingDetailRow[]>`
        SELECT
          id,
          title,
          description,
          price_cents,
          currency,
          photo_urls,
          listing_province_code,
          listing_community_slug,
          pickup_city,
          pickup_province,
          pickup_address_line1,
          pickup_address_line2,
          pickup_postal_code,
          payment_types,
          willing_to_deliver,
          delivery_options,
          e_transfer_email,
          status,
          is_draft,
          updated_at,
          created_at
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
          AND seller_user_id = ${userId}
          AND is_active = TRUE
        LIMIT 1
      `

      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'listing_not_found' })

      return reply.send({
        listing: {
          id: row.id,
          title: row.title,
          description: row.description,
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          photoUrls: deps.readGalleryUrls(row.photo_urls),
          listingProvinceCode: row.listing_province_code,
          listingCommunitySlug: row.listing_community_slug,
          pickupCity: row.pickup_city,
          pickupProvince: row.pickup_province,
          pickupAddressLine1: row.pickup_address_line1,
          pickupAddressLine2: row.pickup_address_line2,
          pickupPostalCode: row.pickup_postal_code,
          paymentTypes: deps.readStringList(row.payment_types),
          willingToDeliver: Boolean(row.willing_to_deliver),
          deliveryOptions: deps.readDeliveryOptions(row.delivery_options),
          eTransferEmail: row.e_transfer_email,
          status: row.status,
          isDraft: Boolean(row.is_draft),
          updatedAt: row.updated_at.toISOString(),
          createdAt: row.created_at.toISOString(),
        },
      })
    }),
  )

  app.get('/market/listings/public/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const userId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(userId)
      await deps.ensureCitizenMarketplaceTables()

      type PublicListingRow = {
        id: string
        title: string
        description: string | null
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        willing_to_deliver: boolean
        delivery_options: unknown
        payment_types: unknown
        created_at: Date
        seller_user_id: string
        seller_handle: string | null
        seller_name: string | null
        seller_avatar_url: string | null
        seller_cover_url: string | null
      }

      const rows = await prisma.$queryRaw<PublicListingRow[]>`
        SELECT
          l.id,
          l.title,
          l.description,
          l.price_cents,
          l.currency,
          l.photo_urls,
          l.pickup_city,
          l.pickup_province,
          l.willing_to_deliver,
          l.delivery_options,
          l.payment_types,
          l.created_at,
          l.seller_user_id,
          u.handle AS seller_handle,
          u.name AS seller_name,
          u."avatarUrl" AS seller_avatar_url,
          u."coverUrl" AS seller_cover_url
        FROM citizen_market_listing l
        INNER JOIN "User" u ON u.id = l.seller_user_id
        WHERE l.id = ${params.data.listingId}
          AND l.is_active = TRUE
          AND l.is_draft = FALSE
          AND l.status = 'active'
          AND l.moderation_status = ${'visible'}
        LIMIT 1
      `

      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'listing_not_found' })
      if (viewerBlockState.blockedUserIds.has(row.seller_user_id)) return reply.code(404).send({ error: 'listing_not_found' })

      return reply.send({
        listing: {
          id: row.id,
          title: row.title,
          description: row.description,
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          photoUrls: deps.readGalleryUrls(row.photo_urls),
          pickupCity: row.pickup_city,
          pickupProvince: row.pickup_province,
          willingToDeliver: Boolean(row.willing_to_deliver),
          deliveryOptions: deps.readDeliveryOptions(row.delivery_options),
          paymentTypes: deps.readStringList(row.payment_types),
          createdAt: row.created_at.toISOString(),
          seller: {
            id: row.seller_user_id,
            handle: row.seller_handle,
            name: row.seller_name,
            avatarUrl: deps.normalizeMediaUrl(row.seller_avatar_url),
            coverUrl: deps.normalizeMediaUrl(row.seller_cover_url),
          },
        },
      })
    }),
  )

  app.put('/market/listings/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.MarketListingUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await deps.ensureCitizenMarketplaceTables()

      const listingRows = await prisma.$queryRaw<Array<{ id: string; moderation_status: string }>>`
        SELECT id, moderation_status
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
          AND seller_user_id = ${userId}
          AND is_active = TRUE
        LIMIT 1
      `
      if (!listingRows[0]) return reply.code(404).send({ error: 'listing_not_found' })
      if (!deps.isVisibleModerationStatus(listingRows[0].moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_LISTING') })
      }

      const nextDescription =
        'description' in body.data ? (body.data.description?.trim() ? deps.sanitizePlainText(body.data.description).trim() : null) : null

      const eTransferProvided = Object.prototype.hasOwnProperty.call(body.data, 'eTransferEmail')
      const nextETransferEmail = eTransferProvided ? (body.data.eTransferEmail?.trim() ? body.data.eTransferEmail.trim() : null) : null

      const hasPaymentTypesUpdate = Object.prototype.hasOwnProperty.call(body.data, 'paymentTypes')
      const nextPaymentTypes = hasPaymentTypesUpdate ? Array.from(new Set(body.data.paymentTypes ?? [])) : []

      const hasDeliveryOptionsUpdate = Object.prototype.hasOwnProperty.call(body.data, 'deliveryOptions')
      const nextDeliveryOptions = hasDeliveryOptionsUpdate ? deps.readDeliveryOptions(body.data.deliveryOptions ?? {}) : {}

      const listingProvinceCodeProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingProvinceCode')
      const listingCommunitySlugProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingCommunitySlug')
      const nextListingProvinceCode = listingProvinceCodeProvided ? (body.data.listingProvinceCode?.trim() ? body.data.listingProvinceCode.trim().toUpperCase() : null) : null
      const nextListingCommunitySlug = listingCommunitySlugProvided
        ? (body.data.listingCommunitySlug?.trim() ? body.data.listingCommunitySlug.trim().toLowerCase() : null)
        : null

      const hasStatusUpdate = Object.prototype.hasOwnProperty.call(body.data, 'status')
      const hasDraftUpdate = Object.prototype.hasOwnProperty.call(body.data, 'isDraft')
      const nextStatus = hasStatusUpdate ? body.data.status : null
      const nextIsDraft = hasDraftUpdate ? body.data.isDraft : null

      const viewerScopeFollows = await deps.readViewerCommunityFollows(userId)
      const viewerScope = viewerScopeFollows[0] ?? null

      await prisma.$executeRaw`
        UPDATE citizen_market_listing
        SET title = COALESCE(${body.data.title?.trim() ?? null}, title),
            description = CASE WHEN ${'description' in body.data} THEN ${nextDescription} ELSE description END,
            price_cents = COALESCE(${body.data.priceCents ?? null}, price_cents),
            currency = COALESCE(${body.data.currency?.toUpperCase() ?? null}, currency),
            photo_urls = CASE
              WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'photoUrls')} THEN ${JSON.stringify(body.data.photoUrls ?? [])}::jsonb
              ELSE photo_urls
            END,
            pickup_city = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupCity')} THEN ${body.data.pickupCity ?? null} ELSE pickup_city END,
            pickup_province = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupProvince')} THEN ${body.data.pickupProvince ?? null} ELSE pickup_province END,
            pickup_address_line1 = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupAddressLine1')} THEN ${body.data.pickupAddressLine1 ?? null} ELSE pickup_address_line1 END,
            pickup_address_line2 = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupAddressLine2')} THEN ${body.data.pickupAddressLine2 ?? null} ELSE pickup_address_line2 END,
            pickup_postal_code = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'pickupPostalCode')} THEN ${body.data.pickupPostalCode ?? null} ELSE pickup_postal_code END,
            listing_province_code = CASE
              WHEN ${listingProvinceCodeProvided} THEN ${nextListingProvinceCode}
              ELSE COALESCE(listing_province_code, ${viewerScope?.provinceCode ?? null})
            END,
            listing_community_slug = CASE
              WHEN ${listingCommunitySlugProvided} THEN ${nextListingCommunitySlug}
              ELSE COALESCE(listing_community_slug, ${viewerScope?.communitySlug ?? null})
            END,
            payment_types = CASE WHEN ${hasPaymentTypesUpdate} THEN ${JSON.stringify(nextPaymentTypes)}::jsonb ELSE payment_types END,
            willing_to_deliver = COALESCE(${typeof body.data.willingToDeliver === 'boolean' ? body.data.willingToDeliver : null}, willing_to_deliver),
            delivery_options = CASE WHEN ${hasDeliveryOptionsUpdate} THEN ${JSON.stringify(nextDeliveryOptions)}::jsonb ELSE delivery_options END,
            e_transfer_email = CASE WHEN ${eTransferProvided} THEN ${nextETransferEmail} ELSE e_transfer_email END,
            status = CASE WHEN ${hasStatusUpdate} THEN ${nextStatus} ELSE status END,
            is_draft = CASE WHEN ${hasDraftUpdate} THEN ${nextIsDraft} ELSE is_draft END,
            updated_at = NOW()
        WHERE id = ${params.data.listingId}
      `

      void deps.enqueueContentAiScanForMarketListing(params.data.listingId).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_listing_failed', error)
      })

      return reply.send({ success: true })
    }),
  )
}