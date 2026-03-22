'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Block from '../_components/Block'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import { getStoredToken } from '../_lib/tokenStorage'
import { formatDriveDateTime, formatDriveRelativePickupTime, type DriveFeedResponse, type DriveRideRequestItem } from './driveShared'

function isTerminalRideStatus(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return ['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(normalized)
}

export default function DriveNextContractsRail({ currentRideId }: { currentRideId: string }) {
  const [items, setItems] = useState<DriveRideRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadNextContracts() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildApiUrl('/drive/rides?scope=mine&limit=24'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        const payload = (await response.json().catch(() => null)) as DriveFeedResponse<DriveRideRequestItem> | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok) {
          setItems([])
          setError('Unable to load next contracts right now.')
          return
        }

        setItems(Array.isArray(payload?.items) ? payload.items : [])
      } catch (loadError) {
        console.error('Failed to load next drive contracts', loadError)
        if (cancelled) return
        setItems([])
        setError('Unable to load next contracts right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadNextContracts()
    return () => {
      cancelled = true
    }
  }, [currentRideId])

  const nextContracts = useMemo(
    () =>
      items
        .filter((item) => item.id !== currentRideId)
        .filter((item) => item.viewerRole === 'driver' && Boolean(item.acceptedOfferId) && !isTerminalRideStatus(item.status))
        .sort((left, right) => {
          const leftDate = new Date(left.pickupAt)
          const rightDate = new Date(right.pickupAt)
          return leftDate.getTime() - rightDate.getTime()
        })
        .slice(0, 4),
    [currentRideId, items],
  )

  return (
    <Block title="Next Contracts">
      {loading ? <p className="text-sm text-slate-500">Loading next contracts…</p> : null}

      {!loading && error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error && nextContracts.length ? (
        <div className="space-y-3">
          {nextContracts.map((item) => {
            const pickupLabel = formatCanadianPhysicalAddressInline(item.pickupAddress) || 'Pickup pending'

            return (
              <Link
                key={item.id}
                href={`/drive/${encodeURIComponent(item.id)}/contract`}
                className="block rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3 transition hover:border-[var(--cc-primary)]/20 hover:bg-slate-50"
              >
                <p className="truncate text-sm font-semibold text-slate-900">{pickupLabel}</p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Pickup In</span>
                    <span className="font-semibold text-slate-950">{formatDriveRelativePickupTime(item.pickupAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Pickup Time</span>
                    <span className="text-right font-medium text-slate-700">{formatDriveDateTime(item.pickupAt)}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      ) : null}

      {!loading && !error && !nextContracts.length ? <p className="text-sm text-slate-500">No upcoming contracts after this one.</p> : null}
    </Block>
  )
}