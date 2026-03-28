'use client'

import { useEffect } from 'react'
import { useMobileKeyboardState } from '../_lib/mobileKeyboard'

type CapacitorBridge = {
  getPlatform?: () => string
}

function getCapacitorBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  return candidate ?? null
}

export default function NativeViewportInsets() {
  const keyboardState = useMobileKeyboardState()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    const effectiveViewportHeight = keyboardState.keyboardOpen
      ? keyboardState.viewportHeight
      : Math.max(keyboardState.layoutViewportHeight, keyboardState.viewportHeight)

    root.style.setProperty('--cc-viewport-height', `${effectiveViewportHeight}px`)
    root.style.setProperty('--cc-keyboard-inset', `${keyboardState.keyboardHeight}px`)
    root.classList.toggle('cc-keyboard-open', keyboardState.keyboardOpen)

    const bridge = getCapacitorBridge()
    const platform = typeof bridge?.getPlatform === 'function' ? bridge.getPlatform() : null
    if (!platform) {
      root.style.removeProperty('--cc-runtime-top-inset')
      root.style.removeProperty('--cc-runtime-bottom-inset')
      return
    }

    root.style.setProperty('--cc-runtime-top-inset', `${keyboardState.viewportOffsetTop}px`)
    root.style.setProperty('--cc-runtime-bottom-inset', `${keyboardState.keyboardOpen ? 0 : keyboardState.bottomOverlap}px`)
  }, [
    keyboardState.bottomOverlap,
    keyboardState.keyboardHeight,
    keyboardState.keyboardOpen,
    keyboardState.layoutViewportHeight,
    keyboardState.viewportHeight,
    keyboardState.viewportOffsetTop,
  ])

  return null
}
