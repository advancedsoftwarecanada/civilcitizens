"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import Image from 'next/image'
import { LuFlame, LuFrown, LuHeart, LuLaugh, LuSparkles, LuShare } from 'react-icons/lu'
import { HiEllipsisHorizontal, HiPencil, HiTrash } from 'react-icons/hi2'
import type { IconBaseProps, IconType } from 'react-icons'
import type { ReactionType } from '@civil/shared'
import type { ApiPost, CommunityTarget } from './PostComposer'
import { JURISDICTION_LABELS } from './PostComposer'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'
import { buildApiUrl } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'
import Modal from './Modal'
import PostComposer from './PostComposer'
import SharePostModal from './SharePostModal'

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
  onReact: (postId: string, reaction: ReactionType | null) => Promise<void>
  onDelete?: (postId: string) => void
  onUpdate?: (post: ApiPost) => void
  viewerIsVerified?: boolean
  viewerId?: string | null
  communityOptions?: CommunityTarget[]
}

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
  onBlockedClick?: () => void
}

function ReactionButton({ option, count, active, blocked, disabled, onClick, onBlockedClick }: ReactionButtonProps) {
  const handleClick = () => {
    if (disabled) return
    if (blocked) {
      onBlockedClick?.()
      return
    }
    onClick()
  }

  const Icon = active && option.activeIcon ? option.activeIcon : option.icon

  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2',
        active
          ? option.accentClass
          : blocked
              ? 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-200'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 focus:ring-[var(--cc-primary)]',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={handleClick}
      aria-label={`${option.label} reaction`}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? <span>{count}</span> : <span className="text-[11px] font-normal text-slate-500">{option.label}</span>}
    </button>
  )
}

function PostImageGrid({ images, mediaUrl, postUrl }: { images?: string[] | null; mediaUrl?: string | null; postUrl: string }) {
  const allImages = images && images.length > 0 ? images : mediaUrl ? [mediaUrl] : []
  if (allImages.length === 0) return null

  if (allImages.length === 1) {
    return (
      <Link href={postUrl} className="block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
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

export default function PostFeedItem({ post, onReact, onDelete, onUpdate, viewerIsVerified, viewerId, communityOptions }: PostFeedItemProps) {
  const [pending, setPending] = useState(false)
  const [showVoteTooltip, setShowVoteTooltip] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [editBody, setEditBody] = useState(post.body)
  const [editTitle, setEditTitle] = useState(post.title ?? '')
  const [isDeleting, setIsDeleting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reactionCounts = post.reactions ?? {
    maple: 0,
    heart: 0,
    haha: 0,
    wow: 0,
    sad: 0,
    fire: 0,
    total: 0,
    positive: 0,
  }
  const totalReactions = reactionCounts.total ?? 0
  const commentCount = post.counts?.commentCount ?? 0
  const currentReaction = (post.viewer?.reaction ?? null) as ReactionType | null
  const postUrl = buildPostUrl(post)
  const communityUrl = buildCommunityUrl(post)
  const createdAt = new Date(post.createdAt)
  const organization = post.organization ?? null
  const isVerifiedAuthor = organization ? Boolean(organization.isVerified) : Boolean(post.author.isVerified)
  const isBusinessAuthor = organization ? true : Boolean(post.author.isPremium)
  const canReact = Boolean(viewerIsVerified)
  const profileHref = organization?.provinceCode && organization.communitySlug
    ? `/com/${organization.provinceCode.toLowerCase()}/${organization.communitySlug.toLowerCase()}/orgs/${organization.slug}`
    : `/u/${post.author.handle}`
  const authorDisplayName = organization?.name
    ? formatDisplayName(organization.name)
    : post.author.name
      ? formatDisplayName(post.author.name)
      : post.author.handle
  const avatarInitials = authorDisplayName || organization?.name || post.author.handle
  const isAuthor = viewerId === post.author.id

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
    } catch (err) {
      pushToast('Failed to delete post', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleUpdate = async () => {
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
    } catch (err) {
      pushToast('Failed to update post', 'error')
    }
  }

  const handleShare = () => {
    if (!canReact) {
      triggerVoteTooltip()
      return
    }
    setShareModalOpen(true)
  }

  const handleReact = useCallback(
    async (nextReaction: ReactionType | null) => {
      if (pending) return
      if (!canReact) return
      setPending(true)
      try {
        await onReact(post.id, nextReaction)
      } finally {
        setPending(false)
      }
    },
    [canReact, onReact, pending, post.id],
  )

  const triggerVoteTooltip = useCallback(() => {
    setShowVoteTooltip(true)
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
    }
    tooltipTimeoutRef.current = setTimeout(() => setShowVoteTooltip(false), 2500)
  }, [])

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
      }
    }
  }, [])

  const formattedDate = createdAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <article className="surface-card space-y-4 px-6 py-5 shadow-subtle">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <VerifiedAvatar
            src={organization ? (organization.logoUrl ?? null) : post.author.avatarUrl}
            alt={authorDisplayName ?? post.author.handle}
            initials={avatarInitials}
            size={48}
            isVerified={isVerifiedAuthor}
            isBusiness={isBusinessAuthor}
            className="shrink-0"
            href={profileHref}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <Link href={profileHref} className="font-semibold text-slate-900 hover:underline" title={`View ${authorDisplayName ?? post.author.handle}`}>
                {authorDisplayName ?? post.author.handle}
              </Link>
              {organization ? <span className="text-xs font-semibold text-slate-400">Organization</span> : null}
              <span className="text-xs">• {formattedDate}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              {communityUrl ? (
                <Link
                  href={communityUrl}
                  className="rounded-full border border-slate-200 px-2 py-0.5 uppercase tracking-wide text-slate-500 hover:border-slate-300"
                  aria-label="Open community feed"
                >
                  {post.communityName ?? post.communitySlug}
                </Link>
              ) : null}
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">
                {post.type === 'article' ? 'Article' : post.type === 'photo' ? 'Photo' : 'Post'}
              </span>
            </div>
          </div>
        </div>
        {isAuthor ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <HiEllipsisHorizontal className="h-5 w-5" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-10 mt-1 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
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
                    handleDelete()
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
      </header>

      <div className="space-y-3 text-[15px] leading-6 text-slate-800">

        <PostImageGrid images={post.images} mediaUrl={post.mediaUrl} postUrl={postUrl} />

        {post.type === 'article' && post.title ? (
          <Link href={postUrl} className="text-lg font-semibold text-slate-900 hover:underline">
            {post.title}
          </Link>
        ) : null}
        {post.type === 'article' ? (
          <Link href={postUrl} className="block text-slate-700 hover:text-slate-900">
            <span dangerouslySetInnerHTML={{ __html: post.body }} />
          </Link>
        ) : post.type === 'photo' ? (
          post.body ? (
            <Link href={postUrl} className="block whitespace-pre-wrap text-slate-800 hover:text-slate-900">
              {post.body}
            </Link>
          ) : null
        ) : (
          <Link href={postUrl} className="block whitespace-pre-wrap text-slate-800 hover:text-slate-900">
            {post.body}
          </Link>
        )}

        {post.sharedPost ? (
          <Link href={buildPostUrl(post.sharedPost)} className="block mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100 transition-colors">
            <div className="flex items-center gap-2 mb-2">
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
              />
              <span className="text-sm font-semibold text-slate-900 hover:underline">
                {post.sharedPost.organization?.name
                  ? formatDisplayName(post.sharedPost.organization.name)
                  : formatDisplayName(post.sharedPost.author.name) || post.sharedPost.author.handle}
              </span>
              <span className="text-xs text-slate-500">• {new Date(post.sharedPost.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="text-sm text-slate-800">
              {post.sharedPost.body}
              {post.sharedPost.images && post.sharedPost.images.length > 0 && (
                 <div className="mt-2">
                   <PostImageGrid images={post.sharedPost.images} mediaUrl={post.sharedPost.mediaUrl} postUrl={buildPostUrl(post.sharedPost)} />
                 </div>
              )}
            </div>
          </Link>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
        <div className="relative min-h-[2.5rem] flex items-center">
          <div className="flex flex-wrap items-center gap-2">
            {REACTION_OPTIONS.map((option) => (
              <ReactionButton
                key={option.type}
                option={option}
                count={(reactionCounts as Record<ReactionType, number>)[option.type] ?? 0}
                active={currentReaction === option.type && canReact}
                blocked={!canReact}
                disabled={pending}
                onBlockedClick={triggerVoteTooltip}
                onClick={() => handleReact(currentReaction === option.type ? null : option.type)}
              />
            ))}
          </div>
          {!canReact && showVoteTooltip ? (
            <div className="absolute left-0 top-full mt-2 w-max max-w-xs rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              Only verified members can react.
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <div className="font-semibold text-slate-600">
            {totalReactions === 1 ? '1 reaction' : `${totalReactions} reactions`}
          </div>
          <Link href={postUrl} className="font-semibold text-slate-600 hover:text-slate-900">
            {commentCount === 1 ? '1 comment' : `${commentCount} comments`}
          </Link>
          <button
            onClick={handleShare}
            className="flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900"
          >
            <LuShare className="h-4 w-4" />
            <span>Share</span>
          </button>
        </div>
      </footer>

      {shareModalOpen ? (
        <SharePostModal
          post={post}
          onClose={() => setShareModalOpen(false)}
          communityOptions={communityOptions}
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
