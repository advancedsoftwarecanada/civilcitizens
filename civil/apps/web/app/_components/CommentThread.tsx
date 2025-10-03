"use client"

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { IconType } from 'react-icons'
import { LuArrowBigDown, LuArrowBigUp, LuDot, LuMessageSquare } from 'react-icons/lu'
import CommentComposer from './CommentComposer'
import { pushToast } from './useToasts'

export type ApiComment = {
  id: string
  postId: string
  parentId: string | null
  body: string
  createdAt: string
  updatedAt: string
  upvotes: number
  downvotes: number
  score: number
  viewerVote: -1 | 0 | 1
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  }
  replies: ApiComment[]
}

type CommentThreadProps = {
  comments: ApiComment[]
  onReply: (parentId: string | null, body: string) => Promise<void>
  onVote: (commentId: string, value: -1 | 0 | 1) => Promise<void>
  currentUser?: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
  } | null
}

type CommentContextProps = {
  onReply: (parentId: string | null, body: string) => Promise<void>
  onVote: (commentId: string, value: -1 | 0 | 1) => Promise<void>
  currentUser?: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
  } | null
}

const RELATIVE_TIME_THRESHOLDS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, 'seconds'],
  [60, 'minutes'],
  [24, 'hours'],
  [7, 'days'],
  [4, 'weeks'],
  [12, 'months'],
]

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
      aria-label={direction === 'up' ? 'Upvote comment' : 'Downvote comment'}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

type InlineActionProps = {
  icon: IconType
  label: string
  onClick?: () => void
  subtle?: boolean
}

function InlineAction({ icon: Icon, label, onClick, subtle }: InlineActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition',
        subtle
          ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          : 'text-[var(--cc-primary)] hover:bg-[var(--cc-primary-50)]',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  let diff = diffMs / 1000
  let unit: Intl.RelativeTimeFormatUnit = 'seconds'

  for (const [threshold, nextUnit] of RELATIVE_TIME_THRESHOLDS) {
    if (Math.abs(diff) < threshold) break
    diff /= threshold
    unit = nextUnit
  }

  const rounded = Math.round(diff)
  return rtf.format(-rounded, unit)
}

function CommentItem({ comment, depth, onReply, onVote, currentUser }: CommentContextProps & { comment: ApiComment; depth: number }) {
  const [replying, setReplying] = useState(false)
  const [pendingVote, setPendingVote] = useState(false)
  const createdLabel = useMemo(() => formatRelativeTime(comment.createdAt), [comment.createdAt])
  const canReply = Boolean(currentUser)
  const currentVote = comment.viewerVote ?? 0
  const isNested = depth > 0

  const handleVote = useCallback(
    async (nextValue: -1 | 0 | 1) => {
      if (pendingVote) return
      setPendingVote(true)
      try {
        await onVote(comment.id, nextValue)
      } catch (err) {
        console.error('Failed to vote on comment', err)
        pushToast('Unable to update your vote right now.', 'error')
      } finally {
        setPendingVote(false)
      }
    },
    [comment.id, onVote, pendingVote],
  )

  const toggleReply = useCallback(() => {
    if (!canReply) {
      pushToast('Sign in to reply to comments.', 'info')
      return
    }
    setReplying((prev) => !prev)
  }, [canReply])

  return (
    <div className={clsx('space-y-3', isNested && 'border-l border-gray-200 pl-4')}>
      <article
        id={`comment-${comment.id}`}
        className={clsx(
          'rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-sm transition hover:shadow-md md:px-4',
          isNested && 'bg-gray-50/80',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-200">
            {comment.author.avatarUrl ? (
              <Image
                src={comment.author.avatarUrl}
                alt={comment.author.name ?? comment.author.handle}
                width={40}
                height={40}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-600">
                {(comment.author.name || comment.author.handle).substring(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <Link href={`/u/${comment.author.handle}`} className="font-semibold text-gray-900 hover:underline">
                {comment.author.name ?? comment.author.handle}
              </Link>
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                <LuDot className="h-3 w-3" />@{comment.author.handle}
              </span>
              <span className="text-gray-400">• {createdLabel}</span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-gray-900">{comment.body}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <div className="flex items-center text-sm font-semibold text-gray-600">
                <VoteButton
                  direction="up"
                  active={currentVote === 1}
                  disabled={pendingVote}
                  onClick={() => handleVote(currentVote === 1 ? 0 : 1)}
                />
                <span
                  className={clsx(
                    'min-w-[2rem] text-center',
                    comment.score > 0
                      ? 'text-[var(--cc-primary)]'
                      : comment.score < 0
                        ? 'text-red-500'
                        : 'text-gray-600',
                  )}
                >
                  {formatScore(comment.score)}
                </span>
                <VoteButton
                  direction="down"
                  active={currentVote === -1}
                  disabled={pendingVote}
                  onClick={() => handleVote(currentVote === -1 ? 0 : -1)}
                />
              </div>
              <InlineAction icon={LuMessageSquare} label={replying ? 'Cancel reply' : 'Reply'} onClick={toggleReply} subtle={!canReply} />
            </div>
            {replying ? (
              <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white/80 p-4">
                <CommentComposer
                  placeholder={`Reply to @${comment.author.handle}`}
                  submitLabel="Reply"
                  onSubmit={(body) => onReply(comment.id, body)}
                  onSuccess={() => setReplying(false)}
                  onCancel={() => setReplying(false)}
                  autoFocus
                />
              </div>
            ) : null}
          </div>
        </div>
      </article>

      {comment.replies.length ? (
        <div className="space-y-4">
          {comment.replies.map((child) => (
            <CommentItem
              key={child.id}
              comment={child}
              depth={depth + 1}
              onReply={onReply}
              onVote={onVote}
              currentUser={currentUser}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function CommentThread({ comments, onReply, onVote, currentUser }: CommentThreadProps) {
  if (!comments.length) {
    return <div className="text-sm text-gray-500">No comments yet. Start the conversation!</div>
  }

  return (
  <div className="space-y-4">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          depth={0}
          onReply={onReply}
          onVote={onVote}
          currentUser={currentUser}
        />
      ))}
    </div>
  )
}
