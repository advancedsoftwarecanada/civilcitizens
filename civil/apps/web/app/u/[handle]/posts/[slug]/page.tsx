"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { LuMessageCircle, LuRepeat2, LuShare } from 'react-icons/lu'
import { HiTrash } from 'react-icons/hi2'
import type { ReactionType } from '@civil/shared'
import Sidebar from '../../../../_components/Sidebar'
import { RightRail } from '../../../../_components/RightRail'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../_components/PostComposer'
import CommentComposer from '../../../../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../../../../_components/CommentThread'
import CivilCard from '../../../../_components/CivilCard'
import CivilLinkPreviewList from '../../../../_components/CivilLinkPreviewList'
import ContentModerationMenu from '../../../../_components/ContentModerationMenu'
import PostReactionBar from '../../../../_components/PostReactionBar'
import PollCard from '../../../../_components/PollCard'
import ThreadBottomCommentComposer from '../../../../_components/ThreadBottomCommentComposer'
import SharePostModal from '../../../../_components/SharePostModal'
import ShareSendModal from '../../../../_components/ShareSendModal'
import { pushToast } from '../../../../_components/useToasts'
import { redirectToAuthModal } from '../../../../_lib/authModal'
import { buildApiUrl } from '../../../../_lib/api'
import { buildPostShareTarget } from '../../../../_lib/shareTarget'
import { stripCivilUrlsFromHtml, stripCivilUrlsFromText } from '../../../../_lib/civilLinks'
import { getStoredToken } from '../../../../_lib/tokenStorage'
import { ensureViewerMe } from '../../../../_lib/viewerMe'
import { useViewerStore } from '../../../../_lib/viewerStore'
import { addCommentToTree, normalizeCommentTree, updateCommentInTree } from '../../../../_lib/comments'
import { formatUserDisplayName } from '../../../../_lib/text'
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
  const router = useRouter()
  const handleParam = decodeURIComponent(params.handle)
  const slugParam = decodeURIComponent(params.slug)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [post, setPost] = useState<ApiPost | null>(null)
  const [paths, setPaths] = useState<CanonicalPaths | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'not-found'>('loading')
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentSort, setCommentSort] = useState<'hot' | 'new'>('hot')
  const [appliedCommentSort, setAppliedCommentSort] = useState<'hot' | 'new'>('hot')
  const [pendingVote, setPendingVote] = useState(false)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const cached = useViewerStore.getState().me
      if (cached) {
        setViewer(cached)
        return
      }
      const data = await ensureViewerMe({ token })
      if (!data) return
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
          if (/^https?:\/\//i.test(canonical.user)) {
            try {
              const url = new URL(canonical.user)
              if (url.origin === window.location.origin) {
                router.replace(`${url.pathname}${url.search}${url.hash}`)
              } else {
                window.location.replace(canonical.user)
              }
            } catch {
              window.location.replace(canonical.user)
            }
          } else {
            router.replace(canonical.user)
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
  }, [handleParam, router, slugParam])

  const postId = post?.id
  useRegisterPageView(postId)
  const viewerReaction = post?.viewer?.reaction ?? null
  const shareTarget = useMemo(() => (post ? buildPostShareTarget(post) : null), [post])
  const postBodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromText(post?.body), [post?.body])
  const postArticleBodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromHtml(post?.body), [post?.body])

  const handleReact = useCallback(
    async (reaction: ReactionType | null) => {
      if (!post?.id || pendingVote) return
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      setPendingVote(true)
      try {
        const res = await fetch('/api/posts/react', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId: post.id, reaction }),
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
  const postOrganization = post?.organization ?? null
  const authorProfileHref = postOrganization?.provinceCode && postOrganization.communitySlug
    ? `/com/${postOrganization.provinceCode.toLowerCase()}/${postOrganization.communitySlug.toLowerCase()}/orgs/${postOrganization.slug}`
    : post
      ? `/u/${post.author.handle}`
      : '/home'
  const headerCoverUrl = postOrganization?.coverUrl ?? post?.author.coverUrl ?? null
  const isAuthor = Boolean(viewer?.id && post?.author.id && viewer.id === post.author.id)
  const reportTargetLabel = post?.title?.trim() || postOrganization?.name || postAuthorDisplayName || 'Post'
  const blockTarget = post
    ? postOrganization
      ? {
          type: 'organization' as const,
          id: postOrganization.id,
          label: postOrganization.name,
        }
      : {
          type: 'user' as const,
          id: post.author.id,
          label: postAuthorDisplayName || post.author.handle,
        }
    : null
  const postDeletedRedirectHref = post ? `/u/${post.author.handle}` : '/home'
  const postSettingsActions = isAuthor
    ? [
        {
          key: 'delete',
          label: 'Delete',
          icon: HiTrash,
          tone: 'danger' as const,
          onSelect: async () => {
            if (!post) return
            if (!window.confirm('Are you sure you want to delete this post?')) return

            const token = getStoredToken()
            if (!token) {
              redirectToAuthModal('login')
              return
            }

            try {
              const response = await fetch(buildApiUrl(`/posts/${encodeURIComponent(post.id)}`), {
                method: 'DELETE',
                headers: {
                  authorization: `Bearer ${token}`,
                },
              })

              if (!response.ok) {
                pushToast('Failed to delete post.', 'error')
                return
              }

              pushToast('Post deleted.', 'success')
              router.push(postDeletedRedirectHref)
            } catch {
              pushToast('Failed to delete post.', 'error')
            }
          },
        },
      ]
    : []

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white">
      <div className="border-b border-white/60 bg-white/80 py-4 shadow-sm backdrop-blur lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} active="home" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pl-[18rem] lg:pr-0 xl:pl-[20rem] xl:pr-0">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">

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

                <header className="relative space-y-4">
                  <CivilCard
                    size="banner"
                    name={postOrganization?.name ?? postAuthorDisplayName}
                    subtitle={`@${post.author.handle} • ${formatDateTime(post.createdAt)}`}
                    details={
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/85">
                        <span className="rounded-full border border-white/35 px-2 py-0.5 text-white/85">
                          {JURISDICTION_LABELS[post.jurisdiction]}
                        </span>
                        {post.provinceCode && post.communitySlug ? (
                          <Link
                            href={`/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}`}
                            className="rounded-full border border-white/35 px-2 py-0.5 uppercase tracking-wide text-white/85 hover:border-white/60"
                          >
                            {post.communityName ?? post.communitySlug}
                          </Link>
                        ) : null}
                      </div>
                    }
                    avatarAlt={postAuthorDisplayName}
                    avatarInitials={postAuthorDisplayName}
                    avatarSrc={postOrganization ? (postOrganization.logoUrl ?? null) : post.author.avatarUrl}
                    avatarHref={authorProfileHref}
                    titleHref={authorProfileHref}
                    coverUrl={headerCoverUrl}
                    isVerified={postOrganization ? Boolean(postOrganization.isVerified) : Boolean(post.author.isVerified)}
                    isBusiness={postOrganization ? true : Boolean(post.author.isPremium)}
                    contentClassName="pr-14"
                  />
                  <div className="absolute right-3 top-3 z-20">
                    <ContentModerationMenu
                      actions={postSettingsActions}
                      reportTarget={
                        post && !isAuthor
                          ? {
                              targetType: 'POST',
                              targetId: post.id,
                              targetLabel: reportTargetLabel,
                            }
                          : null
                      }
                      blockTarget={post && !isAuthor ? blockTarget : null}
                      buttonLabel={isAuthor ? 'Post actions' : 'Post settings'}
                      onReported={() => router.push('/home')}
                      onBlocked={() => router.push('/home')}
                    />
                  </div>
                  <div className="text-[16px] leading-7 text-slate-900">
                    <PostDetailImages images={post.images} mediaUrl={post.mediaUrl} />
                    {post.type === 'article' && post.title ? (
                      <h1 className="text-3xl font-semibold text-slate-900">{post.title}</h1>
                    ) : null}
                    <div className="mt-4 space-y-4">
                      {post.type === 'article' ? (
                        postArticleBodyWithoutCivilLinks ? (
                          <div className="prose prose-base max-w-none" dangerouslySetInnerHTML={{ __html: postArticleBodyWithoutCivilLinks }} />
                        ) : null
                      ) : postBodyWithoutCivilLinks ? (
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-[17px] leading-7 text-slate-900">{postBodyWithoutCivilLinks}</div>
                      ) : null}
                      <CivilLinkPreviewList body={post.body} />
                      {post.type === 'poll' && post.poll ? (
                        <PollCard
                          post={post}
                          viewerId={viewer?.id ?? null}
                          onPostUpdate={setPost}
                          variant="detail"
                        />
                      ) : null}
                    </div>
                  </div>
                </header>

                <footer className="mt-6 space-y-3 text-xs text-slate-500">
                  <div className="space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
                    <div className="flex w-full justify-center sm:justify-start">
                      <PostReactionBar
                        className="w-full justify-center sm:w-auto sm:justify-start"
                        reactions={post.reactions}
                        viewerReaction={viewerReaction}
                        disabled={pendingVote}
                        onReact={(reaction) => handleReact(reaction)}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
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
                        onClick={() => setRepostModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <LuRepeat2 className="h-4 w-4" />
                        <span>Repost</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <LuShare className="h-4 w-4" />
                        <span>Share</span>
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">Canonical: {paths?.user ?? buildLegacyPath(post)}</div>
                </footer>

                <section id="comments" className="mt-6">
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
                  {viewer ? (
                    <CommentComposer className="mt-4 hidden lg:block" onSubmit={(body) => handleReply(null, body)} />
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
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
                  {viewer ? <div className="h-28 lg:hidden" aria-hidden="true" /> : null}
                </section>

                {repostModalOpen && shareTarget ? (
                  <SharePostModal
                    target={shareTarget}
                    onClose={() => setRepostModalOpen(false)}
                  />
                ) : null}

                {shareModalOpen && shareTarget ? (
                  <ShareSendModal
                    target={shareTarget}
                    onClose={() => setShareModalOpen(false)}
                  />
                ) : null}
              </article>
            ) : null}
          </main>

          <aside className="hidden lg:block">
            <RightRail />
          </aside>
        </div>
      </div>
      {viewer ? <ThreadBottomCommentComposer onSubmit={(body) => handleReply(null, body)} /> : null}
    </div>
  )
}

function buildLegacyPath(post: ApiPost) {
  const slug = post.seoSlug ?? post.id
  if (post.author?.handle) {
    return `/u/${post.author.handle}/posts/${slug}`
  }
  return `/post/${post.id}`
}
