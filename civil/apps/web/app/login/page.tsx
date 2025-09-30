"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'
import { pushToast } from '../_components/useToasts'

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

export default function LoginPage() {
  const router = useRouter()
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

    const validationErrors: Record<string, string[]> = {}
    if (!emailOrHandle || emailOrHandle.trim().length < 3) {
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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailOrHandle, password }),
      })

      const data = (await response.json()) as LoginSuccess & LoginErrorResponse

      if (!response.ok) {
        const apiCode = typeof data.error === 'string' ? data.error : null
        let resolvedMessage: string | null = null
        if (apiCode && isKnownAuthError(apiCode)) {
          resolvedMessage = AUTH_ERROR_MESSAGES[apiCode]
        }
        const messageFromApi = typeof data.message === 'string' ? data.message : null
        const finalMessage = resolvedMessage ?? messageFromApi ?? 'Login failed. Please try again.'

        if (apiCode === 'invalid_credentials') {
          pushToast(AUTH_ERROR_MESSAGES.invalid_credentials, 'error')
        } else if (resolvedMessage || messageFromApi) {
          pushToast(finalMessage, 'error')
        }

        setFormError(finalMessage)
        return
      }

      localStorage.setItem('token', data.token)
      window.location.href = '/home'
    } catch (error) {
      console.error('Login request failed', error)
      pushToast('Unexpected error logging in. Please try again.', 'error')
      setFormError('Unexpected error')
    }
  }

  const triggerRegister = () => {
    const inModal = Boolean(document.querySelector('[data-cc-modal-root]'))
    if (inModal) {
      if (window.location.pathname.startsWith('/login')) {
        router.back()
        setTimeout(() => window.dispatchEvent(new CustomEvent('openRegisterModal')), 0)
      } else {
        window.dispatchEvent(new CustomEvent('openRegisterModal'))
      }
    } else {
      window.location.replace('/register')
    }
  }

  const triggerForgot = () => {
    const inModal = Boolean(document.querySelector('[data-cc-modal-root]'))
    if (inModal) {
      if (window.location.pathname.startsWith('/login')) {
        router.back()
        setTimeout(() => window.dispatchEvent(new CustomEvent('openForgotModal')), 0)
      } else {
        window.dispatchEvent(new CustomEvent('openForgotModal'))
      }
    } else {
      window.location.replace('/forgot')
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
            onChange={(event) => setId(event.target.value)}
          />
          {hasFieldError('emailOrHandle') ? (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('emailOrHandle')}</div>
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
        {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
        <button className="w-full rounded bg-black px-4 py-2 text-white" type="submit">
          Sign in
        </button>
      </form>
      <div className="mt-4 text-sm">
        New here?{' '}
        <button className="underline" type="button" onClick={triggerRegister}>
          Create an account
        </button>
        <div className="mt-2">
          <button className="underline" type="button" onClick={triggerForgot}>
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  )
}
