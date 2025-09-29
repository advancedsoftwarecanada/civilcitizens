// @ts-nocheck
"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'
import { pushToast } from '../_components/useToasts'

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password. Please try again.',
}

export default function LoginPage() {
  const router = useRouter()
  const [emailOrHandle, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const hasErr = (k: string) => Array.isArray(fieldErrors[k]) && fieldErrors[k].length > 0
  const firstErr = (k: string) => (hasErr(k) ? fieldErrors[k][0] : null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
  setError(null)
  setFieldErrors({})
    // Basic client validation
    const errs: Record<string, string[]> = {}
    if (!emailOrHandle || emailOrHandle.length < 3) errs.emailOrHandle = ['Enter your email or handle']
    if (!password || password.length < 8) errs.password = ['Password must be at least 8 characters']
    if (Object.keys(errs).length) { setFieldErrors(errs); setError('Please fix the errors and try again'); return }
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrHandle, password }) })
      const data = await res.json()
      if (!res.ok) {
        const apiCode = typeof data?.error === 'string' ? data.error : null
        const resolvedMessage = apiCode && AUTH_ERROR_MESSAGES[apiCode] ? AUTH_ERROR_MESSAGES[apiCode] : typeof data?.message === 'string' ? data.message : null
        const finalMessage = resolvedMessage || (apiCode && AUTH_ERROR_MESSAGES[apiCode]) || 'Login failed. Please try again.'
        if (apiCode === 'invalid_credentials') {
          pushToast(AUTH_ERROR_MESSAGES.invalid_credentials, 'error')
        } else if (resolvedMessage) {
          pushToast(resolvedMessage, 'error')
        }
        setError(finalMessage)
        return
      }
      localStorage.setItem('token', data.token)
      window.location.href = '/home'
    } catch (e: any) {
      pushToast('Unexpected error logging in. Please try again.', 'error')
      setError('Unexpected error')
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <input className={`w-full rounded p-3 border ${hasErr('emailOrHandle') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`} placeholder="Email or handle" value={emailOrHandle} onChange={(e) => setId(e.target.value)} />
          {hasErr('emailOrHandle') && <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('emailOrHandle')}</div>}
        </div>
        <div>
          <input className={`w-full rounded p-3 border ${hasErr('password') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`} placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {hasErr('password') && <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('password')}</div>}
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="px-4 py-2 bg-black text-white rounded w-full" type="submit">Sign in</button>
      </form>
      <div className="mt-4 text-sm">
        New here? <button className="underline" type="button" onClick={() => {
          const inModal = !!document.querySelector('[data-cc-modal-root]')
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
        }}>Create an account</button>
        <div className="mt-2">
          <button className="underline" type="button" onClick={() => {
            const inModal = !!document.querySelector('[data-cc-modal-root]')
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
          }}>Forgot password?</button>
        </div>
      </div>
    </div>
  )
}
