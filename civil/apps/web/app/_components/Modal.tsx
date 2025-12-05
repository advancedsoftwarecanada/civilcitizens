"use client"
import { ReactNode, useEffect } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  maxWidthClassName?: string
}

export default function Modal({ open, onClose, children, title, maxWidthClassName }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  // Intercept auth link clicks inside modal to avoid hard navigation
  const onCaptureClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const el = e.target as HTMLElement | null
    if (!el) return
    const anchor = el.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const rawHref = anchor.getAttribute('href') || ''
    const url = (() => { try { return new URL(rawHref, window.location.origin) } catch { return null } })()
    if (!url) return
    const allowed = new Set(['/login', '/register', '/forgot'])
    if (!allowed.has(url.pathname)) return
    e.preventDefault()
    e.stopPropagation()
    const openEvent = url.pathname === '/login' ? 'openLoginModal' : url.pathname === '/register' ? 'openRegisterModal' : 'openForgotModal'
    window.dispatchEvent(new CustomEvent(openEvent))
  }
  if (!open) return null
  const widthClass = maxWidthClassName ?? 'max-w-md'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose} onClickCapture={onCaptureClick} data-cc-modal-root>
      <div className="absolute inset-0 bg-black/50" />
      <div className={`relative w-full ${widthClass} mx-4 rounded-lg bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="text-lg font-semibold">{title}</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">✕</button>
        </div>
        <div className="p-5">
          {children}
        </div>
      </div>
    </div>
  )
}
