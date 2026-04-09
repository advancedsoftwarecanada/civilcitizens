import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { normalizeCanadaSalesTaxRatesByRegion } from '@civil/shared'
import { z } from 'zod'

type OrganizationShopDeps = Record<string, any>
const SHOP_PRODUCT_SLUG_MAX = 80
const SHOP_SHIPPING_POLICIES = ['local_shipping', 'civil_driver_contracts', 'provincial', 'national', 'international'] as const

type ShopShippingPolicy = (typeof SHOP_SHIPPING_POLICIES)[number]

type ShopShippingOption = {
  policy: ShopShippingPolicy
  enabled: boolean
  weightGrams: number | null
  flatRateFeeCents: number | null
}

type ShopProductAttribute = {
  name: string
  values: string[]
  position: number
}

type ShopProductVariantRecord = {
  id: string
  productId: string
  attributes: Record<string, string>
  attributeSignature: string
  priceCents: number | null
  sku: string | null
  imageUrl: string | null
  isActive: boolean
  inventoryByWarehouse: Record<string, number>
  inventoryTotal: number
  createdAt: string
  updatedAt: string
}

function normalizeShopProductAttributes(value: unknown): ShopProductAttribute[] {
  if (!Array.isArray(value)) return []

  const next = value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const typed = entry as Record<string, unknown>
      const name = String(typed.name || '').trim()
      if (!name) return null
      const values = Array.isArray(typed.values)
        ? Array.from(new Set(typed.values.map((item) => String(item || '').trim()).filter(Boolean)))
        : []
      if (!values.length) return null
      const position = typeof typed.position === 'number' && Number.isFinite(typed.position) ? Math.max(0, Math.round(typed.position)) : index
      return { name, values, position }
    })
    .filter((entry): entry is ShopProductAttribute => Boolean(entry))

  next.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
  return next.slice(0, 3)
}

function resolveShopVariantAttributeValues(
  attributes: ShopProductAttribute[],
  input: Record<string, unknown>,
): { values: Record<string, string> | null; error?: string } {
  if (attributes.length > 3) return { values: null, error: 'Too many options. Consider separate products.' }

  const resolved: Record<string, string> = {}
  for (const attribute of attributes) {
    const rawValue = input[attribute.name]
    const normalizedValue = String(rawValue || '').trim()
    if (!normalizedValue) return { values: null, error: `missing_attribute:${attribute.name}` }
    const matchedValue = attribute.values.find((candidate) => candidate.toLowerCase() === normalizedValue.toLowerCase())
    if (!matchedValue) return { values: null, error: `invalid_attribute:${attribute.name}` }
    resolved[attribute.name] = matchedValue
  }
  return { values: resolved }
}

function buildShopVariantAttributeSignature(attributes: ShopProductAttribute[], values: Record<string, string>) {
  return attributes.map((attribute) => `${attribute.name}:${values[attribute.name] ?? ''}`).join('|')
}

function enumerateShopVariantCombinations(attributes: ShopProductAttribute[]) {
  if (!attributes.length) return [] as Array<Record<string, string>>
  const results: Array<Record<string, string>> = []
  const walk = (index: number, current: Record<string, string>) => {
    const attribute = attributes[index]
    if (!attribute) {
      results.push({ ...current })
      return
    }
    for (const value of attribute.values) {
      current[attribute.name] = value
      walk(index + 1, current)
    }
    delete current[attribute.name]
  }
  walk(0, {})
  return results
}

function normalizeVariantInventoryByWarehouse(value: unknown) {
  const next: Record<string, number> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next
  for (const [warehouseId, quantity] of Object.entries(value as Record<string, unknown>)) {
    const normalizedWarehouseId = String(warehouseId || '').trim()
    if (!normalizedWarehouseId) continue
    const normalizedQuantity = typeof quantity === 'number' && Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0
    next[normalizedWarehouseId] = normalizedQuantity
  }
  return next
}

function sumVariantInventoryByWarehouse(value: Record<string, number>) {
  return Object.values(value).reduce((sum, quantity) => sum + (Number(quantity) || 0), 0)
}

function normalizeShopShippingOptions(
  value: unknown,
  fallback?: { weightGrams?: number | null; shippingPolicy?: string | null; allowShippingContracts?: boolean | null },
): ShopShippingOption[] {
  const byPolicy = new Map<ShopShippingPolicy, ShopShippingOption>()
  for (const policy of SHOP_SHIPPING_POLICIES) {
    byPolicy.set(policy, { policy, enabled: false, weightGrams: null, flatRateFeeCents: null })
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Record<string, unknown>
      const policy = typeof candidate.policy === 'string' ? candidate.policy : ''
      if (!SHOP_SHIPPING_POLICIES.includes(policy as ShopShippingPolicy)) continue
      byPolicy.set(policy as ShopShippingPolicy, {
        policy: policy as ShopShippingPolicy,
        enabled: Boolean(candidate.enabled),
        weightGrams: typeof candidate.weightGrams === 'number' && Number.isFinite(candidate.weightGrams)
          ? Math.max(0, Math.round(candidate.weightGrams))
          : null,
        flatRateFeeCents: typeof candidate.flatRateFeeCents === 'number' && Number.isFinite(candidate.flatRateFeeCents)
          ? Math.max(0, Math.round(candidate.flatRateFeeCents))
          : null,
      })
    }
  } else {
    const fallbackWeight = typeof fallback?.weightGrams === 'number' && Number.isFinite(fallback.weightGrams)
      ? Math.max(0, Math.round(fallback.weightGrams))
      : null
    const fallbackPolicy = String(fallback?.shippingPolicy || 'local_community').toLowerCase()
    const primaryPolicy: ShopShippingPolicy = fallbackPolicy === 'provincial'
      ? 'provincial'
      : fallbackPolicy === 'national'
        ? 'national'
        : fallbackPolicy === 'international'
          ? 'international'
          : 'local_shipping'
    byPolicy.set(primaryPolicy, {
      policy: primaryPolicy,
      enabled: true,
      weightGrams: fallbackWeight,
      flatRateFeeCents: null,
    })
    if (fallback?.allowShippingContracts) {
      byPolicy.set('civil_driver_contracts', {
        policy: 'civil_driver_contracts',
        enabled: true,
        weightGrams: fallbackWeight,
        flatRateFeeCents: null,
      })
    }
  }

  return SHOP_SHIPPING_POLICIES.map((policy) => byPolicy.get(policy) ?? { policy, enabled: false, weightGrams: null, flatRateFeeCents: null })
}

function applyLegacyShippingOverrides(
  options: ShopShippingOption[],
  overrides: { weightGrams?: number | null; shippingPolicy?: string; allowShippingContracts?: boolean },
): ShopShippingOption[] {
  const nextOptions = options.map((option) => ({ ...option }))
  const policyToEnable = overrides.shippingPolicy === 'provincial'
    ? 'provincial'
    : overrides.shippingPolicy === 'national'
      ? 'national'
      : overrides.shippingPolicy === 'international'
        ? 'international'
        : overrides.shippingPolicy === 'local_community'
          ? 'local_shipping'
          : null

  if (policyToEnable) {
    for (const option of nextOptions) {
      if (option.policy === 'civil_driver_contracts') continue
      option.enabled = option.policy === policyToEnable
    }
  }

  if (typeof overrides.allowShippingContracts === 'boolean') {
    const contractOption = nextOptions.find((option) => option.policy === 'civil_driver_contracts')
    if (contractOption) contractOption.enabled = overrides.allowShippingContracts
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'weightGrams')) {
    const nextWeight = typeof overrides.weightGrams === 'number' && Number.isFinite(overrides.weightGrams)
      ? Math.max(0, Math.round(overrides.weightGrams))
      : null
    for (const option of nextOptions) {
      if (option.enabled) option.weightGrams = nextWeight
    }
  }

  return nextOptions
}

function deriveLegacyShopShippingFields(options: ShopShippingOption[]) {
  const primaryOption = options.find((option) => option.enabled && option.policy !== 'civil_driver_contracts')
  const shippingPolicy = primaryOption?.policy === 'provincial'
    ? 'provincial'
    : primaryOption?.policy === 'national'
      ? 'national'
      : primaryOption?.policy === 'international'
        ? 'international'
        : 'local_community'
  const weightOption = options.find((option) => option.enabled && typeof option.weightGrams === 'number' && Number.isFinite(option.weightGrams))

  return {
    weightGrams: weightOption ? Math.max(0, Math.round(weightOption.weightGrams ?? 0)) : null,
    shippingPolicy,
    allowShippingContracts: options.some((option) => option.policy === 'civil_driver_contracts' && option.enabled),
  }
}

async function ensureUniqueShopProductSlug({
  businessId,
  baseName,
  excludeProductId,
  deps,
}: {
  businessId: string
  baseName: string
  excludeProductId?: string
  deps: OrganizationShopDeps
}) {
  const baseSlug = deps.trimSlugLength(deps.slugifyText(String(baseName || '').trim().toLowerCase()), SHOP_PRODUCT_SLUG_MAX) || 'product'
  let candidate = baseSlug
  let suffix = 2

  for (;;) {
    const existing = excludeProductId
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM organization_shop_product
          WHERE business_id = ${businessId}
            AND slug = ${candidate}
            AND id <> ${excludeProductId}
          LIMIT 1
        `
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM organization_shop_product
          WHERE business_id = ${businessId}
            AND slug = ${candidate}
          LIMIT 1
        `
    if (!existing[0]) return candidate
    candidate = deps.trimSlugLength(`${baseSlug}-${suffix}`, SHOP_PRODUCT_SLUG_MAX) || `product-${suffix}`
    suffix += 1
  }
}

async function resolveShopProductSlug({
  businessId,
  productId,
  name,
  currentSlug,
  deps,
  forceRegenerate = false,
}: {
  businessId: string
  productId: string
  name: string
  currentSlug?: string | null
  deps: OrganizationShopDeps
  forceRegenerate?: boolean
}) {
  const normalizedCurrentSlug = typeof currentSlug === 'string' && currentSlug.trim() ? currentSlug.trim().toLowerCase() : null
  if (normalizedCurrentSlug && !forceRegenerate) return normalizedCurrentSlug

  const nextSlug = await ensureUniqueShopProductSlug({
    businessId,
    baseName: name,
    excludeProductId: productId,
    deps,
  })

  if (nextSlug !== normalizedCurrentSlug) {
    await prisma.$executeRaw`
      UPDATE organization_shop_product
      SET slug = ${nextSlug}, updated_at = NOW()
      WHERE id = ${productId}
    `
  }

  return nextSlug
}

export function registerOrganizationShopRoutes(app: FastifyInstance, deps: OrganizationShopDeps) {
  app.get('/communities/:province/:municipality/orgs/:slug/shop', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, status: true, moderationStatus: true, name: true, slug: true, provinceCode: true, communitySlug: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (deps.isBusinessHiddenFromViewer(org, viewerBlockState)) return reply.code(404).send({ error: 'organization_not_found' })

      const [membership, follow] = viewerId
        ? await Promise.all([
            prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId: viewerId } }, select: { role: true } }),
            prisma.businessFollow.findUnique({ where: { businessId_userId: { businessId: org.id, userId: viewerId } }, select: { id: true } }),
          ])
        : [null, null]

      const isOwner = viewerId ? org.ownerId === viewerId : false
      const canManage = Boolean(isOwner || membership?.role === 'MANAGER' || membership?.role === 'OWNER')
      const isAssociated = Boolean(canManage || follow)
      if ((org.status !== 'ACTIVE' || org.moderationStatus !== deps.ModerationStatus.VISIBLE) && !isAssociated) {
        return reply.code(404).send({ error: 'organization_not_found' })
      }

      const includePrivateShopData = canManage
      await deps.ensureOrganizationShopTables()

      type ShopSettingsRow = {
        business_id: string
        head_office_address: string | null
        warehouse_same_as_head_office: boolean
        direct_deposit_transit: string | null
        direct_deposit_institution: string | null
        direct_deposit_account: string | null
      }

      type ShopWarehouseRow = {
        id: string
        business_id: string
        name: string
        address: string | null
        is_head_office: boolean
        created_at: Date
        updated_at: Date
      }

      type ShopProductRow = {
        id: string
        business_id: string
        catalog_id: string | null
        slug: string | null
        name: string
        description: string | null
        listing_section: string | null
        listing_category: string | null
        listing_subcategory: string | null
        featured_homepage: boolean
        tax_collect: boolean
        tax_rates_by_region: unknown
        price_cents: number
        currency: string
        sku: string | null
        primary_image_url: string | null
        gallery_image_urls: unknown
        has_variants: boolean
        attributes_json: unknown
        group_id: string | null
        fulfillment_type: string
        digital_delivery_url: string | null
        weight_grams: number | null
        shipping_policy: string
        allow_shipping_contracts: boolean
        shipping_options: unknown
        is_draft: boolean
        is_active: boolean
        track_inventory: boolean
        created_at: Date
        updated_at: Date
        inventory_total: bigint | number | null
      }

      type ShopProductVariantRow = {
        id: string
        product_id: string
        attribute_values: unknown
        attribute_signature: string
        price_cents: number | null
        sku: string | null
        image_url: string | null
        is_active: boolean
        inventory_by_warehouse: unknown
        created_at: Date
        updated_at: Date
      }

      type ShopInventoryRow = {
        product_id: string
        warehouse_id: string
        quantity: number
        updated_at: Date
      }

      type ShopCatalogRow = {
        id: string
        business_id: string
        title: string
        description: string | null
        image_url: string | null
        sort_order: number
        enabled: boolean
        created_at: Date
        updated_at: Date
      }

      const [settingsRows, warehouseRows, catalogRows, productRows, inventoryRows] = await Promise.all([
        includePrivateShopData
          ? prisma.$queryRaw<ShopSettingsRow[]>`
              SELECT business_id, head_office_address, warehouse_same_as_head_office, direct_deposit_transit, direct_deposit_institution, direct_deposit_account
              FROM organization_shop_settings
              WHERE business_id = ${org.id}
              LIMIT 1
            `
          : Promise.resolve([] as ShopSettingsRow[]),
        includePrivateShopData
          ? prisma.$queryRaw<ShopWarehouseRow[]>`
              SELECT id, business_id, name, address, is_head_office, created_at, updated_at
              FROM organization_shop_warehouse
              WHERE business_id = ${org.id}
              ORDER BY is_head_office DESC, created_at ASC
            `
          : Promise.resolve([] as ShopWarehouseRow[]),
        prisma.$queryRaw<ShopCatalogRow[]>`
          SELECT id, business_id, title, description, image_url, sort_order, enabled, created_at, updated_at
          FROM organization_shop_catalog
          WHERE business_id = ${org.id}
          ORDER BY sort_order ASC, created_at ASC
        `,
        includePrivateShopData
          ? prisma.$queryRaw<ShopProductRow[]>`
              SELECT
                p.id,
                p.business_id,
                p.catalog_id,
                p.slug,
                p.name,
                p.description,
                p.listing_section,
                p.listing_category,
                p.listing_subcategory,
                p.featured_homepage,
                p.tax_collect,
                p.tax_rates_by_region,
                p.price_cents,
                p.currency,
                p.sku,
                p.primary_image_url,
                p.gallery_image_urls,
                p.has_variants,
                p.attributes_json,
                p.group_id,
                p.fulfillment_type,
                p.digital_delivery_url,
                p.weight_grams,
                p.shipping_policy,
                p.allow_shipping_contracts,
                p.shipping_options,
                p.is_draft,
                p.is_active,
                p.track_inventory,
                p.created_at,
                p.updated_at,
                COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total
              FROM organization_shop_product p
              LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
              WHERE p.business_id = ${org.id}
                AND p.moderation_status = ${'visible'}
              GROUP BY p.id
              ORDER BY p.created_at DESC
            `
          : prisma.$queryRaw<ShopProductRow[]>`
              SELECT
                p.id,
                p.business_id,
                p.catalog_id,
                p.slug,
                p.name,
                p.description,
                p.listing_section,
                p.listing_category,
                p.listing_subcategory,
                p.featured_homepage,
                p.tax_collect,
                p.tax_rates_by_region,
                p.price_cents,
                p.currency,
                p.sku,
                p.primary_image_url,
                p.gallery_image_urls,
                p.has_variants,
                p.attributes_json,
                p.group_id,
                p.fulfillment_type,
                p.digital_delivery_url,
                p.weight_grams,
                p.shipping_policy,
                p.allow_shipping_contracts,
                p.shipping_options,
                p.is_draft,
                p.is_active,
                p.track_inventory,
                p.created_at,
                p.updated_at,
                COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total
              FROM organization_shop_product p
              LEFT JOIN organization_shop_inventory i ON i.product_id = p.id
              LEFT JOIN organization_shop_catalog c ON c.id = p.catalog_id
              WHERE p.business_id = ${org.id}
                AND p.is_active = TRUE
                AND p.is_draft = FALSE
                AND p.moderation_status = ${'visible'}
                AND (p.catalog_id IS NULL OR c.enabled = TRUE)
              GROUP BY p.id
              ORDER BY p.created_at DESC
            `,
        includePrivateShopData
          ? prisma.$queryRaw<ShopInventoryRow[]>`
              SELECT i.product_id, i.warehouse_id, i.quantity, i.updated_at
              FROM organization_shop_inventory i
              INNER JOIN organization_shop_product p ON p.id = i.product_id
              WHERE p.business_id = ${org.id}
            `
          : Promise.resolve([] as ShopInventoryRow[]),
      ])

      const settings = settingsRows[0] ?? null
      const productIds = productRows.map((row: ShopProductRow) => row.id)
      const variantRows = productIds.length
        ? await prisma.$queryRaw<ShopProductVariantRow[]>`
            SELECT id, product_id, attribute_values, attribute_signature, price_cents, sku, image_url, is_active, inventory_by_warehouse, created_at, updated_at
            FROM organization_shop_product_variant
            WHERE product_id IN (${Prisma.join(productIds)})
              AND (${includePrivateShopData ? Prisma.sql`TRUE` : Prisma.sql`is_active = TRUE`})
            ORDER BY created_at ASC
          `
        : []
      const productSlugsById = new Map<string, string>()
      for (const row of productRows) {
        const resolvedSlug = await resolveShopProductSlug({
          businessId: org.id,
          productId: row.id,
          name: row.name,
          currentSlug: row.slug,
          deps,
        })
        productSlugsById.set(row.id, resolvedSlug)
      }
      const inventoryByProduct = new Map<string, Array<{ warehouseId: string; quantity: number; updatedAt: string }>>()
      for (const row of inventoryRows) {
        const current = inventoryByProduct.get(row.product_id) ?? []
        current.push({ warehouseId: row.warehouse_id, quantity: Number(row.quantity) || 0, updatedAt: row.updated_at.toISOString() })
        inventoryByProduct.set(row.product_id, current)
      }
      const variantsByProductId = new Map<string, ShopProductVariantRecord[]>()
      for (const row of variantRows) {
        const inventoryByWarehouse = normalizeVariantInventoryByWarehouse(row.inventory_by_warehouse)
        const current = variantsByProductId.get(row.product_id) ?? []
        current.push({
          id: row.id,
          productId: row.product_id,
          attributes:
            row.attribute_values && typeof row.attribute_values === 'object' && !Array.isArray(row.attribute_values)
              ? Object.fromEntries(
                  Object.entries(row.attribute_values as Record<string, unknown>)
                    .map(([key, value]) => [String(key).trim(), String(value || '').trim()])
                    .filter(([key, value]) => Boolean(key && value)),
                )
              : {},
          attributeSignature: row.attribute_signature,
          priceCents: row.price_cents == null ? null : Number(row.price_cents) || 0,
          sku: row.sku,
          imageUrl: deps.normalizeMediaUrl(row.image_url),
          isActive: row.is_active,
          inventoryByWarehouse,
          inventoryTotal: sumVariantInventoryByWarehouse(inventoryByWarehouse),
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })
        variantsByProductId.set(row.product_id, current)
      }

      const publicCatalogs: ShopCatalogRow[] = []
      if (includePrivateShopData) {
        publicCatalogs.push(...catalogRows)
      } else {
        for (const row of catalogRows) {
          if (row.enabled) publicCatalogs.push(row)
        }
      }

      return reply.send({
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          province: org.provinceCode?.toLowerCase() ?? null,
          municipality: org.communitySlug ?? null,
        },
        canManage,
        settings: includePrivateShopData
          ? {
              headOfficeAddress: settings?.head_office_address ?? null,
              warehouseSameAsHeadOffice: settings ? Boolean(settings.warehouse_same_as_head_office) : true,
              directDepositTransit: settings?.direct_deposit_transit ?? null,
              directDepositInstitution: settings?.direct_deposit_institution ?? null,
              directDepositAccount: settings?.direct_deposit_account ?? null,
            }
          : undefined,
        warehouses: warehouseRows.map((row: ShopWarehouseRow) => ({
          id: row.id,
          name: row.name,
          address: row.address,
          isHeadOffice: row.is_head_office,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
        catalogs: publicCatalogs.map((row: ShopCatalogRow) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          imageUrl: deps.normalizeMediaUrl(row.image_url),
          sortOrder: Number(row.sort_order) || 0,
          enabled: row.enabled,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
        products: productRows.map((row: ShopProductRow) => ({
          ...(function () {
            const variants = variantsByProductId.get(row.id) ?? []
            const aggregateVariantInventory = variants.reduce((sum, variant) => sum + variant.inventoryTotal, 0)
            return {
              id: row.id,
              slug: productSlugsById.get(row.id) ?? row.slug,
              catalogId: row.catalog_id,
              name: row.name,
              description: row.description,
              listingSection: row.listing_section,
              listingCategory: row.listing_category,
              listingSubcategory: row.listing_subcategory,
              featuredHomepage: row.featured_homepage,
              taxCollect: row.tax_collect,
              taxRatesByRegion: row.tax_collect ? normalizeCanadaSalesTaxRatesByRegion(row.tax_rates_by_region, { fallbackPreset: 'canada_current' }) : {},
              priceCents: Number(row.price_cents) || 0,
              currency: row.currency,
              sku: row.sku,
              primaryImageUrl: deps.normalizeMediaUrl(row.primary_image_url),
              galleryImageUrls: Array.isArray(row.gallery_image_urls)
                ? row.gallery_image_urls
                    .filter((value): value is string => typeof value === 'string')
                    .map((value: string) => deps.normalizeMediaUrl(value))
                    .filter((value: string | null): value is string => Boolean(value))
                : [],
              hasVariants: row.has_variants,
              attributes: normalizeShopProductAttributes(row.attributes_json),
              groupId: row.group_id,
              variants,
              fulfillmentType: row.fulfillment_type,
              digitalDeliveryUrl: includePrivateShopData ? row.digital_delivery_url : undefined,
              weightGrams: row.weight_grams,
              shippingPolicy: row.shipping_policy,
              allowShippingContracts: row.allow_shipping_contracts,
              shippingOptions: normalizeShopShippingOptions(row.shipping_options, {
                weightGrams: row.weight_grams,
                shippingPolicy: row.shipping_policy,
                allowShippingContracts: row.allow_shipping_contracts,
              }),
              isDraft: row.is_draft,
              isActive: row.is_active,
              trackInventory: row.track_inventory,
              inventoryTotal: row.has_variants ? aggregateVariantInventory : (Number(row.inventory_total ?? 0) || 0),
              inventoryByWarehouse: includePrivateShopData ? inventoryByProduct.get(row.id) ?? [] : [],
              createdAt: row.created_at.toISOString(),
              updatedAt: row.updated_at.toISOString(),
            }
          })(),
        })),
      })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/shop/orders', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(500).optional().default(200),
        })
        .safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: 'invalid_query' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      type OrderRow = {
        id: string
        status: string
        currency: string
        subtotal_cents: number
        tax_cents: number
        civil_fee_cents: number
        stripe_fee_cents: number
        fee_cents: number
        total_cents: number
        created_at: Date
        buyer_user_id: string | null
        buyer_name: string | null
        buyer_handle: string | null
        buyer_email: string | null
        payment_method: string | null
        payment_status: string | null
        item_count: bigint | number
      }

      const orderRows = await prisma.$queryRaw<OrderRow[]>`
        SELECT
          o.id,
          o.status,
          o.currency,
          o.subtotal_cents,
          o.tax_cents,
          o.civil_fee_cents,
          o.stripe_fee_cents,
          o.fee_cents,
          o.total_cents,
          o.created_at,
          o.buyer_user_id,
          u.name AS buyer_name,
          u.handle AS buyer_handle,
          u.email AS buyer_email,
          pay.payment_method,
          pay.status AS payment_status,
          COALESCE(SUM(oi.quantity), 0)::bigint AS item_count
        FROM organization_shop_order o
        LEFT JOIN "User" u ON u.id = o.buyer_user_id
        LEFT JOIN LATERAL (
          SELECT payment_method, status
          FROM organization_shop_payment
          WHERE order_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) pay ON TRUE
        LEFT JOIN organization_shop_order_item oi ON oi.order_id = o.id
        WHERE o.business_id = ${org.id}
        GROUP BY
          o.id,
          o.status,
          o.currency,
          o.subtotal_cents,
          o.tax_cents,
          o.civil_fee_cents,
          o.stripe_fee_cents,
          o.fee_cents,
          o.total_cents,
          o.created_at,
          o.buyer_user_id,
          u.name,
          u.handle,
          u.email,
          pay.payment_method,
          pay.status
        ORDER BY o.created_at DESC
        LIMIT ${query.data.limit}
      `

      const orderIds = orderRows.map((row: OrderRow) => row.id)
      type OrderItemRow = {
        order_id: string
        product_id: string | null
        name: string
        price_cents: number
        quantity: number
        fulfillment_type: string
      }

      const itemRows = orderIds.length
        ? await prisma.$queryRaw<OrderItemRow[]>`
            SELECT order_id, product_id, name, price_cents, quantity, fulfillment_type
            FROM organization_shop_order_item
            WHERE order_id IN (${Prisma.join(orderIds)})
            ORDER BY created_at ASC
          `
        : []

      const itemsByOrderId = new Map<string, OrderItemRow[]>()
      for (const row of itemRows) {
        const current = itemsByOrderId.get(row.order_id) ?? []
        current.push(row)
        itemsByOrderId.set(row.order_id, current)
      }

      return reply.send({
        items: orderRows.map((row: OrderRow) => ({
          id: row.id,
          status: row.status,
          currency: row.currency,
          subtotalCents: Number(row.subtotal_cents) || 0,
          taxCents: Number(row.tax_cents) || 0,
          civilFeeCents: Number(row.civil_fee_cents) || 0,
          stripeFeeCents: Number(row.stripe_fee_cents) || 0,
          feeCents: Number(row.fee_cents) || 0,
          totalCents: Number(row.total_cents) || 0,
          createdAt: row.created_at.toISOString(),
          paymentMethod: row.payment_method,
          paymentStatus: row.payment_status,
          itemCount: Number(row.item_count ?? 0) || 0,
          buyer: row.buyer_user_id
            ? {
                id: row.buyer_user_id,
                name: row.buyer_name,
                handle: row.buyer_handle,
                email: row.buyer_email,
              }
            : null,
          items: (itemsByOrderId.get(row.id) ?? []).map((item: OrderItemRow) => ({
            productId: item.product_id,
            name: item.name,
            priceCents: Number(item.price_cents) || 0,
            quantity: Number(item.quantity) || 0,
            fulfillmentType: item.fulfillment_type,
          })),
        })),
      })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/settings', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopSettingsBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, address: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const headOfficeAddress = body.data.headOfficeAddress ?? null
      const warehouseSameAsHeadOffice =
        typeof body.data.warehouseSameAsHeadOffice === 'boolean' ? body.data.warehouseSameAsHeadOffice : true

      await prisma.$executeRaw`
        INSERT INTO organization_shop_settings (business_id, head_office_address, warehouse_same_as_head_office, direct_deposit_transit, direct_deposit_institution, direct_deposit_account, updated_at)
        VALUES (${org.id}, ${headOfficeAddress}, ${warehouseSameAsHeadOffice}, ${body.data.directDepositTransit ?? null}, ${body.data.directDepositInstitution ?? null}, ${body.data.directDepositAccount ?? null}, NOW())
        ON CONFLICT (business_id)
        DO UPDATE SET
          head_office_address = EXCLUDED.head_office_address,
          warehouse_same_as_head_office = EXCLUDED.warehouse_same_as_head_office,
          direct_deposit_transit = EXCLUDED.direct_deposit_transit,
          direct_deposit_institution = EXCLUDED.direct_deposit_institution,
          direct_deposit_account = EXCLUDED.direct_deposit_account,
          updated_at = NOW()
      `

      if (warehouseSameAsHeadOffice) {
        const existingHeadOffice = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM organization_shop_warehouse
          WHERE business_id = ${org.id} AND is_head_office = TRUE
          LIMIT 1
        `
        const resolvedAddress = headOfficeAddress ?? org.address ?? null
        if (existingHeadOffice[0]) {
          await prisma.$executeRaw`
            UPDATE organization_shop_warehouse
            SET address = ${resolvedAddress}, updated_at = NOW()
            WHERE id = ${existingHeadOffice[0].id}
          `
        } else {
          await prisma.$executeRaw`
            INSERT INTO organization_shop_warehouse (id, business_id, name, address, is_head_office)
            VALUES (${randomUUID()}, ${org.id}, ${'Head Office Warehouse'}, ${resolvedAddress}, TRUE)
          `
        }
      }

      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/connect/account', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, name: true, websiteUrl: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const shopPayments = deps.readOrganizationShopPaymentsState(org.metadata)
      if (shopPayments.stripeConnectAccountId) return reply.send({ accountId: shopPayments.stripeConnectAccountId })

      const stripe = deps.getStripeClient()
      const owner = await prisma.user.findUnique({ where: { id: org.ownerId }, select: { email: true } })
      const ownerEmail = owner?.email ?? null

      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        email: ownerEmail ?? undefined,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { name: org.name, url: org.websiteUrl ?? undefined },
        metadata: { civilBusinessId: org.id, civilCommunity: community.slug, civilProvince: province },
      })

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: deps.mergeOrganizationShopPaymentsStateIntoMetadata(org.metadata, { stripeConnectAccountId: account.id }) },
        select: { id: true },
      })

      return reply.send({ accountId: account.id })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/connect/onboard', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, slug: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const shopPayments = deps.readOrganizationShopPaymentsState(org.metadata)
      if (!shopPayments.stripeConnectAccountId) return reply.code(409).send({ error: 'connect_account_missing' })

      const stripe = deps.getStripeClient()
      const managePath = `/com/${encodeURIComponent(province.toLowerCase())}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(org.slug)}/shop/manage`
      const refreshUrl = `https://${deps.CIVIL_PUBLIC_HOST}${managePath}?connect=refresh`
      const returnUrl = `https://${deps.CIVIL_PUBLIC_HOST}${managePath}?connect=return`

      const link = await stripe.accountLinks.create({
        account: shopPayments.stripeConnectAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      })

      return reply.send({ url: link.url })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/shop/connect/status', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const shopPayments = deps.readOrganizationShopPaymentsState(org.metadata)
      if (!shopPayments.stripeConnectAccountId) {
        return reply.send({ accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false })
      }

      const stripe = deps.getStripeClient()
      const account = await stripe.accounts.retrieve(shopPayments.stripeConnectAccountId)

      return reply.send({
        accountId: shopPayments.stripeConnectAccountId,
        chargesEnabled: Boolean((account as any).charges_enabled),
        payoutsEnabled: Boolean((account as any).payouts_enabled),
        detailsSubmitted: Boolean((account as any).details_submitted),
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/warehouses', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopWarehouseCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const normalizedAddress = [
        body.data.address.line1.trim(),
        body.data.address.line2?.trim() || null,
        `${body.data.address.city.trim()}, ${body.data.address.province.trim()} ${body.data.address.postalCode.trim()}`,
        body.data.address.country.trim().toUpperCase(),
      ]
        .filter((value: string | null): value is string => Boolean(value))
        .join('\n')

      const warehouseId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO organization_shop_warehouse (id, business_id, name, address, is_head_office)
        VALUES (${warehouseId}, ${org.id}, ${body.data.name.trim()}, ${normalizedAddress}, FALSE)
      `

      return reply.code(201).send({ warehouse: { id: warehouseId, name: body.data.name.trim(), address: normalizedAddress, isHeadOffice: false } })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/warehouses/:warehouseId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopWarehouseParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopWarehouseUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const normalizedAddress = [
        body.data.address.line1.trim(),
        body.data.address.line2?.trim() || null,
        `${body.data.address.city.trim()}, ${body.data.address.province.trim()} ${body.data.address.postalCode.trim()}`,
        body.data.address.country.trim().toUpperCase(),
      ]
        .filter((value: string | null): value is string => Boolean(value))
        .join('\n')

      const updatedRows = await prisma.$queryRaw<Array<{ id: string; name: string; address: string | null; is_head_office: boolean }>>`
        UPDATE organization_shop_warehouse
        SET name = ${body.data.name.trim()},
            address = ${normalizedAddress},
            updated_at = NOW()
        WHERE business_id = ${org.id} AND id = ${params.data.warehouseId}
        RETURNING id, name, address, is_head_office
      `

      const updated = updatedRows[0]
      if (!updated) return reply.code(404).send({ error: 'warehouse_not_found' })

      return reply.send({
        warehouse: {
          id: updated.id,
          name: updated.name,
          address: updated.address,
          isHeadOffice: Boolean(updated.is_head_office),
        },
      })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/shop/warehouses/:warehouseId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopWarehouseParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const deletedRows = await prisma.$queryRaw<Array<{ id: string }>>`
        DELETE FROM organization_shop_warehouse
        WHERE business_id = ${org.id} AND id = ${params.data.warehouseId}
        RETURNING id
      `

      if (!deletedRows[0]) return reply.code(404).send({ error: 'warehouse_not_found' })
      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/catalogs', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopCatalogCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const catalogDescription = body.data.description?.trim() ? deps.sanitizePlainText(body.data.description).trim() : null
      const catalogId = randomUUID()
      const sortOrderRows = await prisma.$queryRaw<Array<{ next_sort_order: number | null }>>`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
        FROM organization_shop_catalog
        WHERE business_id = ${org.id}
      `
      const nextSortOrder = Number(sortOrderRows[0]?.next_sort_order ?? 0)

      await prisma.$executeRaw`
        INSERT INTO organization_shop_catalog (id, business_id, title, description, image_url, sort_order, enabled, updated_at)
        VALUES (${catalogId}, ${org.id}, ${body.data.title.trim()}, ${catalogDescription}, ${body.data.imageUrl ?? null}, ${nextSortOrder}, ${body.data.enabled}, NOW())
      `

      return reply.code(201).send({
        catalog: {
          id: catalogId,
          title: body.data.title.trim(),
          description: catalogDescription,
          imageUrl: body.data.imageUrl ?? null,
          enabled: body.data.enabled,
        },
      })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/catalogs/:catalogId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopCatalogParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopCatalogUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const catalogRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM organization_shop_catalog
        WHERE id = ${params.data.catalogId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!catalogRows[0]) return reply.code(404).send({ error: 'catalog_not_found' })

      const nextCatalogDescription =
        'description' in body.data ? (body.data.description?.trim() ? deps.sanitizePlainText(body.data.description).trim() : null) : null

      await prisma.$executeRaw`
        UPDATE organization_shop_catalog
        SET title = COALESCE(${body.data.title?.trim() ?? null}, title),
            description = CASE WHEN ${'description' in body.data} THEN ${nextCatalogDescription} ELSE description END,
            image_url = CASE WHEN ${'imageUrl' in body.data} THEN ${body.data.imageUrl ?? null} ELSE image_url END,
            enabled = COALESCE(${typeof body.data.enabled === 'boolean' ? body.data.enabled : null}, enabled),
            updated_at = NOW()
        WHERE id = ${params.data.catalogId}
      `

      return reply.send({ success: true })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/catalogs/reorder', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopCatalogReorderBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM organization_shop_catalog
        WHERE business_id = ${org.id}
      `

      const existingIds = new Set(existingRows.map((row: { id: string }) => row.id))
      const incomingIds = body.data.catalogIds as string[]
      const uniqueIncomingIds = Array.from(new Set(incomingIds))
      if (uniqueIncomingIds.length !== incomingIds.length) return reply.code(400).send({ error: 'invalid_catalog_order' })
      if (existingIds.size !== uniqueIncomingIds.length) return reply.code(400).send({ error: 'invalid_catalog_order' })
      if (uniqueIncomingIds.some((catalogId: string) => !existingIds.has(catalogId))) {
        return reply.code(400).send({ error: 'invalid_catalog_order' })
      }

      await prisma.$transaction(
        uniqueIncomingIds.map((catalogId: string, index: number) =>
          prisma.$executeRaw`
            UPDATE organization_shop_catalog
            SET sort_order = ${index},
                updated_at = NOW()
            WHERE id = ${catalogId}
              AND business_id = ${org.id}
          `,
        ),
      )

      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/products/draft', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productId = randomUUID()
      const productSlug = await ensureUniqueShopProductSlug({
        businessId: org.id,
        baseName: 'Draft Product',
        deps,
      })
      const draftShippingOptions = normalizeShopShippingOptions(null, {
        weightGrams: null,
        shippingPolicy: 'local_community',
        allowShippingContracts: false,
      })
      await prisma.$executeRaw`
        INSERT INTO organization_shop_product (
          id, business_id, slug, name, description, price_cents, currency, sku,
          primary_image_url, gallery_image_urls, has_variants, attributes_json, group_id, weight_grams, shipping_policy,
          allow_shipping_contracts, shipping_options, featured_homepage, tax_collect, tax_rates_by_region, is_draft, is_active, track_inventory, created_by
        )
        VALUES (
          ${productId}, ${org.id}, ${productSlug}, ${'Draft Product'}, ${null}, ${0}, ${'CAD'}, ${null},
          ${null}, ${JSON.stringify([])}::jsonb, ${false}, ${JSON.stringify([])}::jsonb, ${null}, ${null}, ${'local_community'},
          ${false}, ${JSON.stringify(draftShippingOptions)}::jsonb, ${false}, ${false}, ${JSON.stringify({})}::jsonb, ${true}, ${true}, ${true}, ${userId}
        )
      `

      return reply.code(201).send({ product: { id: productId, isDraft: true } })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopProductUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string | null; fulfillment_type: string; digital_delivery_url: string | null; moderation_status: string; is_draft: boolean; weight_grams: number | null; shipping_policy: string; allow_shipping_contracts: boolean; shipping_options: unknown }>>`
        SELECT id, name, slug, fulfillment_type, digital_delivery_url, moderation_status, is_draft, weight_grams, shipping_policy, allow_shipping_contracts, shipping_options FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })
      if (!productRows[0].is_draft && !deps.isVisibleModerationStatus(productRows[0].moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      const providedName = typeof body.data.name === 'string' ? body.data.name.trim() : ''
      const effectiveProductName = providedName || productRows[0].name
      const shouldGenerateProductSlug = Boolean(
        effectiveProductName && (!productRows[0].slug || (productRows[0].is_draft && providedName) || body.data.isDraft === false),
      )
      const nextProductSlug = shouldGenerateProductSlug
        ? await ensureUniqueShopProductSlug({
            businessId: org.id,
            baseName: effectiveProductName,
            excludeProductId: params.data.productId,
            deps,
          })
        : null

      const fulfillmentProvided = Object.prototype.hasOwnProperty.call(body.data, 'fulfillmentType')
      const digitalUrlProvided = Object.prototype.hasOwnProperty.call(body.data, 'digitalDeliveryUrl')
      const hasDigitalUpdate = fulfillmentProvided || digitalUrlProvided
      const listingSectionProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingSection')
      const listingCategoryProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingCategory')
      const listingSubcategoryProvided = Object.prototype.hasOwnProperty.call(body.data, 'listingSubcategory')

      const existingFulfillment = String(productRows[0].fulfillment_type || 'physical').toLowerCase()
      const nextFulfillmentType = fulfillmentProvided ? String(body.data.fulfillmentType || 'physical').toLowerCase() : existingFulfillment
      let nextDigitalDeliveryUrl = digitalUrlProvided
        ? (body.data.digitalDeliveryUrl?.trim() ? body.data.digitalDeliveryUrl.trim() : null)
        : (productRows[0].digital_delivery_url ?? null)
      if (nextFulfillmentType !== 'digital') nextDigitalDeliveryUrl = null

      const nextListingSection = listingSectionProvided ? (body.data.listingSection?.trim() ? body.data.listingSection.trim() : null) : null
      const nextListingCategory = listingCategoryProvided ? (body.data.listingCategory?.trim() ? body.data.listingCategory.trim() : null) : null
      const nextListingSubcategory = listingSubcategoryProvided
        ? (body.data.listingSubcategory?.trim() ? body.data.listingSubcategory.trim() : null)
        : null

      if (typeof body.data.isDraft === 'boolean' && body.data.isDraft === false && nextFulfillmentType === 'digital' && !nextDigitalDeliveryUrl) {
        return reply.code(400).send({ error: 'digital_delivery_url_required' })
      }

      const nextProductDescription =
        'description' in body.data ? (body.data.description?.trim() ? deps.sanitizeRichTextHtml(body.data.description).trim() : null) : null
      const hasTaxRatesByRegion = Object.prototype.hasOwnProperty.call(body.data, 'taxRatesByRegion')
      const nextTaxRatesByRegion = hasTaxRatesByRegion
        ? body.data.taxCollect === false
          ? {}
          : normalizeCanadaSalesTaxRatesByRegion(body.data.taxRatesByRegion ?? {}, { fallbackPreset: 'canada_current' })
        : undefined
      const hasShippingUpdate =
        Object.prototype.hasOwnProperty.call(body.data, 'shippingOptions')
        || Object.prototype.hasOwnProperty.call(body.data, 'shippingPolicy')
        || Object.prototype.hasOwnProperty.call(body.data, 'allowShippingContracts')
        || Object.prototype.hasOwnProperty.call(body.data, 'weightGrams')

      const nextShippingOptions = hasShippingUpdate
        ? Object.prototype.hasOwnProperty.call(body.data, 'shippingOptions')
          ? normalizeShopShippingOptions(body.data.shippingOptions, {
              weightGrams: productRows[0].weight_grams,
              shippingPolicy: productRows[0].shipping_policy,
              allowShippingContracts: productRows[0].allow_shipping_contracts,
            })
          : applyLegacyShippingOverrides(
              normalizeShopShippingOptions(productRows[0].shipping_options, {
                weightGrams: productRows[0].weight_grams,
                shippingPolicy: productRows[0].shipping_policy,
                allowShippingContracts: productRows[0].allow_shipping_contracts,
              }),
              {
                weightGrams: Object.prototype.hasOwnProperty.call(body.data, 'weightGrams') ? (body.data.weightGrams ?? null) : undefined,
                shippingPolicy: body.data.shippingPolicy,
                allowShippingContracts: typeof body.data.allowShippingContracts === 'boolean' ? body.data.allowShippingContracts : undefined,
              },
            )
        : null
      const nextLegacyShipping = nextShippingOptions ? deriveLegacyShopShippingFields(nextShippingOptions) : null

      const catalogProvided = Object.prototype.hasOwnProperty.call(body.data, 'catalogId')
      let resolvedCatalogId: string | null | undefined = undefined
      if (catalogProvided) {
        if (body.data.catalogId == null) {
          resolvedCatalogId = null
        } else {
          const catalogRows = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM organization_shop_catalog
            WHERE id = ${body.data.catalogId} AND business_id = ${org.id}
            LIMIT 1
          `
          if (!catalogRows[0]) return reply.code(400).send({ error: 'invalid_catalog' })
          resolvedCatalogId = catalogRows[0].id
        }
      }

      await prisma.$executeRaw`
        UPDATE organization_shop_product
        SET catalog_id = CASE WHEN ${catalogProvided} THEN ${resolvedCatalogId ?? null} ELSE catalog_id END,
            slug = COALESCE(${nextProductSlug}, slug),
            name = COALESCE(${body.data.name?.trim() ?? null}, name),
            description = CASE WHEN ${'description' in body.data} THEN ${nextProductDescription} ELSE description END,
            listing_section = CASE WHEN ${listingSectionProvided} THEN ${nextListingSection} ELSE listing_section END,
            listing_category = CASE WHEN ${listingCategoryProvided} THEN ${nextListingCategory} ELSE listing_category END,
            listing_subcategory = CASE WHEN ${listingSubcategoryProvided} THEN ${nextListingSubcategory} ELSE listing_subcategory END,
            featured_homepage = COALESCE(${typeof body.data.featuredHomepage === 'boolean' ? body.data.featuredHomepage : null}, featured_homepage),
            tax_collect = COALESCE(${typeof body.data.taxCollect === 'boolean' ? body.data.taxCollect : null}, tax_collect),
            tax_rates_by_region = CASE
              WHEN ${hasTaxRatesByRegion} THEN ${JSON.stringify(nextTaxRatesByRegion ?? {})}::jsonb
              ELSE tax_rates_by_region
            END,
            price_cents = COALESCE(${body.data.priceCents ?? null}, price_cents),
            currency = COALESCE(${body.data.currency?.toUpperCase() ?? null}, currency),
            sku = CASE WHEN ${'sku' in body.data} THEN ${body.data.sku ?? null} ELSE sku END,
            fulfillment_type = CASE WHEN ${fulfillmentProvided} THEN ${nextFulfillmentType} ELSE fulfillment_type END,
            digital_delivery_url = CASE WHEN ${hasDigitalUpdate} THEN ${nextDigitalDeliveryUrl} ELSE digital_delivery_url END,
            track_inventory = COALESCE(${typeof body.data.trackInventory === 'boolean' ? body.data.trackInventory : null}, track_inventory),
            weight_grams = CASE WHEN ${hasShippingUpdate} THEN ${nextLegacyShipping?.weightGrams ?? null} ELSE weight_grams END,
            shipping_policy = CASE WHEN ${hasShippingUpdate} THEN ${nextLegacyShipping?.shippingPolicy ?? 'local_community'} ELSE shipping_policy END,
            allow_shipping_contracts = CASE WHEN ${hasShippingUpdate} THEN ${nextLegacyShipping?.allowShippingContracts ?? false} ELSE allow_shipping_contracts END,
            shipping_options = CASE WHEN ${hasShippingUpdate} THEN ${JSON.stringify(nextShippingOptions ?? [])}::jsonb ELSE shipping_options END,
            is_draft = COALESCE(${typeof body.data.isDraft === 'boolean' ? body.data.isDraft : null}, is_draft),
            updated_at = NOW()
        WHERE id = ${params.data.productId}
      `

      void deps.enqueueContentAiScanForMarketProduct(params.data.productId).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_product_update_failed', error)
      })

      return reply.send({ success: true })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/attributes', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      if (Array.isArray((req.body as { attributes?: unknown[] } | null | undefined)?.attributes) && ((req.body as { attributes?: unknown[] }).attributes?.length ?? 0) > 3) {
        return reply.code(400).send({ error: 'Too many options. Consider separate products.' })
      }

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopProductAttributesUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; moderation_status: string; is_draft: boolean }>>`
        SELECT id, moderation_status, is_draft
        FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })
      if (!productRows[0].is_draft && !deps.isVisibleModerationStatus(productRows[0].moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      const attributes = normalizeShopProductAttributes(body.data.attributes)
      if (attributes.length > 3) return reply.code(400).send({ error: 'Too many options. Consider separate products.' })

      await prisma.$executeRaw`
        UPDATE organization_shop_product
        SET has_variants = ${attributes.length > 0},
            attributes_json = ${JSON.stringify(attributes)}::jsonb,
            group_id = ${body.data.groupId?.trim() ? body.data.groupId.trim() : null},
            updated_at = NOW()
        WHERE id = ${params.data.productId}
      `

      return reply.send({ success: true, hasVariants: attributes.length > 0, attributes })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/variants/generate', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; sku: string | null; slug: string | null; attributes_json: unknown; has_variants: boolean; moderation_status: string; is_draft: boolean }>>`
        SELECT id, sku, slug, attributes_json, has_variants, moderation_status, is_draft
        FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      const product = productRows[0]
      if (!product) return reply.code(404).send({ error: 'product_not_found' })
      if (!product.is_draft && !deps.isVisibleModerationStatus(product.moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      const attributes = normalizeShopProductAttributes(product.attributes_json)
      if (!attributes.length || !product.has_variants) return reply.code(400).send({ error: 'product_attributes_required' })
      if (attributes.length > 3) return reply.code(400).send({ error: 'Too many options. Consider separate products.' })

      const combinations = enumerateShopVariantCombinations(attributes)
      const existingRows = await prisma.$queryRaw<Array<{ attribute_signature: string }>>`
        SELECT attribute_signature
        FROM organization_shop_product_variant
        WHERE product_id = ${params.data.productId}
      `
      const existing = new Set(existingRows.map((row: { attribute_signature: string }) => row.attribute_signature))
      const skuBase = String(product.sku || product.slug || params.data.productId)
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase()
        .slice(0, 40) || 'VAR'

      let createdCount = 0
      let sequence = existing.size + 1
      for (const combination of combinations) {
        const signature = buildShopVariantAttributeSignature(attributes, combination)
        if (existing.has(signature)) continue
        await prisma.$executeRaw`
          INSERT INTO organization_shop_product_variant (
            id, product_id, attribute_values, attribute_signature, price_cents, sku, image_url, is_active, inventory_by_warehouse, created_at, updated_at
          )
          VALUES (
            ${randomUUID()},
            ${params.data.productId},
            ${JSON.stringify(combination)}::jsonb,
            ${signature},
            ${null},
            ${`${skuBase}-${String(sequence).padStart(3, '0')}`},
            ${null},
            ${true},
            ${JSON.stringify({})}::jsonb,
            NOW(),
            NOW()
          )
        `
        existing.add(signature)
        createdCount += 1
        sequence += 1
      }

      return reply.send({ success: true, createdCount })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/variants', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopProductVariantCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; sku: string | null; attributes_json: unknown; has_variants: boolean; moderation_status: string; is_draft: boolean }>>`
        SELECT id, sku, attributes_json, has_variants, moderation_status, is_draft
        FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      const product = productRows[0]
      if (!product) return reply.code(404).send({ error: 'product_not_found' })
      if (!product.is_draft && !deps.isVisibleModerationStatus(product.moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      const attributes = normalizeShopProductAttributes(product.attributes_json)
      if (!attributes.length || !product.has_variants) return reply.code(400).send({ error: 'product_attributes_required' })
      const resolvedValues = resolveShopVariantAttributeValues(attributes, body.data.attributes)
      if (!resolvedValues.values) return reply.code(400).send({ error: resolvedValues.error ?? 'invalid_variant_attributes' })
      const signature = buildShopVariantAttributeSignature(attributes, resolvedValues.values)
      const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM organization_shop_product_variant
        WHERE product_id = ${params.data.productId}
          AND attribute_signature = ${signature}
        LIMIT 1
      `
      if (existingRows[0]) return reply.code(409).send({ error: 'variant_already_exists' })

      const validWarehouses = new Set(
        (
          await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM organization_shop_warehouse
            WHERE business_id = ${org.id}
          `
        ).map((row: { id: string }) => row.id),
      )
      const inventoryByWarehouse = normalizeVariantInventoryByWarehouse(body.data.inventoryByWarehouse ?? {})
      if (Object.keys(inventoryByWarehouse).some((warehouseId) => !validWarehouses.has(warehouseId))) {
        return reply.code(400).send({ error: 'invalid_warehouse' })
      }

      const variantId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO organization_shop_product_variant (
          id, product_id, attribute_values, attribute_signature, price_cents, sku, image_url, is_active, inventory_by_warehouse, created_at, updated_at
        )
        VALUES (
          ${variantId},
          ${params.data.productId},
          ${JSON.stringify(resolvedValues.values)}::jsonb,
          ${signature},
          ${body.data.priceCents ?? null},
          ${body.data.sku ?? null},
          ${body.data.imageUrl ?? null},
          ${typeof body.data.isActive === 'boolean' ? body.data.isActive : true},
          ${JSON.stringify(inventoryByWarehouse)}::jsonb,
          NOW(),
          NOW()
        )
      `

      return reply.code(201).send({ success: true, variantId })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/variants/:variantId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductVariantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopProductVariantUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const variantRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT v.id
        FROM organization_shop_product_variant v
        INNER JOIN organization_shop_product p ON p.id = v.product_id
        WHERE v.id = ${params.data.variantId}
          AND v.product_id = ${params.data.productId}
          AND p.business_id = ${org.id}
        LIMIT 1
      `
      if (!variantRows[0]) return reply.code(404).send({ error: 'variant_not_found' })

      const validWarehouses = new Set(
        (
          await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM organization_shop_warehouse
            WHERE business_id = ${org.id}
          `
        ).map((row: { id: string }) => row.id),
      )
      const inventoryByWarehouse = Object.prototype.hasOwnProperty.call(body.data, 'inventoryByWarehouse')
        ? normalizeVariantInventoryByWarehouse(body.data.inventoryByWarehouse ?? {})
        : null
      if (inventoryByWarehouse && Object.keys(inventoryByWarehouse).some((warehouseId) => !validWarehouses.has(warehouseId))) {
        return reply.code(400).send({ error: 'invalid_warehouse' })
      }

      await prisma.$executeRaw`
        UPDATE organization_shop_product_variant
        SET price_cents = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'priceCents')} THEN ${body.data.priceCents ?? null} ELSE price_cents END,
            sku = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'sku')} THEN ${body.data.sku ?? null} ELSE sku END,
            image_url = CASE WHEN ${Object.prototype.hasOwnProperty.call(body.data, 'imageUrl')} THEN ${body.data.imageUrl ?? null} ELSE image_url END,
            is_active = COALESCE(${typeof body.data.isActive === 'boolean' ? body.data.isActive : null}, is_active),
            inventory_by_warehouse = CASE WHEN ${Boolean(inventoryByWarehouse)} THEN ${JSON.stringify(inventoryByWarehouse ?? {})}::jsonb ELSE inventory_by_warehouse END,
            updated_at = NOW()
        WHERE id = ${params.data.variantId}
      `

      return reply.send({ success: true })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/shop/products/:productId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; moderation_status: string; is_draft: boolean }>>`
        SELECT id, moderation_status, is_draft
        FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })
      if (!productRows[0].is_draft && !deps.isVisibleModerationStatus(productRows[0].moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      await prisma.$executeRaw`
        UPDATE organization_shop_product
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE id = ${params.data.productId}
          AND business_id = ${org.id}
      `

      return reply.send({ success: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/shop/products', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopProductCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, address: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productId = randomUUID()
      const priceCents = body.data.priceCents
      const currency = body.data.currency.toUpperCase()
      const fulfillmentType = body.data.fulfillmentType
      const digitalDeliveryUrl = body.data.digitalDeliveryUrl?.trim() ? body.data.digitalDeliveryUrl.trim() : null
      if (fulfillmentType === 'digital' && !digitalDeliveryUrl) return reply.code(400).send({ error: 'digital_delivery_url_required' })

      const productDescription = body.data.description?.trim() ? deps.sanitizeRichTextHtml(body.data.description).trim() : null
      const listingSection = body.data.listingSection?.trim() ? body.data.listingSection.trim() : null
      const listingCategory = body.data.listingCategory?.trim() ? body.data.listingCategory.trim() : null
      const listingSubcategory = body.data.listingSubcategory?.trim() ? body.data.listingSubcategory.trim() : null
      const productSlug = await ensureUniqueShopProductSlug({
        businessId: org.id,
        baseName: body.data.name,
        deps,
      })
      const galleryImageUrls = body.data.galleryImageUrls ?? []
      const normalizedTaxRatesByRegion = body.data.taxCollect
        ? normalizeCanadaSalesTaxRatesByRegion(body.data.taxRatesByRegion ?? {}, { fallbackPreset: 'canada_current' })
        : {}
      const shippingOptions = normalizeShopShippingOptions(body.data.shippingOptions, {
        weightGrams: body.data.weightGrams ?? null,
        shippingPolicy: body.data.shippingPolicy,
        allowShippingContracts: body.data.allowShippingContracts,
      })
      const legacyShipping = deriveLegacyShopShippingFields(shippingOptions)
      let resolvedCatalogId: string | null = null

      if (body.data.catalogId != null) {
        const catalogRows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM organization_shop_catalog
          WHERE id = ${body.data.catalogId} AND business_id = ${org.id}
          LIMIT 1
        `
        if (!catalogRows[0]) return reply.code(400).send({ error: 'invalid_catalog' })
        resolvedCatalogId = catalogRows[0].id
      }

      await prisma.$executeRaw`
        INSERT INTO organization_shop_product (
          id, business_id, catalog_id, slug, name, description, listing_section, listing_category, listing_subcategory, price_cents, currency, sku,
          primary_image_url, gallery_image_urls, has_variants, attributes_json, group_id, weight_grams, shipping_policy,
          allow_shipping_contracts, shipping_options, featured_homepage, tax_collect, tax_rates_by_region, fulfillment_type, digital_delivery_url, is_draft, is_active, track_inventory, created_by
        )
        VALUES (
          ${productId}, ${org.id}, ${resolvedCatalogId}, ${productSlug}, ${body.data.name.trim()}, ${productDescription}, ${listingSection}, ${listingCategory}, ${listingSubcategory}, ${priceCents}, ${currency}, ${body.data.sku ?? null},
          ${body.data.primaryImageUrl ?? null}, ${JSON.stringify(galleryImageUrls)}::jsonb, ${false}, ${JSON.stringify([])}::jsonb, ${null}, ${legacyShipping.weightGrams}, ${legacyShipping.shippingPolicy},
          ${legacyShipping.allowShippingContracts}, ${JSON.stringify(shippingOptions)}::jsonb, ${body.data.featuredHomepage}, ${body.data.taxCollect}, ${JSON.stringify(normalizedTaxRatesByRegion)}::jsonb, ${fulfillmentType}, ${fulfillmentType === 'digital' ? digitalDeliveryUrl : null}, ${false}, ${true}, ${body.data.trackInventory}, ${userId}
        )
      `

      if (body.data.trackInventory && body.data.initialInventory > 0) {
        const headOfficeWarehouseRows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM organization_shop_warehouse
          WHERE business_id = ${org.id}
          ORDER BY is_head_office DESC, created_at ASC
          LIMIT 1
        `

        let warehouseId = headOfficeWarehouseRows[0]?.id
        if (!warehouseId) {
          warehouseId = randomUUID()
          await prisma.$executeRaw`
            INSERT INTO organization_shop_warehouse (id, business_id, name, address, is_head_office)
            VALUES (${warehouseId}, ${org.id}, ${'Head Office Warehouse'}, ${org.address ?? null}, TRUE)
          `
        }

        await prisma.$executeRaw`
          INSERT INTO organization_shop_inventory (product_id, warehouse_id, quantity, updated_at)
          VALUES (${productId}, ${warehouseId}, ${body.data.initialInventory}, NOW())
          ON CONFLICT (product_id, warehouse_id)
          DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
        `
      }

      void deps.enqueueContentAiScanForMarketProduct(productId).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_product_create_failed', error)
      })

      return reply.code(201).send({ product: { id: productId } })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/inventory', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopInventoryUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; moderation_status: string; is_draft: boolean }>>`
        SELECT id, moderation_status, is_draft FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })
      if (!productRows[0].is_draft && !deps.isVisibleModerationStatus(productRows[0].moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      const warehouseIds = body.data.quantities.map((entry: { warehouseId: string }) => entry.warehouseId)
      const warehouseRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organization_shop_warehouse
        WHERE business_id = ${org.id} AND id IN (${Prisma.join(warehouseIds)})
      `
      const warehouseIdSet = new Set(warehouseRows.map((row: { id: string }) => row.id))
      const invalidWarehouse = warehouseIds.find((warehouseId: string) => !warehouseIdSet.has(warehouseId))
      if (invalidWarehouse) return reply.code(400).send({ error: 'invalid_warehouse' })

      await prisma.$transaction(
        body.data.quantities.map((entry: { warehouseId: string; quantity: number }) =>
          prisma.$executeRaw`
            INSERT INTO organization_shop_inventory (product_id, warehouse_id, quantity, updated_at)
            VALUES (${params.data.productId}, ${entry.warehouseId}, ${entry.quantity}, NOW())
            ON CONFLICT (product_id, warehouse_id)
            DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
          `,
        ),
      )

      return reply.send({ success: true })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/shop/products/:productId/photos', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgShopProductParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgShopProductPhotosUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, moderationStatus: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      if (org.moderationStatus !== deps.ModerationStatus.VISIBLE) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
      }

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: org.id, userId } }, select: { role: true } })
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'MANAGER')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      await deps.ensureOrganizationShopTables()

      const productRows = await prisma.$queryRaw<Array<{ id: string; moderation_status: string; is_draft: boolean }>>`
        SELECT id, moderation_status, is_draft
        FROM organization_shop_product
        WHERE id = ${params.data.productId} AND business_id = ${org.id}
        LIMIT 1
      `
      if (!productRows[0]) return reply.code(404).send({ error: 'product_not_found' })
      if (!productRows[0].is_draft && !deps.isVisibleModerationStatus(productRows[0].moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_PRODUCT') })
      }

      const galleryImageUrls = body.data.galleryImageUrls ?? []
      await prisma.$executeRaw`
        UPDATE organization_shop_product
        SET primary_image_url = ${body.data.primaryImageUrl ?? null},
            gallery_image_urls = ${JSON.stringify(galleryImageUrls)}::jsonb,
            updated_at = NOW()
        WHERE id = ${params.data.productId}
      `

      void deps.enqueueContentAiScanForMarketProduct(params.data.productId).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_product_photos_failed', error)
      })

      return reply.send({ success: true })
    }),
  )
}
