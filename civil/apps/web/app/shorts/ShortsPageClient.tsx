'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactionType } from '@civil/shared'
import DashboardShell from '../_components/DashboardShell'
import type { ApiComment } from '../_components/CommentThread'
import type { ApiPost } from '../_components/PostComposer'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { addCommentToTree, normalizeCommentTree, removeCommentFromTree, removeCommentsByAuthorFromTree, updateCommentInTree } from '../_lib/comments'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import type { TopicListItem } from '../topics/TopicsRightRail'
import ShortsCommentsPanel from './ShortsCommentsPanel'
import ShortsFeedItem from './ShortsFeedItem'
import ShortsRightRail from './ShortsRightRail'

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

function isMediaPost(post: ApiPost) {
  return Boolean(post.mediaUrl || post.video?.assetId || post.video?.playbackUrl || (post.images?.length ?? 0) > 0)
}

export default function ShortsPageClient() {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const wheelLockRef = useRef(false)
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
  const [activePostId, setActivePostId] = useState<string | null>(null)
  const [commentsDrawerOpen, setCommentsDrawerOpen] = useState(false)
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [commentSort, setCommentSort] = useState<'hot' | 'new'>('hot')
  const [viewer, setViewer] = useState<{
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  } | null>(null)

  const loadFeedRef = useRef<(cursor?: string) => Promise<void>>(async () => {})
  const followedTopicSlugSet = useMemo(() => new Set(followedTopics.map((topic) => topic.slug)), [followedTopics])
  const activePost = useMemo(() => posts.find((post) => post.id === activePostId) ?? null, [activePostId, posts])

  const mergeUpdatedPost = useCallback((updatedPost: ApiPost) => {
    setPosts((current) =>
      current.map((post) => {
        if (post.id !== updatedPost.id) return post
        const incoming = updatedPost as Partial<ApiPost>
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
  }, [])

  const loadComments = useCallback(async (postId: string, sortMode: 'hot' | 'new') => {
    setCommentsLoading(true)
    setCommentsError(null)

    try {
      const response = await fetch(buildApiUrl(`/posts/${postId}/comments?sort=${sortMode}`), {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`shorts_comments_failed:${response.status}`)
      }

      const payload = (await response.json().catch(() => null)) as { comments?: ApiComment[] } | null
      setComments(normalizeCommentTree(payload?.comments ?? []))
    } catch (loadError) {
      console.error('Unable to load shorts comments', loadError)
      setComments([])
      setCommentsError('Unable to load comments right now.')
    } finally {
      setCommentsLoading(false)
    }
  }, [])

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
      const params = new URLSearchParams({ sort: sortMode, mediaOnly: 'true' })
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
        throw new Error(`shorts_feed_failed:${response.status}`)
      }

      const payload = (await response.json().catch(() => null)) as {
        topics?: TopicListItem[]
        items?: ApiPost[]
        nextCursor?: string
      } | null

      const nextTopics = Array.isArray(payload?.topics) ? payload.topics : []
      const nextItems = Array.isArray(payload?.items) ? payload.items.filter(isMediaPost) : []
      setAuthenticated(true)
      setFollowedTopics(nextTopics)
      setPosts((current) => (cursor ? dedupePostsById([...current, ...nextItems]) : dedupePostsById(nextItems)))
      if (!cursor) {
        setActivePostId(nextItems[0]?.id ?? null)
      }
      setNextCursor(payload?.nextCursor)
      setHasMore(Boolean(payload?.nextCursor))
    } catch (loadError) {
      console.error('Failed to load shorts feed', loadError)
      if (!cursor) {
        setPosts([])
        setNextCursor(undefined)
        setHasMore(false)
      }
      setError('Unable to load shorts right now.')
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
      if (!isMediaPost(post)) return
      const matchesFollowedTopic = post.topicSlugs.some((slug) => followedTopicSlugSet.has(slug))
      if (matchesFollowedTopic) {
        setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])
        setActivePostId(post.id)
        return
      }
      void loadFeedRef.current()
    },
    [followedTopicSlugSet],
  )

  const handlePostDelete = useCallback((postId: string) => {
    setPosts((current) => current.filter((post) => post.id !== postId))
    setActivePostId((current) => (current === postId ? null : current))
  }, [])

  const handlePostUpdate = useCallback((updatedPost: ApiPost) => {
    if (!isMediaPost(updatedPost)) {
      setPosts((current) => current.filter((post) => post.id !== updatedPost.id))
      return
    }
    setPosts((current) => current.map((post) => (post.id === updatedPost.id ? updatedPost : post)))
  }, [])

  useEffect(() => {
    if (!posts.length) {
      setActivePostId(null)
      return
    }
    if (!activePostId || !posts.some((post) => post.id === activePostId)) {
      setActivePostId(posts[0]?.id ?? null)
    }
  }, [activePostId, posts])

  useEffect(() => {
    if (!activePostId || !hasMore || loading || !nextCursor) return
    const activeIndex = posts.findIndex((post) => post.id === activePostId)
    if (activeIndex >= posts.length - 2) {
      void loadFeed(nextCursor)
    }
  }, [activePostId, hasMore, loadFeed, loading, nextCursor, posts])

  useEffect(() => {
    if (!commentsDrawerOpen || !activePostId) return
    void loadComments(activePostId, commentSort)
  }, [activePostId, commentSort, commentsDrawerOpen, loadComments])

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
      if (!payload?.post || !isMediaPost(payload.post)) return

      mergeUpdatedPost(payload.post)
    } catch (reactError) {
      console.error('Unable to react to shorts post', reactError)
    }
  }, [mergeUpdatedPost])

  const handleOpenComments = useCallback((postId: string) => {
    setCommentsDrawerOpen((current) => {
      const nextOpen = activePostId !== postId ? true : !current
      return nextOpen
    })
    setActivePostId(postId)
    if (activePostId !== postId || !commentsDrawerOpen) {
      void loadComments(postId, commentSort)
    }
  }, [activePostId, commentSort, commentsDrawerOpen, loadComments])

  const handleReply = useCallback(async (parentId: string | null, body: string) => {
    if (!activePost) throw new Error('post_not_loaded')

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      throw new Error('auth_required')
    }

    const requestPayload: Record<string, unknown> = { postId: activePost.id, body }
    if (parentId) {
      requestPayload.parentId = parentId
    }

    const response = await fetch(buildApiUrl('/comments'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestPayload),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || 'comment_failed')
    }

    const payload = (await response.json().catch(() => null)) as { comment?: ApiComment; post?: ApiPost | null } | null
    if (payload?.comment) {
      setComments((current) => addCommentToTree(current, payload.comment!))
      void loadComments(activePost.id, commentSort)
    }
    if (payload?.post) {
      mergeUpdatedPost(payload.post)
    }
  }, [activePost, commentSort, loadComments, mergeUpdatedPost])

  const handleCommentVote = useCallback(async (commentId: string, value: -1 | 0 | 1) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      throw new Error('auth_required')
    }

    const response = await fetch(buildApiUrl('/comments/vote'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ commentId, value }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || 'vote_failed')
    }

    const payload = (await response.json().catch(() => null)) as { comment?: ApiComment | null } | null
    if (payload?.comment) {
      setComments((current) => updateCommentInTree(current, payload.comment!))
      if (activePostId) {
        void loadComments(activePostId, commentSort)
      }
    }
  }, [activePostId, commentSort, loadComments])

  const handleCommentReported = useCallback((commentId: string) => {
    setComments((current) => removeCommentFromTree(current, commentId))
  }, [])

  const handleCommentAuthorBlocked = useCallback((authorId: string) => {
    setComments((current) => removeCommentsByAuthorFromTree(current, authorId))
  }, [])

  const hasFollowedTopics = useMemo(() => followedTopics.length > 0, [followedTopics])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || posts.length <= 1) return

    const getSections = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-shorts-post-id]'))

    const scrollToIndex = (index: number) => {
      const sections = getSections()
      const target = sections[index]
      if (!target) return
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }

    const navigate = (direction: 'prev' | 'next') => {
      if (wheelLockRef.current) return
      const currentIndex = Math.max(0, posts.findIndex((post) => post.id === activePostId))
      const nextIndex = direction === 'next'
        ? Math.min(posts.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1)

      if (nextIndex === currentIndex) return

      wheelLockRef.current = true
      setActivePostId(posts[nextIndex]?.id ?? null)
      scrollToIndex(nextIndex)
      window.setTimeout(() => {
        wheelLockRef.current = false
      }, 420)
    }

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 16) return
      event.preventDefault()
      navigate(event.deltaY > 0 ? 'next' : 'prev')
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        navigate('next')
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        navigate('prev')
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activePostId, posts])

  return (
    <DashboardShell
      rightRail={<ShortsRightRail onPostCreated={handlePostCreated} onFollowedTopicsChange={handleRightRailTopicsChange} />}
      showMobileRightRail
      mainClassName="min-h-0 xl:h-[calc(var(--cc-viewport-height)-var(--cc-top-nav-height))] xl:overflow-hidden"
      mainTopClassName="pt-3 xl:pt-3"
      rightRailTopClassName="pt-3"
    >
      <div className="relative min-h-0 xl:h-full">
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-3">
          <div className="pointer-events-auto inline-flex rounded-full border border-white/50 bg-white/80 p-1 text-xs font-semibold text-slate-500 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  sortMode === option.value
                    ? 'rounded-full bg-[var(--cc-primary)] px-4 py-1.5 text-white shadow-subtle transition'
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
          <section className="surface-card mx-auto mt-20 max-w-2xl rounded-[var(--cc-radius)] border border-red-100 bg-red-50 px-6 py-6 text-sm text-red-700 shadow-subtle">
            {error}
          </section>
        ) : loading && posts.length === 0 ? (
          <section className="surface-card mx-auto mt-20 max-w-2xl px-6 py-8 text-center text-sm text-slate-500">
            Loading shorts…
          </section>
        ) : !authenticated ? (
          <section className="surface-card mx-auto mt-20 max-w-2xl px-6 py-8 text-center text-sm text-slate-500">
            Sign in to watch media posts from the topics you follow.
          </section>
        ) : posts.length === 0 ? (
          <section className="surface-card mx-auto mt-20 max-w-2xl px-6 py-8 text-center text-sm text-slate-500">
            {loading
              ? 'Loading shorts…'
              : hasFollowedTopics
                ? 'No photo or video posts yet across the topics you follow.'
                : 'No shorts yet. Follow topics from the right rail and we will also rotate in discovery content.'}
          </section>
        ) : (
          <div className="h-full min-h-0 xl:flex xl:gap-4">
            <div className={clsx('min-h-0 transition-[width,padding] duration-300 xl:flex-1', commentsDrawerOpen && 'xl:pr-2')}>
              <div ref={scrollContainerRef} className="h-full overflow-y-auto scroll-smooth snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {posts.map((post, index) => (
                  <ShortsFeedItem
                    key={post.id}
                    post={post}
                    isActive={activePostId ? activePostId === post.id : index === 0}
                    onVisible={setActivePostId}
                    onReact={handleReact}
                    onOpenComments={handleOpenComments}
                    commentsDrawerOpen={commentsDrawerOpen && activePostId === post.id}
                  />
                ))}
                {loading && posts.length > 0 ? (
                  <div className="flex justify-center px-4 pb-6 pt-2 text-sm font-medium text-slate-500">Loading more…</div>
                ) : null}
              </div>
            </div>
            <ShortsCommentsPanel
              open={commentsDrawerOpen}
              post={activePost}
              comments={comments}
              loading={commentsLoading}
              error={commentsError}
              sortMode={commentSort}
              currentUser={viewer}
              onClose={() => setCommentsDrawerOpen(false)}
              onSortChange={setCommentSort}
              onReply={handleReply}
              onVote={handleCommentVote}
              onCommentReported={handleCommentReported}
              onCommentAuthorBlocked={handleCommentAuthorBlocked}
              onSignIn={() => redirectToAuthModal('login')}
            />
          </div>
        )}
      </div>
    </DashboardShell>
  )
}