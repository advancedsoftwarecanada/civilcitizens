"use client"

import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import type { ReactionType } from '@civil/shared'
import { FaUserTie } from 'react-icons/fa'
import {
  HiOutlineCalendarDays,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineChevronDown,
  HiOutlinePhone,
  HiOutlineUserPlus,
  HiOutlineUsers,
  HiOutlineVideoCamera,
  HiOutlineBuildingLibrary,
} from 'react-icons/hi2'
import CivilCard from '../../_components/CivilCard'
import CivilComposerLauncher from '../../_components/CivilComposerLauncher'
import FamilyFeedClient from '../../_components/FamilyFeedClient'
import Sidebar from '../../_components/Sidebar'
import PostComposer, { ApiPost, type PostType } from '../../_components/PostComposer'
import PostFeedItem from '../../_components/PostFeedItem'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import DashboardShell from '../../_components/DashboardShell'
import Modal from '../../_components/Modal'
import { pushToast } from '../../_components/useToasts'
import { hasFamilyProfilesAvailable, type FamilyModeSummary } from '../../_lib/me'
import { formatUserDisplayName } from '../../_lib/text'
import { useViewerStore } from '../../_lib/viewerStore'
import { ensureViewerMe } from '../../_lib/viewerMe'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Smart' },
  { value: 'new', label: 'Latest' },
]

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
  accountType?: 'user' | 'family_member'
  familyMode?: FamilyModeSummary | null
  familyMemberSession?: {
    parentId?: string | null
    parentHandle?: string | null
    parentName?: string | null
    modeBand?: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
    allowChildAudioCalls?: boolean
    allowChildVideoCalls?: boolean
  } | null
}

type UserProfile = {
  id: string
  handle: string
  name?: string | null
  bio?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  avatarPostId?: string | null
  coverPostId?: string | null
  createdAt?: string
  dateOfBirth?: string | null
  birthYear?: number | null
  countryOfBirth?: string | null
  experiences?: UserExperience[]
  isPremium?: boolean
  isVerified?: boolean
  postCount?: number
  friendCount?: number
  communityCount?: number
  organizationCount?: number
  connectionCount?: number
  accountType?: 'user' | 'family_member'
  familyProfile?: {
    memberId: string
    relationshipLabel: string
    modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
    modeLabel: string
    access: 'self' | 'family' | 'friend'
    allowChildAudioCalls?: boolean
    allowChildVideoCalls?: boolean
  } | null
}

type UserExperience = {
  id: string
  title: string
  organization: string
  organizationProfile?: {
    id: string
    name: string
    slug: string
    provinceCode: string
    communitySlug: string
    logoUrl: string | null
    coverUrl: string | null
  } | null
  location?: string | null
  startDate?: string | null
  endDate?: string | null
  current?: boolean
  description?: string | null
  position?: number
}

type ProfileRelationship = {
  friendshipStatus: 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'
  friendshipId?: string
  friendshipSince?: string | null
  connectionStatus: 'self' | 'connected' | 'incoming' | 'outgoing' | 'none'
  connectionId?: string
  connectionSince?: string | null
}

type FriendRequestPayload = {
  id: string
  direction: 'incoming' | 'outgoing'
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  requestedAt: string
  respondedAt: string | null
}

type FriendAcceptResponse = {
  friend?: {
    id: string
    since?: string | null
  }
  error?: string
}

type ConnectionRequestPayload = {
  id: string
  direction: 'incoming' | 'outgoing'
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  requestedAt: string
  respondedAt: string | null
}

type ConnectionAcceptResponse = {
  connection?: {
    id: string
    since?: string | null
  }
  error?: string
}

type InviteSurface = 'event' | 'organization'

type FamilyInviteRelationshipValue =
  | 'mother'
  | 'father'
  | 'grandmother'
  | 'grandfather'
  | 'sister'
  | 'brother'
  | 'aunt'
  | 'uncle'
  | 'cousin'
  | 'second_cousin'
  | 'niece'
  | 'nephew'
  | 'wife'
  | 'husband'
  | 'significant_other'
  | 'partner'
  | 'mother_in_law'
  | 'father_in_law'
  | 'sister_in_law'
  | 'brother_in_law'
  | 'daughter_in_law'
  | 'son_in_law'
  | 'other'

const FAMILY_INVITE_RELATIONSHIP_OPTIONS: Array<{ value: FamilyInviteRelationshipValue; label: string }> = [
  { value: 'mother', label: 'Mother' },
  { value: 'father', label: 'Father' },
  { value: 'grandmother', label: 'Grandmother' },
  { value: 'grandfather', label: 'Grandfather' },
  { value: 'sister', label: 'Sister' },
  { value: 'brother', label: 'Brother' },
  { value: 'aunt', label: 'Aunt' },
  { value: 'uncle', label: 'Uncle' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'second_cousin', label: 'Second Cousin' },
  { value: 'niece', label: 'Niece' },
  { value: 'nephew', label: 'Nephew' },
  { value: 'wife', label: 'Wife' },
  { value: 'husband', label: 'Husband' },
  { value: 'significant_other', label: 'Significant Other' },
  { value: 'partner', label: 'Partner' },
  { value: 'mother_in_law', label: 'Mother-in-law' },
  { value: 'father_in_law', label: 'Father-in-law' },
  { value: 'sister_in_law', label: 'Sister-in-law' },
  { value: 'brother_in_law', label: 'Brother-in-law' },
  { value: 'daughter_in_law', label: 'Daughter-in-law' },
  { value: 'son_in_law', label: 'Son-in-law' },
  { value: 'other', label: 'Other' },
]

type InviteableOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl?: string | null
  coverUrl?: string | null
}

type InviteableEvent = {
  id: string
  eventId: string
  title: string
  startsAt: string
  primaryPhotoUrl: string | null
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string
    communitySlug: string
  }
}

type OrganizationsResponse = {
  items?: Array<{
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl?: string | null
    coverUrl?: string | null
  }>
}

type EventsSidebarResponse = {
  rsvps?: Array<{
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
    }
  }>
}

function formatDate(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatBirthDate(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatBirthYear(year?: number | null) {
  if (typeof year !== 'number' || Number.isNaN(year)) return ''
  return year.toLocaleString()
}

function formatDateRange(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatEventStart(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatExperienceRange(exp: UserExperience) {
  const start = formatDateRange(exp.startDate)
  const end = exp.current ? 'Present' : formatDateRange(exp.endDate)
  if (start && end) return `${start} – ${end}`
  if (start) return start
  if (end) return end
  return 'Dates not provided'
}

function isValidUserId(value: string) {
  const trimmed = value.trim()
  const cuidPattern = /^c[a-z0-9]{24,}$/i
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return cuidPattern.test(trimmed) || uuidPattern.test(trimmed)
}

function formatCount(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0'
  return value.toLocaleString()
}

function getDateMs(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.getTime()
}

function parseExperienceLocation(raw?: string | null): { label: string; href?: string } | null {
  const value = raw?.trim()
  if (!value) return null

  if (value.startsWith('special:')) {
    const special = value.slice('special:'.length).trim().toLowerCase()
    if (special === 'remote') return { label: 'Remote' }
    if (special === 'not_in_canada') return { label: 'Not in Canada' }
    return null
  }

  if (value.startsWith('community:')) {
    const body = value.slice('community:'.length)
    const [head, labelPart] = body.split('|')
    const [provinceCodeRaw, communitySlugRaw] = (head ?? '').split(':')
    const provinceCode = (provinceCodeRaw ?? '').trim().toLowerCase()
    const communitySlug = (communitySlugRaw ?? '').trim().toLowerCase()
    if (!provinceCode || !communitySlug) return null
    const label = (labelPart ?? '').trim() || communitySlug.replace(/-/g, ' ')
    return {
      label,
      href: `/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}`,
    }
  }

  return null
}

type PageProps = {
  params: {
    handle: string
  }
}

function buildPostUrl(post: ApiPost) {
  const slug = post.seoSlug ?? post.id
  if (post.provinceCode && post.communitySlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/posts/${slug}`
  }
  return `/u/${post.author.handle}/posts/${slug}`
}

export default function UserPostsPage({ params }: PageProps) {
  const handleParam = decodeURIComponent(params.handle)
  const router = useRouter()
  const cachedViewer = useViewerStore((s) => s.me)
  const familyView = useViewerStore((s) => s.familyView)
  const viewerHydrated = useViewerStore((s) => s.hydrated)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [mediaLookupPosts, setMediaLookupPosts] = useState<ApiPost[]>([])
  const [mediaLookupFetched, setMediaLookupFetched] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')
  const [relationship, setRelationship] = useState<ProfileRelationship | null>(null)
  const [friendshipAction, setFriendshipAction] = useState<'send' | 'accept' | 'reject' | null>(null)
  const [connectionAction, setConnectionAction] = useState<'send' | 'accept' | 'reject' | null>(null)
  const [removeFriendModalOpen, setRemoveFriendModalOpen] = useState(false)
  const [removeConnectionModalOpen, setRemoveConnectionModalOpen] = useState(false)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [familyInviteModalOpen, setFamilyInviteModalOpen] = useState(false)
  const [familyInviteRelationship, setFamilyInviteRelationship] = useState<FamilyInviteRelationshipValue>('mother')
  const [familyInviteSending, setFamilyInviteSending] = useState(false)
  const [inviteSurface, setInviteSurface] = useState<InviteSurface>('event')
  const [inviteOrganizations, setInviteOrganizations] = useState<InviteableOrganization[]>([])
  const [inviteEvents, setInviteEvents] = useState<InviteableEvent[]>([])
  const [inviteItemsLoading, setInviteItemsLoading] = useState(false)
  const [inviteItemsError, setInviteItemsError] = useState<string | null>(null)
  const [inviteSendingKey, setInviteSendingKey] = useState<string | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)
  const [callActionMode, setCallActionMode] = useState<'audio' | 'video' | null>(null)
  const [familyBlockLoading, setFamilyBlockLoading] = useState(false)
  const resolvedViewer = cachedViewer ?? viewer
  const hasStoredToken = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : false
  const canPostToFamily = resolvedViewer?.accountType === 'user' && hasFamilyProfilesAvailable(resolvedViewer)

  const loadViewer = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setViewerReady(true)
      return
    }

    if (cachedViewer) {
      setViewer(cachedViewer)
      setViewerReady(true)
      return
    }

    try {
      const data = await ensureViewerMe({ token })
      if (!data) return
      setViewer(data)
    } catch {
      /* ignore */
    } finally {
      setViewerReady(true)
    }
  }, [cachedViewer])

  const loadProfilePosts = useCallback(
    async (mode: 'hot' | 'new') => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set('sort', mode)
        const search = params.toString()
        const url = buildApiUrl(
          `/users/${encodeURIComponent(handleParam)}/posts${search ? `?${search}` : ''}`,
        )
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
        const res = await fetch(
          url,
          token
            ? {
                headers: {
                  authorization: `Bearer ${token}`,
                },
                cache: 'no-store',
              }
            : { cache: 'no-store' },
        )
        if (res.status === 404) {
          setProfile(null)
          setPosts([])
          setRelationship(null)
          setError('User not found')
          return
        }
        if (!res.ok) {
          setRelationship(null)
          setError('Unable to load posts right now.')
          return
        }

        const data: {
          user?: UserProfile
          items?: ApiPost[]
          relationship?: ProfileRelationship | null
        } = await res.json()

        const userPayload = data.user
        setProfile(
          userPayload
            ? {
                ...userPayload,
                experiences: Array.isArray(userPayload.experiences) ? userPayload.experiences : [],
              }
            : null,
        )
        setRelationship(data.relationship ?? null)
        const fetchedPosts = Array.isArray(data.items) ? data.items : []
        setPosts(fetchedPosts)
        setMediaLookupPosts(fetchedPosts)
      } catch (err) {
        console.error('Failed loading user posts', err)
        setError('Unable to load posts right now.')
        setRelationship(null)
      } finally {
        setLoading(false)
      }
    },
    [handleParam],
  )

  useEffect(() => {
    loadViewer().catch(() => {
      /* noop */
    })
  }, [loadViewer])

  useEffect(() => {
    if (cachedViewer) {
      setViewerReady(true)
    }
  }, [cachedViewer])

  useEffect(() => {
    setMediaLookupFetched(false)
    setMediaLookupPosts([])
  }, [handleParam])

  useEffect(() => {
    if (hasStoredToken && !resolvedViewer) return
    if (!viewerHydrated) return
    if (!viewerReady) return
    loadProfilePosts(sortMode).catch(() => {
      /* noop */
    })
  }, [hasStoredToken, loadProfilePosts, resolvedViewer, sortMode, viewerHydrated, viewerReady])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      setPosts((prev) => {
        const withoutDuplicate = prev.filter((item) => item.id !== post.id)
        return [post, ...withoutDuplicate]
      })
    },
    [],
  )

  const handleReact = useCallback(
    async (postId: string, reaction: ReactionType | null) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      try {
        const res = await fetch(buildApiUrl('/posts/react'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId, reaction }),
        })
        if (!res.ok) {
          console.error('Reaction request failed', await res.text())
          return
        }
        const data = await res.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }
      } catch (err) {
        console.error('Unable to react to post', err)
      }
    },
    [],
  )

  const isOwner = resolvedViewer && profile && resolvedViewer.handle === profile.handle
  const sortedExperiences = useMemo(() => {
    const items = Array.isArray(profile?.experiences) ? [...profile.experiences] : []
    items.sort((left, right) => {
      const leftCurrent = Boolean(left.current)
      const rightCurrent = Boolean(right.current)
      if (leftCurrent !== rightCurrent) {
        return leftCurrent ? -1 : 1
      }

      const leftStart = getDateMs(left.startDate)
      const rightStart = getDateMs(right.startDate)
      if (leftStart !== null && rightStart !== null && leftStart !== rightStart) {
        return rightStart - leftStart
      }
      if (leftStart !== null && rightStart === null) return -1
      if (leftStart === null && rightStart !== null) return 1

      const leftPosition = typeof left.position === 'number' ? left.position : Number.MAX_SAFE_INTEGER
      const rightPosition = typeof right.position === 'number' ? right.position : Number.MAX_SAFE_INTEGER
      if (leftPosition !== rightPosition) return leftPosition - rightPosition

      return left.title.localeCompare(right.title)
    })
    return items
  }, [profile?.experiences])
  const experienceCount = sortedExperiences.length
  const coverDisplayUrl = profile?.coverUrl ?? null
  const editCoverHref = '/profile/edit?photo=cover'
  const editAvatarHref = '/profile/edit?photo=avatar'
  const ownerDisplayName = formatUserDisplayName(resolvedViewer?.name, resolvedViewer?.handle) || resolvedViewer?.handle || 'Citizen'
  const ownerFirstName = ownerDisplayName.split(' ')[0] ?? 'Citizen'
  const ownerInitials = ownerDisplayName || 'C'
  const profileDisplayName = formatUserDisplayName(profile?.name, profile?.handle) || profile?.handle || 'Citizen'
  const isViewerVerified = Boolean(resolvedViewer?.isVerified)
  const isViewerBusiness = Boolean(resolvedViewer?.isPremium)
  const resolvedRelationship: ProfileRelationship =
    relationship ?? {
      friendshipStatus: isOwner ? 'self' : 'none',
      friendshipId: undefined,
      friendshipSince: null,
      connectionStatus: isOwner ? 'self' : 'none',
      connectionId: undefined,
      connectionSince: null,
    }
  const friendCount = profile?.friendCount ?? 0
  const communityCount = profile?.communityCount ?? 0
  const organizationCount = profile?.organizationCount ?? 0
  const connectionCount = profile?.connectionCount ?? 0
  const postCount = profile?.postCount ?? posts.length
  const publicBirthDate = formatBirthDate(profile?.dateOfBirth)
  const publicBirthYear = formatBirthYear(profile?.birthYear)
  const publicBirthCountry = profile?.countryOfBirth?.trim() ?? ''
  const familyInviteRelationshipLabel =
    FAMILY_INVITE_RELATIONSHIP_OPTIONS.find((option) => option.value === familyInviteRelationship)?.label ?? 'Mother'
  const isBornInCanada = publicBirthCountry.toLowerCase() === 'canada'
  const identityPills = [
    profile?.isVerified ? { label: 'Verified Canadian', tone: 'verified' as const, iconSrc: '/self-verified.png' } : null,
    publicBirthCountry
      ? {
          label: `Born in ${publicBirthCountry}`,
          tone: isBornInCanada ? ('verified' as const) : ('default' as const),
          iconSrc: isBornInCanada ? '/self-verified.png' : undefined,
        }
      : null,
    profile?.createdAt ? { label: `Joined ${formatDate(profile.createdAt) || '—'}`, tone: 'default' as const } : null,
    publicBirthDate ? { label: `Born ${publicBirthDate}`, tone: 'default' as const } : publicBirthYear ? { label: `Born ${publicBirthYear}`, tone: 'default' as const } : null,
  ].filter(
    (value): value is { label: string; tone: 'verified' | 'default'; iconSrc?: string } => Boolean(value),
  )
  const isSendingFriendRequest = friendshipAction === 'send'
  const isAcceptingFriendRequest = friendshipAction === 'accept'
  const isRejectingFriendRequest = friendshipAction === 'reject'
  const isSendingConnectionRequest = connectionAction === 'send'
  const isAcceptingConnectionRequest = connectionAction === 'accept'
  const isRejectingConnectionRequest = connectionAction === 'reject'
  const profileStatCards = profile
    ? [
        {
          label: 'Posts',
          value: formatCount(postCount),
          href: null,
        },
        {
          label: 'Experience entries',
          value: formatCount(experienceCount),
          href: null,
        },
        {
          label: 'Friends',
          value: formatCount(friendCount),
          href: `/u/${encodeURIComponent(profile.handle)}/friends`,
        },
        {
          label: 'Communities',
          value: formatCount(communityCount),
          href: `/u/${encodeURIComponent(profile.handle)}/communities`,
        },
        {
          label: 'Organizations',
          value: formatCount(organizationCount),
          href: `/u/${encodeURIComponent(profile.handle)}/organizations`,
        },
        {
          label: 'Business connections',
          value: formatCount(connectionCount),
          href: `/u/${encodeURIComponent(profile.handle)}/connections`,
        },
      ]
    : []
  const canDirectlyReachProfile =
    !isOwner && (resolvedRelationship.friendshipStatus === 'friends' || resolvedRelationship.connectionStatus === 'connected')

  const closeDetailsMenu = (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    const details = event.currentTarget.closest('details')
    if (details instanceof HTMLDetailsElement) {
      details.open = false
    }
  }

  useEffect(() => {
    const closeOpenMenus = () => {
      document.querySelectorAll<HTMLDetailsElement>('details.profile-action-menu[open]').forEach((details) => {
        details.open = false
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        closeOpenMenus()
        return
      }
      if (target.closest('details.profile-action-menu')) return
      closeOpenMenus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOpenMenus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const menuPanelClassName =
    'mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-lg sm:absolute sm:left-0 sm:top-full sm:z-20 sm:min-w-[220px] sm:w-auto'
  const menuItemClassName =
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55'
  const destructiveMenuItemClassName =
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-55'

  const handleSendFamilyFriendRequest = async () => {
    if (!profile || resolvedViewer?.accountType !== 'family_member') return
    const token = requireAuthToken()
    if (!token) return

    try {
      const response = await fetch(buildApiUrl('/family/friends/requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ username: profile.handle }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to send that Family invite right now.', 'error')
        return
      }
      pushToast(payload?.message?.trim() || "An invite has been sent to this user's parent or guardian if it exists.", 'success')
    } catch (err) {
      console.error('Failed to send family friend request from profile', err)
      pushToast('Unable to send that Family invite right now.', 'error')
    }
  }

  const openFamilyInviteModal = () => {
    const token = requireAuthToken()
    if (!token || !profile) return
    setFamilyInviteRelationship('mother')
    setFamilyInviteModalOpen(true)
  }

  const handleInviteToSurface = (surface: InviteSurface) => {
    const token = requireAuthToken()
    if (!token || !profile) return
    setInviteSurface(surface)
    setInviteItemsError(null)
    setInviteModalOpen(true)
  }

  useEffect(() => {
    if (!inviteModalOpen) return

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setInviteModalOpen(false)
      redirectToAuthModal('login')
      return
    }

    let cancelled = false

    const loadInviteOptions = async () => {
      setInviteItemsLoading(true)
      setInviteItemsError(null)

      try {
        const headers = { authorization: `Bearer ${token}` }
        const [followsRes, ownedRes, membershipsRes, eventsRes] = await Promise.all([
          fetch(buildApiUrl('/organizations/follows'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/organizations/owned'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/organizations/memberships'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/events/sidebar'), { headers, cache: 'no-store' }),
        ])

        if ([followsRes, ownedRes, membershipsRes, eventsRes].some((response) => response.status === 401)) {
          if (!cancelled) {
            setInviteModalOpen(false)
            redirectToAuthModal('login')
          }
          return
        }

        const [followsPayload, ownedPayload, membershipsPayload, eventsPayload] = await Promise.all([
          followsRes.ok ? followsRes.json().catch(() => null) : Promise.resolve(null),
          ownedRes.ok ? ownedRes.json().catch(() => null) : Promise.resolve(null),
          membershipsRes.ok ? membershipsRes.json().catch(() => null) : Promise.resolve(null),
          eventsRes.ok ? eventsRes.json().catch(() => null) : Promise.resolve(null),
        ])

        if (cancelled) return

        const organizationMap = new Map<string, InviteableOrganization>()
        const addOrganizations = (items: OrganizationsResponse['items']) => {
          items?.forEach((item) => {
            const provinceCode = item.provinceCode?.trim() ?? ''
            const communitySlug = item.communitySlug?.trim() ?? ''
            if (!item.id || !item.name || !item.slug || !provinceCode || !communitySlug) return
            if (organizationMap.has(item.id)) return
            organizationMap.set(item.id, {
              id: item.id,
              name: item.name,
              slug: item.slug,
              provinceCode,
              communitySlug,
              logoUrl: item.logoUrl ?? null,
              coverUrl: item.coverUrl ?? null,
            })
          })
        }

        addOrganizations((followsPayload as OrganizationsResponse | null)?.items)
        addOrganizations((ownedPayload as OrganizationsResponse | null)?.items)
        addOrganizations((membershipsPayload as OrganizationsResponse | null)?.items)

        const events = (((eventsPayload as EventsSidebarResponse | null)?.rsvps) ?? []).flatMap((item) => {
          const provinceCode = item.organization.provinceCode?.trim() ?? ''
          const communitySlug = item.organization.communitySlug?.trim() ?? ''
          if (!item.id || !item.eventId || !item.title || !provinceCode || !communitySlug) return []
          return [{
            id: item.id,
            eventId: item.eventId,
            title: item.title,
            startsAt: item.startsAt,
            primaryPhotoUrl: item.primaryPhotoUrl ?? null,
            organization: {
              id: item.organization.id,
              name: item.organization.name,
              slug: item.organization.slug,
              provinceCode,
              communitySlug,
            },
          } satisfies InviteableEvent]
        })

        setInviteOrganizations(Array.from(organizationMap.values()).sort((left, right) => left.name.localeCompare(right.name)))
        setInviteEvents(
          events.sort((left, right) => {
            const leftTime = Date.parse(left.startsAt)
            const rightTime = Date.parse(right.startsAt)
            if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
              return leftTime - rightTime
            }
            return left.title.localeCompare(right.title)
          }),
        )
      } catch (error) {
        console.error('Failed to load profile invite options', error)
        if (!cancelled) {
          setInviteItemsError('Unable to load your events and organizations right now.')
        }
      } finally {
        if (!cancelled) {
          setInviteItemsLoading(false)
        }
      }
    }

    loadInviteOptions().catch(() => {
      /* noop */
    })

    return () => {
      cancelled = true
    }
  }, [inviteModalOpen])

  const renderActionMenu = ({
    label,
    tone = 'neutral',
    icon,
    disabled = false,
    children,
  }: {
    label: string
    tone?: 'neutral' | 'primary' | 'success'
    icon?: ReactNode
    disabled?: boolean
    children: ReactNode
  }) => {
    const summaryClassName = clsx(
      'inline-flex w-full cursor-pointer list-none items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold shadow-sm transition sm:w-auto [&::-webkit-details-marker]:hidden',
      tone === 'primary' && 'bg-[var(--cc-primary)] text-white hover:brightness-110',
      tone === 'success' && 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300',
      tone === 'neutral' && 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900',
      disabled && 'cursor-not-allowed opacity-55',
    )

    if (disabled) {
      return (
        <button type="button" className={summaryClassName} disabled>
          {icon}
          {label}
          <HiOutlineChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      )
    }

    return (
      <details className="group relative w-full sm:w-auto profile-action-menu">
        <summary className={summaryClassName}>
          {icon}
          {label}
          <HiOutlineChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className={menuPanelClassName}>{children}</div>
      </details>
    )
  }

  const renderConnectMenu = () => {
    const hasIncomingFriendRequest = resolvedRelationship.friendshipStatus === 'incoming'
    const hasIncomingConnectionRequest = resolvedRelationship.connectionStatus === 'incoming'
    const connectTone =
      resolvedRelationship.friendshipStatus === 'friends' || resolvedRelationship.connectionStatus === 'connected'
        ? 'success'
        : 'primary'

    const connectLabel = hasIncomingFriendRequest
      ? 'Accept Friend'
      : hasIncomingConnectionRequest
        ? 'Accept Network'
        : 'Connect'

    return renderActionMenu({
      label: connectLabel,
      tone: connectTone,
      icon: <HiOutlineUserPlus className="h-4 w-4" aria-hidden="true" />,
      children: (
        <>
          {resolvedRelationship.friendshipStatus === 'incoming' ? (
            <>
              <button type="button" className={menuItemClassName} onClick={(event) => {
                closeDetailsMenu(event)
                void handleAcceptFriendRequest()
              }} disabled={!relationship?.friendshipId || isAcceptingFriendRequest}>
                <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
                {isAcceptingFriendRequest ? 'Accepting friend…' : 'Accept Friend Request'}
              </button>
              <button type="button" className={destructiveMenuItemClassName} onClick={(event) => {
                closeDetailsMenu(event)
                void handleRejectFriendRequest()
              }} disabled={!relationship?.friendshipId || isRejectingFriendRequest}>
                <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
                Decline Friend Request
              </button>
            </>
          ) : resolvedRelationship.friendshipStatus === 'friends' ? (
            <button type="button" className={destructiveMenuItemClassName} onClick={(event) => {
              closeDetailsMenu(event)
              setRemoveFriendModalOpen(true)
            }}>
              <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
              Remove friend
            </button>
          ) : resolvedRelationship.friendshipStatus === 'outgoing' ? (
            <button type="button" className={menuItemClassName} disabled>
              <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
              Friend request sent
            </button>
          ) : (
            <button type="button" className={menuItemClassName} onClick={(event) => {
              closeDetailsMenu(event)
              void handleSendFriendRequest()
            }} disabled={isSendingFriendRequest}>
              <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
              {isSendingFriendRequest ? 'Sending friend invite…' : 'Add Friend'}
            </button>
          )}

          {resolvedViewer?.accountType === 'family_member' ? (
            <button type="button" className={menuItemClassName} onClick={(event) => {
              closeDetailsMenu(event)
              void handleSendFamilyFriendRequest()
            }}>
              <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
              Add Family
            </button>
          ) : profile?.accountType !== 'family_member' ? (
            <button type="button" className={menuItemClassName} onClick={(event) => {
              closeDetailsMenu(event)
              openFamilyInviteModal()
            }} disabled={familyInviteSending}>
              <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
              Add Family
            </button>
          ) : null}

          {resolvedRelationship.connectionStatus === 'incoming' ? (
            <>
              <button type="button" className={menuItemClassName} onClick={(event) => {
                closeDetailsMenu(event)
                void handleAcceptConnectionRequest()
              }} disabled={!relationship?.connectionId || isAcceptingConnectionRequest}>
                <FaUserTie className="h-4 w-4" aria-hidden="true" />
                {isAcceptingConnectionRequest ? 'Accepting network…' : 'Accept Business Request'}
              </button>
              <button type="button" className={destructiveMenuItemClassName} onClick={(event) => {
                closeDetailsMenu(event)
                void handleRejectConnectionRequest()
              }} disabled={!relationship?.connectionId || isRejectingConnectionRequest}>
                <FaUserTie className="h-4 w-4" aria-hidden="true" />
                Decline Business Request
              </button>
            </>
          ) : resolvedRelationship.connectionStatus === 'connected' ? (
            <button type="button" className={destructiveMenuItemClassName} onClick={(event) => {
              closeDetailsMenu(event)
              setRemoveConnectionModalOpen(true)
            }}>
              <FaUserTie className="h-4 w-4" aria-hidden="true" />
              Remove Business Network
            </button>
          ) : resolvedRelationship.connectionStatus === 'outgoing' ? (
            <button type="button" className={menuItemClassName} disabled>
              <FaUserTie className="h-4 w-4" aria-hidden="true" />
              Business request sent
            </button>
          ) : (
            <button type="button" className={menuItemClassName} onClick={(event) => {
              closeDetailsMenu(event)
              void handleSendConnectionRequest()
            }} disabled={isSendingConnectionRequest}>
              <FaUserTie className="h-4 w-4" aria-hidden="true" />
              {isSendingConnectionRequest ? 'Sending network invite…' : 'Add Business Network'}
            </button>
          )}
        </>
      ),
    })
  }

  const renderMessageMenu = () =>
    renderActionMenu({
      label: 'Message',
      icon: <HiOutlineChatBubbleOvalLeft className="h-4 w-4" aria-hidden="true" />,
      disabled: !canDirectlyReachProfile || messageLoading || callActionMode !== null,
      children: (
        <>
          <button type="button" className={menuItemClassName} onClick={(event) => {
            closeDetailsMenu(event)
            void handleStartDirectMessage()
          }} disabled={messageLoading || callActionMode !== null}>
            <HiOutlineChatBubbleOvalLeft className="h-4 w-4" aria-hidden="true" />
            {messageLoading ? 'Opening text…' : 'Text'}
          </button>
          <button type="button" className={menuItemClassName} onClick={(event) => {
            closeDetailsMenu(event)
            void handleStartDirectCall('audio')
          }} disabled={messageLoading || callActionMode !== null}>
            <HiOutlinePhone className="h-4 w-4" aria-hidden="true" />
            {callActionMode === 'audio' ? 'Calling…' : 'Audio'}
          </button>
          <button type="button" className={menuItemClassName} onClick={(event) => {
            closeDetailsMenu(event)
            void handleStartDirectCall('video')
          }} disabled={messageLoading || callActionMode !== null}>
            <HiOutlineVideoCamera className="h-4 w-4" aria-hidden="true" />
            {callActionMode === 'video' ? 'Starting video…' : 'Video'}
          </button>
        </>
      ),
    })

  const renderInviteMenu = () =>
    renderActionMenu({
      label: 'Invite to',
      icon: <HiOutlineCalendarDays className="h-4 w-4" aria-hidden="true" />,
      children: (
        <>
          <button type="button" className={menuItemClassName} onClick={(event) => {
            closeDetailsMenu(event)
            handleInviteToSurface('event')
          }}>
            <HiOutlineCalendarDays className="h-4 w-4" aria-hidden="true" />
            Event
          </button>
          <button type="button" className={menuItemClassName} onClick={(event) => {
            closeDetailsMenu(event)
            handleInviteToSurface('organization')
          }}>
            <HiOutlineBuildingLibrary className="h-4 w-4" aria-hidden="true" />
            Organization
          </button>
        </>
      ),
    })
  const renderRelationshipRequestCards = () => {
    const cards: ReactNode[] = []

    if (resolvedRelationship.friendshipStatus === 'incoming' || resolvedRelationship.friendshipStatus === 'outgoing') {
      const isIncomingFriendRequest = resolvedRelationship.friendshipStatus === 'incoming'
      cards.push(
        <div
          key="friend-request"
          className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,0.98)_0%,rgba(255,247,237,0.98)_100%)] p-5 shadow-[0_22px_70px_rgba(245,158,11,0.10)] sm:p-6"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <HiOutlineUsers className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">Friend Request</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {isIncomingFriendRequest ? 'This person wants to be your friend.' : 'Friend request pending'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {isIncomingFriendRequest
                  ? 'Accept or decline it here without digging through notifications.'
                  : 'You already sent a friend request to this profile.'}
              </p>
            </div>
          </div>
          {isIncomingFriendRequest ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleAcceptFriendRequest}
                disabled={!relationship?.friendshipId || isAcceptingFriendRequest}
              >
                {isAcceptingFriendRequest ? 'Accepting friend…' : 'Accept Friend Request'}
              </button>
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full border border-amber-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleRejectFriendRequest}
                disabled={!relationship?.friendshipId || isRejectingFriendRequest}
              >
                {isRejectingFriendRequest ? 'Declining…' : 'Decline'}
              </button>
            </div>
          ) : (
            <div className="mt-4 inline-flex items-center rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              Request sent
            </div>
          )}
        </div>,
      )
    }

    if (resolvedRelationship.connectionStatus === 'incoming' || resolvedRelationship.connectionStatus === 'outgoing') {
      const isIncomingConnectionRequest = resolvedRelationship.connectionStatus === 'incoming'
      cards.push(
        <div
          key="connection-request"
          className="rounded-[28px] border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.98)_0%,rgba(239,246,255,0.98)_100%)] p-5 shadow-[0_22px_70px_rgba(14,165,233,0.10)] sm:p-6"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <FaUserTie className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">Business Network</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {isIncomingConnectionRequest ? 'This person wants to connect professionally.' : 'Business request pending'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {isIncomingConnectionRequest
                  ? 'Respond here if you want to add them to your business network.'
                  : 'You already sent a business-network request to this profile.'}
              </p>
            </div>
          </div>
          {isIncomingConnectionRequest ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleAcceptConnectionRequest}
                disabled={!relationship?.connectionId || isAcceptingConnectionRequest}
              >
                {isAcceptingConnectionRequest ? 'Accepting network…' : 'Accept Business Request'}
              </button>
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full border border-sky-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleRejectConnectionRequest}
                disabled={!relationship?.connectionId || isRejectingConnectionRequest}
              >
                {isRejectingConnectionRequest ? 'Declining…' : 'Decline'}
              </button>
            </div>
          ) : (
            <div className="mt-4 inline-flex items-center rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Request sent
            </div>
          )}
        </div>,
      )
    }

    if (!cards.length || isOwner) return null

    return <section className={clsx('grid gap-4', cards.length > 1 && 'xl:grid-cols-2')}>{cards}</section>
  }

  const rightRailContent = <RightRail sticky={false} />

  const openComposer = (type: PostType = 'post') => {
    setComposerDefaultType(type)
    setComposerOpen(true)
  }

  const requireAuthToken = () => {
    if (typeof window === 'undefined') return null
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return null
    }
    return token
  }

  const resolveDirectTargetId = useCallback(
    async (token: string) => {
      if (!profile) return ''

      const localId = typeof profile.id === 'string' ? profile.id.trim() : ''
      if (isValidUserId(localId)) return localId

      try {
        const res = await fetch(buildApiUrl(`/users/${encodeURIComponent(profile.handle)}/posts?limit=1`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!res.ok) return localId
        const data = (await res.json().catch(() => null)) as { user?: { id?: string } | null }
        const refreshedId = typeof data?.user?.id === 'string' ? data.user.id.trim() : ''
        return refreshedId || localId
      } catch (err) {
        console.warn('Fallback user id lookup failed', err)
        return localId
      }
    },
    [profile],
  )

  const ensureDirectThread = useCallback(
    async (token: string) => {
      if (!profile) return null

      const targetId = await resolveDirectTargetId(token)
      if (!targetId) {
        pushToast('Unable to start a conversation: missing user id.', 'error')
        return null
      }
      if (!isValidUserId(targetId)) {
        pushToast('Unable to start a conversation: profile id is not valid.', 'error')
        return null
      }

      const res = await fetch(buildApiUrl('/messages/threads/direct'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: targetId }),
      })
      const payload = (await res.json().catch(() => null)) as { thread?: { id: string } | null; error?: string } | null
      if (!res.ok || !payload?.thread?.id) {
        const message = payload?.error ?? (res.status === 400 ? 'Unable to start a conversation: invalid user id.' : 'Unable to start a conversation right now.')
        pushToast(message, 'error')
        return null
      }

      return payload.thread.id
    },
    [profile, resolveDirectTargetId],
  )

  const handleSendProfileInvite = useCallback(
    async (surface: InviteSurface, item: InviteableEvent | InviteableOrganization) => {
      if (!profile) return
      const token = requireAuthToken()
      if (!token) return

      const targetUserId = await resolveDirectTargetId(token)
      if (!targetUserId || !isValidUserId(targetUserId)) {
        pushToast('Unable to send invite right now.', 'error')
        return
      }

      const requestKey = surface === 'event' ? `event:${(item as InviteableEvent).eventId}` : `organization:${item.id}`
      setInviteSendingKey(requestKey)

      try {
        const response = await fetch(buildApiUrl('/profile/invites'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(
            surface === 'event'
              ? {
                  type: 'event',
                  targetUserId,
                  eventId: (item as InviteableEvent).eventId,
                }
              : {
                  type: 'organization',
                  targetUserId,
                  organizationId: item.id,
                },
          ),
        })

        if (response.status === 401) {
          setInviteModalOpen(false)
          redirectToAuthModal('login')
          return
        }

        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          const message =
            payload?.error === 'event_not_joined'
              ? 'You can only invite people to events you are going to.'
              : payload?.error === 'organization_not_joined'
                ? 'You can only invite people to organizations you follow or belong to.'
                : payload?.error === 'user_not_found'
                  ? 'That profile is no longer available.'
                  : 'Unable to send invite right now.'
          pushToast(message, 'error')
          return
        }

        pushToast(
          surface === 'event'
            ? `Event invite sent to @${profile.handle}.`
            : `Organization invite sent to @${profile.handle}.`,
          'success',
        )
        setInviteModalOpen(false)
      } catch (error) {
        console.error('Failed to send profile invite', error)
        pushToast('Unable to send invite right now.', 'error')
      } finally {
        setInviteSendingKey(null)
      }
    },
    [profile, resolveDirectTargetId],
  )

  const handleSendFamilyInvite = useCallback(async () => {
    if (!profile) return
    const token = requireAuthToken()
    if (!token) return

    const targetUserId = await resolveDirectTargetId(token)
    if (!targetUserId || !isValidUserId(targetUserId)) {
      pushToast('Unable to send family request right now.', 'error')
      return
    }

    setFamilyInviteSending(true)
    try {
      const response = await fetch(buildApiUrl('/profile/family-requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId,
          relationship: familyInviteRelationship,
        }),
      })

      if (response.status === 401) {
        setFamilyInviteModalOpen(false)
        redirectToAuthModal('login')
        return
      }

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        const message = payload?.error === 'user_not_found'
          ? 'That profile is no longer available.'
          : 'Unable to send family request right now.'
        pushToast(message, 'error')
        return
      }

      pushToast(`Family request sent to @${profile.handle}.`, 'success')
      setFamilyInviteModalOpen(false)
    } catch (error) {
      console.error('Failed to send family request', error)
      pushToast('Unable to send family request right now.', 'error')
    } finally {
      setFamilyInviteSending(false)
    }
  }, [familyInviteRelationship, profile, resolveDirectTargetId])

  const handleSendFriendRequest = async () => {
    if (!profile) return
    const token = requireAuthToken()
    if (!token) return
    setFriendshipAction('send')
    try {
      const res = await fetch(buildApiUrl('/friends/requests'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: profile.id }),
      })
      const payload = (await res.json().catch(() => null)) as { request?: FriendRequestPayload; error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to send friend request right now.', 'error')
        return
      }
      setRelationship((prev) => ({
        friendshipStatus: 'outgoing',
        friendshipId: payload?.request?.id ?? prev?.friendshipId,
        friendshipSince: null,
        connectionStatus: prev?.connectionStatus ?? (isOwner ? 'self' : 'none'),
        connectionId: prev?.connectionId,
        connectionSince: prev?.connectionSince ?? null,
      }))
      pushToast('Friend request sent.', 'success')
    } catch (err) {
      console.error('Failed to send friend request', err)
      pushToast('Unable to send friend request right now.', 'error')
    } finally {
      setFriendshipAction(null)
    }
  }

  const handleAcceptFriendRequest = async () => {
    if (!relationship?.friendshipId) return
    const token = requireAuthToken()
    if (!token) return
    setFriendshipAction('accept')
    try {
      const res = await fetch(buildApiUrl(`/friends/requests/${relationship.friendshipId}/accept`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const payload = (await res.json().catch(() => null)) as FriendAcceptResponse | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to accept friend request.', 'error')
        return
      }
      const sinceIso = payload?.friend?.since ? new Date(payload.friend.since).toISOString() : new Date().toISOString()
      setRelationship((prev) => ({
        friendshipStatus: 'friends',
        friendshipId: payload?.friend?.id ?? prev?.friendshipId ?? relationship.friendshipId,
        friendshipSince: sinceIso,
        connectionStatus: prev?.connectionStatus ?? (isOwner ? 'self' : 'none'),
        connectionId: prev?.connectionId,
        connectionSince: prev?.connectionSince ?? null,
      }))
      pushToast('Friend request accepted.', 'success')
    } catch (err) {
      console.error('Failed to accept friend request', err)
      pushToast('Unable to accept friend request.', 'error')
    } finally {
      setFriendshipAction(null)
    }
  }

  const handleRejectFriendRequest = async () => {
    if (!relationship?.friendshipId) return
    const token = requireAuthToken()
    if (!token) return
    setFriendshipAction('reject')
    try {
      const res = await fetch(buildApiUrl(`/friends/requests/${relationship.friendshipId}/reject`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to dismiss friend request.', 'error')
        return
      }
      setRelationship((prev) => ({
        friendshipStatus: 'none',
        friendshipId: undefined,
        friendshipSince: null,
        connectionStatus: prev?.connectionStatus ?? (isOwner ? 'self' : 'none'),
        connectionId: prev?.connectionId,
        connectionSince: prev?.connectionSince ?? null,
      }))
      pushToast('Friend request dismissed.', 'info')
    } catch (err) {
      console.error('Failed to reject friend request', err)
      pushToast('Unable to dismiss friend request.', 'error')
    } finally {
      setFriendshipAction(null)
    }
  }

  const handleRemoveFriend = async () => {
    if (!profile || !relationship?.friendshipId) return
    const token = requireAuthToken()
    if (!token) return

    try {
      const res = await fetch(buildApiUrl(`/friends/${relationship.friendshipId}`), {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        pushToast(payload?.error ?? 'Unable to remove friend.', 'error')
        return
      }

      setRelationship((prev) => ({
        friendshipStatus: 'none',
        friendshipId: undefined,
        friendshipSince: null,
        connectionStatus: prev?.connectionStatus ?? (isOwner ? 'self' : 'none'),
        connectionId: prev?.connectionId,
        connectionSince: prev?.connectionSince ?? null,
      }))
      setProfile((prev) => {
        if (!prev) return prev
        return { ...prev, friendCount: Math.max(0, (prev.friendCount ?? 0) - 1) }
      })
      pushToast('Friend removed.', 'info')
      setRemoveFriendModalOpen(false)
    } catch (err) {
      console.error('Failed to remove friend', err)
      pushToast('Unable to remove friend right now.', 'error')
    }
  }

  const handleRemoveConnection = async () => {
    if (!profile || !relationship?.connectionId) return
    const token = requireAuthToken()
    if (!token) return

    try {
      const res = await fetch(buildApiUrl(`/connections/${relationship.connectionId}`), {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        pushToast(payload?.error ?? 'Unable to remove connection.', 'error')
        return
      }

      setRelationship((prev) => ({
        friendshipStatus: prev?.friendshipStatus ?? (isOwner ? 'self' : 'none'),
        friendshipId: prev?.friendshipId,
        friendshipSince: prev?.friendshipSince ?? null,
        connectionStatus: 'none',
        connectionId: undefined,
        connectionSince: null,
      }))
      setProfile((prev) => {
        if (!prev) return prev
        return { ...prev, connectionCount: Math.max(0, (prev.connectionCount ?? 0) - 1) }
      })
      pushToast('Connection removed.', 'info')
      setRemoveConnectionModalOpen(false)
    } catch (err) {
      console.error('Failed to remove connection', err)
      pushToast('Unable to remove connection right now.', 'error')
    }
  }

  const handleSendConnectionRequest = async () => {
    if (!profile) return
    const token = requireAuthToken()
    if (!token) return
    setConnectionAction('send')
    try {
      const res = await fetch(buildApiUrl('/connections/requests'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: profile.id }),
      })
      const payload = (await res.json().catch(() => null)) as { request?: ConnectionRequestPayload; error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to send connection request right now.', 'error')
        return
      }
      setRelationship((prev) => ({
        friendshipStatus: prev?.friendshipStatus ?? (isOwner ? 'self' : 'none'),
        friendshipId: prev?.friendshipId,
        friendshipSince: prev?.friendshipSince ?? null,
        connectionStatus: 'outgoing',
        connectionId: payload?.request?.id ?? prev?.connectionId,
        connectionSince: null,
      }))
      pushToast('Connection request sent.', 'success')
    } catch (err) {
      console.error('Failed to send connection request', err)
      pushToast('Unable to send connection request right now.', 'error')
    } finally {
      setConnectionAction(null)
    }
  }

  const handleAcceptConnectionRequest = async () => {
    if (!relationship?.connectionId) return
    const token = requireAuthToken()
    if (!token) return
    setConnectionAction('accept')
    try {
      const res = await fetch(buildApiUrl(`/connections/requests/${relationship.connectionId}/accept`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const payload = (await res.json().catch(() => null)) as ConnectionAcceptResponse | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to accept connection request.', 'error')
        return
      }
      const sinceIso = payload?.connection?.since ? new Date(payload.connection.since).toISOString() : new Date().toISOString()
      setRelationship((prev) => ({
        friendshipStatus: prev?.friendshipStatus ?? (isOwner ? 'self' : 'none'),
        friendshipId: prev?.friendshipId,
        friendshipSince: prev?.friendshipSince ?? null,
        connectionStatus: 'connected',
        connectionId: payload?.connection?.id ?? prev?.connectionId ?? relationship.connectionId,
        connectionSince: sinceIso,
      }))
      pushToast('Connection request accepted.', 'success')
    } catch (err) {
      console.error('Failed to accept connection request', err)
      pushToast('Unable to accept connection request.', 'error')
    } finally {
      setConnectionAction(null)
    }
  }

  const handleRejectConnectionRequest = async () => {
    if (!relationship?.connectionId) return
    const token = requireAuthToken()
    if (!token) return
    setConnectionAction('reject')
    try {
      const res = await fetch(buildApiUrl(`/connections/requests/${relationship.connectionId}/reject`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to dismiss connection request.', 'error')
        return
      }
      setRelationship((prev) => ({
        friendshipStatus: prev?.friendshipStatus ?? (isOwner ? 'self' : 'none'),
        friendshipId: prev?.friendshipId,
        friendshipSince: prev?.friendshipSince ?? null,
        connectionStatus: 'none',
        connectionId: undefined,
        connectionSince: null,
      }))
      pushToast('Connection request dismissed.', 'info')
    } catch (err) {
      console.error('Failed to reject connection request', err)
      pushToast('Unable to dismiss connection request.', 'error')
    } finally {
      setConnectionAction(null)
    }
  }

  const handleStartDirectMessage = async () => {
    if (!profile) return
    const token = requireAuthToken()
    if (!token) return

    setMessageLoading(true)
    try {
      const threadId = await ensureDirectThread(token)
      if (!threadId) return
      router.push(`/messages?thread=${threadId}`)
    } catch (err) {
      console.error('Failed to start direct message', err)
      pushToast('Unable to start a conversation right now.', 'error')
    } finally {
      setMessageLoading(false)
    }
  }

  const isFamilyParentProfile = Boolean(
    resolvedViewer?.accountType === 'family_member' &&
      resolvedViewer.familyMemberSession?.parentHandle?.toLowerCase() === handleParam.toLowerCase(),
  )
  const isFamilyMemberSession = resolvedViewer?.accountType === 'family_member'
  const isFamilyAccountProfile = profile?.accountType === 'family_member'
  const canFamilyMessageProfile = Boolean(isFamilyParentProfile || canDirectlyReachProfile)
  const canFamilyUnfriendProfile = Boolean(!isFamilyParentProfile && resolvedRelationship.friendshipStatus === 'friends')
  const canFamilyBlockProfile = Boolean(!isFamilyParentProfile)
  const familyCallMemberId =
    profile?.accountType === 'family_member' && profile.familyProfile?.memberId
      ? profile.familyProfile.memberId
      : resolvedViewer?.accountType === 'family_member' && isFamilyParentProfile
        ? resolvedViewer.id
        : ''
  const familyCallAudioAllowed =
    profile?.accountType === 'family_member'
      ? profile.familyProfile?.allowChildAudioCalls == null || Boolean(profile.familyProfile.allowChildAudioCalls)
      : resolvedViewer?.familyMemberSession?.allowChildAudioCalls == null || Boolean(resolvedViewer.familyMemberSession.allowChildAudioCalls)
  const familyCallVideoAllowed =
    profile?.accountType === 'family_member'
      ? profile.familyProfile?.allowChildVideoCalls == null || Boolean(profile.familyProfile.allowChildVideoCalls)
      : resolvedViewer?.familyMemberSession?.allowChildVideoCalls == null || Boolean(resolvedViewer.familyMemberSession.allowChildVideoCalls)
  const canFamilyAudioCallProfile = Boolean(
    familyCallMemberId &&
      ((profile?.accountType === 'family_member' && profile.familyProfile?.access !== 'self') || isFamilyParentProfile) &&
      familyCallAudioAllowed,
  )
  const canFamilyVideoCallProfile = Boolean(
    familyCallMemberId &&
      ((profile?.accountType === 'family_member' && profile.familyProfile?.access !== 'self') || isFamilyParentProfile) &&
      familyCallVideoAllowed,
  )

  const handleStartFamilyCall = useCallback(async (mode: 'audio' | 'video') => {
    const token = requireAuthToken()
    if (!token) return

    if (!familyCallMemberId) {
      pushToast('Unable to start this Family call right now.', 'error')
      return
    }

    setCallActionMode(mode)
    try {
      const res = await fetch(buildApiUrl('/family/calls/start'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memberId: familyCallMemberId, mode }),
      })
      const payload = (await res.json().catch(() => null)) as { call?: { id?: string | null } | null; error?: string } | null
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok || !payload?.call?.id) {
        pushToast(payload?.error ?? 'Unable to start this Family call right now.', 'error')
        return
      }

      router.push(`/family/call/${encodeURIComponent(familyCallMemberId)}?call=${encodeURIComponent(payload.call.id)}`)
    } catch (err) {
      console.error('Failed to start Family call', err)
      pushToast('Unable to start this Family call right now.', 'error')
    } finally {
      setCallActionMode(null)
    }
  }, [familyCallMemberId, router])

  const handleStartDirectCall = async (mode: 'audio' | 'video') => {
    if (!profile) return

    if (familyCallMemberId) {
      await handleStartFamilyCall(mode)
      return
    }

    if (!canDirectlyReachProfile) return

    const token = requireAuthToken()
    if (!token) return

    setCallActionMode(mode)
    try {
      const threadId = await ensureDirectThread(token)
      if (!threadId) return

      const res = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}/call/start`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode }),
      })
      const payload = (await res.json().catch(() => null)) as { call?: { id: string } | null; error?: string } | null
      if (!res.ok || !payload?.call?.id) {
        pushToast(payload?.error ?? 'Unable to start this call right now.', 'error')
        return
      }

      router.push(`/messages/call/${encodeURIComponent(threadId)}?call=${encodeURIComponent(payload.call.id)}`)
    } catch (err) {
      console.error('Failed to start direct call', err)
      pushToast('Unable to start this call right now.', 'error')
    } finally {
      setCallActionMode(null)
    }
  }

  const handleFamilyBlockUser = async () => {
    if (!profile || resolvedViewer?.accountType !== 'family_member') return
    const token = requireAuthToken()
    if (!token) return

    setFamilyBlockLoading(true)
    try {
      const res = await fetch(buildApiUrl('/family/moderation/blocks/users'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: profile.id }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to block this user right now.', 'error')
        return
      }

      setRelationship((prev) => ({
        friendshipStatus: prev?.friendshipStatus === 'self' ? 'self' : 'none',
        friendshipId: undefined,
        friendshipSince: null,
        connectionStatus: prev?.connectionStatus === 'self' ? 'self' : 'none',
        connectionId: undefined,
        connectionSince: null,
      }))
      pushToast('User blocked. Your parent has been notified.', 'success')
      router.push('/friends')
    } catch (err) {
      console.error('Failed to block user from Family shell', err)
      pushToast('Unable to block this user right now.', 'error')
    } finally {
      setFamilyBlockLoading(false)
    }
  }

  const combinedPostsForMedia = useMemo(() => {
    const seen = new Set<string>()
    const merged: ApiPost[] = []
    for (const post of [...posts, ...mediaLookupPosts]) {
      if (seen.has(post.id)) continue
      seen.add(post.id)
      merged.push(post)
    }
    return merged
  }, [mediaLookupPosts, posts])

  useEffect(() => {
    if (!profile) return
    if (mediaLookupFetched) return

    const needsAvatar = profile.avatarUrl && !combinedPostsForMedia.some((post) => post.mediaUrl === profile.avatarUrl)
    const needsCover = profile.coverUrl && !combinedPostsForMedia.some((post) => post.mediaUrl === profile.coverUrl)
    if (!needsAvatar && !needsCover) return

    const fetchLatest = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const params = new URLSearchParams({ sort: 'new', limit: '50' })
      const url = buildApiUrl(`/users/${encodeURIComponent(profile.handle)}/posts?${params.toString()}`)
      try {
        const res = await fetch(
          url,
          token
            ? {
                headers: {
                  authorization: `Bearer ${token}`,
                },
                cache: 'no-store',
              }
            : { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as { items?: ApiPost[] } | null
        if (Array.isArray(data?.items)) {
          setMediaLookupPosts(data.items)
        }
      } finally {
        setMediaLookupFetched(true)
      }
    }

    fetchLatest().catch(() => {
      /* ignore */
    })
  }, [combinedPostsForMedia, mediaLookupFetched, profile])

  const avatarPost = useMemo(
    () => combinedPostsForMedia.find((post) => profile?.avatarUrl && post.mediaUrl === profile.avatarUrl) ?? null,
    [combinedPostsForMedia, profile?.avatarUrl],
  )

  const coverPost = useMemo(
    () => combinedPostsForMedia.find((post) => profile?.coverUrl && post.mediaUrl === profile.coverUrl) ?? null,
    [combinedPostsForMedia, profile?.coverUrl],
  )

  const avatarPostUrl = avatarPost ? buildPostUrl(avatarPost) : null
  const coverPostUrl = coverPost ? buildPostUrl(coverPost) : null
  const buildFallbackThreadUrl = (postId?: string | null) => {
    if (!postId) return null
    return `/u/${handleParam}/posts/${postId}`
  }
  const avatarThreadUrl = avatarPostUrl ?? buildFallbackThreadUrl(profile?.avatarPostId)
  const coverThreadUrl = coverPostUrl ?? buildFallbackThreadUrl(profile?.coverPostId)

  const renderFamilyProfileActions = () => (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => {
          if (isFamilyParentProfile) {
            router.push(`/messages?inbox=friends&thread=family-parent-${resolvedViewer?.familyMemberSession?.parentId ?? 'parent'}`)
            return
          }
          void handleStartDirectMessage()
        }}
        disabled={messageLoading || callActionMode !== null || !canFamilyMessageProfile}
      >
        {messageLoading ? 'Opening...' : 'Message'}
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => {
          void handleStartDirectCall('audio')
        }}
        disabled={messageLoading || callActionMode !== null || !canFamilyAudioCallProfile}
      >
        <HiOutlinePhone className="mr-2 h-4 w-4" aria-hidden="true" />
        {callActionMode === 'audio' ? 'Calling...' : 'Audio Call'}
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => {
          void handleStartDirectCall('video')
        }}
        disabled={messageLoading || callActionMode !== null || !canFamilyVideoCallProfile}
      >
        <HiOutlineVideoCamera className="mr-2 h-4 w-4" aria-hidden="true" />
        {callActionMode === 'video' ? 'Starting video...' : 'Video Call'}
      </button>
      {canFamilyUnfriendProfile ? (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => setRemoveFriendModalOpen(true)}
          disabled={!canFamilyUnfriendProfile}
        >
          Unfriend
        </button>
      ) : null}
      {canFamilyBlockProfile ? (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            void handleFamilyBlockUser()
          }}
          disabled={familyBlockLoading || !canFamilyBlockProfile}
        >
          {familyBlockLoading ? 'Blocking...' : 'Block'}
        </button>
      ) : null}
    </div>
  )

  if (isFamilyAccountProfile && profile?.familyProfile?.memberId) {
    const familyAccountHeader = (
      <div className="space-y-6">
        <CivilCard
          size="hero"
          name={profileDisplayName}
          avatarAlt={profileDisplayName}
          avatarInitials={profileDisplayName}
          avatarSrc={profile.avatarUrl}
          coverUrl={coverDisplayUrl}
          isVerified={Boolean(profile.isVerified)}
          isBusiness={Boolean(profile.isPremium)}
          interactive={false}
          className="w-full"
        />
        <section className="rounded-[32px] border border-white/60 bg-white/85 p-6 text-slate-700 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Family Profile</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{profileDisplayName}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {profile.familyProfile.access === 'friend'
              ? 'Family updates shared with approved Family friends only.'
              : 'Family updates shared inside your Family circle.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">@{profile.handle}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
              {profile.familyProfile.relationshipLabel} • {profile.familyProfile.modeLabel}
            </span>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 text-center text-slate-600 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-inner">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Posts</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(profile.postCount ?? 0)}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-inner">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Member since</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatDate(profile.createdAt) || '—'}</p>
            </div>
          </div>
        </section>
      </div>
    )

    return (
      <FamilyFeedClient
        memberId={profile.familyProfile.memberId}
        readOnly
        title="Family"
        description={`Updates from ${profileDisplayName}.`}
        emptyState="No Family updates yet."
        memberDisplayName={profileDisplayName}
        memberModeBand={profile.familyProfile.modeBand}
        memberAvatarUrl={profile.avatarUrl}
        headerContent={familyAccountHeader}
      />
    )
  }

  if (isFamilyParentProfile) {
    const familyProfileHeader = profile ? (
      <div className="space-y-6">
        <CivilCard
          size="hero"
          name={profileDisplayName}
          avatarAlt={profileDisplayName}
          avatarInitials={profileDisplayName}
          avatarSrc={profile.avatarUrl}
          coverUrl={coverDisplayUrl}
          isVerified={Boolean(profile.isVerified)}
          isBusiness={Boolean(profile.isPremium)}
          interactive={false}
          className="w-full"
        />
        <section className="rounded-[32px] border border-white/60 bg-white/85 p-6 text-slate-700 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Family Profile</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{profileDisplayName}</h1>
          <p className="mt-2 text-sm text-slate-600">Latest Family updates from your parent or guardian only.</p>
          <div className="mt-4">{renderFamilyProfileActions()}</div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">@{profile.handle}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Joined {formatDate(profile.createdAt) || '—'}</span>
            {publicBirthDate ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Born {publicBirthDate}</span> : null}
          </div>
        </section>
      </div>
    ) : (
      <section className="rounded-[32px] border border-white/60 bg-white/85 p-6 text-sm text-slate-500 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        {loading ? 'Loading Family profile…' : error ?? 'Family profile not available.'}
      </section>
    )

    return (
      <FamilyFeedClient
        readOnly
        title="Family"
        description={`Updates from ${profile?.name?.trim() || resolvedViewer?.familyMemberSession?.parentName || `@${handleParam}`}.`}
        emptyState="No Family updates yet. When your parent or guardian posts here, they will appear in latest order."
        memberDisplayName={resolvedViewer?.name ?? familyView?.displayName ?? 'Family member'}
        memberModeBand={resolvedViewer?.familyMemberSession?.modeBand ?? familyView?.modeBand ?? 'JUNIOR'}
        headerContent={familyProfileHeader}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white">
      <div className="border-b border-white/60 bg-white/70 py-4 shadow-sm backdrop-blur xl:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={resolvedViewer ?? undefined} />
        </div>
      </div>

      <DashboardShell
        className="bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white"
        rightRail={rightRailContent}
        rightRailClassName="pt-8"
        mainClassName="space-y-8 pb-12"
      >
        <div className={profile ? 'space-y-6' : undefined}>
          {profile ? (
            <section className="overflow-hidden rounded-[26px] shadow-[0_28px_90px_rgba(15,23,42,0.16)]">
              <div className="relative h-[180px] w-full bg-slate-100 sm:h-[220px] xl:h-[320px]">
                {coverDisplayUrl ? (
                  <img
                    src={coverDisplayUrl}
                    alt=""
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="h-full w-full bg-[linear-gradient(135deg,#e2e8f0_0%,#f8fafc_48%,#dbeafe_100%)]" aria-hidden="true" />
                )}
              </div>
            </section>
          ) : null}

          {profile ? renderRelationshipRequestCards() : null}

          {profile && isOwner ? (
            <div className="flex flex-wrap items-center justify-center gap-3 px-2">
              <Link
                href={editAvatarHref}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
              >
                Profile photo
              </Link>
              <Link
                href={editCoverHref}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
              >
                Cover photo
              </Link>
              <a
                href="/profile/edit"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 shadow-subtle transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
              >
                Edit profile
              </a>
            </div>
          ) : null}

          <section
            className="rounded-[32px] border border-slate-200 bg-white/92 p-6 text-slate-700 shadow-[0_28px_90px_rgba(15,23,42,0.10)] backdrop-blur sm:p-8"
          >
            {profile ? (
              <>
                <div className="space-y-7">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex items-center gap-4 sm:gap-5">
                      <VerifiedAvatar
                        src={profile.avatarUrl}
                        alt={profileDisplayName}
                        initials={profileDisplayName}
                        size={120}
                        isVerified={Boolean(profile.isVerified)}
                        isBusiness={Boolean(profile.isPremium)}
                        href={avatarThreadUrl ?? undefined}
                        roundedClassName="rounded-[30px]"
                        className="shrink-0"
                      />
                      <div className="space-y-1.5">
                        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">{profileDisplayName}</h1>
                        <p className="text-base font-semibold text-slate-600 sm:text-lg">@{profile.handle}</p>
                      </div>
                    </div>

                    {!isOwner ? (
                      <div className="flex w-full flex-col items-stretch gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:max-w-[540px] xl:justify-end xl:self-center">
                        {isFamilyMemberSession ? (
                          renderFamilyProfileActions()
                        ) : (
                          <>
                            {renderConnectMenu()}
                            {renderMessageMenu()}
                            {renderInviteMenu()}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {identityPills.length ? (
                    <div className="flex flex-wrap gap-2 text-sm font-medium text-slate-600">
                      {identityPills.map((pill) => (
                        <span
                          key={pill.label}
                          className={clsx(
                            'inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium shadow-[0_1px_0_rgba(15,23,42,0.03)]',
                            pill.tone === 'verified'
                              ? 'border border-red-300 text-red-700'
                              : 'border border-slate-200 text-slate-600',
                          )}
                        >
                          {pill.iconSrc ? <img src={pill.iconSrc} alt="" className="h-4 w-4 object-contain" aria-hidden="true" /> : null}
                          {pill.label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="rounded-[28px] border border-slate-200 bg-slate-50/70 px-5 py-5 sm:px-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Profile description</p>
                    {profile.bio ? (
                      <div
                        className="mt-3 max-w-none text-sm leading-7 text-slate-600 sm:text-[15px] [&_p]:m-0 [&_p+p]:mt-3 [&_br]:content-[''] [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1 [&_a]:font-medium [&_a]:text-[var(--cc-primary)] [&_a]:underline"
                        dangerouslySetInnerHTML={{ __html: profile.bio }}
                      />
                    ) : (
                      <p className="mt-3 text-sm leading-7 text-slate-500 sm:text-[15px]">No profile description yet.</p>
                    )}
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  {profileStatCards.map((card) => {
                    const cardClassName = clsx(
                      'flex min-h-[100px] flex-col rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition',
                      card.href ? 'group hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md' : '',
                    )

                    const content = (
                      <>
                        <span className={clsx('min-h-[2.75rem] text-[13px] font-medium leading-5 tracking-normal', card.href ? 'text-slate-500 transition group-hover:text-slate-700' : 'text-slate-500')}>
                          {card.label}
                        </span>
                        <span className="mt-auto pt-4 text-[2.25rem] font-bold leading-none tracking-tight text-slate-950">{card.value}</span>
                      </>
                    )

                    return card.href ? (
                      <Link key={card.label} href={card.href} className={cardClassName}>
                        {content}
                      </Link>
                    ) : (
                      <div key={card.label} className={cardClassName}>
                        {content}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : loading ? (
              <div className="text-sm text-slate-500">Loading profile…</div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : (
              <div className="text-sm text-slate-500">Profile not available.</div>
            )}
          </section>
        </div>

        {sortedExperiences.length > 0 ? (
          <section className="rounded-[28px] border border-white/60 bg-white/90 p-6 shadow-subtle">
            <h2 className="text-lg font-semibold text-slate-900">Experience</h2>
            <ol className="mt-4 space-y-4">
              {sortedExperiences.map((exp, index) => (
                <li key={exp.id ?? `${exp.title}-${index}`} className="rounded-2xl border border-slate-100/70 bg-white/90 p-4 shadow-inner">
                  {exp.organizationProfile ? (
                    <Link
                      href={`/com/${encodeURIComponent(exp.organizationProfile.provinceCode.toLowerCase())}/${encodeURIComponent(exp.organizationProfile.communitySlug)}/orgs/${encodeURIComponent(exp.organizationProfile.slug)}`}
                      className="mb-3 block overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-slate-300"
                    >
                      <div className="relative h-16 w-full overflow-hidden">
                        {exp.organizationProfile.coverUrl ? <img src={exp.organizationProfile.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                        <div className={clsx('absolute inset-0', exp.organizationProfile.coverUrl ? 'bg-slate-900/35' : 'bg-slate-100')} />
                        <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                          <div className="h-9 w-9 overflow-hidden rounded-full border border-white/80 bg-white">
                            {exp.organizationProfile.logoUrl ? <img src={exp.organizationProfile.logoUrl} alt="" className="h-full w-full object-cover" /> : null}
                          </div>
                          <span className={clsx('text-sm font-semibold', exp.organizationProfile.coverUrl ? 'text-white' : 'text-slate-700')}>
                            {exp.organizationProfile.name}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-900">
                    <span className="font-semibold">{exp.title}</span>
                    {exp.organization ? (
                      exp.organizationProfile ? (
                        <Link
                          href={`/com/${encodeURIComponent(exp.organizationProfile.provinceCode.toLowerCase())}/${encodeURIComponent(exp.organizationProfile.communitySlug)}/orgs/${encodeURIComponent(exp.organizationProfile.slug)}`}
                          className="text-slate-600 hover:text-slate-800 hover:underline"
                        >
                          • {exp.organization}
                        </Link>
                      ) : (
                        <span className="text-slate-600">• {exp.organization}</span>
                      )
                    ) : null}
                  </div>
                  {(() => {
                    const location = parseExperienceLocation(exp.location)
                    if (!location?.label) return null
                    return location.href ? (
                      <Link href={location.href} className="mt-1 inline-block text-xs uppercase tracking-wide text-slate-500 hover:text-slate-700 hover:underline">
                        {location.label}
                      </Link>
                    ) : (
                      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{location.label}</div>
                    )
                  })()}
                  <div className="mt-2 text-xs text-slate-500">{formatExperienceRange(exp)}</div>
                  {exp.description ? <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{exp.description}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {isOwner ? (
          <>
            <CivilComposerLauncher
              coverUrl={viewer?.coverUrl ?? null}
              avatarSrc={viewer?.avatarUrl ?? null}
              avatarAlt={ownerDisplayName}
              avatarInitials={ownerInitials}
              avatarHref={viewer?.handle ? `/u/${viewer.handle}` : undefined}
              isVerified={isViewerVerified}
              isBusiness={isViewerBusiness}
              prompt={`What's on your mind, ${ownerFirstName}?`}
              actions={[
                { type: 'post', label: 'Post', icon: '📝' },
                { type: 'article', label: 'Article', icon: '📄' },
                { type: 'poll', label: 'Poll', icon: '📊' },
                { type: 'photo', label: 'Photos', icon: '📷' },
              ]}
              onPrimaryClick={() => openComposer('post')}
              onActionClick={(type) => openComposer(type as PostType)}
            />

            <Modal
              open={composerOpen}
              onClose={() => setComposerOpen(false)}
              title="Share something new"
              key={composerDefaultType}
              maxWidthClassName="max-w-3xl"
              closeOnBackdrop={false}
              closeOnEscape={false}
            >
              <PostComposer
                me={viewer}
                defaultPostType={composerDefaultType}
                allowFamilyAudience={canPostToFamily}
                onPostCreated={(post) => {
                  handlePostCreated(post)
                  setComposerOpen(false)
                }}
                variant="plain"
              />
            </Modal>
          </>
        ) : null}

        <div className="flex justify-center">
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={clsx(
                  'rounded-full px-4 py-1.5 transition',
                  sortMode === option.value
                    ? 'bg-white text-[var(--cc-primary)] shadow-subtle'
                    : 'text-slate-500 hover:text-slate-700',
                )}
                onClick={() => setSortMode(option.value)}
                disabled={loading && sortMode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {error ? (
            <section className="surface-card border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </section>
          ) : posts.length === 0 ? (
            <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
              {loading ? 'Loading posts…' : 'This user has not shared any posts yet.'}
            </section>
          ) : (
            posts.map((post) => (
              <PostFeedItem
                key={post.id}
                post={post}
                onReact={handleReact}
                viewerId={viewer?.id ?? null}
                viewer={viewer ? {
                  id: viewer.id,
                  handle: viewer.handle,
                  name: viewer.name,
                  avatarUrl: viewer.avatarUrl,
                  isPremium: viewer.isPremium,
                  isVerified: viewer.isVerified,
                } : null}
              />
            ))
          )}
        </div>

        <div className="xl:hidden">
          <RightRail />
        </div>

        <Modal
          open={inviteModalOpen}
          onClose={() => {
            if (inviteSendingKey) return
            setInviteModalOpen(false)
          }}
          title={inviteSurface === 'event' ? `Invite @${profile?.handle ?? handleParam} to an event` : `Invite @${profile?.handle ?? handleParam} to an organization`}
          maxWidthClassName="max-w-2xl"
        >
          <div className="space-y-4 p-1">
            <p className="text-sm text-slate-600">
              {inviteSurface === 'event'
                ? 'Choose one of your upcoming events. We will send a notification with a direct link.'
                : 'Choose one of your organizations. We will send a notification with a direct link.'}
            </p>

            {inviteItemsLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Loading your {inviteSurface === 'event' ? 'events' : 'organizations'}…
              </div>
            ) : inviteItemsError ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{inviteItemsError}</div>
            ) : inviteSurface === 'event' ? (
              inviteEvents.length > 0 ? (
                <div className="space-y-3">
                  {inviteEvents.map((event) => {
                    const requestKey = `event:${event.eventId}`
                    const isSending = inviteSendingKey === requestKey
                    return (
                      <button
                        key={requestKey}
                        type="button"
                        className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          void handleSendProfileInvite('event', event)
                        }}
                        disabled={Boolean(inviteSendingKey)}
                      >
                        <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                          {event.primaryPhotoUrl ? <img src={event.primaryPhotoUrl} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-900">{event.title}</div>
                          <div className="truncate text-xs text-slate-500">{event.organization.name}</div>
                          <div className="truncate text-xs text-slate-500">{formatEventStart(event.startsAt) || 'Date to be announced'}</div>
                        </div>
                        <span className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                          {isSending ? 'Sending…' : 'Invite'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  You do not have any upcoming events to invite people to yet.
                </div>
              )
            ) : inviteOrganizations.length > 0 ? (
              <div className="space-y-3">
                {inviteOrganizations.map((organization) => {
                  const requestKey = `organization:${organization.id}`
                  const isSending = inviteSendingKey === requestKey
                  return (
                    <button
                      key={requestKey}
                      type="button"
                      className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        void handleSendProfileInvite('organization', organization)
                      }}
                      disabled={Boolean(inviteSendingKey)}
                    >
                      <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                        {organization.logoUrl ? <img src={organization.logoUrl} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{organization.name}</div>
                        <div className="truncate text-xs text-slate-500">/com/{organization.provinceCode.toLowerCase()}/{organization.communitySlug.toLowerCase()}</div>
                      </div>
                      <span className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                        {isSending ? 'Sending…' : 'Invite'}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                You are not following or part of any organizations yet.
              </div>
            )}
          </div>
        </Modal>

        <Modal
          open={familyInviteModalOpen}
          onClose={() => {
            if (familyInviteSending) return
            setFamilyInviteModalOpen(false)
          }}
          title={`Add @${profile?.handle ?? handleParam} as family`}
          maxWidthClassName="max-w-lg"
        >
          <div className="space-y-4 p-1">
            <p className="text-sm text-slate-600">
              How are you related? We will send a notification with a direct link back to your profile.
            </p>

            <div className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Relationship</span>
              <details className="group relative" data-family-relationship-picker>
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-900 shadow-sm transition hover:border-slate-300 [&::-webkit-details-marker]:hidden">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Selected</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{familyInviteRelationshipLabel}</div>
                  </div>
                  <HiOutlineChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-2 space-y-2 rounded-[24px] border border-slate-200 bg-slate-50/80 p-2">
                  {FAMILY_INVITE_RELATIONSHIP_OPTIONS.map((option) => {
                    const selected = option.value === familyInviteRelationship
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={clsx(
                          'flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-semibold transition',
                          selected
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
                        )}
                        onClick={(event) => {
                          setFamilyInviteRelationship(option.value)
                          const details = event.currentTarget.closest('details')
                          if (details instanceof HTMLDetailsElement) {
                            details.open = false
                          }
                        }}
                        disabled={familyInviteSending}
                      >
                        <span>{option.label}</span>
                        {selected ? <span className="text-xs font-bold uppercase tracking-[0.24em] text-white/80">Selected</span> : null}
                      </button>
                    )
                  })}
                </div>
              </details>
            </div>

            <button
              type="button"
              className="inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                void handleSendFamilyInvite()
              }}
              disabled={familyInviteSending}
            >
              {familyInviteSending ? 'Sending…' : 'Send family request'}
            </button>
          </div>
        </Modal>

        <Modal
          open={removeFriendModalOpen}
          onClose={() => setRemoveFriendModalOpen(false)}
          title="Remove friend?"
          maxWidthClassName="max-w-md"
        >
          <div className="p-6">
            <p className="mb-6 text-slate-600">
              Are you sure you want to remove @{profile?.handle} from your friends list? You will no longer see their private posts.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                onClick={() => setRemoveFriendModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                onClick={handleRemoveFriend}
              >
                Remove friend
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          open={removeConnectionModalOpen}
          onClose={() => setRemoveConnectionModalOpen(false)}
          title="Remove connection?"
          maxWidthClassName="max-w-md"
        >
          <div className="p-6">
            <p className="mb-6 text-slate-600">Are you sure you want to remove @{profile?.handle} from your business connections?</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                onClick={() => setRemoveConnectionModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                onClick={handleRemoveConnection}
              >
                Remove connection
              </button>
            </div>
          </div>
        </Modal>
      </DashboardShell>
    </div>
  )
}
