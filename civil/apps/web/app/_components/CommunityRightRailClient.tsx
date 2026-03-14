'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Block from './Block'
import { buildApiUrl } from '../_lib/api'
import CivilCard from './CivilCard'

type NearbyCommunity = {
  name: string
  provinceCode: string
  communitySlug: string
}

type CommunityStatsResponse = {
  members?: number | null
  postsToday?: number
  postsThisMonth?: number
  nearbyCommunities?: NearbyCommunity[]
}

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

const numberFormatter = new Intl.NumberFormat('en-CA')

function getOrganizationBadge(org: CommunityOrganization): 'Hot' | 'New' | null {
  if (org.followerCount >= 20) return 'Hot'
  const createdAt = Date.parse(org.createdAt)
  if (!Number.isFinite(createdAt)) return null
  const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
  if (ageDays <= 30) return 'New'
  return null
}

export default function CommunityRightRailClient({
  province,
  municipality,
}: {
  province: string
  municipality: string
}) {
  const [stats, setStats] = useState<CommunityStatsResponse | null>(null)
  const [organizations, setOrganizations] = useState<CommunityOrganization[]>([])
  const [feedActivity, setFeedActivity] = useState<{ eventCount: number; jobCount: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
      const headers = token ? { authorization: `Bearer ${token}` } : undefined

      try {
        const [statsRes, orgsRes, activityRes] = await Promise.all([
          fetch(buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/stats`), {
            headers,
            cache: 'no-store',
          }),
          fetch(buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs?limit=20`), {
            headers,
            cache: 'no-store',
          }),
          fetch(
            buildApiUrl(
              `/feed/activity?scope=communities&province=${encodeURIComponent(province)}&community=${encodeURIComponent(municipality)}&eventLimit=50&jobLimit=50`,
            ),
            {
              headers,
              cache: 'no-store',
            },
          ),
        ])

        if (!cancelled) {
          if (statsRes.ok) {
            const payload = (await statsRes.json().catch(() => null)) as CommunityStatsResponse | null
            setStats(payload)
          } else {
            setStats(null)
          }

          if (orgsRes.ok) {
            const payload = (await orgsRes.json().catch(() => null)) as CommunityOrganizationsResponse | null
            setOrganizations(Array.isArray(payload?.items) ? payload.items : [])
          } else {
            setOrganizations([])
          }

          if (activityRes.ok) {
            const payload = (await activityRes.json().catch(() => null)) as CommunityFeedActivityResponse | null
            setFeedActivity({
              eventCount: Array.isArray(payload?.events) ? payload.events.length : 0,
              jobCount: Array.isArray(payload?.jobs) ? payload.jobs.length : 0,
            })
          } else {
            setFeedActivity(null)
          }
        }
      } catch {
        if (!cancelled) {
          setStats(null)
          setOrganizations([])
          setFeedActivity(null)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [municipality, province])

  const topOrganizations = useMemo(() => {
    return [...organizations]
      .sort((a, b) => {
        if (b.followerCount !== a.followerCount) return b.followerCount - a.followerCount
        return Date.parse(b.createdAt) - Date.parse(a.createdAt)
      })
      .slice(0, 5)
  }, [organizations])

  const nearby = Array.isArray(stats?.nearbyCommunities) ? stats.nearbyCommunities.slice(0, 5) : []

  return (
    <div className="sticky top-8 space-y-6">
      <Block title="Community Stats">
        <dl className="space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
            <dt className="font-semibold text-slate-600">Members</dt>
            <dd className="font-semibold text-slate-900">
              {typeof stats?.members === 'number' ? numberFormatter.format(stats.members) : '—'}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <dt className="font-semibold text-slate-600">Posts</dt>
            <dd className="mt-1 text-slate-900">
              Today {numberFormatter.format(stats?.postsToday ?? 0)} | This month {numberFormatter.format(stats?.postsThisMonth ?? 0)}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Nearby Communities</p>
          {nearby.length ? (
            <ul className="mt-2 space-y-2">
              {nearby.map((entry) => (
                <li key={`${entry.provinceCode}:${entry.communitySlug}`}>
                  <Link
                    href={`/${entry.provinceCode.toLowerCase()}/${entry.communitySlug.toLowerCase()}`}
                    className="text-sm font-medium text-slate-700 hover:text-slate-900"
                  >
                    {entry.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No nearby communities available yet.</p>
          )}
        </div>
      </Block>

      <Block title="Community Feed">
        <div className="space-y-3 text-sm text-slate-700">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-600">Posts</p>
                <p className="mt-1 text-slate-900">
                  Today {numberFormatter.format(stats?.postsToday ?? 0)} | This month {numberFormatter.format(stats?.postsThisMonth ?? 0)}
                </p>
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
                <p className="mt-1 text-slate-900">Upcoming {numberFormatter.format(feedActivity?.eventCount ?? 0)}</p>
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
                <p className="mt-1 text-slate-900">Active {numberFormatter.format(feedActivity?.jobCount ?? 0)}</p>
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
        title="Organizations"
        action={{
          label: 'View all',
          href: `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs`,
        }}
      >
        <p className="mb-3 text-xs text-slate-500">New | Hot</p>
        {topOrganizations.length ? (
          <ul className="space-y-3">
            {topOrganizations.map((org) => {
              const badge = getOrganizationBadge(org)
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
                    trailing={
                      badge ? (
                        <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">{badge}</span>
                      ) : null
                    }
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No organizations yet.</p>
        )}
      </Block>
    </div>
  )
}
