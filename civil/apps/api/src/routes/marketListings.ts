import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { MessageType, Prisma } from '@prisma/client'
import { normalizePostalCodeInput } from '../communityGeo.js'

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
        listing_section: string | null
        listing_category: string | null
        listing_subcategory: string | null
        listing_detail: string | null
        food_safety_classification: string | null
        food_ingredients: string | null
        food_preparation_location: string | null
        food_storage_method: string | null
        food_tags: unknown
        food_expiry_date: string | null
        food_handling_instructions: string | null
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
          listing_section,
          listing_category,
          listing_subcategory,
          listing_detail,
          food_safety_classification,
          food_ingredients,
          food_preparation_location,
          food_storage_method,
          food_tags,
          food_expiry_date,
          food_handling_instructions,
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
          AND (is_active = TRUE OR status = 'sold')
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
          listingSection: row.listing_section,
          listingCategory: row.listing_category,
          listingSubcategory: row.listing_subcategory,
          listingDetail: row.listing_detail,
          foodSafetyClassification: row.food_safety_classification,
          foodIngredients: row.food_ingredients,
          foodPreparationLocation: row.food_preparation_location,
          foodStorageMethod: row.food_storage_method,
          foodTags: deps.readStringList(row.food_tags),
          foodExpiryDate: row.food_expiry_date,
          foodHandlingInstructions: row.food_handling_instructions,
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
        listing_section: string | null
        listing_category: string | null
        listing_subcategory: string | null
        listing_detail: string | null
        food_safety_classification: string | null
        food_ingredients: string | null
        food_preparation_location: string | null
        food_storage_method: string | null
        food_tags: unknown
        food_expiry_date: string | null
        food_handling_instructions: string | null
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
          listing_section,
          listing_category,
          listing_subcategory,
          listing_detail,
          food_safety_classification,
          food_ingredients,
          food_preparation_location,
          food_storage_method,
          food_tags,
          food_expiry_date,
          food_handling_instructions,
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
          listingSection: row.listing_section,
          listingCategory: row.listing_category,
          listingSubcategory: row.listing_subcategory,
          listingDetail: row.listing_detail,
          foodSafetyClassification: row.food_safety_classification,
          foodIngredients: row.food_ingredients,
          foodPreparationLocation: row.food_preparation_location,
          foodStorageMethod: row.food_storage_method,
          foodTags: deps.readStringList(row.food_tags),
          foodExpiryDate: row.food_expiry_date,
          foodHandlingInstructions: row.food_handling_instructions,
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
        listing_section: string | null
        listing_category: string | null
        listing_subcategory: string | null
        listing_detail: string | null
        food_safety_classification: string | null
        food_ingredients: string | null
        food_preparation_location: string | null
        food_storage_method: string | null
        food_tags: unknown
        food_expiry_date: string | null
        food_handling_instructions: string | null
        pickup_city: string | null
        pickup_province: string | null
        pickup_postal_code: string | null
        willing_to_deliver: boolean
        delivery_options: unknown
        payment_types: unknown
        status: string
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
          l.listing_section,
          l.listing_category,
          l.listing_subcategory,
          l.listing_detail,
          l.food_safety_classification,
          l.food_ingredients,
          l.food_preparation_location,
          l.food_storage_method,
          l.food_tags,
          l.food_expiry_date,
          l.food_handling_instructions,
          l.pickup_city,
          l.pickup_province,
          l.pickup_postal_code,
          l.willing_to_deliver,
          l.delivery_options,
          l.payment_types,
          l.status,
          l.created_at,
          l.seller_user_id,
          u.handle AS seller_handle,
          u.name AS seller_name,
          u."avatarUrl" AS seller_avatar_url,
          u."coverUrl" AS seller_cover_url
        FROM citizen_market_listing l
        INNER JOIN "User" u ON u.id = l.seller_user_id
        WHERE l.id = ${params.data.listingId}
          AND l.is_draft = FALSE
          AND l.moderation_status = ${'visible'}
          AND (
            (l.is_active = TRUE AND l.status = 'active')
            OR l.status = 'sold'
          )
        LIMIT 1
      `

      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'listing_not_found' })
      if (viewerBlockState.blockedUserIds.has(row.seller_user_id)) return reply.code(404).send({ error: 'listing_not_found' })

      let approximatePickup: { latitude: number; longitude: number; label: string } | null = null
      const normalizedPostal = normalizePostalCodeInput(row.pickup_postal_code)
      if (row.status === 'active' && normalizedPostal) {
        const pointRows = await prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
          SELECT
            COALESCE(ST_Y("pointGeom"), ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326))) AS lat,
            COALESCE(ST_X("pointGeom"), ST_X(ST_Transform(ST_SetSRID(ST_MakePoint("centroidLng", "centroidLat"), 3347), 4326))) AS lng
          FROM "ForwardSortationArea"
          WHERE "code" = ${normalizedPostal.fsa}
          LIMIT 1
        `
        const point = pointRows[0]
        if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
          const areaLabel = row.pickup_city?.trim()
            ? `Approximate pickup area near ${row.pickup_city.trim()}${row.pickup_province?.trim() ? `, ${row.pickup_province.trim()}` : ''}`
            : 'Approximate pickup area'
          approximatePickup = {
            latitude: Number(point.lat),
            longitude: Number(point.lng),
            label: areaLabel,
          }
        }
      }

      return reply.send({
        listing: {
          id: row.id,
          title: row.title,
          description: row.description,
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          photoUrls: deps.readGalleryUrls(row.photo_urls),
          listingSection: row.listing_section,
          listingCategory: row.listing_category,
          listingSubcategory: row.listing_subcategory,
          listingDetail: row.listing_detail,
          foodSafetyClassification: row.food_safety_classification,
          foodIngredients: row.food_ingredients,
          foodPreparationLocation: row.food_preparation_location,
          foodStorageMethod: row.food_storage_method,
          foodTags: deps.readStringList(row.food_tags),
          foodExpiryDate: row.food_expiry_date,
          foodHandlingInstructions: row.food_handling_instructions,
          pickupCity: row.pickup_city,
          pickupProvince: row.pickup_province,
          status: row.status,
          willingToDeliver: Boolean(row.willing_to_deliver),
          deliveryOptions: deps.readDeliveryOptions(row.delivery_options),
          paymentTypes: deps.readStringList(row.payment_types),
          approximatePickup,
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

  app.get('/market/listings/public/:listingId/nearby', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const query = (req.query ?? {}) as { lat?: string | number; lng?: string | number; limit?: string | number }
      const latitude = Number(query.lat)
      const longitude = Number(query.lng)
      const limit = Math.min(12, Math.max(1, Number(query.limit) || 6))
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return reply.send({ items: [] })

      const userId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(userId)
      const blockedUserIds = Array.from(viewerBlockState.blockedUserIds)
      await deps.ensureCitizenMarketplaceTables()

      type NearbyListingRow = {
        id: string
        title: string
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        seller_user_id: string
        distance_meters: number | null
      }

      const rows = await prisma.$queryRaw<NearbyListingRow[]>`
        WITH origin_point AS (
          SELECT ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326) AS geom
        )
        SELECT
          l.id,
          l.title,
          l.price_cents,
          l.currency,
          l.photo_urls,
          l.pickup_city,
          l.pickup_province,
          l.seller_user_id,
          ST_DistanceSphere(
            COALESCE(
              fsa."pointGeom",
              ST_Transform(ST_SetSRID(ST_MakePoint(fsa."centroidLng", fsa."centroidLat"), 3347), 4326)
            ),
            origin_point.geom
          ) AS distance_meters
        FROM citizen_market_listing l
        INNER JOIN "User" u ON u.id = l.seller_user_id
        LEFT JOIN "ForwardSortationArea" fsa
          ON fsa.code = LEFT(REGEXP_REPLACE(UPPER(COALESCE(l.pickup_postal_code, '')), '[^A-Z0-9]', '', 'g'), 3)
        CROSS JOIN origin_point
        WHERE l.id != ${params.data.listingId}
          AND l.is_active = TRUE
          AND l.is_draft = FALSE
          AND l.status = 'active'
          AND l.moderation_status = ${'visible'}
          AND fsa.code IS NOT NULL
          AND (${blockedUserIds.length ? Prisma.sql`l.seller_user_id NOT IN (${Prisma.join(blockedUserIds)})` : Prisma.sql`TRUE`})
        ORDER BY distance_meters ASC NULLS LAST, l.created_at DESC, l.id DESC
        LIMIT ${limit}
      `

      return reply.send({
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          photoUrls: deps.readGalleryUrls(row.photo_urls),
          pickupCity: row.pickup_city,
          pickupProvince: row.pickup_province,
          distanceKm: typeof row.distance_meters === 'number' && Number.isFinite(row.distance_meters) ? Number((row.distance_meters / 1000).toFixed(1)) : null,
        })),
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

      const nextDescription = 'description' in body.data ? deps.normalizeRichTextHtml(body.data.description) : null
      if ('description' in body.data) {
        const descriptionLength = deps.stripHtmlToPlainText(nextDescription ?? '').length
        if (descriptionLength > 5000) {
          return reply.code(400).send({ error: 'description_too_long' })
        }
      }

      const hasPaymentTypesUpdate = Object.prototype.hasOwnProperty.call(body.data, 'paymentTypes')
      const nextPaymentTypes = hasPaymentTypesUpdate ? Array.from(new Set(body.data.paymentTypes ?? [])) : []
      let nextETransferEmail: string | null = null

      if (hasPaymentTypesUpdate) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
        if (!user) return reply.code(401).send({ error: 'unauthorized' })

        const wallet = deps.parseCommunityMeta(user.communityMeta ?? null)?.wallet
        const walletEmail = wallet?.eTransferEmail?.trim()?.toLowerCase() ?? null
        const walletEnabled = wallet?.enabled == null ? Boolean(walletEmail) : Boolean(wallet.enabled)
        const walletMarketSharing = wallet?.sharing?.market == null ? Boolean(walletEmail) : Boolean(wallet.sharing.market)
        if (nextPaymentTypes.includes('etransfer') && !walletEmail) {
          return reply.code(400).send({ error: 'wallet_etransfer_required' })
        }
        if (nextPaymentTypes.includes('etransfer') && (!walletEnabled || !walletMarketSharing)) {
          return reply.code(400).send({ error: 'wallet_etransfer_required' })
        }
        nextETransferEmail = nextPaymentTypes.includes('etransfer') ? walletEmail : null
      }

      const hasDeliveryOptionsUpdate = Object.prototype.hasOwnProperty.call(body.data, 'deliveryOptions')
      const nextDeliveryOptions = hasDeliveryOptionsUpdate ? deps.readDeliveryOptions(body.data.deliveryOptions ?? {}) : {}

      const listingProvinceCodeProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingProvinceCode')
      const listingCommunitySlugProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingCommunitySlug')
      const listingSectionProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingSection')
      const listingCategoryProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingCategory')
      const listingSubcategoryProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingSubcategory')
      const listingDetailProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingDetail')
      const foodSafetyClassificationProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodSafetyClassification')
      const foodIngredientsProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodIngredients')
      const foodPreparationLocationProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodPreparationLocation')
      const foodStorageMethodProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodStorageMethod')
      const foodTagsProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodTags')
      const foodExpiryDateProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodExpiryDate')
      const foodHandlingInstructionsProvided = Object.prototype.hasOwnProperty.call(body.data, 'foodHandlingInstructions')
      const nextListingProvinceCode = listingProvinceCodeProvided ? (body.data.listingProvinceCode?.trim() ? body.data.listingProvinceCode.trim().toUpperCase() : null) : null
      const nextListingCommunitySlug = listingCommunitySlugProvided
        ? (body.data.listingCommunitySlug?.trim() ? body.data.listingCommunitySlug.trim().toLowerCase() : null)
        : null
      const nextListingSection = listingSectionProvided ? (body.data.listingSection?.trim() ? body.data.listingSection.trim() : null) : null
      const nextListingCategory = listingCategoryProvided ? (body.data.listingCategory?.trim() ? body.data.listingCategory.trim() : null) : null
      const nextListingSubcategory = listingSubcategoryProvided
        ? (body.data.listingSubcategory?.trim() ? body.data.listingSubcategory.trim() : null)
        : null
      const nextListingDetail = listingDetailProvided ? (body.data.listingDetail?.trim() ? body.data.listingDetail.trim() : null) : null
      const nextFoodSafetyClassification = foodSafetyClassificationProvided ? body.data.foodSafetyClassification ?? null : null
      const nextFoodIngredients = foodIngredientsProvided ? (body.data.foodIngredients?.trim() ? body.data.foodIngredients.trim() : null) : null
      const nextFoodPreparationLocation = foodPreparationLocationProvided ? body.data.foodPreparationLocation ?? null : null
      const nextFoodStorageMethod = foodStorageMethodProvided ? body.data.foodStorageMethod ?? null : null
      const nextFoodTags = foodTagsProvided ? (Array.isArray(body.data.foodTags) ? body.data.foodTags : []) : []
      const nextFoodExpiryDate = foodExpiryDateProvided ? (body.data.foodExpiryDate?.trim() ? body.data.foodExpiryDate.trim() : null) : null
      const nextFoodHandlingInstructions = foodHandlingInstructionsProvided
        ? (body.data.foodHandlingInstructions?.trim() ? body.data.foodHandlingInstructions.trim() : null)
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
            listing_section = CASE WHEN ${listingSectionProvided} THEN ${nextListingSection} ELSE listing_section END,
            listing_category = CASE WHEN ${listingCategoryProvided} THEN ${nextListingCategory} ELSE listing_category END,
            listing_subcategory = CASE WHEN ${listingSubcategoryProvided} THEN ${nextListingSubcategory} ELSE listing_subcategory END,
            listing_detail = CASE WHEN ${listingDetailProvided} THEN ${nextListingDetail} ELSE listing_detail END,
            food_safety_classification = CASE WHEN ${foodSafetyClassificationProvided} THEN ${nextFoodSafetyClassification} ELSE food_safety_classification END,
            food_ingredients = CASE WHEN ${foodIngredientsProvided} THEN ${nextFoodIngredients} ELSE food_ingredients END,
            food_preparation_location = CASE WHEN ${foodPreparationLocationProvided} THEN ${nextFoodPreparationLocation} ELSE food_preparation_location END,
            food_storage_method = CASE WHEN ${foodStorageMethodProvided} THEN ${nextFoodStorageMethod} ELSE food_storage_method END,
            food_tags = CASE WHEN ${foodTagsProvided} THEN ${JSON.stringify(nextFoodTags)}::jsonb ELSE food_tags END,
            food_expiry_date = CASE WHEN ${foodExpiryDateProvided} THEN ${nextFoodExpiryDate} ELSE food_expiry_date END,
            food_handling_instructions = CASE WHEN ${foodHandlingInstructionsProvided} THEN ${nextFoodHandlingInstructions} ELSE food_handling_instructions END,
            payment_types = CASE WHEN ${hasPaymentTypesUpdate} THEN ${JSON.stringify(nextPaymentTypes)}::jsonb ELSE payment_types END,
            willing_to_deliver = COALESCE(${typeof body.data.willingToDeliver === 'boolean' ? body.data.willingToDeliver : null}, willing_to_deliver),
            delivery_options = CASE WHEN ${hasDeliveryOptionsUpdate} THEN ${JSON.stringify(nextDeliveryOptions)}::jsonb ELSE delivery_options END,
            e_transfer_email = CASE WHEN ${hasPaymentTypesUpdate} THEN ${nextETransferEmail} ELSE e_transfer_email END,
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

  app.post('/market/listings/:listingId/remove', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      try {
        const userId = (await deps.resolveUserId(req)) ?? undefined
        if (!userId) return reply.code(401).send({ error: 'unauthorized' })

        const params = deps.MarketListingParams.safeParse(req.params)
        if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
        const body = deps.MarketListingRemoveBody.safeParse(req.body ?? {})
        if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

        await deps.ensureCitizenMarketplaceTables()

        const listingRows = await prisma.$queryRaw<Array<{ id: string; status: string; seller_user_id: string; is_active: boolean; moderation_status: string }>>`
          SELECT id, status, seller_user_id, is_active, moderation_status
          FROM citizen_market_listing
          WHERE id = ${params.data.listingId}
          LIMIT 1
        `

        const listing = listingRows[0]
        if (!listing || !listing.is_active) return reply.code(404).send({ error: 'listing_not_found' })
        if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })
        if (!deps.isVisibleModerationStatus(listing.moderation_status)) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_LISTING') })
        }

        const resolution = body.data.resolution === 'sold' ? 'sold' : 'deleted'
        const nextStatus = resolution === 'sold' ? 'sold' : 'canceled'
        const buyerMessageBody = deps.sanitizePlainText(resolution === 'sold' ? 'This item is now sold' : 'This item has been deleted').trim()

        const updatedRows = await prisma.$queryRaw<Array<{ id: string }>>`
          UPDATE citizen_market_listing
          SET status = ${nextStatus},
              is_active = FALSE,
              is_draft = FALSE,
              selected_buyer_user_id = CASE WHEN ${resolution === 'sold'} THEN selected_buyer_user_id ELSE NULL END,
              updated_at = NOW()
          WHERE id = ${listing.id}
            AND seller_user_id = ${userId}
            AND is_active = TRUE
          RETURNING id
        `

        if (!updatedRows[0]) {
          return reply.code(409).send({ error: 'listing_not_found' })
        }

        const createdMessages: Array<{ threadId: string; record: any; participants: Array<{ userId: string; mutedUntil: Date | null }> }> = []
        try {
          const threads = await prisma.messageThread.findMany({
            where: {
              contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
              contextId: listing.id,
              participants: { some: { userId } },
            },
            select: {
              id: true,
              participants: { select: { userId: true, mutedUntil: true } },
            },
            orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
            take: 200,
          })

          const createdMessageResults = await Promise.allSettled(
            threads.map(async (thread) => {
              const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const message = await tx.message.create({
                  data: {
                    threadId: thread.id,
                    senderId: userId,
                    body: buyerMessageBody || null,
                    messageType: MessageType.text,
                  },
                  select: deps.MESSAGE_SELECT,
                })

                await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: message.createdAt } })
                await tx.messageParticipant.updateMany({
                  where: { threadId: thread.id, userId },
                  data: { lastReadAt: message.createdAt, lastActivityAt: message.createdAt },
                })
                await tx.messageParticipant.updateMany({
                  where: { threadId: thread.id, userId: { not: userId } },
                  data: { lastActivityAt: message.createdAt },
                })

                return message
              })

              return { threadId: thread.id, record: created, participants: thread.participants }
            }),
          )

          for (const [index, result] of createdMessageResults.entries()) {
            if (result.status === 'fulfilled') {
              createdMessages.push(result.value)
              continue
            }

            console.error('market_listing_remove_thread_message_failed', {
              listingId: listing.id,
              threadId: threads[index]?.id ?? null,
              resolution,
              error: result.reason,
            })
          }
        } catch (error) {
          console.error('market_listing_remove_threads_load_failed', {
            listingId: listing.id,
            resolution,
            error,
          })
        }

        const realtimeResults = await Promise.allSettled(
          createdMessages.flatMap((entry) =>
            entry.participants.map((participant) =>
              deps.dispatchRealtimeEvent(participant.userId, {
                type: 'message.created',
                data: { threadId: entry.threadId, message: deps.formatMessage(entry.record, participant.userId) },
              }),
            ),
          ),
        )

        for (const result of realtimeResults) {
          if (result.status === 'rejected') {
            console.error('market_listing_remove_realtime_failed', result.reason)
          }
        }

        if (resolution === 'sold') {
          const pushResults = await Promise.allSettled(
            createdMessages.map((entry) =>
              deps.sendMobilePushForMessageCreated({
                threadId: entry.threadId,
                message: entry.record,
                participants: entry.participants,
                pushUrl: `/messages?inbox=market&thread=${encodeURIComponent(entry.threadId)}`,
              }),
            ),
          )

          for (const result of pushResults) {
            if (result.status === 'rejected') {
              console.error('market_listing_remove_push_failed', result.reason)
            }
          }
        }

        return reply.send({ success: true, resolution, status: nextStatus })
      } catch (error) {
        req.log.error({ err: error }, 'market_listing_remove_failed')
        const payload: Record<string, unknown> = { error: 'market_listing_remove_failed' }
        if (process.env.NODE_ENV !== 'production') {
          payload.detail = error instanceof Error ? error.message : String(error)
        }
        return reply.code(500).send(payload)
      }
    }),
  )
}