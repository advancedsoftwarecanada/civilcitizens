"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { HiOutlinePaperAirplane, HiOutlinePhoto } from 'react-icons/hi2'
import MobileBottomInputShell from './MobileBottomInputShell'
import { pushToast } from './useToasts'

type ThreadBottomCommentComposerProps = {
  onSubmit: (body: string) => Promise<void>
  placeholder?: string
  ariaLabel?: string
  replyHandle?: string | null
  onCancelReply?: (() => void) | null
  autoFocus?: boolean
  composerId?: string | null
}

export default function ThreadBottomCommentComposer({
  onSubmit,
  placeholder = 'Your comment…',
  ariaLabel = 'Comment composer',
  replyHandle = null,
  onCancelReply = null,
  autoFocus = false,
  composerId = null,
}: ThreadBottomCommentComposerProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const canSubmit = value.trim().length > 0 && !submitting

  const submit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
      setValue('')
    } catch (error) {
      console.error('Unable to submit comment', error)
      pushToast('Unable to post your comment right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [onSubmit, submitting, value])

  useEffect(() => {
    if (!autoFocus) return

    const target = inputRef.current
    if (!target) return

    const focusInput = () => {
      target.focus({ preventScroll: true })
      const length = target.value.length
      target.setSelectionRange(length, length)
    }

    focusInput()
    const frame = window.requestAnimationFrame(focusInput)
    const timeout = window.setTimeout(focusInput, 80)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [autoFocus])

  return (
    <MobileBottomInputShell className="z-[90]">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-2" role="group" aria-label={ariaLabel}>
        {replyHandle ? (
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="min-w-0 text-xs font-semibold text-slate-500">
              Replying to <span className="text-slate-700">@{replyHandle}</span>
            </div>
            {onCancelReply ? (
              <button
                type="button"
                onClick={onCancelReply}
                className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 hover:text-slate-800"
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            data-thread-composer-id={composerId ?? undefined}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck
            enterKeyHint="send"
            inputMode="text"
            autoFocus={autoFocus}
            placeholder={placeholder}
            className="h-11 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
          />
          <button
            type="button"
            onClick={() => pushToast('Comment images are coming soon.', 'info')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
            aria-label="Add image"
            title="Add image"
          >
            <HiOutlinePhoto className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              void submit()
            }}
            disabled={!canSubmit}
            className={clsx(
              'inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition',
              canSubmit ? 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]' : 'cursor-not-allowed bg-slate-300',
            )}
            aria-label="Post comment"
            title="Post comment"
          >
            <HiOutlinePaperAirplane className="h-5 w-5" />
          </button>
        </div>
      </div>
    </MobileBottomInputShell>
  )
}
