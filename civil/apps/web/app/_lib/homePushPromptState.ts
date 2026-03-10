'use client'

const HOME_NATIVE_PUSH_PROMPT_KEY = 'cc:homePushPromptAttempted:native'
const HOME_WEB_PUSH_PROMPT_KEY = 'cc:homePushPromptAttempted:web'

function readFlag(key: string): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(key) === '1'
}

function writeFlag(key: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, '1')
}

function clearFlag(key: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
}

export function hasAttemptedHomeNativePushPrompt(): boolean {
  return readFlag(HOME_NATIVE_PUSH_PROMPT_KEY)
}

export function markHomeNativePushPromptAttempted(): void {
  writeFlag(HOME_NATIVE_PUSH_PROMPT_KEY)
}

export function hasAttemptedHomeWebPushPrompt(): boolean {
  return readFlag(HOME_WEB_PUSH_PROMPT_KEY)
}

export function markHomeWebPushPromptAttempted(): void {
  writeFlag(HOME_WEB_PUSH_PROMPT_KEY)
}

export function resetHomeNativePushPromptAttempt(): void {
  clearFlag(HOME_NATIVE_PUSH_PROMPT_KEY)
}

export function resetHomeWebPushPromptAttempt(): void {
  clearFlag(HOME_WEB_PUSH_PROMPT_KEY)
}

export function resetAllHomePushPromptAttempts(): void {
  resetHomeNativePushPromptAttempt()
  resetHomeWebPushPromptAttempt()
}