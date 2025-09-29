"use client"
import { useEffect } from 'react'
import { useToasts } from './useToasts'

export default function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  // Simple fade-in/out via Tailwind classes
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center">
      <div className="flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              'pointer-events-auto rounded-md px-4 py-2 shadow-md text-sm text-white ' +
              (t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : t.type === 'warning' ? 'bg-yellow-600' : 'bg-gray-800')
            }
            role="status"
            aria-live="polite"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
