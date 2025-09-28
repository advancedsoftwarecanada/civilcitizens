// @ts-nocheck
"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
  const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, handle, name, password }) })
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
      <h1 className="text-2xl font-bold mb-6">Create your account</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input className="w-full border rounded p-3" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border rounded p-3" placeholder="Handle (no @)" value={handle} onChange={(e) => setHandle(e.target.value)} />
        <input className="w-full border rounded p-3" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full border rounded p-3" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
