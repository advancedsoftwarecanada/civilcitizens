"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { CitySummary } from '@civil/shared'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { pushToast } from './useToasts'

const exploreLinks = [
  { label: 'Browse Communities', href: '/communities/settings', description: 'Find your community and explore civic activity.' },
  { label: 'Update your profile', href: '/profile/edit', description: 'Add a bio, avatar, and city details.' },
]

const LOADING_PLACEHOLDER_ITEMS = Array.from({ length: 3 }, (_, idx) => idx)

type CommunitiesDashboardResponse = {
  followCount: number
  followTarget: number
  postsToday: number
  suggestions: CitySummary[]
  home: {
    provinceCode: string
    communitySlug: string
    communityName: string | null
    cityName: string
  } | null
}

type SummaryStatus = 'loading' | 'ready' | 'error' | 'unauthorized'

export function RightRail() {
  const [status, setStatus] = useState<SummaryStatus>('loading')
  const [summary, setSummary] = useState<CommunitiesDashboardResponse | null>(null)
  const [followingKey, setFollowingKey] = useState<string | null>(null)

  const loadSummary = useCallback(async (options?: { silent?: boolean }) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setSummary(null)
      setStatus('unauthorized')
      return
    }
    if (!options?.silent) {
      setStatus('loading')
    }
    try {
      const res = await fetch(buildApiUrl('/communities/dashboard'), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        setSummary(null)
        setStatus('unauthorized')
        return
      }
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`)
      }
      const data = (await res.json()) as CommunitiesDashboardResponse
      setSummary(data)
      setStatus('ready')
    } catch (error) {
      console.error('Failed to load communities dashboard', error)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const missingFollows = useMemo(() => {
    if (!summary) return 0
    return Math.max(0, summary.followTarget - summary.followCount)
  }, [summary])

  const showFollowPrompt = useMemo(() => {
    if (status !== 'ready' || !summary) return false
    return summary.followCount < summary.followTarget
  }, [status, summary])

  const handleFollow = useCallback(
    async (city: CitySummary) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      if (!city.communitySlug) return
      const key = `${city.provinceCode}:${city.communitySlug}`
      setFollowingKey(key)
      try {
        const res = await fetch(buildApiUrl('/communities/follows'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ provinceCode: city.provinceCode, communitySlug: city.communitySlug }),
        })
        if (res.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!res.ok) {
          throw new Error('follow_failed')
        }
        pushToast(`Following ${city.name}.`, 'success')
        await loadSummary({ silent: true })
      } catch (error) {
        console.error('Failed to follow community', error)
        pushToast('Unable to follow that community right now.', 'error')
      } finally {
        setFollowingKey(null)
      }
    },
    [loadSummary],
  )

  const renderSuggestions = () => {
    if (status === 'loading') {
      return (
        <ul className="space-y-2">
          {LOADING_PLACEHOLDER_ITEMS.map((item) => (
            <li key={item} className="animate-pulse rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="h-3 w-1/2 rounded bg-slate-200" />
              <div className="mt-2 h-2 w-3/4 rounded bg-slate-100" />
            </li>
          ))}
        </ul>
      )
    }

    if (!summary?.suggestions?.length) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          No nearby recommendations yet. Visit <Link href="/communities/settings" className="font-semibold text-[var(--cc-primary)] hover:underline">Community Settings</Link> to browse the full map.
        </div>
      )
    }

    return (
      <ul className="space-y-2">
        {summary.suggestions.map((city) => {
          const key = `${city.provinceCode}:${city.communitySlug}`
          return (
            <li key={key} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{city.name}</div>
                <p className="text-xs text-slate-500">
                  {city.provinceName}
                  {typeof city.distanceKm === 'number' ? ` • ${city.distanceKm.toFixed(1)} km away` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleFollow(city)}
                disabled={followingKey === key}
                className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span aria-hidden>+</span>
                Follow
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const renderContent = () => {
    if (status === 'unauthorized') {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <button type="button" className="font-semibold text-[var(--cc-primary)] hover:underline" onClick={() => redirectToAuthModal('login')}>
            Sign in
          </button>{' '}
          to personalize your Communities feed.
        </div>
      )
    }

    if (status === 'error') {
      return (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
          Unable to load your community suggestions right now.
          <button type="button" className="ml-2 font-semibold underline" onClick={() => loadSummary()}>
            Retry
          </button>
        </div>
      )
    }

    if (showFollowPrompt) {
      return (
        <>
          <p className="text-sm text-slate-600">
            Follow {missingFollows} more {missingFollows === 1 ? 'Community' : 'Communities'} to enjoy geographically relevant content.
          </p>
          {renderSuggestions()}
        </>
      )
    }

    if (status === 'loading' && !summary) {
      return renderSuggestions()
    }

    const postsToday = summary?.postsToday ?? 0
    const followedCommunities = [
      { name: 'Keswick', count: 12 },
      { name: 'Aurora', count: 44 },
      { name: 'Richmond Hill', count: 23 },
    ]

    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-3xl font-bold text-slate-800">{postsToday.toLocaleString()}</div>
          <p className="text-sm text-slate-600">new posts since midnight across your Communities.</p>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Updates refresh hourly.</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Following</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {followedCommunities.map((community) => (
              <li key={community.name} className="flex items-center justify-between">
                <span>{community.name}</span>
                <span className="text-xs font-semibold text-slate-500">{community.count.toLocaleString()} posts</span>
              </li>
            ))}
          </ul>
          <Link href="/communities/settings" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--cc-primary)]">
            View all communities
            <span aria-hidden>→</span>
          </Link>
        </div>
        <p className="text-xs text-slate-500">Keep sharing updates to grow civic conversations in your region.</p>
      </div>
    )
  }

  return (
    <div className="sticky top-8 space-y-4">
      <section className="surface-card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Communities</h2>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Beta</span>
        </div>
        {renderContent()}
      </section>

      <section className="surface-card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Explore Canada</h2>
        <ul className="space-y-3">
          {exploreLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="block rounded-xl border border-slate-100 px-3 py-2 transition hover:border-slate-200">
                <div className="text-sm font-semibold text-[var(--cc-primary)]">{link.label}</div>
                <p className="text-xs text-slate-500">{link.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

    </div>
  )
}
