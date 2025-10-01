"use client"
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'
import { pushToast } from '../_components/useToasts'
import { buildHandleBase } from '@civil/shared'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl, parseApiResponse } from '../_lib/api'

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

const triggerModalOrNavigate = (router: ReturnType<typeof useRouter>, modal: 'login' | 'forgot') => {
  const eventName = modal === 'login' ? 'openLoginModal' : 'openForgotModal'
  const inModal = Boolean(document.querySelector('[data-cc-modal-root]'))
  if (inModal) {
    if (window.location.pathname.startsWith('/register')) {
      router.back()
      setTimeout(() => window.dispatchEvent(new CustomEvent(eventName)), 0)
    } else {
      window.dispatchEvent(new CustomEvent(eventName))
    }
  } else {
    redirectToAuthModal(modal)
  }
}

export default function RegisterPage() {
  const router = useRouter()
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
      window.location.href = '/home'
    } catch (error) {
      console.error('Registration request failed', error)
      pushToast('Unexpected error during registration. Please try again.', 'error')
      setFormError('Unexpected error')
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              className={`w-full rounded border p-3 ${
                hasFieldError('firstName')
                  ? 'border-red-500 focus:ring-2 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-2 focus:ring-black/10'
              }`}
              placeholder="First name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
            {hasFieldError('firstName') ? (
              <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('firstName')}</div>
            ) : null}
          </div>
          <div>
            <input
              className={`w-full rounded border p-3 ${
                hasFieldError('lastName')
                  ? 'border-red-500 focus:ring-2 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-2 focus:ring-black/10'
              }`}
              placeholder="Last name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
            {hasFieldError('lastName') ? (
              <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('lastName')}</div>
            ) : null}
          </div>
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Your handle will be <span className="font-semibold text-gray-900">@{previewHandle}</span>. If someone already has it, we'll adjust it automatically.
        </div>
        <div>
          <input
            className={`w-full rounded border p-3 ${
              hasFieldError('email')
                ? 'border-red-500 focus:ring-2 focus:ring-red-500'
                : 'border-gray-300 focus:ring-2 focus:ring-black/10'
            }`}
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {hasFieldError('email') ? (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('email')}</div>
          ) : null}
        </div>
        <div>
          <input
            className={`w-full rounded border p-3 ${
              hasFieldError('password')
                ? 'border-red-500 focus:ring-2 focus:ring-red-500'
                : 'border-gray-300 focus:ring-2 focus:ring-black/10'
            }`}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {hasFieldError('password') ? (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('password')}</div>
          ) : null}
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(event) => setAcceptTerms(event.target.checked)}
            />
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
          {hasFieldError('acceptTerms') ? (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('acceptTerms')}</div>
          ) : null}
        </div>
        {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
        <button className="w-full rounded bg-black px-4 py-2 text-white" type="submit">
          Create account
        </button>
      </form>
      <div className="mt-4 text-sm">
        Already have an account?{' '}
  <button className="underline" type="button" onClick={() => triggerModalOrNavigate(router, 'login')}>
          Sign in
        </button>
      </div>
      <div className="mt-2 text-sm">
  <button className="underline" type="button" onClick={() => triggerModalOrNavigate(router, 'forgot')}>
          Forgot password?
        </button>
      </div>
    </div>
  )
}
