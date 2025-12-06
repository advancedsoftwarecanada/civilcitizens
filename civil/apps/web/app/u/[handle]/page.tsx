"use client"

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
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
}

type UserProfile = {
  id: string
  handle: string
  name?: string | null
  bio?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  createdAt?: string
  experiences?: UserExperience[]
  isPremium?: boolean
  isVerified?: boolean
  followerCount?: number
  followingCount?: number
}

type UserExperience = {
  id: string
  title: string
  organization: string
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
  following: boolean
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

function formatDate(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
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

function formatCount(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0'
  return value.toLocaleString()
}

type PageProps = {
  params: {
    handle: string
  }
}

export default function UserPostsPage({ params }: PageProps) {
  const handleParam = decodeURIComponent(params.handle)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')
  const [relationship, setRelationship] = useState<ProfileRelationship | null>(null)
  const [friendshipAction, setFriendshipAction] = useState<'send' | 'accept' | 'reject' | null>(null)
  const [followLoading, setFollowLoading] = useState(false)

  const loadViewer = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    try {
      const res = await fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setViewer(data)
    } catch {
      /* ignore */
    }
  }, [])

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
              }
            : undefined,
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
        setPosts(Array.isArray(data.items) ? data.items : [])
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

  const handleVote = useCallback(
    async (postId: string, value: -1 | 0 | 1) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      try {
        const res = await fetch(buildApiUrl('/posts/vote'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId, value }),
        })
        if (!res.ok) {
          console.error('Vote request failed', await res.text())
          return
        }
        const data = await res.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }
      } catch (err) {
        console.error('Unable to vote on post', err)
      }
    },
    [],
  )

  const isOwner = viewer && profile && viewer.handle === profile.handle
  const experienceCount = profile?.experiences?.length ?? 0
  const coverDisplayUrl = profile?.coverUrl ?? null
  const ownerFirstName = viewer?.name?.split(' ')[0] ?? viewer?.handle ?? 'Citizen'
  const ownerInitials = viewer?.name ?? viewer?.handle ?? 'C'
  const isViewerVerified = Boolean(viewer?.isVerified)
  const isViewerBusiness = Boolean(viewer?.isPremium)
  const resolvedRelationship: ProfileRelationship =
    relationship ?? {
      friendshipStatus: isOwner ? 'self' : 'none',
      friendshipId: undefined,
      friendshipSince: null,
      following: false,
    }
  const followerCount = profile?.followerCount ?? 0
  const followingCount = profile?.followingCount ?? 0
  const isSendingFriendRequest = friendshipAction === 'send'
  const isAcceptingFriendRequest = friendshipAction === 'accept'
  const isRejectingFriendRequest = friendshipAction === 'reject'
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
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2 text-sm font-semibold text-emerald-700">
            <span role="img" aria-label="Handshake">
              🤝
            </span>
            Friends since {resolvedRelationship.friendshipSince ? formatDate(resolvedRelationship.friendshipSince) : 'today'}
          </div>
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
            Add friend
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

  const handleComingSoon = (label: string) => {
    pushToast(`${label} creation is coming soon.`, 'info')
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
        following: prev?.following ?? false,
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
        following: prev?.following ?? false,
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
        following: prev?.following ?? false,
      }))
      pushToast('Friend request dismissed.', 'info')
    } catch (err) {
      console.error('Failed to reject friend request', err)
      pushToast('Unable to dismiss friend request.', 'error')
    } finally {
      setFriendshipAction(null)
    }
  }

  const handleToggleFollow = async () => {
    if (!profile) return
    const token = requireAuthToken()
    if (!token) return
    const currentlyFollowing = relationship?.following ?? false
    setFollowLoading(true)
    try {
      const res = await fetch(buildApiUrl(`/users/${encodeURIComponent(profile.handle)}/follow`), {
        method: currentlyFollowing ? 'DELETE' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to update follow right now.', 'error')
        return
      }
      setRelationship((prev) => {
        if (prev) {
          return { ...prev, following: !currentlyFollowing }
        }
        return {
          friendshipStatus: isOwner ? 'self' : 'none',
          friendshipId: undefined,
          friendshipSince: null,
          following: !currentlyFollowing,
        }
      })
      setProfile((prev) => {
        if (!prev) return prev
        const delta = currentlyFollowing ? -1 : 1
        const nextCount = Math.max(0, (prev.followerCount ?? 0) + delta)
        return { ...prev, followerCount: nextCount }
      })
      pushToast(currentlyFollowing ? 'Unfollowed.' : 'Now following this citizen.', 'success')
    } catch (err) {
      console.error('Unable to toggle follow state', err)
      pushToast('Unable to update follow right now.', 'error')
    } finally {
      setFollowLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white">
      <div className="border-b border-white/60 bg-white/70 py-4 shadow-sm backdrop-blur lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} />
        </div>
      </div>

      <DashboardShell
        className="bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white"
        sidebar={<Sidebar me={viewer ?? undefined} />}
        rightRail={rightRailContent}
        rightRailClassName="pt-8"
        mainClassName="space-y-8 pb-12"
      >
        <div className={profile ? 'space-y-0' : undefined}>
          {profile ? (
            <section className="relative rounded-[36px] rounded-b-none border border-white/60 bg-white/40 shadow-[0_35px_120px_rgba(15,23,42,0.12)]">
              <div className="relative h-48 w-full overflow-hidden rounded-t-[36px] sm:h-60">
                {coverDisplayUrl ? (
                  <>
                    <img src={coverDisplayUrl} alt={`${profile.name ?? profile.handle} cover`} className="absolute inset-0 h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/20" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-r from-[#fde2d7] via-[#f7f0ff] to-[#dff3ff]" />
                )}
              </div>
            </section>
          ) : null}
          <section
            className={clsx(
              'rounded-[32px] border border-white/60 bg-white/80 p-6 text-slate-700 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8',
              profile && 'rounded-t-none border-t-0',
            )}
          >
            {profile ? (
              <>
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-200 via-amber-100 to-sky-200 blur-lg" aria-hidden="true" />
                      <VerifiedAvatar
                        src={profile.avatarUrl}
                        alt={profile.name ?? profile.handle}
                        initials={profile.name ?? profile.handle}
                        size={96}
                        isVerified={Boolean(profile.isVerified)}
                        isBusiness={Boolean(profile.isPremium)}
                        className="relative border-4 border-white"
                      />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[var(--cc-primary)]">Civic Identity</p>
                      <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{profile.name ?? profile.handle}</h1>
                      <p className="text-sm text-slate-500">@{profile.handle} · Joined {formatDate(profile.createdAt) || '—'}</p>
                    </div>
                  </div>
                  {isOwner ? (
                    <a
                      href="/settings/profile"
                      className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 shadow-subtle transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]"
                    >
                      Edit profile
                    </a>
                  ) : (
                    <div className="flex flex-col items-stretch gap-3 text-sm sm:flex-row sm:items-center">
                      {renderFriendshipPrimaryCta()}
                      <button
                        type="button"
                        className={clsx(
                          'inline-flex items-center justify-center rounded-full px-5 py-2 font-semibold transition',
                          resolvedRelationship.following
                            ? 'bg-slate-900 text-white shadow-lg hover:brightness-110'
                            : 'border border-slate-900/10 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900',
                        )}
                        onClick={handleToggleFollow}
                        disabled={followLoading}
                      >
                        {resolvedRelationship.following ? 'Following' : 'Follow'}
                      </button>
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
                <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-slate-600">
                  <span>
                    <span className="text-base text-slate-900">{formatCount(followerCount)}</span> Followers
                  </span>
                  <span>
                    <span className="text-base text-slate-900">{formatCount(followingCount)}</span> Following
                  </span>
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

        {profile?.experiences && profile.experiences.length > 0 ? (
          <section className="rounded-[28px] border border-white/60 bg-white/90 p-6 shadow-subtle">
            <h2 className="text-lg font-semibold text-slate-900">Experience</h2>
            <ol className="mt-4 space-y-4">
              {profile.experiences.map((exp, index) => (
                <li key={exp.id ?? `${exp.title}-${index}`} className="rounded-2xl border border-slate-100/70 bg-white/90 p-4 shadow-inner">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-900">
                    <span className="font-semibold">{exp.title}</span>
                    {exp.organization ? <span className="text-slate-600">• {exp.organization}</span> : null}
                  </div>
                  {exp.location ? <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{exp.location}</div> : null}
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
                  alt={viewer?.name ?? viewer?.handle ?? ownerFirstName}
                  initials={ownerInitials}
                  size={56}
                  isVerified={isViewerVerified}
                  isBusiness={isViewerBusiness}
                  className="shrink-0"
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
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Poll')}>
                  <span role="img" aria-label="Poll">📊</span>
                  Poll
                </button>
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Link')}>
                  <span role="img" aria-label="Link">🔗</span>
                  Link
                </button>
                <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Photos')}>
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
            >
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="text-slate-700">Create:</span>
                <button type="button" className={`rounded-full px-3 py-1 ${composerDefaultType === 'post' ? 'bg-[var(--cc-primary)] text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setComposerDefaultType('post')}>
                  Post
                </button>
                <button type="button" className={`rounded-full px-3 py-1 ${composerDefaultType === 'article' ? 'bg-[var(--cc-primary)] text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setComposerDefaultType('article')}>
                  Article
                </button>
                <button type="button" className="rounded-full px-3 py-1 text-slate-400" onClick={() => handleComingSoon('Poll')}>
                  Poll
                </button>
                <button type="button" className="rounded-full px-3 py-1 text-slate-400" onClick={() => handleComingSoon('Link')}>
                  Link
                </button>
                <button type="button" className="rounded-full px-3 py-1 text-slate-400" onClick={() => handleComingSoon('Photos')}>
                  Photos
                </button>
              </div>
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
                onVote={handleVote}
                viewerId={viewer?.id ?? null}
                viewerIsVerified={isViewerVerified || isViewerBusiness}
              />
            ))
          )}
        </div>

        <div className="lg:hidden">
          <RightRail />
        </div>
      </DashboardShell>
    </div>
  )
}
