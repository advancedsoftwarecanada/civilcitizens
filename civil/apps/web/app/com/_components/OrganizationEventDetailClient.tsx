'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type OrganizationEventDetailResponse = {
  event?: {
    id: string
    title: string
    description: string | null
    category?: string
    access: 'PUBLIC' | 'RESTRICTED'
    startsAt: string
    endsAt: string | null
    capacity: number | null
    paid: boolean
    priceCents: number | null
    currency: string
    guestSpeakers: string[]
    primaryPhotoUrl: string | null
    galleryPhotoUrls: string[]
  }
  organization?: {
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
  }
}

function formatMoney(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`
}

function toTitleCase(value: string | null | undefined) {
  if (!value) return ''
  return value
    .split('-')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(' ')
}

export default function OrganizationEventDetailClient({
  province,
  municipality,
  organization,
  eventId,
}: {
  province: string
  municipality: string
  organization: string
  eventId: string
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<OrganizationEventDetailResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null

    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/events/${encodeURIComponent(eventId)}`,
        ),
        {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          cache: 'no-store',
        },
      )

      if (!res.ok) {
        setError('Event not found.')
        setPayload(null)
        return
      }

      const data = (await res.json().catch(() => null)) as OrganizationEventDetailResponse | null
      if (!data?.event || !data.organization) {
        setError('Event not found.')
        setPayload(null)
        return
      }

      setPayload(data)
    } catch {
      setError('Unable to load event details right now.')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [eventId, municipality, organization, province])

  useEffect(() => {
    void load()
  }, [load])

  const baseEventsHref = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/events`
  const manageEventsHref = `${baseEventsHref}/manage`

  const event = payload?.event

  return (
    <div className="space-y-5">
      {loading ? <p className="text-sm text-slate-500">Loading event…</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error && event ? (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-subtle">
            {event.primaryPhotoUrl ? (
              <img src={event.primaryPhotoUrl} alt={event.title} className="aspect-[16/6] w-full border-b border-slate-200 object-cover" />
            ) : null}

            <div className="space-y-3 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{event.category ?? 'Other'}</p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{event.title}</h1>
              <p className="text-base text-slate-700">
                {new Date(event.startsAt).toLocaleString()}
                {event.endsAt ? ` → ${new Date(event.endsAt).toLocaleString()}` : ''}
              </p>
              <p className="text-base text-slate-600">{toTitleCase(municipality)} · {toTitleCase(organization)}</p>
              <p className="text-lg font-semibold text-slate-900">
                {event.paid
                  ? event.priceCents && event.priceCents > 0
                    ? `From ${formatMoney(event.priceCents, event.currency)}`
                    : 'Check ticket price on event'
                  : 'Free'}
              </p>

              {event.description ? <div className="prose max-w-none text-slate-800" dangerouslySetInnerHTML={{ __html: event.description }} /> : null}

              {event.guestSpeakers.length ? <p className="text-sm text-slate-600">Speakers: {event.guestSpeakers.join(', ')}</p> : null}
              {event.capacity ? <p className="text-sm text-slate-600">Capacity: {event.capacity}</p> : null}
            </div>
          </section>

          {event.galleryPhotoUrls?.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
              <h2 className="text-base font-semibold text-slate-900">Gallery</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {event.galleryPhotoUrls.map((url) => (
                  <img key={url} src={url} alt="Event gallery" className="aspect-video w-full rounded-xl border border-slate-200 object-cover" />
                ))}
              </div>
            </section>
          ) : null}

          <section className="flex flex-wrap gap-2">
            <Link href={baseEventsHref} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Back to events
            </Link>
            <Link href={manageEventsHref} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Manage events
            </Link>
          </section>
        </>
      ) : null}
    </div>
  )
}
