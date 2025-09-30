"use client"

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../_components/Sidebar'
import PostComposer, { ApiPost } from '../_components/PostComposer'

type User = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function initialsFromUser(user: { name?: string | null; handle: string }) {
  const source = user.name || user.handle
  return source
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
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

export default function HomePage() {
  const [me, setMe] = useState<User | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)

  const refreshPosts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/posts')
      const data = await response.json().catch(() => ({ items: [] }))
      setPosts(Array.isArray(data.items) ? data.items : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const provinceParam = params?.get('province')
    const chamberParam = params?.get('chamber')
    if (provinceParam && chamberParam) {
      window.location.replace(`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`)
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      window.location.href = '/login'
      return
    }

    fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject('unauthorized')))
      .then(setMe)
      .catch(() => {
        localStorage.removeItem('token')
        window.location.href = '/login'
      })

    refreshPosts().catch(() => {
      /* noop */
    })
  }, [refreshPosts])

  const handlePostCreated = useCallback((post: ApiPost) => {
    setPosts((prev) => [post, ...prev])
  }, [])

  return (
    <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-7xl px-4">
          <Sidebar me={me ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-12 gap-6 px-4 py-6">
        <Sidebar me={me ?? undefined} active="home" />

        <main className="col-span-12 space-y-6 md:col-span-9 lg:col-span-6">
          <PostComposer onPostCreated={handlePostCreated} />

          <section className="space-y-4">
            {posts.length === 0 ? (
              <div className="rounded border bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
                {loading ? 'Loading the latest updates…' : "No updates yet. Once the community starts posting, you'll see them here."}
              </div>
            ) : (
              posts.map((p) => {
                const chamberUrl = buildChamberUrl(p)
                const postUrl = buildPostUrl(p)
                return (
                  <article key={p.id} className="rounded border bg-white p-6 shadow-sm">
                    <header className="flex items-start gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
                        {p.author.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.author.avatarUrl} alt={p.author.name ?? p.author.handle} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-600">
                            {initialsFromUser(p.author)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                          <Link href={`/u/${p.author.handle}`} className="font-semibold text-gray-900 hover:underline">
                            {p.author.name ?? p.author.handle}
                          </Link>
                          <span>@{p.author.handle}</span>
                          <span className="text-xs">• {formatDate(p.createdAt)}</span>
                          {chamberUrl ? (
                            <Link href={chamberUrl} className="rounded-full border border-gray-200 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50">
                              {p.chamberName ?? p.chamberSlug}
                            </Link>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-3 text-[15px] leading-6 text-gray-800">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                            <span className="rounded-full border border-gray-300 px-2 py-0.5">
                              {p.type === 'article' ? 'Article' : 'Post'}
                            </span>
                            {p.type === 'article' && p.title ? (
                              <Link href={postUrl} className="font-semibold text-gray-700 hover:underline">
                                {p.title}
                              </Link>
                            ) : null}
                          </div>
                          {p.type === 'article' ? (
                            <Link href={postUrl} className="prose prose-sm max-w-none text-gray-700 hover:underline">
                              <span dangerouslySetInnerHTML={{ __html: p.body }} />
                            </Link>
                          ) : (
                            <Link href={postUrl} className="block whitespace-pre-wrap hover:underline">
                              {p.body}
                            </Link>
                          )}
                        </div>
                      </div>
                    </header>
                  </article>
                )
              })
            )}
          </section>
        </main>

        <aside className="col-span-3 hidden space-y-4 lg:block">
          <div className="rounded border bg-white p-4 shadow-sm">
            <div className="border-b pb-3 text-sm font-semibold">For you</div>
            <p className="pt-3 text-sm text-gray-500">
              We&apos;ll recommend chambers and citizens to follow as this feed comes to life.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
