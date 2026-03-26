import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ModerationStatus, Prisma } from '@prisma/client'
import {
  CAUSE_MAXIMUM_GOAL_CENTS,
  CAUSE_MAXIMUM_CONTRIBUTION_CENTS,
  CAUSE_MINIMUM_GOAL_CENTS,
  CAUSE_MINIMUM_CONTRIBUTION_CENTS,
  calculateCausePlatformFeeCents,
  findCommunity,
  normalizeProvinceCode,
} from '@civil/shared'
import { z } from 'zod'
import {
  applyCauseContributionFromPaymentIntent,
  applyCauseWalletContributionFromBalance,
  createCauseDraft,
  createCauseRecord,
  createCauseSubscriptionWithInitialCharge,
  ensureCivilCauseTables,
  loadCauseDraftById,
  loadCauseDraftByPublishedPostId,
  loadCauseSummariesByPostIds,
  pauseCauseSubscription,
  cancelCauseSubscription,
  updateCauseDraft,
} from '../causes.js'
import { resolvePostTaggingForWrite, syncPostTaggingRelations } from '../postTagging.js'

const CAUSE_STORY_MAX_LENGTH = 3000
const CAUSE_STAGE_GOAL_MAX_CENTS = 1_000_000

function buildStageGoalProgress(goals: Array<{ id: string; amountCents: number }>, raisedAmountCents: number) {
  let remaining = Math.max(0, raisedAmountCents)
  return goals.map((goal) => {
    const progressCents = Math.max(0, Math.min(goal.amountCents, remaining))
    remaining = Math.max(0, remaining - goal.amountCents)
    return {
      id: goal.id,
      amountCents: goal.amountCents,
      progressCents,
    }
  })
}

const CauseStageGoalInput = z.object({
  id: z.string().min(1).max(120),
  amountCents: z.coerce.number().int().min(1).max(CAUSE_STAGE_GOAL_MAX_CENTS),
  description: z.string().trim().min(1).max(280),
  sortOrder: z.coerce.number().int().min(0),
})

const CauseContributionIntentBody = z.object({
  amountCents: z.coerce.number().int().min(CAUSE_MINIMUM_CONTRIBUTION_CENTS).max(CAUSE_MAXIMUM_CONTRIBUTION_CENTS),
})

const CauseContributionConfirmBody = z.object({
  paymentIntentId: z.string().min(1),
})

const CauseSubscriptionManageParams = z.object({
  subscriptionId: z.string().uuid(),
})

const CauseContributorsParams = z.object({
  postId: z.string().cuid(),
})

const CauseContributorsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

type CauseContributorRow = {
  id: string
  contributor_user_id: string
  amount_cents: number
  created_at: Date
  source_type: string
}

type CauseContributorCountRow = {
  count: bigint | number
}

type CauseContributorUserRow = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  premiumStatus: unknown
  communityMeta: Prisma.JsonValue | null
}

const CauseDraftUpdateBody = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  body: z.string().max(30000).optional(),
  goalAmountCents: z.coerce.number().int().min(CAUSE_MINIMUM_GOAL_CENTS).max(CAUSE_MAXIMUM_GOAL_CENTS).optional(),
  stageGoals: z.array(CauseStageGoalInput).max(24).optional(),
  provinceCode: z.string().trim().min(2).max(2).optional().nullable(),
  communitySlug: z.string().trim().min(1).max(120).optional().nullable(),
})

type CauseRouteDeps = Record<string, any>

function buildCommunityOrClauses(keys: Set<string>) {
  return Array.from(keys)
    .map((key) => {
      const [provinceCode, communitySlug] = key.split(':')
      if (!provinceCode || !communitySlug) return null
      return { provinceCode, communitySlug }
    })
    .filter((value): value is { provinceCode: string; communitySlug: string } => Boolean(value))
}

export function registerCauseRoutes(app: FastifyInstance, deps: CauseRouteDeps) {
  app.post('/causes/drafts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { communityMeta: true } })
      if (!viewer) return reply.code(401).send({ error: 'unauthorized' })

      const wallet = deps.readWalletSummary(viewer.communityMeta)
      if (!wallet?.stripeConnect?.accountId || !wallet.stripeConnect.payoutsEnabled) {
        return reply.code(409).send({ error: 'wallet_connect_required' })
      }

      const homeFollow = await prisma.communityFollow.findFirst({
        where: { userId: viewerId },
        orderBy: [{ home: 'desc' }, { createdAt: 'asc' }],
        select: { provinceCode: true, communitySlug: true },
      })

      const draft = await createCauseDraft(prisma, {
        creatorUserId: viewerId,
        provinceCode: homeFollow?.provinceCode ?? null,
        communitySlug: homeFollow?.communitySlug ?? null,
      })
      if (!draft) return reply.code(500).send({ error: 'cause_draft_create_failed' })

      return reply.code(201).send({ draft })
    }),
  )

  app.get('/causes/drafts/:draftId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ draftId: z.string().uuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_draft_id' })

      const draft = await loadCauseDraftById(params.data.draftId, viewerId)
      if (!draft) return reply.code(404).send({ error: 'cause_draft_not_found' })

      let cause = null
      if (draft.publishedPostId) {
        try {
          cause = (await loadCauseSummariesByPostIds([draft.publishedPostId]))[draft.publishedPostId] ?? null
        } catch (error) {
          req.log.error({ err: error, draftId: draft.id, postId: draft.publishedPostId, viewerId }, 'cause_draft_progress_load_failed')
        }
      }

      return reply.send({ draft, cause })
    }),
  )

  app.get('/causes/posts/:postId/draft', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ postId: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_post_id' })

      const draft = await loadCauseDraftByPublishedPostId(params.data.postId, viewerId)
      if (!draft) return reply.code(404).send({ error: 'cause_draft_not_found' })

      return reply.send({ draft })
    }),
  )

  app.get('/causes/posts/:postId/contributors', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      await ensureCivilCauseTables()

      const params = CauseContributorsParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_post_id' })

      const query = CauseContributorsQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const post = await prisma.post.findUnique({
        where: { id: params.data.postId },
        select: { id: true, type: true },
      })
      if (!post || post.type !== 'cause') return reply.code(404).send({ error: 'cause_not_found' })

      const limit = query.data.limit ?? 10
      const [rows, countRows] = await Promise.all([
        prisma.$queryRaw<CauseContributorRow[]>`
          SELECT id, contributor_user_id, amount_cents, created_at, source_type
          FROM civil_cause_contribution
          WHERE post_id = ${post.id}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}
        `,
        prisma.$queryRaw<CauseContributorCountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM civil_cause_contribution
          WHERE post_id = ${post.id}
        `,
      ])

      const contributorIds = Array.from(new Set(rows.map((row: CauseContributorRow) => row.contributor_user_id).filter(Boolean)))
      const users: CauseContributorUserRow[] = contributorIds.length
        ? await prisma.user.findMany({
            where: { id: { in: contributorIds } },
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
              premiumStatus: true,
              communityMeta: true,
            },
          })
        : []

      const userById = new Map(users.map((user: CauseContributorUserRow) => [user.id, user] as const))
      const items = rows.flatMap((row: CauseContributorRow) => {
        const user = userById.get(row.contributor_user_id)
        if (!user) return []

        return [{
          id: row.id,
          amountCents: Math.max(0, Math.round(Number(row.amount_cents ?? 0))),
          createdAt: row.created_at,
          sourceType: row.source_type,
          user: {
            id: user.id,
            handle: user.handle,
            name: user.name,
            avatarUrl: user.avatarUrl,
            coverUrl: user.coverUrl,
            isPremium: deps.isPremium(user.premiumStatus),
            isVerified: deps.isSelfVerifiedCanadianCitizen(deps.parseCommunityMeta(user.communityMeta ?? null)),
          },
        }]
      })

      const totalCountValue = countRows[0]?.count
      const totalCount = typeof totalCountValue === 'bigint'
        ? Number(totalCountValue)
        : Math.max(0, Math.round(Number(totalCountValue ?? 0)))

      return reply.send({ items, totalCount })
    }),
  )

  app.patch('/causes/drafts/:draftId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      try {
        const viewerId = (req as any).user?.id as string | undefined
        if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

        const params = z.object({ draftId: z.string().uuid() }).safeParse(req.params)
        if (!params.success) return reply.code(400).send({ error: 'invalid_draft_id' })

        const body = CauseDraftUpdateBody.safeParse(req.body ?? {})
        if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

        let current
        try {
          current = await loadCauseDraftById(params.data.draftId, viewerId)
        } catch (error) {
          req.log.error({ err: error, draftId: params.data.draftId, viewerId }, 'cause_draft_load_failed')
          return reply.code(500).send({
            error: 'cause_draft_load_failed',
            ...(process.env.NODE_ENV !== 'production' && error instanceof Error ? { detail: error.message } : {}),
          })
        }
        if (!current) return reply.code(404).send({ error: 'cause_draft_not_found' })

        const nextProvinceCode = body.data.provinceCode === undefined ? current.provinceCode : body.data.provinceCode
        const nextCommunitySlug = body.data.communitySlug === undefined ? current.communitySlug : body.data.communitySlug

        if ((nextProvinceCode && !nextCommunitySlug) || (!nextProvinceCode && nextCommunitySlug)) {
          return reply.code(400).send({ error: 'community_pair_required' })
        }

        if (body.data.body !== undefined) {
          const plainBodyLength = deps.stripHtmlToPlainText(body.data.body).trim().length
          if (plainBodyLength > CAUSE_STORY_MAX_LENGTH) {
            return reply.code(400).send({ error: 'cause_body_too_long' })
          }
        }

        let normalizedProvinceCode: string | null | undefined = undefined
        let normalizedCommunitySlug: string | null | undefined = undefined
        try {
          if (nextProvinceCode && nextCommunitySlug) {
            const normalizedProvince = normalizeProvinceCode(nextProvinceCode)
            if (!normalizedProvince) return reply.code(400).send({ error: 'invalid_province' })
            const community = findCommunity(normalizedProvince, nextCommunitySlug)
            if (!community) return reply.code(404).send({ error: 'community_not_found' })
            normalizedProvinceCode = community.province
            normalizedCommunitySlug = community.slug
          } else if (body.data.provinceCode !== undefined || body.data.communitySlug !== undefined) {
            normalizedProvinceCode = null
            normalizedCommunitySlug = null
          }
        } catch (error) {
          req.log.error({ err: error, draftId: params.data.draftId, viewerId }, 'cause_draft_normalize_failed')
          return reply.code(500).send({
            error: 'cause_draft_normalize_failed',
            ...(process.env.NODE_ENV !== 'production' && error instanceof Error ? { detail: error.message } : {}),
          })
        }

        const nextTitle = body.data.title ?? current.title
        const nextBody = body.data.body ?? current.body
        const nextGoalAmountCents = body.data.goalAmountCents ?? current.goalAmountCents
        const nextStageGoals = body.data.stageGoals ?? current.stageGoals

        let publishedCause = null as Awaited<ReturnType<typeof loadCauseSummariesByPostIds>>[string] | null
        if (current.publishedPostId) {
          publishedCause = (await loadCauseSummariesByPostIds([current.publishedPostId]))[current.publishedPostId] ?? null
        }

        if (publishedCause && body.data.stageGoals) {
          const currentGoalProgress = buildStageGoalProgress(current.stageGoals, publishedCause.raisedAmountCents)
          const lastLockedIndex = currentGoalProgress.reduce((lastIndex, goal, index) => (goal.progressCents > 0 ? index : lastIndex), -1)
          if (lastLockedIndex >= 0) {
            const currentLockedPrefix = currentGoalProgress.slice(0, lastLockedIndex + 1)
            const nextPrefix = body.data.stageGoals.slice(0, lastLockedIndex + 1)
            const samePrefix = currentLockedPrefix.every((goal, index) => nextPrefix[index]?.id === goal.id)
            if (!samePrefix) {
              return reply.code(409).send({ error: 'cause_goal_in_progress_locked' })
            }
            const insufficientGoal = currentLockedPrefix.find((goal, index) => {
              const nextGoal = nextPrefix[index]
              return !nextGoal || nextGoal.amountCents < goal.progressCents
            })
            if (insufficientGoal) {
              return reply.code(409).send({ error: 'cause_goal_progress_amount_conflict' })
            }
          }
        }

        let draft
        try {
          draft = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const updatedDraft = await updateCauseDraft(tx, {
              id: params.data.draftId,
              creatorUserId: viewerId,
              title: body.data.title,
              body: body.data.body,
              goalAmountCents: body.data.goalAmountCents,
              stageGoals: body.data.stageGoals,
              provinceCode: normalizedProvinceCode,
              communitySlug: normalizedCommunitySlug,
            })

            if (current.publishedPostId && updatedDraft) {
              const normalizedBody = deps.sanitizeRichTextHtml(nextBody)
              const plainTextBody = deps.stripHtmlToPlainText(normalizedBody)
              const firstUrlMatch = plainTextBody.match(/https?:\/\/[^\s<>"']+/i)
              const resolvedPreview = firstUrlMatch?.[0]
                ? await deps.resolveLinkPreview(firstUrlMatch[0], viewerId).catch(() => null)
                : null

              await tx.post.update({
                where: { id: current.publishedPostId },
                data: {
                  title: nextTitle,
                  body: normalizedBody,
                  provinceCode: normalizedProvinceCode === undefined ? undefined : normalizedProvinceCode,
                  communitySlug: normalizedCommunitySlug === undefined ? undefined : normalizedCommunitySlug,
                  ...(resolvedPreview ? { linkPreview: resolvedPreview as Prisma.InputJsonValue } : body.data.body !== undefined ? { linkPreview: Prisma.JsonNull } : {}),
                },
              })

              await createCauseRecord(tx, {
                postId: current.publishedPostId,
                creatorUserId: viewerId,
                goalAmountCents: nextGoalAmountCents,
                stageGoals: nextStageGoals,
              })

              const tagging = await resolvePostTaggingForWrite({
                tx,
                authorId: viewerId,
                text: plainTextBody,
                implicitCommunitySlugs: normalizedCommunitySlug ? [normalizedCommunitySlug] : [],
              })
              await syncPostTaggingRelations(tx, current.publishedPostId, tagging)
            }

            return updatedDraft
          })
        } catch (error) {
          req.log.error({ err: error, draftId: params.data.draftId, viewerId }, 'cause_draft_save_failed')
          return reply.code(500).send({
            error: 'cause_draft_save_failed',
            ...(process.env.NODE_ENV !== 'production' && error instanceof Error ? { detail: error.message } : {}),
          })
        }
        if (!draft) return reply.code(404).send({ error: 'cause_draft_not_found' })

        const cause = draft.publishedPostId
          ? (await loadCauseSummariesByPostIds([draft.publishedPostId]))[draft.publishedPostId] ?? null
          : null

        return reply.send({ draft, cause })
      } catch (error) {
        req.log.error({ err: error }, 'cause_draft_update_unhandled_failed')
        return reply.code(500).send({
          error: 'cause_draft_update_unhandled_failed',
          ...(process.env.NODE_ENV !== 'production' && error instanceof Error ? { detail: error.message } : {}),
        })
      }
    }),
  )

  app.post('/causes/drafts/:draftId/publish', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ draftId: z.string().uuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_draft_id' })

      const [draft, author] = await Promise.all([
        loadCauseDraftById(params.data.draftId, viewerId),
        prisma.user.findUnique({ where: { id: viewerId }, select: { id: true, handle: true, communityMeta: true } }),
      ])
      if (!draft) return reply.code(404).send({ error: 'cause_draft_not_found' })
      if (!author) return reply.code(401).send({ error: 'unauthorized' })
      if (draft.publishedPostId) return reply.code(409).send({ error: 'cause_draft_published' })

      const wallet = deps.readWalletSummary(author.communityMeta)
      if (!wallet?.stripeConnect?.accountId || !wallet.stripeConnect.payoutsEnabled) {
        return reply.code(409).send({ error: 'wallet_connect_required' })
      }

      const title = draft.title.trim()
      const plainBodyText = deps.stripHtmlToPlainText(draft.body).trim()
      const stageGoalTotal = draft.stageGoals.reduce((sum, goal) => sum + goal.amountCents, 0)
      if (title.length < 3) return reply.code(400).send({ error: 'cause_title_too_short' })
      if (plainBodyText.length < 30) return reply.code(400).send({ error: 'cause_body_too_short' })
      if (plainBodyText.length > CAUSE_STORY_MAX_LENGTH) return reply.code(400).send({ error: 'cause_body_too_long' })
      if (!draft.provinceCode || !draft.communitySlug) return reply.code(400).send({ error: 'cause_community_required' })
      if (!draft.stageGoals.length) return reply.code(400).send({ error: 'cause_stage_goals_required' })
      if (stageGoalTotal !== draft.goalAmountCents) return reply.code(400).send({ error: 'cause_stage_goal_total_mismatch' })

      const normalizedProvince = normalizeProvinceCode(draft.provinceCode)
      if (!normalizedProvince) return reply.code(400).send({ error: 'invalid_province' })
      const community = findCommunity(normalizedProvince, draft.communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const normalizedBody = deps.sanitizeRichTextHtml(draft.body)
      const plainTextBody = deps.stripHtmlToPlainText(normalizedBody)
      const slugBase = deps.buildPostSlugBase({ handle: author.handle, title, body: plainTextBody })
      const firstUrlMatch = plainTextBody.match(/https?:\/\/[^\s<>"']+/i)
      const linkPreview = firstUrlMatch?.[0] ? await deps.resolveLinkPreview(firstUrlMatch[0], viewerId).catch(() => null) : null

      let created: Prisma.PostGetPayload<{ include: typeof deps.POST_INCLUDE }>
      try {
        created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          let seoSlug: string
          try {
            seoSlug = await deps.generateUniquePostSlug(slugBase, tx)
          } catch (error) {
            req.log.error({ err: error, draftId: draft.id, viewerId }, 'cause_publish_slug_failed')
            throw new Error('cause_publish_slug_failed')
          }

          let post: Prisma.PostGetPayload<{ include: typeof deps.POST_INCLUDE }>
          try {
            post = await tx.post.create({
              data: {
                authorId: viewerId,
                body: normalizedBody,
                title,
                type: 'cause',
                seoSlug,
                provinceCode: community.province,
                communitySlug: community.slug,
                jurisdiction: deps.DEFAULT_JURISDICTION,
                audience: 'community',
                visibility: 'public',
                ...(linkPreview ? { linkPreview: linkPreview as Prisma.InputJsonValue } : {}),
              },
              include: deps.POST_INCLUDE,
            })
          } catch (error) {
            req.log.error({ err: error, draftId: draft.id, viewerId }, 'cause_publish_post_create_failed')
            throw new Error('cause_publish_post_create_failed')
          }

          try {
            await createCauseRecord(tx, {
              postId: post.id,
              creatorUserId: viewerId,
              goalAmountCents: draft.goalAmountCents,
              stageGoals: draft.stageGoals,
            })

            const causeRows = await tx.$queryRaw<Array<{ post_id: string }>>`
              SELECT post_id
              FROM civil_cause
              WHERE post_id = ${post.id}
              LIMIT 1
            `
            if (!causeRows[0]?.post_id) {
              req.log.error({ draftId: draft.id, viewerId, postId: post.id }, 'cause_publish_record_verify_failed')
              throw new Error('cause_publish_record_verify_failed')
            }
          } catch (error) {
            req.log.error({ err: error, draftId: draft.id, viewerId, postId: post.id }, 'cause_publish_record_create_failed')
            throw new Error(error instanceof Error ? error.message : 'cause_publish_record_create_failed')
          }

          try {
            const tagging = await resolvePostTaggingForWrite({
              tx,
              authorId: viewerId,
              text: plainTextBody,
              implicitCommunitySlugs: [community.slug],
            })
            await syncPostTaggingRelations(tx, post.id, tagging)
          } catch (error) {
            req.log.error({ err: error, draftId: draft.id, viewerId, postId: post.id }, 'cause_publish_tagging_failed')
            throw new Error('cause_publish_tagging_failed')
          }

          try {
            await updateCauseDraft(tx, {
              id: draft.id,
              creatorUserId: viewerId,
              publishedPostId: post.id,
            })
          } catch (error) {
            req.log.error({ err: error, draftId: draft.id, viewerId, postId: post.id }, 'cause_publish_draft_update_failed')
            throw new Error('cause_publish_draft_update_failed')
          }

          return post
        })
      } catch (error) {
        req.log.error({ err: error, draftId: draft.id, viewerId }, 'cause_publish_failed')
        return reply.code(500).send({
          error: error instanceof Error && error.message === 'cause_publish_record_verify_failed' ? 'cause_publish_record_verify_failed' : 'cause_publish_failed',
          ...(process.env.NODE_ENV !== 'production' && error instanceof Error ? { detail: error.message } : {}),
        })
      }

      void deps.enqueueContentAiScanForPost({
        id: created.id,
        authorId: created.authorId,
        title: created.title ?? null,
        body: created.body,
        mediaUrl: created.mediaUrl ?? null,
        images: created.images,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_cause_publish_failed', error)
      })

      return reply.code(201).send({
        post: {
          id: created.id,
          seoSlug: created.seoSlug ?? null,
          provinceCode: created.provinceCode ?? null,
          communitySlug: created.communitySlug ?? null,
          author: {
            handle: created.author.handle,
          },
        },
      })
    }),
  )

  app.get('/causes/discover', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const viewerBlockState = await deps.loadViewerBlockState(viewerId)
      const feedContext = await deps.loadViewerFeedContext(viewerId)

      const baseWhere: Prisma.PostWhereInput = {
        type: 'cause',
        moderationStatus: ModerationStatus.VISIBLE,
      }
      deps.applyVisibleModerationFiltersToPostWhere(baseWhere, viewerBlockState)

      const localCommunityKeys = new Set<string>()
      if (feedContext.homeCommunityKey) localCommunityKeys.add(feedContext.homeCommunityKey)
      for (const key of feedContext.followedCommunityKeys ?? []) {
        localCommunityKeys.add(key)
      }

      const localClauses = buildCommunityOrClauses(localCommunityKeys)

      const [localPosts, trendingPosts, recentPosts, authoredPosts] = await Promise.all([
        localClauses.length
          ? prisma.post.findMany({
              where: {
                ...baseWhere,
                OR: localClauses,
              },
              orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
              take: 4,
              include: deps.POST_INCLUDE,
            })
          : Promise.resolve([]),
        prisma.post.findMany({
          where: baseWhere,
          orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
          take: 4,
          include: deps.POST_INCLUDE,
        }),
        prisma.post.findMany({
          where: baseWhere,
          orderBy: [{ createdAt: 'desc' }],
          take: 4,
          include: deps.POST_INCLUDE,
        }),
        prisma.post.findMany({
          where: {
            ...baseWhere,
            authorId: viewerId,
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          take: 3,
          include: deps.POST_INCLUDE,
        }),
      ])

      const allPostIds = [...localPosts, ...trendingPosts, ...recentPosts, ...authoredPosts].map((post) => post.id)
      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost, causeByPost } = await deps.loadViewerPostFormattingContext(
        viewerId,
        allPostIds,
        3,
      )

      const formatItems = (posts: any[]) =>
        posts.map((post) =>
          deps.formatPost(post, {
            viewerId,
            viewerReaction: reactionsByPost[post.id] ?? null,
            viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
            recentComments: recentCommentsByPost[post.id] ?? [],
            cause: causeByPost[post.id] ?? null,
          }),
        )

      return reply.send({
        authored: formatItems(authoredPosts),
        local: formatItems(localPosts),
        trending: formatItems(trendingPosts),
        recent: formatItems(recentPosts),
      })
    }),
  )

  app.post('/causes/:postId/contributions/intent', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })
      if (!deps.isStripeConfigured() || !deps.STRIPE_PUBLISHABLE_KEY) return reply.code(503).send({ error: 'stripe_not_configured' })

      const params = z.object({ postId: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_post_id' })

      const body = CauseContributionIntentBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const [viewer, post] = await Promise.all([
        prisma.user.findUnique({ where: { id: viewerId }, select: { id: true, email: true, communityMeta: true } }),
        prisma.post.findUnique({
          where: { id: params.data.postId },
          include: {
            author: {
              select: {
                id: true,
                handle: true,
                name: true,
                email: true,
                communityMeta: true,
              },
            },
          },
        }),
      ])

      if (!viewer) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(viewer.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })
      if (!post || post.type !== 'cause' || post.moderationStatus !== ModerationStatus.VISIBLE) {
        return reply.code(404).send({ error: 'cause_not_found' })
      }
      if (post.authorId === viewerId) return reply.code(400).send({ error: 'cannot_back_own_cause' })

      const causeByPost = await deps.loadCauseSummariesByPostIds([post.id])
      const cause = causeByPost[post.id]
      if (!cause) return reply.code(404).send({ error: 'cause_not_found' })
      if (cause.status !== 'active') return reply.code(409).send({ error: 'cause_inactive' })

      const authorWallet = deps.readWalletSummary(post.author.communityMeta)
      if (!authorWallet?.stripeConnect?.accountId || !authorWallet.stripeConnect.payoutsEnabled) {
        return reply.code(409).send({ error: 'cause_payout_unavailable' })
      }

      const { customerId } = await deps.ensureStripeCustomer(viewerId)
      const stripe = deps.getStripeClient()
      const contributionAmountCents = body.data.amountCents
      const feeCents = calculateCausePlatformFeeCents(contributionAmountCents)
      const totalChargeCents = contributionAmountCents + feeCents
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalChargeCents,
        currency: 'cad',
        customer: customerId,
        payment_method_types: ['card'],
        setup_future_usage: 'off_session',
        description: `Back Civil Cause: ${post.title ?? 'Cause'}`,
        receipt_email: viewer.email ?? undefined,
        metadata: {
          kind: 'cause_contribution',
          causePostId: post.id,
          contributorUserId: viewerId,
          recipientUserId: post.authorId,
          causeAmountCents: String(contributionAmountCents),
          causeFeeCents: String(feeCents),
          causeTotalChargeCents: String(totalChargeCents),
        },
      })

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        publishableKey: deps.STRIPE_PUBLISHABLE_KEY,
        contributionAmountCents,
        feeCents,
        totalChargeCents,
      })
    }),
  )

  app.post('/causes/:postId/contributions/confirm', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })
      if (!deps.isStripeConfigured()) return reply.code(503).send({ error: 'stripe_not_configured' })

      const params = z.object({ postId: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_post_id' })

      const body = CauseContributionConfirmBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const stripe = deps.getStripeClient()
      const paymentIntent = await stripe.paymentIntents.retrieve(body.data.paymentIntentId)
      if (paymentIntent.metadata?.kind !== 'cause_contribution') return reply.code(403).send({ error: 'forbidden' })
      if (paymentIntent.metadata?.causePostId !== params.data.postId || paymentIntent.metadata?.contributorUserId !== viewerId) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (paymentIntent.status !== 'succeeded') {
        return reply.code(409).send({ error: 'payment_not_completed' })
      }

      await applyCauseContributionFromPaymentIntent(paymentIntent, deps.createNotificationRecord)

      const post = await prisma.post.findUnique({
        where: { id: params.data.postId },
        include: deps.POST_INCLUDE,
      })
      if (!post) return reply.code(404).send({ error: 'cause_not_found' })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost, causeByPost } = await deps.loadViewerPostFormattingContext(
        viewerId,
        [post.id],
        5,
      )

      return reply.send({
        post: deps.formatPost(post, {
          viewerId,
          viewerReaction: reactionsByPost[post.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
          recentComments: recentCommentsByPost[post.id] ?? [],
          cause: causeByPost[post.id] ?? null,
        }),
      })
    }),
  )

  app.post('/causes/:postId/wallet-contributions', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ postId: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_post_id' })

      const body = CauseContributionIntentBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const [viewer, post] = await Promise.all([
        prisma.user.findUnique({ where: { id: viewerId }, select: { id: true, communityMeta: true } }),
        prisma.post.findUnique({
          where: { id: params.data.postId },
          include: deps.POST_INCLUDE,
        }),
      ])

      if (!viewer) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(viewer.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })
      if (!post || post.type !== 'cause' || post.moderationStatus !== ModerationStatus.VISIBLE) {
        return reply.code(404).send({ error: 'cause_not_found' })
      }
      if (post.authorId === viewerId) return reply.code(400).send({ error: 'cannot_back_own_cause' })

      try {
        await applyCauseWalletContributionFromBalance({
          postId: post.id,
          contributorUserId: viewerId,
          recipientUserId: post.authorId,
          amountCents: body.data.amountCents,
          createNotificationRecord: deps.createNotificationRecord,
        })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'internal_error'
        if (code === 'insufficient_wallet_balance') {
          return reply.code(409).send({ error: 'insufficient_wallet_balance' })
        }
        if (code === 'cause_payout_unavailable') {
          return reply.code(409).send({ error: 'cause_payout_unavailable' })
        }
        if (code === 'cause_inactive') {
          return reply.code(409).send({ error: 'cause_inactive' })
        }
        req.log.error({ err: error, postId: post.id, viewerId }, 'cause_wallet_contribution_failed')
        return reply.code(500).send({ error: 'cause_wallet_contribution_failed' })
      }

      const refreshed = await prisma.post.findUnique({ where: { id: post.id }, include: deps.POST_INCLUDE })
      if (!refreshed) return reply.code(404).send({ error: 'cause_not_found' })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost, causeByPost } = await deps.loadViewerPostFormattingContext(
        viewerId,
        [refreshed.id],
        5,
      )

      return reply.send({
        post: deps.formatPost(refreshed, {
          viewerId,
          viewerReaction: reactionsByPost[refreshed.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[refreshed.id] ?? null,
          recentComments: recentCommentsByPost[refreshed.id] ?? [],
          cause: causeByPost[refreshed.id] ?? null,
        }),
      })
    }),
  )

  app.post('/causes/:postId/subscriptions', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ postId: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_post_id' })

      const body = CauseContributionIntentBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const [viewer, post] = await Promise.all([
        prisma.user.findUnique({ where: { id: viewerId }, select: { id: true, communityMeta: true } }),
        prisma.post.findUnique({
          where: { id: params.data.postId },
          include: deps.POST_INCLUDE,
        }),
      ])

      if (!viewer) return reply.code(401).send({ error: 'unauthorized' })
      if (deps.isAccountSuspended(viewer.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })
      if (!post || post.type !== 'cause' || post.moderationStatus !== ModerationStatus.VISIBLE) {
        return reply.code(404).send({ error: 'cause_not_found' })
      }
      if (post.authorId === viewerId) return reply.code(400).send({ error: 'cannot_back_own_cause' })

      let subscription = null
      try {
        subscription = await createCauseSubscriptionWithInitialCharge({
          postId: post.id,
          subscriberUserId: viewerId,
          recipientUserId: post.authorId,
          amountCents: body.data.amountCents,
          createNotificationRecord: deps.createNotificationRecord,
        })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'internal_error'
        if (code === 'insufficient_wallet_balance') {
          return reply.code(409).send({ error: 'insufficient_wallet_balance' })
        }
        if (code === 'cause_payout_unavailable') {
          return reply.code(409).send({ error: 'cause_payout_unavailable' })
        }
        if (code === 'cause_inactive') {
          return reply.code(409).send({ error: 'cause_inactive' })
        }
        req.log.error({ err: error, postId: post.id, viewerId }, 'cause_subscription_create_failed')
        return reply.code(500).send({ error: 'cause_subscription_create_failed' })
      }

      const refreshed = await prisma.post.findUnique({ where: { id: post.id }, include: deps.POST_INCLUDE })
      if (!refreshed) return reply.code(404).send({ error: 'cause_not_found' })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost, causeByPost } = await deps.loadViewerPostFormattingContext(
        viewerId,
        [refreshed.id],
        5,
      )

      return reply.code(201).send({
        subscription,
        post: deps.formatPost(refreshed, {
          viewerId,
          viewerReaction: reactionsByPost[refreshed.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[refreshed.id] ?? null,
          recentComments: recentCommentsByPost[refreshed.id] ?? [],
          cause: causeByPost[refreshed.id] ?? null,
        }),
      })
    }),
  )

  app.post('/causes/subscriptions/:subscriptionId/pause', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = CauseSubscriptionManageParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_subscription_id' })

      const subscription = await pauseCauseSubscription(params.data.subscriptionId, viewerId)
      if (!subscription) return reply.code(404).send({ error: 'cause_subscription_not_found' })

      return reply.send({ subscription })
    }),
  )

  app.post('/causes/subscriptions/:subscriptionId/cancel', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = CauseSubscriptionManageParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_subscription_id' })

      const subscription = await cancelCauseSubscription(params.data.subscriptionId, viewerId)
      if (!subscription) return reply.code(404).send({ error: 'cause_subscription_not_found' })

      return reply.send({ subscription })
    }),
  )
}