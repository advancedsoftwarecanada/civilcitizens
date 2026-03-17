'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { HiOutlineBuildingOffice2, HiOutlineCalendarDays, HiOutlineDocumentText, HiOutlineMapPin, HiOutlineShoppingBag } from 'react-icons/hi2'
import {
  type CommunitySearchResult,
  type EventSearchResult,
  type MarketSearchResult,
  type SearchResponse,
  type OrganizationSearchResult,
  type PostSearchResult,
  type UserSearchResult,
} from './searchTypes'
import { buildApiUrl } from '../../_lib/api'
import {
  buildAddressesHrefFromResult,
  fetchAddressSearchResults,
  formatAddressPrimaryLabel,
  formatAddressSecondaryLabel,
  isUsableAddressQuery,
  type NominatimAddress,
} from '../../_lib/addressSearch'
import { redirectToAuthModal } from '../../_lib/authModal'
import { formatUserDisplayName } from '../../_lib/text'
import { getStoredToken } from '../../_lib/tokenStorage'
import VerifiedAvatar from '../VerifiedAvatar'

const MIN_QUERY_LENGTH = 2
const PEOPLE_LIMIT = 3
const COMMUNITY_LIMIT = 3
const ORGANIZATION_LIMIT = 2
const EVENT_LIMIT = 2
const MARKET_LIMIT = 2
const POST_LIMIT = 2

type SearchResultsProps = {
  query: string
  open: boolean
}

function CompactSection({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{title}</p>
        <Link href={href} className="text-[11px] font-semibold text-[var(--cc-primary)] hover:underline">
          View more
        </Link>
      </div>
      {children}
    </section>
  )
}

export function SearchResults({ query, open }: SearchResultsProps) {
  const trimmedQuery = query.trim()
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([])
  const [communityResults, setCommunityResults] = useState<CommunitySearchResult[]>([])
  const [organizationResults, setOrganizationResults] = useState<OrganizationSearchResult[]>([])
  const [eventResults, setEventResults] = useState<EventSearchResult[]>([])
  const [marketResults, setMarketResults] = useState<MarketSearchResult[]>([])
  const [postResults, setPostResults] = useState<PostSearchResult[]>([])
  const [addressResults, setAddressResults] = useState<NominatimAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [addressLoading, setAddressLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const addressAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open || !isUsableAddressQuery(trimmedQuery)) {
      setAddressResults([])
      setAddressLoading(false)
      if (addressAbortRef.current) {
        addressAbortRef.current.abort()
        addressAbortRef.current = null
      }
      return
    }

    const controller = new AbortController()
    addressAbortRef.current = controller
    setAddressLoading(true)

    void fetchAddressSearchResults(trimmedQuery, controller.signal, 4)
      .then((results) => {
        setAddressResults(results)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setAddressResults([])
      })
      .finally(() => {
        setAddressLoading(false)
      })

    return () => controller.abort()
  }, [open, trimmedQuery])

  useEffect(() => {
    if (!open || trimmedQuery.length < MIN_QUERY_LENGTH) {
      setPeopleResults([])
      setCommunityResults([])
      setOrganizationResults([])
      setEventResults([])
      setMarketResults([])
      setPostResults([])
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
      setOrganizationResults([])
      setEventResults([])
      setMarketResults([])
      setPostResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setPeopleResults([])
    setCommunityResults([])
    setOrganizationResults([])
    setEventResults([])
    setMarketResults([])
    setPostResults([])

    const controller = new AbortController()
    abortRef.current = controller

    const fetchResults = async () => {
      try {
        const params = new URLSearchParams({ q: trimmedQuery, type: 'all' })
        params.set('peopleLimit', String(PEOPLE_LIMIT))
        params.set('communityLimit', String(COMMUNITY_LIMIT))
        params.set('organizationLimit', String(ORGANIZATION_LIMIT))
        params.set('eventLimit', String(EVENT_LIMIT))
        params.set('marketLimit', String(MARKET_LIMIT))
        params.set('postLimit', String(POST_LIMIT))

        const response = await fetch(buildApiUrl(`/search?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          setError('Please sign in to keep searching.')
          return
        }

        if (!response.ok) {
          setError('Unable to search right now. Please try again later.')
          return
        }

        const payload = (await response.json()) as SearchResponse
        setPeopleResults(Array.isArray(payload.people) ? payload.people : [])
        setCommunityResults(Array.isArray(payload.communities) ? payload.communities : [])
        setOrganizationResults(Array.isArray(payload.organizations) ? payload.organizations : [])
        setEventResults(Array.isArray(payload.events) ? payload.events : [])
        setMarketResults(Array.isArray(payload.market) ? payload.market : [])
        setPostResults(Array.isArray(payload.posts) ? payload.posts : [])
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
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
  const hasAnyResults =
    peopleResults.length > 0 ||
    communityResults.length > 0 ||
    organizationResults.length > 0 ||
    eventResults.length > 0 ||
    marketResults.length > 0 ||
    postResults.length > 0 ||
    addressResults.length > 0

  const sectionHref = useMemo(
    () => ({
      people: `/search?q=${encodeURIComponent(trimmedQuery)}&type=people`,
      communities: `/search?q=${encodeURIComponent(trimmedQuery)}&type=communities`,
      organizations: `/search?q=${encodeURIComponent(trimmedQuery)}&type=organizations`,
      events: `/search?q=${encodeURIComponent(trimmedQuery)}&type=events`,
      market: `/search?q=${encodeURIComponent(trimmedQuery)}&type=market`,
      posts: `/search?q=${encodeURIComponent(trimmedQuery)}&type=posts`,
      addresses: `/addresses?q=${encodeURIComponent(trimmedQuery)}`,
    }),
    [trimmedQuery],
  )

  if (!showPanel) return null

  const renderHomeCommunity = (home: UserSearchResult['homeCommunity']) => {
    if (!home) return 'No home community yet'
    const provinceLabel = home.provinceName ?? home.provinceCode.toUpperCase()
    const chamberLabel = home.communityName ?? home.communitySlug
    return `${provinceLabel} / ${chamberLabel}`
  }

  return (
    <div
      className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-full min-w-[18rem] rounded-2xl border border-slate-200 bg-white/95 p-3 text-left shadow-2xl shadow-slate-900/10 backdrop-blur"
      onMouseDown={(event) => event.preventDefault()}
    >
      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : (loading || addressLoading) && !hasAnyResults ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">Searching…</div>
      ) : !hasAnyResults && !addressLoading ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">No Civil matches yet.</div>
      ) : (
        <div className="space-y-4">
          {addressResults.length > 0 ? (
            <CompactSection title="Addresses" href={sectionHref.addresses}>
              <ul className="divide-y divide-slate-100">
                {addressResults.map((result) => (
                  <li key={`${result.placeId ?? result.displayName}-${result.latitude}-${result.longitude}`}>
                    <Link href={buildAddressesHrefFromResult(result, trimmedQuery)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <HiOutlineMapPin className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{formatAddressPrimaryLabel(result)}</span>
                        <p className="truncate text-xs text-slate-500">{formatAddressSecondaryLabel(result)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {peopleResults.length > 0 ? (
            <CompactSection title="People" href={sectionHref.people}>
              <ul className="divide-y divide-slate-100">
                {peopleResults.map((person) => {
                  const displayName = formatUserDisplayName(person.name, person.handle) || person.handle
                  return (
                    <li key={person.id}>
                      <Link href={`/u/${person.handle}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                        <VerifiedAvatar
                          src={person.avatarUrl}
                          alt={displayName}
                          initials={displayName}
                          size={40}
                          isVerified={person.isVerified}
                          isBusiness={person.isPremium}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-slate-900">
                            <span className="truncate font-semibold">{displayName}</span>
                            <span className="truncate text-xs text-slate-500">@{person.handle}</span>
                          </div>
                          <p className="truncate text-xs text-slate-500">{renderHomeCommunity(person.homeCommunity ?? null)}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CompactSection>
          ) : null}

          {communityResults.length > 0 ? (
            <CompactSection title="Communities" href={sectionHref.communities}>
              <ul className="divide-y divide-slate-100">
                {communityResults.map((community) => (
                  <li key={`${community.provinceCode}:${community.slug}`}>
                    <Link
                      href={`/${community.provinceCode.toLowerCase()}/${encodeURIComponent(community.slug)}`}
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <HiOutlineMapPin className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{community.communityName}</span>
                        <p className="truncate text-xs text-slate-500">{community.provinceName} • {community.name}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {organizationResults.length > 0 ? (
            <CompactSection title="Organizations" href={sectionHref.organizations}>
              <ul className="divide-y divide-slate-100">
                {organizationResults.map((organization) => (
                  <li key={organization.id}>
                    <Link href={organization.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      {organization.logoUrl ? (
                        <img src={organization.logoUrl} alt={organization.name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <HiOutlineBuildingOffice2 className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{organization.name}</span>
                        <p className="truncate text-xs text-slate-500">{organization.communityName ?? organization.communitySlug} • {organization.provinceCode.toUpperCase()}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {eventResults.length > 0 ? (
            <CompactSection title="Events" href={sectionHref.events}>
              <ul className="divide-y divide-slate-100">
                {eventResults.map((event) => (
                  <li key={event.id}>
                    <Link href={event.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      {event.imageUrl ? (
                        <img src={event.imageUrl} alt={event.title} className="h-10 w-10 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          <HiOutlineCalendarDays className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{event.title}</span>
                        <p className="truncate text-xs text-slate-500">{event.organization.name}{event.startsAtLabel ? ` • ${event.startsAtLabel}` : ''}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {marketResults.length > 0 ? (
            <CompactSection title="Market" href={sectionHref.market}>
              <ul className="divide-y divide-slate-100">
                {marketResults.map((listing) => (
                  <li key={listing.id}>
                    <Link href={listing.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                      {listing.imageUrl ? (
                        <img src={listing.imageUrl} alt={listing.title} className="h-10 w-10 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          <HiOutlineShoppingBag className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-slate-900">
                          <span className="truncate font-semibold">{listing.title}</span>
                          <span className="truncate text-xs font-semibold text-[var(--cc-primary)]">{listing.priceLabel}</span>
                        </div>
                        {listing.locationLabel ? <p className="truncate text-xs text-slate-500">{listing.locationLabel}</p> : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CompactSection>
          ) : null}

          {postResults.length > 0 ? (
            <CompactSection title="Posts" href={sectionHref.posts}>
              <ul className="divide-y divide-slate-100">
                {postResults.map((post) => {
                  const displayName = formatUserDisplayName(post.author.name, post.author.handle) || post.author.handle
                  return (
                    <li key={post.id}>
                      <Link href={post.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
                        {post.imageUrl ? (
                          <img src={post.imageUrl} alt={post.title || 'Post'} className="h-10 w-10 rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                            <HiOutlineDocumentText className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-900">{post.title || post.excerpt || 'Community post'}</span>
                          <p className="truncate text-xs text-slate-500">{displayName} • {post.organization?.name ?? post.communityName ?? 'Community'}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CompactSection>
          ) : null}
        </div>
      )}
    </div>
  )
}
