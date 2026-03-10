import { importPKCS8, SignJWT } from 'jose'

const TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token'
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

let cachedAccessToken = null
let cachedAccessTokenExpiryMs = 0
let cachedProjectId = ''
let cachedClientEmail = ''
let cachedPrivateKeyRef = ''

function assertString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing env ${name}`)
  }
  return value.trim()
}

function normalizePrivateKey(value) {
  return assertString('FCM_PRIVATE_KEY', value).replace(/\\n/g, '\n')
}

function normalizeData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const normalized = {}
  for (const [key, rawValue] of Object.entries(data)) {
    if (!key) continue
    if (rawValue == null) continue
    normalized[key] = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue)
  }
  return Object.keys(normalized).length ? normalized : undefined
}

async function getServiceAccountFromEnv() {
  const inlineJson = (process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim()
  if (inlineJson) {
    const parsed = JSON.parse(inlineJson)
    return {
      projectId: assertString('FCM_SERVICE_ACCOUNT_JSON.project_id', parsed.project_id),
      clientEmail: assertString('FCM_SERVICE_ACCOUNT_JSON.client_email', parsed.client_email),
      privateKey: normalizePrivateKey(parsed.private_key),
    }
  }

  return {
    projectId: assertString('FCM_PROJECT_ID', process.env.FCM_PROJECT_ID),
    clientEmail: assertString('FCM_CLIENT_EMAIL', process.env.FCM_CLIENT_EMAIL),
    privateKey: normalizePrivateKey(process.env.FCM_PRIVATE_KEY),
  }
}

async function getAccessToken(projectId, clientEmail, privateKey) {
  const keyRef = `${projectId}:${clientEmail}:${privateKey.slice(0, 24)}`
  const now = Date.now()
  if (
    cachedAccessToken &&
    cachedAccessTokenExpiryMs - 60_000 > now &&
    cachedProjectId === projectId &&
    cachedClientEmail === clientEmail &&
    cachedPrivateKeyRef === keyRef
  ) {
    return cachedAccessToken
  }

  const privateKeyObj = await importPKCS8(privateKey, 'RS256')
  const issuedAt = Math.floor(now / 1000)
  const assertion = await new SignJWT({ scope: TOKEN_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(privateKeyObj)

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })

  const response = await fetch(TOKEN_AUDIENCE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`FCM auth failed: ${response.status} ${text}`)
  }

  const parsed = JSON.parse(text || '{}')
  const accessToken = assertString('FCM access_token', parsed.access_token)
  const expiresIn = Number(parsed.expires_in || 3600)

  cachedAccessToken = accessToken
  cachedAccessTokenExpiryMs = now + Math.max(300, expiresIn) * 1000
  cachedProjectId = projectId
  cachedClientEmail = clientEmail
  cachedPrivateKeyRef = keyRef

  return accessToken
}

export async function createFcmClientFromEnv() {
  const serviceAccount = await getServiceAccountFromEnv()
  const endpoint = `https://fcm.googleapis.com/v1/projects/${serviceAccount.projectId}/messages:send`

  return {
    projectId: serviceAccount.projectId,
    endpoint,
    async send({ deviceToken, title, body, badge, data, sound }) {
      const accessToken = await getAccessToken(serviceAccount.projectId, serviceAccount.clientEmail, serviceAccount.privateKey)
      const notification = {
        title: title ?? 'Civil',
        body: body ?? 'Test notification',
      }
      const payload = {
        message: {
          token: deviceToken,
          notification,
          data: normalizeData(data),
          android: {
            priority: 'high',
            notification: {
              ...(typeof badge === 'number' ? { notification_count: Math.max(0, Math.floor(badge)) } : {}),
              ...(typeof sound === 'string' && sound.trim() ? { sound: 'default' } : {}),
            },
          },
        },
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      })

      const text = await response.text()
      return { status: response.status, text, endpoint }
    },
  }
}
