import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { normalizeCanadaSalesTaxRatesByRegion } from '@civil/shared'
import { computeCivilPayFeeCents } from '../civilPayFees.js'
import { applyWalletUserTransfer } from '../walletTransactions.js'
import { readWalletSummary, walletHasConnectPayoutsEnabled } from '../walletHelpers.js'

type MarketStorefrontDeps = Record<string, any>
const MARKET_SHIPPING_POLICIES = ['local_shipping', 'civil_driver_contracts', 'provincial', 'national', 'international'] as const

function normalizeMarketLocationKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeMarketShippingOptions(
  value: unknown,
  fallback?: { weightGrams?: number | null; shippingPolicy?: string | null; allowShippingContracts?: boolean | null },
) {
  const byPolicy = new Map<string, { policy: string; enabled: boolean; weightGrams: number | null; flatRateFeeCents: number | null }>()
  for (const policy of MARKET_SHIPPING_POLICIES) {
    byPolicy.set(policy, { policy, enabled: false, weightGrams: null, flatRateFeeCents: null })
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Record<string, unknown>
      const policy = typeof candidate.policy === 'string' ? candidate.policy : ''
      if (!byPolicy.has(policy)) continue
      byPolicy.set(policy, {
        policy,
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
    const primaryPolicy = fallbackPolicy === 'provincial'
      ? 'provincial'
      : fallbackPolicy === 'national'
        ? 'national'
        : fallbackPolicy === 'international'
          ? 'international'
          : 'local_shipping'
    byPolicy.set(primaryPolicy, { policy: primaryPolicy, enabled: true, weightGrams: fallbackWeight, flatRateFeeCents: null })
    if (fallback?.allowShippingContracts) {
      byPolicy.set('civil_driver_contracts', {
        policy: 'civil_driver_contracts',
        enabled: true,
        weightGrams: fallbackWeight,
        flatRateFeeCents: null,
      })
    }
  }

  return MARKET_SHIPPING_POLICIES.map((policy) => byPolicy.get(policy) ?? { policy, enabled: false, weightGrams: null, flatRateFeeCents: null })
}

function normalizeMarketProductAttributes(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ name: string; values: string[]; position: number }>
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
    .filter((entry): entry is { name: string; values: string[]; position: number } => Boolean(entry))
  next.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
  return next.slice(0, 3)
}

function normalizeMarketVariantInventoryByWarehouse(value: unknown) {
  const next: Record<string, number> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next
  for (const [warehouseId, quantity] of Object.entries(value as Record<string, unknown>)) {
    const normalizedWarehouseId = String(warehouseId || '').trim()
    if (!normalizedWarehouseId) continue
    next[normalizedWarehouseId] = typeof quantity === 'number' && Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0
  }
  return next
}

function sumMarketVariantInventoryByWarehouse(value: Record<string, number>) {
  return Object.values(value).reduce((sum, quantity) => sum + (Number(quantity) || 0), 0)
}

function readMarketVariantAttributes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, string>
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [String(key).trim(), String(entry || '').trim()])
      .filter(([key, entry]) => Boolean(key && entry)),
  )
}

function resolveMarketShippingOption(args: {
  options: ReturnType<typeof normalizeMarketShippingOptions>
  shippingAddress?: Record<string, unknown> | null
  sellerProvinceCode?: string | null
  sellerCommunitySlug?: string | null
}) {
  const country = String(args.shippingAddress?.country || 'CA').trim().toUpperCase()
  const province = String(args.shippingAddress?.province || '').trim().toUpperCase()
  const cityKey = normalizeMarketLocationKey(args.shippingAddress?.city)
  const sellerProvinceCode = String(args.sellerProvinceCode || '').trim().toUpperCase()
  const sellerCommunitySlug = normalizeMarketLocationKey(args.sellerCommunitySlug)
  const isInternational = country !== 'CA'
  const isLocal = !isInternational && cityKey && sellerCommunitySlug && cityKey === sellerCommunitySlug
  const isProvincial = !isInternational && province && sellerProvinceCode && province === sellerProvinceCode

  if (isInternational) {
    return args.options.find((option) => option.policy === 'international' && option.enabled) ?? null
  }

  if (isLocal) {
    return (
      args.options.find((option) => option.policy === 'local_shipping' && option.enabled)
      ?? args.options.find((option) => option.policy === 'provincial' && option.enabled)
      ?? args.options.find((option) => option.policy === 'national' && option.enabled)
      ?? null
    )
  }

  if (isProvincial) {
    return (
      args.options.find((option) => option.policy === 'provincial' && option.enabled)
      ?? args.options.find((option) => option.policy === 'national' && option.enabled)
      ?? null
    )
  }

  return args.options.find((option) => option.policy === 'national' && option.enabled) ?? null
}

export function registerMarketStorefrontRoutes(app: FastifyInstance, deps: MarketStorefrontDeps) {
  const MARKET_ORDER_NOTIFICATION_TYPE = 'market_order_received'

  function computeStripeCardProcessingFeeCents(amountCents: number) {
    if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
    return Math.max(0, Math.round(amountCents * 0.029) + 30)
  }

  function readStripeCustomerSessionClientSecret(value: unknown) {
    if (!value || typeof value !== 'object') return null
    const secret = (value as { client_secret?: unknown }).client_secret
    return typeof secret === 'string' && secret.trim() ? secret.trim() : null
  }

  async function buildCheckoutSnapshot(body: {
    items: Array<{ productId: string; variantId?: string | null; selectedAttributes?: Record<string, string> | null; quantity: number }>
    shippingAddress?: Record<string, unknown> | null
  }) {
    await deps.ensureOrganizationShopTables()

    const quantitiesBySelectionKey = new Map<string, number>()
    const selectionByKey = new Map<string, { productId: string; variantId: string | null; selectedAttributes: Record<string, string> | null }>()
    for (const item of body.items) {
      const variantId = item.variantId?.trim() ? item.variantId.trim() : null
      const selectionKey = `${item.productId}::${variantId ?? ''}`
      quantitiesBySelectionKey.set(selectionKey, (quantitiesBySelectionKey.get(selectionKey) ?? 0) + item.quantity)
      if (!selectionByKey.has(selectionKey)) {
        selectionByKey.set(selectionKey, {
          productId: item.productId,
          variantId,
          selectedAttributes: item.selectedAttributes ?? null,
        })
      }
    }
    const productIds = Array.from(new Set(body.items.map((item) => item.productId)))
    const variantIds = Array.from(new Set(body.items.map((item) => item.variantId?.trim()).filter((value): value is string => Boolean(value))))
    if (!productIds.length) {
      throw { statusCode: 400, payload: { error: 'empty_cart' } }
    }

    type CheckoutProductRow = {
      id: string
      business_id: string
      business_name: string
      province_code: string | null
      community_slug: string | null
      name: string
      attributes_json: unknown
      has_variants: boolean
      price_cents: number
      currency: string
      tax_collect: boolean
      tax_rates_by_region: unknown
      track_inventory: boolean
      inventory_total: bigint | number | null
      fulfillment_type: string
      digital_delivery_url: string | null
      weight_grams: number | null
      shipping_policy: string
      allow_shipping_contracts: boolean
      shipping_options: unknown
    }

    type CheckoutVariantRow = {
      id: string
      product_id: string
      attribute_values: unknown
      price_cents: number | null
      sku: string | null
      image_url: string | null
      is_active: boolean
      inventory_by_warehouse: unknown
    }

    const productRows: CheckoutProductRow[] = await prisma.$queryRaw<CheckoutProductRow[]>`
      SELECT
        p.id,
        p.business_id,
        b.name AS business_name,
        b."provinceCode" AS province_code,
        b."communitySlug" AS community_slug,
        p.name,
        p.attributes_json,
        p.has_variants,
        p.price_cents,
        p.currency,
        p.tax_collect,
        p.tax_rates_by_region,
        p.track_inventory,
        COALESCE(SUM(i.quantity), 0)::bigint AS inventory_total,
        p.fulfillment_type,
        p.digital_delivery_url,
        p.weight_grams,
        p.shipping_policy,
        p.allow_shipping_contracts,
        p.shipping_options
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

    const variantRows: CheckoutVariantRow[] = variantIds.length
      ? await prisma.$queryRaw<CheckoutVariantRow[]>`
          SELECT id, product_id, attribute_values, price_cents, sku, image_url, is_active, inventory_by_warehouse
          FROM organization_shop_product_variant
          WHERE id IN (${Prisma.join(variantIds)})
        `
      : []

    if (productRows.length !== productIds.length) {
      throw { statusCode: 404, payload: { error: 'product_not_found' } }
    }

    const businessId = productRows[0]!.business_id
    if (!businessId || productRows.some((row) => row.business_id !== businessId)) {
      throw { statusCode: 400, payload: { error: 'single_seller_required' } }
    }

    const currency = productRows[0]!.currency
    if (!currency || productRows.some((row) => row.currency !== currency)) {
      throw { statusCode: 400, payload: { error: 'single_currency_required' } }
    }

    const requiresShipping = productRows.some((row) => String(row.fulfillment_type || '').toLowerCase() === 'physical')
    const shippingAddress = body.shippingAddress ?? null
    if (requiresShipping && !shippingAddress) {
      throw { statusCode: 412, payload: { error: 'shipping_address_required' } }
    }

    const productById = new Map(productRows.map((row) => [row.id, row]))
    const variantById = new Map(variantRows.map((row) => [row.id, row]))

    const resolvedItems = Array.from(selectionByKey.entries()).map(([selectionKey, selection]) => {
      const product = productById.get(selection.productId)
      if (!product) {
        throw { statusCode: 404, payload: { error: 'product_not_found' } }
      }
      const quantity = quantitiesBySelectionKey.get(selectionKey) ?? 0
      const productAttributes = normalizeMarketProductAttributes(product.attributes_json)
      if (product.has_variants) {
        if (!selection.variantId) {
          throw { statusCode: 412, payload: { error: 'variant_selection_required', productId: product.id } }
        }
        const variant = variantById.get(selection.variantId)
        if (!variant || variant.product_id !== product.id || !variant.is_active) {
          throw { statusCode: 409, payload: { error: 'invalid_variant_selection', productId: product.id, variantId: selection.variantId } }
        }
        const inventoryByWarehouse = normalizeMarketVariantInventoryByWarehouse(variant.inventory_by_warehouse)
        const inventoryTotal = sumMarketVariantInventoryByWarehouse(inventoryByWarehouse)
        return {
          key: selectionKey,
          product,
          variant,
          quantity,
          priceCents: variant.price_cents == null ? (Number(product.price_cents) || 0) : (Number(variant.price_cents) || 0),
          inventoryTotal,
          variantAttributes: readMarketVariantAttributes(variant.attribute_values),
          productAttributes,
        }
      }

      if (selection.variantId) {
        throw { statusCode: 409, payload: { error: 'invalid_variant_selection', productId: product.id, variantId: selection.variantId } }
      }

      return {
        key: selectionKey,
        product,
        variant: null,
        quantity,
        priceCents: Number(product.price_cents) || 0,
        inventoryTotal: Number(product.inventory_total ?? 0) || 0,
        variantAttributes: {} as Record<string, string>,
        productAttributes,
      }
    })

    for (const row of resolvedItems) {
      if (!row.product.track_inventory) continue
      const requested = row.quantity
      const available = row.inventoryTotal
      if (requested > available) {
        throw {
          statusCode: 409,
          payload: {
            error: 'insufficient_inventory',
            productId: row.product.id,
            variantId: row.variant?.id ?? null,
          },
        }
      }
    }

    let subtotalCents = 0
    let shippingCents = 0
    let taxCents = 0
    const taxRegionCode = deps.resolveTaxRegionCode(shippingAddress?.province)

    for (const row of resolvedItems) {
      const qty = row.quantity
      const lineSubtotal = row.priceCents * qty
      subtotalCents += lineSubtotal

      if (String(row.product.fulfillment_type || '').toLowerCase() === 'physical') {
        const shippingOption = resolveMarketShippingOption({
          options: normalizeMarketShippingOptions(row.product.shipping_options, {
            weightGrams: row.product.weight_grams,
            shippingPolicy: row.product.shipping_policy,
            allowShippingContracts: row.product.allow_shipping_contracts,
          }),
          shippingAddress,
          sellerProvinceCode: row.product.province_code,
          sellerCommunitySlug: row.product.community_slug,
        })
        if (!shippingOption) {
          throw { statusCode: 412, payload: { error: 'shipping_unavailable', productId: row.product.id, variantId: row.variant?.id ?? null } }
        }
        shippingCents += (Math.max(0, Number(shippingOption.flatRateFeeCents) || 0) * qty)
      }

      if (
        row.product.tax_collect &&
        taxRegionCode &&
        row.product.tax_rates_by_region &&
        typeof row.product.tax_rates_by_region === 'object' &&
        !Array.isArray(row.product.tax_rates_by_region)
      ) {
        const ratesMap = normalizeCanadaSalesTaxRatesByRegion(row.product.tax_rates_by_region, { fallbackPreset: 'canada_current' }) as Record<string, unknown>
        const ratePct = deps.parseTaxRatePct(ratesMap[taxRegionCode])
        if (ratePct > 0) {
          taxCents += Math.max(0, Math.round(lineSubtotal * (ratePct / 100)))
        }
      }
    }
    if (subtotalCents <= 0) {
      throw { statusCode: 400, payload: { error: 'invalid_total' } }
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, ownerId: true, metadata: true },
    })
    if (!business) {
      throw { statusCode: 404, payload: { error: 'organization_not_found' } }
    }

    const sellerAmountCents = subtotalCents + shippingCents + taxCents
    const civilFeeCents = computeCivilPayFeeCents(subtotalCents)
    const stripeFeeCents = computeStripeCardProcessingFeeCents(sellerAmountCents)
    const orderFeeCents = civilFeeCents + stripeFeeCents
    const totalCents = sellerAmountCents + orderFeeCents

    return {
      quantitiesBySelectionKey,
      productRows,
      resolvedItems,
      business,
      shippingAddress,
      currency,
      subtotalCents,
      shippingCents,
      taxCents,
      sellerAmountCents,
      civilFeeCents,
      stripeFeeCents,
      orderFeeCents,
      totalCents,
    }
  }

  async function insertOrderWithItems(
    tx: Prisma.TransactionClient,
    snapshot: Awaited<ReturnType<typeof buildCheckoutSnapshot>>,
    args: {
      buyerUserId?: string | null
      orderStatus?: string
      paymentMethod: 'credit_card' | 'civil_wallet'
      paymentStatus: string
      stripePaymentIntentId?: string | null
      walletTransactionId?: string | null
    },
  ) {
    const orderId = randomUUID()
    await tx.$executeRaw`
      INSERT INTO organization_shop_order (
        id,
        business_id,
        buyer_user_id,
        status,
        currency,
        subtotal_cents,
        shipping_cents,
        tax_cents,
        civil_fee_cents,
        stripe_fee_cents,
        fee_cents,
        total_cents,
        shipping_address,
        created_at,
        updated_at
      )
      VALUES (
        ${orderId},
        ${snapshot.business.id},
        ${args.buyerUserId ?? null},
        ${args.orderStatus ?? 'pending'},
        ${snapshot.currency},
        ${snapshot.subtotalCents},
        ${snapshot.shippingCents},
        ${snapshot.taxCents},
        ${snapshot.civilFeeCents},
        ${args.paymentMethod === 'credit_card' ? snapshot.stripeFeeCents : 0},
        ${args.paymentMethod === 'credit_card' ? snapshot.civilFeeCents + snapshot.stripeFeeCents : snapshot.civilFeeCents},
        ${args.paymentMethod === 'credit_card' ? snapshot.totalCents : snapshot.sellerAmountCents + snapshot.civilFeeCents},
        ${snapshot.shippingAddress ? JSON.stringify(snapshot.shippingAddress) : null}::jsonb,
        NOW(),
        NOW()
      )
    `

    for (const row of snapshot.resolvedItems) {
      const qty = row.quantity
      await tx.$executeRaw`
        INSERT INTO organization_shop_order_item (id, order_id, product_id, variant_id, name, price_cents, quantity, variant_attributes, fulfillment_type, digital_delivery_url, created_at)
        VALUES (
          ${randomUUID()},
          ${orderId},
          ${row.product.id},
          ${row.variant?.id ?? null},
          ${row.product.name},
          ${row.priceCents},
          ${qty},
          ${JSON.stringify(row.variantAttributes)}::jsonb,
          ${row.product.fulfillment_type || 'physical'},
          ${String(row.product.fulfillment_type || '').toLowerCase() === 'digital' ? row.product.digital_delivery_url ?? null : null},
          NOW()
        )
      `
    }

    await tx.$executeRaw`
      INSERT INTO organization_shop_payment (
        id,
        order_id,
        stripe_payment_intent_id,
        wallet_transaction_id,
        payment_method,
        status,
        amount_cents,
        currency,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${orderId},
        ${args.stripePaymentIntentId ?? null},
        ${args.walletTransactionId ?? null},
        ${args.paymentMethod},
        ${args.paymentStatus},
        ${args.paymentMethod === 'credit_card' ? snapshot.totalCents : snapshot.sellerAmountCents + snapshot.civilFeeCents},
        ${snapshot.currency},
        NOW(),
        NOW()
      )
    `

    return orderId
  }

  async function finalizePaidShopOrder(
    db: typeof prisma | Prisma.TransactionClient,
    args: {
      orderId: string
      paymentStatus: string
      stripePaymentIntentId?: string | null
      walletTransactionId?: string | null
    },
  ) {
    const orderRows = await db.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status
      FROM organization_shop_order
      WHERE id = ${args.orderId}
      LIMIT 1
    `
    const order = orderRows[0]
    if (!order) {
      return { finalized: false, newlyPaid: false }
    }

    await db.$executeRaw`
      UPDATE organization_shop_payment
      SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${args.stripePaymentIntentId ?? null}),
          wallet_transaction_id = COALESCE(wallet_transaction_id, ${args.walletTransactionId ?? null}),
          status = ${args.paymentStatus},
          updated_at = NOW()
      WHERE order_id = ${args.orderId}
    `

    if (order.status === 'paid' || order.status === 'fulfilled') {
      return { finalized: true, newlyPaid: false }
    }

    await db.$executeRaw`
      UPDATE organization_shop_order
      SET status = ${'paid'}, updated_at = NOW()
      WHERE id = ${args.orderId}
    `

    type PaidItemRow = {
      product_id: string | null
      variant_id: string | null
      quantity: number
      track_inventory: boolean | null
    }

    const itemRows = await db.$queryRaw<PaidItemRow[]>`
      SELECT oi.product_id, oi.variant_id, oi.quantity, p.track_inventory
      FROM organization_shop_order_item oi
      LEFT JOIN organization_shop_product p ON p.id = oi.product_id
      WHERE oi.order_id = ${args.orderId}
    `

    for (const item of itemRows) {
      if ((!item.product_id && !item.variant_id) || !item.track_inventory) continue
      let remaining = Number(item.quantity) || 0
      if (remaining <= 0) continue

      if (item.variant_id) {
        const variantRows = await db.$queryRaw<Array<{ inventory_by_warehouse: unknown }>>`
          SELECT inventory_by_warehouse
          FROM organization_shop_product_variant
          WHERE id = ${item.variant_id}
          LIMIT 1
        `
        const inventoryByWarehouse = normalizeMarketVariantInventoryByWarehouse(variantRows[0]?.inventory_by_warehouse)
        const orderedEntries = Object.entries(inventoryByWarehouse).sort((a, b) => b[1] - a[1])
        for (const [warehouseId, quantity] of orderedEntries) {
          if (remaining <= 0) break
          if (quantity <= 0) continue
          const take = Math.min(remaining, quantity)
          remaining -= take
          inventoryByWarehouse[warehouseId] = Math.max(0, quantity - take)
        }
        await db.$executeRaw`
          UPDATE organization_shop_product_variant
          SET inventory_by_warehouse = ${JSON.stringify(inventoryByWarehouse)}::jsonb,
              updated_at = NOW()
          WHERE id = ${item.variant_id}
        `
        continue
      }

      const inventoryRows = await db.$queryRaw<Array<{ warehouse_id: string; quantity: number }>>`
        SELECT warehouse_id, quantity
        FROM organization_shop_inventory
        WHERE product_id = ${item.product_id}
        ORDER BY quantity DESC
      `

      for (const inv of inventoryRows) {
        if (remaining <= 0) break
        const available = Number(inv.quantity) || 0
        if (available <= 0) continue
        const take = Math.min(remaining, available)
        remaining -= take
        await db.$executeRaw`
          UPDATE organization_shop_inventory
          SET quantity = GREATEST(quantity - ${take}, 0), updated_at = NOW()
          WHERE product_id = ${item.product_id} AND warehouse_id = ${inv.warehouse_id}
        `
      }
    }

    return { finalized: true, newlyPaid: true }
  }

  async function loadShopOrderNotificationContext(orderId: string) {
    type OrderNotificationRow = {
      order_id: string
      total_cents: number
      business_id: string
      business_name: string
      business_owner_id: string | null
      business_slug: string | null
      province_code: string | null
      community_slug: string | null
      item_count: bigint | number
    }

    const rows = await prisma.$queryRaw<OrderNotificationRow[]>`
      SELECT
        o.id AS order_id,
        o.total_cents,
        b.id AS business_id,
        b.name AS business_name,
        b."ownerId" AS business_owner_id,
        b.slug AS business_slug,
        b."provinceCode" AS province_code,
        b."communitySlug" AS community_slug,
        COALESCE(SUM(oi.quantity), 0)::bigint AS item_count
      FROM organization_shop_order o
      INNER JOIN "Business" b ON b.id = o.business_id
      LEFT JOIN organization_shop_order_item oi ON oi.order_id = o.id
      WHERE o.id = ${orderId}
      GROUP BY o.id, b.id
      LIMIT 1
    `

    const row = rows[0]
    if (!row) return null

    const url =
      row.province_code && row.community_slug && row.business_slug
        ? `/com/${encodeURIComponent(String(row.province_code))}/${encodeURIComponent(String(row.community_slug))}/orgs/${encodeURIComponent(String(row.business_slug))}/shop/manage/orders?orderId=${encodeURIComponent(orderId)}`
        : '/notifications'

    return {
      orderId: row.order_id,
      totalCents: Number(row.total_cents) || 0,
      businessId: row.business_id,
      businessName: row.business_name,
      ownerId: row.business_owner_id,
      itemCount: Number(row.item_count ?? 0) || 0,
      url,
    }
  }

  async function notifyShopOrderReceived(args: { orderId: string; buyerUserId: string }) {
    if (!deps.createNotificationRecord) return

    const context = await loadShopOrderNotificationContext(args.orderId)
    if (!context?.ownerId || context.ownerId === args.buyerUserId) return

    await deps.createNotificationRecord({
      userId: context.ownerId,
      actorId: args.buyerUserId,
      type: MARKET_ORDER_NOTIFICATION_TYPE,
      payload: {
        orderId: context.orderId,
        businessId: context.businessId,
        businessName: context.businessName,
        totalCents: context.totalCents,
        itemCount: context.itemCount,
        status: 'paid',
        url: context.url,
      },
    })
  }

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
      const listingSection = query.data.listingSection?.trim() || null
      const listingCategory = query.data.listingCategory?.trim() || null
      const listingSubcategory = query.data.listingSubcategory?.trim() || null
      const listingDetail = query.data.listingDetail?.trim() || null

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
        listing_section: string | null
        listing_category: string | null
        listing_subcategory: string | null
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
          p.listing_section,
          p.listing_category,
          p.listing_subcategory,
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
          AND (${listingSection ? Prisma.sql`COALESCE(p.listing_section, '') = ${listingSection}` : Prisma.sql`TRUE`})
          AND (${listingCategory ? Prisma.sql`COALESCE(p.listing_category, '') = ${listingCategory}` : Prisma.sql`TRUE`})
          AND (${listingSubcategory ? Prisma.sql`COALESCE(p.listing_subcategory, '') = ${listingSubcategory}` : Prisma.sql`TRUE`})
          AND (${listingDetail ? Prisma.sql`FALSE` : Prisma.sql`TRUE`})
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
        listing_section: string | null
        listing_category: string | null
        listing_subcategory: string | null
        listing_detail: string | null
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
          l.listing_section,
          l.listing_category,
          l.listing_subcategory,
          l.listing_detail,
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
          AND (${listingSection ? Prisma.sql`COALESCE(l.listing_section, '') = ${listingSection}` : Prisma.sql`TRUE`})
          AND (${listingCategory ? Prisma.sql`COALESCE(l.listing_category, '') = ${listingCategory}` : Prisma.sql`TRUE`})
          AND (${listingSubcategory ? Prisma.sql`COALESCE(l.listing_subcategory, '') = ${listingSubcategory}` : Prisma.sql`TRUE`})
          AND (${listingDetail ? Prisma.sql`COALESCE(l.listing_detail, '') = ${listingDetail}` : Prisma.sql`TRUE`})
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
            listingSection: row.listing_section,
            listingCategory: row.listing_category,
            listingSubcategory: row.listing_subcategory,
            listingDetail: null,
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
              listingSection: row.listing_section,
              listingCategory: row.listing_category,
              listingSubcategory: row.listing_subcategory,
              listingDetail: row.listing_detail,
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
        has_variants: boolean
        attributes_json: unknown
        primary_image_url: string | null
        gallery_image_urls: unknown
        weight_grams: number | null
        shipping_policy: string
        allow_shipping_contracts: boolean
        shipping_options: unknown
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
          p.has_variants,
          p.attributes_json,
          p.primary_image_url,
          p.gallery_image_urls,
          p.weight_grams,
          p.shipping_policy,
          p.allow_shipping_contracts,
          p.shipping_options,
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

      type MarketProductVariantRow = {
        id: string
        product_id: string
        attribute_values: unknown
        price_cents: number | null
        sku: string | null
        image_url: string | null
        is_active: boolean
        inventory_by_warehouse: unknown
      }

      const variantRows = row.has_variants
        ? await prisma.$queryRaw<MarketProductVariantRow[]>`
            SELECT id, product_id, attribute_values, price_cents, sku, image_url, is_active, inventory_by_warehouse
            FROM organization_shop_product_variant
            WHERE product_id = ${row.id}
              AND is_active = TRUE
            ORDER BY created_at ASC, id ASC
          `
        : []

      const attributes = normalizeMarketProductAttributes(row.attributes_json)

      return reply.send({
        product: {
          id: row.id,
          name: row.name,
          description: row.description,
          taxCollect: row.tax_collect,
          taxRatesByRegion: row.tax_collect ? normalizeCanadaSalesTaxRatesByRegion(row.tax_rates_by_region, { fallbackPreset: 'canada_current' }) : {},
          priceCents: Number(row.price_cents) || 0,
          currency: row.currency,
          sku: row.sku,
          hasVariants: row.has_variants,
          attributes,
          variants: variantRows.map((variant: MarketProductVariantRow) => ({
            id: variant.id,
            productId: variant.product_id,
            attributeValues: readMarketVariantAttributes(variant.attribute_values),
            priceCents: variant.price_cents == null ? null : Number(variant.price_cents) || 0,
            sku: variant.sku,
            imageUrl: deps.normalizeMediaUrl(variant.image_url),
            isActive: variant.is_active,
            inventoryTotal: sumMarketVariantInventoryByWarehouse(normalizeMarketVariantInventoryByWarehouse(variant.inventory_by_warehouse)),
          })),
          primaryImageUrl: row.primary_image_url,
          galleryImageUrls: deps.readGalleryUrls(row.gallery_image_urls),
          fulfillmentType: row.fulfillment_type,
          weightGrams: row.weight_grams,
          shippingPolicy: row.shipping_policy,
          allowShippingContracts: row.allow_shipping_contracts,
          shippingOptions: normalizeMarketShippingOptions(row.shipping_options, {
            weightGrams: row.weight_grams,
            shippingPolicy: row.shipping_policy,
            allowShippingContracts: row.allow_shipping_contracts,
          }),
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
      const body = deps.MarketCheckoutBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })
      try {
        const snapshot = await buildCheckoutSnapshot(body.data)
        const orderId = await prisma.$transaction((tx: Prisma.TransactionClient) =>
          insertOrderWithItems(tx, snapshot, {
            buyerUserId: buyerId ?? null,
            paymentMethod: 'credit_card',
            paymentStatus: 'requires_payment_method',
          }),
        )

        return reply.code(201).send({
          orderId,
          totals: {
            subtotalCents: snapshot.subtotalCents,
            shippingCents: snapshot.shippingCents,
            taxCents: snapshot.taxCents,
            civilFeeCents: snapshot.civilFeeCents,
            stripeCardFeeCents: snapshot.stripeFeeCents,
            grandTotalCents: snapshot.totalCents,
          },
        })
      } catch (error) {
        const typed = error as { statusCode?: number; payload?: Record<string, unknown> }
        if (typed?.statusCode && typed.payload) {
          return reply.code(typed.statusCode).send(typed.payload)
        }
        throw error
      }
    }),
  )

  app.post('/market/checkout/card/intent', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const body = deps.MarketCheckoutBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      try {
        const snapshot = await buildCheckoutSnapshot(body.data)
        const shopPayments = deps.readOrganizationShopPaymentsState(snapshot.business.metadata)
        if (!shopPayments.stripeConnectAccountId) {
          return reply.code(409).send({ error: 'card_checkout_unavailable' })
        }

        const stripe = deps.getStripeClient()
        let customerId: string | null = null
        let receiptEmail: string | undefined
        let customerSessionClientSecret: string | null = null

        if (buyerId) {
          const customer = await deps.ensureStripeCustomer(buyerId)
          customerId = customer.customerId
          receiptEmail = customer.user?.email ?? undefined
          const customerSession = await (stripe as any).customerSessions.create({
            customer: customerId,
            components: {
              payment_element: {
                enabled: true,
                features: {
                  payment_method_save: 'enabled',
                  payment_method_save_usage: 'off_session',
                  payment_method_redisplay: 'enabled',
                  payment_method_remove: 'enabled',
                },
              },
            },
          })
          customerSessionClientSecret = readStripeCustomerSessionClientSecret(customerSession)
        }

        const orderId = randomUUID()
        const paymentIntent = await stripe.paymentIntents.create({
          amount: snapshot.totalCents,
          currency: String(snapshot.currency || 'cad').toLowerCase(),
          customer: customerId ?? undefined,
          payment_method_types: ['card'],
          setup_future_usage: customerId ? 'off_session' : undefined,
          receipt_email: receiptEmail,
          description: `Civil Market order for ${snapshot.business.name}`,
          application_fee_amount: snapshot.civilFeeCents + snapshot.stripeFeeCents,
          transfer_data: { destination: shopPayments.stripeConnectAccountId },
          metadata: {
            kind: 'shop_order',
            orderId,
            businessId: snapshot.business.id,
            buyerUserId: buyerId ?? '',
            civilFeeCents: String(snapshot.civilFeeCents),
            stripeFeeCents: String(snapshot.stripeFeeCents),
            shippingCents: String(snapshot.shippingCents),
            sellerAmountCents: String(snapshot.sellerAmountCents),
          },
        })

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.$executeRaw`
            INSERT INTO organization_shop_order (
              id,
              business_id,
              buyer_user_id,
              status,
              currency,
              subtotal_cents,
              shipping_cents,
              tax_cents,
              civil_fee_cents,
              stripe_fee_cents,
              fee_cents,
              total_cents,
              shipping_address,
              created_at,
              updated_at
            )
            VALUES (
              ${orderId},
              ${snapshot.business.id},
              ${buyerId ?? null},
              ${'pending'},
              ${snapshot.currency},
              ${snapshot.subtotalCents},
              ${snapshot.shippingCents},
              ${snapshot.taxCents},
              ${snapshot.civilFeeCents},
              ${snapshot.stripeFeeCents},
              ${snapshot.civilFeeCents + snapshot.stripeFeeCents},
              ${snapshot.totalCents},
              ${snapshot.shippingAddress ? JSON.stringify(snapshot.shippingAddress) : null}::jsonb,
              NOW(),
              NOW()
            )
          `

          for (const row of snapshot.resolvedItems) {
            const qty = row.quantity
            await tx.$executeRaw`
              INSERT INTO organization_shop_order_item (id, order_id, product_id, variant_id, name, price_cents, quantity, variant_attributes, fulfillment_type, digital_delivery_url, created_at)
              VALUES (
                ${randomUUID()},
                ${orderId},
                ${row.product.id},
                ${row.variant?.id ?? null},
                ${row.product.name},
                ${row.priceCents},
                ${qty},
                ${JSON.stringify(row.variantAttributes)}::jsonb,
                ${row.product.fulfillment_type || 'physical'},
                ${String(row.product.fulfillment_type || '').toLowerCase() === 'digital' ? row.product.digital_delivery_url ?? null : null},
                NOW()
              )
            `
          }

          await tx.$executeRaw`
            INSERT INTO organization_shop_payment (
              id,
              order_id,
              stripe_payment_intent_id,
              wallet_transaction_id,
              payment_method,
              status,
              amount_cents,
              currency,
              created_at,
              updated_at
            )
            VALUES (
              ${randomUUID()},
              ${orderId},
              ${paymentIntent.id},
              ${null},
              ${'credit_card'},
              ${paymentIntent.status},
              ${snapshot.totalCents},
              ${snapshot.currency},
              NOW(),
              NOW()
            )
          `
        })

        return reply.send({
          orderId,
          clientSecret: paymentIntent.client_secret,
          customerSessionClientSecret,
          paymentIntentId: paymentIntent.id,
          publishableKey: deps.STRIPE_PUBLISHABLE_KEY,
          totals: {
            subtotalCents: snapshot.subtotalCents,
            shippingCents: snapshot.shippingCents,
            taxCents: snapshot.taxCents,
            civilFeeCents: snapshot.civilFeeCents,
            stripeCardFeeCents: snapshot.stripeFeeCents,
            grandTotalCents: snapshot.totalCents,
          },
        })
      } catch (error) {
        const typed = error as { statusCode?: number; payload?: Record<string, unknown> }
        if (typed?.statusCode && typed.payload) {
          return reply.code(typed.statusCode).send(typed.payload)
        }
        throw error
      }
    }),
  )

  app.post('/market/checkout/card/confirm', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const body = z
        .object({
          orderId: z.string().trim().min(1).max(128),
          paymentIntentId: z.string().trim().min(3).max(255),
        })
        .safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })
      await deps.ensureOrganizationShopTables()

      const orderRows = await prisma.$queryRaw<Array<{ id: string; buyer_user_id: string | null }>>`
        SELECT id, buyer_user_id
        FROM organization_shop_order
        WHERE id = ${body.data.orderId}
        LIMIT 1
      `
      const order = orderRows[0]
      if (!order) return reply.code(404).send({ error: 'order_not_found' })
      if (order.buyer_user_id) {
        if (!buyerId || order.buyer_user_id !== buyerId) return reply.code(403).send({ error: 'forbidden' })
      }

      const stripe = deps.getStripeClient()
      const paymentIntent = await stripe.paymentIntents.retrieve(body.data.paymentIntentId)
      if (paymentIntent.metadata?.kind !== 'shop_order' || paymentIntent.metadata?.orderId !== body.data.orderId) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (paymentIntent.status !== 'succeeded') {
        return reply.code(409).send({ error: 'payment_not_completed' })
      }

      const finalization = await finalizePaidShopOrder(prisma, {
        orderId: body.data.orderId,
        paymentStatus: paymentIntent.status,
        stripePaymentIntentId: paymentIntent.id,
      })
      if (finalization.newlyPaid) {
        void notifyShopOrderReceived({ orderId: body.data.orderId, buyerUserId: buyerId }).catch((error) => {
          console.error('market_shop_order_notification_failed', error)
        })
      }

      return reply.send({ ok: true, orderId: body.data.orderId })
    }),
  )

  app.post('/market/checkout/civil-wallet', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const buyerId = (await deps.resolveUserId(req)) ?? undefined
      if (!buyerId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.MarketCheckoutBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      try {
        const snapshot = await buildCheckoutSnapshot(body.data)
        const sellerOwner = await prisma.user.findUnique({
          where: { id: snapshot.business.ownerId },
          select: { id: true, communityMeta: true },
        })
        if (!sellerOwner) return reply.code(404).send({ error: 'organization_owner_not_found' })

        const sellerWallet = readWalletSummary(sellerOwner.communityMeta)
        if (!sellerWallet.enabled || !walletHasConnectPayoutsEnabled(sellerWallet)) {
          return reply.code(409).send({ error: 'civil_wallet_unavailable' })
        }

        const transactionId = randomUUID()
        const eventId = randomUUID()
        const orderId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const freshOwner = await tx.user.findUnique({
            where: { id: sellerOwner.id },
            select: { communityMeta: true },
          })
          const freshOwnerWallet = readWalletSummary(freshOwner?.communityMeta ?? null)
          if (!freshOwnerWallet.enabled || !walletHasConnectPayoutsEnabled(freshOwnerWallet)) {
            throw new Error('civil_wallet_unavailable')
          }

          const orderIdValue = await insertOrderWithItems(tx, snapshot, {
            buyerUserId: buyerId,
            orderStatus: 'pending',
            paymentMethod: 'civil_wallet',
            paymentStatus: 'pending',
            walletTransactionId: transactionId,
          })

          await applyWalletUserTransfer(tx, {
            senderUserId: buyerId,
            recipientUserId: sellerOwner.id,
            amountCents: snapshot.sellerAmountCents,
            feeCents: snapshot.civilFeeCents,
            totalChargeCents: snapshot.sellerAmountCents + snapshot.civilFeeCents,
            transactionId,
            transactionKind: 'market_shop_order_wallet',
            transactionAmountCents: snapshot.sellerAmountCents + snapshot.civilFeeCents,
            transactionCounterpartyUserId: sellerOwner.id,
            transactionMetadata: {
              kind: 'market_shop_order_wallet',
              orderId: orderIdValue,
              businessId: snapshot.business.id,
              subtotalCents: snapshot.subtotalCents,
              shippingCents: snapshot.shippingCents,
              taxCents: snapshot.taxCents,
              civilFeeCents: snapshot.civilFeeCents,
            },
            requireSenderWalletEnabled: true,
            requireRecipientWalletEnabled: true,
            requireRecipientConnectPayouts: true,
            errors: {
              senderWalletDisabled: 'wallet_required',
              recipientWalletUnavailable: 'civil_wallet_unavailable',
              insufficientFunds: 'insufficient_wallet_balance',
            },
            transferLedger: {
              id: `market-shop-order:sale:${transactionId}`,
              eventId,
              sourceType: 'market_shop_order_sale',
              sourceReferenceId: `${transactionId}:sale`,
              description: `Civil Wallet purchase for ${snapshot.business.name}`,
              metadata: { kind: 'market_shop_order_sale', orderId: orderIdValue, businessId: snapshot.business.id, buyerUserId: buyerId, ownerUserId: sellerOwner.id },
            },
            feeLedger: {
              id: `market-shop-order:fee:${transactionId}`,
              eventId,
              sourceType: 'market_shop_order_fee',
              sourceReferenceId: `${transactionId}:fee`,
              description: `Civil Wallet fee for ${snapshot.business.name}`,
              toEntityType: 'platform_wallet',
              toEntityLabel: 'CIVIL',
              toHandle: 'CIVIL',
              toName: 'Civil',
              metadata: { kind: 'market_shop_order_fee', orderId: orderIdValue, businessId: snapshot.business.id, buyerUserId: buyerId, ownerUserId: sellerOwner.id },
            },
          })

          await finalizePaidShopOrder(tx, {
            orderId: orderIdValue,
            paymentStatus: 'succeeded',
            walletTransactionId: transactionId,
          })

          return orderIdValue
        })

        void notifyShopOrderReceived({ orderId, buyerUserId: buyerId }).catch((error) => {
          console.error('market_shop_order_notification_failed', error)
        })

        return reply.send({
          orderId,
          transactionId,
          totals: {
            subtotalCents: snapshot.subtotalCents,
            shippingCents: snapshot.shippingCents,
            taxCents: snapshot.taxCents,
            civilFeeCents: snapshot.civilFeeCents,
            stripeCardFeeCents: 0,
            grandTotalCents: snapshot.sellerAmountCents + snapshot.civilFeeCents,
          },
        })
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'wallet_required') return reply.code(400).send({ error: 'wallet_required' })
          if (error.message === 'civil_wallet_unavailable') return reply.code(409).send({ error: 'civil_wallet_unavailable' })
          if (error.message === 'insufficient_wallet_balance') {
            const buyer = await prisma.user.findUnique({ where: { id: buyerId }, select: { communityMeta: true } })
            const buyerWallet = readWalletSummary(buyer?.communityMeta ?? null)
            return reply.code(400).send({ error: 'insufficient_wallet_balance', availableCreditsCents: buyerWallet.civilCreditsCents })
          }
        }
        const typed = error as { statusCode?: number; payload?: Record<string, unknown> }
        if (typed?.statusCode && typed.payload) {
          return reply.code(typed.statusCode).send(typed.payload)
        }
        throw error
      }
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
        shipping_cents: number
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
          o.shipping_cents,
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
          shippingCents: Number(row.shipping_cents) || 0,
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

      const params = deps.MarketOrderParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureOrganizationShopTables()

      type OrderRow = {
        id: string
        business_id: string
        buyer_user_id: string | null
        status: string
        currency: string
        subtotal_cents: number
        shipping_cents: number
        tax_cents: number
        civil_fee_cents: number
        stripe_fee_cents: number
        fee_cents: number
        total_cents: number
        shipping_address: unknown
        created_at: Date
      }

      const orderVisibilityFilter = buyerId
        ? Prisma.sql`(buyer_user_id = ${buyerId} OR buyer_user_id IS NULL)`
        : Prisma.sql`buyer_user_id IS NULL`

      const orderRows = await prisma.$queryRaw<OrderRow[]>`
        SELECT id, business_id, buyer_user_id, status, currency, subtotal_cents, shipping_cents, tax_cents, civil_fee_cents, stripe_fee_cents, fee_cents, total_cents, shipping_address, created_at
        FROM organization_shop_order
        WHERE id = ${params.data.orderId}
          AND ${orderVisibilityFilter}
        LIMIT 1
      `
      const order = orderRows[0]
      if (!order) return reply.code(404).send({ error: 'order_not_found' })

      type OrderItemRow = {
        id: string
        product_id: string | null
        variant_id: string | null
        name: string
        price_cents: number
        quantity: number
        variant_attributes: unknown
        fulfillment_type: string
        digital_delivery_url: string | null
      }

      const itemRows = await prisma.$queryRaw<OrderItemRow[]>`
        SELECT id, product_id, variant_id, name, price_cents, quantity, variant_attributes, fulfillment_type, digital_delivery_url
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
          shippingCents: Number(order.shipping_cents) || 0,
          taxCents: Number(order.tax_cents) || 0,
          civilFeeCents: Number(order.civil_fee_cents) || 0,
          stripeFeeCents: Number(order.stripe_fee_cents) || 0,
          feeCents: Number(order.fee_cents) || 0,
          totalCents: Number(order.total_cents) || 0,
          shippingAddress: order.shipping_address ?? null,
          createdAt: order.created_at.toISOString(),
        },
        items: itemRows.map((item: OrderItemRow) => ({
          id: item.id,
          productId: item.product_id,
          variantId: item.variant_id,
          name: item.name,
          priceCents: Number(item.price_cents) || 0,
          quantity: Number(item.quantity) || 0,
          variantAttributes: readMarketVariantAttributes(item.variant_attributes),
          fulfillmentType: item.fulfillment_type,
          digitalDeliveryUrl: allowDigitalDelivery && String(item.fulfillment_type || '').toLowerCase() === 'digital' ? item.digital_delivery_url : null,
        })),
      })
    }),
  )
}
