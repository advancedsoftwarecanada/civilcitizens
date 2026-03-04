'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactionType } from '@civil/shared'
import PostFeedItem from '../../_components/PostFeedItem'
import PostComposer from '../../_components/PostComposer'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { clearAuthSession } from '../../_lib/authSession'
import { ensureViewerMe } from '../../_lib/viewerMe'
import type { ApiPost } from '../../_components/PostComposer'
import type { CommunityOrganization } from '../../_lib/organizations'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

export default function OrganizationWallClient({
  province,
  municipality,
  slug,
  initialOrg,
}: {
  province: string
  municipality: string
  slug: string
  initialOrg: CommunityOrganization | null
}) {
  const [org, setOrg] = useState<CommunityOrganization | null>(initialOrg)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orgLoading, setOrgLoading] = useState(false)
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('new')

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const loadOrg = useCallback(async () => {
    if (org) return
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setOrgLoading(true)
    setError(null)

    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
        ),
        { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
      )

      if (res.status === 401) {
        clearAuthSession()
        redirectToAuthModal('login')
        return
      }

      if (res.status === 404) {
        setError('Organization not found.')
        return
      }

      if (!res.ok) {
        setError('Unable to load this organization right now.')
        return
      }

      const payload = (await res.json().catch(() => null)) as { org?: CommunityOrganization } | null
      if (payload?.org) {
        setOrg(payload.org)
      } else {
        setError('Organization not found.')
      }
    } catch (err) {
      console.error('Failed to load org', err)
      setError('Unable to load this organization right now.')
    } finally {
      setOrgLoading(false)
    }
  }, [municipality, org, province, slug, token])

  const loadPosts = useCallback(async () => {
    if (!org) return
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
        clearAuthSession()
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
  }, [municipality, org, province, slug, sortMode, token])

  useEffect(() => {
    void loadOrg()
  }, [loadOrg])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const loadMe = async () => {
      try {
        const me = await ensureViewerMe({ token })
        if (!cancelled) setViewerId(me?.id ?? null)
      } catch {
        // ignore
      }
    }
    void loadMe()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const refreshOrg = async () => {
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
          ),
          { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
        )
        if (!res.ok) return
        const payload = (await res.json().catch(() => null)) as { org?: CommunityOrganization } | null
        if (!cancelled && payload?.org) setOrg(payload.org)
      } catch {
        // ignore
      }
    }
    void refreshOrg()
    return () => {
      cancelled = true
    }
  }, [municipality, province, slug, token])

  const canPostAsOrg = Boolean(viewerId && org && (org.viewerRole === 'OWNER' || org.viewerRole === 'MANAGER' || org.ownerId === viewerId))
  const communityTarget = org?.provinceCode && org?.communitySlug ? { provinceCode: org.provinceCode, communitySlug: org.communitySlug } : null
  const businessId = org?.id ?? null

  const handlePostCreated = useCallback((post: ApiPost) => {
    setPosts((prev) => [post, ...prev])
  }, [])

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
      if (!res.ok) {
        console.error('Reaction request failed', await res.text())
        return
      }
      const data = (await res.json().catch(() => null)) as { post?: ApiPost } | null
      const updated = data?.post
      if (updated) {
        setPosts((prev) =>
          prev.map((p) => {
            if (p.id !== updated.id) return p
            const incoming = updated as Partial<ApiPost>
            return {
              ...p,
              ...incoming,
              author: {
                ...p.author,
                ...((incoming.author ?? {}) as Partial<ApiPost['author']>),
              },
              organization: incoming.organization === undefined ? p.organization : incoming.organization,
              recentComments:
                Array.isArray(incoming.recentComments) && incoming.recentComments.length === 0 && (p.recentComments?.length ?? 0) > 0
                  ? p.recentComments
                  : Array.isArray(incoming.recentComments)
                    ? incoming.recentComments
                    : p.recentComments,
            }
          }),
        )
      }
    } catch (err) {
      console.error('Unable to react to post', err)
    }
  }, [token])

  return (
    <div className="space-y-6">
      {!org ? (
        <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
          {error ? error : orgLoading ? 'Loading organization…' : 'Loading organization…'}
        </section>
      ) : null}

      {canPostAsOrg && communityTarget && businessId ? (
        <PostComposer
          className="rounded-3xl border border-slate-200 bg-white shadow-sm"
          communityTarget={communityTarget}
          businessTarget={{ businessId, businessName: org?.name ?? null }}
          defaultAudience="business"
          hideAudience
          onPostCreated={handlePostCreated}
        />
      ) : null}

      {org?.headline || org?.description ? (
        <section className="rounded-[28px] border border-white/60 bg-white/90 p-6 shadow-subtle">
          {org?.headline ? <p className="text-base font-semibold text-slate-900">{org.headline}</p> : null}
          <h2 className={`text-lg font-semibold text-slate-900 ${org?.headline ? 'mt-2' : ''}`}>About</h2>
          {org?.description ? (
            <div className="prose prose-sm mt-3 max-w-none text-slate-800" dangerouslySetInnerHTML={{ __html: org.description }} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">No about information yet.</p>
          )}
        </section>
      ) : null}

      <section className="surface-card px-6 py-4 shadow-subtle">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Posts</p>
            <h2 className="text-lg font-semibold text-slate-900">Updates from {org?.name ?? 'this organization'}</h2>
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
            />
          ))
        )}
      </div>
    </div>
  )
}
