import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@civil/db'

type DailyCount = {
  date: string
  count: number
}

type DateRange = {
  start: Date
  end: Date
}

type AdminAnalyticsQueryKind = 'users' | 'posts' | 'comments' | 'reactions'

type AdminUser = { id: string; email: string | null }

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

type AdminReportingDeps = {
  buildCommunityHref: (provinceCode?: string | null, communitySlug?: string | null) => string | null
  buildPostHrefForAdmin: (post: AdminPostHrefInput) => string | null
  formatAdminUserSummary: (user: AdminUserSummaryInput) => AdminUserSummaryInput
  formatCommunityFollowLabel: (community: CommunityFollowLabelInput) => string
  isSuperAdminEmail: (email?: string | null) => boolean
  loadAdminUserOrReply: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown | null>
  loadAuthenticatedUser: (req: FastifyRequest) => Promise<AdminUser | null>
  parseRange: (start?: string, end?: string) => DateRange
  queryDailyCounts: (kind: AdminAnalyticsQueryKind, range: DateRange) => Promise<DailyCount[]>
  queryFollowSeries: (range: DateRange) => Promise<DailyCount[]>
  queryJobAnalyticsSeries: (kind: 'job_added' | 'applicant_submitted' | 'applications_viewed' | 'applicant_hired', range: DateRange) => Promise<DailyCount[]>
  queryPageViewSeries: (range: DateRange) => Promise<DailyCount[]>
  retryContentAiScanTarget: (input: { targetType: 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization'; targetId: string }) => Promise<boolean>
  sanitizePlainText: (value: string) => string
  startOfUtcDay: (value: Date) => Date
}

const AdminInspectUserParams = z.object({
  userId: z.string().cuid(),
})

const AdminContentAiScanRetryBody = z.object({
  targetType: z.enum(['post', 'comment', 'market_listing', 'market_product', 'organization_event', 'organization']),
  targetId: z.string().trim().min(1).max(191),
})

export function registerAdminReportingRoutes(app: FastifyInstance, deps: AdminReportingDeps) {
  app.get('/admin/reports/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    let user: AdminUser | null
    try {
      user = await deps.loadAuthenticatedUser(req)
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (!user || !deps.isSuperAdminEmail(user.email)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const query = req.query as Record<string, string | undefined>
    const { start: startParam, end: endParam, format } = query
    const range = deps.parseRange(startParam, endParam)
    const today = deps.startOfUtcDay(new Date())

    const [
      totalUsers,
      usersToday,
      totalPosts,
      postsToday,
      totalComments,
      commentsToday,
      totalReactions,
      reactionsToday,
      totalCommunityFollows,
      totalBusinessFollows,
      communityFollowsToday,
      businessFollowsToday,
      userSeries,
      postSeries,
      commentSeries,
      reactionSeries,
      followSeries,
      pageViewSeries,
      jobsAddedSeries,
      applicantsSeries,
      applicationsViewedSeries,
      hiredSeries,
      routeTraffic,
      topPostViews,
      totalJobsAdded,
      jobsAddedToday,
      totalApplicants,
      applicantsToday,
      totalApplicationsViewed,
      applicationsViewedToday,
      totalApplicantsHired,
      applicantsHiredToday,
      organizationsViewedTotalRows,
      organizationsViewedTodayRows,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.post.count(),
      prisma.post.count({ where: { createdAt: { gte: today } } }),
      prisma.comment.count(),
      prisma.comment.count({ where: { createdAt: { gte: today } } }),
      prisma.postReaction.count(),
      prisma.postReaction.count({ where: { createdAt: { gte: today } } }),
      prisma.communityFollow.count(),
      prisma.businessFollow.count(),
      prisma.communityFollow.count({ where: { createdAt: { gte: today } } }),
      prisma.businessFollow.count({ where: { createdAt: { gte: today } } }),
      deps.queryDailyCounts('users', range),
      deps.queryDailyCounts('posts', range),
      deps.queryDailyCounts('comments', range),
      deps.queryDailyCounts('reactions', range),
      deps.queryFollowSeries(range),
      deps.queryPageViewSeries(range),
      deps.queryJobAnalyticsSeries('job_added', range),
      deps.queryJobAnalyticsSeries('applicant_submitted', range),
      deps.queryJobAnalyticsSeries('applications_viewed', range),
      deps.queryJobAnalyticsSeries('applicant_hired', range),
      prisma.$queryRaw<Array<{ path: string; views: bigint }>>`
        select path, count(*)::bigint as views
        from "PageView"
        where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
        group by path
        order by views desc
        limit 50
      `,
      prisma.$queryRaw<Array<{ postId: string; views: bigint; title: string | null }>>`
        select pv."postId" as "postId", count(*)::bigint as views, p.title as title
        from "PageView" pv
        join "Post" p on p.id = pv."postId"
        where pv."postId" is not null and pv."createdAt" >= ${range.start} and pv."createdAt" < ${range.end}
        group by pv."postId", p.title
        order by views desc
        limit 20
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'job_added'::"JobAnalyticsEventKind"
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'job_added'::"JobAnalyticsEventKind"
          and "createdAt" >= ${today}
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applicant_submitted'::"JobAnalyticsEventKind"
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applicant_submitted'::"JobAnalyticsEventKind"
          and "createdAt" >= ${today}
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
          and "createdAt" >= ${today}
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applicant_hired'::"JobAnalyticsEventKind"
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(*)::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applicant_hired'::"JobAnalyticsEventKind"
          and "createdAt" >= ${today}
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(distinct "businessId")::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        select count(distinct "businessId")::bigint as count
        from "JobAnalyticsEvent"
        where "kind" = 'applications_viewed'::"JobAnalyticsEventKind"
          and "createdAt" >= ${today}
      `,
    ])

    const jobsAddedTotalCount = Number(totalJobsAdded[0]?.count ?? 0)
    const jobsAddedTodayCount = Number(jobsAddedToday[0]?.count ?? 0)
    const followsTotalCount = totalCommunityFollows + totalBusinessFollows
    const followsTodayCount = communityFollowsToday + businessFollowsToday
    const applicantsTotalCount = Number(totalApplicants[0]?.count ?? 0)
    const applicantsTodayCount = Number(applicantsToday[0]?.count ?? 0)
    const applicationsViewedTotalCount = Number(totalApplicationsViewed[0]?.count ?? 0)
    const applicationsViewedTodayCount = Number(applicationsViewedToday[0]?.count ?? 0)
    const applicantsHiredTotalCount = Number(totalApplicantsHired[0]?.count ?? 0)
    const applicantsHiredTodayCount = Number(applicantsHiredToday[0]?.count ?? 0)
    const organizationsViewedTotalCount = Number(organizationsViewedTotalRows[0]?.count ?? 0)
    const organizationsViewedTodayCount = Number(organizationsViewedTodayRows[0]?.count ?? 0)

    const responsePayload = {
      generatedAt: new Date().toISOString(),
      users: {
        total: totalUsers,
        today: usersToday,
        series: userSeries,
      },
      posts: {
        total: totalPosts,
        today: postsToday,
        series: postSeries,
      },
      comments: {
        total: totalComments,
        today: commentsToday,
        series: commentSeries,
      },
      reactions: {
        total: totalReactions,
        today: reactionsToday,
        series: reactionSeries,
      },
      follows: {
        total: followsTotalCount,
        today: followsTodayCount,
        series: followSeries,
      },
      jobs: {
        added: {
          total: jobsAddedTotalCount,
          today: jobsAddedTodayCount,
          series: jobsAddedSeries,
        },
        applicants: {
          total: applicantsTotalCount,
          today: applicantsTodayCount,
          series: applicantsSeries,
        },
        applicationsViewed: {
          views: {
            total: applicationsViewedTotalCount,
            today: applicationsViewedTodayCount,
            series: applicationsViewedSeries,
          },
          organizations: {
            total: organizationsViewedTotalCount,
            today: organizationsViewedTodayCount,
          },
        },
        hired: {
          total: applicantsHiredTotalCount,
          today: applicantsHiredTodayCount,
          series: hiredSeries,
        },
      },
      pageViews: {
        series: pageViewSeries,
      },
      traffic: {
        routes: routeTraffic.map((row: { path: string; views: bigint }) => ({ path: row.path, views: Number(row.views) || 0 })),
        posts: topPostViews.map((row: { postId: string; views: bigint; title: string | null }) => ({ postId: row.postId, views: Number(row.views) || 0, title: row.title })),
      },
    }

    if (format === 'csv') {
      const dateMap = new Map<string, {
        users?: number
        posts?: number
        comments?: number
        reactions?: number
        views?: number
        jobsAdded?: number
        applicants?: number
        applicationsViewed?: number
        hired?: number
      }>()
      const ingest = (series: DailyCount[], key: keyof NonNullable<ReturnType<typeof dateMap.get>>) => {
        series.forEach((point) => {
          const existing = dateMap.get(point.date) || {}
          existing[key] = point.count
          dateMap.set(point.date, existing)
        })
      }
      ingest(userSeries, 'users')
      ingest(postSeries, 'posts')
      ingest(commentSeries, 'comments')
      ingest(reactionSeries, 'reactions')
      ingest(pageViewSeries, 'views')
      ingest(jobsAddedSeries, 'jobsAdded')
      ingest(applicantsSeries, 'applicants')
      ingest(applicationsViewedSeries, 'applicationsViewed')
      ingest(hiredSeries, 'hired')

      const sortedDates = Array.from(dateMap.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      const rows = sortedDates.map((date) => {
        const entry = dateMap.get(date) || {}
        return [
          date,
          entry.users ?? 0,
          entry.posts ?? 0,
          entry.comments ?? 0,
          entry.reactions ?? 0,
          entry.views ?? 0,
          entry.jobsAdded ?? 0,
          entry.applicants ?? 0,
          entry.applicationsViewed ?? 0,
          entry.hired ?? 0,
        ].join(',')
      })

      const csv = ['date,users,posts,comments,reactions,pageViews,jobsAdded,applicants,applicationsViewed,applicantsHired', ...rows].join('\n')
      return reply.header('content-type', 'text/csv').send(csv)
    }

    return reply.send(responsePayload)
  })

  app.post('/admin/content-ai-scans/retry', async (req: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await deps.loadAdminUserOrReply(req, reply)
    if (!adminUser) return

    const body = AdminContentAiScanRetryBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const retried = await deps.retryContentAiScanTarget(body.data)
    if (!retried) return reply.code(404).send({ error: 'content_ai_scan_target_not_found' })

    return reply.send({ queued: true })
  })

  app.get('/admin/users/:userId/inspect', async (req: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await deps.loadAdminUserOrReply(req, reply)
    if (!adminUser) return

    const params = AdminInspectUserParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const inspectedUser = await prisma.user.findUnique({
      where: { id: params.data.userId },
      select: {
        id: true,
        email: true,
        handle: true,
        name: true,
        bio: true,
        avatarUrl: true,
        coverUrl: true,
        createdAt: true,
        lastLoginAt: true,
        premiumStatus: true,
        communityFollows: {
          orderBy: [{ home: 'desc' }, { createdAt: 'asc' }],
          take: 8,
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
            jobApplications: true,
            jobPostingsCreated: true,
            communityFollows: true,
          },
        },
      },
    })

    if (!inspectedUser) return reply.code(404).send({ error: 'user_not_found' })

    const [recentPosts, recentComments, recentReports] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: inspectedUser.id },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          moderationStatus: true,
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
      }),
      prisma.comment.findMany({
        where: { userId: inspectedUser.id },
        orderBy: [{ createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          body: true,
          createdAt: true,
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
      }),
      prisma.contentReport.findMany({
        where: { reportedUserId: inspectedUser.id },
        orderBy: [{ createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          targetType: true,
          targetLabel: true,
          targetUrl: true,
          reasons: true,
          status: true,
          createdAt: true,
        },
      }),
    ])

    return reply.send({
      user: {
        ...(deps.formatAdminUserSummary(inspectedUser) as object),
        email: inspectedUser.email,
        bio: inspectedUser.bio ? deps.sanitizePlainText(inspectedUser.bio) : null,
        createdAt: inspectedUser.createdAt.toISOString(),
        lastLoginAt: inspectedUser.lastLoginAt?.toISOString() ?? null,
        premiumStatus: inspectedUser.premiumStatus,
        communities: {
          count: inspectedUser._count.communityFollows,
          items: inspectedUser.communityFollows.map((community: any) => ({
            provinceCode: community.provinceCode,
            communitySlug: community.communitySlug,
            home: community.home,
            label: deps.formatCommunityFollowLabel(community),
            href: deps.buildCommunityHref(community.provinceCode, community.communitySlug),
          })),
        },
      },
      stats: {
        posts: inspectedUser._count.posts,
        comments: inspectedUser._count.comments,
        organizationsOwned: inspectedUser._count.businesses,
        reportsFiled: inspectedUser._count.contentReportsFiled,
        reportsAgainst: inspectedUser._count.contentReportsTargeting,
        jobApplications: inspectedUser._count.jobApplications,
        jobsCreated: inspectedUser._count.jobPostingsCreated,
        communities: inspectedUser._count.communityFollows,
      },
      recentPosts: recentPosts.map((entry: any) => ({
        id: entry.id,
        title: entry.title?.trim() || deps.sanitizePlainText(entry.body).slice(0, 90) || 'Untitled post',
        createdAt: entry.createdAt.toISOString(),
        moderationStatus: entry.moderationStatus,
        url: deps.buildPostHrefForAdmin(entry),
      })),
      recentComments: recentComments.map((entry: any) => ({
        id: entry.id,
        body: deps.sanitizePlainText(entry.body).slice(0, 160).trim(),
        createdAt: entry.createdAt.toISOString(),
        post: {
          id: entry.post.id,
          title: entry.post.title?.trim() || deps.sanitizePlainText(entry.post.body).slice(0, 90) || 'Untitled post',
          url: deps.buildPostHrefForAdmin(entry.post),
        },
      })),
      recentReports: recentReports.map((entry: any) => ({
        id: entry.id,
        targetType: entry.targetType,
        targetLabel: entry.targetLabel,
        targetUrl: entry.targetUrl,
        reasons: entry.reasons,
        status: entry.status,
        createdAt: entry.createdAt.toISOString(),
      })),
    })
  })
}
