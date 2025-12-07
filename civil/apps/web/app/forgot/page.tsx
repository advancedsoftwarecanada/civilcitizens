"use client"
import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import { AuthScreen } from '../_components/AuthScreen'

type FieldErrors = Record<string, string[]>

type ForgotSuccessResponse = {
  token?: string
}

type ForgotErrorResponse = {
  error?: string | { fieldErrors?: FieldErrors }
  message?: string
}

export default function ForgotPasswordPage() {
  const [emailOrHandle, setEmailOrHandle] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const hasFieldError = (key: string) => Array.isArray(fieldErrors[key]) && fieldErrors[key].length > 0
  const firstFieldError = (key: string) => fieldErrors[key]?.[0] ?? null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatusMessage(null)
    setFormError(null)
    setFieldErrors({})

    const errors: FieldErrors = {}
    if (!emailOrHandle.trim() || emailOrHandle.trim().length < 3) {
      errors.emailOrHandle = ['Enter your email or handle']
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setFormError('Please fix the errors and try again')
      return
    }

    try {
      const response = await fetch(buildApiUrl('/auth/forgot'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailOrHandle: emailOrHandle.trim() }),
      })

      const { json, text: fallbackText } = await parseApiResponse<ForgotSuccessResponse & ForgotErrorResponse>(response)
      const data = (json ?? {}) as ForgotSuccessResponse & ForgotErrorResponse

      if (response.ok) {
        const message = data.token ? `Reset token (dev only): ${data.token}` : 'If that account exists, you will receive a reset link.'
        setStatusMessage(message)
        return
      }

      if (typeof data.error === 'object' && data.error?.fieldErrors) {
        setFieldErrors(data.error.fieldErrors)
        setFormError('Please fix the errors and try again')
        return
      }

      const looksLikeHtml = typeof fallbackText === 'string' && /<[^>]+>/.test(fallbackText)
      const sanitizedFallback = looksLikeHtml ? null : fallbackText?.trim()
      const statusFallback = response.status >= 500 ? `Service temporarily unavailable (${response.status}). Please try again.` : null
      const message =
        (typeof data.error === 'string' && data.error) || data.message || sanitizedFallback || statusFallback || 'Request failed'
      setStatusMessage(message)
      pushToast(message, 'error')
    } catch (error) {
      console.error('Forgot password request failed', error)
      pushToast('Unexpected error. Please try again.', 'error')
      setFormError('Unexpected error')
    }
  }

  const inputClass = hasFieldError('emailOrHandle')
    ? 'border-red-500 ring-2 ring-red-100'
    : 'border-slate-200 focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15'

  const footer = (
    <p>
      Remembered your password?{' '}
      <Link href="/login" className="font-semibold text-[var(--cc-primary)]">
        Return to login
      </Link>
    </p>
  )

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your email or Civil handle and we’ll send you a secure reset link."
      footer={footer}
      hideSidePanel
      useWallpaper
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block text-sm font-medium text-slate-700">
          Email or handle
          <input
            className={`mt-2 w-full rounded-2xl border px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 transition focus-visible:outline-none ${inputClass}`}
            placeholder="you@civil.ca or @handle"
            value={emailOrHandle}
            onChange={(event) => setEmailOrHandle(event.target.value)}
          />
          {hasFieldError('emailOrHandle') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('emailOrHandle')}</div> : null}
        </label>
        {formError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
        <button className="w-full rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-base font-semibold text-white transition hover:bg-[var(--cc-primary-700)]" type="submit">
          Send reset link
        </button>
      </form>
      {statusMessage ? <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{statusMessage}</div> : null}
    </AuthScreen>
  )
}
