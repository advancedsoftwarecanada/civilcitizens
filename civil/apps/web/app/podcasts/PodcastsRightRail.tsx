'use client'

import { useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../_lib/api'
import { buildPostPath } from '../_lib/shareTarget'
import { formatUserDisplayName } from '../_lib/text'
import type { ApiPost } from '../_components/PostComposer'
import Block from '../_components/Block'
import CivilCard from '../_components/CivilCard'

type PodcastsRightRailProps = {
  onUploadPodcast: () => void
}

type ConnectionsResponse = {
  items?: Array<{
    id: string
    user: {
      id: string
      handle: string
      name?: string | null
      avatarUrl?: string | null
      coverUrl?: string | null
      isVerified?: boolean
    }
  }>
}

type PostsResponse = {
  items?: ApiPost[]
}

type PodcasterRailItem = {
  id: string
  handle: string
  name: string
  avatarUrl: string | null
  coverUrl: string | null
  isVerified: boolean
  latestEpisodeTitle: string | null
}

const TRENDING_LIMIT = 4
const PODCASTER_LIMIT = 4

function getPodcastTitle(post: ApiPost) {
  const title = post.title?.trim()
  if (title) return title

  const bodyPreview = post.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (bodyPreview) return bodyPreview.slice(0, 80)

  return 'Untitled podcast episode'
}

function getAuthorName(post: ApiPost) {
  return formatUserDisplayName(post.author.name, post.author.handle) || 'Civil creator'
}

export default function PodcastsRightRail({ onUploadPodcast }: PodcastsRightRailProps) {
  const [trendingPodcasts, setTrendingPodcasts] = useState<ApiPost[]>([])
  const [followedPodcasters, setFollowedPodcasters] = useState<PodcasterRailItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        if (!cancelled) {
          setTrendingPodcasts([])
          setFollowedPodcasters([])
          setLoading(false)
        }
        return
      }

      setLoading(true)

      try {
        const headers = { authorization: `Bearer ${token}` }
        const [trendingRes, latestRes, connectionsRes] = await Promise.all([
          fetch(buildApiUrl('/posts?scope=network&sort=hot&videoKind=podcast&limit=8'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/posts?scope=network&sort=new&videoKind=podcast&limit=24'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/connections'), { headers, cache: 'no-store' }),
        ])

        if (cancelled) return

        const trendingPayload = trendingRes.ok ? ((await trendingRes.json().catch(() => null)) as PostsResponse | null) : null
        const latestPayload = latestRes.ok ? ((await latestRes.json().catch(() => null)) as PostsResponse | null) : null
        const connectionsPayload = connectionsRes.ok ? ((await connectionsRes.json().catch(() => null)) as ConnectionsResponse | null) : null

        const trendingItems = Array.isArray(trendingPayload?.items) ? trendingPayload.items : []
        const latestItems = Array.isArray(latestPayload?.items) ? latestPayload.items : []
        const connections = Array.isArray(connectionsPayload?.items) ? connectionsPayload.items : []
        const connectionIds = new Set(connections.map((entry) => entry.user.id))
        const podcastersById = new Map<string, PodcasterRailItem>()

        for (const post of latestItems) {
          if (!connectionIds.has(post.author.id) || podcastersById.has(post.author.id)) continue

          podcastersById.set(post.author.id, {
            id: post.author.id,
            handle: post.author.handle,
            name: getAuthorName(post),
            avatarUrl: post.author.avatarUrl ?? null,
            coverUrl: post.video?.thumbnailUrl ?? post.author.coverUrl ?? null,
            isVerified: Boolean(post.author.isVerified),
            latestEpisodeTitle: getPodcastTitle(post),
          })

          if (podcastersById.size >= PODCASTER_LIMIT) break
        }

        setTrendingPodcasts(trendingItems.slice(0, TRENDING_LIMIT))
        setFollowedPodcasters(Array.from(podcastersById.values()))
      } catch {
        if (!cancelled) {
          setTrendingPodcasts([])
          setFollowedPodcasters([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const trendingContent = useMemo(() => {
    if (loading) return <p className="text-sm text-slate-500">Loading podcast queue…</p>
    if (!trendingPodcasts.length) return <p className="text-sm text-slate-500">No podcast episodes are trending yet.</p>

    return (
      <ul className="space-y-3">
        {trendingPodcasts.map((post) => (
          <li key={post.id}>
            <CivilCard
              href={buildPostPath(post)}
              size="md"
              name={getPodcastTitle(post)}
              avatarAlt={getAuthorName(post)}
              avatarInitials={getAuthorName(post)}
              avatarSrc={post.author.avatarUrl ?? null}
              coverUrl={post.video?.thumbnailUrl ?? post.author.coverUrl ?? null}
              subtitle={getAuthorName(post)}
              details={post.communityName ?? 'Network'}
              isVerified={Boolean(post.author.isVerified)}
            />
          </li>
        ))}
      </ul>
    )
  }, [loading, trendingPodcasts])

  const followedContent = useMemo(() => {
    if (loading) return <p className="text-sm text-slate-500">Loading podcasters…</p>
    if (!followedPodcasters.length) return <p className="text-sm text-slate-500">No followed podcasters are publishing yet.</p>

    return (
      <ul className="space-y-3">
        {followedPodcasters.map((podcaster) => (
          <li key={podcaster.id}>
            <CivilCard
              href={`/u/${podcaster.handle}`}
              size="md"
              name={podcaster.name}
              avatarAlt={podcaster.name}
              avatarInitials={podcaster.name}
              avatarSrc={podcaster.avatarUrl}
              coverUrl={podcaster.coverUrl}
              subtitle={podcaster.latestEpisodeTitle ?? 'Latest episode available'}
              isVerified={podcaster.isVerified}
            />
          </li>
        ))}
      </ul>
    )
  }, [followedPodcasters, loading])

  return (
    <div className="space-y-5">
      <Block title="Upload Podcast">
        <button
          type="button"
          onClick={onUploadPodcast}
          className="inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
        >
          Upload Podcast
        </button>
      </Block>

      <Block title="Trending Podcasts">
        {trendingContent}
      </Block>

      <Block title="Podcasters You Follow" action={{ label: 'See all', href: '/network/professionals' }}>
        {followedContent}
      </Block>
    </div>
  )
}