'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, type CSSProperties } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import {
  HiOutlineHome,
  HiOutlineBuildingOffice2,
  HiOutlineUserCircle,
  HiOutlineShieldCheck,
  HiOutlineChatBubbleLeftRight,
  HiOutlineBuildingLibrary,
  HiOutlineCalendarDays,
  HiOutlineShoppingBag,
  HiOutlineWallet,
  HiOutlineBriefcase,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import { isEmailSuperAdmin } from '../_lib/admin'
import VerifiedAvatar from './VerifiedAvatar'

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
  { key: 'chat', label: 'Chat', href: '/chat', icon: HiOutlineChatBubbleLeftRight },
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
  {
    key: 'community',
    label: 'Community',
    href: '/communities',
    icon: HiOutlineBuildingOffice2,
  },
  { key: 'account', label: 'Account Settings', href: '/profile', icon: HiOutlineUserCircle },
]

export const ADMIN_NAV: SidebarNavItem[] = [
  { key: 'admin', label: 'Admin', href: '/admin', icon: HiOutlineShieldCheck },
]

function navItemClasses(active: boolean) {
  return clsx(
    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
    active
      ? 'bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  )
}

export default function Sidebar({ me, active }: SidebarProps) {
  const pathname = usePathname()
  const normalizedActive =
    active === 'profile' || active === 'settings'
      ? 'account'
      : active === 'chambers' || active === 'communities'
        ? 'community'
        : active
  const displayName = me?.name?.trim() || 'Civil Citizen'
  const displayHandle = me?.handle ? `@${me.handle}` : '@civil'
  const profileHref = me?.handle ? `/u/${me.handle}` : '/profile'
  const verified = Boolean(me?.isVerified)
  const business = Boolean(me?.isPremium)
  const isSuperAdmin = isEmailSuperAdmin(me?.email)
  const sidebarBleedStyle: CSSProperties = {
    marginLeft: 'calc((100vw - min(100vw, 96rem)) / -2 + var(--sidebar-offset, 0px))',
  }
  const derivedActiveKey = useMemo(() => {
    if (normalizedActive) return normalizedActive
    const allNav = [...PRIMARY_NAV, ...ADMIN_NAV]
    return allNav.find((item) => (pathname ? pathname.startsWith(item.href) : false))?.key ?? null
  }, [normalizedActive, pathname])

  const navContent = (items: SidebarNavItem[]) =>
    items.map((item) => {
      const Icon = item.icon
      const activeMatch = derivedActiveKey === item.key
      return (
        <Link key={item.key} href={item.href} className={navItemClasses(activeMatch)} aria-current={activeMatch ? 'page' : undefined}>
          <span
            className={clsx(
              'rounded-lg p-2 text-base transition-colors',
              activeMatch
                ? 'bg-white/25 text-white'
                : 'text-slate-400 group-hover:bg-[var(--cc-primary)]/10 group-hover:text-[var(--cc-primary)]',
            )}
          >
            <Icon />
          </span>
          <div className="flex-1">
            <span className="block">{item.label}</span>
          </div>
          {item.badge ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.badge}</span>
          ) : null}
        </Link>
      )
    })

  return (
    <aside
      className="hidden lg:flex lg:h-screen lg:w-72 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white lg:px-6 lg:pt-4 lg:pb-8 lg:sticky lg:top-0 lg:[--sidebar-offset:-2rem] xl:w-80 xl:[--sidebar-offset:-3rem]"
      style={sidebarBleedStyle}
    >
      <div className="flex items-center">
        <Link href="/home" className="inline-flex items-center rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
          <Image src="/logo.svg" alt="Civil Citizens" width={120} height={32} className="h-8 w-auto" priority />
        </Link>
        <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Beta</span>
      </div>

      <Link
        href={profileHref}
        className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 transition hover:border-slate-200"
      >
        <VerifiedAvatar
          src={me?.avatarUrl ?? null}
          alt={displayName}
          initials={me?.name ?? me?.handle ?? 'C'}
          size={48}
          isVerified={verified}
          isBusiness={business}
        />
        <div>
          <p className="text-sm font-semibold text-slate-900">{displayName}</p>
          <p className="text-xs text-slate-500">{displayHandle}</p>
        </div>
      </Link>

      <nav className="mt-4 flex flex-1 flex-col gap-1">{navContent(PRIMARY_NAV)}</nav>

      <div className="mt-auto w-full">
        {isSuperAdmin ? (
          <div className="border-t border-slate-200 pt-6">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</p>
            <nav className="mt-2 flex flex-col gap-1">{navContent(ADMIN_NAV)}</nav>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
