import { prisma } from '@civil/db'
import { BusinessStatus, PremiumStatus, Prisma } from '@prisma/client'
import type { City as CityModel } from '@prisma/client'
import { PROVINCES, findCommunity, getCommunitiesByProvince, getProvinceDisplayName, normalizeHashtagSlug, normalizeProvinceCode, slugifyCommunityName } from '@civil/shared'

import { formatCitySummary, type ProvinceCodeLiteral } from './communityGeo.js'

type UserSearchRecord = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  premiumStatus: PremiumStatus | null
  communityMeta: Prisma.JsonValue | null
}

type UserSearchResultPayload = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  isPremium: boolean
  isVerified: boolean
  homeCommunity: {
    provinceCode: string
    provinceName: string | null
    communitySlug: string
    communityName: string | null
  } | null
}

type OrganizationSearchResultPayload = {
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
}

type EventSearchResultPayload = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  startsAt: string | null
  startsAtLabel: string | null
  organization: {
    name: string
    slug: string
    logoUrl: string | null
    isVerified: boolean
  }
  provinceCode: string
  communitySlug: string
  communityName: string | null
  href: string
}

type MarketSearchResultPayload = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  priceLabel: string
  locationLabel: string | null
  href: string
}

type PostSearchResultPayload = {
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

type VideoSearchResultPayload = {
  id: string
  title: string | null
  excerpt: string | null
  thumbnailUrl: string | null
  durationMs: number | null
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

type LiveSpaceSearchResultPayload = {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  href: string
  host: {
    handle: string
    name: string | null
    avatarUrl: string | null
  }
}

type CreateSearchHelpersDeps = {
  FAMILY_FEED_POST_TYPE: string
  buildCivilAiMarketQueryTokens: (query: string) => string[]
  buildSearchableText: (...parts: Array<string | null | undefined>) => string
  canViewerAccessEventForPreview: (event: any, system: any, viewerId: string | null) => boolean
  ensureCitizenMarketplaceTables: () => Promise<void>
  ensureContentAiScanTables: () => Promise<void>
  formatEventPreviewDate: (value: string | null | undefined) => string | null
  formatMarketplacePrice: (cents: number, currency: string) => string
  formatPost: (post: any, options?: any) => any
  getCanonicalPaths: (post: any) => {
    community?: string | null
    user?: string | null
    legacy?: string | null
  }
  isPremium: (status: PremiumStatus | null | undefined) => boolean
  isSelfVerifiedCanadianCitizen: (meta: any) => boolean
  normalizeMediaUrl: (url?: string | null) => string | null
  normalizeSearchTerm: (value: string) => string
  parseCommunityMeta: (value: any) => any
  readGalleryUrls: (raw: unknown) => string[]
  readOrganizationSystemState: (metadata: unknown) => any
  scoreSearchTextMatch: (text: string, query: string) => number
  stripHtmlToPlainText: (value: string) => string
  truncatePreviewText: (value: string, max?: number) => string
}

export function createSearchHelpers(deps: CreateSearchHelpersDeps) {
  function buildPostSearchPayload(post: any): { post: PostSearchResultPayload; video: VideoSearchResultPayload | null } | null {
    const formatted = deps.formatPost(post)
    const canonical = deps.getCanonicalPaths(post)
    const href = canonical.community ?? canonical.user ?? canonical.legacy ?? null
    if (!href) return null

    const base = {
      id: post.id,
      title: formatted.title,
      excerpt: deps.truncatePreviewText(deps.stripHtmlToPlainText(post.body ?? ''), 200) || null,
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
    }

    const videoThumbnailUrl = formatted.video?.thumbnailUrl ?? formatted.mediaUrl ?? formatted.images?.[0] ?? null
    const postPayload = {
      ...base,
      imageUrl: formatted.images?.[0] ?? formatted.mediaUrl ?? formatted.organization?.coverUrl ?? formatted.organization?.logoUrl ?? null,
    } satisfies PostSearchResultPayload

    const hasVideo = Boolean(formatted.video?.playbackUrl || formatted.video?.assetId || videoThumbnailUrl)
    const videoPayload = hasVideo
      ? ({
          ...base,
          thumbnailUrl: videoThumbnailUrl,
          durationMs: typeof formatted.video?.durationMs === 'number' && Number.isFinite(formatted.video.durationMs)
            ? Math.max(0, Math.round(formatted.video.durationMs))
            : null,
        } satisfies VideoSearchResultPayload)
      : null

    return { post: postPayload, video: videoPayload }
  }

  async function searchUsersForQuery({
    viewerId,
    query,
    limit,
  }: {
    viewerId: string
    query: string
    limit: number
  }): Promise<UserSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const tokens = normalizedQuery.split(' ').filter(Boolean)
    const normalizedHandle = normalizedQuery.replace(/^@/, '')

    const where: Prisma.UserWhereInput = {
      NOT: { id: viewerId },
      OR: [
        tokens.length
          ? {
              AND: tokens.map((token) => ({ name: { contains: token, mode: 'insensitive' } })),
            }
          : { name: { contains: normalizedQuery, mode: 'insensitive' } },
        { handle: { contains: normalizedHandle, mode: 'insensitive' } },
      ],
    }

    const users = (await prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { handle: 'asc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        handle: true,
        avatarUrl: true,
        coverUrl: true,
        premiumStatus: true,
        communityMeta: true,
      },
    })) as UserSearchRecord[]

    const userIds = users.map((user) => user.id)
    const homeFollows = userIds.length
      ? await prisma.communityFollow.findMany({
          where: { userId: { in: userIds }, home: true },
          select: { userId: true, provinceCode: true, communitySlug: true },
        })
      : []

    const homeMap = new Map<string, { provinceCode: string; provinceName: string | null; communitySlug: string; communityName: string | null }>()
    for (const follow of homeFollows) {
      const community = findCommunity(follow.provinceCode, follow.communitySlug)
      const provinceName = getProvinceDisplayName(follow.provinceCode as ProvinceCodeLiteral)
      homeMap.set(follow.userId, {
        provinceCode: follow.provinceCode,
        provinceName,
        communitySlug: follow.communitySlug,
        communityName: community?.name ?? follow.communitySlug,
      })
    }

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      handle: user.handle,
      avatarUrl: deps.normalizeMediaUrl(user.avatarUrl ?? null),
      coverUrl: deps.normalizeMediaUrl(user.coverUrl ?? null),
      isPremium: deps.isPremium(user.premiumStatus),
      isVerified: deps.isSelfVerifiedCanadianCitizen(deps.parseCommunityMeta(user.communityMeta ?? null)),
      homeCommunity: homeMap.get(user.id) ?? null,
    }))
  }

  async function searchCommunitiesForQuery(query: string, limit: number) {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const slugQuery = slugifyCommunityName(normalizedQuery)
    const tokens = normalizedQuery.split(' ').filter(Boolean)
    const tokenLowers = tokens.map((token) => token.toLowerCase())
    const normalizedLower = normalizedQuery.toLowerCase()
    const insensitiveMode = Prisma.QueryMode.insensitive

    const buildFieldCondition = (field: 'name' | 'communityName'): Prisma.CityWhereInput => {
      if (!tokens.length) {
        return { [field]: { contains: normalizedQuery, mode: insensitiveMode } }
      }
      return {
        AND: tokens.map(
          (token) =>
            ({
              [field]: { contains: token, mode: insensitiveMode },
            }) as Prisma.CityWhereInput,
        ),
      }
    }

    const cities = await prisma.city.findMany({
      where: {
        OR: [
          buildFieldCondition('name'),
          buildFieldCondition('communityName'),
          { slug: { contains: slugQuery, mode: insensitiveMode } },
          { communitySlug: { contains: slugQuery, mode: insensitiveMode } },
        ],
      },
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: limit,
    })

    const dbSummaries = cities.map((city: CityModel) => formatCitySummary(city))
    const seenKeys = new Set(dbSummaries.map((entry: any) => `${entry.provinceCode}:${entry.communitySlug}`))
    const staticMatches: any[] = []

    for (const province of PROVINCES) {
      const communities = getCommunitiesByProvince(province.code)
      for (const community of communities) {
        const communityNameLower = community.name.toLowerCase()
        const communitySlugLower = community.slug.toLowerCase()
        const matches =
          communityNameLower.includes(normalizedLower) ||
          communitySlugLower.includes(slugQuery) ||
          tokens.every((token) => communityNameLower.includes(token.toLowerCase()))

        if (!matches) continue

        const key = `${community.province}:${community.slug}`
        if (seenKeys.has(key)) continue

        seenKeys.add(key)
        staticMatches.push({
          name: community.name,
          slug: community.slug,
          provinceCode: community.province,
          provinceName: getProvinceDisplayName(community.province),
          communitySlug: community.slug,
          communityName: community.name,
          latitude: 0,
          longitude: 0,
          population: null,
        })
      }
    }

    const rankCommunityMatch = (entry: any) => {
      const label = (entry.communityName || entry.name || '').toLowerCase()
      const slug = (entry.communitySlug || entry.slug || '').toLowerCase()
      let score = 0
      if (label === normalizedLower || slug === slugQuery) score += 1000
      if (label.startsWith(normalizedLower) || slug.startsWith(slugQuery)) score += 600
      if (label.includes(normalizedLower) || slug.includes(slugQuery)) score += 300
      if (tokenLowers.length) {
        const tokenHits = tokenLowers.filter((token) => label.includes(token) || slug.includes(token)).length
        score += tokenHits * 80
        if (tokenHits === tokenLowers.length) score += 120
      }
      if (typeof entry.population === 'number' && entry.population > 0) score += Math.min(entry.population / 1000, 50)
      return score
    }

    const combined = [...dbSummaries, ...staticMatches]
    combined.sort((a: any, b: any) => {
      const scoreDelta = rankCommunityMatch(b) - rankCommunityMatch(a)
      if (scoreDelta !== 0) return scoreDelta
      const popA = typeof a.population === 'number' ? a.population : -1
      const popB = typeof b.population === 'number' ? b.population : -1
      if (popB !== popA) return popB - popA
      return (a.communityName || a.name).localeCompare(b.communityName || b.name)
    })

    return combined.slice(0, limit)
  }

  async function searchOrganizationsForQuery(query: string, limit: number): Promise<OrganizationSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const tokens = normalizedQuery.split(' ').filter(Boolean)
    const slugQuery = normalizedQuery.toLowerCase().replace(/\s+/g, '-')
    const insensitiveMode = Prisma.QueryMode.insensitive

    const buildContains = (field: 'name' | 'description'): Prisma.BusinessWhereInput => {
      if (!tokens.length) return { [field]: { contains: normalizedQuery, mode: insensitiveMode } }
      return {
        AND: tokens.map(
          (token) =>
            ({
              [field]: { contains: token, mode: insensitiveMode },
            }) as Prisma.BusinessWhereInput,
        ),
      }
    }

    const businesses = await prisma.business.findMany({
      where: {
        status: BusinessStatus.ACTIVE,
        OR: [buildContains('name'), buildContains('description'), { slug: { contains: slugQuery, mode: insensitiveMode } }],
      },
      orderBy: [{ name: 'asc' }],
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

    const ranked: Array<{ item: OrganizationSearchResultPayload; score: number }> = businesses
      .map((business: any) => {
        if (!business.provinceCode || !business.communitySlug) return null
        const provinceCode = business.provinceCode.toLowerCase()
        const communitySlug = business.communitySlug.toLowerCase()
        const community = findCommunity(business.provinceCode, business.communitySlug)
        return {
          item: {
            id: business.id,
            name: business.name,
            slug: business.slug,
            description: deps.truncatePreviewText(deps.stripHtmlToPlainText(business.description ?? ''), 180) || null,
            logoUrl: deps.normalizeMediaUrl(business.logoUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(business.coverUrl ?? null),
            isVerified: Boolean(business.isVerified),
            provinceCode,
            communitySlug,
            communityName: community?.name ?? null,
            href: `/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(business.slug)}`,
          } satisfies OrganizationSearchResultPayload,
          score: deps.scoreSearchTextMatch(deps.buildSearchableText(business.name, business.slug, business.description), normalizedQuery),
        }
      })
      .filter((entry: { item: OrganizationSearchResultPayload; score: number } | null): entry is { item: OrganizationSearchResultPayload; score: number } => Boolean(entry))

    ranked.sort((a: { item: OrganizationSearchResultPayload; score: number }, b: { item: OrganizationSearchResultPayload; score: number }) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return a.item.name.localeCompare(b.item.name)
    })

    return ranked.slice(0, limit).map((entry: { item: OrganizationSearchResultPayload; score: number }) => entry.item)
  }

  async function searchEventsForQuery({ viewerId, query, limit }: { viewerId: string; query: string; limit: number }): Promise<EventSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const likePattern = `%${normalizedQuery.toLowerCase()}%`
    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        name,
        slug,
        description,
        "provinceCode" AS "provinceCode",
        "communitySlug" AS "communitySlug",
        "logoUrl" AS "logoUrl",
        "coverUrl" AS "coverUrl",
        "isVerified" AS "isVerified",
        metadata
      FROM "Business"
      WHERE status = ${BusinessStatus.ACTIVE}::"BusinessStatus"
        AND "provinceCode" IS NOT NULL
        AND "communitySlug" IS NOT NULL
        AND (
          LOWER(name) LIKE ${likePattern}
          OR LOWER(COALESCE(description, '')) LIKE ${likePattern}
          OR LOWER(COALESCE(metadata::text, '')) LIKE ${likePattern}
        )
      ORDER BY name ASC
      LIMIT ${Math.max(limit * 8, 40)}
    `)) as Array<any>

    const results: Array<{ item: EventSearchResultPayload; score: number; startsAtMs: number }> = []
    for (const row of rows) {
      if (!row.provinceCode || !row.communitySlug) continue
      const community = findCommunity(row.provinceCode, row.communitySlug)
      const system = deps.readOrganizationSystemState(row.metadata)

      for (const event of system.events) {
        if (!deps.canViewerAccessEventForPreview(event, system, viewerId)) continue
        const searchText = deps.buildSearchableText(event.title, deps.stripHtmlToPlainText(event.description ?? ''), row.name, row.description)
        const score = deps.scoreSearchTextMatch(searchText, normalizedQuery)
        if (score <= 0) continue

        const startsAt = typeof event.startsAt === 'string' && event.startsAt.trim().length > 0 ? event.startsAt : null
        const parsedStartsAt = startsAt ? Date.parse(startsAt) : Number.NaN
        const startsAtMs = Number.isFinite(parsedStartsAt) ? parsedStartsAt : Number.MAX_SAFE_INTEGER
        const provinceCode = row.provinceCode.toLowerCase()
        const communitySlug = row.communitySlug.toLowerCase()

        results.push({
          item: {
            id: event.id,
            title: deps.truncatePreviewText(event.title || 'Civil event', 120) || 'Civil event',
            description: deps.truncatePreviewText(deps.stripHtmlToPlainText(event.description ?? ''), 180) || null,
            imageUrl: deps.normalizeMediaUrl(event.primaryPhotoUrl ?? event.galleryPhotoUrls?.[0] ?? row.coverUrl ?? row.logoUrl ?? null),
            startsAt,
            startsAtLabel: deps.formatEventPreviewDate(startsAt),
            organization: {
              name: row.name,
              slug: row.slug,
              logoUrl: deps.normalizeMediaUrl(row.logoUrl ?? null),
              isVerified: Boolean(row.isVerified),
            },
            provinceCode,
            communitySlug,
            communityName: community?.name ?? null,
            href: `/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(row.slug)}/events/${encodeURIComponent(event.id)}`,
          },
          score,
          startsAtMs,
        })
      }
    }

    results.sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      const startDelta = a.startsAtMs - b.startsAtMs
      if (Number.isFinite(startDelta) && startDelta !== 0) return startDelta
      return a.item.title.localeCompare(b.item.title)
    })

    return results.slice(0, limit).map((entry) => entry.item)
  }

  async function searchMarketListingsForQuery(
    query: string,
    limit: number,
    options?: { communities?: Array<{ provinceCode: string; communitySlug: string }>; provinceCodes?: string[] },
  ): Promise<MarketSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    await deps.ensureCitizenMarketplaceTables()
    await deps.ensureContentAiScanTables()

    const likePattern = `%${normalizedQuery.toLowerCase()}%`
    const compactLikePattern = `%${normalizedQuery.toLowerCase().replace(/\s+/g, '')}%`
    const tokenPatterns = deps.buildCivilAiMarketQueryTokens(normalizedQuery).map((token) => ({
      like: `%${token}%`,
      compactLike: `%${token.replace(/\s+/g, '')}%`,
    }))

    const searchClauses = [
      Prisma.sql`LOWER(l.title) LIKE ${likePattern}`,
      Prisma.sql`LOWER(COALESCE(l.description, '')) LIKE ${likePattern}`,
      Prisma.sql`LOWER(COALESCE(ai.search_text, '')) LIKE ${likePattern}`,
      Prisma.sql`REPLACE(LOWER(l.title), ' ', '') LIKE ${compactLikePattern}`,
      Prisma.sql`REPLACE(LOWER(COALESCE(l.description, '')), ' ', '') LIKE ${compactLikePattern}`,
      Prisma.sql`REPLACE(LOWER(COALESCE(ai.search_text, '')), ' ', '') LIKE ${compactLikePattern}`,
      ...tokenPatterns.flatMap((pattern) => [
        Prisma.sql`LOWER(l.title) LIKE ${pattern.like}`,
        Prisma.sql`LOWER(COALESCE(l.description, '')) LIKE ${pattern.like}`,
        Prisma.sql`LOWER(COALESCE(ai.search_text, '')) LIKE ${pattern.like}`,
        Prisma.sql`REPLACE(LOWER(l.title), ' ', '') LIKE ${pattern.compactLike}`,
        Prisma.sql`REPLACE(LOWER(COALESCE(l.description, '')), ' ', '') LIKE ${pattern.compactLike}`,
        Prisma.sql`REPLACE(LOWER(COALESCE(ai.search_text, '')), ' ', '') LIKE ${pattern.compactLike}`,
      ]),
    ]

    const communityClauses = (options?.communities ?? [])
      .map((community) => {
        const provinceCode = (normalizeProvinceCode(community.provinceCode) ?? community.provinceCode).toLowerCase()
        const communitySlug = community.communitySlug.trim().toLowerCase()
        if (!provinceCode || !communitySlug) return null
        return Prisma.sql`(
          LOWER(COALESCE(l.listing_province_code, l.pickup_province, '')) = ${provinceCode}
          AND LOWER(COALESCE(l.listing_community_slug, '')) = ${communitySlug}
        )`
      })
      .filter((clause): clause is Prisma.Sql => Boolean(clause))

    const provinceCodes = Array.from(
      new Set(
        (options?.provinceCodes ?? [])
          .map((provinceCode) => (normalizeProvinceCode(provinceCode) ?? provinceCode).toLowerCase())
          .filter(Boolean),
      ),
    )

    const scopeClause = communityClauses.length
      ? Prisma.sql`AND (${Prisma.join(communityClauses, ' OR ')})`
      : provinceCodes.length
        ? Prisma.sql`AND LOWER(COALESCE(l.listing_province_code, l.pickup_province, '')) IN (${Prisma.join(provinceCodes)})`
        : Prisma.empty

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        l.id,
        l.title,
        l.description,
        l.price_cents,
        l.currency,
        l.photo_urls,
        l.pickup_city,
        l.pickup_province,
        l.created_at,
        ai.search_text AS ai_search_text
      FROM citizen_market_listing l
      LEFT JOIN content_ai_scan ai
        ON ai.target_type = ${'market_listing'}
        AND ai.target_id = l.id
        AND ai.status = ${'completed'}
      WHERE l.is_active = TRUE
        AND l.is_draft = FALSE
        AND LOWER(l.status) = 'active'
        ${scopeClause}
        AND (${Prisma.join(searchClauses, ' OR ')})
      ORDER BY l.created_at DESC
      LIMIT ${Math.max(limit * 8, 48)}
    `)) as Array<any>

    const ranked: Array<{ item: MarketSearchResultPayload; score: number; createdAt: number }> = rows
      .map((row: any) => ({
        item: {
          id: row.id,
          title: deps.truncatePreviewText(row.title || 'Marketplace item', 120) || 'Marketplace item',
          description: deps.truncatePreviewText(deps.stripHtmlToPlainText(row.description ?? ''), 180) || null,
          imageUrl: deps.readGalleryUrls(row.photo_urls)[0] ?? null,
          priceLabel: deps.formatMarketplacePrice(Number(row.price_cents) || 0, row.currency || 'CAD'),
          locationLabel: [row.pickup_city, row.pickup_province].filter(Boolean).join(', ') || null,
          href: `/market/listings/${encodeURIComponent(row.id)}`,
        } satisfies MarketSearchResultPayload,
        score: deps.scoreSearchTextMatch(deps.buildSearchableText(row.title, row.description, row.ai_search_text), normalizedQuery),
        createdAt: row.created_at.getTime(),
      }))
      .filter((entry: { item: MarketSearchResultPayload; score: number; createdAt: number }) => entry.score > 0)

    ranked.sort((a: { item: MarketSearchResultPayload; score: number; createdAt: number }, b: { item: MarketSearchResultPayload; score: number; createdAt: number }) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return b.createdAt - a.createdAt
    })

    return ranked.slice(0, limit).map((entry: { item: MarketSearchResultPayload; score: number; createdAt: number }) => entry.item)
  }

  async function searchCommunityPostsForQuery(query: string, limit: number): Promise<PostSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const tokens = normalizedQuery.split(' ').filter(Boolean)
    const insensitiveMode = Prisma.QueryMode.insensitive
    const buildContains = (field: 'title' | 'body'): Prisma.PostWhereInput => {
      if (!tokens.length) return { [field]: { contains: normalizedQuery, mode: insensitiveMode } }
      return {
        AND: tokens.map(
          (token) =>
            ({
              [field]: { contains: token, mode: insensitiveMode },
            }) as Prisma.PostWhereInput,
        ),
      }
    }

    const posts = await prisma.post.findMany({
      where: {
        type: { not: deps.FAMILY_FEED_POST_TYPE as any },
        visibility: 'public',
        OR: [
          buildContains('title'),
          buildContains('body'),
          {
            author: {
              OR: [
                { name: { contains: normalizedQuery, mode: insensitiveMode } },
                { handle: { contains: normalizedQuery.replace(/^@/, ''), mode: insensitiveMode } },
              ],
            },
          },
          {
            business: {
              name: { contains: normalizedQuery, mode: insensitiveMode },
            },
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.max(limit * 4, 24),
      include: { author: true, business: true },
    })

    const ranked: Array<{ item: PostSearchResultPayload; score: number; createdAt: number }> = posts
      .map((post: any) => {
        const payload = buildPostSearchPayload(post)
        if (!payload) return null
        return {
          item: payload.post,
          score: deps.scoreSearchTextMatch(
            deps.buildSearchableText(post.title, deps.stripHtmlToPlainText(post.body ?? ''), post.author.name, post.author.handle, post.business?.name),
            normalizedQuery,
          ),
          createdAt: post.createdAt.getTime(),
        }
      })
      .filter((entry: { item: PostSearchResultPayload; score: number; createdAt: number } | null): entry is { item: PostSearchResultPayload; score: number; createdAt: number } => Boolean(entry))

    ranked.sort((a: { item: PostSearchResultPayload; score: number; createdAt: number }, b: { item: PostSearchResultPayload; score: number; createdAt: number }) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return b.createdAt - a.createdAt
    })

    return ranked.slice(0, limit).map((entry: { item: PostSearchResultPayload; score: number; createdAt: number }) => entry.item)
  }

  async function searchVideosForQuery(query: string, limit: number): Promise<VideoSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const tokens = normalizedQuery.split(' ').filter(Boolean)
    const insensitiveMode = Prisma.QueryMode.insensitive
    const buildContains = (field: 'title' | 'body'): Prisma.PostWhereInput => {
      if (!tokens.length) return { [field]: { contains: normalizedQuery, mode: insensitiveMode } }
      return {
        AND: tokens.map(
          (token) =>
            ({
              [field]: { contains: token, mode: insensitiveMode },
            }) as Prisma.PostWhereInput,
        ),
      }
    }

    const posts = await prisma.post.findMany({
      where: {
        type: { not: deps.FAMILY_FEED_POST_TYPE as any },
        visibility: 'public',
        AND: [
          {
            OR: [
              { video: { not: Prisma.JsonNull } },
              { video: { not: Prisma.DbNull } },
              { video: { not: null } },
            ],
          },
        ],
        OR: [
          buildContains('title'),
          buildContains('body'),
          {
            author: {
              OR: [
                { name: { contains: normalizedQuery, mode: insensitiveMode } },
                { handle: { contains: normalizedQuery.replace(/^@/, ''), mode: insensitiveMode } },
              ],
            },
          },
          {
            business: {
              name: { contains: normalizedQuery, mode: insensitiveMode },
            },
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.max(limit * 4, 24),
      include: { author: true, business: true },
    })

    const ranked: Array<{ item: VideoSearchResultPayload; score: number; createdAt: number }> = posts
      .map((post: any) => {
        const payload = buildPostSearchPayload(post)
        if (!payload?.video) return null
        return {
          item: payload.video,
          score: deps.scoreSearchTextMatch(
            deps.buildSearchableText(post.title, deps.stripHtmlToPlainText(post.body ?? ''), post.author.name, post.author.handle, post.business?.name),
            normalizedQuery,
          ),
          createdAt: post.createdAt.getTime(),
        }
      })
      .filter((entry: { item: VideoSearchResultPayload; score: number; createdAt: number } | null): entry is { item: VideoSearchResultPayload; score: number; createdAt: number } => Boolean(entry))

    ranked.sort((a: { item: VideoSearchResultPayload; score: number; createdAt: number }, b: { item: VideoSearchResultPayload; score: number; createdAt: number }) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return b.createdAt - a.createdAt
    })

    return ranked.slice(0, limit).map((entry: { item: VideoSearchResultPayload; score: number; createdAt: number }) => entry.item)
  }

  async function searchLiveSpacesForQuery(query: string, limit: number): Promise<LiveSpaceSearchResultPayload[]> {
    const normalizedQuery = deps.normalizeSearchTerm(query)
    if (!normalizedQuery) return []

    const likePattern = `%${normalizedQuery.toLowerCase()}%`
    const hashtagSlug = normalizeHashtagSlug(query)
    const hashtagPattern = hashtagSlug ? `%#${hashtagSlug}%` : null

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        space.id,
        space.title,
        space.description,
        space.cover_url,
        host.handle AS host_handle,
        host.name AS host_name,
        host."avatarUrl" AS host_avatar_url
      FROM user_live_space space
      INNER JOIN "User" host ON host.id = space.host_user_id
      WHERE space.status = 'ACTIVE'
        AND space.visibility = 'PUBLIC'
        AND (
          LOWER(space.title) LIKE ${likePattern}
          OR LOWER(COALESCE(space.description, '')) LIKE ${likePattern}
          OR LOWER(host.handle) LIKE ${likePattern}
          OR LOWER(COALESCE(host.name, '')) LIKE ${likePattern}
          ${hashtagPattern ? Prisma.sql`OR LOWER(COALESCE(space.description, '')) LIKE ${hashtagPattern}` : Prisma.empty}
        )
      ORDER BY space.updated_at DESC
      LIMIT ${Math.max(limit * 4, 24)}
    `)) as Array<{
      id: string
      title: string
      description: string | null
      cover_url: string | null
      host_handle: string
      host_name: string | null
      host_avatar_url: string | null
    }>

    const ranked = rows
      .map((row) => ({
        item: {
          id: row.id,
          title: deps.truncatePreviewText(row.title || 'Live space', 120) || 'Live space',
          description: deps.truncatePreviewText(deps.stripHtmlToPlainText(row.description ?? ''), 180) || null,
          coverUrl: deps.normalizeMediaUrl(row.cover_url ?? null),
          href: `/u/${encodeURIComponent(row.host_handle)}/live/${encodeURIComponent(row.id)}`,
          host: {
            handle: row.host_handle,
            name: row.host_name,
            avatarUrl: deps.normalizeMediaUrl(row.host_avatar_url ?? null),
          },
        } satisfies LiveSpaceSearchResultPayload,
        score: deps.scoreSearchTextMatch(
          deps.buildSearchableText(row.title, row.description, row.host_handle, row.host_name, hashtagSlug ? `#${hashtagSlug}` : null),
          normalizedQuery,
        ),
      }))
      .filter((entry) => entry.score > 0)

    ranked.sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return a.item.title.localeCompare(b.item.title)
    })

    return ranked.slice(0, limit).map((entry) => entry.item)
  }

  return {
    searchCommunitiesForQuery,
    searchCommunityPostsForQuery,
    searchEventsForQuery,
    searchLiveSpacesForQuery,
    searchMarketListingsForQuery,
    searchOrganizationsForQuery,
    searchVideosForQuery,
    searchUsersForQuery,
  }
}