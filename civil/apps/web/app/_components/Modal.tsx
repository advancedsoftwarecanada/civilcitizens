"use client"
import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  maxWidthClassName?: string
}

export default function Modal({ open, onClose, children, title, maxWidthClassName }: ModalProps) {
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const container = document.createElement('div')
    container.dataset.ccModalMount = 'true'
    document.body.appendChild(container)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setPortalEl(container)
    return () => {
      document.body.style.overflow = previousOverflow
      container.remove()
      setPortalEl(null)
    }
  }, [open])

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
  if (!open || !portalEl) return null
  const widthClass = maxWidthClassName ?? 'max-w-md'

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      onClick={onClose}
      onClickCapture={onCaptureClick}
      data-cc-modal-root
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative flex min-h-full items-start justify-center p-4 sm:p-6">
        <div
          className={`relative w-full ${widthClass} rounded-lg bg-white shadow-xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {title ? (
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
              <div className="text-lg font-semibold">{title}</div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">
                ✕
              </button>
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      </div>
    </div>,
    portalEl,
  )
}
