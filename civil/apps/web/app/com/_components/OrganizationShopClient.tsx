'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCanadaSalesTaxCatalogResponse, buildCanadaSalesTaxRatesByPreset, normalizeCanadaSalesTaxRatesByRegion } from '@civil/shared'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Area } from 'react-easy-crop'
import { HiOutlineArrowLeft } from 'react-icons/hi2'
import CivilPostMedia from '../../_components/CivilPostMedia'
import PhotoUpdateModal from '../../_components/PhotoUpdateModal'
import { CanadianAddressEditor } from '../../_components/address/CanadianAddressEditor'
import RichTextEditor from '../../_components/RichTextEditor'
import { buildApiUrl } from '../../_lib/api'
import { createEmptyCanadianAddress, hasCanadianAddressValue, normalizeCanadianAddress, type CanadianAddress } from '../../_lib/canadianAddresses'
import { computeFallbackCropArea, generateCroppedImageBlob, generateCroppedImageBlobFromUrl } from '../../_lib/imageCrop'
import { getStoredToken } from '../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../_lib/authModal'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { useViewerStore } from '../../_lib/viewerStore'
import { pushToast } from '../../_components/useToasts'
import { addMarketCartItem, readMarketCart, writeMarketCart } from '../../market/_lib/cart'
import { MARKET_LISTING_SECTIONS, getMarketListingCategory, getMarketListingSection } from '../../market/_lib/listingCategories'

type ShopWarehouse = {
  id: string
  name: string
  address: string | null
  isHeadOffice: boolean
}

type ShopShippingPolicy = 'local_shipping' | 'civil_driver_contracts' | 'provincial' | 'national' | 'international'

type ShopShippingOption = {
  policy: ShopShippingPolicy
  enabled: boolean
  weightGrams?: number | null
  flatRateFeeCents?: number | null
}

type ShopProduct = {
  id: string
  slug?: string | null
  catalogId?: string | null
  name: string
  description: string | null
  listingSection?: string | null
  listingCategory?: string | null
  listingSubcategory?: string | null
  featuredHomepage?: boolean
  taxCollect?: boolean
  taxRatesByRegion?: Record<string, string>
  priceCents: number
  currency: string
  sku: string | null
  primaryImageUrl?: string | null
  galleryImageUrls?: string[]
  fulfillmentType?: string
  digitalDeliveryUrl?: string | null
  weightGrams?: number | null
  shippingPolicy?: 'local_community' | 'provincial' | 'national' | 'international'
  allowShippingContracts?: boolean
  shippingOptions?: ShopShippingOption[]
  isDraft?: boolean
  isActive: boolean
  trackInventory: boolean
  inventoryTotal: number
  inventoryByWarehouse: Array<{ warehouseId: string; quantity: number; updatedAt: string }>
  createdAt: string
}

type ShopCatalog = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  sortOrder?: number
  enabled: boolean
  createdAt: string
}

type ShopResponse = {
  canManage?: boolean
  catalogs?: ShopCatalog[]
  warehouses?: ShopWarehouse[]
  products?: ShopProduct[]
}

type ShopOrderItem = {
  productId: string | null
  name: string
  priceCents: number
  quantity: number
  fulfillmentType: string
}

type ShopOrder = {
  id: string
  status: string
  currency: string
  subtotalCents: number
  taxCents: number
  civilFeeCents: number
  stripeFeeCents: number
  feeCents: number
  totalCents: number
  createdAt: string
  paymentMethod: string | null
  paymentStatus: string | null
  itemCount: number
  buyer: {
    id: string
    name?: string | null
    handle?: string | null
    email?: string | null
  } | null
  items: ShopOrderItem[]
}

type ShopOrdersResponse = {
  items?: ShopOrder[]
}

type ShopConnectStatus = {
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

type CatalogEditDraft = {
  title: string
  description: string
  imageUrl: string
  enabled: boolean
}

type ProductEditDraft = {
  catalogId: string
  featuredHomepage: boolean
  listingSection: string
  listingCategory: string
  listingSubcategory: string
  name: string
  description: string
  priceDollars: string
  sku: string
  fulfillmentType: 'physical' | 'digital'
  digitalDeliveryUrl: string
  trackInventory: boolean
  shippingOptions: Array<{
    policy: ShopShippingPolicy
    enabled: boolean
    weightGrams: string
    flatRateFeeDollars: string
  }>
  primaryImageUrl: string
  galleryImageUrls: string[]
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

type ShopImageTarget =
  | { kind: 'catalog'; catalogId: string }
  | { kind: 'product-primary'; productId: string }
  | { kind: 'product-gallery'; productId: string; galleryIndex: number }

type ShopImageDraft = {
  sourceFile: File | null
  cropperImageUrl: string | null
  sourceImageUrl: string | null
  crop: { x: number; y: number }
  zoom: number
  croppedAreaPixels: Area | null
  uploadStatus: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  uploadError: string | null
}

type CanadaSalesTaxRatesResponse = {
  asOf: string
  regions: Array<{
    code: string
    name: string
    defaultRatePct: number
    options: Array<{ label: string; ratePct: number }>
  }>
}

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const PHOTO_MAX_BYTES = 25 * 1024 * 1024
const CATALOG_BANNER_ASPECT = 16 / 5
const PRODUCT_PRIMARY_ASPECT = 4 / 3
const CATALOG_BANNER_WIDTH = 1920
const CATALOG_BANNER_HEIGHT = 600
const PRODUCT_PRIMARY_WIDTH = 1600
const PRODUCT_PRIMARY_HEIGHT = 1200
const MAX_CROP_ZOOM = 3
const SHOP_SHIPPING_OPTION_ROWS: Array<{ policy: ShopShippingPolicy; label: string }> = [
  { policy: 'local_shipping', label: 'Local Shipping' },
  { policy: 'civil_driver_contracts', label: 'Local Delivery Contracts from Civil Drivers?' },
  { policy: 'provincial', label: 'Provincial' },
  { policy: 'national', label: 'National' },
  { policy: 'international', label: 'International' },
]

const TAX_REGION_CODES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const
const CURRENT_CANADA_TAX_SELECTION = 'canada_current'
const DEFAULT_TAX_RATE_CATALOG = (() => {
  const response = buildCanadaSalesTaxCatalogResponse()
  const byCode: Record<string, { name: string; defaultRatePct: number; options: Array<{ label: string; ratePct: number }> }> = {}
  for (const region of response.regions) {
    byCode[String(region.code).toUpperCase()] = {
      name: region.name,
      defaultRatePct: Number(region.defaultRatePct) || 0,
      options: Array.isArray(region.options) ? region.options : [],
    }
  }
  return {
    asOf: response.asOf,
    byCode,
  }
})()

const listingTypeSummary = (section?: string | null, category?: string | null, subcategory?: string | null) => {
  const parts = [section, category, subcategory].map((value) => (value ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

const parseWarehouseAddress = (value?: string | null): CanadianAddress => {
  if (!value) return createEmptyCanadianAddress()

  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return createEmptyCanadianAddress()

  const countryLine = lines.length >= 2 ? (lines[lines.length - 1] ?? 'CA') : 'CA'
  const cityLine = lines.length >= 2 ? (lines[lines.length - 2] ?? '') : ''
  const addressLines = lines.slice(0, Math.max(1, lines.length - 2))
  const [line1 = '', line2 = ''] = addressLines
  const [cityPart, provincePostal = ''] = cityLine.includes(',') ? cityLine.split(/,(.+)/).map((part) => part.trim()) : ['', cityLine]
  const [province = '', ...postalParts] = provincePostal.split(/\s+/).filter(Boolean)

  return normalizeCanadianAddress({
    line1,
    line2,
    city: cityPart,
    province,
    postalCode: postalParts.join(' '),
    country: countryLine || 'CA',
  })
}

const formatCurrency = (priceCents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CAD' }).format((priceCents || 0) / 100)

const formatOrderDateTime = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const stripHtmlToPlainText = (value: string | null | undefined) =>
  (value ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

const reorderCatalogRows = (items: ShopCatalog[], draggedId: string, targetId: string): ShopCatalog[] => {
  if (!draggedId || !targetId || draggedId === targetId) return items
  const fromIndex = items.findIndex((item) => item.id === draggedId)
  const toIndex = items.findIndex((item) => item.id === targetId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) return items
  next.splice(toIndex, 0, moved)
  return next
}

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

const buildInventorySnapshot = (source: Record<string, number>, fallback: Array<{ warehouseId: string; quantity: number; updatedAt: string }>) => {
  const now = new Date().toISOString()
  const updatedAtByWarehouse = new Map(fallback.map((entry) => [entry.warehouseId, entry.updatedAt]))
  const inventoryByWarehouse = Object.entries(source).map(([warehouseId, quantity]) => ({
    warehouseId,
    quantity: Math.max(0, Math.round(Number(quantity) || 0)),
    updatedAt: updatedAtByWarehouse.get(warehouseId) ?? now,
  }))

  return {
    inventoryByWarehouse,
    inventoryTotal: inventoryByWarehouse.reduce((sum, entry) => sum + entry.quantity, 0),
  }
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

const readRemoteImageDimensions = async (imageUrl: string): Promise<{ width: number; height: number } | null> => {
  try {
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
      }
      img.onerror = () => {
        resolve(null)
      }
      img.src = imageUrl
    })
  } catch {
    return null
  }
}

const createShopImageDraft = (): ShopImageDraft => ({
  sourceFile: null,
  cropperImageUrl: null,
  sourceImageUrl: null,
  crop: { x: 0, y: 0 },
  zoom: 1,
  croppedAreaPixels: null,
  uploadStatus: 'idle',
  uploadError: null,
})

type ShopSettingsPanel = 'shipping' | 'stripe'

function normalizeShippingDraftOptions(product: ShopProduct): ProductEditDraft['shippingOptions'] {
  const byPolicy = new Map<ShopShippingPolicy, ProductEditDraft['shippingOptions'][number]>()
  for (const row of SHOP_SHIPPING_OPTION_ROWS) {
    byPolicy.set(row.policy, { policy: row.policy, enabled: false, weightGrams: '', flatRateFeeDollars: '' })
  }

  if (Array.isArray(product.shippingOptions) && product.shippingOptions.length > 0) {
    for (const option of product.shippingOptions) {
      if (!option || !byPolicy.has(option.policy)) continue
      byPolicy.set(option.policy, {
        policy: option.policy,
        enabled: option.policy === 'civil_driver_contracts' ? false : Boolean(option.enabled),
        weightGrams: option.weightGrams != null ? String(option.weightGrams) : '',
        flatRateFeeDollars: option.flatRateFeeCents != null ? (Math.max(0, option.flatRateFeeCents) / 100).toFixed(2) : '',
      })
    }
  } else {
    const primaryPolicy: ShopShippingPolicy = product.shippingPolicy === 'provincial'
      ? 'provincial'
      : product.shippingPolicy === 'national'
        ? 'national'
        : product.shippingPolicy === 'international'
          ? 'international'
          : 'local_shipping'
    byPolicy.set(primaryPolicy, {
      policy: primaryPolicy,
      enabled: true,
      weightGrams: product.weightGrams != null ? String(product.weightGrams) : '',
      flatRateFeeDollars: '',
    })
    if (product.allowShippingContracts) {
      byPolicy.set('civil_driver_contracts', {
        policy: 'civil_driver_contracts',
        enabled: true,
        weightGrams: product.weightGrams != null ? String(product.weightGrams) : '',
        flatRateFeeDollars: '',
      })
    }
  }

  return SHOP_SHIPPING_OPTION_ROWS.map((row) => byPolicy.get(row.policy) ?? { policy: row.policy, enabled: false, weightGrams: '', flatRateFeeDollars: '' })
}

function toDraft(product: ShopProduct): ProductEditDraft {
  return {
    catalogId: product.catalogId ?? '',
    featuredHomepage: Boolean(product.featuredHomepage),
    listingSection: product.listingSection ?? '',
    listingCategory: product.listingCategory ?? '',
    listingSubcategory: product.listingSubcategory ?? '',
    name: product.name,
    description: product.description ?? '',
    priceDollars: ((product.priceCents || 0) / 100).toFixed(2),
    sku: product.sku ?? '',
    fulfillmentType: String(product.fulfillmentType || 'physical').toLowerCase() === 'digital' ? 'digital' : 'physical',
    digitalDeliveryUrl: product.digitalDeliveryUrl ?? '',
    trackInventory: product.trackInventory,
    shippingOptions: normalizeShippingDraftOptions(product),
    primaryImageUrl: product.primaryImageUrl ?? '',
    galleryImageUrls: Array.isArray(product.galleryImageUrls) ? product.galleryImageUrls : [],
  }
}

export default function OrganizationShopClient({
  province,
  municipality,
  slug,
  mode = 'manage',
  focusProductId,
  focusProductSlug,
  manageSection,
}: {
  province: string
  municipality: string
  slug: string
  mode?: 'storefront' | 'manage' | 'new'
  focusProductId?: string
  focusProductSlug?: string
  manageSection?: 'products' | 'catalogs' | 'warehouses' | 'orders' | 'settings'
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const cachedMe = useViewerStore((s) => s.me)
  const [catalogs, setCatalogs] = useState<ShopCatalog[]>([])
  const [warehouses, setWarehouses] = useState<ShopWarehouse[]>([])
  const [products, setProducts] = useState<ShopProduct[]>([])
  const [newCatalogDraft, setNewCatalogDraft] = useState<CatalogEditDraft>({ title: '', description: '', imageUrl: '', enabled: true })
  const [newWarehouseName, setNewWarehouseName] = useState('')
  const [newWarehouseAddress, setNewWarehouseAddress] = useState<CanadianAddress>(createEmptyCanadianAddress())
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null)
  const [showNewCatalogForm, setShowNewCatalogForm] = useState(false)
  const [showNewWarehouseForm, setShowNewWarehouseForm] = useState(false)
  const [catalogDrafts, setCatalogDrafts] = useState<Record<string, CatalogEditDraft>>({})
  const [draggingCatalogId, setDraggingCatalogId] = useState<string | null>(null)
  const [dragOverCatalogId, setDragOverCatalogId] = useState<string | null>(null)
  const [inventoryDraft, setInventoryDraft] = useState<Record<string, Record<string, number>>>({})
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductEditDraft>>({})
  const [taxDrafts, setTaxDrafts] = useState<
    Record<
      string,
      {
        collectTax: boolean
        selectionKey: string
        ratesByRegion: Record<string, string>
      }
    >
  >({})
  const [taxRateCatalog, setTaxRateCatalog] = useState<null | {
    asOf: string
    byCode: Record<string, { name: string; defaultRatePct: number; options: Array<{ label: string; ratePct: number }> }>
  }>(DEFAULT_TAX_RATE_CATALOG)
  const [connectStatus, setConnectStatus] = useState<ShopConnectStatus | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)
  const [orders, setOrders] = useState<ShopOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderSearchQuery, setOrderSearchQuery] = useState('')
  const [orderDateFrom, setOrderDateFrom] = useState('')
  const [orderDateTo, setOrderDateTo] = useState('')

  const [pendingProductStatusChange, setPendingProductStatusChange] = useState<null | { productId: string; nextStatus: 'DRAFT' | 'PUBLISHED' }>(null)
  const [showProductPublishModal, setShowProductPublishModal] = useState(false)
  const [showProductUnpublishModal, setShowProductUnpublishModal] = useState(false)
  const [pendingDeleteProductId, setPendingDeleteProductId] = useState<string | null>(null)
  const [showProductDeleteModal, setShowProductDeleteModal] = useState(false)
  const [pendingDeleteWarehouseId, setPendingDeleteWarehouseId] = useState<string | null>(null)
  const [showWarehouseDeleteModal, setShowWarehouseDeleteModal] = useState(false)

  const [showInventoryAdjustModal, setShowInventoryAdjustModal] = useState(false)
  const [inventoryAdjustProductId, setInventoryAdjustProductId] = useState<string | null>(null)
  const [inventoryAdjustWarehouseId, setInventoryAdjustWarehouseId] = useState<string>('')
  const [inventoryAdjustDirection, setInventoryAdjustDirection] = useState<'add' | 'remove'>('add')
  const [inventoryAdjustQuantity, setInventoryAdjustQuantity] = useState<string>('')
  const [inventoryAdjustBatchNumber, setInventoryAdjustBatchNumber] = useState<string>('')
  const [inventoryAdjustReason, setInventoryAdjustReason] = useState<string>('')
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [authTokenReady, setAuthTokenReady] = useState(false)
  const [shopImageTarget, setShopImageTarget] = useState<ShopImageTarget | null>(null)
  const [shopImageDraft, setShopImageDraft] = useState<ShopImageDraft>(() => createShopImageDraft())

  const catalogImageInputRef = useRef<HTMLInputElement | null>(null)
  const productPrimaryImageInputRef = useRef<HTMLInputElement | null>(null)

  const shopPath = useMemo(
    () => `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop`,
    [municipality, province, slug],
  )

  const baseComPath = useMemo(
    () => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
    [municipality, province, slug],
  )

  const manageBaseComHref = useMemo(() => `${baseComPath}/shop/manage`, [baseComPath])
  const manageProductsComHref = useMemo(() => `${baseComPath}/shop/manage/products`, [baseComPath])

  const [settingsPanel, setSettingsPanel] = useState<ShopSettingsPanel>('shipping')
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  useEffect(() => {
    setAuthToken(getStoredToken())
    setAuthTokenReady(true)
  }, [])

  const resetShopImageDraft = useCallback(() => {
    setShopImageDraft((current) => {
      if (current.cropperImageUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(current.cropperImageUrl)
      }
      return createShopImageDraft()
    })
  }, [])

  const closeShopImageModal = useCallback(() => {
    resetShopImageDraft()
    setShopImageTarget(null)
  }, [resetShopImageDraft])

  useEffect(() => {
    const currentUrl = shopImageDraft.cropperImageUrl
    return () => {
      if (currentUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [shopImageDraft.cropperImageUrl])

  const openCatalogImageEditor = useCallback(
    (catalogId: string, file?: File | null) => {
      const existingImageUrl = catalogDrafts[catalogId]?.imageUrl ?? null
      const sourceFile = file ?? null
      const cropperImageUrl = sourceFile ? URL.createObjectURL(sourceFile) : existingImageUrl
      setShopImageTarget({ kind: 'catalog', catalogId })
      setShopImageDraft((current) => {
        if (current.cropperImageUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(current.cropperImageUrl)
        }
        return {
          sourceFile,
          cropperImageUrl,
          sourceImageUrl: cropperImageUrl,
          crop: { x: 0, y: 0 },
          zoom: 1,
          croppedAreaPixels: null,
          uploadStatus: 'idle',
          uploadError: null,
        }
      })
    },
    [catalogDrafts],
  )

  const openProductPrimaryImageEditor = useCallback(
    (productId: string, file?: File | null) => {
      const existingImageUrl = productDrafts[productId]?.primaryImageUrl ?? null
      const sourceFile = file ?? null
      const cropperImageUrl = sourceFile ? URL.createObjectURL(sourceFile) : existingImageUrl
      setShopImageTarget({ kind: 'product-primary', productId })
      setShopImageDraft((current) => {
        if (current.cropperImageUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(current.cropperImageUrl)
        }
        return {
          sourceFile,
          cropperImageUrl,
          sourceImageUrl: cropperImageUrl,
          crop: { x: 0, y: 0 },
          zoom: 1,
          croppedAreaPixels: null,
          uploadStatus: 'idle',
          uploadError: null,
        }
      })
    },
    [productDrafts],
  )

  const openProductGalleryImageEditor = useCallback(
    (productId: string, galleryIndex: number, file?: File | null) => {
      const existingImageUrl = productDrafts[productId]?.galleryImageUrls?.[galleryIndex] ?? null
      const sourceFile = file ?? null
      const cropperImageUrl = sourceFile ? URL.createObjectURL(sourceFile) : existingImageUrl
      setShopImageTarget({ kind: 'product-gallery', productId, galleryIndex })
      setShopImageDraft((current) => {
        if (current.cropperImageUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(current.cropperImageUrl)
        }
        return {
          sourceFile,
          cropperImageUrl,
          sourceImageUrl: cropperImageUrl,
          crop: { x: 0, y: 0 },
          zoom: 1,
          croppedAreaPixels: null,
          uploadStatus: 'idle',
          uploadError: null,
        }
      })
    },
    [productDrafts],
  )

  const pickShopImageFile = useCallback(() => {
    if (!shopImageTarget) return
    if (shopImageTarget.kind === 'catalog') {
      catalogImageInputRef.current?.click()
      return
    }
    productPrimaryImageInputRef.current?.click()
  }, [shopImageTarget])

  const handleCatalogEditorFileChange = useCallback(
    (file: File | null) => {
      if (!shopImageTarget || shopImageTarget.kind !== 'catalog' || !file) return
      openCatalogImageEditor(shopImageTarget.catalogId, file)
    },
    [openCatalogImageEditor, shopImageTarget],
  )

  const handleProductPrimaryEditorFileChange = useCallback(
    (file: File | null) => {
      if (!shopImageTarget || !file) return
      if (shopImageTarget.kind === 'product-primary') {
        openProductPrimaryImageEditor(shopImageTarget.productId, file)
        return
      }
      if (shopImageTarget.kind === 'product-gallery') {
        openProductGalleryImageEditor(shopImageTarget.productId, shopImageTarget.galleryIndex, file)
      }
    },
    [openProductGalleryImageEditor, openProductPrimaryImageEditor, shopImageTarget],
  )

  const inferManageAccess = useCallback(
    async (token: string) => {
      try {
        const [mePayload, orgRes] = await Promise.all([
          cachedMe?.id ? Promise.resolve({ id: cachedMe.id } as { id?: string }) : ensureViewerMe({ token }),
          fetch(
            buildApiUrl(
              `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
            ),
            { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
          ),
        ])

        const viewerId = typeof (mePayload as any)?.id === 'string' ? ((mePayload as any).id as string) : null
        const orgPayload = orgRes.ok
          ? ((await orgRes.json().catch(() => null)) as { org?: { ownerId?: string | null; viewerRole?: 'OWNER' | 'MANAGER' | null } } | null)
          : null

        const viewerRole = orgPayload?.org?.viewerRole ?? null
        const inferredOwner = Boolean(viewerId && orgPayload?.org?.ownerId && viewerId === orgPayload.org.ownerId)
        return Boolean(inferredOwner || viewerRole === 'OWNER' || viewerRole === 'MANAGER')
      } catch {
        return false
      }
    },
    [cachedMe, municipality, province, slug],
  )

  const loadConnectStatus = useCallback(async () => {
    if (!canManage || mode !== 'manage') return

    const token = getStoredToken()
    if (!token) return

    setConnectLoading(true)
    try {
      const res = await fetch(buildApiUrl(`${shopPath}/connect/status`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      if (!res.ok) {
        setConnectStatus(null)
        return
      }

      const payload = (await res.json().catch(() => null)) as ShopConnectStatus | null
      if (!payload) {
        setConnectStatus(null)
        return
      }

      setConnectStatus({
        accountId: typeof payload.accountId === 'string' ? payload.accountId : null,
        chargesEnabled: Boolean((payload as any).chargesEnabled),
        payoutsEnabled: Boolean((payload as any).payoutsEnabled),
        detailsSubmitted: Boolean((payload as any).detailsSubmitted),
      })
    } catch {
      setConnectStatus(null)
    } finally {
      setConnectLoading(false)
    }
  }, [canManage, mode, shopPath])

  const startConnectOnboarding = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setConnectLoading(true)
    try {
      const accountRes = await fetch(buildApiUrl(`${shopPath}/connect/account`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!accountRes.ok) {
        pushToast('Unable to start payouts setup.', 'error')
        return
      }

      const onboardRes = await fetch(buildApiUrl(`${shopPath}/connect/onboard`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      const onboardPayload = (await onboardRes.json().catch(() => null)) as { url?: unknown } | null
      const url = typeof onboardPayload?.url === 'string' ? onboardPayload.url : null

      if (!onboardRes.ok || !url) {
        pushToast('Unable to open Stripe onboarding.', 'error')
        return
      }

      window.location.href = url
    } catch {
      pushToast('Unable to start payouts setup.', 'error')
    } finally {
      setConnectLoading(false)
    }
  }, [shopPath])

  const updateProductDraft = useCallback((productId: string, updater: (current: ProductEditDraft) => ProductEditDraft) => {
    setProductDrafts((prev) => {
      const current = prev[productId]
      if (!current) return prev
      return {
        ...prev,
        [productId]: updater(current),
      }
    })
  }, [])

  const renderShippingOptionsEditor = useCallback((productId: string, draft: ProductEditDraft) => {
    return (
      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Shipping policy</h4>
          <p className="mt-1 text-xs text-slate-500">Set which delivery options are available and the flat rate for each option.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full border-collapse text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Enabled</th>
                <th className="px-3 py-2 text-left">Shipping Policy</th>
                <th className="px-3 py-2 text-left">Weight</th>
                <th className="px-3 py-2 text-left">Flat Rate Fee</th>
              </tr>
            </thead>
            <tbody>
              {SHOP_SHIPPING_OPTION_ROWS.map((row) => {
                const isComingSoon = row.policy === 'civil_driver_contracts'
                const option = draft.shippingOptions.find((entry) => entry.policy === row.policy) ?? {
                  policy: row.policy,
                  enabled: false,
                  weightGrams: '',
                  flatRateFeeDollars: '',
                }
                return (
                  <tr key={row.policy} className="border-t border-slate-200 align-top">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isComingSoon ? false : option.enabled}
                        disabled={isComingSoon}
                        onChange={(event) =>
                          updateProductDraft(productId, (current) => ({
                            ...current,
                            shippingOptions: current.shippingOptions.map((entry) =>
                              entry.policy === row.policy ? { ...entry, enabled: event.target.checked } : entry,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">{isComingSoon ? `${row.label} (Coming Soon)` : row.label}</td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={option.weightGrams}
                        disabled={!option.enabled || isComingSoon}
                        onChange={(event) =>
                          updateProductDraft(productId, (current) => ({
                            ...current,
                            shippingOptions: current.shippingOptions.map((entry) =>
                              entry.policy === row.policy ? { ...entry, weightGrams: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="grams"
                        className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={option.flatRateFeeDollars}
                          disabled={!option.enabled || isComingSoon}
                          onChange={(event) =>
                            updateProductDraft(productId, (current) => ({
                              ...current,
                              shippingOptions: current.shippingOptions.map((entry) =>
                                entry.policy === row.policy ? { ...entry, flatRateFeeDollars: event.target.value } : entry,
                              ),
                            }))
                          }
                          placeholder="0.00"
                          className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }, [updateProductDraft])

  const load = useCallback(async () => {
    if (!authTokenReady) return

    setLoading(true)
    try {
      const fetchShop = (tokenOverride?: string | null) =>
        fetch(buildApiUrl(shopPath), {
          headers: tokenOverride ? { authorization: `Bearer ${tokenOverride}` } : undefined,
          cache: 'no-store',
        })

      let res = await fetchShop(authToken)
      if (!res.ok && authToken) {
        const hasManageAccess = await inferManageAccess(authToken)
        if (hasManageAccess) {
          setCanManage(true)
          res = await fetchShop(authToken)
        }
      }

      if (!res.ok) {
        setCatalogs([])
        setProducts([])
        setWarehouses([])
        setCanManage(false)
        return
      }

      const payload = (await res.json().catch(() => null)) as ShopResponse | null

      let canManageFinal = Boolean(payload?.canManage)
      if (!canManageFinal && authToken) {
        canManageFinal = await inferManageAccess(authToken)
      }

      const nextProducts = Array.isArray(payload?.products) ? payload.products : []
      const nextCatalogs = (Array.isArray(payload?.catalogs) ? payload.catalogs : []).sort((a, b) => {
        const orderA = Number(a.sortOrder ?? 0)
        const orderB = Number(b.sortOrder ?? 0)
        if (orderA !== orderB) return orderA - orderB
        return String(a.createdAt).localeCompare(String(b.createdAt))
      })
      const nextWarehouses = Array.isArray(payload?.warehouses) ? payload.warehouses : []
      setProducts(nextProducts)
      setCatalogs(nextCatalogs)
      setWarehouses(nextWarehouses)
      setCanManage(canManageFinal)

      const nextInventoryDraft: Record<string, Record<string, number>> = {}
      const nextProductDrafts: Record<string, ProductEditDraft> = {}
      const nextCatalogDrafts: Record<string, CatalogEditDraft> = {}
      nextCatalogs.forEach((catalog) => {
        nextCatalogDrafts[catalog.id] = {
          title: catalog.title,
          description: catalog.description ?? '',
          imageUrl: catalog.imageUrl ?? '',
          enabled: catalog.enabled,
        }
      })
      nextProducts.forEach((product) => {
        nextProductDrafts[product.id] = toDraft(product)
        const productInventoryDraft: Record<string, number> = {}
        nextWarehouses.forEach((warehouse) => {
          const found = product.inventoryByWarehouse.find((entry) => entry.warehouseId === warehouse.id)
          productInventoryDraft[warehouse.id] = found?.quantity ?? 0
        })
        nextInventoryDraft[product.id] = productInventoryDraft
      })
      setCatalogDrafts(nextCatalogDrafts)
      setProductDrafts(nextProductDrafts)
      setInventoryDraft(nextInventoryDraft)
      setTaxDrafts((prev) => {
        const next = { ...prev }
        nextProducts.forEach((product) => {
          const initialRatesByRegion = product.taxCollect
            ? normalizeCanadaSalesTaxRatesByRegion(product.taxRatesByRegion, { fallbackPreset: 'canada_current' })
            : {}
          next[product.id] = {
            collectTax: Boolean(product.taxCollect),
            selectionKey: CURRENT_CANADA_TAX_SELECTION,
            ratesByRegion: initialRatesByRegion,
          }
        })
        return next
      })

      setSelectedCatalogId((current) => {
        if (!current) return null
        return nextCatalogs.some((catalog) => catalog.id === current && catalog.enabled) ? current : null
      })
      setSelectedProductId((current) => {
        if (!current) return null
        return nextProducts.some((product) => product.id === current && product.isActive && !product.isDraft) ? current : null
      })
    } catch {
      setCatalogs([])
      setProducts([])
      setWarehouses([])
      setCanManage(false)
    } finally {
      setLoading(false)
    }
  }, [authToken, authTokenReady, inferManageAccess, shopPath])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    fetch(buildApiUrl('/tax/canada/sales-rates'), { cache: 'no-store' })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as CanadaSalesTaxRatesResponse | null
        if (!res.ok || !json?.regions?.length) return null
        const byCode: Record<string, { name: string; defaultRatePct: number; options: Array<{ label: string; ratePct: number }> }> = {}
        for (const region of json.regions) {
          if (!region?.code) continue
          byCode[String(region.code).toUpperCase()] = {
            name: region.name,
            defaultRatePct: Number(region.defaultRatePct) || 0,
            options: Array.isArray(region.options) ? region.options : [],
          }
        }
        return { asOf: json.asOf, byCode }
      })
      .then((payload) => {
        if (cancelled) return
        if (payload) setTaxRateCatalog(payload)
      })
      .catch(() => {
        // ignore: the shared default catalog is already loaded locally
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!canManage || mode !== 'manage') return
    void loadConnectStatus()
  }, [canManage, loadConnectStatus, mode])

  const loadOrders = useCallback(async () => {
    if (!canManage || mode !== 'manage' || manageSection !== 'orders') {
      setOrders([])
      setOrdersError(null)
      setOrdersLoading(false)
      return
    }

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setOrdersLoading(true)
    setOrdersError(null)
    try {
      const res = await fetch(buildApiUrl(`${shopPath}/orders?limit=200`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setOrders([])
        setOrdersError('Unable to load orders right now.')
        return
      }

      const payload = (await res.json().catch(() => null)) as ShopOrdersResponse | null
      setOrders(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setOrders([])
      setOrdersError('Unable to load orders right now.')
    } finally {
      setOrdersLoading(false)
    }
  }, [canManage, manageSection, mode, shopPath])

  useEffect(() => {
    if (mode !== 'manage' || manageSection !== 'orders') return
    if (!canManage) return
    void loadOrders()
  }, [canManage, loadOrders, manageSection, mode])

  const uploadMediaFile = useCallback(async (file: File) => {
    const token = getStoredToken()
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
  }, [])

  const createDraftProduct = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${shopPath}/products/draft`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; product?: { id?: string } } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to create product draft.', 'error')
        return
      }

      const createdProductId = typeof payload?.product?.id === 'string' ? payload.product.id : null
      if (mode === 'new' && createdProductId) {
        router.replace(`${baseComPath}/shop/manage/products/${encodeURIComponent(createdProductId)}`)
        return
      }

      await load()
    } catch {
      pushToast('Unable to create product draft.', 'error')
    } finally {
      setSaving(false)
    }
  }, [baseComPath, load, mode, router, shopPath])

  const saveProductDetails = useCallback(
    async (productId: string, options?: { isDraft?: boolean }) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }
      const draft = productDrafts[productId]
      if (!draft) return false
      const taxDraft = taxDrafts[productId] ?? { collectTax: false, selectionKey: CURRENT_CANADA_TAX_SELECTION, ratesByRegion: {} }

      const price = Number(draft.priceDollars)
      if (!Number.isFinite(price) || price < 0) {
        pushToast('Enter a valid product price.', 'error')
        return false
      }

      const shippingOptions = [] as Array<{
        policy: ShopShippingPolicy
        enabled: boolean
        weightGrams: number | null
        flatRateFeeCents: number | null
      }>
      for (const option of draft.shippingOptions) {
        const weightValue = option.weightGrams.trim()
        const feeValue = option.flatRateFeeDollars.trim()
        if (weightValue) {
          const parsedWeight = Number(weightValue)
          if (!Number.isFinite(parsedWeight) || parsedWeight < 0) {
            pushToast('Enter a valid shipping weight.', 'error')
            return false
          }
        }
        if (feeValue) {
          const parsedFee = Number(feeValue)
          if (!Number.isFinite(parsedFee) || parsedFee < 0) {
            pushToast('Enter a valid flat rate fee.', 'error')
            return false
          }
        }
        shippingOptions.push({
          policy: option.policy,
          enabled: option.enabled,
          weightGrams: weightValue ? Math.max(0, Math.round(Number(weightValue))) : null,
          flatRateFeeCents: feeValue ? Math.max(0, Math.round(Number(feeValue) * 100)) : null,
        })
      }

      setSaving(true)
      try {
        const res = await fetch(buildApiUrl(`${shopPath}/products/${encodeURIComponent(productId)}`), {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            catalogId: draft.catalogId || null,
            featuredHomepage: draft.featuredHomepage,
            listingSection: draft.listingSection.trim() || null,
            listingCategory: draft.listingCategory.trim() || null,
            listingSubcategory: draft.listingSubcategory.trim() || null,
            taxCollect: taxDraft.collectTax,
            taxRatesByRegion: taxDraft.ratesByRegion,
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            priceCents: Math.round(price * 100),
            currency: 'CAD',
            sku: draft.sku.trim() || null,
            fulfillmentType: draft.fulfillmentType,
            digitalDeliveryUrl: draft.digitalDeliveryUrl.trim() || null,
            trackInventory: draft.trackInventory,
            shippingOptions,
            isDraft: typeof options?.isDraft === 'boolean' ? options.isDraft : undefined,
          }),
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to save product details.', 'error')
          return false
        }
        pushToast(options?.isDraft === false ? 'Product published.' : options?.isDraft === true ? 'Product unpublished.' : 'Product details saved.', 'success')
        await load()
        return true
      } catch {
        pushToast('Unable to save product details.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [load, productDrafts, shopPath, taxDrafts],
  )

  const requestProductStatusChange = useCallback((productId: string, currentStatus: 'DRAFT' | 'PUBLISHED', nextStatus: 'DRAFT' | 'PUBLISHED') => {
    if (nextStatus === currentStatus) return
    setPendingProductStatusChange({ productId, nextStatus })
    if (nextStatus === 'PUBLISHED') {
      setShowProductPublishModal(true)
      return
    }
    setShowProductUnpublishModal(true)
  }, [])

  const confirmProductPublish = useCallback(async () => {
    const pending = pendingProductStatusChange
    if (!pending) return
    const ok = await saveProductDetails(pending.productId, { isDraft: false })
    if (ok) {
      setShowProductPublishModal(false)
      setPendingProductStatusChange(null)
    }
  }, [pendingProductStatusChange, saveProductDetails])

  const confirmProductUnpublish = useCallback(async () => {
    const pending = pendingProductStatusChange
    if (!pending) return
    const ok = await saveProductDetails(pending.productId, { isDraft: true })
    if (ok) {
      setShowProductUnpublishModal(false)
      setPendingProductStatusChange(null)
    }
  }, [pendingProductStatusChange, saveProductDetails])

  const deleteProduct = useCallback(
    async (productId: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }

      setSaving(true)
      try {
        const res = await fetch(buildApiUrl(`${shopPath}/products/${encodeURIComponent(productId)}`), {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to delete product.', 'error')
          return false
        }

        pushToast('Product deleted.', 'success')
        await load()
        router.replace(manageProductsComHref)
        return true
      } catch {
        pushToast('Unable to delete product.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [load, manageProductsComHref, router, shopPath],
  )

  const requestDeleteProduct = useCallback((productId: string) => {
    setPendingDeleteProductId(productId)
    setShowProductDeleteModal(true)
  }, [])

  const savePhotos = useCallback(
    async (productId: string, nextPrimaryImageUrl: string, nextGalleryImageUrls: string[]) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }
      const res = await fetch(buildApiUrl(`${shopPath}/products/${encodeURIComponent(productId)}/photos`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          primaryImageUrl: nextPrimaryImageUrl || null,
          galleryImageUrls: nextGalleryImageUrls,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        pushToast(payload?.error ?? 'Unable to save product photos.', 'error')
        return false
      }
      return true
    },
    [shopPath],
  )

  async function submitShopImageCrop() {
    if (!shopImageTarget || !shopImageDraft.sourceImageUrl) return

    const desiredAspect = shopImageTarget.kind === 'catalog' ? CATALOG_BANNER_ASPECT : PRODUCT_PRIMARY_ASPECT
    let cropArea = shopImageDraft.croppedAreaPixels

    if (!cropArea) {
      const dims = shopImageDraft.sourceFile
        ? await readImageDimensions(shopImageDraft.sourceFile)
        : await readRemoteImageDimensions(shopImageDraft.sourceImageUrl)
      if (!dims) {
        setShopImageDraft((current) => ({ ...current, uploadStatus: 'error', uploadError: 'Unable to read this image.' }))
        return
      }
      cropArea = computeFallbackCropArea(dims, desiredAspect)
      setShopImageDraft((current) => ({ ...current, croppedAreaPixels: cropArea }))
    }

    if (shopImageTarget.kind !== 'catalog') {
      setUploadingProductId(shopImageTarget.productId)
    }
    setShopImageDraft((current) => ({ ...current, uploadStatus: 'uploading', uploadError: null }))

    try {
      const options = shopImageTarget.kind === 'catalog'
        ? { width: CATALOG_BANNER_WIDTH, height: CATALOG_BANNER_HEIGHT, mime: 'image/jpeg' as const }
        : { width: PRODUCT_PRIMARY_WIDTH, height: PRODUCT_PRIMARY_HEIGHT, mime: 'image/jpeg' as const }

      const croppedBlob = shopImageDraft.sourceFile
        ? await generateCroppedImageBlob(shopImageDraft.sourceFile, cropArea, options)
        : await generateCroppedImageBlobFromUrl(shopImageDraft.sourceImageUrl, cropArea, options)

      if (!croppedBlob) {
        setShopImageDraft((current) => ({ ...current, uploadStatus: 'error', uploadError: 'Unable to crop this image.' }))
        return
      }

      const uploadFile = new File(
        [croppedBlob],
        shopImageTarget.kind === 'catalog'
          ? 'catalog-banner.jpg'
          : shopImageTarget.kind === 'product-gallery'
            ? `product-gallery-${shopImageTarget.galleryIndex + 1}.jpg`
            : 'product-primary.jpg',
        { type: croppedBlob.type || 'image/jpeg' },
      )

      const mediaUrl = await uploadMediaFile(uploadFile)
      if (!mediaUrl) {
        setShopImageDraft((current) => ({ ...current, uploadStatus: 'error', uploadError: 'Unable to upload the image.' }))
        return
      }

      if (shopImageTarget.kind === 'catalog') {
        const current = catalogDrafts[shopImageTarget.catalogId]
        if (!current) return
        const nextDraft = { ...current, imageUrl: mediaUrl }
        setCatalogDrafts((prev) => ({ ...prev, [shopImageTarget.catalogId]: nextDraft }))
        const ok = await saveCatalog(shopImageTarget.catalogId, nextDraft)
        if (ok) closeShopImageModal()
        return
      }

      const draft = productDrafts[shopImageTarget.productId]
      if (!draft) return

      if (shopImageTarget.kind === 'product-gallery') {
        const nextGalleryImageUrls = [...draft.galleryImageUrls]
        nextGalleryImageUrls[shopImageTarget.galleryIndex] = mediaUrl
        const ok = await savePhotos(shopImageTarget.productId, draft.primaryImageUrl, nextGalleryImageUrls)
        if (!ok) {
          setShopImageDraft((current) => ({ ...current, uploadStatus: 'error', uploadError: 'Unable to save the gallery image.' }))
          return
        }

        updateProductDraft(shopImageTarget.productId, (current) => ({ ...current, galleryImageUrls: nextGalleryImageUrls }))
        setProducts((prev) =>
          prev.map((product) =>
            product.id === shopImageTarget.productId ? { ...product, galleryImageUrls: nextGalleryImageUrls } : product,
          ),
        )
        pushToast('Gallery photo updated.', 'success')
        closeShopImageModal()
        return
      }

      const ok = await savePhotos(shopImageTarget.productId, mediaUrl, draft.galleryImageUrls)
      if (!ok) {
        setShopImageDraft((current) => ({ ...current, uploadStatus: 'error', uploadError: 'Unable to save the product image.' }))
        return
      }

      updateProductDraft(shopImageTarget.productId, (current) => ({ ...current, primaryImageUrl: mediaUrl }))
      setProducts((prev) =>
        prev.map((product) =>
          product.id === shopImageTarget.productId ? { ...product, primaryImageUrl: mediaUrl } : product,
        ),
      )
      pushToast('Primary photo updated.', 'success')
      closeShopImageModal()
    } finally {
      if (shopImageTarget.kind !== 'catalog') {
        setUploadingProductId(null)
      }
    }
  }

  const handleGalleryPhotoUpload = useCallback(
    async (productId: string, files: FileList | null) => {
      if (!files?.length) return
      setUploadingProductId(productId)
      try {
        const draft = productDrafts[productId]
        if (!draft) return
        const current = [...draft.galleryImageUrls]

        for (const file of Array.from(files)) {
          const mediaUrl = await uploadMediaFile(file)
          if (!mediaUrl) continue
          current.push(mediaUrl)
          if (current.length >= 12) break
        }

        const deduped = Array.from(new Set(current)).slice(0, 12)
        const ok = await savePhotos(productId, draft.primaryImageUrl, deduped)
        if (!ok) return
        updateProductDraft(productId, (current) => ({ ...current, galleryImageUrls: deduped }))
        setProducts((prev) =>
          prev.map((product) => (product.id === productId ? { ...product, galleryImageUrls: deduped } : product)),
        )
        pushToast('Gallery updated.', 'success')
      } finally {
        setUploadingProductId(null)
      }
    },
    [productDrafts, savePhotos, updateProductDraft, uploadMediaFile],
  )

  const saveInventory = useCallback(
    async (productId: string, override?: Record<string, number>) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }
      const source = override ?? inventoryDraft[productId] ?? {}
      const quantities = Object.entries(source).map(([warehouseId, quantity]) => ({
        warehouseId,
        quantity: Math.max(0, Math.round(Number(quantity) || 0)),
      }))
      if (!quantities.length) return true

      setSaving(true)
      try {
        const res = await fetch(buildApiUrl(`${shopPath}/products/${encodeURIComponent(productId)}/inventory`), {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ quantities }),
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to save inventory right now.', 'error')
          return false
        }
        const normalizedSource = Object.fromEntries(quantities.map((entry) => [entry.warehouseId, entry.quantity]))
        setInventoryDraft((prev) => ({
          ...prev,
          [productId]: normalizedSource,
        }))
        setProducts((prev) =>
          prev.map((product) => {
            if (product.id !== productId) return product
            const snapshot = buildInventorySnapshot(normalizedSource, product.inventoryByWarehouse)
            return {
              ...product,
              inventoryByWarehouse: snapshot.inventoryByWarehouse,
              inventoryTotal: snapshot.inventoryTotal,
            }
          }),
        )
        pushToast('Inventory updated.', 'success')
        return true
      } catch {
        pushToast('Unable to save inventory right now.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [inventoryDraft, shopPath],
  )

  const openInventoryAdjustModal = useCallback(
    (productId: string) => {
      setInventoryAdjustProductId(productId)
      const defaultWarehouseId = warehouses[0]?.id ?? ''
      setInventoryAdjustWarehouseId(defaultWarehouseId)
      setInventoryAdjustDirection('add')
      setInventoryAdjustQuantity('')
      setInventoryAdjustBatchNumber('')
      setInventoryAdjustReason('')
      setShowInventoryAdjustModal(true)
    },
    [warehouses],
  )

  const applyInventoryAdjustment = useCallback(async () => {
    const productId = inventoryAdjustProductId
    if (!productId) return
    if (!inventoryAdjustWarehouseId) {
      pushToast('Select a warehouse.', 'error')
      return
    }
    const magnitude = Math.max(0, Math.round(Number(inventoryAdjustQuantity) || 0))
    if (!magnitude) {
      pushToast('Enter an inventory amount.', 'error')
      return
    }

    const current = inventoryDraft[productId] ?? {}
    const currentQty = Math.max(0, Math.round(Number(current[inventoryAdjustWarehouseId]) || 0))
    const nextQty = inventoryAdjustDirection === 'add' ? currentQty + magnitude : Math.max(0, currentQty - magnitude)
    const next = {
      ...current,
      [inventoryAdjustWarehouseId]: nextQty,
    }
    setInventoryDraft((prev) => ({
      ...prev,
      [productId]: next,
    }))

    const saved = await saveInventory(productId, next)
    if (saved) setShowInventoryAdjustModal(false)
  }, [inventoryAdjustDirection, inventoryAdjustProductId, inventoryAdjustQuantity, inventoryAdjustWarehouseId, inventoryDraft, saveInventory])

  const createCatalog = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!newCatalogDraft.title.trim()) {
      pushToast('Catalog title is required.', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${shopPath}/catalogs`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: newCatalogDraft.title.trim(),
          description: newCatalogDraft.description.trim() || null,
          imageUrl: newCatalogDraft.imageUrl.trim() || null,
          enabled: newCatalogDraft.enabled,
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to create catalog.', 'error')
        return
      }
      setNewCatalogDraft({ title: '', description: '', imageUrl: '', enabled: true })
      setShowNewCatalogForm(false)
      pushToast('Catalog created.', 'success')
      await load()
    } catch {
      pushToast('Unable to create catalog.', 'error')
    } finally {
      setSaving(false)
    }
  }, [load, newCatalogDraft, shopPath])

  const createWarehouse = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!newWarehouseName.trim()) {
      pushToast('Warehouse name is required.', 'error')
      return
    }
    const normalizedWarehouseAddress = normalizeCanadianAddress(newWarehouseAddress)
    if (!normalizedWarehouseAddress.line1 || !normalizedWarehouseAddress.city || !normalizedWarehouseAddress.province || !normalizedWarehouseAddress.postalCode) {
      pushToast('Complete the full warehouse shipping address.', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${shopPath}/warehouses`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: newWarehouseName.trim(),
          address: {
            line1: normalizedWarehouseAddress.line1,
            line2: normalizedWarehouseAddress.line2 || null,
            city: normalizedWarehouseAddress.city,
            province: normalizedWarehouseAddress.province,
            postalCode: normalizedWarehouseAddress.postalCode,
            country: normalizedWarehouseAddress.country || 'CA',
          },
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to create warehouse.', 'error')
        return
      }
      setNewWarehouseName('')
      setNewWarehouseAddress(createEmptyCanadianAddress())
      setShowNewWarehouseForm(false)
      pushToast('Warehouse created.', 'success')
      await load()
    } catch {
      pushToast('Unable to create warehouse.', 'error')
    } finally {
      setSaving(false)
    }
  }, [load, newWarehouseAddress, newWarehouseName, shopPath])

  const resetWarehouseEditor = useCallback(() => {
    setEditingWarehouseId(null)
    setNewWarehouseName('')
    setNewWarehouseAddress(createEmptyCanadianAddress())
    setShowNewWarehouseForm(false)
  }, [])

  const startWarehouseEdit = useCallback((warehouse: ShopWarehouse) => {
    setEditingWarehouseId(warehouse.id)
    setNewWarehouseName(warehouse.name)
    setNewWarehouseAddress(parseWarehouseAddress(warehouse.address))
    setShowNewWarehouseForm(true)
  }, [])

  const updateWarehouse = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!editingWarehouseId) return
    if (!newWarehouseName.trim()) {
      pushToast('Warehouse name is required.', 'error')
      return
    }
    const normalizedWarehouseAddress = normalizeCanadianAddress(newWarehouseAddress)
    if (!normalizedWarehouseAddress.line1 || !normalizedWarehouseAddress.city || !normalizedWarehouseAddress.province || !normalizedWarehouseAddress.postalCode) {
      pushToast('Complete the full warehouse shipping address.', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${shopPath}/warehouses/${encodeURIComponent(editingWarehouseId)}`), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: newWarehouseName.trim(),
          address: {
            line1: normalizedWarehouseAddress.line1,
            line2: normalizedWarehouseAddress.line2 || null,
            city: normalizedWarehouseAddress.city,
            province: normalizedWarehouseAddress.province,
            postalCode: normalizedWarehouseAddress.postalCode,
            country: normalizedWarehouseAddress.country || 'CA',
          },
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to update warehouse.', 'error')
        return
      }
      pushToast('Warehouse updated.', 'success')
      resetWarehouseEditor()
      await load()
    } catch {
      pushToast('Unable to update warehouse.', 'error')
    } finally {
      setSaving(false)
    }
  }, [editingWarehouseId, load, newWarehouseAddress, newWarehouseName, resetWarehouseEditor, shopPath])

  const deleteWarehouse = useCallback(
    async (warehouseId: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }

      setSaving(true)
      try {
        const res = await fetch(buildApiUrl(`${shopPath}/warehouses/${encodeURIComponent(warehouseId)}`), {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to delete warehouse.', 'error')
          return false
        }

        pushToast('Warehouse deleted.', 'success')
        resetWarehouseEditor()
        await load()
        return true
      } catch {
        pushToast('Unable to delete warehouse.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [load, resetWarehouseEditor, shopPath],
  )

  const requestDeleteWarehouse = useCallback((warehouseId: string) => {
    setPendingDeleteWarehouseId(warehouseId)
    setShowWarehouseDeleteModal(true)
  }, [])

  const saveCatalog = useCallback(
    async (catalogId: string, draftOverride?: CatalogEditDraft) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }
      const draft = draftOverride ?? catalogDrafts[catalogId]
      if (!draft) return false
      if (!draft.title.trim()) {
        pushToast('Catalog title is required.', 'error')
        return false
      }

      setSaving(true)
      try {
        const res = await fetch(buildApiUrl(`${shopPath}/catalogs/${encodeURIComponent(catalogId)}`), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            title: draft.title.trim(),
            description: draft.description.trim() || null,
            imageUrl: draft.imageUrl.trim() || null,
            enabled: draft.enabled,
          }),
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to save catalog.', 'error')
          return false
        }
        setCatalogs((prev) =>
          prev.map((catalog) =>
            catalog.id === catalogId
              ? {
                  ...catalog,
                  title: draft.title.trim(),
                  description: draft.description.trim() || null,
                  imageUrl: draft.imageUrl.trim() || null,
                  enabled: draft.enabled,
                }
              : catalog,
          ),
        )
        pushToast('Catalog saved.', 'success')
        await load()
        return true
      } catch {
        pushToast('Unable to save catalog.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [catalogDrafts, load, shopPath],
  )

  const uploadCatalogImage = useCallback(
    async (catalogId: string, file: File | null) => {
      if (file) {
        openCatalogImageEditor(catalogId, file)
        return
      }
      openCatalogImageEditor(catalogId)
    },
    [openCatalogImageEditor],
  )

  const saveCatalogOrder = useCallback(
    async (orderedCatalogIds: string[]) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return false
      }

      const res = await fetch(buildApiUrl(`${shopPath}/catalogs/reorder`), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ catalogIds: orderedCatalogIds }),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        pushToast(payload?.error ?? 'Unable to reorder catalogs.', 'error')
        return false
      }

      return true
    },
    [shopPath],
  )

  const handleCatalogDrop = useCallback(
    async (targetCatalogId: string) => {
      if (!draggingCatalogId || draggingCatalogId === targetCatalogId) {
        setDraggingCatalogId(null)
        setDragOverCatalogId(null)
        return
      }

      const nextCatalogs = reorderCatalogRows(catalogs, draggingCatalogId, targetCatalogId)
      if (nextCatalogs === catalogs) {
        setDraggingCatalogId(null)
        setDragOverCatalogId(null)
        return
      }

      setCatalogs(nextCatalogs)
      setDraggingCatalogId(null)
      setDragOverCatalogId(null)

      const ok = await saveCatalogOrder(nextCatalogs.map((catalog) => catalog.id))
      if (!ok) {
        await load()
        return
      }
      pushToast('Catalog order updated.', 'success')
    },
    [catalogs, draggingCatalogId, load, saveCatalogOrder],
  )

  const enabledCatalogs = useMemo(() => catalogs.filter((catalog) => catalog.enabled), [catalogs])
  const visibleProducts = useMemo(
    () => products.filter((product) => product.isActive && !product.isDraft),
    [products],
  )
  const featuredProducts = useMemo(() => visibleProducts.filter((product) => product.featuredHomepage), [visibleProducts])
  const nonFeaturedProducts = useMemo(() => visibleProducts.filter((product) => !product.featuredHomepage), [visibleProducts])
  const hasCatalogs = enabledCatalogs.length > 0
  const catalogProductCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const product of visibleProducts) {
      const key = product.catalogId ?? ''
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [visibleProducts])
  const selectedCatalog = useMemo(
    () => enabledCatalogs.find((catalog) => catalog.id === selectedCatalogId) ?? null,
    [enabledCatalogs, selectedCatalogId],
  )
  const storefrontCatalogProducts = useMemo(() => {
    if (!selectedCatalogId) return []
    return visibleProducts.filter((product) => product.catalogId === selectedCatalogId)
  }, [selectedCatalogId, visibleProducts])
  const storefrontSelectedProduct = useMemo(
    () => visibleProducts.find((product) => product.id === selectedProductId) ?? null,
    [selectedProductId, visibleProducts],
  )
  const draftProducts = useMemo(() => products.filter((product) => product.isDraft), [products])
  const activeProducts = useMemo(() => products.filter((product) => !product.isDraft), [products])
  const sortedProducts = useMemo(() => {
    const next = [...products.filter((product) => product.isActive || product.isDraft)]
    next.sort((a, b) => {
      const at = new Date(a.createdAt).getTime()
      const bt = new Date(b.createdAt).getTime()
      return bt - at
    })
    return next
  }, [products])
  const editableProducts = useMemo(() => {
    const base = mode === 'new' ? products.filter((product) => product.isDraft) : products
    if (!focusProductId) return base
    return base.filter((product) => product.id === focusProductId)
  }, [focusProductId, mode, products])
  const orderStatusOptions = useMemo(() => {
    const values = Array.from(new Set(orders.map((order) => String(order.status || '').trim()).filter(Boolean)))
    return ['all', ...values]
  }, [orders])
  const filteredOrders = useMemo(() => {
    const searchNeedle = orderSearchQuery.trim().toLowerCase()

    return orders.filter((order) => {
      if (orderStatusFilter !== 'all' && order.status !== orderStatusFilter) return false

      const createdAtMs = new Date(order.createdAt).getTime()
      if (orderDateFrom) {
        const start = new Date(`${orderDateFrom}T00:00:00`).getTime()
        if (Number.isFinite(start) && createdAtMs < start) return false
      }
      if (orderDateTo) {
        const end = new Date(`${orderDateTo}T23:59:59.999`).getTime()
        if (Number.isFinite(end) && createdAtMs > end) return false
      }

      if (!searchNeedle) return true

      const buyerLabel = order.buyer
        ? [order.buyer.name, order.buyer.handle ? `@${order.buyer.handle}` : '', order.buyer.email].filter(Boolean).join(' ').toLowerCase()
        : 'guest guest checkout legacy'
      const itemLabel = order.items.map((item) => `${item.name} ${item.fulfillmentType}`).join(' ').toLowerCase()
      const orderIdLabel = order.id.toLowerCase()

      return buyerLabel.includes(searchNeedle) || itemLabel.includes(searchNeedle) || orderIdLabel.includes(searchNeedle)
    })
  }, [orderDateFrom, orderDateTo, orderSearchQuery, orderStatusFilter, orders])

  useEffect(() => {
    if (mode !== 'storefront') return
    if (!focusProductSlug && !focusProductId) return

    const target = focusProductSlug
      ? visibleProducts.find((product) => product.slug === focusProductSlug)
      : visibleProducts.find((product) => product.id === focusProductId)
    if (!target) {
      setSelectedProductId(null)
      return
    }

    setSelectedProductId(target.id)
    if (target.catalogId) {
      setSelectedCatalogId(target.catalogId)
    }
  }, [focusProductId, focusProductSlug, mode, visibleProducts])

  const [autoDraftAttempted, setAutoDraftAttempted] = useState(false)

  useEffect(() => {
    if (mode !== 'new') return
    if (autoDraftAttempted) return
    if (saving) return
    setAutoDraftAttempted(true)
    void createDraftProduct()
  }, [autoDraftAttempted, createDraftProduct, mode, saving])

  const addToCart = useCallback(
    (productId: string, delta = 1) => {
      const current = readMarketCart()
      const next = addMarketCartItem(current, productId, delta)
      writeMarketCart(next)
      window.dispatchEvent(new Event('civil:market-cart-changed'))
      pushToast('Added to cart.', 'success')
    },
    [],
  )

  const shopImageEditor = (
    <>
      <input
        ref={catalogImageInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="hidden"
        onChange={(event) => {
          handleCatalogEditorFileChange(event.target.files?.[0] ?? null)
          event.currentTarget.value = ''
        }}
      />

      <input
        ref={productPrimaryImageInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="hidden"
        onChange={(event) => {
          handleProductPrimaryEditorFileChange(event.target.files?.[0] ?? null)
          event.currentTarget.value = ''
        }}
      />

      <PhotoUpdateModal
        open={Boolean(shopImageTarget)}
        title={
          shopImageTarget?.kind === 'catalog'
            ? 'Edit catalog banner'
            : shopImageTarget?.kind === 'product-gallery'
              ? 'Edit gallery photo'
              : 'Edit primary product photo'
        }
        subtitle={
          shopImageTarget?.kind === 'catalog'
            ? 'Use a wide crop so the catalog reads as a banner across the shop.'
            : shopImageTarget?.kind === 'product-gallery'
              ? 'Adjust the framing for this gallery photo.'
              : 'Set the framing for the main product photo shown in the shop.'
        }
        imageUrl={shopImageDraft.sourceImageUrl}
        cropperImageUrl={shopImageDraft.cropperImageUrl}
        aspect={shopImageTarget?.kind === 'catalog' ? CATALOG_BANNER_ASPECT : PRODUCT_PRIMARY_ASPECT}
        cropShape="rect"
        showGrid
        crop={shopImageDraft.crop}
        zoom={shopImageDraft.zoom}
        maxZoom={MAX_CROP_ZOOM}
        onCropChange={(nextCrop) => setShopImageDraft((current) => ({ ...current, crop: nextCrop }))}
        onZoomChange={(nextZoom) => setShopImageDraft((current) => ({ ...current, zoom: nextZoom }))}
        onCropComplete={(_, areaPixels) => setShopImageDraft((current) => ({ ...current, croppedAreaPixels: areaPixels }))}
        onResetPosition={() =>
          setShopImageDraft((current) => ({
            ...current,
            crop: { x: 0, y: 0 },
            zoom: 1,
            croppedAreaPixels: null,
            uploadError: null,
          }))
        }
        onPickFile={pickShopImageFile}
        uploadStatus={shopImageDraft.uploadStatus}
        uploadError={shopImageDraft.uploadError}
        showCaption={false}
        caption=""
        onCaptionChange={() => undefined}
        primaryLabel={
          shopImageTarget?.kind === 'catalog'
            ? 'Save banner'
            : shopImageTarget?.kind === 'product-gallery'
              ? 'Save gallery photo'
              : 'Save primary photo'
        }
        primaryDisabled={!shopImageDraft.sourceImageUrl}
        primaryLoading={shopImageDraft.uploadStatus === 'uploading' || shopImageDraft.uploadStatus === 'processing'}
        primaryLoadingLabel={
          shopImageTarget?.kind === 'catalog'
            ? 'Saving banner…'
            : shopImageTarget?.kind === 'product-gallery'
              ? 'Saving gallery photo…'
              : 'Saving photo…'
        }
        onPrimary={() => {
          void submitShopImageCrop()
        }}
        onClose={closeShopImageModal}
      />
    </>
  )

  if (loading) {
    return <p className="text-sm text-slate-500">Loading shop…</p>
  }

  if (mode === 'storefront') {
    const storefrontProductHref = (product: ShopProduct) => {
      const productKey = product.slug?.trim() || product.id
      return `${baseComPath}/shop/${encodeURIComponent(productKey)}`
    }

    const renderProductCard = (product: ShopProduct) => (
      <button
        key={product.id}
        type="button"
        onClick={() => router.push(storefrontProductHref(product))}
        className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300"
      >
        {product.primaryImageUrl ? (
          <img src={product.primaryImageUrl} alt={product.name} className="mb-3 h-44 w-full rounded-xl border border-slate-200 object-cover" />
        ) : null}
        <p className="text-base font-semibold text-slate-900">{product.name}</p>
        {product.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{stripHtmlToPlainText(product.description)}</p> : null}
        <p className="mt-2 text-sm font-semibold text-slate-900">{formatCurrency(product.priceCents, product.currency)}</p>
      </button>
    )

    return (
      <div className="space-y-5">
        {storefrontSelectedProduct ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <button
              type="button"
              onClick={() => {
                if (focusProductSlug || focusProductId) {
                  router.push(`${baseComPath}/shop`)
                  return
                }
                setSelectedProductId(null)
              }}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              <HiOutlineArrowLeft className="h-4 w-4" />
              {selectedCatalog ? `Return to ${selectedCatalog.title}` : 'Return to products'}
            </button>

            {(() => {
              const productImages = Array.from(
                new Set(
                  [storefrontSelectedProduct.primaryImageUrl, ...(storefrontSelectedProduct.galleryImageUrls ?? [])].filter(
                    (value): value is string => Boolean(value && value.trim()),
                  ),
                ),
              )

              if (!productImages.length) return null

              return <CivilPostMedia images={productImages} />
            })()}

            <div>
              <h3 className="text-xl font-semibold text-slate-900">{storefrontSelectedProduct.name}</h3>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {formatCurrency(storefrontSelectedProduct.priceCents, storefrontSelectedProduct.currency)}
              </p>
              {storefrontSelectedProduct.description ? (
                <div
                  className="cc-article-rich-content mt-2 text-sm text-slate-600"
                  dangerouslySetInnerHTML={{ __html: storefrontSelectedProduct.description }}
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => addToCart(storefrontSelectedProduct.id, 1)}
                className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-xs font-semibold text-white transition hover:brightness-110"
              >
                Add to cart
              </button>
              <Link
                href="/market/cart"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                View cart & checkout
              </Link>
            </div>
          </section>
        ) : hasCatalogs && selectedCatalog ? (
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setSelectedCatalogId(null)}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              <HiOutlineArrowLeft className="h-4 w-4" />
              Return to catalogs
            </button>

            <div>
              <h3 className="text-lg font-semibold text-slate-900">{selectedCatalog.title}</h3>
              {selectedCatalog.description ? <p className="mt-1 text-sm text-slate-600">{selectedCatalog.description}</p> : null}
            </div>

            {storefrontCatalogProducts.length ? (
              <div className="grid gap-3 sm:grid-cols-2">{storefrontCatalogProducts.map(renderProductCard)}</div>
            ) : (
              <p className="text-sm text-slate-500">No products in this catalog yet.</p>
            )}
          </section>
        ) : (
          <>
            {featuredProducts.length ? (
              <section className="space-y-3">
                <h3 className="text-lg font-semibold text-slate-900">Featured products</h3>
                <div className="grid gap-3 sm:grid-cols-2">{featuredProducts.map(renderProductCard)}</div>
              </section>
            ) : null}

            {hasCatalogs ? (
              <section className="space-y-3">
                <h3 className="text-lg font-semibold text-slate-900">Catalogs</h3>
                <div className="grid gap-3">
                  {enabledCatalogs.map((catalog) => {
                    const productCount = catalogProductCounts.get(catalog.id) ?? 0
                    return (
                      <button
                        type="button"
                        key={catalog.id}
                        onClick={() => {
                          setSelectedCatalogId(catalog.id)
                          setSelectedProductId(null)
                        }}
                        className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 text-left"
                        style={
                          catalog.imageUrl
                            ? { backgroundImage: `url(${catalog.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                            : undefined
                        }
                      >
                        <div className={clsx('h-44 w-full', catalog.imageUrl ? 'bg-slate-900/50' : 'bg-gradient-to-br from-slate-200 to-slate-100')} />
                        <div className="absolute inset-0 flex flex-col justify-end p-4">
                          <p className={clsx('text-lg font-semibold', catalog.imageUrl ? 'text-white' : 'text-slate-900')}>{catalog.title}</p>
                          <p className={clsx('mt-1 text-sm font-semibold', catalog.imageUrl ? 'text-white/90' : 'text-slate-600')}>
                            {productCount} {productCount === 1 ? 'product' : 'products'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : nonFeaturedProducts.length ? (
              <section className="space-y-3">
                <h3 className="text-lg font-semibold text-slate-900">Products</h3>
                <div className="grid gap-3 sm:grid-cols-2">{nonFeaturedProducts.map(renderProductCard)}</div>
              </section>
            ) : null}

            {!visibleProducts.length ? <p className="text-sm text-slate-500">No products yet.</p> : null}
          </>
        )}
      </div>
    )
  }

  if (mode === 'manage') {
    const section = manageSection ?? 'products'
    const storefrontHref = `${baseComPath}/shop`
    const manageBaseHref = manageBaseComHref
    const manageProductsHref = manageProductsComHref

    const renderHeader = (title: string, returnHref = manageBaseHref, returnLabel = 'Return to shop') => (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <Link
          href={returnHref}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300"
        >
          {returnLabel}
        </Link>
      </div>
    )

    const renderReturnRow = (returnHref = manageBaseHref, returnLabel = 'Return to shop') => (
      <div className="flex flex-wrap items-center justify-start">
        <Link
          href={returnHref}
          className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
        >
          <HiOutlineArrowLeft className="h-4 w-4" />
          {returnLabel}
        </Link>
      </div>
    )

    if (section === 'products') {
      const isFocused = Boolean(focusProductId)
      const focusedProduct = isFocused && editableProducts.length ? editableProducts[0] : null

      if (isFocused) {
        if (!focusedProduct) {
          return <div className="mx-auto w-full max-w-3xl space-y-6">{renderHeader('Products', storefrontHref, 'Return to shop')}</div>
        }
        const draft = productDrafts[focusedProduct.id]
        if (!draft) {
          return <div className="mx-auto w-full max-w-3xl space-y-6"><p className="text-sm text-slate-500">Loading product…</p></div>
        }

        const currentStatus: 'DRAFT' | 'PUBLISHED' = focusedProduct.isDraft ? 'DRAFT' : 'PUBLISHED'
        const taxDraft = taxDrafts[focusedProduct.id] ?? { collectTax: false, selectionKey: CURRENT_CANADA_TAX_SELECTION, ratesByRegion: {} }
        const selectedSection = getMarketListingSection(draft.listingSection)
        const selectedCategory = getMarketListingCategory(draft.listingSection, draft.listingCategory)
        const currentListingSummary = listingTypeSummary(draft.listingSection, draft.listingCategory, draft.listingSubcategory)

        return (
          <>
            <div className="mx-auto w-full max-w-3xl space-y-6">
            <section className="surface-card p-4 shadow-subtle">
              <div className="space-y-3">
                <div>
                  <Link
                    href={manageProductsHref}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                  >
                    <HiOutlineArrowLeft className="h-4 w-4" />
                    Return to products
                  </Link>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Status:</span>
                    <select
                      value={currentStatus}
                      onChange={(event) =>
                        requestProductStatusChange(focusedProduct.id, currentStatus, event.target.value as 'DRAFT' | 'PUBLISHED')
                      }
                      disabled={saving || uploadingProductId === focusedProduct.id}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
                    >
                      <option value="DRAFT">Unpublished</option>
                      <option value="PUBLISHED">Published</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveProductDetails(focusedProduct.id)}
                      disabled={saving}
                      className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDeleteProduct(focusedProduct.id)}
                      disabled={saving}
                      className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
              {uploadingProductId === focusedProduct.id ? <p className="mt-2 text-xs text-slate-500">Finishing image uploads…</p> : null}
            </section>

            <section className="surface-card space-y-4 p-4 shadow-subtle">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Media</h4>
                <p className="mt-1 text-xs text-slate-500">Primary product visuals shown across the storefront.</p>
              </div>

              {draft.primaryImageUrl ? (
                <img
                  src={draft.primaryImageUrl}
                  alt={`${focusedProduct.name} primary`}
                  className="h-52 w-full rounded-xl border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-52 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                  No primary photo yet
                </div>
              )}

              {draft.galleryImageUrls.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {draft.galleryImageUrls.slice(0, 12).map((url, index) => (
                    <button
                      key={`${focusedProduct.id}-gallery-${index}`}
                      type="button"
                      onClick={() => openProductGalleryImageEditor(focusedProduct.id, index)}
                      className="group relative overflow-hidden rounded-lg border border-slate-200 text-left"
                    >
                      <img src={url} alt={`${focusedProduct.name} gallery ${index + 1}`} className="h-20 w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white opacity-0 transition group-hover:opacity-100">
                        Reposition
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openProductPrimaryImageEditor(focusedProduct.id)}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {draft.primaryImageUrl ? 'Edit primary' : 'Add primary'}
                  </button>

                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Upload gallery
                    <input
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES}
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        void handleGalleryPhotoUpload(focusedProduct.id, event.target.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </section>

            <section className="surface-card space-y-4 p-4 shadow-subtle">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Product Details</h4>
                <p className="mt-1 text-xs text-slate-500">Core product information shown to customers.</p>
              </div>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, name: event.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                />
              </label>

              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
                <div className="normal-case text-base font-normal tracking-normal text-slate-900">
                  <RichTextEditor
                    value={draft.description}
                    onChange={(value) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, description: value }))}
                    minHeight={220}
                    placeholder="Describe the product, details, policies, and anything buyers should know"
                  />
                </div>
              </div>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Price (CAD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.priceDollars}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, priceDollars: event.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                />
              </label>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                SKU
                <input
                  value={draft.sku}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, sku: event.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                />
              </label>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Catalog
                <select
                  value={draft.catalogId}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, catalogId: event.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                >
                  <option value="">Uncategorized</option>
                  {catalogs.map((catalog) => (
                    <option key={catalog.id} value={catalog.id}>
                      {catalog.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.featuredHomepage}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, featuredHomepage: event.target.checked }))}
                />
                Feature product on shop homepage
              </label>
            </section>

            <section className="surface-card space-y-4 p-4 shadow-subtle">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Listing Type</h4>
                <p className="mt-1 text-xs text-slate-500">Use the same marketplace taxonomy so customers can find the right kind of product.</p>
              </div>

              {currentListingSummary ? (
                <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">{currentListingSummary}</div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">Select a section, category, and product type for this item.</div>
              )}

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Section
                <select
                  value={draft.listingSection}
                  onChange={(event) =>
                    updateProductDraft(focusedProduct.id, (current) => ({
                      ...current,
                      listingSection: event.target.value,
                      listingCategory: '',
                      listingSubcategory: '',
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                >
                  <option value="">Select section</option>
                  {MARKET_LISTING_SECTIONS.map((section) => (
                    <option key={section.label} value={section.label}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Category
                <select
                  value={draft.listingCategory}
                  disabled={!selectedSection}
                  onChange={(event) =>
                    updateProductDraft(focusedProduct.id, (current) => ({
                      ...current,
                      listingCategory: event.target.value,
                      listingSubcategory: '',
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 disabled:opacity-60"
                >
                  <option value="">{selectedSection ? 'Select category' : 'Select section first'}</option>
                  {(selectedSection?.categories ?? []).map((category) => (
                    <option key={category.label} value={category.label}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Product type
                <select
                  value={draft.listingSubcategory}
                  disabled={!selectedCategory}
                  onChange={(event) =>
                    updateProductDraft(focusedProduct.id, (current) => ({
                      ...current,
                      listingSubcategory: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 disabled:opacity-60"
                >
                  <option value="">{selectedCategory ? 'Select product type' : 'Select category first'}</option>
                  {(selectedCategory?.subcategories ?? []).map((subcategory) => (
                    <option key={subcategory.label} value={subcategory.label}>
                      {subcategory.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="surface-card space-y-4 p-4 shadow-subtle">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Taxes</h4>
                <p className="mt-1 text-xs text-slate-500">Optional per-region tax collection settings.</p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={taxDraft.collectTax}
                  onChange={(event) =>
                    setTaxDrafts((prev) => {
                      const current = prev[focusedProduct.id] ?? { collectTax: false, selectionKey: CURRENT_CANADA_TAX_SELECTION, ratesByRegion: {} }
                      const nextCollectTax = event.target.checked
                      const nextRates = nextCollectTax ? buildCanadaSalesTaxRatesByPreset('canada_current') : {}

                      return {
                        ...prev,
                        [focusedProduct.id]: {
                          ...current,
                          collectTax: nextCollectTax,
                          selectionKey: CURRENT_CANADA_TAX_SELECTION,
                          ratesByRegion: nextRates,
                        },
                      }
                    })
                  }
                />
                Collect tax
              </label>

              {taxDraft.collectTax ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Current Canadian rates apply GST, HST, PST, RST, and QST by province automatically.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {TAX_REGION_CODES.map((code) => {
                      const catalog = taxRateCatalog?.byCode?.[code]
                      const label =
                        catalog?.options?.find((opt) => Number(opt.ratePct) === Number(catalog.defaultRatePct))?.label ??
                        (catalog ? `${catalog.defaultRatePct}%` : '—')
                      const currentRate = taxDraft.ratesByRegion?.[code]
                      return (
                        <div key={code} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          <div className="font-semibold text-slate-900">
                            {code} — {currentRate ?? '—'}%
                          </div>
                          <div className="mt-1">{label}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="surface-card space-y-4 p-4 shadow-subtle">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Fulfillment</h4>
                <p className="mt-1 text-xs text-slate-500">How this product is delivered to customers.</p>
              </div>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Fulfillment type
                <select
                  value={draft.fulfillmentType}
                  onChange={(event) =>
                    updateProductDraft(focusedProduct.id, (current) => ({
                      ...current,
                      fulfillmentType: event.target.value === 'digital' ? 'digital' : 'physical',
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                >
                  <option value="physical">Physical</option>
                  <option value="digital">Digital</option>
                </select>
              </label>

              {draft.fulfillmentType === 'digital' ? (
                <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Digital delivery URL
                  <input
                    value={draft.digitalDeliveryUrl}
                    onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, digitalDeliveryUrl: event.target.value }))}
                    placeholder="https://…"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                  />
                </label>
              ) : null}

              {renderShippingOptionsEditor(focusedProduct.id, draft)}
            </section>

            <section className="surface-card space-y-4 p-4 shadow-subtle">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Inventory</h4>
                <p className="mt-1 text-xs text-slate-500">Track stock and apply adjustments.</p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.trackInventory}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, trackInventory: event.target.checked }))}
                />
                Track inventory
              </label>

              {draft.trackInventory ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600">
                      {focusedProduct.inventoryTotal} total in stock
                    </span>
                  </div>

                  {warehouses.length ? (
                    <div className="space-y-2">
                      {warehouses.map((warehouse) => (
                        <div key={warehouse.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{warehouse.name}</div>
                            {warehouse.address ? <div className="truncate text-xs text-slate-500">{warehouse.address}</div> : null}
                          </div>
                          <div className="text-sm font-semibold text-slate-900">{inventoryDraft[focusedProduct.id]?.[warehouse.id] ?? 0}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No warehouses configured yet.</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openInventoryAdjustModal(focusedProduct.id)}
                      disabled={saving || !warehouses.length}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Modify Inventory
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            {showProductPublishModal ? (
              <div
                className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
                onClick={() => {
                  setShowProductPublishModal(false)
                  setPendingProductStatusChange(null)
                }}
              >
                <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <h4 className="text-base font-semibold text-slate-900">Publish product?</h4>
                  <p className="mt-2 text-sm text-slate-600">Are you sure you wish to publish this product?</p>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowProductPublishModal(false)
                        setPendingProductStatusChange(null)
                      }}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmProductPublish()}
                      disabled={saving}
                      className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {saving ? 'Publishing…' : 'Yes, publish'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {showProductUnpublishModal ? (
              <div
                className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
                onClick={() => {
                  setShowProductUnpublishModal(false)
                  setPendingProductStatusChange(null)
                }}
              >
                <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <h4 className="text-base font-semibold text-slate-900">Unpublish product?</h4>
                  <p className="mt-2 text-sm text-slate-600">New users will no longer be able to see this product, but you can publish it again at any time.</p>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowProductUnpublishModal(false)
                        setPendingProductStatusChange(null)
                      }}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmProductUnpublish()}
                      disabled={saving}
                      className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {saving ? 'Unpublishing…' : 'Confirm unpublish'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {showProductDeleteModal ? (
              <div
                className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
                onClick={() => {
                  setShowProductDeleteModal(false)
                  setPendingDeleteProductId(null)
                }}
              >
                <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <h4 className="text-base font-semibold text-slate-900">Delete product?</h4>
                  <p className="mt-2 text-sm text-slate-600">This will remove the product from your storefront.</p>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowProductDeleteModal(false)
                        setPendingDeleteProductId(null)
                      }}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const productId = pendingDeleteProductId
                        if (!productId) return
                        const ok = await deleteProduct(productId)
                        if (ok) {
                          setShowProductDeleteModal(false)
                          setPendingDeleteProductId(null)
                        }
                      }}
                      disabled={saving}
                      className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                    >
                      {saving ? 'Deleting…' : 'Delete product'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {showInventoryAdjustModal ? (
              <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => setShowInventoryAdjustModal(false)}>
                <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <h4 className="text-base font-semibold text-slate-900">Modify Inventory</h4>
                  <p className="mt-2 text-sm text-slate-600">Apply an adjustment to a warehouse’s on-hand quantity.</p>

                  <div className="mt-4 space-y-3">
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Action
                      <select
                        value={inventoryAdjustDirection}
                        onChange={(event) => setInventoryAdjustDirection(event.target.value === 'remove' ? 'remove' : 'add')}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="add">Add</option>
                        <option value="remove">Remove</option>
                      </select>
                    </label>

                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Warehouse
                      <select
                        value={inventoryAdjustWarehouseId}
                        onChange={(event) => setInventoryAdjustWarehouseId(event.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Quantity
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={inventoryAdjustQuantity}
                        onChange={(event) => setInventoryAdjustQuantity(event.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>

                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Batch number
                      <input
                        value={inventoryAdjustBatchNumber}
                        onChange={(event) => setInventoryAdjustBatchNumber(event.target.value)}
                        placeholder="Optional"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>

                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Reason
                      <textarea
                        rows={3}
                        value={inventoryAdjustReason}
                        onChange={(event) => setInventoryAdjustReason(event.target.value)}
                        placeholder="Optional"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowInventoryAdjustModal(false)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyInventoryAdjustment()}
                      disabled={saving}
                      className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {saving ? 'Saving…' : 'Apply change'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            </div>
            {shopImageEditor}
          </>
        )
      }

      return (
        <>
          <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={manageBaseHref}
                className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
              >
                <HiOutlineArrowLeft className="h-4 w-4" />
                Return to shop
              </Link>
            </div>

            <Link
              href={`${baseComPath}/shop/new`}
              className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Create product
            </Link>
          </div>

          {!sortedProducts.length ? <p className="text-sm text-slate-500">No products yet.</p> : null}

          {sortedProducts.length ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100">
                {sortedProducts.map((product) => {
                  const href = `${manageProductsHref}/${encodeURIComponent(product.id)}`
                  return (
                    <Link key={product.id} href={href} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{product.name || 'Untitled product'}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600">
                            {formatCurrency(product.priceCents, product.currency)}
                          </span>
                          {product.isDraft ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Draft</span>
                          ) : (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Published</span>
                          )}
                        </div>
                      </div>

                      <span className="shrink-0 text-xs font-semibold text-slate-500">Open</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ) : null}
          </div>
          {shopImageEditor}
        </>
      )
    }

    if (section === 'catalogs') {
      return (
        <>
          <div className="space-y-5">
          {renderReturnRow()}

          {canManage ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Catalogs</p>
                  <p className="mt-1 text-xs text-slate-500">Add catalogs and reorder storefront sections.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewCatalogForm((prev) => !prev)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  {showNewCatalogForm ? 'Cancel' : 'Add Catalog'}
                </button>
              </div>

              <div className={clsx('mt-4 overflow-hidden transition-all duration-200', showNewCatalogForm ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0')}>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Create catalog</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      value={newCatalogDraft.title}
                      onChange={(event) => setNewCatalogDraft((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="Catalog title"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <input
                      value={newCatalogDraft.description}
                      onChange={(event) => setNewCatalogDraft((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Short description"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void createCatalog()}
                      disabled={saving}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      Create catalog
                    </button>
                  </div>
                </div>
              </div>

              {!catalogs.length ? <p className="mt-3 text-sm text-slate-500">No catalogs yet.</p> : null}

              {catalogs.length ? (
                <div className="mt-4 grid gap-3">
                  {catalogs.map((catalog, index) => {
                    const draft = catalogDrafts[catalog.id]
                    if (!draft) return null
                    return (
                      <article
                        key={catalog.id}
                        draggable
                        onDragStart={() => {
                          setDraggingCatalogId(catalog.id)
                          setDragOverCatalogId(catalog.id)
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          if (dragOverCatalogId !== catalog.id) setDragOverCatalogId(catalog.id)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          void handleCatalogDrop(catalog.id)
                        }}
                        onDragEnd={() => {
                          setDraggingCatalogId(null)
                          setDragOverCatalogId(null)
                        }}
                        className={clsx(
                          'rounded-2xl border bg-slate-50 p-3 transition',
                          dragOverCatalogId === catalog.id && draggingCatalogId && draggingCatalogId !== catalog.id
                            ? 'border-[var(--cc-primary)] ring-2 ring-[var(--cc-primary)]/20'
                            : 'border-slate-200',
                          draggingCatalogId === catalog.id ? 'opacity-70' : 'opacity-100',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2">
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-slate-300 bg-white px-1.5 text-xs font-semibold text-slate-700">
                              {index + 1}
                            </span>
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Drag to reorder</span>
                          </div>
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(event) =>
                                setCatalogDrafts((prev) => ({ ...prev, [catalog.id]: { ...draft, enabled: event.target.checked } }))
                              }
                            />
                            Enabled
                          </label>
                        </div>

                        <div className="mt-3 grid gap-3">
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            {draft.imageUrl ? (
                              <img src={draft.imageUrl} alt={`${draft.title || 'Catalog'} banner`} className="h-40 w-full object-cover md:h-48" />
                            ) : (
                              <div className="flex h-40 w-full items-center justify-center bg-gradient-to-r from-slate-200 via-slate-100 to-white text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 md:h-48">
                                Catalog banner
                              </div>
                            )}
                          </div>

                          <div className="grid gap-2">
                            <input
                              value={draft.title}
                              onChange={(event) =>
                                setCatalogDrafts((prev) => ({ ...prev, [catalog.id]: { ...draft, title: event.target.value } }))
                              }
                              placeholder="Catalog title"
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                            />
                            <input
                              value={draft.description}
                              onChange={(event) =>
                                setCatalogDrafts((prev) => ({ ...prev, [catalog.id]: { ...draft, description: event.target.value } }))
                              }
                              placeholder="Short description"
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void uploadCatalogImage(catalog.id, null)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            {draft.imageUrl ? 'Edit banner' : 'Add banner'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveCatalog(catalog.id)}
                            disabled={saving}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                          >
                            Save catalog
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : null}
            </section>
          ) : (
            <p className="text-sm text-slate-500">You don’t have access to manage catalogs.</p>
          )}
          </div>
          {shopImageEditor}
        </>
      )
    }

    if (section === 'orders') {
      return (
        <div className="space-y-5">
          {renderReturnRow()}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Orders</p>
                <p className="mt-1 text-xs text-slate-500">Filter by status, date, items, or buyer.</p>
              </div>
              <button
                type="button"
                onClick={() => void loadOrders()}
                disabled={ordersLoading}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {ordersLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-4">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
                <select
                  value={orderStatusFilter}
                  onChange={(event) => setOrderStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  {orderStatusOptions.map((value) => (
                    <option key={value} value={value}>
                      {value === 'all' ? 'All statuses' : value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 lg:col-span-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items or User</span>
                <input
                  value={orderSearchQuery}
                  onChange={(event) => setOrderSearchQuery(event.target.value)}
                  placeholder="Search orders"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date From</span>
                <input
                  type="date"
                  value={orderDateFrom}
                  onChange={(event) => setOrderDateFrom(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date To</span>
                <input
                  type="date"
                  value={orderDateTo}
                  onChange={(event) => setOrderDateTo(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </label>
            </div>

            {ordersError ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ordersError}</div> : null}

            {ordersLoading ? (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading orders…</div>
            ) : filteredOrders.length ? (
              <div className="mt-4 space-y-3">
                {filteredOrders.map((order) => {
                  const buyerLabel = order.buyer?.name?.trim() || (order.buyer?.handle ? `@${order.buyer.handle}` : '') || 'Guest checkout (legacy)'
                  const buyerMeta = order.buyer?.handle ? `@${order.buyer.handle}` : order.buyer?.email?.trim() || null
                  const statusTone =
                    order.status === 'paid'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : order.status === 'fulfilled'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : order.status === 'cancelled'
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'

                  return (
                    <article key={order.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">Order {order.id.slice(0, 8)}</span>
                            <span className={clsx('rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide', statusTone)}>
                              {order.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{formatOrderDateTime(order.createdAt)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-slate-900">{formatCurrency(order.totalCents, order.currency)}</div>
                          <div className="mt-1 text-xs text-slate-500">{order.paymentMethod === 'civil_wallet' ? 'Civil Wallet' : 'Credit Card'}</div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">User</div>
                          <div className="mt-2 text-sm font-semibold text-slate-900">{buyerLabel}</div>
                          {buyerMeta ? <div className="mt-1 text-xs text-slate-500">{buyerMeta}</div> : null}
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 md:col-span-2">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Items</div>
                          <div className="mt-2 space-y-2">
                            {order.items.map((item, index) => (
                              <div key={`${order.id}-${item.productId ?? index}`} className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
                                <div className="min-w-0">
                                  <span className="font-semibold text-slate-900">{item.name}</span>
                                  <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">{item.fulfillmentType}</span>
                                </div>
                                <div className="shrink-0 text-xs text-slate-500">
                                  Qty {item.quantity} • {formatCurrency(item.priceCents * item.quantity, order.currency)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No orders match these filters.
              </div>
            )}
          </section>
        </div>
      )
    }

    if (section === 'warehouses') {
      return (
        <div className="space-y-5">
          {renderReturnRow()}

          {canManage ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Warehouses</p>
                  <p className="mt-1 text-xs text-slate-500">Add warehouses so inventory and fulfillment can be managed correctly.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {showNewWarehouseForm ? (
                    <button
                      type="button"
                      onClick={resetWarehouseEditor}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (showNewWarehouseForm) {
                        if (editingWarehouseId) {
                          void updateWarehouse()
                        } else {
                          void createWarehouse()
                        }
                        return
                      }
                      setEditingWarehouseId(null)
                      setNewWarehouseName('')
                      setNewWarehouseAddress(createEmptyCanadianAddress())
                      setShowNewWarehouseForm(true)
                    }}
                    disabled={saving}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {showNewWarehouseForm
                      ? saving
                        ? editingWarehouseId
                          ? 'Saving…'
                          : 'Creating…'
                        : editingWarehouseId
                          ? 'Save Warehouse'
                          : 'Create Warehouse'
                      : 'Create Warehouse'}
                  </button>
                </div>
              </div>

              <div className={clsx('mt-4 overflow-hidden transition-all duration-200', showNewWarehouseForm ? 'max-h-[1100px] opacity-100' : 'max-h-0 opacity-0')}>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{editingWarehouseId ? 'Edit warehouse' : 'Create warehouse'}</p>
                    {editingWarehouseId ? (
                      <button
                        type="button"
                        onClick={() => requestDeleteWarehouse(editingWarehouseId)}
                        disabled={saving}
                        className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                      >
                        Delete Warehouse
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-4">
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Warehouse name</span>
                      <input
                        value={newWarehouseName}
                        onChange={(event) => setNewWarehouseName(event.target.value)}
                        placeholder="Main warehouse"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>

                    <CanadianAddressEditor value={newWarehouseAddress} onChange={setNewWarehouseAddress} required mode="organization" disabled={saving} />

                    {hasCanadianAddressValue(newWarehouseAddress) ? (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Search for the warehouse address above, then choose the correct result to autofill the verified address fields.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {!warehouses.length ? <p className="mt-3 text-sm text-slate-500">No warehouses yet.</p> : null}

              {warehouses.length ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="divide-y divide-slate-100">
                    {warehouses.map((warehouse) => (
                      <button
                        key={warehouse.id}
                        type="button"
                        onClick={() => startWarehouseEdit(warehouse)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{warehouse.name}</div>
                          {warehouse.address ? <div className="mt-1 truncate text-xs text-slate-600">{warehouse.address}</div> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {warehouse.isHeadOffice ? (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              Head Office
                            </span>
                          ) : null}
                          <span className="text-xs font-semibold text-emerald-700">Edit</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {showWarehouseDeleteModal ? (
                <div
                  className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
                  onClick={() => {
                    setShowWarehouseDeleteModal(false)
                    setPendingDeleteWarehouseId(null)
                  }}
                >
                  <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <h4 className="text-base font-semibold text-slate-900">Delete warehouse?</h4>
                    <p className="mt-2 text-sm text-slate-600">This will remove the warehouse and its inventory records.</p>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowWarehouseDeleteModal(false)
                          setPendingDeleteWarehouseId(null)
                        }}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const warehouseId = pendingDeleteWarehouseId
                          if (!warehouseId) return
                          const ok = await deleteWarehouse(warehouseId)
                          if (ok) {
                            setShowWarehouseDeleteModal(false)
                            setPendingDeleteWarehouseId(null)
                          }
                        }}
                        disabled={saving}
                        className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                      >
                        {saving ? 'Deleting…' : 'Delete warehouse'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <p className="text-sm text-slate-500">You don’t have access to manage warehouses.</p>
          )}
        </div>
      )
    }

    return (
      <div className="space-y-5">
        {renderReturnRow()}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsPanel('shipping')}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-semibold',
                settingsPanel === 'shipping' ? 'border-slate-200 bg-white text-slate-900' : 'border-transparent bg-slate-100 text-slate-700',
              )}
            >
              Shipping
            </button>
            <button
              type="button"
              onClick={() => setSettingsPanel('stripe')}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-semibold',
                settingsPanel === 'stripe' ? 'border-slate-200 bg-white text-slate-900' : 'border-transparent bg-slate-100 text-slate-700',
              )}
            >
              Stripe Connect
            </button>
          </div>

          {settingsPanel === 'shipping' ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="text-sm font-semibold text-slate-900">Shipping</h4>
              <p className="mt-1 text-sm text-slate-500">Shipping settings are configured per product (shipping policy, weight, and optional shipping contracts).</p>
            </section>
          ) : null}

          {settingsPanel === 'stripe' ? (
            canManage ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Payouts (Stripe)</h3>
                    <p className="mt-1 text-xs text-slate-500">Set up payouts to receive earnings from Marketplace orders.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadConnectStatus()}
                      disabled={connectLoading}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => void startConnectOnboarding()}
                      disabled={connectLoading || Boolean(connectStatus?.payoutsEnabled)}
                      className={clsx(
                        'rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60',
                        connectStatus?.payoutsEnabled
                          ? 'border border-slate-200 bg-white text-slate-700'
                          : 'bg-[var(--cc-primary)] text-white',
                      )}
                    >
                      {connectLoading ? 'Working…' : connectStatus?.payoutsEnabled ? 'Payouts enabled' : 'Set up payouts'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Account: {connectStatus?.accountId ? 'Connected' : 'Not connected'}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Details: {connectStatus?.detailsSubmitted ? 'Submitted' : 'Missing'}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Charges: {connectStatus?.chargesEnabled ? 'Enabled' : 'Disabled'}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Payouts: {connectStatus?.payoutsEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </section>
            ) : (
              <p className="text-sm text-slate-500">You don’t have access to manage payouts.</p>
            )
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{mode === 'new' ? 'Create product' : 'Manage shop'}</h3>
        <div className="flex items-center gap-2">
          <Link href={`${baseComPath}/shop`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300">
            View storefront
          </Link>
        </div>
      </div>

      {mode === 'new' && autoDraftAttempted && saving ? (
        <p className="text-sm text-slate-500">Creating a draft product…</p>
      ) : null}

      {mode === 'new' && autoDraftAttempted && !saving && !canManage ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <h3 className="text-sm font-semibold text-slate-900">You don’t have access to create products</h3>
          <p className="mt-1 text-xs text-slate-500">Sign in with an OWNER/MANAGER account for this organization, or ask an org admin to grant access.</p>
          <button
            type="button"
            onClick={() => redirectToAuthModal('login')}
            className="mt-3 inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white"
          >
            Sign in
          </button>
        </section>
      ) : null}

      {canManage ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Product drafts</h3>
          <p className="mt-1 text-xs text-slate-500">Create a draft product first, then upload photos and publish when ready.</p>
          <button
            type="button"
            onClick={createDraftProduct}
            disabled={saving}
            className="mt-3 inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving
              ? 'Working…'
              : mode === 'new'
                ? editableProducts.length
                  ? 'New draft product'
                  : 'Create first draft product'
                : products.length
                  ? 'New draft product'
                  : 'Create first draft product'}
          </button>
        </section>
      ) : null}

      {!editableProducts.length ? <p className="text-sm text-slate-500">No products yet.</p> : null}

      {editableProducts.length ? (
        <div className="grid gap-3">
          {editableProducts.map((product) => {
            const draft = productDrafts[product.id]
            if (!draft) return null
            const productListingSummary = listingTypeSummary(draft.listingSection, draft.listingCategory, draft.listingSubcategory)

            return (
              <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-xs">
                  {product.isDraft ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Draft</span>
                  ) : (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Published</span>
                  )}
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold text-slate-600">{formatCurrency(product.priceCents, product.currency)}</span>
                  {product.trackInventory ? (
                    <span className={clsx('rounded-full border px-2 py-0.5 font-semibold', product.inventoryTotal > 0 ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-700')}>
                      {product.inventoryTotal} in stock
                    </span>
                  ) : null}
                  {productListingSummary ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">{productListingSummary}</span> : null}
                </div>

                {draft.primaryImageUrl ? (
                  <img
                    src={draft.primaryImageUrl}
                    alt={`${product.name} primary`}
                    className="mb-3 h-44 w-full rounded-xl border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="mb-3 flex h-44 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                    No primary photo yet
                  </div>
                )}

                {draft.galleryImageUrls.length ? (
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {draft.galleryImageUrls.slice(0, 12).map((url, index) => (
                      <button
                        key={`${product.id}-gallery-${index}`}
                        type="button"
                        onClick={() => openProductGalleryImageEditor(product.id, index)}
                        className="group relative overflow-hidden rounded-lg border border-slate-200 text-left"
                      >
                        <img src={url} alt={`${product.name} gallery ${index + 1}`} className="h-20 w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white opacity-0 transition group-hover:opacity-100">
                          Reposition
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {canManage ? (
                  <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Photo uploads</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openProductPrimaryImageEditor(product.id)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {draft.primaryImageUrl ? 'Edit primary' : 'Add primary'}
                      </button>

                      <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                        Upload gallery
                        <input
                          type="file"
                          accept={ACCEPTED_IMAGE_TYPES}
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            void handleGalleryPhotoUpload(product.id, event.target.files)
                            event.currentTarget.value = ''
                          }}
                        />
                      </label>
                    </div>
                    {uploadingProductId === product.id ? <p className="mt-2 text-xs text-slate-500">Uploading photos…</p> : null}
                  </div>
                ) : null}

                {canManage ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Catalog
                        <select
                          value={draft.catalogId}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({ ...current, catalogId: event.target.value }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        >
                          <option value="">Uncategorized</option>
                          {catalogs.map((catalog) => (
                            <option key={catalog.id} value={catalog.id}>
                              {catalog.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Name
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({ ...current, name: event.target.value }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        SKU
                        <input
                          value={draft.sku}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({ ...current, sku: event.target.value }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Price (CAD)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.priceDollars}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({ ...current, priceDollars: event.target.value }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        />
                      </label>

                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Fulfillment type
                        <select
                          value={draft.fulfillmentType}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({
                              ...current,
                              fulfillmentType: event.target.value === 'digital' ? 'digital' : 'physical',
                            }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        >
                          <option value="physical">Physical</option>
                          <option value="digital">Digital</option>
                        </select>
                      </label>

                      {draft.fulfillmentType === 'digital' ? (
                        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">
                          Digital delivery URL
                          <input
                            value={draft.digitalDeliveryUrl}
                            onChange={(event) =>
                              updateProductDraft(product.id, (current) => ({ ...current, digitalDeliveryUrl: event.target.value }))
                            }
                            placeholder="https://…"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                          />
                        </label>
                      ) : null}

                    </div>

                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Description
                      <textarea
                        rows={3}
                        value={draft.description}
                        onChange={(event) =>
                          updateProductDraft(product.id, (current) => ({ ...current, description: event.target.value }))
                        }
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                      />
                    </label>

                    {renderShippingOptionsEditor(product.id, draft)}

                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft.trackInventory}
                        onChange={(event) =>
                          updateProductDraft(product.id, (current) => ({ ...current, trackInventory: event.target.checked }))
                        }
                      />
                      Track inventory
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void saveProductDetails(product.id)}
                        disabled={saving}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        Save details
                      </button>

                      {product.isDraft ? (
                        <button
                          type="button"
                          onClick={() => void saveProductDetails(product.id, { isDraft: false })}
                          disabled={saving}
                          className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Publish product
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {canManage && draft.trackInventory && warehouses.length ? (
                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inventory by warehouse</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {warehouses.map((warehouse) => (
                        <label key={warehouse.id} className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {warehouse.name}
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={String(inventoryDraft[product.id]?.[warehouse.id] ?? 0)}
                            onChange={(event) => {
                              const next = Math.max(0, Math.round(Number(event.target.value) || 0))
                              setInventoryDraft((prev) => ({
                                ...prev,
                                [product.id]: {
                                  ...(prev[product.id] ?? {}),
                                  [warehouse.id]: next,
                                },
                              }))
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900"
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveInventory(product.id)}
                      disabled={saving}
                      className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      Save inventory
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
      {shopImageEditor}
    </div>
  )
}
