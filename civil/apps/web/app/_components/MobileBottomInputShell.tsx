'use client'

import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [shellHeight, setShellHeight] = useState(72)

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

  useEffect(() => {
    if (!isMobileViewport || typeof window === 'undefined') return

    const shell = shellRef.current
    if (!shell) return

    const syncHeight = () => {
      const nextHeight = Math.max(60, Math.round(shell.getBoundingClientRect().height))
      setShellHeight((current) => (current === nextHeight ? current : nextHeight))
    }

    syncHeight()

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHeight) : null
    observer?.observe(shell)
    window.addEventListener('resize', syncHeight)
    window.addEventListener('orientationchange', syncHeight)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncHeight)
      window.removeEventListener('orientationchange', syncHeight)
    }
  }, [children, isMobileViewport])

  const anchoredStyle = useMemo<CSSProperties>(() => {
    if (!keyboardState.keyboardOpen) {
      return {
        bottom: 'var(--mobile-dock-active-clearance)',
      }
    }

    const top = Math.max(
      keyboardState.viewportOffsetTop,
      keyboardState.viewportOffsetTop + keyboardState.viewportHeight - shellHeight,
    )

    return {
      top: `${top}px`,
      bottom: 'auto',
    }
  }, [keyboardState.keyboardOpen, keyboardState.viewportHeight, keyboardState.viewportOffsetTop, shellHeight])

  if (!isMobileViewport || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={shellRef}
      className={clsx(
        'fixed inset-x-0 z-[85] border-t border-slate-200 bg-white/95 px-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] xl:hidden',
        className,
      )}
      style={{
        minHeight: '60px',
        paddingTop: '6px',
        paddingBottom: '6px',
        ...anchoredStyle,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
