'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HiOutlineMap, HiOutlineTruck, HiOutlineUserCircle } from 'react-icons/hi2'

const DRIVE_NAV_ITEMS = [
  { href: '/drive/ride', label: 'Rides', icon: HiOutlineMap },
  { href: '/drive/delivery', label: 'Delivery', icon: HiOutlineTruck },
  { href: '/drive/drivers', label: 'Drivers', icon: HiOutlineUserCircle, aliases: ['/drive/driver/'] },
]

function isActivePath(pathname: string | null, href: string, aliases?: string[]) {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`) || Boolean(aliases?.some((alias) => pathname.startsWith(alias)))
}

export default function DriveRouteNav() {
  const pathname = usePathname()

  return (
    <nav className="w-full" aria-label="Drive sections">
      <div className="grid w-full grid-cols-3 gap-3">
        {DRIVE_NAV_ITEMS.map((item) => {
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
  )
}
