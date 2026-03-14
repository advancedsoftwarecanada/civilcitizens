import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ModerationStatus, Prisma, ReactionType as PrismaReactionType } from '@prisma/client'
import { CursorQuery, JurisdictionEnum, PostSortEnum, findCommunity, normalizeProvinceCode } from '@civil/shared'
import { z } from 'zod'

type PostReadDeps = Record<string, any>

async function loadPostDetailResponse(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: PostReadDeps,
  where: Prisma.PostWhereUniqueInput,
) {
  const post = await prisma.post.findUnique({
    where,
    include: deps.POST_INCLUDE,
  })

  if (!post) return reply.code(404).send({ error: 'not found' })

  const viewerId = (req as any).user?.id as string | undefined
  const viewerBlockState = await deps.loadViewerBlockState(viewerId)
  if (deps.isPostHiddenFromViewer(post, viewerBlockState)) return reply.code(404).send({ error: 'not found' })
  if (post.audience === 'family') {
    const canAccess = await deps.canViewerAccessFamilyAudiencePost({ viewerId, authorId: post.authorId })
    if (!canAccess) return reply.code(404).send({ error: 'not found' })
  }
  if (post.business && post.business.moderationStatus !== ModerationStatus.VISIBLE) {
    return reply.code(404).send({ error: 'not found' })
  }

  if (post.visibility === 'members' && post.businessId) {
    if (!viewerId) return reply.code(404).send({ error: 'not found' })
    const business = await prisma.business.findUnique({
      where: { id: post.businessId },
      select: { ownerId: true, moderationStatus: true },
    })
    if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) {
      return reply.code(404).send({ error: 'not found' })
    }
    const isOwner = business.ownerId === viewerId
    const membership = isOwner
      ? { role: 'OWNER' as const }
      : await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: post.businessId, userId: viewerId } },
          select: { role: true },
        })
    if (!membership) return reply.code(404).send({ error: 'not found' })
  }

  let viewerReaction: PrismaReactionType | null = null
  let viewerPollOptionId: string | null = null
  if (viewerId) {
    const [reaction, pollSelectionsByPost] = await Promise.all([
      prisma.postReaction.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId: post.id,
          },
        },
        select: { type: true },
      }),
      deps.loadViewerPollSelectionsByPostIds(viewerId, [post.id]),
    ])
    viewerReaction = reaction?.type ?? null
    viewerPollOptionId = pollSelectionsByPost[post.id] ?? null
  }

  const commentRows = await prisma.comment.findMany({
    where: { postId: post.id, moderationStatus: ModerationStatus.VISIBLE },
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          premiumStatus: true,
        },
      },
    },
  })

  let viewerCommentVotes: Record<string, number> = {}
  if (viewerId && commentRows.length) {
    const commentIds = commentRows.map((comment: (typeof commentRows)[number]) => comment.id)
    const votes = await prisma.commentVote.findMany({
      where: { userId: viewerId, commentId: { in: commentIds } },
      select: { commentId: true, value: true },
    })
    const voteMap: Record<string, number> = {}
    for (const vote of votes) {
      voteMap[vote.commentId] = vote.value
    }
    viewerCommentVotes = voteMap
  }

  const visibleCommentRows = deps.filterCommentRowsForViewer(commentRows, viewerBlockState)

  return {
    post: deps.formatPost(post, { viewerId, viewerReaction, viewerPollOptionId }),
    paths: deps.getCanonicalPaths(post),
    comments: deps.buildCommentTree(visibleCommentRows, viewerCommentVotes),
  }
}

export function registerPostReadRoutes(app: FastifyInstance, deps: PostReadDeps) {
  app.get('/posts/slug/:slug', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = z.object({ slug: z.string() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid slug' })

      return loadPostDetailResponse(req, reply, deps, { seoSlug: params.data.slug })
    }),
  )

  app.get('/posts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = z.object({ id: z.string().cuid() }).safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid id' })

      return loadPostDetailResponse(req, reply, deps, { id: params.data.id })
    }),
  )

  app.get('/posts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const parse = CursorQuery.extend({
        jurisdiction: JurisdictionEnum.optional(),
        sort: PostSortEnum.optional(),
        scope: z.enum(['all', 'friends', 'network', 'communities', 'organizations']).optional(),
        province: z.string().optional(),
        community: z.string().optional(),
      }).safeParse(req.query)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { cursor, limit, jurisdiction, sort, scope = 'all', province, community } = parse.data
      const where: Prisma.PostWhereInput = {}
      if (jurisdiction) {
        where.jurisdiction = jurisdiction
      }
      if (province && community) {
        const normalizedProvince = normalizeProvinceCode(province)
        if (!normalizedProvince) {
          return reply.code(400).send({ error: 'invalid_province' })
        }
        const communityRecord = findCommunity(normalizedProvince, community)
        if (!communityRecord) {
          return reply.code(404).send({ error: 'community_not_found' })
        }
        where.provinceCode = communityRecord.province
        where.communitySlug = communityRecord.slug
      }

      const viewerId = (req as any).user?.id as string | undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)
      deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

      let memberBusinessIds: string[] = []
      let viewerFeedContext: any = null
      if (province && community) {
        where.visibility = 'public'
      } else if (!viewerId) {
        where.visibility = 'public'
      }

      if (!viewerId && scope !== 'all' && !province && !community) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const allowHomeFamilyPosts = Boolean(viewerId && scope === 'all' && !province && !community)
      if (!allowHomeFamilyPosts) {
        where.type = { not: deps.FAMILY_FEED_POST_TYPE }
      }
      if (allowHomeFamilyPosts && viewerId) {
        await deps.syncLegacyParentFamilyFeedPosts(viewerId)
      }

      if (viewerId && !province && !community) {
        viewerFeedContext = await deps.loadViewerFeedContext(viewerId)
        memberBusinessIds = [...viewerFeedContext.memberBusinessIds]

        const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
        where.AND = [
          ...existingAnd,
          {
            OR: [
              { visibility: 'public' },
              {
                visibility: 'members',
                businessId: { in: memberBusinessIds },
              },
            ],
          },
        ]

        const includeFriends = scope === 'all' || scope === 'friends'
        const includeNetwork = scope === 'all' || scope === 'network'
        const includeCommunities = scope === 'all' || scope === 'communities'
        const includeOrganizations = scope === 'all' || scope === 'organizations'

        const accessibleFilters: Prisma.PostWhereInput[] = []

        if (includeFriends) {
          const allowedAuthorIds = new Set<string>([viewerId, ...viewerFeedContext.friendIds])
          if (allowedAuthorIds.size) {
            accessibleFilters.push({
              OR: [
                {
                  authorId: { in: [...allowedAuthorIds] },
                  communitySlug: null,
                  ...(scope === 'friends'
                    ? ({ audience: 'friends' } as any)
                    : ({ audience: { in: ['friends'] } } as any)),
                },
                ...(scope === 'all'
                  ? [
                      {
                        authorId: viewerId,
                        type: deps.FAMILY_FEED_POST_TYPE,
                        audience: 'family',
                      } as Prisma.PostWhereInput,
                    ]
                  : []),
                {
                  authorId: { in: [...allowedAuthorIds] },
                  businessId: { not: null },
                  ...(scope === 'friends'
                    ? ({ audience: 'organization' } as any)
                    : ({ audience: { in: ['organization'] } } as any)),
                },
              ],
            })
          }
        }

        if (includeNetwork) {
          const allowedAuthorIds = new Set<string>([viewerId, ...viewerFeedContext.connectionIds])
          if (allowedAuthorIds.size) {
            accessibleFilters.push({
              OR: [
                {
                  authorId: { in: [...allowedAuthorIds] },
                  communitySlug: null,
                  ...(scope === 'network'
                    ? ({ audience: 'network' } as any)
                    : ({ audience: { in: ['network'] } } as any)),
                },
                {
                  authorId: { in: [...allowedAuthorIds] },
                  businessId: { not: null },
                  ...(scope === 'network'
                    ? ({ audience: 'organization' } as any)
                    : ({ audience: { in: ['organization'] } } as any)),
                },
              ],
            })
          }
        }

        if (includeCommunities) {
          const prioritizedCommunityKeys = Array.from(
            new Set(
              [
                viewerFeedContext.homeCommunityKey,
                ...viewerFeedContext.nearbyCommunityKeys,
                ...viewerFeedContext.regionalCommunityKeys,
                ...viewerFeedContext.followedCommunityKeys,
              ].filter((key): key is string => Boolean(key)),
            ),
          )

          if (prioritizedCommunityKeys.length) {
            for (const key of prioritizedCommunityKeys) {
              const [provinceCode, communitySlug] = key.split(':')
              if (!provinceCode || !communitySlug) continue
              accessibleFilters.push({ provinceCode, communitySlug })
            }
          } else {
            accessibleFilters.push({
              provinceCode: { not: null },
              communitySlug: { not: null },
            })
          }
        }

        if (includeOrganizations) {
          const businessIds = Array.from(
            new Set([...viewerFeedContext.followedBusinessIds, ...viewerFeedContext.memberBusinessIds]),
          )
          if (businessIds.length) {
            accessibleFilters.push({ businessId: { in: businessIds } })
          }
        }

        if (!accessibleFilters.length && scope !== 'all') {
          return { items: [], nextCursor: undefined }
        }

        if (accessibleFilters.length) {
          const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
          where.AND = [...existingAnd, { OR: accessibleFilters }]
        }
      }
      const sortMode = sort ?? 'new'

      let items: any[] = []
      let nextCursor: string | undefined = undefined
      let lastViewedAt: Date | null = null

      if (viewerId) {
        if (province && community) {
          const normalized = normalizeProvinceCode(province)
          const provinceCode = normalized ?? province
          const follow = await prisma.communityFollow.findUnique({
            where: {
              userId_provinceCode_communitySlug: {
                userId: viewerId,
                provinceCode,
                communitySlug: community.toLowerCase(),
              },
            },
            select: { lastViewedAt: true },
          })
          lastViewedAt = follow?.lastViewedAt ?? null
          if (!cursor && follow) {
            prisma.communityFollow
              .update({
                where: {
                  userId_provinceCode_communitySlug: {
                    userId: viewerId,
                    provinceCode,
                    communitySlug: community.toLowerCase(),
                  },
                },
                data: { lastViewedAt: new Date() },
              })
              .catch(console.error)
          }
        } else if (scope === 'friends') {
          const user = await prisma.user.findUnique({ where: { id: viewerId }, select: { lastViewedFriendsAt: true } })
          lastViewedAt = user?.lastViewedFriendsAt ?? null
          if (!cursor) {
            prisma.user.update({ where: { id: viewerId }, data: { lastViewedFriendsAt: new Date() } }).catch(console.error)
          }
        } else if (scope === 'network') {
          lastViewedAt = null
        } else if (scope === 'communities') {
          const user = await prisma.user.findUnique({ where: { id: viewerId }, select: { lastViewedCommunitiesAt: true } })
          lastViewedAt = user?.lastViewedCommunitiesAt ?? null
          if (!cursor) {
            prisma.user.update({ where: { id: viewerId }, data: { lastViewedCommunitiesAt: new Date() } }).catch(console.error)
          }
        } else if (scope === 'organizations') {
          lastViewedAt = null
        } else {
          const user = await prisma.user.findUnique({ where: { id: viewerId }, select: { lastViewedHomeAt: true } })
          lastViewedAt = user?.lastViewedHomeAt ?? null
          if (!cursor) {
            prisma.user.update({ where: { id: viewerId }, data: { lastViewedHomeAt: new Date() } }).catch(console.error)
          }
        }
      }

      if (sortMode === 'hot') {
        const rankOffset = deps.parseFeedRankCursor(cursor).offset
        const candidateTake = Math.min(1500, Math.max(limit * 10, rankOffset + limit + 180, scope === 'all' ? 260 : 200))
        const candidates = await prisma.post.findMany({
          where,
          take: candidateTake,
          orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
          include: deps.POST_INCLUDE,
        })

        const ranked = await deps.rankFeedPosts({
          posts: candidates,
          viewerId: viewerId ?? null,
          scope,
          sortMode,
          cursor,
          context: viewerFeedContext,
          limit,
        })
        items = ranked.items
        nextCursor = ranked.nextCursor
      } else {
        const queryResult = await prisma.post.findMany({
          where,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
          include: deps.POST_INCLUDE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        if (queryResult.length > limit) {
          const next = queryResult.pop()!
          nextCursor = next.id
        }
        items = queryResult
      }

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(
        viewerId,
        items.map((item) => item.id),
        5,
      )

      return {
        items: items.map((item) =>
          deps.formatPost(item, {
            viewerId,
            viewerReaction: reactionsByPost[item.id] ?? null,
            viewerPollOptionId: pollSelectionsByPost[item.id] ?? null,
            recentComments: recentCommentsByPost[item.id] ?? [],
          }),
        ),
        nextCursor,
        lastViewedAt,
      }
    }),
  )

  app.post('/posts/impressions', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (req as any).user?.id as string | undefined
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const parsed = deps.PostImpressionTrackInput.safeParse(req.body ?? {})
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

      const tracked = await deps.recordUserPostImpressions(viewerId, parsed.data.postIds)
      return reply.send({ ok: true, tracked })
    }),
  )
}