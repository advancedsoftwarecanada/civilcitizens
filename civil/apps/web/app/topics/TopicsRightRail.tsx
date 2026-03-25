'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Block from '../_components/Block'
import TopicFollowButton from '../_components/TopicFollowButton'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { formatTopicLabel } from '../_lib/topics'

type TopicListItem = {
  slug: string
  href: string
  recentPostCount?: number
}

type TopicsRightRailProps = {
  onFollowedTopicsChange?: (items: TopicListItem[], authenticated: boolean) => void
}

function buildTopicHref(slug: string) {
  return `/t/${encodeURIComponent(slug)}`
}

function dedupeTopics(items: TopicListItem[]) {
  const seen = new Set<string>()
  const next: TopicListItem[] = []
  for (const item of items) {
    if (seen.has(item.slug)) continue
    seen.add(item.slug)
    next.push(item)
  }
  return next
}

function formatRecentPostCount(value: number | undefined) {
  if (typeof value !== 'number' || value <= 0) return null
  return value === 1 ? '1 recent post' : `${value.toLocaleString()} recent posts`
}

export type { TopicListItem }

export default function TopicsRightRail({ onFollowedTopicsChange }: TopicsRightRailProps) {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [followedTopics, setFollowedTopics] = useState<TopicListItem[]>([])
  const [suggestedTopics, setSuggestedTopics] = useState<TopicListItem[]>([])

  const loadTopics = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const token = typeof window === 'undefined' ? null : window.localStorage.getItem('token')
      const headers = token ? { authorization: `Bearer ${token}` } : undefined

      const [suggestedResult, followedResult] = await Promise.allSettled([
        fetch(buildApiUrl('/topics/suggestions?limit=10'), {
          headers,
          cache: 'no-store',
        }),
        token
          ? fetch(buildApiUrl('/topics/follows'), {
              headers,
              cache: 'no-store',
            })
          : Promise.resolve(null),
      ])

      let nextError: string | null = null
      let followedItems: TopicListItem[] = []

      if (followedResult.status === 'fulfilled' && followedResult.value) {
        const followedResponse = followedResult.value
        if (followedResponse.status === 401) {
          setAuthenticated(false)
        } else if (!followedResponse.ok) {
          nextError = 'Unable to load your topics right now.'
          setAuthenticated(Boolean(token))
        } else {
          const followedPayload = (await followedResponse.json().catch(() => null)) as { items?: TopicListItem[] } | null
          followedItems = Array.isArray(followedPayload?.items) ? followedPayload.items : []
          setAuthenticated(true)
        }
      } else if (token) {
        nextError = 'Unable to load your topics right now.'
        setAuthenticated(true)
      } else {
        setAuthenticated(false)
      }

      let suggestedItems: TopicListItem[] = []
      if (suggestedResult.status === 'fulfilled') {
        const suggestedResponse = suggestedResult.value
        if (suggestedResponse.ok) {
          const suggestedPayload = (await suggestedResponse.json().catch(() => null)) as { items?: TopicListItem[] } | null
          suggestedItems = Array.isArray(suggestedPayload?.items) ? suggestedPayload.items : []
        } else {
          nextError = nextError ?? 'Unable to load topic suggestions right now.'
        }
      } else {
        nextError = nextError ?? 'Unable to load topic suggestions right now.'
      }

      setFollowedTopics(followedItems)
      setSuggestedTopics(
        suggestedItems.filter(
          (item) => !followedItems.some((followed) => followed.slug === item.slug),
        ),
      )
      setError(nextError)
    } catch (loadError) {
      console.error('Failed to load topics right rail', loadError)
      setError('Unable to load topic suggestions right now.')
      setSuggestedTopics([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTopics()
  }, [loadTopics])

  useEffect(() => {
    onFollowedTopicsChange?.(followedTopics, authenticated)
  }, [authenticated, followedTopics, onFollowedTopicsChange])

  const handleSuggestedTopicChange = useCallback((topic: TopicListItem, following: boolean) => {
    if (!following) return
    const normalized = { ...topic, href: buildTopicHref(topic.slug) }
    setFollowedTopics((current) => dedupeTopics([normalized, ...current]))
    setSuggestedTopics((current) => current.filter((item) => item.slug !== topic.slug))
  }, [])

  const handleFollowedTopicChange = useCallback((topic: TopicListItem, following: boolean) => {
    if (following) return
    setFollowedTopics((current) => current.filter((item) => item.slug !== topic.slug))
  }, [])

  return (
    <div className="space-y-6">
      {error ? (
        <section className="rounded-3xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      <Block title="Your Topics" action={{ label: 'Refresh', onClick: () => void loadTopics() }}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading your topics…</p>
        ) : !authenticated ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-600">Sign in to follow topics and build a personalized issue feed.</p>
            <button
              type="button"
              onClick={() => redirectToAuthModal('login')}
              className="mt-3 inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
            >
              Sign in to follow topics
            </button>
          </div>
        ) : followedTopics.length ? (
          <ul className="space-y-3">
            {followedTopics.map((topic) => (
              <li key={topic.slug} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <Link href={topic.href} className="block text-sm font-semibold text-slate-900 hover:text-[var(--cc-primary)]">
                    #{topic.slug}
                  </Link>
                  <p className="truncate text-xs text-slate-500">{formatTopicLabel(topic.slug) || topic.slug}</p>
                </div>
                <TopicFollowButton
                  slug={topic.slug}
                  initialFollowing
                  size="sm"
                  onChange={(following) => handleFollowedTopicChange(topic, following)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">You are not following any topics yet.</p>
        )}
      </Block>

      <Block title="Suggested Topics">
        {loading ? (
          <p className="text-sm text-slate-500">Loading suggested topics…</p>
        ) : suggestedTopics.length ? (
          <ul className="space-y-3">
            {suggestedTopics.map((topic) => (
              <li key={topic.slug} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <Link href={topic.href} className="block text-sm font-semibold text-slate-900 hover:text-[var(--cc-primary)]">
                    #{topic.slug}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {formatRecentPostCount(topic.recentPostCount) ?? (formatTopicLabel(topic.slug) || topic.slug)}
                  </p>
                </div>
                <TopicFollowButton
                  slug={topic.slug}
                  size="sm"
                  onChange={(following) => handleSuggestedTopicChange(topic, following)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No suggested topics yet. Start posting with hashtags to seed the graph.</p>
        )}
      </Block>
    </div>
  )
}
