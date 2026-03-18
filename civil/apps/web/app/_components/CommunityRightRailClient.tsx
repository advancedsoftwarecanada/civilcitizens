'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import Block from './Block'
import { buildApiUrl } from '../_lib/api'
import CivilCard from './CivilCard'
import OrganizationCreateButton from '../com/_components/OrganizationCreateButton'

type CommunityOrganization = {
  id: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
  logoUrl: string | null
  coverUrl: string | null
  isVerified: boolean
  followerCount: number
  createdAt: string
}

type CommunityOrganizationsResponse = {
  items?: CommunityOrganization[]
}

type CommunityFeedActivityResponse = {
  events?: Array<{ id: string }>
  jobs?: Array<{ id: string }>
}

type CommunityPoliticiansResponse = {
  federal?: {
    seat?: {
      title: string
      politician?: {
        id: string
        slug: string
        displayName: string
        lastScrapeAt: string | null
      } | null
      party?: {
        id: string
        slug: string
        name: string
        shortName: string | null
      } | null
      lastScrapeAt: string | null
    } | null
  }
}

type CommunityFederalSeat = NonNullable<NonNullable<CommunityPoliticiansResponse['federal']>['seat']>

const numberFormatter = new Intl.NumberFormat('en-CA')

function shuffleOrganizations<T>(items: T[]): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = next[index]!
    next[index] = next[swapIndex]!
    next[swapIndex] = current
  }
  return next
}

export default function CommunityRightRailClient({
  province,
  municipality,
  showCreateOrganization = false,
}: {
  province: string
  municipality: string
  showCreateOrganization?: boolean
}) {
  const [organizations, setOrganizations] = useState<CommunityOrganization[]>([])
  const [feedActivity, setFeedActivity] = useState<{ eventCount: number; jobCount: number } | null>(null)
  const [federalSeat, setFederalSeat] = useState<CommunityFederalSeat | null>(null)
  const [loadingCommunityData, setLoadingCommunityData] = useState(true)

  const provinceName = useMemo(() => {
    const normalized = normalizeProvinceCode(province)
    return (normalized ? getProvinceDisplayName(normalized) : null) || province.toUpperCase()
  }, [province])

  const communityName = useMemo(
    () => municipality.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    [municipality],
  )

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoadingCommunityData(true)
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
      const headers = token ? { authorization: `Bearer ${token}` } : undefined

      try {
        const [orgsRes, activityRes, politiciansRes] = await Promise.all([
          fetch(buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs?limit=20`), {
            headers,
            cache: 'no-store',
          }),
          token
            ? fetch(
                buildApiUrl(
                  `/feed/activity?scope=communities&province=${encodeURIComponent(province)}&community=${encodeURIComponent(municipality)}&eventLimit=12&jobLimit=12`,
                ),
                {
                  headers,
                  cache: 'no-store',
                },
              )
            : Promise.resolve(null),
          fetch(buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/politicians`), {
            cache: 'no-store',
          }),
        ])

        if (!cancelled) {
          if (orgsRes.ok) {
            const payload = (await orgsRes.json().catch(() => null)) as CommunityOrganizationsResponse | null
            setOrganizations(Array.isArray(payload?.items) ? payload.items : [])
          } else {
            setOrganizations([])
          }

          if (activityRes?.ok) {
            const payload = (await activityRes.json().catch(() => null)) as CommunityFeedActivityResponse | null
            setFeedActivity({
              eventCount: Array.isArray(payload?.events) ? payload.events.length : 0,
              jobCount: Array.isArray(payload?.jobs) ? payload.jobs.length : 0,
            })
          } else {
            setFeedActivity(null)
          }

          if (politiciansRes.ok) {
            const payload = (await politiciansRes.json().catch(() => null)) as CommunityPoliticiansResponse | null
            setFederalSeat(payload?.federal?.seat ?? null)
          } else {
            setFederalSeat(null)
          }
        }
      } catch {
        if (!cancelled) {
          setOrganizations([])
          setFeedActivity(null)
          setFederalSeat(null)
        }
      } finally {
        if (!cancelled) {
          setLoadingCommunityData(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [municipality, province])

  const topOrganizations = useMemo(() => {
    return shuffleOrganizations(organizations)
      .slice(0, 5)
  }, [organizations])

  const federalSeatLabel = useMemo(() => {
    if (!federalSeat) return ''
    const politicianName = federalSeat.politician?.displayName?.trim()
    const partyName = federalSeat.party?.shortName?.trim() || federalSeat.party?.name?.trim() || ''
    if (politicianName && partyName) return `${politicianName}, ${partyName}`
    if (politicianName) return politicianName
    return ''
  }, [federalSeat])

  const dataLoaderDiv = <div className="mt-2 h-4 w-28 animate-pulse rounded bg-slate-200" />

  return (
    <div className="space-y-6">
      {showCreateOrganization ? <OrganizationCreateButton province={province} municipality={municipality} /> : null}

      <Block title="Community Stats">
        <dl className="space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
            <dt className="font-semibold text-slate-600">Community</dt>
            <dd className="font-semibold text-slate-900">{communityName}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <dt className="font-semibold text-slate-600">Province</dt>
            <dd className="mt-1 text-slate-900">{provinceName}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <dt className="font-semibold text-slate-600">MP</dt>
                <dd className="mt-1 min-h-6 text-slate-900">{loadingCommunityData ? dataLoaderDiv : federalSeatLabel}</dd>
              </div>
              <Link
                href={`/${encodeURIComponent(province.toLowerCase())}/${encodeURIComponent(municipality.toLowerCase())}/politicians`}
                className="text-xs font-semibold text-[var(--cc-primary)] hover:underline"
              >
                View all
              </Link>
            </div>
          </div>
        </dl>
      </Block>

      <Block title="Community Feed">
        <div className="space-y-3 text-sm text-slate-700">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-600">Posts</p>
                <p className="mt-1 text-slate-900">Open the local community feed.</p>
              </div>
              <Link
                href={`/${encodeURIComponent(province.toLowerCase())}/${encodeURIComponent(municipality.toLowerCase())}`}
                className="text-xs font-semibold text-[var(--cc-primary)] hover:underline"
              >
                Open
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-600">Events</p>
                {loadingCommunityData ? dataLoaderDiv : <p className="mt-1 text-slate-900">Upcoming {numberFormatter.format(feedActivity?.eventCount ?? 0)}</p>}
              </div>
              <Link href="/events" className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
                Open
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-600">Open roles</p>
                {loadingCommunityData ? dataLoaderDiv : <p className="mt-1 text-slate-900">Active {numberFormatter.format(feedActivity?.jobCount ?? 0)}</p>}
              </div>
              <Link
                href={`/work?provinceCode=${encodeURIComponent(province.toUpperCase())}&communitySlug=${encodeURIComponent(municipality.toLowerCase())}`}
                className="text-xs font-semibold text-[var(--cc-primary)] hover:underline"
              >
                Open
              </Link>
            </div>
          </div>
        </div>
      </Block>

      <Block
        title={
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Organizations in</p>
            <Link
              href={`/${encodeURIComponent(province.toLowerCase())}/${encodeURIComponent(municipality.toLowerCase())}`}
              className="inline-flex text-base font-semibold leading-5 text-slate-900 hover:text-[var(--cc-primary)] hover:underline"
            >
              {communityName}
            </Link>
          </div>
        }
        action={{
          label: 'Directory',
          href: `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs`,
        }}
      >
        {topOrganizations.length ? (
          <ul className="space-y-3">
            {topOrganizations.map((org) => {
              const provinceCode = (org.provinceCode ?? province).toLowerCase()
              const communitySlug = (org.communitySlug ?? municipality).toLowerCase()

              return (
                <li key={org.id}>
                  <CivilCard
                    href={`/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(org.slug)}`}
                    size="md"
                    name={org.name}
                    avatarAlt={org.name}
                    avatarInitials={org.name}
                    avatarSrc={org.logoUrl ?? null}
                    coverUrl={org.coverUrl}
                    isVerified={Boolean(org.isVerified)}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No organizations in this community yet.</p>
        )}
      </Block>
    </div>
  )
}
