'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { formatUserDisplayName } from '../../_lib/text'
import { redirectToAuthModal } from '../../_lib/authModal'
import { pushToast } from '../../_components/useToasts'

type MemberRow = {
  userId: string
  role: 'OWNER' | 'MANAGER' | 'FOLLOWER'
  joinedAt: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
  }
}

type MembersResponse = {
  members?: MemberRow[]
  followers?: MemberRow[]
}

type OrganizationRoleResponse = {
  org?: {
    ownerId?: string
    viewerRole?: 'OWNER' | 'MANAGER' | null
  }
}

type MeResponse = {
  user?: {
    id?: string
  }
}

function roleLabel(role: MemberRow['role']) {
  if (role === 'OWNER') return 'Owner'
  if (role === 'MANAGER') return 'Manager'
  return 'Member'
}

export default function OrganizationMembersClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MemberRow[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [viewerRole, setViewerRole] = useState<'OWNER' | 'MANAGER' | null>(null)
  const [actionBusyUserId, setActionBusyUserId] = useState<string | null>(null)

  const loadOrgRole = useCallback(async () => {
    if (!token) {
      setViewerRole(null)
      setOwnerId(null)
      setViewerUserId(null)
      return
    }

    try {
      const [meRes, orgRes] = await Promise.all([
        fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
          ),
          {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          },
        ),
      ])

      if (meRes.ok) {
        const { json } = await parseApiResponse<MeResponse>(meRes)
        setViewerUserId(json?.user?.id ?? null)
      } else {
        setViewerUserId(null)
      }

      if (orgRes.ok) {
        const { json } = await parseApiResponse<OrganizationRoleResponse>(orgRes)
        setOwnerId(json?.org?.ownerId ?? null)
        setViewerRole(json?.org?.viewerRole ?? null)
      } else {
        setOwnerId(null)
        setViewerRole(null)
      }
    } catch {
      setViewerUserId(null)
      setOwnerId(null)
      setViewerRole(null)
    }
  }, [municipality, province, slug, token])

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/members`,
        ),
        { cache: 'no-store' },
      )

      if (!res.ok) {
        setError(res.status === 404 ? 'Organization not found.' : 'Unable to load members right now.')
        setItems([])
        return
      }

      const payload = (await res.json().catch(() => null)) as MembersResponse | null
      const members = Array.isArray(payload?.members) ? payload.members : []
      const followers = Array.isArray(payload?.followers) ? payload.followers : []

      const merged = [...members, ...followers]
      const uniqueByUserId = new Map<string, MemberRow>()
      merged.forEach((entry) => {
        if (!uniqueByUserId.has(entry.userId)) {
          uniqueByUserId.set(entry.userId, entry)
        }
      })

      setItems(Array.from(uniqueByUserId.values()))
    } catch (err) {
      console.error('Failed to load organization members', err)
      setError('Unable to load members right now.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [municipality, province, slug])

  const runMemberAction = useCallback(
    async ({
      userId,
      method,
      endpoint,
      body,
      successMessage,
    }: {
      userId: string
      method: 'POST' | 'DELETE'
      endpoint: string
      body?: Record<string, unknown>
      successMessage: string
    }) => {
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setActionBusyUserId(userId)
      try {
        const res = await fetch(buildApiUrl(endpoint), {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })

        const { json } = await parseApiResponse<{ error?: unknown }>(res)
        if (!res.ok) {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Member action failed.', 'error')
          return
        }

        pushToast(successMessage, 'success')
        await loadMembers()
      } catch {
        pushToast('Member action failed.', 'error')
      } finally {
        setActionBusyUserId(null)
      }
    },
    [loadMembers, token],
  )

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  useEffect(() => {
    void loadOrgRole()
  }, [loadOrgRole])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const order = { OWNER: 0, MANAGER: 1, FOLLOWER: 2 }
      const roleDelta = order[a.role] - order[b.role]
      if (roleDelta !== 0) return roleDelta
      const aName = (formatUserDisplayName(a.user.name, a.user.handle) || a.user.handle).toLowerCase()
      const bName = (formatUserDisplayName(b.user.name, b.user.handle) || b.user.handle).toLowerCase()
      return aName.localeCompare(bName)
    })
  }, [items])

  const isOwner = Boolean(viewerRole === 'OWNER' || (viewerUserId && ownerId && viewerUserId === ownerId))
  const canModerate = Boolean(isOwner || viewerRole === 'MANAGER')

  if (loading) {
    return <p className="text-sm text-slate-500">Loading members…</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  if (!sortedItems.length) {
    return <p className="text-sm text-slate-500">No members yet.</p>
  }

  return (
    <div className="grid gap-4">
      {sortedItems.map((entry) => {
        const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
        return (
        <Link
          key={entry.userId}
          href={`/u/${entry.user.handle}`}
          className="relative block overflow-hidden rounded-3xl border border-slate-200 bg-slate-800 p-5 shadow-sm transition hover:brightness-105"
        >
          {entry.user.coverUrl ? (
            <img src={entry.user.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          ) : null}
          <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />

          <div className="relative flex min-h-[96px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <VerifiedAvatar
                src={entry.user.avatarUrl}
                alt={displayName}
                initials={displayName}
                size={64}
              />
              <div className="min-w-0">
                <p className="truncate text-2xl font-semibold text-white">{displayName}</p>
                <p className="mt-1 truncate text-sm text-white/80">@{entry.user.handle}</p>
              </div>
            </div>
            <span className="rounded-full border border-white/40 bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              {roleLabel(entry.role)}
            </span>
          </div>

          {canModerate && entry.role !== 'OWNER' ? (
            <div className="relative mt-3 flex flex-wrap gap-2">
              {isOwner && entry.role === 'FOLLOWER' ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    void runMemberAction({
                      userId: entry.userId,
                      method: 'POST',
                      endpoint: `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/members/${encodeURIComponent(entry.userId)}/promote`,
                      successMessage: 'Promoted to manager.',
                    })
                  }}
                  disabled={actionBusyUserId === entry.userId}
                  className="rounded-full border border-white/40 bg-black/30 px-3 py-1 text-xs font-semibold text-white hover:bg-black/40 disabled:opacity-60"
                >
                  Promote
                </button>
              ) : null}

              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  void runMemberAction({
                    userId: entry.userId,
                    method: 'POST',
                    endpoint: `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/members/${encodeURIComponent(entry.userId)}/status`,
                    body: { status: 'ACTIVE', reason: 'Reactivated by admin' },
                    successMessage: 'Member activated.',
                  })
                }}
                disabled={actionBusyUserId === entry.userId}
                className="rounded-full border border-white/40 bg-black/30 px-3 py-1 text-xs font-semibold text-white hover:bg-black/40 disabled:opacity-60"
              >
                Activate
              </button>

              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  void runMemberAction({
                    userId: entry.userId,
                    method: 'POST',
                    endpoint: `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/members/${encodeURIComponent(entry.userId)}/status`,
                    body: { status: 'SUSPENDED', reason: 'Suspended by admin' },
                    successMessage: 'Member suspended.',
                  })
                }}
                disabled={actionBusyUserId === entry.userId}
                className="rounded-full border border-white/40 bg-black/30 px-3 py-1 text-xs font-semibold text-white hover:bg-black/40 disabled:opacity-60"
              >
                Suspend
              </button>

              {isOwner ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      void runMemberAction({
                        userId: entry.userId,
                        method: 'POST',
                        endpoint: `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/members/${encodeURIComponent(entry.userId)}/status`,
                        body: { status: 'BANNED', reason: 'Banned by owner' },
                        successMessage: 'Member banned.',
                      })
                    }}
                    disabled={actionBusyUserId === entry.userId}
                    className="rounded-full border border-rose-300 bg-rose-600/90 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
                  >
                    Ban
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      void runMemberAction({
                        userId: entry.userId,
                        method: 'DELETE',
                        endpoint: `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/members/${encodeURIComponent(entry.userId)}`,
                        successMessage: 'Member removed.',
                      })
                    }}
                    disabled={actionBusyUserId === entry.userId}
                    className="rounded-full border border-rose-300 bg-rose-600/90 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </Link>
        )
      })}
    </div>
  )
}
