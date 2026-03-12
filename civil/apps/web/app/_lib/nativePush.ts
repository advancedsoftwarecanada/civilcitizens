'use client'

export type PushPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

type NativePlatform = 'ios' | 'android'

type CapacitorPushPermissions = { receive?: string }

type CapacitorListenerHandle = { remove: () => void | Promise<void> }

type CapacitorPushRegistrationEvent = { value?: string }

type CapacitorPushActionNotification = {
	data?: Record<string, unknown>
	url?: string
	urlPath?: string
	path?: string
	threadId?: string
	threadID?: string
	channelId?: string
	conversationId?: string
}

type CapacitorPushActionPerformedEvent = {
	notification?: CapacitorPushActionNotification | null
	data?: Record<string, unknown>
}

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

const PUSH_DEVICE_TOKEN_STORAGE_KEY_PREFIX = 'cc:pushDeviceToken'
const PUSH_OPTOUT_STORAGE_KEY_PREFIX = 'cc:pushOptOut'
const PUSH_TAP_URL_STORAGE_KEY = 'cc:lastNativeNotificationTapUrl'
const pushTokenSyncInitializedPlatforms = new Set<NativePlatform>()
let pushTapListenerInitialized = false

function getCapacitorBridge(): CapacitorBridge | null {
	if (typeof window === 'undefined') return null
	const candidate = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
	if (!candidate || typeof candidate !== 'object') return null
	return candidate
}

function getNativePlatform(): NativePlatform | null {
	const bridge = getCapacitorBridge()
	if (!bridge || typeof bridge.getPlatform !== 'function') return null
	const platform = bridge.getPlatform()
	return platform === 'ios' || platform === 'android' ? platform : null
}

function getPushDeviceTokenStorageKey(platform: NativePlatform): string {
	return `${PUSH_DEVICE_TOKEN_STORAGE_KEY_PREFIX}:${platform}`
}

function getPushOptOutStorageKey(platform: NativePlatform): string {
	return `${PUSH_OPTOUT_STORAGE_KEY_PREFIX}:${platform}`
}

export function isAppleNativeApp(): boolean {
	return getNativePlatform() === 'ios'
}

export function isAndroidNativeApp(): boolean {
	return getNativePlatform() === 'android'
}

export function isNativeApp(): boolean {
	return getNativePlatform() !== null
}

function storeLastNativeNotificationTapUrl(url: string): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(PUSH_TAP_URL_STORAGE_KEY, url)
	} catch {
		// ignore
	}
}

function readStoredLastNativeNotificationTapUrl(): string | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.localStorage.getItem(PUSH_TAP_URL_STORAGE_KEY)
		return raw && raw.trim() ? raw.trim() : null
	} catch {
		return null
	}
}

function clearStoredLastNativeNotificationTapUrl(): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.removeItem(PUSH_TAP_URL_STORAGE_KEY)
	} catch {
		// ignore
	}
}

function resolveNativeNotificationTapUrl(payload: Record<string, unknown> | null | undefined): string | null {
	if (!payload) return null

	const urlCandidates = [payload.url, payload.urlPath, payload.path]
	for (const candidate of urlCandidates) {
		const normalized = typeof candidate === 'string' ? candidate.trim() : ''
		if (normalized) return normalized
	}

	const threadCandidate = [payload.threadId, payload.threadID, payload.channelId, payload.conversationId].find(
		(value) => typeof value === 'string' && value.trim().length > 0,
	)
	if (typeof threadCandidate === 'string') {
		return `/messages?thread=${encodeURIComponent(threadCandidate.trim())}`
	}

	return null
}

export async function ensureNativeNotificationTapListener(): Promise<void> {
	const bridge = getCapacitorBridge()
	if (!bridge || pushTapListenerInitialized) return

	const plugin = bridge.Plugins?.PushNotifications
	if (!plugin || typeof plugin.addListener !== 'function') return

	pushTapListenerInitialized = true

	try {
		await plugin.addListener('pushNotificationActionPerformed', (event: CapacitorPushActionPerformedEvent) => {
			const notificationPayload = event?.notification && typeof event.notification === 'object'
				? (event.notification as Record<string, unknown>)
				: null
			const dataPayload = event?.data && typeof event.data === 'object'
				? event.data
				: notificationPayload?.data && typeof notificationPayload.data === 'object'
					? (notificationPayload.data as Record<string, unknown>)
					: null

			const nextUrl =
				resolveNativeNotificationTapUrl(dataPayload) ??
				resolveNativeNotificationTapUrl(notificationPayload)

			if (nextUrl) storeLastNativeNotificationTapUrl(nextUrl)
		})
	} catch {
		pushTapListenerInitialized = false
	}
}

export async function getLastNativeNotificationTapUrl(): Promise<string | null> {
	const bridge = getCapacitorBridge()
	if (!bridge) return null

	const storedUrl = readStoredLastNativeNotificationTapUrl()
	if (storedUrl) return storedUrl

	if (bridge.getPlatform?.() !== 'ios') return null

	const plugin = bridge.Plugins?.CivilPush
	if (!plugin || typeof plugin.getLastNotificationTap !== 'function') return null

	try {
		const result = await plugin.getLastNotificationTap()
		const resolved = resolveNativeNotificationTapUrl(result as Record<string, unknown>)
		if (resolved) storeLastNativeNotificationTapUrl(resolved)
		return resolved
	} catch {
		return null
	}
}

export async function clearLastNativeNotificationTapUrl(): Promise<void> {
	clearStoredLastNativeNotificationTapUrl()

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

function storeLastDeviceToken(deviceToken: string, platform: NativePlatform): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(getPushDeviceTokenStorageKey(platform), deviceToken)
	} catch {
		// ignore
	}
}

function readLastDeviceToken(platform: NativePlatform): string | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.localStorage.getItem(getPushDeviceTokenStorageKey(platform))
		return raw && raw.trim() ? raw.trim() : null
	} catch {
		return null
	}
}

function setOptOut(value: boolean, platform: NativePlatform): void {
	if (typeof window === 'undefined') return
	try {
		const key = getPushOptOutStorageKey(platform)
		if (value) window.localStorage.setItem(key, '1')
		else window.localStorage.removeItem(key)
	} catch {
		// ignore
	}
}

export function isNativePushOptedOut(): boolean {
	const platform = getNativePlatform()
	if (!platform || typeof window === 'undefined') return false
	try {
		return window.localStorage.getItem(getPushOptOutStorageKey(platform)) === '1'
	} catch {
		return false
	}
}

export function enableNativePushOptIn(): void {
	const platform = getNativePlatform()
	if (!platform) return
	setOptOut(false, platform)
}

export async function disableNativePushNotifications(): Promise<boolean> {
	const platform = getNativePlatform()
	if (!platform) return false

	const authToken = getStoredAuthToken()
	const deviceToken = readLastDeviceToken(platform)
	if (!authToken || !deviceToken) {
		setOptOut(true, platform)
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
				platform,
			}),
		})

		setOptOut(true, platform)
		return res.ok
	} catch {
		setOptOut(true, platform)
		return false
	}
}

async function postDeviceTokenToBackend(deviceToken: string, platform: NativePlatform): Promise<void> {
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
				platform,
			}),
		})

		if (!res.ok) {
			console.warn('push_register_failed', res.status, platform)
			return
		}

		setOptOut(false, platform)
	} catch (err) {
		console.warn('push_register_error', err)
	}
}

async function syncStoredDeviceTokenToBackend(platform: NativePlatform): Promise<boolean> {
	const token = readLastDeviceToken(platform)
	if (!token) return false
	void postDeviceTokenToBackend(token, platform)
	return true
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
		storeLastDeviceToken(value, 'ios')
		void postDeviceTokenToBackend(value, 'ios')
		return true
	} catch {
		return false
	}
}

async function waitForDeviceTokenAndSync(maxWaitMs: number, platform: NativePlatform): Promise<boolean> {
	const started = Date.now()
	while (Date.now() - started < maxWaitMs) {
		const synced = platform === 'ios' ? await syncDeviceTokenFromCivilPushPlugin() : await syncStoredDeviceTokenToBackend(platform)
		if (synced) return true
		await new Promise((resolve) => setTimeout(resolve, 250))
	}

	return false
}

async function ensurePushTokenSyncInitialized(): Promise<void> {
	const platform = getNativePlatform()
	if (!platform || pushTokenSyncInitializedPlatforms.has(platform)) return

	const bridge = getCapacitorBridge()
	if (!bridge) return

	const plugin = bridge.Plugins?.PushNotifications
	if (!plugin || typeof plugin.addListener !== 'function') return

	pushTokenSyncInitializedPlatforms.add(platform)

	try {
		await plugin.addListener('registration', (event: CapacitorPushRegistrationEvent) => {
			const value = typeof event?.value === 'string' ? event.value.trim() : ''
			if (!value) return
			storeLastDeviceToken(value, platform)
			void postDeviceTokenToBackend(value, platform)
		})

		await plugin.addListener('registrationError', (event: any) => {
			console.warn('push_registration_error', platform, event)
		})
	} catch {
		// Listener setup failure shouldn't block permission flow.
	}
}

export async function ensureNativePushRegistration(options?: {
	requestIfPrompt?: boolean
	ignoreOptOut?: boolean
}): Promise<PushPermissionState> {
	const platform = getNativePlatform()
	const bridge = getCapacitorBridge()
	if (!platform || !bridge) return 'unknown'

	const pushPlugin = bridge.Plugins?.PushNotifications
	const civilPushPlugin = platform === 'ios' ? bridge.Plugins?.CivilPush : undefined

	if (!pushPlugin && !civilPushPlugin) return 'unknown'

	await ensurePushTokenSyncInitialized()
	await ensureNativeNotificationTapListener()

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

	if (ignoreOptOut || !optedOut) {
		if (platform === 'ios') void syncDeviceTokenFromCivilPushPlugin()
		else void syncStoredDeviceTokenToBackend(platform)
	}

	const registerFn = pushPlugin?.register
	const civilRegisterFn = civilPushPlugin?.registerForRemoteNotifications
	const shouldRegister = normalized === 'granted'

	if (shouldRegister && (ignoreOptOut || !optedOut)) {
		try {
			if (ignoreOptOut) setOptOut(false, platform)
			if (typeof registerFn === 'function') await registerFn()
			else if (typeof civilRegisterFn === 'function') await civilRegisterFn()
		} catch {
			return 'granted'
		}

		void waitForDeviceTokenAndSync(platform === 'ios' ? 5000 : 2500, platform)
	}

	return normalized
}
