'use client'

import { useEffect } from 'react'

type CapacitorBridge = {
  getPlatform?: () => string
}

function getCapacitorBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  return candidate ?? null
}

export default function NativeViewportInsets() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const root = document.documentElement

    const syncInsets = () => {
      const bridge = getCapacitorBridge()
      const platform = typeof bridge?.getPlatform === 'function' ? bridge.getPlatform() : null
      if (!platform) {
        root.style.removeProperty('--cc-runtime-top-inset')
        root.style.removeProperty('--cc-runtime-bottom-inset')
        return
      }

      const viewport = window.visualViewport
      const viewportHeight = viewport?.height ?? window.innerHeight
      const viewportOffsetTop = viewport?.offsetTop ?? 0
      const runtimeTopInset = Math.max(0, viewportOffsetTop)
      const runtimeBottomInset = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop)

      root.style.setProperty('--cc-runtime-top-inset', `${Math.round(runtimeTopInset)}px`)
      root.style.setProperty('--cc-runtime-bottom-inset', `${Math.round(runtimeBottomInset)}px`)
    }

    syncInsets()

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncInsets)
    viewport?.addEventListener('scroll', syncInsets)
    window.addEventListener('resize', syncInsets)
    window.addEventListener('orientationchange', syncInsets)

    return () => {
      viewport?.removeEventListener('resize', syncInsets)
      viewport?.removeEventListener('scroll', syncInsets)
      window.removeEventListener('resize', syncInsets)
      window.removeEventListener('orientationchange', syncInsets)
    }
  }, [])

  return null
}