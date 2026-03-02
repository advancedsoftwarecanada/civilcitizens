'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'

type EventFee = {
  id: string
  label: string
  amountCents: number
  capacity: number | null
  cashOnly: boolean
  goingCount?: number
  remainingCount?: number | null
}

type ViewerRsvp = {
  id: string
  status: 'GOING' | 'INTERESTED' | 'DECLINED'
  ticketId: string | null
  ticketLabel: string | null
  amountCents: number | null
  message: string | null
  createdAt: string
  updatedAt: string
}

type EventDetailPayload = {
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
    fees?: EventFee[]
    guestSpeakers: string[]
    primaryPhotoUrl: string | null
    galleryPhotoUrls: string[]
  }
  viewerRsvp?: ViewerRsvp | null
  rsvpSummary?: {
    goingCount: number
    interestedCount: number
  }
  organization?: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    coverUrl: string | null
    isVerified: boolean
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

function formatEventDateBadge(isoString: string) {
  const value = new Date(isoString)
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const startOfDate = new Date(value)
  startOfDate.setHours(0, 0, 0, 0)

  if (startOfDate.getTime() === startOfToday.getTime()) return 'Today'
  if (startOfDate.getTime() === startOfTomorrow.getTime()) return 'Tomorrow'

  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatEventTimeBadge(isoString: string) {
  const value = new Date(isoString)
  return value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function EventDetailPageClient({
  organizationId,
  eventId,
}: {
  organizationId: string
  eventId: string
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<EventDetailPayload | null>(null)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string>('')
  const [joinMessage, setJoinMessage] = useState('')
  const [joining, setJoining] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const res = await fetch(buildApiUrl(`/events/${encodeURIComponent(organizationId)}/${encodeURIComponent(eventId)}`), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })

      if (!res.ok) {
        setError('Event not found.')
        setPayload(null)
        return
      }

      const data = (await res.json().catch(() => null)) as EventDetailPayload | null
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
  }, [eventId, organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const event = payload?.event
  const organization = payload?.organization
  const viewerRsvp = payload?.viewerRsvp ?? null
  const fees = Array.isArray(event?.fees) ? event.fees : []
  useEffect(() => {
    if (viewerRsvp?.ticketId) {
      setSelectedTicketId(viewerRsvp.ticketId)
      setJoinMessage(viewerRsvp.message ?? '')
      return
    }
    const firstFee = fees[0]
    setSelectedTicketId(firstFee?.id ?? '')
    setJoinMessage('')
  }, [fees, viewerRsvp?.message, viewerRsvp?.ticketId])

  const submitJoin = useCallback(async () => {
    if (!event || !organization?.provinceCode || !organization.communitySlug) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    if (fees.length > 0 && !selectedTicketId) return

    setJoining(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(organization.provinceCode)}/${encodeURIComponent(organization.communitySlug)}/orgs/${encodeURIComponent(organization.slug)}/governance/events/${encodeURIComponent(event.id)}/rsvp`,
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            status: 'GOING',
            ticketId: fees.length > 0 ? selectedTicketId : null,
            message: joinMessage.trim() || null,
          }),
        },
      )

      if (!res.ok) {
        setJoining(false)
        return
      }

      setShowJoinModal(false)
      await load()
    } finally {
      setJoining(false)
    }
  }, [event, fees.length, joinMessage, load, organization?.communitySlug, organization?.provinceCode, organization?.slug, selectedTicketId])

  const startRsvpForFee = useCallback((feeId: string) => {
    setSelectedTicketId(feeId)
    setShowJoinModal(true)
  }, [])
  const organizationEventsHref =
    organization?.provinceCode && organization?.communitySlug
      ? `/com/${encodeURIComponent(organization.provinceCode)}/${encodeURIComponent(organization.communitySlug)}/orgs/${encodeURIComponent(organization.slug)}/events`
      : null
  const communityHref =
    organization?.provinceCode && organization?.communitySlug
      ? `/com/${encodeURIComponent(organization.provinceCode)}/${encodeURIComponent(organization.communitySlug)}`
      : null
  const organizationHref =
    organization?.provinceCode && organization?.communitySlug
      ? `/com/${encodeURIComponent(organization.provinceCode)}/${encodeURIComponent(organization.communitySlug)}/orgs/${encodeURIComponent(organization.slug)}`
      : null

  return (
    <DashboardShell rightRail={<RightRail mode="events" showOrganizations />} showMobileRightRail>
      <div className="space-y-5 pb-12">
        {loading ? <p className="text-sm text-slate-500">Loading event…</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {!loading && !error && event && organization ? (
          <>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-subtle">
              {event.primaryPhotoUrl ? (
                <img src={event.primaryPhotoUrl} alt={event.title} className="aspect-[16/6] w-full border-b border-slate-200 object-cover" />
              ) : null}

              <div className="space-y-3 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{event.category ?? 'Other'}</p>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{event.title}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                    {formatEventDateBadge(event.startsAt)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                    {formatEventTimeBadge(event.startsAt)}
                  </span>
                  {event.endsAt ? (
                    <>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                        Ends {formatEventDateBadge(event.endsAt)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                        {formatEventTimeBadge(event.endsAt)}
                      </span>
                    </>
                  ) : null}
                </div>
                <p className="text-base text-slate-600">
                  {communityHref ? (
                    <Link href={communityHref} className="font-semibold text-slate-700 hover:underline">
                      {toTitleCase(organization.communitySlug)}
                    </Link>
                  ) : (
                    toTitleCase(organization.communitySlug)
                  )}{' '}
                  ·{' '}
                  {organizationHref ? (
                    <Link href={organizationHref} className="font-semibold text-slate-700 hover:underline">
                      {organization.name}
                    </Link>
                  ) : (
                    organization.name
                  )}
                </p>

                {event.description ? (
                  <div className="prose max-w-none text-slate-800" dangerouslySetInnerHTML={{ __html: event.description }} />
                ) : null}

                {event.guestSpeakers.length ? (
                  <p className="text-sm text-slate-600">Speakers: {event.guestSpeakers.join(', ')}</p>
                ) : null}
                {event.capacity ? <p className="text-sm text-slate-600">Capacity: {event.capacity}</p> : null}
              </div>
            </section>

            {organizationHref ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
                <h2 className="text-base font-semibold text-slate-900">Organization</h2>
                <Link href={organizationHref} className="mt-3 block">
                  <div className="relative overflow-hidden rounded-xl border border-slate-200 p-3">
                    {organization.coverUrl ? <img src={organization.coverUrl} alt={`${organization.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                    <div className={organization.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-slate-50'} />
                    <div className="relative z-[1] flex items-center gap-3">
                      <div className="h-12 w-12 overflow-hidden rounded-full border border-slate-200 bg-white">
                        {organization.logoUrl ? <img src={organization.logoUrl} alt={organization.name} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0">
                        <p className={organization.coverUrl ? 'truncate text-sm font-semibold text-white' : 'truncate text-sm font-semibold text-slate-900'}>
                          {organization.name}
                        </p>
                        <p className={organization.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>
                          /{(organization.provinceCode ?? '').toLowerCase()}/{organization.communitySlug ?? ''}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              </section>
            ) : null}

            {fees.length > 0 ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">Fees</h2>
                  {viewerRsvp?.status === 'GOING' ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {viewerRsvp.ticketLabel?.trim() ? `You RSVP’d: ${viewerRsvp.ticketLabel}` : 'You have 1 RSVP'}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Fee name</th>
                        <th className="px-3 py-2 text-left">Amount</th>
                        <th className="px-3 py-2 text-left">Capacity</th>
                        <th className="px-3 py-2 text-left">Payment</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fees.map((fee) => (
                        <tr key={fee.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-sm font-semibold text-slate-800">{fee.label}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{formatMoney(fee.amountCents, event.currency)}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">
                            {typeof fee.remainingCount === 'number'
                              ? `${fee.remainingCount} remaining`
                              : typeof fee.capacity === 'number' && fee.capacity > 0
                                ? `${fee.capacity} remaining`
                                : 'Unlimited'}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-700">{fee.cashOnly ? 'Cash only' : 'Online'}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => startRsvpForFee(fee.id)}
                              className="rounded-full bg-[var(--cc-primary)] px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110"
                            >
                              RSVP
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

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
              <Link href="/events" className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Back to events
              </Link>
              {organizationEventsHref ? (
                <Link
                  href={organizationEventsHref}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View organization events
                </Link>
              ) : null}
            </section>

            {showJoinModal && event ? (
              <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowJoinModal(false)}>
                <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" onClick={(evt) => evt.stopPropagation()}>
                  <h3 className="text-base font-semibold text-slate-900">Confirm RSVP</h3>
                  <p className="mt-1 text-xs text-slate-500">Select your ticket type and optional message for the organizer.</p>

                  <div className="mt-4 space-y-3">
                    {fees.length > 0 ? (
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-600">Ticket type</label>
                        {fees.map((fee) => (
                          <label key={fee.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                            <span className="font-semibold">{fee.label}</span>
                            <span>{formatMoney(fee.amountCents, event.currency)}</span>
                            <input
                              type="radio"
                              name="event-ticket"
                              value={fee.id}
                              checked={selectedTicketId === fee.id}
                              onChange={() => setSelectedTicketId(fee.id)}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Default ticket: Free</p>
                    )}

                    <label className="block text-xs font-semibold text-slate-600">
                      Message to organizer (optional)
                      <textarea
                        value={joinMessage}
                        onChange={(evt) => setJoinMessage(evt.target.value)}
                        rows={4}
                        maxLength={600}
                        placeholder="Any notes for the organizer..."
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowJoinModal(false)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitJoin()}
                      disabled={joining || (fees.length > 0 && !selectedTicketId)}
                      className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {joining ? 'Submitting…' : 'Confirm join'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </DashboardShell>
  )
}
