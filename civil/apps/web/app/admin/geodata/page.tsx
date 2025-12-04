'use client'

import { useEffect } from 'react'

export default function AdminGeodataRedirect() {
  useEffect(() => {
    window.location.replace('/admin')
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-500">
      Redirecting to the admin dashboard…
    </div>
  )
}
