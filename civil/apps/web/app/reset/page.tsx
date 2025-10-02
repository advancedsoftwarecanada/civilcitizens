"use client"
import { useEffect, useState } from 'react'

export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    const t = url.searchParams.get('token')
    if (t) setToken(t)
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    const res = await fetch('/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, newPassword }) })
    if (res.ok) { setStatus('Password reset. You can now sign in.'); setNewPassword('') }
    else setStatus('Reset failed')
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold mb-6">Reset password</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input className="w-full border rounded p-3" placeholder="Reset token" value={token} onChange={(e) => setToken(e.target.value)} />
        <input className="w-full border rounded p-3" placeholder="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
  <button className="w-full rounded bg-[var(--cc-primary)] px-4 py-2 text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400" type="submit" disabled={!token || newPassword.length < 8}>Set new password</button>
      </form>
      {status && <div className="mt-4 text-sm">{status}</div>}
    </div>
  )
}
