function normalizeNotificationUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '/notifications'
  const trimmed = rawUrl.trim()
  if (trimmed.startsWith('/')) return trimmed
  try {
    const parsed = new URL(trimmed, self.location.origin)
    if (parsed.origin !== self.location.origin) return '/notifications'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/notifications'
  }
}

function parsePushPayload(event) {
  if (!event || !event.data) return {}
  try {
    const json = event.data.json()
    return json && typeof json === 'object' ? json : {}
  } catch {
    try {
      const text = event.data.text()
      const json = JSON.parse(text || '{}')
      return json && typeof json === 'object' ? json : {}
    } catch {
      return {}
    }
  }
}

async function hasOpenCivilClient() {
  const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return openClients.some((client) => {
    if (!client || !client.url) return false
    try {
      const currentUrl = new URL(client.url)
      return currentUrl.origin === self.location.origin
    } catch {
      return false
    }
  })
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Civil Citizens'
  const body = typeof payload.body === 'string' ? payload.body.trim() : ''
  const type = typeof payload.type === 'string' ? payload.type.trim() : 'system'
  const entityId = typeof payload.entityId === 'string' ? payload.entityId.trim() : undefined
  const url = normalizeNotificationUrl(payload.url)
  const isCall = type === 'call'

  const options = {
    body,
    icon: '/logo.png',
    badge: '/favicon.png',
    data: { url, type, entityId },
    silent: false,
    tag: isCall && entityId ? `incoming-call-${entityId}` : undefined,
    renotify: Boolean(isCall),
    requireInteraction: Boolean(isCall),
    actions: isCall
      ? [
          { action: 'join', title: 'Join' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : undefined,
  }

  event.waitUntil(
    (async () => {
      if (await hasOpenCivilClient()) {
        return
      }
      await self.registration.showNotification(title, options)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') {
    return
  }

  const notificationData = event.notification && event.notification.data ? event.notification.data : {}
  const targetPath = normalizeNotificationUrl(notificationData.url)
  const targetUrl = new URL(targetPath, self.location.origin).href

  event.waitUntil(
    (async () => {
      const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of openClients) {
        if (!client || !client.url) continue
        try {
          const currentUrl = new URL(client.url)
          if (currentUrl.origin !== self.location.origin) continue
          if (typeof client.navigate === 'function') {
            await client.navigate(targetUrl)
          }
          if (typeof client.focus === 'function') {
            await client.focus()
          }
          return
        } catch {
          // Ignore malformed client URLs.
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl)
      }
    })(),
  )
})
