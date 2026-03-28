"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useMobileKeyboardState } from '../_lib/mobileKeyboard'

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
}: CommentComposerProps) {
  const keyboardState = useMobileKeyboardState()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInlineReply = variant === 'inline-reply'
  const formRef = useRef<HTMLFormElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const canSubmit = value.trim().length > 0 && value.trim().length <= MAX_COMMENT_LENGTH

  const scrollInlineReplyIntoView = useCallback((mode: 'nearest' | 'center' = 'nearest') => {
    if (!isInlineReply) return
    const target = formRef.current
    if (!target) return

    const appRoot = document.getElementById('cc-app-root')
    const runScroll = () => {
      if (mode === 'center' && appRoot) {
        const targetRect = target.getBoundingClientRect()
        const viewportHeight = keyboardState.viewportHeight || window.visualViewport?.height || window.innerHeight
        const targetHeight = Math.min(targetRect.height, Math.max(1, viewportHeight - 32))
        const desiredCenter = viewportHeight / 2
        const currentCenter = targetRect.top + targetHeight / 2
        const delta = currentCenter - desiredCenter
        if (Math.abs(delta) < 4) return
        const maxScrollTop = Math.max(0, appRoot.scrollHeight - appRoot.clientHeight)
        const nextScrollTop = Math.max(0, Math.min(maxScrollTop, appRoot.scrollTop + delta))
        appRoot.scrollTo({ top: nextScrollTop, behavior: 'auto' })
        return
      }
      target.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }

    window.requestAnimationFrame(runScroll)
    window.setTimeout(runScroll, 80)
  }, [isInlineReply, keyboardState.viewportHeight])

  const submit = useCallback(async () => {
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(value.trim())
      setValue('')
      onSuccess?.()
    } catch (err) {
      console.error('Unable to submit comment', err)
      setError('Unable to post your comment right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, onSubmit, onSuccess, submitting, value])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      await submit()
    },
    [submit],
  )

  useEffect(() => {
    if (!isInlineReply) return

    const viewport = window.visualViewport
    const handleViewportChange = () => {
      if (document.activeElement === textareaRef.current) {
        scrollInlineReplyIntoView(keyboardState.keyboardOpen ? 'center' : 'nearest')
      }
    }

    viewport?.addEventListener('resize', handleViewportChange)
    viewport?.addEventListener('scroll', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)

    return () => {
      viewport?.removeEventListener('resize', handleViewportChange)
      viewport?.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [isInlineReply, keyboardState.keyboardOpen, scrollInlineReplyIntoView])

  useEffect(() => {
    if (!isInlineReply || !autoFocus) return
    scrollInlineReplyIntoView()
  }, [autoFocus, isInlineReply, scrollInlineReplyIntoView])

  useEffect(() => {
    if (!isInlineReply || !keyboardState.keyboardOpen) return
    if (document.activeElement !== textareaRef.current) return
    scrollInlineReplyIntoView('center')
  }, [isInlineReply, keyboardState.keyboardOpen, keyboardState.viewportHeight, scrollInlineReplyIntoView])

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
      style={
        isInlineReply
          ? {
              scrollMarginTop: 'calc(var(--cc-native-safe-top-offset) + 0.75rem)',
              scrollMarginBottom: 'calc(max(1rem, var(--safe-area-bottom)) + var(--cc-keyboard-inset) + 2.5rem)',
            }
          : undefined
      }
      onSubmit={handleSubmit}
    >
      <div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          onFocus={() => {
            scrollInlineReplyIntoView(keyboardState.keyboardOpen ? 'center' : 'nearest')
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
          autoFocus={autoFocus}
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
            onClick={onCancel}
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
