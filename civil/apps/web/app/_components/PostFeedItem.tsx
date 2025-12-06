"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { LuArrowBigDown, LuArrowBigUp } from 'react-icons/lu'
import type { ApiPost } from './PostComposer'
import { JURISDICTION_LABELS } from './PostComposer'
import VerifiedAvatar from './VerifiedAvatar'

function buildPostUrl(post: ApiPost) {
  if (post.seoSlug) {
    if (post.provinceCode && post.chamberSlug) {
      return `/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}/posts/${post.seoSlug}`
    }
    return `/u/${post.author.handle}/posts/${post.seoSlug}`
  }
  return `/post/${post.id}`
}

function buildCommunityUrl(post: ApiPost) {
  if (post.provinceCode && post.chamberSlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}`
  }
  return null
}

type PostFeedItemProps = {
  post: ApiPost
  onVote: (postId: string, value: -1 | 0 | 1) => Promise<void>
  viewerIsVerified?: boolean
  viewerId?: string | null
}

function formatScore(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return value.toString()
}

type VoteButtonProps = {
  direction: 'up' | 'down'
  active: boolean
  disabled: boolean
  blocked: boolean
  onClick: () => void
  onBlockedClick?: () => void
}

function VoteButton({ direction, active, blocked, disabled, onClick, onBlockedClick }: VoteButtonProps) {
  const Icon = direction === 'up' ? LuArrowBigUp : LuArrowBigDown
  const intentClasses =
    direction === 'up'
      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-sm'
      : 'border-red-500 bg-red-500 text-white shadow-sm'

  const handleClick = () => {
    if (disabled) return
    if (blocked) {
      onBlockedClick?.()
      return
    }
    onClick()
  }

  return (
    <button
      type="button"
      className={clsx(
        'flex h-9 w-9 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-offset-2',
        blocked
          ? 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-200 hover:text-slate-400 focus:ring-slate-200'
          : active
              ? intentClasses
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 focus:ring-[var(--cc-primary)]',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={handleClick}
      aria-label={direction === 'up' ? 'Upvote post' : 'Downvote post'}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

export default function PostFeedItem({ post, onVote, viewerIsVerified, viewerId }: PostFeedItemProps) {
  const [pending, setPending] = useState(false)
  const [showVoteTooltip, setShowVoteTooltip] = useState(false)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const score = post.counts?.score ?? 0
  const commentCount = post.counts?.commentCount ?? 0
  const currentVote = (post.viewer?.vote ?? 0) as -1 | 0 | 1
  const postUrl = buildPostUrl(post)
  const communityUrl = buildCommunityUrl(post)
  const createdAt = new Date(post.createdAt)
  const isVerifiedAuthor = Boolean(post.author.isVerified)
  const isBusinessAuthor = Boolean(post.author.isPremium)
  const canVote = Boolean(viewerIsVerified)
  const isViewerPost = Boolean(viewerId && post.author.id === viewerId)
  const jurisdictionLabel = isViewerPost ? 'Self' : JURISDICTION_LABELS[post.jurisdiction]

  const handleVote = useCallback(
    async (nextValue: -1 | 0 | 1) => {
      if (pending) return
      if (!canVote) return
      setPending(true)
      try {
        await onVote(post.id, nextValue)
      } finally {
        setPending(false)
      }
    },
    [canVote, onVote, pending, post.id],
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
            src={post.author.avatarUrl}
            alt={post.author.name ?? post.author.handle}
            initials={post.author.name ?? post.author.handle}
            size={48}
            isVerified={isVerifiedAuthor}
            isBusiness={isBusinessAuthor}
            className="shrink-0"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <Link href={`/u/${post.author.handle}`} className="font-semibold text-slate-900 hover:underline">
                {post.author.name ?? post.author.handle}
              </Link>
              <span>@{post.author.handle}</span>
              <span className="text-xs">• {formattedDate}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                {jurisdictionLabel}
              </span>
              {communityUrl ? (
                <Link
                  href={communityUrl}
                  className="rounded-full border border-slate-200 px-2 py-0.5 uppercase tracking-wide text-slate-500 hover:border-slate-300"
                  aria-label="Open community feed"
                >
                  {post.chamberName ?? post.chamberSlug}
                </Link>
              ) : null}
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500">
                {post.type === 'article' ? 'Article' : 'Post'}
              </span>
            </div>
          </div>
        </div>
        {post.metrics?.hotScore ? (
          <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            Hot {Math.round(post.metrics.hotScore)}
          </div>
        ) : null}
      </header>

      <div className="space-y-3 text-[15px] leading-6 text-slate-800">
        {post.type === 'article' && post.title ? (
          <Link href={postUrl} className="text-lg font-semibold text-slate-900 hover:underline">
            {post.title}
          </Link>
        ) : null}
        {post.type === 'article' ? (
          <Link href={postUrl} className="block text-slate-700 hover:text-slate-900">
            <span dangerouslySetInnerHTML={{ __html: post.body }} />
          </Link>
        ) : (
          <Link href={postUrl} className="block whitespace-pre-wrap text-slate-800 hover:text-slate-900">
            {post.body}
          </Link>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
        <div className="relative min-h-[2.5rem] flex items-center">
          <div className="flex items-center gap-2 font-semibold">
            <VoteButton
              direction="up"
              active={currentVote === 1 && canVote}
              blocked={!canVote}
              disabled={pending}
              onBlockedClick={triggerVoteTooltip}
              onClick={() => handleVote(currentVote === 1 ? 0 : 1)}
            />
            <span
              className={clsx(
                'min-w-[2rem] text-center',
                score > 0 ? 'text-[var(--cc-primary)]' : score < 0 ? 'text-red-500' : 'text-slate-600',
              )}
            >
              {formatScore(score)}
            </span>
            <VoteButton
              direction="down"
              active={currentVote === -1 && canVote}
              blocked={!canVote}
              disabled={pending}
              onBlockedClick={triggerVoteTooltip}
              onClick={() => handleVote(currentVote === -1 ? 0 : -1)}
            />
          </div>
          {!canVote && showVoteTooltip ? (
            <div className="absolute left-0 top-full mt-2 w-max max-w-xs rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              Only verified members can vote.
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <Link href={postUrl} className="font-semibold text-slate-600 hover:text-slate-900">
            {commentCount === 1 ? '1 comment' : `${commentCount} comments`}
          </Link>
        </div>
      </footer>
    </article>
  )
}
