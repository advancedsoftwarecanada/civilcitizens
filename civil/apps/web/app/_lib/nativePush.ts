export type PushPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

type CapacitorPushPermissions = { receive?: string }

type CapacitorListenerHandle = { remove: () => void | Promise<void> }

type CapacitorPushRegistrationEvent = { value?: string }

type CivilPushDeviceTokenResult = { value?: string }

type CivilPushPermissionsResult = { receive?: string }

export type CivilPushLastNotificationTapResult = {
  url?: string
  urlPath?: string
  path?: string
  threadId?: string
  threadID?: string
  channelId?: string
  conversationId?: string
  urlAt?: number | null
}

type CivilPushDebugInfo = {
  token?: string
  tokenLength?: number
  tokenAt?: number | null
  error?: string
  errorAt?: number | null
}

type CivilPushPlugin = {
  getDeviceToken?: () => Promise<CivilPushDeviceTokenResult>
  getRegistrationDebugInfo?: () => Promise<CivilPushDebugInfo>
  getLastNotificationTap?: () => Promise<CivilPushLastNotificationTapResult>
  clearLastNotificationTap?: () => Promise<void>
  requestPushPermissions?: () => Promise<CivilPushPermissionsResult>
  registerForRemoteNotifications?: () => Promise<void>
}

type CapacitorPushPlugin = {
  checkPermissions?: () => Promise<CapacitorPushPermissions>
  requestPermissions?: () => Promise<CapacitorPushPermissions>
  register?: () => Promise<void>
  addListener?: (eventName: string, listenerFunc: (event: any) => void) => CapacitorListenerHandle | Promise<CapacitorListenerHandle>
}

type CapacitorBridge = {
  getPlatform?: () => string
  Plugins?: {
    PushNotifications?: CapacitorPushPlugin
    CivilPush?: CivilPushPlugin
  }
}

function getCapacitorBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  if (!candidate || typeof candidate !== 'object') return null
  return candidate
}

export function isAppleNativeApp(): boolean {
  const bridge = getCapacitorBridge()
  if (!bridge || typeof bridge.getPlatform !== 'function') return false
  return bridge.getPlatform() === 'ios'
}

export function isAndroidNativeApp(): boolean {
  const bridge = getCapacitorBridge()
  if (!bridge || typeof bridge.getPlatform !== 'function') return false
  return bridge.getPlatform() === 'android'
}

export function isNativeApp(): boolean {
  return isAppleNativeApp() || isAndroidNativeApp()
}

export async function getLastNativeNotificationTapUrl(): Promise<string | null> {
  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'ios') return null

  const plugin = bridge.Plugins?.CivilPush
  if (!plugin || typeof plugin.getLastNotificationTap !== 'function') return null

  try {
    const result = await plugin.getLastNotificationTap()
    const urlCandidates = [result?.url, result?.urlPath, result?.path]
    for (const candidate of urlCandidates) {
      const normalized = typeof candidate === 'string' ? candidate.trim() : ''
      if (normalized) return normalized
    }

    const threadCandidate = [
      result?.threadId,
      result?.threadID,
      result?.channelId,
      result?.conversationId,
    ].find((value) => typeof value === 'string' && value.trim().length > 0)

    if (typeof threadCandidate === 'string') {
      return `/messages?thread=${encodeURIComponent(threadCandidate.trim())}`
    }

    return null
  } catch {
    return null
  }
}

export async function clearLastNativeNotificationTapUrl(): Promise<void> {
  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'ios') return

  const plugin = bridge.Plugins?.CivilPush
  if (!plugin || typeof plugin.clearLastNotificationTap !== 'function') return

  try {
    await plugin.clearLastNotificationTap()
  } catch {
    // ignore
  }
}

function normalizePermissionState(raw?: string): PushPermissionState {
  if (!raw) return 'unknown'
  const normalized = raw.toLowerCase()
  if (normalized === 'granted') return 'granted'
  if (normalized === 'denied') return 'denied'
  if (normalized === 'prompt') return 'prompt'
  return 'unknown'
}

function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('token')
    return raw && raw.trim() ? raw.trim() : null
  } catch {
    return null
  }
}

const PUSH_DEVICE_TOKEN_STORAGE_KEY = 'cc:pushDeviceToken:ios'
const PUSH_OPTOUT_STORAGE_KEY = 'cc:pushOptOut:ios'

function storeLastDeviceToken(deviceToken: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PUSH_DEVICE_TOKEN_STORAGE_KEY, deviceToken)
  } catch {
    // ignore
  }
}

function readLastDeviceToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PUSH_DEVICE_TOKEN_STORAGE_KEY)
    return raw && raw.trim() ? raw.trim() : null
  } catch {
    return null
  }
}

function setOptOut(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(PUSH_OPTOUT_STORAGE_KEY, '1')
    else window.localStorage.removeItem(PUSH_OPTOUT_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function isNativePushOptedOut(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PUSH_OPTOUT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function enableNativePushOptIn(): void {
  setOptOut(false)
}

export async function disableNativePushNotifications(): Promise<boolean> {
  const authToken = getStoredAuthToken()
  const deviceToken = readLastDeviceToken()
  if (!authToken || !deviceToken) {
    setOptOut(true)
    return false
  }

  try {
    const { buildApiUrl } = await import('./api.js')
    const res = await fetch(buildApiUrl('/mobile/push/register'), {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        token: deviceToken,
        platform: 'ios',
      }),
    })

    setOptOut(true)
    return res.ok
  } catch {
    setOptOut(true)
    return false
  }
}

async function postDeviceTokenToBackend(deviceToken: string): Promise<void> {
  const token = getStoredAuthToken()
  if (!token) return

  try {
    const { buildApiUrl } = await import('./api.js')
    const res = await fetch(buildApiUrl('/mobile/push/register'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        token: deviceToken,
        platform: 'ios',
      }),
    })

    if (!res.ok) {
      // Avoid throwing: push registration should never break UX.
      console.warn('push_register_failed', res.status)
      return
    }

    setOptOut(false)
  } catch (err) {
    console.warn('push_register_error', err)
  }
}

async function syncDeviceTokenFromCivilPushPlugin(): Promise<boolean> {
  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'ios') return false

  const plugin = bridge.Plugins?.CivilPush
  if (!plugin || typeof plugin.getDeviceToken !== 'function') return false

  try {
    const res = await plugin.getDeviceToken()
    const value = typeof res?.value === 'string' ? res.value.trim() : ''
    if (!value) {
      if (typeof plugin.getRegistrationDebugInfo === 'function') {
        try {
          const info = await plugin.getRegistrationDebugInfo()
          if (info?.error) console.warn('push_apns_registration_error', info.error)
        } catch {
          // ignore
        }
      }
      return false
    }
    storeLastDeviceToken(value)
    void postDeviceTokenToBackend(value)
    return true
  } catch {
    return false
  }
}

async function waitForCivilPushTokenAndSync(maxWaitMs: number): Promise<boolean> {
  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'ios') return false

  const plugin = bridge.Plugins?.CivilPush
  if (!plugin || typeof plugin.getDeviceToken !== 'function') return false

  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    const synced = await syncDeviceTokenFromCivilPushPlugin()
    if (synced) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return false
}

let pushTokenSyncInitialized = false

async function ensurePushTokenSyncInitialized(): Promise<void> {
  if (pushTokenSyncInitialized) return

  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'ios') return

  const plugin = bridge.Plugins?.PushNotifications
  if (!plugin || typeof plugin.addListener !== 'function') return

  pushTokenSyncInitialized = true

  try {
    await plugin.addListener('registration', (event: CapacitorPushRegistrationEvent) => {
      const value = typeof event?.value === 'string' ? event.value.trim() : ''
      if (!value) return
      storeLastDeviceToken(value)
      void postDeviceTokenToBackend(value)
    })

    await plugin.addListener('registrationError', (event: any) => {
      console.warn('push_registration_error', event)
    })
  } catch {
    // Listener setup failure shouldn't block permission flow.
  }
}

export async function ensureNativePushRegistration(options?: {
  requestIfPrompt?: boolean
  ignoreOptOut?: boolean
}): Promise<PushPermissionState> {
  const bridge = getCapacitorBridge()
  if (!bridge || bridge.getPlatform?.() !== 'ios') return 'unknown'

  const pushPlugin = bridge.Plugins?.PushNotifications
  const civilPushPlugin = bridge.Plugins?.CivilPush

  if (!pushPlugin && !civilPushPlugin) return 'unknown'

  // Ensure listeners are attached before `register()` so we don't miss the token event.
  // This only applies when the PushNotifications plugin exists.
  await ensurePushTokenSyncInitialized()

  const requestIfPrompt = options?.requestIfPrompt ?? false
  const ignoreOptOut = options?.ignoreOptOut ?? false

  let status = 'unknown'
  if (pushPlugin && typeof pushPlugin.checkPermissions === 'function') {
    try {
      const result = await pushPlugin.checkPermissions()
      status = result?.receive ?? 'unknown'
    } catch {
      status = 'unknown'
    }
  }

  if ((status === 'prompt' || status === 'unknown') && requestIfPrompt) {
    if (pushPlugin && typeof pushPlugin.requestPermissions === 'function') {
      try {
        const result = await pushPlugin.requestPermissions()
        status = result?.receive ?? status
      } catch {
        status = 'unknown'
      }
    } else if (civilPushPlugin && typeof civilPushPlugin.requestPushPermissions === 'function') {
      try {
        const result = await civilPushPlugin.requestPushPermissions()
        status = result?.receive ?? status
      } catch {
        status = 'unknown'
      }
    }
  }

  const normalized = normalizePermissionState(status)
  const optedOut = isNativePushOptedOut()

  // If we're opted-in, attempt to sync a token even if we can't determine permission state.
  if (ignoreOptOut || !optedOut) {
    void syncDeviceTokenFromCivilPushPlugin()
  }

  const registerFn = pushPlugin?.register
  const civilRegisterFn = civilPushPlugin?.registerForRemoteNotifications
  const shouldRegister = normalized === 'granted'

  if (shouldRegister && (ignoreOptOut || !optedOut)) {
    try {
      if (ignoreOptOut) setOptOut(false)
      if (typeof registerFn === 'function') await registerFn()
      else if (typeof civilRegisterFn === 'function') await civilRegisterFn()
    } catch {
      return 'granted'
    }

    // Try again after registration; APNs token delivery is async.
    void waitForCivilPushTokenAndSync(5000)
  }

  return normalized
}
