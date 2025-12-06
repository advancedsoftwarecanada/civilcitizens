'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import PostComposer, { type ApiPost } from '../../_components/PostComposer'
import PostFeedItem from '../../_components/PostFeedItem'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { useCommunity } from './CommunityContext'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

const LOADING_COPY = {
  default: 'Loading posts…',
  empty: 'No posts in this community yet. Be the first to share an update.',
}

export default function CommunityPostsFeed() {
  const community = useCommunity()
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')
  const [viewerIsVerified, setViewerIsVerified] = useState(false)
  const [viewerId, setViewerId] = useState<string | null>(null)

  const queryDescriptor = useMemo(() => {
    const base = new URLSearchParams()
    base.set('province', community.provinceCode)
    if (community.chamberSlug) {
      base.set('chamber', community.chamberSlug)
    } else {
      base.set('municipality', community.municipalitySlug)
    }
    return base
  }, [community.chamberSlug, community.municipalitySlug, community.provinceCode])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams(queryDescriptor)
      params.set('sort', sortMode)
      const query = params.toString()
      const target = buildApiUrl(`/posts${query ? `?${query}` : ''}`)
      const res = await fetch(target, { cache: 'no-store' })
      if (!res.ok) {
        setError(res.status === 404 ? 'Community not found.' : 'Unable to load posts right now.')
        setPosts([])
        return
      }
      const payload = await res.json().catch(() => null)
      const items = Array.isArray(payload?.items) ? (payload.items as ApiPost[]) : []
      setPosts(items)
    } catch (err) {
      console.error('Failed loading community posts', err)
      setError('Unable to load posts right now.')
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [queryDescriptor, sortMode])

  useEffect(() => {
    loadPosts().catch(() => {
      /* noop */
    })
  }, [loadPosts])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('token')
    if (!token) return
    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        setViewerIsVerified(Boolean(data.isVerified || data.isPremium))
        setViewerId(data.id ?? null)
      })
      .catch(() => {
        /* ignore viewer state errors */
      })
  }, [])

  const communityTarget = useMemo(() => {
    if (!community.chamberSlug) return null
    return {
      provinceCode: community.provinceCode,
      chamberSlug: community.chamberSlug,
      chamberName: community.chamberName ?? community.regionLabel ?? community.municipalityName,
      provinceName: community.provinceName,
    }
  }, [community.chamberName, community.chamberSlug, community.municipalityName, community.provinceCode, community.provinceName, community.regionLabel])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      setPosts((prev) => {
        const withoutDuplicate = prev.filter((item) => item.id !== post.id)
        return [post, ...withoutDuplicate]
      })
    },
    [],
  )

  const handleVote = useCallback(async (postId: string, value: -1 | 0 | 1) => {
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
      console.error('Unable to vote on community post', err)
    }
  }, [])

  return (
    <div className="mx-auto max-w-screen-2xl px-4 sm:px-8">
      {communityTarget ? (
        <PostComposer
          className="rounded-3xl border border-slate-200 bg-white shadow-sm"
          communityTarget={communityTarget}
          onPostCreated={handlePostCreated}
        />
      ) : (
        <section className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Posts will unlock once this community is paired with its verified city feed. Admins can link the default community through the latest census imports.
        </section>
      )}

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
          <span className="text-slate-500">Sort</span>
          <div className="flex gap-2">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-full px-3 py-1 transition ${
                  sortMode === option.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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

      <div className="mt-6 space-y-4">
        {error ? (
          <section className="rounded-3xl border border-red-100 bg-red-50 px-6 py-6 text-sm text-red-700">
            {error}
          </section>
        ) : posts.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
            {loading ? LOADING_COPY.default : LOADING_COPY.empty}
          </section>
        ) : (
          posts.map((post) => (
            <PostFeedItem
              key={post.id}
              post={post}
              onVote={handleVote}
              viewerId={viewerId}
              viewerIsVerified={viewerIsVerified}
            />
          ))
        )}
      </div>
    </div>
  )
}
