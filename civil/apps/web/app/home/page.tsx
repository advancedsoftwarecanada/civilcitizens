"use client"

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../_components/Sidebar'
import PostComposer, { ApiPost, JURISDICTION_LABELS } from '../_components/PostComposer'
import type { Jurisdiction } from '@civil/shared'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { hasHomeChamber, type MeResponse } from '../_lib/me'

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

const JURISDICTION_FILTERS: Array<{ value: 'all' | Jurisdiction; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'federal', label: JURISDICTION_LABELS.federal },
  { value: 'provincial', label: JURISDICTION_LABELS.provincial },
  { value: 'municipal', label: JURISDICTION_LABELS.municipal },
  { value: 'citizen', label: JURISDICTION_LABELS.citizen },
]

export default function HomePage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | Jurisdiction>('all')

  const filterQuery = useMemo(() => (activeFilter === 'all' ? '' : `?jurisdiction=${activeFilter}`), [activeFilter])

  const refreshPosts = useCallback(async () => {
    setLoading(true)
    try {
  const response = await fetch(buildApiUrl(`/posts${filterQuery}`))
      const data = await response.json().catch(() => ({ items: [] }))
      setPosts(Array.isArray(data.items) ? data.items : [])
    } finally {
      setLoading(false)
    }
  }, [filterQuery])

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
      redirectToAuthModal('login')
      return
    }

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (!hasHomeChamber(data)) {
          window.location.replace('/welcome')
          return
        }
        setMe(data)
      })
      .catch(() => {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
      })
  }, [])

  useEffect(() => {
    refreshPosts().catch(() => {
      /* noop */
    })
  }, [refreshPosts])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      setPosts((prev) => (activeFilter === 'all' || post.jurisdiction === activeFilter ? [post, ...prev] : prev))
    },
    [activeFilter],
  )

  return (
  <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-7xl px-4">
          <Sidebar me={me ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:gap-0 xl:max-w-6xl xl:grid-cols-[240px_minmax(0,1fr)_260px] xl:gap-0">
        <Sidebar me={me ?? undefined} active="home" />

        <main className="space-y-4 lg:min-h-[calc(100vh-48px)] lg:px-0">
          <div className="border border-gray-200 bg-white">
            <PostComposer className="border-0 px-5 py-4" onPostCreated={handlePostCreated} />

            <div className="border-t border-gray-200 px-5">
              <div className="flex flex-wrap gap-4 text-sm">
                {JURISDICTION_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`pb-2 text-sm font-semibold transition ${
                      activeFilter === filter.value
                        ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                        : 'text-gray-400 hover:text-[var(--cc-primary)]'
                    }`}
                    onClick={() => setActiveFilter(filter.value)}
                    disabled={loading && activeFilter === filter.value}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {posts.length === 0 ? (
              <div className="border-t border-gray-200 px-5 py-4 text-center text-sm text-gray-500">
                {loading ? 'Loading the latest updates…' : "No updates yet. Once the community starts posting, you'll see them here."}
              </div>
            ) : (
              posts.map((p) => {
                const chamberUrl = buildChamberUrl(p)
                const postUrl = buildPostUrl(p)
                return (
                  <article key={p.id} className="border-t border-gray-200 px-5 py-4">
                    <header className="flex items-start gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
                        {p.author.avatarUrl ? (
                          <Image
                            src={p.author.avatarUrl}
                            alt={p.author.name ?? p.author.handle}
                            width={44}
                            height={44}
                            unoptimized
                            className="h-full w-full object-cover"
                          />
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
                          <span className="bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                            {JURISDICTION_LABELS[p.jurisdiction]}
                          </span>
                          {chamberUrl ? (
                            <Link href={chamberUrl} className="border border-gray-200 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50">
                              {p.chamberName ?? p.chamberSlug}
                            </Link>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-3 text-[15px] leading-6 text-gray-800">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                            <span className="border border-gray-300 px-2 py-0.5">
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
          </div>
        </main>

        <aside className="hidden lg:flex lg:min-h-screen lg:w-[220px] lg:flex-col lg:border-l lg:border-gray-200 lg:bg-white xl:w-[260px]">
          <div className="sticky top-0 space-y-4">
            <section className="border border-gray-200 bg-white p-4">
              <div className="border-b pb-3 text-sm font-semibold">For you</div>
              <p className="pt-3 text-sm text-gray-500">
                We&apos;ll recommend chambers and citizens to follow as this feed comes to life.
              </p>
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}
