'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AddressDirectionsMap } from '../../../_components/map/AddressDirectionsMap'
import DashboardShell from '../../../_components/DashboardShell'
import Modal from '../../../_components/Modal'
import RichTextEditor from '../../../_components/RichTextEditor'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import { fetchAddressSearchResults } from '../../../_lib/addressSearch'
import { normalizeCanadianPostalCode, normalizeCanadianProvince, type SavedShippingAddress } from '../../../_lib/canadianAddresses'
import MarketRightRail from '../../_components/MarketRightRail'
import { getMarketListingCategory, getMarketListingSection, getMarketListingSubcategory, MARKET_LISTING_SECTIONS } from '../../_lib/listingCategories'

type ListingTypeFieldKey = 'section' | 'category' | 'subcategory' | 'detail'

type ListingTypeSuggestion = {
  section?: string | null
  category?: string | null
  subcategory?: string | null
  detail?: string | null
}

type AiTaskResponse = {
  result?: ListingTypeSuggestion | null
  error?: string | null
  detail?: string | null
}

type ListingTypePickerProps = {
  label: string
  value: string
  placeholder: string
  disabled?: boolean
  onClick: () => void
}

type ListingTypePickerModalProps = {
  open: boolean
  title: string
  options: string[]
  selectedValue: string
  emptyLabel: string
  onChoose: (value: string) => void
  onClose: () => void
}

type ListingDetail = {
  id: string
  title: string
  description: string | null
  priceCents: number
  currency: string
  photoUrls: string[]
  listingProvinceCode?: string | null
  listingCommunitySlug?: string | null
  listingSection?: string | null
  listingCategory?: string | null
  listingSubcategory?: string | null
  listingDetail?: string | null
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

type ProfileHomeAddress = {
  line1: string
  line2: string
  city: string
  province: string
  postalCode: string
}

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
}

type FavoriteAddress = {
  id: string
  label: string
  address: string | null
  latitude: number | null
  longitude: number | null
  savedAt: string
}

type DraftForm = {
  title: string
  description: string
  price: string
  listingProvinceCode: string
  listingCommunitySlug: string
  listingSection: string
  listingCategory: string
  listingSubcategory: string
  listingDetail: string
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

type ListingEditorStatus = 'draft' | 'active' | 'pending' | 'sold' | 'canceled'

const EMPTY_FORM: DraftForm = {
  title: 'Draft Listing',
  description: '',
  price: '0.00',
  listingProvinceCode: '',
  listingCommunitySlug: '',
  listingSection: '',
  listingCategory: '',
  listingSubcategory: '',
  listingDetail: '',
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
const ADDRESS_FAVORITES_STORAGE_KEY = 'civil_address_favorites'
const MAX_LISTING_DESCRIPTION_LENGTH = 5000
function extractFirstJsonObject(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return null
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1]?.trim() || trimmed
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  return objectMatch?.[0] ?? null
}

function normalizeListingTypeSuggestion(input: unknown): ListingTypeSuggestion | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const read = (key: string) => (typeof record[key] === 'string' ? record[key].trim() || null : null)
  return {
    section: read('section'),
    category: read('category'),
    subcategory: read('subcategory'),
    detail: read('detail'),
  }
}

function ListingTypePicker({ label, value, placeholder, disabled, onClick }: ListingTypePickerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
        <span className={`mt-1 block whitespace-normal break-words text-sm font-medium leading-6 ${value ? 'text-slate-900' : 'text-slate-400'}`}>{value || placeholder}</span>
      </span>
      <span className="mt-0.5 shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500 group-hover:border-slate-300 group-hover:bg-white">
        Choose
      </span>
    </button>
  )
}

function ListingTypePickerModal({ open, title, options, selectedValue, emptyLabel, onChoose, onClose }: ListingTypePickerModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClassName="max-w-xl">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onChoose('')}
          className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${!selectedValue ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
        >
          <span>{emptyLabel}</span>
          {!selectedValue ? <span className="text-xs font-semibold uppercase tracking-wide">Selected</span> : null}
        </button>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {options.map((option) => {
            const selected = option === selectedValue
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChoose(option)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${selected ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'}`}
              >
                <span>{option}</span>
                {selected ? <span className="text-xs font-semibold uppercase tracking-wide">Selected</span> : null}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
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

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function formatMoneyInput(cents: number) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2)
}

function stripHtmlToPlainText(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function readFavoriteAddresses() {
  if (typeof window === 'undefined') return [] as FavoriteAddress[]
  try {
    const raw = window.localStorage.getItem(ADDRESS_FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const record = entry as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        if (!id || !label) return null
        return {
          id,
          label,
          address: typeof record.address === 'string' ? record.address.trim() || null : null,
          latitude: typeof record.latitude === 'number' && Number.isFinite(record.latitude) ? record.latitude : null,
          longitude: typeof record.longitude === 'number' && Number.isFinite(record.longitude) ? record.longitude : null,
          savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
        } satisfies FavoriteAddress
      })
      .filter((entry): entry is FavoriteAddress => Boolean(entry))
  } catch {
    return []
  }
}

function isHomeAddress(address: SavedShippingAddress) {
  const label = `${address.label ?? ''} ${address.name ?? ''}`.trim().toLowerCase()
  return address.isDefault || label.includes('home')
}

function formatSavedAddressTitle(address: SavedShippingAddress, fallback: string) {
  return address.label?.trim() || address.name?.trim() || fallback
}

function formatSavedAddressDetail(address: SavedShippingAddress, options?: { includeName?: boolean }) {
  const includeName = options?.includeName ?? true
  const lines = [includeName ? address.name?.trim() : '', address.line1?.trim(), address.line2?.trim()].filter(Boolean)
  const locality = [address.city?.trim(), address.province?.trim(), address.postalCode?.trim()].filter(Boolean).join(', ')
  if (locality) lines.push(locality)
  return lines.join(', ')
}

function formatHomeAddressTitle(address: SavedShippingAddress) {
  const nickname = address.name?.trim()
  return nickname ? `Home, ${nickname}` : 'Home'
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
  const [statusLabel, setStatusLabel] = useState<ListingEditorStatus>('draft')
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteAsSold, setDeleteAsSold] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [communityOptions, setCommunityOptions] = useState<CommunityFollowOption[]>([])
  const [savedAddresses, setSavedAddresses] = useState<SavedShippingAddress[]>([])
  const [favoriteAddresses, setFavoriteAddresses] = useState<FavoriteAddress[]>([])
  const [profileHomeAddress, setProfileHomeAddress] = useState<ProfileHomeAddress | null>(null)
  const [quickSelectValue, setQuickSelectValue] = useState('')
  const [addressMapPreview, setAddressMapPreview] = useState<{ latitude: number; longitude: number; label: string } | null>(null)
  const [addressMapStatus, setAddressMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [activeListingTypePicker, setActiveListingTypePicker] = useState<ListingTypeFieldKey | null>(null)
  const [aiCategorizing, setAiCategorizing] = useState(false)

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
      listingSection: listing.listingSection ?? '',
      listingCategory: listing.listingCategory ?? '',
      listingSubcategory: listing.listingSubcategory ?? '',
      listingDetail: listing.listingDetail ?? '',
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
    const nextStatus: ListingEditorStatus =
      listing.status === 'active' ||
      listing.status === 'pending' ||
      listing.status === 'sold' ||
      listing.status === 'canceled'
        ? listing.status
        : listing.isDraft
          ? 'draft'
          : 'active'
    setStatusLabel(nextStatus)
  }, [])

  const canEditActiveDraftListing = statusLabel === 'draft' || statusLabel === 'active'
  const statusLabelText =
    statusLabel === 'draft'
      ? 'Draft'
      : statusLabel === 'active'
        ? 'Active'
        : statusLabel === 'pending'
          ? 'Pending sale'
          : statusLabel === 'sold'
            ? 'Sold'
            : 'Canceled'
  const hasExistingListing = Boolean(listingParam?.trim() || listingId)
  const pageTitle = hasExistingListing ? 'Manage Listing' : 'Create Listing'
  const pageSubtitle = hasExistingListing
    ? canEditActiveDraftListing
      ? 'Review and update this listing from your marketplace manager.'
      : `This ${statusLabelText.toLowerCase()} listing is available here for reference only.`
    : 'Create a marketplace listing for your community.'
  const initializingText = listingParam?.trim() ? 'Loading listing…' : 'Preparing listing draft…'
  const editorCardClassName = 'rounded-3xl border border-slate-200 bg-white p-4 sm:p-5'

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

  const loadAddressQuickSelects = useCallback(async () => {
    setFavoriteAddresses(readFavoriteAddresses())

    try {
      const profileRes = await fetch(buildApiUrl('/profile'), {
        headers: getAuthHeaders(),
        cache: 'no-store',
      })
      if (profileRes.ok) {
        const payload = (await profileRes.json().catch(() => null)) as ProfileAddressResponse | null
        const user = payload?.user
        const nextHome = {
          line1: typeof user?.billingAddress1 === 'string' ? user.billingAddress1.trim() : '',
          line2: typeof user?.billingAddress2 === 'string' ? user.billingAddress2.trim() : '',
          city: typeof user?.billingCity === 'string' ? user.billingCity.trim() : '',
          province: normalizeCanadianProvince(typeof user?.billingState === 'string' ? user.billingState : ''),
          postalCode: normalizeCanadianPostalCode(typeof user?.billingPostalCode === 'string' ? user.billingPostalCode : ''),
        }
        if (nextHome.line1 || nextHome.city || nextHome.province || nextHome.postalCode) {
          setProfileHomeAddress(nextHome)
        } else {
          setProfileHomeAddress(null)
        }
      } else {
        setProfileHomeAddress(null)
      }
    } catch {
      setProfileHomeAddress(null)
    }

    try {
      const res = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
        headers: getAuthHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) {
        setSavedAddresses([])
        return
      }
      const payload = (await res.json().catch(() => null)) as ShippingAddressListResponse | null
      setSavedAddresses(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setSavedAddresses([])
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

  useEffect(() => {
    void loadAddressQuickSelects()
  }, [loadAddressQuickSelects])

  const quickSelectOptions = useMemo(() => {
    const profileHome = profileHomeAddress
      ? [
          {
            value: 'profile:home',
            group: 'Saved addresses',
            label: 'Home',
            detail: [profileHomeAddress.line1, profileHomeAddress.line2, [profileHomeAddress.city, profileHomeAddress.province, profileHomeAddress.postalCode].filter(Boolean).join(', ')]
              .filter(Boolean)
              .join(', '),
          },
        ]
      : []
    const orderedSaved = [...savedAddresses].sort(
      (left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? '').localeCompare(String(right.label ?? '')),
    )
    const saved = orderedSaved.map((address, index) => ({
      value: `saved:${address.id}`,
      group: 'Saved addresses',
      label: isHomeAddress(address) ? formatHomeAddressTitle(address) : formatSavedAddressTitle(address, index === 0 ? 'Saved address' : `Saved address ${index + 1}`),
      detail: formatSavedAddressDetail(address, { includeName: !isHomeAddress(address) }),
    }))
    const favorites = favoriteAddresses.map((favorite) => ({
      value: `favorite:${favorite.id}`,
      group: 'Favorites',
      label: favorite.label,
      detail: favorite.address,
    }))
    const combinedSaved = [...profileHome, ...saved]
    return { saved: combinedSaved, favorites, all: [...combinedSaved, ...favorites] }
  }, [favoriteAddresses, profileHomeAddress, savedAddresses])

  const descriptionPlainText = useMemo(() => stripHtmlToPlainText(form.description), [form.description])
  const descriptionTooLong = descriptionPlainText.length > MAX_LISTING_DESCRIPTION_LENGTH
  const selectedListingSection = useMemo(() => getMarketListingSection(form.listingSection), [form.listingSection])
  const selectedListingCategory = useMemo(
    () => getMarketListingCategory(form.listingSection, form.listingCategory),
    [form.listingCategory, form.listingSection],
  )
  const selectedListingSubcategory = useMemo(
    () => getMarketListingSubcategory(form.listingSection, form.listingCategory, form.listingSubcategory),
    [form.listingCategory, form.listingSection, form.listingSubcategory],
  )
  const selectedListingDetails = selectedListingSubcategory?.details ?? []
  const requiresListingDetail = selectedListingDetails.length > 0
  const listingTypeOptions = useMemo(
    () => ({
      section: MARKET_LISTING_SECTIONS.map((section) => section.label),
      category: (selectedListingSection?.categories ?? []).map((category) => category.label),
      subcategory: (selectedListingCategory?.subcategories ?? []).map((subcategory) => subcategory.label),
      detail: selectedListingDetails.map((detail) => detail.label),
    }),
    [selectedListingCategory, selectedListingDetails, selectedListingSection],
  )

  const applyListingTypeSuggestion = useCallback((suggestion: ListingTypeSuggestion) => {
    const section = getMarketListingSection(suggestion.section)
    if (!section) return false
    const category = getMarketListingCategory(section.label, suggestion.category)
    if (!category) return false
    const subcategory = getMarketListingSubcategory(section.label, category.label, suggestion.subcategory)
    if (!subcategory) return false

    let detail = ''
    if (subcategory.details?.length) {
      const nextDetail = (suggestion.detail ?? '').trim()
      if (!subcategory.details.some((entry) => entry.label === nextDetail)) return false
      detail = nextDetail
    }

    setForm((prev) => ({
      ...prev,
      listingSection: section.label,
      listingCategory: category.label,
      listingSubcategory: subcategory.label,
      listingDetail: detail,
    }))
    return true
  }, [])

  const classifyListingTypeWithAi = useCallback(async () => {
    const title = form.title.trim()
    const description = descriptionPlainText.trim()
    if (!title && !description) {
      pushToast('Add a title or description before asking Civil AI to classify the listing.', 'error')
      return
    }

    setAiCategorizing(true)
    try {
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
      const response = await fetch(buildApiUrl('/ai/task/marketplace/category'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          input: {
            title: title || '(empty)',
            description: description || '(empty)',
          },
        }),
      })
      const payload = (await response.json().catch(() => null)) as AiTaskResponse | null
      if (!response.ok || !payload?.result) {
        const rawContent = payload?.detail?.trim() || payload?.error?.trim() || ''
        const jsonText = extractFirstJsonObject(rawContent)
        const parsed = jsonText ? normalizeListingTypeSuggestion(JSON.parse(jsonText)) : null
        if (parsed && applyListingTypeSuggestion(parsed)) {
          pushToast('Civil AI selected a listing type.', 'success')
          return
        }
        throw new Error(payload?.detail || payload?.error || 'Civil AI could not classify this listing right now.')
      }

      if (!applyListingTypeSuggestion(payload.result)) {
        throw new Error('Civil AI returned a category path that does not match the marketplace taxonomy.')
      }
      pushToast('Civil AI selected a listing type.', 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Civil AI could not classify this listing right now.', 'error')
    } finally {
      setAiCategorizing(false)
    }
  }, [applyListingTypeSuggestion, descriptionPlainText, form.title])

  useEffect(() => {
    if (requiresListingDetail) {
      const hasMatchingDetail = selectedListingDetails.some((detail) => detail.label === form.listingDetail)
      if (!hasMatchingDetail && form.listingDetail) {
        setForm((prev) => ({ ...prev, listingDetail: '' }))
      }
      return
    }

    if (form.listingDetail) {
      setForm((prev) => ({ ...prev, listingDetail: '' }))
    }
  }, [form.listingDetail, requiresListingDetail, selectedListingDetails])

  const addressMapQuery = useMemo(() => {
    const line1 = form.pickupAddressLine1.trim()
    const city = form.pickupCity.trim()
    const province = form.pickupProvince.trim()
    const postalCode = form.pickupPostalCode.trim()
    const line2 = form.pickupAddressLine2.trim()

    if (!line1 || !city || !province) return ''
    return [line1, line2, city, province, postalCode, 'Canada'].filter(Boolean).join(', ')
  }, [form.pickupAddressLine1, form.pickupAddressLine2, form.pickupCity, form.pickupPostalCode, form.pickupProvince])

  const applyQuickSelect = useCallback(
    (value: string) => {
      if (!value) return

      if (value.startsWith('saved:')) {
        const targetId = value.slice('saved:'.length)
        const address = savedAddresses.find((entry) => entry.id === targetId)
        if (!address) return
        setForm((prev) => ({
          ...prev,
          pickupAddressLine1: address.line1?.trim() ?? '',
          pickupAddressLine2: address.line2?.trim() ?? '',
          pickupCity: address.city?.trim() ?? '',
          pickupProvince: normalizeCanadianProvince(address.province),
          pickupPostalCode: normalizeCanadianPostalCode(address.postalCode),
        }))
        return
      }

      if (value === 'profile:home' && profileHomeAddress) {
        setForm((prev) => ({
          ...prev,
          pickupAddressLine1: profileHomeAddress.line1,
          pickupAddressLine2: profileHomeAddress.line2,
          pickupCity: profileHomeAddress.city,
          pickupProvince: profileHomeAddress.province,
          pickupPostalCode: profileHomeAddress.postalCode,
        }))
        return
      }

      if (value.startsWith('favorite:')) {
        const targetId = value.slice('favorite:'.length)
        const favorite = favoriteAddresses.find((entry) => entry.id === targetId)
        if (!favorite) return
        setForm((prev) => ({
          ...prev,
          pickupAddressLine1: favorite.address?.trim() || favorite.label,
        }))
      }
    },
    [favoriteAddresses, profileHomeAddress, savedAddresses],
  )

  useEffect(() => {
    if (!addressMapQuery) {
      setAddressMapPreview(null)
      setAddressMapStatus('idle')
      return
    }

    const controller = new AbortController()
    let cancelled = false

    setAddressMapStatus('loading')

    void (async () => {
      try {
        const results = await fetchAddressSearchResults(addressMapQuery, controller.signal, 1)
        if (cancelled) return
        const result = results[0]
        if (!result) {
          setAddressMapPreview(null)
          setAddressMapStatus('error')
          return
        }

        setAddressMapPreview({
          latitude: result.latitude,
          longitude: result.longitude,
          label: addressMapQuery,
        })
        setAddressMapStatus('ready')
      } catch (error) {
        if (cancelled) return
        if (error instanceof Error && error.name === 'AbortError') return
        setAddressMapPreview(null)
        setAddressMapStatus('error')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [addressMapQuery])

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

      if (descriptionTooLong) {
        pushToast(`Description must be ${MAX_LISTING_DESCRIPTION_LENGTH.toLocaleString()} characters or fewer.`, 'error')
        return
      }

      const priceCents = toCents(form.price)
      if (publish) {
        if (!form.title.trim()) {
          pushToast('Title is required.', 'error')
          return
        }
        if (form.photoUrls.length < 1) {
          pushToast('Upload at least one photo before publishing.', 'error')
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
        if (!form.listingSection.trim() || !form.listingCategory.trim() || !form.listingSubcategory.trim()) {
          pushToast('Choose a listing type before publishing.', 'error')
          return
        }
        if (requiresListingDetail && !form.listingDetail.trim()) {
          pushToast('Choose the final listing type before publishing.', 'error')
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
        const nextStatus: ListingEditorStatus = publish ? 'active' : unpublish ? 'draft' : statusLabel
        const nextIsDraft = nextStatus !== 'active'

        const res = await fetch(buildApiUrl(`/market/listings/${encodeURIComponent(listingId)}`), {
          method: 'PUT',
          headers: getAuthHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            title: form.title.trim() || 'Draft Listing',
            description: descriptionPlainText ? form.description : null,
            priceCents,
            currency: 'CAD',
            photoUrls: form.photoUrls,
            listingProvinceCode: form.listingProvinceCode.trim().toUpperCase() || null,
            listingCommunitySlug: form.listingCommunitySlug.trim().toLowerCase() || null,
            listingSection: form.listingSection.trim() || null,
            listingCategory: form.listingCategory.trim() || null,
            listingSubcategory: form.listingSubcategory.trim() || null,
            listingDetail: requiresListingDetail ? form.listingDetail.trim() || null : null,
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
        if (publish) {
          router.push(`/market/listings/${encodeURIComponent(listingId)}`)
          return
        }
      } catch {
        pushToast('Unable to save listing right now.', 'error')
      } finally {
        setSaving(false)
      }
    },
    [descriptionPlainText, descriptionTooLong, form, listingId, router, statusLabel],
  )

  const removeListing = useCallback(async () => {
    if (!listingId) return

    setDeleteSubmitting(true)
    setDeleteError(null)
    try {
      const res = await fetch(buildApiUrl(`/market/listings/${encodeURIComponent(listingId)}/remove`), {
        method: 'POST',
        headers: getAuthHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ resolution: deleteAsSold ? 'sold' : 'deleted' }),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setDeleteError(payload?.error || 'Unable to remove listing right now.')
        return
      }

      pushToast(deleteAsSold ? 'Listing marked sold and removed.' : 'Listing deleted.', 'success')
      router.push('/market/listings')
    } catch {
      setDeleteError('Unable to remove listing right now.')
    } finally {
      setDeleteSubmitting(false)
    }
  }, [deleteAsSold, listingId, router])

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{pageTitle}</h1>
              <p className="mt-1 text-sm text-slate-600">{pageSubtitle}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Status: {statusLabelText}
              </span>
              <button
                type="button"
                disabled={!listingId || saving || initializing || deleteSubmitting || !canEditActiveDraftListing}
                onClick={() => {
                  setDeleteError(null)
                  setDeleteAsSold(false)
                  setDeleteConfirmOpen(true)
                }}
                className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
              >
                Delete listing
              </button>
              <button
                type="button"
                disabled={saving || initializing || !canEditActiveDraftListing}
                onClick={() => void saveListing('save')}
                className="inline-flex items-center justify-center rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {statusLabel === 'draft' ? (
                <button
                  type="button"
                  disabled={saving || initializing || !canEditActiveDraftListing}
                  onClick={() => setPublishConfirmOpen(true)}
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  Publish listing
                </button>
              ) : statusLabel === 'active' ? (
                <button
                  type="button"
                  disabled={saving || initializing || !canEditActiveDraftListing}
                  onClick={() => void saveListing('unpublish')}
                  className="inline-flex items-center justify-center rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Unpublish
                </button>
              ) : null}
            </div>
          </div>
          {!canEditActiveDraftListing ? (
            <p className="mt-3 text-sm text-slate-600">This listing is {statusLabelText.toLowerCase()} and can no longer be edited from the listing manager.</p>
          ) : null}
        </section>

        {initializing ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{initializingText}</div> : null}

        {!initializing ? (
          <>
          <fieldset disabled={!canEditActiveDraftListing} className={`space-y-5 ${canEditActiveDraftListing ? '' : 'opacity-80'}`}>
            <section className={editorCardClassName}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Add photos</p>
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
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {form.photoUrls.map((url) => (
                    <li key={url} className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {url ? <img src={url} alt="Listing" className="h-full w-full object-cover" loading="lazy" /> : null}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent" />
                      <div className="absolute right-2 top-2">
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, photoUrls: prev.photoUrls.filter((entry) => entry !== url) }))}
                          aria-label="Remove photo"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-sm font-semibold text-white transition hover:bg-black/80"
                        >
                          X
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            </section>

            <section className={editorCardClassName}>
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
            </section>

            <section className={editorCardClassName}>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
              <div className="rounded-xl border border-slate-200 bg-white p-2">
                <RichTextEditor
                  value={form.description}
                  onChange={(value) => setForm((prev) => ({ ...prev, description: value }))}
                  placeholder="Condition, details, pickup expectations, and anything buyers should know."
                  minHeight={200}
                  disabled={saving || initializing || !canEditActiveDraftListing}
                />
              </div>
              <p className={`text-xs ${descriptionTooLong ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
                {descriptionPlainText.length.toLocaleString()} / {MAX_LISTING_DESCRIPTION_LENGTH.toLocaleString()} characters
              </p>
            </label>
            </section>

            <section className={editorCardClassName}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Listing type</p>
                </div>
                <button
                  type="button"
                  onClick={() => void classifyListingTypeWithAi()}
                  disabled={aiCategorizing || saving || initializing || !canEditActiveDraftListing}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] bg-white px-4 py-2 text-xs font-semibold text-[var(--cc-primary)] shadow-sm transition hover:bg-[var(--cc-primary)]/5 disabled:opacity-60"
                >
                  {aiCategorizing ? 'Civil AI is classifying…' : 'Civil AI'}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Use Civil AI to automatically detect the appropriate category.</p>
              <div className="mt-4 space-y-3">
                <ListingTypePicker
                  label="Section"
                  value={form.listingSection}
                  placeholder="Select section…"
                  onClick={() => setActiveListingTypePicker('section')}
                />
                <ListingTypePicker
                  label="Category"
                  value={form.listingCategory}
                  placeholder="Select category…"
                  disabled={!selectedListingSection}
                  onClick={() => setActiveListingTypePicker('category')}
                />
                <ListingTypePicker
                  label="Subcategory"
                  value={form.listingSubcategory}
                  placeholder="Select subcategory…"
                  disabled={!selectedListingCategory}
                  onClick={() => setActiveListingTypePicker('subcategory')}
                />
                <ListingTypePicker
                  label="Detail"
                  value={form.listingDetail}
                  placeholder={requiresListingDetail ? 'Select detail…' : 'No detail needed'}
                  disabled={!requiresListingDetail}
                  onClick={() => setActiveListingTypePicker('detail')}
                />
              </div>
            </div>
            </section>

            <section className={editorCardClassName}>
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
            </section>

            <section className={editorCardClassName}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Address</p>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Your address will remain private until you select a buyer for your item. Then it will be automaticaly shared for pickup.
              </div>

              {quickSelectOptions.all.length ? (
                <label className="mt-3 block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick select</span>
                  <select
                    value={quickSelectValue}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      setQuickSelectValue(nextValue)
                      applyQuickSelect(nextValue)
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Choose home or a saved favorite</option>
                    {quickSelectOptions.saved.length ? (
                      <optgroup label="Saved addresses">
                        {quickSelectOptions.saved.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.detail ? `${option.label} • ${option.detail}` : option.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {quickSelectOptions.favorites.length ? (
                      <optgroup label="Favorites">
                        {quickSelectOptions.favorites.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.detail ? `${option.label} • ${option.detail}` : option.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  <p className="text-xs text-slate-500">Use Home, another saved address, or a favorite location to prefill pickup details.</p>
                </label>
              ) : null}

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

              {addressMapQuery ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">Map preview</p>
                    {addressMapStatus === 'loading' ? <p className="text-xs text-slate-500">Locating address…</p> : null}
                    {addressMapStatus === 'error' ? <p className="text-xs text-amber-700">We could not place this address on the map yet.</p> : null}
                  </div>
                  {addressMapPreview ? <AddressDirectionsMap destination={addressMapPreview} /> : null}
                </div>
              ) : null}
            </div>
            </section>

            <section className={editorCardClassName}>
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
            </section>

            <section className={editorCardClassName}>
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

            </section>

          </fieldset>

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

            <ListingTypePickerModal
              open={activeListingTypePicker === 'section'}
              title="Choose section"
              options={listingTypeOptions.section}
              selectedValue={form.listingSection}
              emptyLabel="No section selected"
              onClose={() => setActiveListingTypePicker(null)}
              onChoose={(value) => {
                setForm((prev) => ({
                  ...prev,
                  listingSection: value,
                  listingCategory: '',
                  listingSubcategory: '',
                  listingDetail: '',
                }))
                setActiveListingTypePicker(null)
              }}
            />

            <ListingTypePickerModal
              open={activeListingTypePicker === 'category'}
              title="Choose category"
              options={listingTypeOptions.category}
              selectedValue={form.listingCategory}
              emptyLabel="No category selected"
              onClose={() => setActiveListingTypePicker(null)}
              onChoose={(value) => {
                setForm((prev) => ({
                  ...prev,
                  listingCategory: value,
                  listingSubcategory: '',
                  listingDetail: '',
                }))
                setActiveListingTypePicker(null)
              }}
            />

            <ListingTypePickerModal
              open={activeListingTypePicker === 'subcategory'}
              title="Choose subcategory"
              options={listingTypeOptions.subcategory}
              selectedValue={form.listingSubcategory}
              emptyLabel="No subcategory selected"
              onClose={() => setActiveListingTypePicker(null)}
              onChoose={(value) => {
                setForm((prev) => ({
                  ...prev,
                  listingSubcategory: value,
                  listingDetail: '',
                }))
                setActiveListingTypePicker(null)
              }}
            />

            <ListingTypePickerModal
              open={activeListingTypePicker === 'detail'}
              title="Choose detail"
              options={listingTypeOptions.detail}
              selectedValue={form.listingDetail}
              emptyLabel="No detail selected"
              onClose={() => setActiveListingTypePicker(null)}
              onChoose={(value) => {
                setForm((prev) => ({ ...prev, listingDetail: value }))
                setActiveListingTypePicker(null)
              }}
            />

            <Modal
              open={deleteConfirmOpen}
              onClose={() => {
                if (deleteSubmitting) return
                setDeleteConfirmOpen(false)
              }}
              title={deleteAsSold ? 'Mark item sold and remove listing?' : 'Delete listing?'}
            >
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  {deleteAsSold
                    ? 'This will remove the listing and tell active buyers that the item has been sold.'
                    : 'This will remove the listing and tell active buyers that the item has been deleted.'}
                </p>
                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={deleteAsSold}
                    onChange={(event) => setDeleteAsSold(event.target.checked)}
                    disabled={deleteSubmitting}
                    className="mt-0.5"
                  />
                  <span>
                    Mark this item as sold instead of deleted
                  </span>
                </label>
                {deleteError ? <p className="text-sm text-rose-700">{deleteError}</p> : null}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(false)}
                    disabled={deleteSubmitting}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeListing()}
                    disabled={deleteSubmitting}
                    className={`rounded-full px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-60 ${deleteAsSold ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                  >
                    {deleteSubmitting ? (deleteAsSold ? 'Marking sold…' : 'Deleting…') : deleteAsSold ? 'Mark sold and remove' : 'Delete listing'}
                  </button>
                </div>
              </div>
            </Modal>
          </>
        ) : null}
      </div>
    </DashboardShell>
  )
}
