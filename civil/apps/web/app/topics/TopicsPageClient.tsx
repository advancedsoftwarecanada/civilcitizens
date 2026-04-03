'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactionType } from '@civil/shared'
import DashboardShell from '../_components/DashboardShell'
import PostFeedItem from '../_components/PostFeedItem'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import TopicComposerLauncher from './TopicComposerLauncher'
import TopicsRightRail, { type TopicListItem } from './TopicsRightRail'
import type { ApiPost } from '../_components/PostComposer'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

function dedupePostsById(items: ApiPost[]) {
  const deduped = new Map<string, ApiPost>()
  for (const item of items) {
    deduped.set(item.id, item)
  }
  return Array.from(deduped.values())
}

export default function TopicsPageClient() {
  const cachedMe = useViewerStore((state) => state.me)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [followedTopics, setFollowedTopics] = useState<TopicListItem[]>([])
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  } | null>(null)

  const followedTopicSlugSet = useMemo(() => new Set(followedTopics.map((topic) => topic.slug)), [followedTopics])
  const loadFeedRef = useRef<(cursor?: string) => Promise<void>>(async () => {})

  const loadFeed = useCallback(async (cursor?: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setAuthenticated(false)
      setFollowedTopics([])
      setPosts([])
      setNextCursor(undefined)
      setHasMore(false)
      setError(null)
      setLoading(false)
      return
    }

    if (!cursor) {
      setPosts([])
      setNextCursor(undefined)
      setHasMore(false)
    }
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ sort: sortMode })
      if (cursor) {
        params.set('cursor', cursor)
      }
      const response = await fetch(buildApiUrl(`/topics/feed?${params.toString()}`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      })
      if (response.status === 401) {
        setAuthenticated(false)
        setFollowedTopics([])
        setPosts([])
        setNextCursor(undefined)
        setHasMore(false)
        setError(null)
        return
      }
      if (!response.ok) {
        throw new Error(`topic_feed_failed:${response.status}`)
      }

      const payload = (await response.json().catch(() => null)) as {
        topics?: TopicListItem[]
        items?: ApiPost[]
        nextCursor?: string
      } | null

      const nextTopics = Array.isArray(payload?.topics) ? payload.topics : []
      const nextItems = Array.isArray(payload?.items) ? payload.items : []
      setAuthenticated(true)
      setFollowedTopics(nextTopics)
      setPosts((current) => (cursor ? dedupePostsById([...current, ...nextItems]) : dedupePostsById(nextItems)))
      setNextCursor(payload?.nextCursor)
      setHasMore(Boolean(payload?.nextCursor))
    } catch (loadError) {
      console.error('Failed to load followed topic feed', loadError)
      if (!cursor) {
        setPosts([])
        setNextCursor(undefined)
        setHasMore(false)
      }
      setError('Unable to load your topic feed right now.')
    } finally {
      setLoading(false)
    }
  }, [sortMode])

  useEffect(() => {
    loadFeedRef.current = loadFeed
  }, [loadFeed])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

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

  const handleRightRailTopicsChange = useCallback((items: TopicListItem[], nextAuthenticated: boolean) => {
    setAuthenticated(nextAuthenticated)
    setFollowedTopics(items)
    void loadFeedRef.current()
  }, [])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      if (!post.topicSlugs.length) return
      const matchesFollowedTopic = post.topicSlugs.some((slug) => followedTopicSlugSet.has(slug))
      if (matchesFollowedTopic) {
        setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])
        return
      }
      void loadFeedRef.current()
    },
    [followedTopicSlugSet],
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
      console.error('Unable to react to followed topic post', reactError)
    }
  }, [])

  return (
    <DashboardShell
      rightRail={<TopicsRightRail onFollowedTopicsChange={handleRightRailTopicsChange} />}
      showMobileRightRail
      mainClassName="space-y-6"
    >
      <TopicComposerLauncher guestPrompt="Sign in to post about issues and topics" modalTitle="Share a public topic post" />

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
        ) : loading && posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            Loading your topic feed…
          </section>
        ) : !authenticated ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            Sign in to see posts from the topics you follow.
          </section>
        ) : posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            {loading
              ? 'Loading your topic feed…'
              : followedTopics.length === 0
                ? 'No topic posts yet. Follow topics from the right rail and we will also mix in discovery topics for you.'
                : 'No posts yet across the topics you follow.'}
          </section>
        ) : (
          <>
            {posts.map((post) => (
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
            ))}
            {hasMore ? (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => void loadFeed(nextCursor)}
                  disabled={loading || !nextCursor}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </DashboardShell>
  )
}
