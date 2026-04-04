'use client'

import clsx from 'clsx'
import { LuMessageCircle, LuX } from 'react-icons/lu'
import CommentComposer from '../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../_components/CommentThread'
import type { ApiPost } from '../_components/PostComposer'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
}

type ShortsCommentsPanelProps = {
  open: boolean
  post: ApiPost | null
  comments: ApiComment[]
  loading: boolean
  error: string | null
  sortMode: 'hot' | 'new'
  currentUser: Viewer | null
  onClose: () => void
  onSortChange: (value: 'hot' | 'new') => void
  onReply: (parentId: string | null, body: string) => Promise<void>
  onVote: (commentId: string, value: -1 | 0 | 1) => Promise<void>
  onCommentReported: (commentId: string) => void
  onCommentAuthorBlocked: (authorId: string) => void
  onSignIn: () => void
  overlayMode?: boolean
}

const COMMENT_SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

export default function ShortsCommentsPanel({
  open,
  post,
  comments,
  loading,
  error,
  sortMode,
  currentUser,
  onClose,
  onSortChange,
  onReply,
  onVote,
  onCommentReported,
  onCommentAuthorBlocked,
  onSignIn,
  overlayMode = false,
}: ShortsCommentsPanelProps) {
  const commentCount = post?.counts?.commentCount ?? comments.length

  return (
    <aside
      className={clsx(
        overlayMode
          ? 'hidden xl:absolute xl:inset-0 xl:z-20 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:transition-[opacity,transform] xl:duration-300'
          : 'hidden min-h-0 xl:flex xl:flex-col xl:overflow-hidden xl:transition-[width,opacity,transform] xl:duration-300',
        overlayMode
          ? open
            ? 'xl:translate-x-0 xl:opacity-100'
            : 'xl:translate-x-8 xl:opacity-0 xl:pointer-events-none'
          : open
            ? 'xl:w-[26rem] xl:translate-x-0 xl:opacity-100'
            : 'xl:w-0 xl:translate-x-8 xl:opacity-0 xl:pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <div className={clsx('flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)]', overlayMode && 'xl:bg-white/98 xl:backdrop-blur-xl')}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <LuMessageCircle className="h-4 w-4 text-[var(--cc-primary)]" />
              <span>Comments</span>
              <span className="text-slate-400">{commentCount}</span>
            </div>
            {post ? <p className="mt-1 truncate text-xs text-slate-500">@{post.author.handle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
            aria-label="Close comments"
          >
            <LuX className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 px-5 py-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-xs font-semibold text-slate-500">
            {COMMENT_SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSortChange(option.value)}
                className={clsx(
                  'rounded-full px-3 py-1.5 transition',
                  sortMode === option.value
                    ? 'bg-[var(--cc-primary)] text-white shadow-subtle'
                    : 'text-slate-500 hover:text-slate-700',
                )}
                disabled={sortMode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!post ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Pick a short to view comments.</div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading comments…</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : (
            <div className="space-y-4">
              {currentUser ? (
                <CommentComposer onSubmit={(body) => onReply(null, body)} className="rounded-2xl border border-slate-200 bg-slate-50/85" />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <span>Sign in to join the conversation.</span>
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
                  >
                    Sign in
                  </button>
                </div>
              )}

              {comments.length ? (
                <CommentThread
                  comments={comments}
                  onReply={onReply}
                  onVote={onVote}
                  onCommentReported={onCommentReported}
                  onCommentAuthorBlocked={onCommentAuthorBlocked}
                  currentUser={currentUser}
                />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  No comments yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}