import type { ApiPost } from '../_components/PostComposer'

export type ShareTargetKind = 'post' | 'event' | 'market_listing' | 'organization' | 'community' | 'profile' | 'url' | 'address'

export type ShareTarget = {
  kind: ShareTargetKind
  id?: string | null
  title: string
  description?: string | null
  url: string
  imageUrl?: string | null
  meta?: string | null
  post?: ApiPost
}

type EventShareTargetInput = {
  eventId: string
  title: string
  description?: string | null
  startsAt?: string | null
  primaryPhotoUrl?: string | null
  galleryPhotoUrls?: string[] | null
  organizationName?: string | null
  provinceCode: string
  communitySlug: string
  organizationSlug: string
}

type AddressShareTargetInput = {
  title: string
  description?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  query?: string | null
}

const ABSOLUTE_URL_REGEX = /^https?:\/\//i

function stripHtmlToText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildPostPath(post: ApiPost): string {
  const slug = post.seoSlug ?? post.id
  if (post.provinceCode && post.communitySlug) {
    const segment = post.type === 'cause' ? 'causes' : 'posts'
    return `/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/${segment}/${slug}`
  }
  return `/u/${post.author.handle}/posts/${slug}`
}

export function toAbsoluteShareUrl(pathOrUrl: string): string {
  const raw = pathOrUrl.trim()
  if (!raw) return raw
  if (ABSOLUTE_URL_REGEX.test(raw)) return raw
  if (typeof window === 'undefined') return raw
  const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`
  return new URL(normalizedPath, window.location.origin).toString()
}

export function buildPostShareTarget(post: ApiPost): ShareTarget {
  const fallbackDescription = post.type === 'article'
    ? post.title || post.body
    : post.body || post.title || 'Shared from Civil'

  return {
    kind: 'post',
    id: post.id,
    title: post.title?.trim() || `Post by @${post.author.handle}`,
    description: fallbackDescription,
    url: buildPostPath(post),
    imageUrl: post.images?.[0] ?? post.mediaUrl ?? null,
    meta: post.communityName ?? post.communitySlug ?? `@${post.author.handle}`,
    post,
  }
}

export function buildEventShareTarget(input: EventShareTargetInput): ShareTarget {
  const province = input.provinceCode.trim().toLowerCase()
  const community = input.communitySlug.trim().toLowerCase()
  const organization = input.organizationSlug.trim().toLowerCase()
  const eventId = input.eventId.trim()

  const plainDescription = stripHtmlToText(input.description)
  const description = plainDescription || `Join this event on Civil`
  const startsAtDate = input.startsAt ? new Date(input.startsAt) : null
  const startsAtLabel = startsAtDate && !Number.isNaN(startsAtDate.getTime())
    ? startsAtDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return {
    kind: 'event',
    id: eventId,
    title: input.title.trim() || 'Civil event',
    description,
    url: `/com/${encodeURIComponent(province)}/${encodeURIComponent(community)}/orgs/${encodeURIComponent(organization)}/events/${encodeURIComponent(eventId)}`,
    imageUrl: input.primaryPhotoUrl ?? input.galleryPhotoUrls?.[0] ?? null,
    meta: [input.organizationName?.trim(), startsAtLabel].filter(Boolean).join(' • ') || null,
  }
}

export function buildAddressShareTarget(input: AddressShareTargetInput): ShareTarget {
  const title = input.title.trim() || 'Address'
  const description = stripHtmlToText(input.description || input.address || '') || 'Shared address on Civil'
  const params = new URLSearchParams()

  if (input.query?.trim()) params.set('q', input.query.trim())
  params.set('label', title)
  if (input.address?.trim()) params.set('address', input.address.trim())
  if (typeof input.latitude === 'number' && Number.isFinite(input.latitude)) params.set('lat', String(input.latitude))
  if (typeof input.longitude === 'number' && Number.isFinite(input.longitude)) params.set('lon', String(input.longitude))

  return {
    kind: 'address',
    title,
    description,
    url: `/addresses?${params.toString()}`,
    meta: input.address?.trim() || null,
  }
}

function trimMessagePart(value: string, max = 260): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

export function buildExternalShareText(target: ShareTarget, max = 180): string {
  return trimMessagePart(target.description || target.title || 'Check this out on Civil', max)
}

export function buildExternalShareTitle(target: ShareTarget, max = 90): string {
  return trimMessagePart(target.title || 'Civil', max) || 'Civil'
}

export function buildDirectShareMessage(target: ShareTarget): string {
  const absoluteUrl = toAbsoluteShareUrl(target.url)
  const intro = trimMessagePart(target.description || target.title || 'Check this out on Civil', 220)
  return intro ? `${intro}\n${absoluteUrl}` : absoluteUrl
}

export function buildRepostBody(target: ShareTarget, note: string): string {
  const trimmedNote = note.trim()
  const absoluteUrl = toAbsoluteShareUrl(target.url)
  const titleLine = trimMessagePart(target.title || '', 160)

  if (trimmedNote && titleLine) return `${trimmedNote}\n\n${titleLine}\n${absoluteUrl}`
  if (trimmedNote) return `${trimmedNote}\n\n${absoluteUrl}`
  if (titleLine) return `${titleLine}\n${absoluteUrl}`
  return absoluteUrl
}

export function isPostTarget(target: ShareTarget): target is ShareTarget & { kind: 'post'; post: ApiPost } {
  return target.kind === 'post' && Boolean(target.post?.id)
}
