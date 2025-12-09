'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBuildingOffice2,
  HiOutlineCog8Tooth,
  HiOutlineCreditCard,
  HiOutlineUserCircle,
} from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import DashboardShell from '../_components/DashboardShell'
import Sidebar from '../_components/Sidebar'
import type { MeResponse } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { isSuperAdmin } from '../_lib/admin'

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
    label: 'Community Settings',
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
  const [viewer, setViewer] = useState<MeResponse | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedToken = window.localStorage.getItem('token')
    if (!storedToken) return
    setToken(storedToken)

    let cancelled = false
    const loadViewer = async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${storedToken}` },
        })
        if (!res.ok) return
        const payload = (await res.json()) as MeResponse
        if (!cancelled) {
          setViewer(payload)
        }
      } catch (error) {
        console.error('Unable to load viewer for settings', error)
      }
    }

    void loadViewer()
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
      window.location.replace('/')
    }
  }, [token])

  const requestLogout = () => setShowLogoutConfirm(true)
  const cancelLogout = () => setShowLogoutConfirm(false)
  const confirmLogout = async () => {
    await handleLogout()
    setShowLogoutConfirm(false)
  }

  const greeting = useMemo(() => {
    if (!viewer?.name) return 'Settings'
    return `Settings for ${viewer.name}`
  }, [viewer?.name])

  const isAdminViewer = useMemo(() => isSuperAdmin(viewer), [viewer])

  return (
    <DashboardShell sidebar={<Sidebar me={viewer ?? undefined} active="account" />} className="bg-gradient-to-b from-white to-slate-50">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Account</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{greeting}</h1>
        <p className="mt-3 text-sm text-slate-600">
          Manage everything about your Civil account from one dashboard. Pick a card to jump straight into the experience you need.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-3">
          {CARD_LINKS.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.key}
                href={card.href}
                className="group rounded-3xl border border-slate-200 bg-white/90 p-4 text-slate-700 shadow hover:border-[var(--cc-primary)] hover:bg-white"
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
        </div>

        <div className="mt-4 flex w-full justify-center">
          <button
            type="button"
            onClick={requestLogout}
            className="w-full max-w-xs rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-center text-sm font-semibold text-rose-700 shadow transition hover:bg-rose-100"
          >
            <HiOutlineArrowRightOnRectangle className="mx-auto h-5 w-5" />
            <span className="mt-2 block text-base font-semibold">Log Out</span>
          </button>
        </div>

        {isAdminViewer ? (
          <div className="mt-3 flex w-full justify-center">
            <Link
              href="/admin"
              className="flex w-full max-w-xs flex-col items-center justify-center rounded-3xl border border-slate-900 bg-slate-900 px-5 py-4 text-center text-sm font-semibold text-white shadow transition hover:bg-slate-800"
            >
              <HiOutlineCog8Tooth className="h-5 w-5" />
              <span className="mt-2 block text-base font-semibold">Open Admin Dashboard</span>
            </Link>
          </div>
        ) : null}

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
      </div>
    </DashboardShell>
  )
}
