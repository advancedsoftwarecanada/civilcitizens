"use client"

import { useCallback, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'
import { LuArrowBigDown, LuArrowBigUp } from 'react-icons/lu'
import type { ApiPost } from './PostComposer'
import { JURISDICTION_LABELS } from './PostComposer'

function buildPostUrl(post: ApiPost) {
  if (post.seoSlug) {
    if (post.provinceCode && post.chamberSlug) {
      return `/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}/posts/${post.seoSlug}`
    }
    return `/u/${post.author.handle}/posts/${post.seoSlug}`
  }
  return `/post/${post.id}`
}

function buildChamberUrl(post: ApiPost) {
  if (post.provinceCode && post.chamberSlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.chamberSlug.toLowerCase()}`
  }
  return null
}

type PostFeedItemProps = {
  post: ApiPost
  onVote: (postId: string, value: -1 | 0 | 1) => Promise<void>
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
  onClick: () => void
}

function VoteButton({ direction, active, disabled, onClick }: VoteButtonProps) {
  const Icon = direction === 'up' ? LuArrowBigUp : LuArrowBigDown
  const intentClasses =
    direction === 'up'
      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-sm'
      : 'border-red-500 bg-red-500 text-white shadow-sm'

  return (
    <button
      type="button"
      className={clsx(
        'flex h-8 w-8 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-offset-1',
        active
          ? intentClasses
          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-600 focus:ring-[var(--cc-primary)]',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={onClick}
      aria-label={direction === 'up' ? 'Upvote post' : 'Downvote post'}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

export default function PostFeedItem({ post, onVote }: PostFeedItemProps) {
  const [pending, setPending] = useState(false)
  const score = post.counts?.score ?? 0
  const commentCount = post.counts?.commentCount ?? 0
  const currentVote = (post.viewer?.vote ?? 0) as -1 | 0 | 1
  const postUrl = buildPostUrl(post)
  const chamberUrl = buildChamberUrl(post)
  const createdAt = new Date(post.createdAt)

  const handleVote = useCallback(
    async (nextValue: -1 | 0 | 1) => {
      if (pending) return
      setPending(true)
      try {
        await onVote(post.id, nextValue)
      } finally {
        setPending(false)
      }
    },
    [onVote, pending, post.id],
  )

  const formattedDate = createdAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <article className="border-t border-gray-200 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
              {post.author.avatarUrl ? (
                <Image
                  src={post.author.avatarUrl}
                  alt={post.author.name ?? post.author.handle}
                  width={44}
                  height={44}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-600">
                  {(post.author.name || post.author.handle).substring(0, 1).toUpperCase()}
                </div>
              )}
        </div>
        <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                <Link href={`/u/${post.author.handle}`} className="font-semibold text-gray-900 hover:underline">
                  {post.author.name ?? post.author.handle}
                </Link>
                <span>@{post.author.handle}</span>
                <span className="text-xs">• {formattedDate}</span>
                <span className="bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                  {JURISDICTION_LABELS[post.jurisdiction]}
                </span>
                {chamberUrl ? (
                  <Link
                    href={chamberUrl}
                    className="border border-gray-200 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50"
                  >
                    {post.chamberName ?? post.chamberSlug}
                  </Link>
                ) : null}
              </div>
              <div className="mt-3 space-y-3 text-[15px] leading-6 text-gray-800">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                  <span className="border border-gray-300 px-2 py-0.5">
                    {post.type === 'article' ? 'Article' : 'Post'}
                  </span>
                  {post.type === 'article' && post.title ? (
                    <Link href={postUrl} className="font-semibold text-gray-700 hover:underline">
                      {post.title}
                    </Link>
                  ) : null}
                </div>
                {post.type === 'article' ? (
                  <Link href={postUrl} className="prose prose-sm max-w-none text-gray-700 hover:underline">
                    <span dangerouslySetInnerHTML={{ __html: post.body }} />
                  </Link>
                ) : (
                  <Link href={postUrl} className="block whitespace-pre-wrap hover:underline">
                    {post.body}
                  </Link>
                )}
              </div>
        </div>
      </div>
      <footer className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
  <div className="flex items-center text-sm font-semibold text-gray-600">
          <VoteButton
            direction="up"
            active={currentVote === 1}
            disabled={pending}
            onClick={() => handleVote(currentVote === 1 ? 0 : 1)}
          />
          <span
            className={clsx(
              'min-w-[2rem] text-center',
              score > 0 ? 'text-[var(--cc-primary)]' : score < 0 ? 'text-red-500' : 'text-gray-600',
            )}
          >
            {formatScore(score)}
          </span>
          <VoteButton
            direction="down"
            active={currentVote === -1}
            disabled={pending}
            onClick={() => handleVote(currentVote === -1 ? 0 : -1)}
          />
        </div>
        <Link href={postUrl} className="hover:underline">
          {commentCount === 1 ? '1 comment' : `${commentCount} comments`}
        </Link>
      </footer>
    </article>
  )
}
