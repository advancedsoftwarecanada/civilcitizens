"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import type { ReactionType } from '@civil/shared'
import { HiOutlineUserPlus, HiOutlineBriefcase, HiOutlinePhone, HiOutlineVideoCamera } from 'react-icons/hi2'
import CivilCard from '../../_components/CivilCard'
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
import { formatUserDisplayName } from '../../_lib/text'
import { useViewerStore } from '../../_lib/viewerStore'
import { ensureViewerMe } from '../../_lib/viewerMe'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
  accountType?: 'user' | 'family_member'
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

function formatDateRange(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
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
  const [viewer, setViewer] = useState<Viewer | null>(null)
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
  const [messageLoading, setMessageLoading] = useState(false)
  const [callActionMode, setCallActionMode] = useState<'audio' | 'video' | null>(null)
  const [familyBlockLoading, setFamilyBlockLoading] = useState(false)
  const resolvedViewer = cachedViewer ?? viewer

  const loadViewer = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    if (cachedViewer) {
      setViewer(cachedViewer)
      return
    }

    try {
      const data = await ensureViewerMe({ token })
      if (!data) return
      setViewer(data)
    } catch {
      /* ignore */
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
    setMediaLookupFetched(false)
    setMediaLookupPosts([])
  }, [handleParam])

  useEffect(() => {
    loadProfilePosts(sortMode).catch(() => {
      /* noop */
    })
  }, [loadProfilePosts, sortMode])

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
  const publicBirthDate = formatBirthDate(profile?.dateOfBirth)
  const publicBirthCountry = profile?.countryOfBirth?.trim() ?? ''
  const isSendingFriendRequest = friendshipAction === 'send'
  const isAcceptingFriendRequest = friendshipAction === 'accept'
  const isRejectingFriendRequest = friendshipAction === 'reject'
  const isSendingConnectionRequest = connectionAction === 'send'
  const isAcceptingConnectionRequest = connectionAction === 'accept'
  const isRejectingConnectionRequest = connectionAction === 'reject'
  const canDirectlyReachProfile =
    !isOwner && (resolvedRelationship.friendshipStatus === 'friends' || resolvedRelationship.connectionStatus === 'connected')
  const renderFriendshipPrimaryCta = () => {
    switch (resolvedRelationship.friendshipStatus) {
      case 'incoming':
        return (
          <div className="flex flex-col gap-2 text-sm font-semibold">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-center text-amber-700">
              This person sent you a friend request.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleAcceptFriendRequest}
                disabled={!relationship?.friendshipId || isAcceptingFriendRequest}
              >
                Accept request
              </button>
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleRejectFriendRequest}
                disabled={!relationship?.friendshipId || isRejectingFriendRequest}
              >
                Dismiss
              </button>
            </div>
          </div>
        )
      case 'outgoing':
        return (
          <div className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-5 py-2 text-sm font-semibold text-amber-700">
            Request sent
          </div>
        )
      case 'friends':
        return (
          <details className="group relative w-full sm:w-auto">
            <summary className="inline-flex w-full cursor-pointer list-none items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 sm:w-auto [&::-webkit-details-marker]:hidden">
              <span role="img" aria-label="Handshake">
                🤝
              </span>
              Friends
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition group-open:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-lg sm:absolute sm:left-0 sm:top-full sm:z-20 sm:min-w-[180px] sm:w-auto">
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
                onClick={() => setRemoveFriendModalOpen(true)}
              >
                Remove friend
              </button>
            </div>
          </details>
        )
      case 'self':
        return null
      default:
        return (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSendFriendRequest}
            disabled={isSendingFriendRequest}
          >
            <HiOutlineUserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add friend
          </button>
        )
    }
  }

  const renderConnectionPrimaryCta = () => {
    switch (resolvedRelationship.connectionStatus) {
      case 'incoming':
        return (
          <div className="flex flex-col gap-2 text-sm font-semibold">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-center text-sky-700">
              This person sent you a connection request.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleAcceptConnectionRequest}
                disabled={!relationship?.connectionId || isAcceptingConnectionRequest}
              >
                Accept connect
              </button>
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleRejectConnectionRequest}
                disabled={!relationship?.connectionId || isRejectingConnectionRequest}
              >
                Dismiss
              </button>
            </div>
          </div>
        )
      case 'outgoing':
        return (
          <div className="inline-flex items-center justify-center rounded-full border border-sky-200 bg-sky-50 px-5 py-2 text-sm font-semibold text-sky-700">
            Connect request sent
          </div>
        )
      case 'connected':
        return (
          <details className="group relative w-full sm:w-auto">
            <summary className="inline-flex w-full cursor-pointer list-none items-center justify-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-5 py-2 text-sm font-semibold text-sky-700 transition hover:border-sky-300 sm:w-auto [&::-webkit-details-marker]:hidden">
              <span role="img" aria-label="Professional connection">
                🧑‍💼
              </span>
              Connected
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition group-open:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-lg sm:absolute sm:left-0 sm:top-full sm:z-20 sm:min-w-[200px] sm:w-auto">
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
                onClick={() => setRemoveConnectionModalOpen(true)}
              >
                Remove connection
              </button>
            </div>
          </details>
        )
      case 'self':
        return null
      default:
        return (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSendConnectionRequest}
            disabled={isSendingConnectionRequest}
          >
            <HiOutlineBriefcase className="mr-2 h-4 w-4" aria-hidden="true" />
            Connect
          </button>
        )
    }
  }

  const rightRailContent = (
    <div className="sticky top-8 space-y-4">
      <RightRail />
    </div>
  )

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
      <div className="border-b border-white/60 bg-white/70 py-4 shadow-sm backdrop-blur lg:hidden">
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
            <CivilCard
              size="hero"
              name={profileDisplayName}
              avatarAlt={profileDisplayName}
              avatarInitials={profileDisplayName}
              avatarSrc={profile.avatarUrl}
              avatarHref={avatarThreadUrl ?? undefined}
              coverUrl={coverDisplayUrl}
              isVerified={Boolean(profile.isVerified)}
              isBusiness={Boolean(profile.isPremium)}
              interactive={false}
              className="w-full"
            />
          ) : null}

          <section
            className="rounded-[32px] border border-white/60 bg-white/80 p-6 text-slate-700 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8"
          >
            {profile ? (
              <>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1 text-slate-600">
                    <p className="text-lg font-semibold text-slate-900">@{profile.handle}</p>
                    <p className="text-sm">Joined {formatDate(profile.createdAt) || '—'}</p>
                    {publicBirthDate || publicBirthCountry ? (
                      <div className="flex flex-wrap gap-2 pt-1 text-xs font-medium text-slate-600">
                        {publicBirthDate ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Born {publicBirthDate}</span> : null}
                        {publicBirthCountry ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Born in {publicBirthCountry}</span> : null}
                      </div>
                    ) : null}
                  </div>
                  {isOwner ? (
                    <div className="flex flex-wrap gap-3">
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
                  ) : (
                    <div className="flex flex-col items-stretch gap-3 text-sm sm:flex-row sm:items-center">
                      {isFamilyMemberSession ? (
                        renderFamilyProfileActions()
                      ) : (
                        <>
                          {renderFriendshipPrimaryCta()}
                          {canDirectlyReachProfile ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => {
                                  void handleStartDirectCall('audio')
                                }}
                                disabled={messageLoading || callActionMode !== null}
                              >
                                <HiOutlinePhone className="mr-2 h-4 w-4" aria-hidden="true" />
                                {callActionMode === 'audio' ? 'Calling...' : 'Call'}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => {
                                  void handleStartDirectCall('video')
                                }}
                                disabled={messageLoading || callActionMode !== null}
                              >
                                <HiOutlineVideoCamera className="mr-2 h-4 w-4" aria-hidden="true" />
                                {callActionMode === 'video' ? 'Starting video...' : 'Video'}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-2 font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={handleStartDirectMessage}
                                disabled={messageLoading || callActionMode !== null}
                              >
                                {messageLoading ? 'Opening...' : 'Message'}
                              </button>
                            </div>
                          ) : null}
                          {renderConnectionPrimaryCta()}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 text-center text-slate-600 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Posts</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{posts.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Experience entries</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{experienceCount}</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Member since</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{formatDate(profile.createdAt) || '—'}</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm font-semibold text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                  <Link
                    href={`/u/${encodeURIComponent(profile.handle)}/friends`}
                    className="group flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-md"
                  >
                    <span className="text-lg font-bold text-slate-900">{formatCount(friendCount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition group-hover:text-slate-700">Friends</span>
                  </Link>
                  <Link
                    href={`/u/${encodeURIComponent(profile.handle)}/communities`}
                    className="group flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-md"
                  >
                    <span className="text-lg font-bold text-slate-900">{formatCount(communityCount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition group-hover:text-slate-700">Communities</span>
                  </Link>
                  <Link
                    href={`/u/${encodeURIComponent(profile.handle)}/organizations`}
                    className="group flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-md"
                  >
                    <span className="text-lg font-bold text-slate-900">{formatCount(organizationCount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition group-hover:text-slate-700">Organizations</span>
                  </Link>
                  <Link
                    href={`/u/${encodeURIComponent(profile.handle)}/connections`}
                    className="group flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-md"
                  >
                    <span className="text-lg font-bold text-slate-900">{formatCount(connectionCount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition group-hover:text-slate-700">Business Connections</span>
                  </Link>
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

        {profile?.bio ? (
          <section className="rounded-[28px] border border-white/60 bg-white/90 p-6 shadow-subtle">
            <h2 className="text-lg font-semibold text-slate-900">About</h2>
            <div className="prose prose-sm mt-3 max-w-none text-slate-800" dangerouslySetInnerHTML={{ __html: profile.bio }} />
          </section>
        ) : null}

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
            <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
              <div className="flex items-center gap-3">
                <VerifiedAvatar
                  src={viewer?.avatarUrl ?? null}
                  alt={ownerDisplayName}
                  initials={ownerInitials}
                  size={56}
                  isVerified={isViewerVerified}
                  isBusiness={isViewerBusiness}
                  className="shrink-0"
                  href={viewer?.handle ? `/u/${viewer.handle}` : undefined}
                />
                <button
                  type="button"
                  className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-500 transition hover:bg-white hover:text-slate-700"
                  onClick={() => openComposer('post')}
                >
                  What&apos;s on your mind, {ownerFirstName}?
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('post')}>
                  <span role="img" aria-label="Post">📝</span>
                  Post
                </button>
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('article')}>
                  <span role="img" aria-label="Article">📄</span>
                  Article
                </button>
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('poll')}>
                  <span role="img" aria-label="Poll">📊</span>
                  Poll
                </button>
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('photo')}>
                  <span role="img" aria-label="Photos">📷</span>
                  Photos
                </button>
              </div>
            </section>

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
                onPostCreated={(post) => {
                  handlePostCreated(post)
                  setComposerOpen(false)
                }}
                variant="plain"
              />
            </Modal>
          </>
        ) : null}

        <section className="surface-card px-6 py-4 shadow-subtle">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Posts</p>
              <h2 className="text-lg font-semibold text-slate-900">Updates from @{profile?.handle ?? handleParam}</h2>
            </div>
            <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-full px-4 py-1 transition ${sortMode === option.value ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500'}`}
                  onClick={() => setSortMode(option.value)}
                  disabled={loading && sortMode === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>

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
              />
            ))
          )}
        </div>

        <div className="lg:hidden">
          <RightRail />
        </div>

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
