"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../../../_components/Sidebar'
import PostComposer, { ApiPost } from '../../../_components/PostComposer'
import type { ProvinceCode } from '@civil/shared'
import { getProvinceDisplayName } from '@civil/shared'
import { buildApiUrl } from '../../../_lib/api'
import { hasHomeChamber, type MeResponse } from '../../../_lib/me'
import { redirectToAuthModal } from '../../../_lib/authModal'
import PostFeedItem from '../../../_components/PostFeedItem'
import { RightRail } from '../../../_components/RightRail'

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

export default function ChamberFeedPage({ params }: PageProps) {
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)

  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [chamber, setChamber] = useState<ChamberInfo | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  }, [chamberParam, provinceParam, sortMode])

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

  const handlePostCreated = useCallback((post: ApiPost) => {
    setPosts((prev) => {
      const withoutDuplicate = prev.filter((item) => item.id !== post.id)
      return [post, ...withoutDuplicate]
    })
  }, [])

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
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={viewer ?? undefined} active="community" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-8 xl:px-12">
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px] xl:gap-10">
          <Sidebar me={viewer ?? undefined} active="community" />

          <main className="space-y-6">
            <section className="surface-card px-6 py-5 shadow-subtle">
              {chamber ? (
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Chamber of Citizens</div>
                  <h1 className="text-xl font-semibold text-slate-900">{chamber.name}</h1>
                  <div className="text-sm text-slate-600">
                    Province: {getProvinceDisplayName(chamber.province)} ({chamber.province.toUpperCase()})
                  </div>
                  <div className="text-xs text-slate-500">
                    {posts.length} post{posts.length === 1 ? '' : 's'} shared here.
                  </div>
                </div>
              ) : error ? (
                <div className="text-sm text-red-600">{error}</div>
              ) : (
                <div className="text-sm text-slate-500">Loading chamber information…</div>
              )}
            </section>

            {viewer && chamberTarget ? <PostComposer chamberTarget={chamberTarget} onPostCreated={handlePostCreated} /> : null}

            <section className="surface-card px-6 py-4 shadow-subtle">
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                <span className="text-slate-500">Sort</span>
                <div className="flex gap-2">
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
              {error ? (
                <section className="surface-card px-6 py-5 text-center text-sm text-red-600">{error}</section>
              ) : posts.length === 0 ? (
                <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
                  {loading ? 'Loading posts…' : 'No posts in this chamber yet. Be the first to start the conversation!'}
                </section>
              ) : (
                posts.map((post) => (
                  <PostFeedItem
                    key={post.id}
                    post={post}
                    onVote={handleVote}
                    viewerIsVerified={Boolean(viewer?.isVerified || viewer?.isPremium)}
                  />
                ))
              )}
            </div>
          </main>

          <aside className="hidden lg:block">
            <div className="sticky top-8 space-y-4">
              {chamber ? (
                <section className="surface-card space-y-4 p-5 shadow-subtle">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Chamber snapshot</p>
                    <h2 className="text-base font-semibold text-slate-900">{chamber.name}</h2>
                    <p className="text-sm text-slate-500">{getProvinceDisplayName(chamber.province)}</p>
                  </div>
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    Currently tracking {posts.length} post{posts.length === 1 ? '' : 's'} inside this chamber feed.
                  </div>
                </section>
              ) : null}

              <RightRail />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
