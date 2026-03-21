'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import CivilCard from '../../_components/CivilCard'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { formatContractStatus, formatMoney, formatParticipantName, getDeliveryRequirementItems, pickMediaVariantUrl, type DeliveryDriverContract, type DeliveryOnboardingResponse } from '../deliveryShared'

type DriverContractsResponse = {
  items?: DeliveryDriverContract[]
}

type MediaAssetStatusResponse = {
  asset?: {
    status?: string
    failureReason?: string | null
    variants?: unknown
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldUseDirectUpload(url?: string | null) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:') return false
    return true
  } catch {
    return false
  }
}

function getProofUploadErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  switch (code) {
    case 'upload_init_failed':
      return 'Unable to start the proof photo upload.'
    case 'upload_failed':
      return 'Unable to upload the proof photo.'
    case 'upload_complete_failed':
      return 'The proof photo upload could not be completed.'
    case 'processing_timeout':
      return 'The proof photo is still processing. Please try again in a moment.'
    default:
      return code || 'Unable to mark this delivery complete.'
  }
}

async function uploadDeliveryProofPhoto(token: string, file: File) {
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

  const initPayload = (await initRes.json().catch(() => null)) as {
    assetId?: string
    proxyPath?: string
    upload?: { url?: string; method?: string; headers?: Record<string, string> }
    error?: string
  } | null

  if (!initRes.ok || !initPayload?.assetId) throw new Error(initPayload?.error || 'upload_init_failed')

  let uploaded = false
  if (shouldUseDirectUpload(initPayload.upload?.url)) {
    try {
      const directRes = await fetch(initPayload.upload?.url as string, {
        method: initPayload.upload?.method || 'PUT',
        headers: initPayload.upload?.headers,
        body: file,
      })
      uploaded = directRes.ok
    } catch {
      uploaded = false
    }
  }

  if (!uploaded && initPayload.proxyPath) {
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
  }

  if (!uploaded) throw new Error('upload_failed')

  const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assetId: initPayload.assetId }),
  })
  if (!completeRes.ok) throw new Error('upload_complete_failed')

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(1000)
    const pollRes = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(initPayload.assetId)}`), {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!pollRes.ok) continue
    const pollPayload = (await pollRes.json().catch(() => null)) as MediaAssetStatusResponse | null
    if (pollPayload?.asset?.status === 'ready') {
      const mediaUrl = pickMediaVariantUrl(pollPayload.asset.variants)
      if (mediaUrl) return mediaUrl
      break
    }
    if (pollPayload?.asset?.status === 'failed') throw new Error(pollPayload.asset.failureReason || 'processing_failed')
  }

  throw new Error('processing_timeout')
}

export default function DeliveryMyPageClient() {
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<DeliveryDriverContract[]>([])
  const [onboarding, setOnboarding] = useState<DeliveryOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickupModalContractId, setPickupModalContractId] = useState<string | null>(null)
  const [pickupEta, setPickupEta] = useState('')
  const [pickupSubmitting, setPickupSubmitting] = useState(false)
  const [deliverySubmittingId, setDeliverySubmittingId] = useState<string | null>(null)

  const loadContracts = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl('/delivery/contracts/my'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await res.json().catch(() => null)) as (DriverContractsResponse & { error?: string; onboarding?: DeliveryOnboardingResponse }) | null
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (res.status === 403 && payload?.error === 'driver_not_active') {
        setOnboarding(payload.onboarding ?? null)
        setContracts([])
        return
      }
      if (!res.ok) {
        setError('Unable to load your deliveries right now.')
        setContracts([])
        return
      }
      setOnboarding(null)
      setContracts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (err) {
      console.error('Failed to load driver deliveries', err)
      setError('Unable to load your deliveries right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadContracts()
  }, [loadContracts])

  const handlePickup = useCallback(async () => {
    const contractId = pickupModalContractId
    if (!contractId) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!pickupEta) {
      pushToast('Choose an estimated delivery time first.', 'error')
      return
    }

    setPickupSubmitting(true)
    try {
      const eta = new Date(pickupEta)
      const res = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(contractId)}/pickup`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ estimatedDeliveryAt: eta.toISOString() }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; estimatedDeliveryAt?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to mark this delivery as picked up.', 'error')
        return
      }
      pushToast('Delivery marked as picked up.', 'success')
      setContracts((prev) => prev.map((contract) => (contract.id === contractId ? { ...contract, status: 'picked_up', pickedUpAt: contract.pickedUpAt ?? new Date().toISOString(), estimatedDeliveryAt: payload?.estimatedDeliveryAt ?? eta.toISOString() } : contract)))
      setPickupModalContractId(null)
      setPickupEta('')
    } catch (err) {
      console.error('Failed to mark delivery picked up', err)
      pushToast('Unable to mark this delivery as picked up.', 'error')
    } finally {
      setPickupSubmitting(false)
    }
  }, [pickupEta, pickupModalContractId])

  const handleProofSelected = useCallback(async (contractId: string, file: File | null) => {
    if (!file) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setDeliverySubmittingId(contractId)
    try {
      const photoUrl = await uploadDeliveryProofPhoto(token, file)
      const res = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(contractId)}/deliver`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ photoUrl }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to mark this delivery complete.', 'error')
        return
      }
      pushToast('Delivery marked complete with proof photo.', 'success')
      setContracts((prev) => prev.map((contract) => (contract.id === contractId ? { ...contract, status: 'delivered', deliveredAt: new Date().toISOString() } : contract)))
    } catch (err) {
      console.error('Failed to complete delivery', err)
      pushToast(getProofUploadErrorMessage(err), 'error')
    } finally {
      setDeliverySubmittingId(null)
    }
  }, [])

  const pickupModalContract = useMemo(() => contracts.find((entry) => entry.id === pickupModalContractId) ?? null, [contracts, pickupModalContractId])
  const requirementItems = getDeliveryRequirementItems(onboarding?.requirements)

  return (
    <DashboardShell rightRail={<RightRail mode="drive" organizationLinkTarget="chat" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Civil Delivery</p>
              <h1 className="mt-3 text-3xl font-semibold text-slate-900">My Deliveries</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">Manage accepted delivery contracts, share ETAs with the buyer and seller, and upload proof when the item is delivered.</p>
            </div>
            <Link href="/drive" className="inline-flex rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
              Browse open contracts
            </Link>
          </div>
        </section>

        {onboarding ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-amber-950">Your Civil Driver account is not active yet</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {requirementItems.map((item) => (
                <div key={item.key} className={`rounded-2xl border px-4 py-3 text-sm ${item.met ? 'border-emerald-200 bg-white text-emerald-800' : 'border-amber-200 bg-white text-amber-900'}`}>
                  <span className="font-semibold">{item.met ? 'Ready' : 'Needed'}</span>
                  <p className="mt-1">{item.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <Link href="/drive/onboarding" className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95">
                Open onboarding
              </Link>
            </div>
          </section>
        ) : null}

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Loading your delivery contracts…</div>
        ) : null}

        {!loading && !onboarding ? (
          <section className="space-y-4">
            {contracts.length ? (
              contracts.map((contract) => {
                const canMarkPickedUp = contract.status === 'assigned'
                const canMarkDelivered = contract.status === 'picked_up'
                return (
                  <article key={contract.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
                      <div className="relative min-h-44 bg-slate-100">
                        {contract.listingPhotoUrl ? <img src={contract.listingPhotoUrl} alt={contract.listingTitle} className="absolute inset-0 h-full w-full object-cover" /> : null}
                      </div>

                      <div className="space-y-5 p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{formatContractStatus(contract.status)}</p>
                            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{contract.listingTitle}</h2>
                            <p className="mt-2 text-sm text-slate-600">Driver pay: <span className="font-semibold text-slate-900">{formatMoney(contract.bidAmountCents)}</span></p>
                          </div>
                          {contract.groupThreadId ? (
                            <Link href={`/messages?thread=${encodeURIComponent(contract.groupThreadId)}`} className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
                              Open delivery chat
                            </Link>
                          ) : null}
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Seller</p>
                              <div className="mt-2">
                                <CivilCard size="rail" name={formatParticipantName(contract.seller)} avatarAlt={formatParticipantName(contract.seller)} avatarInitials={formatParticipantName(contract.seller)} avatarSrc={contract.seller.avatarUrl} />
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Buyer</p>
                              <div className="mt-2">
                                <CivilCard size="rail" name={formatParticipantName(contract.buyer)} avatarAlt={formatParticipantName(contract.buyer)} avatarInitials={formatParticipantName(contract.buyer)} avatarSrc={contract.buyer.avatarUrl} />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Pickup instructions</p>
                              <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{contract.pickupInstructions?.trim() || 'No extra pickup notes were supplied.'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {contract.itemTraits.length ? contract.itemTraits.map((trait) => <span key={trait} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">{trait}</span>) : <span className="text-sm text-slate-500">No special handling notes.</span>}
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                              <p>Assigned: {contract.estimatedDeliveryAt ? new Date(contract.estimatedDeliveryAt).toLocaleString() : 'Waiting for pickup ETA'}</p>
                              <p className="mt-1">Picked up: {contract.pickedUpAt ? new Date(contract.pickedUpAt).toLocaleString() : 'Not yet'}</p>
                              <p className="mt-1">Delivered: {contract.deliveredAt ? new Date(contract.deliveredAt).toLocaleString() : 'Not yet'}</p>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canMarkPickedUp}
                            onClick={() => setPickupModalContractId(contract.id)}
                            className="rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Picked Up
                          </button>

                          <label className={`inline-flex cursor-pointer items-center rounded-full border px-5 py-2.5 text-sm font-semibold transition ${canMarkDelivered ? 'border-slate-200 text-slate-700 hover:border-emerald-300 hover:text-emerald-700' : 'cursor-not-allowed border-slate-200 text-slate-400 opacity-50'}`}>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                              className="hidden"
                              disabled={!canMarkDelivered || deliverySubmittingId === contract.id}
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null
                                void handleProofSelected(contract.id, file)
                                event.currentTarget.value = ''
                              }}
                            />
                            {deliverySubmittingId === contract.id ? 'Uploading proof…' : 'Delivered with proof photo'}
                          </label>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">You do not have any assigned delivery contracts yet.</div>
            )}
          </section>
        ) : null}

        {pickupModalContract ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
            <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <h2 className="text-2xl font-semibold text-slate-900">Picked Up</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Set the estimated delivery time for {pickupModalContract.listingTitle}. This will be sent into the shared buyer-seller delivery chat.</p>
              <label className="mt-5 block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Estimated delivery</span>
                <input
                  type="datetime-local"
                  value={pickupEta}
                  onChange={(event) => setPickupEta(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900"
                />
              </label>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPickupModalContractId(null)
                    setPickupEta('')
                  }}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pickupSubmitting}
                  onClick={() => void handlePickup()}
                  className="rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pickupSubmitting ? 'Saving…' : 'Send ETA'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
