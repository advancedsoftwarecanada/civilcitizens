'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { HiOutlineMapPin, HiOutlineUser } from 'react-icons/hi2'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import VerifiedAvatar from '../VerifiedAvatar'

const MIN_QUERY_LENGTH = 2
const PEOPLE_LIMIT = 3
const COMMUNITY_LIMIT = 3

type HomeChamber = {
  provinceCode: string
  provinceName: string | null
  chamberSlug: string
  chamberName: string | null
}

type UserSearchResult = {
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
  population: number | null
  distanceKm?: number
}

type QuickSearchResponse = {
  people?: UserSearchResult[]
  communities?: CommunitySearchResult[]
  meta?: {
    peopleHasMore?: boolean
    communitiesHasMore?: boolean
  }
}

type SearchResultsProps = {
  query: string
  open: boolean
}

export function SearchResults({ query, open }: SearchResultsProps) {
  const trimmedQuery = query.trim()
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([])
  const [communityResults, setCommunityResults] = useState<CommunitySearchResult[]>([])
  const [meta, setMeta] = useState<{ peopleHasMore?: boolean; communitiesHasMore?: boolean }>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open || trimmedQuery.length < MIN_QUERY_LENGTH) {
      setPeopleResults([])
      setCommunityResults([])
      setMeta({})
      setLoading(false)
      setError(null)
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      return
    }

    const token = getStoredToken()
    if (!token) {
      setPeopleResults([])
      setCommunityResults([])
      setMeta({})
      setLoading(false)
      setError('Sign in to search people across Civil.')
      return
    }

    setLoading(true)
    setError(null)
    setPeopleResults([])
    setCommunityResults([])
    setMeta({})

    const controller = new AbortController()
    abortRef.current = controller

    const fetchResults = async () => {
      try {
        const url = buildApiUrl(
          `/search?q=${encodeURIComponent(trimmedQuery)}&type=all&peopleLimit=${PEOPLE_LIMIT}&communityLimit=${COMMUNITY_LIMIT}`,
        )
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          setPeopleResults([])
          setCommunityResults([])
          setMeta({})
          setError('Please sign in to keep searching.')
          return
        }

        if (!response.ok) {
          setPeopleResults([])
          setCommunityResults([])
          setError('Unable to search right now. Please try again later.')
          return
        }

        const payload = (await response.json()) as QuickSearchResponse
        setPeopleResults(Array.isArray(payload.people) ? payload.people : [])
        setCommunityResults(Array.isArray(payload.communities) ? payload.communities : [])
        setMeta(payload.meta ?? {})
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setPeopleResults([])
        setCommunityResults([])
        setError('Unable to search right now. Please try again later.')
      } finally {
        setLoading(false)
      }
    }

    void fetchResults()

    return () => {
      controller.abort()
    }
  }, [open, trimmedQuery])

  const showPanel = open && trimmedQuery.length >= MIN_QUERY_LENGTH
  const peopleHasMore = meta.peopleHasMore ?? false
  const communitiesHasMore = meta.communitiesHasMore ?? false
  const viewMorePeopleHref = useMemo(() => `/search?q=${encodeURIComponent(trimmedQuery)}&type=people`, [trimmedQuery])
  const viewMoreCommunitiesHref = useMemo(() => `/search?q=${encodeURIComponent(trimmedQuery)}&type=communities`, [trimmedQuery])

  if (!showPanel) return null

  const renderHomeCommunity = (home: HomeChamber | null) => {
    if (!home) return 'No home community yet'
    const provinceLabel = home.provinceName ?? home.provinceCode.toUpperCase()
    const chamberLabel = home.chamberName ?? home.chamberSlug
    return `${provinceLabel} / ${chamberLabel}`
  }

  return (
    <div
      className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-full min-w-[18rem] rounded-2xl border border-slate-200 bg-white/95 p-3 text-left shadow-2xl shadow-slate-900/10 backdrop-blur"
      onMouseDown={(event) => event.preventDefault()}
    >
      {error ? (
        <div className="mt-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : (
        <>
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">People</p>
          {peopleResults.length === 0 ? (
            <div className="mt-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              {loading ? 'Searching…' : 'No people found yet.'}
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {peopleResults.map((person) => (
                <li key={person.id}>
                  <Link
                    href={`/u/${person.handle}`}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
                    onClick={(event) => event.currentTarget.blur()}
                  >
                    <VerifiedAvatar
                      src={person.avatarUrl}
                      alt={person.name ?? person.handle}
                      initials={person.name}
                      size={40}
                      isVerified={person.isVerified}
                      isBusiness={person.isPremium}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-slate-900">
                        <span className="truncate font-semibold">{person.name ?? `@${person.handle}`}</span>
                        <span className="truncate text-xs text-slate-500">@{person.handle}</span>
                      </div>
                      <p className="truncate text-xs text-slate-500">{renderHomeCommunity(person.homeChamber)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {(peopleResults.length > 0 || peopleHasMore) && (
            <Link
              href={viewMorePeopleHref}
              className="mt-2 block rounded-2xl border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/60"
            >
              View more people
            </Link>
          )}

          <div className="my-3 border-t border-slate-100" />
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Communities</p>
          {communityResults.length === 0 ? (
            <div className="mt-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              {loading ? 'Searching…' : 'No communities found yet.'}
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {communityResults.map((community) => (
                <li key={`${community.provinceCode}:${community.slug}`}>
                  <Link
                    href={`/communities/${community.provinceCode}/${encodeURIComponent(community.slug)}`}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
                    onClick={(event) => event.currentTarget.blur()}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <HiOutlineMapPin className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-slate-900">
                        <span className="truncate font-semibold">{community.chamberName}</span>
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {community.provinceName} • {community.name}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {(communityResults.length > 0 || communitiesHasMore) && (
            <Link
              href={viewMoreCommunitiesHref}
              className="mt-2 block rounded-2xl border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/60"
            >
              View more communities
            </Link>
          )}
        </>
      )}
    </div>
  )
}
