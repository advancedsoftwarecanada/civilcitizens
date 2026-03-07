'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ApiPost } from './PostComposer'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'

type PollCardProps = {
  post: ApiPost
  viewerId?: string | null
  onPostUpdate?: (post: ApiPost) => void
  variant?: 'feed' | 'detail'
  className?: string
}

function formatUnlockAt(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatEndedAt(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export default function PollCard({ post, viewerId, onPostUpdate, variant = 'feed', className }: PollCardProps) {
  const poll = post.poll ?? null
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [newOptionLabel, setNewOptionLabel] = useState('')

  const isDetail = variant === 'detail'
  const isBusy = busyKey !== null

  const summary = useMemo(() => {
    if (!poll) return null
    if (poll.viewer.canSeeResults) {
      const totalVotes = poll.totalVotes ?? 0
      const voteLabel = totalVotes === 1 ? 'vote' : 'votes'
      const endedLabel = poll.endedAt ? `Ended ${formatEndedAt(poll.endedAt)}` : 'Live results'
      return `${totalVotes} ${voteLabel} • ${endedLabel}`
    }
    if (poll.resultsVisibility === 'after_vote') {
      return poll.endedAt ? 'Poll closed' : 'Results hidden until you vote'
    }
    const unlockAt = formatUnlockAt(poll.resultsAvailableAt)
    return unlockAt ? `Results unlock ${unlockAt}` : 'Results hidden for now'
  }, [poll])

  const footnote = useMemo(() => {
    if (!poll) return null
    if (poll.viewer.canSeeResults) {
      if (poll.endedAt) return 'Poll closed. Results are final.'
      if (poll.viewer.hasVoted) return 'You can change your vote until the poll ends.'
      return 'Results are visible.'
    }
    if (poll.resultsVisibility === 'after_vote') {
      return viewerId ? 'Vote to unlock the results for this poll.' : 'Sign in and vote to unlock the results.'
    }
    const unlockAt = formatUnlockAt(poll.resultsAvailableAt)
    if (poll.viewer.hasVoted) {
      return unlockAt ? `Results unlock ${unlockAt}. Voters will be notified when they are ready.` : 'Voters will be notified when results are ready.'
    }
    return unlockAt ? `Results unlock ${unlockAt}.` : 'Results are hidden for now.'
  }, [poll, viewerId])

  if (!poll) return null

  const handleUnauthorized = () => {
    redirectToAuthModal('login')
  }

  const updatePostFromResponse = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as { post?: ApiPost } | null
    if (!response.ok || !payload?.post) {
      const errorPayload = payload as { error?: string } | null
      throw new Error(errorPayload?.error ?? 'request_failed')
    }
    onPostUpdate?.(payload.post)
    return payload.post
  }

  const handleVote = async (optionId: string) => {
    if (!poll.viewer.canVote || isBusy) return
    const token = getStoredToken()
    if (!token) {
      handleUnauthorized()
      return
    }

    setBusyKey(`vote:${optionId}`)
    try {
      const response = await fetch(buildApiUrl(`/posts/${post.id}/poll/vote`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ optionId }),
      })
      await updatePostFromResponse(response)
    } catch (error) {
      console.error('poll_vote_failed', error)
      pushToast('Unable to record your vote right now.', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const handleAddOption = async () => {
    const trimmed = newOptionLabel.trim()
    if (!trimmed || !poll.authorCanAddOptions || isBusy) return

    const token = getStoredToken()
    if (!token) {
      handleUnauthorized()
      return
    }

    setBusyKey('add-option')
    try {
      const response = await fetch(buildApiUrl(`/posts/${post.id}/poll/options`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: trimmed }),
      })
      await updatePostFromResponse(response)
      setNewOptionLabel('')
      pushToast('Poll option added.', 'success')
    } catch (error) {
      console.error('poll_add_option_failed', error)
      pushToast('Unable to add that option right now.', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const handleEndPoll = async () => {
    if (!poll.authorCanEndPoll || isBusy) return
    if (typeof window !== 'undefined' && !window.confirm('End this poll and lock the results?')) {
      return
    }

    const token = getStoredToken()
    if (!token) {
      handleUnauthorized()
      return
    }

    setBusyKey('end-poll')
    try {
      const response = await fetch(buildApiUrl(`/posts/${post.id}/poll/end`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      await updatePostFromResponse(response)
      pushToast('Poll ended.', 'success')
    } catch (error) {
      console.error('poll_end_failed', error)
      pushToast('Unable to end this poll right now.', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section
      className={clsx(
        'rounded-2xl border border-slate-200 bg-white',
        isDetail ? 'p-5' : 'p-4',
        className,
      )}
      data-prevent-card-nav="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Poll</p>
          <p className="mt-1 text-xs text-slate-500">{summary}</p>
        </div>
        {poll.endedAt ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Closed
          </span>
        ) : (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Active
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {poll.options.map((option) => {
          const selected = poll.viewer.optionId === option.id
          const percentage = poll.viewer.canSeeResults ? Math.max(0, Math.min(100, option.percentage ?? 0)) : 0

          return (
            <button
              key={option.id}
              type="button"
              className={clsx(
                'relative isolate block w-full overflow-hidden rounded-xl border bg-white text-left transition',
                selected ? 'border-[var(--cc-primary)]' : 'border-slate-200 hover:border-slate-300',
                !poll.viewer.canVote && 'cursor-default',
              )}
              onClick={() => void handleVote(option.id)}
              disabled={isBusy || !poll.viewer.canVote}
              aria-pressed={selected}
            >
              <span className={clsx('absolute inset-0', selected ? 'bg-[var(--cc-primary)]/5' : 'bg-slate-50')} aria-hidden="true" />
              {poll.viewer.canSeeResults ? (
                <span
                  className={clsx(
                    'absolute inset-1 origin-left rounded-[0.9rem]',
                    selected
                      ? 'bg-[linear-gradient(90deg,rgba(202,5,45,0.26),rgba(202,5,45,0.12))]'
                      : 'bg-[linear-gradient(90deg,rgba(59,130,246,0.16),rgba(59,130,246,0.07))]',
                  )}
                  style={{ transform: `scaleX(${percentage / 100})` }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="relative z-[1] flex items-center justify-between gap-3 px-4 py-3">
                <span className={clsx('min-w-0 text-sm font-semibold', selected ? 'text-[var(--cc-primary-700)]' : 'text-slate-800')}>
                  {option.label}
                </span>
                <span className="shrink-0 text-xs font-semibold text-slate-500">
                  {poll.viewer.canSeeResults
                    ? `${option.voteCount ?? 0} • ${percentage}%`
                    : selected
                      ? 'Selected'
                      : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-slate-500">{footnote}</p>

      {poll.authorCanAddOptions ? (
        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Add option
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newOptionLabel}
              onChange={(event) => setNewOptionLabel(event.target.value)}
              placeholder="Add another option"
              maxLength={160}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:outline-none"
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() => void handleAddOption()}
              className={clsx(
                'h-10 rounded-full px-4 text-sm font-semibold transition',
                !newOptionLabel.trim() || isBusy
                  ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                  : 'bg-[var(--cc-primary)] text-white hover:bg-[var(--cc-primary-700)]',
              )}
              disabled={!newOptionLabel.trim() || isBusy}
            >
              {busyKey === 'add-option' ? 'Adding...' : 'Add'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            {poll.options.length}/{poll.maxOptions} options used.
          </p>
        </div>
      ) : null}

      {poll.authorCanEndPoll ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleEndPoll()}
            className={clsx(
              'rounded-full border px-4 py-2 text-sm font-semibold transition',
              isBusy
                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
            )}
            disabled={isBusy}
          >
            {busyKey === 'end-poll' ? 'Ending...' : 'End poll'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
