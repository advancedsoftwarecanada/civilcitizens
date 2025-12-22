'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import PostFeedItem from '../../_components/PostFeedItem'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import type { ReactionType } from '@civil/shared'
import type { ApiPost } from '../../_components/PostComposer'
import type { CommunityOrganization } from '../../_lib/organizations'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

function formatShortDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OrganizationWallClient({
  province,
  municipality,
  slug,
  initialOrg,
}: {
  province: string
  municipality: string
  slug: string
  initialOrg: CommunityOrganization
}) {
  const [org, setOrg] = useState<CommunityOrganization>(initialOrg)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('new')

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ sort: sortMode, limit: '25' })
    const url = buildApiUrl(
      `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/posts?${params.toString()}`,
    )

    try {
      const res = await fetch(
        url,
        token
          ? {
              headers: {
                authorization: `Bearer ${token}`,
              },
            }
          : undefined,
      )

      if (res.status === 401) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('token')
        }
        redirectToAuthModal('login')
        return
      }

      if (!res.ok) {
        setError('Unable to load organization posts right now.')
        return
      }

      const payload = (await res.json().catch(() => null)) as { items?: ApiPost[] } | null
      setPosts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (err) {
      console.error('Failed to load org posts', err)
      setError('Unable to load organization posts right now.')
    } finally {
      setLoading(false)
    }
  }, [municipality, province, slug, sortMode, token])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const loadMe = async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const payload = (await res.json().catch(() => null)) as { id?: string } | null
        if (!cancelled) setViewerId(payload?.id ?? null)
      } catch {
        // ignore
      }
    }
    void loadMe()
    return () => {
      cancelled = true
    }
  }, [token])

  const coverDisplayUrl = org.coverUrl ?? null
  const createdLabel = formatShortDate(org.createdAt)

  const handleReact = useCallback(async (postId: string, reaction: ReactionType | null) => {
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
      if (!res.ok) return
      const data = (await res.json().catch(() => null)) as { post?: ApiPost } | null
      const updated = data?.post
      if (updated) {
        setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      }
    } catch (err) {
      console.error('Unable to react to post', err)
    }
  }, [token])

  return (
    <div className={org ? 'space-y-0' : undefined}>
      <section className="relative rounded-[36px] rounded-b-none border border-white/60 bg-white/40 shadow-[0_35px_120px_rgba(15,23,42,0.12)]">
        <div className="relative h-48 w-full overflow-hidden rounded-t-[36px] sm:h-60">
          {coverDisplayUrl ? (
            <>
              <img src={coverDisplayUrl} alt={`${org.name} cover`} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/20" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-r from-[#fde2d7] via-[#f7f0ff] to-[#dff3ff]" />
          )}
        </div>
      </section>

      <section
        className={clsx(
          'rounded-[32px] border border-white/60 bg-white/80 p-6 text-slate-700 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8',
          org && 'rounded-t-none border-t-0',
        )}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-200 via-amber-100 to-sky-200 blur-lg" aria-hidden="true" />
              <VerifiedAvatar
                src={org.logoUrl}
                alt={org.name}
                initials={org.name}
                size={96}
                isVerified={Boolean(org.isVerified)}
                isBusiness
                className="relative border-4 border-white"
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{org.name}</h1>
              <p className="text-sm text-slate-500">@{org.slug} · Created {createdLabel}</p>
            </div>
          </div>
        </div>
      </section>

      {org.description ? (
        <section className="rounded-[28px] border border-white/60 bg-white/90 p-6 shadow-subtle">
          <h2 className="text-lg font-semibold text-slate-900">About</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{org.description}</p>
        </section>
      ) : null}

      <section className="surface-card px-6 py-4 shadow-subtle">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Posts</p>
            <h2 className="text-lg font-semibold text-slate-900">Updates from {org.name}</h2>
          </div>
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-full px-4 py-1 transition ${sortMode === option.value ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500'}`}
                onClick={() => setSortMode(option.value)}
                disabled={loading && sortMode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {error ? (
          <section className="surface-card border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</section>
        ) : posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            {loading ? 'Loading posts…' : 'This organization has not shared any posts yet.'}
          </section>
        ) : (
          posts.map((post) => (
            <PostFeedItem
              key={post.id}
              post={post}
              onReact={handleReact}
              viewerId={viewerId}
              viewerIsVerified
            />
          ))
        )}
      </div>
    </div>
  )
}
