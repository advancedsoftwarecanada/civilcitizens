'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { LuRepeat2, LuShare } from 'react-icons/lu'
import SharePostModal from '../../_components/SharePostModal'
import ShareSendModal from '../../_components/ShareSendModal'
import type { CommunityTarget } from '../../_components/PostComposer'
import { buildApiUrl } from '../../_lib/api'
import { buildAddressesHref } from '../../_lib/addressSearch'
import { buildEventShareTarget, type ShareTarget } from '../../_lib/shareTarget'

type InviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED'

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

type EventGuestSpeakerInvite = {
  userId: string
  name: string
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  status: InviteStatus
}

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
    guestSpeakerInvites?: EventGuestSpeakerInvite[]
    sponsors?: EventSponsorTag[]
    sponsorInvites?: EventSponsorTag[]
    fees?: EventFee[]
    primaryPhotoUrl: string | null
    galleryPhotoUrls: string[]
  }
  viewerRsvp?: ViewerRsvp | null
  rsvpSummary?: {
    goingCount: number
    interestedCount: number
  }
  viewerInvitation?: {
    kind: 'guest_speaker' | 'sponsor'
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
    notificationId: string | null
    inviter: {
      id: string
      handle: string
      name?: string | null
      avatarUrl?: string | null
      coverUrl?: string | null
      isPremium?: boolean
      isVerified?: boolean
    } | null
  } | null
  organization?: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    address: string | null
    addressDetails?: {
      name?: string | null
      label?: string | null
      line1?: string | null
      line2?: string | null
      city?: string | null
      province?: string | null
      postalCode?: string | null
      country?: string | null
      latitude?: number | null
      longitude?: number | null
    } | null
    logoUrl: string | null
    coverUrl: string | null
    isVerified: boolean
  }
}

type EventSponsorTag = {
  organizationId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl?: string | null
  status?: InviteStatus
}

function formatMoney(cents: number) {
  return `${(cents / 100).toFixed(2)} CAD`
}

function toTitleCase(value: string | null | undefined) {
  if (!value) return ''
  return value
    .split('-')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(' ')
}

function toCategoryQueryValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return normalized || 'other'
}

function isVideoMedia(url: string) {
  const source = (url.split('?')[0] ?? '').split('#')[0]?.toLowerCase() ?? ''
  return /\.(mp4|webm|mov|m4v|ogg)$/.test(source)
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
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<OrganizationEventDetailResponse | null>(null)
  const [respondingAction, setRespondingAction] = useState<'accept' | 'reject' | null>(null)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string>('')
  const [joinMessage, setJoinMessage] = useState('')
  const [joining, setJoining] = useState(false)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [activeGalleryIndex, setActiveGalleryIndex] = useState<number | null>(null)
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)

  const requireAuthenticatedCta = useCallback((): string | null => {
    if (typeof window === 'undefined') return null
    const token = window.localStorage.getItem('token')
    if (token) return token
    router.push('/')
    return null
  }, [router])

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

  const event = payload?.event
  const org = payload?.organization
  const resolvedProvince = (org?.provinceCode ?? province).trim().toLowerCase()
  const resolvedMunicipality = (org?.communitySlug ?? municipality).trim().toLowerCase()
  const resolvedOrganizationSlug = (org?.slug ?? organization).trim().toLowerCase()
  const invitation = payload?.viewerInvitation ?? null
  const viewerRsvp = payload?.viewerRsvp ?? null
  const fees = useMemo(() => (Array.isArray(event?.fees) ? event.fees : []), [event?.fees])

  const communityHref = `/com/${encodeURIComponent(resolvedProvince)}/${encodeURIComponent(resolvedMunicipality)}`
  const organizationHref = `/com/${encodeURIComponent(resolvedProvince)}/${encodeURIComponent(resolvedMunicipality)}/orgs/${encodeURIComponent(resolvedOrganizationSlug)}`
  const categoryHref = `/events?category=${encodeURIComponent(toCategoryQueryValue(event?.category))}`
  const shareCommunityOptions = useMemo<CommunityTarget[]>(
    () =>
      resolvedProvince && resolvedMunicipality
        ? [
            {
              provinceCode: resolvedProvince.toUpperCase(),
              communitySlug: resolvedMunicipality,
              communityName: toTitleCase(resolvedMunicipality),
            },
          ]
        : [],
    [resolvedMunicipality, resolvedProvince],
  )
  const eventShareTarget = useMemo<ShareTarget | null>(() => {
    if (!event || !resolvedProvince || !resolvedMunicipality || !resolvedOrganizationSlug) return null
    return buildEventShareTarget({
      eventId: event.id,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      primaryPhotoUrl: event.primaryPhotoUrl,
      galleryPhotoUrls: event.galleryPhotoUrls,
      organizationName: org?.name ?? toTitleCase(resolvedOrganizationSlug),
      provinceCode: resolvedProvince,
      communitySlug: resolvedMunicipality,
      organizationSlug: resolvedOrganizationSlug,
    })
  }, [event, org?.name, resolvedMunicipality, resolvedOrganizationSlug, resolvedProvince])
  const attendanceMode = typeof (event as { attendanceMode?: unknown } | undefined)?.attendanceMode === 'string'
    ? String((event as { attendanceMode?: string }).attendanceMode).trim().toUpperCase()
    : null
  const directionsHref = useMemo(() => {
    if (!org) return null
    const latitude = typeof org.addressDetails?.latitude === 'number' ? org.addressDetails.latitude : null
    const longitude = typeof org.addressDetails?.longitude === 'number' ? org.addressDetails.longitude : null
    const address = org.address?.trim() || null
    if (!address && (latitude === null || longitude === null)) return null
    return buildAddressesHref({
      query: address || `${event?.title ?? org.name} ${resolvedMunicipality}`,
      label: event?.title ?? org.name,
      address,
      latitude,
      longitude,
    })
  }, [event?.title, org, resolvedMunicipality])
  const showDirections = Boolean(directionsHref) && (!attendanceMode || attendanceMode === 'IN_PERSON' || attendanceMode === 'HYBRID')

  const guestSpeakerCards = useMemo(() => {
    if (!event) return []
    if (Array.isArray(event.guestSpeakerInvites) && event.guestSpeakerInvites.length > 0) {
      return event.guestSpeakerInvites.filter((speaker) => speaker.status !== 'DECLINED')
    }
    return []
  }, [event])

  const sponsorCards = useMemo(() => {
    if (!event) return []
    if (Array.isArray(event.sponsorInvites) && event.sponsorInvites.length > 0) {
      return event.sponsorInvites.filter((sponsor) => sponsor.status !== 'DECLINED')
    }
    return Array.isArray(event.sponsors) ? event.sponsors : []
  }, [event])

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

  const activeGalleryItem =
    typeof activeGalleryIndex === 'number' && event?.galleryPhotoUrls?.[activeGalleryIndex]
      ? event.galleryPhotoUrls[activeGalleryIndex]
      : null

  const moveGallery = useCallback(
    (direction: 'prev' | 'next') => {
      if (!event?.galleryPhotoUrls?.length || typeof activeGalleryIndex !== 'number') return
      const total = event.galleryPhotoUrls.length
      if (total <= 1) return
      const delta = direction === 'next' ? 1 : -1
      setActiveGalleryIndex((current) => {
        if (typeof current !== 'number') return 0
        return (current + delta + total) % total
      })
    },
    [activeGalleryIndex, event?.galleryPhotoUrls],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || activeGalleryItem === null) return

    const onKeyDown = (eventKey: KeyboardEvent) => {
      if (eventKey.key === 'Escape') {
        setActiveGalleryIndex(null)
        return
      }
      if (eventKey.key === 'ArrowLeft') {
        eventKey.preventDefault()
        moveGallery('prev')
      }
      if (eventKey.key === 'ArrowRight') {
        eventKey.preventDefault()
        moveGallery('next')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeGalleryItem, moveGallery])

  const respondToInvitation = useCallback(
    async (action: 'accept' | 'reject') => {
      const notificationId = invitation?.notificationId
      if (!notificationId) return

      const token = requireAuthenticatedCta()
      if (!token) return

      setRespondingAction(action)
      try {
        const res = await fetch(buildApiUrl(`/notifications/${encodeURIComponent(notificationId)}/respond`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action }),
        })

        if (!res.ok) {
          setRespondingAction(null)
          return
        }

        await load()
      } finally {
        setRespondingAction(null)
      }
    },
    [invitation?.notificationId, load, requireAuthenticatedCta],
  )

  const submitJoin = useCallback(async () => {
    if (!event) return
    const token = requireAuthenticatedCta()
    if (!token) return

    if (fees.length > 0 && !selectedTicketId) return

    setJoining(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/governance/events/${encodeURIComponent(event.id)}/rsvp`,
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
  }, [event, fees.length, joinMessage, load, municipality, organization, province, requireAuthenticatedCta, selectedTicketId])

  const handleJoinClick = useCallback(() => {
    if (!requireAuthenticatedCta()) return
    setShowJoinModal(true)
  }, [requireAuthenticatedCta])

  const handleRepostClick = useCallback(() => {
    if (!requireAuthenticatedCta()) return
    setRepostModalOpen(true)
  }, [requireAuthenticatedCta])

  const handleShareClick = useCallback(() => {
    if (!requireAuthenticatedCta()) return
    setShareModalOpen(true)
  }, [requireAuthenticatedCta])

  return (
    <div className="space-y-5">
      {loading ? <p className="text-sm text-slate-500">Loading event…</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error && event ? (
        <>
          {invitation?.status === 'PENDING' && invitation.notificationId ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-subtle">
              <div className="relative overflow-hidden border-b border-slate-200 px-4 py-3">
                {invitation.inviter?.coverUrl ? <img src={invitation.inviter.coverUrl} alt="Inviter cover" className="absolute inset-0 h-full w-full object-cover" /> : null}
                <div className={invitation.inviter?.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                <div className="relative z-[1] flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="h-9 w-9 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                      {invitation.inviter?.avatarUrl ? <img src={invitation.inviter.avatarUrl} alt={invitation.inviter.name ?? invitation.inviter.handle ?? 'Inviter'} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      {invitation.inviter?.handle ? (
                        <Link
                          href={`/u/${encodeURIComponent(invitation.inviter.handle)}`}
                          className={invitation.inviter?.coverUrl ? 'truncate text-sm font-semibold text-white hover:underline' : 'truncate text-sm font-semibold text-slate-800 hover:underline'}
                        >
                          {invitation.inviter?.name?.trim() || invitation.inviter?.handle || 'Civil member'}
                        </Link>
                      ) : (
                        <p className={invitation.inviter?.coverUrl ? 'truncate text-sm font-semibold text-white' : 'truncate text-sm font-semibold text-slate-800'}>
                          {invitation.inviter?.name?.trim() || invitation.inviter?.handle || 'Civil member'}
                        </p>
                      )}
                      {invitation.inviter?.handle ? (
                        <p className={invitation.inviter?.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>@{invitation.inviter.handle}</p>
                      ) : null}
                    </div>
                  </div>
                  {invitation.inviter?.handle ? (
                    <Link
                      href={`/u/${encodeURIComponent(invitation.inviter.handle)}`}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View profile
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm text-slate-700">
                  {invitation.kind === 'guest_speaker'
                    ? 'You have a pending guest speaker invitation for this event.'
                    : 'You have a pending sponsor invitation for this event.'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void respondToInvitation('accept')}
                    disabled={respondingAction !== null}
                    className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {respondingAction === 'accept' ? 'Accepting…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void respondToInvitation('reject')}
                    disabled={respondingAction !== null}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {respondingAction === 'reject' ? 'Declining…' : 'Decline'}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-subtle">
            {event.primaryPhotoUrl ? (
              <img src={event.primaryPhotoUrl} alt={event.title} className="aspect-[16/6] w-full border-b border-slate-200 object-cover" />
            ) : null}

            <div className="space-y-3 p-5">
              <Link href={categoryHref} className="inline-flex text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)] hover:underline">
                {event.category ?? 'Other'}
              </Link>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{event.title}</h1>
              <p className="text-base text-slate-700">
                {new Date(event.startsAt).toLocaleString()}
                {event.endsAt ? ` → ${new Date(event.endsAt).toLocaleString()}` : ''}
              </p>
              <p className="text-base text-slate-600">
                <Link href={communityHref} className="font-semibold text-slate-700 hover:underline">
                  {toTitleCase(resolvedMunicipality)}
                </Link>{' '}
                ·{' '}
                <Link
                  href={organizationHref}
                  className="font-semibold text-slate-700 hover:underline"
                >
                  {org?.name || toTitleCase(resolvedOrganizationSlug)}
                </Link>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleJoinClick}
                  className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  {viewerRsvp?.status === 'GOING' ? 'Update RSVP' : 'Join'}
                </button>
                {showDirections && directionsHref ? (
                  <Link
                    href={directionsHref}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <span>Directions</span>
                  </Link>
                ) : null}
                {eventShareTarget ? (
                  <>
                    <button
                      type="button"
                      onClick={handleRepostClick}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <LuRepeat2 className="h-4 w-4" />
                      <span>Repost</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleShareClick}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <LuShare className="h-4 w-4" />
                      <span>Share</span>
                    </button>
                  </>
                ) : null}
              </div>

              {event.description ? <div className="prose max-w-none text-slate-800" dangerouslySetInnerHTML={{ __html: event.description }} /> : null}
              {event.capacity ? <p className="text-sm text-slate-600">Capacity: {event.capacity}</p> : null}
            </div>
          </section>

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
                      <th className="px-3 py-2 text-left">Amount (CAD)</th>
                      <th className="px-3 py-2 text-left">Capacity</th>
                      <th className="px-3 py-2 text-left">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fees.map((fee) => (
                      <tr key={fee.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-sm font-semibold text-slate-800">{fee.label}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{formatMoney(fee.amountCents)}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          {typeof fee.remainingCount === 'number'
                            ? `${fee.remainingCount} remaining`
                            : typeof fee.capacity === 'number' && fee.capacity > 0
                              ? `${fee.capacity} remaining`
                              : 'Unlimited'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">{fee.cashOnly ? 'Cash only' : 'Online'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {org ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
              <h2 className="text-base font-semibold text-slate-900">Organization</h2>
              <Link href={organizationHref} className="mt-3 block">
                <div className="relative overflow-hidden rounded-xl border border-slate-200 p-3">
                  {org.coverUrl ? <img src={org.coverUrl} alt={`${org.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                  <div className={org.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-slate-50'} />
                  <div className="relative z-[1] flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-full border border-slate-200 bg-white">
                      {org.logoUrl ? <img src={org.logoUrl} alt={org.name} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <p className={org.coverUrl ? 'truncate text-sm font-semibold text-white' : 'truncate text-sm font-semibold text-slate-900'}>{org.name}</p>
                      <p className={org.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>
                        /{resolvedProvince}/{resolvedMunicipality}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            </section>
          ) : null}

          {guestSpeakerCards.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
              <h2 className="text-base font-semibold text-slate-900">Guest speakers</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {guestSpeakerCards.map((speaker) => {
                  const href = `/u/${encodeURIComponent(speaker.handle)}`
                  return (
                    <Link key={speaker.userId} href={href} className="block">
                      <div className="relative overflow-hidden rounded-xl border border-slate-200 p-3">
                        {speaker.coverUrl ? <img src={speaker.coverUrl} alt={`${speaker.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                        <div className={speaker.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-slate-50'} />
                        <div className="relative z-[1] flex items-center gap-3">
                          <div className="h-12 w-12 overflow-hidden rounded-full border border-slate-200 bg-white">
                            {speaker.avatarUrl ? <img src={speaker.avatarUrl} alt={speaker.name} className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0">
                            <p className={speaker.coverUrl ? 'truncate text-sm font-semibold text-white' : 'truncate text-sm font-semibold text-slate-900'}>{speaker.name}</p>
                            <p className={speaker.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>@{speaker.handle}</p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ) : event.guestSpeakers.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
              <h2 className="text-base font-semibold text-slate-900">Guest speakers</h2>
              <p className="mt-2 text-sm text-slate-600">{event.guestSpeakers.join(', ')}</p>
            </section>
          ) : null}

          {sponsorCards.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
              <h2 className="text-base font-semibold text-slate-900">Sponsors</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {sponsorCards.map((sponsor) => {
                  const href = `/com/${encodeURIComponent(sponsor.provinceCode)}/${encodeURIComponent(sponsor.communitySlug)}/orgs/${encodeURIComponent(sponsor.slug)}`
                  return (
                    <Link key={sponsor.organizationId} href={href} className="block">
                      <div className="relative overflow-hidden rounded-xl border border-slate-200 p-3">
                        {sponsor.coverUrl ? <img src={sponsor.coverUrl} alt={`${sponsor.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                        <div className={sponsor.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-slate-50'} />
                        <div className="relative z-[1] flex items-center gap-3">
                          <div className="h-12 w-12 overflow-hidden rounded-full border border-slate-200 bg-white">
                            {sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0">
                            <p className={sponsor.coverUrl ? 'truncate text-sm font-semibold text-white' : 'truncate text-sm font-semibold text-slate-900'}>{sponsor.name}</p>
                            <p className={sponsor.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>
                              /{sponsor.provinceCode.toLowerCase()}/{sponsor.communitySlug}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ) : null}

          {event.galleryPhotoUrls?.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
              <h2 className="text-base font-semibold text-slate-900">Gallery</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {event.galleryPhotoUrls.map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    onClick={() => setActiveGalleryIndex(index)}
                    className="overflow-hidden rounded-xl border border-slate-200"
                  >
                    {isVideoMedia(url) ? (
                      <video src={url} className="aspect-video w-full object-cover" muted playsInline />
                    ) : (
                      <img src={url} alt="Event gallery" className="aspect-video w-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

        </>
      ) : null}

      {repostModalOpen && eventShareTarget ? (
        <SharePostModal
          target={eventShareTarget}
          communityOptions={shareCommunityOptions}
          onClose={() => setRepostModalOpen(false)}
        />
      ) : null}

      {shareModalOpen && eventShareTarget ? (
        <ShareSendModal
          target={eventShareTarget}
          onClose={() => setShareModalOpen(false)}
        />
      ) : null}

      {activeGalleryItem && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm" onClick={() => setActiveGalleryIndex(null)}>
              <button
                type="button"
                onClick={() => setActiveGalleryIndex(null)}
                className="absolute right-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
              >
                Close
              </button>

              {event?.galleryPhotoUrls.length && event.galleryPhotoUrls.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={(evt) => {
                      evt.stopPropagation()
                      moveGallery('prev')
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={(evt) => {
                      evt.stopPropagation()
                      moveGallery('next')
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                  >
                    →
                  </button>
                </>
              ) : null}

              <div
                className="max-h-full max-w-full"
                onClick={(evt) => evt.stopPropagation()}
                onTouchStart={(evt) => {
                  const touch = evt.changedTouches[0]
                  if (!touch) return
                  setTouchStart({ x: touch.clientX, y: touch.clientY })
                }}
                onTouchEnd={(evt) => {
                  const start = touchStart
                  const touch = evt.changedTouches[0]
                  if (!start || !touch) return
                  const deltaX = touch.clientX - start.x
                  const deltaY = touch.clientY - start.y
                  if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 80) {
                    moveGallery(deltaX < 0 ? 'next' : 'prev')
                  }
                  setTouchStart(null)
                }}
              >
                {isVideoMedia(activeGalleryItem) ? (
                  <video src={activeGalleryItem} controls autoPlay playsInline className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl" />
                ) : (
                  <img src={activeGalleryItem} alt="Event gallery full view" className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl" />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      {showJoinModal && event && typeof document !== 'undefined'
        ? createPortal(
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
                          <span>{formatMoney(fee.amountCents)}</span>
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
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
