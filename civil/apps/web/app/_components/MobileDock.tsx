"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  HiOutlineBars3,
  HiOutlineBellAlert,
  HiOutlineEnvelope,
  HiOutlineMagnifyingGlass,
  HiOutlineSquares2X2,
  HiOutlineWallet,
  HiOutlineXMark,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'
import { PRIMARY_NAV } from './Sidebar'
import type { MeResponse } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { RightRail } from './RightRail'
import FriendsRightRail from './FriendsRightRail'
import { getStoredToken } from '../_lib/tokenStorage'
import Block from './Block'

const NAV_BUTTONS: Array<{
  key: 'menu' | 'search' | 'notifications' | 'messages' | 'wallet' | 'more'
  label: string
  icon: IconType
}> = [
  { key: 'menu', label: 'Menu', icon: HiOutlineBars3 },
  { key: 'search', label: 'Search', icon: HiOutlineMagnifyingGlass },
  { key: 'notifications', label: 'Alerts', icon: HiOutlineBellAlert },
  { key: 'messages', label: 'Messages', icon: HiOutlineEnvelope },
  { key: 'wallet', label: 'Wallet', icon: HiOutlineWallet },
  { key: 'more', label: 'More', icon: HiOutlineSquares2X2 },
] as const

const DRAWER_TRANSITION_MS = 320
const EDGE_SWIPE_THRESHOLD = 36
const SWIPE_DISTANCE_THRESHOLD = 60
const MAX_SWIPE_VERTICAL_DELTA = 80

type NavButtonKey = (typeof NAV_BUTTONS)[number]['key']

const ORG_DRAWER_LINKS: Array<{ key: string; label: string; segment: string }> = [
  { key: 'overview', label: 'Overview', segment: '' },
  { key: 'posts', label: 'Posts', segment: 'posts' },
  { key: 'events', label: 'Events', segment: 'events' },
  { key: 'jobs', label: 'Jobs', segment: 'jobs' },
  { key: 'gigs', label: 'Gigs', segment: 'gigs' },
  { key: 'discussions', label: 'Discussions', segment: 'discussions' },
  { key: 'settings', label: 'Settings', segment: 'settings' },
]

function getOrgRouteFromPathname(pathname: string | null | undefined):
  | { basePath: string; activePath: string }
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
  return { basePath, activePath: pathname }
}

function OrganizationMoreBlock({
  pathname,
  onNavigate,
}: {
  pathname: string | null | undefined
  onNavigate: () => void
}) {
  const orgInfo = useMemo(() => getOrgRouteFromPathname(pathname), [pathname])
  if (!orgInfo) return null

  return (
    <Block title="Organization" className="p-0">
      <div className="divide-y divide-slate-100">
        {ORG_DRAWER_LINKS.map((link) => {
          const href = link.segment ? `${orgInfo.basePath}/${link.segment}` : orgInfo.basePath
          const active = orgInfo.activePath === href || (link.segment && orgInfo.activePath?.startsWith(`${href}`))
          return (
            <Link
              key={link.key}
              href={href}
              onClick={onNavigate}
              className={clsx(
                'flex items-center justify-between px-5 py-3 text-sm font-semibold transition-colors',
                active
                  ? 'bg-slate-50 text-[var(--cc-primary)]'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <span>{link.label}</span>
            </Link>
          )
        })}
      </div>
    </Block>
  )
}

export default function MobileDock() {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMounted, setMoreMounted] = useState(false)
  const isOrganizationsDirectory = pathname === '/organizations/directory'
  const [viewer, setViewer] = useState<MeResponse | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [messageUnreadCount, setMessageUnreadCount] = useState(0)
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

    let cancelled = false
    const loadViewer = async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.localStorage.removeItem('token')
            setHasSession(false)
          }
          return
        }
        const data = (await res.json()) as MeResponse
        if (!cancelled) {
          setViewer(data)
        }
      } catch (err) {
        console.error('Unable to load viewer for mobile dock', err)
      }
    }

    void loadViewer()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasSession) return

    const fetchCounts = async () => {
      const token = getStoredToken()
      if (!token) return

      try {
        const [notifRes, msgRes] = await Promise.all([
          fetch(buildApiUrl('/notifications?limit=1'), {
            headers: { authorization: `Bearer ${token}` },
          }),
          fetch(buildApiUrl('/messages/unread-count'), {
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
    },
    [],
  )

  const handleButtonPress = useCallback(
    (key: NavButtonKey) => {
      if (key === 'menu') {
        handleOpenMenu()
        return
      }
      if (key === 'search') {
        router.push('/search')
        return
      }
      if (key === 'notifications') {
        router.push('/notifications')
        return
      }
      if (key === 'messages') {
        router.push('/messages')
        return
      }
      if (key === 'wallet') {
        router.push('/wallet')
        return
      }
      if (key === 'more') {
        handleOpenMore()
        return
      }
    },
    [handleOpenMenu, handleOpenMore, router],
  )

  const navGroups = useMemo(() => [{ title: '', items: PRIMARY_NAV }], [])

  const drawerSpacingVars = useMemo<CSSProperties>(
      () =>
        ({
          '--drawer-pad': 'clamp(12px, 1.4vh, 15px)',
          '--drawer-gap': 'clamp(6px, 0.7vh, 8px)',
          '--drawer-top-gap': 'clamp(6px, 0.9vh, 10px)',
          '--drawer-item-pad': 'clamp(10px, 1.8vh, 12px)',
          '--drawer-item-radius': 'clamp(15px, 1.9vw, 19px)',
          '--drawer-icon-pad': 'clamp(12px, 1.6vh, 14px)',
          '--drawer-icon-size': 'clamp(32px, 4vh, 46px)',
        } as CSSProperties),
      [],
    )

  const navGridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: `repeat(${NAV_BUTTONS.length}, minmax(0, 1fr))`,
  }), [])

  const morePanelContent = useMemo(() => {
    if (pathname?.startsWith('/friends') || pathname?.startsWith('/network')) {
      if (pathname?.startsWith('/network')) {
        return <RightRail mode="network" sticky={false} />
      }
      return <FriendsRightRail />
    }
    if (pathname?.startsWith('/organizations')) {
      return isOrganizationsDirectory ? (
        <RightRail mode="organizationsDirectory" sticky={false} />
      ) : (
        <RightRail mode="organizations" sticky={false} />
      )
    }
    return (
      <div className="space-y-6">
        <OrganizationMoreBlock pathname={pathname} onNavigate={handleCloseMore} />
        <RightRail sticky={false} />
      </div>
    )
  }, [pathname, handleCloseMore, isOrganizationsDirectory])

  useEffect(() => {
    if (!hydrated || !hasSession) return undefined
    let tracking = false
    let startX = 0
    let startY = 0

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches.item(0)
      if (!touch) return
      startX = touch.clientX
      startY = touch.clientY
      tracking = true
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (!tracking) return
      tracking = false
      if (event.changedTouches.length === 0) return
      const touch = event.changedTouches.item(0)
      if (!touch) return
      const deltaX = touch.clientX - startX
      const deltaY = touch.clientY - startY
      if (Math.abs(deltaY) > MAX_SWIPE_VERTICAL_DELTA) return
      if (startX <= EDGE_SWIPE_THRESHOLD && deltaX > SWIPE_DISTANCE_THRESHOLD) {
        handleOpenMenu()
        return
      }
      if (typeof window !== 'undefined' && startX >= window.innerWidth - EDGE_SWIPE_THRESHOLD && deltaX < -SWIPE_DISTANCE_THRESHOLD) {
        handleOpenMore()
      }
    }

    window.addEventListener('touchstart', handleTouchStart)
    window.addEventListener('touchend', handleTouchEnd)
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [hasSession, hydrated, handleOpenMenu, handleOpenMore])

  if (!hydrated || !hasSession) {
    return null
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 text-[var(--cc-primary)] shadow-[0_-10px_24px_rgba(0,0,0,0.08)] lg:hidden"
        role="navigation"
        aria-label="Mobile navigation"
      >
        <div className="grid gap-0.5" style={navGridStyle}>
          {NAV_BUTTONS.map((item) => {
            const Icon = item.icon
            const isActive =
              (item.key === 'menu' && menuOpen) ||
              (item.key === 'search' && pathname?.startsWith('/search')) ||
              (item.key === 'notifications' && pathname?.startsWith('/notifications')) ||
              (item.key === 'messages' && pathname?.startsWith('/messages')) ||
              (item.key === 'wallet' && pathname?.startsWith('/wallet')) ||
              (item.key === 'more' && moreOpen)
            
            const count = item.key === 'notifications' ? unreadCount : item.key === 'messages' ? messageUnreadCount : 0

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleButtonPress(item.key)}
                className={clsx(
                  'flex w-full items-center justify-center rounded-2xl px-3 py-2 transition-colors',
                  isActive
                    ? 'bg-[var(--cc-primary)] text-white shadow shadow-[var(--cc-primary)]/30'
                    : 'text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10',
                )}
                aria-label={item.label}
              >
                <div className="relative">
                  <Icon className="text-xl leading-none" />
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
              'absolute inset-y-0 left-0 flex h-full w-[min(24rem,90vw)] max-w-full flex-col bg-white px-[var(--drawer-pad)] pb-[calc(env(safe-area-inset-bottom)+var(--drawer-pad))] pt-[calc(var(--drawer-pad)*0.85)] shadow-2xl transition-transform duration-300',
              menuOpen ? 'translate-x-0' : '-translate-x-full',
            )}
            style={drawerSpacingVars}
          >
            <div className="relative">
              {viewer?.handle ? (
                <Link
                  href={`/u/${viewer.handle}`}
                  onClick={handleCloseMenu}
                  className="relative flex min-h-[64px] w-[calc(100%-48px)] items-center gap-2 overflow-hidden rounded-[var(--drawer-item-radius)] border border-slate-200 px-2.5 py-2 transition hover:border-slate-300"
                >
                  {viewer?.coverUrl ? <img src={viewer.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                  <div className={clsx('absolute inset-0', viewer?.coverUrl ? 'bg-slate-900/52' : 'bg-slate-700')} />
                  <VerifiedAvatar
                    src={viewer?.avatarUrl ?? null}
                    alt={viewer?.name ?? viewer?.handle ?? 'Civil citizen'}
                    initials={viewer?.name ?? viewer?.handle ?? 'C'}
                    size={42}
                    isVerified={Boolean(viewer?.isVerified)}
                    isBusiness={Boolean(viewer?.isPremium)}
                    className="relative z-[1]"
                  />
                  <div className="relative z-[1] min-w-0 flex-1">
                    <p className="truncate text-[clamp(13px,3.4vw,14px)] font-semibold leading-tight text-white">
                      {viewer?.name ?? 'Civil Citizen'}
                    </p>
                    <p className="truncate text-[12px] text-white/80">View profile</p>
                  </div>
                </Link>
              ) : (
                <div className="relative flex min-h-[64px] w-[calc(100%-48px)] items-center gap-2 overflow-hidden rounded-[var(--drawer-item-radius)] border border-slate-200 px-2.5 py-2">
                  {viewer?.coverUrl ? <img src={viewer.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                  <div className={clsx('absolute inset-0', viewer?.coverUrl ? 'bg-slate-900/52' : 'bg-slate-700')} />
                  <VerifiedAvatar
                    src={viewer?.avatarUrl ?? null}
                    alt={viewer?.name ?? viewer?.handle ?? 'Civil citizen'}
                    initials={viewer?.name ?? viewer?.handle ?? 'C'}
                    size={42}
                    isVerified={Boolean(viewer?.isVerified)}
                    isBusiness={Boolean(viewer?.isPremium)}
                    className="relative z-[1]"
                  />
                  <div className="relative z-[1] min-w-0 flex-1">
                    <p className="truncate text-[clamp(13px,3.4vw,14px)] font-semibold leading-tight text-white">
                      {viewer?.name ?? 'Civil Citizen'}
                    </p>
                    <p className="truncate text-[12px] text-white/80">View profile</p>
                  </div>
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
            <div className="mt-[var(--drawer-top-gap)] flex-1 overflow-y-auto pb-[calc(var(--drawer-pad)*0.85)]">
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
              'absolute inset-y-0 right-0 flex h-full w-[min(24rem,90vw)] max-w-full flex-col bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-6 shadow-2xl transition-transform duration-300',
              moreOpen ? 'translate-x-0' : 'translate-x-full',
            )}
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
            <div className="mt-6 flex-1 overflow-y-auto pb-12">
              {morePanelContent}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
