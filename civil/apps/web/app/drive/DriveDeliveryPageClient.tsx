'use client'

import { useEffect, useState } from 'react'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { DriveCardSkeleton, DriveDeliveryPreviewCard } from './DrivePreviewCards'
import DriveRouteNav from './DriveRouteNav'
import type { DriveDeliveryItem, DriveFeedResponse } from './driveShared'

export default function DriveDeliveryPageClient() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<DriveDeliveryItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
        const response = await fetch(buildApiUrl('/drive/delivery?limit=48'), {
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
          setError('Unable to load delivery requests right now.')
          return
        }

        setItems(Array.isArray(payload?.items) ? payload.items : [])
      } catch (loadError) {
        console.error('Failed to load drive delivery feed', loadError)
        if (cancelled) return
        setItems([])
        setError('Unable to load delivery requests right now.')
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
      rightRail={<RightRail mode="drive" organizationLinkTarget="chat" />}
      showMobileRightRail
      mainClassName="space-y-6 pb-12"
      rightRailClassName="pb-12"
    >
      <DriveRouteNav />

      {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <DriveCardSkeleton key={index} />
          ))}
        </div>
      ) : null}

      {!loading && !error && !items.length ? (
        <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No delivery requests are open right now.</div>
      ) : null}

      {!loading && items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <DriveDeliveryPreviewCard key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </DashboardShell>
  )
}
