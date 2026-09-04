'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardShell from '../_components/DashboardShell'
import Modal from '../_components/Modal'
import { RightRail } from '../_components/RightRail'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveDeliveryOfferModal from './DriveDeliveryOfferModal'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveRouteNav from './DriveRouteNav'
import { DriveDeliveryTable, DriveDriverAccessGate } from './DriveTables'
import { formatDriveDateTime, formatDriveMoney, type DriveDeliveryItem, type DriveDriverManageResponse, type DriveFeedResponse } from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

function toDateTimeLocalValue(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  if (!Number.isFinite(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function buildMapSearchUrl(label: string | null | undefined) {
  const query = typeof label === 'string' ? label.trim() : ''
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null
}

export default function DriveDeliveryPageClient() {
  const { isDriverActive, isDriverMode, loading: viewerLoading, rideRequestCount, deliveryRequestCount, exitDriverMode } = useDriveViewerState()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [openItems, setOpenItems] = useState<DriveDeliveryItem[]>([])
  const [myItems, setMyItems] = useState<DriveDeliveryItem[]>([])
  const [openTotal, setOpenTotal] = useState(0)
  const [myTotal, setMyTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [defaultPerKmFeeCents, setDefaultPerKmFeeCents] = useState(150)
  const [selectedOfferItem, setSelectedOfferItem] = useState<DriveDeliveryItem | null>(null)
  const [selectedManageItem, setSelectedManageItem] = useState<DriveDeliveryItem | null>(null)
  const [pickupEtaValue, setPickupEtaValue] = useState(() => toDateTimeLocalValue(null))
  const [submittingOfferId, setSubmittingOfferId] = useState<string | null>(null)
  const [managingId, setManagingId] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (!options?.silent) setLoading(true)
    setError(null)

    try {
      const [openResponse, mineResponse, manageResponse] = await Promise.all([
        fetch(buildApiUrl('/drive/delivery?scope=open&limit=48'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(buildApiUrl('/drive/delivery?scope=mine&limit=24'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(buildApiUrl('/drive/driver/manage'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ])

      if (openResponse.status === 401 || mineResponse.status === 401 || manageResponse.status === 401) {
        redirectToAuthModal('login')
        return
      }

      const [openPayload, minePayload, managePayload] = await Promise.all([
        openResponse.json().catch(() => null) as Promise<DriveFeedResponse<DriveDeliveryItem> | null>,
        mineResponse.json().catch(() => null) as Promise<DriveFeedResponse<DriveDeliveryItem> | null>,
        manageResponse.json().catch(() => null) as Promise<DriveDriverManageResponse | null>,
      ])

      if (!openResponse.ok || !mineResponse.ok) {
        setOpenItems([])
        setMyItems([])
        setOpenTotal(0)
        setMyTotal(0)
        setError('Unable to load delivery requests right now.')
        return
      }

      const vehicles = Array.isArray(managePayload?.vehicles) ? managePayload.vehicles : []
      const featuredVehicle = vehicles.find((vehicle) => vehicle.featured) ?? vehicles[0] ?? null

      setOpenItems(Array.isArray(openPayload?.items) ? openPayload.items : [])
      setMyItems(Array.isArray(minePayload?.items) ? minePayload.items : [])
      setOpenTotal(Number(openPayload?.total) || 0)
      setMyTotal(Number(minePayload?.total) || 0)
      setDefaultPerKmFeeCents(featuredVehicle?.perKmFeeCents ?? 150)
    } catch (loadError) {
      console.error('Failed to load drive delivery feed', loadError)
      setOpenItems([])
      setMyItems([])
      setOpenTotal(0)
      setMyTotal(0)
      setError('Unable to load delivery requests right now.')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (viewerLoading || !isDriverMode) {
      if (!viewerLoading) setLoading(false)
      return
    }

    let cancelled = false

    void loadData()
    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void loadData({ silent: true })
      }
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [isDriverMode, loadData, viewerLoading])

  useEffect(() => {
    setPickupEtaValue(toDateTimeLocalValue(selectedManageItem?.estimatedDeliveryAt))
  }, [selectedManageItem])

  const handleSubmitOffer = useCallback(
    async (item: DriveDeliveryItem, perKmFeeCents: number) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setSubmittingOfferId(item.id)
      try {
        const response = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(item.id)}/bid`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ perKmFeeCents }),
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) throw new Error('delivery_bid_failed')

        setSelectedOfferItem(null)
        await loadData({ silent: true })
      } catch (submitError) {
        console.error('Failed to submit delivery bid', submitError)
        setError('Unable to submit that delivery bid right now.')
      } finally {
        setSubmittingOfferId(null)
      }
    },
    [loadData],
  )

  const handlePickup = useCallback(async () => {
    if (!selectedManageItem) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setActionLoadingId(selectedManageItem.id)
    try {
      const response = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(selectedManageItem.id)}/pickup`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ estimatedDeliveryAt: new Date(pickupEtaValue).toISOString() }),
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) throw new Error('delivery_pickup_failed')

      setSelectedManageItem(null)
      await loadData({ silent: true })
    } catch (actionError) {
      console.error('Failed to update delivery pickup state', actionError)
      setError('Unable to mark that item as picked up right now.')
    } finally {
      setActionLoadingId(null)
      setManagingId(null)
    }
  }, [loadData, pickupEtaValue, selectedManageItem])

  const handleDelivered = useCallback(async () => {
    if (!selectedManageItem) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setActionLoadingId(selectedManageItem.id)
    try {
      const response = await fetch(buildApiUrl(`/delivery/contracts/${encodeURIComponent(selectedManageItem.id)}/deliver`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) throw new Error('delivery_deliver_failed')

      setSelectedManageItem(null)
      await loadData({ silent: true })
    } catch (actionError) {
      console.error('Failed to complete delivery', actionError)
      setError('Unable to mark that delivery complete right now.')
    } finally {
      setActionLoadingId(null)
      setManagingId(null)
    }
  }, [loadData, selectedManageItem])

  const handleExitDriverMode = () => {
    exitDriverMode()
    router.push('/ride')
  }

  const managePickupUrl = useMemo(() => buildMapSearchUrl(selectedManageItem?.pickupAddressLabel), [selectedManageItem?.pickupAddressLabel])
  const manageDropoffUrl = useMemo(() => buildMapSearchUrl(selectedManageItem?.dropoffAddressLabel), [selectedManageItem?.dropoffAddressLabel])

  return (
    <DashboardShell
      rightRail={
        <div className="space-y-5">
          <DriveModeRail
            isDriverActive={isDriverActive}
            isDriverMode={isDriverMode}
            loading={viewerLoading}
            rideRequestCount={rideRequestCount}
            deliveryRequestCount={deliveryRequestCount}
            onExitDriverMode={handleExitDriverMode}
          />
          <DriveDriverEarningsRail enabled={isDriverMode} />
          <RightRail mode="drive" organizationLinkTarget="chat" showDriveCallout={false} />
        </div>
      }
      showMobileRightRail
      mainClassName="space-y-6 pb-12"
      rightRailClassName="pb-12"
    >
      <DriveRouteNav />

      {!viewerLoading && !isDriverMode ? (
        <DriveDriverAccessGate
          title="Delivery Requests Are Driver-Only"
          description="Live delivery requests are part of driver mode. Enter Driver Mode from /drive to browse nearby contracts."
        />
      ) : (
        <div className="space-y-6">
          <DriveDeliveryTable
            title="Open Delivery Requests"
            items={openItems}
            total={openTotal}
            loading={loading}
            error={error}
            emptyMessage="No delivery requests are live right now."
            variant="open"
            onMakeOffer={(item) => setSelectedOfferItem(item)}
            submittingOfferId={submittingOfferId}
          />

          <DriveDeliveryTable
            title="My Active Deliveries"
            items={myItems}
            total={myTotal}
            loading={loading}
            error={null}
            emptyMessage="You do not have any active delivery contracts right now."
            variant="mine"
            onManage={(item) => {
              setManagingId(item.id)
              setSelectedManageItem(item)
            }}
            managingId={managingId}
          />
        </div>
      )}

      <DriveDeliveryOfferModal
        open={Boolean(selectedOfferItem)}
        item={selectedOfferItem}
        defaultPerKmFeeCents={defaultPerKmFeeCents}
        submitting={Boolean(submittingOfferId)}
        onClose={() => setSelectedOfferItem(null)}
        onSubmit={handleSubmitOffer}
      />

      <Modal
        open={Boolean(selectedManageItem)}
        onClose={() => {
          setSelectedManageItem(null)
          setManagingId(null)
        }}
        title="Manage Delivery"
        maxWidthClassName="max-w-2xl"
      >
        {selectedManageItem ? (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-900">{selectedManageItem.pickupAddressLabel || 'Pickup pending'}</p>
              </div>
              <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Dropoff</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-900">{selectedManageItem.dropoffAddressLabel || 'Dropoff pending'}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Status</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{selectedManageItem.status.replace(/_/g, ' ')}</p>
              </div>
              <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Payout</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{formatDriveMoney(selectedManageItem.bidAmountCents)}</p>
              </div>
              <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">ETA</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{selectedManageItem.estimatedDeliveryAt ? formatDriveDateTime(selectedManageItem.estimatedDeliveryAt) : 'Not set yet'}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {managePickupUrl ? (
                <a href={managePickupUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
                  Pickup Directions
                </a>
              ) : null}
              {manageDropoffUrl ? (
                <a href={manageDropoffUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
                  Dropoff Directions
                </a>
              ) : null}
              {selectedManageItem.groupThreadId ? (
                <button
                  type="button"
                  onClick={() => router.push(`/messages?thread=${encodeURIComponent(selectedManageItem.groupThreadId || '')}`)}
                  className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  Open Chat
                </button>
              ) : null}
            </div>

            {(selectedManageItem.status || '').trim().toLowerCase() === 'assigned' ? (
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                <label className="block text-sm font-semibold text-slate-950" htmlFor="delivery-eta-input">
                  Delivery ETA after pickup
                </label>
                <input
                  id="delivery-eta-input"
                  type="datetime-local"
                  value={pickupEtaValue}
                  onChange={(event) => setPickupEtaValue(event.target.value)}
                  className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedManageItem(null)
                  setManagingId(null)
                }}
                className="inline-flex rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
              >
                Close
              </button>
              {(selectedManageItem.status || '').trim().toLowerCase() === 'assigned' ? (
                <button
                  type="button"
                  onClick={handlePickup}
                  disabled={actionLoadingId === selectedManageItem.id || !pickupEtaValue}
                  className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoadingId === selectedManageItem.id ? 'Updating…' : 'Item Picked Up'}
                </button>
              ) : null}
              {(selectedManageItem.status || '').trim().toLowerCase() === 'picked_up' ? (
                <button
                  type="button"
                  onClick={handleDelivered}
                  disabled={actionLoadingId === selectedManageItem.id}
                  className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoadingId === selectedManageItem.id ? 'Updating…' : 'Delivered'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </DashboardShell>
  )
}
