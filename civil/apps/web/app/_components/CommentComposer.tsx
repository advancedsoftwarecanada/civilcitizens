"use client"

import { useCallback, useState } from 'react'
import clsx from 'clsx'

const MAX_COMMENT_LENGTH = 5000

type CommentComposerProps = {
  onSubmit: (body: string) => Promise<void>
  className?: string
  placeholder?: string
  submitLabel?: string
  autoFocus?: boolean
  onCancel?: () => void
  onSuccess?: () => void
}

export default function CommentComposer({
  onSubmit,
  className,
  placeholder = 'Share your thoughts…',
  submitLabel = 'Comment',
  autoFocus = false,
  onCancel,
  onSuccess,
}: CommentComposerProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = value.trim().length > 0 && value.trim().length <= MAX_COMMENT_LENGTH

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
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
    },
    [canSubmit, onSubmit, onSuccess, submitting, value],
  )

  return (
    <form className={clsx('space-y-3', className)} onSubmit={handleSubmit}>
      <div>
        <textarea
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          placeholder={placeholder}
          rows={4}
          maxLength={MAX_COMMENT_LENGTH}
          autoFocus={autoFocus}
          className="w-full border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cc-primary)]"
        />
        <div className="mt-1 text-right text-xs text-gray-400">
          {value.trim().length}/{MAX_COMMENT_LENGTH}
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className={clsx(
            'inline-flex items-center bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition',
            !canSubmit || submitting ? 'cursor-not-allowed opacity-60' : 'hover:bg-[var(--cc-primary-700)]',
          )}
        >
          {submitting ? 'Posting…' : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-sm font-semibold text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  )
}
