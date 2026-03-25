'use client'

import Link from 'next/link'
import { useMemo, type CSSProperties } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { FaCarSide, FaHouseUser, FaUserTie, FaWallet } from 'react-icons/fa'
import {
  HiOutlineChatBubbleOvalLeft,
  HiOutlineCurrencyDollar,
  HiOutlineHome,
  HiOutlineCalendarDays,
  HiOutlineShoppingCart,
  HiOutlineTag,
  HiOutlineUserCircle,
  HiOutlineUsers,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import { RiCommunityLine } from 'react-icons/ri'
import { VscOrganization } from 'react-icons/vsc'
import CivilCard from './CivilCard'
import { getFamilyLockedCardIdentity } from '../_lib/familyIdentity'
import { formatDisplayName } from '../_lib/text'
import { useViewerStore } from '../_lib/viewerStore'
import { type FamilyModeSummary, type MeResponse } from '../_lib/me'
import type { FamilyViewState } from '../_lib/familyView'

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
  { key: 'home', label: 'Civil Pulse', href: '/home', icon: HiOutlineHome },
  { key: 'messages', label: 'Messages', href: '/messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'friends', label: 'Friends', href: '/friends', icon: HiOutlineUsers },
  { key: 'network', label: 'Network', href: '/network', icon: FaUserTie },
  { key: 'communities', label: 'Communities', href: '/communities', icon: RiCommunityLine },
  { key: 'organizations', label: 'Organizations', href: '/organizations', icon: VscOrganization },
  { key: 'topics', label: 'Topics', href: '/topics', icon: HiOutlineTag },
  { key: 'events', label: 'Events', href: '/events', icon: HiOutlineCalendarDays },
  { key: 'market', label: 'Market', href: '/market', icon: HiOutlineShoppingCart },
  { key: 'work', label: 'Work', href: '/work', icon: HiOutlineCurrencyDollar },
  { key: 'drive', label: 'Drive', href: '/drive', icon: FaCarSide },
  { key: 'wallet', label: 'Wallet', href: '/wallet', icon: FaWallet },
  // TODO(app-store): restore News, Podcasts, Music, and Video nav items once those product areas are ready.
  { key: 'account', label: 'Account Settings', href: '/settings', icon: HiOutlineUserCircle },
]

const FAMILY_CHILD_NAV: SidebarNavItem[] = [
  { key: 'home', label: 'Family & Friends', href: '/home', icon: HiOutlineHome },
  { key: 'messages', label: 'Messages', href: '/messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'friends', label: 'My Friends', href: '/friends', icon: HiOutlineUsers },
  { key: 'account', label: 'Settings', href: '/settings/guardian/settings', icon: HiOutlineUserCircle },
]

export function getSidebarNavItems(
  familyView: FamilyViewState | null | undefined,
  me?: Pick<MeResponse, 'accountType' | 'familyMode'> | null,
): SidebarNavItem[] {
  if (!familyView) {
    if (me?.accountType === 'user') {
      const [homeItem, messagesItem, friendsItem] = PRIMARY_NAV
      if (!homeItem || !messagesItem || !friendsItem) return PRIMARY_NAV

      return [
        homeItem,
        messagesItem,
        { key: 'family', label: 'Family', href: '/family', icon: FaHouseUser },
        friendsItem,
        ...PRIMARY_NAV.slice(3),
      ]
    }
    return PRIMARY_NAV
  }
  return FAMILY_CHILD_NAV
}

function navItemClasses(active: boolean) {
  return clsx(
    'group flex h-[var(--nav-item-h)] min-h-[36px] items-center gap-2.5 rounded-[var(--nav-radius)] px-[var(--nav-pad-x)] py-[var(--nav-pad-y)] text-[12.5px] font-semibold leading-tight transition-all',
    active
      ? 'bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20'
      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
  )
}

function SidebarProfileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-[var(--profile-card-gap)] h-[82px] overflow-hidden rounded-[1.7rem] border border-slate-200 bg-slate-800 shadow-sm animate-pulse"
    >
      <div className="absolute inset-y-0 left-0 w-1/4 bg-slate-200" />
      <div className="absolute inset-y-0 right-0 left-1/4 bg-[linear-gradient(120deg,#0f172a_0%,#020617_58%,#0b1228_100%)]" />
      <div className="absolute inset-y-0 right-0 left-1/4 bg-[linear-gradient(90deg,rgba(2,6,23,0.88)_0%,rgba(2,6,23,0.72)_18%,rgba(2,6,23,0.52)_42%,rgba(2,6,23,0.28)_100%)]" />
      <div className="absolute inset-y-0 left-1/4 right-0 flex items-center justify-center px-5">
        <div className="h-[42px] w-[68%] max-w-[190px] rounded-[1.2rem] border border-white/12 bg-slate-900/20 shadow-[0_16px_36px_rgba(15,23,42,0.16)]" />
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
  const displayName = (familyCardIdentity?.name ?? formatDisplayName(effectiveMe?.name ?? null)) || 'Civil Citizen'
  const avatarInitials = (familyCardIdentity?.avatarInitials ?? displayName) || effectiveMe?.handle || 'C'
  const profileHref = familyCardIdentity?.href ?? (effectiveMe?.handle ? `/u/${effectiveMe.handle}` : '/profile/edit')
  const verified = familyCardIdentity?.isVerified ?? Boolean(effectiveMe?.isVerified)
  const business = familyCardIdentity?.isBusiness ?? Boolean(effectiveMe?.isPremium)
  const navItems = getSidebarNavItems(familyView, effectiveMe)
  const isOnOwnProfile = Boolean(
    profileHref && pathname && (pathname === profileHref || pathname.startsWith(`${profileHref}/`)),
  )
  const navCount = navItems.length
  const sidebarTopOffsetExpr = 'var(--cc-top-nav-offset)'
  const sidebarBottomPadPx = 10
  const profileHeightPx = 82
  const profileGapPx = 8
  const navTopGapPx = 8
  const navGapPx = 6
  const totalNavGapPx = (navCount - 1) * navGapPx
  const navAvailableHeightExpr = `var(--cc-viewport-height) - ${sidebarTopOffsetExpr} - ${sidebarBottomPadPx}px - ${profileHeightPx}px - ${profileGapPx}px - ${navTopGapPx}px - ${totalNavGapPx}px`
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
    if (normalizedActive) return normalizedActive
    return navItems.find((item) => (pathname ? pathname.startsWith(item.href) : false))?.key ?? null
  }, [navItems, normalizedActive, pathname])
  const showProfileCardSkeleton = !familyView && !effectiveMe && (!hydrated || hasStoredSession)

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
      className={clsx(
        'hidden xl:fixed xl:left-0 xl:top-0 xl:flex xl:h-screen xl:max-h-screen xl:w-72 xl:flex-col xl:flex-shrink-0 xl:overflow-hidden xl:border-r xl:border-slate-200 xl:bg-white xl:px-[var(--sidebar-pad)] xl:pb-[10px] xl:[--sidebar-offset:0px] 2xl:w-80 2xl:[--sidebar-offset:0px]',
        familyView ? 'xl:pt-0' : 'xl:pt-[var(--cc-top-nav-offset)]',
      )}
      style={{ ...spacingVars, ...sidebarBleedStyle }}
    >
      {showProfileCardSkeleton ? (
        <SidebarProfileCardSkeleton />
      ) : (
        <CivilCard
          href={profileHref}
          size="md"
          name={displayName}
          subtitle={familyView || isOnOwnProfile ? undefined : familyCardIdentity?.subtitle}
          avatarAlt={familyCardIdentity?.avatarAlt ?? displayName}
          avatarInitials={avatarInitials}
          avatarSrc={familyCardIdentity?.avatarSrc ?? effectiveMe?.avatarUrl ?? null}
          coverUrl={familyCardIdentity?.coverUrl ?? effectiveMe?.coverUrl ?? null}
          isVerified={verified}
          isBusiness={business}
          className="mt-[var(--profile-card-gap)]"
        />
      )}

      <nav className="mt-[var(--sidebar-top-gap)] flex flex-1 flex-col gap-[var(--sidebar-gap)]">
        {navContent(navItems)}
      </nav>
    </aside>
  )
}
