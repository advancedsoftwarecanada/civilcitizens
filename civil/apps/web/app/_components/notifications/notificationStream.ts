'use client'

import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import type { NotificationActor } from './notificationUtils'

export type RealtimePayload = {
  type: string
  data?: unknown
}

export type NotificationRealtimeData = {
  id: string
  type: string
  actorId: string | null
  postId: string | null
  payload: unknown
  readAt: string | null
  createdAt: string
  unread: boolean
  actor: NotificationActor | null
}

export function isNotificationPayload(
  payload: RealtimePayload,
): payload is { type: 'notification'; data: NotificationRealtimeData } {
  const data = (payload as { data?: unknown }).data as Partial<NotificationRealtimeData> | undefined
  return (
    payload.type === 'notification' &&
    typeof data?.id === 'string' &&
    typeof data?.type === 'string' &&
    typeof data?.createdAt === 'string' &&
    ('actor' in (data ?? {}) ? data?.actor === null || typeof data?.actor === 'object' : true)
  )
}

type Listener = (payload: RealtimePayload) => void

const listeners = new Set<Listener>()
let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let currentToken: string | null = null
let storageListenerAttached = false

function notifyListeners(payload: RealtimePayload) {
  const snapshot = Array.from(listeners)
  snapshot.forEach((listener) => {
    try {
      listener(payload)
    } catch (err) {
      console.error('notifications_stream_listener_failed', err)
    }
  })
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key !== 'token') return
  currentToken = null
  ensureConnection()
}

function attachStorageListener() {
  if (storageListenerAttached) return
  window.addEventListener('storage', handleStorage)
  storageListenerAttached = true
}

function detachStorageListener() {
  if (!storageListenerAttached) return
  window.removeEventListener('storage', handleStorage)
  storageListenerAttached = false
}

function scheduleReconnect() {
  if (reconnectTimer || listeners.size === 0) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    ensureConnection()
  }, 3000)
}

function ensureConnection() {
  if (typeof window === 'undefined') return
  if (listeners.size === 0) {
    closeEventSource()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    return
  }

  const token = getStoredToken()
  if (!token) {
    closeEventSource()
    currentToken = null
    return
  }

  if (eventSource && currentToken === token && eventSource.readyState !== EventSource.CLOSED) {
    return
  }

  closeEventSource()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const streamUrl = `${buildApiUrl('/notifications/stream')}?token=${encodeURIComponent(token)}`
  const source = new EventSource(streamUrl)
  eventSource = source
  currentToken = token

  source.onmessage = (event) => {
    if (!event.data) return
    try {
      const payload = JSON.parse(event.data) as RealtimePayload
      if (!payload?.type || payload.type === 'connected') return
      notifyListeners(payload)
    } catch (err) {
      console.error('notifications_stream_parse_failed', err)
    }
  }

  source.onerror = () => {
    closeEventSource()
    scheduleReconnect()
  }
}

export function subscribeToNotificationsStream(listener: Listener) {
  if (typeof window === 'undefined') {
    return () => {}
  }
  listeners.add(listener)
  attachStorageListener()
  ensureConnection()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      closeEventSource()
      currentToken = null
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      detachStorageListener()
    }
  }
}

export function refreshNotificationStream() {
  ensureConnection()
}
