'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { HiOutlineChevronLeft, HiOutlineChevronRight, HiOutlineXMark } from 'react-icons/hi2'
import { LuRepeat2, LuShare } from 'react-icons/lu'
import CivilCard from '../../../_components/CivilCard'
import ContentModerationMenu from '../../../_components/ContentModerationMenu'
import DashboardShell from '../../../_components/DashboardShell'
import SharePostModal from '../../../_components/SharePostModal'
import ShareSendModal from '../../../_components/ShareSendModal'
import ApproximatePickupMap from '../../../_components/map/ApproximatePickupMap'
import { pushToast } from '../../../_components/useToasts'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { buildApiUrl } from '../../../_lib/api'
import { type ShareTarget } from '../../../_lib/shareTarget'
import { getStoredToken } from '../../../_lib/tokenStorage'
import MarketRightRail from '../../_components/MarketRightRail'

type ListingDetailResponse = {
  listing?: {
    id: string
    title: string
    description: string | null
    priceCents: number
    currency: string
    photoUrls: string[]
    foodSafetyClassification?: 'low_risk' | 'high_risk' | null
    foodIngredients?: string | null
    foodPreparationLocation?: 'home_kitchen' | 'certified_kitchen' | null
    foodStorageMethod?: 'refrigerated' | 'frozen' | null
    foodTags?: string[]
    foodExpiryDate?: string | null
    pickupCity: string | null
    pickupProvince: string | null
    paymentTypes?: string[]
    status?: string | null
    approximatePickup?: {
      latitude: number
      longitude: number
      label: string
    } | null
    seller?: {
      id: string
      handle: string | null
      name: string | null
      avatarUrl: string | null
      coverUrl: string | null
    }
  }
}

type NearbyListing = {
  id: string
  title: string
  priceCents: number
  currency: string
  photoUrls: string[]
  pickupCity: string | null
  pickupProvince: string | null
  distanceKm: number | null
}

type NearbyListingsResponse = {
  items?: NearbyListing[]
}

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

function stripHtmlToPlainText(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function formatDistanceKm(distanceKm: number) {
  if (distanceKm >= 100) return `${Math.round(distanceKm)} km`
  if (distanceKm >= 10) return `${distanceKm.toFixed(1)} km`
  return `${distanceKm.toFixed(1)} km`
}

function formatFoodSafetyClassification(value: 'low_risk' | 'high_risk' | null | undefined) {
  if (value === 'high_risk') return 'High Risk Food'
  if (value === 'low_risk') return 'Low Risk Food'
  return null
}

function formatPreparationLocation(value: 'home_kitchen' | 'certified_kitchen' | null | undefined) {
  if (value === 'home_kitchen') return 'Seller states this item was prepared in a home kitchen.'
  if (value === 'certified_kitchen') return 'Seller states this item was prepared in a certified kitchen.'
  return null
}

function formatStorageMethod(value: 'refrigerated' | 'frozen' | null | undefined) {
  if (value === 'refrigerated') return 'Seller states this item should be kept refrigerated.'
  if (value === 'frozen') return 'Seller states this item should be kept frozen.'
  return null
}

function supportsCivilPay(paymentTypes: string[] | null | undefined) {
  return Array.isArray(paymentTypes) && paymentTypes.includes('civil_wallet')
}

function getPaymentMethodLabels(paymentTypes: string[] | null | undefined) {
  const labels: string[] = []
  if (Array.isArray(paymentTypes) && paymentTypes.includes('cash_pickup')) labels.push('Cash')
  if (Array.isArray(paymentTypes) && paymentTypes.includes('etransfer')) labels.push('eTransfer')
  if (Array.isArray(paymentTypes) && paymentTypes.includes('civil_wallet')) labels.push('Civil Pay')
  return labels
}

export default function MarketListingDetailPageClient({ listingId }: { listingId: string }) {
  const router = useRouter()
  const [listing, setListing] = useState<ListingDetailResponse['listing'] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [nearbyListings, setNearbyListings] = useState<NearbyListing[]>([])
  const [nearbyStatus, setNearbyStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const quickMessageOptions = useMemo(
    () => ['I have some questions', "I'd like to buy this", 'When can I pickup?', 'Do you deliver?'],
    [],
  )

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl(`/market/listings/public/${encodeURIComponent(listingId)}`), { cache: 'no-store' })
        if (cancelled) return
        if (res.status === 404) {
          setStatus('not-found')
          setListing(null)
          return
        }
        if (!res.ok) {
          setStatus('error')
          setListing(null)
          return
        }
        const payload = (await res.json().catch(() => null)) as ListingDetailResponse | null
        if (!payload?.listing) {
          setStatus('not-found')
          setListing(null)
          return
        }
        setListing(payload.listing)
        setStatus('ready')
      } catch {
        if (cancelled) return
        setStatus('error')
        setListing(null)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [listingId])

  useEffect(() => {
    if (galleryIndex === null) {
      document.body.style.overflow = ''
      return
    }

    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!listing?.photoUrls?.length) return
      if (event.key === 'Escape') setGalleryIndex(null)
      if (event.key === 'ArrowLeft') {
        setGalleryIndex((prev) => {
          if (prev === null) return prev
          return prev === 0 ? listing.photoUrls.length - 1 : prev - 1
        })
      }
      if (event.key === 'ArrowRight') {
        setGalleryIndex((prev) => {
          if (prev === null) return prev
          return prev === listing.photoUrls.length - 1 ? 0 : prev + 1
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [galleryIndex, listing?.photoUrls])

  const sendMessageToSeller = useCallback(
    async (body: string) => {
      const trimmedBody = body.trim()
      if (!trimmedBody) {
        pushToast('Please choose a message first.', 'error')
        return
      }

      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setSendingMessage(true)
      try {
        const threadRes = await fetch(buildApiUrl(`/market/chats/listings/${encodeURIComponent(listingId)}/thread`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })
        const threadPayload = (await threadRes.json().catch(() => null)) as { thread?: { id?: string } | null; error?: string } | null
        const threadId = threadPayload?.thread?.id?.trim()
        if (!threadRes.ok || !threadId) {
          pushToast(threadPayload?.error ?? 'Unable to start a conversation right now.', 'error')
          return
        }

        const messageRes = await fetch(buildApiUrl(`/market/chats/${encodeURIComponent(threadId)}/messages`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ body: trimmedBody }),
        })
        const messagePayload = (await messageRes.json().catch(() => null)) as { error?: string } | null
        if (!messageRes.ok) {
          pushToast(messagePayload?.error ?? 'Unable to send message right now.', 'error')
          return
        }

        pushToast('Message sent.', 'success')
        router.push(`/market/chats/${encodeURIComponent(threadId)}`)
      } catch {
        pushToast('Unable to send message right now.', 'error')
      } finally {
        setSendingMessage(false)
      }
    },
    [listingId, router],
  )

  useEffect(() => {
    if (!listing?.id || !listing.approximatePickup) {
      setNearbyListings([])
      setNearbyStatus('ready')
      return
    }

    const approximatePickup = listing.approximatePickup

    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      setNearbyStatus('loading')
      try {
        const params = new URLSearchParams({
          lat: String(approximatePickup.latitude),
          lng: String(approximatePickup.longitude),
          limit: '6',
        })
        const res = await fetch(buildApiUrl(`/market/listings/public/${encodeURIComponent(listing.id)}/nearby?${params.toString()}`), {
          headers: getStoredToken() ? { authorization: `Bearer ${getStoredToken()}` } : undefined,
          cache: 'no-store',
          signal: controller.signal,
        })
        if (cancelled) return
        if (!res.ok) {
          setNearbyListings([])
          setNearbyStatus('error')
          return
        }
        const payload = (await res.json().catch(() => null)) as NearbyListingsResponse | null
        setNearbyListings(Array.isArray(payload?.items) ? payload.items : [])
        setNearbyStatus('ready')
      } catch (error) {
        if ((error as Error).name === 'AbortError' || cancelled) return
        setNearbyListings([])
        setNearbyStatus('error')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [listing])

  const priceLabel = useMemo(() => formatMoney(listing?.priceCents ?? 0, listing?.currency ?? 'CAD'), [listing?.currency, listing?.priceCents])
  const paymentMethodLabels = useMemo(() => getPaymentMethodLabels(listing?.paymentTypes), [listing?.paymentTypes])
  const isSoldListing = listing?.status === 'sold'
  const galleryPhotos = listing?.photoUrls ?? []
  const activeGalleryPhoto = galleryIndex !== null ? galleryPhotos[galleryIndex] ?? null : null
  const foodSafetyLabel = formatFoodSafetyClassification(listing?.foodSafetyClassification)
  const preparationLocationText = formatPreparationLocation(listing?.foodPreparationLocation)
  const storageMethodText = formatStorageMethod(listing?.foodStorageMethod)
  const foodTags = Array.isArray(listing?.foodTags) ? listing.foodTags.filter((entry) => typeof entry === 'string' && entry.trim()) : []
  const hasFoodSafetyDetails = Boolean(
    foodSafetyLabel ||
      listing?.foodIngredients?.trim() ||
      preparationLocationText ||
      storageMethodText ||
      foodTags.length ||
        listing?.foodExpiryDate?.trim(),
  )
  const listingShareTarget = useMemo<ShareTarget | null>(() => {
    if (!listing) return null
    const location = listing.pickupCity ? `${listing.pickupCity}${listing.pickupProvince ? `, ${listing.pickupProvince}` : ''}` : null
    const descriptionParts = [priceLabel, stripHtmlToPlainText(listing.description ?? ''), location].filter(
      (value) => typeof value === 'string' && value.trim().length > 0,
    )
    return {
      kind: 'market_listing',
      id: listing.id,
      title: listing.title,
      description: descriptionParts.join(' • '),
      url: `/market/listings/${encodeURIComponent(listing.id)}`,
      imageUrl: listing.photoUrls?.[0] ?? null,
      meta: location,
    }
  }, [listing, priceLabel])

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">Listing details</h1>
            <Link href="/market" className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Back to market
            </Link>
          </div>
        </section>

        {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading listing…</div> : null}
        {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load listing right now.</div> : null}
        {status === 'not-found' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Listing not found.</div> : null}

        {status === 'ready' && listing ? (
          isSoldListing ? (
            <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="space-y-3">
                {listing.photoUrls?.[0] ? (
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    {listing.seller ? (
                      <div className="absolute right-3 top-3 z-10">
                        <ContentModerationMenu
                          reportTarget={{
                            targetType: 'MARKET_LISTING',
                            targetId: listing.id,
                            targetLabel: listing.title,
                          }}
                          blockTarget={{
                            type: 'user',
                            id: listing.seller.id,
                            label: listing.seller.name || (listing.seller.handle ? `@${listing.seller.handle}` : 'Seller'),
                          }}
                          buttonClassName="border-white/70 bg-slate-950/72 text-white shadow-lg ring-1 ring-black/10 backdrop-blur-md hover:border-white hover:bg-slate-950/84"
                          onReported={() => router.push('/market')}
                          onBlocked={() => router.push('/market')}
                        />
                      </div>
                    ) : null}
                    <img src={listing.photoUrls[0]} alt={listing.title} className="aspect-[16/10] w-full object-cover" loading="lazy" />
                  </div>
                ) : null}

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900">{listing.title}</h2>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        Sold
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {listing.pickupCity ? `${listing.pickupCity}${listing.pickupProvince ? `, ${listing.pickupProvince}` : ''}` : 'Location not specified'}
                    </p>
                  </div>
                  <div className="text-lg font-semibold text-slate-900">{priceLabel}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  This item has already been sold.
                </div>

                {listing.description ? <div className="prose prose-slate max-w-none text-base" dangerouslySetInnerHTML={{ __html: listing.description }} /> : null}

                {paymentMethodLabels.length ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">Ways to Pay</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {paymentMethodLabels.map((label) => (
                        <span
                          key={label}
                          className={label === 'Civil Pay' ? 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700' : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700'}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {hasFoodSafetyDetails ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">Food safety</p>
                      <p className="text-xs text-slate-500">Civil displays seller-provided food handling details and does not certify or regulate food listings.</p>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      {foodSafetyLabel ? <p><span className="font-semibold text-slate-900">Classification:</span> {foodSafetyLabel}</p> : null}
                      {foodTags.length ? (
                        <div className="flex flex-wrap gap-2">
                          {foodTags.map((tag) => (
                            <span key={tag} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              {tag.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {preparationLocationText ? <p>{preparationLocationText}</p> : null}
                      {storageMethodText ? <p>{storageMethodText}</p> : null}
                      {listing.foodIngredients?.trim() ? <p><span className="font-semibold text-slate-900">Ingredients:</span> {listing.foodIngredients.trim()}</p> : null}
                      {listing.foodExpiryDate?.trim() ? <p><span className="font-semibold text-slate-900">Expiry / best before:</span> {listing.foodExpiryDate.trim()}</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="space-y-3">
              <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (galleryPhotos[0]) setGalleryIndex(0)
                }}
                className="block w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left"
              >
                {listing.photoUrls?.[0] ? <img src={listing.photoUrls[0]} alt={listing.title} className="aspect-[16/10] w-full object-cover" loading="lazy" /> : null}
              </button>
              {listing.seller ? (
                <div className="absolute right-3 top-3 z-10">
                  <ContentModerationMenu
                    reportTarget={{
                      targetType: 'MARKET_LISTING',
                      targetId: listing.id,
                      targetLabel: listing.title,
                    }}
                    blockTarget={{
                      type: 'user',
                      id: listing.seller.id,
                      label: listing.seller.name || (listing.seller.handle ? `@${listing.seller.handle}` : 'Seller'),
                    }}
                    buttonClassName="border-white/70 bg-slate-950/72 text-white shadow-lg ring-1 ring-black/10 backdrop-blur-md hover:border-white hover:bg-slate-950/84"
                    onReported={() => router.push('/market')}
                    onBlocked={() => router.push('/market')}
                  />
                </div>
              ) : null}
              </div>

              {galleryPhotos.length > 1 ? (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                  {galleryPhotos.map((url, index) => (
                    <li key={`${url}-${index}`}>
                      <button
                        type="button"
                        onClick={() => setGalleryIndex(index)}
                        className="block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-slate-300"
                      >
                        <img src={url} alt={`${listing.title} ${index + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-slate-900">{listing.title}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {listing.pickupCity ? `${listing.pickupCity}${listing.pickupProvince ? `, ${listing.pickupProvince}` : ''}` : 'Location not specified'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRepostModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <LuRepeat2 className="h-4 w-4" />
                    <span>Repost</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <LuShare className="h-4 w-4" />
                    <span>Share</span>
                  </button>
                </div>
              </div>
              <div className="text-lg font-semibold text-slate-900">{priceLabel}</div>
            </div>

            {listing.description ? <div className="prose prose-slate max-w-none text-base" dangerouslySetInnerHTML={{ __html: listing.description }} /> : null}

            {paymentMethodLabels.length ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Ways to Pay</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {paymentMethodLabels.map((label) => (
                    <span
                      key={label}
                      className={label === 'Civil Pay' ? 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700' : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700'}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {hasFoodSafetyDetails ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">Food safety</p>
                  <p className="text-xs text-slate-500">Civil displays seller-provided food handling details and does not certify or regulate food listings.</p>
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {foodSafetyLabel ? <p><span className="font-semibold text-slate-900">Classification:</span> {foodSafetyLabel}</p> : null}
                  {foodTags.length ? (
                    <div className="flex flex-wrap gap-2">
                      {foodTags.map((tag) => (
                        <span key={tag} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          {tag.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {preparationLocationText ? <p>{preparationLocationText}</p> : null}
                  {storageMethodText ? <p>{storageMethodText}</p> : null}
                  {listing.foodIngredients?.trim() ? <p><span className="font-semibold text-slate-900">Ingredients:</span> {listing.foodIngredients.trim()}</p> : null}
                  {listing.foodExpiryDate?.trim() ? <p><span className="font-semibold text-slate-900">Expiry / best before:</span> {listing.foodExpiryDate.trim()}</p> : null}
                </div>
              </div>
            ) : null}

            {listing.seller ? (
              <CivilCard
                size="rail"
                href={listing.seller.handle ? `/u/${encodeURIComponent(listing.seller.handle)}` : undefined}
                name={listing.seller.name || (listing.seller.handle ? `@${listing.seller.handle}` : 'Seller')}
                subtitle={listing.seller.handle ? `@${listing.seller.handle}` : 'Civil Citizen'}
                avatarAlt={listing.seller.name ?? listing.seller.handle ?? 'Seller'}
                avatarInitials={listing.seller.handle || listing.seller.name || 'C'}
                avatarSrc={listing.seller.avatarUrl || undefined}
                coverUrl={listing.seller.coverUrl}
              />
            ) : null}

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Interested in this item?</p>
                <p className="text-xs text-slate-500">Choose a quick message and we will open the conversation with the seller.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {quickMessageOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      void sendMessageToSeller(option)
                    }}
                    disabled={sendingMessage}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {option}
                  </button>
                ))}
              </div>

              {listing.approximatePickup ? (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Approximate pickup area</p>
                    <p className="text-xs text-slate-500">Using the seller postal area to show an approximate pickup zone.</p>
                  </div>

                  <ApproximatePickupMap location={listing.approximatePickup} />

                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                    {listing.approximatePickup.label}
                  </div>

                  <p className="text-xs font-medium text-slate-600">Full address is shared when you have been selected as a buyer.</p>
                </div>
              ) : null}
            </div>
          </section>
          )
        ) : null}

        {status === 'ready' && !isSoldListing ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Other listings nearby</h2>
              </div>

              {nearbyStatus === 'loading' ? <div className="text-sm text-slate-600">Loading nearby listings…</div> : null}

              {nearbyStatus !== 'loading' && nearbyListings.length === 0 ? <div className="text-sm text-slate-600">No other listings found</div> : null}

              {nearbyListings.length ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {nearbyListings.map((item) => (
                    <Link
                      key={item.id}
                      href={`/market/listings/${encodeURIComponent(item.id)}`}
                      className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300"
                    >
                      <div className="aspect-[16/10] w-full bg-slate-50">
                        {item.photoUrls[0] ? <img src={item.photoUrls[0]} alt={item.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                      </div>
                      <div className="space-y-2 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{item.title}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {item.pickupCity ? `${item.pickupCity}${item.pickupProvince ? `, ${item.pickupProvince}` : ''}` : 'Location not specified'}
                            </div>
                          </div>
                          <div className="shrink-0 text-sm font-semibold text-slate-900">{formatMoney(item.priceCents, item.currency)}</div>
                        </div>
                        {typeof item.distanceKm === 'number' ? <div className="text-xs font-medium text-slate-600">{formatDistanceKm(item.distanceKm)} away</div> : null}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {repostModalOpen && listingShareTarget && !isSoldListing ? (
          <SharePostModal
            target={listingShareTarget}
            onClose={() => setRepostModalOpen(false)}
          />
        ) : null}

        {shareModalOpen && listingShareTarget && !isSoldListing ? (
          <ShareSendModal
            target={listingShareTarget}
            onClose={() => setShareModalOpen(false)}
          />
        ) : null}

        {activeGalleryPhoto
          ? createPortal(
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setGalleryIndex(null)}>
                <button
                  type="button"
                  className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                  onClick={() => setGalleryIndex(null)}
                >
                  <HiOutlineXMark className="h-6 w-6" />
                </button>
                {galleryPhotos.length > 1 ? (
                  <button
                    type="button"
                    className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                    onClick={(event) => {
                      event.stopPropagation()
                      setGalleryIndex((prev) => {
                        if (prev === null) return prev
                        return prev === 0 ? galleryPhotos.length - 1 : prev - 1
                      })
                    }}
                  >
                    <HiOutlineChevronLeft className="h-7 w-7" />
                  </button>
                ) : null}
                <div className="flex max-h-full w-full max-w-6xl flex-col items-center gap-4" onClick={(event) => event.stopPropagation()}>
                  <img src={activeGalleryPhoto} alt={listing?.title ?? 'Listing photo'} className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-2xl" />
                  {galleryPhotos.length > 1 ? (
                    <div className="flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-black/30 p-2">
                      {galleryPhotos.map((url, index) => (
                        <button
                          key={`${url}-gallery-${index}`}
                          type="button"
                          onClick={() => setGalleryIndex(index)}
                          className={`overflow-hidden rounded-lg border ${galleryIndex === index ? 'border-white' : 'border-white/20 opacity-80'}`}
                        >
                          <img src={url} alt={`${listing?.title ?? 'Listing photo'} ${index + 1}`} className="h-16 w-16 object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {galleryPhotos.length > 1 ? (
                  <button
                    type="button"
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                    onClick={(event) => {
                      event.stopPropagation()
                      setGalleryIndex((prev) => {
                        if (prev === null) return prev
                        return prev === galleryPhotos.length - 1 ? 0 : prev + 1
                      })
                    }}
                  >
                    <HiOutlineChevronRight className="h-7 w-7" />
                  </button>
                ) : null}
              </div>,
              document.body,
            )
          : null}
      </div>
    </DashboardShell>
  )
}
