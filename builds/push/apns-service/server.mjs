import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApnsClientFromEnv } from './apns.mjs'
import { createFcmClientFromEnv } from './fcm.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 8787)
const DATA_PATH = process.env.DEVICE_STORE_PATH || path.join(__dirname, 'data', 'devices.json')
const REGISTER_SECRET = (process.env.PUSH_REGISTER_SECRET || '').trim()
const ADMIN_SECRET = (process.env.PUSH_ADMIN_SECRET || '').trim()

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return null
  return JSON.parse(raw)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

function requireSecret(req, res, expected, headerName) {
  if (!expected) return true
  const got = String(req.headers[headerName] || '').trim()
  if (got !== expected) {
    sendJson(res, 403, { error: 'forbidden' })
    return false
  }
  return true
}

function normalizeSound(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed === 'default') return 'default'
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return undefined
  return trimmed
}

function normalizePlatform(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return normalized === 'android' ? 'android' : 'ios'
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      if (!requireSecret(req, res, REGISTER_SECRET, 'x-register-secret')) return

      const body = await readBody(req)
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid_json' })

      const token = typeof body.token === 'string' ? body.token.trim() : ''
      const platform = typeof body.platform === 'string' ? body.platform.trim() : ''
      if (!token || !platform) return sendJson(res, 400, { error: 'missing_token_or_platform' })

      const devices = await readJsonSafe(DATA_PATH, [])
      const now = new Date().toISOString()
      const record = {
        token,
        platform,
        bundleId: typeof body.bundleId === 'string' ? body.bundleId : null,
        deviceId: typeof body.deviceId === 'string' ? body.deviceId : null,
        updatedAt: now,
      }

      const next = Array.isArray(devices) ? devices.filter((d) => d?.token !== token) : []
      next.unshift(record)
      await writeJson(DATA_PATH, next.slice(0, 2000))

      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/send-test') {
      if (!requireSecret(req, res, ADMIN_SECRET, 'x-admin-secret')) return

      const body = await readBody(req)
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid_json' })

      const deviceToken = typeof body.deviceToken === 'string' ? body.deviceToken.trim() : ''
      if (!deviceToken) return sendJson(res, 400, { error: 'missing_deviceToken' })
      const platform = normalizePlatform(body.platform)

      const title = typeof body.title === 'string' ? body.title : 'Civil'
      const message = typeof body.message === 'string' ? body.message : 'Test notification'

      const sound = normalizeSound(body.sound)
      const channelId = typeof body.channelId === 'string' && body.channelId.trim() ? body.channelId.trim() : undefined

      const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : undefined

      let badge
      if (typeof body.badge === 'number' && Number.isFinite(body.badge)) {
        badge = Math.max(0, Math.floor(body.badge))
      } else if (typeof body.badge === 'string' && body.badge.trim() !== '' && Number.isFinite(Number(body.badge))) {
        badge = Math.max(0, Math.floor(Number(body.badge)))
      }

      const client = platform === 'android' ? await createFcmClientFromEnv() : await createApnsClientFromEnv()
      const result = await client.send({ deviceToken, title, body: message, badge, data, sound, channelId })
      return sendJson(res, 200, { ok: true, platform, result })
    }

    return notFound(res)
  } catch (err) {
    console.error('push_service_error', err)
    return sendJson(res, 500, { error: 'internal_error' })
  }
})

server.listen(PORT, () => {
  console.log(`APNs service listening on :${PORT}`)
  console.log(`Device store: ${DATA_PATH}`)
})
