"use client"

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../../../../_components/Sidebar'
import { RightRail } from '../../../../_components/RightRail'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../_components/PostComposer'
import CommentComposer from '../../../../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../../../../_components/CommentThread'
import { redirectToAuthModal } from '../../../../_lib/authModal'
import { addCommentToTree, normalizeCommentTree, updateCommentInTree } from '../../../../_lib/comments'
import VerifiedAvatar from '../../../../_components/VerifiedAvatar'

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
  chamber: string | null
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
      const res = await fetch(`/api/posts/slug/${encodeURIComponent(slugParam)}?commentSort=${sortMode}`)
      if (!res.ok) {
        setStatus(res.status === 404 ? 'not-found' : 'error')
        setComments([])
        return
      }
      const data = await res.json()
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
                {paths?.chamber ? (
                  <>
                    <span className="mx-1">/</span>
                    <Link href={paths.chamber} className="hover:underline">
                      {post.chamberName ?? post.chamberSlug}
                    </Link>
                  </>
                ) : null}
              </nav>

                <header className="flex flex-col gap-4 md:flex-row md:items-start">
                  <VerifiedAvatar
                    src={post.author.avatarUrl}
                    alt={post.author.name ?? post.author.handle}
                    initials={post.author.name ?? post.author.handle}
                    size={56}
                    isVerified={Boolean(post.author.isVerified ?? post.author.isPremium)}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                      <Link href={`/u/${post.author.handle}`} className="font-semibold text-slate-900 hover:underline">
                        {post.author.name ?? post.author.handle}
                      </Link>
                      <span>@{post.author.handle}</span>
                      <span className="text-xs">• {formatDateTime(post.createdAt)}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {JURISDICTION_LABELS[post.jurisdiction]}
                      </span>
                      {post.provinceCode && post.chamberSlug ? (
                        <Link
                          href={`/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}`}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-500 hover:bg-slate-50"
                        >
                          {post.chamberName ?? post.chamberSlug}
                        </Link>
                      ) : null}
                    </div>
                    <div className="text-[16px] leading-7 text-slate-900">
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

                <footer className="mt-6 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                  {post.counts ? (
                    <span>
                      {post.counts.score} points • {post.counts.commentCount} comments
                    </span>
                  ) : null}
                  <span>Canonical: {paths?.user ?? buildLegacyPath(post)}</span>
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
