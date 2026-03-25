'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactionType } from '@civil/shared'
import DashboardShell from '../../_components/DashboardShell'
import PostFeedItem from '../../_components/PostFeedItem'
import TopicFollowButton from '../../_components/TopicFollowButton'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { formatTopicLabel } from '../../_lib/topics'
import { useViewerStore } from '../../_lib/viewerStore'
import { ensureViewerMe } from '../../_lib/viewerMe'
import TopicComposerLauncher from '../../topics/TopicComposerLauncher'
import TopicsRightRail from '../../topics/TopicsRightRail'
import type { ApiPost } from '../../_components/PostComposer'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

type TopicPageClientProps = {
  slug: string
}

export default function TopicPageClient({ slug }: TopicPageClientProps) {
  const cachedMe = useViewerStore((state) => state.me)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [isFollowingTopic, setIsFollowingTopic] = useState(false)
  const [viewer, setViewer] = useState<{
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  } | null>(null)

  const topicLabel = useMemo(() => formatTopicLabel(slug), [slug])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ sort: sortMode })
      const response = await fetch(buildApiUrl(`/topics/${encodeURIComponent(slug)}/posts?${params.toString()}`), {
        cache: 'no-store',
      })
      if (!response.ok) {
        setPosts([])
        setError(response.status === 404 ? 'Topic not found.' : 'Unable to load this topic right now.')
        return
      }

      const payload = (await response.json().catch(() => null)) as { items?: ApiPost[] } | null
      setPosts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (loadError) {
      console.error('Failed to load topic posts', loadError)
      setPosts([])
      setError('Unable to load this topic right now.')
    } finally {
      setLoading(false)
    }
  }, [slug, sortMode])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('token')
    if (!token) {
      setViewerId(null)
      setViewer(null)
      return
    }

    if (cachedMe) {
      setViewerId(cachedMe.id ?? null)
      setViewer({
        id: cachedMe.id,
        handle: cachedMe.handle,
        name: cachedMe.name,
        avatarUrl: cachedMe.avatarUrl,
        isPremium: cachedMe.isPremium,
        isVerified: cachedMe.isVerified,
      })
      return
    }

    let cancelled = false
    void (async () => {
      const me = await ensureViewerMe({ token })
      if (cancelled || !me) return
      setViewerId(me.id ?? null)
      setViewer({
        id: me.id,
        handle: me.handle,
        name: me.name,
        avatarUrl: me.avatarUrl,
        isPremium: me.isPremium,
        isVerified: me.isVerified,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [cachedMe])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('token')
    if (!token) {
      setIsFollowingTopic(false)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(buildApiUrl('/topics/follows'), {
          headers: {
            authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })
        if (!response.ok || cancelled) return
        const payload = (await response.json().catch(() => null)) as { items?: Array<{ slug: string }> } | null
        const following = Array.isArray(payload?.items) ? payload.items.some((item) => item.slug === slug) : false
        if (!cancelled) {
          setIsFollowingTopic(following)
        }
      } catch (followError) {
        console.error('Failed to load topic follow state', followError)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [slug])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      if (!post.topicSlugs.includes(slug)) return
      setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])
    },
    [slug],
  )

  const handlePostDelete = useCallback((postId: string) => {
    setPosts((current) => current.filter((post) => post.id !== postId))
  }, [])

  const handlePostUpdate = useCallback((updatedPost: ApiPost) => {
    setPosts((current) => current.map((post) => (post.id === updatedPost.id ? updatedPost : post)))
  }, [])

  const handleReact = useCallback(async (postId: string, reaction: ReactionType | null) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    try {
      const response = await fetch(buildApiUrl('/posts/react'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId, reaction }),
      })
      if (!response.ok) return

      const payload = (await response.json().catch(() => null)) as { post?: ApiPost } | null
      if (!payload?.post) return

      setPosts((current) =>
        current.map((post) => {
          if (post.id !== payload.post!.id) return post
          const incoming = payload.post as Partial<ApiPost>
          return {
            ...post,
            ...incoming,
            author: {
              ...post.author,
              ...((incoming.author ?? {}) as Partial<ApiPost['author']>),
            },
            organization: incoming.organization === undefined ? post.organization : incoming.organization,
            recentComments:
              Array.isArray(incoming.recentComments) && incoming.recentComments.length === 0 && (post.recentComments?.length ?? 0) > 0
                ? post.recentComments
                : Array.isArray(incoming.recentComments)
                  ? incoming.recentComments
                  : post.recentComments,
          }
        }),
      )
    } catch (reactError) {
      console.error('Unable to react to topic post', reactError)
    }
  }, [])

  return (
    <DashboardShell rightRail={<TopicsRightRail />} showMobileRightRail mainClassName="min-w-0 space-y-6">
      <section className="surface-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="min-w-0 flex-1 text-3xl font-semibold tracking-tight text-slate-950">#{topicLabel || slug}</h1>
          <TopicFollowButton slug={slug} initialFollowing={isFollowingTopic} onChange={setIsFollowingTopic} />
        </div>
      </section>

      <TopicComposerLauncher
        guestPrompt={`Sign in to post about #${slug}`}
        modalTitle={`Share an update about #${slug}`}
        onPostCreated={handlePostCreated}
      />

      <div className="min-w-0 space-y-4">
        <div className="flex justify-center">
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  sortMode === option.value
                    ? 'rounded-full bg-white px-4 py-1.5 text-[var(--cc-primary)] shadow-subtle transition'
                    : 'rounded-full px-4 py-1.5 text-slate-500 transition hover:text-slate-700'
                }
                onClick={() => setSortMode(option.value)}
                disabled={loading && sortMode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <section className="rounded-[var(--cc-radius)] border border-red-100 bg-red-50 px-6 py-6 text-sm text-red-700 shadow-subtle">
            {error}
          </section>
        ) : posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            {loading ? 'Loading posts…' : `No posts tagged #${slug} yet.`}
          </section>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="min-w-0">
              <PostFeedItem
                post={post}
                onReact={handleReact}
                onDelete={handlePostDelete}
                onUpdate={handlePostUpdate}
                viewerId={viewerId}
                viewer={viewer}
              />
            </div>
          ))
        )}
      </div>
    </DashboardShell>
  )
}
