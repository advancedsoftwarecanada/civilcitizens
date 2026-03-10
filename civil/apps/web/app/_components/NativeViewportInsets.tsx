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

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLInputElement) {
    const nonTextTypes = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])
    return !nonTextTypes.has(element.type)
  }
  return false
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
        root.style.removeProperty('--cc-keyboard-inset')
        root.classList.remove('cc-keyboard-open')
        return
      }

      const viewportOffsetTop = viewport?.offsetTop ?? 0
      const runtimeTopInset = Math.max(0, viewportOffsetTop)
      const bottomOverlap = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop)
      const keyboardLikelyOpen = bottomOverlap > 120 && isEditableElement(document.activeElement)
      const keyboardInset = keyboardLikelyOpen ? bottomOverlap : 0
      const runtimeBottomInset = keyboardLikelyOpen ? 0 : bottomOverlap

      root.style.setProperty('--cc-runtime-top-inset', `${Math.round(runtimeTopInset)}px`)
      root.style.setProperty('--cc-runtime-bottom-inset', `${Math.round(runtimeBottomInset)}px`)
      root.style.setProperty('--cc-keyboard-inset', `${Math.round(keyboardInset)}px`)
      root.classList.toggle('cc-keyboard-open', keyboardInset > 0)
    }

    syncViewportMetrics()

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncViewportMetrics)
    viewport?.addEventListener('scroll', syncViewportMetrics)
    window.addEventListener('resize', syncViewportMetrics)
    window.addEventListener('orientationchange', syncViewportMetrics)
    window.addEventListener('focusin', syncViewportMetrics)
    window.addEventListener('focusout', syncViewportMetrics)

    return () => {
      viewport?.removeEventListener('resize', syncViewportMetrics)
      viewport?.removeEventListener('scroll', syncViewportMetrics)
      window.removeEventListener('resize', syncViewportMetrics)
      window.removeEventListener('orientationchange', syncViewportMetrics)
      window.removeEventListener('focusin', syncViewportMetrics)
      window.removeEventListener('focusout', syncViewportMetrics)
    }
  }, [])

  return null
}