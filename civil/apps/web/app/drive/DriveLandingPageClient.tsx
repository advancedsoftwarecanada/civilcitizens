'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveRouteNav from './DriveRouteNav'
import {
  DriveCardSkeleton,
  DriveDeliveryPreviewCard,
  DriveDriverPreviewCard,
  DriveRidePreviewCard,
} from './DrivePreviewCards'
import DriveRideRequestRail from './DriveRideRequestRail'
import type { DriveDeliveryItem, DriveDriverItem, DriveFeedResponse, DriveRideRequestItem } from './driveShared'

type FeedState<T> = {
  items: T[]
  error: string | null
}

function DrivePreviewSection({
  title,
  href,
  loading,
  error,
  emptyMessage,
  children,
}: {
  title: string
  href: string
  loading: boolean
  error: string | null
  emptyMessage: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
        </div>
        <Link
          href={href}
          className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
        >
          View All
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <DriveCardSkeleton key={index} />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {!loading && !error ? children : null}

      {!loading && !error && !children ? (
        <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">{emptyMessage}</div>
      ) : null}
    </section>
  )
}

export default function DriveLandingPageClient() {
  const [loading, setLoading] = useState(true)
  const [rides, setRides] = useState<FeedState<DriveRideRequestItem>>({ items: [], error: null })
  const [delivery, setDelivery] = useState<FeedState<DriveDeliveryItem>>({ items: [], error: null })
  const [drivers, setDrivers] = useState<FeedState<DriveDriverItem>>({ items: [], error: null })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      try {
        const [ridesRes, deliveryRes, driversRes] = await Promise.all([
          fetch(buildApiUrl('/drive/rides?limit=6'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/delivery?limit=6'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/drivers?limit=6'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ])

        const [ridesPayload, deliveryPayload, driversPayload] = await Promise.all([
          ridesRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveRideRequestItem> | null>,
          deliveryRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveDeliveryItem> | null>,
          driversRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveDriverItem> | null>,
        ])

        if (ridesRes.status === 401 || deliveryRes.status === 401 || driversRes.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        setRides({
          items: ridesRes.ok && Array.isArray(ridesPayload?.items) ? ridesPayload.items : [],
          error: ridesRes.ok ? null : 'Unable to load ride requests right now.',
        })
        setDelivery({
          items: deliveryRes.ok && Array.isArray(deliveryPayload?.items) ? deliveryPayload.items : [],
          error: deliveryRes.ok ? null : 'Unable to load delivery requests right now.',
        })
        setDrivers({
          items: driversRes.ok && Array.isArray(driversPayload?.items) ? driversPayload.items : [],
          error: driversRes.ok ? null : 'Unable to load drivers right now.',
        })
      } catch (error) {
        console.error('Failed to load Drive overview', error)
        if (cancelled) return
        setRides({ items: [], error: 'Unable to load ride requests right now.' })
        setDelivery({ items: [], error: 'Unable to load delivery requests right now.' })
        setDrivers({ items: [], error: 'Unable to load drivers right now.' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DashboardShell
      rightRail={
        <div className="space-y-5">
          <DriveRideRequestRail />
          <RightRail mode="drive" organizationLinkTarget="chat" />
        </div>
      }
      showMobileRightRail
      mainClassName="space-y-8 pb-12"
      rightRailClassName="pb-12"
    >
      <DriveRouteNav />

      <DrivePreviewSection
        title="Ride Requests"
        href="/drive/ride"
        loading={loading}
        error={rides.error}
        emptyMessage="No ride requests have been posted yet."
      >
        {rides.items.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rides.items.map((item) => (
              <DriveRidePreviewCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </DrivePreviewSection>

      <DrivePreviewSection
        title="Delivery Requests"
        href="/drive/delivery"
        loading={loading}
        error={delivery.error}
        emptyMessage="No delivery requests are open right now."
      >
        {delivery.items.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {delivery.items.map((item) => (
              <DriveDeliveryPreviewCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </DrivePreviewSection>

      <DrivePreviewSection
        title="Drivers"
        href="/drive/drivers"
        loading={loading}
        error={drivers.error}
        emptyMessage="No active drivers are showing up right now."
      >
        {drivers.items.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {drivers.items.map((item) => (
              <DriveDriverPreviewCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </DrivePreviewSection>
    </DashboardShell>
  )
}
