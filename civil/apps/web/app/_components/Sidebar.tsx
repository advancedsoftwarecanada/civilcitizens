'use client'

import Link from 'next/link'
import { useMemo, type CSSProperties } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { FaCarSide, FaWallet } from 'react-icons/fa'
import {
  HiOutlineHome,
  HiOutlineMap,
  HiOutlineUserCircle,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import { getFamilyLockedCardIdentity } from '../_lib/familyIdentity'
import { formatDisplayName } from '../_lib/text'
import { useViewerStore } from '../_lib/viewerStore'
import { type FamilyModeSummary, type MeResponse } from '../_lib/me'
import type { FamilyViewState } from '../_lib/familyView'
import VerifiedAvatar from './VerifiedAvatar'

type SidebarViewer = {
  name?: string | null
  handle?: string
  avatarUrl?: string | null
  coverUrl?: string | null
  email?: string | null
  isPremium?: boolean
  isVerified?: boolean
  accountType?: MeResponse['accountType']
  familyMode?: FamilyModeSummary | null
}

type SidebarProps = {
  me?: SidebarViewer
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
  { key: 'ride', label: 'Ride', href: '/ride', icon: HiOutlineMap },
  { key: 'drive', label: 'Drive', href: '/drive', icon: FaCarSide },
  { key: 'wallet', label: 'Wallet', href: '/wallet', icon: FaWallet },
  { key: 'account', label: 'Account', href: '/settings', icon: HiOutlineUserCircle },
]

const FAMILY_CHILD_NAV: SidebarNavItem[] = [
  { key: 'home', label: 'Family & Friends', href: '/home', icon: HiOutlineHome },
  { key: 'account', label: 'Account', href: '/settings/guardian/settings', icon: HiOutlineUserCircle },
]

export function getSidebarNavItems(
  familyView: FamilyViewState | null | undefined,
  _me?: Pick<MeResponse, 'accountType' | 'familyMode'> | null,
): SidebarNavItem[] {
  void _me
  if (!familyView) {
    return PRIMARY_NAV
  }
  return FAMILY_CHILD_NAV
}

function navItemClasses(active: boolean) {
  return clsx(
    'group relative flex min-h-[72px] items-center gap-3 overflow-hidden rounded-[1.35rem] px-3.5 py-3 text-[13px] font-semibold leading-tight transition-all',
    active
      ? 'bg-[linear-gradient(135deg,#dc2626_0%,#ef4444_58%,#fb7185_100%)] text-white shadow-[0_20px_45px_rgba(220,38,38,0.28)]'
      : 'border border-slate-200/90 bg-white text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-red-200 hover:bg-[linear-gradient(135deg,rgba(255,255,255,1)_0%,rgba(254,242,242,1)_100%)] hover:text-slate-950 hover:shadow-[0_14px_30px_rgba(220,38,38,0.10)]',
  )
}

function matchesSidebarPath(item: SidebarNavItem, pathname: string | null) {
  if (!pathname) return false
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true
  if (item.key === 'ride') {
    return pathname === '/delivery/my' || pathname.startsWith('/delivery/my/') || pathname.startsWith('/drive/ride/request')
  }
  if (item.key === 'drive') {
    return pathname.startsWith('/drive/') || pathname.startsWith('/delivery/')
  }
  return false
}

function SidebarProfileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-[var(--profile-card-gap)] overflow-hidden rounded-[1.7rem] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#111827_65%,#1f2937_100%)] p-4 shadow-sm animate-pulse"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.22),transparent_42%)]" />
      <div className="relative flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 rounded-full bg-slate-300/90" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-20 rounded-full bg-white/18" />
          <div className="h-5 w-[70%] rounded-full bg-white/16" />
          <div className="h-3 w-[48%] rounded-full bg-white/12" />
        </div>
      </div>
    </div>
  )
}

export default function Sidebar({ me, active }: SidebarProps) {
  const cachedMe = useViewerStore((s) => s.me)
  const hydrated = useViewerStore((s) => s.hydrated)
  const familyView = useViewerStore((s) => s.familyView)
  const hasStoredSession = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : false
  const effectiveMe = me ?? cachedMe ?? undefined
  const familyCardIdentity = getFamilyLockedCardIdentity(effectiveMe, familyView)
  const pathname = usePathname()
  const normalizedActive = active === 'profile' || active === 'settings' ? 'account' : active
  const displayName = (familyCardIdentity?.name ?? formatDisplayName(effectiveMe?.name ?? null)) || 'MapleRides Member'
  const avatarInitials = (familyCardIdentity?.avatarInitials ?? displayName) || effectiveMe?.handle || 'M'
  const profileHref = '/settings'
  const navItems = getSidebarNavItems(familyView)
  const primaryNavItems = navItems.filter((item) => item.key !== 'account')
  const accountNavItem = navItems.find((item) => item.key === 'account') ?? null
  const isOnOwnProfile = Boolean(
    profileHref && pathname && (pathname === profileHref || pathname.startsWith(`${profileHref}/`)),
  )
  const sidebarTopOffsetExpr = 'var(--cc-top-nav-offset)'
  const sidebarBottomPadPx = 10
  const spacingVars = {
    '--sidebar-pad': '10px',
    '--sidebar-gap': '10px',
    '--sidebar-top-gap': '10px',
    '--profile-card-gap': '8px',
  } as CSSProperties
  const sidebarBleedStyle: CSSProperties = {
    marginLeft: 0,
  }
  const derivedActiveKey = useMemo(() => {
    if (normalizedActive) return normalizedActive
    return navItems.find((item) => matchesSidebarPath(item, pathname))?.key ?? null
  }, [navItems, normalizedActive, pathname])
  const showProfileCardSkeleton = !familyView && !effectiveMe && (!hydrated || hasStoredSession)
  const navContent = (items: SidebarNavItem[]) =>
    items.map((item) => {
      const Icon = item.icon
      const activeMatch = derivedActiveKey === item.key
      return (
        <Link key={item.key} href={item.href} className={navItemClasses(activeMatch)} aria-current={activeMatch ? 'page' : undefined}>
          {activeMatch ? (
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.26),transparent_38%)]" aria-hidden="true" />
          ) : null}
          <span
            className={clsx(
              'relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] border text-[20px] shadow-sm transition-all',
              activeMatch
                ? 'border-white/20 bg-white/14 text-white'
                : 'border-slate-200 bg-slate-50 text-slate-500 group-hover:border-red-200 group-hover:bg-red-50 group-hover:text-red-600',
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="relative min-w-0 flex-1">
            <span className="block leading-tight">{item.label}</span>
          </div>
          {item.badge ? (
            <span className={clsx('relative rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', activeMatch ? 'bg-white/18 text-white' : 'bg-slate-100 text-slate-500')}>
              {item.badge}
            </span>
          ) : null}
        </Link>
      )
    })

  return (
    <aside
      className={clsx(
        'hidden xl:fixed xl:left-0 xl:top-0 xl:flex xl:h-screen xl:max-h-screen xl:w-72 xl:flex-col xl:flex-shrink-0 xl:overflow-hidden xl:border-r xl:border-slate-200 xl:bg-white xl:px-[var(--sidebar-pad)] xl:pb-[10px] xl:[--sidebar-offset:0px] 2xl:w-80 2xl:[--sidebar-offset:0px]',
        familyView ? 'xl:pt-0' : 'xl:pt-[var(--cc-top-nav-offset)]',
      )}
      style={{ ...spacingVars, ...sidebarBleedStyle }}
    >
      {showProfileCardSkeleton ? (
        <SidebarProfileCardSkeleton />
      ) : (
        <Link
          href={profileHref}
          className="group relative mt-[var(--profile-card-gap)] overflow-hidden rounded-[1.7rem] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#111827_64%,#1f2937_100%)] p-4 text-white shadow-[0_18px_45px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_55px_rgba(15,23,42,0.22)]"
          aria-current={isOnOwnProfile ? 'page' : undefined}
        >
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.24),transparent_44%)] opacity-90" aria-hidden="true" />
          <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_42%,rgba(255,255,255,0.03)_72%,transparent_100%)]" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <div className="relative shrink-0">
              <span className="absolute inset-0 rounded-full bg-red-500/20 blur-md" aria-hidden="true" />
              <VerifiedAvatar
                src={familyCardIdentity?.avatarSrc ?? effectiveMe?.avatarUrl ?? null}
                alt={familyCardIdentity?.avatarAlt ?? displayName}
                initials={avatarInitials}
                size={56}
                className="relative shadow-[0_12px_28px_rgba(15,23,42,0.28)]"
                roundedClassName="rounded-full"
                hideBadge
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-red-100/80">MapleRides Account</p>
              <p className="mt-1 truncate text-lg font-semibold leading-tight text-white">{displayName}</p>
            </div>
          </div>
        </Link>
      )}

      <nav className="mt-[var(--sidebar-top-gap)] flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <div className="rounded-[1.7rem] border border-slate-200 bg-[linear-gradient(180deg,#fff_0%,#f8fafc_100%)] p-2 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
          <div className="space-y-[var(--sidebar-gap)]">
            {navContent(primaryNavItems)}
          </div>
        </div>

        {accountNavItem ? (
          <div className="mt-auto pt-4">
            <div className="rounded-[1.7rem] border border-slate-200 bg-[linear-gradient(180deg,#fff_0%,#fef2f2_100%)] p-2 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
              {navContent([accountNavItem])}
            </div>
          </div>
        ) : null}
      </nav>
    </aside>
  )
}
