"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../_components/Sidebar'
import PostComposer, { ApiPost, JURISDICTION_LABELS } from '../_components/PostComposer'
import { RightRail } from '../_components/RightRail'
import type { Jurisdiction } from '@civil/shared'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { hasHomeChamber, type MeResponse } from '../_lib/me'
import PostFeedItem from '../_components/PostFeedItem'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

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
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (activeFilter !== 'all') {
      params.set('jurisdiction', activeFilter)
    }
    params.set('sort', sortMode)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [activeFilter, sortMode])

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
      if (sortMode === 'new' && (activeFilter === 'all' || post.jurisdiction === activeFilter)) {
        setPosts((prev) => [post, ...prev])
      } else {
        refreshPosts().catch(() => {
          /* noop */
        })
      }
    },
    [activeFilter, sortMode, refreshPosts],
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
          <Sidebar me={me ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:gap-0 xl:max-w-6xl xl:grid-cols-[240px_minmax(0,1fr)_260px] xl:gap-0">
        <Sidebar me={me ?? undefined} active="home" />

        <main className="space-y-4 lg:min-h-[calc(100vh-48px)] lg:px-0">
          <div className="border border-gray-200 bg-white">
            <PostComposer className="border-0 px-5 py-4" onPostCreated={handlePostCreated} />

            <div className="border-t border-gray-200 px-5">
              <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
                <div className="flex flex-wrap gap-4">
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

            {posts.length === 0 ? (
              <div className="border-t border-gray-200 px-5 py-4 text-center text-sm text-gray-500">
                {loading ? 'Loading the latest updates…' : "No updates yet. Once the community starts posting, you'll see them here."}
              </div>
            ) : (
              posts.map((p) => <PostFeedItem key={p.id} post={p} onVote={handleVote} />)
            )}
          </div>
        </main>

        <aside className="hidden lg:flex lg:min-h-screen lg:w-[220px] lg:flex-col lg:border-l lg:border-gray-200 lg:bg-white xl:w-[260px]">
          <RightRail />
        </aside>
      </div>
    </div>
  )
}
