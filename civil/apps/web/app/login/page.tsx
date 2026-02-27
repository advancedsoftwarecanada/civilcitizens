"use client"
import { Suspense, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import { AuthScreen } from '../_components/AuthScreen'

type LoginSuccess = {
  token: string
}

type LoginErrorResponse = {
  error?: string
  message?: string
}

const AUTH_ERROR_MESSAGES = {
  invalid_credentials: 'Incorrect email or password. Please try again.',
} as const satisfies Record<string, string>

const isKnownAuthError = (code: string): code is keyof typeof AUTH_ERROR_MESSAGES => code in AUTH_ERROR_MESSAGES

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextParam = searchParams.get('next')
  const safeNext = useMemo(() => {
    if (!nextParam) return null
    return nextParam.startsWith('/') ? nextParam : null
  }, [nextParam])
  const [emailOrHandle, setId] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const hasFieldError = (key: string) => Array.isArray(fieldErrors[key]) && fieldErrors[key].length > 0
  const firstFieldError = (key: string) => fieldErrors[key]?.[0] ?? null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const normalizedEmailOrHandle = emailOrHandle.trim().replace(/^@+/, '')

    const validationErrors: Record<string, string[]> = {}
    if (!normalizedEmailOrHandle || normalizedEmailOrHandle.length < 3) {
      validationErrors.emailOrHandle = ['Enter your email or handle']
    }
    if (!password || password.length < 8) {
      validationErrors.password = ['Password must be at least 8 characters']
    }

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setFormError('Please fix the errors and try again')
      return
    }

    try {
      const response = await fetch(buildApiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailOrHandle: normalizedEmailOrHandle, password }),
      })

      const { json, text: fallbackText } = await parseApiResponse<LoginSuccess & LoginErrorResponse>(response)
      const data: Partial<LoginSuccess & LoginErrorResponse> = json ?? {}

      if (!response.ok) {
        const apiCode = typeof data.error === 'string' ? data.error : null
        let resolvedMessage: string | null = null
        if (apiCode && isKnownAuthError(apiCode)) {
          resolvedMessage = AUTH_ERROR_MESSAGES[apiCode]
        }
        const messageFromApi = typeof data.message === 'string' ? data.message : null
        const looksLikeHtml = typeof fallbackText === 'string' && /<[^>]+>/.test(fallbackText)
        const sanitizedFallback = looksLikeHtml ? null : fallbackText?.trim()
        const statusFallback = response.status >= 500 ? `Service temporarily unavailable (${response.status}). Please try again.` : null
        const finalMessage =
          resolvedMessage ?? messageFromApi ?? sanitizedFallback ?? statusFallback ?? 'Login failed. Please try again.'

        if (apiCode === 'invalid_credentials') {
          pushToast(AUTH_ERROR_MESSAGES.invalid_credentials, 'error')
        } else {
          pushToast(finalMessage, 'error')
        }

        setFormError(finalMessage)
        return
      }

      if (typeof data.token === 'string') {
        localStorage.setItem('token', data.token)
      }
      const destination = safeNext ?? '/home'
      router.replace(destination)
    } catch (error) {
      console.error('Login request failed', error)
      pushToast('Unexpected error logging in. Please try again.', 'error')
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
        New to Civil?{' '}
        <Link href="/register" className="font-semibold text-[var(--cc-primary)]">
          Create an account
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
    <AuthScreen title="Welcome back" subtitle="Sign in to post, follow, and coordinate inside your city." footer={footer} hideSidePanel useWallpaper>
      <form onSubmit={handleSubmit} className="space-y-5" autoCapitalize="none" autoCorrect="off" spellCheck={false}>
        <label className="block text-sm font-medium text-slate-700">
          Email or handle
          <input className={`${inputClass('emailOrHandle')} mt-2`} placeholder="you@civil.ca or @handle" value={emailOrHandle} onChange={(event) => setId(event.target.value)} />
          {hasFieldError('emailOrHandle') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('emailOrHandle')}</div> : null}
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input className={`${inputClass('password')} mt-2`} placeholder="Enter your password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {hasFieldError('password') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('password')}</div> : null}
        </label>
        {formError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
        <button className="w-full rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-base font-semibold text-white transition hover:bg-[var(--cc-primary-700)]" type="submit">
          Sign in
        </button>
      </form>
    </AuthScreen>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[var(--cc-page-bg)] text-slate-500">Loading…</div>}>
      <LoginPageInner />
    </Suspense>
  )
}
