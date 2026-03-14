'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FaUserTie } from 'react-icons/fa'
import {
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
  HiOutlineShoppingBag,
  HiOutlineUserGroup,
  HiOutlineUsers,
  HiOutlineShieldCheck,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineMegaphone,
  HiOutlineChatBubbleLeftRight,
  HiOutlineVideoCamera,
} from 'react-icons/hi2'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'

type PanelItem = {
  label: string
  description: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  requiresMeetingManagePermission?: boolean
}

type GovernanceStateResponse = {
  viewer?: {
    permissions?: string[]
  }
}

type OrgResponse = {
  org?: {
    viewerRole?: 'OWNER' | 'MANAGER' | null
  }
}

export default function OrganizationControlPanelClient({
  province,
  municipality,
  organization,
}: {
  province: string
  municipality: string
  organization: string
}) {
  const [canManageMeetings, setCanManageMeetings] = useState(false)

  const base = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}`

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      setCanManageMeetings(false)
      return
    }

    const load = async () => {
      try {
        const [orgRes, governanceRes] = await Promise.all([
          fetch(
            buildApiUrl(
              `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}`,
            ),
            {
              headers: { authorization: `Bearer ${token}` },
              cache: 'no-store',
            },
          ),
          fetch(
            buildApiUrl(
              `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/governance/state`,
            ),
            {
              headers: { authorization: `Bearer ${token}` },
              cache: 'no-store',
            },
          ),
        ])

        const orgPayload = orgRes.ok ? ((await orgRes.json().catch(() => null)) as OrgResponse | null) : null
        const viewerRole = orgPayload?.org?.viewerRole
        if (viewerRole === 'OWNER' || viewerRole === 'MANAGER') {
          setCanManageMeetings(true)
          return
        }

        const governancePayload = governanceRes.ok
          ? ((await governanceRes.json().catch(() => null)) as GovernanceStateResponse | null)
          : null
        const permissions = Array.isArray(governancePayload?.viewer?.permissions)
          ? governancePayload!.viewer!.permissions!.filter((value): value is string => typeof value === 'string')
          : []
        setCanManageMeetings(permissions.includes('manage_events'))
      } catch {
        setCanManageMeetings(false)
      }
    }

    void load()
  }, [municipality, organization, province])

  const items: PanelItem[] = useMemo(
    () => [
      {
        label: 'Details',
        description: 'Profile, branding, and organization information.',
        href: `${base}/settings/details`,
        icon: HiOutlineBuildingOffice2,
      },
      {
        label: 'Events',
        description: 'Create, edit, and publish event drafts.',
        href: `${base}/events/manage`,
        icon: HiOutlineCalendarDays,
      },
      {
        label: 'Meetings',
        description: 'Create, schedule, and manage meeting rooms.',
        href: `${base}/meetings/manage`,
        icon: HiOutlineVideoCamera,
        requiresMeetingManagePermission: true,
      },
      {
        label: 'Jobs',
        description: 'Manage job listings and hiring visibility.',
        href: `${base}/jobs/manage`,
        icon: FaUserTie,
      },
      {
        label: 'Shop',
        description: 'Manage products, pricing, and storefront.',
        href: `${base}/shop/manage`,
        icon: HiOutlineShoppingBag,
      },
      {
        label: 'Referrals',
        description: 'Invite tracking, referral links, and growth.',
        href: `${base}/referrals`,
        icon: HiOutlineMegaphone,
      },
      {
        label: 'Governance',
        description: 'Plans, join mode, and governance controls.',
        href: `${base}/settings/governance`,
        icon: HiOutlineShieldCheck,
      },
      {
        label: 'Members',
        description: 'Promote, suspend, ban, and manage members.',
        href: `${base}/settings/members`,
        icon: HiOutlineUserGroup,
      },
      {
        label: 'Joins',
        description: 'See people who joined and engagement.',
        href: `${base}/joins`,
        icon: HiOutlineUsers,
      },
      {
        label: 'Roles',
        description: 'Create and manage role permissions.',
        href: `${base}/settings/roles`,
        icon: HiOutlineAdjustmentsHorizontal,
      },
      {
        label: 'Chat Channels',
        description: 'Create and manage community channels.',
        href: `${base}/chat-channels/manage`,
        icon: HiOutlineChatBubbleLeftRight,
      },
    ],
    [base],
  )

  return (
    <section className="surface-card p-4 shadow-subtle">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          if (item.requiresMeetingManagePermission && !canManageMeetings) return null
          const Icon = item.icon
          return (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:bg-slate-50"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <Icon className="h-5 w-5 text-slate-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
