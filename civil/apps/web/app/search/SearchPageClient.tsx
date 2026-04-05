'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
  HiOutlineDocumentText,
  HiOutlineMagnifyingGlass,
  HiOutlineMapPin,
  HiOutlinePlayCircle,
  HiOutlineShoppingBag,
  HiOutlineXMark,
} from 'react-icons/hi2'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import {
  type CommunitySearchResult,
  type EventSearchResult,
  type HomeCommunitySummary,
  type MarketSearchResult,
  type OrganizationSearchResult,
  type PostSearchResult,
  type SearchResponse,
  type SearchType,
  type UserSearchResult,
  type VideoSearchResult,
} from '../_components/search/searchTypes'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { formatUserDisplayName } from '../_lib/text'
import { getStoredToken } from '../_lib/tokenStorage'
import { buildSearchRequestParams } from './searchRequest'

const MIN_QUERY_LENGTH = 2

const SEARCH_TABS: Array<{ value: SearchType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'people', label: 'People' },
  { value: 'communities', label: 'Chambers' },
  { value: 'organizations', label: 'Organizations' },
  { value: 'events', label: 'Events' },
  { value: 'market', label: 'Market' },
  { value: 'videos', label: 'Videos' },
  { value: 'posts', label: 'Posts' },
]

function formatDurationLabel(durationMs: number | null | undefined) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return null
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

type SearchPageClientProps = {
  initialQuery?: string
  initialType?: SearchType
}

type FetchStatus = 'idle' | 'loading' | 'error'

function sectionCard(title: string, count: number, children: ReactNode) {
  return (
    <section className="space-y-3 rounded-[28px] border border-white/60 bg-white/80 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">{title}</h2>
        <span className="text-xs font-medium text-slate-400">{count}</span>
      </div>
      {children}
    </section>
  )
}

function SearchSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return sectionCard(title, count, children)
}

type SearchSectionConfig = {
  key: Exclude<SearchType, 'all'>
  title: string
  count: number
  emptyMessage: ReactNode
  content: ReactNode
}

export default function SearchPageClient({ initialQuery = '', initialType = 'all' }: SearchPageClientProps) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [activeQuery, setActiveQuery] = useState(initialQuery)
  const [searchType, setSearchType] = useState<SearchType>(initialType)
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([])
  const [communityResults, setCommunityResults] = useState<CommunitySearchResult[]>([])
  const [organizationResults, setOrganizationResults] = useState<OrganizationSearchResult[]>([])
  const [eventResults, setEventResults] = useState<EventSearchResult[]>([])
  const [marketResults, setMarketResults] = useState<MarketSearchResult[]>([])
  const [postResults, setPostResults] = useState<PostSearchResult[]>([])
  const [videoResults, setVideoResults] = useState<VideoSearchResult[]>([])
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setQuery(initialQuery)
    setActiveQuery(initialQuery)
    setSearchType(initialType)
  }, [initialQuery, initialType])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
    }
  }, [])

  const submitSearch = useCallback(
    (nextQuery: string, nextType: SearchType = searchType) => {
      const trimmed = nextQuery.trim()
      setActiveQuery(trimmed)
      setSearchType(nextType)
      const params = new URLSearchParams()
      if (trimmed) params.set('q', trimmed)
      if (nextType !== 'all') params.set('type', nextType)
      const qs = params.toString()
      router.replace(`/search${qs ? `?${qs}` : ''}`)
    },
    [router, searchType],
  )

  const handleTypeSelect = useCallback(
    (nextType: SearchType) => {
      if (nextType === searchType) return
      submitSearch(query, nextType)
    },
    [query, searchType, submitSearch],
  )

  useEffect(() => {
    const executeSearch = async () => {
      const trimmed = activeQuery.trim()
      if (!trimmed) {
        setPeopleResults([])
        setCommunityResults([])
        setOrganizationResults([])
        setEventResults([])
        setMarketResults([])
        setPostResults([])
        setVideoResults([])
        setFetchStatus('idle')
        setError(null)
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
        return
      }
      if (trimmed.length < MIN_QUERY_LENGTH) {
        setPeopleResults([])
        setCommunityResults([])
        setOrganizationResults([])
        setEventResults([])
        setMarketResults([])
        setPostResults([])
        setVideoResults([])
        setFetchStatus('idle')
        setError(null)
        return
      }

      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      if (abortRef.current) {
        abortRef.current.abort()
      }

      const controller = new AbortController()
      abortRef.current = controller
      setFetchStatus('loading')
      setError(null)

      try {
        const params = buildSearchRequestParams(trimmed, searchType)

        const response = await fetch(buildApiUrl(`/search?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`)
        }

        const payload = (await response.json()) as SearchResponse
        setPeopleResults(Array.isArray(payload.people) ? payload.people : [])
        setCommunityResults(Array.isArray(payload.communities) ? payload.communities : [])
        setOrganizationResults(Array.isArray(payload.organizations) ? payload.organizations : [])
        setEventResults(Array.isArray(payload.events) ? payload.events : [])
        setMarketResults(Array.isArray(payload.market) ? payload.market : [])
        setPostResults(Array.isArray(payload.posts) ? payload.posts : [])
        setVideoResults(Array.isArray(payload.videos) ? payload.videos : [])
        setFetchStatus('idle')
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error('Failed to search', err)
        setFetchStatus('error')
        setError('Unable to search right now. Please try again later.')
      }
    }

    void executeSearch()

    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [activeQuery, searchType])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      submitSearch(query, searchType)
    },
    [query, searchType, submitSearch],
  )

  const handleClear = useCallback(() => {
    setQuery('')
    submitSearch('', searchType)
    setPeopleResults([])
    setCommunityResults([])
    setOrganizationResults([])
    setEventResults([])
    setMarketResults([])
    setPostResults([])
    setError(null)
    setFetchStatus('idle')
  }, [searchType, submitSearch])

  const trimmedActiveQuery = activeQuery.trim()
  const tooShort = trimmedActiveQuery.length > 0 && trimmedActiveQuery.length < MIN_QUERY_LENGTH
  const isLoading = fetchStatus === 'loading'
  const totalResults =
    peopleResults.length +
    communityResults.length +
    organizationResults.length +
    eventResults.length +
    marketResults.length +
    videoResults.length +
    postResults.length

  const searchTypeLabel = useMemo(() => {
    switch (searchType) {
      case 'people':
        return 'People'
      case 'communities':
        return 'Chambers'
      case 'organizations':
        return 'Organizations'
      case 'events':
        return 'Events'
      case 'market':
        return 'Market'
      case 'videos':
        return 'Videos'
      case 'posts':
        return 'Community Posts'
      default:
        return 'Search'
    }
  }, [searchType])

  const headerSubtitle = useMemo(() => {
    if (!trimmedActiveQuery) return 'Search Civil across people, communities, organizations, events, marketplace, videos, and community posts.'
    if (tooShort) return 'Enter at least two characters to search.'
    if (isLoading) return 'Searching Civil...'
    if (fetchStatus === 'error') return 'Unable to load results.'
    if (searchType === 'all') {
      return totalResults > 0 ? `Showing ${totalResults} results across Civil.` : `No matches found for “${trimmedActiveQuery}”.`
    }
    const resultCount =
      searchType === 'people'
        ? peopleResults.length
        : searchType === 'communities'
          ? communityResults.length
          : searchType === 'organizations'
            ? organizationResults.length
            : searchType === 'events'
              ? eventResults.length
              : searchType === 'market'
                ? marketResults.length
                : searchType === 'videos'
                  ? videoResults.length
                : postResults.length
    return resultCount > 0 ? `Showing ${resultCount} results.` : `No ${searchTypeLabel.toLowerCase()} found for “${trimmedActiveQuery}”.`
  }, [
    trimmedActiveQuery,
    tooShort,
    isLoading,
    fetchStatus,
    searchType,
    searchTypeLabel,
    totalResults,
    peopleResults.length,
    communityResults.length,
    organizationResults.length,
    eventResults.length,
    marketResults.length,
    videoResults.length,
    postResults.length,
  ])

  const renderHomeCommunity = (home: HomeCommunitySummary | null | undefined) => {
    if (!home) return 'No home chamber yet'
    const provinceLabel = home.provinceName ?? home.provinceCode.toUpperCase()
    const chamberLabel = home.communityName ?? home.chamberName ?? home.communitySlug ?? home.chamberSlug
    if (!chamberLabel) return 'No home chamber yet'
    return `${provinceLabel} / ${chamberLabel}`
  }

  const renderCommunityDetails = (community: CommunitySearchResult) => {
    const provinceLabel = community.provinceName ?? community.provinceCode.toUpperCase()
    const populationLabel = typeof community.population === 'number' && community.population > 0 ? `${community.population.toLocaleString()} residents` : null
    const distanceLabel = typeof community.distanceKm === 'number' ? `${community.distanceKm.toFixed(1)} km away` : null
    return {
      location: `${provinceLabel} • ${community.name}`,
      detail: populationLabel || distanceLabel ? [populationLabel, distanceLabel].filter(Boolean).join(' • ') : null,
    }
  }

  const renderPeopleList = (items: UserSearchResult[]) => (
    <ul className="space-y-3">
      {items.map((person) => {
        const displayName = formatUserDisplayName(person.name, person.handle) || person.handle
        return (
          <li key={person.id}>
            <Link
              href={`/u/${person.handle}`}
              className="flex items-center gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
            >
              <VerifiedAvatar
                src={person.avatarUrl}
                alt={displayName}
                initials={displayName}
                size={56}
                isVerified={person.isVerified}
                isBusiness={person.isPremium}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <p className="text-lg font-semibold text-slate-900">{displayName}</p>
                  <span className="text-xs text-slate-400">@{person.handle}</span>
                </div>
                <p className="text-sm text-slate-500">{renderHomeCommunity(person.homeCommunity ?? person.homeChamber)}</p>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )

  const renderCommunityList = (items: CommunitySearchResult[]) => (
    <ul className="space-y-3">
      {items.map((community) => {
        const { location, detail } = renderCommunityDetails(community)
        return (
          <li key={`${community.provinceCode}:${community.slug}`}>
            <Link
              href={`/${community.provinceCode.toLowerCase()}/${encodeURIComponent(community.slug)}`}
              className="block rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
            >
              <p className="text-lg font-semibold text-slate-900">{community.chamberName}</p>
              <p className="text-sm text-slate-600">{location}</p>
              {detail ? <p className="text-xs text-slate-500">{detail}</p> : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )

  const renderOrganizationList = (items: OrganizationSearchResult[]) => (
    <ul className="space-y-3">
      {items.map((organization) => {
        const initials = organization.name.slice(0, 2).toUpperCase()
        return (
          <li key={organization.id}>
            <Link
              href={organization.href}
              className="flex items-center gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
            >
              <VerifiedAvatar
                src={organization.logoUrl}
                alt={organization.name}
                initials={initials}
                size={56}
                isVerified={organization.isVerified}
                isBusiness
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-slate-900">{organization.name}</p>
                <p className="truncate text-sm text-slate-500">
                  {(organization.communityName ?? organization.communitySlug).replace(/-/g, ' ')} • {organization.provinceCode.toUpperCase()}
                </p>
                {organization.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{organization.description}</p> : null}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )

  const renderEventList = (items: EventSearchResult[]) => (
    <ul className="space-y-3">
      {items.map((event) => (
        <li key={event.id}>
          <Link
            href={event.href}
            className="flex gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
          >
            {event.imageUrl ? (
              <img src={event.imageUrl} alt={event.title} className="h-20 w-20 flex-none rounded-2xl object-cover" />
            ) : (
              <div className="flex h-20 w-20 flex-none items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <HiOutlineCalendarDays className="h-8 w-8" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-slate-900">{event.title}</p>
              <p className="truncate text-sm text-slate-500">
                {event.organization.name} • {event.communityName ?? event.communitySlug.replace(/-/g, ' ')}
                {event.startsAtLabel ? ` • ${event.startsAtLabel}` : ''}
              </p>
              {event.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{event.description}</p> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )

  const renderMarketList = (items: MarketSearchResult[]) => (
    <ul className="space-y-3">
      {items.map((listing) => (
        <li key={listing.id}>
          <Link
            href={listing.href}
            className="flex gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
          >
            {listing.imageUrl ? (
              <img src={listing.imageUrl} alt={listing.title} className="h-20 w-20 flex-none rounded-2xl object-cover" />
            ) : (
              <div className="flex h-20 w-20 flex-none items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <HiOutlineShoppingBag className="h-8 w-8" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-lg font-semibold text-slate-900">{listing.title}</p>
                <span className="text-sm font-semibold text-[var(--cc-primary)]">{listing.priceLabel}</span>
              </div>
              {listing.locationLabel ? <p className="text-sm text-slate-500">{listing.locationLabel}</p> : null}
              {listing.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{listing.description}</p> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )

  const renderPostList = (items: PostSearchResult[]) => (
    <ul className="space-y-3">
      {items.map((post) => {
        const displayName = formatUserDisplayName(post.author.name, post.author.handle) || post.author.handle
        return (
          <li key={post.id}>
            <Link
              href={post.href}
              className="flex gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
            >
              <VerifiedAvatar src={post.author.avatarUrl} alt={displayName} initials={displayName} size={48} isVerified={false} isBusiness={false} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-slate-900">{post.title || post.excerpt || 'Community post'}</p>
                <p className="truncate text-sm text-slate-500">
                  {displayName} • {post.organization?.name ?? `${post.communityName ?? 'Community'}${post.provinceName ? ` • ${post.provinceName}` : ''}`}
                </p>
                {post.excerpt ? <p className="mt-1 line-clamp-3 text-sm text-slate-600">{post.excerpt}</p> : null}
              </div>
              {post.imageUrl ? <img src={post.imageUrl} alt={post.title || 'Post preview'} className="hidden h-20 w-20 rounded-2xl object-cover sm:block" /> : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )

  const renderVideoList = (items: VideoSearchResult[]) => (
    <ul className="space-y-3">
      {items.map((video) => {
        const displayName = formatUserDisplayName(video.author.name, video.author.handle) || video.author.handle
        const durationLabel = formatDurationLabel(video.durationMs)
        return (
          <li key={video.id}>
            <Link
              href={video.href}
              className="flex gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
            >
              {video.thumbnailUrl ? (
                <div className="relative h-20 w-20 flex-none overflow-hidden rounded-2xl bg-slate-100">
                  <img src={video.thumbnailUrl} alt={video.title || 'Video preview'} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-black/25" />
                  <HiOutlinePlayCircle className="absolute inset-0 m-auto h-8 w-8 text-white" />
                </div>
              ) : (
                <div className="flex h-20 w-20 flex-none items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <HiOutlinePlayCircle className="h-8 w-8" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-lg font-semibold text-slate-900">{video.title || video.excerpt || 'Video'}</p>
                  {durationLabel ? <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--cc-primary)]">{durationLabel}</span> : null}
                </div>
                <p className="truncate text-sm text-slate-500">
                  {displayName} • {video.organization?.name ?? `${video.communityName ?? 'Community'}${video.provinceName ? ` • ${video.provinceName}` : ''}`}
                </p>
                {video.excerpt ? <p className="mt-1 line-clamp-3 text-sm text-slate-600">{video.excerpt}</p> : null}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )

  const renderEmptyState = (message: ReactNode) => (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">{message}</div>
  )

  const searchSections: SearchSectionConfig[] = [
    {
      key: 'market',
      title: 'Market',
      count: marketResults.length,
      emptyMessage: <>No marketplace listings found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: marketResults.length > 0 ? renderMarketList(marketResults) : renderEmptyState(<>No marketplace listings found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
    {
      key: 'people',
      title: 'People',
      count: peopleResults.length,
      emptyMessage: <>No people found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: peopleResults.length > 0 ? renderPeopleList(peopleResults) : renderEmptyState(<>No people found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
    {
      key: 'communities',
      title: 'Chambers',
      count: communityResults.length,
      emptyMessage: <>No chambers found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: communityResults.length > 0 ? renderCommunityList(communityResults) : renderEmptyState(<>No chambers found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
    {
      key: 'organizations',
      title: 'Organizations',
      count: organizationResults.length,
      emptyMessage: <>No organizations found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: organizationResults.length > 0 ? renderOrganizationList(organizationResults) : renderEmptyState(<>No organizations found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
    {
      key: 'events',
      title: 'Events',
      count: eventResults.length,
      emptyMessage: <>No events found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: eventResults.length > 0 ? renderEventList(eventResults) : renderEmptyState(<>No events found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
    {
      key: 'videos',
      title: 'Videos',
      count: videoResults.length,
      emptyMessage: <>No videos found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: videoResults.length > 0 ? renderVideoList(videoResults) : renderEmptyState(<>No videos found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
    {
      key: 'posts',
      title: 'Posts',
      count: postResults.length,
      emptyMessage: <>No community posts found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>,
      content: postResults.length > 0 ? renderPostList(postResults) : renderEmptyState(<>No community posts found for <span className="font-semibold">{trimmedActiveQuery}</span>.</>),
    },
  ]

  const orderedSearchSections =
    searchType === 'all'
      ? searchSections
      : [
          ...searchSections.filter((section) => section.key === searchType),
          ...searchSections.filter((section) => section.key !== searchType),
        ]

  const renderResults = () => {
    if (!trimmedActiveQuery) {
      return renderEmptyState('Start typing to search Civil.')
    }
    if (tooShort) {
      return renderEmptyState('Please enter at least two characters.')
    }
    if (isLoading) {
      return renderEmptyState('Searching...')
    }
    if (error) {
      return <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-6 text-sm text-rose-700">{error}</div>
    }

    return (
      <div className="space-y-4">
        {orderedSearchSections.map((section) => (
          <SearchSection key={section.key} title={section.title} count={section.count}>
            {section.content}
          </SearchSection>
        ))}
      </div>
    )
  }

  const searchPlaceholder =
    searchType === 'people'
      ? 'Search people'
      : searchType === 'communities'
        ? 'Search communities'
        : searchType === 'organizations'
          ? 'Search organizations'
          : searchType === 'events'
            ? 'Search events'
            : searchType === 'market'
              ? 'Search marketplace'
              : searchType === 'videos'
                ? 'Search videos'
              : searchType === 'posts'
                ? 'Search community posts'
                : 'Search Civil'

  return (
    <DashboardShell rightRail={<RightRail />} mainClassName="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-[0_35px_120px_rgba(15,23,42,0.12)] sm:p-8">
        <header className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Search</p>
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{searchTypeLabel}</h1>
              <p className="mt-2 text-sm text-slate-500">{headerSubtitle}</p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <div className="inline-flex flex-wrap rounded-[28px] bg-slate-100 p-1 text-xs font-semibold text-slate-500">
                {SEARCH_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={`rounded-full px-4 py-1 transition ${searchType === tab.value ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500'}`}
                    onClick={() => handleTypeSelect(tab.value)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSubmit} className="relative w-full sm:max-w-xl" autoComplete="off">
                <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-full border border-slate-200 bg-white py-2.5 pl-11 pr-12 text-sm text-slate-800 shadow-inner focus:border-[var(--cc-primary)] focus:outline-none"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Clear search"
                  >
                    <HiOutlineXMark className="h-4 w-4" />
                  </button>
                ) : null}
              </form>
            </div>
          </div>
        </header>

        <div className="mt-6">{renderResults()}</div>
      </section>
    </DashboardShell>
  )
}
