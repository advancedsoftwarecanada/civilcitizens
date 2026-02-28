import fs from 'node:fs/promises'
import http2 from 'node:http2'
import { importPKCS8, SignJWT } from 'jose'

function normalizeApnsSound(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // APNs expects a filename like "custom.caf" or the literal "default".
  // Avoid passing paths or odd characters.
  if (trimmed === 'default') return 'default'
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return undefined
  return trimmed
}

function assertString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing env ${name}`)
  }
  return value.trim()
}

export async function createApnsClientFromEnv() {
  const keyPath = assertString('APNS_KEY_PATH', process.env.APNS_KEY_PATH)
  const keyId = assertString('APNS_KEY_ID', process.env.APNS_KEY_ID)
  const teamId = assertString('APNS_TEAM_ID', process.env.APNS_TEAM_ID)
  const topic = assertString('APNS_BUNDLE_ID', process.env.APNS_BUNDLE_ID)
  const useSandbox = (process.env.APNS_USE_SANDBOX || '').trim().toLowerCase() === 'true'
  const allowFallback = (process.env.APNS_ALLOW_FALLBACK || '').trim().toLowerCase() === 'true'

  const pem = await fs.readFile(keyPath, 'utf8')
  const privateKey = await importPKCS8(pem, 'ES256')

  const sandboxEndpoint = 'https://api.sandbox.push.apple.com'
  const productionEndpoint = 'https://api.push.apple.com'
  const primaryEndpoint = useSandbox ? sandboxEndpoint : productionEndpoint

  const makeJwt = async () => {
    const iat = Math.floor(Date.now() / 1000)
    return await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuedAt(iat)
      .setIssuer(teamId)
      .sign(privateKey)
  }

  return {
    topic,
    endpoint: primaryEndpoint,
    async send({ deviceToken, title, body, badge, data, sound }) {
      const jwt = await makeJwt()

      const resolvedSound = normalizeApnsSound(sound) || 'default'

      const payload = {
        aps: {
          alert: {
            title: title ?? 'Civil',
            body: body ?? 'Test notification',
          },
          sound: resolvedSound,
          ...(typeof badge === 'number' ? { badge } : {}),
        },
        ...(data && typeof data === 'object' && !Array.isArray(data) ? { civil: data } : {}),
      }

      async function sendOnce(endpoint) {
        const client = http2.connect(endpoint)
        try {
          const headers = {
            ':method': 'POST',
            ':path': `/3/device/${deviceToken}`,
            'apns-topic': topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            authorization: `bearer ${jwt}`,
          }

          const req = client.request(headers)
          const chunks = []
          let status = 0

          req.setEncoding('utf8')
          req.on('data', (chunk) => chunks.push(chunk))

          const resultPromise = new Promise((resolve, reject) => {
            req.on('response', (headers) => {
              status = Number(headers[':status'] || 0)
            })
            req.on('end', () => {
              resolve({ status, text: chunks.join('') })
            })
            req.on('error', reject)
          })

          req.end(JSON.stringify(payload))
          return await resultPromise
        } finally {
          client.close()
        }
      }

      const primary = await sendOnce(primaryEndpoint)
      let reason = ''
      try {
        reason = JSON.parse(primary.text || '{}')?.reason || ''
      } catch {
        reason = ''
      }

      // Optional: if the token belongs to the other APNs environment (sandbox vs production),
      // APNs commonly returns 400 {"reason":"BadDeviceToken"}. When enabled, retry once.
      if (allowFallback && primary.status === 400 && reason === 'BadDeviceToken') {
        const retryEndpoint = primaryEndpoint === sandboxEndpoint ? productionEndpoint : sandboxEndpoint
        const retry = await sendOnce(retryEndpoint)

        // If the fallback succeeds, return it, but keep the primary attempt attached for diagnostics.
        if (retry.status >= 200 && retry.status < 300) {
          return {
            status: retry.status,
            text: retry.text,
            endpoint: retryEndpoint,
            retry: { status: primary.status, text: primary.text, endpoint: primaryEndpoint },
          }
        }

        // Otherwise, preserve the primary failure as the main result.
        return {
          status: primary.status,
          text: primary.text,
          endpoint: primaryEndpoint,
          retry: { status: retry.status, text: retry.text, endpoint: retryEndpoint },
        }
      }

      return { status: primary.status, text: primary.text, endpoint: primaryEndpoint }
    },
  }
}
