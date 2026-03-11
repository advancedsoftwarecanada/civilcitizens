"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { normalizeProvinceCode } from '@civil/shared'
import {
  HiOutlineArrowLeftCircle,
  HiOutlineBars3,
  HiOutlineBell,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineComputerDesktop,
  HiOutlineMagnifyingGlass,
  HiOutlineShoppingCart,
  HiOutlineUsers,
  HiOutlineXMark,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import clsx from 'clsx'
import CivilCard from './CivilCard'
import { PRIMARY_NAV, getSidebarNavItems } from './Sidebar'
import { getFamilyLockedCardIdentity } from '../_lib/familyIdentity'
import type { MeResponse } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { RightRail } from './RightRail'
import CommunityRightRailClient from './CommunityRightRailClient'
import { getStoredToken } from '../_lib/tokenStorage'
import { readMarketCart } from '../market/_lib/cart'
import { restoreParentAuthSession } from '../_lib/authSession'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import { SearchResults } from './search/SearchResults'
import MessagesNavBlock from './MessagesNavBlock'
import OrganizationRailCard from '../com/_components/OrganizationRailCard'
import { clearFamilyView } from '../_lib/familyView'

const DEFAULT_NAV_BUTTONS: Array<{
  key: 'home' | 'cart' | 'messages' | 'notifications' | 'ai' | 'more' | 'friends'
  label: string
  icon?: IconType
  imageSrc?: string
}> = [
  { key: 'home', label: 'Menu', icon: HiOutlineBars3 },
  { key: 'cart', label: 'Cart', icon: HiOutlineShoppingCart },
  { key: 'messages', label: 'Messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'notifications', label: 'Notifications', icon: HiOutlineBell },
  { key: 'ai', label: 'Civil AI', imageSrc: '/PWA-ICON.png?v=20260306' },
  { key: 'more', label: 'More', icon: HiOutlineBars3 },
] as const

const FAMILY_NAV_BUTTONS: Array<{
  key: 'home' | 'cart' | 'messages' | 'notifications' | 'ai' | 'more' | 'friends'
  label: string
  icon?: IconType
  imageSrc?: string
}> = [
  { key: 'home', label: 'Menu', icon: HiOutlineBars3 },
  { key: 'friends', label: 'Friends', icon: HiOutlineUsers },
  { key: 'messages', label: 'Messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'notifications', label: 'Notifications', icon: HiOutlineBell },
  { key: 'more', label: 'More', icon: HiOutlineBars3 },
] as const

const DRAWER_TRANSITION_MS = 320

type NavButtonKey = (typeof DEFAULT_NAV_BUTTONS)[number]['key']

type UserRelationshipRoute = {
  handle: string
  kind: 'friends' | 'connections' | 'communities' | 'organizations'
}

function toPathLabel(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function getOrgRouteFromPathname(pathname: string | null | undefined):
  | { basePath: string; activePath: string; province: string; municipality: string; organization: string }
  | null {
  if (!pathname) return null
  const parts = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean) ?? []
  if (parts.length < 5) return null
  if (parts[0] !== 'com') return null
  if (parts[3] !== 'orgs') return null
  const province = parts[1]
  const municipality = parts[2]
  const organization = parts[4]
  if (!province || !municipality || !organization) return null
  const basePath = `/com/${province}/${municipality}/orgs/${organization}`
  return { basePath, activePath: pathname, province, municipality, organization }
}

function getCommunityRouteFromPathname(pathname: string | null | undefined):
  | { province: string; municipality: string }
  | null {
  if (!pathname) return null
  const parts = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean) ?? []
  if (!parts.length) return null

  if (parts[0] === 'com') {
    if (parts.length < 3) return null
    const province = parts[1]
    const municipality = parts[2]
    if (!province || !municipality) return null
    return { province, municipality }
  }

  if (parts.length < 2) return null
  const province = parts[0]
  const municipality = parts[1]
  if (!province || !municipality) return null
  if (!normalizeProvinceCode(province)) return null
  return { province, municipality }
}

function getUserRelationshipRouteFromPathname(pathname: string | null | undefined): UserRelationshipRoute | null {
  if (!pathname) return null
  const parts = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean) ?? []
  if (parts.length !== 3 || parts[0] !== 'u') return null
  const handle = parts[1]
  const kind = parts[2]
  if (!handle) return null
  if (kind === 'friends' || kind === 'connections' || kind === 'communities' || kind === 'organizations') {
    return { handle, kind }
  }
  return null
}

export default function MobileDock() {
  const pathname = usePathname()
  const router = useRouter()
  const cachedViewer = useViewerStore((s) => s.me)
  const familyView = useViewerStore((s) => s.familyView)
  const sidebarNavItems = useMemo(() => getSidebarNavItems(familyView), [familyView])
  const navButtons = useMemo(() => (familyView ? FAMILY_NAV_BUTTONS : DEFAULT_NAV_BUTTONS), [familyView])
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMounted, setMoreMounted] = useState(false)
  const isOrganizationsDirectory = pathname === '/organizations/directory'
  const [viewer, setViewer] = useState<MeResponse | null>(null)
  const isFamilyLockedSession = Boolean(familyView) || (viewer ?? cachedViewer)?.accountType === 'family_member'
  const familyCardIdentity = getFamilyLockedCardIdentity(viewer ?? cachedViewer, familyView)
  const [hydrated, setHydrated] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [messageUnreadCount, setMessageUnreadCount] = useState(0)
  const [orgChannelUnreadCount, setOrgChannelUnreadCount] = useState(0)
  const [marketChatUnreadCount, setMarketChatUnreadCount] = useState(0)
  const [marketCartCount, setMarketCartCount] = useState(0)
  const unifiedMessageUnreadCount = Math.max(messageUnreadCount, orgChannelUnreadCount) + marketChatUnreadCount
  const [menuSearchQuery, setMenuSearchQuery] = useState('')
  const [menuSearchFocused, setMenuSearchFocused] = useState(false)
  const [civilAiOpen, setCivilAiOpen] = useState(false)
  const menuSearchBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moreCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuMountedRef = useRef(false)
  const moreMountedRef = useRef(false)

  useEffect(() => {
    setHydrated(true)
    if (typeof window === 'undefined') return
    const token = window.localStorage.getItem('token')
    if (!token) return
    setHasSession(true)

    if (cachedViewer) {
      setViewer(cachedViewer)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const data = await ensureViewerMe({ token })
        if (cancelled) return
        if (data) {
          setViewer(data)
          return
        }
        if (!window.localStorage.getItem('token')) {
          setHasSession(false)
        }
      } catch (err) {
        console.error('Unable to load viewer for mobile dock', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cachedViewer])

  useEffect(() => {
    if (!hasSession) return
    if (isFamilyLockedSession) {
      setUnreadCount(0)
      setMessageUnreadCount(0)
      setOrgChannelUnreadCount(0)
      setMarketChatUnreadCount(0)
      return
    }

    const fetchCounts = async () => {
      const token = getStoredToken()
      if (!token) return

      try {
        const [notifRes, msgRes, orgChannelsRes, marketChatsRes] = await Promise.all([
          fetch(buildApiUrl('/notifications?limit=1'), {
            headers: { authorization: `Bearer ${token}` },
          }),
          fetch(buildApiUrl('/messages/unread-count'), {
            headers: { authorization: `Bearer ${token}` },
          }),
          fetch(buildApiUrl('/org-channels/unread-count'), {
            headers: { authorization: `Bearer ${token}` },
          }),
          fetch(buildApiUrl('/market/chats/unread-count'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        ])

        if (notifRes.ok) {
          const data = (await notifRes.json()) as { unreadCount?: number }
          setUnreadCount(data.unreadCount || 0)
        }

        if (msgRes.ok) {
          const data = (await msgRes.json()) as { count: number }
          setMessageUnreadCount(data.count || 0)
        }

        if (orgChannelsRes.ok) {
          const data = (await orgChannelsRes.json()) as { count: number }
          setOrgChannelUnreadCount(data.count || 0)
        }

        if (marketChatsRes.ok) {
          const data = (await marketChatsRes.json()) as { count: number }
          setMarketChatUnreadCount(data.count || 0)
        }
      } catch (err) {
        console.error('Failed to load notification counts', err)
      }
    }

    void fetchCounts()
    const interval = setInterval(fetchCounts, 30000)

    const handleMessageRead = () => {
      void fetchCounts()
    }
    window.addEventListener('message.read', handleMessageRead)

    return () => {
      clearInterval(interval)
      window.removeEventListener('message.read', handleMessageRead)
    }
  }, [hasSession, isFamilyLockedSession])

  useEffect(() => {
    if (!hasSession || typeof window === 'undefined') return undefined

    const refreshCount = () => {
      const total = readMarketCart().reduce((sum, item) => sum + item.quantity, 0)
      setMarketCartCount(total)
    }

    refreshCount()

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== 'civil_market_cart') return
      refreshCount()
    }

    const handleLocalCartChanged = () => {
      refreshCount()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('civil:market-cart-changed', handleLocalCartChanged)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('civil:market-cart-changed', handleLocalCartChanged)
    }
  }, [hasSession])

  useEffect(() => {
    if (!menuMounted && !moreMounted) return undefined
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [menuMounted, moreMounted])

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false)
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    closeTimeoutRef.current = setTimeout(() => {
      setMenuMounted(false)
      closeTimeoutRef.current = null
    }, DRAWER_TRANSITION_MS)
  }, [])

  const handleOpenMenu = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setMenuMounted(true)
    requestAnimationFrame(() => setMenuOpen(true))
  }, [])

  const handleCloseMore = useCallback(() => {
    setMoreOpen(false)
    if (moreCloseTimeoutRef.current) {
      clearTimeout(moreCloseTimeoutRef.current)
    }
    moreCloseTimeoutRef.current = setTimeout(() => {
      setMoreMounted(false)
      moreCloseTimeoutRef.current = null
    }, DRAWER_TRANSITION_MS)
  }, [])

  const handleOpenMore = useCallback(() => {
    if (moreCloseTimeoutRef.current) {
      clearTimeout(moreCloseTimeoutRef.current)
      moreCloseTimeoutRef.current = null
    }
    setMoreMounted(true)
    requestAnimationFrame(() => setMoreOpen(true))
  }, [])

  useEffect(() => {
    menuMountedRef.current = menuMounted
  }, [menuMounted])

  useEffect(() => {
    moreMountedRef.current = moreMounted
  }, [moreMounted])

  useEffect(() => {
    if (!menuMountedRef.current) return
    handleCloseMenu()
  }, [pathname, handleCloseMenu])

  useEffect(() => {
    if (!moreMountedRef.current) return
    handleCloseMore()
  }, [pathname, handleCloseMore])

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
      if (moreCloseTimeoutRef.current) {
        clearTimeout(moreCloseTimeoutRef.current)
      }
      if (menuSearchBlurTimeoutRef.current) {
        clearTimeout(menuSearchBlurTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    const handleCivilAiState = (event: Event) => {
      const nextOpen = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open)
      setCivilAiOpen(nextOpen)
    }

    window.addEventListener('civil-ai:state', handleCivilAiState)
    return () => window.removeEventListener('civil-ai:state', handleCivilAiState)
  }, [])

  const handleMenuSearchFocus = useCallback(() => {
    if (menuSearchBlurTimeoutRef.current) {
      clearTimeout(menuSearchBlurTimeoutRef.current)
      menuSearchBlurTimeoutRef.current = null
    }
    setMenuSearchFocused(true)
  }, [])

  const handleMenuSearchBlur = useCallback(() => {
    if (menuSearchBlurTimeoutRef.current) clearTimeout(menuSearchBlurTimeoutRef.current)
    menuSearchBlurTimeoutRef.current = setTimeout(() => {
      setMenuSearchFocused(false)
    }, 120)
  }, [])

  const handleButtonPress = useCallback(
    (key: NavButtonKey) => {
      if (key === 'home') {
        handleOpenMenu()
        return
      }
      if (key === 'cart') {
        router.push('/market/cart')
        return
      }
      if (key === 'friends') {
        router.push('/friends')
        return
      }
      if (key === 'notifications') {
        router.push('/notifications')
        return
      }
      if (key === 'ai') {
        window.dispatchEvent(new CustomEvent('civil-ai:open'))
        return
      }
      if (key === 'messages') {
        router.push('/messages')
        return
      }
      if (key === 'more') {
        handleOpenMore()
        return
      }
    },
    [handleOpenMenu, handleOpenMore, router],
  )

  const navGroups = useMemo(() => [{ title: '', items: sidebarNavItems.length ? sidebarNavItems : PRIMARY_NAV }], [sidebarNavItems])

  const drawerSpacingVars = useMemo<CSSProperties>(
      () =>
        ({
          '--drawer-pad': 'clamp(12px, 1.4vh, 15px)',
          '--drawer-gap': 'clamp(6px, 0.7vh, 8px)',
          '--drawer-top-gap': 'clamp(6px, 0.9vh, 10px)',
          '--drawer-top-safe-pad': 'calc(var(--cc-native-safe-top-offset) + var(--cc-native-shell-top-gap) + clamp(10px, 1.2vh, 14px))',
          '--drawer-item-pad': 'clamp(10px, 1.8vh, 12px)',
          '--drawer-item-radius': 'clamp(15px, 1.9vw, 19px)',
          '--drawer-icon-pad': 'clamp(12px, 1.6vh, 14px)',
          '--drawer-icon-size': 'clamp(32px, 4vh, 46px)',
        } as CSSProperties),
      [],
    )

  const navGridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: `repeat(${navButtons.length}, minmax(0, 1fr))`,
  }), [navButtons.length])

  const orgRoute = useMemo(() => getOrgRouteFromPathname(pathname), [pathname])
  const communityRoute = useMemo(() => getCommunityRouteFromPathname(pathname), [pathname])
  const userRelationshipRoute = useMemo(() => getUserRelationshipRouteFromPathname(pathname), [pathname])

  const morePanelContent = useMemo(() => {
    if (pathname === '/home') {
      return <RightRail showOrganizations showRsvps sticky={false} />
    }
    const isFriendsDirectoryRoute =
      pathname?.startsWith('/friends') || Boolean(pathname?.match(/^\/u\/[^/]+\/friends(?:\/|$)/))

    if (isFriendsDirectoryRoute) {
      return <RightRail hideCommunities showPendingFriendRequests sticky={false} />
    }
    if (pathname?.startsWith('/network')) {
      return pathname === '/network'
        ? <RightRail mode="network" showRsvps sticky={false} />
        : <RightRail mode="network" sticky={false} />
    }
    if (pathname?.startsWith('/events')) {
      return <RightRail mode="events" showOrganizations sticky={false} />
    }
    if (pathname?.startsWith('/work')) {
      return <RightRail mode="work" organizationLinkTarget="chat" sticky={false} />
    }
    if (pathname?.startsWith('/market')) {
      return <RightRail mode="default" hideContacts hideCommunities sticky={false} />
    }
    if (pathname?.startsWith('/channels')) {
      return <RightRail mode="organizations" organizationLinkTarget="chat" sticky={false} />
    }
    if (pathname === '/organizations') {
      return <RightRail showOrganizations hideContacts hideCommunities sticky={false} />
    }
    if (pathname?.startsWith('/organizations')) {
      return isOrganizationsDirectory ? (
        <RightRail mode="organizationsDirectory" sticky={false} />
      ) : (
        <RightRail mode="organizations" sticky={false} />
      )
    }
    if (userRelationshipRoute) {
      if (userRelationshipRoute.kind === 'friends' || userRelationshipRoute.kind === 'connections') {
        return (
          <div className="space-y-4">
            <MessagesNavBlock active={userRelationshipRoute.kind === 'friends' ? 'friends' : 'network'} />
            <RightRail
              hideContacts
              hideCommunities={userRelationshipRoute.kind === 'friends'}
              sticky={false}
            />
          </div>
        )
      }
      return <RightRail hideContacts sticky={false} />
    }
    if (orgRoute) {
      return (
        <OrganizationRailCard
          pathname={pathname}
          basePath={orgRoute.basePath}
          province={orgRoute.province}
          municipality={orgRoute.municipality}
          organizationSlug={orgRoute.organization}
          organizationName={toPathLabel(orgRoute.organization)}
          onNavigate={handleCloseMore}
        />
      )
    }
    if (pathname?.startsWith('/communities')) {
      return <RightRail mode="communitiesFeed" sticky={false} />
    }
    if (communityRoute) {
      return <CommunityRightRailClient province={communityRoute.province} municipality={communityRoute.municipality} />
    }
    return <RightRail sticky={false} />
  }, [pathname, handleCloseMore, isOrganizationsDirectory, orgRoute, communityRoute, userRelationshipRoute])

  if (!hydrated || !hasSession) {
    return null
  }

  return (
    <>
      <nav
        data-mobile-dock="true"
        className="fixed inset-x-0 bottom-0 z-40 min-h-[var(--mobile-dock-height)] border-t border-slate-200 bg-white/95 px-3 pb-[var(--mobile-dock-bottom-pad)] pt-[var(--mobile-bottom-bar-top-pad)] text-[var(--cc-primary)] shadow-[0_-10px_24px_rgba(0,0,0,0.08)] transition-[transform,opacity] duration-200 lg:hidden"
        style={{ bottom: 'var(--mobile-dock-bottom-offset)' }}
        role="navigation"
        aria-label="Mobile navigation"
      >
        <div className="grid gap-0.5" style={navGridStyle}>
          {navButtons.map((item) => {
            const Icon = item.icon
            const isActive =
              (item.key === 'home' && menuOpen) ||
              (item.key === 'friends' && pathname?.startsWith('/friends')) ||
              (item.key === 'cart' && (pathname?.startsWith('/market/cart') || pathname?.startsWith('/market/checkout'))) ||
              (item.key === 'notifications' && pathname?.startsWith('/notifications')) ||
              (item.key === 'messages' && (pathname?.startsWith('/messages') || pathname?.startsWith('/channels'))) ||
              (item.key === 'ai' && civilAiOpen) ||
              (item.key === 'more' && moreOpen)

            const count =
              item.key === 'cart'
                ? marketCartCount
                : item.key === 'notifications'
                ? unreadCount
                : item.key === 'messages'
                  ? unifiedMessageUnreadCount
                    : 0

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleButtonPress(item.key)}
                className={clsx(
                  'flex h-11 w-full items-center justify-center rounded-2xl px-3 transition-colors',
                  isActive
                    ? 'bg-[var(--cc-primary)] text-white shadow shadow-[var(--cc-primary)]/30'
                    : 'text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10',
                )}
                aria-label={item.label}
              >
                <div className="relative">
                  {item.imageSrc ? (
                    <img src={item.imageSrc} alt="" className="h-6 w-6 rounded-lg" />
                  ) : Icon ? (
                    <Icon className="text-xl leading-none" />
                  ) : null}
                  {count > 0 ? (
                    <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </nav>

      {menuMounted ? (
        <div className="fixed inset-0 z-50 lg:hidden" aria-modal="true" role="dialog">
          <button
            type="button"
            aria-label="Close menu"
            className={clsx(
              'absolute inset-0 bg-slate-900/60 backdrop-blur transition-opacity duration-300',
              menuOpen ? 'opacity-100' : 'opacity-0',
            )}
            onClick={handleCloseMenu}
          />
          <div
            className={clsx(
              'absolute inset-y-0 left-0 flex h-full w-[min(24rem,90vw)] max-w-full flex-col bg-white px-[var(--drawer-pad)] pb-[calc(env(safe-area-inset-bottom)+var(--drawer-pad))] pt-[var(--drawer-top-safe-pad)] shadow-2xl transition-transform duration-300',
              menuOpen ? 'translate-x-0' : '-translate-x-full',
            )}
            style={drawerSpacingVars}
          >
            <div className="relative">
              <div onClick={viewer?.handle ? handleCloseMenu : undefined}>
                <CivilCard
                  href={familyCardIdentity?.href ?? (viewer?.handle ? `/u/${viewer.handle}` : undefined)}
                  size="rail"
                  name={familyCardIdentity?.name ?? viewer?.name ?? 'Civil Citizen'}
                  subtitle={familyCardIdentity?.subtitle ?? 'View profile'}
                  avatarAlt={familyCardIdentity?.avatarAlt ?? viewer?.name ?? viewer?.handle ?? 'Civil citizen'}
                  avatarInitials={familyCardIdentity?.avatarInitials ?? viewer?.name ?? viewer?.handle ?? 'C'}
                  avatarSrc={familyCardIdentity?.avatarSrc ?? viewer?.avatarUrl ?? null}
                  coverUrl={familyCardIdentity?.coverUrl ?? viewer?.coverUrl ?? null}
                  isVerified={familyCardIdentity?.isVerified ?? Boolean(viewer?.isVerified)}
                  isBusiness={familyCardIdentity?.isBusiness ?? Boolean(viewer?.isPremium)}
                  className="w-[calc(100%-48px)] rounded-[var(--drawer-item-radius)]"
                />
              </div>
              <button
                type="button"
                className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-2 text-slate-500"
                onClick={handleCloseMenu}
                aria-label="Close menu"
              >
                <HiOutlineXMark className="text-lg" />
              </button>
            </div>
            {familyView ? (
              <div className="mt-3 rounded-[var(--drawer-item-radius)] border border-[var(--cc-primary)]/15 bg-[var(--cc-primary)]/5 p-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-2xl bg-white p-2 text-[var(--cc-primary)] shadow-sm">
                    <HiOutlineComputerDesktop className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-primary)]">Locked Device</p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-950">{familyView.displayName}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{familyView.relationshipLabel} • Age {familyView.age} • {familyView.modeLabel}</p>
                    <Link
                      href="/settings/family/settings"
                      onClick={handleCloseMenu}
                      className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      <HiOutlineArrowLeftCircle className="h-4 w-4" />
                      Locked device settings
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="mt-[var(--drawer-top-gap)] flex-1 overflow-y-auto pb-[calc(var(--drawer-pad)*0.85)]">
              <div className="relative mb-3">
                <div className="relative w-full rounded-full border border-slate-200 bg-white/90 shadow-sm transition focus-within:border-[var(--cc-primary)] focus-within:bg-white">
                  <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <form action="/search" method="GET" autoComplete="off">
                    <input
                      type="search"
                      name="q"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="Search"
                      className="w-full bg-transparent py-2.5 pl-11 pr-4 text-sm text-slate-800 focus:outline-none placeholder:text-slate-500"
                      value={menuSearchQuery}
                      onChange={(event) => setMenuSearchQuery(event.target.value)}
                      onFocus={handleMenuSearchFocus}
                      onBlur={handleMenuSearchBlur}
                    />
                  </form>
                  <SearchResults query={menuSearchQuery} open={menuSearchFocused && menuSearchQuery.trim().length >= 2} />
                </div>
              </div>
              {navGroups.map((group, index) => (
                <div key={index} className={index === 0 ? undefined : 'mt-[calc(var(--drawer-top-gap)*0.9)]'}>
                  <div className="grid grid-cols-3 gap-[var(--drawer-gap)]">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const active = pathname ? pathname.startsWith(item.href) : false
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={handleCloseMenu}
                          className={clsx(
                            'flex h-full flex-col items-center justify-center gap-1.5 rounded-[var(--drawer-item-radius)] border px-3 py-[var(--drawer-item-pad)] text-[clamp(10.5px,2.3vw,12px)] font-semibold leading-tight text-center transition',
                            active
                              ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/8 text-[var(--cc-primary)]'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
                          )}
                        >
                          <span className="rounded-2xl bg-slate-100 p-[var(--drawer-icon-pad)] text-[var(--drawer-icon-size)] text-slate-600 shadow-sm">
                            <Icon className="h-[var(--drawer-icon-size)] w-[var(--drawer-icon-size)]" />
                          </span>
                          <span className="leading-tight">{item.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {moreMounted ? (
        <div className="fixed inset-0 z-50 lg:hidden" aria-modal="true" role="dialog">
          <button
            type="button"
            aria-label="Close more panel"
            className={clsx(
              'absolute inset-0 bg-slate-900/60 backdrop-blur transition-opacity duration-300',
              moreOpen ? 'opacity-100' : 'opacity-0',
            )}
            onClick={handleCloseMore}
          />
          <div
            className={clsx(
              'absolute inset-y-0 right-0 flex h-full w-[min(24rem,90vw)] max-w-full flex-col bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[var(--drawer-top-safe-pad)] shadow-2xl transition-transform duration-300',
              moreOpen ? 'translate-x-0' : 'translate-x-full',
            )}
            style={drawerSpacingVars}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">More</p>
                <p className="text-sm font-semibold text-slate-900">Communities & shortcuts</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 p-2 text-slate-500"
                onClick={handleCloseMore}
                aria-label="Close more panel"
              >
                <HiOutlineXMark className="text-lg" />
              </button>
            </div>
            <div className="mt-[calc(var(--drawer-top-gap)*1.6)] flex-1 overflow-y-auto pb-12">
              {morePanelContent}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
