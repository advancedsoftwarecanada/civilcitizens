'use client'

import type { FormEvent } from 'react'
import clsx from 'clsx'
import type { ApiPost } from './PostComposer'
import CivilCard from './CivilCard'
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
  return (
    <section className="space-y-3 border-t border-slate-100 pt-3" data-prevent-card-nav="true">
      {comments.map((comment) => {
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
                      onRequireAuth()
                      return
                    }
                    onToggleReply(comment.id)
                  }}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10"
                >
                  {isReplyTarget ? 'Cancel' : 'Reply'}
                </button>
              </div>

              {isReplyTarget ? (
                <form
                  className="mt-2 flex items-center gap-2 border-l border-slate-200 pl-3"
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
              ) : null}
            </div>
          </div>
        )
      })}

      {!hideInlineCommentComposer ? (
        <form className="flex items-center gap-2" onSubmit={onInlineCommentSubmit}>
          <input
            type="text"
            value={inlineComment}
            onChange={(event) => onInlineCommentChange(event.target.value)}
            onFocus={() => {
              if (!viewerId) {
                onRequireAuth()
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
              !inlineComment.trim() || inlineSubmitting || !viewerId ? 'cursor-not-allowed opacity-60' : 'hover:bg-[var(--cc-primary-700)]',
            )}
            disabled={!inlineComment.trim() || inlineSubmitting || !viewerId}
          >
            {inlineSubmitting ? '...' : 'Post'}
          </button>
        </form>
      ) : null}
    </section>
  )
}