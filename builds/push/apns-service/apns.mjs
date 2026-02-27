import fs from 'node:fs/promises'
import http2 from 'node:http2'
import { importPKCS8, SignJWT } from 'jose'

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

  const pem = await fs.readFile(keyPath, 'utf8')
  const privateKey = await importPKCS8(pem, 'ES256')

  const endpoint = useSandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'

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
    endpoint,
    async send({ deviceToken, title, body, badge }) {
      const jwt = await makeJwt()

      const client = http2.connect(endpoint)
      try {
        const payload = {
          aps: {
            alert: {
              title: title ?? 'Civil',
              body: body ?? 'Test notification',
            },
            sound: 'default',
            ...(typeof badge === 'number' ? { badge } : {}),
          },
        }

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

        req.setEncoding('utf8')
        req.on('data', (chunk) => chunks.push(chunk))

        const result = await new Promise((resolve, reject) => {
          req.on('response', (headers) => {
            const status = Number(headers[':status'] || 0)
            req.on('end', () => {
              const text = chunks.join('')
              resolve({ status, text })
            })
          })
          req.on('error', reject)
        })

        req.end(JSON.stringify(payload))
        return result
      } finally {
        client.close()
      }
    },
  }
}
