'use client'

import { useEffect } from 'react'

type CapacitorKeyboardPlugin = {
  setAccessoryBarVisible?: (options: { isVisible: boolean }) => Promise<void>
}

type CapacitorBridge = {
  getPlatform?: () => string
  Plugins?: {
    Keyboard?: CapacitorKeyboardPlugin
  }
}

function getCapacitorBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  if (!candidate || typeof candidate !== 'object') return null
  return candidate
}

export default function NativeKeyboardUi() {
  useEffect(() => {
    const bridge = getCapacitorBridge()
    if (!bridge || typeof bridge.getPlatform !== 'function') return
    if (bridge.getPlatform() !== 'ios') return

    const keyboard = bridge.Plugins?.Keyboard
    if (!keyboard || typeof keyboard.setAccessoryBarVisible !== 'function') return

    keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {
      // Ignore if the native plugin is not ready yet or unavailable in web.
    })
  }, [])

  return null
}