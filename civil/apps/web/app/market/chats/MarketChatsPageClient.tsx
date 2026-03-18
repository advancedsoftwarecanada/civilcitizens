'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import CivilCard from '../../_components/CivilCard'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { redirectToAuthModal } from '../../_lib/authModal'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import MarketRightRail from '../_components/MarketRightRail'

type MarketChatsOverviewProps = {
  embedded?: boolean
}

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
  lastMessage?: {
    body: string | null
    senderId: string
    isMine: boolean
  } | null
}

type MarketChatsResponse = {
  yourListings?: YourListingGroup[]
  activeItems?: MarketChatItem[]
  inactiveItems?: MarketChatItem[]
  soldItems?: MarketChatItem[]
}

type MarketChatContext = 'buying' | 'selling'

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

export function MarketChatsOverview({ embedded = false }: MarketChatsOverviewProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [yourListings, setYourListings] = useState<YourListingGroup[]>([])
  const [activeItems, setActiveItems] = useState<MarketChatItem[]>([])
  const [inactiveItems, setInactiveItems] = useState<MarketChatItem[]>([])
  const [soldItems, setSoldItems] = useState<MarketChatItem[]>([])
  const [marketContext, setMarketContext] = useState<MarketChatContext>('buying')

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
  const buyingActiveUnreadCount = useMemo(
    () => activeItems.filter((item) => item.lastMessage && !item.lastMessage.isMine).length,
    [activeItems],
  )
  const sellingUnreadCount = useMemo(
    () => activeSellingListings.reduce((total, group) => total + group.unrespondedThreads.length, 0),
    [activeSellingListings],
  )
  const closedBuyingItems = useMemo(() => [...inactiveItems, ...soldItems], [inactiveItems, soldItems])
  const closedSellingListings = soldSellingListings

  const renderBuyingItemCard = (item: MarketChatItem, muted = false, statusBadge?: string) => (
    <div key={item.threadId} className={clsx('rounded-2xl border p-3', muted ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white')}>
      <Link
        href={`/messages?inbox=market&thread=${encodeURIComponent(item.threadId)}`}
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

  const renderSellingListingCard = (group: YourListingGroup) => {
    const buyers = group.unrespondedThreads.filter((preview) => preview.counterpart)

    return (
      <div key={group.listing.id} className="rounded-[1.7rem] border border-slate-200 bg-white p-4 sm:p-5">
        <Link
          href={`/market/chats/item/${encodeURIComponent(group.listing.id)}`}
          className="block rounded-[1.4rem] border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 hover:bg-slate-100/70"
        >
          <div className="flex items-start gap-4">
            <div className="h-24 w-24 flex-none overflow-hidden rounded-2xl border border-slate-200 bg-white sm:h-28 sm:w-28">
              {group.listing.photoUrl ? (
                <img src={group.listing.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-slate-900 sm:text-xl">{group.listing.title}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {formatMoney(group.listing.priceCents, group.listing.currency)} • {formatPickupLocation(group.listing.pickupCity, group.listing.pickupProvince)}
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {group.totalThreads === 1 ? '1 conversation' : `${group.totalThreads} conversations`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">{group.listing.status}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">Manage listing</span>
                </div>
              </div>
            </div>
          </div>
        </Link>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Potential buyers</p>
            <p className="text-[11px] text-slate-400">{buyers.length} waiting</p>
          </div>

          {buyers.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No waiting buyers.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
              {buyers.map((preview) => {
                const counterpart = preview.counterpart
                if (!counterpart) return null
                const displayHandle = counterpart.handle ? `@${counterpart.handle}` : 'Civil Citizen'
                const displayName = counterpart.name?.trim() || displayHandle

                return (
                  <Link
                    key={preview.threadId}
                    href={`/messages?inbox=market&thread=${encodeURIComponent(preview.threadId)}`}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-3 text-center transition hover:border-slate-300 hover:bg-white"
                    title={displayName}
                  >
                    <VerifiedAvatar
                      src={counterpart.avatarUrl || undefined}
                      alt={displayName}
                      initials={counterpart.handle || counterpart.name || 'C'}
                      size={52}
                      className="shrink-0"
                    />
                    <div className="line-clamp-2 text-xs font-medium text-slate-700">{displayName}</div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-5', embedded ? 'pb-4' : 'pb-12')}>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <h1 className="text-2xl font-semibold text-slate-900">{embedded ? 'Market Inbox' : 'Market Chats'}</h1>
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
                  Buying {buyingActiveUnreadCount > 0 ? `· ${buyingActiveUnreadCount}` : ''}
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
                  Selling {sellingUnreadCount > 0 ? `· ${sellingUnreadCount}` : ''}
                </button>
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {marketContext === 'buying' ? (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active chats</p>
                      <p className="text-[11px] text-slate-400">{activeItems.length} open</p>
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
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Closed chats</p>
                      <p className="text-[11px] text-slate-400">{closedBuyingItems.length} closed</p>
                    </div>
                    <div className="space-y-3">
                      {closedBuyingItems.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No closed buying chats.</div>
                      ) : null}
                      {inactiveItems.map((item) => renderBuyingItemCard(item, true, 'Not interested'))}
                      {soldItems.map((item) => renderBuyingItemCard(item, false, 'Closed'))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active chats</p>
                      <p className="text-[11px] text-slate-400">{activeSellingListings.length} open</p>
                    </div>
                    <div className="space-y-3">
                      {activeSellingListings.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No active listing chats.</div>
                      ) : null}
                      {activeSellingListings.map((group) => renderSellingListingCard(group))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Closed chats</p>
                      <p className="text-[11px] text-slate-400">{closedSellingListings.length} closed</p>
                    </div>
                    <div className="space-y-3">
                      {closedSellingListings.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No closed listing chats.</div>
                      ) : null}
                      {closedSellingListings.map((group) => renderSellingListingCard(group))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export default function MarketChatsPageClient() {
  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <MarketChatsOverview />
    </DashboardShell>
  )
}
