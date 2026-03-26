import { createServer } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8788)
const MEETING_RTC_SECRET = (process.env.MEETING_RTC_SECRET || '').trim()
const RTC_WS_URL = (process.env.RTC_WS_URL || '').trim()
const RTC_WS_PATH = (process.env.RTC_WS_PATH || '/v1/ws').trim() || '/v1/ws'
const SESSION_TTL_SECONDS = Number(process.env.RTC_SESSION_TTL_SECONDS || 1800)
const BODY_LIMIT_BYTES = 64 * 1024
const HEARTBEAT_INTERVAL_MS = Number(process.env.RTC_HEARTBEAT_INTERVAL_MS || 30000)

const sessionsByToken = new Map()
const peersByRoom = new Map()

function nowMs() {
  return Date.now()
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return
  try {
    ws.send(JSON.stringify(payload))
  } catch {
    // ignore socket send failures
  }
}

function token() {
  return randomBytes(32).toString('base64url')
}

function normalizeDisplayName(value, fallback = 'Civil user') {
  const display = typeof value === 'string' ? value.trim() : ''
  return display || fallback
}

function getIceServers() {
  const raw = (process.env.RTC_ICE_SERVERS_JSON || '').trim()
  if (!raw) return [{ urls: 'stun:stun.l.google.com:19302' }]
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [{ urls: 'stun:stun.l.google.com:19302' }]
    const normalized = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const urlsRaw = entry.urls
      const urls = typeof urlsRaw === 'string'
        ? urlsRaw.trim()
        : Array.isArray(urlsRaw)
          ? urlsRaw.filter((item) => typeof item === 'string' && item.trim().length > 0)
          : ''
      if (!urls || (Array.isArray(urls) && urls.length === 0)) continue
      const row = { urls }
      if (typeof entry.username === 'string') row.username = entry.username
      if (typeof entry.credential === 'string') row.credential = entry.credential
      normalized.push(row)
    }
    return normalized.length ? normalized : [{ urls: 'stun:stun.l.google.com:19302' }]
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        reject(new Error('body_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('invalid_json_body'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new Error('invalid_json_body'))
      }
    })

    req.on('error', reject)
  })
}

function writeUpgradeError(socket, statusCode, message) {
  const statusText = statusCode === 401 ? 'Unauthorized' : statusCode === 404 ? 'Not Found' : 'Bad Request'
  const payload = JSON.stringify({ error: message })
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: application/json; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n` +
    payload,
  )
  socket.destroy()
}

function cleanupExpiredSessions() {
  const now = nowMs()
  for (const [sessionToken, session] of sessionsByToken.entries()) {
    if (session.expiresAtMs <= now) {
      sessionsByToken.delete(sessionToken)
    }
  }
}

function buildPeerPayload(peer) {
  return {
    peerId: peer.peerId,
    userId: peer.userId,
    displayName: peer.displayName,
    role: peer.role,
  }
}

function listPeersInRoom(roomId, excludePeerId = null) {
  const roomPeers = peersByRoom.get(roomId)
  if (!roomPeers) return []
  const peers = []
  for (const peer of roomPeers.values()) {
    if (excludePeerId && peer.peerId === excludePeerId) continue
    peers.push(buildPeerPayload(peer))
  }
  return peers
}

function broadcastToRoom(roomId, payload, excludePeerId = null) {
  const roomPeers = peersByRoom.get(roomId)
  if (!roomPeers) return
  for (const peer of roomPeers.values()) {
    if (excludePeerId && peer.peerId === excludePeerId) continue
    safeSend(peer.ws, payload)
  }
}

function resolveWsUrl(req, sessionToken, roomId) {
  const configured = RTC_WS_URL
  if (configured) {
    try {
      const parsed = new URL(configured)
      parsed.searchParams.set('token', sessionToken)
      parsed.searchParams.set('roomId', roomId)
      return parsed.toString()
    } catch {
      return null
    }
  }

  const host = String(req.headers.host || '').trim()
  if (!host) return null
  const proto = host.includes('localhost') || host.startsWith('127.') ? 'ws' : 'wss'
  return `${proto}://${host}${RTC_WS_PATH}?token=${encodeURIComponent(sessionToken)}&roomId=${encodeURIComponent(roomId)}`
}

const server = createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase()
  const requestUrl = new URL(req.url || '/', 'http://localhost')

  if (method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'civil-meeting-rtc',
      rooms: peersByRoom.size,
      activeSessions: sessionsByToken.size,
    })
    return
  }

  if (method === 'GET' && requestUrl.pathname.startsWith('/v1/rooms/') && requestUrl.pathname.endsWith('/state')) {
    if (MEETING_RTC_SECRET) {
      const provided = String(req.headers['x-meeting-rtc-secret'] || '').trim()
      if (!provided || provided !== MEETING_RTC_SECRET) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
    }

    const segments = requestUrl.pathname.split('/').filter(Boolean)
    const roomId = segments.length >= 4 ? decodeURIComponent(segments[2] || '') : ''
    if (!roomId) {
      sendJson(res, 400, { error: 'invalid_room_id' })
      return
    }

    sendJson(res, 200, {
      roomId,
      peerCount: (peersByRoom.get(roomId)?.size ?? 0),
      peers: listPeersInRoom(roomId),
    })
    return
  }

  if (method === 'POST' && requestUrl.pathname.startsWith('/v1/rooms/') && requestUrl.pathname.endsWith('/sessions')) {
    if (MEETING_RTC_SECRET) {
      const provided = String(req.headers['x-meeting-rtc-secret'] || '').trim()
      if (!provided || provided !== MEETING_RTC_SECRET) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
    }

    const segments = requestUrl.pathname.split('/').filter(Boolean)
    const roomId = segments.length >= 4 ? decodeURIComponent(segments[2] || '') : ''
    if (!roomId) {
      sendJson(res, 400, { error: 'invalid_room_id' })
      return
    }

    try {
      const body = await readJsonBody(req)
      const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
      if (!userId) {
        sendJson(res, 400, { error: 'user_id_required' })
        return
      }

      const ttlSeconds = Math.max(60, Math.floor(SESSION_TTL_SECONDS))
      const expiresAtMs = nowMs() + ttlSeconds * 1000
      const sessionToken = token()
      const session = {
        sessionId: `rtc_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        token: sessionToken,
        roomId,
        userId,
        displayName: normalizeDisplayName(body.displayName),
        role: body.role === 'manager' ? 'manager' : 'participant',
        deviceId: typeof body.deviceId === 'string' ? body.deviceId.trim() : null,
        capabilities: body.capabilities && typeof body.capabilities === 'object' && !Array.isArray(body.capabilities)
          ? body.capabilities
          : {},
        metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
        expiresAtMs,
      }

      sessionsByToken.set(sessionToken, session)
      sendJson(res, 200, {
        sessionId: session.sessionId,
        token: session.token,
        wsUrl: resolveWsUrl(req, session.token, roomId),
        iceServers: getIceServers(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      })
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid_request'
      const code = message === 'body_too_large' ? 413 : 400
      sendJson(res, code, { error: message })
      return
    }
  }

  if (method === 'POST' && requestUrl.pathname.startsWith('/v1/rooms/') && requestUrl.pathname.includes('/peers/') && requestUrl.pathname.endsWith('/disconnect')) {
    if (MEETING_RTC_SECRET) {
      const provided = String(req.headers['x-meeting-rtc-secret'] || '').trim()
      if (!provided || provided !== MEETING_RTC_SECRET) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
    }

    const segments = requestUrl.pathname.split('/').filter(Boolean)
    const roomId = segments.length >= 6 ? decodeURIComponent(segments[2] || '') : ''
    const peerId = segments.length >= 6 ? decodeURIComponent(segments[4] || '') : ''
    if (!roomId || !peerId) {
      sendJson(res, 400, { error: 'invalid_peer_target' })
      return
    }

    const room = peersByRoom.get(roomId)
    const peer = room?.get(peerId)
    if (!peer) {
      sendJson(res, 404, { error: 'peer_not_found' })
      return
    }

    let reason = null
    try {
      const body = await readJsonBody(req)
      reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 280) : null
    } catch {
      reason = null
    }

    safeSend(peer.ws, {
      type: 'moderation.disconnect',
      peerId,
      roomId,
      reason,
      ts: new Date().toISOString(),
    })

    try {
      peer.ws.close(4000, 'moderator_disconnect')
    } catch {
      try {
        peer.ws.terminate?.()
      } catch {
        // ignore
      }
    }

    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 404, { error: 'not_found' })
})

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws, request, session) => {
  const peerId = `peer_${randomUUID().replace(/-/g, '').slice(0, 18)}`
  const peer = {
    peerId,
    ws,
    roomId: session.roomId,
    userId: session.userId,
    displayName: session.displayName,
    role: session.role,
  }

  let roomPeers = peersByRoom.get(session.roomId)
  if (!roomPeers) {
    roomPeers = new Map()
    peersByRoom.set(session.roomId, roomPeers)
  }
  roomPeers.set(peerId, peer)

  safeSend(ws, {
    type: 'hello',
    peerId,
    roomId: session.roomId,
    role: session.role,
    peers: listPeersInRoom(session.roomId, peerId),
    ts: new Date().toISOString(),
  })

  broadcastToRoom(
    session.roomId,
    {
      type: 'peer.joined',
      peer: buildPeerPayload(peer),
      ts: new Date().toISOString(),
    },
    peerId,
  )

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw || ''))
    } catch {
      safeSend(ws, { type: 'error', error: 'invalid_json' })
      return
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      safeSend(ws, { type: 'error', error: 'invalid_message' })
      return
    }

    const type = typeof message.type === 'string' ? message.type.trim() : ''
    if (!type) {
      safeSend(ws, { type: 'error', error: 'message_type_required' })
      return
    }

    if (type === 'ping') {
      safeSend(ws, { type: 'pong', ts: new Date().toISOString() })
      return
    }

    if (type === 'signal') {
      const targetPeerId = typeof message.targetPeerId === 'string' ? message.targetPeerId.trim() : ''
      if (!targetPeerId) {
        safeSend(ws, { type: 'error', error: 'target_peer_required' })
        return
      }
      const target = peersByRoom.get(session.roomId)?.get(targetPeerId)
      if (!target) {
        safeSend(ws, { type: 'error', error: 'target_peer_not_found', targetPeerId })
        return
      }
      safeSend(target.ws, {
        type: 'signal',
        fromPeerId: peerId,
        fromUserId: session.userId,
        payload: message.payload ?? null,
        ts: new Date().toISOString(),
      })
      return
    }

    if (type === 'broadcast') {
      broadcastToRoom(
        session.roomId,
        {
          type: 'broadcast',
          fromPeerId: peerId,
          fromUserId: session.userId,
          payload: message.payload ?? null,
          ts: new Date().toISOString(),
        },
        peerId,
      )
      return
    }

    if (type === 'peer.state') {
      broadcastToRoom(
        session.roomId,
        {
          type: 'peer.state',
          peerId,
          userId: session.userId,
          payload: message.payload ?? null,
          ts: new Date().toISOString(),
        },
        peerId,
      )
      return
    }

    safeSend(ws, { type: 'error', error: 'unsupported_message_type', messageType: type })
  })

  ws.on('close', () => {
    const room = peersByRoom.get(session.roomId)
    if (!room) return
    room.delete(peerId)
    if (room.size === 0) {
      peersByRoom.delete(session.roomId)
      return
    }
    broadcastToRoom(session.roomId, {
      type: 'peer.left',
      peerId,
      userId: session.userId,
      ts: new Date().toISOString(),
    })
  })
})

server.on('upgrade', (request, socket, head) => {
  cleanupExpiredSessions()
  const requestUrl = new URL(request.url || '/', 'http://localhost')
  if (requestUrl.pathname !== RTC_WS_PATH) {
    writeUpgradeError(socket, 404, 'not_found')
    return
  }

  const sessionToken = (requestUrl.searchParams.get('token') || '').trim()
  if (!sessionToken) {
    writeUpgradeError(socket, 401, 'token_required')
    return
  }

  const session = sessionsByToken.get(sessionToken)
  if (!session) {
    writeUpgradeError(socket, 401, 'invalid_token')
    return
  }
  if (session.expiresAtMs <= nowMs()) {
    sessionsByToken.delete(sessionToken)
    writeUpgradeError(socket, 401, 'session_expired')
    return
  }

  const roomIdFromQuery = (requestUrl.searchParams.get('roomId') || '').trim()
  if (roomIdFromQuery && roomIdFromQuery !== session.roomId) {
    writeUpgradeError(socket, 401, 'room_mismatch')
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, session)
  })
})

setInterval(() => {
  cleanupExpiredSessions()
  for (const roomId of peersByRoom.keys()) {
    broadcastToRoom(roomId, { type: 'ping', ts: new Date().toISOString() })
  }
}, Math.max(10000, HEARTBEAT_INTERVAL_MS)).unref?.()

server.listen(PORT, '0.0.0.0', () => {
  console.log(`civil-meeting-rtc listening on :${PORT}`)
})
