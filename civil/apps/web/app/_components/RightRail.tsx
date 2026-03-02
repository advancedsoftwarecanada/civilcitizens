"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HiOutlineBell } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { formatUserDisplayName } from '../_lib/text'
import { pushToast } from './useToasts'
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

type RequestUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
  isPremium: boolean
  isVerified: boolean
}

type PendingFriendRequest = {
  id: string
  status: string
  direction: 'incoming' | 'outgoing'
  requestedAt: string
  respondedAt: string | null
  user: RequestUser
}

type FriendRequestsResponse = {
  incoming?: PendingFriendRequest[]
  outgoing?: PendingFriendRequest[]
}

type PendingConnectionRequest = {
  id: string
  status: string
  direction: 'incoming' | 'outgoing'
  requestedAt: string
  respondedAt: string | null
  user: RequestUser
}

type ConnectionRequestsResponse = {
  incoming?: PendingConnectionRequest[]
  outgoing?: PendingConnectionRequest[]
}

type EventSidebarRsvpItem = {
  id: string
  eventId: string
  title: string
  startsAt: string
  primaryPhotoUrl: string | null
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    isVerified: boolean
  }
}

type EventSidebarOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified: boolean
  logoUrl: string | null
  coverUrl: string | null
}

type EventsSidebarResponse = {
  rsvps?: EventSidebarRsvpItem[]
  manageableOrganizations?: EventSidebarOrganization[]
}

type Status = 'loading' | 'ready' | 'error' | 'unauthorized'

export function RightRail({
  mode = 'default',
  showOrganizations = false,
  showRsvps = false,
  sticky = true,
  hideContactsAndCommunities = false,
  hideContacts = false,
  hideCommunities = false,
  showPendingFriendRequests = false,
  showPendingConnectionRequests = false,
}: {
  mode?: 'default' | 'organizations' | 'organizationsDirectory' | 'network' | 'events' | 'community' | 'communitiesFeed'
  showOrganizations?: boolean
  showRsvps?: boolean
  sticky?: boolean
  hideContactsAndCommunities?: boolean
  hideContacts?: boolean
  hideCommunities?: boolean
  showPendingFriendRequests?: boolean
  showPendingConnectionRequests?: boolean
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<RightRailData | null>(null)
  const [organizations, setOrganizations] = useState<FollowedOrganization[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])
  const [memberOrganizations, setMemberOrganizations] = useState<MemberOrganization[]>([])
  const [connections, setConnections] = useState<ConnectionEntry[]>([])
  const [pendingFriendRequests, setPendingFriendRequests] = useState<PendingFriendRequest[]>([])
  const [pendingConnectionRequests, setPendingConnectionRequests] = useState<PendingConnectionRequest[]>([])
  const [pendingConnectionAction, setPendingConnectionAction] = useState<{ id: string; action: 'accept' | 'reject' } | null>(null)
  const [eventRsvps, setEventRsvps] = useState<EventSidebarRsvpItem[]>([])
  const [eventOrganizations, setEventOrganizations] = useState<EventSidebarOrganization[]>([])

  const hideSocialBlocks = hideContactsAndCommunities || mode === 'organizations' || mode === 'organizationsDirectory' || mode === 'network' || mode === 'events' || mode === 'community'
  const shouldLoadOrganizations = mode === 'organizations' || mode === 'organizationsDirectory' || mode === 'network' || mode === 'community' || mode === 'communitiesFeed' || showOrganizations
  const shouldLoadOwnedOrganizations = shouldLoadOrganizations
  const shouldLoadMemberOrganizations = shouldLoadOrganizations
  const shouldLoadConnections = mode === 'network'
  const shouldLoadPendingFriendRequests = showPendingFriendRequests
  const shouldLoadPendingConnectionRequests = mode === 'network' || showPendingConnectionRequests
  const shouldLoadEventsSidebar = mode === 'events' || mode === 'community' || mode === 'communitiesFeed' || showRsvps
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
      const requests: Array<{
        key: 'home' | 'follows' | 'owned' | 'memberships' | 'connections' | 'friendRequests' | 'connectionRequests' | 'eventsSidebar'
        promise: Promise<Response>
      }> = []

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

      if (shouldLoadPendingFriendRequests) {
        requests.push({
          key: 'friendRequests',
          promise: fetch(buildApiUrl('/friends/requests'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadPendingConnectionRequests) {
        requests.push({
          key: 'connectionRequests',
          promise: fetch(buildApiUrl('/connections/requests'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadEventsSidebar) {
        requests.push({
          key: 'eventsSidebar',
          promise: fetch(buildApiUrl('/events/sidebar'), {
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
      const friendRequestsRes = byKey.get('friendRequests')
      const connectionRequestsRes = byKey.get('connectionRequests')
      const eventsSidebarRes = byKey.get('eventsSidebar')

      if (
        homeRes?.status === 401 ||
        followsRes?.status === 401 ||
        ownedRes?.status === 401 ||
        membershipsRes?.status === 401 ||
        connectionsRes?.status === 401 ||
        friendRequestsRes?.status === 401 ||
        connectionRequestsRes?.status === 401 ||
        eventsSidebarRes?.status === 401
      ) {
        setStatus('unauthorized')
        return
      }

      const requiredHomeOk = shouldLoadHomeRail ? Boolean(homeRes?.ok) : true
      const requiredFollowsOk = shouldLoadOrganizations ? Boolean(followsRes?.ok) : true
      const requiredOwnedOk = shouldLoadOwnedOrganizations ? Boolean(ownedRes?.ok) : true
      const requiredMembershipsOk = shouldLoadMemberOrganizations ? Boolean(membershipsRes?.ok) : true
      const requiredConnectionsOk = shouldLoadConnections ? Boolean(connectionsRes?.ok) : true
      const requiredFriendRequestsOk = shouldLoadPendingFriendRequests ? Boolean(friendRequestsRes?.ok) : true
      const requiredConnectionRequestsOk = shouldLoadPendingConnectionRequests ? Boolean(connectionRequestsRes?.ok) : true
      const requiredEventsSidebarOk = shouldLoadEventsSidebar ? Boolean(eventsSidebarRes?.ok) : true

      if (!requiredHomeOk || !requiredFollowsOk || !requiredOwnedOk || !requiredMembershipsOk || !requiredConnectionsOk || !requiredFriendRequestsOk || !requiredConnectionRequestsOk || !requiredEventsSidebarOk) {
        setStatus('error')
        if (!shouldLoadHomeRail) setData(null)
        if (!shouldLoadOrganizations) setOrganizations([])
        if (!shouldLoadOwnedOrganizations) setOwnedOrganizations([])
        if (!shouldLoadMemberOrganizations) setMemberOrganizations([])
        if (!shouldLoadConnections) setConnections([])
        if (!shouldLoadPendingFriendRequests) setPendingFriendRequests([])
        if (!shouldLoadPendingConnectionRequests) setPendingConnectionRequests([])
        if (!shouldLoadEventsSidebar) {
          setEventRsvps([])
          setEventOrganizations([])
        }
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

      if (friendRequestsRes?.ok) {
        const payload = (await friendRequestsRes.json().catch(() => null)) as FriendRequestsResponse | null
        const incoming = Array.isArray(payload?.incoming) ? payload.incoming : []
        setPendingFriendRequests(incoming)
      } else {
        setPendingFriendRequests([])
      }

      if (connectionRequestsRes?.ok) {
        const payload = (await connectionRequestsRes.json().catch(() => null)) as ConnectionRequestsResponse | null
        const incoming = Array.isArray(payload?.incoming) ? payload.incoming : []
        setPendingConnectionRequests(incoming)
      } else {
        setPendingConnectionRequests([])
      }

      if (eventsSidebarRes?.ok) {
        const payload = (await eventsSidebarRes.json().catch(() => null)) as EventsSidebarResponse | null
        setEventRsvps(Array.isArray(payload?.rsvps) ? payload.rsvps : [])
        setEventOrganizations(Array.isArray(payload?.manageableOrganizations) ? payload.manageableOrganizations : [])
      } else {
        setEventRsvps([])
        setEventOrganizations([])
      }

      setStatus('ready')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [shouldLoadHomeRail, shouldLoadOrganizations, shouldLoadOwnedOrganizations, shouldLoadMemberOrganizations, shouldLoadConnections, shouldLoadPendingFriendRequests, shouldLoadPendingConnectionRequests, shouldLoadEventsSidebar])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handlePendingConnectionRequestAction = useCallback(async (request: PendingConnectionRequest, action: 'accept' | 'reject') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    setPendingConnectionAction({ id: request.id, action })
    try {
      const response = await fetch(buildApiUrl(`/connections/requests/${request.id}/${action}`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; connection?: { id?: string; since?: string | null } } | null
      if (!response.ok) {
        pushToast(payload?.error ?? `Unable to ${action === 'accept' ? 'accept' : 'dismiss'} connection request.`, 'error')
        return
      }

      setPendingConnectionRequests((prev) => prev.filter((item) => item.id !== request.id))
      if (action === 'accept') {
        const since = payload?.connection?.since ?? new Date().toISOString()
        const id = payload?.connection?.id ?? request.id
        setConnections((prev) => {
          if (prev.some((entry) => entry.user.id === request.user.id)) return prev
          return [{ id, status: 'ACCEPTED', since, user: request.user }, ...prev]
        })
        pushToast('Connection request accepted.', 'success')
      } else {
        pushToast('Connection request dismissed.', 'info')
      }
    } catch {
      pushToast(`Unable to ${action === 'accept' ? 'accept' : 'dismiss'} connection request.`, 'error')
    } finally {
      setPendingConnectionAction(null)
    }
  }, [])

  if (status === 'loading') {
    return (
      <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
        <div className="surface-card h-48 animate-pulse p-5" />
        <div className="surface-card h-48 animate-pulse p-5" />
      </div>
    )
  }

  if (status === 'unauthorized') return null

  if (mode === 'communitiesFeed') {
    return (
      <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
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
                    {comm.newPosts > 0 ? (
                      <Link
                        href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                        className="flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white"
                      >
                        <HiOutlineBell className="h-4 w-4" />
                        ({comm.newPosts})
                      </Link>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No communities followed.</p>
          )}
        </Block>

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
                    <span className="max-w-[160px] truncate text-sm font-semibold text-white">{org.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No organizations yet.</p>
          )}
        </Block>

        {eventRsvps.length ? (
          <Block title="Your RSVPs" action={{ label: 'View all', href: '/events?mine=going' }}>
            <ul className="space-y-3">
              {eventRsvps.map((entry) => {
                const href =
                  entry.organization.provinceCode && entry.organization.communitySlug
                    ? `/com/${entry.organization.provinceCode.toLowerCase()}/${entry.organization.communitySlug.toLowerCase()}/orgs/${entry.organization.slug}/events/${entry.eventId}`
                    : '/events'

                return (
                  <li key={entry.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                    {entry.primaryPhotoUrl ? <img src={entry.primaryPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                    <Link href={href} className="group relative block px-3 py-2">
                      <p className="line-clamp-1 text-sm font-semibold text-white">{entry.title}</p>
                      <p className="mt-0.5 text-xs text-white/85">{new Date(entry.startsAt).toLocaleString()}</p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Block>
        ) : null}
      </div>
    )
  }

  return (
    <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
      {showPendingFriendRequests && pendingFriendRequests.length ? (
        <Block title="Pending Friend Requests" action={{ label: 'View all', href: '/friends' }}>
          <ul className="space-y-3">
            {pendingFriendRequests.slice(0, 5).map((request) => {
              const displayName = formatUserDisplayName(request.user.name, request.user.handle) || request.user.handle
              return (
                <li key={request.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                  {request.user.coverUrl ? (
                    <img src={request.user.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  ) : null}
                  <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                  <Link href={`/u/${request.user.handle}`} className="group relative flex items-center gap-2.5 px-3 py-2">
                    <VerifiedAvatar
                      src={request.user.avatarUrl}
                      alt={displayName}
                      initials={displayName}
                      size={32}
                      isVerified={request.user.isVerified}
                      isBusiness={request.user.isPremium}
                    />
                    <span className="max-w-[160px] truncate text-sm font-semibold text-white">{displayName}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Block>
      ) : null}

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
          {pendingConnectionRequests.length ? (
            <Block title="Pending Connect Requests" action={{ label: 'View all', href: '/network/professionals/requests' }}>
              <ul className="space-y-3">
                {pendingConnectionRequests.slice(0, 5).map((request) => {
                  const displayName = formatUserDisplayName(request.user.name, request.user.handle) || request.user.handle
                  const isAccepting = pendingConnectionAction?.id === request.id && pendingConnectionAction.action === 'accept'
                  const isRejecting = pendingConnectionAction?.id === request.id && pendingConnectionAction.action === 'reject'
                  const isActing = pendingConnectionAction?.id === request.id
                  return (
                    <li key={request.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                      {request.user.coverUrl ? (
                        <img src={request.user.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      ) : null}
                      <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                      <div className="relative px-3 py-2">
                        <Link href={`/u/${request.user.handle}`} className="group flex items-center gap-2.5">
                          <VerifiedAvatar
                            src={request.user.avatarUrl}
                            alt={displayName}
                            initials={displayName}
                            size={32}
                            isVerified={request.user.isVerified}
                            isBusiness={request.user.isPremium}
                          />
                          <span className="max-w-[160px] truncate text-sm font-semibold text-white">{displayName}</span>
                        </Link>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            className="inline-flex flex-1 items-center justify-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => void handlePendingConnectionRequestAction(request, 'accept')}
                            disabled={isActing}
                          >
                            {isAccepting ? 'Accepting…' : 'Accept'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex flex-1 items-center justify-center rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => void handlePendingConnectionRequestAction(request, 'reject')}
                            disabled={isActing}
                          >
                            {isRejecting ? 'Declining…' : 'Decline'}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Block>
          ) : null}

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

      {mode === 'community' ? (
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

          <Block title="Events" action={{ label: 'View all', href: '/events?mine=going' }}>
            {eventRsvps.length ? (
              <ul className="space-y-3">
                {eventRsvps.map((entry) => {
                  const href =
                    entry.organization.provinceCode && entry.organization.communitySlug
                      ? `/com/${entry.organization.provinceCode.toLowerCase()}/${entry.organization.communitySlug.toLowerCase()}/orgs/${entry.organization.slug}/events/${entry.eventId}`
                      : '/events'

                  return (
                    <li key={entry.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                      {entry.primaryPhotoUrl ? <img src={entry.primaryPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                      <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                      <Link href={href} className="group relative block px-3 py-2">
                        <p className="line-clamp-1 text-sm font-semibold text-white">{entry.title}</p>
                        <p className="mt-0.5 text-xs text-white/85">{new Date(entry.startsAt).toLocaleString()}</p>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No upcoming events yet.</p>
            )}
          </Block>
        </>
      ) : null}

      {mode === 'events' ? (
        <>
          {eventRsvps.length ? (
            <Block title="Your RSVPs" action={{ label: 'View all', href: '/events?mine=going' }}>
              <ul className="space-y-3">
                {eventRsvps.map((entry) => {
                  const href =
                    entry.organization.provinceCode && entry.organization.communitySlug
                      ? `/com/${entry.organization.provinceCode.toLowerCase()}/${entry.organization.communitySlug.toLowerCase()}/orgs/${entry.organization.slug}/events/${entry.eventId}`
                      : '/events'

                  return (
                    <li key={entry.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                      {entry.primaryPhotoUrl ? <img src={entry.primaryPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                      <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                      <Link href={href} className="group relative block px-3 py-2">
                        <p className="line-clamp-1 text-sm font-semibold text-white">{entry.title}</p>
                        <p className="mt-0.5 text-xs text-white/85">{new Date(entry.startsAt).toLocaleString()}</p>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Block>
          ) : null}

          {eventOrganizations.length ? (
            <Block title="Events from your organization" action={{ label: 'View all', href: '/organizations/manager' }}>
              <ul className="space-y-3">
                {eventOrganizations.map((org) => {
                  const href =
                    org.provinceCode && org.communitySlug
                      ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}/events/manage`
                      : '/organizations/manager'

                  return (
                    <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                      {org.coverUrl ? <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                      <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                      <Link href={href} className="group relative flex items-center gap-2.5 px-3 py-2">
                        <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} isVerified={Boolean(org.isVerified)} />
                        <span className="max-w-[160px] truncate text-sm font-semibold text-white">{org.name}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Block>
          ) : null}
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

      {mode !== 'events' && showRsvps && eventRsvps.length ? (
        <Block title="Your RSVPs" action={{ label: 'View all', href: '/events?mine=going' }}>
          <ul className="space-y-3">
            {eventRsvps.map((entry) => {
              const href =
                entry.organization.provinceCode && entry.organization.communitySlug
                  ? `/com/${entry.organization.provinceCode.toLowerCase()}/${entry.organization.communitySlug.toLowerCase()}/orgs/${entry.organization.slug}/events/${entry.eventId}`
                  : '/events'

              return (
                <li key={entry.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                  {entry.primaryPhotoUrl ? <img src={entry.primaryPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                  <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                  <Link href={href} className="group relative block px-3 py-2">
                    <p className="line-clamp-1 text-sm font-semibold text-white">{entry.title}</p>
                    <p className="mt-0.5 text-xs text-white/85">{new Date(entry.startsAt).toLocaleString()}</p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Block>
      ) : null}
    </div>
  )
}
