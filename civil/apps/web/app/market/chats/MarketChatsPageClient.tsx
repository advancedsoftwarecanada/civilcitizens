'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import CivilCard from '../../_components/CivilCard'
import { redirectToAuthModal } from '../../_lib/authModal'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import MarketRightRail from '../_components/MarketRightRail'

type SellerSummary = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

type ListingSummary = {
  id: string
  title: string
  status: string
  priceCents: number
  currency: string
  photoUrl: string | null
  pickupCity?: string | null
  pickupProvince?: string | null
}

type UnrespondedThreadPreview = {
  threadId: string
  lastMessageAt: string
  lastMessage?: {
    body: string | null
    senderId: string
    isMine: boolean
  } | null
  counterpart?: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
  } | null
}

type YourListingGroup = {
  listing: ListingSummary
  unrespondedThreads: UnrespondedThreadPreview[]
  totalThreads: number
}

type MarketChatItem = {
  threadId: string
  listingId: string
  listingTitle: string
  listingStatus: string
  listingPriceCents: number
  listingCurrency: string
  listingPhotoUrl: string | null
  listingPickupCity?: string | null
  listingPickupProvince?: string | null
  seller?: SellerSummary | null
  lastMessageAt: string
  counterpart?: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  } | null
}

type MarketChatsResponse = {
  yourListings?: YourListingGroup[]
  activeItems?: MarketChatItem[]
  inactiveItems?: MarketChatItem[]
  soldItems?: MarketChatItem[]
}

type MarketChatContext = 'buying' | 'selling'
type BuyingFilter = 'buying' | 'bought'
type SellingFilter = 'selling' | 'sold'

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: (currency || 'CAD').toUpperCase() }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

function formatPickupLocation(city?: string | null, province?: string | null) {
  const parts = [city?.trim(), province?.trim()].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Location unavailable'
}

function formatTimestamp(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function isClosedListingStatus(status?: string | null) {
  const value = String(status || '').toLowerCase()
  return value === 'sold' || value === 'canceled'
}

function SellerCivilCard({ seller }: { seller: SellerSummary }) {
  const displayHandle = seller.handle ? `@${seller.handle}` : 'Civil Citizen'
  const displayName = seller.name?.trim() || displayHandle

  return (
    <CivilCard
      size="md"
      name={displayName}
      subtitle={displayHandle}
      avatarAlt={displayName}
      avatarInitials={seller.handle || seller.name || 'C'}
      avatarSrc={seller.avatarUrl || undefined}
      coverUrl={seller.coverUrl}
    />
  )
}

function CounterpartPreviewCard({
  counterpart,
  timestamp,
  snippet,
}: {
  counterpart: NonNullable<UnrespondedThreadPreview['counterpart']>
  timestamp: string
  snippet: string
}) {
  const displayHandle = counterpart.handle ? `@${counterpart.handle}` : 'Civil Citizen'
  const displayName = counterpart.name?.trim() || displayHandle

  return (
    <div className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50">
      <CivilCard
        size="rail"
        name={displayName}
        titleSuffix={<span className="rounded-full border border-blue-200 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-blue-700">Not responded</span>}
        subtitle={displayHandle}
        avatarAlt={displayName}
        avatarInitials={counterpart.handle || counterpart.name || 'C'}
        avatarSrc={counterpart.avatarUrl || undefined}
        coverUrl={counterpart.coverUrl}
        trailing={<div className="pt-0.5 text-xs text-white/85">{timestamp}</div>}
        className="!rounded-b-none !border-0"
      />
      <div className="px-4 pb-4 pt-3">
        <div className="rounded-xl bg-white/95 px-3 py-2">
          <div className="line-clamp-2 text-sm text-slate-900">{snippet}</div>
        </div>
      </div>
    </div>
  )
}

export default function MarketChatsPageClient() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [yourListings, setYourListings] = useState<YourListingGroup[]>([])
  const [activeItems, setActiveItems] = useState<MarketChatItem[]>([])
  const [inactiveItems, setInactiveItems] = useState<MarketChatItem[]>([])
  const [soldItems, setSoldItems] = useState<MarketChatItem[]>([])
  const [marketContext, setMarketContext] = useState<MarketChatContext>('buying')
  const [buyingFilter, setBuyingFilter] = useState<BuyingFilter>('buying')
  const [sellingFilter, setSellingFilter] = useState<SellingFilter>('selling')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl('/market/chats'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          return
        }

        const payload = (await res.json().catch(() => null)) as MarketChatsResponse | null
        setYourListings(Array.isArray(payload?.yourListings) ? payload!.yourListings! : [])
        setActiveItems(Array.isArray(payload?.activeItems) ? payload!.activeItems! : [])
        setInactiveItems(Array.isArray(payload?.inactiveItems) ? payload!.inactiveItems! : [])
        setSoldItems(Array.isArray(payload?.soldItems) ? payload!.soldItems! : [])
        setStatus('ready')
      } catch {
        if (cancelled) return
        setStatus('error')
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [])

  const hasItems = useMemo(
    () => yourListings.length > 0 || activeItems.length > 0 || inactiveItems.length > 0 || soldItems.length > 0,
    [yourListings.length, activeItems.length, inactiveItems.length, soldItems.length],
  )

  const activeSellingListings = useMemo(
    () => yourListings.filter((group) => !isClosedListingStatus(group.listing.status)),
    [yourListings],
  )
  const soldSellingListings = useMemo(
    () => yourListings.filter((group) => isClosedListingStatus(group.listing.status)),
    [yourListings],
  )

  const renderBuyingItemCard = (item: MarketChatItem, muted = false, statusBadge?: string) => (
    <div key={item.threadId} className={clsx('rounded-2xl border p-3', muted ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white')}>
      <Link
        href={`/market/chats/${encodeURIComponent(item.threadId)}`}
        className={clsx('flex items-start gap-3 rounded-xl p-1 transition', muted ? 'hover:bg-slate-100' : 'hover:bg-slate-50')}
      >
        <div className={clsx('h-16 w-16 flex-none overflow-hidden rounded-xl border', muted ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50')}>
          {item.listingPhotoUrl ? (
            <img src={item.listingPhotoUrl} alt="" className={clsx('h-full w-full object-cover', muted ? 'opacity-80' : undefined)} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={clsx('truncate text-sm font-semibold', muted ? 'text-slate-700' : 'text-slate-900')}>{item.listingTitle}</div>
              <div className="truncate text-xs text-slate-600">
                {formatMoney(item.listingPriceCents, item.listingCurrency)} • {formatPickupLocation(item.listingPickupCity, item.listingPickupProvince)}
              </div>
            </div>
            <span className="mt-0.5 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">{statusBadge ?? item.listingStatus}</span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-500">Seller: {item.seller?.name || (item.seller?.handle ? `@${item.seller.handle}` : (item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Civil Citizen')))}</div>
        </div>
      </Link>
      {item.seller ? <div className={clsx('mt-3', muted ? 'opacity-80' : undefined)}><SellerCivilCard seller={item.seller} /></div> : null}
    </div>
  )

  const renderSellingListingCard = (group: YourListingGroup) => (
    <div key={group.listing.id} className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/market/chats/item/${encodeURIComponent(group.listing.id)}`}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-1 hover:bg-slate-50"
        >
          <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {group.listing.photoUrl ? (
              <img src={group.listing.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{group.listing.title}</div>
                <div className="truncate text-xs text-slate-600">
                  {formatMoney(group.listing.priceCents, group.listing.currency)} • {formatPickupLocation(group.listing.pickupCity, group.listing.pickupProvince)}
                </div>
              </div>
              <span className="mt-0.5 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600">{group.listing.status}</span>
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">
              {group.totalThreads === 1 ? '1 conversation' : `${group.totalThreads} conversations`}
            </div>
          </div>
        </Link>

        <Link
          href={`/market/chats/item/${encodeURIComponent(group.listing.id)}`}
          className="flex-none rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          View all chats
        </Link>
      </div>

      <div className="mt-3 space-y-2">
        {group.unrespondedThreads.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No unresponded chats.</div>
        ) : null}

        {group.unrespondedThreads.map((preview) => {
          const counterpart = preview.counterpart
          if (!counterpart) return null

          const snippet = preview.lastMessage?.body?.trim() || 'Message'
          return (
            <Link
              key={preview.threadId}
              href={`/market/chats/${encodeURIComponent(preview.threadId)}`}
              className="block rounded-2xl hover:bg-transparent"
            >
              <CounterpartPreviewCard counterpart={counterpart} timestamp={formatTimestamp(preview.lastMessageAt)} snippet={snippet} />
            </Link>
          )
        })}
      </div>
    </div>
  )

  const activeBuyingCount = activeItems.length + inactiveItems.length
  const boughtCount = soldItems.length
  const sellingCount = activeSellingListings.length
  const soldCount = soldSellingListings.length
  const currentSectionTitle = marketContext === 'buying'
    ? buyingFilter === 'buying'
      ? 'Buying'
      : 'Bought'
    : sellingFilter === 'selling'
      ? 'Selling'
      : 'Sold'
  const currentSectionDescription = marketContext === 'buying'
    ? buyingFilter === 'buying'
      ? 'Chats for items you are still working through, plus any you marked not interested.'
      : 'Marketplace threads tied to listings that have already closed.'
    : sellingFilter === 'selling'
      ? 'Your current listings and the buyer conversations attached to them.'
      : 'Listings you have already closed out, with their chat history grouped underneath.'

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Market Chats</h1>
        <p className="mt-1 text-sm text-slate-600">Messages about the items you are buying and the listings you are managing.</p>
      </section>

      {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading chats…</div> : null}
      {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load marketplace chats.</div> : null}

      {status === 'ready' ? (
        <>
          {!hasItems ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">No marketplace messages yet.</div> : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="space-y-3 border-b border-slate-100 pb-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMarketContext('buying')}
                  className={clsx(
                    'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                    marketContext === 'buying'
                      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                      : 'border-slate-200 text-slate-600 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
                  )}
                >
                  Buying
                </button>
                <button
                  type="button"
                  onClick={() => setMarketContext('selling')}
                  className={clsx(
                    'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                    marketContext === 'selling'
                      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                      : 'border-slate-200 text-slate-600 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
                  )}
                >
                  Selling
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {marketContext === 'buying' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setBuyingFilter('buying')}
                      className={clsx(
                        'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        buyingFilter === 'buying'
                          ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                          : 'border-slate-200 text-slate-600 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
                      )}
                    >
                      Buying {activeBuyingCount > 0 ? `· ${activeBuyingCount}` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuyingFilter('bought')}
                      className={clsx(
                        'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        buyingFilter === 'bought'
                          ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                          : 'border-slate-200 text-slate-600 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
                      )}
                    >
                      Bought {boughtCount > 0 ? `· ${boughtCount}` : ''}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSellingFilter('selling')}
                      className={clsx(
                        'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        sellingFilter === 'selling'
                          ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                          : 'border-slate-200 text-slate-600 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
                      )}
                    >
                      Selling {sellingCount > 0 ? `· ${sellingCount}` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSellingFilter('sold')}
                      className={clsx(
                        'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        sellingFilter === 'sold'
                          ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                          : 'border-slate-200 text-slate-600 hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]',
                      )}
                    >
                      Sold {soldCount > 0 ? `· ${soldCount}` : ''}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{currentSectionTitle}</p>
                <p className="text-[11px] text-slate-400">{currentSectionDescription}</p>
              </div>

              {marketContext === 'buying' ? (
                buyingFilter === 'buying' ? (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Buying</p>
                        <p className="text-[11px] text-slate-400">{activeItems.length} active</p>
                      </div>
                      <div className="space-y-3">
                        {activeItems.length === 0 ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No active item chats.</div>
                        ) : null}
                        {activeItems.map((item) => renderBuyingItemCard(item))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Archived</p>
                        <p className="text-[11px] text-slate-400">{inactiveItems.length} not interested</p>
                      </div>
                      <div className="space-y-3">
                        {inactiveItems.length === 0 ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No archived buying chats.</div>
                        ) : null}
                        {inactiveItems.map((item) => renderBuyingItemCard(item, true, 'Not interested'))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {soldItems.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No bought item chats.</div>
                    ) : null}
                    {soldItems.map((item) => renderBuyingItemCard(item))}
                  </div>
                )
              ) : sellingFilter === 'selling' ? (
                <div className="space-y-3">
                  {activeSellingListings.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No active listing chats.</div>
                  ) : null}
                  {activeSellingListings.map((group) => renderSellingListingCard(group))}
                </div>
              ) : (
                <div className="space-y-3">
                  {soldSellingListings.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No sold listing chats.</div>
                  ) : null}
                  {soldSellingListings.map((group) => renderSellingListingCard(group))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </DashboardShell>
  )
}
