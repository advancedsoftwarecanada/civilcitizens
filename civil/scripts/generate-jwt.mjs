#!/usr/bin/env node
import crypto from 'node:crypto'

const [, , userId, email = '', secret = process.env.JWT_SECRET || 'dev_secret', lifetimeSeconds = '3600'] = process.argv

if (!userId) {
  console.error('Usage: node scripts/generate-jwt.mjs <userId> [email] [secret] [lifetimeSeconds]')
  process.exit(1)
}

const now = Math.floor(Date.now() / 1000)
const payload = {
  sub: userId,
  email,
  iat: now,
  exp: now + Number(lifetimeSeconds),
}

const header = { alg: 'HS256', typ: 'JWT' }

const base64url = (input) => Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)).toString('base64url')

const encodedHeader = base64url(header)
const encodedPayload = base64url(payload)
const signature = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url')

console.log(`${encodedHeader}.${encodedPayload}.${signature}`)
