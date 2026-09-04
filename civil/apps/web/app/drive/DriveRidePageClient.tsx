'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveRideOfferModal from './DriveRideOfferModal'
import DriveRouteNav from './DriveRouteNav'
import { DriveDriverAccessGate, DriveRideTable } from './DriveTables'
import type { DriveDriverManageResponse, DriveFeedResponse, DriveRideRequestItem } from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

export default function DriveRidePageClient() {
  const { isDriverActive, isDriverMode, loading: viewerLoading, rideRequestCount, deliveryRequestCount, exitDriverMode } = useDriveViewerState()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<DriveRideRequestItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selectedRide, setSelectedRide] = useState<DriveRideRequestItem | null>(null)
  const [submittingOfferId, setSubmittingOfferId] = useState<string | null>(null)
  const [defaultOfferPerKmCents, setDefaultOfferPerKmCents] = useState(100)

  useEffect(() => {
    if (viewerLoading || !isDriverMode) {
      if (!viewerLoading) setLoading(false)
      return
    }

    let cancelled = false
    let intervalId: number | null = null

    async function load(showLoading: boolean) {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      if (showLoading) setLoading(true)
      try {
        const [response, manageResponse] = await Promise.all([
          fetch(buildApiUrl('/drive/rides?scope=open&limit=48'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/driver/manage'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ])

        const [payload, managePayload] = await Promise.all([
          response.json().catch(() => null) as Promise<DriveFeedResponse<DriveRideRequestItem> | null>,
          manageResponse.json().catch(() => null) as Promise<DriveDriverManageResponse | null>,
        ])

        if (response.status === 401 || manageResponse.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok) {
          if (showLoading) {
            setItems([])
            setTotal(0)
          }
          setError('Unable to load ride requests right now.')
          return
        }

        const nextItems = Array.isArray(payload?.items) ? payload.items : []
        setItems(nextItems)
        setTotal(Number(payload?.total) || 0)
        setError(null)

        if (selectedRide?.id) {
          const refreshedSelectedRide = nextItems.find((entry) => entry.id === selectedRide.id) ?? null
          if (!refreshedSelectedRide) {
            setSelectedRide(null)
            pushToast('This ride request changed and is no longer available.', 'info')
          } else {
            setSelectedRide(refreshedSelectedRide)
          }
        }

        const featuredVehicle =
          Array.isArray(managePayload?.vehicles)
            ? managePayload.vehicles.find((vehicle) => vehicle.featured) ?? managePayload.vehicles[0] ?? null
            : null
        if (featuredVehicle?.perKmFeeCents) {
          setDefaultOfferPerKmCents(featuredVehicle.perKmFeeCents)
        }
      } catch (loadError) {
        console.error('Failed to load drive rides feed', loadError)
        if (cancelled) return
        if (showLoading) {
          setItems([])
          setTotal(0)
        }
        setError('Unable to load ride requests right now.')
      } finally {
        if (!cancelled && showLoading) setLoading(false)
      }
    }

    void load(true)
    intervalId = window.setInterval(() => {
      void load(false)
    }, 10000)

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [isDriverMode, selectedRide?.id, viewerLoading])

  const handleExitDriverMode = () => {
    exitDriverMode()
    router.push('/ride')
  }

  async function handleSubmitOffer(ride: DriveRideRequestItem, perKmFeeCents: number) {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSubmittingOfferId(ride.id)
    try {
      const response = await fetch(buildApiUrl(`/drive/rides/${ride.id}/offer`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ perKmFeeCents }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; item?: DriveRideRequestItem } | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok || !payload?.item) {
        const errorMessage =
          payload?.error === 'driver_not_active'
            ? 'Activate your Drive account before sending offers.'
            : payload?.error === 'ride_not_open'
                ? 'This ride is no longer accepting offers.'
                : payload?.error === 'forbidden'
                  ? 'You cannot make an offer on your own ride request.'
                  : 'Unable to submit that offer right now.'
        pushToast(errorMessage, 'error')
        return
      }

      setItems((current) => current.map((entry) => (entry.id === ride.id ? payload.item ?? entry : entry)))
      setSelectedRide(null)
      pushToast('Offer sent to the customer.', 'success')
    } catch (error) {
      console.error('Failed to submit ride offer', error)
      pushToast('Unable to submit that offer right now.', 'error')
    } finally {
      setSubmittingOfferId((current) => (current === ride.id ? null : current))
    }
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
          title="Ride Requests Are Driver-Only"
          description="Live ride requests are part of driver mode. Enter Driver Mode from /drive to browse pickup requests."
        />
      ) : (
        <DriveRideTable
          title="Ride Requests"
          items={items}
          total={total}
          loading={loading}
          error={error}
          emptyMessage="No ride requests are live right now."
          variant="open"
          onMakeOffer={setSelectedRide}
          submittingOfferId={submittingOfferId}
        />
      )}

      <DriveRideOfferModal
        open={Boolean(selectedRide)}
        item={selectedRide}
        defaultPerKmFeeCents={defaultOfferPerKmCents}
        submitting={Boolean(selectedRide && submittingOfferId === selectedRide.id)}
        onClose={() => setSelectedRide(null)}
        onSubmit={handleSubmitOffer}
      />
    </DashboardShell>
  )
}
