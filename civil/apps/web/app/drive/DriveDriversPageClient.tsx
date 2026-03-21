'use client'

import { useEffect, useMemo, useState } from 'react'
import Block from '../_components/Block'
import CivilCard from '../_components/CivilCard'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { DriveCardSkeleton, DriveDriverPreviewCard } from './DrivePreviewCards'
import DriveRouteNav from './DriveRouteNav'
import { getAvatarInitials } from './driveShared'
import type { DriveDriverItem, DriveFeedResponse } from './driveShared'

const PREFERRED_DRIVERS_STORAGE_KEY = 'drivePreferredDrivers'

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

function PreferredDriversRail({ items }: { items: DriveDriverItem[] }) {
  return (
    <Block title="Preferred Drivers">
      <ul className="space-y-3">
        {items.map((item) => {
          const displayName = item.name?.trim() || item.handle?.trim() || 'Civil driver'

          return (
            <li key={item.id}>
              <CivilCard
                size="md"
                name={displayName}
                avatarAlt={displayName}
                avatarInitials={getAvatarInitials(displayName)}
                avatarSrc={item.avatarUrl}
                coverUrl={item.coverUrl}
                titleLines={0}
                subtitleLines={0}
                interactive={false}
              />
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

export default function DriveDriversPageClient() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<DriveDriverItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preferredDrivers, setPreferredDrivers] = useState<DriveDriverItem[]>([])

  const preferredDriverIds = useMemo(() => new Set(preferredDrivers.map((item) => item.id)), [preferredDrivers])

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
        const response = await fetch(buildApiUrl('/drive/drivers?limit=48'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveFeedResponse<DriveDriverItem> | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok) {
          setItems([])
          setError('Unable to load drivers right now.')
          return
        }

        setItems(Array.isArray(payload?.items) ? payload.items : [])
      } catch (loadError) {
        console.error('Failed to load drive drivers feed', loadError)
        if (cancelled) return
        setItems([])
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

  const handleMessageDriver = () => {
    pushToast('Coming soon', 'info')
  }

  return (
    <DashboardShell
      rightRail={
        <div className="space-y-5">
          {preferredDrivers.length ? <PreferredDriversRail items={preferredDrivers} /> : null}
          <RightRail mode="drive" organizationLinkTarget="chat" />
        </div>
      }
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
        <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No active drivers are showing up right now.</div>
      ) : null}

      {!loading && items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <DriveDriverPreviewCard
              key={item.id}
              item={item}
              actions={
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handlePreferDriver(item)}
                    disabled={preferredDriverIds.has(item.id)}
                    className={`inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition ${preferredDriverIds.has(item.id) ? 'cursor-default border border-[var(--cc-primary)]/25 bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'bg-[var(--cc-primary)] text-white hover:brightness-95'}`}
                  >
                    {preferredDriverIds.has(item.id) ? 'Preferred' : 'Prefer Driver'}
                  </button>
                  <button
                    type="button"
                    onClick={handleMessageDriver}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    Message
                  </button>
                </div>
              }
            />
          ))}
        </div>
      ) : null}
    </DashboardShell>
  )
}
