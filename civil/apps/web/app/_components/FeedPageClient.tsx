'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { getProvinceDisplayName, normalizeProvinceCode, type ReactionType } from '@civil/shared'
import PostComposer, { ApiPost, CommunityTarget, type PostType } from './PostComposer'
import { RightRail } from './RightRail'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession, hasPendingFamilySessionBootstrap } from '../_lib/authSession'
import { buildApiUrl } from '../_lib/api'
import { hasDeclaredCivilStatus, hasHomeCommunity, type MeResponse } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import PostFeedItem from './PostFeedItem'
import DashboardShell from './DashboardShell'
import Modal from './Modal'
import { pushToast } from './useToasts'
import VerifiedAvatar from './VerifiedAvatar'
import CivilComposerLauncher from './CivilComposerLauncher'
import { formatDisplayName } from '../_lib/text'


export type FeedScope = 'all' | 'friends' | 'network' | 'communities' | 'organizations'
type FeedSortMode = 'new' | 'hot'

export type FeedPageClientProps = {
  scope: FeedScope
  sidebarActive: string
  title: string
  description?: string
  headerContent?: ReactNode
  emptyState?: string
  emptyStateCta?: { label: string; href: string }
  rightRail?: ReactNode
  province?: string
  community?: string
  defaultSort?: FeedSortMode
  sortOptions?: Array<{ value: FeedSortMode; label: string; description?: string }>
  showFeedSummary?: boolean
  showSupplementalFeedItems?: boolean
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

type CommunityEventFeedItem = {
  id: string
  title: string
  description: string | null
  startsAt: string
  primaryPhotoUrl: string | null
  signal?: {
    label: string
    strength: 'high' | 'medium' | 'low'
  }
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    isVerified: boolean
  }
}

type CommunityEventsResponse = {
  items?: CommunityEventFeedItem[]
}

type CommunityJobFeedItem = {
  id: string
  title: string
  photoUrl: string | null
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  description: string | null
  location: string
  publishedAt: string | null
  signal?: {
    label: string
    strength: 'high' | 'medium' | 'low'
  }
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
}

type CommunityJobsResponse = {
  sponsored?: CommunityJobFeedItem[]
  items?: CommunityJobFeedItem[]
}

type SupplementalActivityItem =
  | ({ kind: 'event' } & CommunityEventFeedItem)
  | ({ kind: 'job' } & CommunityJobFeedItem)

type FeedActivityResponse = {
  events?: CommunityEventFeedItem[]
  jobs?: CommunityJobFeedItem[]
  items?: SupplementalActivityItem[]
  context?: {
    scope?: FeedScope
    communityCount?: number
    organizationCount?: number
  }
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

const buildCommunityKey = (provinceCode: string | null | undefined, communitySlug: string | null | undefined) => {
  if (!provinceCode || !communitySlug) return null
  return `${provinceCode.toUpperCase()}:${communitySlug.toLowerCase()}`
}

function truncatePreview(value: string | null | undefined, maxChars = 140) {
  const text = (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
    .replace(/\s+/g, ' ')

  if (!text) return null
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}…`
}

function formatCommunityEventDate(isoString: string) {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return 'Upcoming event'
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function parseJobLocationLabel(value: string) {
  const trimmed = (value || '').trim()
  if (!trimmed) return 'Location not set'
  if (trimmed === 'special:remote') return 'Remote'
  if (trimmed === 'special:not_in_canada') return 'Not in Canada'
  if (!trimmed.startsWith('community:')) return 'Location not set'

  const body = trimmed.slice('community:'.length)
  const [head, labelPart] = body.split('|')
  const [, communitySlug] = (head ?? '').split(':')
  const label = (labelPart ?? '').trim()
  if (label) return label
  return (communitySlug ?? '').replace(/-/g, ' ')
}

function formatJobSalary(job: CommunityJobFeedItem) {
  const currency = job.salaryCurrency ?? 'CAD'
  if (typeof job.salaryMin !== 'number' && typeof job.salaryMax !== 'number') return null
  const min = typeof job.salaryMin === 'number' ? job.salaryMin.toLocaleString() : null
  const max = typeof job.salaryMax === 'number' ? job.salaryMax.toLocaleString() : null
  const range = min && max ? `${currency} ${min} - ${max}` : `${currency} ${min ?? max}`
  return job.salaryPeriod ? `${range} / ${job.salaryPeriod}` : range
}

function activitySignalClassName(strength: 'high' | 'medium' | 'low' | undefined) {
  if (strength === 'high') return 'border-[var(--cc-primary)]/20 bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
  if (strength === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function getCommunityEventHref(event: CommunityEventFeedItem) {
  if (event.organization.provinceCode && event.organization.communitySlug) {
    return `/com/${encodeURIComponent(event.organization.provinceCode.toLowerCase())}/${encodeURIComponent(event.organization.communitySlug)}/orgs/${encodeURIComponent(event.organization.slug)}/events/${encodeURIComponent(event.id)}`
  }
  return `/events/${encodeURIComponent(event.organization.id)}/${encodeURIComponent(event.id)}`
}

function getCommunityJobHref(job: CommunityJobFeedItem) {
  if (!job.organization.provinceCode || !job.organization.communitySlug) return null
  return `/com/${encodeURIComponent(job.organization.provinceCode.toLowerCase())}/${encodeURIComponent(job.organization.communitySlug)}/orgs/${encodeURIComponent(job.organization.slug)}/jobs/${encodeURIComponent(job.id)}`
}

function formatSnapshotValue(value: number) {
  return value.toLocaleString()
}

const SMART_HOME_SEEN_STORAGE_KEY = 'cc:smart-home-seen:v1'
const SMART_HOME_SEEN_STORAGE_LIMIT = 400

function dedupePostsById(items: ApiPost[]) {
  const deduped = new Map<string, ApiPost>()
  for (const item of items) {
    deduped.set(item.id, item)
  }
  return Array.from(deduped.values())
}

function hashSmartFeedValue(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function loadSmartHomeSeenIds() {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.sessionStorage.getItem(SMART_HOME_SEEN_STORAGE_KEY)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))
  } catch {
    return new Set<string>()
  }
}

function markSmartHomePostSeen(postId: string) {
  if (typeof window === 'undefined' || !postId) return
  try {
    const existing = Array.from(loadSmartHomeSeenIds()).filter((value) => value !== postId)
    existing.push(postId)
    window.sessionStorage.setItem(
      SMART_HOME_SEEN_STORAGE_KEY,
      JSON.stringify(existing.slice(-SMART_HOME_SEEN_STORAGE_LIMIT)),
    )
  } catch {
    // Ignore storage failures and fall back to server ordering.
  }
}

function orderSmartHomePosts(items: ApiPost[], seenIds: Set<string>, seed: string) {
  const nowMs = Date.now()
  const scorePost = (post: ApiPost) => {
    const createdAtMs = Date.parse(post.createdAt)
    const ageHours = Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) / (1000 * 60 * 60) : 9999
    const recencyBoost = Math.max(0, 72 - ageHours) * 1.2
    const jitter = hashSmartFeedValue(`${seed}:${post.id}`) * 100
    return recencyBoost + jitter
  }

  const deduped = dedupePostsById(items)
  const unseen = deduped.filter((post) => !seenIds.has(post.id))
  const seen = deduped.filter((post) => seenIds.has(post.id))
  unseen.sort((left, right) => scorePost(right) - scorePost(left))
  seen.sort((left, right) => scorePost(right) - scorePost(left))
  return [...unseen, ...seen]
}

export default function FeedPageClient(props: FeedPageClientProps) {
  const {
    scope,
    title,
    description,
    headerContent,
    emptyState,
    emptyStateCta,
    rightRail,
    province,
    community,
    defaultSort = 'new',
    sortOptions = [],
    showFeedSummary = true,
    showSupplementalFeedItems = true,
  } = props
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)
  const familyView = useViewerStore((s) => s.familyView)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [communityOptions, setCommunityOptions] = useState<CommunityTarget[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])
  const [memberOrganizations, setMemberOrganizations] = useState<MemberOrganization[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [activityEvents, setActivityEvents] = useState<CommunityEventFeedItem[]>([])
  const [activityJobs, setActivityJobs] = useState<CommunityJobFeedItem[]>([])
  const [activityItems, setActivityItems] = useState<SupplementalActivityItem[]>([])
  const [loading, setLoading] = useState(false)

  const postableOrganizations = useMemo(() => {
    const ownedIds = new Set(ownedOrganizations.map((org) => org.id))
    const memberships = memberOrganizations.filter((org) => !ownedIds.has(org.id))
    return [...ownedOrganizations, ...memberships]
  }, [memberOrganizations, ownedOrganizations])

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')
  const [sortMode, setSortMode] = useState<FeedSortMode>(defaultSort)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null)
  const feedItemsContainerRef = useRef<HTMLDivElement>(null)
  const seenPostIdsRef = useRef<Set<string>>(new Set())
  const pendingImpressionIdsRef = useRef<Set<string>>(new Set())
  const impressionTimersRef = useRef<Map<string, number>>(new Map())
  const flushImpressionsTimerRef = useRef<number | null>(null)
  const smartHomeShuffleSeedRef = useRef('')

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams()
    params.set('scope', scope)
    params.set('sort', sortMode)
    if (province) params.set('province', province)
    if (community) params.set('community', community)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [community, province, scope, sortMode])

  useEffect(() => {
    setSortMode(defaultSort)
  }, [defaultSort])

  const loadPosts = useCallback(async (cursor?: string) => {
    const shouldShuffleSmartHome = scope === 'all' && sortMode === 'hot'
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
      if (!cursor && shouldShuffleSmartHome) {
        smartHomeShuffleSeedRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      }
      const query = new URLSearchParams(filterQuery)
      if (cursor) query.set('cursor', cursor)

      const response = await fetch(buildApiUrl(`/posts?${query.toString()}`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
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
      const newItems: ApiPost[] = Array.isArray(data.items) ? (data.items as ApiPost[]) : []

      setPosts((prev) => {
        if (!shouldShuffleSmartHome) {
          return cursor ? dedupePostsById([...prev, ...newItems]) : dedupePostsById(newItems)
        }

        const seenIds = loadSmartHomeSeenIds()
        const seed = smartHomeShuffleSeedRef.current || 'smart-home'
        if (!cursor) {
          return orderSmartHomePosts(newItems, seenIds, seed)
        }

        const existingIds = new Set(prev.map((post) => post.id))
        const incomingUnique = newItems.filter((post) => !existingIds.has(post.id))
        return [...prev, ...orderSmartHomePosts(incomingUnique, seenIds, seed)]
      })
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
  }, [filterQuery, scope, sortMode])

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
    const isTopLevelCommunitiesFeed = scope === 'communities' && !province && !community
    const isPulseHighlightsFeed = scope === 'all' && sortMode === 'hot'
    const shouldLoadActivity = isTopLevelCommunitiesFeed || isPulseHighlightsFeed
    if (!shouldLoadActivity) {
      setActivityEvents([])
      setActivityJobs([])
      setActivityItems([])
      return
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    const loadActivity = async () => {
      try {
        const params = new URLSearchParams({
          scope,
          eventLimit: '6',
          jobLimit: '6',
        })
        if (province) params.set('province', province)
        if (community) params.set('community', community)

        const response = await fetch(buildApiUrl(`/feed/activity?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        if (response.status === 401) {
          setActivityEvents([])
          setActivityJobs([])
          setActivityItems([])
          if (hasPendingFamilySessionBootstrap()) {
            return
          }
          clearAuthSession()
          redirectToAuthModal('login')
          return
        }

        if (!response.ok) {
          setActivityEvents([])
          setActivityJobs([])
          setActivityItems([])
          return
        }

        const payload = (await response.json().catch(() => null)) as FeedActivityResponse | null
        setActivityEvents(Array.isArray(payload?.events) ? payload.events : [])
        setActivityJobs(Array.isArray(payload?.jobs) ? payload.jobs : [])
        setActivityItems(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        setActivityEvents([])
        setActivityJobs([])
        setActivityItems([])
        if (hasPendingFamilySessionBootstrap()) {
          return
        }
      }
    }

    void loadActivity()
  }, [community, province, scope, sortMode])

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
  const smartHomeShuffleEnabled = scope === 'all' && sortMode === 'hot'

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
              if (smartHomeShuffleEnabled) {
                markSmartHomePostSeen(postId)
              }
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
  }, [schedulePostImpressionFlush, posts, scope, me?.handle, smartHomeShuffleEnabled])

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
      if (cachedMe.accountType === 'family_member') {
        setMe(cachedMe)
      } else {
        if (!hasHomeCommunity(cachedMe)) {
          router.replace('/welcome')
          return
        }
        if (scope === 'all' && !province && !community && !hasDeclaredCivilStatus(cachedMe)) {
          router.replace('/verify')
          return
        }
        setMe(cachedMe)
      }
    }

    const bootstrap = async () => {
      try {
        const resolvedMe = cachedMe ?? (await ensureViewerMe({ token }))
        if (!resolvedMe) {
          if (!window.localStorage.getItem('token')) {
            redirectToAuthModal('login')
            return
          }
          if (familyView) return
          pushToast('Unable to load your account right now.', 'error')
          return
        }

        const isFamilyLockedSession = resolvedMe.accountType === 'family_member' || Boolean(familyView)

        if (!isFamilyLockedSession && !hasHomeCommunity(resolvedMe)) {
          router.replace('/welcome')
          return
        }

        if (!isFamilyLockedSession && scope === 'all' && !province && !community && !hasDeclaredCivilStatus(resolvedMe)) {
          router.replace('/verify')
          return
        }

        setMe(resolvedMe)

        if (isFamilyLockedSession) {
          setCommunityOptions([])
          setOwnedOrganizations([])
          setMemberOrganizations([])
          return
        }

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

        const [followsRes, ownedRes, membershipsRes] = await Promise.all([
          followsPromise,
          ownedPromise ?? Promise.resolve(null),
          membershipsPromise ?? Promise.resolve(null),
        ])

        if (ownedRes?.status === 401 || membershipsRes?.status === 401) {
          if (hasPendingFamilySessionBootstrap()) {
            return
          }
          clearAuthSession()
          redirectToAuthModal('login')
          return
        }

        if (followsRes.status === 401) {
          if (hasPendingFamilySessionBootstrap()) {
            return
          }
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
        if (hasPendingFamilySessionBootstrap()) {
          return
        }
        clearAuthSession()
        redirectToAuthModal('login')
      }
    }

    void bootstrap()
  }, [cachedMe, familyView, router, scope, province, community])

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
  const isTopLevelCommunitiesFeed = scope === 'communities' && !province && !community
  const isPulseHighlightsFeed = scope === 'all' && sortMode === 'hot'
  const hasSupplementalActivity = activityItems.length > 0
  const showSupplementalActivity = showSupplementalFeedItems && (isTopLevelCommunitiesFeed || isPulseHighlightsFeed) && hasSupplementalActivity
  const supplementalTitle = isPulseHighlightsFeed ? 'Events and jobs in your feed' : 'Community activity'
  const supplementalDescription = isPulseHighlightsFeed
    ? 'Nearby events and open jobs surfaced alongside posts in your home feed.'
    : 'Events and jobs from the communities you follow, surfaced alongside local posts.'
  const uniquePostCommunityCount = useMemo(() => {
    const keys = new Set<string>()
    for (const post of visiblePosts) {
      const key = buildCommunityKey(post.provinceCode ?? null, post.communitySlug ?? null)
      if (key) keys.add(key)
    }
    return keys.size
  }, [visiblePosts])
  const uniqueOrganizationCount = useMemo(() => {
    const ids = new Set<string>()
    for (const post of visiblePosts) {
      if (post.organization?.id) ids.add(post.organization.id)
    }
    return ids.size
  }, [visiblePosts])
  const postsSinceLastVisit = useMemo(() => {
    if (!lastViewedAt) return visiblePosts.length
    const threshold = Date.parse(lastViewedAt)
    if (!Number.isFinite(threshold)) return visiblePosts.length
    return visiblePosts.filter((post) => Date.parse(post.createdAt) > threshold).length
  }, [lastViewedAt, visiblePosts])
  const feedSnapshot = useMemo(() => {
    if (scope === 'all') {
      return {
        eyebrow: 'Feed Summary',
        title: sortMode === 'hot' ? 'Posts, events, and jobs currently surfacing in your home feed.' : 'The newest posts, events, and jobs in your home feed.',
        cards: [
          { label: 'Posts', value: formatSnapshotValue(visiblePosts.length) },
          { label: 'Communities', value: formatSnapshotValue(Math.max(uniquePostCommunityCount, communityOptions.length)) },
          { label: 'Events', value: formatSnapshotValue(activityEvents.length) },
          { label: 'Jobs', value: formatSnapshotValue(activityJobs.length) },
        ],
      }
    }

    if (scope === 'communities') {
      return {
        eyebrow: 'Community Snapshot',
        title: 'Your local feed now tracks posts, public events, and jobs across the places you follow.',
        cards: [
          { label: 'Communities followed', value: formatSnapshotValue(communityOptions.length) },
          { label: 'Local posts loaded', value: formatSnapshotValue(visiblePosts.length) },
          { label: 'Upcoming events', value: formatSnapshotValue(activityEvents.length) },
          { label: 'Open roles', value: formatSnapshotValue(activityJobs.length) },
        ],
      }
    }

    if (scope === 'organizations') {
      return {
        eyebrow: 'Organization Snapshot',
        title: 'This feed stays locked on the organizations you follow or help run.',
        cards: [
          { label: 'Organizations in scope', value: formatSnapshotValue(Math.max(postableOrganizations.length, uniqueOrganizationCount)) },
          { label: 'Posts loaded', value: formatSnapshotValue(visiblePosts.length) },
          { label: 'New since visit', value: formatSnapshotValue(postsSinceLastVisit) },
          { label: 'Communities touched', value: formatSnapshotValue(uniquePostCommunityCount) },
        ],
      }
    }

    if (scope === 'network') {
      return {
        eyebrow: 'Network Snapshot',
        title: 'Professional signal from the people and organizations in your Civil network.',
        cards: [
          { label: 'Updates loaded', value: formatSnapshotValue(visiblePosts.length) },
          { label: 'New since visit', value: formatSnapshotValue(postsSinceLastVisit) },
          { label: 'Organizations represented', value: formatSnapshotValue(uniqueOrganizationCount) },
          { label: 'Communities represented', value: formatSnapshotValue(uniquePostCommunityCount) },
        ],
      }
    }

    return {
      eyebrow: 'Friends Snapshot',
      title: 'Personal updates from the people you trust most on Civil.',
      cards: [
        { label: 'Updates loaded', value: formatSnapshotValue(visiblePosts.length) },
        { label: 'New since visit', value: formatSnapshotValue(postsSinceLastVisit) },
        { label: 'Communities represented', value: formatSnapshotValue(uniquePostCommunityCount) },
        { label: 'Organizations represented', value: formatSnapshotValue(uniqueOrganizationCount) },
      ],
    }
  }, [
    activityEvents.length,
    activityJobs.length,
    communityOptions.length,
    postableOrganizations.length,
    postsSinceLastVisit,
    scope,
    sortMode,
    uniqueOrganizationCount,
    uniquePostCommunityCount,
    visiblePosts.length,
  ])

  const selectedOrganization = useMemo(() => {
    if (scope !== 'organizations' || !selectedOrganizationId) return null
    return postableOrganizations.find((org) => org.id === selectedOrganizationId) ?? null
  }, [postableOrganizations, scope, selectedOrganizationId])
  const composerCoverUrl = useMemo(
    () => (scope === 'organizations' ? selectedOrganization?.coverUrl ?? me?.coverUrl ?? null : me?.coverUrl ?? null),
    [me?.coverUrl, scope, selectedOrganization?.coverUrl],
  )
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

  const emptyLabel = emptyState ?? "No updates yet. Once the community starts posting, you'll see them here."
  const composerDefaultAudience: 'friends' | 'network' | 'community' =
    scope === 'communities' ? 'community' : scope === 'network' ? 'network' : 'friends'

  const resolvedRightRail = rightRail ?? <RightRail />
  const composerActions: Array<{ type: PostType; label: string; icon: string }> = [
    { type: 'post', label: 'Post', icon: '📝' },
    { type: 'article', label: 'Article', icon: '📄' },
    { type: 'poll', label: 'Poll', icon: '📊' },
    { type: 'photo', label: 'Photos', icon: '📷' },
  ]

  const renderSupplementalActivityCard = (item: SupplementalActivityItem) => {
    if (item.kind === 'event') {
      const descriptionPreview = truncatePreview(item.description, 170)
      return (
        <Link
          key={`event:${item.id}`}
          href={getCommunityEventHref(item)}
          className="group flex gap-4 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-slate-50"
        >
          <div className="h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-slate-100">
            {item.primaryPhotoUrl ? <img src={item.primaryPhotoUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]">
              <span>Event</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">{formatCommunityEventDate(item.startsAt)}</span>
              {item.signal?.label ? (
                <span className={clsx('rounded-full border px-2 py-1 normal-case tracking-normal', activitySignalClassName(item.signal.strength))}>
                  {item.signal.label}
                </span>
              ) : null}
            </div>
            <h4 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)]">{item.title}</h4>
            {descriptionPreview ? <p className="mt-1 text-sm text-slate-600">{descriptionPreview}</p> : null}
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <VerifiedAvatar
                src={item.organization.logoUrl}
                alt={item.organization.name}
                initials={item.organization.name}
                size={28}
                isVerified={item.organization.isVerified}
                className="shrink-0"
              />
              <span className="truncate">{item.organization.name}</span>
            </div>
          </div>
        </Link>
      )
    }

    const jobHref = getCommunityJobHref(item)
    const salaryLabel = formatJobSalary(item)
    const descriptionPreview = truncatePreview(item.description, 160)
    const content = (
      <>
        <div className="h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-slate-100">
          {item.photoUrl ? <img src={item.photoUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]">
            <span>Job</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-500">{item.employmentType.replace(/_/g, ' ')}</span>
            {item.signal?.label ? (
              <span className={clsx('rounded-full border px-2 py-1 normal-case tracking-normal', activitySignalClassName(item.signal.strength))}>
                {item.signal.label}
              </span>
            ) : null}
          </div>
          <h4 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)]">{item.title}</h4>
          <p className="mt-1 text-sm text-slate-500">{parseJobLocationLabel(item.location)}</p>
          {descriptionPreview ? <p className="mt-1 text-sm text-slate-600">{descriptionPreview}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 px-2 py-1">{item.organization.name}</span>
            {salaryLabel ? <span className="rounded-full border border-slate-200 px-2 py-1">{salaryLabel}</span> : null}
          </div>
        </div>
      </>
    )

    if (!jobHref) {
      return (
        <article key={`job:${item.id}`} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-3">
          {content}
        </article>
      )
    }

    return (
      <Link
        key={`job:${item.id}`}
        href={jobHref}
        className="group flex gap-4 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-slate-50"
      >
        {content}
      </Link>
    )
  }

  return (
    <DashboardShell rightRail={resolvedRightRail} mainClassName="min-w-0 space-y-6">
      {headerContent ? <div>{headerContent}</div> : null}

      <CivilComposerLauncher
        title={scope !== 'organizations' ? title : undefined}
        description={scope !== 'organizations' ? description : undefined}
        coverUrl={composerCoverUrl}
        avatarSrc={me?.avatarUrl ?? null}
        avatarAlt={viewerDisplayName}
        avatarInitials={viewerDisplayName}
        avatarHref={me?.handle ? `/u/${me.handle}` : undefined}
        isVerified={isVerifiedUser}
        isBusiness={isBusinessUser}
        prompt={`What's on your mind, ${friendlyFirstName}?`}
        actions={composerActions}
        onPrimaryClick={() => openComposer('post')}
        onActionClick={(type) => openComposer(type as PostType)}
      />

      {showFeedSummary ? (
        <section className="overflow-hidden rounded-[var(--cc-radius)] border border-slate-200 bg-white shadow-subtle">
          <div className="border-b border-slate-200/80 px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--cc-primary)]">{feedSnapshot.eyebrow}</p>
            <p className="mt-2 text-sm text-slate-600">{feedSnapshot.title}</p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200/80 sm:grid-cols-4">
            {feedSnapshot.cards.map((card) => (
              <div key={card.label} className="bg-white px-5 py-4">
                <p className="text-2xl font-semibold tracking-tight text-slate-900">{card.value}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div ref={feedItemsContainerRef} className="min-w-0 space-y-4">
        {sortOptions.length > 1 ? (
          <div className="flex justify-center">
            <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx(
                      'rounded-full px-4 py-1.5 transition',
                      sortMode === option.value
                        ? 'bg-white text-[var(--cc-primary)] shadow-subtle'
                        : 'text-slate-500 hover:text-slate-700',
                    )}
                    onClick={() => setSortMode(option.value)}
                    disabled={loading && sortMode === option.value}
                  >
                    {option.label}
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {showSupplementalActivity ? (
          <section className="overflow-hidden rounded-[calc(var(--cc-radius)+4px)] border border-[var(--cc-primary)]/12 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(249,250,251,0.98)_100%)] shadow-[0_24px_56px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(185,28,28,0.06)_0%,rgba(255,255,255,0)_55%)] px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Feed</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{supplementalTitle}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{supplementalDescription}</p>
            </div>
            <div className="px-6 py-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">Ranked by recency, proximity, and activity.</p>
                <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]">
                  <Link href="/events">Events</Link>
                  <Link href="/work">Jobs</Link>
                </div>
              </div>
              <div className="space-y-3">
                {activityItems.map((item) => renderSupplementalActivityCard(item))}
              </div>
            </div>
          </section>
        ) : null}

        {visiblePosts.length === 0 && !hasSupplementalActivity ? (
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
              const isChronological = sortMode === 'new'
              const isFirstSeen = isChronological && lastViewedAt && p.createdAt <= lastViewedAt && (i === 0 || (prevPost && prevPost.createdAt > lastViewedAt))
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
        closeOnBackdrop={false}
        closeOnEscape={false}
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
