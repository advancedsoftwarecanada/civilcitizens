"use client"

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import clsx from 'clsx'
import { LuFlame, LuFrown, LuHeart, LuLaugh, LuSparkles } from 'react-icons/lu'
import type { IconBaseProps, IconType } from 'react-icons'
import { type ReactionType } from '@civil/shared'
import Sidebar from '../../../../_components/Sidebar'
import { RightRail } from '../../../../_components/RightRail'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../_components/PostComposer'
import CommentComposer from '../../../../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../../../../_components/CommentThread'
import { redirectToAuthModal } from '../../../../_lib/authModal'
import { addCommentToTree, normalizeCommentTree, updateCommentInTree } from '../../../../_lib/comments'
import { formatUserDisplayName } from '../../../../_lib/text'
import VerifiedAvatar from '../../../../_components/VerifiedAvatar'
import { useRegisterPageView } from '../../../../_components/AnalyticsTracker'

function PostDetailImages({ images, mediaUrl }: { images?: string[] | null; mediaUrl?: string | null }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const allImages = images && images.length > 0 ? images : mediaUrl ? [mediaUrl] : []

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedIndex((prev) => {
      if (prev === null) return null
      return prev === 0 ? allImages.length - 1 : prev - 1
    })
  }, [allImages.length])

  const handleNext = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedIndex((prev) => {
      if (prev === null) return null
      return prev === allImages.length - 1 ? 0 : prev + 1
    })
  }, [allImages.length])

  useEffect(() => {
    if (selectedIndex === null) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'Escape') setSelectedIndex(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, handleNext, handlePrev])

  if (allImages.length === 0) return null

  return (
    <>
      <div
        className={clsx(
          'mb-6 grid gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50',
          allImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3',
        )}
      >
        {allImages.map((src, index) => {
          let className = 'relative aspect-square w-full overflow-hidden bg-slate-100 hover:opacity-95 transition cursor-zoom-in'
          
          if (allImages.length === 1) {
            className = 'relative w-full overflow-hidden bg-slate-100 cursor-zoom-in'
          } else if (allImages.length === 3 && index === 0) {
            className += ' col-span-2 row-span-2'
          }

          return (
            <button
              key={src}
              type="button"
              onClick={() => setSelectedIndex(index)}
              className={className}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Post image ${index + 1}`}
                className={clsx(
                  'h-full w-full',
                  allImages.length === 1 ? 'max-h-[80vh] object-contain' : 'object-cover',
                )}
              />
            </button>
          )
        })}
      </div>

      {selectedIndex !== null ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 backdrop-blur-sm"
          onClick={() => setSelectedIndex(null)}
        >
          <button className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-8 w-8"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {allImages.length > 1 ? (
            <>
              <button
                onClick={handlePrev}
                className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/70 hover:bg-white/20 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/70 hover:bg-white/20 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </>
          ) : null}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={allImages[selectedIndex]}
            alt="Full size"
            className="max-h-full max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  )
}

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
    handle: string
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
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function UserPostPage({ params }: PageProps) {
  const handleParam = decodeURIComponent(params.handle)
  const slugParam = decodeURIComponent(params.slug)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [post, setPost] = useState<ApiPost | null>(null)
  const [paths, setPaths] = useState<CanonicalPaths | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'not-found'>('loading')
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentSort, setCommentSort] = useState<'hot' | 'new'>('hot')
  const [appliedCommentSort, setAppliedCommentSort] = useState<'hot' | 'new'>('hot')
  const [pendingReaction, setPendingReaction] = useState(false)

  const viewerIsVerified = Boolean(viewer?.isVerified || viewer?.isPremium)

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setViewer(data)
    } catch {
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

      setPaths(canonical)

      if (retrievedPost.author.handle.toLowerCase() !== handleParam.toLowerCase()) {
        if (canonical?.user) {
          window.location.replace(canonical.user)
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
  }, [handleParam, slugParam])

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

  const postAuthorDisplayName = post ? formatUserDisplayName(post.author.name, post.author.handle) || post.author.handle : ''

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white">
      <div className="border-b border-white/60 bg-white/80 py-4 shadow-sm backdrop-blur lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pr-0 xl:pl-12 xl:pr-0">
        <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <div className="hidden lg:block">
            <Sidebar me={viewer ?? undefined} active="home" />
          </div>

          <main className="space-y-8 py-8">
            {status === 'loading' ? (
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 text-sm text-slate-500 shadow-subtle">Loading post…</div>
            ) : status === 'not-found' ? (
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 text-sm text-slate-500 shadow-subtle">Post not found.</div>
            ) : status === 'error' ? (
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 text-sm text-red-600 shadow-subtle">Unable to load this post right now.</div>
            ) : post ? (
              <article className="rounded-[32px] border border-white/70 bg-white/95 p-6 shadow-panel sm:p-8">
                <nav className="mb-4 text-xs text-gray-500">
                <Link href="/home" className="hover:underline">
                  Home
                </Link>
                <span className="mx-1">/</span>
                <Link href={`/u/${post.author.handle}`} className="hover:underline">
                  @{post.author.handle}
                </Link>
                {paths?.community ? (
                  <>
                    <span className="mx-1">/</span>
                    <Link href={paths.community} className="hover:underline">
                      {post.communityName ?? post.communitySlug}
                    </Link>
                  </>
                ) : null}
              </nav>

                <header className="flex flex-col gap-4 md:flex-row md:items-start">
                  <VerifiedAvatar
                    src={post.author.avatarUrl}
                    alt={postAuthorDisplayName}
                    initials={postAuthorDisplayName}
                    size={56}
                    isVerified={Boolean(post.author.isVerified)}
                    isBusiness={Boolean(post.author.isPremium)}
                    className="shrink-0"
                    href={`/u/${post.author.handle}`}
                  />
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                      <Link href={`/u/${post.author.handle}`} className="font-semibold text-slate-900 hover:underline">
                        {postAuthorDisplayName}
                      </Link>
                      <span>@{post.author.handle}</span>
                      <span className="text-xs">• {formatDateTime(post.createdAt)}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {JURISDICTION_LABELS[post.jurisdiction]}
                      </span>
                      {post.provinceCode && post.communitySlug ? (
                        <Link
                          href={`/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}`}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-500 hover:bg-slate-50"
                        >
                          {post.communityName ?? post.communitySlug}
                        </Link>
                      ) : null}
                    </div>
                    <div className="text-[16px] leading-7 text-slate-900">
                      <PostDetailImages images={post.images} mediaUrl={post.mediaUrl} />
                      {post.type === 'article' && post.title ? (
                        <h1 className="text-3xl font-semibold text-slate-900">{post.title}</h1>
                      ) : null}
                      <div className="mt-4 space-y-4">
                        {post.type === 'article' ? (
                          <div className="prose prose-base max-w-none" dangerouslySetInnerHTML={{ __html: post.body }} />
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-[17px] leading-7 text-slate-900">{post.body}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </header>

                <footer className="mt-6 space-y-3 text-xs text-slate-500">
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
                    {!viewerIsVerified ? <span className="text-[11px] text-slate-500">Only verified members can react.</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-slate-700">
                      {totalReactions === 1 ? '1 reaction' : `${totalReactions} reactions`}
                    </span>
                    {post.counts ? (
                      <span>{post.counts.commentCount === 1 ? '1 comment' : `${post.counts.commentCount} comments`}</span>
                    ) : null}
                    <span>Canonical: {paths?.user ?? buildLegacyPath(post)}</span>
                  </div>
                </footer>

                <section className="mt-8 rounded-[28px] border border-white/70 bg-white/95 p-5 shadow-subtle">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Comments</p>
                      {post.counts ? (
                        <h2 className="text-lg font-semibold text-slate-900">{post.counts.commentCount} total</h2>
                      ) : (
                        <h2 className="text-lg font-semibold text-slate-900">Join the conversation</h2>
                      )}
                    </div>
                    <div className="inline-flex rounded-full bg-slate-100 p-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {COMMENT_SORT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`rounded-full px-4 py-1 transition ${
                            commentSort === option.value
                              ? 'bg-white text-[var(--cc-primary)] shadow-subtle'
                              : 'text-slate-500'
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
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <span>Sign in to join the conversation.</span>
                      <button
                        type="button"
                        onClick={() => redirectToAuthModal('login')}
                        className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)]"
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
          </main>

          <aside className="hidden lg:block">
            <RightRail />
          </aside>
        </div>
      </div>
    </div>
  )
}

function buildLegacyPath(post: ApiPost) {
  return `/post/${post.id}`
}
