'use client'

const PROMPT_COMPLETED_COOKIE = 'cc_ios_pwa_push_prompt_completed'
const PROMPT_DEFER_UNTIL_COOKIE = 'cc_ios_pwa_push_prompt_defer_until'
const PROMPT_PENDING_NEXT_OPEN_STORAGE_KEY = 'cc:iosPwaPushPrompt:pendingNextOpenAt'
const WELCOME_SEEN_STORAGE_KEY = 'cc:iosPwaPushPrompt:welcomeSeen'
const WELCOME_LEFT_STORAGE_KEY = 'cc:iosPwaPushPrompt:welcomeLeft'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const COMPLETED_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const pairs = document.cookie ? document.cookie.split(';') : []
  for (const rawPair of pairs) {
    const pair = rawPair.trim()
    if (!pair) continue
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const key = pair.slice(0, separator)
    if (key !== name) continue
    return decodeURIComponent(pair.slice(separator + 1))
  }
  return null
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
}

export function markIosPwaPushPromptCompleted(): void {
  writeCookie(PROMPT_COMPLETED_COOKIE, '1', COMPLETED_MAX_AGE_SECONDS)
}

export function clearIosPwaPushPromptCompleted(): void {
  clearCookie(PROMPT_COMPLETED_COOKIE)
}

export function isIosPwaPushPromptCompleted(): boolean {
  return readCookie(PROMPT_COMPLETED_COOKIE) === '1'
}

export function deferIosPwaPushPromptForSevenDays(): void {
  const deferUntil = Date.now() + SEVEN_DAYS_MS
  writeCookie(PROMPT_DEFER_UNTIL_COOKIE, String(deferUntil), Math.ceil(SEVEN_DAYS_MS / 1000))
}

export function clearIosPwaPushPromptDeferral(): void {
  clearCookie(PROMPT_DEFER_UNTIL_COOKIE)
}

export function isIosPwaPushPromptDeferred(): boolean {
  const raw = readCookie(PROMPT_DEFER_UNTIL_COOKIE)
  if (!raw) return false
  const value = Number(raw)
  return Number.isFinite(value) && value > Date.now()
}

export function markIosPwaWelcomeSeen(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, '1')
}

export function hasIosPwaWelcomeBeenSeen(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) === '1'
}

export function markIosPwaWelcomeLeft(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(WELCOME_LEFT_STORAGE_KEY, '1')
}

export function hasIosPwaWelcomeBeenLeft(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(WELCOME_LEFT_STORAGE_KEY) === '1'
}

export function markIosPwaPushPromptPendingNextOpen(atMs = Date.now()): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROMPT_PENDING_NEXT_OPEN_STORAGE_KEY, String(atMs))
}

export function getIosPwaPushPromptPendingNextOpenAt(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(PROMPT_PENDING_NEXT_OPEN_STORAGE_KEY)
  if (!raw) return null
  if (raw === '1') return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function clearIosPwaPushPromptPendingNextOpen(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(PROMPT_PENDING_NEXT_OPEN_STORAGE_KEY)
}

export function resetIosPwaPushPromptForNextOpen(): void {
  clearIosPwaPushPromptCompleted()
  clearIosPwaPushPromptDeferral()
  markIosPwaPushPromptPendingNextOpen()
}
