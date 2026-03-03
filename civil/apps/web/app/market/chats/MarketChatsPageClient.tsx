'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
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

function SellerCivilCard({ seller }: { seller: SellerSummary }) {
  const displayHandle = seller.handle ? `@${seller.handle}` : 'Civil Citizen'
  const displayName = seller.name?.trim() || displayHandle

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="relative h-14 bg-slate-800">
        {seller.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seller.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-slate-900/20 to-transparent" />
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <VerifiedAvatar
          src={seller.avatarUrl || undefined}
          alt={displayName}
          size={42}
          isVerified={false}
          isBusiness={false}
          initials={seller.handle || seller.name || 'C'}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{displayName}</div>
          <div className="truncate text-xs text-slate-600">{displayHandle}</div>
        </div>
      </div>
    </div>
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
    <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-blue-50">
      {counterpart.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={counterpart.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/25 to-white/85" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <VerifiedAvatar
              src={counterpart.avatarUrl || undefined}
              alt={displayName}
              size={42}
              isVerified={false}
              isBusiness={false}
              initials={counterpart.handle || counterpart.name || 'C'}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-sm font-semibold text-white">{displayName}</div>
                <span className="flex-none rounded-full border border-blue-200 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-blue-700">Not responded</span>
              </div>
              <div className="truncate text-xs text-white/85">{displayHandle}</div>
            </div>
          </div>
          <div className="flex-none pt-1 text-xs text-white/85">{timestamp}</div>
        </div>
        <div className="px-4 pb-4 pt-3">
          <div className="rounded-xl bg-white/95 px-3 py-2">
            <div className="line-clamp-2 text-sm text-slate-900">{snippet}</div>
          </div>
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

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Marketplace</h1>
        <p className="mt-1 text-sm text-slate-600">Messages about items you&apos;re buying or selling.</p>
      </section>

      {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading chats…</div> : null}
      {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load marketplace chats.</div> : null}

      {status === 'ready' ? (
        <>
          {!hasItems ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">No marketplace messages yet.</div> : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-900">Your Listings</h2>
            <div className="mt-3 space-y-3">
              {yourListings.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No listing messages yet.</div>
              ) : null}

              {yourListings.map((group) => (
                <div key={group.listing.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/market/chats/item/${encodeURIComponent(group.listing.id)}`}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-1 hover:bg-slate-50"
                    >
                      <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        {group.listing.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
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
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-900">Active item chats</h2>
            <p className="mt-1 text-sm text-slate-600">Items you&apos;re interested in.</p>
            <div className="mt-3 space-y-3">
              {activeItems.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No active item chats.</div>
              ) : null}
              {activeItems.map((item) => (
                <div key={item.threadId} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <Link
                    href={`/market/chats/${encodeURIComponent(item.threadId)}`}
                    className="flex items-start gap-3 rounded-xl p-1 hover:bg-slate-50"
                  >
                    <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {item.listingPhotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.listingPhotoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{item.listingTitle}</div>
                          <div className="truncate text-xs text-slate-600">
                            {formatMoney(item.listingPriceCents, item.listingCurrency)} • {formatPickupLocation(item.listingPickupCity, item.listingPickupProvince)}
                          </div>
                        </div>
                        <span className="mt-0.5 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600">{item.listingStatus}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">Seller: {item.seller?.name || (item.seller?.handle ? `@${item.seller.handle}` : (item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Civil Citizen')))}</div>
                    </div>
                  </Link>
                  {item.seller ? <div className="mt-3"><SellerCivilCard seller={item.seller} /></div> : null}
                </div>
              ))}
            </div>
          </section>

          {inactiveItems.length > 0 ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-slate-900">Inactive chats</h2>
              <p className="mt-1 text-sm text-slate-600">Chats you marked as not interested.</p>
              <div className="mt-3 space-y-3">
                {inactiveItems.map((item) => (
                  <div key={item.threadId} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <Link
                      href={`/market/chats/${encodeURIComponent(item.threadId)}`}
                      className="flex items-start gap-3 rounded-xl p-1 hover:bg-slate-100"
                    >
                      <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {item.listingPhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.listingPhotoUrl} alt="" className="h-full w-full object-cover opacity-80" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-700">{item.listingTitle}</div>
                            <div className="truncate text-xs text-slate-600">
                              {formatMoney(item.listingPriceCents, item.listingCurrency)} • {formatPickupLocation(item.listingPickupCity, item.listingPickupProvince)}
                            </div>
                          </div>
                          <span className="mt-0.5 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">Not interested</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500">Seller: {item.seller?.name || (item.seller?.handle ? `@${item.seller.handle}` : (item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Civil Citizen')))}</div>
                      </div>
                    </Link>
                    {item.seller ? <div className="mt-3 opacity-80"><SellerCivilCard seller={item.seller} /></div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-900">Sold item chats</h2>
            <div className="mt-3 space-y-3">
              {soldItems.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No sold item chats.</div>
              ) : null}
              {soldItems.map((item) => (
                <div key={item.threadId} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <Link
                    href={`/market/chats/${encodeURIComponent(item.threadId)}`}
                    className="flex items-start gap-3 rounded-xl p-1 hover:bg-slate-50"
                  >
                    <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {item.listingPhotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.listingPhotoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{item.listingTitle}</div>
                          <div className="truncate text-xs text-slate-600">
                            {formatMoney(item.listingPriceCents, item.listingCurrency)} • {formatPickupLocation(item.listingPickupCity, item.listingPickupProvince)}
                          </div>
                        </div>
                        <span className="mt-0.5 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600">{item.listingStatus}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">Seller: {item.seller?.name || (item.seller?.handle ? `@${item.seller.handle}` : (item.counterpart?.name || (item.counterpart?.handle ? `@${item.counterpart.handle}` : 'Civil Citizen')))}</div>
                    </div>
                  </Link>
                  {item.seller ? <div className="mt-3"><SellerCivilCard seller={item.seller} /></div> : null}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </DashboardShell>
  )
}
