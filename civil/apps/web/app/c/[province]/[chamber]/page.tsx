"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../../../_components/Sidebar'
import PostComposer, { ApiPost } from '../../../_components/PostComposer'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
}

type ChamberInfo = {
  provinceCode: string
  provinceName: string
  slug: string
  name: string
}

type PageProps = {
  params: {
    province: string
    chamber: string
  }
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

function buildPostUrl(post: ApiPost) {
  if (post.seoSlug && post.provinceCode && post.chamberSlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}/posts/${post.seoSlug}`
  }
  if (post.seoSlug) {
    return `/u/${post.author.handle}/posts/${post.seoSlug}`
  }
  return `/post/${post.id}`
}

export default function ChamberFeedPage({ params }: PageProps) {
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)

  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [chamber, setChamber] = useState<ChamberInfo | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/c/')) {
      const target = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`
      window.location.replace(target)
    }
  }, [chamberParam, provinceParam])

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setViewer(data)
    } catch {
      /* noop */
    }
  }, [])

  const loadChamberPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/chambers/${encodeURIComponent(provinceParam)}/${encodeURIComponent(chamberParam)}/posts`)
      if (!res.ok) {
        setError(res.status === 404 ? 'Chamber not found.' : 'Unable to load chamber posts right now.')
        return
      }
      const data = await res.json()
      setChamber(data.chamber ?? null)
      setPosts(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error('Failed loading chamber posts', err)
      setError('Unable to load chamber posts right now.')
    } finally {
      setLoading(false)
    }
  }, [chamberParam, provinceParam])

  useEffect(() => {
    loadViewer().catch(() => {
      /* noop */
    })
  }, [loadViewer])

  useEffect(() => {
    loadChamberPosts().catch(() => {
      /* noop */
    })
  }, [loadChamberPosts])

  const chamberTarget = useMemo(() => {
    if (!chamber) return null
    return {
      provinceCode: chamber.provinceCode,
      chamberSlug: chamber.slug,
      chamberName: chamber.name,
      provinceName: chamber.provinceName,
    }
  }, [chamber])

  const handlePostCreated = useCallback((post: ApiPost) => {
    setPosts((prev) => [post, ...prev])
  }, [])

  return (
    <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-7xl px-4">
          <Sidebar me={viewer ?? undefined} active="chambers" />
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-12 gap-6 px-4 py-6">
        <Sidebar me={viewer ?? undefined} active="chambers" />

        <main className="col-span-12 space-y-6 md:col-span-9 lg:col-span-6">
          <section className="rounded border bg-white p-6 shadow-sm">
            {chamber ? (
              <div className="flex flex-col gap-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Chamber of Citizens</div>
                <h1 className="text-2xl font-semibold text-gray-900">{chamber.name}</h1>
                <div className="text-sm text-gray-600">
                  Province: {chamber.provinceName} ({chamber.provinceCode.toUpperCase()})
                </div>
                <div className="text-xs text-gray-400">
                  {posts.length} post{posts.length === 1 ? '' : 's'} shared here.
                </div>
              </div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : (
              <div className="text-sm text-gray-500">Loading chamber information…</div>
            )}
          </section>

          {viewer && chamberTarget ? (
            <PostComposer chamberTarget={chamberTarget} onPostCreated={handlePostCreated} />
          ) : null}

          <section className="space-y-4">
            {error ? (
              <div className="rounded border bg-white p-6 text-center text-sm text-red-600 shadow-sm">{error}</div>
            ) : posts.length === 0 ? (
              <div className="rounded border bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
                {loading ? 'Loading posts…' : 'No posts in this chamber yet. Be the first to start the conversation!'}
              </div>
            ) : (
              posts.map((post) => {
                const postUrl = buildPostUrl(post)
                return (
                  <article key={post.id} className="rounded border bg-white p-6 shadow-sm">
                    <header className="flex items-start gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
                        {post.author.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={post.author.avatarUrl} alt={post.author.name ?? post.author.handle} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-600">
                            {(post.author.name || post.author.handle).substring(0, 1).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                          <Link href={`/u/${post.author.handle}`} className="font-semibold text-gray-900 hover:underline">
                            {post.author.name ?? post.author.handle}
                          </Link>
                          <span>@{post.author.handle}</span>
                          <span className="text-xs">• {formatDate(post.createdAt)}</span>
                        </div>
                        <div className="mt-3 space-y-3 text-[15px] leading-6 text-gray-800">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                            <span className="rounded-full border border-gray-300 px-2 py-0.5">
                              {post.type === 'article' ? 'Article' : 'Post'}
                            </span>
                            {post.type === 'article' && post.title ? (
                              <Link href={postUrl} className="font-semibold text-gray-700 hover:underline">
                                {post.title}
                              </Link>
                            ) : null}
                          </div>
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
                      </div>
                    </header>
                  </article>
                )
              })
            )}
          </section>
        </main>

        <aside className="col-span-3 hidden lg:block">
          <div className="sticky top-4 space-y-4">
            <div className="rounded border bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Stay in the loop</div>
              <p className="mt-2 text-sm text-gray-600">
                Follow neighbouring chambers to compare conversations and keep your civic radar sharp across the region.
              </p>
            </div>
            <div className="rounded border bg-white p-4 shadow-sm text-sm text-gray-600">
              We&apos;re expanding chamber insights soon&mdash;expect voter stats, MP updates, and upcoming events curated for
              your riding.
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
