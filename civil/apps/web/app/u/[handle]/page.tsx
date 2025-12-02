"use client"

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import Sidebar from '../../_components/Sidebar'
import PostComposer, { ApiPost } from '../../_components/PostComposer'
import PostFeedItem from '../../_components/PostFeedItem'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import DashboardShell from '../../_components/DashboardShell'

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
          setError('User not found')
          return
        }
        if (!res.ok) {
          setError('Unable to load posts right now.')
          return
        }

        const data: {
          user?: UserProfile
          items?: ApiPost[]
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
        setPosts(Array.isArray(data.items) ? data.items : [])
      } catch (err) {
        console.error('Failed loading user posts', err)
        setError('Unable to load posts right now.')
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
  const rightRailContent = (
    <div className="sticky top-8 space-y-4">
      <RightRail />
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white">
      <div className="border-b border-white/60 bg-white/70 py-4 shadow-sm backdrop-blur lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} active="profile" />
        </div>
      </div>

      <DashboardShell
        className="bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white"
        sidebar={<Sidebar me={viewer ?? undefined} active="profile" />}
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
                        isVerified={Boolean(profile.isVerified ?? profile.isPremium)}
                        className="relative border-4 border-white shadow-xl"
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
                  ) : null}
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
          <PostComposer onPostCreated={handlePostCreated} className="rounded-[28px] border border-white/60 bg-white/95 shadow-panel" />
        ) : null}

        <section className="rounded-[32px] border border-white/60 bg-white/95 shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/70 px-6 py-4">
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

          <div className="space-y-4 px-6 py-6">
            {error ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            ) : posts.length === 0 ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
                {loading ? 'Loading posts…' : 'This user has not shared any posts yet.'}
              </div>
            ) : (
              posts.map((post) => <PostFeedItem key={post.id} post={post} onVote={handleVote} />)
            )}
          </div>
        </section>

        <div className="lg:hidden">
          <RightRail />
        </div>
      </DashboardShell>
    </div>
  )
}
