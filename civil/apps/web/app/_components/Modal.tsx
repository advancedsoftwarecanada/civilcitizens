"use client"
import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  maxWidthClassName?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}

export default function Modal({
  open,
  onClose,
  children,
  title,
  maxWidthClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalProps) {
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const container = document.createElement('div')
    container.dataset.ccModalMount = 'true'
    document.body.appendChild(container)
    const scrollY = window.scrollY
    const documentElement = document.documentElement
    const previousHtmlOverflow = documentElement.style.overflow
    const previousOverflow = document.body.style.overflow
    const previousPosition = document.body.style.position
    const previousTop = document.body.style.top
    const previousLeft = document.body.style.left
    const previousRight = document.body.style.right
    const previousWidth = document.body.style.width
    const appRoot = document.getElementById('cc-app-root')
    const previousAppRootOverflow = appRoot?.style.overflow
    documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    if (appRoot) {
      appRoot.style.overflow = 'hidden'
    }
    setPortalEl(container)
    return () => {
      documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousOverflow
      document.body.style.position = previousPosition
      document.body.style.top = previousTop
      document.body.style.left = previousLeft
      document.body.style.right = previousRight
      document.body.style.width = previousWidth
      if (appRoot) {
        appRoot.style.overflow = previousAppRootOverflow ?? ''
      }
      container.remove()
      setPortalEl(null)
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeOnEscape, open, onClose])

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
  const safeAreaStyle = {
    paddingTop: 'max(1rem, env(safe-area-inset-top))',
    paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
  } as const
  const panelStyle = {
    maxHeight: 'calc(100dvh - max(1rem, env(safe-area-inset-top)) - max(1rem, env(safe-area-inset-bottom)) - 2rem)',
  } as const

  return createPortal(
    <div
      className="cc-safe-modal-overlay fixed inset-0 z-[130] overflow-hidden overscroll-none p-4 sm:p-6"
      onClick={closeOnBackdrop ? onClose : undefined}
      onClickCapture={onCaptureClick}
      data-cc-modal-root
      style={safeAreaStyle}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative flex h-[100dvh] items-center justify-center">
        <div
          className={`cc-safe-modal-panel relative flex w-full ${widthClass} min-h-0 flex-col overflow-hidden rounded-[20px] bg-white shadow-xl`}
          onClick={(e) => e.stopPropagation()}
          style={panelStyle}
        >
          {title ? (
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
              <div className="text-lg font-semibold">{title}</div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">
                ✕
              </button>
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        </div>
      </div>
    </div>,
    portalEl,
  )
}
