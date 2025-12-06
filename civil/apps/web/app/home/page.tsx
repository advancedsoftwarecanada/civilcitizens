"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from '../_components/Sidebar'
import PostComposer, { ApiPost, JURISDICTION_LABELS, type PostType } from '../_components/PostComposer'
import { RightRail } from '../_components/RightRail'
import type { Jurisdiction } from '@civil/shared'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'
import PostFeedItem from '../_components/PostFeedItem'
import DashboardShell from '../_components/DashboardShell'
import Modal from '../_components/Modal'
import { pushToast } from '../_components/useToasts'
import VerifiedAvatar from '../_components/VerifiedAvatar'

const SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

const JURISDICTION_FILTERS: Array<{ value: 'all' | Jurisdiction; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'federal', label: JURISDICTION_LABELS.federal },
  { value: 'provincial', label: JURISDICTION_LABELS.provincial },
  { value: 'municipal', label: JURISDICTION_LABELS.municipal },
  { value: 'self', label: JURISDICTION_LABELS.self },
]

export default function HomePage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | Jurisdiction>('all')
  const [sortMode, setSortMode] = useState<'hot' | 'new'>('hot')
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (activeFilter !== 'all') {
      params.set('jurisdiction', activeFilter)
    }
    params.set('sort', sortMode)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [activeFilter, sortMode])

  const refreshPosts = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setLoading(true)
    try {
      const response = await fetch(buildApiUrl(`/posts${filterQuery}`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      if (response.status === 401) {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
        return
      }
      const data = await response.json().catch(() => ({ items: [] }))
      setPosts(Array.isArray(data.items) ? data.items : [])
    } finally {
      setLoading(false)
    }
  }, [filterQuery])

  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const provinceParam = params?.get('province')
    const chamberParam = params?.get('chamber')
    if (provinceParam && chamberParam) {
      window.location.replace(`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`)
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (!hasHomeCommunity(data)) {
          window.location.replace('/welcome')
          return
        }
        setMe(data)
      })
      .catch(() => {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
      })
  }, [])

  useEffect(() => {
    refreshPosts().catch(() => {
      /* noop */
    })
  }, [refreshPosts])

  const handlePostCreated = useCallback(
    (post: ApiPost) => {
      const matchesFilter = activeFilter === 'all' || post.jurisdiction === activeFilter
      if (matchesFilter) {
        setPosts((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== post.id)
          return [post, ...withoutDuplicate]
        })
        return
      }

      refreshPosts().catch(() => {
        /* noop */
      })
    },
    [activeFilter, refreshPosts],
  )

  const handleVote = useCallback(
    async (postId: string, value: -1 | 0 | 1) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      try {
        const res = await fetch(buildApiUrl('/posts/vote'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId, value }),
        })
        if (!res.ok) {
          console.error('Vote request failed', await res.text())
          return
        }
        const data = await res.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }
      } catch (err) {
        console.error('Unable to vote on post', err)
      }
    },
    [],
  )

  const firstName = me?.name?.split(' ')[0] ?? 'Citizen'
  const isVerifiedUser = Boolean(me?.isVerified)
  const isBusinessUser = Boolean(me?.isPremium)

  const openComposer = (type: PostType = 'post') => {
    setComposerDefaultType(type)
    setComposerOpen(true)
  }

  const handleComingSoon = (label: string) => {
    pushToast(`${label} creation is coming soon.`, 'info')
  }

  return (
    <DashboardShell sidebar={<Sidebar me={me ?? undefined} active="home" />} rightRail={<RightRail />} mainClassName="space-y-6">
      <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
        <div className="flex items-center gap-3">
          <VerifiedAvatar
            src={me?.avatarUrl ?? null}
            alt={me?.name ?? me?.handle ?? firstName}
            initials={me?.name ?? me?.handle ?? firstName}
            size={56}
            isVerified={isVerifiedUser}
            isBusiness={isBusinessUser}
            className="shrink-0"
          />
          <button
            type="button"
            className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-500 transition hover:bg-white hover:text-slate-700"
            onClick={() => openComposer('post')}
          >
            What&apos;s on your mind, {firstName}?
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('post')}>
            <span role="img" aria-label="Post">📝</span>
            Post
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 transition hover:border-slate-300 hover:text-slate-700" onClick={() => openComposer('article')}>
            <span role="img" aria-label="Article">📄</span>
            Article
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Poll')}>
            <span role="img" aria-label="Poll">📊</span>
            Poll
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Link')}>
            <span role="img" aria-label="Link">🔗</span>
            Link
          </button>
          <button type="button" className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-slate-400" onClick={() => handleComingSoon('Photos')}>
            <span role="img" aria-label="Photos">📷</span>
            Photos
          </button>
        </div>
      </section>

      <section className="surface-card px-6 py-4 shadow-subtle">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {JURISDICTION_FILTERS.filter((filter) => filter.value === 'all').map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`rounded-full border px-4 py-1 text-sm font-semibold transition ${
                  activeFilter === filter.value
                    ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                    : 'border-transparent bg-slate-100 text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setActiveFilter(filter.value)}
                disabled={loading && activeFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-full px-3 py-1 transition ${
                  sortMode === option.value
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
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
        {posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            {loading ? 'Loading the latest updates…' : "No updates yet. Once the community starts posting, you'll see them here."}
          </section>
        ) : (
          posts.map((p) => (
            <PostFeedItem
              key={p.id}
              post={p}
              onVote={handleVote}
              viewerId={me?.id ?? null}
              viewerIsVerified={isVerifiedUser || isBusinessUser}
            />
          ))
        )}
      </div>

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Share something new"
        key={composerDefaultType}
        maxWidthClassName="max-w-3xl"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="text-slate-700">Create:</span>
          <button type="button" className={`rounded-full px-3 py-1 ${composerDefaultType === 'post' ? 'bg-[var(--cc-primary)] text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setComposerDefaultType('post')}>
            Post
          </button>
          <button type="button" className={`rounded-full px-3 py-1 ${composerDefaultType === 'article' ? 'bg-[var(--cc-primary)] text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setComposerDefaultType('article')}>
            Article
          </button>
          <button type="button" className="rounded-full px-3 py-1 text-slate-400" onClick={() => handleComingSoon('Poll')}>
            Poll
          </button>
          <button type="button" className="rounded-full px-3 py-1 text-slate-400" onClick={() => handleComingSoon('Link')}>
            Link
          </button>
          <button type="button" className="rounded-full px-3 py-1 text-slate-400" onClick={() => handleComingSoon('Photos')}>
            Photos
          </button>
        </div>
        <PostComposer
          me={me}
          defaultPostType={composerDefaultType}
          onPostCreated={(post) => {
            handlePostCreated(post)
            setComposerOpen(false)
          }}
          variant="plain"
        />
      </Modal>
    </DashboardShell>
  )
}
