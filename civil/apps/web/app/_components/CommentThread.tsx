"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { IconType } from 'react-icons'
import { LuArrowBigDown, LuArrowBigUp, LuDot, LuMessageSquare } from 'react-icons/lu'
import CommentComposer from './CommentComposer'
import { pushToast } from './useToasts'
import VerifiedAvatar from './VerifiedAvatar'

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
  hotScore: number
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    isPremium?: boolean
    isVerified?: boolean
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
    isVerified?: boolean
    isPremium?: boolean
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
    isVerified?: boolean
    isPremium?: boolean
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
  blocked: boolean
  onClick: () => void
  onBlockedClick?: () => void
}

function VoteButton({ direction, active, blocked, disabled, onClick, onBlockedClick }: VoteButtonProps) {
  const Icon = direction === 'up' ? LuArrowBigUp : LuArrowBigDown
  const intentClasses =
    direction === 'up'
      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-sm'
      : 'border-red-400 bg-red-50 text-red-500 shadow-sm'

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
        'flex h-9 w-9 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-offset-1',
        blocked
          ? 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-200 hover:text-slate-400 focus:ring-slate-200'
          : active
              ? intentClasses
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 focus:ring-[var(--cc-primary)]',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={handleClick}
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
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition',
        subtle
          ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
          : 'text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10',
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
  const [collapsed, setCollapsed] = useState(false)
  const [pendingVote, setPendingVote] = useState(false)
  const [showVoteTooltip, setShowVoteTooltip] = useState(false)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const createdLabel = useMemo(() => formatRelativeTime(comment.createdAt), [comment.createdAt])
  const canReply = Boolean(currentUser)
  const currentVote = comment.viewerVote ?? 0
  const isNested = depth > 0
  const hasReplies = comment.replies.length > 0
  const showCollapseButton = hasReplies || isNested
  const canVote = Boolean(currentUser?.isVerified || currentUser?.isPremium)

  const handleVote = useCallback(
    async (nextValue: -1 | 0 | 1) => {
      if (pendingVote) return
      if (!canVote) return
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
    [canVote, comment.id, onVote, pendingVote],
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

  const toggleReply = useCallback(() => {
    if (!canReply) {
      pushToast('Sign in to reply to comments.', 'info')
      return
    }
    setReplying((prev) => !prev)
  }, [canReply])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (next) {
        setReplying(false)
      }
      return next
    })
  }, [])

  return (
    <div className={clsx('relative', (showCollapseButton || isNested) && 'pl-6')}>
      {isNested ? (
        <>
          <span className="pointer-events-none absolute left-2 top-0 bottom-0 w-px bg-slate-200" aria-hidden />
          <span className="pointer-events-none absolute left-2 top-5 h-px w-4 bg-slate-200" aria-hidden />
        </>
      ) : null}
      {showCollapseButton ? (
        <button
          type="button"
          className="absolute -left-0.5 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-500 shadow-sm transition hover:bg-slate-50"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '+' : '-'}
        </button>
      ) : null}
      <article id={`comment-${comment.id}`} className="border-b border-slate-100 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <VerifiedAvatar
            src={comment.author.avatarUrl}
            alt={comment.author.name ?? comment.author.handle}
            initials={comment.author.name ?? comment.author.handle}
            size={44}
            isVerified={Boolean(comment.author.isVerified)}
            isBusiness={Boolean(comment.author.isPremium)}
            className="shrink-0"
            href={`/u/${comment.author.handle}`}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <Link href={`/u/${comment.author.handle}`} className="font-semibold text-slate-900 hover:underline">
                {comment.author.name ?? comment.author.handle}
              </Link>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <LuDot className="h-3 w-3" />@{comment.author.handle}
              </span>
              <span className="text-slate-400">• {createdLabel}</span>
              {collapsed ? (
                <span className="text-slate-400">
                  Thread collapsed{hasReplies ? ` • ${comment.replies.length} repl${comment.replies.length === 1 ? 'y' : 'ies'}` : ''}
                </span>
              ) : null}
            </div>
            {collapsed ? null : (
              <>
                <div className="whitespace-pre-wrap text-sm leading-6 text-slate-900">{comment.body}</div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <div className="relative flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <VoteButton
                      direction="up"
                      active={currentVote === 1 && canVote}
                      blocked={!canVote}
                      disabled={pendingVote}
                      onBlockedClick={triggerVoteTooltip}
                      onClick={() => handleVote(currentVote === 1 ? 0 : 1)}
                    />
                    <span className={clsx('min-w-[2rem] text-center text-sm', comment.score > 0 ? 'text-[var(--cc-primary)]' : comment.score < 0 ? 'text-red-500' : 'text-slate-500')}>
                      {formatScore(comment.score)}
                    </span>
                    <VoteButton
                      direction="down"
                      active={currentVote === -1 && canVote}
                      blocked={!canVote}
                      disabled={pendingVote}
                      onBlockedClick={triggerVoteTooltip}
                      onClick={() => handleVote(currentVote === -1 ? 0 : -1)}
                    />
                    {!canVote && showVoteTooltip ? (
                      <div className="absolute left-0 top-full mt-2 w-max max-w-xs rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg">
                        Only verified members can vote.
                      </div>
                    ) : null}
                  </div>
                  <InlineAction icon={LuMessageSquare} label={replying ? 'Cancel reply' : 'Reply'} onClick={toggleReply} subtle={!canReply} />
                </div>
                {replying ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white/80 p-4">
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
              </>
            )}
          </div>
        </div>
      </article>

      {!collapsed && comment.replies.length ? (
        <div className="space-y-2">
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
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-4 text-sm text-slate-500">No comments yet. Start the conversation!</div>
  }

  return (
    <div className="space-y-2">
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
