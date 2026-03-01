"use client"
import { create } from 'zustand'
import type { NotificationItem } from './notifications/notificationUtils'

export type Toast = {
  id: string
  message: string
  type?: 'info' | 'success' | 'error' | 'warning'
  ttlMs?: number
  notification?: NotificationItem
}

type ToastState = {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'> & { id?: string }) => string
  remove: (id: string) => void
  clear: () => void
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = t.id || Math.random().toString(36).slice(2)
    const ttl = t.ttlMs ?? 4000
    set((s) => ({ toasts: [...s.toasts, { id, ...t }] }))
    if (ttl > 0) {
      setTimeout(() => {
        const { remove } = get()
        remove(id)
      }, ttl)
    }
    return id
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

export function pushToast(message: string, type: Toast['type'] = 'info', ttlMs?: number) {
  return useToasts.getState().push({ message, type, ttlMs })
}

export function pushNotificationToast(notification: NotificationItem, ttlMs = 7000) {
  return useToasts.getState().push({
    message: 'New notification',
    type: 'info',
    ttlMs,
    notification,
  })
}

export function removeToast(id: string) {
  return useToasts.getState().remove(id)
}
