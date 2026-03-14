import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SupportRequestStatus } from '@prisma/client'
import { prisma } from '@civil/db'

type SupportRouteDeps = Record<string, any>

export function registerSupportRoutes(app: FastifyInstance, deps: SupportRouteDeps) {
  app.get('/support/overview', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const requesterUserId = (await deps.resolveUserId(req)) ?? undefined
      if (!requesterUserId) return reply.code(401).send({ error: 'unauthorized' })

      const [supportRequests, contentReports] = await Promise.all([
        prisma.supportRequest.findMany({
          where: { requesterUserId },
          orderBy: [{ createdAt: 'desc' }],
          take: 100,
          include: {
            reviewedBy: {
              select: {
                id: true,
                handle: true,
                name: true,
              },
            },
          },
        }),
        prisma.contentReport.findMany({
          where: { reporterUserId: requesterUserId },
          orderBy: [{ createdAt: 'desc' }],
          take: 100,
          include: {
            reportedUser: {
              select: {
                id: true,
                handle: true,
                name: true,
                avatarUrl: true,
                coverUrl: true,
              },
            },
            reportedBusiness: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                coverUrl: true,
                provinceCode: true,
                communitySlug: true,
              },
            },
            reviewedBy: {
              select: {
                id: true,
                handle: true,
                name: true,
              },
            },
          },
        }),
      ])

      return reply.send({
        supportRequests: supportRequests.map((request: (typeof supportRequests)[number]) => ({
          id: request.id,
          type: request.type,
          subject: request.subject,
          body: request.body,
          status: request.status,
          adminNotes: request.adminNotes ?? null,
          createdAt: request.createdAt.toISOString(),
          updatedAt: request.updatedAt.toISOString(),
          reviewedAt: request.reviewedAt?.toISOString() ?? null,
          reviewedBy: request.reviewedBy
            ? {
                id: request.reviewedBy.id,
                handle: request.reviewedBy.handle,
                name: request.reviewedBy.name,
              }
            : null,
        })),
        contentReports: contentReports.map((report: (typeof contentReports)[number]) => ({
          id: report.id,
          targetType: report.targetType,
          targetId: report.targetId,
          targetLabel: report.targetLabel,
          targetUrl: report.targetUrl,
          reasons: report.reasons,
          details: report.details,
          status: report.status,
          quarantineAppliedAt: report.quarantineAppliedAt?.toISOString() ?? null,
          reviewedAt: report.reviewedAt?.toISOString() ?? null,
          reviewNotes: report.reviewNotes ?? null,
          createdAt: report.createdAt.toISOString(),
          updatedAt: report.updatedAt.toISOString(),
          reviewedBy: report.reviewedBy
            ? {
                id: report.reviewedBy.id,
                handle: report.reviewedBy.handle,
                name: report.reviewedBy.name,
              }
            : null,
          reportedUser: report.reportedUser
            ? {
                id: report.reportedUser.id,
                handle: report.reportedUser.handle,
                name: report.reportedUser.name,
                avatarUrl: deps.normalizeMediaUrl(report.reportedUser.avatarUrl ?? null),
                coverUrl: deps.normalizeMediaUrl(report.reportedUser.coverUrl ?? null),
              }
            : null,
          reportedBusiness: report.reportedBusiness
            ? {
                id: report.reportedBusiness.id,
                name: report.reportedBusiness.name,
                slug: report.reportedBusiness.slug,
                logoUrl: deps.normalizeMediaUrl(report.reportedBusiness.logoUrl ?? null),
                coverUrl: deps.normalizeMediaUrl(report.reportedBusiness.coverUrl ?? null),
                provinceCode: report.reportedBusiness.provinceCode,
                communitySlug: report.reportedBusiness.communitySlug,
              }
            : null,
        })),
      })
    }),
  )

  app.post('/support/requests', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const requesterUserId = (await deps.resolveUserId(req)) ?? undefined
      if (!requesterUserId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.SupportRequestBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const created = await prisma.supportRequest.create({
        data: {
          requesterUserId,
          type: body.data.type,
          subject: deps.sanitizePlainText(body.data.subject).trim(),
          body: deps.sanitizePlainText(body.data.body).trim(),
          status: SupportRequestStatus.OPEN,
        },
        select: { id: true },
      })

      return reply.code(201).send({ ok: true, requestId: created.id })
    }),
  )
}