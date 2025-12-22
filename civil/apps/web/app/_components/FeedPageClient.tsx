'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getProvinceDisplayName, normalizeProvinceCode, type ReactionType } from '@civil/shared'
import Sidebar from './Sidebar'
import PostComposer, { ApiPost, CommunityTarget, type PostType } from './PostComposer'
import { RightRail } from './RightRail'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'
import PostFeedItem from './PostFeedItem'
import DashboardShell from './DashboardShell'
import Modal from './Modal'
import { pushToast } from './useToasts'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'


export type FeedScope = 'all' | 'friends' | 'communities' | 'organizations'

export type FeedPageClientProps = {
  scope: FeedScope
  sidebarActive: string
  title: string
  description?: string
  emptyState?: string
  emptyStateCta?: { label: string; href: string }
  rightRail?: ReactNode
  province?: string
  community?: string
}

type CommunityFollowRow = {
  province: string
  communitySlug: string
  home?: boolean
  community?: {
    name?: string | null
    cityName?: string | null
    province: string
    slug: string
  } | null
}

type CommunityFollowsResponse = {
  items?: CommunityFollowRow[]
}

const mapFollowToCommunityTarget = (follow: CommunityFollowRow): CommunityTarget => {
  const normalizedProvince = normalizeProvinceCode(follow.province)
  const provinceCode = normalizedProvince ?? follow.province
  const provinceName = normalizedProvince
    ? getProvinceDisplayName(normalizedProvince) ?? normalizedProvince.toUpperCase()
    : follow.community?.province ?? follow.province.toUpperCase()

  return {
    provinceCode,
    provinceName,
    communitySlug: follow.communitySlug,
    communityName: follow.community?.name ?? follow.community?.cityName ?? follow.communitySlug,
    isHome: Boolean(follow.home),
  }
}

export default function FeedPageClient({ scope, sidebarActive, title, description, emptyState, emptyStateCta, rightRail, province, community }: FeedPageClientProps) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [communityOptions, setCommunityOptions] = useState<CommunityTarget[]>([])
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null)

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams()
    params.set('scope', scope)
    if (province) params.set('province', province)
    if (community) params.set('community', community)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [scope, province, community])

  const loadPosts = useCallback(async (cursor?: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setLoading(true)
    try {
      const query = new URLSearchParams(filterQuery)
      if (cursor) query.set('cursor', cursor)
      
      const response = await fetch(buildApiUrl(`/posts?${query.toString()}`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      if (response.status === 401) {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
        return
      }
      const data = await response.json().catch(() => ({ items: [], nextCursor: undefined, lastViewedAt: null }))
      const newItems = Array.isArray(data.items) ? data.items : []
      
      setPosts((prev) => cursor ? [...prev, ...newItems] : newItems)
      setNextCursor(data.nextCursor)
      setHasMore(!!data.nextCursor)
      if (!cursor && data.lastViewedAt) {
        setLastViewedAt(data.lastViewedAt)
      }
    } finally {
      setLoading(false)
    }
  }, [filterQuery])

  useEffect(() => {
    loadPosts().catch(() => {
      /* noop */
    })
  }, [loadPosts])

  const handleLoadMore = useCallback(() => {
    if (nextCursor && !loading) {
      loadPosts(nextCursor)
    }
  }, [nextCursor, loading, loadPosts])

  const observerTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          handleLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [hasMore, loading, handleLoadMore])

  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const provinceParam = params?.get('province')
    const chamberParam = params?.get('chamber')
    if (provinceParam && chamberParam) {
      window.location.replace(`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`)
      return
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    const bootstrap = async () => {
      try {
        const [meRes, followsRes] = await Promise.all([
          fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } }),
          fetch(buildApiUrl('/communities/follows'), { headers: { authorization: `Bearer ${token}` } }),
        ])

        if (!meRes.ok) {
          throw new Error('unauthorized')
        }

        const meData = (await meRes.json()) as MeResponse
        if (!hasHomeCommunity(meData)) {
          window.location.replace('/welcome')
          return
        }
        setMe(meData)

        if (followsRes.status === 401) {
          localStorage.removeItem('token')
          redirectToAuthModal('login')
          return
        }

        if (followsRes.ok) {
          const payload = (await followsRes.json().catch(() => null)) as CommunityFollowsResponse | null
          const followItems = Array.isArray(payload?.items) ? payload.items : []
          const deduped = new Map<string, CommunityTarget>()
          followItems.forEach((follow) => {
            const target = mapFollowToCommunityTarget(follow)
            const key = `${target.provinceCode}:${target.communitySlug}`
            deduped.set(key, target)
          })
          setCommunityOptions(Array.from(deduped.values()))
        } else {
          setCommunityOptions([])
        }
      } catch {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
      }
    }

    void bootstrap()
  }, [])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      setPosts((prev) => [post, ...prev])
    },
    [],
  )

  const handlePostDelete = useCallback(
    (postId: string) => {
      setPosts((prev) => prev.filter((p) => p.id !== postId))
    },
    [],
  )

  const handlePostUpdate = useCallback(
    (updatedPost: ApiPost) => {
      setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)))
    },
    [],
  )

  const handleReact = useCallback(
    async (postId: string, reaction: ReactionType | null) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      try {
        const res = await fetch(buildApiUrl('/posts/react'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId, reaction }),
        })
        if (!res.ok) {
          console.error('Reaction request failed', await res.text())
          return
        }
        const data = await res.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }
      } catch (err) {
        console.error('Unable to react to post', err)
      }
    },
    [],
  )

  const firstName = me?.name?.split(' ')[0] ?? 'Citizen'
  const friendlyFirstName = formatDisplayName(firstName) || firstName
  const isVerifiedUser = Boolean(me?.isVerified)
  const isBusinessUser = Boolean(me?.isPremium)
  const viewerDisplayName = me?.name ? formatDisplayName(me.name) : me?.handle ?? friendlyFirstName
  const viewerHandleNormalized = me?.handle ? me.handle.toLowerCase() : null
  // Only hide self posts in the friends feed
  const hideSelfPosts = scope === 'friends'
  const visiblePosts = useMemo(() => {
    if (!hideSelfPosts || !viewerHandleNormalized) return posts
    return posts.filter((post) => {
      const authorHandle = post.author.handle?.toLowerCase()
      return authorHandle ? authorHandle !== viewerHandleNormalized : true
    })
  }, [hideSelfPosts, posts, viewerHandleNormalized])

  const openComposer = (type: PostType = 'post') => {
    setComposerDefaultType(type)
    setComposerOpen(true)
  }

  const handleComingSoon = (label: string) => {
    pushToast(`${label} creation is coming soon.`, 'info')
  }

  const emptyLabel = emptyState ?? "No updates yet. Once the community starts posting, you'll see them here."
  const composerDefaultAudience: 'friends' | 'community' = scope === 'communities' ? 'community' : 'friends'

  const resolvedRightRail = rightRail ?? <RightRail />

  return (
    <DashboardShell sidebar={<Sidebar me={me ?? undefined} active={sidebarActive} />} rightRail={resolvedRightRail} mainClassName="space-y-6">
      <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">{title}</p>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <VerifiedAvatar
            src={me?.avatarUrl ?? null}
            alt={viewerDisplayName}
            initials={viewerDisplayName}
            size={56}
            isVerified={isVerifiedUser}
            isBusiness={isBusinessUser}
            className="shrink-0"
            href={me?.handle ? `/u/${me.handle}` : undefined}
          />
          <button
            type="button"
            className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-500 transition hover:bg-white hover:text-slate-700"
            onClick={() => openComposer('post')}
          >
            {"What's on your mind, "}
            <span>{friendlyFirstName}</span>
            {'?'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('post')}>
            <span role="img" aria-label="Post">📝</span>
            Post
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('article')}>
            <span role="img" aria-label="Article">📄</span>
            Article
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Poll')}>
            <span role="img" aria-label="Poll">📊</span>
            Poll
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Link')}>
            <span role="img" aria-label="Link">🔗</span>
            Link
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Video')}>
            <span role="img" aria-label="Video">🎥</span>
            Video
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('photo')}>
            <span role="img" aria-label="Photos">📷</span>
            Photos
          </button>
        </div>
      </section>

      <div className="space-y-4">
        {visiblePosts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            {loading ? 'Loading the latest updates…' : emptyLabel}
            {!loading && emptyStateCta ? (
              <a
                href={emptyStateCta.href}
                className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]"
              >
                {emptyStateCta.label}
              </a>
            ) : null}
          </section>
        ) : (
          <>
            {visiblePosts.map((p, i) => {
              const prevPost = visiblePosts[i - 1]
              const isFirstSeen = lastViewedAt && p.createdAt <= lastViewedAt && (i === 0 || (prevPost && prevPost.createdAt > lastViewedAt))
              return (
                <div key={p.id}>
                  {isFirstSeen ? (
                    <div className="relative my-6 flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-slate-200"></div>
                      </div>
                      <span className="relative bg-slate-50 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Caught up
                      </span>
                    </div>
                  ) : null}
                  <PostFeedItem
                    post={p}
                    onReact={handleReact}
                    onDelete={handlePostDelete}
                    onUpdate={handlePostUpdate}
                    viewerId={me?.id ?? null}
                    viewerIsVerified={isVerifiedUser || isBusinessUser}
                    communityOptions={communityOptions}
                  />
                </div>
              )
            })}
            {hasMore ? (
              <div ref={observerTarget} className="flex justify-center py-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Share something new"
        key={composerDefaultType}
        maxWidthClassName="max-w-3xl"
      >
        <PostComposer
          me={me}
          defaultPostType={composerDefaultType}
          onPostCreated={(post) => {
            handlePostCreated(post)
            setComposerOpen(false)
          }}
          variant="plain"
          communityOptions={communityOptions}
          defaultAudience={composerDefaultAudience}
        />
      </Modal>
    </DashboardShell>
  )
}
