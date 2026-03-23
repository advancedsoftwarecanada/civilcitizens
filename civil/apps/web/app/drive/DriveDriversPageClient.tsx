'use client'

import { useEffect, useMemo, useState } from 'react'
import { HiOutlineChatBubbleLeftRight, HiOutlineHeart, HiOutlineXMark } from 'react-icons/hi2'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import { DriveCardSkeleton, DriveDriverPreviewCard } from './DrivePreviewCards'
import DriveRouteNav from './DriveRouteNav'
import { getAvatarInitials } from './driveShared'
import type { DriveDriverItem, DriveFeedResponse } from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

const PREFERRED_DRIVERS_STORAGE_KEY = 'drivePreferredDrivers'

type DriveContactItem = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

type DriveContactsResponse = {
  items?: DriveContactItem[]
}

function readPreferredDriversFromStorage() {
  if (typeof window === 'undefined') return [] as DriveDriverItem[]

  try {
    const raw = window.localStorage.getItem(PREFERRED_DRIVERS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as DriveDriverItem[]) : []
  } catch {
    return []
  }
}

function DriverSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  )
}

export default function DriveDriversPageClient() {
  const { isDriverActive, isDriverMode, loading: viewerLoading, rideRequestCount, deliveryRequestCount, enterDriverMode, exitDriverMode } = useDriveViewerState()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<DriveDriverItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preferredDrivers, setPreferredDrivers] = useState<DriveDriverItem[]>([])
  const [pastDrivers, setPastDrivers] = useState<DriveContactItem[]>([])

  const preferredDriverIds = useMemo(() => new Set(preferredDrivers.map((item) => item.id)), [preferredDrivers])
  const pastDriverIds = useMemo(() => new Set(pastDrivers.map((item) => item.id)), [pastDrivers])
  const driverItemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const nearbyDrivers = useMemo(
    () => items.filter((item) => !preferredDriverIds.has(item.id) && !pastDriverIds.has(item.id)),
    [items, pastDriverIds, preferredDriverIds],
  )
  const normalizedPastDrivers = useMemo(
    () =>
      pastDrivers.map((item) => {
        const matched = driverItemMap.get(item.id)
        if (matched) return matched
        return {
          id: item.id,
          handle: item.handle,
          name: item.name,
          bio: null,
          avatarUrl: item.avatarUrl,
          coverUrl: item.coverUrl,
          activeAt: null,
          city: null,
          province: null,
          vehicles: [],
          featuredVehicle: null,
        } satisfies DriveDriverItem
      }),
    [driverItemMap, pastDrivers],
  )
  const visiblePastDrivers = useMemo(
    () => normalizedPastDrivers.filter((item) => !preferredDriverIds.has(item.id)),
    [normalizedPastDrivers, preferredDriverIds],
  )

  useEffect(() => {
    setPreferredDrivers(readPreferredDriversFromStorage())
  }, [])

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
        const [driversResponse, contactsResponse] = await Promise.all([
          fetch(buildApiUrl('/drive/drivers?limit=48'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/contacts'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ])
        const driversPayload = (await driversResponse.json().catch(() => null)) as DriveFeedResponse<DriveDriverItem> | null
        const contactsPayload = (await contactsResponse.json().catch(() => null)) as DriveContactsResponse | null

        if (driversResponse.status === 401 || contactsResponse.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!driversResponse.ok) {
          setItems([])
          setPastDrivers([])
          setError('Unable to load drivers right now.')
          return
        }

        setItems(Array.isArray(driversPayload?.items) ? driversPayload.items : [])
        setPastDrivers(Array.isArray(contactsPayload?.items) ? contactsPayload.items : [])
      } catch (loadError) {
        console.error('Failed to load drive drivers feed', loadError)
        if (cancelled) return
        setItems([])
        setPastDrivers([])
        setError('Unable to load drivers right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PREFERRED_DRIVERS_STORAGE_KEY, JSON.stringify(preferredDrivers))
  }, [preferredDrivers])

  useEffect(() => {
    if (!items.length || !preferredDrivers.length) return

    const itemMap = new Map(items.map((item) => [item.id, item]))
    let changed = false
    const nextPreferred = preferredDrivers.map((item) => {
      const updated = itemMap.get(item.id)
      if (!updated) return item
      if (updated !== item) changed = true
      return updated
    })

    if (changed) setPreferredDrivers(nextPreferred)
  }, [items, preferredDrivers])

  const handlePreferDriver = (item: DriveDriverItem) => {
    if (preferredDriverIds.has(item.id)) {
      pushToast('Driver already preferred.', 'info')
      return
    }

    setPreferredDrivers((current) => [item, ...current.filter((entry) => entry.id !== item.id)])
    pushToast('Driver added to Preferred Drivers.', 'success')
  }

  const handleRemovePreferredDriver = (item: DriveDriverItem) => {
    if (!preferredDriverIds.has(item.id)) return

    setPreferredDrivers((current) => current.filter((entry) => entry.id !== item.id))
    pushToast('Driver removed from Preferred Drivers.', 'success')
  }

  const handleMessageDriver = () => {
    pushToast('Coming soon', 'info')
  }

  const renderDriverActions = (item: DriveDriverItem) => (
    <div className="flex flex-wrap gap-3">
      {preferredDriverIds.has(item.id) ? (
        <button
          type="button"
          onClick={() => handleRemovePreferredDriver(item)}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
        >
          <HiOutlineXMark className="mr-2 h-4 w-4 shrink-0" />
          Remove Preferred
        </button>
      ) : (
        <button
          type="button"
          onClick={() => handlePreferDriver(item)}
          className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
        >
          <HiOutlineHeart className="mr-2 h-4 w-4 shrink-0" />
          Prefer Driver
        </button>
      )}
      <button
        type="button"
        onClick={handleMessageDriver}
        className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
      >
        <HiOutlineChatBubbleLeftRight className="mr-2 h-4 w-4 shrink-0" />
        Message
      </button>
    </div>
  )

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
            onEnterDriverMode={enterDriverMode}
            onExitDriverMode={exitDriverMode}
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

      {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <DriveCardSkeleton key={index} />
          ))}
        </div>
      ) : null}

      {!loading ? (
        <div className="space-y-8">
          <DriverSection title="Preferred Drivers" description="Set a preferred driver so it's easier for you to find them again.">
            {preferredDrivers.length ? (
              <div className="space-y-4">
                {preferredDrivers.map((item) => (
                  <DriveDriverPreviewCard key={item.id} item={item} actions={renderDriverActions(item)} />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No preferred drivers yet.</div>
            )}
          </DriverSection>

          <DriverSection title="Past Drivers" description="After completing a ride, your past drivers will be shown here.">
            {visiblePastDrivers.length ? (
              <div className="space-y-4">
                {visiblePastDrivers.map((item) => (
                  <DriveDriverPreviewCard key={item.id} item={item} actions={renderDriverActions(item)} />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No past drivers yet.</div>
            )}
          </DriverSection>

          <DriverSection title="Drivers Nearby" description="Browse nearby drivers available on Drive.">
            {!nearbyDrivers.length ? (
              <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No drivers found.</div>
            ) : (
              <div className="space-y-4">
                {nearbyDrivers.map((item) => (
                  <DriveDriverPreviewCard key={item.id} item={item} actions={renderDriverActions(item)} />
                ))}
              </div>
            )}
          </DriverSection>
        </div>
      ) : null}
    </DashboardShell>
  )
}
