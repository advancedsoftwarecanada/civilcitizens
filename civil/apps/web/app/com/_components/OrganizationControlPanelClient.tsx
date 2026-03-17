'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  HiOutlineTrash,
  HiOutlineVideoCamera,
} from 'react-icons/hi2'
import Modal from '../../_components/Modal'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'

type PanelItem = {
  label: string
  description: string
  href?: string
  onClick?: () => void
  icon: React.ComponentType<{ className?: string }>
  requiresMeetingManagePermission?: boolean
  tone?: 'default' | 'danger'
}

type GovernanceStateResponse = {
  viewer?: {
    permissions?: string[]
  }
}

type OrgResponse = {
  org?: {
    name?: string
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
  const router = useRouter()
  const [canManageMeetings, setCanManageMeetings] = useState(false)
  const [canDeleteOrganization, setCanDeleteOrganization] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [tokenReady, setTokenReady] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteSaving, setDeleteSaving] = useState(false)

  const base = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}`

  useEffect(() => {
    setToken(getStoredToken())
    setTokenReady(true)
  }, [])

  useEffect(() => {
    if (!tokenReady) return
    if (!token) {
      setCanManageMeetings(false)
      setCanDeleteOrganization(false)
      setOrganizationName('')
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
        setOrganizationName(orgPayload?.org?.name?.trim() || '')
        const viewerRole = orgPayload?.org?.viewerRole
        const canAdminister = viewerRole === 'OWNER' || viewerRole === 'MANAGER'
        setCanDeleteOrganization(canAdminister)
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
        setCanDeleteOrganization(false)
      }
    }

    void load()
  }, [municipality, organization, province, token, tokenReady])

  const items: PanelItem[] = useMemo(() => {
    const panelItems: PanelItem[] = [
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
    ]

    if (canDeleteOrganization) {
      panelItems.push({
        label: 'Delete',
        description: 'Mark this organization and its posts as deleted.',
        onClick: () => setDeleteModalOpen(true),
        icon: HiOutlineTrash,
        tone: 'danger',
      })
    }

    return panelItems
  }, [base, canDeleteOrganization])

  const deleteConfirmationMatches = Boolean(organizationName && deleteConfirmName.trim() === organizationName)

  const closeDeleteModal = () => {
    if (deleteSaving) return
    setDeleteModalOpen(false)
    setDeleteConfirmName('')
  }

  const handleDeleteOrganization = async () => {
    if (!token) return
    if (!deleteConfirmationMatches) {
      pushToast('Type the organization name to confirm deletion.', 'error')
      return
    }

    setDeleteSaving(true)
    try {
      const res = await fetch(
        buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}`),
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        },
      )

      const { json } = await parseApiResponse<{ error?: unknown }>(res)
      if (!res.ok) {
        const rawError =
          typeof (json as any)?.error === 'string'
            ? (json as any).error
            : typeof (json as any)?.error?.message === 'string'
              ? (json as any).error.message
              : null
        pushToast(rawError ?? 'Unable to delete this organization right now.', 'error')
        return
      }

      setDeleteModalOpen(false)
      setDeleteConfirmName('')
      pushToast('Organization marked as deleted.', 'success')
      router.push('/organizations/manager')
    } catch (error) {
      console.error('Failed to delete organization', error)
      pushToast('Unable to delete this organization right now.', 'error')
    } finally {
      setDeleteSaving(false)
    }
  }

  return (
    <section className="surface-card p-4 shadow-subtle">
      <Modal open={deleteModalOpen} onClose={closeDeleteModal} title="Delete organization">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            This marks the organization as deleted and hides it from public discovery. Organization posts will also be marked deleted.
          </p>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Confirmation</p>
            <p className="mt-2 text-sm text-rose-800">Type the organization name exactly to confirm deletion.</p>
            <p className="mt-1 text-sm font-semibold text-rose-900">{organizationName || 'Organization'}</p>
          </div>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={(event) => setDeleteConfirmName(event.target.value)}
            disabled={deleteSaving}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder={organizationName || 'Organization name'}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={deleteSaving}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDeleteOrganization()
              }}
              disabled={deleteSaving || !deleteConfirmationMatches}
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteSaving ? 'Deleting…' : 'Delete organization'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          if (item.requiresMeetingManagePermission && !canManageMeetings) return null
          const Icon = item.icon
          const className = item.tone === 'danger'
            ? 'rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left transition hover:bg-rose-100'
            : 'rounded-2xl border border-slate-200 bg-white p-4 transition hover:bg-slate-50'

          const content = (
            <>
              <div className="flex items-start gap-3">
                <div className={item.tone === 'danger' ? 'rounded-xl border border-rose-200 bg-white/70 p-2' : 'rounded-xl border border-slate-200 bg-slate-50 p-2'}>
                  <Icon className={item.tone === 'danger' ? 'h-5 w-5 text-rose-700' : 'h-5 w-5 text-slate-700'} />
                </div>
                <div className="min-w-0">
                  <p className={item.tone === 'danger' ? 'text-sm font-semibold text-rose-900' : 'text-sm font-semibold text-slate-900'}>{item.label}</p>
                  <p className={item.tone === 'danger' ? 'mt-1 text-xs text-rose-700' : 'mt-1 text-xs text-slate-500'}>{item.description}</p>
                </div>
              </div>
            </>
          )

          if (item.href) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className={className}
              >
                {content}
              </Link>
            )
          }

          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className={className}
            >
              {content}
            </button>
          )
        })}
      </div>
    </section>
  )
}
