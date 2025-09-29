// @ts-nocheck
"use client"
import { useState } from 'react'
import { pushToast } from '../_components/useToasts'

export default function ForgotPasswordPage() {
  const [emailOrHandle, setId] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const hasErr = (k: string) => Array.isArray(fieldErrors[k]) && fieldErrors[k].length > 0
  const firstErr = (k: string) => (hasErr(k) ? fieldErrors[k][0] : null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    setError(null)
    setFieldErrors({})
    const errs: Record<string, string[]> = {}
    if (!emailOrHandle || emailOrHandle.length < 3) errs.emailOrHandle = ['Enter your email or handle']
    if (Object.keys(errs).length) { setFieldErrors(errs); setError('Please fix the errors and try again'); return }
    try {
      const res = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrHandle }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setStatus(data.token ? `Reset token (dev only): ${data.token}` : 'If that account exists, you will receive a reset link.')
      else setStatus('Request failed')
    } catch (e) {
      pushToast('Unexpected error. Please try again.', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <input className={`w-full rounded p-3 border ${hasErr('emailOrHandle') ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-black/10'}`} placeholder="Email or handle" value={emailOrHandle} onChange={(e) => setId(e.target.value)} />
          {hasErr('emailOrHandle') && <div className="mt-1 text-xs text-red-600">⚠️ {firstErr('emailOrHandle')}</div>}
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="px-4 py-2 bg-black text-white rounded w-full" type="submit">Send reset link</button>
      </form>
      {status && <div className="mt-4 text-sm">{status}</div>}
    </div>
  )
}
