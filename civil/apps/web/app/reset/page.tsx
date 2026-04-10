"use client"

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import AppleInstallRedirect from '../_components/AppleInstallRedirect'
import { AuthScreen } from '../_components/AuthScreen'
import { buildApiUrl, parseApiResponse } from '../_lib/api'

type ResetResponse = {
  error?: string
  message?: string
}

type FieldErrors = Record<string, string[]>

export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const url = new URL(window.location.href)
    const resetToken = url.searchParams.get('token')
    if (resetToken) setToken(resetToken)
  }, [])

  const hasFieldError = (key: string) => Array.isArray(fieldErrors[key]) && fieldErrors[key].length > 0
  const firstFieldError = (key: string) => fieldErrors[key]?.[0] ?? null

  const inputClass = (key: string) =>
    `mt-2 w-full rounded-2xl border px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 transition focus-visible:outline-none ${
      hasFieldError(key)
        ? 'border-red-500 ring-2 ring-red-100'
        : 'border-slate-200 focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15'
    }`

  const footer = useMemo(
    () => (
      <p>
        Ready to sign in?{' '}
        <Link href="/login" className="font-semibold text-[var(--cc-primary)]">
          Return to login
        </Link>
      </p>
    ),
    [],
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setStatus(null)
    setFormError(null)
    setFieldErrors({})

    const errors: FieldErrors = {}
    if (!token.trim()) errors.token = ['Enter your reset token']
    if (!newPassword || newPassword.length < 8) errors.newPassword = ['Password must be at least 8 characters']

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setFormError('Please fix the errors and try again')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/auth/reset'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), newPassword }),
      })

      const { json, text: fallbackText } = await parseApiResponse<ResetResponse>(response)
      const data = json ?? {}

      if (!response.ok) {
        const looksLikeHtml = typeof fallbackText === 'string' && /<[^>]+>/.test(fallbackText)
        const sanitizedFallback = looksLikeHtml ? null : fallbackText?.trim()
        const statusFallback = response.status >= 500 ? `Service temporarily unavailable (${response.status}). Please try again.` : null
        const message =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.message === 'string' && data.message) ||
          sanitizedFallback ||
          statusFallback ||
          'Reset failed'
        setFormError(message)
        return
      }

      setStatus('Password reset. You can now sign in to MapleRides.')
      setNewPassword('')
    } catch (error) {
      console.error('Reset password request failed', error)
      setFormError('Unexpected error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <AppleInstallRedirect source="reset" />
      <AuthScreen
        title="Set a new password"
        subtitle="Choose a new password for your MapleRides account. If you opened a reset link, your token may already be filled in."
        footer={footer}
        hideSidePanel
      >
        <form onSubmit={onSubmit} className="space-y-5" autoCapitalize="none" autoCorrect="off" spellCheck={false}>
          <label className="block text-sm font-medium text-slate-700">
            Reset token
            <input className={inputClass('token')} value={token} onChange={(event) => setToken(event.target.value)} />
            {hasFieldError('token') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('token')}</div> : null}
          </label>
          <label className="block text-sm font-medium text-slate-700">
            New password
            <input
              className={inputClass('newPassword')}
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {hasFieldError('newPassword') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('newPassword')}</div> : null}
          </label>
          {formError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
          <button
            className="w-full rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-base font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating password…' : 'Set new password'}
          </button>
        </form>
        {status ? <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div> : null}
      </AuthScreen>
    </>
  )
}
