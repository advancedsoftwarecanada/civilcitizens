import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { redirect } from 'next/navigation'
import { buildApiUrl } from '../../../_lib/api'

type MarketProductDetailResponse = {
  product?: {
    id: string
    name: string
    description: string | null
    priceCents: number
    currency: string
    sku: string | null
    primaryImageUrl: string | null
    galleryImageUrls: string[]
    fulfillmentType: string
    weightGrams: number | null
    shippingPolicy: string
    allowShippingContracts: boolean
    trackInventory: boolean
    inventoryTotal: number
    createdAt: string
    updatedAt: string
  }
  organization?: {
    id: string
    name: string
    slug: string
    province: string | null
    municipality: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
}

export const metadata: Metadata = {
  title: 'Market Item',
}

export default async function MarketProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params

  const res = await fetch(buildApiUrl(`/market/products/${encodeURIComponent(productId)}`), { cache: 'no-store' })
  if (!res.ok) return notFound()
  const payload = (await res.json().catch(() => null)) as MarketProductDetailResponse | null
  if (!payload?.product || !payload?.organization) return notFound()

  const province = String(payload.organization.province ?? '').trim().toLowerCase()
  const municipality = String(payload.organization.municipality ?? '').trim().toLowerCase()
  const slug = String(payload.organization.slug ?? '').trim()

  if (!province || !municipality || !slug) return notFound()

  const query = new URLSearchParams({ product: payload.product.id })
  redirect(`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop?${query.toString()}`)
}
