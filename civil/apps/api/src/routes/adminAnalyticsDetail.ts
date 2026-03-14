import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@civil/db'
import { Prisma, ContentReportStatus, ModerationTargetType } from '@prisma/client'

const ModerationReportReasonValues = [
  'spam_or_scam',
  'hate_or_harassment',
  'violence_or_threats',
  'sexual_or_explicit',
  'child_safety',
  'impersonation',
  'misinformation',
  'illegal_goods_or_services',
  'copyright_or_ip',
  'other',
] as const

const AdminAnalyticsDetailMetricValues = [
  'users',
  'posts',
  'comments',
  'reactions',
  'follows',
  'jobsAdded',
  'applicants',
  'applicationsViewed',
  'hired',
] as const

const AdminAnalyticsDetailQuery = z.object({
  metric: z.enum(AdminAnalyticsDetailMetricValues),
  start: z.string().trim().optional(),
  end: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  page: z.coerce.number().int().min(1).max(500).default(1),
  flagReason: z.enum(ModerationReportReasonValues).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  authorId: z.string().cuid().optional(),
})

type DateRange = {
  start: Date
  end: Date
}

type ContentAiScanTargetType = 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization'

type ContentAiScanSummary = {
  status: string
  moderationState: string | null
  labelSummary: string | null
  labels: string[]
  moderationFlags: string[]
  errorText: string | null
  updatedAt: string | null
  completedAt: string | null
}

type AdminUserSummaryInput = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

type CommunityFollowLabelInput = {
  provinceCode: string
  communitySlug: string
  home?: boolean | null
}

type AdminPostHrefInput = {
  id: string
  seoSlug?: string | null
  provinceCode?: string | null
  communitySlug?: string | null
  author?: { handle?: string | null } | null
  business?: { provinceCode?: string | null; communitySlug?: string | null } | null
}

type BusinessHrefInput = {
  provinceCode?: string | null
  communitySlug?: string | null
  slug?: string | null
}

type AdminAnalyticsDetailDeps = {
  buildAdminUserSearchWhere: (search: string) => Prisma.UserWhereInput
  buildBusinessHrefForAdmin: (business?: BusinessHrefInput | null) => string | null
  buildCommunityHref: (provinceCode?: string | null, communitySlug?: string | null) => string | null
  buildOrganizationEventScanTargetId: (orgId: string, eventId: string) => string
  buildPostHrefForAdmin: (post: AdminPostHrefInput) => string | null
  buildSearchableText: (...parts: string[]) => string
  ensureCitizenMarketplaceTables: () => Promise<void> | void
  ensureContentAiScanTables: () => Promise<void> | void
  formatAdminUserSummary: (user: AdminUserSummaryInput) => AdminUserSummaryInput
  formatCommunityFollowLabel: (community: CommunityFollowLabelInput) => string
  loadAdminUserOrReply: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown | null>
  normalizeSearchTerm: (value: string) => string
  parseRange: (start?: string, end?: string) => DateRange
  readOrganizationSystemState: (metadata: unknown) => { events: any[] }
  readStringList: (raw: unknown) => string[]
  sanitizePlainText: (value: string) => string
  stripHtmlToPlainText: (value: string) => string
  summarizeReportReasons: (reports: Array<{ reasons: string[]; status: ContentReportStatus; createdAt: Date }>) => {
    count: number
    openCount: number
    reviewedCount: number
    reasons: string[]
    latestReportedAt: string | null
  }
}

function buildContentAiScanDefaultSummary(): ContentAiScanSummary {
  return {
    status: 'not_queued',
    moderationState: null,
    labelSummary: null,
    labels: [],
    moderationFlags: [],
    errorText: null,
    updatedAt: null,
    completedAt: null,
  }
}

export function registerAdminAnalyticsDetailRoutes(app: FastifyInstance, deps: AdminAnalyticsDetailDeps) {
  app.get('/admin/reports/detail', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const query = AdminAnalyticsDetailQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const range = deps.parseRange(query.data.start, query.data.end)
    const limit = query.data.limit
    const normalizedSearch = query.data.search ? deps.normalizeSearchTerm(query.data.search) : ''

    if (query.data.metric === 'users') {
      const users = await prisma.user.findMany({
        where: normalizedSearch
          ? deps.buildAdminUserSearchWhere(normalizedSearch)
          : { createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          email: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          createdAt: true,
          lastLoginAt: true,
          premiumStatus: true,
          communityFollows: {
            orderBy: [{ home: 'desc' }, { createdAt: 'asc' }],
            take: 3,
            select: {
              provinceCode: true,
              communitySlug: true,
              home: true,
            },
          },
          _count: {
            select: {
              posts: true,
              comments: true,
              businesses: true,
              contentReportsFiled: true,
              contentReportsTargeting: true,
              communityFollows: true,
            },
          },
        },
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: users.map((entry: any) => ({
          ...deps.formatAdminUserSummary(entry),
          email: entry.email,
          createdAt: entry.createdAt.toISOString(),
          lastLoginAt: entry.lastLoginAt?.toISOString() ?? null,
          premiumStatus: entry.premiumStatus,
          communities: {
            count: entry._count.communityFollows,
            items: entry.communityFollows.map((community: any) => ({
              provinceCode: community.provinceCode,
              communitySlug: community.communitySlug,
              home: community.home,
              label: deps.formatCommunityFollowLabel(community),
              href: deps.buildCommunityHref(community.provinceCode, community.communitySlug),
            })),
          },
          postCount: entry._count.posts,
          commentCount: entry._count.comments,
          organizationsOwned: entry._count.businesses,
          reportsFiled: entry._count.contentReportsFiled,
          reportsAgainst: entry._count.contentReportsTargeting,
        })),
      })
    }

    if (query.data.metric === 'posts') {
      await deps.ensureContentAiScanTables()
      await deps.ensureCitizenMarketplaceTables()

      const page = query.data.page
      const pageSize = query.data.limit
      const offset = (page - 1) * pageSize
      const sourceTake = Math.min(offset + pageSize + 1, 600)

      let flaggedPostIds: string[] | null = null
      let flaggedListingIds: string[] | null = null

      if (query.data.flagReason) {
        const flaggedReports = await prisma.contentReport.findMany({
          where: {
            targetType: { in: [ModerationTargetType.POST, ModerationTargetType.MARKET_LISTING] },
            reasons: { has: query.data.flagReason },
          },
          select: { targetId: true, targetType: true },
          take: 500,
        })
        flaggedPostIds = Array.from(
          new Set(flaggedReports.filter((entry: any) => entry.targetType === ModerationTargetType.POST).map((entry: any) => entry.targetId)),
        )
        flaggedListingIds = Array.from(
          new Set(flaggedReports.filter((entry: any) => entry.targetType === ModerationTargetType.MARKET_LISTING).map((entry: any) => entry.targetId)),
        )
        if (!flaggedPostIds.length && !flaggedListingIds.length) {
          return reply.send({ metric: query.data.metric, generatedAt: new Date().toISOString(), items: [], page, hasMore: false })
        }
      }

      const posts = await prisma.post.findMany({
        where: {
          ...(query.data.authorId ? { authorId: query.data.authorId } : {}),
          ...(!query.data.authorId ? { createdAt: { gte: range.start, lt: range.end } } : {}),
          ...(flaggedPostIds ? { id: { in: flaggedPostIds } } : {}),
          ...(normalizedSearch
            ? {
                OR: [
                  { title: { contains: normalizedSearch, mode: 'insensitive' } },
                  { body: { contains: normalizedSearch, mode: 'insensitive' } },
                  { author: { handle: { contains: normalizedSearch.replace(/^@/, ''), mode: 'insensitive' } } },
                  { author: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: sourceTake,
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          seoSlug: true,
          provinceCode: true,
          communitySlug: true,
          jurisdiction: true,
          moderationStatus: true,
          commentCount: true,
          upvotes: true,
          downvotes: true,
          reactionTotal: true,
          author: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
            },
          },
        },
      })

      const listingSearchLike = `%${normalizedSearch}%`
      const listingHandleLike = `%${normalizedSearch.replace(/^@/, '')}%`
      const listingWhereClauses: Prisma.Sql[] = [Prisma.sql`l.is_active = TRUE`]

      if (query.data.authorId) {
        listingWhereClauses.push(Prisma.sql`l.seller_user_id = ${query.data.authorId}`)
      } else {
        listingWhereClauses.push(Prisma.sql`l.created_at >= ${range.start}`)
        listingWhereClauses.push(Prisma.sql`l.created_at < ${range.end}`)
      }

      if (flaggedListingIds) {
        listingWhereClauses.push(Prisma.sql`l.id IN (${Prisma.join(flaggedListingIds)})`)
      }

      if (normalizedSearch) {
        listingWhereClauses.push(Prisma.sql`
          (
            LOWER(COALESCE(l.title, '')) LIKE ${listingSearchLike}
            OR LOWER(COALESCE(l.description, '')) LIKE ${listingSearchLike}
            OR LOWER(COALESCE(u.handle, '')) LIKE ${listingHandleLike}
            OR LOWER(COALESCE(u.name, '')) LIKE ${listingSearchLike}
          )
        `)
      }

      const listings = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          l.id,
          l.seller_user_id,
          l.title,
          l.description,
          l.price_cents,
          l.currency,
          l.pickup_city,
          l.pickup_province,
          l.listing_province_code,
          l.listing_community_slug,
          l.moderation_status,
          l.status,
          l.created_at,
          u.handle AS seller_handle,
          u.name AS seller_name,
          u."avatarUrl" AS seller_avatar_url,
          u."coverUrl" AS seller_cover_url
        FROM citizen_market_listing l
        INNER JOIN "User" u ON u.id = l.seller_user_id
        WHERE ${Prisma.join(listingWhereClauses, ' AND ')}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${sourceTake}
      `)) as Array<any>

      const eventBusinesses = await prisma.business.findMany({
        where: query.data.authorId ? { ownerId: query.data.authorId } : undefined,
        select: {
          id: true,
          ownerId: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          metadata: true,
          owner: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
        },
      })

      const eventRows = eventBusinesses
        .flatMap((business: any) => {
          const system = deps.readOrganizationSystemState(business.metadata)
          return system.events.map((event: any) => ({ business, event }))
        })
        .filter(({ event }: any) => {
          const createdAt = new Date(event.createdAt)
          if (Number.isNaN(createdAt.getTime())) return false
          if (!query.data.authorId && (createdAt < range.start || createdAt >= range.end)) return false
          if (!normalizedSearch) return true
          const haystack = deps.buildSearchableText(event.title, deps.stripHtmlToPlainText(event.description ?? ''))
          return haystack.includes(normalizedSearch)
        })
        .sort((left: any, right: any) => {
          const leftTime = new Date(left.event.createdAt).getTime()
          const rightTime = new Date(right.event.createdAt).getTime()
          if (rightTime !== leftTime) return rightTime - leftTime
          return left.event.id.localeCompare(right.event.id)
        })
        .slice(0, sourceTake)

      const postIds = posts.map((entry: any) => entry.id)
      const listingIds = listings.map((entry: any) => entry.id)

      const reportRows = postIds.length || listingIds.length
        ? await prisma.contentReport.findMany({
            where: {
              OR: [
                ...(postIds.length ? [{ targetType: ModerationTargetType.POST, targetId: { in: postIds } }] : []),
                ...(listingIds.length ? [{ targetType: ModerationTargetType.MARKET_LISTING, targetId: { in: listingIds } }] : []),
              ],
            },
            orderBy: [{ createdAt: 'desc' }],
            select: {
              targetType: true,
              targetId: true,
              reasons: true,
              status: true,
              createdAt: true,
            },
          })
        : []

      const reportsByTargetKey = new Map<string, Array<{ reasons: string[]; status: ContentReportStatus; createdAt: Date }>>()
      reportRows.forEach((report: any) => {
        const bucket = reportsByTargetKey.get(`${report.targetType}:${report.targetId}`) ?? []
        bucket.push(report)
        reportsByTargetKey.set(`${report.targetType}:${report.targetId}`, bucket)
      })

      const postScanRows = postIds.length
        ? await prisma.$queryRaw<Array<any>>`
            SELECT target_id, status, moderation_state, label_summary, labels, moderation_flags, error_text, updated_at, completed_at
            FROM content_ai_scan
            WHERE target_type = ${'post'}
              AND target_id IN (${Prisma.join(postIds)})
          `
        : []

      const listingScanRows = listingIds.length
        ? await prisma.$queryRaw<Array<any>>`
            SELECT target_id, status, moderation_state, label_summary, labels, moderation_flags, error_text, updated_at, completed_at
            FROM content_ai_scan
            WHERE target_type = ${'market_listing'}
              AND target_id IN (${Prisma.join(listingIds)})
          `
        : []

      const eventScanTargetIds = eventRows.map(({ business, event }: any) => deps.buildOrganizationEventScanTargetId(business.id, event.id))
      const eventScanRows = eventScanTargetIds.length
        ? await prisma.$queryRaw<Array<any>>`
            SELECT target_id, status, moderation_state, label_summary, labels, moderation_flags, error_text, updated_at, completed_at
            FROM content_ai_scan
            WHERE target_type = ${'organization_event'}
              AND target_id IN (${Prisma.join(eventScanTargetIds)})
          `
        : []

      const scansByTargetKey = new Map<string, ContentAiScanSummary>()
      const ingestScanRows = (targetType: ContentAiScanTargetType, rows: Array<any>) => {
        rows.forEach((scan) => {
          scansByTargetKey.set(`${targetType}:${scan.target_id}`, {
            status: scan.status,
            moderationState: scan.moderation_state,
            labelSummary: scan.label_summary,
            labels: deps.readStringList(scan.labels),
            moderationFlags: deps.readStringList(scan.moderation_flags),
            errorText: scan.error_text,
            updatedAt: scan.updated_at?.toISOString() ?? null,
            completedAt: scan.completed_at?.toISOString() ?? null,
          })
        })
      }

      ingestScanRows('post', postScanRows)
      ingestScanRows('market_listing', listingScanRows)
      ingestScanRows('organization_event', eventScanRows)

      const items = [
        ...posts.map((post: any) => {
          const reportSummary = deps.summarizeReportReasons(reportsByTargetKey.get(`${ModerationTargetType.POST}:${post.id}`) ?? [])
          return {
            id: `post:${post.id}`,
            aiScanTargetType: 'post',
            aiScanTargetId: post.id,
            createdAt: post.createdAt.toISOString(),
            contentType: 'social_post',
            title: post.title?.trim() || null,
            preview: deps.sanitizePlainText(post.body).slice(0, 220).trim(),
            url: deps.buildPostHrefForAdmin(post),
            sourceLabel: post.business ? 'Organization post' : post.communitySlug ? 'Community post' : 'Citizen post',
            metaLine: post.jurisdiction,
            moderationStatus: post.moderationStatus,
            commentCount: post.commentCount,
            reactionCount: post.reactionTotal,
            score: post.upvotes - post.downvotes,
            author: deps.formatAdminUserSummary(post.author),
            organization: post.business
              ? {
                  id: post.business.id,
                  name: post.business.name,
                  slug: post.business.slug,
                  href: deps.buildBusinessHrefForAdmin(post.business),
                }
              : null,
            flags: reportSummary,
            aiScan: scansByTargetKey.get(`post:${post.id}`) ?? buildContentAiScanDefaultSummary(),
          }
        }),
        ...listings.map((listing: any) => {
          const reportSummary = deps.summarizeReportReasons(reportsByTargetKey.get(`${ModerationTargetType.MARKET_LISTING}:${listing.id}`) ?? [])
          const locationLabel = [listing.pickup_city, listing.pickup_province].filter(Boolean).join(', ')
          let priceLabel = `${((Number(listing.price_cents) || 0) / 100).toFixed(2)} ${listing.currency}`
          try {
            priceLabel = new Intl.NumberFormat('en-CA', { style: 'currency', currency: String(listing.currency || 'CAD').toUpperCase() }).format((Number(listing.price_cents) || 0) / 100)
          } catch {
            priceLabel = `${((Number(listing.price_cents) || 0) / 100).toFixed(2)} ${listing.currency}`
          }
          return {
            id: `market_listing:${listing.id}`,
            aiScanTargetType: 'market_listing',
            aiScanTargetId: listing.id,
            createdAt: listing.created_at.toISOString(),
            contentType: 'market_listing',
            title: listing.title?.trim() || null,
            preview: deps.sanitizePlainText(listing.description ?? '').slice(0, 220).trim(),
            url: `/market/listings/${encodeURIComponent(listing.id)}`,
            sourceLabel: 'Market listing',
            metaLine: [priceLabel, locationLabel].filter(Boolean).join(' · ') || null,
            moderationStatus: listing.moderation_status,
            commentCount: 0,
            reactionCount: 0,
            score: 0,
            author: deps.formatAdminUserSummary({
              id: listing.seller_user_id,
              handle: listing.seller_handle,
              name: listing.seller_name,
              avatarUrl: listing.seller_avatar_url,
              coverUrl: listing.seller_cover_url,
            }),
            organization: null,
            flags: reportSummary,
            aiScan: scansByTargetKey.get(`market_listing:${listing.id}`) ?? buildContentAiScanDefaultSummary(),
          }
        }),
        ...eventRows.map(({ business, event }: any) => ({
          id: `organization_event:${event.id}`,
          aiScanTargetType: 'organization_event',
          aiScanTargetId: deps.buildOrganizationEventScanTargetId(business.id, event.id),
          createdAt: new Date(event.createdAt).toISOString(),
          contentType: 'organization_event',
          title: event.title?.trim() || null,
          preview: deps.sanitizePlainText(event.description ?? '').slice(0, 220).trim(),
          url:
            business.provinceCode && business.communitySlug && business.slug
              ? `/com/${encodeURIComponent(business.provinceCode.toLowerCase())}/${encodeURIComponent(business.communitySlug.toLowerCase())}/orgs/${encodeURIComponent(business.slug)}/events/${encodeURIComponent(event.id)}`
              : null,
          sourceLabel: 'Organization event',
          metaLine: event.startsAt ? `Starts ${new Date(event.startsAt).toLocaleString()}` : null,
          moderationStatus: event.status ?? 'PUBLISHED',
          commentCount: 0,
          reactionCount: 0,
          score: 0,
          author: deps.formatAdminUserSummary(business.owner),
          organization: {
            id: business.id,
            name: business.name,
            slug: business.slug,
            href: deps.buildBusinessHrefForAdmin(business),
          },
          flags: deps.summarizeReportReasons([]),
          aiScan:
            scansByTargetKey.get(`organization_event:${deps.buildOrganizationEventScanTargetId(business.id, event.id)}`) ??
            buildContentAiScanDefaultSummary(),
        })),
      ]
        .sort((left, right) => {
          const leftTime = new Date(left.createdAt).getTime()
          const rightTime = new Date(right.createdAt).getTime()
          if (rightTime !== leftTime) return rightTime - leftTime
          return left.id.localeCompare(right.id)
        })

      const pagedItems = items.slice(offset, offset + pageSize)
      const hasMore = offset + pageSize < items.length

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: pagedItems,
        page,
        hasMore,
      })
    }

    if (query.data.metric === 'comments') {
      const comments = await prisma.comment.findMany({
        where: { createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          body: true,
          createdAt: true,
          moderationStatus: true,
          upvotes: true,
          downvotes: true,
          user: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
          post: {
            select: {
              id: true,
              title: true,
              body: true,
              seoSlug: true,
              provinceCode: true,
              communitySlug: true,
              business: {
                select: {
                  provinceCode: true,
                  communitySlug: true,
                },
              },
              author: {
                select: {
                  handle: true,
                },
              },
            },
          },
        },
      })

      const scanRows = comments.length
        ? await prisma.$queryRaw<Array<any>>`
            SELECT target_id, status, moderation_state, label_summary, labels, moderation_flags, error_text, updated_at, completed_at
            FROM content_ai_scan
            WHERE target_type = ${'comment'}
              AND target_id IN (${Prisma.join(comments.map((entry: any) => entry.id))})
          `
        : []

      const scansByCommentId = new Map<string, ContentAiScanSummary>()
      scanRows.forEach((scan: any) => {
        scansByCommentId.set(scan.target_id, {
          status: scan.status,
          moderationState: scan.moderation_state,
          labelSummary: scan.label_summary,
          labels: deps.readStringList(scan.labels),
          moderationFlags: deps.readStringList(scan.moderation_flags),
          errorText: scan.error_text,
          updatedAt: scan.updated_at?.toISOString() ?? null,
          completedAt: scan.completed_at?.toISOString() ?? null,
        })
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: comments.map((entry: any) => ({
          id: entry.id,
          aiScanTargetType: 'comment',
          aiScanTargetId: entry.id,
          createdAt: entry.createdAt.toISOString(),
          body: deps.sanitizePlainText(entry.body).slice(0, 220).trim(),
          moderationStatus: entry.moderationStatus,
          score: entry.upvotes - entry.downvotes,
          author: deps.formatAdminUserSummary(entry.user),
          post: {
            id: entry.post.id,
            title: entry.post.title?.trim() || deps.sanitizePlainText(entry.post.body).slice(0, 90) || 'Untitled post',
            url: deps.buildPostHrefForAdmin(entry.post),
          },
          aiScan: scansByCommentId.get(entry.id) ?? buildContentAiScanDefaultSummary(),
        })),
      })
    }

    if (query.data.metric === 'reactions') {
      const reactions = await prisma.postReaction.findMany({
        where: { createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          createdAt: true,
          type: true,
          user: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
          post: {
            select: {
              id: true,
              title: true,
              body: true,
              seoSlug: true,
              provinceCode: true,
              communitySlug: true,
              business: {
                select: {
                  provinceCode: true,
                  communitySlug: true,
                },
              },
              author: {
                select: {
                  handle: true,
                },
              },
            },
          },
        },
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: reactions.map((entry: any) => ({
          createdAt: entry.createdAt.toISOString(),
          type: entry.type,
          user: deps.formatAdminUserSummary(entry.user),
          post: {
            id: entry.post.id,
            title: entry.post.title?.trim() || deps.sanitizePlainText(entry.post.body).slice(0, 90) || 'Untitled post',
            url: deps.buildPostHrefForAdmin(entry.post),
          },
        })),
      })
    }

    if (query.data.metric === 'follows') {
      const [communityFollows, businessFollows] = await Promise.all([
        prisma.communityFollow.findMany({
          where: { createdAt: { gte: range.start, lt: range.end } },
          orderBy: [{ createdAt: 'desc' }],
          take: limit,
          select: {
            id: true,
            createdAt: true,
            provinceCode: true,
            communitySlug: true,
            user: {
              select: {
                id: true,
                handle: true,
                name: true,
                avatarUrl: true,
                coverUrl: true,
              },
            },
          },
        }),
        prisma.businessFollow.findMany({
          where: { createdAt: { gte: range.start, lt: range.end } },
          orderBy: [{ createdAt: 'desc' }],
          take: limit,
          select: {
            id: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                handle: true,
                name: true,
                avatarUrl: true,
                coverUrl: true,
              },
            },
            business: {
              select: {
                id: true,
                name: true,
                slug: true,
                provinceCode: true,
                communitySlug: true,
              },
            },
          },
        }),
      ])

      const items = [
        ...communityFollows.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          type: 'community',
          user: deps.formatAdminUserSummary(entry.user),
          label: `${entry.provinceCode.toUpperCase()} / ${entry.communitySlug}`,
          href: deps.buildCommunityHref(entry.provinceCode, entry.communitySlug),
        })),
        ...businessFollows.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          type: 'organization',
          user: deps.formatAdminUserSummary(entry.user),
          label: entry.business.name,
          href: deps.buildBusinessHrefForAdmin(entry.business),
        })),
      ]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, limit)

      return reply.send({ metric: query.data.metric, generatedAt: new Date().toISOString(), items })
    }

    if (query.data.metric === 'jobsAdded') {
      const jobs = await prisma.jobPosting.findMany({
        where: { createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          title: true,
          createdAt: true,
          status: true,
          applicantCount: true,
          publishedAt: true,
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
        },
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: jobs.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          title: entry.title,
          status: entry.status,
          publishedAt: entry.publishedAt?.toISOString() ?? null,
          applicantCount: entry.applicantCount,
          organization: {
            id: entry.business.id,
            name: entry.business.name,
            href: deps.buildBusinessHrefForAdmin(entry.business),
          },
          createdBy: deps.formatAdminUserSummary(entry.createdBy),
        })),
      })
    }

    if (query.data.metric === 'applicants') {
      const applicants = await prisma.jobApplication.findMany({
        where: { createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          createdAt: true,
          status: true,
          applicant: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
          jobPosting: {
            select: {
              id: true,
              title: true,
              status: true,
              business: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  provinceCode: true,
                  communitySlug: true,
                },
              },
            },
          },
        },
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: applicants.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          status: entry.status,
          applicant: deps.formatAdminUserSummary(entry.applicant),
          job: {
            id: entry.jobPosting.id,
            title: entry.jobPosting.title,
            status: entry.jobPosting.status,
          },
          organization: {
            id: entry.jobPosting.business.id,
            name: entry.jobPosting.business.name,
            href: deps.buildBusinessHrefForAdmin(entry.jobPosting.business),
          },
        })),
      })
    }

    if (query.data.metric === 'applicationsViewed') {
      const views = await prisma.jobAnalyticsEvent.findMany({
        where: {
          kind: 'applications_viewed',
          createdAt: { gte: range.start, lt: range.end },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarUrl: true,
              coverUrl: true,
            },
          },
          jobPosting: {
            select: {
              id: true,
              title: true,
            },
          },
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
            },
          },
        },
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: views.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          viewer: entry.actor ? deps.formatAdminUserSummary(entry.actor) : null,
          job: entry.jobPosting ? { id: entry.jobPosting.id, title: entry.jobPosting.title } : null,
          organization: {
            id: entry.business.id,
            name: entry.business.name,
            href: deps.buildBusinessHrefForAdmin(entry.business),
          },
        })),
      })
    }

    if (query.data.metric === 'hired') {
      const hires = await prisma.jobAnalyticsEvent.findMany({
        where: {
          kind: 'applicant_hired',
          createdAt: { gte: range.start, lt: range.end },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          createdAt: true,
          jobPosting: {
            select: {
              id: true,
              title: true,
            },
          },
          jobApplication: {
            select: {
              applicant: {
                select: {
                  id: true,
                  handle: true,
                  name: true,
                  avatarUrl: true,
                  coverUrl: true,
                },
              },
            },
          },
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
            },
          },
        },
      })

      return reply.send({
        metric: query.data.metric,
        generatedAt: new Date().toISOString(),
        items: hires.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          applicant: entry.jobApplication?.applicant ? deps.formatAdminUserSummary(entry.jobApplication.applicant) : null,
          job: entry.jobPosting ? { id: entry.jobPosting.id, title: entry.jobPosting.title } : null,
          organization: {
            id: entry.business.id,
            name: entry.business.name,
            href: deps.buildBusinessHrefForAdmin(entry.business),
          },
        })),
      })
    }

    return reply.code(400).send({ error: 'unsupported_metric' })
  })
}