'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBell,
  HiOutlineChatBubbleLeftRight,
  HiOutlineBuildingLibrary,
  HiOutlineBuildingOffice2,
  HiOutlineCog8Tooth,
  HiOutlineShoppingBag,
  HiOutlineTrash,
  HiOutlineUserGroup,
  HiOutlineUserCircle,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import clsx from 'clsx'
import DashboardShell from '../_components/DashboardShell'
import Modal from '../_components/Modal'
import { RightRail } from '../_components/RightRail'
import type { MeResponse } from '../_lib/me'
import { hasHomeCommunity } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { isSuperAdmin } from '../_lib/admin'
import { clearAuthSession } from '../_lib/authSession'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import { redirectToAuthModal } from '../_lib/authModal'
import {
  enableNativePushOptIn,
  disableNativePushNotifications,
  ensureNativePushRegistration,
  isNativeApp,
  isNativePushOptedOut,
  type PushPermissionState,
} from '../_lib/nativePush'
import { resetHomeNativePushPromptAttempt, resetHomeWebPushPromptAttempt } from '../_lib/homePushPromptState'
import {
  canEnablePush as canEnableWebPush,
  disablePush as disableWebPush,
  enablePush as enableWebPush,
  getPermissionState as getWebPushPermissionState,
  isPushEnabled as isWebPushEnabled,
} from '../_lib/pushClient'
import { pushToast } from '../_components/useToasts'

type SettingsActionCardItem = {
  key: string
  label: string
  description: string
  href?: string
  onClick?: () => void
  icon: IconType
  tone?: 'default' | 'danger' | 'warning' | 'admin'
}

type SettingsActionCardProps = {
  label: string
  description: string
  icon: IconType
  href?: string
  onClick?: () => void
  tone?: 'default' | 'danger' | 'warning' | 'admin'
}

type SettingsToggleCardProps = {
  icon: IconType
  title: string
  description: string
  enabled: boolean
  busy: boolean
  disabled?: boolean
  note?: string | null
  actionLabel?: string | null
  onAction?: () => void
  onToggle: (nextEnabled: boolean) => void
}

function normalizeDangerInput(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function SettingsSectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </header>
  )
}

function SettingsPanelSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section id={id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <SettingsSectionHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="mt-6">{children}</div>
    </section>
  )
}

function SettingsActionCard({
  label,
  description,
  icon: Icon,
  href,
  onClick,
  tone = 'default',
}: SettingsActionCardProps) {
  const cardClassName = clsx(
    'rounded-2xl border p-4 text-left transition hover:bg-slate-50',
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50/40 hover:border-rose-300 hover:bg-rose-50/60'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/60 hover:border-amber-300 hover:bg-amber-100/70'
        : tone === 'admin'
          ? 'border-slate-950 bg-slate-950 hover:border-amber-300 hover:bg-black'
          : 'border-slate-200 bg-white',
  )
  const iconShellClassName = clsx(
    'rounded-xl border p-2 transition',
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-600'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-100 text-amber-700'
        : tone === 'admin'
          ? 'border-amber-300/50 bg-amber-300/10 text-amber-300'
          : 'border-slate-200 bg-slate-50 text-slate-700',
  )
  const labelClassName =
    tone === 'danger' ? 'text-rose-700' : tone === 'warning' ? 'text-amber-800' : tone === 'admin' ? 'text-amber-300' : 'text-slate-900'
  const descriptionClassName =
    tone === 'danger'
      ? 'text-rose-700/80'
      : tone === 'warning'
        ? 'text-amber-800/80'
        : tone === 'admin'
          ? 'text-amber-100/80'
          : 'text-slate-500'

  const content = (
    <div className="flex items-start gap-3">
      <div className={iconShellClassName}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={clsx('text-sm font-semibold', labelClassName)}>{label}</p>
        <p className={clsx('mt-1 text-xs leading-5', descriptionClassName)}>{description}</p>
      </div>
    </div>
  )

  if (href) {
    return (
      <Link href={href} className={cardClassName}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={clsx(cardClassName, 'w-full')}>
      {content}
    </button>
  )
}

function SettingsToggleCard({
  icon: Icon,
  title,
  description,
  enabled,
  busy,
  disabled = false,
  note,
  actionLabel,
  onAction,
  onToggle,
}: SettingsToggleCardProps) {
  const toggleDisabled = disabled || busy

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-subtle">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={toggleDisabled}
          onClick={() => onToggle(!enabled)}
          className={clsx(
            'relative inline-flex h-7 w-12 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60',
            enabled ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]' : 'border-slate-200 bg-slate-200',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform',
              enabled ? 'translate-x-[1.35rem]' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {note ? <p className="mt-3 text-xs leading-5 text-slate-500">{note}</p> : null}

      {actionLabel && onAction ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={onAction}
            disabled={toggleDisabled}
            className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--cc-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Working…' : actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const cachedViewer = useViewerStore((s) => s.me)
  const [viewer, setViewer] = useState<MeResponse | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showDeleteNameModal, setShowDeleteNameModal] = useState(false)
  const [showDeleteYesModal, setShowDeleteYesModal] = useState(false)
  const [deleteNameInput, setDeleteNameInput] = useState('')
  const [deleteYesInput, setDeleteYesInput] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [showNativePushControl, setShowNativePushControl] = useState(false)
  const [nativePushState, setNativePushState] = useState<PushPermissionState>('unknown')
  const [nativePushBusy, setNativePushBusy] = useState(false)
  const [nativePushOptedOut, setNativePushOptedOut] = useState(false)
  const [showWebPushControl, setShowWebPushControl] = useState(false)
  const [webPushBusy, setWebPushBusy] = useState(false)
  const [webPushEnabled, setWebPushEnabled] = useState(false)
  const [webPushPermission, setWebPushPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [webPushMessage, setWebPushMessage] = useState<string | null>(null)

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
    if (!isNativeApp()) return

    setShowNativePushControl(true)
    setNativePushOptedOut(isNativePushOptedOut())

    let cancelled = false
    void (async () => {
      const state = await ensureNativePushRegistration({ requestIfPrompt: false })
      if (!cancelled) setNativePushState(state)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isNativeApp()) return

    setShowWebPushControl(true)
    setWebPushPermission(getWebPushPermissionState())
    if (!canEnableWebPush()) {
      setWebPushMessage('Install the PWA and allow notifications on this device to enable web push.')
      return
    }

    let cancelled = false
    void (async () => {
      const enabled = await isWebPushEnabled()
      if (cancelled) return
      setWebPushEnabled(enabled)
      setWebPushPermission(getWebPushPermissionState())
      if (!enabled) setWebPushMessage(null)
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
          headers: { authorization: `Bearer ${token}` },
        })
      }
    } catch (error) {
      console.error('Failed to log out', error)
    } finally {
      clearAuthSession()
      router.replace('/')
    }
  }, [router, token])

  const handleEnableNativePush = useCallback(async () => {
    if (!showNativePushControl) return
    setNativePushBusy(true)
    try {
      enableNativePushOptIn()
      setNativePushOptedOut(false)
      const state = await ensureNativePushRegistration({ requestIfPrompt: true, ignoreOptOut: true })
      setNativePushState(state)
      setNativePushOptedOut(isNativePushOptedOut())
    } finally {
      setNativePushBusy(false)
    }
  }, [showNativePushControl])

  const handleToggleNativePush = useCallback(
    async (nextEnabled: boolean) => {
      if (!showNativePushControl || nativePushBusy) return

      setNativePushBusy(true)
      try {
        if (nextEnabled) {
          enableNativePushOptIn()
          setNativePushOptedOut(false)
          const state = await ensureNativePushRegistration({ requestIfPrompt: true, ignoreOptOut: true })
          setNativePushState(state)
          setNativePushOptedOut(isNativePushOptedOut())
          return
        }

        await disableNativePushNotifications()
        setNativePushOptedOut(true)
        resetHomeNativePushPromptAttempt()
      } finally {
        setNativePushBusy(false)
      }
    },
    [nativePushBusy, showNativePushControl],
  )

  const handleToggleWebPush = useCallback(
    async (nextEnabled: boolean) => {
      if (!showWebPushControl || webPushBusy) return

      setWebPushBusy(true)
      setWebPushMessage(null)
      try {
        if (nextEnabled) {
          const result = await enableWebPush()
          const enabled = await isWebPushEnabled()
          setWebPushEnabled(enabled)
          setWebPushPermission(getWebPushPermissionState())
          if (!result.ok) setWebPushMessage(result.message ?? 'Unable to enable notifications.')
          return
        }

        const result = await disableWebPush()
        setWebPushEnabled(false)
        setWebPushPermission(getWebPushPermissionState())
        if (result.ok) {
          resetHomeWebPushPromptAttempt()
        }
        if (!result.ok) setWebPushMessage(result.message ?? 'Unable to disable notifications.')
      } finally {
        setWebPushBusy(false)
      }
    },
    [showWebPushControl, webPushBusy],
  )

  const isNativePushToggleOn = useMemo(() => !nativePushOptedOut, [nativePushOptedOut])
  const isWebPushSupported = canEnableWebPush()
  const viewerDisplayName = useMemo(() => viewer?.name?.trim() || viewer?.handle || 'Civil Citizen', [viewer?.handle, viewer?.name])
  const isAdminViewer = useMemo(() => isSuperAdmin(viewer), [viewer])
  const showManageOrganizations = useMemo(() => hasHomeCommunity(viewer), [viewer])
  const manageOrganizationsHref = showManageOrganizations ? '/organizations/manager' : null
  const deleteVerificationValue = useMemo(() => {
    const fullName = viewer?.name?.trim()
    if (fullName) return fullName
    return viewer?.email?.trim() ?? ''
  }, [viewer?.email, viewer?.name])
  const deleteVerificationLabel = viewer?.name?.trim() ? 'Type your full name' : 'Type your account email'
  const deleteNameMatches = useMemo(
    () => normalizeDangerInput(deleteNameInput) === normalizeDangerInput(deleteVerificationValue),
    [deleteNameInput, deleteVerificationValue],
  )
  const deleteYesMatches = deleteYesInput.trim().toUpperCase() === 'YES'

  const openDeleteAccountFlow = useCallback(() => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setDeleteNameInput('')
    setDeleteYesInput('')
    setShowDeleteYesModal(false)
    setShowDeleteNameModal(true)
  }, [token])

  const controlPanelItems = useMemo<SettingsActionCardItem[]>(() => {
    const items: SettingsActionCardItem[] = [
      {
        key: 'profile',
        label: 'Profile',
        description: 'Edit your bio, cover photo, profile photo, and civic identity.',
        href: '/profile/edit',
        icon: HiOutlineUserCircle,
      },
      {
        key: 'communities',
        label: 'Communities',
        description: 'Set your home riding and manage the communities you follow.',
        href: '/communities/settings',
        icon: HiOutlineBuildingOffice2,
      },
      {
        key: 'family',
        label: 'Guardian Mode',
        description: 'Enable supervised profiles for children, adolescents, and youth, and prepare devices for guardian-managed accounts.',
        href: '/settings/guardian',
        icon: HiOutlineUserGroup,
      },
      {
        key: 'commerce',
        label: 'Orders & Shipping',
        description: 'Open your market buyer account, orders, and saved shipping details.',
        href: '/market/account',
        icon: HiOutlineShoppingBag,
      },
      {
        key: 'support',
        label: 'Customer Support',
        description: 'Submit service or feature requests and track reported content you filed.',
        href: '/settings/support',
        icon: HiOutlineChatBubbleLeftRight,
      },
      {
        key: 'logout',
        label: 'Log Out',
        description: 'End your current session on this device.',
        onClick: () => setShowLogoutConfirm(true),
        icon: HiOutlineArrowRightOnRectangle,
        tone: 'warning',
      },
      {
        key: 'delete',
        label: 'Delete Account',
        description: 'Delete your profile, messages, posts, organizations, and authored content permanently.',
        onClick: openDeleteAccountFlow,
        icon: HiOutlineTrash,
        tone: 'danger',
      },
    ]

    if (manageOrganizationsHref) {
      items.splice(2, 0, {
        key: 'organizations',
        label: 'Organizations',
        description: 'Manage organizations you own, follow, or help operate.',
        href: manageOrganizationsHref,
        icon: HiOutlineBuildingLibrary,
      })
    }

    if (isAdminViewer) {
      items.push({
        key: 'admin',
        label: 'Admin Dashboard',
        description: 'Open platform diagnostics, reports, support queues, and moderation controls.',
        href: '/admin',
        icon: HiOutlineCog8Tooth,
        tone: 'admin',
      })
    }

    return items
  }, [isAdminViewer, manageOrganizationsHref, openDeleteAccountFlow])

  const closeDeleteAccountFlow = useCallback(() => {
    if (deleteBusy) return
    setShowDeleteNameModal(false)
    setShowDeleteYesModal(false)
    setDeleteNameInput('')
    setDeleteYesInput('')
  }, [deleteBusy])

  const continueDeleteAccountFlow = useCallback(() => {
    if (!deleteNameMatches || deleteBusy) return
    setShowDeleteNameModal(false)
    setShowDeleteYesModal(true)
  }, [deleteBusy, deleteNameMatches])

  const confirmDeleteAccount = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!deleteNameMatches || !deleteYesMatches) return

    setDeleteBusy(true)
    try {
      const response = await fetch(buildApiUrl('/account'), {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fullName: deleteNameInput,
          confirmation: deleteYesInput.trim().toUpperCase(),
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        if (payload?.error === 'name_mismatch') {
          pushToast('The full-name confirmation did not match your account.', 'error')
        } else if (payload?.error === 'confirmation_mismatch') {
          pushToast('Type YES to permanently delete this account.', 'error')
        } else {
          pushToast(payload?.error ?? 'Unable to delete this account right now.', 'error')
        }
        return
      }

      clearAuthSession()
      router.replace('/')
    } catch (error) {
      console.error('Failed to delete account', error)
      pushToast('Unable to delete this account right now.', 'error')
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteNameInput, deleteNameMatches, deleteYesInput, deleteYesMatches, router, token])

  const panelEyebrow = useMemo(() => `${viewerDisplayName.toUpperCase()} · ACCOUNT`, [viewerDisplayName])

  return (
    <DashboardShell
      className="bg-slate-50"
      mainClassName="space-y-6"
      rightRail={<RightRail showOrganizations showRsvps sticky={false} />}
    >
      <SettingsPanelSection
        id="notifications"
        eyebrow="Notifications"
        title="Device Controls"
        description="Manage how Civil reaches you on this device without digging through browser settings."
      >
        <section className="surface-card p-4 shadow-subtle">
          {showNativePushControl || showWebPushControl ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {showNativePushControl ? (
                <SettingsToggleCard
                  icon={HiOutlineBell}
                  title="App Notifications"
                  description="Allow the installed Civil app to receive push notifications on this device."
                  enabled={isNativePushToggleOn}
                  busy={nativePushBusy}
                  note={
                    isNativePushToggleOn && nativePushState !== 'granted'
                      ? 'If notifications still do not appear, check your device notification settings for Civil.'
                      : null
                  }
                  actionLabel={
                    nativePushState !== 'denied' && nativePushState !== 'unknown' && nativePushState !== 'prompt' && nativePushOptedOut
                      ? 'Re-enable Notifications'
                      : null
                  }
                  onAction={() => {
                    void handleEnableNativePush()
                  }}
                  onToggle={(nextEnabled) => {
                    void handleToggleNativePush(nextEnabled)
                  }}
                />
              ) : null}

              {showWebPushControl ? (
                <SettingsToggleCard
                  icon={HiOutlineBell}
                  title="Web Push Notifications"
                  description="Turn on browser or PWA notifications for this device."
                  enabled={webPushEnabled}
                  busy={webPushBusy}
                  disabled={!webPushEnabled && !isWebPushSupported}
                  note={
                    webPushMessage
                      ? webPushMessage
                      : !isWebPushSupported
                        ? `Permission: ${webPushPermission}. iOS requires opening the installed PWA from your home screen before enabling push.`
                        : `Permission: ${webPushPermission}.`
                  }
                  onToggle={(nextEnabled) => {
                    void handleToggleWebPush(nextEnabled)
                  }}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Notification controls are not available on this device.</p>
          )}
        </section>
      </SettingsPanelSection>

      <SettingsPanelSection
        eyebrow={panelEyebrow}
        title="Control Panel"
        description="Manage every part of your account from one place."
      >
        <section className="surface-card p-4 shadow-subtle">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {controlPanelItems.map((item) => (
              <SettingsActionCard
                key={item.key}
                href={item.href}
                onClick={item.onClick}
                icon={item.icon}
                label={item.label}
                description={item.description}
                tone={item.tone}
              />
            ))}
          </div>
        </section>
      </SettingsPanelSection>

      <Modal open={showLogoutConfirm} onClose={() => setShowLogoutConfirm(false)} title="Log out">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">You will need to sign in again to continue.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(false)}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleLogout()
              }}
              className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300"
            >
              Log Out
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showDeleteNameModal} onClose={closeDeleteAccountFlow} title="Delete account">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            This permanently deletes your account and removes your authored posts, messages, comments, owned organizations, and related content.
          </p>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Confirmation Step 1</p>
            <p className="mt-2 text-sm text-rose-800">
              {deleteVerificationLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-rose-900">{deleteVerificationValue || 'No account name available.'}</p>
          </div>
          <input
            type="text"
            value={deleteNameInput}
            onChange={(event) => setDeleteNameInput(event.target.value)}
            disabled={deleteBusy}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder={deleteVerificationValue}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteAccountFlow}
              disabled={deleteBusy}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={continueDeleteAccountFlow}
              disabled={deleteBusy || !deleteNameMatches || !deleteVerificationValue}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showDeleteYesModal} onClose={closeDeleteAccountFlow} title="Delete account">
        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Confirmation Step 2</p>
            <p className="mt-2 text-sm text-rose-800">
              Type <span className="font-semibold text-rose-900">YES</span> to permanently delete this account.
            </p>
          </div>
          <input
            type="text"
            value={deleteYesInput}
            onChange={(event) => setDeleteYesInput(event.target.value.toUpperCase())}
            disabled={deleteBusy}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm uppercase tracking-[0.18em] text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="YES"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (deleteBusy) return
                setShowDeleteYesModal(false)
                setShowDeleteNameModal(true)
              }}
              disabled={deleteBusy}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                void confirmDeleteAccount()
              }}
              disabled={deleteBusy || !deleteNameMatches || !deleteYesMatches}
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteBusy ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}
