import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { buildApiUrl } from '../../../_lib/api'

export const metadata: Metadata = {
  title: 'Event',
}

type EventCanonicalLookupResponse = {
  event?: {
    id: string
  }
  organization?: {
    slug: string
    provinceCode: string | null
    communitySlug: string | null
  }
}

type PageProps = {
  params: Promise<{
    organizationId: string
    eventId: string
  }>
}

export default async function EventDetailPage({ params }: PageProps) {
  const { organizationId, eventId } = await params
  const normalizedOrganizationId = organizationId.trim()
  const normalizedEventId = eventId.trim()
  if (!normalizedOrganizationId || !normalizedEventId) return notFound()

  let lookup: EventCanonicalLookupResponse | null = null
  try {
    const response = await fetch(
      buildApiUrl(`/events/${encodeURIComponent(normalizedOrganizationId)}/${encodeURIComponent(normalizedEventId)}`),
      { cache: 'no-store' },
    )
    if (!response.ok) return notFound()
    lookup = (await response.json().catch(() => null)) as EventCanonicalLookupResponse | null
  } catch {
    return notFound()
  }

  const canonicalEventId = lookup?.event?.id?.trim()
  const province = lookup?.organization?.provinceCode?.trim().toLowerCase()
  const municipality = lookup?.organization?.communitySlug?.trim().toLowerCase()
  const slug = lookup?.organization?.slug?.trim().toLowerCase()
  if (!canonicalEventId || !province || !municipality || !slug) return notFound()

  redirect(
    `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/events/${encodeURIComponent(canonicalEventId)}`,
  )
}
