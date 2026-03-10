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

    const syncViewportMetrics = () => {
      const viewport = window.visualViewport
      const viewportHeight = viewport?.height ?? window.innerHeight
      root.style.setProperty('--cc-viewport-height', `${Math.round(viewportHeight)}px`)

      const bridge = getCapacitorBridge()
      const platform = typeof bridge?.getPlatform === 'function' ? bridge.getPlatform() : null
      if (!platform) {
        root.style.removeProperty('--cc-runtime-top-inset')
        root.style.removeProperty('--cc-runtime-bottom-inset')
        return
      }

      const viewportOffsetTop = viewport?.offsetTop ?? 0
      const runtimeTopInset = Math.max(0, viewportOffsetTop)
      const runtimeBottomInset = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop)

      root.style.setProperty('--cc-runtime-top-inset', `${Math.round(runtimeTopInset)}px`)
      root.style.setProperty('--cc-runtime-bottom-inset', `${Math.round(runtimeBottomInset)}px`)
    }

    syncViewportMetrics()

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncViewportMetrics)
    viewport?.addEventListener('scroll', syncViewportMetrics)
    window.addEventListener('resize', syncViewportMetrics)
    window.addEventListener('orientationchange', syncViewportMetrics)

    return () => {
      viewport?.removeEventListener('resize', syncViewportMetrics)
      viewport?.removeEventListener('scroll', syncViewportMetrics)
      window.removeEventListener('resize', syncViewportMetrics)
      window.removeEventListener('orientationchange', syncViewportMetrics)
    }
  }, [])

  return null
}