'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBuildingOffice2,
  HiOutlineCog8Tooth,
  HiOutlineCreditCard,
  HiOutlineUserCircle,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import DashboardShell from '../_components/DashboardShell'
import type { MeResponse } from '../_lib/me'
import { hasHomeCommunity, isPremiumMember } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { isSuperAdmin } from '../_lib/admin'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import {
  enableNativePushOptIn,
  disableNativePushNotifications,
  ensureNativePushRegistration,
  isAppleNativeApp,
  isNativePushOptedOut,
  type PushPermissionState,
} from '../_lib/nativePush'

const CARD_LINKS: Array<{
  key: 'profile' | 'communities' | 'billing'
  label: string
  description: string
  href: string
  icon: IconType
}> = [
  {
    key: 'profile',
    label: 'My Profile',
    description: 'Edit your bio, experience, and civic identity.',
    href: '/profile/edit',
    icon: HiOutlineUserCircle,
  },
  {
    key: 'communities',
    label: 'Manage Communities',
    description: 'Pick your home riding and follow more communities.',
    href: '/communities/settings',
    icon: HiOutlineBuildingOffice2,
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Manage premium, organizations, and payment methods.',
    href: '/settings/billing',
    icon: HiOutlineCreditCard,
  },
]

export default function SettingsPage() {
  const router = useRouter()
  const cachedViewer = useViewerStore((s) => s.me)
  const [viewer, setViewer] = useState<MeResponse | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showPushControl, setShowPushControl] = useState(false)
  const [pushState, setPushState] = useState<PushPermissionState>('unknown')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushOptedOut, setPushOptedOut] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedToken = window.localStorage.getItem('token')
    if (!storedToken) return
    setToken(storedToken)

    if (cachedViewer) {
      setViewer(cachedViewer)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const payload = await ensureViewerMe({ token: storedToken })
        if (!cancelled && payload) setViewer(payload)
      } catch (error) {
        console.error('Unable to load viewer for settings', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cachedViewer])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isAppleNativeApp()) return

    setShowPushControl(true)
    setPushOptedOut(isNativePushOptedOut())

    let cancelled = false
    void (async () => {
      const state = await ensureNativePushRegistration({ requestIfPrompt: false })
      if (!cancelled) setPushState(state)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      if (token) {
        await fetch(buildApiUrl('/auth/logout'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })
      }
    } catch (error) {
      console.error('Failed to log out', error)
    } finally {
      window.localStorage.removeItem('token')
      router.replace('/')
    }
  }, [router, token])

  const requestLogout = () => setShowLogoutConfirm(true)
  const cancelLogout = () => setShowLogoutConfirm(false)
  const confirmLogout = async () => {
    await handleLogout()
    setShowLogoutConfirm(false)
  }

  const handleEnablePush = useCallback(async () => {
    if (!showPushControl) return
    setPushBusy(true)
    try {
      enableNativePushOptIn()
      setPushOptedOut(false)
      const state = await ensureNativePushRegistration({ requestIfPrompt: true, ignoreOptOut: true })
      setPushState(state)
      setPushOptedOut(isNativePushOptedOut())
    } finally {
      setPushBusy(false)
    }
  }, [showPushControl])

  const handleTogglePush = useCallback(
    async (nextEnabled: boolean) => {
      if (!showPushControl) return
      if (pushBusy) return

      setPushBusy(true)
      try {
        if (nextEnabled) {
          enableNativePushOptIn()
          setPushOptedOut(false)
          const state = await ensureNativePushRegistration({ requestIfPrompt: true, ignoreOptOut: true })
          setPushState(state)
          setPushOptedOut(isNativePushOptedOut())
          return
        }

        await disableNativePushNotifications()
        setPushOptedOut(true)
      } finally {
        setPushBusy(false)
      }
    },
    [pushBusy, showPushControl],
  )

  const isPushToggleOn = useMemo(() => {
    return !pushOptedOut
  }, [pushOptedOut, pushState])

  const greeting = useMemo(() => {
    if (!viewer?.name) return 'Settings'
    return `Settings for ${viewer.name}`
  }, [viewer?.name])

  const isAdminViewer = useMemo(() => isSuperAdmin(viewer), [viewer])
  const showManageOrganizations = useMemo(() => isPremiumMember(viewer) && hasHomeCommunity(viewer), [viewer])
  const manageOrganizationsHref = showManageOrganizations ? '/organizations/manager' : null

  return (
    <DashboardShell
      className="bg-slate-50"
      mainClassName="space-y-6"
    >
      <section className="surface-card px-6 py-5 shadow-subtle">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Account</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{greeting}</h1>
            <p className="mt-3 text-sm text-slate-600">
              Manage everything about your Civil account from one dashboard. Pick a card to jump straight into the experience you need.
            </p>
          </div>
        </div>

        {showPushControl ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">iOS Notifications</p>
                <p className="text-xs text-slate-600">
                  {isPushToggleOn
                    ? 'We will attempt to send you push notifications.'
                    : 'Turn this on to allow the server to send push notifications.'}
                </p>
              </div>
              <label className="inline-flex items-center gap-3 select-none">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {pushBusy ? 'Working…' : isPushToggleOn ? 'On' : 'Off'}
                </span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--cc-primary)] disabled:cursor-not-allowed"
                  checked={isPushToggleOn}
                  disabled={pushBusy}
                  onChange={(e) => void handleTogglePush(e.target.checked)}
                />
              </label>
            </div>
            {isPushToggleOn && pushState !== 'granted' ? (
              <div className="mt-3 text-xs text-slate-500">
                Please ensure your notifications are allowed, in config -&gt; notifications -&gt; civil -&gt; on.
              </div>
            ) : null}
            {pushState !== 'denied' && pushState !== 'unknown' && pushState !== 'prompt' && pushOptedOut ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleEnablePush}
                  disabled={pushBusy}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushBusy ? 'Checking…' : 'Re-enable Notifications'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARD_LINKS.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.key}
                href={card.href}
                className="group rounded-3xl border border-slate-200 bg-white/90 p-4 text-slate-700 shadow-subtle transition hover:border-[var(--cc-primary)] hover:bg-white"
              >
                <span className="inline-flex rounded-2xl bg-[var(--cc-primary)]/10 p-2 text-[var(--cc-primary)]">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  {card.label}
                  <span className="ml-1 text-sm text-[var(--cc-primary)] transition group-hover:translate-x-1">{'>'}</span>
                </h2>
                <p className="mt-2 text-xs text-slate-600">{card.description}</p>
              </Link>
            )
          })}

          {manageOrganizationsHref ? (
            <Link
              href={manageOrganizationsHref}
              className="group rounded-3xl border border-slate-200 bg-white/90 p-4 text-slate-700 shadow-subtle transition hover:border-[var(--cc-primary)] hover:bg-white"
            >
              <span className="inline-flex rounded-2xl bg-[var(--cc-primary)]/10 p-2 text-[var(--cc-primary)]">
                <HiOutlineBuildingOffice2 className="h-5 w-5" />
              </span>
              <h2 className="mt-3 text-base font-semibold text-slate-900">
                Manage Organizations
                <span className="ml-1 text-sm text-[var(--cc-primary)] transition group-hover:translate-x-1">{'>'}</span>
              </h2>
              <p className="mt-2 text-xs text-slate-600">Manage organizations you follow or own.</p>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="surface-card px-6 py-5 shadow-subtle">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={requestLogout}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
          >
            <HiOutlineArrowRightOnRectangle className="h-5 w-5" />
            Log Out
          </button>

          {isAdminViewer ? (
            <Link
              href="/admin"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <HiOutlineCog8Tooth className="h-5 w-5" />
              Open Admin Dashboard
            </Link>
          ) : null}
        </div>
      </section>

      {showLogoutConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-rose-200 bg-white p-5 shadow-xl">
            <div className="flex items-center gap-3 text-rose-700">
              <span className="rounded-xl bg-rose-50 p-2">
                <HiOutlineArrowRightOnRectangle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-rose-700">Confirm log out</p>
                <p className="text-xs text-slate-600">You will need to sign in again to continue.</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelLogout}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLogout}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  )
}
