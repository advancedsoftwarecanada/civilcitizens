import type { Metadata } from 'next'
import { headers } from 'next/headers'

type CauseMetadataPost = {
  id: string
  type: string
  seoSlug: string | null
  title?: string | null
  body: string
  createdAt: string
  updatedAt: string
  provinceCode?: string | null
  communitySlug?: string | null
  mediaUrl?: string | null
  images?: string[] | null
}

type CausePostResponse = {
  post?: CauseMetadataPost | null
}

function trimTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizeBaseUrl(value: string) {
  const normalized = trimTrailingSlash(value)
  if (/^https?:\/\//i.test(normalized)) return normalized
  return `https://${normalized}`
}

function resolveRequestBaseUrl() {
  const requestHeaders = headers()
  const forwardedHost = requestHeaders.get('x-forwarded-host')
  const host = forwardedHost || requestHeaders.get('host') || process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca'
  const forwardedProto = requestHeaders.get('x-forwarded-proto')
  const protocol = forwardedProto || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https')

  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return normalizeBaseUrl(process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca')
  }

  return `${protocol}://${trimTrailingSlash(host)}`
}

function resolveApiBase(baseUrl: string) {
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || '/api').trim()
  if (/^https?:\/\//i.test(apiBase)) return trimTrailingSlash(apiBase)
  const path = apiBase.startsWith('/') ? apiBase : `/${apiBase}`
  return `${trimTrailingSlash(baseUrl)}${path}`
}

function toAbsoluteUrl(url: string | null | undefined, baseUrl: string) {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  const path = url.startsWith('/') ? url : `/${url}`
  return `${trimTrailingSlash(baseUrl)}${path}`
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function sanitizeDescriptionForMetadata(value: string | null | undefined) {
  if (!value) return ''

  let text = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

  text = decodeHtmlEntities(text).replace(/\s+/g, ' ').trim()
  if (text.length > 220) return `${text.slice(0, 217).trimEnd()}...`
  return text
}

async function fetchCausePost(slug: string, baseUrl: string): Promise<CauseMetadataPost | null> {
  try {
    const apiBase = resolveApiBase(baseUrl)
    const response = await fetch(`${apiBase}/posts/slug/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as CausePostResponse | null
    const post = payload?.post ?? null
    if (!post || post.type !== 'cause') return null
    return post
  } catch {
    return null
  }
}

export async function generateCauseMetadata(input: {
  province: string
  chamber: string
  slug: string
}): Promise<Metadata> {
  const baseUrl = resolveRequestBaseUrl()
  const requestedCanonicalPath = `/${encodeURIComponent(input.province)}/${encodeURIComponent(input.chamber)}/causes/${encodeURIComponent(input.slug)}`
  const fallbackTitle = 'Cause | Civil Citizens'
  const fallbackDescription = 'View this cause on Civil Citizens.'
  const fallbackImageUrl = `${baseUrl}/logo-lg.png`
  const post = await fetchCausePost(input.slug, baseUrl)

  if (!post) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      alternates: {
        canonical: `${baseUrl}${requestedCanonicalPath}`,
      },
      openGraph: {
        type: 'article',
        url: `${baseUrl}${requestedCanonicalPath}`,
        title: fallbackTitle,
        description: fallbackDescription,
        siteName: 'Civil Citizens',
        images: [{ url: fallbackImageUrl }],
      },
      twitter: {
        card: 'summary_large_image',
        title: fallbackTitle,
        description: fallbackDescription,
        images: [fallbackImageUrl],
      },
    }
  }

  const canonicalPath = post.provinceCode && post.communitySlug
    ? `/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/causes/${encodeURIComponent((post.seoSlug ?? post.id).trim())}`
    : requestedCanonicalPath
  const canonicalUrl = `${baseUrl}${canonicalPath}`
  const title = post.title?.trim() || 'Cause'
  const description = sanitizeDescriptionForMetadata(post.body) || `View ${title} on Civil Citizens.`
  const imageUrl =
    toAbsoluteUrl(post.images?.[0] ?? null, baseUrl) ||
    toAbsoluteUrl(post.mediaUrl ?? null, baseUrl) ||
    fallbackImageUrl

  const metadata: Metadata = {
    title: `${title} | Civil Citizens`,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'article',
      url: canonicalUrl,
      title,
      description,
      siteName: 'Civil Citizens',
      images: [{ url: imageUrl }],
      publishedTime: post.createdAt,
      modifiedTime: post.updatedAt,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  }

  const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID?.trim()
  if (fbAppId) {
    metadata.other = {
      'fb:app_id': fbAppId,
    }
  }

  return metadata
}
