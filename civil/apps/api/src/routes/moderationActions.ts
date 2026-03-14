import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ModerationTargetType, Prisma } from '@prisma/client'

type ModerationActionDeps = Record<string, any>

export function registerModerationActionRoutes(app: FastifyInstance, deps: ModerationActionDeps) {
  app.post('/moderation/reports', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const reporterUserId = (await deps.resolveUserId(req)) ?? undefined
      if (!reporterUserId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.ModerationReportBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const targetType = body.data.targetType as ModerationTargetType
      const target = await deps.resolveModerationTarget(targetType, body.data.targetId)
      if (!target) return reply.code(404).send({ error: 'target_not_found' })

      const reasons = Array.from(new Set(body.data.reasons))
      const details = body.data.details?.trim() ? deps.sanitizePlainText(body.data.details).trim() : null
      const now = new Date()

      const report = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        return deps.createModerationReportAndQuarantine(tx, {
          reporterUserId,
          target,
          reasons,
          details,
          quarantineAppliedAt: now,
        })
      })

      return reply.code(201).send({ ok: true, reportId: report.id })
    }),
  )

  app.post('/moderation/blocks/users', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const blockerUserId = (await deps.resolveUserId(req)) ?? undefined
      if (!blockerUserId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.UserBlockBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
      if (body.data.userId === blockerUserId) return reply.code(400).send({ error: 'cannot_block_self' })

      const blockedUser = await prisma.user.findUnique({
        where: { id: body.data.userId },
        select: { id: true },
      })
      if (!blockedUser) return reply.code(404).send({ error: 'user_not_found' })

      const reportTarget = body.data.reportTarget
        ? await deps.resolveModerationTarget(body.data.reportTarget.targetType as ModerationTargetType, body.data.reportTarget.targetId)
        : null

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.userBlock.upsert({
          where: {
            blockerUserId_blockedUserId: {
              blockerUserId,
              blockedUserId: blockedUser.id,
            },
          },
          update: {},
          create: {
            blockerUserId,
            blockedUserId: blockedUser.id,
          },
        })

        if (reportTarget) {
          await deps.createModerationReportAndQuarantine(tx, {
            reporterUserId: blockerUserId,
            target: reportTarget,
            reasons: ['other'],
            details: 'Auto-generated from a member block action so moderators can review abusive content within 24 hours.',
          })
        }
      })

      return reply.send({ ok: true })
    }),
  )

  app.post('/family/moderation/blocks/users', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      if (authContext.actor !== 'family_member') return reply.code(403).send({ error: 'family_member_required' })

      const body = deps.UserBlockBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const blockerUserId = authContext.member.parentId
      if (body.data.userId === blockerUserId) return reply.code(400).send({ error: 'cannot_block_parent_account' })

      const blockedUser = await prisma.user.findUnique({
        where: { id: body.data.userId },
        select: { id: true, handle: true, name: true },
      })
      if (!blockedUser) return reply.code(404).send({ error: 'user_not_found' })

      const reportTarget = body.data.reportTarget
        ? await deps.resolveModerationTarget(body.data.reportTarget.targetType as ModerationTargetType, body.data.reportTarget.targetId)
        : null

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.userBlock.upsert({
          where: {
            blockerUserId_blockedUserId: {
              blockerUserId,
              blockedUserId: blockedUser.id,
            },
          },
          update: {},
          create: {
            blockerUserId,
            blockedUserId: blockedUser.id,
          },
        })

        await tx.friendship.deleteMany({
          where: {
            OR: [
              { requesterId: blockerUserId, addresseeId: blockedUser.id },
              { requesterId: blockedUser.id, addresseeId: blockerUserId },
            ],
          },
        })

        if (reportTarget) {
          await deps.createModerationReportAndQuarantine(tx, {
            reporterUserId: blockerUserId,
            target: reportTarget,
            reasons: ['other'],
            details: 'Auto-generated from a Family block action so moderators can review abusive content within 24 hours.',
          })
        }
      })

      void deps.createNotificationRecord({
        userId: blockerUserId,
        actorId: null,
        type: deps.FAMILY_NOTIFICATION_TYPES.USER_BLOCKED,
        payload: {
          childDisplayName: deps.normalizeFamilyMemberSummary(authContext.member).displayName,
          targetUserId: blockedUser.id,
          targetHandle: blockedUser.handle,
          targetName: blockedUser.name,
          url: `/u/${encodeURIComponent(blockedUser.handle)}`,
          sourceUrl: `/u/${encodeURIComponent(blockedUser.handle)}`,
        },
      }).catch((error: unknown) => {
        req.log.error({ err: error, memberId: authContext.member.id, targetUserId: blockedUser.id }, 'family_block_notification_failed')
      })

      return reply.send({ ok: true })
    }),
  )

  app.post('/moderation/blocks/organizations', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const blockerUserId = (await deps.resolveUserId(req)) ?? undefined
      if (!blockerUserId) return reply.code(401).send({ error: 'unauthorized' })

      const body = deps.BusinessBlockBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const business = await prisma.business.findUnique({
        where: { id: body.data.businessId },
        select: { id: true },
      })
      if (!business) return reply.code(404).send({ error: 'organization_not_found' })

      const reportTarget = body.data.reportTarget
        ? await deps.resolveModerationTarget(body.data.reportTarget.targetType as ModerationTargetType, body.data.reportTarget.targetId)
        : null

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.businessBlock.upsert({
          where: {
            blockerUserId_blockedBusinessId: {
              blockerUserId,
              blockedBusinessId: business.id,
            },
          },
          update: {},
          create: {
            blockerUserId,
            blockedBusinessId: business.id,
          },
        })

        if (reportTarget) {
          await deps.createModerationReportAndQuarantine(tx, {
            reporterUserId: blockerUserId,
            target: reportTarget,
            reasons: ['other'],
            details: 'Auto-generated from a member block action so moderators can review abusive content within 24 hours.',
          })
        }
      })

      return reply.send({ ok: true })
    }),
  )
}