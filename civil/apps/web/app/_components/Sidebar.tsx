'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import {
  HiOutlineHome,
  HiOutlineBuildingOffice2,
  HiOutlineUserCircle,
  HiOutlineChatBubbleLeftRight,
  HiOutlineBuildingLibrary,
  HiOutlineCalendarDays,
  HiOutlineShoppingBag,
  HiOutlineWallet,
  HiOutlineBriefcase,
  HiOutlineUserGroup,
  HiOutlineNewspaper,
  HiOutlineMicrophone,
  HiOutlineMusicalNote,
  HiOutlineVideoCamera,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'

type SidebarProps = {
  me?: {
    name?: string | null
    handle?: string
    avatarUrl?: string | null
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
  { key: 'home', label: 'Home', href: '/home', icon: HiOutlineHome },
  { key: 'friends', label: 'Friends', href: '/friends', icon: HiOutlineUserGroup },
  {
    key: 'communities',
    label: 'Communities',
    href: '/communities',
    icon: HiOutlineBuildingOffice2,
  },
  { key: 'messages', label: 'Messages', href: '/messages', icon: HiOutlineChatBubbleLeftRight },
  {
    key: 'organizations',
    label: 'Organizations',
    href: '/organizations',
    icon: HiOutlineBuildingLibrary,
  },
  { key: 'events', label: 'Events', href: '/events', icon: HiOutlineCalendarDays },
  { key: 'market', label: 'Market', href: '/market', icon: HiOutlineShoppingBag },
  { key: 'work', label: 'Work', href: '/work', icon: HiOutlineBriefcase },
  { key: 'wallet', label: 'Wallet', href: '/wallet', icon: HiOutlineWallet },
  { key: 'news', label: 'News', href: '/news', icon: HiOutlineNewspaper },
  { key: 'podcasts', label: 'Podcasts', href: '/podcasts', icon: HiOutlineMicrophone },
  { key: 'music', label: 'Music', href: '/music', icon: HiOutlineMusicalNote },
  { key: 'video', label: 'Video', href: '/video', icon: HiOutlineVideoCamera },
  { key: 'account', label: 'Account Settings', href: '/settings', icon: HiOutlineUserCircle },
]

const MIN_NAV_SCALE = 0.72

function navItemClasses(active: boolean) {
  return clsx(
    'group flex items-center gap-2 rounded-[var(--nav-radius)] px-[var(--nav-pad-x)] py-[var(--nav-pad-y)] text-[clamp(12px,0.95vw,13.5px)] font-semibold leading-tight transition-colors',
    active
      ? 'bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  )
}

export default function Sidebar({ me, active }: SidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const profileRef = useRef<HTMLAnchorElement | null>(null)
  const [navScale, setNavScale] = useState(1)
  const pathname = usePathname()
  const normalizedActive =
    active === 'profile' || active === 'settings'
      ? 'account'
      : active === 'community' || active === 'chambers'
        ? 'communities'
        : active
  const displayName = formatDisplayName(me?.name ?? null) || 'Civil Citizen'
  const avatarInitials = displayName || me?.handle || 'C'
  const displayHandle = me?.handle ? `@${me.handle}` : '@civil'
  const profileHref = me?.handle ? `/u/${me.handle}` : '/profile/edit'
  const verified = Boolean(me?.isVerified)
  const business = Boolean(me?.isPremium)
  const scaled = (value: number, minFactor = 0.72) => {
    // scaled(px) = max(base * navScale, base * minFactor)
    const scaledValue = value * navScale
    const minValue = value * minFactor
    return `${Math.max(scaledValue, minValue)}px`
  }
  const spacingVars = {
    '--sidebar-pad': '10px',
    '--sidebar-gap': scaled(6, 0.7),
    '--sidebar-top-gap': '14px',
    '--profile-card-gap': '10px',
    '--nav-pad-x': scaled(11, 0.7),
    '--nav-pad-y': scaled(7, 0.7),
    '--nav-icon-pad': scaled(8, 0.7),
    '--nav-icon-size': scaled(20, 0.7),
    '--nav-radius': scaled(12, 0.7),
  } as CSSProperties
  const sidebarBleedStyle: CSSProperties = {
    marginLeft: 0,
  }
  const derivedActiveKey = useMemo(() => {
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
              'rounded-lg p-[var(--nav-icon-pad)] text-[var(--nav-icon-size)] transition-colors',
              activeMatch
                ? 'bg-white/25 text-white'
                : 'text-slate-400 group-hover:bg-[var(--cc-primary)]/10 group-hover:text-[var(--cc-primary)]',
            )}
          >
            <Icon />
          </span>
          <div className="flex-1">
            <span className="block leading-tight" style={{ fontSize: scaled(13, 0.78) }}>
              {item.label}
            </span>
          </div>
          {item.badge ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.badge}</span>
          ) : null}
        </Link>
      )
    })

  useEffect(() => {
    const measure = () => {
      const sidebar = sidebarRef.current
      const nav = navRef.current
      if (!sidebar || !nav) return
      const sidebarRect = sidebar.getBoundingClientRect()
      const navRect = nav.getBoundingClientRect()
      const styles = getComputedStyle(sidebar)
      const padBottom = parseFloat(styles.paddingBottom) || 0
      const available = sidebar.clientHeight - (navRect.top - sidebarRect.top) - padBottom
      const needed = nav.scrollHeight
      if (needed === 0 || available <= 0) return
      const rawScale = available / needed
      const nextScale = Math.min(1, Math.max(MIN_NAV_SCALE, rawScale))
      sidebar.dataset.navScaleEquation = `scale = clamp(${available.toFixed(0)} / ${needed.toFixed(0)}, ${MIN_NAV_SCALE.toFixed(2)}, 1)`
      sidebar.dataset.navScale = nextScale.toFixed(3)
      sidebar.dataset.navRawScale = rawScale.toFixed(3)
      if (Math.abs(nextScale - navScale) > 0.02) setNavScale(nextScale)
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [navScale])

  return (
    <aside
      className="hidden lg:fixed lg:left-0 lg:top-0 lg:flex lg:h-screen lg:max-h-screen lg:w-72 lg:flex-col lg:flex-shrink-0 lg:overflow-hidden lg:border-r lg:border-slate-200 lg:bg-white lg:px-[var(--sidebar-pad)] lg:pt-[clamp(60px,8vh,80px)] lg:pb-[calc(var(--sidebar-pad)*1.02)] lg:[--sidebar-offset:0px] xl:w-80 xl:[--sidebar-offset:0px]"
      style={{ ...spacingVars, ...sidebarBleedStyle }}
      ref={sidebarRef}
    >
      <Link
        href={profileHref}
        className="mt-[var(--profile-card-gap)] flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/80 px-[clamp(8px,0.8vw,10px)] py-[clamp(6px,0.8vh,8px)] transition hover:border-slate-200"
        ref={profileRef}
      >
        <VerifiedAvatar
          src={me?.avatarUrl ?? null}
          alt={displayName}
          initials={avatarInitials}
          size={36}
          isVerified={verified}
          isBusiness={business}
        />
        <div>
          <p className="text-sm font-semibold text-slate-900">{displayName}</p>
          <p className="text-xs text-slate-500">{displayHandle}</p>
        </div>
      </Link>

      <nav className="mt-[var(--sidebar-top-gap)] flex flex-1 flex-col gap-[var(--sidebar-gap)] pb-2" ref={navRef}>
        {navContent(PRIMARY_NAV)}
      </nav>
    </aside>
  )
}
