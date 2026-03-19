'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../_components/Modal'
import ContentModerationMenu from '../_components/ContentModerationMenu'
import DashboardShell from '../_components/DashboardShell'
import { buildApiUrl } from '../_lib/api'
import MarketRightRail from './_components/MarketRightRail'
import { getMarketListingCategory, getMarketListingSection, getMarketListingSubcategory, MARKET_LISTING_SECTIONS } from './_lib/listingCategories'

type MarketProduct = {
  id: string
  kind: 'organization_product' | 'citizen_listing'
  title: string
  description: string | null
  listingSection?: string | null
  listingCategory?: string | null
  listingSubcategory?: string | null
  listingDetail?: string | null
  priceCents: number
  currency: string
  primaryImageUrl: string | null
  galleryImageUrls: string[]
  createdAt: string
  organization?: {
    id: string
    name: string
    slug: string
    province: string | null
    municipality: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
  pickupCity?: string | null
  pickupProvince?: string | null
  seller?: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
  }
}

type MarketProductsResponse = {
  items?: MarketProduct[]
  nextCursor?: string | null
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

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function buildProductHref(product: MarketProduct): string {
  if (product.kind !== 'organization_product') return '/market'
  const province = String(product.organization?.province ?? '').trim().toLowerCase()
  const municipality = String(product.organization?.municipality ?? '').trim().toLowerCase()
  const slug = String(product.organization?.slug ?? '').trim()
  if (province && municipality && slug) {
    const params = new URLSearchParams({ product: product.id })
    return `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop?${params.toString()}`
  }
  return `/market/products/${encodeURIComponent(product.id)}`
}

function buildListingHref(product: MarketProduct): string {
  if (product.kind === 'citizen_listing') return `/market/listings/${encodeURIComponent(product.id)}`
  return buildProductHref(product)
}

function ListingTypePicker({ label, value, placeholder, disabled, onClick }: ListingTypePickerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      <span className="block min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
        <span className={`mt-1 block whitespace-normal break-words text-sm font-medium leading-6 ${value ? 'text-slate-900' : 'text-slate-400'}`}>{value || placeholder}</span>
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

export default function MarketPageClient() {
  const router = useRouter()
  const [items, setItems] = useState<MarketProduct[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listingSection, setListingSection] = useState('')
  const [listingCategory, setListingCategory] = useState('')
  const [listingSubcategory, setListingSubcategory] = useState('')
  const [listingDetail, setListingDetail] = useState('')
  const [activeListingTypePicker, setActiveListingTypePicker] = useState<null | 'section' | 'category' | 'subcategory' | 'detail'>(null)

  const selectedListingSection = useMemo(() => getMarketListingSection(listingSection), [listingSection])
  const selectedListingCategory = useMemo(() => getMarketListingCategory(listingSection, listingCategory), [listingCategory, listingSection])
  const selectedListingSubcategory = useMemo(
    () => getMarketListingSubcategory(listingSection, listingCategory, listingSubcategory),
    [listingCategory, listingSection, listingSubcategory],
  )
  const listingTypeOptions = useMemo(
    () => ({
      section: MARKET_LISTING_SECTIONS.map((section) => section.label),
      category: (selectedListingSection?.categories ?? []).map((category) => category.label),
      subcategory: (selectedListingCategory?.subcategories ?? []).map((subcategory) => subcategory.label),
      detail: (selectedListingSubcategory?.details ?? []).map((detail) => detail.label),
    }),
    [selectedListingCategory, selectedListingSection, selectedListingSubcategory],
  )

  const load = useCallback(async (cursor?: string | null) => {
    try {
      if (!cursor) setStatus('loading')
      const params = new URLSearchParams()
      params.set('limit', '24')
      if (cursor) params.set('cursor', cursor)
      if (listingSection) params.set('listingSection', listingSection)
      if (listingCategory) params.set('listingCategory', listingCategory)
      if (listingSubcategory) params.set('listingSubcategory', listingSubcategory)
      if (listingDetail) params.set('listingDetail', listingDetail)

      const res = await fetch(buildApiUrl(`/market/feed?${params.toString()}`), {
        headers: getAuthHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const payload = (await res.json().catch(() => null)) as MarketProductsResponse | null
      const nextItems = Array.isArray(payload?.items) ? payload!.items! : []
      const next = typeof payload?.nextCursor === 'string' ? payload.nextCursor : null

      setItems((prev) => (cursor ? [...prev, ...nextItems] : nextItems))
      setNextCursor(next)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [listingCategory, listingDetail, listingSection, listingSubcategory])

  useEffect(() => {
    void load(null)
  }, [load])

  const hasItems = items.length > 0
  const hasActiveFilters = Boolean(listingSection || listingCategory || listingSubcategory || listingDetail)
  const marketFilterBlock = (
    <section className="rounded-3xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">Marketplace Filters</p>
        <button
          type="button"
          onClick={() => {
            setListingSection('')
            setListingCategory('')
            setListingSubcategory('')
            setListingDetail('')
          }}
          className="rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-50"
        >
          Clear Filters
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <ListingTypePicker label="Section" value={listingSection} placeholder="Choose section" onClick={() => setActiveListingTypePicker('section')} />
        <ListingTypePicker
          label="Category"
          value={listingCategory}
          placeholder={selectedListingSection ? 'Choose category' : 'Choose section first'}
          disabled={!selectedListingSection}
          onClick={() => setActiveListingTypePicker('category')}
        />
        <ListingTypePicker
          label="Subcategory"
          value={listingSubcategory}
          placeholder={selectedListingCategory ? 'Choose subcategory' : 'Choose category first'}
          disabled={!selectedListingCategory}
          onClick={() => setActiveListingTypePicker('subcategory')}
        />
        <ListingTypePicker
          label="Detail"
          value={listingDetail}
          placeholder={listingTypeOptions.detail.length ? 'Choose detail' : 'No detail options'}
          disabled={!listingTypeOptions.detail.length}
          onClick={() => setActiveListingTypePicker('detail')}
        />
      </div>
    </section>
  )

  return (
    <DashboardShell
      rightRail={<MarketRightRail filterBlock={marketFilterBlock} />}
      showMobileRightRail
      mainClassName="space-y-5 pb-12"
    >
      <div className="space-y-5">
        {status === 'error' ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Unable to load market items.</div>
        ) : null}

        {!hasItems && status === 'loading' ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading…</div>
        ) : null}

        {!hasItems && status === 'ready' ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            No market listings are available right now.
          </div>
        ) : null}

        {hasItems ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((product) => {
              const priceLabel = product.currency?.toUpperCase() === 'CAD' ? money.format((product.priceCents || 0) / 100) : `${(product.priceCents || 0) / 100}`

              const cardBody = (
                <>
                  <div className="aspect-[16/10] w-full bg-slate-50">
                    {product.primaryImageUrl ? (
                      <img src={product.primaryImageUrl} alt={product.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{product.title}</div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-slate-900">{priceLabel}</div>
                    </div>
                  </div>
                </>
              )
              return (
                <div key={`${product.kind}:${product.id}`} className="relative">
                  {product.kind === 'organization_product' && product.organization ? (
                    <div className="absolute right-3 top-3 z-20">
                      <ContentModerationMenu
                        reportTarget={{
                          targetType: 'MARKET_PRODUCT',
                          targetId: product.id,
                          targetLabel: product.title,
                        }}
                        blockTarget={{
                          type: 'organization',
                          id: product.organization.id,
                          label: product.organization.name,
                        }}
                        buttonClassName="h-10 w-10 border-white/70 bg-slate-950/72 text-white shadow-lg ring-1 ring-black/10 backdrop-blur-md hover:border-white hover:bg-slate-950/84"
                        onReported={() => {
                          setItems((prev) => prev.filter((item) => item.id !== product.id))
                          router.refresh()
                        }}
                        onBlocked={() => {
                          setItems((prev) => prev.filter((item) => item.organization?.id !== product.organization?.id))
                          router.refresh()
                        }}
                      />
                    </div>
                  ) : null}
                  {product.kind === 'citizen_listing' && product.seller ? (
                    <div className="absolute right-3 top-3 z-20">
                      <ContentModerationMenu
                        reportTarget={{
                          targetType: 'MARKET_LISTING',
                          targetId: product.id,
                          targetLabel: product.title,
                        }}
                        blockTarget={{
                          type: 'user',
                          id: product.seller.id,
                          label: product.seller.name || (product.seller.handle ? `@${product.seller.handle}` : 'Seller'),
                        }}
                        buttonClassName="h-10 w-10 border-white/70 bg-slate-950/72 text-white shadow-lg ring-1 ring-black/10 backdrop-blur-md hover:border-white hover:bg-slate-950/84"
                        onReported={() => {
                          setItems((prev) => prev.filter((item) => item.id !== product.id))
                          router.refresh()
                        }}
                        onBlocked={() => {
                          setItems((prev) => prev.filter((item) => item.seller?.id !== product.seller?.id))
                          router.refresh()
                        }}
                      />
                    </div>
                  ) : null}
                  <Link
                    href={buildListingHref(product)}
                    className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300"
                  >
                    {cardBody}
                  </Link>
                </div>
              )
            })}
            </div>
          </section>
        ) : null}

        {nextCursor && status === 'ready' ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300"
              onClick={() => void load(nextCursor)}
            >
              Load more
            </button>
          </div>
        ) : null}

        <ListingTypePickerModal
          open={activeListingTypePicker === 'section'}
          title="Choose section"
          options={listingTypeOptions.section}
          selectedValue={listingSection}
          emptyLabel="No section selected"
          onClose={() => setActiveListingTypePicker(null)}
          onChoose={(value) => {
            setListingSection(value)
            setListingCategory('')
            setListingSubcategory('')
            setListingDetail('')
            setActiveListingTypePicker(null)
          }}
        />

        <ListingTypePickerModal
          open={activeListingTypePicker === 'category'}
          title="Choose category"
          options={listingTypeOptions.category}
          selectedValue={listingCategory}
          emptyLabel="No category selected"
          onClose={() => setActiveListingTypePicker(null)}
          onChoose={(value) => {
            setListingCategory(value)
            setListingSubcategory('')
            setListingDetail('')
            setActiveListingTypePicker(null)
          }}
        />

        <ListingTypePickerModal
          open={activeListingTypePicker === 'subcategory'}
          title="Choose subcategory"
          options={listingTypeOptions.subcategory}
          selectedValue={listingSubcategory}
          emptyLabel="No subcategory selected"
          onClose={() => setActiveListingTypePicker(null)}
          onChoose={(value) => {
            setListingSubcategory(value)
            setListingDetail('')
            setActiveListingTypePicker(null)
          }}
        />

        <ListingTypePickerModal
          open={activeListingTypePicker === 'detail'}
          title="Choose detail"
          options={listingTypeOptions.detail}
          selectedValue={listingDetail}
          emptyLabel="No detail selected"
          onClose={() => setActiveListingTypePicker(null)}
          onChoose={(value) => {
            setListingDetail(value)
            setActiveListingTypePicker(null)
          }}
        />
      </div>
    </DashboardShell>
  )
}
