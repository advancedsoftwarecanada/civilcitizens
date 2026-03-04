'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LuRepeat2, LuShare } from 'react-icons/lu'
import DashboardShell from '../../../_components/DashboardShell'
import SharePostModal from '../../../_components/SharePostModal'
import ShareSendModal from '../../../_components/ShareSendModal'
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
    pickupCity: string | null
    pickupProvince: string | null
    seller?: {
      id: string
      handle: string | null
      name: string | null
      avatarUrl: string | null
      coverUrl: string | null
    }
  }
}

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

export default function MarketListingDetailPageClient({ listingId }: { listingId: string }) {
  const router = useRouter()
  const [listing, setListing] = useState<ListingDetailResponse['listing'] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [messageText, setMessageText] = useState("Hello, I'm interested in this item")
  const [sendingMessage, setSendingMessage] = useState(false)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)

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

  const priceLabel = useMemo(() => formatMoney(listing?.priceCents ?? 0, listing?.currency ?? 'CAD'), [listing?.currency, listing?.priceCents])
  const listingShareTarget = useMemo<ShareTarget | null>(() => {
    if (!listing) return null
    const location = listing.pickupCity ? `${listing.pickupCity}${listing.pickupProvince ? `, ${listing.pickupProvince}` : ''}` : null
    const descriptionParts = [priceLabel, listing.description, location].filter((value) => typeof value === 'string' && value.trim().length > 0)
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

  const sendMessageToSeller = async () => {
    const body = messageText.trim()
    if (!body) {
      pushToast('Please enter a message.', 'error')
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
        body: JSON.stringify({ body }),
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
  }

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
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {listing.photoUrls?.[0] ? <img src={listing.photoUrls[0]} alt={listing.title} className="aspect-[16/10] w-full object-cover" loading="lazy" /> : null}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
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

            {listing.description ? <p className="text-base text-slate-800">{listing.description}</p> : null}

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="relative h-12 bg-slate-800">
                {listing.seller?.coverUrl ? <img src={listing.seller.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                <div className={`absolute inset-0 ${listing.seller?.coverUrl ? 'bg-slate-900/40' : 'bg-slate-800'}`} />
                <div className="relative flex h-full items-center gap-2 px-3">
                  <div className="h-7 w-7 overflow-hidden rounded-full border border-white/70 bg-slate-100">
                    {listing.seller?.avatarUrl ? <img src={listing.seller.avatarUrl} alt={listing.seller.name ?? listing.seller.handle ?? 'Seller'} className="h-full w-full object-cover" loading="lazy" /> : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{listing.seller?.name || (listing.seller?.handle ? `@${listing.seller.handle}` : 'Seller')}</div>
                    {listing.seller?.handle ? <div className="truncate text-xs text-white/85">@{listing.seller.handle}</div> : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <input
                type="text"
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                aria-label="Message seller"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMessageText('I have some questions about this')}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  I have some questions about this
                </button>
                <button
                  type="button"
                  onClick={() => setMessageText("I'd like to buy this")}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  I'd like to buy this
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  void sendMessageToSeller()
                }}
                disabled={sendingMessage}
                className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingMessage ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </section>
        ) : null}

        {repostModalOpen && listingShareTarget ? (
          <SharePostModal
            target={listingShareTarget}
            onClose={() => setRepostModalOpen(false)}
          />
        ) : null}

        {shareModalOpen && listingShareTarget ? (
          <ShareSendModal
            target={listingShareTarget}
            onClose={() => setShareModalOpen(false)}
          />
        ) : null}
      </div>
    </DashboardShell>
  )
}
