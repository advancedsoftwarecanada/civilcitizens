"use client"

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { LuArrowBigDown, LuArrowBigUp, LuMessageCircle, LuShare } from 'react-icons/lu'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../../_components/PostComposer'
import CommentComposer from '../../../../../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../../../../../_components/CommentThread'
import VerifiedAvatar from '../../../../../_components/VerifiedAvatar'
import { hasHomeCommunity } from '../../../../../_lib/me'
import { redirectToAuthModal } from '../../../../../_lib/authModal'
import { ensureViewerMe } from '../../../../../_lib/viewerMe'
import { useViewerStore } from '../../../../../_lib/viewerStore'
import { addCommentToTree, normalizeCommentTree, updateCommentInTree } from '../../../../../_lib/comments'
import { formatUserDisplayName } from '../../../../../_lib/text'
import { buildApiUrl } from '../../../../../_lib/api'
import DashboardShell from '../../../../../_components/DashboardShell'
import { useRegisterPageView } from '../../../../../_components/AnalyticsTracker'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
}

type CanonicalPaths = {
  user: string
  community: string | null
  legacy: string
}

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

type CommunityOrgItem = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified: boolean
  logoUrl?: string | null
  coverUrl?: string | null
}

const COMMENT_SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function ChamberPostPage({ params }: PageProps) {
  const router = useRouter()
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)
  const slugParam = decodeURIComponent(params.slug)

  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [post, setPost] = useState<ApiPost | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'not-found'>('loading')
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentSort, setCommentSort] = useState<'hot' | 'new'>('hot')
  const [appliedCommentSort, setAppliedCommentSort] = useState<'hot' | 'new'>('hot')
  const [pendingVote, setPendingVote] = useState(false)
  const [railPosts, setRailPosts] = useState<ApiPost[]>([])
  const [railOrganizations, setRailOrganizations] = useState<CommunityOrgItem[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/c/')) {
      const target = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}/posts/${slugParam}`
      router.replace(target)
    }
  }, [chamberParam, provinceParam, router, slugParam])

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    try {
      const cached = useViewerStore.getState().me
      if (cached) {
        if (!hasHomeCommunity(cached)) {
          router.replace('/welcome')
          return
        }
        setViewer(cached)
        return
      }

      const data = await ensureViewerMe({ token })
      if (!data) {
        redirectToAuthModal('login')
        return
      }
      if (!hasHomeCommunity(data)) {
        router.replace('/welcome')
        return
      }
      setViewer(data)
    } catch {
      redirectToAuthModal('login')
      /* noop */
    }
  }, [router])

  const loadPost = useCallback(async (sortMode: 'hot' | 'new') => {
    setStatus('loading')
    setComments([])
    try {
      const slugRes = await fetch(`/api/posts/slug/${encodeURIComponent(slugParam)}?commentSort=${sortMode}`)

      let data: any = null
      if (slugRes.ok) {
        data = await slugRes.json()
      } else if (slugRes.status === 404) {
        const idRes = await fetch(`/api/posts/${encodeURIComponent(slugParam)}`)
        if (!idRes.ok) {
          setStatus(idRes.status === 404 ? 'not-found' : 'error')
          setComments([])
          return
        }
        data = await idRes.json()
      } else {
        setStatus('error')
        setComments([])
        return
      }

      const retrievedPost = data.post as ApiPost
      const canonical = data.paths as CanonicalPaths
      const commentTree = normalizeCommentTree((data as { comments?: ApiComment[] }).comments ?? [])

      const provinceMatches = retrievedPost.provinceCode?.toLowerCase() === provinceParam.toLowerCase()
      const communityMatches = retrievedPost.communitySlug?.toLowerCase() === chamberParam.toLowerCase()

      if (!provinceMatches || !communityMatches) {
        if (canonical?.community) {
          if (/^https?:\/\//i.test(canonical.community)) {
            try {
              const url = new URL(canonical.community)
              if (url.origin === window.location.origin) {
                router.replace(`${url.pathname}${url.search}${url.hash}`)
              } else {
                window.location.replace(canonical.community)
              }
            } catch {
              window.location.replace(canonical.community)
            }
          } else {
            router.replace(canonical.community)
          }
          return
        }
      }

      setPost(retrievedPost)
      setComments(commentTree)
      setAppliedCommentSort(sortMode)
      setStatus('loaded')
    } catch (err) {
      console.error('Failed loading post', err)
      setComments([])
      setStatus('error')
    }
  }, [chamberParam, provinceParam, router, slugParam])

  const postId = post?.id
  useRegisterPageView(postId)
  const voteScore = post?.votes?.score ?? post?.counts?.score ?? 0
  const viewerVote = post?.viewer?.vote ?? null

  const handleVote = useCallback(
    async (value: -1 | 0 | 1) => {
      if (!post?.id || pendingVote) return
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      setPendingVote(true)
      try {
        const response = await fetch('/api/posts/vote', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId: post.id, value }),
        })
        if (!response.ok) {
          console.error('Vote request failed', await response.text())
          return
        }
        const data = await response.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPost(updated)
        }
      } catch (err) {
        console.error('Unable to vote on post', err)
      } finally {
        setPendingVote(false)
      }
    },
    [pendingVote, post?.id],
  )

  const loadComments = useCallback(
    async (sortMode: 'hot' | 'new') => {
      if (!postId) return
      try {
        const res = await fetch(`/api/posts/${postId}/comments?sort=${sortMode}`)
        if (!res.ok) {
          console.error('Failed loading comments', res.status)
          return
        }
        const data = await res.json()
        const commentTree = normalizeCommentTree((data as { comments?: ApiComment[] }).comments ?? [])
        setComments(commentTree)
        setAppliedCommentSort(sortMode)
      } catch (err) {
        console.error('Failed loading comments', err)
      }
    },
    [postId],
  )

  useEffect(() => {
    loadViewer().catch(() => {
      /* noop */
    })
  }, [loadViewer])

  useEffect(() => {
    loadPost('hot').catch(() => {
      /* noop */
    })
  }, [loadPost])

  useEffect(() => {
    if (!postId) return
    if (commentSort === appliedCommentSort) return
    loadComments(commentSort).catch(() => {
      /* noop */
    })
  }, [appliedCommentSort, commentSort, loadComments, postId])

  const loadRightRail = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const headers = token ? { authorization: `Bearer ${token}` } : undefined

      const [postsRes, orgsRes] = await Promise.all([
        fetch(buildApiUrl(`/posts?scope=communities&province=${encodeURIComponent(provinceParam)}&community=${encodeURIComponent(chamberParam)}&limit=12`), {
          headers,
        }),
        fetch(buildApiUrl(`/communities/${encodeURIComponent(provinceParam)}/${encodeURIComponent(chamberParam)}/orgs?limit=5`), {
          headers,
        }),
      ])

      if (postsRes.ok) {
        const postsPayload = (await postsRes.json().catch(() => null)) as { items?: ApiPost[] } | null
        const items = Array.isArray(postsPayload?.items) ? postsPayload.items : []
        const filtered = post
          ? items.filter((item) => item.id !== post.id)
          : items
        setRailPosts(filtered.slice(0, 5))
      } else {
        setRailPosts([])
      }

      if (orgsRes.ok) {
        const orgPayload = (await orgsRes.json().catch(() => null)) as { items?: CommunityOrgItem[] } | null
        setRailOrganizations(Array.isArray(orgPayload?.items) ? orgPayload.items.slice(0, 5) : [])
      } else {
        setRailOrganizations([])
      }
    } catch (err) {
      console.error('Unable to load community right rail', err)
      setRailPosts([])
      setRailOrganizations([])
    }
  }, [chamberParam, post, provinceParam])

  useEffect(() => {
    loadRightRail().catch(() => {
      /* noop */
    })
  }, [loadRightRail])

  const handleReply = useCallback(
    async (parentId: string | null, body: string) => {
      if (!post) throw new Error('post_not_loaded')
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        throw new Error('auth_required')
      }

      const requestPayload: Record<string, unknown> = { postId: post.id, body }
      if (parentId) {
        requestPayload.parentId = parentId
      }

      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      })

      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw new Error(message || 'comment_failed')
      }

      const responseData = await response.json().catch(() => null)
      const newComment = (responseData as { comment?: ApiComment })?.comment
      const updatedPost = (responseData as { post?: ApiPost | null })?.post

      if (newComment) {
        setComments((prev) => addCommentToTree(prev, newComment))
        void loadComments(commentSort)
      }
      if (updatedPost) {
        setPost(updatedPost)
      }
    },
    [commentSort, loadComments, post],
  )

  const handleCommentVote = useCallback(async (commentId: string, value: -1 | 0 | 1) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      throw new Error('auth_required')
    }

    const response = await fetch('/api/comments/vote', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ commentId, value }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || 'vote_failed')
    }

    const responseData = await response.json().catch(() => null)
    const updatedComment = (responseData as { comment?: ApiComment | null })?.comment
    if (updatedComment) {
      setComments((prev) => updateCommentInTree(prev, updatedComment))
      void loadComments(commentSort)
    }
  }, [commentSort, loadComments])

  const handleShare = useCallback(async () => {
    if (typeof window === 'undefined') return
    const shareUrl = window.location.href
    const shareText = post?.title || post?.body || 'Post'
    try {
      if (navigator.share) {
        await navigator.share({ title: shareText, text: shareText, url: shareUrl })
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      }
    } catch (err) {
      console.error('Unable to share post', err)
    }
  }, [post?.body, post?.title])

  const communityDisplayName = (post?.communityName ?? chamberParam)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  const rightRail = (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">More in {communityDisplayName}</div>
          <Link href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`} className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            View all
          </Link>
        </div>
        {railPosts.length ? (
          <ul className="mt-3 space-y-3">
            {railPosts.map((item) => {
              const itemCommunityHref = item.provinceCode && item.communitySlug
                ? `/${item.provinceCode.toLowerCase()}/${item.communitySlug.toLowerCase()}/posts/${item.seoSlug ?? item.id}`
                : `/u/${item.author.handle}/posts/${item.seoSlug ?? item.id}`
              const itemCover = item.organization?.coverUrl ?? item.author.coverUrl ?? null
              const itemAvatar = item.organization?.logoUrl ?? item.author.avatarUrl
              const itemName = item.organization?.name ?? (formatUserDisplayName(item.author.name, item.author.handle) || item.author.handle)
              const imageThumb = item.mediaUrl ?? (Array.isArray(item.images) ? item.images[0] ?? null : null)

              return (
                <li key={item.id}>
                  <Link href={itemCommunityHref} className="block rounded-lg border border-slate-200 p-2 hover:bg-slate-50">
                    <div className={clsx('relative overflow-hidden rounded-md border px-2 py-1.5', itemCover ? 'border-slate-300' : 'border-slate-200 bg-slate-50')}>
                      {itemCover ? <img src={itemCover} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                      <span className={clsx('absolute inset-0', itemCover ? 'bg-slate-900/55' : 'bg-transparent')} aria-hidden="true" />
                      <div className="relative z-[1] flex items-center gap-2">
                        <VerifiedAvatar
                          src={itemAvatar}
                          alt={itemName}
                          initials={itemName}
                          size={26}
                          isVerified={Boolean(item.organization?.isVerified ?? item.author.isVerified)}
                          isBusiness={Boolean(item.organization) || Boolean(item.author.isPremium)}
                        />
                        <span className={clsx('truncate text-xs font-semibold', itemCover ? 'text-white' : 'text-slate-800')}>
                          {itemName}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-start gap-2">
                      <p className="line-clamp-2 min-w-0 flex-1 text-sm text-slate-700">
                        {item.title?.trim() || item.body}
                      </p>
                      {imageThumb ? (
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                          <img src={imageThumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No additional posts available yet.</p>
        )}
      </div>

      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">Organizations in {communityDisplayName}</div>
          <Link href={`/com/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}/orgs`} className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            View all
          </Link>
        </div>
        {railOrganizations.length ? (
          <ul className="mt-3 space-y-3">
            {railOrganizations.map((org) => {
              const href = org.provinceCode && org.communitySlug
                ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`
                : '/organizations/directory'
              return (
                <li key={org.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-700">
                  {org.coverUrl ? <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                  <span className="absolute inset-0 bg-slate-900/55" aria-hidden="true" />
                  <Link href={href} className="relative flex items-center gap-2.5 px-3 py-2">
                    <VerifiedAvatar
                      src={org.logoUrl ?? null}
                      alt={org.name}
                      initials={org.name}
                      size={30}
                      isVerified={Boolean(org.isVerified)}
                      isBusiness
                    />
                    <span className="truncate text-sm font-semibold text-white">{org.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No organizations found yet.</p>
        )}
      </div>
    </div>
  )

  const postAuthorDisplayName = post ? formatUserDisplayName(post.author.name, post.author.handle) || post.author.handle : ''
  const postOrganization = post?.organization ?? null
  const authorProfileHref = postOrganization?.provinceCode && postOrganization.communitySlug
    ? `/com/${postOrganization.provinceCode.toLowerCase()}/${postOrganization.communitySlug.toLowerCase()}/orgs/${postOrganization.slug}`
    : post
      ? `/u/${post.author.handle}`
      : '/home'
  const headerCoverUrl = postOrganization?.coverUrl ?? post?.author.coverUrl ?? null
  const hasHeaderCover = Boolean(headerCoverUrl)
  const breadcrumbCommunityName = communityDisplayName

  return (
    <DashboardShell
      rightRail={rightRail}
      mainClassName="space-y-5 lg:min-h-[calc(100vh-48px)]"
    >
      {status === 'loading' ? (
        <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Loading post…</div>
      ) : status === 'not-found' ? (
        <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Post not found.</div>
      ) : status === 'error' ? (
        <div className="rounded border bg-white p-6 text-sm text-red-600 shadow-sm">Unable to load this post right now.</div>
      ) : post ? (
        <article className="rounded border bg-white p-6 shadow-sm">
          <nav className="mb-4 text-xs text-gray-500">
            <Link href="/home" className="hover:underline">
              Home
            </Link>
            <span className="mx-1">/</span>
            <Link
              href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`}
              className="hover:underline"
            >
              {breadcrumbCommunityName}
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">Post</span>
          </nav>

          <header className="space-y-4 border-b border-gray-100 pb-4">
            <div className={clsx('relative overflow-hidden rounded-xl border px-3 py-2', hasHeaderCover ? 'border-slate-300' : 'border-slate-200 bg-slate-50')}>
              {headerCoverUrl ? <img src={headerCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
              <div className={clsx('absolute inset-0', hasHeaderCover ? 'bg-slate-900/50' : 'bg-transparent')} />
              <div className="relative z-[1] flex items-start gap-3">
                <VerifiedAvatar
                  src={postOrganization ? (postOrganization.logoUrl ?? null) : post.author.avatarUrl}
                  alt={postAuthorDisplayName}
                  initials={postAuthorDisplayName}
                  size={56}
                  isVerified={postOrganization ? Boolean(postOrganization.isVerified) : Boolean(post.author.isVerified)}
                  isBusiness={postOrganization ? true : Boolean(post.author.isPremium)}
                  className="shrink-0"
                  href={authorProfileHref}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className={clsx('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm', hasHeaderCover ? 'text-white/80' : 'text-slate-500')}>
                    <Link href={authorProfileHref} className={clsx('font-semibold hover:underline', hasHeaderCover ? 'text-white' : 'text-slate-900')}>
                      {postOrganization?.name ?? postAuthorDisplayName}
                    </Link>
                    <span>@{post.author.handle}</span>
                    <span className="text-xs">• {formatDateTime(post.createdAt)}</span>
                  </div>
                  <div className={clsx('flex flex-wrap items-center gap-2 text-xs font-semibold', hasHeaderCover ? 'text-white/85' : 'text-slate-500')}>
                    <span className={clsx('rounded-full px-2 py-0.5', hasHeaderCover ? 'border border-white/35 text-white/85' : 'bg-slate-100 text-slate-600')}>
                      {JURISDICTION_LABELS[post.jurisdiction]}
                    </span>
                    {post.provinceCode && post.communitySlug ? (
                      <Link
                        href={`/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}`}
                        className={clsx('rounded-full px-2 py-0.5 uppercase tracking-wide', hasHeaderCover ? 'border border-white/35 text-white/85 hover:border-white/60' : 'border border-slate-200 text-slate-500 hover:border-slate-300')}
                      >
                        {post.communityName ?? post.communitySlug}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 text-[16px] leading-7 text-gray-900">
              {post.mediaUrl ? (
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  <img
                    src={post.mediaUrl}
                    alt={post.title || post.body || 'Post image'}
                    className="h-auto w-full max-h-[75vh] object-contain bg-gray-900/5"
                    loading="lazy"
                  />
                </div>
              ) : null}
              {post.type === 'article' && post.title ? (
                <h1 className="text-2xl font-semibold text-gray-900">{post.title}</h1>
              ) : null}
              {post.type === 'article' ? (
                <div className="prose prose-base max-w-none" dangerouslySetInnerHTML={{ __html: post.body }} />
              ) : (
                <div className="whitespace-pre-wrap">{post.body}</div>
              )}
            </div>
          </header>

          <footer className="mt-6 space-y-3 text-xs text-gray-500">
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => void handleVote(viewerVote === 1 ? 0 : 1)}
                  className={clsx(
                    'inline-flex items-center rounded-full p-1.5 transition',
                    viewerVote === 1
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800',
                    pendingVote && 'pointer-events-none opacity-60',
                  )}
                  aria-label="Upvote post"
                >
                  <LuArrowBigUp className="h-4 w-4" />
                </button>
                <span className="min-w-[2ch] text-center text-sm font-semibold text-gray-700">{voteScore}</span>
                <button
                  type="button"
                  onClick={() => void handleVote(viewerVote === -1 ? 0 : -1)}
                  className={clsx(
                    'inline-flex items-center rounded-full p-1.5 transition',
                    viewerVote === -1
                      ? 'bg-rose-50 text-rose-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800',
                    pendingVote && 'pointer-events-none opacity-60',
                  )}
                  aria-label="Downvote post"
                >
                  <LuArrowBigDown className="h-4 w-4" />
                </button>
              </div>
              {post.counts ? (
                <a
                  href="#comments"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Open comments"
                >
                  <LuMessageCircle className="h-4 w-4" />
                  <span>{post.counts.commentCount}</span>
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void handleShare()}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <LuShare className="h-4 w-4" />
                <span>Share</span>
              </button>
            </div>
          </footer>

          <section id="comments" className="mt-6">
            <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-wide text-gray-500">
              <div className="flex gap-3 font-semibold">
                {COMMENT_SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`pb-1 transition ${
                      commentSort === option.value
                        ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                        : 'text-gray-400 hover:text-[var(--cc-primary)]'
                    }`}
                    onClick={() => setCommentSort(option.value)}
                    disabled={commentSort === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {viewer ? (
              <CommentComposer className="mt-4" onSubmit={(body) => handleReply(null, body)} />
            ) : (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <span>Sign in to join the conversation.</span>
                <button
                  type="button"
                  onClick={() => redirectToAuthModal('login')}
                  className="inline-flex items-center bg-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)]"
                >
                  Sign in
                </button>
              </div>
            )}

            <div className="mt-6">
              <CommentThread comments={comments} onReply={handleReply} onVote={handleCommentVote} currentUser={viewer} />
            </div>
          </section>
        </article>
      ) : null}
    </DashboardShell>
  )
}
