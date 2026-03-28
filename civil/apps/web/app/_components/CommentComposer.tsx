"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { dismissMobileKeyboardTracking, readMobileKeyboardSnapshot, useMobileKeyboardState } from '../_lib/mobileKeyboard'

const MAX_COMMENT_LENGTH = 5000

type CommentComposerProps = {
  onSubmit: (body: string) => Promise<void>
  className?: string
  placeholder?: string
  submitLabel?: string
  autoFocus?: boolean
  onCancel?: () => void
  onSuccess?: () => void
  variant?: 'default' | 'inline-reply'
  ariaLabel?: string
  composerId?: string | null
}

export default function CommentComposer({
  onSubmit,
  className,
  placeholder = 'Share your thoughts…',
  submitLabel = 'Comment',
  autoFocus = false,
  onCancel,
  onSuccess,
  variant = 'default',
  ariaLabel,
  composerId = null,
}: CommentComposerProps) {
  const keyboardState = useMobileKeyboardState()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInlineReply = variant === 'inline-reply'
  const formRef = useRef<HTMLFormElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const alignIntervalRef = useRef<number | null>(null)
  const alignTimeoutRef = useRef<number | null>(null)
  const focusIntervalRef = useRef<number | null>(null)
  const focusTimeoutRef = useRef<number | null>(null)

  const canSubmit = value.trim().length > 0 && value.trim().length <= MAX_COMMENT_LENGTH

  const clearInlineReplyAlignment = useCallback(() => {
    if (alignIntervalRef.current) {
      window.clearInterval(alignIntervalRef.current)
      alignIntervalRef.current = null
    }
    if (alignTimeoutRef.current) {
      window.clearTimeout(alignTimeoutRef.current)
      alignTimeoutRef.current = null
    }
  }, [])

  const clearFocusStabilization = useCallback(() => {
    if (focusIntervalRef.current) {
      window.clearInterval(focusIntervalRef.current)
      focusIntervalRef.current = null
    }
    if (focusTimeoutRef.current) {
      window.clearTimeout(focusTimeoutRef.current)
      focusTimeoutRef.current = null
    }
  }, [])

  const focusComposerTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return false

    textarea.focus({ preventScroll: true })
    const length = textarea.value.length
    textarea.setSelectionRange(length, length)
    return document.activeElement === textarea
  }, [])

  const alignInlineReplyComposer = useCallback(() => {
    if (!isInlineReply) return

    const form = formRef.current
    const appRoot = document.getElementById('cc-app-root')
    if (!form || !appRoot) return

    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportHeight = viewport?.height ?? keyboardState.viewportHeight ?? window.innerHeight
    const formRect = form.getBoundingClientRect()
    const desiredTop = Math.max(viewportTop + 16, viewportTop + viewportHeight / 2 - formRect.height / 2)
    const delta = formRect.top - desiredTop
    if (Math.abs(delta) < 4) return

    const maxScrollTop = Math.max(0, appRoot.scrollHeight - appRoot.clientHeight)
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, appRoot.scrollTop + delta))
    if (Math.abs(nextScrollTop - appRoot.scrollTop) < 1) return

    appRoot.scrollTo({ top: nextScrollTop, behavior: 'auto' })
  }, [isInlineReply, keyboardState.viewportHeight])

  const scheduleInlineReplyAlignment = useCallback(() => {
    if (!isInlineReply) return

    clearInlineReplyAlignment()

    let attempts = 0
    const runAlignment = () => {
      attempts += 1
      alignInlineReplyComposer()
      if (attempts >= 8) {
        clearInlineReplyAlignment()
      }
    }

    runAlignment()
    alignIntervalRef.current = window.setInterval(runAlignment, 70)
    alignTimeoutRef.current = window.setTimeout(() => {
      clearInlineReplyAlignment()
    }, 650)
  }, [alignInlineReplyComposer, clearInlineReplyAlignment, isInlineReply])

  const scheduleFocusStabilization = useCallback(() => {
    if (!autoFocus) return

    clearFocusStabilization()

    let attempts = 0
    const runFocus = () => {
      attempts += 1
      const focused = focusComposerTextarea()
      if (isInlineReply) {
        scheduleInlineReplyAlignment()
      }

      const keyboardSnapshot = readMobileKeyboardSnapshot()
      if ((focused && keyboardSnapshot.keyboardOpen) || attempts >= 10) {
        clearFocusStabilization()
      }
    }

    runFocus()
    focusIntervalRef.current = window.setInterval(runFocus, 90)
    focusTimeoutRef.current = window.setTimeout(() => {
      clearFocusStabilization()
    }, 950)
  }, [autoFocus, clearFocusStabilization, focusComposerTextarea, isInlineReply, scheduleInlineReplyAlignment])

  const stopMobileComposerStabilization = useCallback(() => {
    clearFocusStabilization()
    if (isInlineReply) {
      clearInlineReplyAlignment()
    }
  }, [clearFocusStabilization, clearInlineReplyAlignment, isInlineReply])

  const releaseInlineReplyFocus = useCallback(() => {
    if (!isInlineReply) return
    stopMobileComposerStabilization()
    textareaRef.current?.blur()
    dismissMobileKeyboardTracking()
  }, [isInlineReply, stopMobileComposerStabilization])

  const submit = useCallback(async () => {
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(value.trim())
      setValue('')
      releaseInlineReplyFocus()
      onSuccess?.()
    } catch (err) {
      console.error('Unable to submit comment', err)
      setError('Unable to post your comment right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, onSubmit, onSuccess, releaseInlineReplyFocus, submitting, value])

  const handleCancel = useCallback(() => {
    releaseInlineReplyFocus()
    onCancel?.()
  }, [onCancel, releaseInlineReplyFocus])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      stopMobileComposerStabilization()
      await submit()
    },
    [stopMobileComposerStabilization, submit],
  )

  useEffect(() => {
    return () => {
      clearInlineReplyAlignment()
      clearFocusStabilization()
    }
  }, [clearFocusStabilization, clearInlineReplyAlignment])

  useEffect(() => {
    if (!autoFocus) return
    scheduleFocusStabilization()
  }, [autoFocus, scheduleFocusStabilization])

  useEffect(() => {
    if (!isInlineReply || !keyboardState.keyboardOpen) return
    if (document.activeElement !== textareaRef.current) return
    scheduleInlineReplyAlignment()
  }, [isInlineReply, keyboardState.keyboardOpen, keyboardState.viewportHeight, scheduleInlineReplyAlignment])

  return (
    <form
      ref={formRef}
      aria-label={ariaLabel}
      className={clsx(
        isInlineReply
          ? 'space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)]'
          : 'space-y-3 rounded-2xl border border-slate-200 bg-slate-50/85 p-3.5',
        className,
      )}
      onSubmit={handleSubmit}
    >
      <div>
        <textarea
          ref={textareaRef}
          data-inline-reply-id={composerId ?? undefined}
          value={value}
          onChange={(event) => {
            stopMobileComposerStabilization()
            setValue(event.target.value)
            if (error) setError(null)
          }}
          onFocus={() => {
            if (isInlineReply) {
              scheduleInlineReplyAlignment()
            }
          }}
          onBlur={() => {
            if (isInlineReply) {
              clearInlineReplyAlignment()
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder={placeholder}
          rows={isInlineReply ? 3 : 4}
          maxLength={MAX_COMMENT_LENGTH}
          className={clsx(
            'w-full border text-slate-900 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cc-primary)]',
            isInlineReply
              ? 'min-h-[104px] rounded-2xl border-slate-200 bg-white px-3.5 py-3 text-[15px] leading-6'
              : 'rounded-xl border-slate-200 bg-white px-4 py-3 text-sm leading-6',
          )}
        />
        <div className={clsx('mt-2 flex items-center gap-3 text-slate-400', isInlineReply ? 'justify-end text-[11px]' : 'justify-between text-xs')}>
          {isInlineReply ? null : <span>Ctrl/Cmd + Enter to post</span>}
          <span>
            {value.trim().length}/{MAX_COMMENT_LENGTH}
          </span>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className={clsx('flex flex-wrap items-center gap-3', isInlineReply && 'justify-end')}>
        {onCancel ? (
          <button
            type="button"
            onClick={handleCancel}
            onPointerDown={stopMobileComposerStabilization}
            disabled={submitting}
            className={clsx(
              isInlineReply
                ? 'inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 hover:text-slate-800'
                : 'text-sm font-semibold text-slate-500 hover:text-slate-700',
            )}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          onPointerDown={stopMobileComposerStabilization}
          disabled={!canSubmit || submitting}
          className={clsx(
            'inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-white transition',
            !canSubmit || submitting
              ? 'cursor-not-allowed bg-slate-300 opacity-60'
              : 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]',
          )}
        >
          {submitting ? 'Posting…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
