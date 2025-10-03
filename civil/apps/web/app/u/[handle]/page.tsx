"use client"

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../../_components/Sidebar'
import PostComposer, { ApiPost } from '../../_components/PostComposer'
import PostFeedItem from '../../_components/PostFeedItem'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
}

type UserProfile = {
  id: string
  handle: string
  name?: string | null
  bio?: string | null
  avatarUrl?: string | null
  createdAt?: string
  experiences?: UserExperience[]
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

function initialsFromUser(user: { name?: string | null; handle: string }) {
  const source = user.name || user.handle
  return source
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
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
      if (sortMode === 'new') {
        setPosts((prev) => [post, ...prev])
      } else {
        loadProfilePosts(sortMode).catch(() => {
          /* noop */
        })
      }
    },
    [loadProfilePosts, sortMode],
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

  return (
    <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} active="profile" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-72 shrink-0 lg:block">
          <Sidebar me={viewer ?? undefined} active="profile" />
        </aside>

        <main className="flex-1 space-y-6">
          <section className="rounded border bg-white p-6 shadow-sm">
            {profile ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-gray-200">
                    {profile.avatarUrl ? (
                      <Image
                        src={profile.avatarUrl}
                        alt={profile.name ?? profile.handle}
                        width={56}
                        height={56}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-gray-500">
                        {initialsFromUser(profile)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-gray-900">{profile.name ?? profile.handle}</div>
                    <div className="text-sm text-gray-500">@{profile.handle}</div>
                    <div className="text-xs text-gray-400">Joined {formatDate(profile.createdAt)}</div>
                  </div>
                </div>
              </div>
            ) : loading ? (
              <div className="text-sm text-gray-500">Loading profile…</div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : (
              <div className="text-sm text-gray-500">Profile not available.</div>
            )}
          </section>

          {profile?.bio ? (
            <section className="rounded border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">About</h2>
              <div
                className="prose prose-sm mt-3 max-w-none text-gray-800"
                dangerouslySetInnerHTML={{ __html: profile.bio }}
              />
            </section>
          ) : null}

          {profile?.experiences && profile.experiences.length > 0 ? (
            <section className="rounded border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Experience</h2>
              <ol className="mt-4 space-y-4">
                {profile.experiences.map((exp, index) => (
                  <li key={exp.id ?? `${exp.title}-${index}`} className="rounded border border-gray-100 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
                      <span className="font-semibold">{exp.title}</span>
                      {exp.organization ? <span className="text-gray-600">• {exp.organization}</span> : null}
                    </div>
                    {exp.location ? (
                      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">{exp.location}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-gray-500">{formatExperienceRange(exp)}</div>
                    {exp.description ? (
                      <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{exp.description}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <div className="border border-gray-200 bg-white">
            {viewer && profile && viewer.handle === profile.handle ? (
              <PostComposer className="border-0 px-5 py-4" onPostCreated={handlePostCreated} />
            ) : null}

            <div className={`${viewer && profile && viewer.handle === profile.handle ? 'border-t border-gray-200 ' : ''}px-5 py-3`}>
              <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
                <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">Posts</div>
                <div className="flex gap-3 text-xs uppercase tracking-wide text-gray-500">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pb-1 font-semibold transition ${
                        sortMode === option.value
                          ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                          : 'text-gray-400 hover:text-[var(--cc-primary)]'
                      }`}
                      onClick={() => setSortMode(option.value)}
                      disabled={loading && sortMode === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error ? (
              <div className="border-t border-gray-200 px-5 py-4 text-center text-sm text-red-600">{error}</div>
            ) : posts.length === 0 ? (
              <div className="border-t border-gray-200 px-5 py-4 text-center text-sm text-gray-500">
                {loading ? 'Loading posts…' : 'This user has not shared any posts yet.'}
              </div>
            ) : (
              posts.map((post) => <PostFeedItem key={post.id} post={post} onVote={handleVote} />)
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
