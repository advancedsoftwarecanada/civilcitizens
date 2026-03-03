'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import DashboardShell from '../../../_components/DashboardShell'
import Modal from '../../../_components/Modal'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import MarketRightRail from '../../_components/MarketRightRail'

type ListingDetail = {
  id: string
  title: string
  description: string | null
  priceCents: number
  currency: string
  photoUrls: string[]
  listingProvinceCode?: string | null
  listingCommunitySlug?: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupAddressLine1: string | null
  pickupAddressLine2: string | null
  pickupPostalCode: string | null
  paymentTypes: string[]
  willingToDeliver: boolean
  deliveryOptions?: {
    short50km?: number
    medium100km?: number
    long250km?: number
  } | null
  eTransferEmail: string | null
  status: string
  isDraft: boolean
}

type ListingResponse = {
  listing?: ListingDetail
}

type ProfileAddressResponse = {
  user?: {
    billingAddress1?: string | null
    billingAddress2?: string | null
    billingCity?: string | null
    billingState?: string | null
    billingPostalCode?: string | null
    billingCountry?: string | null
  }
}

type DraftForm = {
  title: string
  description: string
  price: string
  listingProvinceCode: string
  listingCommunitySlug: string
  pickupCity: string
  pickupProvince: string
  pickupAddressLine1: string
  pickupAddressLine2: string
  pickupPostalCode: string
  willingToDeliver: boolean
  deliverySelection: {
    short50km: boolean
    medium100km: boolean
    long250km: boolean
  }
  deliveryPrices: {
    short50km: string
    medium100km: string
    long250km: string
  }
  eTransferEmail: string
  paymentTypes: Array<'cash_pickup' | 'etransfer'>
  photoUrls: string[]
}

const EMPTY_FORM: DraftForm = {
  title: 'Draft Listing',
  description: '',
  price: '0.00',
  listingProvinceCode: '',
  listingCommunitySlug: '',
  pickupCity: '',
  pickupProvince: '',
  pickupAddressLine1: '',
  pickupAddressLine2: '',
  pickupPostalCode: '',
  willingToDeliver: false,
  deliverySelection: {
    short50km: false,
    medium100km: false,
    long250km: false,
  },
  deliveryPrices: {
    short50km: '0.00',
    medium100km: '0.00',
    long250km: '0.00',
  },
  eTransferEmail: '',
  paymentTypes: ['cash_pickup'],
  photoUrls: [],
}

type CommunityFollowOption = {
  provinceCode: string
  communitySlug: string
  label: string
  home: boolean
}

type CommunityFollowsResponse = {
  items?: Array<{
    province?: string
    communitySlug?: string
    home?: boolean
    community?: {
      name?: string
      cityName?: string
      communityName?: string
      slug?: string
    } | null
  }>
}

const DELIVERY_RANGES: Array<{ key: 'short50km' | 'medium100km' | 'long250km'; label: string; distance: string }> = [
  { key: 'short50km', label: 'Short', distance: '50km' },
  { key: 'medium100km', label: 'Medium', distance: '100km' },
  { key: 'long250km', label: 'Long', distance: '250km' },
]

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const PHOTO_MAX_BYTES = 25 * 1024 * 1024

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

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function formatMoneyInput(cents: number) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2)
}

function toCents(value: string) {
  const normalized = String(value || '').replace(/[^0-9.]/g, '')
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.round(parsed * 100))
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

export default function MarketNewListingPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const listingParam = searchParams.get('listing')

  const [listingId, setListingId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM)
  const [statusLabel, setStatusLabel] = useState<'draft' | 'active'>('draft')
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [communityOptions, setCommunityOptions] = useState<CommunityFollowOption[]>([])

  const loadListing = useCallback(async (id: string) => {
    const res = await fetch(buildApiUrl(`/market/listings/${encodeURIComponent(id)}`), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('listing_load_failed')
    const payload = (await res.json().catch(() => null)) as ListingResponse | null
    const listing = payload?.listing
    if (!listing) throw new Error('listing_not_found')

    const deliveryOptions = listing.deliveryOptions ?? {}
    const hasShort = typeof deliveryOptions.short50km === 'number'
    const hasMedium = typeof deliveryOptions.medium100km === 'number'
    const hasLong = typeof deliveryOptions.long250km === 'number'

    setListingId(listing.id)
    setForm({
      title: listing.title || 'Draft Listing',
      description: listing.description ?? '',
      price: formatMoneyInput(listing.priceCents),
      listingProvinceCode: listing.listingProvinceCode ?? '',
      listingCommunitySlug: listing.listingCommunitySlug ?? '',
      pickupCity: listing.pickupCity ?? '',
      pickupProvince: listing.pickupProvince ?? '',
      pickupAddressLine1: listing.pickupAddressLine1 ?? '',
      pickupAddressLine2: listing.pickupAddressLine2 ?? '',
      pickupPostalCode: listing.pickupPostalCode ?? '',
      willingToDeliver: Boolean(listing.willingToDeliver),
      deliverySelection: {
        short50km: hasShort,
        medium100km: hasMedium,
        long250km: hasLong,
      },
      deliveryPrices: {
        short50km: formatMoneyInput(hasShort ? Number(deliveryOptions.short50km) || 0 : 0),
        medium100km: formatMoneyInput(hasMedium ? Number(deliveryOptions.medium100km) || 0 : 0),
        long250km: formatMoneyInput(hasLong ? Number(deliveryOptions.long250km) || 0 : 0),
      },
      eTransferEmail: listing.eTransferEmail ?? '',
      paymentTypes: (Array.isArray(listing.paymentTypes) ? listing.paymentTypes : []).filter(
        (entry): entry is 'cash_pickup' | 'etransfer' => entry === 'cash_pickup' || entry === 'etransfer',
      ),
      photoUrls: Array.isArray(listing.photoUrls) ? listing.photoUrls : [],
    })
    setStatusLabel(listing.status === 'active' || !listing.isDraft ? 'active' : 'draft')
  }, [])

  const loadCommunityOptions = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl('/communities/follows'), {
        headers: getAuthHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) return
      const payload = (await res.json().catch(() => null)) as CommunityFollowsResponse | null
      const items = Array.isArray(payload?.items) ? payload.items : []
      const options = items
        .map((item) => {
          const provinceCode = String(item?.province ?? '').trim().toUpperCase()
          const communitySlug = String(item?.communitySlug ?? '').trim().toLowerCase()
          if (!provinceCode || !communitySlug) return null
          const community = item?.community
          const rawName =
            (typeof community?.name === 'string' && community.name.trim()) ||
            (typeof community?.cityName === 'string' && community.cityName.trim()) ||
            (typeof community?.communityName === 'string' && community.communityName.trim()) ||
            communitySlug
          return {
            provinceCode,
            communitySlug,
            label: `${rawName} (${provinceCode})${item?.home ? ' • Home' : ''}`,
            home: Boolean(item?.home),
          } satisfies CommunityFollowOption
        })
        .filter((entry): entry is CommunityFollowOption => Boolean(entry))

      setCommunityOptions(options)

      if (options.length) {
        const preferred = options.find((entry) => entry.home) ?? options[0]
        if (preferred) {
          setForm((prev) => {
            if (prev.listingProvinceCode && prev.listingCommunitySlug) return prev
            return {
              ...prev,
              listingProvinceCode: preferred.provinceCode,
              listingCommunitySlug: preferred.communitySlug,
            }
          })
        }
      }
    } catch {
      // best effort
    }
  }, [])

  const createDraft = useCallback(async () => {
    const res = await fetch(buildApiUrl('/market/listings/draft'), {
      method: 'POST',
      headers: getAuthHeaders(),
    })
    if (!res.ok) throw new Error('draft_create_failed')
    const payload = (await res.json().catch(() => null)) as { listing?: { id?: string } } | null
    const id = payload?.listing?.id
    if (!id) throw new Error('draft_create_failed')
    setListingId(id)
    router.replace(`/market/listings/new?listing=${encodeURIComponent(id)}`)
    await loadListing(id)
  }, [loadListing, router])

  const tryAutofillAddress = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl('/profile'), {
        headers: getAuthHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) return
      const payload = (await res.json().catch(() => null)) as ProfileAddressResponse | null
      const user = payload?.user
      if (!user) return

      setForm((prev) => {
        const hasAddress = Boolean(prev.pickupAddressLine1.trim() || prev.pickupCity.trim() || prev.pickupProvince.trim() || prev.pickupPostalCode.trim())
        if (hasAddress) return prev

        return {
          ...prev,
          pickupAddressLine1: typeof user.billingAddress1 === 'string' ? user.billingAddress1 : prev.pickupAddressLine1,
          pickupAddressLine2: typeof user.billingAddress2 === 'string' ? user.billingAddress2 : prev.pickupAddressLine2,
          pickupCity: typeof user.billingCity === 'string' ? user.billingCity : prev.pickupCity,
          pickupProvince: typeof user.billingState === 'string' ? user.billingState : prev.pickupProvince,
          pickupPostalCode: typeof user.billingPostalCode === 'string' ? user.billingPostalCode : prev.pickupPostalCode,
        }
      })
    } catch {
      // silent best-effort autofill
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setInitializing(true)
      try {
        if (listingParam && listingParam.trim()) {
          await loadListing(listingParam.trim())
          await tryAutofillAddress()
        } else {
          await createDraft()
          await tryAutofillAddress()
        }
      } catch {
        if (!cancelled) pushToast('Unable to initialize listing draft.', 'error')
      } finally {
        if (!cancelled) setInitializing(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [createDraft, listingParam, loadListing])

  useEffect(() => {
    void loadCommunityOptions()
  }, [loadCommunityOptions])

  const togglePaymentType = useCallback((type: 'cash_pickup' | 'etransfer') => {
    setForm((prev) => {
      const exists = prev.paymentTypes.includes(type)
      if (exists) {
        const next = prev.paymentTypes.filter((entry) => entry !== type)
        return { ...prev, paymentTypes: next.length ? next : ['cash_pickup'] }
      }
      return { ...prev, paymentTypes: [...prev.paymentTypes, type] }
    })
  }, [])

  const uploadMediaFile = useCallback(async (file: File) => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      pushToast('Sign in required for uploads.', 'error')
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
  }, [])

  const handlePhotoUpload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setUploadingPhotos(true)
      try {
        const current = [...form.photoUrls]
        for (const file of Array.from(files)) {
          if (current.length >= 12) break
          const mediaUrl = await uploadMediaFile(file)
          if (!mediaUrl) continue
          current.push(mediaUrl)
        }

        const deduped = Array.from(new Set(current)).slice(0, 12)
        setForm((prev) => ({ ...prev, photoUrls: deduped }))
      } finally {
        setUploadingPhotos(false)
      }
    },
    [form.photoUrls, uploadMediaFile],
  )

  const saveListing = useCallback(
    async (mode: 'save' | 'publish' | 'unpublish') => {
      if (!listingId) return

      const publish = mode === 'publish'
      const unpublish = mode === 'unpublish'

      const priceCents = toCents(form.price)
      if (publish) {
        if (!form.title.trim()) {
          pushToast('Title is required.', 'error')
          return
        }
        if (priceCents <= 0) {
          pushToast('Price must be greater than zero.', 'error')
          return
        }
        if (!form.pickupCity.trim()) {
          pushToast('Pickup city is required.', 'error')
          return
        }
        if (!form.paymentTypes.length) {
          pushToast('Select at least one payment type.', 'error')
          return
        }
        if (!form.listingProvinceCode.trim() || !form.listingCommunitySlug.trim()) {
          pushToast('Select a community to list in.', 'error')
          return
        }
        if (form.willingToDeliver) {
          const hasDeliveryRange = Object.values(form.deliverySelection).some(Boolean)
          if (!hasDeliveryRange) {
            pushToast('Select at least one delivery range.', 'error')
            return
          }
        }
      }

      const deliveryOptions: { short50km?: number; medium100km?: number; long250km?: number } = {}
      if (form.willingToDeliver) {
        if (form.deliverySelection.short50km) deliveryOptions.short50km = toCents(form.deliveryPrices.short50km)
        if (form.deliverySelection.medium100km) deliveryOptions.medium100km = toCents(form.deliveryPrices.medium100km)
        if (form.deliverySelection.long250km) deliveryOptions.long250km = toCents(form.deliveryPrices.long250km)
      }

      setSaving(true)
      try {
        const nextStatus: 'draft' | 'active' = publish ? 'active' : unpublish ? 'draft' : statusLabel
        const nextIsDraft = nextStatus !== 'active'

        const res = await fetch(buildApiUrl(`/market/listings/${encodeURIComponent(listingId)}`), {
          method: 'PUT',
          headers: getAuthHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            title: form.title.trim() || 'Draft Listing',
            description: form.description.trim() || null,
            priceCents,
            currency: 'CAD',
            photoUrls: form.photoUrls,
            listingProvinceCode: form.listingProvinceCode.trim().toUpperCase() || null,
            listingCommunitySlug: form.listingCommunitySlug.trim().toLowerCase() || null,
            pickupCity: form.pickupCity.trim() || null,
            pickupProvince: form.pickupProvince.trim() || null,
            pickupAddressLine1: form.pickupAddressLine1.trim() || null,
            pickupAddressLine2: form.pickupAddressLine2.trim() || null,
            pickupPostalCode: form.pickupPostalCode.trim() || null,
            paymentTypes: form.paymentTypes,
            willingToDeliver: form.willingToDeliver,
            deliveryOptions,
            eTransferEmail: form.eTransferEmail.trim() || null,
            isDraft: nextIsDraft,
            status: nextStatus,
          }),
        })

        if (!res.ok) {
          pushToast('Unable to save listing right now.', 'error')
          return
        }

        setStatusLabel(nextStatus)
        pushToast(publish ? 'Listing is now active.' : unpublish ? 'Listing is now unpublished.' : 'Saved.', 'success')
      } catch {
        pushToast('Unable to save listing right now.', 'error')
      } finally {
        setSaving(false)
      }
    },
    [form, listingId, statusLabel],
  )

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Create Listing</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Status: {statusLabel === 'active' ? 'Active' : 'Draft'}
              </span>
              <Link href="/market/listings" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                View all listings
              </Link>
            </div>
          </div>
        </section>

        {initializing ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Preparing listing draft…</div> : null}

        {!initializing ? (
          <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title</span>
                <input
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none"
                  placeholder="What are you selling?"
                  maxLength={140}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price (CAD)</span>
                <input
                  value={form.price}
                  onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none"
                  placeholder="0.00"
                />
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="min-h-[140px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none"
                placeholder="Condition, details, pickup expectations, and anything buyers should know."
                maxLength={4000}
              />
            </label>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Community</p>
              <p className="mt-1 text-xs text-slate-600">Choose the community this listing belongs to.</p>
              <label className="mt-3 block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">List in community</span>
                <select
                  value={form.listingProvinceCode && form.listingCommunitySlug ? `${form.listingProvinceCode}|${form.listingCommunitySlug}` : ''}
                  onChange={(event) => {
                    const value = event.target.value
                    if (!value) {
                      setForm((prev) => ({ ...prev, listingProvinceCode: '', listingCommunitySlug: '' }))
                      return
                    }
                    const [provinceCode, communitySlug] = value.split('|')
                    setForm((prev) => ({
                      ...prev,
                      listingProvinceCode: provinceCode ?? '',
                      listingCommunitySlug: communitySlug ?? '',
                    }))
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Select community…</option>
                  {communityOptions.map((option) => (
                    <option key={`${option.provinceCode}|${option.communitySlug}`} value={`${option.provinceCode}|${option.communitySlug}`}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {!communityOptions.length ? (
                <p className="mt-2 text-xs text-amber-700">Follow or set a home community first to publish listings into market feed scope.</p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Photos</p>
              <p className="mt-1 text-xs text-slate-600">Upload up to 12 photos.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  {uploadingPhotos ? 'Uploading…' : 'Upload photos'}
                  <input
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    multiple
                    className="hidden"
                    disabled={uploadingPhotos}
                    onChange={(event) => {
                      void handlePhotoUpload(event.target.files)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
              {form.photoUrls.length ? (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {form.photoUrls.map((url) => (
                    <li key={url} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="h-28 bg-slate-100">{url ? <img src={url} alt="Listing" className="h-full w-full object-cover" loading="lazy" /> : null}</div>
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <p className="min-w-0 truncate text-xs text-slate-500">{url}</p>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, photoUrls: prev.photoUrls.filter((entry) => entry !== url) }))}
                          className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Address</p>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Your address will remain private until you select a buyer for your item. Then it will be automaticaly shared for pickup.
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pickup city</span>
                  <input
                    value={form.pickupCity}
                    onChange={(event) => setForm((prev) => ({ ...prev, pickupCity: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="City"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Province</span>
                  <input
                    value={form.pickupProvince}
                    onChange={(event) => setForm((prev) => ({ ...prev, pickupProvince: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="ON"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address line 1</span>
                  <input
                    value={form.pickupAddressLine1}
                    onChange={(event) => setForm((prev) => ({ ...prev, pickupAddressLine1: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Street address"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address line 2</span>
                  <input
                    value={form.pickupAddressLine2}
                    onChange={(event) => setForm((prev) => ({ ...prev, pickupAddressLine2: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Unit / buzzer"
                  />
                </label>

                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Postal code</span>
                  <input
                    value={form.pickupPostalCode}
                    onChange={(event) => setForm((prev) => ({ ...prev, pickupPostalCode: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="A1A 1A1"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Delivery Addon?</p>
              <p className="mt-1 text-xs text-slate-600">
                If you are willing to deliver this item, you can set an additional price so its not a surprise to potential buyers.
              </p>

              <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.willingToDeliver}
                  onChange={(event) => setForm((prev) => ({ ...prev, willingToDeliver: event.target.checked }))}
                />
                Willing to deliver for an extra fee
              </label>

              {form.willingToDeliver ? (
                <div className="mt-3 space-y-2">
                  {DELIVERY_RANGES.map((range) => {
                    const checked = form.deliverySelection[range.key]
                    return (
                      <div key={range.key} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setForm((prev) => ({
                                  ...prev,
                                  deliverySelection: {
                                    ...prev.deliverySelection,
                                    [range.key]: event.target.checked,
                                  },
                                }))
                              }
                            />
                            {range.label} ({range.distance})
                          </label>

                          <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Addon price (CAD)
                            <input
                              value={form.deliveryPrices[range.key]}
                              onChange={(event) =>
                                setForm((prev) => ({
                                  ...prev,
                                  deliveryPrices: {
                                    ...prev.deliveryPrices,
                                    [range.key]: event.target.value,
                                  },
                                }))
                              }
                              disabled={!checked}
                              className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                              placeholder="0.00"
                            />
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Payment options</p>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Your Etransfer account will remain private until you select a buyer.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => togglePaymentType('cash_pickup')}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${form.paymentTypes.includes('cash_pickup') ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  Cash on pickup
                </button>
                <button
                  type="button"
                  onClick={() => togglePaymentType('etransfer')}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${form.paymentTypes.includes('etransfer') ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  eTransfer
                </button>
              </div>

              {form.paymentTypes.includes('etransfer') ? (
                <label className="mt-3 block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">eTransfer email (private)</span>
                  <input
                    value={form.eTransferEmail}
                    onChange={(event) => setForm((prev) => ({ ...prev, eTransferEmail: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="you@email.com"
                  />
                </label>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || initializing}
                onClick={() => void saveListing('save')}
                className="inline-flex items-center justify-center rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {statusLabel === 'draft' ? (
                <button
                  type="button"
                  disabled={saving || initializing}
                  onClick={() => setPublishConfirmOpen(true)}
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  Publish listing
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving || initializing}
                  onClick={() => void saveListing('unpublish')}
                  className="inline-flex items-center justify-center rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Unpublish
                </button>
              )}
            </div>

            <Modal
              open={publishConfirmOpen}
              onClose={() => {
                if (!saving) setPublishConfirmOpen(false)
              }}
              title="Publish listing?"
            >
              <p className="text-sm text-slate-600">This listing will be active in the marketplace and visible to buyers.</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPublishConfirmOpen(false)}
                  disabled={saving}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPublishConfirmOpen(false)
                    void saveListing('publish')
                  }}
                  disabled={saving}
                  className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Publishing…' : 'Confirm publish'}
                </button>
              </div>
            </Modal>
          </section>
        ) : null}
      </div>
    </DashboardShell>
  )
}
