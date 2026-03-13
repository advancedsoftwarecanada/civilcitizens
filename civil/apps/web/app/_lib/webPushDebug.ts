'use client'

export type WebPushDebugState = {
  updatedAt: number
  source: string
  platformContext: 'ios-pwa' | 'android-pwa' | 'other'
  permission: NotificationPermission | 'unsupported'
  hasAuthToken: boolean
  canEnable: boolean
  supportError: string | null
  result: string
  error: string | null
  hasExistingSubscription: boolean | null
  endpointHost: string | null
  currentPath: string
  visibilityState: DocumentVisibilityState | 'unknown'
}

const WEB_PUSH_DEBUG_STORAGE_KEY = 'cc:webPushDebugState'

function readCurrentPath(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function detectPlatformContext(): WebPushDebugState['platformContext'] {
  if (typeof navigator === 'undefined') return 'other'
  const ua = (navigator.userAgent || '').toLowerCase()
  const isStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    || (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  if (!isStandalone) return 'other'
  if (ua.includes('android')) return 'android-pwa'
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios-pwa'
  }
  return 'other'
}

export function readWebPushDebugState(): WebPushDebugState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(WEB_PUSH_DEBUG_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as WebPushDebugState
  } catch {
    return null
  }
}

export function clearWebPushDebugState(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(WEB_PUSH_DEBUG_STORAGE_KEY)
}

export function writeWebPushDebugState(partial: Partial<WebPushDebugState> & Pick<WebPushDebugState, 'source' | 'result'>): WebPushDebugState | null {
  if (typeof window === 'undefined') return null
  const previous = readWebPushDebugState()
  const next: WebPushDebugState = {
    updatedAt: Date.now(),
    source: partial.source,
    platformContext: partial.platformContext ?? previous?.platformContext ?? detectPlatformContext(),
    permission: partial.permission ?? previous?.permission ?? (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    hasAuthToken: partial.hasAuthToken ?? previous?.hasAuthToken ?? Boolean(window.localStorage.getItem('token')),
    canEnable: partial.canEnable ?? previous?.canEnable ?? false,
    supportError: partial.supportError ?? previous?.supportError ?? null,
    result: partial.result,
    error: partial.error ?? null,
    hasExistingSubscription: partial.hasExistingSubscription ?? previous?.hasExistingSubscription ?? null,
    endpointHost: partial.endpointHost ?? previous?.endpointHost ?? null,
    currentPath: partial.currentPath ?? readCurrentPath(),
    visibilityState: partial.visibilityState ?? (typeof document === 'undefined' ? 'unknown' : document.visibilityState),
  }

  try {
    window.localStorage.setItem(WEB_PUSH_DEBUG_STORAGE_KEY, JSON.stringify(next))
  } catch {
    return null
  }

  return next
}

export function endpointHostFromValue(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  try {
    return new URL(trimmed).host || null
  } catch {
    return null
  }
}