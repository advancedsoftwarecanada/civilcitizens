"use client"

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../../_components/Sidebar'
import PostComposer, { ApiPost } from '../../_components/PostComposer'

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

function buildPostUrl(post: ApiPost) {
  if (post.seoSlug) {
    return `/u/${post.author.handle}/posts/${post.seoSlug}`
  }
  return `/post/${post.id}`
}

function buildChamberUrl(post: ApiPost) {
  if (post.provinceCode && post.chamberSlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}`
  }
  return null
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

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setViewer(data)
    } catch {
      /* ignore */
    }
  }, [])

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(handleParam)}/posts`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('User not found')
        } else {
          setError('Unable to load posts right now.')
        }
        return
      }
      const data = await res.json()
      setProfile(data.user ?? null)
      setPosts(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error('Failed loading user posts', err)
      setError('Unable to load posts right now.')
    } finally {
      setLoading(false)
    }
  }, [handleParam])

  useEffect(() => {
    loadViewer().catch(() => {
      /* noop */
    })
  }, [loadViewer])

  useEffect(() => {
    loadProfile().catch(() => {
      /* noop */
    })
  }, [loadProfile])

  const handlePostCreated = useCallback((post: ApiPost) => {
    setPosts((prev) => [post, ...prev])
  }, [])

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
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-gray-200">
                    {profile.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatarUrl} alt={profile.name ?? profile.handle} className="h-full w-full object-cover" />
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
                {profile.bio ? <p className="max-w-xl text-sm text-gray-600">{profile.bio}</p> : null}
              </div>
            ) : loading ? (
              <div className="text-sm text-gray-500">Loading profile…</div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : (
              <div className="text-sm text-gray-500">Profile not available.</div>
            )}
          </section>

          {viewer && profile && viewer.handle === profile.handle ? (
            <PostComposer onPostCreated={handlePostCreated} />
          ) : null}

          <section className="space-y-4">
            {error ? (
              <div className="rounded border bg-white p-6 text-center text-sm text-red-600 shadow-sm">{error}</div>
            ) : posts.length === 0 ? (
              <div className="rounded border bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
                {loading ? 'Loading posts…' : 'This user has not shared any posts yet.'}
              </div>
            ) : (
              posts.map((post) => {
                const chamberUrl = buildChamberUrl(post)
                const postUrl = buildPostUrl(post)
                return (
                  <article key={post.id} className="rounded border bg-white p-6 shadow-sm">
                    <header className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                      <span className="rounded-full border border-gray-300 px-2 py-0.5">{post.type === 'article' ? 'Article' : 'Post'}</span>
                      {post.type === 'article' && post.title ? (
                        <Link href={postUrl} className="font-semibold text-gray-700 hover:underline">
                          {post.title}
                        </Link>
                      ) : null}
                      {chamberUrl ? (
                        <Link href={chamberUrl} className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] uppercase text-gray-500 hover:bg-gray-50">
                          {post.chamberName ?? post.chamberSlug}
                        </Link>
                      ) : null}
                    </header>
                    <div className="mt-3 space-y-3 text-[15px] leading-6 text-gray-800">
                      {post.type === 'article' ? (
                        <Link href={postUrl} className="prose prose-sm max-w-none text-gray-700 hover:underline">
                          <span dangerouslySetInnerHTML={{ __html: post.body }} />
                        </Link>
                      ) : (
                        <Link href={postUrl} className="block whitespace-pre-wrap hover:underline">
                          {post.body}
                        </Link>
                      )}
                    </div>
                    <footer className="mt-4 text-xs text-gray-400">Posted {formatDate(post.createdAt)}</footer>
                  </article>
                )
              })
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
