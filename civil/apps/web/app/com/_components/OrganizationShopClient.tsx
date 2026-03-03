'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HiOutlineArrowLeft, HiOutlineCog6Tooth } from 'react-icons/hi2'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../_lib/authModal'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { useViewerStore } from '../../_lib/viewerStore'
import { pushToast } from '../../_components/useToasts'

type ShopWarehouse = {
  id: string
  name: string
  address: string | null
  isHeadOffice: boolean
}

type ShopProduct = {
  id: string
  catalogId?: string | null
  name: string
  description: string | null
  priceCents: number
  currency: string
  sku: string | null
  primaryImageUrl?: string | null
  galleryImageUrls?: string[]
  fulfillmentType?: string
  digitalDeliveryUrl?: string | null
  weightGrams?: number | null
  shippingPolicy?: 'local_community' | 'provincial' | 'national'
  allowShippingContracts?: boolean
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
  name: string
  description: string
  priceDollars: string
  sku: string
  fulfillmentType: 'physical' | 'digital'
  digitalDeliveryUrl: string
  trackInventory: boolean
  weightGrams: string
  shippingPolicy: 'local_community' | 'provincial' | 'national'
  allowShippingContracts: boolean
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

const TAX_REGION_CODES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const

const formatCurrency = (priceCents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CAD' }).format((priceCents || 0) / 100)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

type ShopSettingsPanel = 'shipping' | 'stripe'

function toDraft(product: ShopProduct): ProductEditDraft {
  return {
    catalogId: product.catalogId ?? '',
    name: product.name,
    description: product.description ?? '',
    priceDollars: ((product.priceCents || 0) / 100).toFixed(2),
    sku: product.sku ?? '',
    fulfillmentType: String(product.fulfillmentType || 'physical').toLowerCase() === 'digital' ? 'digital' : 'physical',
    digitalDeliveryUrl: product.digitalDeliveryUrl ?? '',
    trackInventory: product.trackInventory,
    weightGrams: product.weightGrams != null ? String(product.weightGrams) : '',
    shippingPolicy: product.shippingPolicy ?? 'local_community',
    allowShippingContracts: Boolean(product.allowShippingContracts),
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
  manageSection,
}: {
  province: string
  municipality: string
  slug: string
  mode?: 'storefront' | 'manage' | 'new'
  focusProductId?: string
  manageSection?: 'products' | 'catalogs' | 'orders' | 'settings'
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
  }>(null)
  const [taxRateCatalogLoading, setTaxRateCatalogLoading] = useState(false)
  const [connectStatus, setConnectStatus] = useState<ShopConnectStatus | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)

  const [pendingProductStatusChange, setPendingProductStatusChange] = useState<null | { productId: string; nextStatus: 'DRAFT' | 'PUBLISHED' }>(null)
  const [showProductPublishModal, setShowProductPublishModal] = useState(false)
  const [showProductUnpublishModal, setShowProductUnpublishModal] = useState(false)
  const [pendingDeleteProductId, setPendingDeleteProductId] = useState<string | null>(null)
  const [showProductDeleteModal, setShowProductDeleteModal] = useState(false)

  const [showInventoryAdjustModal, setShowInventoryAdjustModal] = useState(false)
  const [inventoryAdjustProductId, setInventoryAdjustProductId] = useState<string | null>(null)
  const [inventoryAdjustWarehouseId, setInventoryAdjustWarehouseId] = useState<string>('')
  const [inventoryAdjustDirection, setInventoryAdjustDirection] = useState<'add' | 'remove'>('add')
  const [inventoryAdjustQuantity, setInventoryAdjustQuantity] = useState<string>('')
  const [inventoryAdjustBatchNumber, setInventoryAdjustBatchNumber] = useState<string>('')
  const [inventoryAdjustReason, setInventoryAdjustReason] = useState<string>('')

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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = getStoredToken()
      const res = await fetch(buildApiUrl(shopPath), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      if (!res.ok) {
        setProducts([])
        setWarehouses([])
        setCanManage(false)
        return
      }
      const payload = (await res.json().catch(() => null)) as ShopResponse | null

      let canManageFinal = Boolean(payload?.canManage)
      if (!canManageFinal && token) {
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
          canManageFinal = Boolean(inferredOwner || viewerRole === 'OWNER' || viewerRole === 'MANAGER')
        } catch {
          // ignore; keep shop-provided canManage
        }
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
          if (!next[product.id]) {
            const provinceCode = String(province || '').trim().toUpperCase()
            const defaultSelection = TAX_REGION_CODES.includes(provinceCode as any) ? `region:${provinceCode}` : 'gst_5'
            next[product.id] = { collectTax: false, selectionKey: defaultSelection, ratesByRegion: {} }
          }
        })
        return next
      })
    } catch {
      setCatalogs([])
      setProducts([])
      setWarehouses([])
      setCanManage(false)
    } finally {
      setLoading(false)
    }
  }, [cachedMe, municipality, province, shopPath, slug])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    setTaxRateCatalogLoading(true)
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
        // ignore: fallback to manual entry values already in state
      })
      .finally(() => {
        if (cancelled) return
        setTaxRateCatalogLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const buildRatesBySelection = useCallback(
    (selectionKey: string, existing: Record<string, string> | undefined): Record<string, string> => {
      const nextRates: Record<string, string> = { ...(existing ?? {}) }

      let targetRatePct = 0
      if (selectionKey === 'none') {
        targetRatePct = 0
      } else if (selectionKey === 'gst_5') {
        targetRatePct = 5
      } else if (selectionKey.startsWith('region:')) {
        const code = selectionKey.slice('region:'.length).trim().toUpperCase()
        const catalog = taxRateCatalog?.byCode?.[code]
        targetRatePct = catalog ? Number(catalog.defaultRatePct) || 0 : 5
      } else {
        targetRatePct = 5
      }

      for (const code of TAX_REGION_CODES) {
        nextRates[code] = String(targetRatePct)
      }
      return nextRates
    },
    [taxRateCatalog],
  )

  useEffect(() => {
    if (!canManage || mode !== 'manage') return
    void loadConnectStatus()
  }, [canManage, loadConnectStatus, mode])

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

      const price = Number(draft.priceDollars)
      if (!Number.isFinite(price) || price < 0) {
        pushToast('Enter a valid product price.', 'error')
        return false
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
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            priceCents: Math.round(price * 100),
            currency: 'CAD',
            sku: draft.sku.trim() || null,
            fulfillmentType: draft.fulfillmentType,
            digitalDeliveryUrl: draft.digitalDeliveryUrl.trim() || null,
            trackInventory: draft.trackInventory,
            weightGrams: draft.weightGrams.trim() ? Math.max(0, Math.round(Number(draft.weightGrams) || 0)) : null,
            shippingPolicy: draft.shippingPolicy,
            allowShippingContracts: draft.allowShippingContracts,
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
    [load, productDrafts, shopPath],
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

  const handlePrimaryPhotoUpload = useCallback(
    async (productId: string, file: File | null) => {
      if (!file) return
      setUploadingProductId(productId)
      try {
        const mediaUrl = await uploadMediaFile(file)
        if (!mediaUrl) return
        const draft = productDrafts[productId]
        if (!draft) return
        const ok = await savePhotos(productId, mediaUrl, draft.galleryImageUrls)
        if (!ok) return
        updateProductDraft(productId, (current) => ({ ...current, primaryImageUrl: mediaUrl }))
        pushToast('Primary photo uploaded.', 'success')
        await load()
      } finally {
        setUploadingProductId(null)
      }
    },
    [load, productDrafts, pushToast, savePhotos, updateProductDraft, uploadMediaFile],
  )

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
        pushToast('Gallery updated.', 'success')
        await load()
      } finally {
        setUploadingProductId(null)
      }
    },
    [load, productDrafts, pushToast, savePhotos, updateProductDraft, uploadMediaFile],
  )

  const saveInventory = useCallback(
    async (productId: string, override?: Record<string, number>) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      const source = override ?? inventoryDraft[productId] ?? {}
      const quantities = Object.entries(source).map(([warehouseId, quantity]) => ({
        warehouseId,
        quantity: Math.max(0, Math.round(Number(quantity) || 0)),
      }))
      if (!quantities.length) return

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
          return
        }
        pushToast('Inventory updated.', 'success')
        await load()
      } catch {
        pushToast('Unable to save inventory right now.', 'error')
      } finally {
        setSaving(false)
      }
    },
    [inventoryDraft, load, shopPath],
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

    await saveInventory(productId, next)
    setShowInventoryAdjustModal(false)
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
      pushToast('Catalog created.', 'success')
      await load()
    } catch {
      pushToast('Unable to create catalog.', 'error')
    } finally {
      setSaving(false)
    }
  }, [load, newCatalogDraft, shopPath])

  const saveCatalog = useCallback(
    async (catalogId: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      const draft = catalogDrafts[catalogId]
      if (!draft) return
      if (!draft.title.trim()) {
        pushToast('Catalog title is required.', 'error')
        return
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
          return
        }
        pushToast('Catalog saved.', 'success')
        await load()
      } catch {
        pushToast('Unable to save catalog.', 'error')
      } finally {
        setSaving(false)
      }
    },
    [catalogDrafts, load, shopPath],
  )

  const uploadCatalogImage = useCallback(
    async (catalogId: string, file: File | null) => {
      if (!file) return
      const mediaUrl = await uploadMediaFile(file)
      if (!mediaUrl) return
      setCatalogDrafts((prev) => {
        const current = prev[catalogId]
        if (!current) return prev
        return {
          ...prev,
          [catalogId]: {
            ...current,
            imageUrl: mediaUrl,
          },
        }
      })
    },
    [uploadMediaFile],
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

  const [autoDraftAttempted, setAutoDraftAttempted] = useState(false)

  useEffect(() => {
    if (mode !== 'new') return
    if (autoDraftAttempted) return
    if (saving) return
    setAutoDraftAttempted(true)
    void createDraftProduct()
  }, [autoDraftAttempted, createDraftProduct, mode, saving])
  if (loading) {
    return <p className="text-sm text-slate-500">Loading shop…</p>
  }

  if (mode === 'storefront') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-end">
          {canManage ? (
            <Link
              href={`${baseComPath}/shop/manage`}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900"
            >
              <HiOutlineCog6Tooth className="h-4 w-4" />
              Manage shop
            </Link>
          ) : null}
        </div>

        {enabledCatalogs.length ? (
          <div className="grid gap-3">
            {enabledCatalogs.map((catalog) => (
              <article
                key={catalog.id}
                className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                style={catalog.imageUrl ? { backgroundImage: `url(${catalog.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              >
                <div className={clsx('h-44 w-full', catalog.imageUrl ? 'bg-slate-900/50' : 'bg-gradient-to-br from-slate-200 to-slate-100')} />
                <div className="absolute inset-0 flex flex-col justify-end p-4">
                  <p className={clsx('text-lg font-semibold', catalog.imageUrl ? 'text-white' : 'text-slate-900')}>{catalog.title}</p>
                  {catalog.description ? <p className={clsx('mt-1 text-sm', catalog.imageUrl ? 'text-white/90' : 'text-slate-600')}>{catalog.description}</p> : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {!visibleProducts.length ? <p className="text-sm text-slate-500">No products yet.</p> : null}

        {visibleProducts.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleProducts.map((product) => (
              <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                {product.primaryImageUrl ? (
                  <img src={product.primaryImageUrl} alt={product.name} className="mb-3 h-44 w-full rounded-xl border border-slate-200 object-cover" />
                ) : null}
                <p className="text-base font-semibold text-slate-900">{product.name}</p>
                {product.description ? <p className="mt-1 text-sm text-slate-600">{product.description}</p> : null}
                <p className="mt-2 text-sm font-semibold text-slate-900">{formatCurrency(product.priceCents, product.currency)}</p>
              </article>
            ))}
          </div>
        ) : null}
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
        const taxDraft = taxDrafts[focusedProduct.id] ?? { collectTax: false, selectionKey: 'gst_5', ratesByRegion: {} }

        return (
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
                <h4 className="text-sm font-semibold text-slate-900">Product Information</h4>
                <p className="mt-1 text-xs text-slate-500">Core details shown to customers.</p>
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
                    <img
                      key={`${focusedProduct.id}-gallery-${index}`}
                      src={url}
                      alt={`${focusedProduct.name} gallery ${index + 1}`}
                      className="h-20 w-full rounded-lg border border-slate-200 object-cover"
                    />
                  ))}
                </div>
              ) : null}

              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Upload primary
                    <input
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES}
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null
                        void handlePrimaryPhotoUpload(focusedProduct.id, file)
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>

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

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, name: event.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                />
              </label>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
                <textarea
                  rows={4}
                  value={draft.description}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, description: event.target.value }))}
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
                      const nextCollectTax = event.target.checked
                      const nextSelectionKey = taxDraft.selectionKey || 'gst_5'
                      const nextRates = nextCollectTax ? buildRatesBySelection(nextSelectionKey, taxDraft.ratesByRegion) : taxDraft.ratesByRegion

                      return {
                        ...prev,
                        [focusedProduct.id]: {
                          ...taxDraft,
                          collectTax: nextCollectTax,
                          selectionKey: nextSelectionKey,
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
                  {taxRateCatalogLoading ? <p className="text-xs text-slate-500">Loading latest tax rates…</p> : null}
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Select tax rate
                    <select
                      value={taxDraft.selectionKey || 'gst_5'}
                      onChange={(event) => {
                        const selectionKey = String(event.target.value || 'gst_5')
                        setTaxDrafts((prev) => ({
                          ...prev,
                          [focusedProduct.id]: {
                            ...taxDraft,
                            selectionKey,
                            ratesByRegion: buildRatesBySelection(selectionKey, taxDraft.ratesByRegion),
                          },
                        }))
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none"
                    >
                      {TAX_REGION_CODES.map((code) => {
                        const catalog = taxRateCatalog?.byCode?.[code]
                        const standardLabel =
                          catalog?.options?.find((opt) => Number(opt.ratePct) === Number(catalog.defaultRatePct))?.label ??
                          (catalog ? `${catalog.defaultRatePct}%` : '5%')
                        const name = catalog?.name ? ` — ${catalog.name}` : ''
                        return (
                          <option key={code} value={`region:${code}`}>
                            {code}
                            {name} — {standardLabel}
                          </option>
                        )
                      })}
                      <option value="gst_5">GST only — 5%</option>
                      <option value="none">No tax — 0%</option>
                    </select>
                  </label>
                  <p className="text-xs text-slate-500">This applies your selected rate across all regions for now.</p>
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

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Weight (grams)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.weightGrams}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, weightGrams: event.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                />
              </label>

              <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Shipping policy
                <select
                  value={draft.shippingPolicy}
                  onChange={(event) =>
                    updateProductDraft(focusedProduct.id, (current) => ({
                      ...current,
                      shippingPolicy: event.target.value as 'local_community' | 'provincial' | 'national',
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                >
                  <option value="local_community">Local community only</option>
                  <option value="provincial">Provincial</option>
                  <option value="national">National</option>
                </select>
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.allowShippingContracts}
                  onChange={(event) => updateProductDraft(focusedProduct.id, (current) => ({ ...current, allowShippingContracts: event.target.checked }))}
                />
                Allow shipping contracts at customer purchase
              </label>
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
        )
      }

      return (
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
      )
    }

    if (section === 'catalogs') {
      return (
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
                  onClick={() => {
                    const el = document.getElementById('shop-add-catalog')
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Add new
                </button>
              </div>

              <div id="shop-add-catalog" className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add catalog</p>
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
                    Add catalog
                  </button>
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

                        <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            {draft.imageUrl ? (
                              <img src={draft.imageUrl} alt={`${draft.title || 'Catalog'} thumbnail`} className="h-36 w-full object-cover" />
                            ) : (
                              <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Thumbnail
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
                          <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                            Upload image
                            <input
                              type="file"
                              accept={ACCEPTED_IMAGE_TYPES}
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null
                                void uploadCatalogImage(catalog.id, file)
                                event.currentTarget.value = ''
                              }}
                            />
                          </label>
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
      )
    }

    if (section === 'orders') {
      return (
        <div className="space-y-5">
          {renderReturnRow()}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">Orders management will appear here.</p>
          </section>
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
                      <img key={`${product.id}-gallery-${index}`} src={url} alt={`${product.name} gallery ${index + 1}`} className="h-20 w-full rounded-lg border border-slate-200 object-cover" />
                    ))}
                  </div>
                ) : null}

                {canManage ? (
                  <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Photo uploads</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                        Upload primary
                        <input
                          type="file"
                          accept={ACCEPTED_IMAGE_TYPES}
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null
                            void handlePrimaryPhotoUpload(product.id, file)
                            event.currentTarget.value = ''
                          }}
                        />
                      </label>

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

                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Weight (grams)
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.weightGrams}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({ ...current, weightGrams: event.target.value }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        />
                      </label>
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

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Shipping policy
                        <select
                          value={draft.shippingPolicy}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({
                              ...current,
                              shippingPolicy: event.target.value as 'local_community' | 'provincial' | 'national',
                            }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                        >
                          <option value="local_community">Local community only</option>
                          <option value="provincial">Provincial</option>
                          <option value="national">National</option>
                        </select>
                      </label>

                      <label className="mt-5 inline-flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={draft.allowShippingContracts}
                          onChange={(event) =>
                            updateProductDraft(product.id, (current) => ({ ...current, allowShippingContracts: event.target.checked }))
                          }
                        />
                        Allow shipping contracts at customer purchase
                      </label>
                    </div>

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
    </div>
  )
}
