import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { BusinessStatus, ModerationStatus, Prisma, ReactionType as PrismaReactionType } from '@prisma/client'
import {
  AddPollOptionInput,
  CommentSortEnum,
  CreateCommentInput,
  CreatePostInput,
  ReactPostInput,
  UpdatePostInput,
  VoteCommentInput,
  VotePollInput,
  findCommunity,
  normalizeProvinceCode,
  slugifyCommunityName,
} from '@civil/shared'
import { z } from 'zod'

const VotePostInput = z.object({
  postId: z.string().cuid(),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
})

const HTTP_URL_REGEX = /https?:\/\/[^\s<>"']+/gi

function extractFirstPostUrl(value: string): string | null {
  const matches = value.match(HTTP_URL_REGEX)
  if (!matches?.length) return null
  return matches[0] ?? null
}

type PostInteractionsDeps = Record<string, any>

export function registerPostInteractionRoutes(app: FastifyInstance, deps: PostInteractionsDeps) {
  app.post('/posts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const parse = CreatePostInput.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const author = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, handle: true, communityMeta: true } })
      if (!author) return reply.code(401).send({ error: 'unauthorized' })

      let business: {
        id: string
        ownerId: string
        provinceCode: string | null
        communitySlug: string | null
        status: BusinessStatus
        moderationStatus: ModerationStatus
      } | null = null
      const businessId = (parse.data as any).businessId as string | undefined
      if (businessId) {
        business = await prisma.business.findUnique({
          where: { id: businessId },
          select: { id: true, ownerId: true, provinceCode: true, communitySlug: true, status: true, moderationStatus: true },
        })
        if (!business) return reply.code(404).send({ error: 'organization_not_found' })
        if (business.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
        }

        const isOwner = business.ownerId === userId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({
              where: { businessId_userId: { businessId: business.id, userId } },
              select: { role: true },
            })
        if (!membership) return reply.code(403).send({ error: 'forbidden' })
      }

      let provinceCode: string | null = null
      let communitySlug: string | null = null
      if (business) {
        if (!business.provinceCode || !business.communitySlug) {
          return reply.code(400).send({ error: 'organization_missing_community' })
        }
        const normalizedProvince = normalizeProvinceCode(business.provinceCode)
        if (!normalizedProvince) return reply.code(400).send({ error: 'invalid_province' })
        provinceCode = normalizedProvince
        communitySlug = business.communitySlug

        const requestedProvince = parse.data.communityProvince ? normalizeProvinceCode(parse.data.communityProvince) : null
        const requestedCommunity = parse.data.communitySlug?.trim() ? slugifyCommunityName(parse.data.communitySlug) : null
        if ((requestedProvince && requestedProvince !== provinceCode) || (requestedCommunity && requestedCommunity !== communitySlug)) {
          return reply.code(400).send({ error: 'organization_community_mismatch' })
        }
      } else if (parse.data.communityProvince && parse.data.communitySlug) {
        const normalizedProvince = normalizeProvinceCode(parse.data.communityProvince)
        if (!normalizedProvince) return reply.code(400).send({ error: 'invalid_province' })
        const community = findCommunity(normalizedProvince, parse.data.communitySlug)
        if (!community) return reply.code(404).send({ error: 'community_not_found' })
        provinceCode = community.province
        communitySlug = community.slug
      }

      if (parse.data.audience === 'family' && (business || (provinceCode && communitySlug))) {
        return reply.code(400).send({ error: 'family_posts_must_be_personal' })
      }

      if (parse.data.audience === 'family') {
        const communityMeta = deps.parseCommunityMeta(author.communityMeta ?? null)
        const hasFamilyModeEnabled = Boolean(communityMeta?.familyMode?.enabledAt)
        const hasProfileRelationships = deps.getStoredProfileFamilyRelationships(author.communityMeta).length > 0
        let hasFamilyMembers = false

        if (hasFamilyModeEnabled) {
          hasFamilyMembers = (await prisma.familyMember.count({ where: { parentId: userId } })) > 0
        }

        if (!hasFamilyMembers && !hasProfileRelationships) {
          return reply.code(400).send({ error: 'family_audience_unavailable' })
        }
      }

      const { body: rawBody, mediaUrl, images, hashtags, type, title, jurisdiction, sharedPostId, visibility, audience, poll: pollInput } = parse.data
      const showBusinessAuthor = Boolean(business && parse.data.showBusinessAuthor)

      const isArticle = type === 'article'
      const normalizedBody = sharedPostId
        ? deps.sanitizePlainText(rawBody)
        : isArticle
          ? deps.sanitizeRichTextHtml(rawBody)
          : deps.sanitizePlainText(rawBody)
      const previewSourceBody = isArticle ? deps.stripHtmlToPlainText(normalizedBody) : normalizedBody
      const firstUrl = extractFirstPostUrl(previewSourceBody)
      const linkPreview = firstUrl ? await deps.resolveLinkPreview(firstUrl, userId).catch(() => null) : null

      const slugBase = deps.buildPostSlugBase({ handle: author.handle, title, body: normalizedBody })
      const normalizedJurisdiction = jurisdiction ?? (provinceCode ? 'federal' : deps.DEFAULT_JURISDICTION)
      const normalizedAudience = business
        ? 'organization'
        : provinceCode && communitySlug
          ? 'community'
          : audience === 'family'
            ? 'family'
          : audience === 'network'
            ? 'network'
            : 'friends'

      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const seoSlug = await deps.generateUniquePostSlug(slugBase, tx)

        const post = await tx.post.create({
          data: {
            authorId: userId,
            ...(business ? { businessId: business.id } : {}),
            showBusinessAuthor,
            ...(visibility ? { visibility } : {}),
            ...(normalizedAudience ? ({ audience: normalizedAudience } as any) : {}),
            body: normalizedBody,
            mediaUrl,
            images: images ? (images as any) : undefined,
            ...(linkPreview ? { linkPreview: linkPreview as Prisma.InputJsonValue } : {}),
            type,
            title,
            provinceCode,
            communitySlug,
            seoSlug,
            jurisdiction: normalizedJurisdiction,
            sharedPostId,
          },
        })

        if (type === 'poll' && pollInput) {
          await tx.poll.create({
            data: {
              postId: post.id,
              resultsVisibility: deps.mapPollResultsVisibilityToDb(pollInput.resultsVisibility),
              resultsAvailableAt: deps.getPollResultsAvailableAt(pollInput.resultsVisibility, post.createdAt),
              options: {
                create: pollInput.options.map((label: string, index: number) => ({
                  label,
                  sortOrder: index,
                })),
              },
            },
          })
        }

        if (hashtags?.length) {
          const tags = [...new Set(hashtags.map((tag: string) => tag.replace(/^#/, '')))] as string[]
          if (tags.length) {
            await tx.hashtag.createMany({ data: tags.map((tag: string) => ({ tag })), skipDuplicates: true })
            await tx.postHashtag.createMany({ data: tags.map((tag: string) => ({ postId: post.id, tag })) })
          }
        }

        return tx.post.findUnique({
          where: { id: post.id },
          include: deps.POST_INCLUDE,
        })
      })

      if (!created) return reply.code(500).send({ error: 'post_create_failed' })

      void deps.enqueueContentAiScanForPost({
        id: created.id,
        authorId: created.authorId,
        title: created.title ?? null,
        body: created.body,
        mediaUrl: created.mediaUrl ?? null,
        images: created.images,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_post_create_failed', error)
      })

      return reply.code(201).send(deps.formatPost(created, { viewerId: userId }))
    }),
  )

  app.post('/posts/:id/poll/vote', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

      const parse = VotePollInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const post = await prisma.post.findUnique({ where: { id: params.data.id }, include: deps.POST_INCLUDE })
      if (!post || post.type !== 'poll' || !post.poll) return reply.code(404).send({ error: 'poll_not_found' })

      const canView = await deps.canViewerAccessPostForPreview(post, userId)
      if (!canView) return reply.code(404).send({ error: 'poll_not_found' })
      if (post.poll.endedAt) return reply.code(409).send({ error: 'poll_closed' })

      const option = post.poll.options.find((item: { id: string }) => item.id === parse.data.optionId)
      if (!option) return reply.code(404).send({ error: 'poll_option_not_found' })

      const now = new Date()
      const markResultsDelivered = Boolean(post.poll.resultsAvailableAt && post.poll.resultsAvailableAt.getTime() <= now.getTime())

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existingVote = await tx.pollVote.findUnique({
          where: { pollId_userId: { pollId: post.poll!.id, userId } },
          select: { resultNotificationSentAt: true },
        })

        if (existingVote) {
          await tx.pollVote.update({
            where: { pollId_userId: { pollId: post.poll!.id, userId } },
            data: {
              optionId: option.id,
              ...(markResultsDelivered && !existingVote.resultNotificationSentAt ? { resultNotificationSentAt: now } : {}),
            },
          })
        } else {
          await tx.pollVote.create({
            data: {
              pollId: post.poll!.id,
              userId,
              optionId: option.id,
              ...(markResultsDelivered ? { resultNotificationSentAt: now } : {}),
            },
          })
        }

        await tx.poll.updateMany({ where: { id: post.poll!.id, firstVoteAt: null }, data: { firstVoteAt: now } })
      })

      const updatedPost = await prisma.post.findUnique({ where: { id: params.data.id }, include: deps.POST_INCLUDE })
      if (!updatedPost) return reply.code(404).send({ error: 'poll_not_found' })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(userId, [updatedPost.id], 5)

      return reply.send({
        post: deps.formatPost(updatedPost, {
          viewerId: userId,
          viewerReaction: reactionsByPost[updatedPost.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[updatedPost.id] ?? null,
          recentComments: recentCommentsByPost[updatedPost.id] ?? [],
        }),
      })
    }),
  )

  app.post('/posts/:id/poll/options', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

      const parse = AddPollOptionInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const post = await prisma.post.findUnique({ where: { id: params.data.id }, include: deps.POST_INCLUDE })
      if (!post || post.type !== 'poll' || !post.poll) return reply.code(404).send({ error: 'poll_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.authorId !== userId) return reply.code(403).send({ error: 'forbidden' })
      if (post.poll.endedAt) return reply.code(409).send({ error: 'poll_closed' })
      if (post.poll.options.length >= deps.MAX_POLL_OPTIONS) return reply.code(400).send({ error: 'poll_option_limit_reached' })

      const normalizedLabel = parse.data.label.trim().toLowerCase()
      const hasDuplicate = post.poll.options.some((option: { label: string }) => option.label.trim().toLowerCase() === normalizedLabel)
      if (hasDuplicate) return reply.code(409).send({ error: 'poll_option_duplicate' })

      await prisma.pollOption.create({ data: { pollId: post.poll.id, label: parse.data.label, sortOrder: post.poll.options.length } })

      const updatedPost = await prisma.post.findUnique({ where: { id: params.data.id }, include: deps.POST_INCLUDE })
      if (!updatedPost) return reply.code(404).send({ error: 'poll_not_found' })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(userId, [updatedPost.id], 5)

      return reply.send({
        post: deps.formatPost(updatedPost, {
          viewerId: userId,
          viewerReaction: reactionsByPost[updatedPost.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[updatedPost.id] ?? null,
          recentComments: recentCommentsByPost[updatedPost.id] ?? [],
        }),
      })
    }),
  )

  app.post('/posts/:id/poll/end', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

      const post = await prisma.post.findUnique({ where: { id: params.data.id }, include: deps.POST_INCLUDE })
      if (!post || post.type !== 'poll' || !post.poll) return reply.code(404).send({ error: 'poll_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.authorId !== userId) return reply.code(403).send({ error: 'forbidden' })

      if (!post.poll.endedAt) {
        await prisma.poll.update({ where: { id: post.poll.id }, data: { endedAt: new Date() } })
      }

      const updatedPost = await prisma.post.findUnique({ where: { id: params.data.id }, include: deps.POST_INCLUDE })
      if (!updatedPost) return reply.code(404).send({ error: 'poll_not_found' })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(userId, [updatedPost.id], 5)

      return reply.send({
        post: deps.formatPost(updatedPost, {
          viewerId: userId,
          viewerReaction: reactionsByPost[updatedPost.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[updatedPost.id] ?? null,
          recentComments: recentCommentsByPost[updatedPost.id] ?? [],
        }),
      })
    }),
  )

  app.post('/posts/vote', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = VotePostInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { postId, value } = parse.data
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, authorId: true, createdAt: true, updatedAt: true, visibility: true, businessId: true, moderationStatus: true, audience: true },
      })
      if (!post) return reply.code(404).send({ error: 'post_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.audience === 'family') {
        const canAccess = await deps.canViewerAccessFamilyAudiencePost({ viewerId: userId, authorId: post.authorId })
        if (!canAccess) return reply.code(404).send({ error: 'post_not_found' })
      }

      if (post.visibility === 'members' && post.businessId) {
        const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true, moderationStatus: true } })
        if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
        }
        const isOwner = business.ownerId === userId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: post.businessId, userId } }, select: { role: true } })
        if (!membership) return reply.code(404).send({ error: 'post_not_found' })
      }

      const mappedReaction: PrismaReactionType | null = value === 1 ? PrismaReactionType.maple : value === -1 ? PrismaReactionType.sad : null

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.vote.deleteMany({ where: { userId, postId } })

        if (!mappedReaction) {
          await tx.postReaction.deleteMany({ where: { userId, postId } })
        } else {
          await tx.postReaction.upsert({
            where: { userId_postId: { userId, postId } },
            create: { userId, postId, type: mappedReaction },
            update: { type: mappedReaction },
          })
        }

        await deps.refreshPostAggregates(tx, postId, { createdAt: post.createdAt, lastActivityAt: post.updatedAt }, { bumpActivity: false })
      })

      const updatedPost = await prisma.post.findUnique({ where: { id: postId }, include: deps.POST_INCLUDE })
      if (!updatedPost) return reply.code(404).send({ error: 'post_not_found' })
      const { pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(userId, [postId], 5)

      return reply.send({
        post: deps.formatPost(updatedPost, {
          viewerId: userId,
          viewerReaction: mappedReaction,
          viewerPollOptionId: pollSelectionsByPost[postId] ?? null,
          recentComments: recentCommentsByPost[postId] ?? [],
        }),
      })
    }),
  )

  app.post('/posts/react', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = ReactPostInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { postId, reaction } = parse.data
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, authorId: true, createdAt: true, updatedAt: true, visibility: true, businessId: true, moderationStatus: true, audience: true },
      })
      if (!post) return reply.code(404).send({ error: 'post_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.audience === 'family') {
        const canAccess = await deps.canViewerAccessFamilyAudiencePost({ viewerId: userId, authorId: post.authorId })
        if (!canAccess) return reply.code(404).send({ error: 'post_not_found' })
      }

      if (post.visibility === 'members' && post.businessId) {
        const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true, moderationStatus: true } })
        if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
        }
        const isOwner = business.ownerId === userId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: post.businessId, userId } }, select: { role: true } })
        if (!membership) return reply.code(404).send({ error: 'post_not_found' })
      }

      const normalizedReaction: PrismaReactionType | null =
        reaction === null
          ? null
          : reaction === 'maple'
            ? PrismaReactionType.maple
            : reaction === 'heart'
              ? PrismaReactionType.heart
              : reaction === 'haha'
                ? PrismaReactionType.haha
                : reaction === 'wow'
                  ? PrismaReactionType.wow
                  : reaction === 'sad'
                    ? PrismaReactionType.sad
                    : reaction === 'fire'
                      ? PrismaReactionType.fire
                      : null

      if (reaction !== null && !normalizedReaction) return reply.code(400).send({ error: 'invalid_reaction' })

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.vote.deleteMany({ where: { userId, postId } })

        if (!normalizedReaction) {
          await tx.postReaction.deleteMany({ where: { userId, postId } })
        } else {
          await tx.postReaction.upsert({
            where: { userId_postId: { userId, postId } },
            create: { userId, postId, type: normalizedReaction },
            update: { type: normalizedReaction },
          })
        }

        await deps.refreshPostAggregates(tx, postId, { createdAt: post.createdAt, lastActivityAt: post.updatedAt }, { bumpActivity: false })
      })

      const updatedPost = await prisma.post.findUnique({ where: { id: postId }, include: deps.POST_INCLUDE })
      if (!updatedPost) return reply.code(404).send({ error: 'post_not_found' })
      const { pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(userId, [postId], 5)

      return reply.send({
        post: deps.formatPost(updatedPost, {
          viewerId: userId,
          viewerReaction: normalizedReaction,
          viewerPollOptionId: pollSelectionsByPost[postId] ?? null,
          recentComments: recentCommentsByPost[postId] ?? [],
        }),
      })
    }),
  )

  app.get('/posts/:id/comments', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

      const query = z.object({ sort: CommentSortEnum.optional() }).safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const post = await prisma.post.findUnique({
        where: { id: params.data.id },
        select: { id: true, visibility: true, businessId: true, moderationStatus: true, authorId: true, audience: true },
      })
      if (!post) return reply.code(404).send({ error: 'post_not_found' })

      const viewerId = (req as any).user?.id as string | undefined
      const blockState = await deps.loadViewerBlockState(viewerId)
      if (deps.isPostHiddenFromViewer(post, blockState)) return reply.code(404).send({ error: 'post_not_found' })
      if (post.audience === 'family') {
        const canAccess = await deps.canViewerAccessFamilyAudiencePost({ viewerId, authorId: post.authorId })
        if (!canAccess) return reply.code(404).send({ error: 'post_not_found' })
      }

      if (post.visibility === 'members' && post.businessId) {
        if (!viewerId) return reply.code(404).send({ error: 'post_not_found' })
        const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true, moderationStatus: true } })
        if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
        }
        const isOwner = business.ownerId === viewerId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: post.businessId, userId: viewerId } }, select: { role: true } })
        if (!membership) return reply.code(404).send({ error: 'post_not_found' })
      }

      const sortMode = query.data.sort ?? 'hot'

      const commentRows = await prisma.comment.findMany({
        where: { postId: params.data.id, moderationStatus: ModerationStatus.VISIBLE },
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true },
          },
        },
      })

      let viewerCommentVotes: Record<string, number> = {}
      if (viewerId && commentRows.length) {
        const commentIds = commentRows.map((comment: (typeof commentRows)[number]) => comment.id)
        const votes = await prisma.commentVote.findMany({ where: { userId: viewerId, commentId: { in: commentIds } }, select: { commentId: true, value: true } })
        const voteMap: Record<string, number> = {}
        for (const vote of votes) {
          voteMap[vote.commentId] = vote.value
        }
        viewerCommentVotes = voteMap
      }

      const visibleCommentRows = deps.filterCommentRowsForViewer(commentRows, blockState)

      return reply.send({
        comments: deps.buildCommentTree(visibleCommentRows, viewerCommentVotes, { sort: sortMode }),
      })
    }),
  )

  app.post('/comments', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = CreateCommentInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { postId, body: rawBody, parentId } = parse.data
      const body = deps.sanitizePlainText(rawBody)

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, authorId: true, createdAt: true, updatedAt: true, visibility: true, businessId: true, moderationStatus: true, audience: true },
      })
      if (!post) return reply.code(404).send({ error: 'post_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.audience === 'family') {
        const canAccess = await deps.canViewerAccessFamilyAudiencePost({ viewerId: userId, authorId: post.authorId })
        if (!canAccess) return reply.code(404).send({ error: 'post_not_found' })
      }

      if (post.visibility === 'members' && post.businessId) {
        const business = await prisma.business.findUnique({ where: { id: post.businessId }, select: { ownerId: true, moderationStatus: true } })
        if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
        }
        const isOwner = business.ownerId === userId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: post.businessId, userId } }, select: { role: true } })
        if (!membership) return reply.code(404).send({ error: 'post_not_found' })
      }

      let parentComment: { id: string; postId: string; userId: string } | null = null
      if (parentId) {
        const parent = await prisma.comment.findUnique({
          where: { id: parentId },
          select: { id: true, postId: true, userId: true, moderationStatus: true },
        })
        if (!parent || parent.postId !== postId || parent.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(400).send({ error: 'invalid_parent_comment' })
        }
        parentComment = parent
      }

      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const comment = await tx.comment.create({
          data: { postId, userId, parentId: parentId ?? null, body },
          include: {
            user: {
              select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true },
            },
          },
        })

        await deps.refreshPostAggregates(tx, postId, { createdAt: post.createdAt, lastActivityAt: post.updatedAt }, { bumpActivity: true })
        return comment
      })

      const updatedPost = await prisma.post.findUnique({ where: { id: postId }, include: deps.POST_INCLUDE })

      if (parentComment && parentComment.userId !== userId && updatedPost) {
        const paths = deps.getCanonicalPaths(updatedPost)
        const basePath = paths.community ?? paths.user
        const sourceCommentTarget = `${basePath}?comment=${encodeURIComponent(parentComment.id)}#comment-${parentComment.id}`
        const replyCommentTarget = `${basePath}?comment=${encodeURIComponent(created.id)}#comment-${created.id}`
        await deps.createNotificationRecord({
          userId: parentComment.userId,
          actorId: userId,
          type: deps.COMMENT_NOTIFICATION_TYPES.REPLY,
          postId,
          payload: {
            commentId: created.id,
            parentCommentId: parentComment.id,
            bodyPreview: deps.truncatePushBody(body, 90),
            url: sourceCommentTarget,
            sourceUrl: sourceCommentTarget,
            replyUrl: replyCommentTarget,
          },
        })
      }

      if (!parentComment && post.authorId && post.authorId !== userId && updatedPost) {
        const paths = deps.getCanonicalPaths(updatedPost)
        const basePath = paths.community ?? paths.user
        const commentTarget = `${basePath}?comment=${encodeURIComponent(created.id)}#comment-${created.id}`
        await deps.createNotificationRecord({
          userId: post.authorId,
          actorId: userId,
          type: deps.COMMENT_NOTIFICATION_TYPES.POST_COMMENT,
          postId,
          payload: {
            commentId: created.id,
            bodyPreview: deps.truncatePushBody(body, 90),
            url: commentTarget,
            sourceUrl: commentTarget,
          },
        })
      }

      const formattingContext = updatedPost ? await deps.loadViewerPostFormattingContext(userId, [updatedPost.id], 5) : null

      void deps.enqueueContentAiScanForComment(created).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_comment_failed', error)
      })

      return reply.code(201).send({
        comment: {
          ...deps.mapComment(created, 0),
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
        post: updatedPost
          ? deps.formatPost(updatedPost, {
              viewerId: userId,
              viewerReaction: formattingContext?.reactionsByPost[updatedPost.id] ?? null,
              viewerPollOptionId: formattingContext?.pollSelectionsByPost[updatedPost.id] ?? null,
              recentComments: formattingContext?.recentCommentsByPost[updatedPost.id] ?? [],
            })
          : null,
      })
    }),
  )

  app.post('/comments/vote', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = VoteCommentInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })

      const { commentId, value } = parse.data
      const existing = await prisma.comment.findUnique({
        where: { id: commentId },
        include: {
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true } },
          post: { select: { id: true, createdAt: true, updatedAt: true, visibility: true, businessId: true, moderationStatus: true } },
        },
      })

      if (!existing) return reply.code(404).send({ error: 'comment_not_found' })
      if (existing.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('COMMENT') })
      if (existing.post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })

      if (existing.post.visibility === 'members' && existing.post.businessId) {
        const business = await prisma.business.findUnique({ where: { id: existing.post.businessId }, select: { ownerId: true, moderationStatus: true } })
        if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) {
          return reply.code(423).send({ error: deps.moderationLockedErrorCode('ORGANIZATION') })
        }
        const isOwner = business.ownerId === userId
        const membership = isOwner
          ? { role: 'OWNER' as const }
          : await prisma.businessMembership.findUnique({ where: { businessId_userId: { businessId: existing.post.businessId, userId } }, select: { role: true } })
        if (!membership) return reply.code(404).send({ error: 'comment_not_found' })
      }

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (value === 0) {
          await tx.commentVote.deleteMany({ where: { userId, commentId } })
        } else {
          await tx.commentVote.upsert({
            where: { userId_commentId: { userId, commentId } },
            create: { userId, commentId, value },
            update: { value },
          })
        }

        await deps.refreshCommentAggregates(tx, commentId)
        await deps.refreshPostAggregates(tx, existing.postId, { createdAt: existing.post.createdAt, lastActivityAt: existing.post.updatedAt }, { bumpActivity: false })

        return tx.comment.findUnique({
          where: { id: commentId },
          include: {
            user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true } },
          },
        })
      })

      if (!result) return reply.code(404).send({ error: 'comment_not_found' })

      return reply.send({
        comment: {
          ...deps.mapComment(result, value),
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      })
    }),
  )

  app.delete('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

      const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { authorId: true, type: true, moderationStatus: true } })
      if (!post) return reply.code(404).send({ error: 'post_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.authorId !== userId) return reply.code(403).send({ error: 'forbidden' })

      await prisma.post.delete({ where: { id: params.data.id } })
      return reply.send({ success: true })
    }),
  )

  app.patch('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' })

      const parse = UpdatePostInput.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const post = await prisma.post.findUnique({
        where: { id: params.data.id },
        select: {
          authorId: true,
          businessId: true,
          type: true,
          moderationStatus: true,
          poll: { select: { endedAt: true, _count: { select: { votes: true } } } },
        },
      })
      if (!post) return reply.code(404).send({ error: 'post_not_found' })
      if (post.moderationStatus !== ModerationStatus.VISIBLE) return reply.code(423).send({ error: deps.moderationLockedErrorCode('POST') })
      if (post.authorId !== userId) return reply.code(403).send({ error: 'forbidden' })

      const { title, body: rawBody, mediaUrl, hashtags, showBusinessAuthor } = parse.data
      if (post.type === 'poll') {
        if (post.poll?.endedAt) return reply.code(409).send({ error: 'poll_closed' })
        if ((post.poll?._count.votes ?? 0) > 0 && rawBody !== undefined) return reply.code(409).send({ error: 'poll_locked' })
        if (title !== undefined || mediaUrl !== undefined) return reply.code(400).send({ error: 'poll_update_not_supported' })
      }

      const normalizedUpdatedBody = rawBody !== undefined ? (post.type === 'article' ? deps.sanitizeRichTextHtml(rawBody) : deps.sanitizePlainText(rawBody)) : undefined
      const updatedPreviewSource = normalizedUpdatedBody !== undefined
        ? post.type === 'article'
          ? deps.stripHtmlToPlainText(normalizedUpdatedBody)
          : normalizedUpdatedBody
        : undefined
      const updatedFirstUrl = updatedPreviewSource ? extractFirstPostUrl(updatedPreviewSource) : null
      const updatedLinkPreview = updatedPreviewSource !== undefined
        ? updatedFirstUrl
          ? await deps.resolveLinkPreview(updatedFirstUrl, userId).catch(() => null)
          : null
        : undefined

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const postData: Prisma.PostUpdateInput = {}
        if (title !== undefined) postData.title = title
        if (normalizedUpdatedBody !== undefined) postData.body = normalizedUpdatedBody
        if (mediaUrl !== undefined) postData.mediaUrl = mediaUrl
        if (updatedLinkPreview !== undefined) {
          postData.linkPreview = updatedLinkPreview ? (updatedLinkPreview as Prisma.InputJsonValue) : Prisma.DbNull
        }
        if (showBusinessAuthor !== undefined) postData.showBusinessAuthor = Boolean(post.businessId && showBusinessAuthor)

        const updatedPost = await tx.post.update({
          where: { id: params.data.id },
          data: postData,
          include: deps.POST_INCLUDE,
        })

        if (hashtags) {
          await tx.postHashtag.deleteMany({ where: { postId: params.data.id } })
          const tags = [...new Set(hashtags.map((tag: string) => tag.replace(/^#/, '')))] as string[]
          if (tags.length) {
            await tx.hashtag.createMany({ data: tags.map((tag: string) => ({ tag })), skipDuplicates: true })
            await tx.postHashtag.createMany({ data: tags.map((tag: string) => ({ postId: params.data.id, tag })) })
          }
        }

        return updatedPost
      })

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(userId, [params.data.id], 5)

      void deps.enqueueContentAiScanForPost({
        id: updated.id,
        authorId: updated.authorId,
        title: updated.title ?? null,
        body: updated.body,
        mediaUrl: updated.mediaUrl ?? null,
        images: updated.images,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_post_update_failed', error)
      })

      return reply.send(
        deps.formatPost(updated, {
          viewerId: userId,
          viewerReaction: reactionsByPost[params.data.id] ?? null,
          viewerPollOptionId: pollSelectionsByPost[params.data.id] ?? null,
          recentComments: recentCommentsByPost[params.data.id] ?? [],
        }),
      )
    }),
  )
}