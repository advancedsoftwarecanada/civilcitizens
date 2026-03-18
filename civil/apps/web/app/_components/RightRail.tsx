"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HiOutlineBell } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { hasFamilyProfilesAvailable } from '../_lib/me'
import { formatUserDisplayName } from '../_lib/text'
import { useViewerStore } from '../_lib/viewerStore'
import { pushToast } from './useToasts'
import VerifiedAvatar from './VerifiedAvatar'
import Block from './Block'
import CivilCard from './CivilCard'
import FamilyRailBlock, { type SharedFamilyRailEntry } from './FamilyRailBlock'

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

type CommunityFollowEntry = {
  province: string
  communitySlug: string
  home?: boolean
  community?: {
    name?: string | null
    cityName?: string | null
    province: string
    slug: string
  } | null
}

type CommunityFollowsResponse = {
  items?: CommunityFollowEntry[]
}

type CommunityOrganizationRailItem = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified?: boolean
  logoUrl?: string | null
  coverUrl?: string | null
}

type CommunityOrganizationsRailResponse = {
  items?: CommunityOrganizationRailItem[]
}

type CommunityOrganizationsRailGroup = {
  key: string
  title: string
  isHome: boolean
  href: string
  communityHref: string
  items: CommunityOrganizationRailItem[]
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

type WorkApplicationRailItem = {
  id: string
  status: string
  createdAt: string
  job: {
    id: string
    title: string
    photoUrl: string | null
    status: string
    expiresAt: string
    organization: {
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      logoUrl: string | null
      coverUrl: string | null
    }
  }
}

type WorkApplicationsRailResponse = {
  items?: WorkApplicationRailItem[]
}

type FamilyMemberRailItem = {
  id: string
  displayName: string
  modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
  relationshipLabel: string
  avatarUrl?: string | null
  latestPostAt?: string | null
  suspended: boolean
}

type ProfileFamilyRelationshipRailItem = {
  id: string
  handle: string
  displayName: string
  relationshipLabel: string
  avatarUrl?: string | null
  coverUrl?: string | null
  latestPostAt?: string | null
}

type FamilyRailResponse = {
  members?: FamilyMemberRailItem[]
  profileRelationships?: ProfileFamilyRelationshipRailItem[]
}

type PublicFamilyRailEntry = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  relationshipLabel: string
}

type PublicFamilyRailResponse = {
  immediateFamily?: PublicFamilyRailEntry[]
  extendedFamily?: PublicFamilyRailEntry[]
}

type FamilyRailEntry = SharedFamilyRailEntry

type Status = 'loading' | 'ready' | 'error' | 'unauthorized'

function formatCommunityRailLabel(value: string | null | undefined) {
  if (!value) return 'Community'
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function shuffleItems<T>(items: T[]) {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = next[index]
    next[index] = next[swapIndex] as T
    next[swapIndex] = current as T
  }
  return next
}

export function RightRail({
  mode = 'default',
  showOrganizations = false,
  showRsvps = false,
  organizationLinkTarget = 'org',
  organizationBlockVariant = 'combined',
  hideContactsAndCommunities = false,
  hideContacts = false,
  hideCommunities = false,
  hideFamilyBlock = false,
  showPendingFriendRequests = false,
  showPendingConnectionRequests = false,
}: {
  mode?: 'default' | 'organizations' | 'organizationsDirectory' | 'network' | 'events' | 'community' | 'communitiesFeed' | 'work'
  showOrganizations?: boolean
  showRsvps?: boolean
  organizationLinkTarget?: 'org' | 'chat'
  organizationBlockVariant?: 'combined' | 'followed'
  hideContactsAndCommunities?: boolean
  hideContacts?: boolean
  hideCommunities?: boolean
  hideFamilyBlock?: boolean
  showPendingFriendRequests?: boolean
  showPendingConnectionRequests?: boolean
}) {
  const viewer = useViewerStore((s) => s.me)
  const familyView = useViewerStore((s) => s.familyView)
  const isFamilyLockedSession = Boolean(familyView) || viewer?.accountType === 'family_member'
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
  const [communityOrganizationGroups, setCommunityOrganizationGroups] = useState<CommunityOrganizationsRailGroup[]>([])
  const [workApplications, setWorkApplications] = useState<WorkApplicationRailItem[]>([])
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberRailItem[]>([])
  const [familyRelationships, setFamilyRelationships] = useState<ProfileFamilyRelationshipRailItem[]>([])

  const getOrganizationHref = useCallback(
    (org: { provinceCode: string | null; communitySlug: string | null; slug: string }) => {
      const base = `/com/${String(org.provinceCode).toLowerCase()}/${String(org.communitySlug).toLowerCase()}/orgs/${org.slug}`
      return organizationLinkTarget === 'chat' ? `${base}/chat-channels` : base
    },
    [organizationLinkTarget],
  )

  const hideSocialBlocks = hideContactsAndCommunities || mode === 'organizations' || mode === 'organizationsDirectory' || mode === 'network' || mode === 'events' || mode === 'community' || mode === 'work'
  const shouldLoadOrganizations = !isFamilyLockedSession && (mode === 'organizations' || mode === 'organizationsDirectory' || mode === 'community' || showOrganizations)
  const shouldLoadOwnedOrganizations = shouldLoadOrganizations
  const shouldLoadMemberOrganizations = shouldLoadOrganizations
  const shouldLoadCommunityOrganizations = !isFamilyLockedSession && mode === 'communitiesFeed'
  const shouldLoadConnections = mode === 'network'
  const shouldLoadPendingFriendRequests = showPendingFriendRequests
  const shouldLoadPendingConnectionRequests = mode === 'network' || showPendingConnectionRequests
  const shouldLoadEventsSidebar = !isFamilyLockedSession && (mode === 'events' || mode === 'community' || mode === 'communitiesFeed' || showRsvps)
  const shouldLoadWorkApplications = mode === 'work'
  const shouldLoadHomeRail = !hideSocialBlocks
  const shouldLoadFamilyRail = !isFamilyLockedSession && mode === 'default' && viewer?.accountType === 'user'

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

  const railOrganizations = organizationBlockVariant === 'followed' ? subscribedOrganizations : combinedOrganizations

  const railOrganizationsTitle = organizationBlockVariant === 'followed' ? 'Organizations you follow' : 'Your Organizations'

  const railOrganizationsEmptyLabel = organizationBlockVariant === 'followed' ? 'No organizations followed yet.' : 'No organizations yet.'

  const manageCreateEventHref = useMemo(() => {
    const org = eventOrganizations[0]
    if (org?.provinceCode && org.communitySlug) {
      return `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}/events/manage/create`
    }
    return '/organizations/manager'
  }, [eventOrganizations])

  const familyEntries = useMemo<FamilyRailEntry[]>(() => {
    const memberEntries = familyMembers.map((member) => ({
      kind: 'member' as const,
      id: member.id,
      displayName: member.displayName,
      relationshipLabel: member.relationshipLabel,
      avatarUrl: member.avatarUrl ?? null,
      modeBand: member.modeBand,
      latestPostAt: member.latestPostAt ?? null,
      suspended: member.suspended,
    }))

    const relationshipEntries = familyRelationships.map((relationship) => ({
      kind: 'profile' as const,
      id: relationship.id,
      handle: relationship.handle,
      displayName: relationship.displayName,
      relationshipLabel: relationship.relationshipLabel,
      avatarUrl: relationship.avatarUrl ?? null,
      coverUrl: relationship.coverUrl ?? null,
      latestPostAt: relationship.latestPostAt ?? null,
    }))

    return [...memberEntries, ...relationshipEntries]
      .sort((left, right) => {
        const leftTime = left.latestPostAt ? new Date(left.latestPostAt).getTime() : 0
        const rightTime = right.latestPostAt ? new Date(right.latestPostAt).getTime() : 0
        if (rightTime !== leftTime) return rightTime - leftTime
        return left.displayName.localeCompare(right.displayName)
      })
      .slice(0, 5)
  }, [familyMembers, familyRelationships])

  const loadData = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setStatus('unauthorized')
      return
    }
    try {
      const requests: Array<{
        key: 'home' | 'follows' | 'owned' | 'memberships' | 'communityFollows' | 'connections' | 'friendRequests' | 'connectionRequests' | 'eventsSidebar' | 'workApplications' | 'family'
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

      if (shouldLoadCommunityOrganizations) {
        requests.push({
          key: 'communityFollows',
          promise: fetch(buildApiUrl('/communities/follows'), {
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

      if (shouldLoadWorkApplications) {
        requests.push({
          key: 'workApplications',
          promise: fetch(buildApiUrl('/work/applications?limit=5'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadFamilyRail) {
        requests.push({
          key: 'family',
          promise: fetch(buildApiUrl('/family'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        })
      }

      const results = await Promise.all(requests.map((entry) => entry.promise))
      const byKey = new Map(requests.map((entry, index) => [entry.key, results[index] as Response]))

      const homeRes = byKey.get('home')
      const followsRes = byKey.get('follows')
      const ownedRes = byKey.get('owned')
      const membershipsRes = byKey.get('memberships')
      const communityFollowsRes = byKey.get('communityFollows')
      const connectionsRes = byKey.get('connections')
      const friendRequestsRes = byKey.get('friendRequests')
      const connectionRequestsRes = byKey.get('connectionRequests')
      const eventsSidebarRes = byKey.get('eventsSidebar')
      const workApplicationsRes = byKey.get('workApplications')
      const familyRes = byKey.get('family')

      if (
        homeRes?.status === 401 ||
        followsRes?.status === 401 ||
        ownedRes?.status === 401 ||
        membershipsRes?.status === 401 ||
        communityFollowsRes?.status === 401 ||
        connectionsRes?.status === 401 ||
        friendRequestsRes?.status === 401 ||
        connectionRequestsRes?.status === 401 ||
        eventsSidebarRes?.status === 401 ||
        workApplicationsRes?.status === 401 ||
        familyRes?.status === 401
      ) {
        setStatus('unauthorized')
        return
      }

      const requiredHomeOk = shouldLoadHomeRail ? Boolean(homeRes?.ok) : true
      const requiredFollowsOk = shouldLoadOrganizations ? Boolean(followsRes?.ok) : true
      const requiredOwnedOk = shouldLoadOwnedOrganizations ? Boolean(ownedRes?.ok) : true
      const requiredMembershipsOk = shouldLoadMemberOrganizations ? Boolean(membershipsRes?.ok) : true
      const requiredCommunityOrganizationsOk = shouldLoadCommunityOrganizations ? Boolean(communityFollowsRes?.ok) : true
      const requiredConnectionsOk = shouldLoadConnections ? Boolean(connectionsRes?.ok) : true
      const requiredFriendRequestsOk = shouldLoadPendingFriendRequests ? Boolean(friendRequestsRes?.ok) : true
      const requiredConnectionRequestsOk = shouldLoadPendingConnectionRequests ? Boolean(connectionRequestsRes?.ok) : true
      const requiredEventsSidebarOk = shouldLoadEventsSidebar ? Boolean(eventsSidebarRes?.ok) : true
      const requiredWorkApplicationsOk = shouldLoadWorkApplications ? Boolean(workApplicationsRes?.ok) : true

      if (!requiredHomeOk || !requiredFollowsOk || !requiredOwnedOk || !requiredMembershipsOk || !requiredCommunityOrganizationsOk || !requiredConnectionsOk || !requiredFriendRequestsOk || !requiredConnectionRequestsOk || !requiredEventsSidebarOk || !requiredWorkApplicationsOk) {
        setStatus('error')
        if (!shouldLoadHomeRail) setData(null)
        if (!shouldLoadOrganizations) setOrganizations([])
        if (!shouldLoadOwnedOrganizations) setOwnedOrganizations([])
        if (!shouldLoadMemberOrganizations) setMemberOrganizations([])
        if (!shouldLoadCommunityOrganizations) setCommunityOrganizationGroups([])
        if (!shouldLoadConnections) setConnections([])
        if (!shouldLoadPendingFriendRequests) setPendingFriendRequests([])
        if (!shouldLoadPendingConnectionRequests) setPendingConnectionRequests([])
        if (!shouldLoadEventsSidebar) {
          setEventRsvps([])
          setEventOrganizations([])
        }
        if (!shouldLoadWorkApplications) setWorkApplications([])
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

      if (communityFollowsRes?.ok) {
        const payload = (await communityFollowsRes.json().catch(() => null)) as CommunityFollowsResponse | null
        const rawItems = Array.isArray(payload?.items) ? payload.items : []
        const orderedItems = [...rawItems].sort((left, right) => {
          const leftIsHome = Boolean(left.home || (viewer?.homeCommunity?.provinceCode === left.province && viewer?.homeCommunity?.communitySlug === left.communitySlug))
          const rightIsHome = Boolean(right.home || (viewer?.homeCommunity?.provinceCode === right.province && viewer?.homeCommunity?.communitySlug === right.communitySlug))
          if (leftIsHome !== rightIsHome) return leftIsHome ? -1 : 1

          const leftLabel = formatCommunityRailLabel(left.community?.cityName ?? left.community?.name ?? left.communitySlug)
          const rightLabel = formatCommunityRailLabel(right.community?.cityName ?? right.community?.name ?? right.communitySlug)
          return leftLabel.localeCompare(rightLabel)
        })

        const groups = await Promise.all(
          orderedItems.map(async (item) => {
            const provinceCode = item.province.trim().toLowerCase()
            const communitySlug = item.communitySlug.trim().toLowerCase()
            const href = `/com/${provinceCode}/${communitySlug}/orgs`
            const communityHref = `/${provinceCode}/${communitySlug}`
            const isHome = Boolean(item.home || (viewer?.homeCommunity?.provinceCode === item.province && viewer?.homeCommunity?.communitySlug === item.communitySlug))
            const communityName = formatCommunityRailLabel(item.community?.cityName ?? item.community?.name ?? item.communitySlug)

            try {
              const response = await fetch(buildApiUrl(`/communities/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs?limit=24`), {
                headers: { authorization: `Bearer ${token}` },
              })

              if (!response.ok) {
                return {
                  key: `${provinceCode}:${communitySlug}`,
                  title: communityName,
                  isHome,
                  href,
                  communityHref,
                  items: [],
                }
              }

              const orgPayload = (await response.json().catch(() => null)) as CommunityOrganizationsRailResponse | null
              return {
                key: `${provinceCode}:${communitySlug}`,
                title: communityName,
                isHome,
                href,
                communityHref,
                items: shuffleItems(Array.isArray(orgPayload?.items) ? orgPayload.items : []).slice(0, 5),
              }
            } catch (error) {
              console.error('Unable to load community organizations for rail', error)
              return {
                key: `${provinceCode}:${communitySlug}`,
                title: communityName,
                isHome,
                href,
                communityHref,
                items: [],
              }
            }
          }),
        )

        setCommunityOrganizationGroups(groups)
      } else {
        setCommunityOrganizationGroups([])
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

      if (workApplicationsRes?.ok) {
        const payload = (await workApplicationsRes.json().catch(() => null)) as WorkApplicationsRailResponse | null
        setWorkApplications(Array.isArray(payload?.items) ? payload.items : [])
      } else {
        setWorkApplications([])
      }

      if (familyRes?.ok) {
        const payload = (await familyRes.json().catch(() => null)) as FamilyRailResponse | null
        setFamilyMembers(Array.isArray(payload?.members) ? payload.members : [])
        let nextRelationships = Array.isArray(payload?.profileRelationships) ? payload.profileRelationships : []

        if (nextRelationships.length === 0 && viewer?.handle) {
          try {
            const publicFamilyResponse = await fetch(buildApiUrl(`/users/${encodeURIComponent(viewer.handle)}/family`), {
              cache: 'no-store',
            })
            if (publicFamilyResponse.ok) {
              const publicPayload = (await publicFamilyResponse.json().catch(() => null)) as PublicFamilyRailResponse | null
              const combinedEntries = [
                ...(Array.isArray(publicPayload?.immediateFamily) ? publicPayload.immediateFamily : []),
                ...(Array.isArray(publicPayload?.extendedFamily) ? publicPayload.extendedFamily : []),
              ]
              nextRelationships = Array.from(
                new Map(
                  combinedEntries.map((entry) => [
                    entry.id,
                    {
                      id: entry.id,
                      handle: entry.handle,
                      displayName: entry.name?.trim() || entry.handle,
                      relationshipLabel: entry.relationshipLabel,
                      avatarUrl: entry.avatarUrl ?? null,
                      coverUrl: entry.coverUrl ?? null,
                      latestPostAt: null,
                    } satisfies ProfileFamilyRelationshipRailItem,
                  ]),
                ).values(),
              )
            }
          } catch (fallbackError) {
            console.error('Failed to load public family fallback for right rail', fallbackError)
          }
        }

        setFamilyRelationships(nextRelationships)
      } else {
        setFamilyMembers([])
        setFamilyRelationships([])
      }

      setStatus('ready')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [shouldLoadHomeRail, shouldLoadOrganizations, shouldLoadOwnedOrganizations, shouldLoadMemberOrganizations, shouldLoadCommunityOrganizations, shouldLoadConnections, shouldLoadPendingFriendRequests, shouldLoadPendingConnectionRequests, shouldLoadEventsSidebar, shouldLoadWorkApplications, shouldLoadFamilyRail, viewer?.homeCommunity?.communitySlug, viewer?.homeCommunity?.provinceCode])

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
      <div className="space-y-6">
        <div className="surface-card h-48 animate-pulse p-5" />
        <div className="surface-card h-48 animate-pulse p-5" />
      </div>
    )
  }

  if (status === 'unauthorized') return null

  if (mode === 'communitiesFeed') {
    return (
      <div className="space-y-6">
        <Block title="Your Communities" action={{ label: 'View all', href: '/communities/settings' }}>
          {data?.communities.length ? (
            <ul className="space-y-3">
              {data.communities.map((comm) => {
                const formattedName = comm.name
                  .split('-')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ')

                return (
                  <li key={`${comm.provinceCode}:${comm.communitySlug}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-900 px-3 py-2">
                    <Link
                      href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                      className="flex-1 whitespace-normal break-words text-sm font-semibold leading-5 text-white hover:text-white"
                    >
                      {formattedName}
                    </Link>
                    {comm.newPosts > 0 ? (
                      <Link
                        href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                        className="mt-0.5 shrink-0 flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white"
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

        {communityOrganizationGroups.length ? (
          communityOrganizationGroups.map((group) => (
            <Block
              key={group.key}
              title={
                <div className="space-y-1">
                  {group.isHome ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                      Home
                    </span>
                  ) : null}
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Organizations in</p>
                    <Link href={group.communityHref} className="inline-flex text-base font-semibold leading-5 text-slate-900 hover:text-[var(--cc-primary)] hover:underline">
                      {group.title}
                    </Link>
                  </div>
                </div>
              }
              action={{ label: 'Directory', href: group.href }}
            >
              {group.items.length ? (
                <ul className="space-y-3">
                  {group.items.map((org) => (
                    <li key={org.id}>
                      <CivilCard
                        href={org.provinceCode && org.communitySlug ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}` : group.href}
                        size="md"
                        name={org.name}
                        avatarAlt={org.name}
                        avatarInitials={org.name}
                        avatarSrc={org.logoUrl ?? null}
                        coverUrl={org.coverUrl ?? null}
                        isVerified={Boolean(org.isVerified)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No organizations in this community yet.</p>
              )}
            </Block>
          ))
        ) : (
          <Block title="Community Organizations" action={{ label: 'View all', href: '/communities/settings' }}>
            <p className="text-sm text-slate-500">Follow a community to see its organizations here.</p>
          </Block>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {showPendingFriendRequests && pendingFriendRequests.length ? (
        <Block title="Pending Friend Requests" action={{ label: 'View all', href: '/friends' }}>
          <ul className="space-y-3">
            {pendingFriendRequests.slice(0, 4).map((request) => {
              const displayName = formatUserDisplayName(request.user.name, request.user.handle) || request.user.handle
              return (
                <li key={request.id}>
                  <CivilCard
                    href={`/u/${request.user.handle}`}
                    size="md"
                    name={displayName}
                    avatarAlt={displayName}
                    avatarInitials={displayName}
                    avatarSrc={request.user.avatarUrl}
                    coverUrl={request.user.coverUrl ?? null}
                    isVerified={request.user.isVerified}
                    isBusiness={request.user.isPremium}
                  />
                </li>
              )
            })}
          </ul>
        </Block>
      ) : null}

      {!hideFamilyBlock && !hideSocialBlocks && !isFamilyLockedSession && viewer?.accountType === 'user' && (hasFamilyProfilesAvailable(viewer) || familyEntries.length > 0) ? (
        <FamilyRailBlock entries={familyEntries} viewAllHref={viewer?.handle ? `/u/${viewer.handle}/family` : '/family'} />
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
                {subscribedOrganizations.slice(0, 5).map((org) => (
                  <li key={org.id}>
                    <CivilCard
                      href={getOrganizationHref(org)}
                      size="md"
                      name={org.name}
                      avatarAlt={org.name}
                      avatarInitials={org.name}
                      avatarSrc={org.logoUrl ?? null}
                      coverUrl={org.coverUrl ?? null}
                      isVerified={Boolean(org.isVerified)}
                    />
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
                {partOfOrganizations.slice(0, 5).map((org) => (
                  <li key={org.id}>
                    <CivilCard
                      href={getOrganizationHref(org)}
                      size="md"
                      name={org.name}
                      avatarAlt={org.name}
                      avatarInitials={org.name}
                      avatarSrc={org.logoUrl ?? null}
                      coverUrl={org.coverUrl ?? null}
                      isVerified={Boolean(org.isVerified)}
                    />
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
              {combinedOrganizations.slice(0, 5).map((org) => (
                <li key={org.id}>
                  <CivilCard
                    href={getOrganizationHref(org)}
                    size="md"
                    name={org.name}
                    avatarAlt={org.name}
                    avatarInitials={org.name}
                    avatarSrc={org.logoUrl ?? null}
                    coverUrl={org.coverUrl ?? null}
                    isVerified={Boolean(org.isVerified)}
                  />
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
                {pendingConnectionRequests.slice(0, 4).map((request) => {
                  const displayName = formatUserDisplayName(request.user.name, request.user.handle) || request.user.handle
                  const isAccepting = pendingConnectionAction?.id === request.id && pendingConnectionAction.action === 'accept'
                  const isRejecting = pendingConnectionAction?.id === request.id && pendingConnectionAction.action === 'reject'
                  const isActing = pendingConnectionAction?.id === request.id
                  return (
                    <li key={request.id}>
                      <CivilCard
                        size="md"
                        name={displayName}
                        avatarAlt={displayName}
                        avatarInitials={displayName}
                        avatarSrc={request.user.avatarUrl}
                        avatarHref={`/u/${request.user.handle}`}
                        titleHref={`/u/${request.user.handle}`}
                        coverUrl={request.user.coverUrl ?? null}
                        isVerified={request.user.isVerified}
                        isBusiness={request.user.isPremium}
                        align="start"
                        details={
                          <div className="flex gap-2">
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
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </Block>
          ) : null}

          <Block title="Professionals" action={{ label: 'See all', href: '/network/professionals' }}>
            {connections.length ? (
              <ul className="space-y-3">
                {connections.slice(0, 5).map((connection) => {
                  const displayName = formatUserDisplayName(connection.user.name, connection.user.handle) || connection.user.handle
                  return (
                    <li key={connection.id}>
                      <CivilCard
                        href={`/u/${connection.user.handle}`}
                        size="md"
                        name={displayName}
                        avatarAlt={displayName}
                        avatarInitials={displayName}
                        avatarSrc={connection.user.avatarUrl}
                        coverUrl={connection.user.coverUrl ?? null}
                        isVerified={connection.user.isVerified}
                        isBusiness={connection.user.isPremium}
                      />
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
                {combinedOrganizations.slice(0, 5).map((org) => (
                  <li key={org.id}>
                    <CivilCard
                      href={getOrganizationHref(org)}
                      size="md"
                      name={org.name}
                      avatarAlt={org.name}
                      avatarInitials={org.name}
                      avatarSrc={org.logoUrl ?? null}
                      coverUrl={org.coverUrl ?? null}
                      isVerified={Boolean(org.isVerified)}
                    />
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
          <Link
            href={manageCreateEventHref}
            className="inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Create Event
          </Link>

          {eventRsvps.length ? (
            <Block title="Your Events" action={{ label: 'View all', href: '/events?mine=going' }}>
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
            <Block title="Events from your organizations" action={{ label: 'View all', href: '/organizations/manager' }}>
              <ul className="space-y-3">
                {eventOrganizations.map((org) => {
                  const href =
                    org.provinceCode && org.communitySlug
                      ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}/events/manage`
                      : '/organizations/manager'

                  return (
                    <li key={org.id}>
                      <CivilCard
                        href={href}
                        size="md"
                        name={org.name}
                        avatarAlt={org.name}
                        avatarInitials={org.name}
                        avatarSrc={org.logoUrl ?? null}
                        coverUrl={org.coverUrl ?? null}
                        isVerified={Boolean(org.isVerified)}
                      />
                    </li>
                  )
                })}
              </ul>
            </Block>
          ) : null}
        </>
      ) : null}

      {mode === 'work' ? (
        <Block title="Your Applications" action={{ label: 'View all', href: '/work/applications' }}>
          {workApplications.length ? (
            <ul className="space-y-3">
              {workApplications.map((entry) => {
                const org = entry.job.organization
                const href =
                  org.provinceCode && org.communitySlug
                    ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}/jobs/${entry.job.id}`
                    : '/work/applications'

                return (
                  <li key={entry.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-700">
                    {org.coverUrl ? <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                    <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                    <Link href={href} className="group relative flex items-center gap-2.5 px-3 py-2">
                      <VerifiedAvatar src={org.logoUrl ?? null} alt={org.name} initials={org.name} size={32} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{entry.job.title}</p>
                        <p className="truncate text-xs text-white/85">{org.name}</p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No applications submitted yet.</p>
          )}
        </Block>
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
              <li key={friend.id}>
                <CivilCard
                  href={`/u/${friend.handle}`}
                  size="md"
                  name={displayName}
                  avatarAlt={displayName}
                  avatarInitials={displayName}
                  avatarSrc={friend.avatarUrl}
                  coverUrl={friend.coverUrl ?? null}
                  trailing={
                    friend.newPosts > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-white/90">
                        <HiOutlineBell className="h-4 w-4" />
                        ({friend.newPosts})
                      </span>
                    ) : null
                  }
                />
              </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No friends yet.</p>
        )}
      </Block>
      ) : null}

      {mode === 'default' && showOrganizations && !isFamilyLockedSession ? (
        <Block title={railOrganizationsTitle} action={{ label: 'View all', href: '/organizations/directory' }}>
          {railOrganizations.length ? (
            <ul className="space-y-3">
              {railOrganizations.slice(0, 5).map((org) => (
                <li key={org.id}>
                  <CivilCard
                    href={getOrganizationHref(org)}
                    size="md"
                    name={org.name}
                    avatarAlt={org.name}
                    avatarInitials={org.name}
                    avatarSrc={org.logoUrl ?? null}
                    coverUrl={org.coverUrl ?? null}
                    isVerified={Boolean(org.isVerified)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{railOrganizationsEmptyLabel}</p>
          )}
        </Block>
      ) : null}

      {/* Communities Section */}
      {!hideSocialBlocks && !hideCommunities && !isFamilyLockedSession ? (
        <Block title="Your Communities" action={{ label: 'View all', href: '/communities/settings' }}>
          {data?.communities.length ? (
            <ul className="space-y-3">
              {data.communities.map((comm) => {
                const formattedName = comm.name
                  .split('-')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ')

                return (
                  <li key={`${comm.provinceCode}:${comm.communitySlug}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-900 px-3 py-2">
                    <Link
                      href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                      className="flex-1 whitespace-normal break-words text-sm font-semibold leading-5 text-white hover:text-white"
                    >
                      {formattedName}
                    </Link>
                    {comm.newPosts > 0 && (
                      <Link
                        href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                        className="mt-0.5 shrink-0 flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white"
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
