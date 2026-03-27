'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HiCheck } from 'react-icons/hi2'
import { AddressDirectionsMap } from '../../../_components/map/AddressDirectionsMap'
import DashboardShell from '../../../_components/DashboardShell'
import Modal from '../../../_components/Modal'
import RichTextEditor from '../../../_components/RichTextEditor'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import { resolveBestAddressSearchResult } from '../../../_lib/addressSearch'
import { normalizeCanadianPostalCode, normalizeCanadianProvince, type SavedShippingAddress } from '../../../_lib/canadianAddresses'
import { ensureViewerMe } from '../../../_lib/viewerMe'
import { useViewerStore } from '../../../_lib/viewerStore'
import MarketRightRail from '../../_components/MarketRightRail'
import { getMarketListingCategory, getMarketListingSection, getMarketListingSubcategory, MARKET_LISTING_SECTIONS } from '../../_lib/listingCategories'

type ListingTypeFieldKey = 'section' | 'category' | 'subcategory' | 'detail'

type FoodSafetyClassification = 'low_risk' | 'high_risk'
type FoodPreparationLocation = 'home_kitchen' | 'certified_kitchen'
type FoodStorageMethod = 'refrigerated' | 'frozen'
type FoodTag = 'organic' | 'grass_fed' | 'free_range' | 'non_gmo' | 'local'

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
  foodSafetyClassification?: FoodSafetyClassification | null
  foodIngredients?: string | null
  foodPreparationLocation?: FoodPreparationLocation | null
  foodStorageMethod?: FoodStorageMethod | null
  foodTags?: FoodTag[]
  foodExpiryDate?: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupAddressLine1: string | null
  pickupAddressLine2: string | null
  pickupPostalCode: string | null
  paymentTypes: string[]
  willingToDeliver: boolean
  deliveryOptions?: {
    pickupInstructions?: string
    itemIsHeavy?: boolean
    itemIsBulky?: boolean
    itemIsSmall?: boolean
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
  foodSafetyClassification: FoodSafetyClassification | ''
  foodIngredients: string
  foodPreparationLocation: FoodPreparationLocation | ''
  foodStorageMethod: FoodStorageMethod | ''
  foodTags: FoodTag[]
  foodExpiryDate: string
  pickupCity: string
  pickupProvince: string
  pickupAddressLine1: string
  pickupAddressLine2: string
  pickupPostalCode: string
  willingToDeliver: boolean
  deliveryPickupInstructions: string
  deliveryTraits: {
    itemIsHeavy: boolean
    itemIsBulky: boolean
    itemIsSmall: boolean
  }
  paymentTypes: Array<'cash_pickup' | 'etransfer' | 'civil_wallet'>
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
  foodSafetyClassification: '',
  foodIngredients: '',
  foodPreparationLocation: '',
  foodStorageMethod: '',
  foodTags: [],
  foodExpiryDate: '',
  pickupCity: '',
  pickupProvince: '',
  pickupAddressLine1: '',
  pickupAddressLine2: '',
  pickupPostalCode: '',
  willingToDeliver: false,
  deliveryPickupInstructions: '',
  deliveryTraits: {
    itemIsHeavy: false,
    itemIsBulky: false,
    itemIsSmall: false,
  },
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

type OrganizationsOwnedResponse = {
  items?: Array<{ id: string }>
}

type OrganizationsMembershipsResponse = {
  items?: Array<{ id: string }>
}

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const PHOTO_MAX_BYTES = 25 * 1024 * 1024
const ADDRESS_FAVORITES_STORAGE_KEY = 'civil_address_favorites'
const MAX_LISTING_DESCRIPTION_LENGTH = 5000
const FOOD_GROCERY_SECTION = 'Food & Grocery'
const HIGH_RISK_FOOD_SUBCATEGORIES = new Set(['Prepared Food', 'Frozen Foods'])
const HIGH_RISK_FOOD_DETAILS = new Set([
  'Meat',
  'Poultry',
  'Fish & Seafood',
  'Dairy & Eggs',
  'Home Cooked Meals',
  'Ready To Eat Meals',
  'Catering Trays',
  'Restaurant Takeout',
  'Frozen Meat',
  'Frozen Meals',
  'Frozen Desserts',
  'Juices',
  'Homemade Drinks',
  'Bulk Meat Orders',
])
const FOOD_TAG_OPTIONS: Array<{ value: FoodTag; label: string }> = [
  { value: 'organic', label: 'Organic' },
  { value: 'grass_fed', label: 'Grass Fed' },
  { value: 'free_range', label: 'Free Range' },
  { value: 'non_gmo', label: 'Non GMO' },
  { value: 'local', label: 'Local' },
]
const LOW_RISK_FOOD_DETAILS = new Set([
  'Fruits',
  'Vegetables',
  'Grains & Flour',
  'Herbs & Spices',
  'Oils & Sauces',
  'Baked Goods',
  'Preserves (Jams, Pickles)',
  'Frozen Vegetables',
  'Coffee & Tea',
  'Soft Drinks',
  'Farm Produce Boxes',
  'Wholesale Produce',
])

function normalizeFoodField(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function normalizeLegacyFoodListingPath(path: Pick<DraftForm, 'listingSection' | 'listingCategory' | 'listingSubcategory' | 'listingDetail'>) {
  if (
    normalizeFoodField(path.listingSection) === 'items' &&
    normalizeFoodField(path.listingCategory) === normalizeFoodField(FOOD_GROCERY_SECTION)
  ) {
    return {
      listingSection: FOOD_GROCERY_SECTION,
      listingCategory: path.listingSubcategory,
      listingSubcategory: path.listingDetail,
      listingDetail: '',
    }
  }

  return path
}

function inferFoodSafetyClassification(
  sectionLabel: string | null | undefined,
  categoryLabel: string | null | undefined,
  subcategoryLabel: string | null | undefined,
) {
  if (normalizeFoodField(sectionLabel) !== normalizeFoodField(FOOD_GROCERY_SECTION)) return ''

  if (HIGH_RISK_FOOD_SUBCATEGORIES.has(categoryLabel ?? '') || HIGH_RISK_FOOD_DETAILS.has(subcategoryLabel ?? '')) return 'high_risk' satisfies FoodSafetyClassification
  if (LOW_RISK_FOOD_DETAILS.has(subcategoryLabel ?? '')) return 'low_risk' satisfies FoodSafetyClassification

  return ''
}

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

function normalizeEmail(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
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

function normalizeAddressPart(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function matchesSavedAddress(
  form: Pick<DraftForm, 'pickupAddressLine1' | 'pickupAddressLine2' | 'pickupCity' | 'pickupProvince' | 'pickupPostalCode'>,
  address: Pick<SavedShippingAddress, 'line1' | 'line2' | 'city' | 'province' | 'postalCode'>,
) {
  return (
    normalizeAddressPart(form.pickupAddressLine1) === normalizeAddressPart(address.line1) &&
    normalizeAddressPart(form.pickupAddressLine2) === normalizeAddressPart(address.line2) &&
    normalizeAddressPart(form.pickupCity) === normalizeAddressPart(address.city) &&
    normalizeAddressPart(form.pickupProvince) === normalizeAddressPart(normalizeCanadianProvince(address.province)) &&
    normalizeAddressPart(form.pickupPostalCode) === normalizeAddressPart(normalizeCanadianPostalCode(address.postalCode))
  )
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
  const viewerMe = useViewerStore((state) => state.me)

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
  const [hasOrganization, setHasOrganization] = useState<boolean | null>(null)
  const [walletSetupModalOpen, setWalletSetupModalOpen] = useState(false)

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

    setListingId(listing.id)
    const normalizedFoodPath = normalizeLegacyFoodListingPath({
      listingSection: listing.listingSection ?? '',
      listingCategory: listing.listingCategory ?? '',
      listingSubcategory: listing.listingSubcategory ?? '',
      listingDetail: listing.listingDetail ?? '',
    })

    setForm({
      title: listing.title || 'Draft Listing',
      description: listing.description ?? '',
      price: formatMoneyInput(listing.priceCents),
      listingProvinceCode: listing.listingProvinceCode ?? '',
      listingCommunitySlug: listing.listingCommunitySlug ?? '',
      listingSection: normalizedFoodPath.listingSection,
      listingCategory: normalizedFoodPath.listingCategory,
      listingSubcategory: normalizedFoodPath.listingSubcategory,
      listingDetail: normalizedFoodPath.listingDetail,
      foodSafetyClassification: listing.foodSafetyClassification ?? '',
      foodIngredients: listing.foodIngredients ?? '',
      foodPreparationLocation: listing.foodPreparationLocation ?? '',
      foodStorageMethod: listing.foodStorageMethod ?? '',
      foodTags: Array.isArray(listing.foodTags)
        ? listing.foodTags.filter((entry): entry is FoodTag => FOOD_TAG_OPTIONS.some((option) => option.value === entry))
        : [],
      foodExpiryDate: listing.foodExpiryDate ?? '',
      pickupCity: listing.pickupCity ?? '',
      pickupProvince: listing.pickupProvince ?? '',
      pickupAddressLine1: listing.pickupAddressLine1 ?? '',
      pickupAddressLine2: listing.pickupAddressLine2 ?? '',
      pickupPostalCode: listing.pickupPostalCode ?? '',
      willingToDeliver: Boolean(listing.willingToDeliver),
      deliveryPickupInstructions: typeof deliveryOptions.pickupInstructions === 'string' ? deliveryOptions.pickupInstructions : '',
      deliveryTraits: {
        itemIsHeavy: deliveryOptions.itemIsHeavy === true,
        itemIsBulky: deliveryOptions.itemIsBulky === true,
        itemIsSmall: deliveryOptions.itemIsSmall === true,
      },
      paymentTypes: (Array.isArray(listing.paymentTypes) ? listing.paymentTypes : []).filter(
        (entry): entry is 'cash_pickup' | 'etransfer' | 'civil_wallet' => entry === 'cash_pickup' || entry === 'etransfer' || entry === 'civil_wallet',
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

  useEffect(() => {
    void ensureViewerMe()
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadOrganizationState = async () => {
      try {
        const [ownedRes, membershipsRes] = await Promise.all([
          fetch(buildApiUrl('/organizations/owned'), {
            headers: getAuthHeaders(),
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/organizations/memberships'), {
            headers: getAuthHeaders(),
            cache: 'no-store',
          }),
        ])

        if (cancelled) return

        const ownedPayload = ownedRes.ok ? ((await ownedRes.json().catch(() => null)) as OrganizationsOwnedResponse | null) : null
        const membershipsPayload = membershipsRes.ok
          ? ((await membershipsRes.json().catch(() => null)) as OrganizationsMembershipsResponse | null)
          : null

        const ownedCount = Array.isArray(ownedPayload?.items) ? ownedPayload.items.length : 0
        const membershipCount = Array.isArray(membershipsPayload?.items) ? membershipsPayload.items.length : 0
        setHasOrganization(ownedCount + membershipCount > 0)
      } catch {
        if (!cancelled) setHasOrganization(null)
      }
    }

    void loadOrganizationState()

    return () => {
      cancelled = true
    }
  }, [])

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
  const defaultSavedAddress = useMemo(() => {
    const orderedSaved = [...savedAddresses].sort(
      (left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? '').localeCompare(String(right.label ?? '')),
    )
    return orderedSaved.find((address) => Boolean(address.line1?.trim() || address.city?.trim() || address.province?.trim() || address.postalCode?.trim())) ?? null
  }, [savedAddresses])
  const defaultQuickSelectValue = profileHomeAddress ? 'profile:home' : defaultSavedAddress ? `saved:${defaultSavedAddress.id}` : ''
  const selectedStructuredQuickSelect = quickSelectValue === 'profile:home' || quickSelectValue.startsWith('saved:')

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
  const isFoodListing = selectedListingSection?.label === FOOD_GROCERY_SECTION
  const suggestedFoodSafetyClassification = useMemo(
    () => inferFoodSafetyClassification(selectedListingSection?.label, selectedListingCategory?.label, selectedListingSubcategory?.label),
    [selectedListingCategory?.label, selectedListingSection?.label, selectedListingSubcategory?.label],
  )
  const requiresHighRiskFoodFields = isFoodListing && form.foodSafetyClassification === 'high_risk'

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

  useEffect(() => {
    if (!isFoodListing) {
      if (
        form.foodSafetyClassification ||
        form.foodIngredients ||
        form.foodPreparationLocation ||
        form.foodStorageMethod ||
        form.foodTags.length ||
        form.foodExpiryDate
      ) {
        setForm((prev) => ({
          ...prev,
          foodSafetyClassification: '',
          foodIngredients: '',
          foodPreparationLocation: '',
          foodStorageMethod: '',
          foodTags: [],
          foodExpiryDate: '',
        }))
      }
      return
    }

    if (suggestedFoodSafetyClassification === 'high_risk' && form.foodSafetyClassification !== 'high_risk') {
      setForm((prev) => ({ ...prev, foodSafetyClassification: 'high_risk' }))
      return
    }

    if (suggestedFoodSafetyClassification && !form.foodSafetyClassification) {
      setForm((prev) => ({ ...prev, foodSafetyClassification: suggestedFoodSafetyClassification }))
    }
  }, [
    form.foodExpiryDate,
    form.foodIngredients,
    form.foodPreparationLocation,
    form.foodSafetyClassification,
    form.foodStorageMethod,
    isFoodListing,
    suggestedFoodSafetyClassification,
  ])

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
    const formMatchesHome = profileHomeAddress
      ? matchesSavedAddress(form, {
          line1: profileHomeAddress.line1,
          line2: profileHomeAddress.line2,
          city: profileHomeAddress.city,
          province: profileHomeAddress.province,
          postalCode: profileHomeAddress.postalCode,
        })
      : false
    const matchingSavedAddress = savedAddresses.find((address) => matchesSavedAddress(form, address)) ?? null

    const formHasAddress = Boolean(
      form.pickupAddressLine1.trim() || form.pickupAddressLine2.trim() || form.pickupCity.trim() || form.pickupProvince.trim() || form.pickupPostalCode.trim(),
    )

    if (!formHasAddress && defaultQuickSelectValue) {
      setQuickSelectValue(defaultQuickSelectValue)
      applyQuickSelect(defaultQuickSelectValue)
      return
    }

    if (formMatchesHome && quickSelectValue !== 'profile:home') {
      setQuickSelectValue('profile:home')
      return
    }

    if (matchingSavedAddress) {
      const nextValue = `saved:${matchingSavedAddress.id}`
      if (quickSelectValue !== nextValue) {
        setQuickSelectValue(nextValue)
      }
    }
  }, [
    applyQuickSelect,
    defaultQuickSelectValue,
    form.pickupAddressLine1,
    form.pickupAddressLine2,
    form.pickupCity,
    form.pickupPostalCode,
    form.pickupProvince,
    profileHomeAddress,
    quickSelectValue,
    savedAddresses,
  ])

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
        const result = await resolveBestAddressSearchResult(addressMapQuery, controller.signal, 1)
        if (cancelled) return
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

  const resolveWalletETransferEmail = useCallback(async () => {
    const cachedWallet = useViewerStore.getState().me?.wallet
    const cachedEmail = normalizeEmail(cachedWallet?.eTransferEmail)
    const cachedEnabled = cachedWallet?.enabled == null ? Boolean(cachedEmail) : Boolean(cachedWallet.enabled)
    const cachedMarketSharing = cachedWallet?.sharing?.market == null ? Boolean(cachedEmail) : Boolean(cachedWallet.sharing.market)
    if (cachedEmail && cachedEnabled && cachedMarketSharing) return cachedEmail

    const resolvedMe = await ensureViewerMe({ refresh: true })
    const resolvedWallet = resolvedMe?.wallet
    const resolvedEmail = normalizeEmail(resolvedWallet?.eTransferEmail)
    const resolvedEnabled = resolvedWallet?.enabled == null ? Boolean(resolvedEmail) : Boolean(resolvedWallet.enabled)
    const resolvedMarketSharing = resolvedWallet?.sharing?.market == null ? Boolean(resolvedEmail) : Boolean(resolvedWallet.sharing.market)
    return resolvedEmail && resolvedEnabled && resolvedMarketSharing ? resolvedEmail : ''
  }, [])

  const walletETransferEmail = normalizeEmail(viewerMe?.wallet?.eTransferEmail)
  const walletMarketEnabled = Boolean(
    walletETransferEmail &&
      (viewerMe?.wallet?.enabled == null ? true : viewerMe.wallet.enabled) &&
      (viewerMe?.wallet?.sharing?.market == null ? true : viewerMe.wallet.sharing.market),
  )
  const walletCivilPayEnabled = Boolean(
    (viewerMe?.wallet?.enabled == null ? true : viewerMe.wallet.enabled) &&
      viewerMe?.wallet?.stripeConnect?.accountId &&
      viewerMe?.wallet?.stripeConnect?.payoutsEnabled,
  )

  const togglePaymentType = useCallback(async (type: 'cash_pickup' | 'etransfer' | 'civil_wallet') => {
    const exists = form.paymentTypes.includes(type)
    if (exists) {
      setForm((prev) => {
        const next = prev.paymentTypes.filter((entry) => entry !== type)
        return { ...prev, paymentTypes: next.length ? next : ['cash_pickup'] }
      })
      return
    }

    if (type === 'etransfer') {
      const walletEmail = await resolveWalletETransferEmail()
      if (!walletEmail) {
        setWalletSetupModalOpen(true)
        return
      }
    }

    if (type === 'civil_wallet' && !walletCivilPayEnabled) {
      pushToast('Set up Civil Wallet payouts before enabling Civil Wallet on this listing.', 'error')
      return
    }

    setForm((prev) => ({ ...prev, paymentTypes: [...prev.paymentTypes, type] }))
  }, [form.paymentTypes, resolveWalletETransferEmail, walletCivilPayEnabled])

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

      if (form.paymentTypes.includes('etransfer')) {
        const walletEmail = await resolveWalletETransferEmail()
        if (!walletEmail) {
          setWalletSetupModalOpen(true)
          pushToast('Set up your wallet eTransfer address before enabling eTransfer.', 'error')
          return
        }
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
        if (isFoodListing && !form.foodSafetyClassification) {
          pushToast('Choose whether this food listing is low risk or high risk before publishing.', 'error')
          return
        }
        if (isFoodListing && suggestedFoodSafetyClassification === 'high_risk' && form.foodSafetyClassification !== 'high_risk') {
          pushToast('This food selection must be marked as high risk before publishing.', 'error')
          return
        }
        if (requiresHighRiskFoodFields) {
          if (!form.foodIngredients.trim()) {
            pushToast('Ingredients are required for high-risk food listings.', 'error')
            return
          }
          if (!form.foodPreparationLocation) {
            pushToast('Preparation location is required for high-risk food listings.', 'error')
            return
          }
        }
        if (form.willingToDeliver) {
          if (!form.deliveryPickupInstructions.trim()) {
            pushToast('Pickup instructions are required when requesting a Civil driver.', 'error')
            return
          }
        }
      }

      const deliveryOptions: { pickupInstructions?: string; itemIsHeavy?: boolean; itemIsBulky?: boolean; itemIsSmall?: boolean } = {}
      if (form.willingToDeliver) {
        deliveryOptions.pickupInstructions = form.deliveryPickupInstructions.trim()
        if (form.deliveryTraits.itemIsHeavy) deliveryOptions.itemIsHeavy = true
        if (form.deliveryTraits.itemIsBulky) deliveryOptions.itemIsBulky = true
        if (form.deliveryTraits.itemIsSmall) deliveryOptions.itemIsSmall = true
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
            foodSafetyClassification: isFoodListing ? form.foodSafetyClassification || null : null,
            foodIngredients: requiresHighRiskFoodFields ? form.foodIngredients.trim() || null : null,
            foodPreparationLocation: requiresHighRiskFoodFields ? form.foodPreparationLocation || null : null,
            foodStorageMethod: null,
            foodTags: isFoodListing ? form.foodTags : [],
            foodExpiryDate: requiresHighRiskFoodFields ? form.foodExpiryDate.trim() || null : null,
            pickupCity: form.pickupCity.trim() || null,
            pickupProvince: form.pickupProvince.trim() || null,
            pickupAddressLine1: form.pickupAddressLine1.trim() || null,
            pickupAddressLine2: form.pickupAddressLine2.trim() || null,
            pickupPostalCode: form.pickupPostalCode.trim() || null,
            paymentTypes: form.paymentTypes,
            willingToDeliver: form.willingToDeliver,
            deliveryOptions,
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
    [descriptionPlainText, descriptionTooLong, form, listingId, resolveWalletETransferEmail, router, statusLabel],
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

        {hasOrganization === false ? (
          <section className={editorCardClassName}>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
              <p className="text-sm font-semibold text-slate-900">Did you know? If you'd like to create an E-Commerce store, it's free on Civil!</p>
              <p className="mt-2 text-sm text-slate-700">Get access to features like inventory management, free local delivery, repeat customers and grow your business!</p>
              <div className="mt-4">
                <Link
                  href="/organizations/manager"
                  className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Create an organization
                </Link>
              </div>
            </div>
          </section>
        ) : null}

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
                  {aiCategorizing ? 'Autodetecting with Civil AI…' : 'Autodetect with Civil AI'}
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

            {isFoodListing ? (
              <section className={editorCardClassName}>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Food safety</p>
                    <p className="text-xs text-slate-600">Civil collects seller-provided food handling details for buyers. Civil does not certify or regulate food listings.</p>
                  </div>

                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${suggestedFoodSafetyClassification === 'high_risk' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
                    {suggestedFoodSafetyClassification === 'high_risk'
                      ? 'This looks like a high-risk food item. Additional seller-provided details are required before publishing.'
                      : 'Every food listing must choose a safety classification so buyers can review seller-provided handling details.'}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={saving || initializing || !canEditActiveDraftListing || suggestedFoodSafetyClassification === 'high_risk'}
                      onClick={() => setForm((prev) => ({ ...prev, foodSafetyClassification: 'low_risk' }))}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${form.foodSafetyClassification === 'low_risk' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="block text-sm font-semibold">Low Risk Food</span>
                      <span className="mt-1 block text-xs text-slate-500">Examples: bread, cookies, dry goods, whole fruits, whole vegetables.</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving || initializing || !canEditActiveDraftListing}
                      onClick={() => setForm((prev) => ({ ...prev, foodSafetyClassification: 'high_risk' }))}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${form.foodSafetyClassification === 'high_risk' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      <span className="block text-sm font-semibold">High Risk Food</span>
                      <span className="mt-1 block text-xs text-slate-500">Examples: meat, dairy, cooked meals, perishable beverages, frozen prepared food.</span>
                    </button>
                  </div>

                  {requiresHighRiskFoodFields ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Please ensure to package your food with an expire or best before date and handling instructions.
                    </div>
                  ) : null}

                  {requiresHighRiskFoodFields ? (
                    <div className="mt-4 space-y-4">

                      <label className="block space-y-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ingredients list</span>
                        <textarea
                          value={form.foodIngredients}
                          onChange={(event) => setForm((prev) => ({ ...prev, foodIngredients: event.target.value }))}
                          rows={4}
                          disabled={saving || initializing || !canEditActiveDraftListing}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                          placeholder="List ingredients and major allergens exactly as the seller wants buyers to read them."
                        />
                      </label>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Food tags</span>
                          <div className="flex flex-wrap gap-2">
                            {FOOD_TAG_OPTIONS.map((option) => {
                              const selected = form.foodTags.includes(option.value)
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  disabled={saving || initializing || !canEditActiveDraftListing}
                                  onClick={() =>
                                    setForm((prev) => ({
                                      ...prev,
                                      foodTags: prev.foodTags.includes(option.value)
                                        ? prev.foodTags.filter((entry) => entry !== option.value)
                                        : [...prev.foodTags, option.value],
                                    }))
                                  }
                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selected ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
                                >
                                  {option.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preparation location</span>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              disabled={saving || initializing || !canEditActiveDraftListing}
                              onClick={() => setForm((prev) => ({ ...prev, foodPreparationLocation: 'home_kitchen' }))}
                              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${form.foodPreparationLocation === 'home_kitchen' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
                            >
                              Home kitchen
                            </button>
                            <button
                              type="button"
                              disabled={saving || initializing || !canEditActiveDraftListing}
                              onClick={() => setForm((prev) => ({ ...prev, foodPreparationLocation: 'certified_kitchen' }))}
                              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${form.foodPreparationLocation === 'certified_kitchen' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
                            >
                              Certified kitchen
                            </button>
                          </div>
                        </div>
                      </div>

                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

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

              {!quickSelectOptions.saved.length ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  In order for you to create listing, please add an address by clicking <Link href="/market/account" className="font-semibold underline underline-offset-2">here</Link>.
                </div>
              ) : null}

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

              {!selectedStructuredQuickSelect ? (
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
              ) : null}

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
              <p className="text-sm font-semibold text-slate-900">Delivery</p>
              <p className="mt-1 text-xs text-slate-600">
                Request delivery from a Certified Civil Driver after you select a buyer.
              </p>

              <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.willingToDeliver}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      willingToDeliver: event.target.checked,
                      ...(event.target.checked
                        ? {}
                        : {
                            deliveryPickupInstructions: '',
                            deliveryTraits: {
                              itemIsHeavy: false,
                              itemIsBulky: false,
                              itemIsSmall: false,
                            },
                          }),
                    }))
                  }
                />
                Request Delivery from a Certified Civil Driver
              </label>

              {form.willingToDeliver ? (
                <div className="mt-3 space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pickup instructions</span>
                    <textarea
                      value={form.deliveryPickupInstructions}
                      onChange={(event) => setForm((prev) => ({ ...prev, deliveryPickupInstructions: event.target.value }))}
                      rows={4}
                      disabled={saving || initializing || !canEditActiveDraftListing}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                      placeholder="Door code, preferred pickup window, stairs, parking notes, loading instructions, or anything your Civil driver should know."
                    />
                  </label>

                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item details</span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'itemIsHeavy', label: 'Item is heavy' },
                        { key: 'itemIsBulky', label: 'Item is bulky' },
                        { key: 'itemIsSmall', label: 'Item is small' },
                      ].map((option) => (
                        <label key={option.key} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.deliveryTraits[option.key as keyof DraftForm['deliveryTraits']]}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                deliveryTraits: {
                                  ...prev.deliveryTraits,
                                  [option.key]: event.target.checked,
                                },
                              }))
                            }
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    Civil drivers will see the buyer, seller, product photo, and your pickup notes before bidding on the contract.
                  </div>
                </div>
              ) : null}
            </div>
            </section>

            <section className={editorCardClassName}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Payment options</p>
              <p className="mt-1 text-xs text-slate-500">
                Your eTransfer account stays private until you choose a buyer.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void togglePaymentType('civil_wallet')}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${form.paymentTypes.includes('civil_wallet') ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  {form.paymentTypes.includes('civil_wallet') ? <HiCheck className="h-3.5 w-3.5" /> : null}
                  Civil Wallet
                </button>
                <button
                  type="button"
                  onClick={() => void togglePaymentType('cash_pickup')}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${form.paymentTypes.includes('cash_pickup') ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  {form.paymentTypes.includes('cash_pickup') ? <HiCheck className="h-3.5 w-3.5" /> : null}
                  Cash on pickup
                </button>
                <button
                  type="button"
                  onClick={() => void togglePaymentType('etransfer')}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${form.paymentTypes.includes('etransfer') ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  {form.paymentTypes.includes('etransfer') ? <HiCheck className="h-3.5 w-3.5" /> : null}
                  eTransfer
                </button>
              </div>

              {form.paymentTypes.includes('civil_wallet') ? (
                <div className={`mt-4 rounded-2xl border p-4 ${walletCivilPayEnabled ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50'}`}>
                  <p className="text-sm font-semibold text-slate-900">Civil Pay enabled</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Buyers can complete the sale with Civil Wallet after you select them. Civil records the fee in the global ledger and keeps the funds on the platform until you withdraw later.
                  </p>
                  {!walletCivilPayEnabled ? <p className="mt-2 text-sm text-amber-700">Enable wallet payouts in Wallet before using Civil Wallet on listings.</p> : null}
                </div>
              ) : null}

              {form.paymentTypes.includes('etransfer') ? (
                <div className={`mt-4 rounded-2xl border p-4 ${walletMarketEnabled ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">eTransfer email</p>
                      <p className="mt-1 text-sm text-slate-600">Managed in Wallet. Update it there if you need to change where buyers send payment.</p>
                    </div>
                    <Link
                      href="/wallet"
                      className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      Open Wallet
                    </Link>
                  </div>
                  <input
                    value={walletMarketEnabled ? walletETransferEmail : ''}
                    readOnly
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none"
                    placeholder="No wallet eTransfer address enabled for Market"
                  />
                  {!walletMarketEnabled ? (
                    <p className="mt-2 text-sm text-amber-700">Enable an eTransfer address for Market in Wallet before you enable eTransfer on this listing.</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            </section>

          </fieldset>

            <Modal open={walletSetupModalOpen} onClose={() => setWalletSetupModalOpen(false)} title="Set up your wallet first" maxWidthClassName="max-w-lg">
              <div className="space-y-4">
                <p className="text-sm leading-6 text-slate-600">
                  Add an eTransfer address in your wallet first. It is used to help you buy and sell things. When you choose a buyer,
                  Civil will automatically show your eTransfer email address to the buyer.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/wallet"
                    onClick={() => setWalletSetupModalOpen(false)}
                    className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
                  >
                    Open Wallet
                  </Link>
                  <button
                    type="button"
                    onClick={() => setWalletSetupModalOpen(false)}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </Modal>

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
