'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import type { ApiPost } from './PostComposer'
import CivilCommentIdentity from './CivilCommentIdentity'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'

type CommentItem = NonNullable<ApiPost['recentComments']>[number]

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

type CivilPostCommentsProps = {
  comments: CommentItem[]
  postHref: string
  viewerId?: string | null
  activeReplyParentId: string | null
  replyDraft: string
  inlineComment: string
  inlineSubmitting: boolean
  hideInlineCommentComposer: boolean
  onRequireAuth: () => void
  onToggleReply: (commentId: string) => void
  onReplyDraftChange: (value: string) => void
  onReplySubmit: (commentId: string) => Promise<boolean>
  onInlineCommentChange: (value: string) => void
  onInlineCommentSubmit: (event: FormEvent) => void
}

export default function CivilPostComments({
  comments,
  postHref,
  viewerId,
  activeReplyParentId,
  replyDraft,
  inlineComment,
  inlineSubmitting,
  hideInlineCommentComposer,
  onRequireAuth,
  onToggleReply,
  onReplyDraftChange,
  onReplySubmit,
  onInlineCommentChange,
  onInlineCommentSubmit,
}: CivilPostCommentsProps) {
  const [isMobileViewport, setIsMobileViewport] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 1023px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport)
    } else {
      mediaQuery.addListener(syncViewport)
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncViewport)
      } else {
        mediaQuery.removeListener(syncViewport)
      }
    }
  }, [])

  return (
    <section className="space-y-3 border-t border-slate-100 pt-3" data-prevent-card-nav="true">
      {comments.map((comment) => {
        const commentAuthorName = comment.author.name ? formatDisplayName(comment.author.name) : comment.author.handle
        const isReplyTarget = activeReplyParentId === comment.id
        const createdLabel = comment.optimistic ? 'Sending...' : formatRelativeTime(comment.createdAt)
        const identityBadge = viewerId && viewerId === comment.author.id ? 'You' : undefined
        const commentHref = `${postHref}?comment=${encodeURIComponent(comment.id)}#comment-${encodeURIComponent(comment.id)}`

        return (
          <div
            key={comment.id}
            className={clsx(
              'relative border-b border-slate-100 py-3 last:border-b-0 transition-colors',
              comment.optimistic && 'opacity-80',
              comment.localPreview && 'rounded-2xl border border-rose-200/80 bg-rose-50/65 px-3 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.08)]',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 pt-0.5">
                <VerifiedAvatar
                  src={comment.author.avatarUrl ?? null}
                  alt={commentAuthorName}
                  initials={commentAuthorName}
                  size={32}
                  isVerified={Boolean(comment.author.isVerified)}
                  isBusiness={Boolean(comment.author.isPremium)}
                  href={`/u/${comment.author.handle}`}
                  className="shrink-0"
                />
              </div>
              <div className="min-w-0 flex-1">
                <Link href={commentHref} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--cc-primary)]/30">
                  <CivilCommentIdentity
                    handle={comment.author.handle}
                    name={commentAuthorName}
                    isVerified={Boolean(comment.author.isVerified)}
                    isBusiness={Boolean(comment.author.isPremium)}
                    meta={createdLabel}
                    badgeLabel={identityBadge}
                    showAvatar={false}
                    linkProfile={false}
                    className="max-w-full"
                  />

                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-900 hover:text-slate-950">{comment.body}</p>
                </Link>

                {!isMobileViewport ? (
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (comment.optimistic) return
                        if (!viewerId) {
                          onRequireAuth()
                          return
                        }
                        onToggleReply(comment.id)
                      }}
                      className={clsx(
                        'inline-flex items-center rounded-full px-1 py-0.5 text-xs font-semibold text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10',
                        comment.optimistic && 'cursor-default opacity-60 hover:bg-transparent',
                          comment.localPreview && !comment.optimistic && 'text-rose-700 hover:bg-rose-100/70',
                      )}
                    >
                      {comment.optimistic ? 'Posting...' : isReplyTarget ? 'Cancel reply' : 'Reply'}
                    </button>
                  </div>
                ) : null}

                {isReplyTarget ? (
                  !isMobileViewport ? (
                    <form
                      className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 p-2"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        await onReplySubmit(comment.id)
                      }}
                    >
                      <input
                        type="text"
                        value={replyDraft}
                        onChange={(event) => onReplyDraftChange(event.target.value)}
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
                          !replyDraft.trim() || inlineSubmitting || !viewerId ? 'cursor-not-allowed opacity-60' : 'hover:bg-[var(--cc-primary-700)]',
                        )}
                        disabled={!replyDraft.trim() || inlineSubmitting || !viewerId}
                      >
                        {inlineSubmitting ? '...' : 'Reply'}
                      </button>
                    </form>
                  ) : null
                ) : null}
              </div>
            </div>
          </div>
        )
      })}

      {!hideInlineCommentComposer ? (
        !isMobileViewport ? (
          <form className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2" onSubmit={onInlineCommentSubmit}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inlineComment}
                onChange={(event) => onInlineCommentChange(event.target.value)}
                onFocus={() => {
                  if (!viewerId) {
                    onRequireAuth()
                  }
                }}
                placeholder={viewerId ? 'Add a comment' : 'Sign in to comment'}
                className="h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cc-primary)]"
                maxLength={5000}
                disabled={inlineSubmitting || !viewerId}
              />
              <button
                type="submit"
                className={clsx(
                  'h-9 rounded-full bg-[var(--cc-primary)] px-3 text-xs font-semibold text-white transition',
                  !inlineComment.trim() || inlineSubmitting || !viewerId ? 'cursor-not-allowed opacity-60' : 'hover:bg-[var(--cc-primary-700)]',
                )}
                disabled={!inlineComment.trim() || inlineSubmitting || !viewerId}
              >
                {inlineSubmitting ? '...' : 'Comment'}
              </button>
            </div>
          </form>
        ) : null
      ) : null}
    </section>
  )
}
