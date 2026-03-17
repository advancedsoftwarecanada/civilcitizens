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
import CivilPostActions from './CivilPostActions'
import CivilPost from './CivilPost'
import CivilPostComments from './CivilPostComments'
import CivilPostMedia from './CivilPostMedia'
import CivilPostSharedReference from './CivilPostSharedReference'
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
import LinkPreviewCard from './LinkPreviewCard'
import LinkifiedText from './LinkifiedText'
import { linkifyUrlsInHtml, stripCivilUrlsFromHtml, stripCivilUrlsFromText } from '../_lib/civilLinks'
import PostReactionBar from './PostReactionBar'
import PollCard from './PollCard'

const FEED_COMMENT_PREVIEW_LIMIT = 3
const FEED_COMMENT_BUFFER_LIMIT = 20
const FEED_BODY_TRUNCATION_THRESHOLD = 520
const FEED_BODY_MAX_HEIGHT_CLASSNAME = 'max-h-[14rem] overflow-hidden'

type FeedComment = NonNullable<ApiPost['recentComments']>[number]

type FeedViewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
}

function mergeRecentCommentList(current: FeedComment[], comment: FeedComment, removeIds: string[] = []) {
  return [comment, ...current.filter((item) => item.id !== comment.id && !removeIds.includes(item.id))].slice(0, FEED_COMMENT_BUFFER_LIMIT)
}

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

type PostFeedItemProps = {
  post: ApiPost
  onReact?: (postId: string, reaction: ReactionType | null) => Promise<void>
  onDelete?: (postId: string) => void
  onUpdate?: (post: ApiPost) => void
  viewerId?: string | null
  viewer?: FeedViewer | null
  communityOptions?: CommunityTarget[]
}

export default function PostFeedItem({ post, onReact, onDelete, onUpdate, viewerId, viewer, communityOptions }: PostFeedItemProps) {
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
  const [clientRecentComments, setClientRecentComments] = useState<FeedComment[]>([])
  const [hideInlineCommentComposer, setHideInlineCommentComposer] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(post.counts?.commentCount ?? 0)
  const commentCount = localCommentCount
  const effectiveViewer = viewer ?? null
  const serverRecentComments = useMemo(() => (post.recentComments ?? []) as FeedComment[], [post.recentComments])
  const recentComments = useMemo(() => {
    const merged = new Map<string, FeedComment>()
    for (const comment of clientRecentComments) {
      merged.set(comment.id, comment)
    }
    for (const comment of serverRecentComments) {
      if (!merged.has(comment.id)) {
        merged.set(comment.id, comment)
      }
    }
    return Array.from(merged.values())
  }, [clientRecentComments, serverRecentComments])
  const viewerReaction = post.viewer?.reaction ?? null
  const postUrl = buildPostUrl(post)
  const shareTarget = useMemo(() => buildPostShareTarget(post), [post])
  const bodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromText(post.body), [post.body])
  const articleBodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromHtml(post.body), [post.body])
  const linkedArticleBody = useMemo(() => linkifyUrlsInHtml(articleBodyWithoutCivilLinks), [articleBodyWithoutCivilLinks])
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
  const writtenByBlockTarget = {
    type: 'user' as const,
    id: post.author.id,
    label: formatDisplayName(post.author.name) || post.author.handle,
  }
  const moderationBlockTarget = showOrganizationAuthorBox ? writtenByBlockTarget : blockTarget
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
  const sharedPostHref = post.sharedPost ? buildPostUrl(post.sharedPost) : null
  const shouldClampFeedBody = bodyWithoutCivilLinks.trim().length > FEED_BODY_TRUNCATION_THRESHOLD

  useEffect(() => {
    setClientRecentComments([])
  }, [post.id])

  useEffect(() => {
    setLocalCommentCount(post.counts?.commentCount ?? 0)
  }, [post.id, post.counts?.commentCount])

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
    const optimisticCommentId = viewerId ? `optimistic-${post.id}-${Date.now()}` : null

    if (parentId) {
      setReplyDraft('')
      setActiveReplyParentId(null)
    } else {
      setInlineComment('')
      setHideInlineCommentComposer(true)
    }

    if (optimisticCommentId) {
      const optimisticComment: FeedComment = {
        id: optimisticCommentId,
        postId: post.id,
        parentId: parentId ?? null,
        body: trimmedBody,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        score: 0,
        optimistic: true,
        localPreview: true,
        author: {
          id: viewerId ?? '',
          handle: effectiveViewer?.handle ?? 'you',
          name: effectiveViewer?.name ?? 'You',
          avatarUrl: effectiveViewer?.avatarUrl ?? null,
          isPremium: Boolean(effectiveViewer?.isPremium),
          isVerified: Boolean(effectiveViewer?.isVerified),
        },
      }
      setClientRecentComments((current) => mergeRecentCommentList(current, optimisticComment))
      setLocalCommentCount((current) => current + 1)
    }

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
        const localPreviewComment: FeedComment = {
          ...newComment,
          localPreview: true,
        }
        setClientRecentComments((current) => {
          nextRecentComments = mergeRecentCommentList(current, localPreviewComment, optimisticCommentId ? [optimisticCommentId] : [])
          return nextRecentComments
        })
      }
      if (updatedPost) {
        const incomingRecentComments = (updatedPost as Partial<ApiPost>).recentComments
        const incomingCommentCount = (updatedPost as Partial<ApiPost>).counts?.commentCount
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
        if (typeof incomingCommentCount === 'number') {
          setLocalCommentCount(incomingCommentCount)
        }
        onUpdate?.(mergedPost)
      }
      return true
    } catch {
      if (optimisticCommentId) {
        setClientRecentComments((current) => current.filter((item) => item.id !== optimisticCommentId))
        setLocalCommentCount((current) => Math.max(0, current - 1))
      }
      if (parentId) {
        setReplyDraft(trimmedBody)
        setActiveReplyParentId(parentId)
      } else {
        setInlineComment(trimmedBody)
        setHideInlineCommentComposer(false)
      }
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
    <>
      <CivilPost
        className="cursor-pointer"
        onClick={handleCardClick}
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
            <span className="rounded-full border border-white/35 px-2 py-0.5 text-white/85">{postTypeLabel}</span>
          </div>
        }
        avatarAlt={authorDisplayName ?? post.author.handle}
        avatarInitials={avatarInitials}
        avatarSrc={organization ? (organization.logoUrl ?? null) : post.author.avatarUrl}
        profileHref={profileHref}
        coverUrl={authorCoverUrl}
        isVerified={isVerifiedAuthor}
        isBusiness={isBusinessAuthor}
        cardContentClassName="pr-14"
        trailing={null}
        afterHeader={
          showOrganizationAuthorBox ? (
            <div className="flex justify-center">
              <PostAuthorMiniCard author={post.author} className="w-full max-w-[320px]" />
            </div>
          ) : null
        }
        headerOverlay={
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
              blockTarget={isAuthor ? null : moderationBlockTarget}
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
        }
        content={
          <>
            <CivilPostMedia images={post.images} mediaUrl={post.mediaUrl} postUrl={postUrl} />

            {post.type === 'article' && post.title ? (
              <Link href={postUrl} className="text-lg font-semibold text-slate-900 hover:underline">
                {post.title}
              </Link>
            ) : null}
            {post.type === 'article' ? (
              articleBodyWithoutCivilLinks ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Link href={postUrl} className="cc-article-rich-content block text-slate-700 hover:text-slate-900">
                      <div
                        className={clsx(shouldClampFeedBody && FEED_BODY_MAX_HEIGHT_CLASSNAME)}
                        dangerouslySetInnerHTML={{ __html: linkedArticleBody }}
                      />
                    </Link>
                    {shouldClampFeedBody ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/95 to-transparent" /> : null}
                  </div>
                  {shouldClampFeedBody ? (
                    <Link href={postUrl} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
                      Continue reading in thread
                    </Link>
                  ) : null}
                </div>
              ) : null
            ) : post.type === 'photo' ? (
              bodyWithoutCivilLinks ? (
                <div className="space-y-3">
                  <div className="relative">
                    <div className={clsx(shouldClampFeedBody && FEED_BODY_MAX_HEIGHT_CLASSNAME)}>
                      <LinkifiedText text={bodyWithoutCivilLinks} className="whitespace-pre-wrap text-slate-800" />
                    </div>
                    {shouldClampFeedBody ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/95 to-transparent" /> : null}
                  </div>
                  {shouldClampFeedBody ? (
                    <Link href={postUrl} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
                      Continue reading in thread
                    </Link>
                  ) : null}
                </div>
              ) : null
            ) : (
              bodyWithoutCivilLinks ? (
                <div className="space-y-3">
                  <div className="relative">
                    <div className={clsx(shouldClampFeedBody && FEED_BODY_MAX_HEIGHT_CLASSNAME)}>
                      <LinkifiedText text={bodyWithoutCivilLinks} className="whitespace-pre-wrap text-slate-800" />
                    </div>
                    {shouldClampFeedBody ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/95 to-transparent" /> : null}
                  </div>
                  {shouldClampFeedBody ? (
                    <Link href={postUrl} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)]">
                      Continue reading in thread
                    </Link>
                  ) : null}
                </div>
              ) : null
            )}

            {post.linkPreview ? <LinkPreviewCard preview={post.linkPreview} /> : <CivilLinkPreviewList body={post.body} />}

            {post.type === 'poll' && post.poll ? (
              <PollCard post={post} viewerId={viewerId} onPostUpdate={onUpdate} />
            ) : null}

            {post.sharedPost ? (
              <CivilPostSharedReference
                href={sharedPostHref ?? postUrl}
                name={
                  post.sharedPost.organization?.name
                    ? formatDisplayName(post.sharedPost.organization.name)
                    : formatDisplayName(post.sharedPost.author.name) || post.sharedPost.author.handle
                }
                subtitle={new Date(post.sharedPost.createdAt).toLocaleDateString()}
                avatarAlt={
                  post.sharedPost.organization?.name
                    ? formatDisplayName(post.sharedPost.organization.name)
                    : formatDisplayName(post.sharedPost.author.name) || post.sharedPost.author.handle
                }
                avatarInitials={
                  post.sharedPost.organization?.name
                    ? formatDisplayName(post.sharedPost.organization.name)
                    : formatDisplayName(post.sharedPost.author.name) || post.sharedPost.author.handle
                }
                avatarSrc={post.sharedPost.organization ? (post.sharedPost.organization.logoUrl ?? null) : post.sharedPost.author.avatarUrl}
                coverUrl={post.sharedPost.organization?.coverUrl ?? post.sharedPost.author.coverUrl ?? null}
                isVerified={post.sharedPost.organization ? Boolean(post.sharedPost.organization.isVerified) : Boolean(post.sharedPost.author.isVerified)}
                isBusiness={post.sharedPost.organization ? true : Boolean(post.sharedPost.author.isPremium)}
                body={sharedPostBodyWithoutCivilLinks}
                images={post.sharedPost.images}
                mediaUrl={post.sharedPost.mediaUrl}
              />
            ) : null}
          </>
        }
      >
        <CivilPostActions
          leading={
            <PostReactionBar
              className="w-full justify-center sm:w-auto sm:justify-start"
              reactions={post.reactions}
              viewerReaction={viewerReaction}
              disabled={pending}
              onReact={(reaction) => handleReact(reaction)}
            />
          }
          actions={[
            {
              key: 'comments',
              label: String(commentCount),
              icon: LuMessageCircle,
              href: postUrl,
              ariaLabel: 'Open comments',
            },
            {
              key: 'repost',
              label: 'Repost',
              icon: LuRepeat2,
              onClick: handleRepost,
            },
            {
              key: 'share',
              label: 'Share',
              icon: LuShare,
              onClick: handleShare,
            },
          ]}
        />

        <CivilPostComments
          comments={previewComments}
          postHref={postUrl}
          viewerId={viewerId}
          activeReplyParentId={activeReplyParentId}
          replyDraft={replyDraft}
          inlineComment={inlineComment}
          inlineSubmitting={inlineSubmitting}
          hideInlineCommentComposer={hideInlineCommentComposer}
          onRequireAuth={() => redirectToAuthModal('login')}
          onToggleReply={(commentId) => {
            setActiveReplyParentId((prev) => (prev === commentId ? null : commentId))
            setReplyDraft('')
          }}
          onReplyDraftChange={setReplyDraft}
          onReplySubmit={async (commentId) => {
            const ok = await submitComment({ body: replyDraft, parentId: commentId })
            if (ok) {
              setReplyDraft('')
              setActiveReplyParentId(null)
            }
            return ok
          }}
          onInlineCommentChange={setInlineComment}
          onInlineCommentSubmit={handleInlineCommentSubmit}
        />
      </CivilPost>

      {repostModalOpen ? (
        <SharePostModal target={shareTarget} onClose={() => setRepostModalOpen(false)} communityOptions={communityOptions} />
      ) : null}

      {shareModalOpen ? (
        <ShareSendModal target={shareTarget} onClose={() => setShareModalOpen(false)} />
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
                    <RichTextEditor value={editBody} onChange={setEditBody} placeholder="Share something" minHeight={260} disabled={pending} />
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
    </>
  )
}
