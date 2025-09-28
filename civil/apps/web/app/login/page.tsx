// @ts-nocheck
"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'

export default function LoginPage() {
  const router = useRouter()
  const [emailOrHandle, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrHandle, password }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed')
      localStorage.setItem('token', data.token)
      window.location.href = '/home'
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold mb-6">Sign in to Civil</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input className="w-full border rounded p-3" placeholder="Email or handle" value={emailOrHandle} onChange={(e) => setId(e.target.value)} />
        <input className="w-full border rounded p-3" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
