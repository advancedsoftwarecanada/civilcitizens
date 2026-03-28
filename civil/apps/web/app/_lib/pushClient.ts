'use client'

import { buildApiUrl, parseApiResponse } from './api'
import { endpointHostFromValue, writeWebPushDebugState } from './webPushDebug'

type PushEnableStatus =
  | 'enabled'
  | 'already-enabled'
  | 'unsupported'
  | 'ios_install_required'
  | 'permission-denied'
  | 'permission-dismissed'
  | 'unauthorized'
  | 'invalid-vapid-key'
  | 'subscription-failed'
  | 'server-error'

type PushDisableStatus = 'disabled' | 'not-enabled' | 'unsupported' | 'unauthorized' | 'server-error'
type PushSyncStatus = 'synced' | 'already-synced' | 'missing-registration' | 'missing-subscription' | 'unsupported' | 'unauthorized' | 'permission-not-granted' | 'server-error'

export type PushEnableResult = {
  ok: boolean
  status: PushEnableStatus
  message?: string
}

export type PushDisableResult = {
  ok: boolean
  status: PushDisableStatus
  message?: string
}

export type PushSyncResult = {
  ok: boolean
  status: PushSyncStatus
  message?: string
}

let cachedVapidPublicKey: string | null = null
let enablePushInFlight: Promise<PushEnableResult> | null = null
let syncExistingPushInFlight: Promise<PushSyncResult> | null = null

const PUSH_SYNC_SIGNATURE_STORAGE_KEY = 'cc:webPushSyncSignature'

function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const token = window.localStorage.getItem('token')
    return token && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

function logPush(event: string, detail?: Record<string, unknown>): void {
  console.info(`[web-push] ${event}`, detail ?? {})
}

function getStoredSyncSignature(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(PUSH_SYNC_SIGNATURE_STORAGE_KEY)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function setStoredSyncSignature(value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PUSH_SYNC_SIGNATURE_STORAGE_KEY, value)
  } catch {
    // Ignore storage write failures.
  }
}

function clearStoredSyncSignature(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PUSH_SYNC_SIGNATURE_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '')
}

function isIosInstalledPwaMode(): boolean {
  if (typeof window === 'undefined') return false
  const navStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const mediaStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  return navStandalone || mediaStandalone
}

function detectPlatform(): 'android' | 'ios' | 'desktop' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = (navigator.userAgent || '').toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios'
  if (ua.includes('windows') || ua.includes('macintosh') || ua.includes('linux') || ua.includes('x11') || ua.includes('cros')) return 'desktop'
  return 'unknown'
}

function detectBrowser(): 'chrome' | 'edge' | 'safari' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = (navigator.userAgent || '').toLowerCase()
  if (ua.includes('edg/')) return 'edge'
  if ((ua.includes('chrome/') || ua.includes('crios/')) && !ua.includes('edg/')) return 'chrome'
  if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('crios/') && !ua.includes('edg/')) return 'safari'
  return 'unknown'
}

function getSupportErrorMessage(): string | null {
  if (typeof window === 'undefined') return 'Push is unavailable during server render.'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'This browser does not support web push notifications.'
  }
  if (isIosDevice() && !isIosInstalledPwaMode()) {
    return 'On iOS, install the app to your home screen before enabling notifications.'
  }
  return null
}

function recordDebug(source: string, result: string, options?: {
  error?: string | null
  hasExistingSubscription?: boolean | null
  endpoint?: string | null
}): void {
  writeWebPushDebugState({
    source,
    result,
    error: options?.error ?? null,
    hasExistingSubscription: options?.hasExistingSubscription ?? null,
    endpointHost: endpointHostFromValue(options?.endpoint),
    canEnable: getSupportErrorMessage() === null,
    supportError: getSupportErrorMessage(),
  })
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('service_worker_unsupported')
  }

  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing

  const registered = await navigator.serviceWorker.register('/sw.js')
  const ready = await navigator.serviceWorker.ready
  return ready || registered
}

async function getExistingServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const existing = await navigator.serviceWorker.getRegistration('/')
  return existing ?? null
}

async function fetchVapidPublicKey(authToken: string): Promise<string> {
  if (cachedVapidPublicKey) return cachedVapidPublicKey

  const response = await fetch(buildApiUrl('/push/public-key'), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${authToken}`,
    },
  })

  const { json } = await parseApiResponse<{ publicKey?: string; error?: string }>(response)
  if (!response.ok) {
    throw new Error(json?.error || 'failed_to_load_vapid_public_key')
  }

  const publicKey = typeof json?.publicKey === 'string' ? json.publicKey.trim() : ''
  if (!publicKey) {
    throw new Error('missing_vapid_public_key')
  }

  cachedVapidPublicKey = publicKey
  return publicKey
}

function subscriptionToPayload(subscription: PushSubscription): {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
} {
  const json = subscription.toJSON()
  const endpoint = typeof json.endpoint === 'string' ? json.endpoint.trim() : subscription.endpoint
  const p256dh = typeof json.keys?.p256dh === 'string' ? json.keys.p256dh : ''
  const auth = typeof json.keys?.auth === 'string' ? json.keys.auth : ''

  return {
    endpoint,
    expirationTime: typeof json.expirationTime === 'number' ? json.expirationTime : null,
    keys: { p256dh, auth },
  }
}

function buildSubscriptionSyncSignature(
  payload: ReturnType<typeof subscriptionToPayload>,
  authToken: string,
): string {
  return JSON.stringify({
    endpoint: payload.endpoint,
    p256dh: payload.keys.p256dh,
    auth: payload.keys.auth,
    authTokenFingerprint: authToken.slice(-16),
  })
}

async function syncSubscriptionToServerIfNeeded(
  subscription: PushSubscription,
  authToken: string,
  options: {
    source: string
    syncedResult: string
    force?: boolean
  },
): Promise<'synced' | 'already-synced'> {
  const payload = subscriptionToPayload(subscription)
  const nextSignature = buildSubscriptionSyncSignature(payload, authToken)
  const previousSignature = getStoredSyncSignature()
  const changed = previousSignature !== nextSignature

  logPush('backend_sync_check', {
    source: options.source,
    changed,
    endpointHost: endpointHostFromValue(payload.endpoint),
  })

  if (!changed && !options.force) {
    recordDebug(options.source, 'subscription_sync_skipped_unchanged', {
      hasExistingSubscription: true,
      endpoint: payload.endpoint,
    })
    return 'already-synced'
  }

  logPush('backend_sync_start', {
    source: options.source,
    endpointHost: endpointHostFromValue(payload.endpoint),
  })
  await sendSubscriptionToServer(subscription, authToken)
  setStoredSyncSignature(nextSignature)
  recordDebug(options.source, options.syncedResult, {
    hasExistingSubscription: true,
    endpoint: payload.endpoint,
  })
  logPush('backend_sync_success', {
    source: options.source,
    endpointHost: endpointHostFromValue(payload.endpoint),
  })
  return 'synced'
}

async function sendSubscriptionToServer(subscription: PushSubscription, authToken: string): Promise<void> {
  const payload = subscriptionToPayload(subscription)
  const response = await fetch(buildApiUrl('/push/subscribe'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      subscription: payload,
      meta: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        platform: detectPlatform(),
        browser: detectBrowser(),
      },
    }),
  })

  if (!response.ok) {
    const { json, text } = await parseApiResponse<{ error?: string }>(response)
    throw new Error(json?.error || text || 'push_subscribe_failed')
  }
}

async function sendUnsubscribeToServer(endpoint: string, authToken: string): Promise<void> {
  const response = await fetch(buildApiUrl('/push/unsubscribe'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ endpoint }),
  })

  if (!response.ok) {
    const { json, text } = await parseApiResponse<{ error?: string }>(response)
    throw new Error(json?.error || text || 'push_unsubscribe_failed')
  }
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function canEnablePush(): boolean {
  return getSupportErrorMessage() === null
}

export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function isPushEnabled(): Promise<boolean> {
  if (!canEnablePush()) return false
  try {
    const registration = await getExistingServiceWorkerRegistration()
    if (!registration) return false
    const subscription = await registration.pushManager.getSubscription()
    recordDebug('isPushEnabled', subscription ? 'subscription_present' : 'subscription_missing', {
      hasExistingSubscription: Boolean(subscription),
      endpoint: subscription?.endpoint ?? null,
    })
    return Boolean(subscription)
  } catch {
    recordDebug('isPushEnabled', 'subscription_check_failed', { error: 'subscription_check_failed' })
    return false
  }
}

async function performEnablePush(): Promise<PushEnableResult> {
  const supportError = getSupportErrorMessage()
  if (supportError) {
    recordDebug('enablePush', 'skipped_support_error', { error: supportError })
    return {
      ok: false,
      status: isIosDevice() && !isIosInstalledPwaMode() ? 'ios_install_required' : 'unsupported',
      message: supportError,
    }
  }

  const authToken = getStoredAuthToken()
  if (!authToken) {
    recordDebug('enablePush', 'skipped_no_auth_token', { error: 'no_auth_token' })
    return { ok: false, status: 'unauthorized', message: 'Sign in before enabling notifications.' }
  }

  const existingRegistration = await getExistingServiceWorkerRegistration()
  const existingSubscriptionBeforePrompt = existingRegistration
    ? await existingRegistration.pushManager.getSubscription()
    : null

  logPush('enable_start', {
    permission: Notification.permission,
    hasExistingSubscription: Boolean(existingSubscriptionBeforePrompt),
  })

  if (existingSubscriptionBeforePrompt && Notification.permission === 'granted') {
    const syncStatus = await syncSubscriptionToServerIfNeeded(existingSubscriptionBeforePrompt, authToken, {
      source: 'enablePush',
      syncedResult: 'existing_subscription_synced',
    })
    return { ok: true, status: 'already-enabled', message: syncStatus === 'synced' ? 'Notifications enabled.' : undefined }
  }

  if (Notification.permission === 'denied') {
    recordDebug('enablePush', 'skipped_permission_denied', { error: 'permission_denied' })
    return {
      ok: false,
      status: 'permission-denied',
      message: 'Notifications are blocked in browser settings.',
    }
  }

  let permission: NotificationPermission = Notification.permission
  if (permission !== 'granted') {
    logPush('permission_request', { source: 'enablePush', permission })
    permission = await Notification.requestPermission()
    if (permission === 'denied') {
      recordDebug('enablePush', 'permission_denied_after_prompt', { error: 'permission_denied' })
      return {
        ok: false,
        status: 'permission-denied',
        message: 'Notifications permission was denied.',
      }
    }
    if (permission !== 'granted') {
      recordDebug('enablePush', 'permission_not_granted', { error: permission })
      return {
        ok: false,
        status: 'permission-dismissed',
        message: 'Notifications permission was not granted.',
      }
    }
  }

  let registration: ServiceWorkerRegistration | null = null
  try {
    registration = await getServiceWorkerRegistration()
    const existing = await registration.pushManager.getSubscription()
    if (existing) {
      const syncStatus = await syncSubscriptionToServerIfNeeded(existing, authToken, {
        source: 'enablePush',
        syncedResult: 'existing_subscription_synced',
      })
      return { ok: true, status: 'already-enabled', message: syncStatus === 'synced' ? 'Notifications enabled.' : undefined }
    }

    const publicKey = await fetchVapidPublicKey(authToken)
    const applicationServerKey = urlBase64ToUint8Array(publicKey)

    let subscription: PushSubscription
    try {
      logPush('subscribe_called', { source: 'enablePush' })
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const recoveredSubscription = await registration.pushManager.getSubscription().catch(() => null)
      if (recoveredSubscription && Notification.permission === 'granted') {
        await syncSubscriptionToServerIfNeeded(recoveredSubscription, authToken, {
          source: 'enablePush',
          syncedResult: 'existing_subscription_synced',
        })
        return { ok: true, status: 'already-enabled', message: 'Notifications already enabled.' }
      }
      if (/applicationserverkey|vapid|invalid/i.test(errorMessage)) {
        recordDebug('enablePush', 'invalid_vapid_key', { error: errorMessage })
        return {
          ok: false,
          status: 'invalid-vapid-key',
          message: 'The VAPID public key is invalid or not accepted by the browser.',
        }
      }
      recordDebug('enablePush', 'subscription_failed', { error: errorMessage })
      return {
        ok: false,
        status: 'subscription-failed',
        message: 'The browser could not create a push subscription.',
      }
    }

    await syncSubscriptionToServerIfNeeded(subscription, authToken, {
      source: 'enablePush',
      syncedResult: 'new_subscription_synced',
    })
    return { ok: true, status: 'enabled' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'push_enable_failed'
    recordDebug('enablePush', 'server_error', { error: message })
    if (message.includes('unauthorized')) {
      return { ok: false, status: 'unauthorized', message: 'Sign in before enabling notifications.' }
    }
    if (
      message.includes('push_not_configured') ||
      message.includes('failed_to_load_vapid_public_key') ||
      message.includes('missing_vapid_public_key')
    ) {
      return {
        ok: false,
        status: 'server-error',
        message: 'Push notifications are not configured on this server yet. Please try again later.',
      }
    }
    return { ok: false, status: 'server-error', message }
  }
}

export async function enablePush(): Promise<PushEnableResult> {
  if (enablePushInFlight) return enablePushInFlight
  enablePushInFlight = performEnablePush().finally(() => {
    enablePushInFlight = null
  })
  return enablePushInFlight
}

async function performSyncExistingPushSubscription(): Promise<PushSyncResult> {
  const supportError = getSupportErrorMessage()
  if (supportError) {
    recordDebug('syncExistingPushSubscription', 'skipped_support_error', { error: supportError })
    return { ok: false, status: 'unsupported', message: supportError }
  }

  const authToken = getStoredAuthToken()
  if (!authToken) {
    recordDebug('syncExistingPushSubscription', 'skipped_no_auth_token', { error: 'no_auth_token' })
    return { ok: false, status: 'unauthorized', message: 'Sign in before syncing notifications.' }
  }

  const permission = getPermissionState()
  logPush('sync_existing_start', { permission })
  if (permission !== 'granted') {
    recordDebug('syncExistingPushSubscription', 'skipped_permission_not_granted', { error: String(permission) })
    return { ok: false, status: 'permission-not-granted', message: 'Notifications permission is not granted.' }
  }

  try {
    const registration = await getExistingServiceWorkerRegistration()
    if (!registration) {
      recordDebug('syncExistingPushSubscription', 'skipped_missing_registration', { hasExistingSubscription: false })
      return { ok: true, status: 'missing-registration' }
    }

    const subscription = await registration.pushManager.getSubscription()
    logPush('existing_subscription_check', {
      source: 'syncExistingPushSubscription',
      hasExistingSubscription: Boolean(subscription),
    })
    if (!subscription) {
      recordDebug('syncExistingPushSubscription', 'skipped_no_existing_subscription', { hasExistingSubscription: false })
      return { ok: true, status: 'missing-subscription' }
    }

    const syncStatus = await syncSubscriptionToServerIfNeeded(subscription, authToken, {
      source: 'syncExistingPushSubscription',
      syncedResult: 'existing_subscription_synced',
    })
    return {
      ok: true,
      status: syncStatus === 'synced' ? 'synced' : 'already-synced',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'push_sync_failed'
    recordDebug('syncExistingPushSubscription', 'server_error', { error: message })
    return { ok: false, status: 'server-error', message }
  }
}

export async function syncExistingPushSubscription(): Promise<PushSyncResult> {
  if (syncExistingPushInFlight) return syncExistingPushInFlight
  syncExistingPushInFlight = performSyncExistingPushSubscription().finally(() => {
    syncExistingPushInFlight = null
  })
  return syncExistingPushInFlight
}

export async function disablePush(): Promise<PushDisableResult> {
  const supportError = getSupportErrorMessage()
  if (supportError) return { ok: false, status: 'unsupported', message: supportError }

  const authToken = getStoredAuthToken()
  if (!authToken) return { ok: false, status: 'unauthorized', message: 'Sign in before disabling notifications.' }

  try {
    const registration = await getExistingServiceWorkerRegistration()
    if (!registration) {
      clearStoredSyncSignature()
      return { ok: true, status: 'not-enabled' }
    }
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      clearStoredSyncSignature()
      return { ok: true, status: 'not-enabled' }
    }

    const endpoint = subscription.endpoint
    logPush('unsubscribe_called', { endpointHost: endpointHostFromValue(endpoint) })
    await subscription.unsubscribe().catch(() => undefined)
    await sendUnsubscribeToServer(endpoint, authToken)
    clearStoredSyncSignature()

    return { ok: true, status: 'disabled' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'push_disable_failed'
    if (message.includes('unauthorized')) {
      return { ok: false, status: 'unauthorized', message: 'Sign in before disabling notifications.' }
    }
    return { ok: false, status: 'server-error', message }
  }
}
