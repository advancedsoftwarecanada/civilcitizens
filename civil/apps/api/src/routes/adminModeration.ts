import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { Prisma, ContentReportStatus, ModerationTargetType, SupportRequestStatus } from '@prisma/client'

const AdminModerationReportsQuery = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'ALL']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const AdminModerationReportReviewBody = z.object({
  reviewNotes: z.string().trim().max(2000).optional().nullable(),
  ejectReportedUser: z.boolean().optional().default(false),
  suspendReportedOrganization: z.boolean().optional().default(false),
})

const AdminSupportRequestsQuery = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'ALL']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const AdminSupportRequestReviewBody = z.object({
  adminNotes: z.string().trim().max(2000).optional().nullable(),
})

type AdminUser = { id: string; email: string | null }

type AdminModerationDeps = {
  buildModerationSuspensionReason: (input: { reportId: string; targetType: ModerationTargetType; targetId: string }) => string
  loadAdminUserOrReply: (req: FastifyRequest, reply: FastifyReply) => Promise<AdminUser | null>
  normalizeMediaUrl: (value: string | null | undefined) => string | null
  suspendBusinessForModeration: (tx: Prisma.TransactionClient, input: { businessId: string }) => Promise<boolean>
  suspendUserForModeration: (
    tx: Prisma.TransactionClient,
    input: { userId: string; suspendedByUserId: string; sourceReportId: string; reason: string },
  ) => Promise<boolean>
}

export function registerAdminModerationRoutes(app: FastifyInstance, deps: AdminModerationDeps) {
  app.get('/admin/moderation/reports', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const query = AdminModerationReportsQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const where =
      query.data.status === 'ALL'
        ? {}
        : {
            status: query.data.status as ContentReportStatus,
          }

    const reports = await prisma.contentReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: query.data.limit,
      include: {
        reporter: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            handle: true,
            name: true,
          },
        },
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
      },
    })

    return reply.send({
      items: reports.map((report: (typeof reports)[number]) => ({
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
        reporter: {
          id: report.reporter.id,
          handle: report.reporter.handle,
          name: report.reporter.name,
          avatarUrl: deps.normalizeMediaUrl(report.reporter.avatarUrl ?? null),
          coverUrl: deps.normalizeMediaUrl(report.reporter.coverUrl ?? null),
        },
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
  })

  app.post('/admin/moderation/reports/:reportId/review', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const params = z.object({ reportId: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = AdminModerationReportReviewBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const enforcement = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const report = await tx.contentReport.findUnique({
        where: { id: params.data.reportId },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          reportedUserId: true,
          reportedBusinessId: true,
        },
      })
      if (!report) return null

      const suspendedUser =
        body.data.ejectReportedUser && report.reportedUserId
          ? await deps.suspendUserForModeration(tx, {
              userId: report.reportedUserId,
              suspendedByUserId: user.id,
              sourceReportId: report.id,
              reason: deps.buildModerationSuspensionReason({
                reportId: report.id,
                targetType: report.targetType,
                targetId: report.targetId,
              }),
            })
          : false

      const suspendedOrganization =
        body.data.suspendReportedOrganization && report.reportedBusinessId
          ? await deps.suspendBusinessForModeration(tx, {
              businessId: report.reportedBusinessId,
            })
          : false

      await tx.contentReport.update({
        where: { id: params.data.reportId },
        data: {
          status: ContentReportStatus.REVIEWED,
          reviewedAt: new Date(),
          reviewedByUserId: user.id,
          reviewNotes: body.data.reviewNotes?.trim() || null,
          updatedAt: new Date(),
        },
      })

      return {
        suspendedUser,
        suspendedOrganization,
      }
    })

    if (!enforcement) return reply.code(404).send({ error: 'report_not_found' })

    return reply.send({ ok: true, enforcement })
  })

  app.get('/admin/support/requests', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const query = AdminSupportRequestsQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const where =
      query.data.status === 'ALL'
        ? {}
        : {
            status: query.data.status as SupportRequestStatus,
          }

    const requests = await prisma.supportRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: query.data.limit,
      include: {
        requester: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
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
    })

    return reply.send({
      items: requests.map((request: (typeof requests)[number]) => ({
        id: request.id,
        type: request.type,
        subject: request.subject,
        body: request.body,
        status: request.status,
        adminNotes: request.adminNotes ?? null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        reviewedAt: request.reviewedAt?.toISOString() ?? null,
        requester: {
          id: request.requester.id,
          handle: request.requester.handle,
          name: request.requester.name,
          avatarUrl: deps.normalizeMediaUrl(request.requester.avatarUrl ?? null),
          coverUrl: deps.normalizeMediaUrl(request.requester.coverUrl ?? null),
        },
        reviewedBy: request.reviewedBy
          ? {
              id: request.reviewedBy.id,
              handle: request.reviewedBy.handle,
              name: request.reviewedBy.name,
            }
          : null,
      })),
    })
  })

  app.post('/admin/support/requests/:requestId/review', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const params = z.object({ requestId: z.string().cuid() }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const body = AdminSupportRequestReviewBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const updated = await prisma.supportRequest.updateMany({
      where: { id: params.data.requestId },
      data: {
        status: SupportRequestStatus.REVIEWED,
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
        adminNotes: body.data.adminNotes?.trim() || null,
        updatedAt: new Date(),
      },
    })

    if (!updated.count) return reply.code(404).send({ error: 'support_request_not_found' })

    return reply.send({ ok: true })
  })
}
