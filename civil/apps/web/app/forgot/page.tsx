"use client"
import { useState } from 'react'
import type { FormEvent } from 'react'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../_lib/api'

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

  return (
    <div className="mx-auto max-w-md p-8">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            className={`w-full rounded border p-3 ${
              hasFieldError('emailOrHandle')
                ? 'border-red-500 focus:ring-2 focus:ring-red-500'
                : 'border-gray-300 focus:ring-2 focus:ring-black/10'
            }`}
            placeholder="Email or handle"
            value={emailOrHandle}
            onChange={(event) => setEmailOrHandle(event.target.value)}
          />
          {hasFieldError('emailOrHandle') ? (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('emailOrHandle')}</div>
          ) : null}
        </div>
        {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
        <button className="w-full rounded bg-black px-4 py-2 text-white" type="submit">
          Send reset link
        </button>
      </form>
      {statusMessage ? <div className="mt-4 text-sm">{statusMessage}</div> : null}
    </div>
  )
}
