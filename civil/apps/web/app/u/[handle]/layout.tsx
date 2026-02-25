import type { Metadata } from 'next'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'

type LayoutProps = {
  children: ReactNode
  params: {
    handle: string
  }
}

type UserProfile = {
  handle?: string
  name?: string | null
  bio?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizeBaseUrl(value: string): string {
  const v = trimTrailingSlash(value)
  if (/^https?:\/\//i.test(v)) return v
  return `https://${v}`
}

function resolveRequestBaseUrl(): string {
  const h = headers()
  const forwardedHost = h.get('x-forwarded-host')
  const host = forwardedHost || h.get('host') || process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca'
  const forwardedProto = h.get('x-forwarded-proto')
  const protocol = forwardedProto || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https')

  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return normalizeBaseUrl(process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca')
  }

  return `${protocol}://${trimTrailingSlash(host)}`
}

function resolveApiBase(baseUrl: string): string {
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || '/api').trim()
  if (/^https?:\/\//i.test(apiBase)) return trimTrailingSlash(apiBase)
  const path = apiBase.startsWith('/') ? apiBase : `/${apiBase}`
  return `${trimTrailingSlash(baseUrl)}${path}`
}

function toAbsoluteUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  const path = url.startsWith('/') ? url : `/${url}`
  return `${trimTrailingSlash(baseUrl)}${path}`
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function sanitizeBioForMetadata(value: string | null | undefined): string {
  if (!value) return ''

  let text = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

  text = decodeHtmlEntities(text)

  text = text
    .replace(/--tw-[^;\s]*\s*:[^;]*;?/gi, ' ')
    .replace(/\b(?:background(?:-color)?|border-image|color|font-family|font-size|line-height|letter-spacing|word-spacing|text-rendering|filter|backdrop-filter|opacity|contrast|brightness|saturate|invert|hue-rotate|drop-shadow|sepia|blur|contain-intrinsic-size|contain-layout|contain-paint|contain-style)\s*:[^;]*;?/gi, ' ')
    .replace(/rgb\([^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length > 220) {
    return `${text.slice(0, 217).trimEnd()}...`
  }

  return text
}

async function fetchUserProfile(handle: string, baseUrl: string): Promise<UserProfile | null> {
  try {
    const apiBase = resolveApiBase(baseUrl)
    const url = `${apiBase}/users/${encodeURIComponent(handle)}/posts?sort=hot`
    const res = await fetch(url, {
      next: { revalidate: 60 },
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: UserProfile }
    return data?.user ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const rawHandle = decodeURIComponent(params.handle)
  const handle = rawHandle.replace(/^@+/, '')
  const baseUrl = resolveRequestBaseUrl()
  const profileUrl = `${baseUrl}/u/${encodeURIComponent(handle)}`
  const profile = await fetchUserProfile(handle, baseUrl)

  const displayName = profile?.name?.trim() || `@${handle}`
  const profileBioText = sanitizeBioForMetadata(profile?.bio)
  const description = profileBioText || `View ${displayName}'s profile on Civil Citizens.`
  const imageUrl =
    toAbsoluteUrl(profile?.coverUrl, baseUrl) ||
    toAbsoluteUrl(profile?.avatarUrl, baseUrl) ||
    `${baseUrl}/logo-lg.png`

  const metadata: Metadata = {
    title: `${displayName} (@${handle}) | Civil Citizens`,
    description,
    alternates: {
      canonical: profileUrl,
    },
    openGraph: {
      type: 'profile',
      url: profileUrl,
      title: `${displayName} (@${handle})`,
      description,
      siteName: 'Civil Citizens',
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayName} (@${handle})`,
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

export default function UserHandleLayout({ children }: LayoutProps) {
  return children
}
