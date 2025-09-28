// @ts-nocheck
"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const payload = { email, handle: handle.replace(/^@/, ''), firstName, lastName, password, acceptTerms }
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
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
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <input className="w-full border rounded p-3" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input className="w-full border rounded p-3" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">@</span>
          <input className="flex-1 border rounded p-3" placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
        </div>
        <input className="w-full border rounded p-3" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border rounded p-3" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
          <span>I agree to the Terms of Service and Privacy Policy</span>
        </label>
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
