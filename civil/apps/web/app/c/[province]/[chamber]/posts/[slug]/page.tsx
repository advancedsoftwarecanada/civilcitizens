"use client"

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { LuFlame, LuFrown, LuHeart, LuLaugh, LuSparkles } from 'react-icons/lu'
import type { IconBaseProps, IconType } from 'react-icons'
import { type ReactionType } from '@civil/shared'
import { useRouter } from 'next/navigation'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../../_components/PostComposer'
import CommentComposer from '../../../../../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../../../../../_components/CommentThread'
import { buildApiUrl } from '../../../../../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../../../../../_lib/me'
import { redirectToAuthModal } from '../../../../../_lib/authModal'
import { ensureViewerMe } from '../../../../../_lib/viewerMe'
import { useViewerStore } from '../../../../../_lib/viewerStore'
import { addCommentToTree, normalizeCommentTree, updateCommentInTree } from '../../../../../_lib/comments'
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

const COMMENT_SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

type ReactionOption = {
  type: ReactionType
  label: string
  icon: IconType
  activeIcon?: IconType
  accentClass: string
}

const MapleIconNeutral: IconType = ({ className, size = 16 }: IconBaseProps) => (
  <Image src="/maple-leaf-red.svg" alt="" width={Number(size)} height={Number(size)} className={className} />
)

const MapleIconActive: IconType = ({ className, size = 16 }: IconBaseProps) => (
  <Image src="/maple-leaf-red.svg" alt="" width={Number(size)} height={Number(size)} className={className} />
)

const REACTION_OPTIONS: ReactionOption[] = [
  { type: 'maple', label: 'Like', icon: MapleIconNeutral, activeIcon: MapleIconActive, accentClass: 'border-red-200 bg-red-50 text-red-700' },
  { type: 'heart', label: 'Heart', icon: LuHeart, accentClass: 'border-rose-200 bg-rose-50 text-rose-700' },
  { type: 'haha', label: 'Haha', icon: LuLaugh, accentClass: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  { type: 'wow', label: 'Wow', icon: LuSparkles, accentClass: 'border-sky-200 bg-sky-50 text-sky-700' },
  { type: 'sad', label: 'Support', icon: LuFrown, accentClass: 'border-slate-200 bg-slate-50 text-slate-700' },
  { type: 'fire', label: 'Fire', icon: LuFlame, accentClass: 'border-orange-200 bg-orange-50 text-orange-700' },
]

type ReactionButtonProps = {
  option: ReactionOption
  count: number
  active: boolean
  blocked: boolean
  disabled: boolean
  onClick: () => void
}

function ReactionButton({ option, count, active, blocked, disabled, onClick }: ReactionButtonProps) {
  const Icon = active && option.activeIcon ? option.activeIcon : option.icon
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${active ? option.accentClass : blocked ? 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-200' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 focus:ring-[var(--cc-primary)]'} ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      onClick={() => {
        if (disabled || blocked) return
        onClick()
      }}
      aria-label={`${option.label} reaction`}
      disabled={disabled || blocked}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? <span>{count}</span> : <span className="text-[11px] font-normal text-slate-500">{option.label}</span>}
    </button>
  )
}

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
  const [pendingReaction, setPendingReaction] = useState(false)

  const viewerIsVerified = Boolean(viewer?.isVerified || viewer?.isPremium)

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
  }, [])

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
  const reactionCounts =
    post?.reactions ?? { maple: 0, heart: 0, haha: 0, wow: 0, sad: 0, fire: 0, total: 0, positive: 0 }
  const currentReaction = (post?.viewer?.reaction ?? null) as ReactionType | null
  const totalReactions = reactionCounts.total ?? 0

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

  const handleReact = useCallback(
    async (nextReaction: ReactionType | null) => {
      if (!post?.id) return
      if (pendingReaction) return
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      if (!viewerIsVerified) {
        redirectToAuthModal('login')
        return
      }
      setPendingReaction(true)
      try {
        const res = await fetch('/api/posts/react', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId: post.id, reaction: nextReaction }),
        })
        if (!res.ok) {
          console.error('Reaction request failed', await res.text())
          return
        }
        const data = await res.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPost(updated)
        }
      } catch (err) {
        console.error('Unable to react to post', err)
      } finally {
        setPendingReaction(false)
      }
    },
    [pendingReaction, post?.id, viewerIsVerified],
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

  const rightRail = (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Keep exploring</div>
        <p className="mt-2 text-sm text-gray-600">
          Jump back to the community feed or browse neighbouring ridings to see how other citizens are weighing in.
        </p>
        <Link
          href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`}
          className="mt-3 inline-flex items-center justify-center rounded bg-[var(--cc-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--cc-primary-700)]"
        >
          Return to community
        </Link>
      </div>
      <div className="rounded border bg-white p-4 shadow-sm text-sm text-gray-600">
        Share thoughtful updates and tag your community to reach neighbours faster. Articles support full formatting for deeper dives.
      </div>
    </div>
  )

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
              Community feed
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">Post</span>
          </nav>

          <header className="border-b border-gray-100 pb-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <span className="font-semibold text-gray-900">@{post.author.handle}</span>
              <span className="text-xs">• {formatDateTime(post.createdAt)}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                {JURISDICTION_LABELS[post.jurisdiction]}
              </span>
              {post.provinceCode && post.communitySlug ? (
                <Link
                  href={`/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}`}
                  className="rounded-full border border-gray-200 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50"
                >
                  {post.communityName ?? post.communitySlug}
                </Link>
              ) : null}
            </div>

            <div className="mt-4 space-y-4 text-[16px] leading-7 text-gray-900">
              {post.mediaUrl ? (
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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
            <div className="flex flex-wrap items-center gap-2">
              {REACTION_OPTIONS.map((option) => (
                <ReactionButton
                  key={option.type}
                  option={option}
                  count={(reactionCounts as Record<ReactionType, number>)[option.type] ?? 0}
                  active={currentReaction === option.type && viewerIsVerified}
                  blocked={!viewerIsVerified}
                  disabled={pendingReaction}
                  onClick={() => handleReact(currentReaction === option.type ? null : option.type)}
                />
              ))}
              {!viewerIsVerified ? <span className="text-[11px] text-gray-500">Only verified members can react.</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-gray-700">
                {totalReactions === 1 ? '1 reaction' : `${totalReactions} reactions`}
              </span>
              {post.counts ? (
                <span>
                  {post.counts.commentCount === 1 ? '1 comment' : `${post.counts.commentCount} comments`}
                </span>
              ) : null}
            </div>
          </footer>

          <section className="mt-8 border-t border-gray-200 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Comments</h2>
              {post.counts ? <span className="text-sm text-gray-500">{post.counts.commentCount} total</span> : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs uppercase tracking-wide text-gray-500">
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
