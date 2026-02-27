"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HiOutlineBell } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { formatUserDisplayName } from '../_lib/text'
import VerifiedAvatar from './VerifiedAvatar'
import Block from './Block'

type RightRailData = {
  userHandle?: string
  totalFriends?: number
  friends: Array<{
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
    newPosts: number
  }>
  communities: Array<{
    provinceCode: string
    communitySlug: string
    name: string
    newPosts: number
  }>
}

type FollowedOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  isVerified?: boolean
  logoUrl?: string | null
  coverUrl?: string | null
}

type OwnedOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified?: boolean
  status?: string
  logoUrl?: string | null
  coverUrl?: string | null
}

type MemberOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified?: boolean
  logoUrl?: string | null
  coverUrl?: string | null
  role?: string
}

type OrganizationsFollowsResponse = {
  items?: FollowedOrganization[]
}

type OrganizationsOwnedResponse = {
  items?: OwnedOrganization[]
}

type OrganizationsMembershipsResponse = {
  items?: MemberOrganization[]
}

type ConnectionEntry = {
  id: string
  status: string
  since: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
    isPremium: boolean
    isVerified: boolean
  }
}

type ConnectionsResponse = {
  items?: ConnectionEntry[]
}

type Status = 'loading' | 'ready' | 'error' | 'unauthorized'

export function RightRail({
  mode = 'default',
  showOrganizations = false,
  sticky = true,
  hideContactsAndCommunities = false,
  hideContacts = false,
  hideCommunities = false,
}: {
  mode?: 'default' | 'organizations' | 'organizationsDirectory' | 'network'
  showOrganizations?: boolean
  sticky?: boolean
  hideContactsAndCommunities?: boolean
  hideContacts?: boolean
  hideCommunities?: boolean
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<RightRailData | null>(null)
  const [organizations, setOrganizations] = useState<FollowedOrganization[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])
  const [memberOrganizations, setMemberOrganizations] = useState<MemberOrganization[]>([])
  const [connections, setConnections] = useState<ConnectionEntry[]>([])

  const hideSocialBlocks = hideContactsAndCommunities || mode === 'organizations' || mode === 'organizationsDirectory' || mode === 'network'
  const shouldLoadOrganizations = mode === 'organizations' || mode === 'organizationsDirectory' || mode === 'network' || showOrganizations
  const shouldLoadOwnedOrganizations = shouldLoadOrganizations
  const shouldLoadMemberOrganizations = shouldLoadOrganizations
  const shouldLoadConnections = mode === 'network'
  const shouldLoadHomeRail = !hideSocialBlocks

  const subscribedOrganizations = useMemo(
    () => organizations.filter((org) => Boolean(org.provinceCode) && Boolean(org.communitySlug)),
    [organizations],
  )

  const partOfOrganizations = useMemo(() => {
    const owned = ownedOrganizations.filter((org) => Boolean(org.provinceCode) && Boolean(org.communitySlug))
    const ownedIds = new Set(owned.map((org) => org.id))

    const memberships = memberOrganizations
      .filter((org) => Boolean(org.provinceCode) && Boolean(org.communitySlug))
      .filter((org) => !ownedIds.has(org.id))

    return [...owned, ...memberships]
  }, [ownedOrganizations, memberOrganizations])

  const combinedOrganizations = useMemo(() => {
    const owned = ownedOrganizations.flatMap((org) => {
      if (!org.provinceCode || !org.communitySlug) return []
      return [
        {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          isVerified: org.isVerified,
          logoUrl: org.logoUrl,
          coverUrl: org.coverUrl,
        },
      ]
    })

    const memberships = memberOrganizations.flatMap((org) => {
      if (!org.provinceCode || !org.communitySlug) return []
      return [
        {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          isVerified: org.isVerified,
          logoUrl: org.logoUrl,
          coverUrl: org.coverUrl,
        },
      ]
    })

    const ownedIds = new Set(owned.map((org) => org.id))
    const membershipIds = new Set(memberships.map((org) => org.id))
    const partOfIds = new Set([...ownedIds, ...membershipIds])
    const dedupedMemberships = memberships.filter((org) => !ownedIds.has(org.id))

    const followed = subscribedOrganizations.filter((org) => !partOfIds.has(org.id))
    return [...owned, ...dedupedMemberships, ...followed]
  }, [ownedOrganizations, memberOrganizations, subscribedOrganizations])

  const loadData = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setStatus('unauthorized')
      return
    }
    try {
      const requests: Array<{ key: 'home' | 'follows' | 'owned' | 'memberships' | 'connections'; promise: Promise<Response> }> = []

      if (shouldLoadHomeRail) {
        requests.push({
          key: 'home',
          promise: fetch(buildApiUrl('/home/right-rail'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadOrganizations) {
        requests.push({
          key: 'follows',
          promise: fetch(buildApiUrl('/organizations/follows'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadOwnedOrganizations) {
        requests.push({
          key: 'owned',
          promise: fetch(buildApiUrl('/organizations/owned'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadMemberOrganizations) {
        requests.push({
          key: 'memberships',
          promise: fetch(buildApiUrl('/organizations/memberships'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadConnections) {
        requests.push({
          key: 'connections',
          promise: fetch(buildApiUrl('/connections'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      const results = await Promise.all(requests.map((entry) => entry.promise))
      const byKey = new Map(requests.map((entry, index) => [entry.key, results[index] as Response]))

      const homeRes = byKey.get('home')
      const followsRes = byKey.get('follows')
      const ownedRes = byKey.get('owned')
      const membershipsRes = byKey.get('memberships')
      const connectionsRes = byKey.get('connections')

      if (
        homeRes?.status === 401 ||
        followsRes?.status === 401 ||
        ownedRes?.status === 401 ||
        membershipsRes?.status === 401 ||
        connectionsRes?.status === 401
      ) {
        setStatus('unauthorized')
        return
      }

      const requiredHomeOk = shouldLoadHomeRail ? Boolean(homeRes?.ok) : true
      const requiredFollowsOk = shouldLoadOrganizations ? Boolean(followsRes?.ok) : true
      const requiredOwnedOk = shouldLoadOwnedOrganizations ? Boolean(ownedRes?.ok) : true
      const requiredMembershipsOk = shouldLoadMemberOrganizations ? Boolean(membershipsRes?.ok) : true
      const requiredConnectionsOk = shouldLoadConnections ? Boolean(connectionsRes?.ok) : true

      if (!requiredHomeOk || !requiredFollowsOk || !requiredOwnedOk || !requiredMembershipsOk || !requiredConnectionsOk) {
        setStatus('error')
        if (!shouldLoadHomeRail) setData(null)
        if (!shouldLoadOrganizations) setOrganizations([])
        if (!shouldLoadOwnedOrganizations) setOwnedOrganizations([])
        if (!shouldLoadMemberOrganizations) setMemberOrganizations([])
        if (!shouldLoadConnections) setConnections([])
        return
      }

      if (homeRes?.ok) {
        const homeJson = (await homeRes.json()) as RightRailData
        setData(homeJson)
      } else {
        setData(null)
      }

      if (followsRes?.ok) {
        const payload = (await followsRes.json().catch(() => null)) as OrganizationsFollowsResponse | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setOrganizations(items)
      } else {
        setOrganizations([])
      }

      if (ownedRes?.ok) {
        const payload = (await ownedRes.json().catch(() => null)) as OrganizationsOwnedResponse | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setOwnedOrganizations(items)
      } else {
        setOwnedOrganizations([])
      }

      if (membershipsRes?.ok) {
        const payload = (await membershipsRes.json().catch(() => null)) as OrganizationsMembershipsResponse | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setMemberOrganizations(items)
      } else {
        setMemberOrganizations([])
      }

      if (connectionsRes?.ok) {
        const payload = (await connectionsRes.json().catch(() => null)) as ConnectionsResponse | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setConnections(items)
      } else {
        setConnections([])
      }

      setStatus('ready')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [shouldLoadHomeRail, shouldLoadOrganizations, shouldLoadOwnedOrganizations, shouldLoadMemberOrganizations, shouldLoadConnections])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (status === 'loading') {
    return (
      <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
        <div className="surface-card h-48 animate-pulse p-5" />
        <div className="surface-card h-48 animate-pulse p-5" />
      </div>
    )
  }

  if (status === 'unauthorized') return null

  return (
    <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
      {mode === 'organizationsDirectory' ? (
        <>
          <Block
            title="Organizations You're Subscribed to"
            action={{ label: 'Show all', href: '/organizations/manager' }}
            actionVariant="pill"
          >
            {subscribedOrganizations.length ? (
              <ul className="space-y-3">
                {subscribedOrganizations.slice(0, 10).map((org) => (
                  <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                    {org.coverUrl ? (
                      <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    ) : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                    <Link
                      href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                      className="group relative flex items-center gap-2.5 px-3 py-2"
                    >
                      <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} isVerified={Boolean(org.isVerified)} />
                      <span className="max-w-[160px] truncate text-sm font-semibold text-white">
                        {org.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No organizations subscribed.</p>
            )}
          </Block>

          <Block title="Organizations You're a part of" action={{ label: 'Manage', href: '/organizations/manager' }} actionVariant="pill">
            {partOfOrganizations.length ? (
              <ul className="space-y-3">
                {partOfOrganizations.slice(0, 10).map((org) => (
                  <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                    {org.coverUrl ? (
                      <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    ) : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                    <Link
                      href={`/com/${String(org.provinceCode).toLowerCase()}/${String(org.communitySlug).toLowerCase()}/orgs/${org.slug}`}
                      className="group relative flex items-center gap-2.5 px-3 py-2"
                    >
                      <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} isVerified={Boolean(org.isVerified)} />
                      <span className="max-w-[160px] truncate text-sm font-semibold text-white">
                        {org.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No organizations managed.</p>
            )}
          </Block>
        </>
      ) : null}

      {mode === 'organizations' ? (
        <Block
          title="Your Organizations"
          action={{ label: 'View all', href: '/organizations/directory' }}
          actionVariant="link"
        >
          {combinedOrganizations.length ? (
            <ul className="space-y-3">
              {combinedOrganizations.slice(0, 10).map((org) => (
                <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                  {org.coverUrl ? (
                    <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  ) : null}
                  <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                  <Link
                    href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                    className="group relative flex items-center gap-2.5 px-3 py-2"
                  >
                    <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} isVerified={Boolean(org.isVerified)} />
                    <span className="max-w-[160px] truncate text-sm font-semibold text-white">
                      {org.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No organizations yet.</p>
          )}
        </Block>
      ) : null}

      {mode === 'network' ? (
        <>
          <Block title="Organizations" action={{ label: 'See all', href: '/organizations/directory' }}>
            {combinedOrganizations.length ? (
              <ul className="space-y-3">
                {combinedOrganizations.slice(0, 8).map((org) => (
                  <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                    {org.coverUrl ? (
                      <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    ) : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                    <Link
                      href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                      className="group relative flex items-center gap-2.5 px-3 py-2"
                    >
                      <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} isVerified={Boolean(org.isVerified)} />
                      <span className="max-w-[160px] truncate text-sm font-semibold text-white">{org.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No organizations yet.</p>
            )}
          </Block>

          <Block title="Professionals" action={{ label: 'See all', href: '/network/professionals' }}>
            {connections.length ? (
              <ul className="space-y-3">
                {connections.slice(0, 8).map((connection) => {
                  const displayName = formatUserDisplayName(connection.user.name, connection.user.handle) || connection.user.handle
                  return (
                    <li key={connection.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                      {connection.user.coverUrl ? (
                        <img src={connection.user.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      ) : null}
                      <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                      <Link href={`/u/${connection.user.handle}`} className="group relative flex items-center gap-2.5 px-3 py-2">
                        <VerifiedAvatar
                          src={connection.user.avatarUrl}
                          alt={displayName}
                          initials={displayName}
                          size={32}
                          isVerified={connection.user.isVerified}
                          isBusiness={connection.user.isPremium}
                        />
                        <span className="max-w-[160px] truncate text-sm font-semibold text-white">{displayName}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No professional connections yet.</p>
            )}
          </Block>
        </>
      ) : null}

      {/* Friends Section */}
      {!hideSocialBlocks && !hideContacts ? (
      <Block
        title="Your Friends"
        action={
          data?.userHandle && (data.totalFriends ?? 0) > 0
            ? { label: `View all (${data.totalFriends})`, href: `/u/${data.userHandle}/friends` }
            : undefined
        }
      >
        {data?.friends.length ? (
          <ul className="space-y-3">
            {data.friends.map((friend) => {
              const displayName = formatUserDisplayName(friend.name, friend.handle) || friend.handle
              return (
              <li key={friend.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                {friend.coverUrl ? (
                  <img
                    src={friend.coverUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
                <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                <div className="relative flex items-center justify-between px-3 py-2">
                  <Link href={`/u/${friend.handle}`} className="group flex min-w-0 items-center gap-2.5">
                    <VerifiedAvatar
                      src={friend.avatarUrl}
                      alt={displayName}
                      initials={displayName}
                      size={32}
                    />
                    <span className="max-w-[130px] truncate text-sm font-semibold text-white">
                      {displayName}
                    </span>
                  </Link>
                  {friend.newPosts > 0 && (
                    <Link href={`/u/${friend.handle}`} className="ml-2 flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white">
                      <HiOutlineBell className="h-4 w-4" />
                      ({friend.newPosts})
                    </Link>
                  )}
                </div>
              </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No friends yet.</p>
        )}
      </Block>
      ) : null}

      {mode === 'default' && showOrganizations ? (
        <Block title="Your Organizations" action={{ label: 'View all', href: '/organizations/directory' }}>
          {combinedOrganizations.length ? (
            <ul className="space-y-3">
              {combinedOrganizations.slice(0, 8).map((org) => (
                <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                  {org.coverUrl ? (
                    <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  ) : null}
                  <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                  <Link
                    href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                    className="group relative flex items-center gap-2.5 px-3 py-2"
                  >
                    <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} isVerified={Boolean(org.isVerified)} />
                    <span className="max-w-[160px] truncate text-sm font-semibold text-white">
                      {org.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No organizations yet.</p>
          )}
        </Block>
      ) : null}

      {/* Communities Section */}
      {!hideSocialBlocks && !hideCommunities ? (
        <Block title="Your Communities" action={{ label: 'View all', href: '/communities/settings' }}>
          {data?.communities.length ? (
            <ul className="space-y-3">
              {data.communities.map((comm) => {
                const formattedName = comm.name
                  .split('-')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ')

                return (
                  <li key={`${comm.provinceCode}:${comm.communitySlug}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-900 px-3 py-2">
                    <Link
                      href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                      className="max-w-[160px] truncate text-sm font-semibold text-white hover:text-white"
                    >
                      {formattedName}
                    </Link>
                    {comm.newPosts > 0 && (
                      <Link
                        href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                        className="flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white"
                      >
                        <HiOutlineBell className="h-4 w-4" />
                        ({comm.newPosts})
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No communities followed.</p>
          )}
        </Block>
      ) : null}
    </div>
  )
}
