import { prisma } from '@civil/db'
import { Prisma, BusinessStatus } from '@prisma/client'
import type { CivilAiCardReference } from './civilAiCore.js'

export type CivilAiOrganizationDataItem = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  isVerified: boolean
  provinceCode: string
  communitySlug: string
  communityName: string | null
  href: string
  role?: 'owner' | 'member' | 'followed'
}

export type CivilAiPostDataItem = {
  id: string
  title: string | null
  excerpt: string | null
  imageUrl: string | null
  communityName: string | null
  provinceName: string | null
  author: {
    handle: string
    name: string | null
    avatarUrl: string | null
  }
  organization: {
    name: string
    slug: string
    logoUrl: string | null
    isVerified: boolean
  } | null
  href: string
}

export type CivilAiEventDataItem = {
  id: string
  title: string
  description: string | null
  startsAt: string
  primaryPhotoUrl: string | null
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    isVerified: boolean
  }
}

export type CivilAiJobDataItem = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'active' | 'closed' | 'expired'
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  description: string | null
  photoUrl: string | null
  duties: string
  roleRequirements: string
  location: string
  applicantCount: number
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  expiresAt: string
  sponsored: boolean
  marketing: {
    impressions: number
    views: number
    applications: number
    activePromotion: boolean
    impressionCap: number
  }
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
}

export type CivilAiMarketDataItem = {
  id: string
  title: string
  description?: string | null
  priceLabel: string
  locationLabel: string | null
  href: string
  imageUrl: string | null
}

type CivilAiCommunityLike = {
  id: string
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
  href: string
}

type ViewerFeedContextLike = {
  viewerId: string
  friendIds: Iterable<string>
}

type CivilAiSourcesDeps = {
  parseCivilAiCommunityId: (value: string) => CivilAiCommunityLike | null
  loadFeedActivityEvents: (args: { communityKeys: string[]; organizationIds: string[]; limit: number }) => Promise<CivilAiEventDataItem[]>
  loadFeedActivityJobs: (args: { communityKeys: string[]; organizationIds: string[]; limit: number }) => Promise<CivilAiJobDataItem[]>
  filterCivilAiEventsByWhen: (events: CivilAiEventDataItem[], when: 'today' | 'upcoming') => CivilAiEventDataItem[]
  normalizeSearchTerm: (value: string) => string
  normalizeMediaUrl: (value: string | null) => string | null
  buildCivilOrganizationHref: (args: { provinceCode: string | null; communitySlug: string | null; slug: string }) => string | null
  buildCivilCommunityHref: (provinceCode: string, communitySlug: string) => string
  buildCivilPostHref: (path: string | null) => string | null
  buildCivilEventHref: (args: { organizationId: string; eventId: string; provinceCode: string | null; communitySlug: string | null; slug: string }) => string
  buildCivilJobHref: (args: { jobId: string; provinceCode: string | null; communitySlug: string | null; slug: string }) => string | null
  truncatePreviewText: (value: string, maxChars: number) => string
  stripHtmlToPlainText: (value: string) => string
  scoreSearchTextMatch: (haystack: string, needle: string) => number
  buildSearchableText: (...values: Array<string | null | undefined>) => string
  formatPost: (post: unknown) => {
    title: string | null
    images?: string[] | null
    mediaUrl?: string | null
    communityName: string | null
    provinceName: string | null
    author: { handle: string; name: string | null; avatarUrl: string | null }
    organization: { name: string; slug: string; logoUrl: string | null; coverUrl?: string | null; isVerified: boolean } | null
  }
  getCanonicalPaths: (post: unknown) => { community: string | null }
}

export function createCivilAiSources(deps: CivilAiSourcesDeps) {
  async function loadCivilAiCommunityEvents(communityId: string, when: 'today' | 'upcoming', limit: number) {
    const parsed = deps.parseCivilAiCommunityId(communityId)
    if (!parsed) return { error: 'community_not_found' as const }

    const items = deps
      .filterCivilAiEventsByWhen(await deps.loadFeedActivityEvents({ communityKeys: [parsed.id], organizationIds: [], limit: Math.max(limit * 2, 12) }), when)
      .slice(0, limit)

    return { community: parsed, items }
  }

  async function loadCivilAiCommunityJobs(communityId: string, limit: number) {
    const parsed = deps.parseCivilAiCommunityId(communityId)
    if (!parsed) return { error: 'community_not_found' as const }

    const items = (await deps.loadFeedActivityJobs({ communityKeys: [parsed.id], organizationIds: [], limit: Math.max(limit * 2, 12) })).slice(0, limit)
    return { community: parsed, items }
  }

  async function loadCivilAiCommunityOrganizations(communityId: string, limit: number, query?: string) {
    const parsed = deps.parseCivilAiCommunityId(communityId)
    if (!parsed) return { error: 'community_not_found' as const }

    const normalizedQuery = deps.normalizeSearchTerm(query ?? '')
    type CivilAiOrganizationRow = {
      id: string
      name: string
      slug: string
      description: string | null
      logoUrl: string | null
      coverUrl: string | null
      isVerified: boolean
      provinceCode: string | null
      communitySlug: string | null
    }

    const businesses: CivilAiOrganizationRow[] = await prisma.business.findMany({
      where: {
        status: BusinessStatus.ACTIVE,
        provinceCode: parsed.provinceCode,
        communitySlug: parsed.communitySlug,
      },
      orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
      take: Math.max(limit * 3, 18),
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
        coverUrl: true,
        isVerified: true,
        provinceCode: true,
        communitySlug: true,
      },
    })

    const ranked: Array<{ item: CivilAiOrganizationDataItem; score: number }> = []
    for (const business of businesses) {
      const item = {
        id: business.id,
        name: business.name,
        slug: business.slug,
        description: deps.truncatePreviewText(deps.stripHtmlToPlainText(business.description ?? ''), 180) || null,
        logoUrl: deps.normalizeMediaUrl(business.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(business.coverUrl ?? null),
        isVerified: Boolean(business.isVerified),
        provinceCode: parsed.provinceCode,
        communitySlug: parsed.communitySlug,
        communityName: parsed.communityName,
        href:
          deps.buildCivilOrganizationHref({
            provinceCode: parsed.provinceCode,
            communitySlug: parsed.communitySlug,
            slug: business.slug,
          }) ?? deps.buildCivilCommunityHref(parsed.provinceCode, parsed.communitySlug),
      } satisfies CivilAiOrganizationDataItem

      const textScore = normalizedQuery
        ? deps.scoreSearchTextMatch(deps.buildSearchableText(business.name, business.slug, business.description), normalizedQuery)
        : 0

      const entry = {
        item,
        score: textScore + (business.isVerified ? 25 : 0),
      }
      if (normalizedQuery && entry.score <= 0) continue
      ranked.push(entry)
    }

    ranked.sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      if (a.item.isVerified !== b.item.isVerified) return a.item.isVerified ? -1 : 1
      return a.item.name.localeCompare(b.item.name)
    })

    return {
      community: parsed,
      items: ranked.slice(0, limit).map((entry) => entry.item),
    }
  }

  async function loadCivilAiCommunityPosts(communityId: string, limit: number, query?: string, viewerFeedContext?: ViewerFeedContextLike | null) {
    const parsed = deps.parseCivilAiCommunityId(communityId)
    if (!parsed) return { error: 'community_not_found' as const }

    const normalizedQuery = deps.normalizeSearchTerm(query ?? '')
    const allowedAuthorIds = viewerFeedContext ? Array.from(new Set([viewerFeedContext.viewerId, ...viewerFeedContext.friendIds])) : []
    type CivilAiPostRow = Prisma.PostGetPayload<{
      include: {
        author: true
        business: true
      }
    }>

    const posts: CivilAiPostRow[] = await prisma.post.findMany({
      where: {
        provinceCode: parsed.provinceCode,
        communitySlug: parsed.communitySlug,
        AND: [
          {
            OR: [
              { visibility: 'public' },
              ...(allowedAuthorIds.length
                ? [
                    {
                      authorId: { in: allowedAuthorIds },
                      businessId: null,
                    } satisfies Prisma.PostWhereInput,
                  ]
                : []),
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.max(limit * 4, 24),
      include: {
        author: true,
        business: true,
      },
    })

    const ranked: Array<{ item: CivilAiPostDataItem; score: number; createdAt: number }> = []
    for (const post of posts) {
      const formatted = deps.formatPost(post as unknown)
      const href = deps.buildCivilPostHref(deps.getCanonicalPaths(post as unknown).community)
      if (!href) continue

      const item = {
        id: post.id,
        title: formatted.title,
        excerpt: deps.truncatePreviewText(deps.stripHtmlToPlainText(post.body ?? ''), 220) || null,
        imageUrl: formatted.images?.[0] ?? formatted.mediaUrl ?? formatted.organization?.coverUrl ?? formatted.organization?.logoUrl ?? null,
        communityName: formatted.communityName,
        provinceName: formatted.provinceName,
        author: {
          handle: formatted.author.handle,
          name: formatted.author.name,
          avatarUrl: formatted.author.avatarUrl,
        },
        organization: formatted.organization
          ? {
              name: formatted.organization.name,
              slug: formatted.organization.slug,
              logoUrl: formatted.organization.logoUrl,
              isVerified: formatted.organization.isVerified,
            }
          : null,
        href,
      } satisfies CivilAiPostDataItem

      const textScore = normalizedQuery
        ? deps.scoreSearchTextMatch(
            deps.buildSearchableText(post.title, deps.stripHtmlToPlainText(post.body ?? ''), post.author.name, post.author.handle, post.business?.name),
            normalizedQuery,
          )
        : 0

      const entry = {
        item,
        score: textScore,
        createdAt: post.createdAt.getTime(),
      }
      if (normalizedQuery && entry.score <= 0) continue
      ranked.push(entry)
    }

    ranked.sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return b.createdAt - a.createdAt
    })

    return {
      community: parsed,
      items: ranked.slice(0, limit).map((entry) => entry.item),
    }
  }

  function toCivilAiCommunityReference(community: CivilAiCommunityLike): CivilAiCardReference {
    return {
      kind: 'community',
      id: community.id,
      title: community.communityName,
      subtitle: `${community.provinceName}`,
      summary: `Community page for ${community.communityName}, ${community.provinceName}.`,
      href: community.href,
      imageUrl: null,
      badge: 'Community',
    }
  }

  function toCivilAiEventReference(event: CivilAiEventDataItem): CivilAiCardReference {
    const summary = deps.truncatePreviewText(deps.stripHtmlToPlainText(event.description ?? ''), 180) || null
    return {
      kind: 'event',
      id: event.id,
      title: event.title,
      subtitle: `${event.organization.name} • ${new Date(event.startsAt).toLocaleString()}`,
      summary,
      href: deps.buildCivilEventHref({
        organizationId: event.organization.id,
        eventId: event.id,
        provinceCode: event.organization.provinceCode,
        communitySlug: event.organization.communitySlug,
        slug: event.organization.slug,
      }),
      imageUrl: event.primaryPhotoUrl,
      badge: 'Event',
    }
  }

  function toCivilAiJobReference(job: CivilAiJobDataItem): CivilAiCardReference | null {
    const href = deps.buildCivilJobHref({
      jobId: job.id,
      provinceCode: job.organization.provinceCode,
      communitySlug: job.organization.communitySlug,
      slug: job.organization.slug,
    })
    if (!href) return null
    const summary = deps.truncatePreviewText(deps.stripHtmlToPlainText(job.description ?? ''), 180) || null
    return {
      kind: 'job',
      id: job.id,
      title: job.title,
      subtitle: `${job.organization.name}${job.salaryMin || job.salaryMax ? ` • ${job.salaryCurrency ?? 'CAD'} ${job.salaryMin?.toLocaleString() ?? job.salaryMax?.toLocaleString() ?? ''}` : ''}`,
      summary,
      href,
      imageUrl: job.photoUrl ?? job.organization.coverUrl ?? job.organization.logoUrl ?? null,
      badge: 'Job',
    }
  }

  function toCivilAiMarketReference(listing: CivilAiMarketDataItem): CivilAiCardReference {
    const summary = deps.truncatePreviewText(deps.stripHtmlToPlainText(listing.description ?? ''), 180) || null
    return {
      kind: 'market',
      id: listing.id,
      title: listing.title,
      subtitle: [listing.priceLabel, listing.locationLabel].filter(Boolean).join(' • ') || 'Marketplace listing',
      summary,
      href: listing.href,
      imageUrl: listing.imageUrl,
      badge: 'Market',
    }
  }

  function toCivilAiOrganizationReference(org: {
    id: string
    name: string
    href: string | null
    logoUrl: string | null
    coverUrl: string | null
    role?: 'owner' | 'member' | 'followed'
    description?: string | null
    communityName?: string | null
  }): CivilAiCardReference | null {
    if (!org.href) return null
    const summary = deps.truncatePreviewText(deps.stripHtmlToPlainText(org.description ?? ''), 180) || null
    return {
      kind: 'organization',
      id: org.id,
      title: org.name,
      subtitle:
        org.role === 'owner'
          ? 'Your organization'
          : org.role === 'member'
            ? 'Organization membership'
            : org.role === 'followed'
              ? 'Followed organization'
              : org.communityName
                ? `${org.communityName} organization`
                : 'Community organization',
      summary,
      href: org.href,
      imageUrl: org.coverUrl ?? org.logoUrl ?? null,
      badge: 'Organization',
    }
  }

  function toCivilAiPostReference(post: CivilAiPostDataItem): CivilAiCardReference {
    return {
      kind: 'post',
      id: post.id,
      title: post.title || `Post by ${post.author.name || `@${post.author.handle}`}`,
      subtitle: [post.communityName, post.provinceName].filter(Boolean).join(', ') || `@${post.author.handle}`,
      summary: post.excerpt,
      href: post.href,
      imageUrl: post.imageUrl ?? post.author.avatarUrl ?? null,
      badge: 'Post',
    }
  }

  return {
    loadCivilAiCommunityEvents,
    loadCivilAiCommunityJobs,
    loadCivilAiCommunityOrganizations,
    loadCivilAiCommunityPosts,
    toCivilAiCommunityReference,
    toCivilAiEventReference,
    toCivilAiJobReference,
    toCivilAiMarketReference,
    toCivilAiOrganizationReference,
    toCivilAiPostReference,
  }
}
