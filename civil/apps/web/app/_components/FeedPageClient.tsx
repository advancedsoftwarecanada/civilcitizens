'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getProvinceDisplayName, normalizeProvinceCode, type ReactionType } from '@civil/shared'
import PostComposer, { ApiPost, CommunityTarget, type PostType } from './PostComposer'
import { RightRail } from './RightRail'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession } from '../_lib/authSession'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import PostFeedItem from './PostFeedItem'
import DashboardShell from './DashboardShell'
import Modal from './Modal'
import { pushToast } from './useToasts'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'


export type FeedScope = 'all' | 'friends' | 'network' | 'communities' | 'organizations'

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

type OwnedOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified?: boolean
  status?: string
  logoUrl?: string | null
  coverUrl?: string | null
}

type MemberOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified?: boolean
  logoUrl?: string | null
  coverUrl?: string | null
  role?: string
}

type OrganizationsOwnedResponse = {
  items?: OwnedOrganization[]
}

type OrganizationsMembershipsResponse = {
  items?: MemberOrganization[]
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

export default function FeedPageClient(props: FeedPageClientProps) {
  const { scope, title, description, emptyState, emptyStateCta, rightRail, province, community } = props
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [communityOptions, setCommunityOptions] = useState<CommunityTarget[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])
  const [memberOrganizations, setMemberOrganizations] = useState<MemberOrganization[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)

  const postableOrganizations = useMemo(() => {
    const ownedIds = new Set(ownedOrganizations.map((org) => org.id))
    const memberships = memberOrganizations.filter((org) => !ownedIds.has(org.id))
    return [...ownedOrganizations, ...memberships]
  }, [memberOrganizations, ownedOrganizations])

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null)
  const feedItemsContainerRef = useRef<HTMLDivElement>(null)
  const seenPostIdsRef = useRef<Set<string>>(new Set())
  const pendingImpressionIdsRef = useRef<Set<string>>(new Set())
  const impressionTimersRef = useRef<Map<string, number>>(new Map())
  const flushImpressionsTimerRef = useRef<number | null>(null)

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
    if (!cursor) {
      setPosts([])
      setNextCursor(undefined)
      setHasMore(false)
      setLastViewedAt(null)
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
        setPosts([])
        setNextCursor(undefined)
        setHasMore(false)
        setLastViewedAt(null)
        clearAuthSession()
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
    } catch {
      if (!cursor) {
        setPosts([])
        setNextCursor(undefined)
        setHasMore(false)
      }
      pushToast('Unable to load the feed right now.', 'error')
    } finally {
      setLoading(false)
    }
  }, [filterQuery])

  const flushPostImpressions = useCallback(async () => {
    if (flushImpressionsTimerRef.current) {
      window.clearTimeout(flushImpressionsTimerRef.current)
      flushImpressionsTimerRef.current = null
    }

    const postIds = Array.from(pendingImpressionIdsRef.current)
    if (!postIds.length) return
    pendingImpressionIdsRef.current.clear()

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    try {
      const response = await fetch(buildApiUrl('/posts/impressions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postIds }),
      })
      if (!response.ok) {
        for (const postId of postIds) {
          pendingImpressionIdsRef.current.add(postId)
        }
      }
    } catch {
      for (const postId of postIds) {
        pendingImpressionIdsRef.current.add(postId)
      }
    }
  }, [])

  const schedulePostImpressionFlush = useCallback(() => {
    if (flushImpressionsTimerRef.current) return
    flushImpressionsTimerRef.current = window.setTimeout(() => {
      void flushPostImpressions()
    }, 600)
  }, [flushPostImpressions])

  useEffect(() => {
    loadPosts().catch(() => {
      /* noop */
    })
  }, [loadPosts])

  useEffect(() => {
    seenPostIdsRef.current.clear()
    pendingImpressionIdsRef.current.clear()
    for (const timer of impressionTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
    impressionTimersRef.current.clear()
    if (flushImpressionsTimerRef.current) {
      window.clearTimeout(flushImpressionsTimerRef.current)
      flushImpressionsTimerRef.current = null
    }
  }, [filterQuery])

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
    const host = feedItemsContainerRef.current
    if (!host) return

    const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-feed-post-id]'))
    if (!nodes.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement
          const postId = element.dataset.feedPostId?.trim()
          if (!postId) continue

          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (seenPostIdsRef.current.has(postId) || impressionTimersRef.current.has(postId)) continue

            const timerId = window.setTimeout(() => {
              impressionTimersRef.current.delete(postId)
              if (seenPostIdsRef.current.has(postId)) return
              seenPostIdsRef.current.add(postId)
              pendingImpressionIdsRef.current.add(postId)
              schedulePostImpressionFlush()
            }, 1000)

            impressionTimersRef.current.set(postId, timerId)
          } else {
            const timerId = impressionTimersRef.current.get(postId)
            if (timerId !== undefined) {
              window.clearTimeout(timerId)
              impressionTimersRef.current.delete(postId)
            }
          }
        }
      },
      { threshold: [0.5] },
    )

    nodes.forEach((node) => observer.observe(node))

    return () => {
      observer.disconnect()
      for (const timer of impressionTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      impressionTimersRef.current.clear()
    }
  }, [schedulePostImpressionFlush, posts, scope, me?.handle])

  useEffect(() => {
    return () => {
      if (flushImpressionsTimerRef.current) {
        window.clearTimeout(flushImpressionsTimerRef.current)
      }
      void flushPostImpressions()
    }
  }, [flushPostImpressions])

  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const provinceParam = params?.get('province')
    const chamberParam = params?.get('chamber')
    if (provinceParam && chamberParam) {
      router.replace(`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`)
      return
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (cachedMe) {
      if (!hasHomeCommunity(cachedMe)) {
        router.replace('/welcome')
        return
      }
      setMe(cachedMe)
    }

    const bootstrap = async () => {
      try {
        const shouldLoadPostableOrganizations = scope === 'organizations' || scope === 'all'

        const followsPromise = fetch(buildApiUrl('/communities/follows'), {
          headers: { authorization: `Bearer ${token}` },
        })

        const ownedPromise =
          shouldLoadPostableOrganizations
            ? fetch(buildApiUrl('/organizations/owned'), {
                headers: { authorization: `Bearer ${token}` },
              })
            : null

        const membershipsPromise =
          shouldLoadPostableOrganizations
            ? fetch(buildApiUrl('/organizations/memberships'), {
                headers: { authorization: `Bearer ${token}` },
              })
            : null

        const resolvedMe = cachedMe ?? (await ensureViewerMe({ token }))
        if (!resolvedMe) {
          if (!window.localStorage.getItem('token')) {
            redirectToAuthModal('login')
            return
          }
          pushToast('Unable to load your account right now.', 'error')
          return
        }

        if (!hasHomeCommunity(resolvedMe)) {
          router.replace('/welcome')
          return
        }

        setMe(resolvedMe)

        const [followsRes, ownedRes, membershipsRes] = await Promise.all([
          followsPromise,
          ownedPromise ?? Promise.resolve(null),
          membershipsPromise ?? Promise.resolve(null),
        ])

        if (ownedRes?.status === 401 || membershipsRes?.status === 401) {
          clearAuthSession()
          redirectToAuthModal('login')
          return
        }

        if (followsRes.status === 401) {
          clearAuthSession()
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

        if (shouldLoadPostableOrganizations) {
          let ownedItems: OwnedOrganization[] = []
          if (ownedRes?.ok) {
            const payload = (await ownedRes.json().catch(() => null)) as OrganizationsOwnedResponse | null
            ownedItems = Array.isArray(payload?.items) ? payload.items : []
            setOwnedOrganizations(ownedItems)
          } else {
            setOwnedOrganizations([])
            ownedItems = []
          }

          let membershipItems: MemberOrganization[] = []
          if (membershipsRes?.ok) {
            const payload = (await membershipsRes.json().catch(() => null)) as OrganizationsMembershipsResponse | null
            membershipItems = Array.isArray(payload?.items) ? payload.items : []
            setMemberOrganizations(membershipItems)
          } else {
            setMemberOrganizations([])
            membershipItems = []
          }

          if (scope === 'organizations') {
            const ownedIds = new Set(ownedItems.map((org) => org.id))
            const combinedItems = [...ownedItems, ...membershipItems.filter((org) => !ownedIds.has(org.id))]
            setSelectedOrganizationId((prev) => {
              if (prev && combinedItems.some((org) => org.id === prev)) return prev
              if (combinedItems.length === 1 && combinedItems[0]) return combinedItems[0].id
              return ''
            })
          }
        } else {
          setOwnedOrganizations([])
          setMemberOrganizations([])
        }
      } catch {
        clearAuthSession()
        redirectToAuthModal('login')
      }
    }

    void bootstrap()
  }, [cachedMe, router, scope])

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

  const handleReact = useCallback(async (postId: string, reaction: ReactionType | null) => {
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
        setPosts((prev) =>
          prev.map((p) => {
            if (p.id !== updated.id) return p
            const incoming = updated as Partial<ApiPost>
            return {
              ...p,
              ...incoming,
              author: {
                ...p.author,
                ...((incoming.author ?? {}) as Partial<ApiPost['author']>),
              },
              organization: incoming.organization === undefined ? p.organization : incoming.organization,
              recentComments:
                Array.isArray(incoming.recentComments) && incoming.recentComments.length === 0 && (p.recentComments?.length ?? 0) > 0
                  ? p.recentComments
                  : Array.isArray(incoming.recentComments)
                    ? incoming.recentComments
                    : p.recentComments,
            }
          }),
        )
      }
    } catch (err) {
      console.error('Unable to react to post', err)
    }
  }, [])

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

  const selectedOrganization = useMemo(() => {
    if (scope !== 'organizations' || !selectedOrganizationId) return null
    return postableOrganizations.find((org) => org.id === selectedOrganizationId) ?? null
  }, [postableOrganizations, scope, selectedOrganizationId])

  const composerModalTitle = useMemo(() => {
    switch (scope) {
      case 'friends':
        return 'Share personal updates with friends and family'
      case 'network':
        return 'Share professional news with your business contacts'
      case 'communities':
        return 'Share news with your local community'
      case 'organizations':
        return selectedOrganization?.name
          ? `Share an update as ${selectedOrganization.name}`
          : 'Share updates from your organization'
      default:
        return 'Share something new'
    }
  }, [scope, selectedOrganization?.name])

  const openComposer = (type: PostType = 'post') => {
    setComposerDefaultType(type)

    if (scope === 'organizations') {
      setSelectedOrganizationId(() => {
        if (postableOrganizations.length === 1 && postableOrganizations[0]) return postableOrganizations[0].id
        return ''
      })
    }

    setComposerOpen(true)
  }

  const handleComingSoon = (label: string) => {
    pushToast(`${label} creation is coming soon.`, 'info')
  }

  const emptyLabel = emptyState ?? "No updates yet. Once the community starts posting, you'll see them here."
  const composerDefaultAudience: 'friends' | 'network' | 'community' =
    scope === 'communities' ? 'community' : scope === 'network' ? 'network' : 'friends'

  const resolvedRightRail = rightRail ?? <RightRail />

  return (
    <DashboardShell rightRail={resolvedRightRail} mainClassName="min-w-0 space-y-6">
      <section className="surface-card min-w-0 space-y-4 px-6 py-5 shadow-subtle">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {scope !== 'organizations' ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">{title}</p>
              {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
          ) : null}
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

      <div ref={feedItemsContainerRef} className="min-w-0 space-y-4">
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
                <div key={p.id} data-feed-post-id={p.id} className="min-w-0">
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
        title={composerModalTitle}
        key={composerDefaultType}
        maxWidthClassName="max-w-3xl"
      >
        {scope === 'organizations' ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Organization</span>
              <select
                className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none"
                value={selectedOrganizationId}
                onChange={(e) => setSelectedOrganizationId(e.target.value)}
              >
                <option value="" disabled>
                  Select an organization
                </option>
                {postableOrganizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
              {selectedOrganization ? (
                <p className="text-xs text-slate-500">Posting as {selectedOrganization.name}</p>
              ) : null}
            </div>

            {selectedOrganization ? (
              <PostComposer
                me={me}
                defaultPostType={composerDefaultType}
                onPostCreated={(post) => {
                  handlePostCreated(post)
                  setComposerOpen(false)
                }}
                variant="plain"
                communityOptions={communityOptions}
                businessTarget={{ businessId: selectedOrganization.id, businessName: selectedOrganization.name }}
                hideAudience
              />
            ) : (
              <p className="text-sm text-slate-600">Select an organization to start writing.</p>
            )}
          </div>
        ) : (
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
            hideAudience={scope === 'friends' || scope === 'network'}
            organizationOptions={
              scope === 'all'
                ? postableOrganizations.map((org) => ({ id: org.id, name: org.name }))
                : undefined
            }
          />
        )}
      </Modal>
    </DashboardShell>
  )
}
