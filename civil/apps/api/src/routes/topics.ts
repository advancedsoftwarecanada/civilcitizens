import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ModerationStatus } from '@prisma/client'
import { CursorQuery, JurisdictionEnum, PostSortEnum, normalizeHashtagSlug } from '@civil/shared'
import { z } from 'zod'

type TopicRoutesDeps = Record<string, any>

type TopicRailItem = {
  slug: string
  href: string
  recentPostCount?: number
}

const TopicFollowBody = z.object({
  slug: z.string().min(1).max(80),
})

const TopicSuggestionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
})

const TopicFeedQuery = CursorQuery.extend({
  jurisdiction: JurisdictionEnum.optional(),
  sort: PostSortEnum.optional(),
})

function toTopicRailItem(slug: string, recentPostCount?: number): TopicRailItem {
  return recentPostCount === undefined
    ? {
        slug,
        href: `/t/${slug}`,
      }
    : {
        slug,
        href: `/t/${slug}`,
        recentPostCount,
      }
}

async function loadSuggestedTopics(args: { excludedSlugs?: string[]; limit: number }): Promise<TopicRailItem[]> {
  const excludedSlugs = new Set(
    (args.excludedSlugs ?? [])
      .map((slug) => normalizeHashtagSlug(slug))
      .filter((slug): slug is string => Boolean(slug)),
  )

  const recentPosts = await prisma.post.findMany({
    where: {
      visibility: 'public',
      moderationStatus: ModerationStatus.VISIBLE,
      hashtags: {
        some: {},
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
    select: {
      hashtags: {
        select: {
          tag: true,
        },
      },
    },
  })

  const counts = new Map<string, number>()
  for (const post of recentPosts) {
    for (const hashtag of post.hashtags) {
      const slug = normalizeHashtagSlug(hashtag.tag)
      if (!slug || excludedSlugs.has(slug)) continue
      counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }
  }

  const items = [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .slice(0, args.limit)
    .map(([slug, recentPostCount]) => toTopicRailItem(slug, recentPostCount))

  if (items.length >= args.limit) {
    return items
  }

  const alreadyPicked = new Set([...excludedSlugs, ...items.map((item) => item.slug)])
  const fallback = await prisma.hashtag.findMany({
    where: {
      tag: {
        notIn: [...alreadyPicked],
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: args.limit - items.length,
    select: {
      tag: true,
    },
  })

  return [...items, ...fallback.map((item: { tag: string }) => toTopicRailItem(item.tag))]
}

async function loadTopicPostRows(args: {
  where: Record<string, any>
  limit: number
  cursor?: string
  sortMode: 'hot' | 'new'
  deps: TopicRoutesDeps
}) {
  const { where, limit, cursor, sortMode, deps } = args
  let items: any[] = []
  let nextCursor: string | undefined

  if (sortMode === 'hot') {
    items = await prisma.post.findMany({
      where,
      take: limit,
      orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
      include: deps.POST_INCLUDE,
    })
  } else {
    const rows = await prisma.post.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: deps.POST_INCLUDE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length > limit) {
      const next = rows.pop()!
      nextCursor = next.id
    }
    items = rows
  }

  return { items, nextCursor }
}

async function formatTopicPostRows(args: {
  items: any[]
  viewerId?: string
  deps: TopicRoutesDeps
}) {
  const { items, viewerId, deps } = args
  const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost, causeByPost } = await deps.loadViewerPostFormattingContext(
    viewerId,
    items.map((item) => item.id),
    5,
  )

  return items.map((item) =>
    deps.formatPost(item, {
      viewerId,
      viewerReaction: reactionsByPost[item.id] ?? null,
      viewerPollOptionId: pollSelectionsByPost[item.id] ?? null,
      recentComments: recentCommentsByPost[item.id] ?? [],
      cause: causeByPost[item.id] ?? null,
    }),
  )
}

export function registerTopicRoutes(app: FastifyInstance, deps: TopicRoutesDeps) {
  app.get('/topics/follows', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const follows = await prisma.topicFollow.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          topicSlug: true,
        },
      })

      return reply.send({
        items: follows.map((follow: { topicSlug: string }) => toTopicRailItem(follow.topicSlug)),
      })
    }),
  )

  app.get('/topics/suggestions', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const query = TopicSuggestionsQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const userId = (req as any).user?.id as string | undefined
      const follows = userId
        ? await prisma.topicFollow.findMany({
            where: { userId },
            select: {
              topicSlug: true,
            },
          })
        : []

      const items = await loadSuggestedTopics({
        excludedSlugs: follows.map((follow: { topicSlug: string }) => follow.topicSlug),
        limit: query.data.limit ?? 6,
      })

      return reply.send({ items })
    }),
  )

  app.post('/topics/follows', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = TopicFollowBody.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const topicSlug = normalizeHashtagSlug(parse.data.slug)
      if (!topicSlug) return reply.code(400).send({ error: 'invalid_topic_slug' })

      await prisma.hashtag.upsert({
        where: { tag: topicSlug },
        create: { tag: topicSlug },
        update: {},
      })

      await prisma.topicFollow.upsert({
        where: {
          userId_topicSlug: {
            userId,
            topicSlug,
          },
        },
        create: {
          userId,
          topicSlug,
        },
        update: {},
      })

      return reply.send({
        ok: true,
        topic: toTopicRailItem(topicSlug),
      })
    }),
  )

  app.delete('/topics/follows', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const parse = TopicFollowBody.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const topicSlug = normalizeHashtagSlug(parse.data.slug)
      if (!topicSlug) return reply.code(400).send({ error: 'invalid_topic_slug' })

      const existing = await prisma.topicFollow.findUnique({
        where: {
          userId_topicSlug: {
            userId,
            topicSlug,
          },
        },
        select: {
          topicSlug: true,
        },
      })
      if (!existing) return reply.code(404).send({ error: 'not_following' })

      await prisma.topicFollow.delete({
        where: {
          userId_topicSlug: {
            userId,
            topicSlug,
          },
        },
      })

      return reply.send({ ok: true })
    }),
  )

  app.get('/topics/feed', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const query = TopicFeedQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const follows = await prisma.topicFollow.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
        select: {
          topicSlug: true,
        },
      })

      const followedSlugs = follows
        .map((follow: { topicSlug: string }) => normalizeHashtagSlug(follow.topicSlug))
        .filter((slug: string | undefined | null): slug is string => Boolean(slug))
      const followedTopics = followedSlugs.map((slug: string) => toTopicRailItem(slug))

      if (!followedSlugs.length) {
        return reply.send({
          topics: followedTopics,
          items: [],
          nextCursor: undefined,
        })
      }

      const { cursor, limit, jurisdiction, sort } = query.data
      const viewerBlockState = await deps.loadViewerBlockState(userId)

      const where: any = {
        visibility: 'public',
        hashtags: {
          some: {
            tag: {
              in: followedSlugs,
            },
          },
        },
      }

      if (jurisdiction) {
        where.jurisdiction = jurisdiction
      }
      if (deps.FAMILY_FEED_POST_TYPE) {
        where.type = { not: deps.FAMILY_FEED_POST_TYPE }
      }

      deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

      const { items, nextCursor } = await loadTopicPostRows({
        where,
        limit,
        cursor,
        sortMode: sort ?? 'hot',
        deps,
      })

      return reply.send({
        topics: followedTopics,
        items: await formatTopicPostRows({
          items,
          viewerId: userId,
          deps,
        }),
        nextCursor,
      })
    }),
  )

  app.get('/topics/:slug/posts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = { slug: String((req.params as Record<string, unknown>)?.slug ?? '') }
      const topicSlug = normalizeHashtagSlug(params.slug)
      if (!topicSlug) return reply.code(400).send({ error: 'invalid_topic_slug' })

      const query = TopicFeedQuery.safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { cursor, limit, jurisdiction, sort } = query.data
      const viewerId = (req as any).user?.id as string | undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)

      const where: any = {
        visibility: 'public',
        hashtags: {
          some: {
            tag: topicSlug,
          },
        },
      }

      if (jurisdiction) {
        where.jurisdiction = jurisdiction
      }
      if (deps.FAMILY_FEED_POST_TYPE) {
        where.type = { not: deps.FAMILY_FEED_POST_TYPE }
      }

      deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

      const { items, nextCursor } = await loadTopicPostRows({
        where,
        limit,
        cursor,
        sortMode: sort ?? 'hot',
        deps,
      })

      return reply.send({
        topic: {
          slug: topicSlug,
          href: `/t/${topicSlug}`,
        },
        items: await formatTopicPostRows({
          items,
          viewerId,
          deps,
        }),
        nextCursor,
      })
    }),
  )
}
