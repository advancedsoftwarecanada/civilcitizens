import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import sanitizeHtml from 'sanitize-html'
import { prisma } from '@civil/db'
import { BusinessRole, MessageParticipantRole, MessageThreadType, Prisma } from '@prisma/client'
import { buildWalletMetaValue, ensureCitizenWalletTables, insertCivilCreditLedgerEntry, readBaseJsonObject, readWalletSummary } from '../walletHelpers.js'

type JobRouteDeps = Record<string, any>

const OPEN_ENDED_JOB_EXPIRES_AT = new Date('2100-01-01T00:00:00.000Z')
const JOB_BOOST_COST_CENTS = 1000
const JOB_BOOST_IMPRESSION_CAP = 1000
const JOB_BOOST_DURATION_DAYS = 7

export function registerJobRoutes(app: FastifyInstance, deps: JobRouteDeps) {
  app.get('/feed/activity', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = deps.FeedActivityQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const viewerId = await deps.resolveUserId(req)
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const viewerFeedContext = await deps.loadViewerFeedContext(viewerId)
      const targets = deps.resolveFeedActivityTargets({
        scope: query.data.scope,
        context: viewerFeedContext,
        province: query.data.province,
        community: query.data.community,
      })

      if ('error' in targets) {
        return reply.code(targets.error === 'invalid_province' ? 400 : 404).send({ error: targets.error })
      }

      const [events, jobs] = await Promise.all([
        deps.loadFeedActivityEvents({
          communityKeys: targets.communityKeys,
          organizationIds: targets.organizationIds,
          limit: query.data.eventLimit,
        }),
        deps.loadFeedActivityJobs({
          communityKeys: targets.communityKeys,
          organizationIds: targets.organizationIds,
          limit: query.data.jobLimit,
        }),
      ])
      const items = deps.mixFeedActivityItems({ events, jobs, scope: query.data.scope, context: viewerFeedContext })

      return reply.send({
        events,
        jobs,
        items,
        context: {
          scope: query.data.scope,
          communityCount: targets.communityKeys.length,
          organizationCount: targets.organizationIds.length,
        },
      })
    }),
  )

  app.get('/work/jobs', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = deps.JobListQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const now = new Date()

      await prisma.$executeRaw`
        UPDATE "JobPromotion"
        SET "status" = 'ended'::"JobPromotionStatus", "updatedAt" = NOW()
        WHERE "status" = 'active'::"JobPromotionStatus"
          AND ("endsAt" <= ${now} OR "impressionsServed" >= "impressionCap")
      `

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          jp."id",
          jp."title",
          jp."slug",
          jp."status",
          jp."employmentType",
          jp."salaryMin",
          jp."salaryMax",
          jp."salaryCurrency",
          jp."salaryPeriod",
          jp."description",
          jp."photoUrl",
          jp."duties",
          jp."roleRequirements",
          jp."locationType",
          jp."locationProvinceCode",
          jp."locationCommunitySlug",
          jp."locationLabel",
          jp."industryId",
          ji."name" as "industryName",
          ji."slug" as "industrySlug",
          jp."subIndustryId",
          jsi."name" as "subIndustryName",
          jsi."slug" as "subIndustrySlug",
          jp."applicantCount",
          jp."createdAt",
          jp."updatedAt",
          jp."publishedAt",
          jp."expiresAt",
          b."id" as "businessId",
          b."name" as "businessName",
          b."slug" as "businessSlug",
          b."provinceCode" as "businessProvinceCode",
          b."communitySlug" as "businessCommunitySlug",
          b."logoUrl" as "businessLogoUrl",
          b."coverUrl" as "businessCoverUrl",
          (
            SELECT prm."id"
            FROM "JobPromotion" prm
            WHERE prm."jobPostingId" = jp."id"
              AND prm."status" = 'active'::"JobPromotionStatus"
              AND prm."startsAt" <= ${now}
              AND prm."endsAt" > ${now}
              AND prm."impressionsServed" < prm."impressionCap"
            ORDER BY prm."createdAt" DESC
            LIMIT 1
          ) as "activePromotionId"
        FROM "JobPosting" jp
        JOIN "Business" b ON b."id" = jp."businessId"
        JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
        LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
        WHERE jp."status" = 'active'::"JobStatus"
          AND jp."publishedAt" IS NOT NULL
          ${query.data.q ? Prisma.sql`AND (jp."title" ILIKE ${`%${query.data.q}%`} OR jp."description" ILIKE ${`%${query.data.q}%`})` : Prisma.empty}
          ${query.data.provinceCode ? Prisma.sql`AND jp."locationProvinceCode" = ${query.data.provinceCode.toUpperCase()}` : Prisma.empty}
          ${query.data.communitySlug ? Prisma.sql`AND jp."locationCommunitySlug" = ${query.data.communitySlug.toLowerCase()}` : Prisma.empty}
          ${query.data.industrySlug ? Prisma.sql`AND ji."slug" = ${query.data.industrySlug.toLowerCase()}` : Prisma.empty}
          ${query.data.subIndustrySlug ? Prisma.sql`AND jsi."slug" = ${query.data.subIndustrySlug.toLowerCase()}` : Prisma.empty}
          ${query.data.employmentType ? Prisma.sql`AND jp."employmentType" = ${query.data.employmentType}::"JobEmploymentType"` : Prisma.empty}
        ORDER BY
          CASE WHEN (
            SELECT COUNT(*)
            FROM "JobPromotion" prm2
            WHERE prm2."jobPostingId" = jp."id"
              AND prm2."status" = 'active'::"JobPromotionStatus"
              AND prm2."startsAt" <= ${now}
              AND prm2."endsAt" > ${now}
              AND prm2."impressionsServed" < prm2."impressionCap"
          ) > 0 THEN 0 ELSE 1 END,
          jp."publishedAt" DESC NULLS LAST,
          jp."createdAt" DESC
        LIMIT ${query.data.limit}
      `)) as any[]

      const sponsored: any[] = []
      const items: any[] = []
      const rowJobIds = rows.map((row: any) => row.id)
      const userId = (req as any).user?.id as string | undefined
      let appliedJobIds: string[] = []

      if (userId && rowJobIds.length > 0) {
        const appliedRows = (await prisma.$queryRaw(Prisma.sql`
          SELECT DISTINCT ja."jobPostingId"
          FROM "JobApplication" ja
          WHERE ja."applicantUserId" = ${userId}
            AND ja."jobPostingId" IN (${Prisma.join(rowJobIds)})
        `)) as Array<{ jobPostingId: string }>
        appliedJobIds = appliedRows.map((row) => row.jobPostingId)
      }

      rows.forEach((row: any) => {
        const mapped = deps.mapJobListRow(row)
        if (mapped.sponsored) sponsored.push(mapped)
        else items.push(mapped)
      })

      return reply.send({ sponsored, items, appliedJobIds })
    }),
  )

  app.get('/work/applications', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = deps.WorkApplicationsQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          ja."id",
          ja."status",
          ja."createdAt",
          ja."jobPostingId",
          jp."title" as "jobTitle",
          jp."photoUrl" as "jobPhotoUrl",
          jp."status" as "jobStatus",
          jp."expiresAt" as "jobExpiresAt",
          b."name" as "businessName",
          b."slug" as "businessSlug",
          b."provinceCode" as "businessProvinceCode",
          b."communitySlug" as "businessCommunitySlug",
          b."logoUrl" as "businessLogoUrl",
          b."coverUrl" as "businessCoverUrl"
        FROM "JobApplication" ja
        JOIN "JobPosting" jp ON jp."id" = ja."jobPostingId"
        JOIN "Business" b ON b."id" = jp."businessId"
        WHERE ja."applicantUserId" = ${userId}
        ${query.data.jobId ? Prisma.sql`AND ja."jobPostingId" = ${query.data.jobId}` : Prisma.empty}
        ORDER BY ja."createdAt" DESC
        LIMIT ${query.data.limit}
      `)) as any[]

      return reply.send({
        items: rows.map((row: any) => ({
          id: row.id,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          job: {
            id: row.jobPostingId,
            title: row.jobTitle,
            photoUrl: deps.normalizeMediaUrl(row.jobPhotoUrl),
            status: row.jobStatus,
            expiresAt: row.jobExpiresAt.toISOString(),
            organization: {
              name: row.businessName,
              slug: row.businessSlug,
              provinceCode: row.businessProvinceCode,
              communitySlug: row.businessCommunitySlug,
              logoUrl: deps.normalizeMediaUrl(row.businessLogoUrl),
              coverUrl: deps.normalizeMediaUrl(row.businessCoverUrl),
            },
          },
        })),
      })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/jobs', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const query = deps.OrgJobListQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const orgResult = await deps.resolveOrgManagerOrOwner({
        province: params.data.province,
        municipality: params.data.municipality,
        slug: params.data.slug,
        userId: (req as any).user?.id as string,
      })
      if ('error' in orgResult && orgResult.error !== 'forbidden') {
        // Fall back to public org lookup for listing.
        const org = await prisma.business.findFirst({
          where: { slug: params.data.slug.trim().toLowerCase() },
          select: { id: true, ownerId: true },
        })
        if (!org) return reply.code(404).send({ error: 'organization_not_found' })
        const includeDraftsRequested = query.data.includeDrafts
        let canManage = false
        if (includeDraftsRequested) {
          const userId = (req as any).user?.id as string | undefined
          if (userId) {
            const membership = await prisma.businessMembership.findUnique({
              where: { businessId_userId: { businessId: org.id, userId } },
              select: { role: true },
            })
            canManage = org.ownerId === userId || membership?.role === 'MANAGER'
          }
        }
        const now = new Date()
        const rows = (await prisma.$queryRaw(Prisma.sql`
          SELECT
            jp."id", jp."title", jp."slug", jp."status", jp."employmentType", jp."salaryMin", jp."salaryMax",
            jp."salaryCurrency", jp."salaryPeriod", jp."description", jp."photoUrl", jp."duties", jp."roleRequirements",
            jp."locationType", jp."locationProvinceCode", jp."locationCommunitySlug", jp."locationLabel", jp."industryId",
            ji."name" as "industryName", ji."slug" as "industrySlug", jp."subIndustryId", jsi."name" as "subIndustryName",
            jsi."slug" as "subIndustrySlug", jp."applicantCount", jp."createdAt", jp."updatedAt", jp."publishedAt", jp."expiresAt",
            b."id" as "businessId", b."name" as "businessName", b."slug" as "businessSlug", b."provinceCode" as "businessProvinceCode",
            b."communitySlug" as "businessCommunitySlug", b."logoUrl" as "businessLogoUrl", b."coverUrl" as "businessCoverUrl",
            (
              SELECT prm."id" FROM "JobPromotion" prm
              WHERE prm."jobPostingId" = jp."id" AND prm."status" = 'active'::"JobPromotionStatus"
                AND prm."startsAt" <= ${now} AND prm."endsAt" > ${now} AND prm."impressionsServed" < prm."impressionCap"
              ORDER BY prm."createdAt" DESC LIMIT 1
            ) as "activePromotionId"
          FROM "JobPosting" jp
          JOIN "Business" b ON b."id" = jp."businessId"
          JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
          LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
          WHERE jp."businessId" = ${org.id}
          ${includeDraftsRequested && canManage ? Prisma.empty : Prisma.sql`AND jp."status" = 'active'::"JobStatus" AND jp."publishedAt" IS NOT NULL`}
          ORDER BY jp."createdAt" DESC
          LIMIT ${query.data.limit}
        `)) as any[]
        return reply.send({ items: rows.map((row: any) => deps.mapJobListRow(row)), canManage: includeDraftsRequested ? canManage : undefined })
      }

      const org = 'org' in orgResult ? orgResult.org : null
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })
      const includeDraftsRequested = query.data.includeDrafts
      let canManage = false
      if (includeDraftsRequested) {
        const userId = (req as any).user?.id as string | undefined
        if (userId) {
          const membership = await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: org.id, userId } },
            select: { role: true },
          })
          canManage = org.ownerId === userId || membership?.role === 'MANAGER'
        }
      }
      const now = new Date()
      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          jp."id", jp."title", jp."slug", jp."status", jp."employmentType", jp."salaryMin", jp."salaryMax",
          jp."salaryCurrency", jp."salaryPeriod", jp."description", jp."photoUrl", jp."duties", jp."roleRequirements",
          jp."locationType", jp."locationProvinceCode", jp."locationCommunitySlug", jp."locationLabel", jp."industryId",
          ji."name" as "industryName", ji."slug" as "industrySlug", jp."subIndustryId", jsi."name" as "subIndustryName",
          jsi."slug" as "subIndustrySlug", jp."applicantCount", jp."createdAt", jp."updatedAt", jp."publishedAt", jp."expiresAt",
          b."id" as "businessId", b."name" as "businessName", b."slug" as "businessSlug", b."provinceCode" as "businessProvinceCode",
          b."communitySlug" as "businessCommunitySlug", b."logoUrl" as "businessLogoUrl", b."coverUrl" as "businessCoverUrl",
          (
            SELECT prm."id" FROM "JobPromotion" prm
            WHERE prm."jobPostingId" = jp."id" AND prm."status" = 'active'::"JobPromotionStatus"
              AND prm."startsAt" <= ${now} AND prm."endsAt" > ${now} AND prm."impressionsServed" < prm."impressionCap"
            ORDER BY prm."createdAt" DESC LIMIT 1
          ) as "activePromotionId"
        FROM "JobPosting" jp
        JOIN "Business" b ON b."id" = jp."businessId"
        JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
        LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
        WHERE jp."businessId" = ${org.id}
        ${includeDraftsRequested && canManage ? Prisma.empty : Prisma.sql`AND jp."status" = 'active'::"JobStatus" AND jp."publishedAt" IS NOT NULL`}
        ORDER BY jp."createdAt" DESC
        LIMIT ${query.data.limit}
      `)) as any[]

      return reply.send({ items: rows.map((row: any) => deps.mapJobListRow(row)), canManage: includeDraftsRequested ? canManage : undefined })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/jobs/draft', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const industryRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "JobIndustry" WHERE "active" = true ORDER BY "sortOrder" ASC, "name" ASC LIMIT 1
      `
      const industryId = industryRows[0]?.id
      if (!industryId) return reply.code(400).send({ error: 'industry_required' })
      const now = new Date()
      const inserted = (await prisma.$queryRaw(Prisma.sql`
        INSERT INTO "JobPosting" (
          "id", "businessId", "createdByUserId", "title", "slug", "employmentType", "salaryCurrency", "duties", "roleRequirements", "description",
          "locationType", "locationProvinceCode", "locationCommunitySlug", "locationLabel", "industryId", "status", "publishedAt", "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${orgResult.org.id}, ${userId}, 'Untitled job', ${`draft-${deps.randomSlugSuffix()}`}, 'full_time'::"JobEmploymentType",
          'CAD', '<p>Describe responsibilities.</p>', '<p>Describe requirements.</p>', null,
          'community'::"JobWorkplaceType", null, null, ${params.data.municipality.replace(/-/g, ' ')}, ${industryId}, 'draft'::"JobStatus", null, ${OPEN_ENDED_JOB_EXPIRES_AT}, ${now}, ${now}
        ) RETURNING "id"
      `)) as Array<{ id: string }>
      const jobId = inserted[0]?.id
      if (!jobId) return reply.code(500).send({ error: 'draft_create_failed' })
      try {
        await deps.trackJobAnalyticsEvent({ kind: 'job_added', businessId: orgResult.org.id, jobPostingId: jobId, actorUserId: userId, createdAt: now })
      } catch (err) {
        req.log.warn({ err, jobId }, 'job_analytics_track_failed')
      }
      return reply.code(201).send({ id: jobId })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const now = new Date()
      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT jp."id", jp."title", jp."slug", jp."status", jp."employmentType", jp."salaryMin", jp."salaryMax", jp."salaryCurrency", jp."salaryPeriod",
          jp."description", jp."photoUrl", jp."duties", jp."roleRequirements", jp."locationType", jp."locationProvinceCode", jp."locationCommunitySlug",
          jp."locationLabel", jp."industryId", ji."name" as "industryName", ji."slug" as "industrySlug", jp."subIndustryId", jsi."name" as "subIndustryName",
          jsi."slug" as "subIndustrySlug", jp."applicantCount", jp."createdAt", jp."updatedAt", jp."publishedAt", jp."expiresAt", b."id" as "businessId",
          b."name" as "businessName", b."slug" as "businessSlug", b."provinceCode" as "businessProvinceCode", b."communitySlug" as "businessCommunitySlug",
          b."logoUrl" as "businessLogoUrl", b."coverUrl" as "businessCoverUrl",
          (SELECT prm."id" FROM "JobPromotion" prm WHERE prm."jobPostingId" = jp."id" AND prm."status" = 'active'::"JobPromotionStatus" AND prm."startsAt" <= ${now} AND prm."endsAt" > ${now} AND prm."impressionsServed" < prm."impressionCap" ORDER BY prm."createdAt" DESC LIMIT 1) as "activePromotionId",
          (SELECT COALESCE(SUM(prm."impressionsServed"), 0)::int FROM "JobPromotion" prm WHERE prm."jobPostingId" = jp."id") as "totalImpressionsServed",
          (SELECT COALESCE(SUM(prm."impressionsServed"), 0)::int FROM "JobPromotion" prm WHERE prm."jobPostingId" = jp."id") as "totalViews",
          (SELECT prm."impressionCap"::int FROM "JobPromotion" prm WHERE prm."jobPostingId" = jp."id" AND prm."status" = 'active'::"JobPromotionStatus" AND prm."startsAt" <= ${now} AND prm."endsAt" > ${now} AND prm."impressionsServed" < prm."impressionCap" ORDER BY prm."createdAt" DESC LIMIT 1) as "activeImpressionCap"
        FROM "JobPosting" jp
        JOIN "Business" b ON b."id" = jp."businessId"
        JOIN "JobIndustry" ji ON ji."id" = jp."industryId"
        LEFT JOIN "JobSubIndustry" jsi ON jsi."id" = jp."subIndustryId"
        WHERE jp."id" = ${params.data.jobId} AND jp."businessId" = ${orgResult.org.id}
        LIMIT 1
      `)) as any[]
      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'job_not_found' })
      return reply.send({ job: deps.mapJobListRow(row) })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.UpdateJobBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const now = new Date()
      const industry = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobIndustry" WHERE "id" = ${body.data.industryId} AND "active" = true LIMIT 1`
      if (!industry.length) return reply.code(400).send({ error: 'invalid_industry' })
      if (body.data.subIndustryId) {
        const sub = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobSubIndustry" WHERE "id" = ${body.data.subIndustryId} AND "industryId" = ${body.data.industryId} AND "active" = true LIMIT 1`
        if (!sub.length) return reply.code(400).send({ error: 'invalid_sub_industry' })
      }
      const location = deps.parseStructuredJobLocation(body.data.location)
      const normalizedDescription = body.data.description?.trim() || body.data.duties.trim()
      const normalizedRoleRequirements = body.data.roleRequirements?.trim() || normalizedDescription
      const updated = await prisma.$executeRaw`
        UPDATE "JobPosting"
        SET "title" = ${body.data.title.trim()}, "employmentType" = ${body.data.employmentType}::"JobEmploymentType", "salaryMin" = ${body.data.salaryMin ?? null},
          "salaryMax" = ${body.data.salaryMax ?? null}, "salaryCurrency" = ${body.data.salaryCurrency.toUpperCase()}, "salaryPeriod" = ${body.data.salaryPeriod ?? null},
          "duties" = ${normalizedDescription}, "roleRequirements" = ${normalizedRoleRequirements}, "description" = ${normalizedDescription}, "photoUrl" = ${body.data.photoUrl?.trim() ?? null},
          "locationType" = ${location.locationType}::"JobWorkplaceType", "locationProvinceCode" = ${location.locationProvinceCode}, "locationCommunitySlug" = ${location.locationCommunitySlug}, "locationLabel" = ${location.locationLabel},
          "industryId" = ${body.data.industryId}, "subIndustryId" = ${body.data.subIndustryId ?? null}, "expiresAt" = ${OPEN_ENDED_JOB_EXPIRES_AT}, "updatedAt" = ${now}
        WHERE "id" = ${params.data.jobId} AND "businessId" = ${orgResult.org.id}
      `
      if (!updated) return reply.code(404).send({ error: 'job_not_found' })
      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/publish', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const now = new Date()
      const updated = await prisma.$executeRaw`
        UPDATE "JobPosting"
        SET "status" = 'active'::"JobStatus", "publishedAt" = COALESCE("publishedAt", ${now}), "expiresAt" = ${OPEN_ENDED_JOB_EXPIRES_AT}, "updatedAt" = ${now}
        WHERE "id" = ${params.data.jobId} AND "businessId" = ${orgResult.org.id}
      `
      if (!updated) return reply.code(404).send({ error: 'job_not_found' })
      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/unpublish', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const now = new Date()
      const updated = await prisma.$executeRaw`
        UPDATE "JobPosting"
        SET "status" = 'draft'::"JobStatus", "publishedAt" = null, "updatedAt" = ${now}
        WHERE "id" = ${params.data.jobId} AND "businessId" = ${orgResult.org.id}
      `
      if (!updated) return reply.code(404).send({ error: 'job_not_found' })
      return reply.send({ ok: true })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const deleted = await prisma.$executeRaw`DELETE FROM "JobPosting" WHERE "id" = ${params.data.jobId} AND "businessId" = ${orgResult.org.id}`
      if (!deleted) return reply.code(404).send({ error: 'job_not_found' })
      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/jobs', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CreateJobBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        if (orgResult.error === 'province_not_found' || orgResult.error === 'community_not_found' || orgResult.error === 'organization_not_found') return reply.code(404).send({ error: orgResult.error })
        return reply.code(400).send({ error: orgResult.error })
      }
      const now = new Date()
      const industry = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobIndustry" WHERE "id" = ${body.data.industryId} AND "active" = true LIMIT 1`
      if (!industry.length) return reply.code(400).send({ error: 'invalid_industry' })
      if (body.data.subIndustryId) {
        const sub = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobSubIndustry" WHERE "id" = ${body.data.subIndustryId} AND "industryId" = ${body.data.industryId} AND "active" = true LIMIT 1`
        if (!sub.length) return reply.code(400).send({ error: 'invalid_sub_industry' })
      }
      const location = deps.parseStructuredJobLocation(body.data.location)
      const normalizedDescription = body.data.description?.trim() || body.data.duties.trim()
      const normalizedRoleRequirements = body.data.roleRequirements?.trim() || normalizedDescription
      const baseSlug = deps.trimSlugLength(deps.slugifyText(body.data.title), 80) || 'job'
      const existingSlugRows = await prisma.$queryRaw<Array<{ slug: string }>>`SELECT "slug" FROM "JobPosting" WHERE "businessId" = ${orgResult.org.id} AND "slug" ILIKE ${`${baseSlug}%`} LIMIT 100`
      const existing = new Set(existingSlugRows.map((row: { slug: string }) => row.slug))
      let slug = baseSlug
      let suffix = 2
      while (existing.has(slug)) {
        slug = deps.trimSlugLength(`${baseSlug}-${suffix}`, 80)
        suffix += 1
      }
      const inserted = (await prisma.$queryRaw(Prisma.sql`
        INSERT INTO "JobPosting" (
          "id", "businessId", "createdByUserId", "title", "slug", "employmentType", "salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod", "duties", "roleRequirements", "description",
          "locationType", "locationProvinceCode", "locationCommunitySlug", "locationLabel", "industryId", "subIndustryId", "status", "publishedAt", "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${orgResult.org.id}, ${userId}, ${body.data.title.trim()}, ${slug}, ${body.data.employmentType}::"JobEmploymentType",
          ${body.data.salaryMin ?? null}, ${body.data.salaryMax ?? null}, ${body.data.salaryCurrency.toUpperCase()}, ${body.data.salaryPeriod ?? null}, ${normalizedDescription}, ${normalizedRoleRequirements}, ${normalizedDescription},
          ${location.locationType}::"JobWorkplaceType", ${location.locationProvinceCode}, ${location.locationCommunitySlug}, ${location.locationLabel}, ${body.data.industryId}, ${body.data.subIndustryId ?? null},
          ${body.data.publish ? Prisma.sql`'active'::"JobStatus"` : Prisma.sql`'draft'::"JobStatus"`}, ${body.data.publish ? now : null}, ${OPEN_ENDED_JOB_EXPIRES_AT}, ${now}, ${now}
        ) RETURNING "id"
      `)) as Array<{ id: string }>
      const createdJobId = inserted[0]?.id
      if (createdJobId) {
        try {
          await deps.trackJobAnalyticsEvent({ kind: 'job_added', businessId: orgResult.org.id, jobPostingId: createdJobId, actorUserId: userId, createdAt: now })
        } catch (err) {
          req.log.warn({ err, jobId: createdJobId }, 'job_analytics_track_failed')
        }
      }
      return reply.code(201).send({ id: inserted[0]?.id, slug })
    }),
  )

  app.post('/work/jobs/:jobId/apply', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.JobIdParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.ApplyJobBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      const motivationHtml = sanitizeHtml(body.data.motivationHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'img']),
        allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt'] },
      }).trim()
      if (!motivationHtml) return reply.code(400).send({ error: 'motivation_required' })
      const jobRows = await prisma.$queryRaw<Array<{ id: string; businessId: string; title: string }>>`
        SELECT "id", "businessId", "title" FROM "JobPosting" WHERE "id" = ${params.data.jobId} AND "status" = 'active'::"JobStatus" LIMIT 1
      `
      const job = jobRows[0]
      if (!job) return reply.code(404).send({ error: 'job_not_found' })
      const now = new Date()
      const existing = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "JobApplication" WHERE "jobPostingId" = ${job.id} AND "applicantUserId" = ${userId} LIMIT 1`
      if (existing.length) return reply.code(409).send({ error: 'already_applied' })
      const thread = await prisma.messageThread.create({
        data: {
          type: MessageThreadType.job,
          uniqueKey: `job:${job.id}:applicant:${userId}`,
          contextType: 'job_application',
          contextId: job.id,
          lastMessageAt: now,
          participants: { create: [{ userId, role: MessageParticipantRole.member, lastReadAt: now, lastActivityAt: now }] },
        },
        select: { id: true },
      })
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const insertedApplication = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "JobApplication" ("id", "jobPostingId", "applicantUserId", "motivationHtml", "status", "threadId", "createdAt", "updatedAt")
          VALUES (${randomUUID()}, ${job.id}, ${userId}, ${motivationHtml}, 'submitted'::"JobApplicationStatus", ${thread.id}, ${now}, ${now}) RETURNING "id"
        `
        const applicationId = insertedApplication[0]?.id
        await tx.$executeRaw`UPDATE "JobPosting" SET "applicantCount" = "applicantCount" + 1, "updatedAt" = ${now} WHERE "id" = ${job.id}`
        if (applicationId) {
          await tx.$executeRaw`
            INSERT INTO "JobAnalyticsEvent" ("id", "kind", "businessId", "jobPostingId", "jobApplicationId", "actorUserId", "createdAt")
            VALUES (${randomUUID()}, 'applicant_submitted'::"JobAnalyticsEventKind", ${job.businessId}, ${job.id}, ${applicationId}, ${userId}, ${now})
          `
        }
        const managerRows = await tx.businessMembership.findMany({ where: { businessId: job.businessId, role: { in: [BusinessRole.OWNER, BusinessRole.MANAGER] } }, select: { userId: true } })
        const managerIds = Array.from(new Set(managerRows.map((row) => row.userId).filter((id) => id && id !== userId)))
        if (managerIds.length > 0) {
          await tx.messageParticipant.createMany({
            data: managerIds.map((managerId) => ({ threadId: thread.id, userId: managerId, role: MessageParticipantRole.admin, lastReadAt: null, lastActivityAt: now })),
            skipDuplicates: true,
          })
          await tx.notification.createMany({
            data: managerIds.map((managerId) => ({ userId: managerId, type: 'job_application_created', actorId: userId, payload: { jobId: job.id, jobTitle: job.title, threadId: thread.id } })),
          })
        }
      })
      return reply.code(201).send({ ok: true, threadId: thread.id })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/applications', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT ja."id", ja."motivationHtml", ja."status", ja."threadId", ja."createdAt", u."id" as "applicantId", u."handle" as "applicantHandle", u."name" as "applicantName", u."avatarUrl" as "applicantAvatarUrl", u."communityMeta" as "applicantCommunityMeta"
        FROM "JobApplication" ja
        JOIN "JobPosting" jp ON jp."id" = ja."jobPostingId"
        JOIN "User" u ON u."id" = ja."applicantUserId"
        WHERE jp."id" = ${params.data.jobId} AND jp."businessId" = ${orgResult.org.id}
        ORDER BY ja."createdAt" DESC
      `)) as any[]
      try {
        await deps.trackJobAnalyticsEvent({ kind: 'applications_viewed', businessId: orgResult.org.id, jobPostingId: params.data.jobId, actorUserId: userId })
      } catch (err) {
        req.log.warn({ err, jobId: params.data.jobId }, 'job_analytics_track_failed')
      }
      return reply.send({
        items: rows.map((row: any) => {
          const applicantMeta = deps.parseCommunityMeta(row.applicantCommunityMeta)
          return {
            id: row.id,
            motivationHtml: row.motivationHtml,
            status: row.status,
            threadId: row.threadId,
            createdAt: row.createdAt.toISOString(),
            civicStatus: applicantMeta?.civicStatus ?? 'unspecified',
            workAuthorization: applicantMeta?.workAuthorization ?? 'unspecified',
            applicant: { id: row.applicantId, handle: row.applicantHandle, name: row.applicantName, avatarUrl: deps.normalizeMediaUrl(row.applicantAvatarUrl) },
          }
        }),
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/applications/:applicationId/status', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobApplicationParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.UpdateJobApplicationStatusBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const applicationRows = await prisma.$queryRaw<Array<{ id: string; currentStatus: string; jobPostingId: string }>>`
        SELECT ja."id", ja."status"::text as "currentStatus", ja."jobPostingId"
        FROM "JobApplication" ja
        JOIN "JobPosting" jp ON jp."id" = ja."jobPostingId"
        WHERE ja."id" = ${params.data.applicationId} AND ja."jobPostingId" = ${params.data.jobId} AND jp."businessId" = ${orgResult.org.id}
        LIMIT 1
      `
      const application = applicationRows[0]
      if (!application) return reply.code(404).send({ error: 'application_not_found' })
      const now = new Date()
      await prisma.$executeRaw`UPDATE "JobApplication" SET "status" = ${body.data.status}::"JobApplicationStatus", "updatedAt" = ${now} WHERE "id" = ${application.id}`
      if (body.data.status === 'hired' && application.currentStatus !== 'hired') {
        try {
          await deps.trackJobAnalyticsEvent({ kind: 'applicant_hired', businessId: orgResult.org.id, jobPostingId: application.jobPostingId, jobApplicationId: application.id, actorUserId: userId, createdAt: now })
        } catch (err) {
          req.log.warn({ err, applicationId: application.id }, 'job_analytics_track_failed')
        }
      }
      return reply.send({ ok: true, status: body.data.status })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/jobs/:jobId/promote', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })
      const params = deps.CommunityOrgJobParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const orgResult = await deps.resolveOrgManagerOrOwner({ province: params.data.province, municipality: params.data.municipality, slug: params.data.slug, userId })
      if ('error' in orgResult) {
        if (orgResult.error === 'forbidden') return reply.code(403).send({ error: orgResult.error })
        return reply.code(404).send({ error: orgResult.error })
      }
      const now = new Date()
      const active = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT prm."id" FROM "JobPromotion" prm
        JOIN "JobPosting" jp ON jp."id" = prm."jobPostingId"
        WHERE prm."status" = 'active'::"JobPromotionStatus" AND prm."jobPostingId" = ${params.data.jobId} AND jp."businessId" = ${orgResult.org.id}
          AND prm."startsAt" <= ${now} AND prm."endsAt" > ${now} AND prm."impressionsServed" < prm."impressionCap"
        LIMIT 1
      `
      if (active.length) return reply.send({ ok: true, promotionId: active[0].id, alreadyActive: true })
      await ensureCitizenWalletTables()

      let promotionId: string | null = null
      let alreadyActive = false
      const endsAt = new Date(now.getTime() + JOB_BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000)

      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const [freshUser, freshJob, freshActive] = await Promise.all([
            tx.user.findUnique({
              where: { id: userId },
              select: { id: true, handle: true, name: true, communityMeta: true },
            }),
            tx.$queryRaw<Array<{ id: string; businessId: string; title: string }>>`
              SELECT "id", "businessId", "title"
              FROM "JobPosting"
              WHERE "id" = ${params.data.jobId} AND "businessId" = ${orgResult.org.id} AND "status" = 'active'::"JobStatus"
              LIMIT 1
            `,
            tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "JobPromotion"
              WHERE "jobPostingId" = ${params.data.jobId}
                AND "status" = 'active'::"JobPromotionStatus"
                AND "startsAt" <= ${now}
                AND "endsAt" > ${now}
                AND "impressionsServed" < "impressionCap"
              LIMIT 1
            `,
          ])

          if (!freshUser) throw new Error('user_not_found')
          const job = freshJob[0]
          if (!job) throw new Error('job_not_promotable')
          if (freshActive.length) {
            alreadyActive = true
            promotionId = freshActive[0]?.id ?? null
            return
          }

          const wallet = readWalletSummary(freshUser.communityMeta ?? null)
          if (!wallet.enabled) throw new Error('wallet_required')
          if (wallet.civilCreditsCents < JOB_BOOST_COST_CENTS) throw new Error('insufficient_wallet_balance')

          const userMeta = readBaseJsonObject(freshUser.communityMeta)
          userMeta.wallet = buildWalletMetaValue({
            ...wallet,
            civilCreditsCents: wallet.civilCreditsCents - JOB_BOOST_COST_CENTS,
          })

          const walletTransactionId = `job-boost:${params.data.jobId}:${randomUUID()}`
          const ledgerEventId = walletTransactionId

          await tx.user.update({
            where: { id: freshUser.id },
            data: { communityMeta: userMeta as Prisma.InputJsonValue },
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
              ${'job_boost'},
              ${'completed'},
              ${freshUser.id},
              null,
              ${JOB_BOOST_COST_CENTS},
              ${'cad'},
              ${JSON.stringify({
                kind: 'job_boost',
                jobPostingId: job.id,
                businessId: job.businessId,
                impressionCap: JOB_BOOST_IMPRESSION_CAP,
                endsAt: endsAt.toISOString(),
              })}::jsonb,
              NOW(),
              NOW()
            )
          `

          await insertCivilCreditLedgerEntry(tx, {
            id: `${walletTransactionId}:ledger`,
            eventId: ledgerEventId,
            entryType: 'transfer',
            status: 'completed',
            amountCents: JOB_BOOST_COST_CENTS,
            currency: 'cad',
            from: {
              entityType: 'user_wallet',
              userId: freshUser.id,
              handle: freshUser.handle ?? null,
              name: freshUser.name ?? null,
              entityLabel: 'Civil Wallet',
            },
            to: {
              entityType: 'platform_wallet',
              entityLabel: 'Civil Job Boosts',
            },
            sourceType: 'job_boost',
            sourceReferenceId: job.id,
            description: `Boost for job: ${job.title}`,
            metadata: {
              kind: 'job_boost',
              jobPostingId: job.id,
              businessId: job.businessId,
              impressionCap: JOB_BOOST_IMPRESSION_CAP,
              endsAt: endsAt.toISOString(),
            },
          })

          const inserted = (await tx.$queryRaw(Prisma.sql`
            INSERT INTO "JobPromotion" (
              "id",
              "jobPostingId",
              "createdByUserId",
              "status",
              "label",
              "startsAt",
              "endsAt",
              "impressionCap",
              "impressionsServed",
              "createdAt",
              "updatedAt"
            )
            VALUES (
              ${randomUUID()},
              ${job.id},
              ${freshUser.id},
              'active'::"JobPromotionStatus",
              '$10 Civil Wallet boost',
              ${now},
              ${endsAt},
              ${JOB_BOOST_IMPRESSION_CAP},
              0,
              ${now},
              ${now}
            )
            RETURNING "id"
          `)) as Array<{ id: string }>

          promotionId = inserted[0]?.id ?? null
          if (!promotionId) throw new Error('job_not_promotable')
        })
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'wallet_required') {
            return reply.code(400).send({ error: 'wallet_required', requiredAmountCents: JOB_BOOST_COST_CENTS })
          }
          if (error.message === 'insufficient_wallet_balance') {
            const currentUser = await prisma.user.findUnique({
              where: { id: userId },
              select: { communityMeta: true },
            })
            const wallet = readWalletSummary(currentUser?.communityMeta ?? null)
            return reply.code(400).send({
              error: 'insufficient_wallet_balance',
              availableCreditsCents: wallet.civilCreditsCents,
              requiredAmountCents: JOB_BOOST_COST_CENTS,
            })
          }
          if (error.message === 'job_not_promotable') return reply.code(400).send({ error: 'job_not_promotable' })
          if (error.message === 'user_not_found') return reply.code(404).send({ error: 'user_not_found' })
        }
        throw error
      }

      if (alreadyActive && promotionId) return reply.send({ ok: true, promotionId, alreadyActive: true })
      if (!promotionId) return reply.code(400).send({ error: 'job_not_promotable' })
      return reply.code(201).send({ ok: true, promotionId, endsAt: endsAt.toISOString(), impressionCap: JOB_BOOST_IMPRESSION_CAP })
    }),
  )

  app.post('/work/jobs/:jobId/impression', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.JobIdParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const now = new Date()
      const updated = await prisma.$executeRaw`
        UPDATE "JobPromotion"
        SET "impressionsServed" = "impressionsServed" + 1,
            "status" = CASE WHEN ("impressionsServed" + 1) >= "impressionCap" OR "endsAt" <= ${now} THEN 'ended'::"JobPromotionStatus" ELSE "status" END,
            "updatedAt" = ${now}
        WHERE "jobPostingId" = ${params.data.jobId} AND "status" = 'active'::"JobPromotionStatus"
          AND "startsAt" <= ${now} AND "endsAt" > ${now} AND "impressionsServed" < "impressionCap"
      `
      return reply.send({ tracked: updated > 0 })
    }),
  )

  app.get('/work/industries', async (_req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(_req, reply, async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT ji."id" as "industryId", ji."name" as "industryName", ji."slug" as "industrySlug", ji."sortOrder" as "industrySortOrder",
          jsi."id" as "subIndustryId", jsi."name" as "subIndustryName", jsi."slug" as "subIndustrySlug", jsi."sortOrder" as "subIndustrySortOrder"
        FROM "JobIndustry" ji
        LEFT JOIN "JobSubIndustry" jsi ON jsi."industryId" = ji."id" AND jsi."active" = true
        WHERE ji."active" = true
        ORDER BY ji."sortOrder" ASC, ji."name" ASC, jsi."sortOrder" ASC NULLS LAST, jsi."name" ASC NULLS LAST
      `
      const byIndustry = new Map<string, { id: string; name: string; slug: string; subIndustries: Array<{ id: string; name: string; slug: string }> }>()
      for (const row of rows) {
        if (!byIndustry.has(row.industryId)) {
          byIndustry.set(row.industryId, { id: row.industryId, name: row.industryName, slug: row.industrySlug, subIndustries: [] })
        }
        if (row.subIndustryId && row.subIndustryName && row.subIndustrySlug) {
          byIndustry.get(row.industryId)!.subIndustries.push({ id: row.subIndustryId, name: row.subIndustryName, slug: row.subIndustrySlug })
        }
      }
      return reply.send({ items: Array.from(byIndustry.values()) })
    }),
  )
}
