'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { useMobileKeyboardState } from '../_lib/mobileKeyboard'

const MOBILE_BREAKPOINT_QUERY = '(max-width: 1023px)'

type MobileBottomInputShellProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export default function MobileBottomInputShell({
  children,
  className,
  style,
}: MobileBottomInputShellProps) {
  const keyboardState = useMobileKeyboardState()
  const [isMobileViewport, setIsMobileViewport] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport)
    } else {
      mediaQuery.addListener(syncViewport)
    }

    window.addEventListener('resize', syncViewport)
    window.addEventListener('orientationchange', syncViewport)

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncViewport)
      } else {
        mediaQuery.removeListener(syncViewport)
      }
      window.removeEventListener('resize', syncViewport)
      window.removeEventListener('orientationchange', syncViewport)
    }
  }, [])

  if (!isMobileViewport || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={clsx(
        'fixed inset-x-0 z-[85] border-t border-slate-200 bg-white/95 px-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] xl:hidden',
        className,
      )}
      style={{
        bottom: keyboardState.keyboardOpen ? 'var(--cc-keyboard-inset)' : 'var(--mobile-dock-active-clearance)',
        minHeight: '60px',
        paddingTop: '6px',
        paddingBottom: '6px',
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
