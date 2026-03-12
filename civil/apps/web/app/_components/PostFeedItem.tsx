"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { LuMessageCircle, LuRepeat2, LuShare } from 'react-icons/lu'
import { HiPencil, HiTrash } from 'react-icons/hi2'
import type { ReactionType } from '@civil/shared'
import type { ApiPost, CommunityTarget } from './PostComposer'
import CivilCard from './CivilCard'
import CivilPostMedia from './CivilPostMedia'
import PostAuthorMiniCard from './PostAuthorMiniCard'
import ContentModerationMenu from './ContentModerationMenu'
import { formatDisplayName } from '../_lib/text'
import { buildApiUrl } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'
import Modal from './Modal'
import RichTextEditor from './RichTextEditor'
import SharePostModal from './SharePostModal'
import ShareSendModal from './ShareSendModal'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildPostShareTarget } from '../_lib/shareTarget'
import CivilLinkPreviewList from './CivilLinkPreviewList'
import { stripCivilUrlsFromHtml, stripCivilUrlsFromText } from '../_lib/civilLinks'
import PostReactionBar from './PostReactionBar'
import PollCard from './PollCard'

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

export default function PostFeedItem({ post, onReact, onDelete, onUpdate, viewerId, communityOptions }: PostFeedItemProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
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
  const showOrganizationAuthorBox = Boolean(organization && post.showBusinessAuthor)
  const isAuthor = viewerId === post.author.id
  const postTypeLabel =
    post.type === 'article' ? 'Article' : post.type === 'photo' ? 'Photo' : post.type === 'poll' ? 'Poll' : 'Post'
  const reportTargetLabel = post.title?.trim() || bodyWithoutCivilLinks.slice(0, 120) || authorDisplayName || post.author.handle
  const blockTarget = organization
    ? {
        type: 'organization' as const,
        id: organization.id,
        label: organization.name,
      }
    : {
        type: 'user' as const,
        id: post.author.id,
        label: authorDisplayName || post.author.handle,
      }
  const authorActions = isAuthor
    ? [
        {
          key: 'edit',
          label: 'Edit',
          icon: HiPencil,
          disabled: isDeleting,
          onSelect: () => setIsEditing(true),
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: HiTrash,
          tone: 'danger' as const,
          disabled: isDeleting,
          onSelect: () => {
            void handleDelete()
          },
        },
      ]
    : []

  useEffect(() => {
    setRecentComments(post.recentComments ?? [])
  }, [post.id, post.recentComments])

  useEffect(() => {
    setEditTitle(post.title ?? '')
    setEditBody(post.body)
  }, [post.id, post.title, post.body, isEditing])

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

    return Array.from(deduped.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, FEED_COMMENT_PREVIEW_LIMIT)
  }, [recentComments])

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
      <header className="relative z-[2]">
        <CivilCard
          size="banner"
          name={authorDisplayName ?? post.author.handle}
          titleSuffix={organization ? 'Organization' : undefined}
          subtitle={formattedDate}
          details={
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/85">
              {communityUrl ? (
                <Link
                  href={communityUrl}
                  className="rounded-full border border-white/35 px-2 py-0.5 uppercase tracking-wide text-white/85 hover:border-white/60"
                  aria-label="Open community feed"
                >
                  {post.communityName ?? post.communitySlug}
                </Link>
              ) : null}
              <span className="rounded-full border border-white/35 px-2 py-0.5 text-white/85">
                {postTypeLabel}
              </span>
            </div>
          }
          avatarAlt={authorDisplayName ?? post.author.handle}
          avatarInitials={avatarInitials}
          avatarSrc={organization ? (organization.logoUrl ?? null) : post.author.avatarUrl}
          avatarHref={profileHref}
          titleHref={profileHref}
          coverUrl={authorCoverUrl}
          isVerified={isVerifiedAuthor}
          isBusiness={isBusinessAuthor}
          contentClassName="pr-14"
          trailing={
            showOrganizationAuthorBox ? <PostAuthorMiniCard author={post.author} className="hidden w-[210px] md:block" /> : null
          }
        />
        {showOrganizationAuthorBox ? (
          <div className="mt-3 flex justify-end md:hidden">
            <PostAuthorMiniCard author={post.author} className="w-full max-w-[220px]" />
          </div>
        ) : null}
        <div className="absolute right-3 top-3 z-30">
          <ContentModerationMenu
            actions={authorActions}
            reportTarget={
              isAuthor
                ? null
                : {
                    targetType: 'POST',
                    targetId: post.id,
                    targetLabel: reportTargetLabel,
                  }
            }
            blockTarget={isAuthor ? null : blockTarget}
            buttonLabel={isAuthor ? 'Post actions' : 'Post settings'}
            onReported={() => {
              onDelete?.(post.id)
              router.refresh()
            }}
            onBlocked={() => {
              onDelete?.(post.id)
              router.refresh()
            }}
          />
        </div>
      </header>

      <div className="space-y-3 text-[15px] leading-6 text-slate-800">
        <CivilPostMedia images={post.images} mediaUrl={post.mediaUrl} postUrl={postUrl} />

        {post.type === 'article' && post.title ? (
          <Link href={postUrl} className="text-lg font-semibold text-slate-900 hover:underline">
            {post.title}
          </Link>
        ) : null}
        {post.type === 'article' ? (
          articleBodyWithoutCivilLinks ? (
            <Link href={postUrl} className="cc-article-rich-content block text-slate-700 hover:text-slate-900">
              <div dangerouslySetInnerHTML={{ __html: articleBodyWithoutCivilLinks }} />
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

        {post.type === 'poll' && post.poll ? (
          <PollCard
            post={post}
            viewerId={viewerId}
            onPostUpdate={onUpdate}
          />
        ) : null}

        {post.sharedPost ? (
          <Link
            href={buildPostUrl(post.sharedPost)}
            className="mt-3 block w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100"
          >
            {(() => {
              const sharedCover = post.sharedPost.organization?.coverUrl ?? post.sharedPost.author.coverUrl ?? null
              const sharedDisplayName = post.sharedPost.organization?.name
                ? formatDisplayName(post.sharedPost.organization.name)
                : formatDisplayName(post.sharedPost.author.name) || post.sharedPost.author.handle

              return (
                <CivilCard
                  size="rail"
                  name={sharedDisplayName}
                  subtitle={new Date(post.sharedPost.createdAt).toLocaleDateString()}
                  avatarAlt={sharedDisplayName}
                  avatarInitials={sharedDisplayName}
                  avatarSrc={post.sharedPost.organization ? (post.sharedPost.organization.logoUrl ?? null) : post.sharedPost.author.avatarUrl}
                  coverUrl={sharedCover}
                  isVerified={post.sharedPost.organization ? Boolean(post.sharedPost.organization.isVerified) : Boolean(post.sharedPost.author.isVerified)}
                  isBusiness={post.sharedPost.organization ? true : Boolean(post.sharedPost.author.isPremium)}
                  className="mb-2 w-fit max-w-full"
                />
              )
            })()}
            <div className="text-sm text-slate-800 [overflow-wrap:anywhere] break-words">
              {sharedPostBodyWithoutCivilLinks ? <div className="whitespace-pre-wrap">{sharedPostBodyWithoutCivilLinks}</div> : null}
              {post.sharedPost.images && post.sharedPost.images.length > 0 ? (
                <div className="mt-2">
                  <CivilPostMedia images={post.sharedPost.images} mediaUrl={post.sharedPost.mediaUrl} postUrl={buildPostUrl(post.sharedPost)} />
                </div>
              ) : null}
            </div>
          </Link>
        ) : null}
      </div>

      <footer className="space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
        <div className="flex w-full justify-center sm:justify-start">
          <PostReactionBar
            className="w-full justify-center sm:w-auto sm:justify-start"
            reactions={post.reactions}
            viewerReaction={viewerReaction}
            disabled={pending}
            onReact={(reaction) => handleReact(reaction)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
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
        </div>
      </footer>

      <section className="space-y-3 border-t border-slate-100 pt-3" data-prevent-card-nav="true">
        {previewComments.map((comment) => {
          const commentAuthorName = comment.author.name ? formatDisplayName(comment.author.name) : comment.author.handle
          const commentCoverUrl = comment.author.coverUrl ?? null
          const isReplyTarget = activeReplyParentId === comment.id
          const isNestedReply = Boolean(comment.parentId)
          const createdLabel = formatRelativeTime(comment.createdAt)
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
                <CivilCard
                  href={`/u/${comment.author.handle}`}
                  size="sm"
                  name={commentAuthorName}
                  avatarAlt={commentAuthorName}
                  avatarInitials={commentAuthorName}
                  avatarSrc={comment.author.avatarUrl ?? null}
                  coverUrl={commentCoverUrl}
                  isVerified={Boolean(comment.author.isVerified)}
                  isBusiness={Boolean(comment.author.isPremium)}
                  titleSuffix={createdLabel ? `• ${createdLabel}` : undefined}
                  className="w-fit max-w-full border-slate-200"
                />
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
        <Modal open onClose={() => setIsEditing(false)} title="Edit post" maxWidthClassName="max-w-2xl" closeOnBackdrop={false} closeOnEscape={false}>
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
                  {post.type === 'article' ? 'Story' : 'Body'}
                </label>
                {post.type === 'article' ? (
                  <>
                    <RichTextEditor
                      value={editBody}
                      onChange={setEditBody}
                      placeholder="Share something"
                      minHeight={260}
                      disabled={pending}
                    />
                    <div className="flex justify-end text-xs text-slate-500">
                      <span>{editBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length}/10000</span>
                    </div>
                  </>
                ) : (
                  <textarea
                    id="body"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                    rows={6}
                    placeholder="Enter post content"
                  />
                )}
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
