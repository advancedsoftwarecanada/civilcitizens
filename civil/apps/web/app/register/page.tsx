"use client"
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { pushToast } from '../_components/useToasts'
import { buildHandleBase } from '@civil/shared'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import { AuthScreen } from '../_components/AuthScreen'

type FieldErrors = Record<string, string[]>

type RegisterSuccess = {
  token: string
}

type RegisterErrorResponse = {
  error?:
    | string
    | {
        fieldErrors?: FieldErrors
      }
  message?: string
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const previewHandle = useMemo(() => buildHandleBase(firstName, lastName), [firstName, lastName])

  const hasFieldError = (key: string) => Array.isArray(fieldErrors[key]) && fieldErrors[key].length > 0
  const firstFieldError = (key: string) => fieldErrors[key]?.[0] ?? null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const validationErrors: FieldErrors = {}

    if (!firstName.trim()) validationErrors.firstName = ['First name is required']
    if (!lastName.trim()) validationErrors.lastName = ['Last name is required']
    if (!email || !isValidEmail(email)) validationErrors.email = ['Enter a valid email']
    if (!password || password.length < 8) validationErrors.password = ['Password must be at least 8 characters']
    if (!acceptTerms) validationErrors.acceptTerms = ['You must accept the terms']

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setFormError('Please fix the errors and try again')
      return
    }

    try {
      const payload = {
        email,
        firstName,
        lastName,
        password,
        acceptTerms,
      }

      const response = await fetch(buildApiUrl('/auth/register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const { json: data, text: fallbackText } = await parseApiResponse<RegisterSuccess & RegisterErrorResponse>(response)
      const safeData: Partial<RegisterSuccess & RegisterErrorResponse> = data ?? {}

      if (!response.ok) {
        const fieldErrorPayload = typeof safeData.error === 'object' && safeData.error && 'fieldErrors' in safeData.error ? safeData.error.fieldErrors : null
        if (fieldErrorPayload && typeof fieldErrorPayload === 'object') {
          setFieldErrors(fieldErrorPayload as FieldErrors)
          setFormError('Please fix the errors and try again')
          return
        }

        const looksLikeHtml = typeof fallbackText === 'string' && /<[^>]+>/.test(fallbackText)
        const sanitizedFallback = looksLikeHtml ? null : fallbackText?.trim()
        const statusFallback = response.status >= 500 ? `Service temporarily unavailable (${response.status}). Please try again.` : null
        const message =
          (typeof safeData.error === 'string' && safeData.error) ||
          (typeof safeData.message === 'string' && safeData.message) ||
          sanitizedFallback ||
          statusFallback ||
          'Registration failed'
        setFormError(message)
        pushToast(message, 'error')
        return
      }

      if (safeData && 'token' in safeData && typeof safeData.token === 'string') {
        localStorage.setItem('token', safeData.token)
      }
      window.location.href = '/welcome'
    } catch (error) {
      console.error('Registration request failed', error)
      pushToast('Unexpected error during registration. Please try again.', 'error')
      setFormError('Unexpected error')
    }
  }

  const inputClass = (key: string) =>
    `w-full rounded-2xl border px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 transition focus-visible:outline-none ${
      hasFieldError(key)
        ? 'border-red-500 ring-2 ring-red-100'
        : 'border-slate-200 focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15'
    }`

  const footer = (
    <div className="space-y-2">
      <p>
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-[var(--cc-primary)]">
          Sign in
        </Link>
      </p>
      <p>
        Forgot password?{' '}
        <Link href="/forgot" className="font-semibold text-[var(--cc-primary)]">
          Reset it here
        </Link>
      </p>
    </div>
  )

  return (
      <AuthScreen
        title="Create your Civil account"
        subtitle="Reserve your handle, pick your home city, and get access to Canada’s civic operating system."
      footer={footer}
      hideSidePanel
      useWallpaper
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            First name
            <input className={`${inputClass('firstName')} mt-2`} placeholder="Jane" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            {hasFieldError('firstName') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('firstName')}</div> : null}
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Last name
            <input className={`${inputClass('lastName')} mt-2`} placeholder="Citizen" value={lastName} onChange={(event) => setLastName(event.target.value)} />
            {hasFieldError('lastName') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('lastName')}</div> : null}
          </label>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Your Civil handle will be <span className="font-semibold text-slate-900">@{previewHandle}</span>. If it&apos;s taken, we&apos;ll make a tiny tweak to keep it unique.
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input className={`${inputClass('email')} mt-2`} placeholder="you@civil.ca" value={email} onChange={(event) => setEmail(event.target.value)} />
          {hasFieldError('email') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('email')}</div> : null}
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input className={`${inputClass('password')} mt-2`} placeholder="At least 8 characters" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {hasFieldError('password') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('password')}</div> : null}
        </label>
        <label className="flex items-start gap-3 text-sm text-slate-600">
          <input type="checkbox" className="mt-1" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
          <span>
            I agree to the{' '}
            <a href="/terms" className="underline" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" className="underline" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
          </span>
        </label>
        {hasFieldError('acceptTerms') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('acceptTerms')}</div> : null}
        {formError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
        <button className="w-full rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-base font-semibold text-white transition hover:bg-[var(--cc-primary-700)]" type="submit">
          Create account
        </button>
      </form>
    </AuthScreen>
  )
}
