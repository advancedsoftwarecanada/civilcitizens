'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HiOutlineMagnifyingGlass, HiOutlineXMark } from 'react-icons/hi2'
import Sidebar from '../_components/Sidebar'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import type { MeResponse } from '../_lib/me'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'

const MIN_QUERY_LENGTH = 2
const PAGE_LIMIT = 25

export type SearchType = 'people' | 'communities'

const SEARCH_TABS: Array<{ value: SearchType; label: string }> = [
  { value: 'people', label: 'People' },
  { value: 'communities', label: 'Communities' },
]

export type HomeChamber = {
  provinceCode: string
  provinceName: string | null
  chamberSlug: string
  chamberName: string | null
}

export type UserSearchResult = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  isPremium: boolean
  isVerified: boolean
  homeChamber: HomeChamber | null
}

type CommunitySearchResult = {
  slug: string
  name: string
  provinceCode: string
  provinceName: string
  chamberSlug: string
  chamberName: string
  latitude: number
  longitude: number
  population: number | null
  distanceKm?: number
}

type SearchPageClientProps = {
  initialQuery?: string
  initialType?: SearchType
}

type FetchStatus = 'idle' | 'loading' | 'error'

type SearchResponse = {
  people?: UserSearchResult[]
  communities?: CommunitySearchResult[]
}

export default function SearchPageClient({ initialQuery = '', initialType = 'people' }: SearchPageClientProps) {
  const router = useRouter()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [activeQuery, setActiveQuery] = useState(initialQuery)
  const [searchType, setSearchType] = useState<SearchType>(initialType)
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([])
  const [communityResults, setCommunityResults] = useState<CommunitySearchResult[]>([])
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
      return
    }
    let cancelled = false
    const loadMe = async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
        if (!res.ok) {
          redirectToAuthModal('login')
          return
        }
        const data = (await res.json()) as MeResponse
        if (!cancelled) {
          setMe(data)
        }
      } catch (err) {
        console.error('Failed to load viewer for search page', err)
      }
    }
    void loadMe()
    return () => {
      cancelled = true
    }
  }, [])

  const submitSearch = useCallback(
    (nextQuery: string, nextType: SearchType = searchType) => {
      const trimmed = nextQuery.trim()
      setActiveQuery(trimmed)
      setSearchType(nextType)
      const params = new URLSearchParams()
      if (trimmed) params.set('q', trimmed)
      if (nextType !== 'people') params.set('type', nextType)
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
        const url = buildApiUrl(`/search?q=${encodeURIComponent(trimmed)}&type=${searchType}&limit=${PAGE_LIMIT}`)
        const response = await fetch(url, {
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
        if (searchType === 'people') {
          setPeopleResults(Array.isArray(payload.people) ? payload.people : [])
          setCommunityResults([])
        } else {
          setCommunityResults(Array.isArray(payload.communities) ? payload.communities : [])
          setPeopleResults([])
        }
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
    setError(null)
    setFetchStatus('idle')
  }, [searchType, submitSearch])

  const trimmedActiveQuery = activeQuery.trim()
  const tooShort = trimmedActiveQuery.length > 0 && trimmedActiveQuery.length < MIN_QUERY_LENGTH
  const isLoading = fetchStatus === 'loading'

  const headerSubtitle = useMemo(() => {
    const resultCount = searchType === 'people' ? peopleResults.length : communityResults.length
    const label = searchType === 'people' ? 'people' : 'communities'
    if (!trimmedActiveQuery) return searchType === 'people' ? 'Search Civil citizens and communities.' : 'Search Canadian communities by riding.'
    if (tooShort) return `Enter at least two characters to search ${label}.`
    if (isLoading) return `Searching ${label}...`
    if (resultCount > 0) {
      const noun = searchType === 'people' && resultCount === 1 ? 'person' : label
      return `Showing ${resultCount} ${noun}`
    }
    if (fetchStatus === 'error') return 'Unable to load results.'
    return `No ${label} found for that query yet.`
  }, [trimmedActiveQuery, tooShort, isLoading, fetchStatus, searchType, peopleResults.length, communityResults.length])

  const renderHomeCommunity = (home: HomeChamber | null) => {
    if (!home) return 'No home community yet'
    const provinceLabel = home.provinceName ?? home.provinceCode.toUpperCase()
    const chamberLabel = home.chamberName ?? home.chamberSlug
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

  const renderResults = () => {
    const label = searchType === 'people' ? 'people across Civil.' : 'communities across Canada.'
    if (!trimmedActiveQuery) {
      return <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">Start typing to find {label}</div>
    }
    if (tooShort) {
      return <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">Please enter at least two characters.</div>
    }
    if (isLoading) {
      return <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">Searching...</div>
    }
    if (error) {
      return <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-6 text-sm text-rose-700">{error}</div>
    }
    if (searchType === 'people') {
      if (peopleResults.length === 0) {
        return (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No people found for <span className="font-semibold">{trimmedActiveQuery}</span> yet.
          </div>
        )
      }
      return (
        <ul className="space-y-3">
          {peopleResults.map((person) => (
            <li key={person.id}>
              <Link
                href={`/u/${person.handle}`}
                className="flex items-center gap-4 rounded-[28px] border border-white/60 bg-white/90 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:border-[var(--cc-primary)]/50"
              >
                <VerifiedAvatar
                  src={person.avatarUrl}
                  alt={person.name ?? person.handle}
                  initials={person.name ?? person.handle}
                  size={56}
                  isVerified={person.isVerified}
                  isBusiness={person.isPremium}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <p className="text-lg font-semibold text-slate-900">{person.name ?? person.handle}</p>
                    <span className="text-xs text-slate-400">@{person.handle}</span>
                  </div>
                  <p className="text-sm text-slate-500">{renderHomeCommunity(person.homeChamber)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )
    }

    if (communityResults.length === 0) {
      return (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No communities found for <span className="font-semibold">{trimmedActiveQuery}</span> yet.
        </div>
      )
    }

    return (
      <ul className="space-y-3">
        {communityResults.map((community) => {
          const { location, detail } = renderCommunityDetails(community)
          return (
            <li key={`${community.provinceCode}:${community.slug}`}>
              <Link
                href={`/communities/${community.provinceCode}/${encodeURIComponent(community.slug)}`}
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
  }

  return (
    <DashboardShell sidebar={<Sidebar me={me ?? undefined} />} rightRail={<RightRail />} mainClassName="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-[0_35px_120px_rgba(15,23,42,0.12)] sm:p-8">
        <header className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Search</p>
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
                {searchType === 'people' ? 'People' : 'Communities'}
              </h1>
              <p className="mt-2 text-sm text-slate-500">{headerSubtitle}</p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
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
              <form onSubmit={handleSubmit} className="relative w-full sm:max-w-lg">
                <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchType === 'people' ? 'Search people' : 'Search communities'}
                  className="w-full rounded-full border border-slate-200 bg-white/80 py-2.5 pl-11 pr-12 text-sm text-slate-800 shadow-inner focus:border-[var(--cc-primary)] focus:outline-none"
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
