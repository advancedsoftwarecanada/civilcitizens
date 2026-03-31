"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { normalizeProvinceCode } from '@civil/shared'
import {
  HiOutlineArrowLeftCircle,
  HiOutlineBell,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineComputerDesktop,
  HiOutlineMagnifyingGlass,
  HiOutlineShoppingCart,
  HiOutlineUsers,
  HiOutlineXMark,
} from 'react-icons/hi2'
import { AiOutlineHome } from 'react-icons/ai'
import { MdOutlineReadMore } from 'react-icons/md'
import type { IconType } from 'react-icons'
import clsx from 'clsx'
import CivilCard from './CivilCard'
import { PRIMARY_NAV, getSidebarNavItems } from './Sidebar'
import { getFamilyLockedCardIdentity } from '../_lib/familyIdentity'
import type { MeResponse } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { RightRail } from './RightRail'
import CommunityRightRailClient from './CommunityRightRailClient'
import { useRightRailRegistry } from './RightRailRegistry'
import { getStoredToken } from '../_lib/tokenStorage'
import { readMarketCart } from '../market/_lib/cart'
import { restoreParentAuthSession } from '../_lib/authSession'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import { SearchResults, type SearchResultsLoadingState } from './search/SearchResults'
import MessagesNavBlock from './MessagesNavBlock'
import { hasFamilyProfilesAvailable } from '../_lib/me'
import OrganizationRailCard from '../com/_components/OrganizationRailCard'
import { clearFamilyView } from '../_lib/familyView'
import { useMobileKeyboardState } from '../_lib/mobileKeyboard'
import { PUSH_UI_RESET_EVENT } from '../_lib/pushNavigation'

const DEFAULT_NAV_BUTTONS: Array<{
  key: 'home' | 'cart' | 'messages' | 'notifications' | 'ai' | 'more' | 'friends'
  label: string
  icon?: IconType
  imageSrc?: string
  text?: string
}> = [
  { key: 'home', label: 'Menu', icon: AiOutlineHome },
  { key: 'cart', label: 'Cart', icon: HiOutlineShoppingCart },
  { key: 'messages', label: 'Messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'notifications', label: 'Notifications', icon: HiOutlineBell },
  { key: 'ai', label: 'Civil AI', text: 'AI' },
  { key: 'more', label: 'More', icon: MdOutlineReadMore },
] as const

const FAMILY_NAV_BUTTONS: Array<{
  key: 'home' | 'cart' | 'messages' | 'notifications' | 'ai' | 'more' | 'friends'
  label: string
  icon?: IconType
  imageSrc?: string
  text?: string
}> = [
  { key: 'home', label: 'Menu', icon: AiOutlineHome },
  { key: 'friends', label: 'Friends', icon: HiOutlineUsers },
  { key: 'messages', label: 'Messages', icon: HiOutlineChatBubbleOvalLeft },
  { key: 'notifications', label: 'Notifications', icon: HiOutlineBell },
  { key: 'more', label: 'More', icon: MdOutlineReadMore },
] as const

const DRAWER_TRANSITION_MS = 320
const MOBILE_MORE_DRAWER_CLOSE_EVENT = 'civil:mobile-more-close'
const MOBILE_DRAWER_STATE_EVENT = 'civil:mobile-drawer-state'

type NavButtonKey = (typeof DEFAULT_NAV_BUTTONS)[number]['key']

type UserRelationshipRoute = {
  handle: string
  kind: 'friends' | 'contacts' | 'connections' | 'communities' | 'organizations'
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
  if (kind === 'friends' || kind === 'contacts' || kind === 'connections' || kind === 'communities' || kind === 'organizations') {
    return { handle, kind }
  }
  return null
}

function MobileDrawerProfileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative h-[58px] w-[calc(100%-48px)] overflow-hidden rounded-[var(--drawer-item-radius)] border border-slate-200 bg-slate-800 shadow-sm animate-pulse"
    >
      <div className="absolute inset-y-0 left-0 w-1/4 bg-slate-200" />
      <div className="absolute inset-y-0 right-0 left-1/4 bg-[linear-gradient(120deg,#0f172a_0%,#020617_58%,#0b1228_100%)]" />
      <div className="absolute inset-y-0 right-0 left-1/4 bg-[linear-gradient(90deg,rgba(2,6,23,0.88)_0%,rgba(2,6,23,0.72)_18%,rgba(2,6,23,0.52)_42%,rgba(2,6,23,0.28)_100%)]" />
      <div className="absolute inset-y-0 left-1/4 right-0 flex items-center justify-center px-4">
        <div className="h-[34px] w-[66%] max-w-[180px] rounded-[1rem] border border-white/12 bg-slate-900/20 shadow-[0_16px_36px_rgba(15,23,42,0.16)]" />
      </div>
    </div>
  )
}

export default function MobileDock() {
  const { activeRightRail } = useRightRailRegistry()
  const pathname = usePathname()
  const router = useRouter()
  const keyboardState = useMobileKeyboardState()
  const cachedViewer = useViewerStore((s) => s.me)
  const familyView = useViewerStore((s) => s.familyView)
  const [resolvedViewer, setResolvedViewer] = useState<MeResponse | null>(null)
  const effectiveViewer = resolvedViewer ?? cachedViewer
  const sidebarNavItems = useMemo(() => getSidebarNavItems(familyView, effectiveViewer), [effectiveViewer, familyView])
  const navButtons = useMemo(() => (familyView ? FAMILY_NAV_BUTTONS : DEFAULT_NAV_BUTTONS), [familyView])
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMounted, setMoreMounted] = useState(false)
  const isOrganizationsDirectory = pathname === '/organizations/directory'
  const isFamilyLockedSession = Boolean(familyView) || effectiveViewer?.accountType === 'family_member'
  const familyCardIdentity = getFamilyLockedCardIdentity(effectiveViewer, familyView)
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
  const [menuSearchLoadingState, setMenuSearchLoadingState] = useState<SearchResultsLoadingState>({ active: false, label: 'Searching Civil' })
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
      setResolvedViewer(cachedViewer)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const data = await ensureViewerMe({ token })
        if (cancelled) return
        if (data) {
          setResolvedViewer(data)
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const open = menuMounted || moreMounted
    window.dispatchEvent(new CustomEvent(MOBILE_DRAWER_STATE_EVENT, { detail: { open } }))
  }, [menuMounted, moreMounted])

  useEffect(
    () => () => {
      if (typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent(MOBILE_DRAWER_STATE_EVENT, { detail: { open: false } }))
    },
    [],
  )

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
    setMenuSearchFocused(false)
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

  useEffect(() => {
    setMenuSearchFocused(false)
  }, [pathname])

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

  useEffect(() => {
    const handleCloseMoreEvent = () => {
      if (!moreMountedRef.current) return
      handleCloseMore()
    }

    window.addEventListener(MOBILE_MORE_DRAWER_CLOSE_EVENT, handleCloseMoreEvent)
    return () => window.removeEventListener(MOBILE_MORE_DRAWER_CLOSE_EVENT, handleCloseMoreEvent)
  }, [handleCloseMore])

  useEffect(() => {
    const handlePushUiReset = () => {
      setMenuSearchFocused(false)
      if (menuMountedRef.current) handleCloseMenu()
      if (moreMountedRef.current) handleCloseMore()
    }

    window.addEventListener(PUSH_UI_RESET_EVENT, handlePushUiReset)
    return () => window.removeEventListener(PUSH_UI_RESET_EVENT, handlePushUiReset)
  }, [handleCloseMenu, handleCloseMore])

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

  const handleClearMenuSearch = useCallback(() => {
    setMenuSearchQuery('')
  }, [])

  const handleDrawerSearchResultSelect = useCallback(() => {
    setMenuSearchFocused(false)
    handleCloseMenu()
  }, [handleCloseMenu])

  const handleMenuSearchLoadingStateChange = useCallback((state: SearchResultsLoadingState) => {
    setMenuSearchLoadingState(state)
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
  const profileHref = familyCardIdentity?.href ?? (effectiveViewer?.handle ? `/u/${effectiveViewer.handle}` : undefined)
  const showProfileCardSkeleton = hasSession && !effectiveViewer && !familyView

  const morePanelContent = useMemo(() => {
    if (activeRightRail?.content) {
      return activeRightRail.content
    }

    if (pathname === '/home') {
      return <RightRail mode="home" showOrganizations showRsvps />
    }
    const isFriendsDirectoryRoute =
      pathname?.startsWith('/friends') || Boolean(pathname?.match(/^\/u\/[^/]+\/friends(?:\/|$)/))

    if (isFriendsDirectoryRoute) {
      return (
        <div className="space-y-4">
          <MessagesNavBlock
            active="friends"
            visibleItems={hasFamilyProfilesAvailable(effectiveViewer) ? ['family', 'friends', 'groups', 'network', 'market', 'drivers'] : ['friends', 'groups', 'network', 'market', 'drivers']}
          />
          <RightRail hideCommunities showPendingFriendRequests />
        </div>
      )
    }
    if (pathname?.startsWith('/network')) {
      return pathname === '/network'
        ? <RightRail mode="network" showRsvps />
        : <RightRail mode="network" />
    }
    if (pathname?.startsWith('/events')) {
      return <RightRail mode="events" showOrganizations />
    }
    if (pathname?.startsWith('/work')) {
      return <RightRail mode="work" organizationLinkTarget="chat" />
    }
    if (pathname?.startsWith('/drive') || pathname?.startsWith('/delivery')) {
      return <RightRail mode="drive" organizationLinkTarget="chat" />
    }
    if (pathname?.startsWith('/market')) {
      return <RightRail mode="default" hideContacts hideCommunities />
    }
    if (pathname?.startsWith('/channels')) {
      return <RightRail mode="organizations" organizationLinkTarget="chat" />
    }
    if (pathname === '/organizations') {
      return <RightRail showOrganizations organizationBlockVariant="followed" hideContacts hideCommunities hideFamilyBlock />
    }
    if (pathname?.startsWith('/organizations')) {
      return isOrganizationsDirectory ? (
        <RightRail mode="organizationsDirectory" />
      ) : (
        <RightRail mode="organizations" />
      )
    }
    if (userRelationshipRoute) {
      if (userRelationshipRoute.kind === 'friends' || userRelationshipRoute.kind === 'contacts' || userRelationshipRoute.kind === 'connections') {
        return (
          <div className="space-y-4">
            <MessagesNavBlock
              active={userRelationshipRoute.kind === 'connections' ? 'network' : 'friends'}
              visibleItems={hasFamilyProfilesAvailable(effectiveViewer) ? ['family', 'friends', 'groups', 'network', 'market', 'drivers'] : ['friends', 'groups', 'network', 'market', 'drivers']}
              footerAction={effectiveViewer?.handle ? { label: 'My Contacts', href: `/u/${effectiveViewer.handle}/contacts` } : undefined}
            />
            <RightRail
              hideContacts
              hideCommunities={userRelationshipRoute.kind === 'friends' || userRelationshipRoute.kind === 'contacts'}
            />
          </div>
        )
      }
      return <RightRail hideContacts />
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
    if (pathname?.startsWith('/communities') || pathname?.startsWith('/chambers')) {
      return <RightRail mode="communitiesFeed" />
    }
    if (communityRoute) {
      return <CommunityRightRailClient province={communityRoute.province} municipality={communityRoute.municipality} />
    }
    return <RightRail />
  }, [activeRightRail, pathname, handleCloseMore, isOrganizationsDirectory, orgRoute, communityRoute, userRelationshipRoute])

  if (!hydrated || !hasSession) {
    return null
  }

  const hideForKeyboard = keyboardState.keyboardOpen

  return (
    <>
      <nav
        data-mobile-dock="true"
        className="fixed inset-x-0 bottom-0 z-40 min-h-[var(--mobile-dock-height)] border-t border-slate-200 bg-white/95 px-3 pb-[var(--mobile-dock-bottom-pad)] pt-[var(--mobile-bottom-bar-top-pad)] text-[var(--cc-primary)] shadow-[0_-10px_24px_rgba(0,0,0,0.08)] transition-[transform,opacity] duration-200 xl:hidden"
        style={{
          bottom: 'var(--mobile-dock-bottom-offset)',
          transform: hideForKeyboard ? 'translateY(calc(100% + var(--mobile-dock-bottom-offset) + 1rem))' : undefined,
          opacity: hideForKeyboard ? 0 : 1,
          pointerEvents: hideForKeyboard ? 'none' : 'auto',
          visibility: hideForKeyboard ? 'hidden' : 'visible',
        }}
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
                  {item.text ? (
                    <span className="text-sm font-semibold leading-none tracking-[0.08em]">{item.text}</span>
                  ) : item.imageSrc ? (
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
        <div className="fixed inset-0 z-50 xl:hidden" aria-modal="true" role="dialog">
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
              {showProfileCardSkeleton ? (
                <MobileDrawerProfileCardSkeleton />
              ) : (
                <div onClick={profileHref ? handleCloseMenu : undefined}>
                  <CivilCard
                    href={profileHref}
                    size="rail"
                    name={familyCardIdentity?.name ?? effectiveViewer?.name ?? 'Civil Citizen'}
                    subtitle={familyCardIdentity?.subtitle}
                    avatarAlt={familyCardIdentity?.avatarAlt ?? effectiveViewer?.name ?? effectiveViewer?.handle ?? 'Civil citizen'}
                    avatarInitials={familyCardIdentity?.avatarInitials ?? effectiveViewer?.name ?? effectiveViewer?.handle ?? 'C'}
                    avatarSrc={familyCardIdentity?.avatarSrc ?? effectiveViewer?.avatarUrl ?? null}
                    coverUrl={familyCardIdentity?.coverUrl ?? effectiveViewer?.coverUrl ?? null}
                    isVerified={familyCardIdentity?.isVerified ?? Boolean(effectiveViewer?.isVerified)}
                    isBusiness={familyCardIdentity?.isBusiness ?? Boolean(effectiveViewer?.isPremium)}
                    className="w-[calc(100%-48px)] rounded-[var(--drawer-item-radius)]"
                  />
                </div>
              )}
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
                      href="/settings/guardian/settings"
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
                <div className="relative w-full rounded-full border border-slate-200 bg-white shadow-sm transition focus-within:border-[var(--cc-primary)]">
                  {menuSearchLoadingState.active ? (
                    <span className="pointer-events-none absolute left-4 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--cc-primary)]" aria-hidden="true" />
                  ) : (
                    <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  )}
                  <form action="/search" method="GET" autoComplete="off">
                    <input
                      type="search"
                      name="q"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="Search"
                      className="w-full rounded-full bg-white py-2.5 pl-11 pr-11 text-sm text-slate-800 focus:outline-none placeholder:text-slate-500"
                      value={menuSearchQuery}
                      onChange={(event) => setMenuSearchQuery(event.target.value)}
                      onFocus={handleMenuSearchFocus}
                      onBlur={handleMenuSearchBlur}
                    />
                  </form>
                  {menuSearchLoadingState.active ? (
                    <div className="pointer-events-none absolute inset-x-12 bottom-[-1.35rem] truncate px-2 text-center text-[11px] font-medium text-slate-500">
                      {menuSearchLoadingState.label}
                    </div>
                  ) : null}
                  {menuSearchQuery.length > 0 ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setMenuSearchQuery('')}
                    >
                      <HiOutlineXMark className="h-4 w-4" />
                    </button>
                  ) : null}
                  <SearchResults
                    query={menuSearchQuery}
                    open={menuSearchFocused && menuSearchQuery.trim().length >= 2}
                    onResultSelect={handleDrawerSearchResultSelect}
                    onLoadingStateChange={handleMenuSearchLoadingStateChange}
                  />
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
        <div className="fixed inset-0 z-[95] xl:hidden" aria-modal="true" role="dialog">
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
                <p className="text-sm font-semibold text-slate-900">Chambers of Citizens & shortcuts</p>
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
