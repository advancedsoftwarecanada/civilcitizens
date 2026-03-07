'use client'

import { isAndroidNativeApp, isAppleNativeApp } from './nativePush'

type NavigatorWithStandalone = Navigator & { standalone?: boolean }
export const IOS_PWA_INSTALL_ROUTE = '/install/ios/pwa'
export const IOS_SWITCH_TO_SAFARI_ROUTE = '/install/ios/switch-to-safari'
export const ANDROID_PWA_INSTALL_ROUTE = '/install/android/pwa'

export function isAppleMobileOrTablet(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const touchPoints = navigator.maxTouchPoints || 0

  const iosUserAgent = /iPhone|iPad|iPod/i.test(ua)
  const ipadOsDesktopUserAgent = platform === 'MacIntel' && touchPoints > 1

  return iosUserAgent || ipadOsDesktopUserAgent
}

export function isInstalledPwaDisplayMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const navStandalone = Boolean((navigator as NavigatorWithStandalone).standalone)
  const standaloneDisplay = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  const fullscreenDisplay = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: fullscreen)').matches
  return navStandalone || standaloneDisplay || fullscreenDisplay
}

export function isIosSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = (navigator.userAgent || '').toLowerCase()
  const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIos) return false

  const isExcluded = /crios|fxios|edgios|opios|duckduckgo|mercury|gsa|yaapp|yabrowser/.test(ua)
  const looksSafari = /safari/.test(ua) && /applewebkit/.test(ua)
  return looksSafari && !isExcluded
}

export function isAndroidMobileOrTablet(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = (navigator.userAgent || '').toLowerCase()
  return ua.includes('android')
}

export function shouldBlockForAppleInstall(): boolean {
  if (!isAppleMobileOrTablet()) return false
  if (isAppleNativeApp()) return false
  if (isInstalledPwaDisplayMode()) return false
  return true
}

export function shouldBlockForAndroidInstall(): boolean {
  if (!isAndroidMobileOrTablet()) return false
  if (isAndroidNativeApp()) return false
  if (isInstalledPwaDisplayMode()) return false
  return true
}

export function isIosInstalledPwaContext(): boolean {
  if (!isAppleMobileOrTablet()) return false
  if (isAppleNativeApp()) return false
  return isInstalledPwaDisplayMode()
}

export function isAndroidInstalledPwaContext(): boolean {
  if (!isAndroidMobileOrTablet()) return false
  if (isAndroidNativeApp()) return true
  return isInstalledPwaDisplayMode()
}

export function normalizeRelativePath(value: string | null | undefined, fallback = '/login'): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || !trimmed.startsWith('/')) return fallback
  if (trimmed.startsWith('//')) return fallback
  return trimmed
}

export function buildIosPwaInstallUrl(nextPath: string, source?: string): string {
  return buildIosInstallUrl(IOS_PWA_INSTALL_ROUTE, nextPath, source)
}

export function buildIosSwitchToSafariUrl(nextPath: string, source?: string): string {
  return buildIosInstallUrl(IOS_SWITCH_TO_SAFARI_ROUTE, nextPath, source)
}

export function buildAndroidPwaInstallUrl(nextPath: string, source?: string): string {
  return buildIosInstallUrl(ANDROID_PWA_INSTALL_ROUTE, nextPath, source)
}

function buildIosInstallUrl(route: string, nextPath: string, source?: string): string {
  const params = new URLSearchParams()
  params.set('next', normalizeRelativePath(nextPath, '/login'))
  if (typeof source === 'string' && source.trim()) params.set('source', source.trim())
  return `${route}?${params.toString()}`
}

export function buildIosInstallEntryUrl(nextPath: string, source?: string): string {
  if (isIosSafariBrowser()) return buildIosPwaInstallUrl(nextPath, source)
  return buildIosSwitchToSafariUrl(nextPath, source)
}

export function buildPwaInstallEntryUrl(nextPath: string, source?: string): string | null {
  if (shouldBlockForAppleInstall()) return buildIosInstallEntryUrl(nextPath, source)
  if (shouldBlockForAndroidInstall()) return buildAndroidPwaInstallUrl(nextPath, source)
  return null
}
