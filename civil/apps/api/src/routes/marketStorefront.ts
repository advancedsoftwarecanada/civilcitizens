import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type MarketStorefrontDeps = Record<string, any>

export function registerMarketStorefrontRoutes(app: FastifyInstance, deps: MarketStorefrontDeps) {
  app.get('/market/feed', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = deps.MarketProductsQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const userId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(userId)
      const blockedUserIds = Array.from(viewerBlockState.blockedUserIds)
      const blockedBusinessIds = Array.from(viewerBlockState.blockedBusinessIds)
      await Promise.all([deps.ensureOrganizationShopTables(), deps.ensureCitizenMarketplaceTables()])

      const follows = userId ? await deps.readViewerCommunityFollows(userId) : []
      const useCommunityScope = follows.length > 0
      const provinceCodes = Array.from(new Set(follows.map((entry: { provinceCode: string }) => entry.provinceCode)))
      const communitySlugs = Array.from(new Set(follows.map((entry: { communitySlug: string }) => entry.communitySlug)))

      type OrgFeedRow = {
        id: string
        business_id: string
        business_name: string
        business_slug: string
        province_code: string | null
        community_slug: string | null
        business_logo_url: string | null
        business_cover_url: string | null
        name: string
        description: string | null
        price_cents: number
        currency: string
        primary_image_url: string | null
        gallery_image_urls: unknown
        created_at: Date
      }

      const orgRows: OrgFeedRow[] = await prisma.$queryRaw<OrgFeedRow[]>`
        SELECT
          p.id,
          p.business_id,
          b.name AS business_name,
          b.slug AS business_slug,
          b."provinceCode" AS province_code,
          b."communitySlug" AS community_slug,
          b."logoUrl" AS business_logo_url,
          b."coverUrl" AS business_cover_url,
          p.name,
          p.description,
          p.price_cents,
          p.currency,
          p.primary_image_url,
          p.gallery_image_urls,
          p.created_at
        FROM organization_shop_product p
        INNER JOIN "Business" b ON b.id = p.business_id
        LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
        WHERE p.is_active = TRUE
          AND p.is_draft = FALSE
          AND p.moderation_status = ${'visible'}
          AND b.status = 'ACTIVE'
          AND b."moderationStatus" = CAST(${deps.ModerationStatus.VISIBLE} AS "ModerationStatus")
          AND (${blockedBusinessIds.length ? Prisma.sql`p.business_id NOT IN (${Prisma.join(blockedBusinessIds)})` : Prisma.sql`TRUE`})
          AND (${useCommunityScope ? Prisma.sql`(UPPER(COALESCE(b."provinceCode", '')) IN (${Prisma.join(provinceCodes)}) AND LOWER(COALESCE(b."communitySlug", '')) IN (${Prisma.join(communitySlugs)}))` : Prisma.sql`TRUE`})
          AND (p.catalog_id IS NULL OR c.enabled = TRUE)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${query.data.limit * 2}
      `

      type CitizenFeedRow = {
        id: string
        title: string
        description: string | null
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        created_at: Date
        seller_user_id: string
        seller_handle: string | null
        seller_name: string | null
        seller_avatar_url: string | null
        seller_cover_url: string | null
      }

      const citizenRows: CitizenFeedRow[] = await prisma.$queryRaw<CitizenFeedRow[]>`
        SELECT
          l.id,
          l.title,
          l.description,
          l.price_cents,
          l.currency,
          l.photo_urls,
          l.pickup_city,
          l.pickup_province,
          l.created_at,
          l.seller_user_id,
          u.handle AS seller_handle,
          u.name AS seller_name,
          u."avatarUrl" AS seller_avatar_url,
          u."coverUrl" AS seller_cover_url
        FROM citizen_market_listing l
        INNER JOIN "User" u ON u.id = l.seller_user_id
        LEFT JOIN LATERAL (
          SELECT cf."provinceCode", cf."communitySlug"
          FROM "CommunityFollow" cf
          WHERE cf."userId" = l.seller_user_id
          ORDER BY cf.home DESC, cf."createdAt" DESC
          LIMIT 1
        ) cf_scope ON TRUE
        WHERE l.is_active = TRUE
          AND l.is_draft = FALSE
          AND l.status = 'active'
          AND l.moderation_status = ${'visible'}
          AND (${blockedUserIds.length ? Prisma.sql`l.seller_user_id NOT IN (${Prisma.join(blockedUserIds)})` : Prisma.sql`TRUE`})
          AND (${useCommunityScope
            ? Prisma.sql`((UPPER(COALESCE(l.listing_province_code, cf_scope."provinceCode", '')) IN (${Prisma.join(provinceCodes)}) AND LOWER(COALESCE(l.listing_community_slug, cf_scope."communitySlug", '')) IN (${Prisma.join(communitySlugs)})) OR l.seller_user_id = ${userId})`
            : Prisma.sql`TRUE`})
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${query.data.limit * 2}
      `

      const merged = [
        ...orgRows.map((row) => ({
          createdAtMs: row.created_at.getTime(),
          id: row.id,
          payload: {
            id: row.id,
            kind: 'organization_product' as const,
            title: row.name,
            description: row.description,
            priceCents: Number(row.price_cents) || 0,
            currency: row.currency,
            primaryImageUrl: row.primary_image_url,
            galleryImageUrls: deps.readGalleryUrls(row.gallery_image_urls),
            createdAt: row.created_at.toISOString(),
            organization: {
              id: row.business_id,
              name: row.business_name,
              slug: row.business_slug,
              province: row.province_code?.toLowerCase() ?? null,
              municipality: row.community_slug ?? null,
              logoUrl: deps.normalizeMediaUrl(row.business_logo_url),
              coverUrl: deps.normalizeMediaUrl(row.business_cover_url),
            },
          },
        })),
        ...citizenRows.map((row) => {
          const photoUrls = deps.readGalleryUrls(row.photo_urls)
          return {
            createdAtMs: row.created_at.getTime(),
            id: row.id,
            payload: {
              id: row.id,
              kind: 'citizen_listing' as const,
              title: row.title,
              description: row.description,
              priceCents: Number(row.price_cents) || 0,
              currency: row.currency,
              primaryImageUrl: photoUrls[0] ?? null,
              galleryImageUrls: photoUrls,
              createdAt: row.created_at.toISOString(),
              pickupCity: row.pickup_city,
              pickupProvince: row.pickup_province,
              seller: {
                id: row.seller_user_id,
                handle: row.seller_handle,
                name: row.seller_name,
                avatarUrl: deps.normalizeMediaUrl(row.seller_avatar_url),
                coverUrl: deps.normalizeMediaUrl(row.seller_cover_url),
              },
            },
          }
        }),
      ]
        .sort((a, b) => {
          if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs
          return b.id.localeCompare(a.id)
        })
        .slice(0, query.data.limit)
        .map((entry) => entry.payload)

      return reply.send({ items: merged, nextCursor: null })
    }),
  )

  app.get('/market/products', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = deps.MarketProductsQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const cursor = deps.parseMarketCursor(query.data.cursor)
      const userId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(userId)
      const blockedBusinessIds = Array.from(viewerBlockState.blockedBusinessIds)
      await deps.ensureOrganizationShopTables()

      type MarketProductRow = {
        id: string
        business_id: string
        business_name: string
        business_slug: string
        province_code: string | null
        community_slug: string | null
        business_logo_url: string | null
        business_cover_url: string | null
        name: string
        description: string | null
        price_cents: number
        currency: string
        primary_image_url: string | null
        gallery_image_urls: unknown
        fulfillment_type: string
        created_at: Date
      }

      const rows: MarketProductRow[] = await prisma.$queryRaw<MarketProductRow[]>`
        SELECT
          p.id,
          p.business_id,
          b.name AS business_name,
          b.slug AS business_slug,
          b."provinceCode" AS province_code,
          b."communitySlug" AS community_slug,
          b."logoUrl" AS business_logo_url,
          b."coverUrl" AS business_cover_url,
          p.name,
          p.description,
          p.price_cents,
          p.currency,
          p.primary_image_url,
          p.gallery_image_urls,
          p.fulfillment_type,
          p.created_at
        FROM organization_shop_product p
        INNER JOIN "Business" b ON b.id = p.business_id
        LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
        WHERE p.is_active = TRUE
          AND p.is_draft = FALSE
          AND p.moderation_status = ${'visible'}
          AND b.status = 'ACTIVE'
          AND b."moderationStatus" = CAST(${deps.ModerationStatus.VISIBLE} AS "ModerationStatus")
          AND (${blockedBusinessIds.length ? Prisma.sql`p.business_id NOT IN (${Prisma.join(blockedBusinessIds)})` : Prisma.sql`TRUE`})
          AND (p.catalog_id IS NULL OR c.enabled = TRUE)
          AND (${cursor ? Prisma.sql`(p.created_at < ${cursor.createdAt} OR (p.created_at = ${cursor.createdAt} AND p.id < ${cursor.id}))` : Prisma.sql`TRUE`})
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${query.data.limit + 1}
      `

      const pageRows = rows.slice(0, query.data.limit)
      const nextCursor = rows.length > query.data.limit ? `${pageRows[pageRows.length - 1]!.created_at.toISOString()}|${pageRows[pageRows.length - 1]!.id}` : null

      const items = pageRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        priceCents: Number(row.price_cents) || 0,
        currency: row.currency,
        primaryImageUrl: row.primary_image_url,
        galleryImageUrls: deps.readGalleryUrls(row.gallery_image_urls),
        fulfillmentType: row.fulfillment_type,
        createdAt: row.created_at.toISOString(),
        organization: {
          id: row.business_id,
          name: row.business_name,
          slug: row.business_slug,
          province: row.province_code?.toLowerCase() ?? null,
          municipality: row.community_slug ?? null,
          logoUrl: deps.normalizeMediaUrl(row.business_logo_url),
          coverUrl: deps.normalizeMediaUrl(row.business_cover_url),
        },
      }))

      return reply.send({ items, nextCursor })
    }),
  )

  app.get('/market/products/:productId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.MarketProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const userId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(userId)
      await deps.ensureOrganizationShopTables()

      type MarketProductDetailRow = {
        id: string
        business_id: string
        business_name: string
        business_slug: string
        province_code: string | null
        community_slug: string | null
        business_logo_url: string | null
        business_cover_url: string | null
        name: string
        description: string | null
        tax_collect: boolean
        tax_rates_by_region: unknown
        price_cents: number
        currency: string
        sku: string | null
        primary_image_url: string | null
        gallery_image_urls: unknown
        weight_grams: number | null
        shipping_policy: string
        allow_shipping_contracts: boolean
        track_inventory: boolean
        fulfillment_type: string
        inventory_total: bigint | number | null
        created_at: Date
        updated_at: Date
      }

      const rows = await prisma.$queryRaw<MarketProductDetailRow[]>`
        SELECT
          p.id,
          p.business_id,
          b.name AS business_name,
          b.slug AS business_slug,
          b."provinceCode" AS province_code,
          b."communitySlug" AS community_slug,
          b."logoUrl" AS business_logo_url,
          b."coverUrl" AS business_cover_url,
          p.name,
          p.description,
          p.tax_collect,
          p.tax_rates_by_region,
          p.price_cents,
          p.currency,
          p.sku,
          p.primary_image_url,
          p.gallery_image_urls,
          p.weight_grams,
          p.shipping_policy,
          p.allow_shipping_contracts,
          p.track_inventory,
          p.fulfillment_type,
          COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total,
          p.created_at,
          p.updated_at
        FROM organization_shop_product p
        INNER JOIN "Business" b ON b.id = p.business_id
        LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
        LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
        WHERE p.id = ${params.data.productId}
          AND p.is_active = TRUE
          AND p.is_draft = FALSE
          AND p.moderation_status = ${'visible'}
          AND b.status = 'ACTIVE'
          AND b."moderationStatus" = CAST(${deps.ModerationStatus.VISIBLE} AS "ModerationStatus")
          AND (p.catalog_id IS NULL OR c.enabled = TRUE)
        GROUP BY p.id, b.id
        LIMIT 1
      `

      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'product_not_found' })
      if (viewerBlockState.blockedBusinessIds.has(row.business_id)) return reply.code(404).send({ error: 'product_not_found' })

      return reply.send({
        product: {
          id: row.id,
          name: row.name,
          description: row.description,
          taxCollect: row.tax_collect,
          taxRatesByRegion: row.tax_rates_by_region && typeof row.tax_rates_by_region === 'object' && !Array.isArray(row.tax_rates_by_region)
            ? (row.tax_rates_by_region as Record<string, unknown>)
            : {},
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          sku: row.sku,
          primaryImageUrl: row.primary_image_url,
          galleryImageUrls: deps.readGalleryUrls(row.gallery_image_urls),
          fulfillmentType: row.fulfillment_type,
          weightGrams: row.weight_grams,
          shippingPolicy: row.shipping_policy,
          allowShippingContracts: row.allow_shipping_contracts,
          trackInventory: row.track_inventory,
          inventoryTotal: Number(row.inventory_total ?? 0) || 0,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        },
        organization: {
          id: row.business_id,
          name: row.business_name,
          slug: row.business_slug,
          province: row.province_code?.toLowerCase() ?? null,
          municipality: row.community_slug ?? null,
          logoUrl: deps.normalizeMediaUrl(row.business_logo_url),
          coverUrl: deps.normalizeMediaUrl(row.business_cover_url),
        },
      })
    }),
  )

  app.get('/market/account/shipping-addresses', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const user = await prisma.user.findUnique({
        where: { id: buyerId },
        select: { communityMeta: true },
      })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const items = deps.readMarketShippingAddresses(user.communityMeta)
      return reply.send({ items })
    }),
  )

  app.post('/market/account/shipping-addresses', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.MarketShippingAddressBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const user = await prisma.user.findUnique({
        where: { id: buyerId },
        select: { communityMeta: true },
      })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const nowIso = new Date().toISOString()
      const existing = deps.readMarketShippingAddresses(user.communityMeta)
      const addressId = body.data.id?.trim() || randomUUID()
      const nextItem = {
        id: addressId,
        label: body.data.label?.trim() || null,
        name: body.data.name?.trim() || null,
        line1: body.data.line1.trim(),
        line2: body.data.line2?.trim() || null,
        city: body.data.city.trim(),
        province: body.data.province.trim().toUpperCase(),
        postalCode: body.data.postalCode.trim().toUpperCase(),
        originalPostalCode: body.data.originalPostalCode?.trim().toUpperCase() || null,
        country: body.data.country.trim().toUpperCase() || 'CA',
        latitude: typeof body.data.latitude === 'number' ? body.data.latitude : null,
        longitude: typeof body.data.longitude === 'number' ? body.data.longitude : null,
        nominatimDisplayName: body.data.nominatimDisplayName?.trim() || null,
        nominatimRaw: body.data.nominatimRaw ?? null,
        isDefault: Boolean(body.data.isDefault),
        createdAt: nowIso,
        updatedAt: nowIso,
      }

      let replaced = false
      const nextItems = existing
        .map((entry: any) => {
          if (entry.id !== addressId) return entry
          replaced = true
          return {
            ...entry,
            ...nextItem,
            createdAt: entry.createdAt || nowIso,
            updatedAt: nowIso,
          }
        })
        .slice(0, 9)

      if (!replaced) nextItems.push(nextItem)

      const shouldDefault = nextItem.isDefault || nextItems.length === 1 || !nextItems.some((entry: any) => entry.isDefault && entry.id !== addressId)
      const normalizedItems = nextItems.map((entry: any) => ({
        ...entry,
        isDefault: shouldDefault ? entry.id === addressId : Boolean(entry.isDefault) && entry.id !== addressId,
      }))

      await prisma.user.update({
        where: { id: buyerId },
        data: { communityMeta: deps.mergeMarketShippingAddressesIntoCommunityMeta(user.communityMeta, normalizedItems) },
      })

      return reply.code(replaced ? 200 : 201).send({
        item: normalizedItems.find((entry: any) => entry.id === addressId) ?? null,
        items: normalizedItems,
      })
    }),
  )

  app.delete('/market/account/shipping-addresses/:addressId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketShippingAddressParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const user = await prisma.user.findUnique({
        where: { id: buyerId },
        select: { communityMeta: true },
      })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const existing = deps.readMarketShippingAddresses(user.communityMeta)
      const nextItems = existing.filter((entry: any) => entry.id !== params.data.addressId)
      if (nextItems.length === existing.length) return reply.code(404).send({ error: 'shipping_address_not_found' })

      const normalizedItems = nextItems.map((entry: any, index: number) => ({
        ...entry,
        isDefault: nextItems.some((candidate: any) => candidate.isDefault) ? entry.isDefault : index === 0,
      }))

      await prisma.user.update({
        where: { id: buyerId },
        data: { communityMeta: deps.mergeMarketShippingAddressesIntoCommunityMeta(user.communityMeta, normalizedItems) },
      })

      return reply.send({ ok: true, items: normalizedItems })
    }),
  )

  app.post('/market/checkout', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.MarketCheckoutBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await deps.ensureOrganizationShopTables()

      const quantitiesByProductId = new Map<string, number>()
      for (const item of body.data.items) {
        quantitiesByProductId.set(item.productId, (quantitiesByProductId.get(item.productId) ?? 0) + item.quantity)
      }
      const productIds = Array.from(quantitiesByProductId.keys())
      if (!productIds.length) return reply.code(400).send({ error: 'empty_cart' })

      type CheckoutProductRow = {
        id: string
        business_id: string
        name: string
        price_cents: number
        currency: string
        tax_collect: boolean
        tax_rates_by_region: unknown
        track_inventory: boolean
        inventory_total: bigint | number | null
        fulfillment_type: string
        digital_delivery_url: string | null
      }

      const productRows: CheckoutProductRow[] = await prisma.$queryRaw<CheckoutProductRow[]>`
        SELECT
          p.id,
          p.business_id,
          p.name,
          p.price_cents,
          p.currency,
          p.tax_collect,
          p.tax_rates_by_region,
          p.track_inventory,
          COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total,
          p.fulfillment_type,
          p.digital_delivery_url
        FROM organization_shop_product p
        INNER JOIN "Business" b ON b.id = p.business_id
        LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
        LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
        WHERE p.id IN (${Prisma.join(productIds)})
          AND p.is_active = TRUE
          AND p.is_draft = FALSE
          AND p.moderation_status = ${'visible'}
          AND b.status = 'ACTIVE'
          AND b."moderationStatus" = CAST(${deps.ModerationStatus.VISIBLE} AS "ModerationStatus")
          AND (p.catalog_id IS NULL OR c.enabled = TRUE)
        GROUP BY p.id, b.id
      `

      if (productRows.length !== productIds.length) return reply.code(404).send({ error: 'product_not_found' })

      const businessId = productRows[0]!.business_id
      if (!businessId || productRows.some((row) => row.business_id !== businessId)) {
        return reply.code(400).send({ error: 'single_seller_required' })
      }

      const currency = productRows[0]!.currency
      if (!currency || productRows.some((row) => row.currency !== currency)) {
        return reply.code(400).send({ error: 'single_currency_required' })
      }

      const requiresShipping = productRows.some((row) => String(row.fulfillment_type || '').toLowerCase() === 'physical')
      const shippingAddress = body.data.shippingAddress ?? null
      if (requiresShipping && !shippingAddress) return reply.code(412).send({ error: 'shipping_address_required' })

      for (const row of productRows) {
        if (!row.track_inventory) continue
        const requested = quantitiesByProductId.get(row.id) ?? 0
        const available = Number(row.inventory_total ?? 0) || 0
        if (requested > available) return reply.code(409).send({ error: 'insufficient_inventory', productId: row.id })
      }

      let subtotalCents = 0
      let taxCents = 0
      const taxRegionCode = deps.resolveTaxRegionCode(shippingAddress?.province)

      for (const row of productRows) {
        const qty = quantitiesByProductId.get(row.id) ?? 0
        const lineSubtotal = (Number(row.price_cents) || 0) * qty
        subtotalCents += lineSubtotal

        if (row.tax_collect && taxRegionCode && row.tax_rates_by_region && typeof row.tax_rates_by_region === 'object' && !Array.isArray(row.tax_rates_by_region)) {
          const ratesMap = row.tax_rates_by_region as Record<string, unknown>
          const ratePct = deps.parseTaxRatePct(ratesMap[taxRegionCode])
          if (ratePct > 0) taxCents += Math.max(0, Math.round(lineSubtotal * (ratePct / 100)))
        }
      }
      if (subtotalCents <= 0) return reply.code(400).send({ error: 'invalid_total' })

      const stripeConnectFeeCents = Math.max(0, Math.round(subtotalCents * 0.029) + 30)
      const civilMarketFeeCents = Math.max(0, Math.round(subtotalCents * 0.05))
      const feeCents = stripeConnectFeeCents + civilMarketFeeCents
      const totalCents = subtotalCents + taxCents + feeCents

      const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } })
      if (!business) return reply.code(404).send({ error: 'organization_not_found' })

      const orderId = randomUUID()
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`
          INSERT INTO organization_shop_order (id, business_id, buyer_user_id, status, currency, subtotal_cents, fee_cents, total_cents, shipping_address, created_at, updated_at)
          VALUES (${orderId}, ${businessId}, ${buyerId}, ${'pending'}, ${currency}, ${subtotalCents}, ${feeCents}, ${totalCents}, ${shippingAddress ? JSON.stringify(shippingAddress) : null}::jsonb, NOW(), NOW())
        `

        for (const row of productRows) {
          const qty = quantitiesByProductId.get(row.id) ?? 0
          await tx.$executeRaw`
            INSERT INTO organization_shop_order_item (id, order_id, product_id, name, price_cents, quantity, fulfillment_type, digital_delivery_url, created_at)
            VALUES (
              ${randomUUID()},
              ${orderId},
              ${row.id},
              ${row.name},
              ${Number(row.price_cents) || 0},
              ${qty},
              ${row.fulfillment_type || 'physical'},
              ${String(row.fulfillment_type || '').toLowerCase() === 'digital' ? row.digital_delivery_url ?? null : null},
              NOW()
            )
          `
        }
      })

      return reply.code(201).send({
        orderId,
        totals: { subtotalCents, taxCents, stripeConnectFeeCents, civilMarketFeeCents, grandTotalCents: totalCents },
      })
    }),
  )

  app.get('/market/orders', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const query = deps.MarketOrdersQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      await deps.ensureOrganizationShopTables()

      type OrderListRow = {
        id: string
        business_id: string
        business_name: string
        status: string
        currency: string
        subtotal_cents: number
        fee_cents: number
        total_cents: number
        created_at: Date
        item_count: bigint | number
      }

      const rows = await prisma.$queryRaw<OrderListRow[]>`
        SELECT
          o.id,
          o.business_id,
          b.name AS business_name,
          o.status,
          o.currency,
          o.subtotal_cents,
          o.fee_cents,
          o.total_cents,
          o.created_at,
          COALESCE(SUM(oi.quantity), 0)::bigint AS item_count
        FROM organization_shop_order o
        INNER JOIN "Business" b ON b.id = o.business_id
        LEFT JOIN organization_shop_order_item oi ON oi.order_id = o.id
        WHERE o.buyer_user_id = ${buyerId}
        GROUP BY o.id, b.id
        ORDER BY o.created_at DESC
        LIMIT ${query.data.limit}
      `

      return reply.send({
        items: rows.map((row: OrderListRow) => ({
          id: row.id,
          businessId: row.business_id,
          businessName: row.business_name,
          status: row.status,
          currency: row.currency,
          subtotalCents: Number(row.subtotal_cents) || 0,
          feeCents: Number(row.fee_cents) || 0,
          totalCents: Number(row.total_cents) || 0,
          itemCount: Number(row.item_count ?? 0) || 0,
          createdAt: row.created_at.toISOString(),
        })),
      })
    }),
  )

  app.get('/market/orders/:orderId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketOrderParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureOrganizationShopTables()

      type OrderRow = {
        id: string
        business_id: string
        status: string
        currency: string
        subtotal_cents: number
        fee_cents: number
        total_cents: number
        shipping_address: unknown
        created_at: Date
      }

      const orderRows = await prisma.$queryRaw<OrderRow[]>`
        SELECT id, business_id, status, currency, subtotal_cents, fee_cents, total_cents, shipping_address, created_at
        FROM organization_shop_order
        WHERE id = ${params.data.orderId} AND buyer_user_id = ${buyerId}
        LIMIT 1
      `
      const order = orderRows[0]
      if (!order) return reply.code(404).send({ error: 'order_not_found' })

      type OrderItemRow = {
        id: string
        name: string
        price_cents: number
        quantity: number
        fulfillment_type: string
        digital_delivery_url: string | null
      }

      const itemRows = await prisma.$queryRaw<OrderItemRow[]>`
        SELECT id, name, price_cents, quantity, fulfillment_type, digital_delivery_url
        FROM organization_shop_order_item
        WHERE order_id = ${order.id}
        ORDER BY created_at ASC
      `

      const allowDigitalDelivery = order.status === 'paid' || order.status === 'fulfilled'

      return reply.send({
        order: {
          id: order.id,
          businessId: order.business_id,
          status: order.status,
          currency: order.currency,
          subtotalCents: Number(order.subtotal_cents) || 0,
          feeCents: Number(order.fee_cents) || 0,
          totalCents: Number(order.total_cents) || 0,
          shippingAddress: order.shipping_address ?? null,
          createdAt: order.created_at.toISOString(),
        },
        items: itemRows.map((item: OrderItemRow) => ({
          id: item.id,
          name: item.name,
          priceCents: Number(item.price_cents) || 0,
          quantity: Number(item.quantity) || 0,
          fulfillmentType: item.fulfillment_type,
          digitalDeliveryUrl: allowDigitalDelivery && String(item.fulfillment_type || '').toLowerCase() === 'digital' ? item.digital_delivery_url : null,
        })),
      })
    }),
  )
}