'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../../../_components/DashboardShell'
import Modal from '../../../../_components/Modal'
import VerifiedAvatar from '../../../../_components/VerifiedAvatar'
import { redirectToAuthModal } from '../../../../_lib/authModal'
import { buildApiUrl } from '../../../../_lib/api'
import { getStoredToken } from '../../../../_lib/tokenStorage'
import MarketRightRail from '../../../_components/MarketRightRail'

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

type ThreadPreview = {
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

type ItemChatsResponse = {
  listing?: ListingSummary
  threads?: ThreadPreview[]
  selectedThreadId?: string | null
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

function ConversationCard({
  counterpart,
  timestamp,
  snippet,
  notResponded,
}: {
  counterpart: NonNullable<ThreadPreview['counterpart']>
  timestamp: string
  snippet: string
  notResponded: boolean
}) {
  const displayHandle = counterpart.handle ? `@${counterpart.handle}` : 'Civil Citizen'
  const displayName = counterpart.name?.trim() || displayHandle

  return (
    <div
      className={
        'relative overflow-hidden rounded-2xl border ' +
        (notResponded ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white')
      }
    >
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
                {notResponded ? (
                  <span className="flex-none rounded-full border border-blue-200 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-blue-700">Not responded</span>
                ) : null}
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

export default function MarketChatItemPageClient({ listingId }: { listingId: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [listing, setListing] = useState<ListingSummary | null>(null)
  const [threads, setThreads] = useState<ThreadPreview[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [selectBuyerThreadId, setSelectBuyerThreadId] = useState<string | null>(null)
  const [selectBuyerSubmitting, setSelectBuyerSubmitting] = useState(false)
  const [selectBuyerError, setSelectBuyerError] = useState<string | null>(null)
  const [relistSubmitting, setRelistSubmitting] = useState(false)
  const [relistError, setRelistError] = useState<string | null>(null)

  const load = async (cancelledRef?: { cancelled: boolean }) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setStatus('loading')
      try {
        const res = await fetch(buildApiUrl(`/market/chats/item/${encodeURIComponent(listingId)}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        if (cancelledRef?.cancelled) return

        if (res.status === 404) {
          setStatus('not-found')
          setListing(null)
          setThreads([])
          return
        }

        if (!res.ok) {
          setStatus('error')
          return
        }

        const payload = (await res.json().catch(() => null)) as ItemChatsResponse | null
        if (!payload?.listing) {
          setStatus('not-found')
          setListing(null)
          setThreads([])
          return
        }

        setListing(payload.listing)
        setThreads(Array.isArray(payload.threads) ? payload.threads : [])
        setSelectedThreadId(payload.selectedThreadId ? String(payload.selectedThreadId) : null)
        setStatus('ready')
      } catch {
        if (cancelledRef?.cancelled) return
        setStatus('error')
      }
  }

  useEffect(() => {
    const cancelledRef = { cancelled: false }
    void load(cancelledRef)
    return () => {
      cancelledRef.cancelled = true
    }
  }, [listingId])

  const header = useMemo(() => {
    if (!listing) return null

    const editHref = `/market/listings/new?listing=${encodeURIComponent(listing.id)}`

    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
        <Link href={editHref} className="block rounded-2xl p-1 hover:bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {listing.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={listing.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-slate-900">{listing.title}</div>
                <div className="truncate text-sm text-slate-600">
                  {formatMoney(listing.priceCents, listing.currency)} • {formatPickupLocation(listing.pickupCity, listing.pickupProvince)}
                </div>
                <div className="mt-1 text-xs font-medium text-slate-500">Click to edit listing</div>
              </div>
            </div>
            <span className="mt-0.5 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">{listing.status}</span>
          </div>
        </Link>
      </section>
    )
  }, [listing])

  const canSelectBuyer = useMemo(() => {
    const statusValue = (listing?.status || '').toLowerCase()
    if (!listing || statusValue === 'sold' || statusValue === 'canceled') return false
    if (statusValue === 'pending' && selectedThreadId) return false
    return true
  }, [listing, selectedThreadId])

  const canRelist = useMemo(() => {
    const statusValue = (listing?.status || '').toLowerCase()
    return Boolean(listing && statusValue === 'pending')
  }, [listing])

  const openThread = (threadId: string) => {
    router.push(`/market/chats/${encodeURIComponent(threadId)}`)
  }

  const onSelectBuyer = async () => {
    if (!selectBuyerThreadId || !listing) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSelectBuyerSubmitting(true)
    setSelectBuyerError(null)
    try {
      const res = await fetch(buildApiUrl(`/market/chats/item/${encodeURIComponent(listing.id)}/select-buyer`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ threadId: selectBuyerThreadId }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setSelectBuyerError(payload?.error || 'Unable to select buyer.')
        return
      }

      setSelectBuyerThreadId(null)
      await load()
    } catch {
      setSelectBuyerError('Unable to select buyer.')
    } finally {
      setSelectBuyerSubmitting(false)
    }
  }

  const onRelist = async () => {
    if (!listing) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setRelistSubmitting(true)
    setRelistError(null)
    try {
      const res = await fetch(buildApiUrl(`/market/chats/item/${encodeURIComponent(listing.id)}/relist`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setRelistError(payload?.error || 'Unable to relist item.')
        return
      }

      await load()
    } catch {
      setRelistError('Unable to relist item.')
    } finally {
      setRelistSubmitting(false)
    }
  }

  return (
    <DashboardShell rightRail={<MarketRightRail />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Your listing</h1>
            <p className="mt-1 text-sm text-slate-600">Select a conversation to open the thread.</p>
          </div>
          <div className="flex items-center gap-2">
            {canRelist ? (
              <button
                type="button"
                onClick={() => void onRelist()}
                disabled={relistSubmitting}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {relistSubmitting ? 'Relisting…' : 'Relist item'}
              </button>
            ) : null}
            <Link href="/market/chats" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Back
            </Link>
          </div>
        </div>
        {relistError ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{relistError}</div> : null}
      </section>

      {status === 'loading' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Loading…</div> : null}
      {status === 'error' ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Unable to load conversations.</div> : null}
      {status === 'not-found' ? <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Listing not found.</div> : null}

      {status === 'ready' ? (
        <>
          {header}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-slate-900">All chats</h2>
            <div className="mt-3 space-y-2">
              {threads.length === 0 ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No chats yet.</div> : null}

              {threads.map((thread) => {
                const counterpart = thread.counterpart
                if (!counterpart) return null

                const snippet = thread.lastMessage?.body?.trim() || 'Message'
                const notResponded = thread.lastMessage ? !thread.lastMessage.isMine : false
                const isSelected = Boolean(selectedThreadId && thread.threadId === selectedThreadId)

                return (
                  <div key={thread.threadId} className="relative">
                    <button type="button" onClick={() => openThread(thread.threadId)} className="block w-full rounded-2xl text-left">
                      <div className={isSelected ? 'rounded-2xl ring-2 ring-[var(--cc-primary)]' : ''}>
                        <ConversationCard counterpart={counterpart} timestamp={formatTimestamp(thread.lastMessageAt)} snippet={snippet} notResponded={notResponded} />
                      </div>
                    </button>

                    <div className="absolute right-4 top-4">
                      {isSelected ? (
                        <div className="mb-2 flex justify-end">
                          <span className="rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold text-slate-900">Selected buyer</span>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        disabled={!canSelectBuyer}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setSelectBuyerError(null)
                          setSelectBuyerThreadId(thread.threadId)
                        }}
                        className={
                          'rounded-full px-3 py-1 text-xs font-semibold transition ' +
                          (canSelectBuyer
                            ? 'bg-white/95 text-slate-900 hover:bg-white'
                            : 'cursor-not-allowed bg-white/70 text-slate-400')
                        }
                      >
                        Select Buyer
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <Modal
            open={Boolean(selectBuyerThreadId)}
            onClose={() => {
              if (selectBuyerSubmitting) return
              setSelectBuyerThreadId(null)
            }}
            title="Select Buyer"
            maxWidthClassName="max-w-lg"
          >
            <p className="text-sm text-slate-700">would you like to select a buyer, which will notify all other interested buyers</p>
            {selectBuyerError ? <p className="mt-3 text-sm text-rose-700">{selectBuyerError}</p> : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectBuyerThreadId(null)}
                disabled={selectBuyerSubmitting}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onSelectBuyer()}
                disabled={selectBuyerSubmitting}
                className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {selectBuyerSubmitting ? 'Selecting…' : 'Select Buyer'}
              </button>
            </div>
          </Modal>
        </>
      ) : null}
    </DashboardShell>
  )
}
