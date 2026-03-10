'use client'

import { useEffect } from 'react'

function sanitizePlaceholder(element: HTMLInputElement | HTMLTextAreaElement) {
  const placeholder = element.getAttribute('placeholder')?.trim()
  if (!placeholder) return

  const hasAccessibleName =
    element.hasAttribute('aria-label') ||
    element.hasAttribute('aria-labelledby') ||
    Boolean(element.labels?.length) ||
    Boolean(element.getAttribute('title')?.trim())

  if (!hasAccessibleName) {
    element.setAttribute('aria-label', placeholder)
  }

  element.removeAttribute('placeholder')
}

function sanitizePlaceholders(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]').forEach((element) => {
    sanitizePlaceholder(element)
  })
}

export default function PlaceholderSanitizer() {
  useEffect(() => {
    if (typeof document === 'undefined') return

    sanitizePlaceholders(document)

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return
            if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
              sanitizePlaceholder(node)
            }
            sanitizePlaceholders(node)
          })
          return
        }

        if (mutation.type === 'attributes') {
          const target = mutation.target
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            sanitizePlaceholder(target)
          }
        }
      })
    })

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['placeholder'],
    })

    return () => observer.disconnect()
  }, [])

  return null
}