import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ModerationStatus, Prisma } from '@prisma/client'
import { CursorQuery, JurisdictionEnum, PostSortEnum, normalizeHashtagSlug } from '@civil/shared'
import { z } from 'zod'

type TopicRoutesDeps = Record<string, any>

type TopicRailItem = {
  slug: string
  href: string
  recentPostCount?: number
}

type TopicFeedCursorState = {
  mode: 'followed' | 'discover'
  postCursor?: string
  usedDiscoverySlugs?: string[]
  activeDiscoverySlugs?: string[]
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
  mediaOnly: z.coerce.boolean().optional(),
  videoOnly: z.coerce.boolean().optional(),
})

const DISCOVERY_TOPIC_BATCH_SIZE = 5
const RANDOM_TOPIC_POOL_SIZE = 80

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

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = next[index]
    next[index] = next[swapIndex] as T
    next[swapIndex] = current as T
  }
  return next
}

function encodeTopicFeedCursor(state: TopicFeedCursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
}

function parseTopicFeedCursor(cursor: string | undefined): TopicFeedCursorState | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as TopicFeedCursorState
    if (parsed.mode !== 'followed' && parsed.mode !== 'discover') return null
    return {
      mode: parsed.mode,
      postCursor: typeof parsed.postCursor === 'string' && parsed.postCursor.trim().length ? parsed.postCursor : undefined,
      usedDiscoverySlugs: Array.isArray(parsed.usedDiscoverySlugs)
        ? parsed.usedDiscoverySlugs.map((slug) => normalizeHashtagSlug(slug)).filter((slug): slug is string => Boolean(slug))
        : [],
      activeDiscoverySlugs: Array.isArray(parsed.activeDiscoverySlugs)
        ? parsed.activeDiscoverySlugs.map((slug) => normalizeHashtagSlug(slug)).filter((slug): slug is string => Boolean(slug))
        : [],
    }
  } catch {
    return null
  }
}

function buildTopicPostsWhere(args: {
  topicSlugs: string[]
  jurisdiction?: string
  mediaOnly?: boolean
  videoOnly?: boolean
  familyFeedPostType?: string | null
}) {
  const where: Record<string, unknown> = {
    visibility: 'public',
    hashtags: {
      some: {
        tag: {
          in: args.topicSlugs,
        },
      },
    },
  }

  if (args.jurisdiction) {
    where.jurisdiction = args.jurisdiction
  }
  if (args.familyFeedPostType) {
    where.type = { not: args.familyFeedPostType }
  }
  if (args.videoOnly) {
    where.AND = [
      {
        OR: [
          { video: { not: Prisma.JsonNull } },
          { video: { not: Prisma.DbNull } },
          { video: { not: null } },
        ],
      },
    ]
  }
  if (args.mediaOnly) {
    where.OR = [
      { mediaUrl: { not: null } },
      { video: { not: Prisma.JsonNull } },
      { video: { not: Prisma.DbNull } },
      { video: { not: null } },
    ]
  }

  return where
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

async function loadRandomTopics(args: { excludedSlugs?: string[]; limit: number }): Promise<TopicRailItem[]> {
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
    take: 500,
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

  const rankedPool = [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .slice(0, RANDOM_TOPIC_POOL_SIZE)
    .map(([slug, recentPostCount]) => toTopicRailItem(slug, recentPostCount))

  const randomPrimary = shuffleArray(rankedPool).slice(0, args.limit)
  if (randomPrimary.length >= args.limit) {
    return randomPrimary
  }

  const alreadyPicked = new Set([...excludedSlugs, ...randomPrimary.map((item) => item.slug)])
  const fallback = await prisma.hashtag.findMany({
    where: {
      tag: {
        notIn: [...alreadyPicked],
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.max(args.limit * 8, 40),
    select: {
      tag: true,
    },
  })

  const fallbackSlugs: string[] = fallback
    .map((item: { tag: string }): string | null => normalizeHashtagSlug(item.tag))
    .filter((slug: string | null): slug is string => {
      if (!slug) return false
      return !alreadyPicked.has(slug)
    })

  const fallbackItems: TopicRailItem[] = fallbackSlugs.map((slug: string) => toTopicRailItem(slug))
  const fallbackRandom: TopicRailItem[] = shuffleArray(fallbackItems).slice(0, args.limit - randomPrimary.length)

  return [...randomPrimary, ...fallbackRandom]
}

async function loadDiscoveryTopicPosts(args: {
  excludedSlugs: string[]
  limit: number
  sortMode: 'hot' | 'new'
  jurisdiction?: string
  mediaOnly?: boolean
  videoOnly?: boolean
  viewerBlockState: unknown
  deps: TopicRoutesDeps
}) {
  const excluded = new Set(
    args.excludedSlugs
      .map((slug) => normalizeHashtagSlug(slug))
      .filter((slug): slug is string => Boolean(slug)),
  )

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const topics = await loadRandomTopics({
      excludedSlugs: [...excluded],
      limit: DISCOVERY_TOPIC_BATCH_SIZE,
    })
    if (!topics.length) {
      return {
        items: [] as any[],
        nextCursor: undefined,
        activeTopicSlugs: [] as string[],
        usedDiscoverySlugs: [...excluded],
        canLoadMore: false,
      }
    }

    const activeTopicSlugs = topics.map((topic) => topic.slug)
    activeTopicSlugs.forEach((slug) => excluded.add(slug))

    const where = buildTopicPostsWhere({
      topicSlugs: activeTopicSlugs,
      jurisdiction: args.jurisdiction,
      mediaOnly: args.mediaOnly,
      videoOnly: args.videoOnly,
      familyFeedPostType: args.deps.FAMILY_FEED_POST_TYPE,
    })

    args.deps.applyVisibleModerationFiltersToPostWhere(where, args.viewerBlockState)

    const { items, nextCursor } = await loadTopicPostRows({
      where,
      limit: args.limit,
      sortMode: args.sortMode,
      deps: args.deps,
    })

    if (items.length || nextCursor) {
      return {
        items,
        nextCursor,
        activeTopicSlugs,
        usedDiscoverySlugs: [...excluded],
        canLoadMore: topics.length >= DISCOVERY_TOPIC_BATCH_SIZE,
      }
    }

    if (topics.length < DISCOVERY_TOPIC_BATCH_SIZE) {
      break
    }
  }

  return {
    items: [] as any[],
    nextCursor: undefined,
    activeTopicSlugs: [] as string[],
    usedDiscoverySlugs: [...excluded],
    canLoadMore: false,
  }
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

      const { cursor, limit, jurisdiction, sort, mediaOnly, videoOnly } = query.data
      const cursorState = parseTopicFeedCursor(cursor)
      const sortMode = sort ?? 'hot'
      const viewerBlockState = await deps.loadViewerBlockState(userId)

      let items: any[] = []
      let nextCursor: string | undefined

      if ((cursorState?.mode ?? 'followed') === 'discover') {
        const usedDiscoverySlugs = Array.from(
          new Set([
            ...followedSlugs,
            ...(cursorState?.usedDiscoverySlugs ?? []),
          ]),
        )
        const activeDiscoverySlugs = Array.from(
          new Set((cursorState?.activeDiscoverySlugs ?? []).filter((slug) => !followedSlugs.includes(slug))),
        )

        if (activeDiscoverySlugs.length) {
          const where = buildTopicPostsWhere({
            topicSlugs: activeDiscoverySlugs,
            jurisdiction,
            mediaOnly,
            videoOnly,
            familyFeedPostType: deps.FAMILY_FEED_POST_TYPE,
          })
          deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

          const continuation = await loadTopicPostRows({
            where,
            limit,
            cursor: cursorState?.postCursor,
            sortMode,
            deps,
          })

          if (continuation.items.length || continuation.nextCursor) {
            items = continuation.items
            nextCursor = continuation.nextCursor
              ? encodeTopicFeedCursor({
                  mode: 'discover',
                  postCursor: continuation.nextCursor,
                  usedDiscoverySlugs,
                  activeDiscoverySlugs,
                })
              : encodeTopicFeedCursor({
                  mode: 'discover',
                  usedDiscoverySlugs,
                  activeDiscoverySlugs: [],
                })
          }
        }

        if (!items.length) {
          const discovery = await loadDiscoveryTopicPosts({
            excludedSlugs: usedDiscoverySlugs,
            limit,
            sortMode,
            jurisdiction,
            mediaOnly,
            videoOnly,
            viewerBlockState,
            deps,
          })
          items = discovery.items
          nextCursor = discovery.nextCursor
            ? encodeTopicFeedCursor({
                mode: 'discover',
                postCursor: discovery.nextCursor,
                usedDiscoverySlugs: discovery.usedDiscoverySlugs,
                activeDiscoverySlugs: discovery.activeTopicSlugs,
              })
            : discovery.canLoadMore
              ? encodeTopicFeedCursor({
                  mode: 'discover',
                  usedDiscoverySlugs: discovery.usedDiscoverySlugs,
                  activeDiscoverySlugs: [],
                })
              : undefined
        }
      } else {
        const where = buildTopicPostsWhere({
          topicSlugs: followedSlugs,
          jurisdiction,
          mediaOnly,
          videoOnly,
          familyFeedPostType: deps.FAMILY_FEED_POST_TYPE,
        })
        deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

        const followedResult = await loadTopicPostRows({
          where,
          limit,
          cursor: cursorState?.postCursor,
          sortMode,
          deps,
        })

        items = followedResult.items
        if (followedResult.nextCursor) {
          nextCursor = encodeTopicFeedCursor({
            mode: 'followed',
            postCursor: followedResult.nextCursor,
          })
        } else {
          const discovery = await loadDiscoveryTopicPosts({
            excludedSlugs: followedSlugs,
            limit,
            sortMode,
            jurisdiction,
            mediaOnly,
            videoOnly,
            viewerBlockState,
            deps,
          })
          if (discovery.items.length) {
            items = discovery.items
          }
          nextCursor = discovery.nextCursor
            ? encodeTopicFeedCursor({
                mode: 'discover',
                postCursor: discovery.nextCursor,
                usedDiscoverySlugs: discovery.usedDiscoverySlugs,
                activeDiscoverySlugs: discovery.activeTopicSlugs,
              })
            : discovery.canLoadMore
              ? encodeTopicFeedCursor({
                  mode: 'discover',
                  usedDiscoverySlugs: discovery.usedDiscoverySlugs,
                  activeDiscoverySlugs: [],
                })
              : undefined
        }
      }

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

      const { cursor, limit, jurisdiction, sort, mediaOnly, videoOnly } = query.data
      const viewerId = (req as any).user?.id as string | undefined
      const viewerBlockState = await deps.loadViewerBlockState(viewerId)

      const where = buildTopicPostsWhere({
        topicSlugs: [topicSlug],
        jurisdiction,
        mediaOnly,
        videoOnly,
        familyFeedPostType: deps.FAMILY_FEED_POST_TYPE,
      })

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
