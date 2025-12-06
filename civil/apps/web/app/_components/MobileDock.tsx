"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HiOutlineBell,
  HiOutlineEnvelope,
  HiOutlineHome,
  HiOutlineMagnifyingGlass,
  HiOutlineXMark,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'
import { PRIMARY_NAV, ADMIN_NAV, type SidebarNavItem } from './Sidebar'
import type { MeResponse } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { pushToast } from './useToasts'
import { isSuperAdmin } from '../_lib/admin'

const NAV_BUTTONS: Array<{ key: 'home' | 'search' | 'notifications' | 'messages'; label: string; icon: IconType }> = [
  { key: 'home', label: 'Menu', icon: HiOutlineHome },
  { key: 'search', label: 'Search', icon: HiOutlineMagnifyingGlass },
  { key: 'notifications', label: 'Alerts', icon: HiOutlineBell },
  { key: 'messages', label: 'Messages', icon: HiOutlineEnvelope },
] as const

const DRAWER_TRANSITION_MS = 320

type NavButtonKey = (typeof NAV_BUTTONS)[number]['key']

export default function MobileDock() {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [viewer, setViewer] = useState<MeResponse | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuMountedRef = useRef(false)

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
    if (!menuMounted) return undefined
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [menuMounted])

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

  useEffect(() => {
    menuMountedRef.current = menuMounted
  }, [menuMounted])

  useEffect(() => {
    if (!menuMountedRef.current) return
    handleCloseMenu()
  }, [pathname, handleCloseMenu])

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    },
    [],
  )

  const handleButtonPress = useCallback(
    (key: NavButtonKey) => {
      if (key === 'home') {
        handleOpenMenu()
        return
      }
      if (key === 'messages') {
        router.push('/messages')
        return
      }
      const friendlyLabel = key === 'notifications' ? 'Notifications' : 'Search'
      pushToast(`${friendlyLabel} is coming soon.`, 'info', 3500)
    },
    [handleOpenMenu, router],
  )

  const navGroups = useMemo(() => {
    const groups: Array<{ title: string; items: SidebarNavItem[] }> = [
      { title: 'Navigate', items: PRIMARY_NAV },
    ]
    if (isSuperAdmin(viewer)) {
      groups.push({ title: 'Admin', items: ADMIN_NAV })
    }
    return groups
  }, [viewer])

  if (!hydrated || !hasSession) {
    return null
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[var(--cc-primary)] shadow-[0_-12px_30px_rgba(0,0,0,0.08)] lg:hidden"
        role="navigation"
        aria-label="Mobile navigation"
      >
        <div className="flex items-center justify-around gap-2">
          {NAV_BUTTONS.map((item) => {
            const Icon = item.icon
            const isActive =
              item.key !== 'home' &&
              ((item.key === 'search' && pathname?.startsWith('/search')) ||
                (item.key === 'notifications' && pathname?.startsWith('/notifications')) ||
                (item.key === 'messages' && pathname?.startsWith('/messages')))
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleButtonPress(item.key)}
                className={clsx(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  isActive
                    ? 'bg-[var(--cc-primary)] text-white shadow shadow-[var(--cc-primary)]/30'
                    : 'text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10',
                )}
              >
                <Icon className="text-2xl" />
                <span>{item.label}</span>
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
              'absolute inset-y-0 left-0 flex h-full w-[min(24rem,90vw)] max-w-full flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-6 shadow-2xl transition-transform duration-300',
              menuOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <div className="flex items-center gap-3">
              <VerifiedAvatar
                src={viewer?.avatarUrl ?? null}
                alt={viewer?.name ?? viewer?.handle ?? 'Civil citizen'}
                initials={viewer?.name ?? viewer?.handle ?? 'C'}
                size={56}
                isVerified={Boolean(viewer?.isVerified)}
                isBusiness={Boolean(viewer?.isPremium)}
              />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900">{viewer?.name ?? 'Civil Citizen'}</p>
                <p className="text-xs text-slate-500">@{viewer?.handle ?? 'civil'}</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 p-2 text-slate-500"
                onClick={handleCloseMenu}
                aria-label="Close menu"
              >
                <HiOutlineXMark className="text-lg" />
              </button>
            </div>
            <div className="mt-6 flex-1 overflow-y-auto pb-6">
              {navGroups.map((group, index) => (
                <div key={group.title} className={index === 0 ? undefined : 'mt-6'}>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{group.title}</p>
                  <div className="mt-3 space-y-2">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const active = pathname ? pathname.startsWith(item.href) : false
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={handleCloseMenu}
                          className={clsx(
                            'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                            active
                              ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5 text-[var(--cc-primary)]'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
                          )}
                        >
                          <span className="rounded-xl bg-slate-100 p-2 text-base text-slate-600">
                            <Icon />
                          </span>
                          <span>{item.label}</span>
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
    </>
  )
}
