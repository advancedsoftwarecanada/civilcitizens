"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../../../_components/Sidebar'
import PostComposer, { ApiPost, JURISDICTION_LABELS } from '../../../_components/PostComposer'
import type { Jurisdiction, ProvinceCode } from '@civil/shared'
import { getProvinceDisplayName } from '@civil/shared'
import { buildApiUrl } from '../../../_lib/api'
import { hasHomeChamber, type MeResponse } from '../../../_lib/me'
import { redirectToAuthModal } from '../../../_lib/authModal'
import PostFeedItem from '../../../_components/PostFeedItem'

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

type ChamberInfo = {
  code: number
  name: string
  slug: string
  province: ProvinceCode
}

type PageProps = {
  params: {
    province: string
    chamber: string
  }
}

const FILTER_OPTIONS: Array<{ value: 'all' | Jurisdiction; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'federal', label: JURISDICTION_LABELS.federal },
  { value: 'provincial', label: JURISDICTION_LABELS.provincial },
  { value: 'municipal', label: JURISDICTION_LABELS.municipal },
  { value: 'citizen', label: JURISDICTION_LABELS.citizen },
]

export default function ChamberFeedPage({ params }: PageProps) {
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)

  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [chamber, setChamber] = useState<ChamberInfo | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | Jurisdiction>('all')
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/c/')) {
      const target = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`
      window.location.replace(target)
    }
  }, [chamberParam, provinceParam])

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    try {
      const res = await fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
        return
      }
      const data = (await res.json()) as MeResponse
      if (!hasHomeChamber(data)) {
        window.location.replace('/welcome')
        return
      }
      setViewer(data)
    } catch {
      localStorage.removeItem('token')
      redirectToAuthModal('login')
      /* noop */
    }
  }, [])

  const loadChamberPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (activeFilter !== 'all') {
        params.set('jurisdiction', activeFilter)
      }
      params.set('sort', sortMode)
      const query = params.toString()
      const res = await fetch(
        `/api/chambers/${encodeURIComponent(provinceParam)}/${encodeURIComponent(chamberParam)}/posts${query ? `?${query}` : ''}`,
      )
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
  }, [activeFilter, chamberParam, provinceParam, sortMode])

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
    const provinceName = getProvinceDisplayName(chamber.province)
    return {
      provinceCode: chamber.province,
      chamberSlug: chamber.slug,
      chamberName: chamber.name,
      provinceName,
    }
  }, [chamber])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      if (sortMode === 'new' && (activeFilter === 'all' || post.jurisdiction === activeFilter)) {
        setPosts((prev) => [post, ...prev])
      } else {
        loadChamberPosts().catch(() => {
          /* noop */
        })
      }
    },
    [activeFilter, sortMode, loadChamberPosts],
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
          <Sidebar me={viewer ?? undefined} active="chambers" />
        </div>
      </div>

  <div className="mx-auto w-full max-w-5xl px-4 pb-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:gap-0 lg:px-0 xl:max-w-6xl xl:grid-cols-[240px_minmax(0,1fr)_260px] xl:gap-0">
        <Sidebar me={viewer ?? undefined} active="chambers" />

  <main className="space-y-4 lg:min-h-[calc(100vh-48px)] lg:px-0">
          <section className="border border-gray-200 bg-white px-5 py-4">
            {chamber ? (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Chamber of Citizens</div>
                <h1 className="text-xl font-semibold text-gray-900">{chamber.name}</h1>
                <div className="text-sm text-gray-600">
                  Province: {getProvinceDisplayName(chamber.province)} ({chamber.province.toUpperCase()})
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

          <div className="border border-gray-200 bg-white">
            {viewer && chamberTarget ? (
              <PostComposer className="border-0 px-5 py-4" chamberTarget={chamberTarget} onPostCreated={handlePostCreated} />
            ) : null}

            <div className={`${viewer && chamberTarget ? 'border-t border-gray-200 ' : ''}px-5`}>
              <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
                <div className="flex flex-wrap gap-4">
                  {FILTER_OPTIONS.map((filter) => (
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
                {loading ? 'Loading posts…' : 'No posts in this chamber yet. Be the first to start the conversation!'}
              </div>
            ) : (
              posts.map((post) => <PostFeedItem key={post.id} post={post} onVote={handleVote} />)
            )}
          </div>
        </main>

        <aside className="hidden lg:flex lg:min-h-screen lg:w-[220px] lg:flex-col lg:border-l lg:border-gray-200 lg:bg-white xl:w-[260px]">
          <div className="sticky top-0 space-y-4">
            <div className="border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900">Stay in the loop</div>
              <p className="mt-2 text-sm text-gray-600">
                Follow neighbouring chambers to compare conversations and keep your civic radar sharp across the region.
              </p>
            </div>
            <div className="border border-gray-200 bg-white p-4 text-sm text-gray-600">
              We&apos;re expanding chamber insights soon&mdash;expect voter stats, MP updates, and upcoming events curated for
              your riding.
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
