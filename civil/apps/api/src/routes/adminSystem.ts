import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import { ensureCitizenWalletTables } from '../walletHelpers.js'

const AdminIndustryInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminSubIndustryInput = z.object({
  industryId: z.string().cuid(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminIndustryUpdateInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminSubIndustryUpdateInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
})

const AdminIndustryIdParams = z.object({ industryId: z.string().cuid() })
const AdminSubIndustryIdParams = z.object({ subIndustryId: z.string().cuid() })
const AdminWalletSubscriptionsQuery = z.object({
  status: z.enum(['all', 'active', 'paused', 'canceled']).default('active'),
  limit: z.coerce.number().int().min(1).max(250).default(100),
})

const DEFAULT_JOB_TAXONOMY: Array<{
  name: string
  slug: string
  sortOrder: number
  subIndustries: Array<{ name: string; slug: string; sortOrder: number }>
}> = [
  {
    name: 'Technology',
    slug: 'technology',
    sortOrder: 10,
    subIndustries: [
      { name: 'Software Development', slug: 'software-development', sortOrder: 10 },
      { name: 'IT Support', slug: 'it-support', sortOrder: 20 },
      { name: 'Data & AI', slug: 'data-ai', sortOrder: 30 },
    ],
  },
  {
    name: 'Healthcare',
    slug: 'healthcare',
    sortOrder: 20,
    subIndustries: [
      { name: 'Nursing', slug: 'nursing', sortOrder: 10 },
      { name: 'Allied Health', slug: 'allied-health', sortOrder: 20 },
      { name: 'Administration', slug: 'health-admin', sortOrder: 30 },
    ],
  },
  {
    name: 'Education',
    slug: 'education',
    sortOrder: 30,
    subIndustries: [
      { name: 'Teaching', slug: 'teaching', sortOrder: 10 },
      { name: 'Early Childhood', slug: 'early-childhood', sortOrder: 20 },
      { name: 'Academic Support', slug: 'academic-support', sortOrder: 30 },
    ],
  },
  {
    name: 'Government & Public Service',
    slug: 'government-public-service',
    sortOrder: 40,
    subIndustries: [
      { name: 'Administration', slug: 'public-admin', sortOrder: 10 },
      { name: 'Policy', slug: 'policy', sortOrder: 20 },
      { name: 'Community Services', slug: 'community-services', sortOrder: 30 },
    ],
  },
  {
    name: 'Trades & Construction',
    slug: 'trades-construction',
    sortOrder: 50,
    subIndustries: [
      { name: 'Skilled Trades', slug: 'skilled-trades', sortOrder: 10 },
      { name: 'General Labour', slug: 'general-labour', sortOrder: 20 },
      { name: 'Project Management', slug: 'construction-pm', sortOrder: 30 },
    ],
  },
  {
    name: 'Sales & Marketing',
    slug: 'sales-marketing',
    sortOrder: 60,
    subIndustries: [
      { name: 'Sales', slug: 'sales', sortOrder: 10 },
      { name: 'Marketing', slug: 'marketing', sortOrder: 20 },
      { name: 'Customer Success', slug: 'customer-success', sortOrder: 30 },
    ],
  },
  {
    name: 'Operations & Logistics',
    slug: 'operations-logistics',
    sortOrder: 70,
    subIndustries: [
      { name: 'Operations', slug: 'operations', sortOrder: 10 },
      { name: 'Supply Chain', slug: 'supply-chain', sortOrder: 20 },
      { name: 'Warehouse', slug: 'warehouse', sortOrder: 30 },
    ],
  },
]

type AdminUser = { id: string; email: string | null }

type AdminSystemDeps = {
  buildAdminChecklist: () => unknown
  isStripeConfigured: () => boolean
  isSuperAdminEmail: (email?: string | null) => boolean
  loadAdminUserOrReply: (req: FastifyRequest, reply: FastifyReply) => Promise<AdminUser | null>
  loadAuthenticatedUser: (req: FastifyRequest) => Promise<{ id: string; email: string | null; name: string | null } | null>
}

export function registerAdminSystemRoutes(app: FastifyInstance, deps: AdminSystemDeps) {
  app.get('/admin/env', async (req: FastifyRequest, reply: FastifyReply) => {
    let user: { id: string; email: string | null; name: string | null } | null
    try {
      user = await deps.loadAuthenticatedUser(req)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (!user || !deps.isSuperAdminEmail(user.email)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const envSources = (process.env.CIVIL_ENV_FILES || '')
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean)
    const primarySource = process.env.CIVIL_ENV_PRIMARY?.trim() || envSources.at(-1) || null
    const label = process.env.CIVIL_ENV_LABEL?.trim() || (process.env.NODE_ENV === 'production' ? 'production' : 'development')

    return reply.send({
      env: {
        label,
        primarySource,
        sources: envSources,
        nodeEnv: process.env.NODE_ENV || null,
        projectName: process.env.COMPOSE_PROJECT_NAME || null,
      },
      stripeEnabled: deps.isStripeConfigured(),
      checklist: deps.buildAdminChecklist(),
      generatedAt: new Date().toISOString(),
    })
  })

  app.get('/admin/geodata', async (req: FastifyRequest, reply: FastifyReply) => {
    let user: { id: string; email: string | null } | null
    try {
      user = await deps.loadAuthenticatedUser(req)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (!user || !deps.isSuperAdminEmail(user.email)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const [divisionStats, subdivisionStats, fsaStats] = await Promise.all([
      prisma.censusDivision.aggregate({ _count: true, _max: { updatedAt: true } }),
      prisma.censusSubdivision.aggregate({ _count: true, _max: { updatedAt: true } }),
      prisma.forwardSortationArea.aggregate({ _count: true, _max: { updatedAt: true } }),
    ])

    return reply.send({
      generatedAt: new Date().toISOString(),
      datasets: [
        {
          key: 'divisions',
          label: 'Census divisions',
          count: divisionStats._count ?? 0,
          lastUpdatedAt: divisionStats._max?.updatedAt?.toISOString() ?? null,
        },
        {
          key: 'subdivisions',
          label: 'Census subdivisions',
          count: subdivisionStats._count ?? 0,
          lastUpdatedAt: subdivisionStats._max?.updatedAt?.toISOString() ?? null,
        },
        {
          key: 'fsas',
          label: 'Forward sortation areas',
          count: fsaStats._count ?? 0,
          lastUpdatedAt: fsaStats._max?.updatedAt?.toISOString() ?? null,
        },
      ],
    })
  })

  app.get('/admin/wallet', async (req: FastifyRequest, reply: FastifyReply) => {
    let user: { id: string; email: string | null; name: string | null } | null
    try {
      user = await deps.loadAuthenticatedUser(req)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (!user || !deps.isSuperAdminEmail(user.email)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    await ensureCitizenWalletTables()

    const [platformRows, escrowRows] = await Promise.all([
      prisma.$queryRaw<Array<{ balance_cents: number }>>`
        SELECT (
          COALESCE(SUM(CASE WHEN to_entity_type = 'platform' AND status = 'completed' THEN amount_cents ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN from_entity_type = 'platform' AND status = 'completed' THEN amount_cents ELSE 0 END), 0)
        )::int AS balance_cents
        FROM civil_credit_ledger
      `,
      prisma.$queryRaw<Array<{ holding_cents: number; escrow_count: number }>>`
        SELECT
          COALESCE(SUM(amount_cents), 0)::int AS holding_cents,
          COUNT(*)::int AS escrow_count
        FROM citizen_wallet_transaction
        WHERE kind = ${'drive_ride_escrow'}
          AND status = ${'pending'}
      `,
    ])

    const platform = platformRows[0] ?? { balance_cents: 0 }
    const escrow = escrowRows[0] ?? { holding_cents: 0, escrow_count: 0 }

    return reply.send({
      wallet: {
        balanceCents: Math.max(0, Number(platform.balance_cents) || 0),
        inEscrowHoldingCents: Math.max(0, Number(escrow.holding_cents) || 0),
        activeEscrowCount: Math.max(0, Number(escrow.escrow_count) || 0),
      },
      generatedAt: new Date().toISOString(),
    })
  })

  app.get('/admin/wallet/subscriptions', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const query = AdminWalletSubscriptionsQuery.safeParse(req.query ?? {})
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() })
    }

    await ensureCitizenWalletTables()

    const statusFilter = query.data.status === 'all' ? Prisma.empty : Prisma.sql`AND sub.status = ${query.data.status}`
    const [summaryRows, itemRows] = await Promise.all([
      prisma.$queryRaw<Array<{
        active_count: number
        paused_count: number
        canceled_count: number
        active_amount_cents: number
        due_count: number
      }>>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
          COUNT(*) FILTER (WHERE status = 'paused')::int AS paused_count,
          COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled_count,
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'active'), 0)::int AS active_amount_cents,
          COUNT(*) FILTER (WHERE status = 'active' AND next_charge_at IS NOT NULL AND next_charge_at <= NOW())::int AS due_count
        FROM civil_cause_subscription
      `,
      prisma.$queryRaw<Array<{
        id: string
        amount_cents: number
        interval_unit: string
        status: string
        next_charge_at: Date | null
        last_charge_at: Date | null
        paused_at: Date | null
        canceled_at: Date | null
        created_at: Date
        updated_at: Date
        post_id: string
        post_title: string | null
        post_slug: string | null
        province_code: string | null
        community_slug: string | null
        subscriber_id: string
        subscriber_handle: string | null
        subscriber_name: string | null
        subscriber_email: string | null
        recipient_id: string
        recipient_handle: string | null
        recipient_name: string | null
        recipient_email: string | null
      }>>(
        Prisma.sql`
          SELECT
            sub.id,
            sub.amount_cents,
            sub.interval_unit,
            sub.status,
            sub.next_charge_at,
            sub.last_charge_at,
            sub.paused_at,
            sub.canceled_at,
            sub.created_at,
            sub.updated_at,
            post.id AS post_id,
            post.title AS post_title,
            post."seoSlug" AS post_slug,
            post."provinceCode" AS province_code,
            post."communitySlug" AS community_slug,
            subscriber.id AS subscriber_id,
            subscriber.handle AS subscriber_handle,
            subscriber.name AS subscriber_name,
            subscriber.email AS subscriber_email,
            recipient.id AS recipient_id,
            recipient.handle AS recipient_handle,
            recipient.name AS recipient_name,
            recipient.email AS recipient_email
          FROM civil_cause_subscription sub
          JOIN "Post" post ON post.id = sub.post_id
          JOIN "User" subscriber ON subscriber.id = sub.subscriber_user_id
          JOIN "User" recipient ON recipient.id = sub.recipient_user_id
          WHERE 1 = 1
          ${statusFilter}
          ORDER BY
            CASE sub.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
            sub.next_charge_at ASC NULLS LAST,
            sub.updated_at DESC
          LIMIT ${query.data.limit}
        `,
      ),
    ])

    const summary = summaryRows[0] ?? {
      active_count: 0,
      paused_count: 0,
      canceled_count: 0,
      active_amount_cents: 0,
      due_count: 0,
    }

    return reply.send({
      summary: {
        activeCount: Math.max(0, Number(summary.active_count) || 0),
        pausedCount: Math.max(0, Number(summary.paused_count) || 0),
        canceledCount: Math.max(0, Number(summary.canceled_count) || 0),
        activeAmountCents: Math.max(0, Number(summary.active_amount_cents) || 0),
        dueCount: Math.max(0, Number(summary.due_count) || 0),
      },
      items: itemRows.map((row) => ({
        id: row.id,
        amountCents: Math.max(0, Number(row.amount_cents) || 0),
        intervalUnit: row.interval_unit === 'monthly' ? 'monthly' : row.interval_unit,
        status: row.status,
        nextChargeAt: row.next_charge_at?.toISOString() ?? null,
        lastChargeAt: row.last_charge_at?.toISOString() ?? null,
        pausedAt: row.paused_at?.toISOString() ?? null,
        canceledAt: row.canceled_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        post: {
          id: row.post_id,
          title: row.post_title,
          slug: row.post_slug,
          path:
            row.province_code && row.community_slug && row.post_slug
              ? `/${row.province_code.toLowerCase()}/${row.community_slug.toLowerCase()}/causes/${row.post_slug}`
              : row.recipient_handle && row.post_slug
                ? `/u/${row.recipient_handle}/posts/${row.post_slug}`
                : null,
        },
        subscriber: {
          id: row.subscriber_id,
          handle: row.subscriber_handle,
          name: row.subscriber_name,
          email: row.subscriber_email,
        },
        recipient: {
          id: row.recipient_id,
          handle: row.recipient_handle,
          name: row.recipient_name,
          email: row.recipient_email,
        },
      })),
      generatedAt: new Date().toISOString(),
    })
  })

  app.get('/admin/jobs/taxonomy', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const industries = await prisma.jobIndustry.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        subIndustries: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    })

    return reply.send({
      items: industries.map((industry: Prisma.JobIndustryGetPayload<{ include: { subIndustries: true } }>) => ({
        id: industry.id,
        name: industry.name,
        slug: industry.slug,
        description: industry.description,
        sortOrder: industry.sortOrder,
        active: industry.active,
        subIndustries: industry.subIndustries.map((subIndustry: Prisma.JobSubIndustryGetPayload<{}>) => ({
          id: subIndustry.id,
          industryId: subIndustry.industryId,
          name: subIndustry.name,
          slug: subIndustry.slug,
          description: subIndustry.description,
          sortOrder: subIndustry.sortOrder,
          active: subIndustry.active,
        })),
      })),
    })
  })

  app.post('/admin/jobs/seed', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const now = new Date()
    let industriesInserted = 0
    let subIndustriesInserted = 0

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const industrySeed of DEFAULT_JOB_TAXONOMY) {
        const existingIndustry = await tx.jobIndustry.findUnique({ where: { slug: industrySeed.slug }, select: { id: true } })
        let industryId = existingIndustry?.id
        if (!industryId) {
          const insertedIndustry = await tx.jobIndustry.create({
            data: {
              name: industrySeed.name,
              slug: industrySeed.slug,
              sortOrder: industrySeed.sortOrder,
              active: true,
            },
            select: { id: true },
          })
          industryId = insertedIndustry.id
          industriesInserted += 1
        }

        for (const subSeed of industrySeed.subIndustries) {
          const existingSub = await tx.jobSubIndustry.findFirst({
            where: {
              industryId,
              slug: subSeed.slug,
            },
            select: { id: true },
          })
          if (!existingSub) {
            await tx.jobSubIndustry.create({
              data: {
                industryId,
                name: subSeed.name,
                slug: subSeed.slug,
                sortOrder: subSeed.sortOrder,
                active: true,
              },
            })
            subIndustriesInserted += 1
          }
        }
      }

      await tx.$executeRaw`
        UPDATE "JobIndustry"
        SET "updatedAt" = ${now}
        WHERE "id" IN (
          SELECT "id" FROM "JobIndustry"
        )
      `
    })

    return reply.send({ ok: true, industriesInserted, subIndustriesInserted })
  })

  app.post('/admin/jobs/industries', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const body = AdminIndustryInput.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const slug = body.data.slug.trim().toLowerCase()
    const duplicate = await prisma.jobIndustry.findUnique({ where: { slug }, select: { id: true } })
    if (duplicate) return reply.code(409).send({ error: 'industry_slug_exists' })

    const created = await prisma.jobIndustry.create({
      data: {
        name: body.data.name.trim(),
        slug,
        description: body.data.description?.trim() || null,
        sortOrder: body.data.sortOrder,
        active: body.data.active,
      },
      select: { id: true },
    })

    return reply.code(201).send({ id: created.id })
  })

  app.put('/admin/jobs/industries/:industryId', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const params = AdminIndustryIdParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = AdminIndustryUpdateInput.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const slug = body.data.slug.trim().toLowerCase()
    const duplicate = await prisma.jobIndustry.findFirst({
      where: { slug, id: { not: params.data.industryId } },
      select: { id: true },
    })
    if (duplicate) return reply.code(409).send({ error: 'industry_slug_exists' })

    const updated = await prisma.jobIndustry.updateMany({
      where: { id: params.data.industryId },
      data: {
        name: body.data.name.trim(),
        slug,
        description: body.data.description?.trim() || null,
        sortOrder: body.data.sortOrder,
        active: body.data.active,
        updatedAt: new Date(),
      },
    })
    if (!updated.count) return reply.code(404).send({ error: 'industry_not_found' })

    return reply.send({ ok: true })
  })

  app.post('/admin/jobs/sub-industries', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const body = AdminSubIndustryInput.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const parent = await prisma.jobIndustry.findUnique({ where: { id: body.data.industryId }, select: { id: true } })
    if (!parent) return reply.code(404).send({ error: 'industry_not_found' })

    const slug = body.data.slug.trim().toLowerCase()
    const duplicate = await prisma.jobSubIndustry.findFirst({
      where: { industryId: body.data.industryId, slug },
      select: { id: true },
    })
    if (duplicate) return reply.code(409).send({ error: 'sub_industry_slug_exists' })

    const created = await prisma.jobSubIndustry.create({
      data: {
        industryId: body.data.industryId,
        name: body.data.name.trim(),
        slug,
        description: body.data.description?.trim() || null,
        sortOrder: body.data.sortOrder,
        active: body.data.active,
      },
      select: { id: true },
    })

    return reply.code(201).send({ id: created.id })
  })

  app.put('/admin/jobs/sub-industries/:subIndustryId', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const params = AdminSubIndustryIdParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = AdminSubIndustryUpdateInput.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const existing = await prisma.jobSubIndustry.findUnique({
      where: { id: params.data.subIndustryId },
      select: { id: true, industryId: true },
    })
    if (!existing) return reply.code(404).send({ error: 'sub_industry_not_found' })

    const slug = body.data.slug.trim().toLowerCase()
    const duplicate = await prisma.jobSubIndustry.findFirst({
      where: {
        industryId: existing.industryId,
        slug,
        id: { not: params.data.subIndustryId },
      },
      select: { id: true },
    })
    if (duplicate) return reply.code(409).send({ error: 'sub_industry_slug_exists' })

    const updated = await prisma.jobSubIndustry.updateMany({
      where: { id: params.data.subIndustryId },
      data: {
        name: body.data.name.trim(),
        slug,
        description: body.data.description?.trim() || null,
        sortOrder: body.data.sortOrder,
        active: body.data.active,
        updatedAt: new Date(),
      },
    })
    if (!updated.count) return reply.code(404).send({ error: 'sub_industry_not_found' })

    return reply.send({ ok: true })
  })
}
