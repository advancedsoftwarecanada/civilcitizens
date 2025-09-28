"use client"
import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [emailOrHandle, setId] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    const res = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrHandle }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setStatus(data.token ? `Reset token (dev only): ${data.token}` : 'If that account exists, you will receive a reset link.')
    else setStatus('Request failed')
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <form onSubmit={onSubmit} className="space-y-4">
        <input className="w-full border rounded p-3" placeholder="Email or handle" value={emailOrHandle} onChange={(e) => setId(e.target.value)} />
        <button className="px-4 py-2 bg-black text-white rounded w-full" type="submit">Send reset link</button>
      </form>
      {status && <div className="mt-4 text-sm">{status}</div>}
    </div>
  )
}
