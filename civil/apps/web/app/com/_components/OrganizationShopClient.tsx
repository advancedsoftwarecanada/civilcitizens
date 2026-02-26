'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../_lib/authModal'
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

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const PHOTO_MAX_BYTES = 25 * 1024 * 1024

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

function toDraft(product: ShopProduct): ProductEditDraft {
  return {
    catalogId: product.catalogId ?? '',
    name: product.name,
    description: product.description ?? '',
    priceDollars: ((product.priceCents || 0) / 100).toFixed(2),
    sku: product.sku ?? '',
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
}: {
  province: string
  municipality: string
  slug: string
  mode?: 'storefront' | 'manage' | 'new'
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [catalogs, setCatalogs] = useState<ShopCatalog[]>([])
  const [warehouses, setWarehouses] = useState<ShopWarehouse[]>([])
  const [products, setProducts] = useState<ShopProduct[]>([])
  const [newCatalogDraft, setNewCatalogDraft] = useState<CatalogEditDraft>({ title: '', description: '', imageUrl: '', enabled: true })
  const [catalogDrafts, setCatalogDrafts] = useState<Record<string, CatalogEditDraft>>({})
  const [draggingCatalogId, setDraggingCatalogId] = useState<string | null>(null)
  const [dragOverCatalogId, setDragOverCatalogId] = useState<string | null>(null)
  const [inventoryDraft, setInventoryDraft] = useState<Record<string, Record<string, number>>>({})
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductEditDraft>>({})

  const shopPath = useMemo(
    () => `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop`,
    [municipality, province, slug],
  )

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
          const [meRes, orgRes] = await Promise.all([
            fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }),
            fetch(
              buildApiUrl(
                `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
              ),
              { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
            ),
          ])

          const mePayload = meRes.ok ? ((await meRes.json().catch(() => null)) as { id?: string } | null) : null
          const orgPayload = orgRes.ok
            ? ((await orgRes.json().catch(() => null)) as { org?: { ownerId?: string | null; viewerRole?: 'OWNER' | 'MANAGER' | null } } | null)
            : null

          const viewerRole = orgPayload?.org?.viewerRole ?? null
          const inferredOwner = Boolean(mePayload?.id && orgPayload?.org?.ownerId && mePayload.id === orgPayload.org.ownerId)
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
    } catch {
      setCatalogs([])
      setProducts([])
      setWarehouses([])
      setCanManage(false)
    } finally {
      setLoading(false)
    }
  }, [municipality, province, shopPath, slug])

  useEffect(() => {
    void load()
  }, [load])

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
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to create product draft.', 'error')
        return
      }
      await load()
    } catch {
      pushToast('Unable to create product draft.', 'error')
    } finally {
      setSaving(false)
    }
  }, [load, shopPath])

  const saveProductDetails = useCallback(
    async (productId: string, publish = false) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      const draft = productDrafts[productId]
      if (!draft) return

      const price = Number(draft.priceDollars)
      if (!Number.isFinite(price) || price < 0) {
        pushToast('Enter a valid product price.', 'error')
        return
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
            trackInventory: draft.trackInventory,
            weightGrams: draft.weightGrams.trim() ? Math.max(0, Math.round(Number(draft.weightGrams) || 0)) : null,
            shippingPolicy: draft.shippingPolicy,
            allowShippingContracts: draft.allowShippingContracts,
            isDraft: publish ? false : undefined,
          }),
        })
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          pushToast(payload?.error ?? 'Unable to save product details.', 'error')
          return
        }
        pushToast(publish ? 'Product published.' : 'Product details saved.', 'success')
        await load()
      } catch {
        pushToast('Unable to save product details.', 'error')
      } finally {
        setSaving(false)
      }
    },
    [load, productDrafts, shopPath],
  )

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
    async (productId: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      const quantities = Object.entries(inventoryDraft[productId] ?? {}).map(([warehouseId, quantity]) => ({
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
  const editableProducts = useMemo(
    () => (mode === 'new' ? products.filter((product) => product.isDraft) : products),
    [mode, products],
  )
  const baseComPath = useMemo(
    () => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
    [municipality, province, slug],
  )

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{mode === 'new' ? 'Create product' : 'Manage shop'}</h3>
        <div className="flex items-center gap-2">
          <Link href={`${baseComPath}/shop`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300">
            View storefront
          </Link>
          {mode !== 'new' ? (
            <Link href={`${baseComPath}/shop/new`} className="rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white">
              New product
            </Link>
          ) : null}
        </div>
      </div>

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
            {saving ? 'Working…' : products.length ? 'New draft product' : 'Create first draft product'}
          </button>
        </section>
      ) : null}

      {canManage && mode === 'manage' ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Catalogs</h3>
          <p className="mt-1 text-xs text-slate-500">Catalog cards show first on storefront when enabled. Drag rows to reorder 1, 2, 3…</p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
            <button type="button" onClick={() => void createCatalog()} disabled={saving} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60">
              Add catalog
            </button>
          </div>

          {catalogs.length ? (
            <div className="mt-3 grid gap-3">
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
                      <button type="button" onClick={() => void saveCatalog(catalog.id)} disabled={saving} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60">
                        Save catalog
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
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
                        onClick={() => void saveProductDetails(product.id, false)}
                        disabled={saving}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        Save details
                      </button>

                      {product.isDraft ? (
                        <button
                          type="button"
                          onClick={() => void saveProductDetails(product.id, true)}
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
