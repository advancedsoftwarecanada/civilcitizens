'use client'

export type CivilOrientationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

type DeviceOrientationPermissionEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const ORIENTATION_PERMISSION_STORAGE_KEY = 'cc:orientation-permission-decision:v1'

function logOrientation(event: string, details: Record<string, unknown> = {}) {
  console.info(`[orientation] ${event}`, details)
}

function readStoredOrientationDecision(): Extract<CivilOrientationPermissionState, 'granted' | 'denied'> | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(ORIENTATION_PERMISSION_STORAGE_KEY)
    if (value === 'granted' || value === 'denied') return value
  } catch {
    // ignore storage read failures
  }
  return null
}

function writeStoredOrientationDecision(state: Extract<CivilOrientationPermissionState, 'granted' | 'denied'>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ORIENTATION_PERMISSION_STORAGE_KEY, state)
  } catch {
    // ignore storage write failures
  }
}

function getDeviceOrientationPermissionEvent(): DeviceOrientationPermissionEvent | null {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return null
  return window.DeviceOrientationEvent as DeviceOrientationPermissionEvent
}

export function isOrientationSupported() {
  return getDeviceOrientationPermissionEvent() !== null
}

export async function getOrientationPermissionState(reason?: string): Promise<CivilOrientationPermissionState> {
  const eventCtor = getDeviceOrientationPermissionEvent()
  if (!eventCtor) {
    logOrientation('permission_state', { reason, state: 'unsupported' })
    return 'unsupported'
  }

  if (typeof eventCtor.requestPermission !== 'function') {
    logOrientation('permission_state', { reason, state: 'granted', source: 'ungated-api' })
    return 'granted'
  }

  const stored = readStoredOrientationDecision()
  const state = stored ?? 'prompt'
  logOrientation('permission_state', { reason, state, source: stored ? 'local-storage' : 'prompt-required' })
  return state
}

export async function requestOrientationPermission(reason?: string): Promise<CivilOrientationPermissionState> {
  const eventCtor = getDeviceOrientationPermissionEvent()
  if (!eventCtor) {
    logOrientation('permission_request_skipped', { reason, state: 'unsupported' })
    return 'unsupported'
  }

  if (typeof eventCtor.requestPermission !== 'function') {
    logOrientation('permission_request_skipped', { reason, state: 'granted', source: 'ungated-api' })
    return 'granted'
  }

  const stored = readStoredOrientationDecision()
  if (stored) {
    logOrientation('permission_request_skipped', { reason, state: stored, source: 'local-storage' })
    return stored
  }

  try {
    const permission = await eventCtor.requestPermission()
    const resolvedState: Extract<CivilOrientationPermissionState, 'granted' | 'denied'> = permission === 'granted' ? 'granted' : 'denied'
    writeStoredOrientationDecision(resolvedState)
    logOrientation('permission_requested', { reason, state: resolvedState })
    return resolvedState
  } catch (error) {
    writeStoredOrientationDecision('denied')
    logOrientation('permission_request_failed', {
      reason,
      state: 'denied',
      message: error instanceof Error ? error.message : 'unknown',
    })
    return 'denied'
  }
}
