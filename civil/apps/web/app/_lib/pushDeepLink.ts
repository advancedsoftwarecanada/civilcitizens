'use client'

export function normalizePushDeepLinkUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/')) return trimmed

  if (/^[a-zA-Z0-9_-]+(\/|\?|#|$)/.test(trimmed)) {
    return `/${trimmed}`
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const relative = `${url.pathname}${url.search}${url.hash}`
      return relative.startsWith('/') ? relative : null
    } catch {
      return null
    }
  }

  return null
}
