'use client'

import Link from 'next/link'
import { useMemo, type CSSProperties } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import {
  HiOutlineChatBubbleOvalLeft,
  HiOutlineHome,
  HiOutlineBuildingOffice2,
  HiOutlineUserCircle,
  HiOutlineBuildingLibrary,
  HiOutlineCalendarDays,
  HiOutlineShoppingBag,
  HiOutlineBriefcase,
  HiOutlineUsers,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import CivilCard from './CivilCard'
import { formatDisplayName } from '../_lib/text'
import { useViewerStore } from '../_lib/viewerStore'

type SidebarProps = {
  me?: {
    name?: string | null
    handle?: string
    avatarUrl?: string | null
    coverUrl?: string | null
    email?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  active?: 'home' | 'chambers' | 'communities' | 'community' | string
}

export type SidebarNavItem = {
  key: string
  label: string
  href: string
  icon: IconType
  badge?: string
  description?: string
}

export const PRIMARY_NAV: SidebarNavItem[] = [
  { key: 'home', label: 'Civic Pulse', href: '/home', icon: HiOutlineHome },
  { key: 'messages', label: 'Messages', href: '/messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'friends', label: 'Friends', href: '/friends', icon: HiOutlineUsers },
  { key: 'network', label: 'Network', href: '/network', icon: HiOutlineBriefcase },
  {
    key: 'communities',
    label: 'Communities',
    href: '/communities',
    icon: HiOutlineBuildingOffice2,
  },
  {
    key: 'organizations',
    label: 'Organizations',
    href: '/organizations',
    icon: HiOutlineBuildingLibrary,
  },
  { key: 'events', label: 'Events', href: '/events', icon: HiOutlineCalendarDays },
  { key: 'market', label: 'Market', href: '/market', icon: HiOutlineShoppingBag },
  { key: 'work', label: 'Work', href: '/work', icon: HiOutlineBriefcase },
  // TODO(app-store): restore News, Podcasts, Music, and Video nav items once those product areas are ready.
  { key: 'account', label: 'Account Settings', href: '/settings', icon: HiOutlineUserCircle },
]

function navItemClasses(active: boolean) {
  return clsx(
    'group flex h-[var(--nav-item-h)] min-h-[36px] items-center gap-2.5 rounded-[var(--nav-radius)] px-[var(--nav-pad-x)] py-[var(--nav-pad-y)] text-[12.5px] font-semibold leading-tight transition-all',
    active
      ? 'bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20'
      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
  )
}

export default function Sidebar({ me, active }: SidebarProps) {
  const cachedMe = useViewerStore((s) => s.me)
  const effectiveMe = me ?? cachedMe ?? undefined
  const pathname = usePathname()
  const normalizedActive =
    active === 'profile' || active === 'settings'
      ? 'account'
      : active === 'community' || active === 'chambers'
        ? 'communities'
        : active
  const displayName = formatDisplayName(effectiveMe?.name ?? null) || 'Civil Citizen'
  const avatarInitials = displayName || effectiveMe?.handle || 'C'
  const profileHref = effectiveMe?.handle ? `/u/${effectiveMe.handle}` : '/profile/edit'
  const verified = Boolean(effectiveMe?.isVerified)
  const business = Boolean(effectiveMe?.isPremium)
  const navCount = PRIMARY_NAV.length
  const sidebarTopOffsetPx = 72
  const sidebarBottomPadPx = 10
  const profileHeightPx = 56
  const profileGapPx = 8
  const navTopGapPx = 8
  const navGapPx = 6
  const totalNavGapPx = (navCount - 1) * navGapPx
  const navAvailableHeightExpr = `100vh - ${sidebarTopOffsetPx}px - ${sidebarBottomPadPx}px - ${profileHeightPx}px - ${profileGapPx}px - ${navTopGapPx}px - ${totalNavGapPx}px`
  const spacingVars = {
    '--sidebar-pad': '10px',
    '--sidebar-gap': `${navGapPx}px`,
    '--sidebar-top-gap': `${navTopGapPx}px`,
    '--profile-card-gap': '8px',
    '--nav-pad-x': '10px',
    '--nav-pad-y': '6px',
    '--nav-icon-pad': '8px',
    '--nav-icon-size': '20px',
    '--nav-radius': '12px',
    '--nav-item-h': `calc((${navAvailableHeightExpr}) / ${navCount})`,
  } as CSSProperties
  const sidebarBleedStyle: CSSProperties = {
    marginLeft: 0,
  }
  const derivedActiveKey = useMemo(() => {
    if (pathname && /(^|\/)(orgs|organizations)(\/|$)/.test(pathname)) return 'organizations'
    if (pathname && /^(\/c\/|\/com\/)/.test(pathname)) return 'communities'
    if (normalizedActive) return normalizedActive
    return PRIMARY_NAV.find((item) => (pathname ? pathname.startsWith(item.href) : false))?.key ?? null
  }, [normalizedActive, pathname])

  const navContent = (items: SidebarNavItem[]) =>
    items.map((item) => {
      const Icon = item.icon
      const activeMatch = derivedActiveKey === item.key
      return (
        <Link key={item.key} href={item.href} className={navItemClasses(activeMatch)} aria-current={activeMatch ? 'page' : undefined}>
          <span
            className={clsx(
              'inline-flex items-center justify-center rounded-xl border p-[var(--nav-icon-pad)] text-[var(--nav-icon-size)] shadow-sm transition-all',
              activeMatch
                ? 'border-white/25 bg-white/18 text-white'
                : 'border-slate-200 bg-white text-slate-500 group-hover:border-[var(--cc-primary)]/30 group-hover:bg-[var(--cc-primary)]/10 group-hover:text-[var(--cc-primary)]',
            )}
          >
            <Icon className="h-[var(--nav-icon-size)] w-[var(--nav-icon-size)]" />
          </span>
          <div className="flex-1">
            <span className="block leading-tight">
              {item.label}
            </span>
          </div>
          {item.badge ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.badge}</span>
          ) : null}
        </Link>
      )
    })

  return (
    <aside
      className="hidden lg:fixed lg:left-0 lg:top-0 lg:flex lg:h-screen lg:max-h-screen lg:w-72 lg:flex-col lg:flex-shrink-0 lg:overflow-hidden lg:border-r lg:border-slate-200 lg:bg-white lg:px-[var(--sidebar-pad)] lg:pt-[72px] lg:pb-[10px] lg:[--sidebar-offset:0px] xl:w-80 xl:[--sidebar-offset:0px]"
      style={{ ...spacingVars, ...sidebarBleedStyle }}
    >
      <CivilCard
        href={profileHref}
        size="rail"
        name={displayName}
        subtitle="View profile"
        avatarAlt={displayName}
        avatarInitials={avatarInitials}
        avatarSrc={effectiveMe?.avatarUrl ?? null}
        coverUrl={effectiveMe?.coverUrl ?? null}
        isVerified={verified}
        isBusiness={business}
        className="mt-[var(--profile-card-gap)]"
      />

      <nav className="mt-[var(--sidebar-top-gap)] flex flex-1 flex-col gap-[var(--sidebar-gap)]">
        {navContent(PRIMARY_NAV)}
      </nav>
    </aside>
  )
}
