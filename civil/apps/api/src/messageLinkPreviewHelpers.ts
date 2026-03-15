import { prisma } from '@civil/db'
import { BusinessStatus, ModerationStatus } from '@prisma/client'

const MESSAGE_LINK_PREVIEW_HOSTS = new Set([
  'dev.civilcitizens.ca',
  'civilcitizens.ca',
  'www.civilcitizens.ca',
  'civilvitizens.ca',
  'www.civilvitizens.ca',
])

type CreateMessageLinkPreviewHelpersDeps = {
  canViewerAccessEventForPreview?: (event: any, system: any, viewerId: string | null) => boolean
  civilPublicHost: string
  ensureCitizenMarketplaceTables: () => Promise<void>
  findCommunity: (province: string, communitySlug: string) => any
  formatMarketplacePrice?: (cents: number, currency: string) => string
  formatPost: (post: any, options?: any) => any
  getCanonicalPaths: (post: any) => { community?: string; user?: string }
  getProvinceDisplayName: (province: string) => string
  isPostHiddenFromViewer: (post: any, blockState: any) => boolean
  loadViewerBlockState: (userId: string | null | undefined) => Promise<any>
  normalizeMediaUrl: (url?: string | null) => string | null
  normalizeProvinceCode: (value: string) => string | null
  postInclude: any
  readGalleryUrls: (value: unknown) => string[]
  readOrganizationHeadline: (value: unknown) => string | null
  readOrganizationSystemState: (value: unknown) => any
  stripHtmlToPlainText: (value: string) => string
}

export function createMessageLinkPreviewHelpers(deps: CreateMessageLinkPreviewHelpersDeps) {
  function decodePathSegment(value: string): string {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  function isCivilMessageLinkHost(hostname: string): boolean {
    const host = hostname.trim().toLowerCase()
    if (!host) return false
    if (MESSAGE_LINK_PREVIEW_HOSTS.has(host)) return true
    if (host === deps.civilPublicHost.toLowerCase()) return true
    return host.endsWith('.civilcitizens.ca') || host.endsWith('.civilvitizens.ca')
  }

  function normalizeMessageLinkPath(rawUrl: string): string | null {
    const trimmed = rawUrl.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('/')) {
      const relative = trimmed.replace(/#.*/, '')
      return relative.length ? relative : null
    }

    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!isCivilMessageLinkHost(parsed.hostname)) return null

    const path = `${parsed.pathname || '/'}${parsed.search || ''}`
    return path.replace(/#.*/, '')
  }

  async function canViewerAccessPostForPreview(post: any, viewerId: string | null): Promise<boolean> {
    const blockState = await deps.loadViewerBlockState(viewerId)
    if (
      post.moderationStatus &&
      post.authorId &&
      deps.isPostHiddenFromViewer(
        {
          moderationStatus: post.moderationStatus,
          authorId: post.authorId,
          businessId: post.businessId,
        },
        blockState,
      )
    ) {
      return false
    }
    if (post.visibility !== 'members' || !post.businessId) return true
    if (!viewerId) return false
    const business = await prisma.business.findUnique({
      where: { id: post.businessId },
      select: { ownerId: true, moderationStatus: true },
    })
    if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) return false
    if (business?.ownerId === viewerId) return true
    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: post.businessId, userId: viewerId } },
      select: { role: true },
    })
    return Boolean(membership)
  }

  async function resolvePostLinkPreview(slugOrId: string, viewerId: string | null) {
    const lookup = slugOrId.trim()
    if (!lookup) return null

    const post = await prisma.post.findFirst({
      where: {
        OR: [{ seoSlug: lookup }, { id: lookup }],
      },
      include: deps.postInclude,
    })
    if (!post) return null

    const canView = await canViewerAccessPostForPreview(post, viewerId)
    if (!canView) return null

    const formatted = deps.formatPost(post, { viewerVote: null, recentComments: [] })
    const plainBody = deps.stripHtmlToPlainText(formatted.body || '')
    const title = formatted.title?.trim() || truncatePreviewText(plainBody, 110) || 'Civil post'
    const descriptionSource = truncatePreviewText(plainBody, 200)
    const description = descriptionSource && descriptionSource !== title ? descriptionSource : null
    const imageUrl =
      formatted.images?.[0] ?? formatted.mediaUrl ?? formatted.organization?.logoUrl ?? formatted.author.avatarUrl ?? null
    const canonical = deps.getCanonicalPaths(post)
    const url = canonical.community ?? canonical.user

    const metaParts: string[] = []
    if (formatted.organization?.name) metaParts.push(formatted.organization.name)
    if (formatted.communityName) metaParts.push(formatted.communityName)
    if (!formatted.organization?.name) metaParts.push(`@${formatted.author.handle}`)

    return {
      kind: 'post' as const,
      title,
      description,
      url,
      imageUrl,
      meta: metaParts.filter(Boolean).join(' • ') || null,
    }
  }

  async function resolveOrganizationLinkPreview(
    provinceParam: string,
    communityParam: string,
    slugParam: string,
    viewerId: string | null,
  ) {
    const province = deps.normalizeProvinceCode(provinceParam)
    if (!province) return null
    const communitySlug = communityParam.trim().toLowerCase()
    const community = deps.findCommunity(province, communitySlug)
    if (!community) return null

    const slug = slugParam.trim().toLowerCase()
    if (!slug) return null

    const org = await prisma.business.findFirst({
      where: {
        provinceCode: community.province,
        communitySlug: community.slug,
        slug,
      },
      select: {
        id: true,
        ownerId: true,
        name: true,
        slug: true,
        description: true,
        metadata: true,
        status: true,
        logoUrl: true,
        coverUrl: true,
      },
    })
    if (!org) return null

    if (org.status !== 'ACTIVE') {
      if (!viewerId) return null
      const isOwner = org.ownerId === viewerId
      if (!isOwner) {
        const membership = await prisma.businessMembership.findUnique({
          where: {
            businessId_userId: {
              businessId: org.id,
              userId: viewerId,
            },
          },
          select: { role: true },
        })
        if (!membership) return null
      }
    }

    const headline = deps.readOrganizationHeadline(org.metadata)
    const description = headline || truncatePreviewText(deps.stripHtmlToPlainText(org.description ?? ''), 200) || null
    return {
      kind: 'organization' as const,
      title: org.name,
      description,
      url: `/com/${community.province.toLowerCase()}/${community.slug.toLowerCase()}/orgs/${org.slug}`,
      imageUrl: deps.normalizeMediaUrl(org.coverUrl ?? org.logoUrl ?? null),
      meta: `${community.name} • Organization`,
    }
  }

  function buildOrganizationEventLinkPreviewRecord(input: {
    event: any
    organization: any
    communityName: string
  }) {
    const plainDescription = deps.stripHtmlToPlainText(input.event.description ?? '')
    const description = truncatePreviewText(plainDescription, 200) || null
    const startsAtLabel = formatEventPreviewDate(input.event.startsAt)
    const imageCandidate =
      input.event.primaryPhotoUrl ??
      input.event.galleryPhotoUrls?.[0] ??
      input.organization.coverUrl ??
      input.organization.logoUrl ??
      null

    return {
      kind: 'event' as const,
      title: truncatePreviewText(input.event.title || 'Civil event', 120) || 'Civil event',
      description,
      url: `/com/${encodeURIComponent(input.organization.provinceCode.toLowerCase())}/${encodeURIComponent(input.organization.communitySlug.toLowerCase())}/orgs/${encodeURIComponent(input.organization.slug)}/events/${encodeURIComponent(input.event.id)}`,
      imageUrl: deps.normalizeMediaUrl(imageCandidate),
      meta: [input.organization.name, input.communityName, startsAtLabel].filter(Boolean).join(' • ') || null,
    }
  }

  async function resolveOrganizationEventLinkPreview(
    provinceParam: string,
    communityParam: string,
    slugParam: string,
    eventIdParam: string,
    viewerId: string | null,
  ) {
    const province = deps.normalizeProvinceCode(provinceParam)
    if (!province) return null
    const communitySlug = communityParam.trim().toLowerCase()
    const community = deps.findCommunity(province, communitySlug)
    if (!community) return null

    const slug = slugParam.trim().toLowerCase()
    const eventId = eventIdParam.trim()
    if (!slug || !eventId) return null

    const org = await prisma.business.findFirst({
      where: {
        provinceCode: community.province,
        communitySlug: community.slug,
        slug,
        status: BusinessStatus.ACTIVE,
      },
      select: {
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        logoUrl: true,
        coverUrl: true,
        metadata: true,
      },
    })
    if (!org || !org.provinceCode || !org.communitySlug) return null

    const system = deps.readOrganizationSystemState(org.metadata)
    const event = system.events.find((item: any) => item.id === eventId)
    if (!event) return null
    if (!canViewerAccessEventForPreview(event, system, viewerId)) return null

    return buildOrganizationEventLinkPreviewRecord({
      event,
      organization: {
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
      },
      communityName: community.name,
    })
  }

  async function resolveOrganizationIdEventLinkPreview(
    organizationIdParam: string,
    eventIdParam: string,
    viewerId: string | null,
  ) {
    const organizationId = organizationIdParam.trim()
    const eventId = eventIdParam.trim()
    if (!organizationId || !eventId) return null

    const org = await prisma.business.findFirst({
      where: {
        id: organizationId,
        status: BusinessStatus.ACTIVE,
      },
      select: {
        name: true,
        slug: true,
        provinceCode: true,
        communitySlug: true,
        logoUrl: true,
        coverUrl: true,
        metadata: true,
      },
    })
    if (!org || !org.provinceCode || !org.communitySlug) return null

    const province = deps.normalizeProvinceCode(org.provinceCode)
    if (!province) return null
    const community = deps.findCommunity(province, org.communitySlug.trim().toLowerCase())
    if (!community) return null

    const system = deps.readOrganizationSystemState(org.metadata)
    const event = system.events.find((item: any) => item.id === eventId)
    if (!event) return null
    if (!canViewerAccessEventForPreview(event, system, viewerId)) return null

    return buildOrganizationEventLinkPreviewRecord({
      event,
      organization: {
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
      },
      communityName: community.name,
    })
  }

  async function resolveMarketplaceListingLinkPreview(listingId: string) {
    const normalizedId = listingId.trim()
    if (!normalizedId) return null
    await deps.ensureCitizenMarketplaceTables()

    const rows = await prisma.$queryRaw<
      Array<{
        id: string
        title: string
        description: string | null
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        status: string
        is_draft: boolean
        is_active: boolean
      }>
    >`
      SELECT
        id,
        title,
        description,
        price_cents,
        currency,
        photo_urls,
        pickup_city,
        pickup_province,
        status,
        is_draft,
        is_active
      FROM citizen_market_listing
      WHERE id = ${normalizedId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    if (!row.is_active || row.is_draft || String(row.status || '').toLowerCase() !== 'active') return null

    const priceLabel = formatMarketplacePrice(Number(row.price_cents) || 0, row.currency || 'CAD')
    const location = row.pickup_city ? `${row.pickup_city}${row.pickup_province ? `, ${row.pickup_province}` : ''}` : null
    const descriptionParts = [truncatePreviewText(row.description ?? '', 140), location].filter(
      (value): value is string => Boolean(value && value.trim()),
    )
    return {
      kind: 'market_listing' as const,
      title: row.title || 'Marketplace item',
      description: descriptionParts.join(' • ') || null,
      url: `/market/listings/${row.id}`,
      imageUrl: deps.normalizeMediaUrl(deps.readGalleryUrls(row.photo_urls)[0] ?? null),
      meta: [priceLabel, location].filter(Boolean).join(' • ') || priceLabel,
    }
  }

  async function resolveProfileLinkPreview(handleParam: string) {
    const handle = handleParam.replace(/^@+/, '').trim().toLowerCase()
    if (!handle) return null

    const user = await prisma.user.findUnique({
      where: { handle },
      select: {
        handle: true,
        name: true,
        bio: true,
        avatarUrl: true,
        coverUrl: true,
      },
    })
    if (!user) return null

    const title = (user.name || '').trim() || `@${user.handle}`
    return {
      kind: 'profile' as const,
      title,
      description: truncatePreviewText(user.bio ?? '', 200) || null,
      url: `/u/${user.handle}`,
      imageUrl: deps.normalizeMediaUrl(user.coverUrl ?? user.avatarUrl ?? null),
      meta: `@${user.handle}`,
    }
  }

  function resolveCommunityLinkPreview(provinceParam: string, communityParam: string) {
    const province = deps.normalizeProvinceCode(provinceParam)
    if (!province) return null
    const communitySlug = communityParam.trim().toLowerCase()
    const community = deps.findCommunity(province, communitySlug)
    if (!community) return null

    const provinceName = deps.getProvinceDisplayName(community.province as any)
    return {
      kind: 'community' as const,
      title: community.name,
      description: `${provinceName} community on Civil`,
      url: `/${community.province.toLowerCase()}/${community.slug.toLowerCase()}`,
      imageUrl: null,
      meta: provinceName,
    }
  }

  async function resolveMessageLinkPreview(pathWithQuery: string, viewerId: string | null) {
    const [pathname] = pathWithQuery.split('?')
    const path = pathname || '/'
    const segments = path
      .split('/')
      .filter(Boolean)
      .map((segment) => decodePathSegment(segment))
    if (!segments.length) return null

    if (segments[0]?.toLowerCase() === 'u') {
      if (segments[1] && segments[2]?.toLowerCase() === 'posts' && segments[3]) {
        return resolvePostLinkPreview(segments[3], viewerId)
      }
      if (segments[1]) {
        return resolveProfileLinkPreview(segments[1])
      }
    }

    if (segments[0]?.toLowerCase() === 'post' && segments[1]) {
      return resolvePostLinkPreview(segments[1], viewerId)
    }

    if (segments[0]?.toLowerCase() === 'events' && segments[1] && segments[2]) {
      return resolveOrganizationIdEventLinkPreview(segments[1], segments[2], viewerId)
    }

    if (segments[0]?.toLowerCase() === 'market' && segments[1]?.toLowerCase() === 'listings' && segments[2]) {
      return resolveMarketplaceListingLinkPreview(segments[2])
    }

    if (
      segments[0]?.toLowerCase() === 'com' &&
      segments[1] &&
      segments[2] &&
      segments[3]?.toLowerCase() === 'orgs' &&
      segments[4] &&
      segments[5]?.toLowerCase() === 'events' &&
      segments[6] &&
      segments[6]?.toLowerCase() !== 'manage'
    ) {
      return resolveOrganizationEventLinkPreview(segments[1], segments[2], segments[4], segments[6], viewerId)
    }

    if (
      segments[0]?.toLowerCase() === 'com' &&
      segments[1] &&
      segments[2] &&
      segments[3]?.toLowerCase() === 'orgs' &&
      segments[4]
    ) {
      return resolveOrganizationLinkPreview(segments[1], segments[2], segments[4], viewerId)
    }

    if (segments[0] && segments[1] && segments[2]?.toLowerCase() === 'posts' && segments[3]) {
      return resolvePostLinkPreview(segments[3], viewerId)
    }

    if (segments[0] && segments[1]) {
      return resolveCommunityLinkPreview(segments[0], segments[1])
    }

    return null
  }

  return {
    canViewerAccessEventForPreview,
    canViewerAccessPostForPreview,
    formatEventPreviewDate,
    formatMarketplacePrice,
    normalizeMessageLinkPath,
    resolveMessageLinkPreview,
    truncatePreviewText,
  }
}

export function truncatePreviewText(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

export function formatMarketplacePrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: (currency || 'CAD').toUpperCase(),
    }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

export function formatEventPreviewDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function canViewerAccessEventForPreview(event: any, system: any, viewerId: string | null): boolean {
  const status = String(event.status ?? 'PUBLISHED').toUpperCase()
  if (status !== 'PUBLISHED') return false
  if (event.access !== 'RESTRICTED') return true
  if (!viewerId) return false

  const membership = system.members[viewerId]
  if (!membership || membership.status !== 'ACTIVE') return false

  const eligibleRankIdsRaw = (event as { eligibleRankIds?: unknown }).eligibleRankIds
  const eligibleRankIds = Array.isArray(eligibleRankIdsRaw)
    ? eligibleRankIdsRaw
        .map((rankId) => (typeof rankId === 'string' ? rankId.trim() : ''))
        .filter((rankId): rankId is string => Boolean(rankId))
    : []
  if (eligibleRankIds.length > 0 && !eligibleRankIds.includes(membership.rankId)) {
    return false
  }
  return true
}
