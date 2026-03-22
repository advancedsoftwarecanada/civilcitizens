'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HiOutlineClock, HiOutlineMap, HiOutlineTruck, HiOutlineUserCircle } from 'react-icons/hi2'
import DriveActiveRideLocationSync from './DriveActiveRideLocationSync'
import { useDriveViewerState } from './useDriveViewerState'

const DRIVE_NAV_ITEMS = [
  { href: '/drive', label: 'My Rides', icon: HiOutlineClock, aliases: ['/drive/ride/request', '/drive/myrides/'], driverOnly: false },
  { href: '/delivery/my', label: 'My Deliveries', icon: HiOutlineTruck, aliases: ['/delivery/contracts/my'], driverOnly: false, requesterOnly: true },
  { href: '/drive/ride', label: 'Ride Requests', icon: HiOutlineMap, driverOnly: true },
  { href: '/drive/delivery', label: 'Delivery Requests', icon: HiOutlineTruck, driverOnly: true },
  { href: '/drive/drivers', label: 'Drivers', icon: HiOutlineUserCircle, aliases: ['/drive/driver/'], driverOnly: false },
]

function isActivePath(pathname: string | null, href: string, aliases?: string[]) {
  if (!pathname) return false
  if (pathname === href) return true
  if (href === '/drive' && /^\/drive\/[^/]+\/contract(?:\/|$)/.test(pathname)) return true
  if (href !== '/drive' && pathname.startsWith(`${href}/`)) return true
  return Boolean(aliases?.some((alias) => pathname === alias || pathname.startsWith(alias)))
}

export default function DriveRouteNav() {
  const pathname = usePathname()
  const { isDriverMode } = useDriveViewerState()
  const items = DRIVE_NAV_ITEMS.filter((item) => {
    if (item.driverOnly && !isDriverMode) return false
    if (item.requesterOnly && isDriverMode) return false
    return true
  })

  return (
    <>
      <DriveActiveRideLocationSync enabled />
      <nav className="w-full" aria-label="Drive sections">
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
