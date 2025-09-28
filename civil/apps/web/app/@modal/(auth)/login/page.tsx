"use client"
import { useRouter } from 'next/navigation'
import Login from '../../../login/page'

export default function LoginModal() {
  const router = useRouter()
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => router.back()}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Sign in</h2>
          <button className="text-gray-500" onClick={() => router.back()} aria-label="Close">✕</button>
        </div>
        <Login />
      </div>
    </div>
  )
}
