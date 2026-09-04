'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HiOutlineClock, HiOutlineMap, HiOutlineTruck, HiOutlineUserCircle } from 'react-icons/hi2'
import EnableLocationServicesButton from '../_components/EnableLocationServicesButton'
import { getLocationPermissionState, type CivilLocationPermissionState } from '../_lib/locationService'
import DriveActiveRideLocationSync from './DriveActiveRideLocationSync'
import { useDriveViewerState } from './useDriveViewerState'

type DriveNavItem = {
  href: string
  label: string
  icon: typeof HiOutlineClock
  aliases?: string[]
  forceDriverMode?: boolean
}

const REQUESTER_NAV_ITEMS: DriveNavItem[] = [
  { href: '/ride', label: 'My Rides', icon: HiOutlineClock, aliases: ['/drive/ride/request', '/drive/myrides/'] },
  { href: '/delivery/my', label: 'My Deliveries', icon: HiOutlineTruck, aliases: ['/delivery/contracts/my'] },
  { href: '/drive/drivers', label: 'My Drivers', icon: HiOutlineUserCircle, aliases: ['/drive/driver/'] },
]

const DRIVER_NAV_ITEMS: DriveNavItem[] = [
  { href: '/drive/ride', label: 'Open Ride Requests', icon: HiOutlineMap, forceDriverMode: true },
  { href: '/drive/delivery', label: 'Open Delivery Requests', icon: HiOutlineTruck, forceDriverMode: true },
  { href: '/drive/drivers', label: 'My Customers', icon: HiOutlineUserCircle },
]

function isActivePath(pathname: string | null, href: string, aliases?: string[]) {
  if (!pathname) return false
  if (pathname === href) return true
  if (href === '/ride' && /^\/drive\/ride\/request(?:\/|$)/.test(pathname)) return true
  if (href !== '/ride' && pathname.startsWith(`${href}/`)) return true
  return Boolean(aliases?.some((alias) => pathname === alias || pathname.startsWith(alias)))
}

export default function DriveRouteNav() {
  const pathname = usePathname()
  const { isDriverMode, enterDriverMode } = useDriveViewerState()
  const items = isDriverMode ? DRIVER_NAV_ITEMS : REQUESTER_NAV_ITEMS
  const [locationPermissionState, setLocationPermissionState] = useState<CivilLocationPermissionState | null>(null)

  useEffect(() => {
    let cancelled = false

    void getLocationPermissionState('drive-route-nav').then((state) => {
      if (!cancelled) {
        setLocationPermissionState(state)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <DriveActiveRideLocationSync enabled />
      <nav className="w-full space-y-3" aria-label="Drive sections">
        {locationPermissionState && locationPermissionState !== 'granted' && locationPermissionState !== 'unsupported' ? (
          <div className="flex flex-col gap-3 rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-950">Enable Location Services</p>
              <p className="mt-1 text-sm text-emerald-900">Rides and delivery will keep using GPS silently after the first approval.</p>
            </div>
            <EnableLocationServicesButton
              reason="drive-route-nav-enable-location"
              onEnabled={() => {
                setLocationPermissionState('granted')
              }}
              onResult={(result) => {
                setLocationPermissionState(result.state)
              }}
              className="inline-flex items-center justify-center rounded-full border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            />
          </div>
        ) : null}
        <div
          className={`grid w-full gap-3 ${
            items.length >= 4
              ? 'grid-cols-2 xl:grid-cols-4'
              : items.length === 3
                ? 'grid-cols-1 md:grid-cols-3'
                : 'grid-cols-2'
          }`}
        >
          {items.map((item) => {
            const active = isActivePath(pathname, item.href, item.aliases)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={item.forceDriverMode ? () => enterDriverMode() : undefined}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold transition ${active ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-[0_10px_24px_rgba(213,43,30,0.22)] hover:brightness-95' : 'border-slate-200 bg-white text-slate-700 hover:border-[var(--cc-primary)]/25 hover:text-[var(--cc-primary)]'}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
