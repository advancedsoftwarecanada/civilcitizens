// @ts-nocheck
"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { pushToast } from '../_components/useToasts'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const hasErr = (k: string) => Array.isArray(fieldErrors[k]) && fieldErrors[k].length > 0
  const firstErr = (k: string) => (hasErr(k) ? fieldErrors[k][0] : null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    // Client-side validation
    const errs: Record<string, string[]> = {}
    const h = (handle || '').replace(/^@/, '').trim()
    if (!firstName) errs.firstName = ['First name is required']
    if (!lastName) errs.lastName = ['Last name is required']
    if (!h || h.length < 3 || h.length > 32 || !/^[A-Za-z0-9_]+$/.test(h)) errs.handle = ['Handle must be 3-32 chars, letters/numbers/_']
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = ['Enter a valid email']
    if (!password || password.length < 8) errs.password = ['Password must be at least 8 characters']
    if (!acceptTerms) errs.acceptTerms = ['You must accept the terms']
    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      setError('Please fix the errors and try again')
      return
    }
    try {
      const payload = { email, handle: handle.replace(/^@/, ''), firstName, lastName, password, acceptTerms }
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) {
        // Map Zod error format to field messages
        if (data?.error?.fieldErrors) {
          setFieldErrors(data.error.fieldErrors)
          setError('Please fix the errors and try again')
          return
        }
        const msg = typeof data?.error === 'string' ? data.error : 'Registration failed'
        setError(msg)
        return
      }
      localStorage.setItem('token', data.token)
      window.location.href = '/home'
    } catch (e: any) {
      pushToast('Unexpected error during registration. Please try again.', 'error')
      setError('Unexpected error')
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              className={`w-full rounded p-3 border ${hasErr('firstName') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`}
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            {hasErr('firstName') && (
              <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('firstName')}</div>
            )}
          </div>
          <div>
            <input
              className={`w-full rounded p-3 border ${hasErr('lastName') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`}
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
            {hasErr('lastName') && (
              <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('lastName')}</div>
            )}
          </div>
        </div>
        <div>
          <div className={`flex items-center gap-2 rounded p-0` }>
            <span className="text-gray-500">@</span>
            <input
              className={`flex-1 rounded p-3 border ${hasErr('handle') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`}
              placeholder="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          {hasErr('handle') && (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('handle')}</div>
          )}
        </div>
        <div>
          <input
            className={`w-full rounded p-3 border ${hasErr('email') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {hasErr('email') && (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('email')}</div>
          )}
        </div>
        <div>
          <input
            className={`w-full rounded p-3 border ${hasErr('password') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {hasErr('password') && (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('password')}</div>
          )}
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>
              I agree to the <a href="/terms" className="underline" target="_blank" rel="noopener noreferrer">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </span>
          </label>
          {hasErr('acceptTerms') && (
            <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('acceptTerms')}</div>
          )}
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="px-4 py-2 bg-black text-white rounded w-full" type="submit">Create account</button>
      </form>
      <div className="mt-4 text-sm">
        Already have an account? <button className="underline" type="button" onClick={() => {
          const inModal = !!document.querySelector('[data-cc-modal-root]')
          if (inModal) {
            if (window.location.pathname.startsWith('/register')) {
              router.back()
              setTimeout(() => window.dispatchEvent(new CustomEvent('openLoginModal')), 0)
            } else {
              window.dispatchEvent(new CustomEvent('openLoginModal'))
            }
          } else {
            window.location.replace('/login')
          }
        }}>Sign in</button>
      </div>
      <div className="mt-2 text-sm">
        <button className="underline" type="button" onClick={() => {
          const inModal = !!document.querySelector('[data-cc-modal-root]')
          if (inModal) {
            if (window.location.pathname.startsWith('/register')) {
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
  )
}
