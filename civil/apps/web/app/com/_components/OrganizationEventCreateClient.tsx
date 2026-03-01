'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import RichTextEditor from '../../_components/RichTextEditor'
import { DEFAULT_EVENT_CATEGORY, EVENT_CATEGORIES, type EventCategory } from '../_lib/eventCategories'

type GovernanceEvent = {
  id: string
  title: string
  description: string | null
  category?: EventCategory
  access: 'PUBLIC' | 'RESTRICTED'
  startsAt: string
  endsAt: string | null
  capacity: number | null
  paid: boolean
  priceCents: number | null
  currency: string
  guestSpeakers: string[]
  guestSpeakerInvites?: GuestSpeakerInvitePayload[]
  sponsors?: EventSponsorTag[]
  sponsorInvites?: SponsorInvitePayload[]
  fees?: EventFeePayload[]
  primaryPhotoUrl: string | null
  galleryPhotoUrls: string[]
  status: 'DRAFT' | 'PUBLISHED'
  createdAt: string
  updatedAt: string
}

type InviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED'

type EventFeePayload = {
  id: string
  label: string
  amountCents: number
  capacity: number | null
  cashOnly: boolean
}

type EventRsvpRow = {
  id: string
  eventId: string
  userId: string
  status: 'GOING' | 'INTERESTED' | 'DECLINED'
  ticketType: 'FREE' | 'PAID'
  ticketId: string | null
  ticketLabel: string | null
  amountCents: number | null
  message: string | null
  createdAt: string
  updatedAt: string
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium?: boolean
    isVerified?: boolean
  } | null
}

type GuestSpeakerInvitePayload = {
  userId: string
  name: string
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  status: InviteStatus
}

type SponsorInvitePayload = {
  organizationId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
  status: InviteStatus
}

type NewEventForm = {
  title: string
  description: string
  category: EventCategory
  startsAtLocal: string
  endsAtLocal: string
  access: 'PUBLIC' | 'RESTRICTED'
  paid: boolean
  price: string
  capacity: string
}

type UserSearchResult = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  isPremium: boolean
  isVerified: boolean
}

type SelectedGuestSpeaker = {
  id: string
  name: string
  handle: string | null
  avatarUrl: string | null
  coverUrl: string | null
  status: InviteStatus
}

type OrganizationDirectoryResult = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
}

type EventSponsorTag = {
  organizationId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
}

type SelectedSponsor = EventSponsorTag & {
  status: InviteStatus
}

type EventFeeDraftRow = {
  id: string
  label: string
  amount: string
  capacity: string
}

type MediaUploadInitResponse = {
  assetId: string
  upload?: {
    url?: string
    method?: string
    headers?: Record<string, string>
  }
  proxyPath?: string
}

type MediaAssetStatusResponse = {
  asset?: {
    status?: 'pending' | 'processing' | 'ready' | 'failed'
    variants?: Record<string, { url?: string | null } | null>
    failureReason?: string | null
  }
}

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const PHOTO_MAX_BYTES = 25 * 1024 * 1024

const INITIAL_FORM: NewEventForm = {
  title: '',
  description: '',
  category: DEFAULT_EVENT_CATEGORY,
  startsAtLocal: '',
  endsAtLocal: '',
  access: 'PUBLIC',
  paid: false,
  price: '',
  capacity: '',
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const pickPhotoVariantUrl = (variants?: Record<string, { url?: string | null } | null>) => {
  if (!variants) return null
  const preference = ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md', 'avatar@2x', 'avatar@1x']
  for (const key of preference) {
    const candidate = variants[key]?.url
    if (candidate) return candidate
  }
  const fallback = Object.values(variants).find((variant) => variant?.url)
  return fallback?.url ?? null
}

const readImageDimensions = async (file: File): Promise<{ width: number; height: number } | null> => {
  try {
    const objectUrl = URL.createObjectURL(file)
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
        URL.revokeObjectURL(objectUrl)
      }
      img.onerror = () => {
        resolve(null)
        URL.revokeObjectURL(objectUrl)
      }
      img.src = objectUrl
    })
  } catch {
    return null
  }
}

function toIso(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toLocalDateTimeInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function normalizeRichText(value: string | null | undefined): string {
  const source = (value ?? '').trim()
  if (!source) return ''
  const textOnly = source.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim()
  return textOnly ? source : ''
}

function centsToCadAmountInput(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  return (value / 100).toFixed(2)
}

function cadAmountInputToCents(value: string): number | null {
  const normalized = value.trim().replace(/,/g, '')
  if (!normalized) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function cadAmountInputToCentsAllowZero(value: string): number | null {
  const normalized = value.trim().replace(/,/g, '')
  if (!normalized) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount * 100)
}

function centsToCadDisplay(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '$0.00'
  return `$${(value / 100).toFixed(2)}`
}

function mapFeesToDraftRows(fees: EventFeePayload[] | undefined): EventFeeDraftRow[] {
  if (!Array.isArray(fees) || fees.length === 0) return []
  return fees.map((fee) => ({
    id: fee.id,
    label: fee.label,
    amount: (fee.amountCents / 100).toFixed(2),
    capacity: typeof fee.capacity === 'number' && Number.isFinite(fee.capacity) && fee.capacity > 0 ? String(fee.capacity) : '',
  }))
}

export default function OrganizationEventCreateClient({
  province,
  municipality,
  slug,
  eventId,
}: {
  province: string
  municipality: string
  slug: string
  eventId?: string
}) {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [draft, setDraft] = useState<GovernanceEvent | null>(null)
  const [form, setForm] = useState<NewEventForm>(INITIAL_FORM)
  const [primaryPhotoUrl, setPrimaryPhotoUrl] = useState<string>('')
  const [galleryPhotoUrls, setGalleryPhotoUrls] = useState<string[]>([])
  const [guestSpeakerQuery, setGuestSpeakerQuery] = useState('')
  const [guestSpeakerResults, setGuestSpeakerResults] = useState<UserSearchResult[]>([])
  const [guestSpeakerSearching, setGuestSpeakerSearching] = useState(false)
  const [selectedGuestSpeakers, setSelectedGuestSpeakers] = useState<SelectedGuestSpeaker[]>([])
  const [sponsorQuery, setSponsorQuery] = useState('')
  const [sponsorResults, setSponsorResults] = useState<OrganizationDirectoryResult[]>([])
  const [sponsorSearching, setSponsorSearching] = useState(false)
  const [selectedSponsors, setSelectedSponsors] = useState<SelectedSponsor[]>([])
  const [feeRows, setFeeRows] = useState<EventFeeDraftRow[]>([])
  const [eventRsvps, setEventRsvps] = useState<EventRsvpRow[]>([])
  const [showUnpublishModal, setShowUnpublishModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const bootstrapGuardRef = useRef(false)

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

  const uploadMediaFile = useCallback(
    async (file: File) => {
      if (!token) {
        redirectToAuthModal('login')
        return null
      }

      if (file.size > PHOTO_MAX_BYTES) {
        pushToast('Image must be 25MB or smaller.', 'error')
        return null
      }
      if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast('Please upload JPG, PNG, WebP, AVIF, HEIC, or HEIF images.', 'error')
        return null
      }

      const dimensions = await readImageDimensions(file)

      const initRes = await fetch(buildApiUrl('/media/uploads'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: 'post_image',
          mime: file.type || 'application/octet-stream',
          byteSize: file.size,
          filename: file.name,
        }),
      })

      if (!initRes.ok) {
        pushToast('Unable to start photo upload.', 'error')
        return null
      }

      const initPayload = (await initRes.json().catch(() => null)) as MediaUploadInitResponse | null
      if (!initPayload?.assetId) {
        pushToast('Upload initialization failed.', 'error')
        return null
      }

      let uploaded = false
      const signedUrl = initPayload.upload?.url
      const signedMethod = initPayload.upload?.method || 'PUT'
      const signedHeaders = initPayload.upload?.headers ?? {}

      if (signedUrl) {
        try {
          const directRes = await fetch(signedUrl, {
            method: signedMethod,
            headers: {
              ...signedHeaders,
              'content-type': file.type || 'application/octet-stream',
            },
            body: file,
          })
          uploaded = directRes.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded && initPayload.proxyPath) {
        try {
          const proxyRes = await fetch(buildApiUrl(initPayload.proxyPath), {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': file.type || 'application/octet-stream',
              'x-upload-byte-size': String(file.size),
            },
            body: file,
          })
          uploaded = proxyRes.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded) {
        pushToast('Photo upload failed.', 'error')
        return null
      }

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          assetId: initPayload.assetId,
          width: dimensions?.width,
          height: dimensions?.height,
        }),
      })

      if (!completeRes.ok) {
        pushToast('Could not complete photo upload.', 'error')
        return null
      }

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const pollRes = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(initPayload.assetId)}`), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (pollRes.ok) {
          const pollPayload = (await pollRes.json().catch(() => null)) as MediaAssetStatusResponse | null
          const status = pollPayload?.asset?.status
          if (status === 'ready') {
            const mediaUrl = pickPhotoVariantUrl(pollPayload?.asset?.variants)
            if (mediaUrl) return mediaUrl
            break
          }
          if (status === 'failed') {
            pushToast(pollPayload?.asset?.failureReason || 'Image processing failed.', 'error')
            return null
          }
        }
        await wait(2000)
      }

      pushToast('Image processing is taking longer than expected.', 'error')
      return null
    },
    [token],
  )

  const editRoute = useMemo(() => {
    return `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/events/manage`
  }, [municipality, province, slug])

  const draftEditRoute = useCallback(
    (id: string) => `${editRoute}/${encodeURIComponent(id)}`,
    [editRoute],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem('token')
      setToken(stored && stored.trim() ? stored : null)
    } catch {
      setToken(null)
    } finally {
      setAuthResolved(true)
    }
  }, [])

  const fetchEvent = useCallback(
    async (id: string) => {
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(id)}`), {
          headers: {
            authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })

        const { json } = await parseApiResponse<{ event?: GovernanceEvent; rsvps?: EventRsvpRow[]; error?: unknown }>(res)
        if (!res.ok || !json?.event) {
          const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
          pushToast(rawError ?? 'Unable to load event draft.', 'error')
          setDraft(null)
          return
        }

        const event = json.event

        setDraft(event)
        setForm((prev) => ({
          ...prev,
          title: event.title === 'Untitled event' ? '' : event.title,
          description: event.description ?? '',
          category: event.category ?? DEFAULT_EVENT_CATEGORY,
          access: event.access,
          startsAtLocal: toLocalDateTimeInputValue(event.startsAt) || prev.startsAtLocal,
          endsAtLocal: toLocalDateTimeInputValue(event.endsAt),
          paid: event.paid,
          price: centsToCadAmountInput(event.priceCents),
          capacity: event.capacity != null ? String(event.capacity) : '',
        }))
        setSelectedGuestSpeakers(
          Array.isArray(event.guestSpeakerInvites) && event.guestSpeakerInvites.length > 0
            ? event.guestSpeakerInvites.map((invite) => ({
                id: invite.userId,
                name: invite.name,
                handle: invite.handle ?? null,
                avatarUrl: invite.avatarUrl ?? null,
                coverUrl: invite.coverUrl ?? null,
                status: invite.status ?? 'PENDING',
              }))
            : (event.guestSpeakers ?? []).map((name) => ({
                id: `legacy_${name.toLowerCase().replace(/\s+/g, '_')}`,
                name,
                handle: null,
                avatarUrl: null,
                coverUrl: null,
                status: 'PENDING',
              })),
        )
        setSelectedSponsors(
          Array.isArray(event.sponsorInvites) && event.sponsorInvites.length > 0
            ? event.sponsorInvites.map((invite) => ({
                organizationId: invite.organizationId,
                name: invite.name,
                slug: invite.slug,
                provinceCode: invite.provinceCode,
                communitySlug: invite.communitySlug,
                logoUrl: invite.logoUrl ?? null,
                coverUrl: invite.coverUrl ?? null,
                status: invite.status ?? 'PENDING',
              }))
            : Array.isArray(event.sponsors)
              ? event.sponsors.map((item) => ({ ...item, coverUrl: item.coverUrl ?? null, status: 'PENDING' as InviteStatus }))
              : [],
        )
        setFeeRows(mapFeesToDraftRows(event.fees))
        setEventRsvps(Array.isArray(json.rsvps) ? json.rsvps : [])
        setPrimaryPhotoUrl(event.primaryPhotoUrl ?? '')
        setGalleryPhotoUrls(Array.isArray(event.galleryPhotoUrls) ? event.galleryPhotoUrls : [])
      } catch {
        setDraft(null)
        pushToast('Unable to load event draft.', 'error')
      } finally {
        setLoading(false)
      }
    },
    [orgApiPath, token],
  )

  const createDraft = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/draft`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const { json } = await parseApiResponse<{ event?: GovernanceEvent; error?: unknown }>(res)
      if (!res.ok || !json?.event) {
        const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
        pushToast(rawError ?? 'Unable to start event draft.', 'error')
        setDraft(null)
        return
      }

      const event = json.event

      setDraft(event)
      setForm((prev) => ({
        ...prev,
        title: event.title === 'Untitled event' ? '' : event.title,
        description: event.description ?? '',
        category: event.category ?? DEFAULT_EVENT_CATEGORY,
        access: event.access,
        startsAtLocal: toLocalDateTimeInputValue(event.startsAt) || prev.startsAtLocal,
        endsAtLocal: toLocalDateTimeInputValue(event.endsAt),
        paid: event.paid,
        price: centsToCadAmountInput(event.priceCents),
        capacity: event.capacity != null ? String(event.capacity) : '',
      }))
      setSelectedGuestSpeakers([])
      setSelectedSponsors([])
      setFeeRows(mapFeesToDraftRows(event.fees))
      setEventRsvps([])
      setPrimaryPhotoUrl(event.primaryPhotoUrl ?? '')
      setGalleryPhotoUrls(Array.isArray(event.galleryPhotoUrls) ? event.galleryPhotoUrls : [])

      router.replace(draftEditRoute(event.id))
    } catch {
      setDraft(null)
      pushToast('Unable to start event draft.', 'error')
    } finally {
      setLoading(false)
    }
  }, [draftEditRoute, orgApiPath, router, token])

  useEffect(() => {
    if (!authResolved) return
    if (!token) {
      setLoading(false)
      return
    }
    if (eventId) {
      void fetchEvent(eventId)
      return
    }
    if (bootstrapGuardRef.current) return
    bootstrapGuardRef.current = true
    void createDraft()
  }, [authResolved, createDraft, eventId, fetchEvent, token])

  useEffect(() => {
    if (!token || !authResolved) return
    const q = guestSpeakerQuery.trim()
    if (q.length < 2) {
      setGuestSpeakerResults([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setGuestSpeakerSearching(true)
      try {
        const params = new URLSearchParams({ q, limit: '8' })
        const response = await fetch(buildApiUrl(`/search/users?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          if (!cancelled) setGuestSpeakerResults([])
          return
        }
        const payload = (await response.json().catch(() => null)) as { items?: UserSearchResult[] } | null
        if (cancelled) return
        setGuestSpeakerResults(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        if (!cancelled) setGuestSpeakerResults([])
      } finally {
        if (!cancelled) setGuestSpeakerSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [authResolved, guestSpeakerQuery, token])

  useEffect(() => {
    const q = sponsorQuery.trim()
    if (q.length < 2) {
      setSponsorResults([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSponsorSearching(true)
      try {
        const params = new URLSearchParams({ q, limit: '8' })
        const response = await fetch(buildApiUrl(`/organizations/directory?${params.toString()}`), { cache: 'no-store' })
        if (!response.ok) {
          if (!cancelled) setSponsorResults([])
          return
        }
        const payload = (await response.json().catch(() => null)) as { items?: OrganizationDirectoryResult[] } | null
        if (cancelled) return
        setSponsorResults(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        if (!cancelled) setSponsorResults([])
      } finally {
        if (!cancelled) setSponsorSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sponsorQuery])

  const buildGuestSpeakersPayload = useCallback(
    (speakers: SelectedGuestSpeaker[]) =>
      speakers.map((speaker) => ({
        userId: speaker.id,
        name: speaker.name,
        handle: speaker.handle ?? speaker.name,
        avatarUrl: speaker.avatarUrl ?? null,
        coverUrl: speaker.coverUrl ?? null,
      })),
    [],
  )

  const buildSponsorsPayload = useCallback(
    (sponsors: SelectedSponsor[]) =>
      sponsors.map((sponsor) => ({
        organizationId: sponsor.organizationId,
        name: sponsor.name,
        slug: sponsor.slug,
        provinceCode: sponsor.provinceCode,
        communitySlug: sponsor.communitySlug,
        logoUrl: sponsor.logoUrl ?? null,
        coverUrl: sponsor.coverUrl ?? null,
      })),
    [],
  )

  const buildFeesPayload = useCallback(() => {
    const payload: EventFeePayload[] = []
    for (const row of feeRows) {
      const label = row.label.trim()
      const amountCents = cadAmountInputToCentsAllowZero(row.amount)
      const capacity = row.capacity.trim() ? Number(row.capacity) : null

      if (!label && !row.amount.trim() && !row.capacity.trim()) continue
      if (!label) {
        pushToast('Fee label is required for each fee row.', 'error')
        return null
      }
      if (amountCents === null) {
        pushToast(`Fee amount is invalid for "${label}". Use 0 or greater.`, 'error')
        return null
      }
      if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0)) {
        pushToast(`Capacity is invalid for "${label}".`, 'error')
        return null
      }

      payload.push({
        id: row.id,
        label,
        amountCents,
        capacity: capacity === null ? null : Math.floor(capacity),
        cashOnly: true,
      })
    }
    return payload
  }, [feeRows])

  const addFeeRow = useCallback(() => {
    setFeeRows((prev) => [
      ...prev,
      {
        id: `fee_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
        label: '',
        amount: '0.00',
        capacity: '',
      },
    ])
  }, [])

  const updateFeeRow = useCallback((id: string, patch: Partial<EventFeeDraftRow>) => {
    setFeeRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const removeFeeRow = useCallback((id: string) => {
    setFeeRows((prev) => prev.filter((row) => row.id !== id))
  }, [])

  const persistInviteSelections = useCallback(
    async (nextGuestSpeakers: SelectedGuestSpeaker[], nextSponsors: SelectedSponsor[]) => {
      if (!token) {
        redirectToAuthModal('login')
        return false
      }
      if (!draft?.id) return false

      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(draft.id)}`), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            guestSpeakers: buildGuestSpeakersPayload(nextGuestSpeakers),
            sponsors: buildSponsorsPayload(nextSponsors),
          }),
        })

        const { json } = await parseApiResponse<{ event?: GovernanceEvent; error?: unknown }>(res)
        if (!res.ok || !json?.event) {
          const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
          pushToast(rawError ?? 'Unable to save invitation changes.', 'error')
          return false
        }

        setDraft(json.event)
        return true
      } catch {
        pushToast('Unable to save invitation changes.', 'error')
        return false
      }
    },
    [buildGuestSpeakersPayload, buildSponsorsPayload, draft?.id, orgApiPath, token],
  )

  const addGuestSpeaker = useCallback(async (user: UserSearchResult) => {
    if (selectedGuestSpeakers.some((item) => item.id === user.id)) return
    const display = (user.name || user.handle).trim()
    if (!display) return

    const nextGuestSpeakers: SelectedGuestSpeaker[] = [
      ...selectedGuestSpeakers,
      { id: user.id, name: display, handle: user.handle, avatarUrl: user.avatarUrl, coverUrl: user.coverUrl, status: 'PENDING' },
    ]

    setSelectedGuestSpeakers(nextGuestSpeakers)
    setGuestSpeakerQuery('')
    setGuestSpeakerResults([])

    const persisted = await persistInviteSelections(nextGuestSpeakers, selectedSponsors)
    if (!persisted) {
      setSelectedGuestSpeakers(selectedGuestSpeakers)
      return
    }

    pushToast('Guest speaker invited.', 'success')
  }, [persistInviteSelections, selectedGuestSpeakers, selectedSponsors])

  const removeGuestSpeaker = useCallback(async (speakerId: string) => {
    const nextGuestSpeakers = selectedGuestSpeakers.filter((item) => item.id !== speakerId)
    setSelectedGuestSpeakers(nextGuestSpeakers)

    const persisted = await persistInviteSelections(nextGuestSpeakers, selectedSponsors)
    if (!persisted) {
      setSelectedGuestSpeakers(selectedGuestSpeakers)
    }
  }, [persistInviteSelections, selectedGuestSpeakers, selectedSponsors])

  const addSponsor = useCallback(async (org: OrganizationDirectoryResult) => {
    if (selectedSponsors.some((item) => item.organizationId === org.id)) return

    const nextSponsors: SelectedSponsor[] = [
      ...selectedSponsors,
      {
        organizationId: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: org.logoUrl ?? null,
        coverUrl: org.coverUrl ?? null,
        status: 'PENDING',
      },
    ]

    setSelectedSponsors(nextSponsors)
    setSponsorQuery('')
    setSponsorResults([])

    const persisted = await persistInviteSelections(selectedGuestSpeakers, nextSponsors)
    if (!persisted) {
      setSelectedSponsors(selectedSponsors)
      return
    }

    pushToast('Sponsor invited.', 'success')
  }, [persistInviteSelections, selectedGuestSpeakers, selectedSponsors])

  const removeSponsor = useCallback(async (organizationId: string) => {
    const nextSponsors = selectedSponsors.filter((item) => item.organizationId !== organizationId)
    setSelectedSponsors(nextSponsors)

    const persisted = await persistInviteSelections(selectedGuestSpeakers, nextSponsors)
    if (!persisted) {
      setSelectedSponsors(selectedSponsors)
    }
  }, [persistInviteSelections, selectedGuestSpeakers, selectedSponsors])

  const saveDraft = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!draft?.id) return

    if (uploading) {
      pushToast('Please wait for uploads to finish.', 'error')
      return
    }

    const startsAt = toIso(form.startsAtLocal)
    const endsAt = toIso(form.endsAtLocal)

    const parsedCapacity = form.capacity.trim() ? Number(form.capacity) : null
    if (parsedCapacity !== null && (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0)) {
      pushToast('Capacity must be a positive integer.', 'error')
      return
    }

    const feesPayload = buildFeesPayload()
    if (!feesPayload) return
    const minPaidFee = feesPayload
      .map((fee) => fee.amountCents)
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => a - b)[0] ?? null
    const hasPaidFees = minPaidFee !== null
    const guestSpeakers = buildGuestSpeakersPayload(selectedGuestSpeakers)
    const sponsorsPayload = buildSponsorsPayload(selectedSponsors)

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(draft.id)}`), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: form.title.trim() || 'Untitled event',
          description: normalizeRichText(form.description) || null,
          category: form.category,
          access: form.access,
          startsAt,
          endsAt,
          capacity: parsedCapacity,
          paid: hasPaidFees,
          priceCents: minPaidFee,
          currency: 'CAD',
          fees: feesPayload,
          guestSpeakers,
          sponsors: sponsorsPayload,
          primaryPhotoUrl: primaryPhotoUrl.trim() ? primaryPhotoUrl.trim() : null,
          galleryPhotoUrls,
        }),
      })

      const { json } = await parseApiResponse<{ event?: GovernanceEvent; error?: unknown }>(res)
      if (!res.ok || !json?.event) {
        const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
        pushToast(rawError ?? 'Unable to save draft.', 'error')
        return
      }

      setDraft(json.event)
      pushToast('Draft saved.', 'success')
    } catch {
      pushToast('Unable to save draft.', 'error')
    } finally {
      setSaving(false)
    }
  }, [buildFeesPayload, buildGuestSpeakersPayload, buildSponsorsPayload, draft?.id, form, galleryPhotoUrls, orgApiPath, primaryPhotoUrl, selectedGuestSpeakers, selectedSponsors, token, uploading])

  const publishDraft = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!draft?.id) return

    if (uploading) {
      pushToast('Please wait for uploads to finish.', 'error')
      return
    }

    const startsAt = toIso(form.startsAtLocal)
    if (!form.title.trim() || !startsAt) {
      pushToast('Title and valid start date/time are required.', 'error')
      return
    }

    const endsAt = toIso(form.endsAtLocal)
    const parsedCapacity = form.capacity.trim() ? Number(form.capacity) : null
    if (parsedCapacity !== null && (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0)) {
      pushToast('Capacity must be a positive integer.', 'error')
      return
    }

    const feesPayload = buildFeesPayload()
    if (!feesPayload) return
    const minPaidFee = feesPayload
      .map((fee) => fee.amountCents)
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => a - b)[0] ?? null
    const hasPaidFees = minPaidFee !== null
    const guestSpeakers = buildGuestSpeakersPayload(selectedGuestSpeakers)
    const sponsorsPayload = buildSponsorsPayload(selectedSponsors)

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(draft.id)}/publish`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: normalizeRichText(form.description) || null,
          category: form.category,
          access: form.access,
          startsAt,
          endsAt,
          capacity: parsedCapacity,
          paid: hasPaidFees,
          priceCents: minPaidFee,
          currency: 'CAD',
          fees: feesPayload,
          guestSpeakers,
          sponsors: sponsorsPayload,
          agenda: [],
          attachments: [],
          primaryPhotoUrl: primaryPhotoUrl.trim() ? primaryPhotoUrl.trim() : null,
          galleryPhotoUrls,
        }),
      })

      const { json } = await parseApiResponse<{ event?: GovernanceEvent; error?: unknown }>(res)
      if (!res.ok || !json?.event) {
        const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
        pushToast(rawError ?? 'Unable to publish event.', 'error')
        return
      }

      setDraft(json.event)
      pushToast('Event published.', 'success')
    } catch {
      pushToast('Unable to publish event.', 'error')
    } finally {
      setSaving(false)
    }
  }, [buildFeesPayload, buildGuestSpeakersPayload, buildSponsorsPayload, draft?.id, form, galleryPhotoUrls, orgApiPath, primaryPhotoUrl, selectedGuestSpeakers, selectedSponsors, token, uploading])

  const unpublishEvent = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!draft?.id) return

    setUnpublishing(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(draft.id)}/unpublish`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const { json } = await parseApiResponse<{ event?: GovernanceEvent; error?: unknown }>(res)
      if (!res.ok || !json?.event) {
        const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
        pushToast(rawError ?? 'Unable to unpublish event.', 'error')
        return
      }

      setDraft(json.event)
      setShowUnpublishModal(false)
      pushToast('Event unpublished.', 'success')
    } catch {
      pushToast('Unable to unpublish event.', 'error')
    } finally {
      setUnpublishing(false)
    }
  }, [draft?.id, orgApiPath, token])

  const deleteEvent = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!draft?.id) return

    setDeleting(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(draft.id)}`), {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        const { json } = await parseApiResponse<{ error?: unknown }>(res)
        const rawError = typeof (json as any)?.error === 'string' ? (json as any).error : null
        pushToast(rawError ?? 'Unable to delete event.', 'error')
        return
      }

      setShowDeleteModal(false)
      pushToast('Event deleted.', 'success')
      router.push(editRoute)
      router.refresh()
    } catch {
      pushToast('Unable to delete event.', 'error')
    } finally {
      setDeleting(false)
    }
  }, [draft?.id, editRoute, orgApiPath, router, token])

  if (!authResolved) {
    return <p className="text-sm text-slate-500">Preparing draft…</p>
  }

  if (!token) {
    return (
      <div className="surface-card p-4 shadow-subtle">
        <p className="text-sm text-slate-600">Sign in to create an event.</p>
        <button
          type="button"
          onClick={() => redirectToAuthModal('login')}
          className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Sign in
        </button>
      </div>
    )
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Preparing draft…</p>
  }

  if (!draft) {
    return (
      <div className="surface-card p-4 shadow-subtle">
        <p className="text-sm text-slate-600">Could not start a draft event.</p>
        <button
          type="button"
          onClick={() => void createDraft()}
          className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    )
  }

  const guestPending = selectedGuestSpeakers.filter((speaker) => speaker.status === 'PENDING')
  const guestAccepted = selectedGuestSpeakers.filter((speaker) => speaker.status === 'ACCEPTED')
  const guestDeclined = selectedGuestSpeakers.filter((speaker) => speaker.status === 'DECLINED')

  const sponsorPending = selectedSponsors.filter((sponsor) => sponsor.status === 'PENDING')
  const sponsorAccepted = selectedSponsors.filter((sponsor) => sponsor.status === 'ACCEPTED')
  const sponsorDeclined = selectedSponsors.filter((sponsor) => sponsor.status === 'DECLINED')

  return (
    <div className="space-y-6">
      <section className="surface-card space-y-3 p-4 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Draft details</h3>
          <p className="text-xs text-slate-500">Draft id: {draft.id}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Event title"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
          <select
            value={form.category}
            onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as EventCategory }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          >
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={form.access}
            onChange={(event) => setForm((prev) => ({ ...prev, access: event.target.value as 'PUBLIC' | 'RESTRICTED' }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          >
            <option value="PUBLIC">Public</option>
            <option value="RESTRICTED">Members only</option>
          </select>
        </div>

        <div className="rounded-lg border border-slate-200 p-2">
          <RichTextEditor
            value={form.description}
            onChange={(description) => setForm((prev) => ({ ...prev, description }))}
            placeholder="Describe your event"
            minHeight={180}
            disabled={saving || uploading}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-600">
            Starts at
            <input
              type="datetime-local"
              value={form.startsAtLocal}
              onChange={(event) => setForm((prev) => ({ ...prev, startsAtLocal: event.target.value }))}
              step={900}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            Ends at (optional)
            <input
              type="datetime-local"
              value={form.endsAtLocal}
              onChange={(event) => setForm((prev) => ({ ...prev, endsAtLocal: event.target.value }))}
              step={900}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={form.capacity}
            onChange={(event) => setForm((prev) => ({ ...prev, capacity: event.target.value }))}
            placeholder="Overall event capacity (optional)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
        </div>
      </section>

      <section className="surface-card space-y-3 p-4 shadow-subtle">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Fees</h3>
            <p className="text-xs text-slate-500">Add ticket rows (cash only for now). Use 0 for free tickets.</p>
          </div>
          <button
            type="button"
            onClick={addFeeRow}
            className="rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
          >
            Add fee row
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Fee name</th>
                <th className="px-3 py-2 text-left">Amount (CAD)</th>
                <th className="px-3 py-2 text-left">Capacity</th>
                <th className="px-3 py-2 text-left">Payment</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {feeRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <input
                      value={row.label}
                      onChange={(event) => updateFeeRow(row.id, { label: event.target.value })}
                      placeholder="Door fee"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.amount}
                      onChange={(event) => updateFeeRow(row.id, { amount: event.target.value })}
                      placeholder="0.00"
                      className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.capacity}
                      onChange={(event) => updateFeeRow(row.id, { capacity: event.target.value })}
                      placeholder="Optional"
                      className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600">Cash only</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeFeeRow(row.id)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {feeRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-xs text-slate-500">
                    No fee rows yet. Add one for door fee, sponsor fee, guest speaker fee, VIP line, or keep free by setting amount to 0.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card space-y-3 p-4 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Photos</h3>
          <p className="text-xs text-slate-500">Upload photos to the draft before publishing.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">Primary photo</label>
            {primaryPhotoUrl ? (
              <div className="space-y-2">
                <img src={primaryPhotoUrl} alt="Primary" className="aspect-video w-full rounded-2xl border border-slate-200 object-cover" />
                <button
                  type="button"
                  onClick={() => setPrimaryPhotoUrl('')}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Remove
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void (async () => {
                    setUploading(true)
                    const url = await uploadMediaFile(file)
                    if (url) setPrimaryPhotoUrl(url)
                    setUploading(false)
                  })()
                }}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">Gallery photos</label>
            <input
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              multiple
              disabled={uploading}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (!files.length) return
                void (async () => {
                  setUploading(true)
                  const nextUrls: string[] = []
                  for (const file of files) {
                    if (galleryPhotoUrls.length + nextUrls.length >= 12) break
                    const url = await uploadMediaFile(file)
                    if (url) nextUrls.push(url)
                  }
                  if (nextUrls.length) setGalleryPhotoUrls((prev) => [...prev, ...nextUrls])
                  setUploading(false)
                })()
              }}
              className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />

            {galleryPhotoUrls.length ? (
              <div className="grid grid-cols-3 gap-2">
                {galleryPhotoUrls.map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    onClick={() => setGalleryPhotoUrls((prev) => prev.filter((_, idx) => idx !== index))}
                    className="group relative overflow-hidden rounded-xl border border-slate-200"
                    title="Remove"
                  >
                    <img src={url} alt="Gallery" className="aspect-square w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700 opacity-0 transition-opacity group-hover:opacity-100">
                      Remove
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-[11px] text-slate-500">Up to 12 images.</p>
          </div>
        </div>
      </section>

      <section className="surface-card space-y-3 p-4 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Guest speakers</h3>
          <p className="text-xs text-slate-500">Invite Civil members and track acceptance.</p>
        </div>

        <input
          value={guestSpeakerQuery}
          onChange={(event) => setGuestSpeakerQuery(event.target.value)}
          placeholder="Search Civil members by name"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
        />
        {guestSpeakerSearching ? <p className="text-xs text-slate-500">Searching members…</p> : null}
        {!guestSpeakerSearching && guestSpeakerQuery.trim().length >= 2 && guestSpeakerResults.length === 0 ? <p className="text-xs text-slate-500">No members found.</p> : null}

        {guestSpeakerResults.length > 0 ? (
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
            {guestSpeakerResults.map((user) => (
              <div key={user.id} className="flex max-w-[560px] items-center gap-2">
                <div className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                  {user.coverUrl ? <img src={user.coverUrl} alt={`${user.name || user.handle} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                  <div className={user.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                  <div className="relative z-[1] flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                        {user.avatarUrl ? <img src={user.avatarUrl} alt={`${user.name || user.handle} profile`} className="h-full w-full object-cover" /> : null}
                      </div>
                      <Link
                        href={`/u/${encodeURIComponent(user.handle)}`}
                        className={user.coverUrl ? 'truncate text-sm font-semibold text-white hover:underline' : 'truncate text-sm font-semibold text-slate-700 hover:underline'}
                      >
                        {user.name || user.handle}
                      </Link>
                    </div>
                    <span className={user.coverUrl ? 'text-xs text-white/85' : 'text-xs text-slate-500'}>@{user.handle}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addGuestSpeaker(user)}
                  className="shrink-0 rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  Invite
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {selectedGuestSpeakers.length > 0 ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Awaiting acceptance</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Profile</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guestPending.map((speaker) => (
                      <tr key={speaker.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                            {speaker.coverUrl ? <img src={speaker.coverUrl} alt={`${speaker.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                            <div className={speaker.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                            <div className="relative z-[1] flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">{speaker.avatarUrl ? <img src={speaker.avatarUrl} alt={speaker.name} className="h-full w-full object-cover" /> : null}</div>
                              <div className="min-w-0">
                                {speaker.handle ? (
                                  <Link
                                    href={`/u/${encodeURIComponent(speaker.handle)}`}
                                    className={speaker.coverUrl ? 'truncate font-semibold text-white hover:underline' : 'truncate font-semibold text-slate-800 hover:underline'}
                                  >
                                    {speaker.name}
                                  </Link>
                                ) : (
                                  <p className={speaker.coverUrl ? 'truncate font-semibold text-white' : 'truncate font-semibold text-slate-800'}>{speaker.name}</p>
                                )}
                                <p className={speaker.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>{speaker.handle ? `@${speaker.handle}` : ''}</p>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-600">Awaiting acceptance</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => removeGuestSpeaker(speaker.id)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Remove</button>
                        </td>
                      </tr>
                    ))}
                    {guestPending.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-3 text-xs text-slate-500">No pending speaker invites.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Accepted</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <tbody>
                    {guestAccepted.map((speaker) => (
                      <tr key={speaker.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                            {speaker.coverUrl ? <img src={speaker.coverUrl} alt={`${speaker.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                            <div className={speaker.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                            <div className="relative z-[1] flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">{speaker.avatarUrl ? <img src={speaker.avatarUrl} alt={speaker.name} className="h-full w-full object-cover" /> : null}</div>
                              {speaker.handle ? (
                                <Link
                                  href={`/u/${encodeURIComponent(speaker.handle)}`}
                                  className={speaker.coverUrl ? 'truncate font-semibold text-white hover:underline' : 'truncate font-semibold text-slate-800 hover:underline'}
                                >
                                  {speaker.name}
                                </Link>
                              ) : (
                                <p className={speaker.coverUrl ? 'truncate font-semibold text-white' : 'truncate font-semibold text-slate-800'}>{speaker.name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="w-44 px-3 py-2 text-xs font-semibold text-emerald-700">Accepted</td>
                        <td className="w-28 px-3 py-2 text-right"><button type="button" onClick={() => removeGuestSpeaker(speaker.id)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Remove</button></td>
                      </tr>
                    ))}
                    {guestAccepted.length === 0 ? <tr><td className="px-3 py-3 text-xs text-slate-500">No accepted speaker invites yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Declined</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <tbody>
                    {guestDeclined.map((speaker) => (
                      <tr key={speaker.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                            {speaker.coverUrl ? <img src={speaker.coverUrl} alt={`${speaker.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                            <div className={speaker.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                            <div className="relative z-[1] flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">{speaker.avatarUrl ? <img src={speaker.avatarUrl} alt={speaker.name} className="h-full w-full object-cover" /> : null}</div>
                              {speaker.handle ? (
                                <Link
                                  href={`/u/${encodeURIComponent(speaker.handle)}`}
                                  className={speaker.coverUrl ? 'truncate font-semibold text-white hover:underline' : 'truncate font-semibold text-slate-800 hover:underline'}
                                >
                                  {speaker.name}
                                </Link>
                              ) : (
                                <p className={speaker.coverUrl ? 'truncate font-semibold text-white' : 'truncate font-semibold text-slate-800'}>{speaker.name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="w-44 px-3 py-2 text-xs font-semibold text-rose-700">Declined</td>
                        <td className="w-28 px-3 py-2 text-right"><button type="button" onClick={() => removeGuestSpeaker(speaker.id)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Remove</button></td>
                      </tr>
                    ))}
                    {guestDeclined.length === 0 ? <tr><td className="px-3 py-3 text-xs text-slate-500">No declined speaker invites.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="surface-card space-y-3 p-4 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Sponsors</h3>
          <p className="text-xs text-slate-500">Tag organizations and track sponsor acceptance.</p>
        </div>

        <input
          value={sponsorQuery}
          onChange={(event) => setSponsorQuery(event.target.value)}
          placeholder="Search Civil organizations to tag"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
        />
        {sponsorSearching ? <p className="text-xs text-slate-500">Searching organizations…</p> : null}
        {!sponsorSearching && sponsorQuery.trim().length >= 2 && sponsorResults.length === 0 ? <p className="text-xs text-slate-500">No organizations found.</p> : null}

        {sponsorResults.length > 0 ? (
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
            {sponsorResults.map((org) => (
              <div key={org.id} className="flex max-w-[560px] items-center gap-2">
                <div className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                  {org.coverUrl ? <img src={org.coverUrl} alt={`${org.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                  <div className={org.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                  <div className="relative z-[1] flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                        {org.logoUrl ? <img src={org.logoUrl} alt={`${org.name} profile`} className="h-full w-full object-cover" /> : null}
                      </div>
                      <Link
                        href={`/com/${encodeURIComponent(org.provinceCode)}/${encodeURIComponent(org.communitySlug)}/orgs/${encodeURIComponent(org.slug)}`}
                        className={org.coverUrl ? 'truncate text-sm font-semibold text-white hover:underline' : 'truncate text-sm font-semibold text-slate-700 hover:underline'}
                      >
                        {org.name}
                      </Link>
                    </div>
                    <span className={org.coverUrl ? 'text-xs text-white/85' : 'text-xs text-slate-500'}>/{org.provinceCode.toLowerCase()}/{org.communitySlug}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addSponsor(org)}
                  className="shrink-0 rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  Invite
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {selectedSponsors.length > 0 ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Awaiting acceptance</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Organization</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsorPending.map((sponsor) => (
                      <tr key={sponsor.organizationId} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                            {sponsor.coverUrl ? <img src={sponsor.coverUrl} alt={`${sponsor.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                            <div className={sponsor.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                            <div className="relative z-[1] flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} className="h-full w-full object-cover" /> : null}</div>
                              <div className="min-w-0">
                                <Link
                                  href={`/com/${encodeURIComponent(sponsor.provinceCode)}/${encodeURIComponent(sponsor.communitySlug)}/orgs/${encodeURIComponent(sponsor.slug)}`}
                                  className={sponsor.coverUrl ? 'truncate font-semibold text-white hover:underline' : 'truncate font-semibold text-slate-800 hover:underline'}
                                >
                                  {sponsor.name}
                                </Link>
                                <p className={sponsor.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>/{sponsor.provinceCode.toLowerCase()}/{sponsor.communitySlug}</p>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-600">Awaiting acceptance</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => removeSponsor(sponsor.organizationId)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Remove</button>
                        </td>
                      </tr>
                    ))}
                    {sponsorPending.length === 0 ? <tr><td colSpan={3} className="px-3 py-3 text-xs text-slate-500">No pending sponsor invites.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Accepted</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <tbody>
                    {sponsorAccepted.map((sponsor) => (
                      <tr key={sponsor.organizationId} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                            {sponsor.coverUrl ? <img src={sponsor.coverUrl} alt={`${sponsor.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                            <div className={sponsor.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                            <div className="relative z-[1] flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} className="h-full w-full object-cover" /> : null}</div>
                              <Link
                                href={`/com/${encodeURIComponent(sponsor.provinceCode)}/${encodeURIComponent(sponsor.communitySlug)}/orgs/${encodeURIComponent(sponsor.slug)}`}
                                className={sponsor.coverUrl ? 'truncate font-semibold text-white hover:underline' : 'truncate font-semibold text-slate-800 hover:underline'}
                              >
                                {sponsor.name}
                              </Link>
                            </div>
                          </div>
                        </td>
                        <td className="w-44 px-3 py-2 text-xs font-semibold text-emerald-700">Accepted</td>
                        <td className="w-28 px-3 py-2 text-right"><button type="button" onClick={() => removeSponsor(sponsor.organizationId)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Remove</button></td>
                      </tr>
                    ))}
                    {sponsorAccepted.length === 0 ? <tr><td className="px-3 py-3 text-xs text-slate-500">No accepted sponsor invites yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Declined</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <tbody>
                    {sponsorDeclined.map((sponsor) => (
                      <tr key={sponsor.organizationId} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                            {sponsor.coverUrl ? <img src={sponsor.coverUrl} alt={`${sponsor.name} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                            <div className={sponsor.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                            <div className="relative z-[1] flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} className="h-full w-full object-cover" /> : null}</div>
                              <Link
                                href={`/com/${encodeURIComponent(sponsor.provinceCode)}/${encodeURIComponent(sponsor.communitySlug)}/orgs/${encodeURIComponent(sponsor.slug)}`}
                                className={sponsor.coverUrl ? 'truncate font-semibold text-white hover:underline' : 'truncate font-semibold text-slate-800 hover:underline'}
                              >
                                {sponsor.name}
                              </Link>
                            </div>
                          </div>
                        </td>
                        <td className="w-44 px-3 py-2 text-xs font-semibold text-rose-700">Declined</td>
                        <td className="w-28 px-3 py-2 text-right"><button type="button" onClick={() => removeSponsor(sponsor.organizationId)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Remove</button></td>
                      </tr>
                    ))}
                    {sponsorDeclined.length === 0 ? <tr><td className="px-3 py-3 text-xs text-slate-500">No declined sponsor invites.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="surface-card space-y-3 p-4 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">RSVPs</h3>
          <p className="text-xs text-slate-500">Track who joined, their selected ticket type, and organizer message.</p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Ticket</th>
                <th className="px-3 py-2 text-left">Amount</th>
                <th className="px-3 py-2 text-left">Message</th>
              </tr>
            </thead>
            <tbody>
              {eventRsvps.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    {row.user?.handle ? (
                      <Link href={`/u/${encodeURIComponent(row.user.handle)}`} className="block">
                        <div className="relative overflow-hidden rounded-md border border-slate-200 px-2 py-1.5">
                          {row.user.coverUrl ? <img src={row.user.coverUrl} alt={`${row.user.name || row.user.handle} cover`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                          <div className={row.user.coverUrl ? 'absolute inset-0 bg-slate-900/45' : 'absolute inset-0 bg-transparent'} />
                          <div className="relative z-[1] flex min-w-0 items-center gap-2">
                            <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                              {row.user.avatarUrl ? <img src={row.user.avatarUrl} alt={row.user.name || row.user.handle} className="h-full w-full object-cover" /> : null}
                            </div>
                            <div className="min-w-0">
                              <p className={row.user.coverUrl ? 'truncate font-semibold text-white' : 'truncate font-semibold text-slate-800'}>{row.user.name || row.user.handle}</p>
                              <p className={row.user.coverUrl ? 'truncate text-xs text-white/85' : 'truncate text-xs text-slate-500'}>@{row.user.handle}</p>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ) : (
                      <p className="text-xs text-slate-500">Unknown user</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-700">{row.status}</td>
                  <td className="px-3 py-2 text-xs text-slate-700">{row.ticketLabel || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-700">{centsToCadDisplay(row.amountCents)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700">{row.message?.trim() || '—'}</td>
                </tr>
              ))}
              {eventRsvps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-xs text-slate-500">
                    No RSVPs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card flex flex-wrap items-center gap-3 p-4 shadow-subtle">
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={saving || uploading || deleting || unpublishing}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {saving ? 'Saving…' : draft.status === 'PUBLISHED' ? 'Save' : 'Save draft'}
        </button>
        {draft.status === 'PUBLISHED' ? (
          <button
            type="button"
            onClick={() => setShowUnpublishModal(true)}
            disabled={saving || uploading || deleting || unpublishing}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Unpublish
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void publishDraft()}
            disabled={saving || uploading || deleting || unpublishing}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : saving ? 'Publishing…' : 'Publish'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          disabled={saving || uploading || deleting || unpublishing}
          className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        >
          Delete
        </button>
        {uploading ? <p className="text-xs text-slate-500">Finishing image uploads…</p> : null}
      </section>

      {showUnpublishModal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => setShowUnpublishModal(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h4 className="text-base font-semibold text-slate-900">Unpublish event?</h4>
            <p className="mt-2 text-sm text-slate-600">
              New users will no longer be able to see this event, but existing users will still see it unless you delete the event.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowUnpublishModal(false)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void unpublishEvent()}
                disabled={unpublishing}
                className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {unpublishing ? 'Unpublishing…' : 'Confirm unpublish'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteModal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => setShowDeleteModal(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h4 className="text-base font-semibold text-slate-900">Delete event?</h4>
            <p className="mt-2 text-sm text-slate-600">This will permanently remove the event and all RSVP records for it.</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteEvent()}
                disabled={deleting}
                className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete event'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
