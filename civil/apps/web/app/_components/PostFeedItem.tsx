"use client"

import { useCallback, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'
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
      <div className="flex gap-4">
        <div className="flex w-12 flex-col items-center justify-start gap-1 pt-1">
          <button
            type="button"
            className={clsx(
              'flex h-7 w-7 items-center justify-center rounded-full text-sm transition',
              currentVote === 1 ? 'bg-[var(--cc-primary)] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
            )}
            onClick={() => handleVote(currentVote === 1 ? 0 : 1)}
            disabled={pending}
            aria-label="Upvote"
          >
            ▲
          </button>
          <div className="text-sm font-semibold text-gray-700">{score}</div>
          <button
            type="button"
            className={clsx(
              'flex h-7 w-7 items-center justify-center rounded-full text-sm transition',
              currentVote === -1 ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
            )}
            onClick={() => handleVote(currentVote === -1 ? 0 : -1)}
            disabled={pending}
            aria-label="Downvote"
          >
            ▼
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <header className="flex items-start gap-3">
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
              <footer className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                <Link href={postUrl} className="hover:underline">
                  {commentCount === 1 ? '1 comment' : `${commentCount} comments`}
                </Link>
                <span className="text-gray-400">
                  Hot score: {post.metrics?.hotScore?.toFixed(2) ?? '0.00'}
                </span>
              </footer>
            </div>
          </header>
        </div>
      </div>
    </article>
  )
}
