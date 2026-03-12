"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { IconType } from 'react-icons'
import { LuArrowBigDown, LuArrowBigUp, LuMessageSquare } from 'react-icons/lu'
import CommentComposer from './CommentComposer'
import ContentModerationMenu from './ContentModerationMenu'
import CivilCommentIdentity from './CivilCommentIdentity'
import VerifiedAvatar from './VerifiedAvatar'
import { pushToast } from './useToasts'
import { formatUserDisplayName } from '../_lib/text'

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
    coverUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  replies: ApiComment[]
}

type CommentThreadProps = {
  comments: ApiComment[]
  onReply: (parentId: string | null, body: string) => Promise<void>
  onVote: (commentId: string, value: -1 | 0 | 1) => Promise<void>
  onCommentReported?: (commentId: string) => void
  onCommentAuthorBlocked?: (authorId: string) => void
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
  onCommentReported?: (commentId: string) => void
  onCommentAuthorBlocked?: (authorId: string) => void
  highlightedCommentId?: string | null
  currentUser?: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    isVerified?: boolean
    isPremium?: boolean
  } | null
}

type CommentItemProps = CommentContextProps & {
  comment: ApiComment
  depth: number
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
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-rose-50 text-rose-700'

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
        'inline-flex items-center rounded-full p-1.5 transition focus:outline-none focus:ring-2 focus:ring-offset-1',
        blocked
          ? 'text-slate-400 focus:ring-slate-200'
          : active
              ? intentClasses
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800 focus:ring-[var(--cc-primary)]',
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

function CommentItem(props: CommentItemProps) {
  const { comment, depth, onReply, onVote, onCommentReported, onCommentAuthorBlocked, highlightedCommentId, currentUser } = props
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
  const canVote = Boolean(currentUser)
  const isHighlighted = highlightedCommentId === comment.id
  const authorDisplayName = formatUserDisplayName(comment.author.name, comment.author.handle) || comment.author.handle
  const isOwnComment = Boolean(currentUser?.id && currentUser.id === comment.author.id)
  const commentTargetLabel = `Comment by @${comment.author.handle}`
  const identityBadge = currentUser?.id === comment.author.id ? 'You' : undefined

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
    <div className={clsx('relative', (showCollapseButton || isNested) && 'pl-8')}>
      {isNested ? (
        <>
          <span className="pointer-events-none absolute left-3 top-0 bottom-0 w-px bg-slate-200" aria-hidden />
          <span className="pointer-events-none absolute left-3 top-5 h-px w-4 bg-slate-200" aria-hidden />
        </>
      ) : null}
      {showCollapseButton ? (
        <button
          type="button"
          className="absolute left-0 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-500 shadow-sm transition hover:bg-slate-50"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '+' : '-'}
        </button>
      ) : null}
      <article
        id={`comment-${comment.id}`}
        className={clsx(
          'border-b border-slate-100 pb-3 pt-3 transition',
          isNested && 'ml-auto w-full',
          isHighlighted && 'rounded-2xl bg-amber-50/80 px-3 ring-2 ring-amber-300/80',
        )}
      >
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="shrink-0 pt-0.5">
              <VerifiedAvatar
                src={comment.author.avatarUrl}
                alt={authorDisplayName}
                initials={authorDisplayName}
                size={32}
                isVerified={Boolean(comment.author.isVerified)}
                isBusiness={Boolean(comment.author.isPremium)}
                href={`/u/${comment.author.handle}`}
                className="shrink-0"
              />
            </div>

            <div className="min-w-0 flex-1">
              <CivilCommentIdentity
                handle={comment.author.handle}
                name={authorDisplayName}
                isVerified={Boolean(comment.author.isVerified)}
                isBusiness={Boolean(comment.author.isPremium)}
                meta={createdLabel}
                badgeLabel={identityBadge}
                showAvatar={false}
                className="max-w-full"
              />

              {collapsed ? (
                <div className="pt-1 text-xs text-slate-400">
                  Thread collapsed{hasReplies ? ` • ${comment.replies.length} repl${comment.replies.length === 1 ? 'y' : 'ies'}` : ''}
                </div>
              ) : (
                <div className="mt-1.5 whitespace-pre-wrap text-[15px] leading-6 text-slate-900">{comment.body}</div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <div className="relative inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-0.5 text-sm font-semibold text-slate-600">
                  <VoteButton
                    direction="up"
                    active={currentVote === 1 && canVote}
                    blocked={!canVote}
                    disabled={pendingVote}
                    onBlockedClick={triggerVoteTooltip}
                    onClick={() => handleVote(currentVote === 1 ? 0 : 1)}
                  />
                  <span className="min-w-[2ch] text-center text-sm font-semibold text-slate-700">{formatScore(comment.score)}</span>
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
                      Sign in to vote.
                    </div>
                  ) : null}
                </div>

                <InlineAction icon={LuMessageSquare} label={replying ? 'Cancel reply' : 'Reply'} onClick={toggleReply} subtle={!canReply} />

                {!isOwnComment ? (
                  <ContentModerationMenu
                    className="shrink-0"
                    buttonClassName="h-8 w-8 border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                    buttonLabel="Comment settings"
                    reportTarget={{
                      targetType: 'COMMENT',
                      targetId: comment.id,
                      targetLabel: commentTargetLabel,
                    }}
                    blockTarget={{
                      type: 'user',
                      id: comment.author.id,
                      label: authorDisplayName,
                    }}
                    onReported={() => onCommentReported?.(comment.id)}
                    onBlocked={() => onCommentAuthorBlocked?.(comment.author.id)}
                  />
                ) : null}
              </div>

              {replying ? (
                <CommentComposer
                  className="mt-3"
                  placeholder={`Reply to @${comment.author.handle}`}
                  submitLabel="Reply"
                  onSubmit={(body) => onReply(comment.id, body)}
                  onSuccess={() => setReplying(false)}
                  onCancel={() => setReplying(false)}
                  autoFocus
                />
              ) : null}
            </div>
          </div>
        </div>
      </article>

      {!collapsed && comment.replies.length ? (
        <div className="space-y-0">
          {comment.replies.map((child) => (
            <CommentItem
              key={child.id}
              comment={child}
              depth={depth + 1}
              onReply={onReply}
              onVote={onVote}
              onCommentReported={onCommentReported}
              onCommentAuthorBlocked={onCommentAuthorBlocked}
              highlightedCommentId={highlightedCommentId}
              currentUser={currentUser}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function CommentThread({ comments, onReply, onVote, onCommentReported, onCommentAuthorBlocked, currentUser }: CommentThreadProps) {
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !comments.length) return
    const hashMatch = window.location.hash.match(/^#comment-([A-Za-z0-9]+)$/)
    const queryCommentId = new URLSearchParams(window.location.search).get('comment')
    const targetCommentId = queryCommentId || hashMatch?.[1] || null
    if (!targetCommentId) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const maxAttempts = 10
    const tryHighlight = () => {
      const el = document.getElementById(`comment-${targetCommentId}`)
      if (!el) {
        attempts += 1
        if (attempts < maxAttempts) {
          timeoutId = setTimeout(tryHighlight, 120)
        }
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedCommentId(targetCommentId)
      timeoutId = setTimeout(() => {
        setHighlightedCommentId((current) => (current === targetCommentId ? null : current))
      }, 2600)
    }

    tryHighlight()

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [comments])

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
          onCommentReported={onCommentReported}
          onCommentAuthorBlocked={onCommentAuthorBlocked}
          highlightedCommentId={highlightedCommentId}
          currentUser={currentUser}
        />
      ))}
    </div>
  )
}
