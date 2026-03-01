'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  primaryPhotoUrl: string | null
  galleryPhotoUrls: string[]
  status: 'DRAFT' | 'PUBLISHED'
  createdAt: string
  updatedAt: string
}

type NewEventForm = {
  title: string
  description: string
  category: EventCategory
  startsAtLocal: string
  endsAtLocal: string
  access: 'PUBLIC' | 'RESTRICTED'
  paid: boolean
  priceCents: string
  capacity: string
  currency: string
  guestSpeakers: string
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
  priceCents: '',
  capacity: '',
  currency: 'CAD',
  guestSpeakers: '',
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

function normalizeRichText(value: string | null | undefined): string {
  const source = (value ?? '').trim()
  if (!source) return ''
  const textOnly = source.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim()
  return textOnly ? source : ''
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
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [draft, setDraft] = useState<GovernanceEvent | null>(null)
  const [form, setForm] = useState<NewEventForm>(INITIAL_FORM)
  const [primaryPhotoUrl, setPrimaryPhotoUrl] = useState<string>('')
  const [galleryPhotoUrls, setGalleryPhotoUrls] = useState<string[]>([])

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

        const { json } = await parseApiResponse<{ event?: GovernanceEvent; error?: unknown }>(res)
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
          startsAtLocal: event.startsAt ? new Date(event.startsAt).toISOString().slice(0, 16) : prev.startsAtLocal,
          endsAtLocal: event.endsAt ? new Date(event.endsAt).toISOString().slice(0, 16) : '',
          paid: event.paid,
          priceCents: event.priceCents != null ? String(event.priceCents) : '',
          capacity: event.capacity != null ? String(event.capacity) : '',
          currency: event.currency || 'CAD',
          guestSpeakers: (event.guestSpeakers ?? []).join(', '),
        }))
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
        startsAtLocal: event.startsAt ? new Date(event.startsAt).toISOString().slice(0, 16) : prev.startsAtLocal,
        endsAtLocal: event.endsAt ? new Date(event.endsAt).toISOString().slice(0, 16) : '',
        paid: event.paid,
        priceCents: event.priceCents != null ? String(event.priceCents) : '',
        capacity: event.capacity != null ? String(event.capacity) : '',
        currency: event.currency || 'CAD',
        guestSpeakers: (event.guestSpeakers ?? []).join(', '),
      }))
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
    if (eventId) {
      void fetchEvent(eventId)
      return
    }
    void createDraft()
  }, [createDraft, eventId, fetchEvent])

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

    const parsedPrice = form.priceCents.trim() ? Number(form.priceCents) : null
    if (form.paid && (!Number.isFinite(parsedPrice) || !parsedPrice || parsedPrice <= 0)) {
      pushToast('Paid events require a price in cents.', 'error')
      return
    }

    const guestSpeakers = form.guestSpeakers
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

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
          paid: form.paid,
          priceCents: form.paid ? parsedPrice : null,
          currency: (form.currency || 'CAD').toUpperCase(),
          guestSpeakers,
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
  }, [draft?.id, form, galleryPhotoUrls, orgApiPath, primaryPhotoUrl, token, uploading])

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

    const parsedPrice = form.priceCents.trim() ? Number(form.priceCents) : null
    if (form.paid && (!Number.isFinite(parsedPrice) || !parsedPrice || parsedPrice <= 0)) {
      pushToast('Paid events require a price in cents.', 'error')
      return
    }

    const guestSpeakers = form.guestSpeakers
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

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
          paid: form.paid,
          priceCents: form.paid ? parsedPrice : null,
          currency: (form.currency || 'CAD').toUpperCase(),
          guestSpeakers,
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

      pushToast('Event published.', 'success')
      router.push(editRoute)
      router.refresh()
    } catch {
      pushToast('Unable to publish event.', 'error')
    } finally {
      setSaving(false)
    }
  }, [draft?.id, editRoute, form, galleryPhotoUrls, orgApiPath, primaryPhotoUrl, router, token, uploading])

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
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            Ends at (optional)
            <input
              type="datetime-local"
              value={form.endsAtLocal}
              onChange={(event) => setForm((prev) => ({ ...prev, endsAtLocal: event.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
            <input type="checkbox" checked={form.paid} onChange={(event) => setForm((prev) => ({ ...prev, paid: event.target.checked }))} />
            Paid event
          </label>
          <input
            value={form.priceCents}
            onChange={(event) => setForm((prev) => ({ ...prev, priceCents: event.target.value }))}
            placeholder="Price cents"
            disabled={!form.paid}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
          />
          <input
            value={form.currency}
            onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))}
            placeholder="Currency"
            maxLength={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
          <input
            value={form.capacity}
            onChange={(event) => setForm((prev) => ({ ...prev, capacity: event.target.value }))}
            placeholder="Capacity"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
        </div>

        <input
          value={form.guestSpeakers}
          onChange={(event) => setForm((prev) => ({ ...prev, guestSpeakers: event.target.value }))}
          placeholder="Guest speakers (comma separated)"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
        />
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

      <section className="surface-card flex flex-wrap items-center gap-3 p-4 shadow-subtle">
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={saving || uploading}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={() => void publishDraft()}
          disabled={saving || uploading}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : saving ? 'Publishing…' : 'Publish'}
        </button>
        {uploading ? <p className="text-xs text-slate-500">Finishing image uploads…</p> : null}
      </section>
    </div>
  )
}
