'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveRouteNav from './DriveRouteNav'
import { DriveDeliveryTable, DriveDriverAccessGate } from './DriveTables'
import type { DriveDeliveryItem, DriveFeedResponse } from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

export default function DriveDeliveryPageClient() {
  const { isDriverActive, isDriverMode, loading: viewerLoading, rideRequestCount, deliveryRequestCount, exitDriverMode } = useDriveViewerState()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<DriveDeliveryItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (viewerLoading || !isDriverMode) {
      if (!viewerLoading) setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildApiUrl('/drive/delivery?scope=open&limit=48'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveFeedResponse<DriveDeliveryItem> | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok) {
          setItems([])
          setTotal(0)
          setError('Unable to load delivery requests right now.')
          return
        }

        setItems(Array.isArray(payload?.items) ? payload.items : [])
        setTotal(Number(payload?.total) || 0)
      } catch (loadError) {
        console.error('Failed to load drive delivery feed', loadError)
        if (cancelled) return
        setItems([])
        setTotal(0)
        setError('Unable to load delivery requests right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isDriverMode, viewerLoading])

  const handleExitDriverMode = () => {
    exitDriverMode()
    router.push('/drive')
  }

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
          <DriveDriverEarningsRail enabled={isDriverActive} />
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
        <DriveDeliveryTable
          title="Delivery Requests"
          items={items}
          total={total}
          loading={loading}
          error={error}
          emptyMessage="No delivery requests are live right now."
          variant="open"
        />
      )}
    </DashboardShell>
  )
}
