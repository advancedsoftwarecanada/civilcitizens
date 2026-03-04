"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { LuMessageCircle, LuRepeat2, LuShare } from 'react-icons/lu'
import { HiEllipsisHorizontal, HiPencil, HiTrash } from 'react-icons/hi2'
import type { ReactionType } from '@civil/shared'
import type { ApiPost, CommunityTarget } from './PostComposer'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'
import { buildApiUrl } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'
import Modal from './Modal'
import SharePostModal from './SharePostModal'
import ShareSendModal from './ShareSendModal'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildPostShareTarget } from '../_lib/shareTarget'
import CivilLinkPreviewList from './CivilLinkPreviewList'
import { stripCivilUrlsFromHtml, stripCivilUrlsFromText } from '../_lib/civilLinks'
import PostReactionBar from './PostReactionBar'

const FEED_COMMENT_PREVIEW_LIMIT = 3
const FEED_COMMENT_BUFFER_LIMIT = 20

function buildPostUrl(post: ApiPost) {
  const slug = post.seoSlug ?? post.id
  if (post.provinceCode && post.communitySlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/posts/${slug}`
  }
  return `/u/${post.author.handle}/posts/${slug}`
}

function buildCommunityUrl(post: ApiPost) {
  if (post.provinceCode && post.communitySlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}`
  }
  return null
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const seconds = Math.max(1, Math.round(diffMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.round(days / 365)
  return `${years}y`
}

type PostFeedItemProps = {
  post: ApiPost
  onReact?: (postId: string, reaction: ReactionType | null) => Promise<void>
  onDelete?: (postId: string) => void
  onUpdate?: (post: ApiPost) => void
  viewerId?: string | null
  communityOptions?: CommunityTarget[]
}

function PostImageGrid({ images, mediaUrl, postUrl }: { images?: string[] | null; mediaUrl?: string | null; postUrl: string }) {
  const allImages = images && images.length > 0 ? images : mediaUrl ? [mediaUrl] : []
  if (allImages.length === 0) return null

  if (allImages.length === 1) {
    return (
      <Link href={postUrl} className="block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <img
          src={allImages[0]}
          alt="Post image"
          className="h-auto w-full max-h-[70vh] object-contain bg-slate-900/5"
          loading="lazy"
        />
      </Link>
    )
  }

  const displayImages = allImages.slice(0, 5)
  const remainingCount = allImages.length - 5

  return (
    <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:grid-cols-6">
      {displayImages.map((src, index) => {
        // Layout logic for up to 5 images
        // 2 images: 50/50 (col-span-3)
        // 3 images: 1st (col-span-4), 2nd/3rd (col-span-2) - wait, 6 cols.
        // Let's try a simpler approach with CSS grid classes based on count.

        let className = 'relative aspect-square w-full overflow-hidden bg-slate-100'
        const isLast = index === displayImages.length - 1

        if (displayImages.length === 2) {
          className += ' col-span-1 sm:col-span-3'
        } else if (displayImages.length === 3) {
          if (index === 0) className += ' col-span-2 sm:col-span-4 row-span-2'
          else className += ' col-span-1 sm:col-span-2'
        } else if (displayImages.length === 4) {
          className += ' col-span-1 sm:col-span-3'
        } else if (displayImages.length >= 5) {
          if (index < 2) className += ' col-span-1 sm:col-span-3'
          else if (index === 4) className += ' col-span-2 sm:col-span-2'
          else className += ' col-span-1 sm:col-span-2'
        }

        return (
          <Link key={src} href={postUrl} className={className}>
            <img src={src} alt={`Post image ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
            {isLast && remainingCount > 0 ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-bold text-white backdrop-blur-sm">
                +{remainingCount} more
              </div>
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

export default function PostFeedItem({ post, onReact, onDelete, onUpdate, viewerId, communityOptions }: PostFeedItemProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [editBody, setEditBody] = useState(post.body)
  const [editTitle, setEditTitle] = useState(post.title ?? '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [inlineComment, setInlineComment] = useState('')
  const [inlineSubmitting, setInlineSubmitting] = useState(false)
  const [activeReplyParentId, setActiveReplyParentId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [recentComments, setRecentComments] = useState(post.recentComments ?? [])
  const [hideInlineCommentComposer, setHideInlineCommentComposer] = useState(false)
  const [commentPreviewSort, setCommentPreviewSort] = useState<'new' | 'hot'>('new')
  const menuRef = useRef<HTMLDivElement>(null)
  const commentCount = post.counts?.commentCount ?? 0
  const viewerReaction = post.viewer?.reaction ?? null
  const postUrl = buildPostUrl(post)
  const shareTarget = useMemo(() => buildPostShareTarget(post), [post])
  const bodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromText(post.body), [post.body])
  const articleBodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromHtml(post.body), [post.body])
  const sharedPostBodyWithoutCivilLinks = useMemo(
    () => (post.sharedPost ? stripCivilUrlsFromText(post.sharedPost.body) : ''),
    [post.sharedPost],
  )
  const communityUrl = buildCommunityUrl(post)
  const createdAt = new Date(post.createdAt)
  const organization = post.organization ?? null
  const isVerifiedAuthor = organization ? Boolean(organization.isVerified) : Boolean(post.author.isVerified)
  const isBusinessAuthor = organization ? true : Boolean(post.author.isPremium)
  const profileHref = organization?.provinceCode && organization.communitySlug
    ? `/com/${organization.provinceCode.toLowerCase()}/${organization.communitySlug.toLowerCase()}/orgs/${organization.slug}`
    : `/u/${post.author.handle}`
  const authorDisplayName = organization?.name
    ? formatDisplayName(organization.name)
    : post.author.name
      ? formatDisplayName(post.author.name)
      : post.author.handle
  const avatarInitials = authorDisplayName || organization?.name || post.author.handle
  const authorCoverUrl = organization?.coverUrl ?? post.author.coverUrl ?? null
  const hasHeaderCover = Boolean(authorCoverUrl)
  const isAuthor = viewerId === post.author.id

  useEffect(() => {
    setRecentComments(post.recentComments ?? [])
  }, [post.id, post.recentComments])

  useEffect(() => {
    setHideInlineCommentComposer(false)
  }, [post.id])

  const previewComments = useMemo(() => {
    const deduped = new Map<string, NonNullable<ApiPost['recentComments']>[number]>()
    for (const comment of recentComments) {
      if (!deduped.has(comment.id)) {
        deduped.set(comment.id, comment)
      }
    }

    const items = Array.from(deduped.values())
    if (commentPreviewSort === 'hot') {
      return items
        .sort((a, b) => {
          const scoreA = typeof a.score === 'number' ? a.score : 0
          const scoreB = typeof b.score === 'number' ? b.score : 0
          if (scoreB !== scoreA) return scoreB - scoreA
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        })
        .slice(0, FEED_COMMENT_PREVIEW_LIMIT)
    }

    return items
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, FEED_COMMENT_PREVIEW_LIMIT)
  }, [commentPreviewSort, recentComments])

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this post?')) return
    setIsDeleting(true)
    try {
      const token = getStoredToken()
      if (!token) return
      const res = await fetch(buildApiUrl(`/posts/${post.id}`), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        onDelete?.(post.id)
        pushToast('Post deleted', 'success')
      } else {
        pushToast('Failed to delete post', 'error')
      }
    } catch {
      pushToast('Failed to delete post', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleUpdate = async () => {
    if (pending) return
    setPending(true)
    try {
      const token = getStoredToken()
      if (!token) return
      const res = await fetch(buildApiUrl(`/posts/${post.id}`), {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: post.type === 'article' ? editTitle : undefined,
          body: editBody,
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        onUpdate?.(updated)
        setIsEditing(false)
        pushToast('Post updated', 'success')
      } else {
        pushToast('Failed to update post', 'error')
      }
    } catch {
      pushToast('Failed to update post', 'error')
    } finally {
      setPending(false)
    }
  }

  const handleRepost = () => {
    setRepostModalOpen(true)
  }

  const handleShare = () => {
    setShareModalOpen(true)
  }

  const handleReact = async (reaction: ReactionType | null) => {
    if (!onReact || pending) return
    setPending(true)
    try {
      await onReact(post.id, reaction)
    } finally {
      setPending(false)
    }
  }

  const submitComment = async ({ body, parentId }: { body: string; parentId?: string | null }) => {
    const trimmedBody = body.trim()
    if (!trimmedBody || inlineSubmitting) return false

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return false
    }

    setInlineSubmitting(true)
    try {
      const res = await fetch(buildApiUrl('/comments'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          postId: post.id,
          body: trimmedBody,
          parentId: parentId ?? undefined,
        }),
      })

      if (!res.ok) {
        pushToast('Unable to add comment right now.', 'error')
        return false
      }

      const payload = await res.json().catch(() => null)
      const newComment = payload?.comment ?? null
      const updatedPost = payload?.post ?? null
      let nextRecentComments = recentComments

      if (newComment) {
        nextRecentComments = [newComment, ...recentComments.filter((item) => item.id !== newComment.id)].slice(0, FEED_COMMENT_BUFFER_LIMIT)
        setRecentComments(nextRecentComments)
      }
      if (updatedPost) {
        const incomingRecentComments = (updatedPost as Partial<ApiPost>).recentComments
        const mergedPost: ApiPost = {
          ...post,
          ...(updatedPost as Partial<ApiPost>),
          author: {
            ...post.author,
            ...(((updatedPost as Partial<ApiPost>)?.author ?? {}) as Partial<ApiPost['author']>),
          },
          organization:
            (updatedPost as Partial<ApiPost>).organization === undefined
              ? post.organization
              : (updatedPost as Partial<ApiPost>).organization,
          recentComments: Array.isArray(incomingRecentComments) && incomingRecentComments.length > 0
            ? incomingRecentComments
            : nextRecentComments,
        }
        onUpdate?.(mergedPost)
      }
      setHideInlineCommentComposer(true)
      return true
    } catch {
      pushToast('Unable to add comment right now.', 'error')
      return false
    } finally {
      setInlineSubmitting(false)
    }
  }

  const handleInlineCommentSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const ok = await submitComment({ body: inlineComment, parentId: null })
    if (ok) {
      setInlineComment('')
    }
  }

  const formattedDate = createdAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented) return

    const target = event.target as HTMLElement | null
    if (!target) return

    if (target.closest('a,button,input,textarea,select,label,[role="button"],[data-prevent-card-nav="true"]')) {
      return
    }

    const selectedText = typeof window !== 'undefined' ? window.getSelection?.()?.toString() : ''
    if (selectedText) return

    router.push(postUrl)
  }

  return (
    <article
      className="surface-card min-w-0 space-y-4 px-6 py-5 shadow-subtle cursor-pointer"
      onClick={handleCardClick}
    >
      <header>
        <div className="relative">
          <div
            className={clsx(
              'relative flex flex-1 items-start gap-3 overflow-hidden rounded-xl px-3 py-2',
              hasHeaderCover ? 'border border-slate-300' : 'border border-slate-200',
            )}
          >
            {authorCoverUrl ? <img src={authorCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
            <div className={clsx('absolute inset-0', hasHeaderCover ? 'bg-slate-900/50' : 'bg-slate-50')} />
            <VerifiedAvatar
              src={organization ? (organization.logoUrl ?? null) : post.author.avatarUrl}
              alt={authorDisplayName ?? post.author.handle}
              initials={avatarInitials}
              size={48}
              isVerified={isVerifiedAuthor}
              isBusiness={isBusinessAuthor}
              className="shrink-0 relative z-[1]"
              href={profileHref}
            />
            <div className="min-w-0 relative z-[1]">
              <div className="space-y-0.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={profileHref}
                    className={clsx('font-semibold hover:underline', hasHeaderCover ? 'text-white' : 'text-slate-900')}
                    title={`View ${authorDisplayName ?? post.author.handle}`}
                  >
                    {authorDisplayName ?? post.author.handle}
                  </Link>
                  {organization ? (
                    <span className={clsx('text-xs font-semibold', hasHeaderCover ? 'text-white/80' : 'text-slate-500')}>Organization</span>
                  ) : null}
                </div>
                <div className={clsx('text-xs', hasHeaderCover ? 'text-white/80' : 'text-slate-500')}>
                  {formattedDate}
                </div>
              </div>
              <div className={clsx('mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold', hasHeaderCover ? 'text-white/85' : 'text-slate-500')}>
                {communityUrl ? (
                  <Link
                    href={communityUrl}
                    className={clsx(
                      'rounded-full px-2 py-0.5 uppercase tracking-wide',
                      hasHeaderCover
                        ? 'border border-white/35 text-white/85 hover:border-white/60'
                        : 'border border-slate-200 text-slate-500 hover:border-slate-300',
                    )}
                    aria-label="Open community feed"
                  >
                    {post.communityName ?? post.communitySlug}
                  </Link>
                ) : null}
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5',
                    hasHeaderCover
                      ? 'border border-white/35 text-white/85'
                      : 'border border-slate-200 text-slate-500',
                  )}
                >
                  {post.type === 'article' ? 'Article' : post.type === 'photo' ? 'Photo' : 'Post'}
                </span>
              </div>
            </div>
          </div>

          {isAuthor ? (
            <div className="absolute right-2 top-2 z-20" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={clsx(
                  'rounded-full p-1 transition',
                  hasHeaderCover
                    ? 'text-white/80 hover:bg-black/25 hover:text-white'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                )}
                disabled={isDeleting}
              >
                <HiEllipsisHorizontal className="h-5 w-5" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setIsEditing(true)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <HiPencil className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      void handleDelete()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <HiTrash className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="space-y-3 text-[15px] leading-6 text-slate-800">
        <PostImageGrid images={post.images} mediaUrl={post.mediaUrl} postUrl={postUrl} />

        {post.type === 'article' && post.title ? (
          <Link href={postUrl} className="text-lg font-semibold text-slate-900 hover:underline">
            {post.title}
          </Link>
        ) : null}
        {post.type === 'article' ? (
          articleBodyWithoutCivilLinks ? (
            <Link href={postUrl} className="block text-slate-700 hover:text-slate-900">
              <span dangerouslySetInnerHTML={{ __html: articleBodyWithoutCivilLinks }} />
            </Link>
          ) : null
        ) : post.type === 'photo' ? (
          bodyWithoutCivilLinks ? (
            <Link href={postUrl} className="block whitespace-pre-wrap text-slate-800 hover:text-slate-900">
              {bodyWithoutCivilLinks}
            </Link>
          ) : null
        ) : (
          bodyWithoutCivilLinks ? (
            <Link href={postUrl} className="block whitespace-pre-wrap text-slate-800 hover:text-slate-900">
              {bodyWithoutCivilLinks}
            </Link>
          ) : null
        )}

        <CivilLinkPreviewList body={post.body} />

        {post.sharedPost ? (
          <Link
            href={buildPostUrl(post.sharedPost)}
            className="mt-3 block w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100"
          >
            {(() => {
              const sharedCover = post.sharedPost.organization?.coverUrl ?? post.sharedPost.author.coverUrl ?? null
              const sharedHasCover = Boolean(sharedCover)
              return (
                <div className="relative mb-2 flex items-center gap-2 overflow-hidden rounded-lg border border-slate-200 px-2 py-1.5">
                  {sharedCover ? (
                    <img
                      src={sharedCover}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <div
                    className={clsx(
                      'absolute inset-0',
                      sharedHasCover ? 'bg-slate-900/50' : 'bg-slate-50',
                    )}
                  />
                  <VerifiedAvatar
                    src={post.sharedPost.organization ? (post.sharedPost.organization.logoUrl ?? null) : post.sharedPost.author.avatarUrl}
                    alt={
                      post.sharedPost.organization?.name
                        ? formatDisplayName(post.sharedPost.organization.name)
                        : post.sharedPost.author.name || post.sharedPost.author.handle
                    }
                    initials={
                      post.sharedPost.organization?.name
                        ? formatDisplayName(post.sharedPost.organization.name)
                        : post.sharedPost.author.name || post.sharedPost.author.handle
                    }
                    size={24}
                    isVerified={post.sharedPost.organization ? Boolean(post.sharedPost.organization.isVerified) : Boolean(post.sharedPost.author.isVerified)}
                    isBusiness={post.sharedPost.organization ? true : Boolean(post.sharedPost.author.isPremium)}
                    className="relative z-[1]"
                  />
                  <div className="relative z-[1] min-w-0">
                    <div className={clsx('text-sm font-semibold', sharedHasCover ? 'text-white' : 'text-slate-900')}>
                      {post.sharedPost.organization?.name
                        ? formatDisplayName(post.sharedPost.organization.name)
                        : formatDisplayName(post.sharedPost.author.name) || post.sharedPost.author.handle}
                    </div>
                    <div className={clsx('text-xs', sharedHasCover ? 'text-white/80' : 'text-slate-500')}>
                      {new Date(post.sharedPost.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              )
            })()}
            <div className="text-sm text-slate-800 [overflow-wrap:anywhere] break-words">
              {sharedPostBodyWithoutCivilLinks ? <div className="whitespace-pre-wrap">{sharedPostBodyWithoutCivilLinks}</div> : null}
              {post.sharedPost.images && post.sharedPost.images.length > 0 ? (
                <div className="mt-2">
                  <PostImageGrid images={post.sharedPost.images} mediaUrl={post.sharedPost.mediaUrl} postUrl={buildPostUrl(post.sharedPost)} />
                </div>
              ) : null}
            </div>
          </Link>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
        <PostReactionBar
          reactions={post.reactions}
          viewerReaction={viewerReaction}
          disabled={pending}
          onReact={(reaction) => handleReact(reaction)}
        />
        <Link
          href={postUrl}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          aria-label="Open comments"
        >
          <LuMessageCircle className="h-4 w-4" />
          <span>{commentCount}</span>
        </Link>
        <button
          onClick={handleRepost}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          <LuRepeat2 className="h-4 w-4" />
          <span>Repost</span>
        </button>
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          <LuShare className="h-4 w-4" />
          <span>Share</span>
        </button>
        <div className="ml-auto inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setCommentPreviewSort('new')}
            className={clsx(commentPreviewSort === 'new' ? 'text-[var(--cc-primary)]' : 'text-slate-500 hover:text-slate-700')}
          >
            New
          </button>
          <span className="px-1 text-slate-300">|</span>
          <button
            type="button"
            onClick={() => setCommentPreviewSort('hot')}
            className={clsx(commentPreviewSort === 'hot' ? 'text-[var(--cc-primary)]' : 'text-slate-500 hover:text-slate-700')}
          >
            Hot
          </button>
        </div>
      </footer>

      <section className="space-y-3 border-t border-slate-100 pt-3" data-prevent-card-nav="true">
        {previewComments.map((comment) => {
          const commentAuthorName = comment.author.name ? formatDisplayName(comment.author.name) : comment.author.handle
          const commentCoverUrl = comment.author.coverUrl ?? null
          const hasCommentCover = Boolean(commentCoverUrl)
          const isReplyTarget = activeReplyParentId === comment.id
          const isNestedReply = Boolean(comment.parentId)
          return (
            <div
              key={comment.id}
              className={clsx(
                'rounded-xl border bg-white/70 px-2.5 py-2',
                isReplyTarget ? 'border-[var(--cc-primary)]/40' : 'border-slate-100',
                isNestedReply && 'border-l-2 border-l-[var(--cc-primary)]/40',
              )}
            >
              <div className="min-w-0">
                <div className={clsx('relative inline-flex max-w-full items-center gap-2 overflow-hidden rounded-lg border px-2 py-1', hasCommentCover ? 'border-slate-300' : 'border-slate-200')}>
                  {commentCoverUrl ? <img src={commentCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                  <div className={clsx('absolute inset-0', hasCommentCover ? 'bg-slate-900/50' : 'bg-slate-50')} />
                  <VerifiedAvatar
                    src={comment.author.avatarUrl ?? null}
                    alt={commentAuthorName}
                    initials={commentAuthorName}
                    size={24}
                    isVerified={Boolean(comment.author.isVerified)}
                    isBusiness={Boolean(comment.author.isPremium)}
                    className="shrink-0 relative z-[1]"
                    href={`/u/${comment.author.handle}`}
                  />
                  <Link
                    href={`/u/${comment.author.handle}`}
                    className={clsx('relative z-[1] shrink-0 text-sm font-semibold hover:underline', hasCommentCover ? 'text-white' : 'text-slate-900')}
                  >
                    {commentAuthorName}
                  </Link>
                  <span className={clsx('relative z-[1] text-[11px]', hasCommentCover ? 'text-white/80' : 'text-slate-500')}>• {formatRelativeTime(comment.createdAt)}</span>
                </div>
                {isNestedReply ? <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-primary)]/80">Reply in thread</p> : null}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-800">{comment.body}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!viewerId) {
                        redirectToAuthModal('login')
                        return
                      }
                      setActiveReplyParentId((prev) => (prev === comment.id ? null : comment.id))
                      setReplyDraft('')
                    }}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10"
                  >
                    {isReplyTarget ? 'Cancel' : 'Reply'}
                  </button>
                </div>

                {isReplyTarget ? (
                  <form
                    className="mt-2 flex items-center gap-2 pl-3 border-l border-slate-200"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const ok = await submitComment({ body: replyDraft, parentId: comment.id })
                      if (ok) {
                        setReplyDraft('')
                      }
                    }}
                  >
                    <input
                      type="text"
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      placeholder={`Reply to @${comment.author.handle}…`}
                      autoFocus
                      className="h-8 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cc-primary)]"
                      maxLength={5000}
                      disabled={inlineSubmitting || !viewerId}
                    />
                    <button
                      type="submit"
                      className={clsx(
                        'h-8 rounded-full bg-[var(--cc-primary)] px-3 text-xs font-semibold text-white transition',
                        !replyDraft.trim() || inlineSubmitting || !viewerId
                          ? 'cursor-not-allowed opacity-60'
                          : 'hover:bg-[var(--cc-primary-700)]',
                      )}
                      disabled={!replyDraft.trim() || inlineSubmitting || !viewerId}
                    >
                      {inlineSubmitting ? '...' : 'Reply'}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          )
        })}

        {!hideInlineCommentComposer ? (
          <form className="flex items-center gap-2" onSubmit={handleInlineCommentSubmit}>
            <input
              type="text"
              value={inlineComment}
              onChange={(event) => setInlineComment(event.target.value)}
              onFocus={() => {
                if (!viewerId) {
                  redirectToAuthModal('login')
                }
              }}
              placeholder={viewerId ? 'Write a comment…' : 'Sign in to comment…'}
              className="h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cc-primary)]"
              maxLength={5000}
              disabled={inlineSubmitting || !viewerId}
            />
            <button
              type="submit"
              className={clsx(
                'h-9 rounded-full bg-[var(--cc-primary)] px-3 text-xs font-semibold text-white transition',
                !inlineComment.trim() || inlineSubmitting || !viewerId
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-[var(--cc-primary-700)]',
              )}
              disabled={!inlineComment.trim() || inlineSubmitting || !viewerId}
            >
              {inlineSubmitting ? '...' : 'Post'}
            </button>
          </form>
        ) : null}
      </section>

      {repostModalOpen ? (
        <SharePostModal
          target={shareTarget}
          onClose={() => setRepostModalOpen(false)}
          communityOptions={communityOptions}
        />
      ) : null}

      {shareModalOpen ? (
        <ShareSendModal
          target={shareTarget}
          onClose={() => setShareModalOpen(false)}
        />
      ) : null}

      {isEditing ? (
        <Modal open onClose={() => setIsEditing(false)} title="Edit post" maxWidthClassName="max-w-2xl">
          <div className="space-y-4 p-6">
            <div className="grid gap-4">
              {post.type === 'article' ? (
                <div className="grid gap-2">
                  <label htmlFor="title" className="text-sm font-medium text-slate-700">
                    Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                    placeholder="Enter post title"
                  />
                </div>
              ) : null}
              <div className="grid gap-2">
                <label htmlFor="body" className="text-sm font-medium text-slate-700">
                  Body
                </label>
                <textarea
                  id="body"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  rows={6}
                  placeholder="Enter post content"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={pending}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {pending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </article>
  )
}
