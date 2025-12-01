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
      const matchesFilter = activeFilter === 'all' || post.jurisdiction === activeFilter
      if (matchesFilter) {
        setPosts((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== post.id)
          return [post, ...withoutDuplicate]
        })
        return
      }

      refreshPosts().catch(() => {
        /* noop */
      })
    },
    [activeFilter, refreshPosts],
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
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-screen-2xl px-4 pb-12 pt-4 sm:px-8 lg:pb-16 lg:pt-8 xl:px-12">
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px] xl:gap-10">
          <Sidebar me={me ?? undefined} active="home" />

          <main className="space-y-6">
            <section className="surface-card px-6 py-4 shadow-subtle">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">News feed</p>
                  <h1 className="text-xl font-semibold text-slate-900">{me?.name ? `Welcome back, ${me.name.split(' ')[0]}!` : 'Welcome to Civil Citizens'}</h1>
                  <p className="text-sm text-slate-500">Track what&apos;s hot inside your home chamber and beyond.</p>
                </div>
                <div className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {sortMode === 'hot' ? 'Hot sorting' : 'Newest first'}
                </div>
              </div>
            </section>

            <PostComposer onPostCreated={handlePostCreated} />

            <section className="surface-card px-6 py-4 shadow-subtle">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {JURISDICTION_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      className={`rounded-full border px-4 py-1 text-sm font-semibold transition ${
                        activeFilter === filter.value
                          ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                          : 'border-transparent bg-slate-100 text-slate-500 hover:text-slate-700'
                      }`}
                      onClick={() => setActiveFilter(filter.value)}
                      disabled={loading && activeFilter === filter.value}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`rounded-full px-3 py-1 transition ${
                        sortMode === option.value
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
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
              {posts.length === 0 ? (
                <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
                  {loading ? 'Loading the latest updates…' : "No updates yet. Once the community starts posting, you'll see them here."}
                </section>
              ) : (
                posts.map((p) => <PostFeedItem key={p.id} post={p} onVote={handleVote} />)
              )}
            </div>
          </main>

          <aside className="hidden lg:block">
            <RightRail />
          </aside>
        </div>
      </div>
    </div>
  )
}
