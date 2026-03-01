'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import Modal from '../../_components/Modal'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import { formatUserDisplayName } from '../../_lib/text'

type OrgRank = {
  id: string
  name: string
  description?: string | null
  permissions: string[]
  visibility: string
  system?: boolean
}

type GovernanceMemberState = {
  status?: string | null
  rankId?: string | null
  planId?: string | null
}

type GovernanceMemberItem = {
  userId: string
  user: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  membershipRole?: string | null
  memberState?: GovernanceMemberState | null
}

type GovernanceMembersResponse = {
  org: {
    id: string
    handle: string
    name?: string | null
  }
  ranks: OrgRank[]
  items: GovernanceMemberItem[]
  viewer: {
    permissions: string[]
  }
}

type ModerationAction = 'kick' | 'ban'

export default function OrganizationMembersAdminClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<GovernanceMembersResponse | null>(null)

  const [rolesUserId, setRolesUserId] = useState<string | null>(null)
  const [rolesRankId, setRolesRankId] = useState<string>('')
  const [savingRoles, setSavingRoles] = useState(false)

  const [moderationOpen, setModerationOpen] = useState(false)
  const [moderationAction, setModerationAction] = useState<ModerationAction>('kick')
  const [moderationUserId, setModerationUserId] = useState<string | null>(null)
  const [moderationReason, setModerationReason] = useState('')
  const [moderating, setModerating] = useState(false)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

  const viewerPermissions = data?.viewer?.permissions ?? []
  const canRemoveMembers = viewerPermissions.includes('remove_members')
  const canChangeRanks =
    viewerPermissions.includes('promote_members') ||
    viewerPermissions.includes('demote_members') ||
    viewerPermissions.includes('create_ranks')

  const rankById = useMemo(() => {
    const map = new Map<string, OrgRank>()
    for (const rank of data?.ranks ?? []) {
      map.set(rank.id, rank)
    }
    return map
  }, [data?.ranks])

  const roleOptions = useMemo(() => {
    const ranks = [...(data?.ranks ?? [])]
    ranks.sort((a, b) => {
      const aSystem = Boolean(a.system)
      const bSystem = Boolean(b.system)
      if (aSystem !== bSystem) return aSystem ? -1 : 1
      const aAdmins = String(a.name || '').toLowerCase() === 'admins'
      const bAdmins = String(b.name || '').toLowerCase() === 'admins'
      if (aAdmins !== bAdmins) return aAdmins ? -1 : 1
      return String(a.name || '').localeCompare(String(b.name || ''))
    })

    return ranks.filter((rank) => String(rank.id) !== 'system_owner')
  }, [data?.ranks])

  const load = useCallback(async () => {
    if (!token) {
      setData(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/members`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `Failed to load members (${res.status})`)
      }

      const json = (await res.json()) as GovernanceMembersResponse
      setData(json)
    } catch (err: any) {
      pushToast(err?.message ?? 'Failed to load members', 'error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [orgApiPath, token])

  useEffect(() => {
    void load()
  }, [load])

  const openModeration = (action: ModerationAction, userId: string) => {
    setModerationAction(action)
    setModerationUserId(userId)
    setModerationReason('')
    setModerationOpen(true)
  }

  const submitModeration = async () => {
    if (!token || !moderationUserId) return

    setModerating(true)
    try {
      const endpoint =
        moderationAction === 'ban'
          ? `${orgApiPath}/governance/members/${moderationUserId}/ban`
          : `${orgApiPath}/governance/members/${moderationUserId}/kick`

      const res = await fetch(buildApiUrl(endpoint), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: moderationReason || null }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `Action failed (${res.status})`)
      }

      pushToast(moderationAction === 'ban' ? 'Member banned' : 'Member kicked', 'success')
      setModerationOpen(false)
      await load()
    } catch (err: any) {
      pushToast(err?.message ?? 'Action failed', 'error')
    } finally {
      setModerating(false)
    }
  }

  const startRoles = (userId: string, currentRankId: string | null | undefined) => {
    setRolesUserId(userId)
    setRolesRankId(currentRankId || 'system_member')
  }

  const cancelRoles = () => {
    setRolesUserId(null)
    setRolesRankId('')
  }

  const submitRoles = async () => {
    if (!token || !rolesUserId || !rolesRankId) return

    const target = data?.items?.find((item) => item.userId === rolesUserId)
    const currentStatus = target?.memberState?.status || 'ACTIVE'

    setSavingRoles(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/members/${rolesUserId}/status`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: currentStatus, rankId: rolesRankId }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `Failed to update roles (${res.status})`)
      }

      pushToast('Roles updated', 'success')
      cancelRoles()
      await load()
    } catch (err: any) {
      pushToast(err?.message ?? 'Failed to update roles', 'error')
    } finally {
      setSavingRoles(false)
    }
  }

  const title = data?.org?.name ? `${data.org.name} · Members` : 'Members'

  if (!token) {
    return (
      <section className="surface-card p-6 shadow-subtle">
        <h2 className="text-lg font-semibold text-slate-900">Members</h2>
        <p className="mt-1 text-sm text-slate-600">Sign in to manage members.</p>
      </section>
    )
  }

  return (
    <section className="surface-card space-y-4 p-6 shadow-subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">Kick, ban, and assign roles.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : !data ? (
        <p className="text-sm text-slate-600">Unable to load members.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <div className="col-span-5">Person</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Role</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <div className="divide-y divide-slate-100">
            {data.items.map((item) => {
              const status = item.memberState?.status || (item.membershipRole === 'FOLLOWER' ? 'FOLLOWING' : 'ACTIVE')
              const rankId = item.memberState?.rankId || 'system_member'
              const rankName = rankById.get(rankId)?.name ?? 'Member'
              const isOwner = item.membershipRole === 'OWNER'
              const displayName = formatUserDisplayName(item.user?.name, item.user?.handle) || item.user?.handle || item.userId
              const profileHref = item.user?.handle ? `/u/${encodeURIComponent(item.user.handle)}` : '#'

              return (
                <div key={item.userId} className="grid grid-cols-12 items-center gap-2 px-4 py-3">
                  <div className="col-span-5 min-w-0">
                    <Link
                      href={profileHref}
                      className="group relative flex min-h-[56px] items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-700 px-2.5 py-2"
                    >
                      {item.user?.coverUrl ? (
                        <img
                          src={item.user.coverUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : null}
                      <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                      <div className="relative flex min-w-0 items-center gap-2.5">
                        <VerifiedAvatar
                          src={item.user?.avatarUrl ?? null}
                          alt={displayName}
                          initials={displayName}
                          size={32}
                          isVerified={Boolean(item.user?.isVerified)}
                          isBusiness={Boolean(item.user?.isPremium)}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                          <p className="truncate text-xs text-white/85">
                            {item.user?.handle ? `@${item.user.handle}` : item.userId} · {item.membershipRole || 'MEMBER'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="col-span-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                      {status}
                    </span>
                  </div>

                  <div className="col-span-3">
                    {rolesUserId === item.userId ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={rolesRankId}
                          onChange={(event) => setRolesRankId(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
                        >
                          {roleOptions.map((rank) => (
                            <option key={rank.id} value={rank.id}>
                              {rank.name}{rank.system ? ' (system)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="truncate text-sm text-slate-800">{rankName}</p>
                    )}
                  </div>

                  <div className="col-span-2 flex justify-end gap-2">
                    {rolesUserId === item.userId ? (
                      <>
                        <button
                          type="button"
                          disabled={savingRoles}
                          onClick={() => void submitRoles()}
                          className="rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={savingRoles}
                          onClick={cancelRoles}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={!canChangeRanks || isOwner}
                          onClick={() => startRoles(item.userId, item.memberState?.rankId)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                        >
                          Roles
                        </button>
                        <button
                          type="button"
                          disabled={!canRemoveMembers || isOwner}
                          onClick={() => openModeration('kick', item.userId)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                        >
                          Kick
                        </button>
                        <button
                          type="button"
                          disabled={!canRemoveMembers || isOwner}
                          onClick={() => openModeration('ban', item.userId)}
                          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-40"
                        >
                          Ban
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal
        open={moderationOpen}
        onClose={() => (moderating ? null : setModerationOpen(false))}
        title={moderationAction === 'ban' ? 'Ban member' : 'Kick member'}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Optional reason (will be included in the audit log and sent to the user).</p>
          <textarea
            value={moderationReason}
            onChange={(event) => setModerationReason(event.target.value)}
            className="h-28 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Reason (optional)"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={moderating}
              onClick={() => setModerationOpen(false)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={moderating}
              onClick={() => void submitModeration()}
              className={
                moderationAction === 'ban'
                  ? 'rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50'
                  : 'rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50'
              }
            >
              {moderationAction === 'ban' ? 'Ban' : 'Kick'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
