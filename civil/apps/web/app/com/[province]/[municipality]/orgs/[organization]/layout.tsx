import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { OrganizationContextProvider } from '../../../../_components/OrganizationContext'
import OrganizationLayoutClient from '../../../../_components/OrganizationLayoutClient'
import { fetchCommunityOrganization } from '../../../../../_lib/organizations'

export const dynamic = 'force-dynamic'

const titleCase = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

type LayoutProps = {
  children: ReactNode
  params: {
    province: string
    municipality: string
    organization: string
  }
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

function sanitizeDescriptionForMetadata(value: string | null | undefined): string {
  if (!value) return ''

  let text = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

  text = decodeHtmlEntities(text).replace(/\s+/g, ' ').trim()
  if (text.length > 220) return `${text.slice(0, 217).trimEnd()}...`
  return text
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const province = decodeURIComponent(params.province)
  const municipality = decodeURIComponent(params.municipality)
  const slug = decodeURIComponent(params.organization).trim().toLowerCase()
  const baseUrl = resolveRequestBaseUrl()

  const org = await fetchCommunityOrganization({ province, municipality, slug })
  const canonicalSlug = org?.slug?.trim() || slug
  const orgName = org?.name?.trim() || titleCase(slug)
  const description =
    sanitizeDescriptionForMetadata(org?.headline) ||
    sanitizeDescriptionForMetadata(org?.description) ||
    `View ${orgName} on Civil Citizens.`

  const canonicalPath = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(canonicalSlug)}`
  const canonicalUrl = `${baseUrl}${canonicalPath}`
  const imageUrl =
    toAbsoluteUrl(org?.coverUrl, baseUrl) ||
    toAbsoluteUrl(org?.logoUrl, baseUrl) ||
    `${baseUrl}/logo-lg.png`

  return {
    title: `${orgName} | Civil Citizens`,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title: orgName,
      description,
      siteName: 'Civil Citizens',
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: 'summary_large_image',
      title: orgName,
      description,
      images: [imageUrl],
    },
  }
}

export default async function OrganizationLayout({ children, params }: LayoutProps) {
  const province = decodeURIComponent(params.province)
  const municipality = decodeURIComponent(params.municipality)
  const slug = decodeURIComponent(params.organization).trim().toLowerCase()
  const baseUrl = resolveRequestBaseUrl()

  const org = await fetchCommunityOrganization({
    province,
    municipality,
    slug,
  })
  const canonicalSlug = org?.slug?.trim().toLowerCase() || slug
  if (org && canonicalSlug !== slug) {
    redirect(`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(canonicalSlug)}`)
  }
  const name = org?.name ?? titleCase(slug)
  const canonicalPath = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(canonicalSlug)}`
  const canonicalUrl = `${baseUrl}${canonicalPath}`
  const imageUrl = toAbsoluteUrl(org?.coverUrl, baseUrl) || toAbsoluteUrl(org?.logoUrl, baseUrl)
  const logoUrl = toAbsoluteUrl(org?.logoUrl, baseUrl) || imageUrl
  const description =
    sanitizeDescriptionForMetadata(org?.headline) ||
    sanitizeDescriptionForMetadata(org?.description) ||
    `View ${name} on Civil Citizens.`

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: canonicalUrl,
    description,
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(logoUrl ? { logo: logoUrl } : {}),
    ...(org?.websiteUrl ? { sameAs: [org.websiteUrl] } : {}),
    ...(org?.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: org.address,
            addressLocality: titleCase(municipality),
            addressRegion: province.toUpperCase(),
            addressCountry: 'CA',
          },
        }
      : {}),
  }

  return (
    <OrganizationContextProvider value={{ slug: canonicalSlug, name }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <OrganizationLayoutClient initialOrg={org} province={params.province} municipality={params.municipality}>
        {children}
      </OrganizationLayoutClient>
    </OrganizationContextProvider>
  )
}
