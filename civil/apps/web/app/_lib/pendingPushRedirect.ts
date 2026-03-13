'use client'

const PENDING_PUSH_REDIRECT_STORAGE_KEY = 'cc:pendingPushRedirect'
const PENDING_PUSH_REDIRECT_TTL_MS = 15 * 60 * 1000
const PENDING_PUSH_REDIRECT_MAX_ATTEMPTS = 8
const PENDING_PUSH_REDIRECT_ATTEMPT_COOLDOWN_MS = 1200

type PendingPushRedirectRecord = {
  url: string
  createdAt: number
  lastAttemptAt: number | null
  attempts: number
}

export type PendingPushRedirectDebugRecord = PendingPushRedirectRecord

function normalizePendingPushRedirectUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/')) return null
  return trimmed
}

function readStoredRecord(): PendingPushRedirectRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PENDING_PUSH_REDIRECT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingPushRedirectRecord> | null
    const url = normalizePendingPushRedirectUrl(parsed?.url)
    const createdAt = typeof parsed?.createdAt === 'number' ? parsed.createdAt : 0
    const lastAttemptAt = typeof parsed?.lastAttemptAt === 'number' ? parsed.lastAttemptAt : null
    const attempts = typeof parsed?.attempts === 'number' ? parsed.attempts : 0

    if (!url || !createdAt || Date.now() - createdAt > PENDING_PUSH_REDIRECT_TTL_MS) {
      clearPendingPushRedirect()
      return null
    }

    if (attempts >= PENDING_PUSH_REDIRECT_MAX_ATTEMPTS) {
      clearPendingPushRedirect()
      return null
    }

    return { url, createdAt, lastAttemptAt, attempts }
  } catch {
    clearPendingPushRedirect()
    return null
  }
}

export function getPendingPushRedirectDebugRecord(): PendingPushRedirectDebugRecord | null {
  return readStoredRecord()
}

function writeStoredRecord(record: PendingPushRedirectRecord): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PENDING_PUSH_REDIRECT_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // ignore
  }
}

export function setPendingPushRedirect(url: string): string | null {
  const normalized = normalizePendingPushRedirectUrl(url)
  if (!normalized) return null

  const current = readStoredRecord()
  if (current?.url === normalized) return normalized

  writeStoredRecord({
    url: normalized,
    createdAt: Date.now(),
    lastAttemptAt: null,
    attempts: 0,
  })

  return normalized
}

export function getPendingPushRedirectUrl(): string | null {
  return readStoredRecord()?.url ?? null
}

export function clearPendingPushRedirect(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PENDING_PUSH_REDIRECT_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function acknowledgePendingPushRedirect(currentUrl: string): boolean {
  const record = readStoredRecord()
  if (!record) return false
  if (record.url !== currentUrl) return false
  clearPendingPushRedirect()
  return true
}

export function markPendingPushRedirectAttempt(url: string): boolean {
  const record = readStoredRecord()
  if (!record) return false
  if (record.url !== url) {
    return Boolean(setPendingPushRedirect(url))
  }

  const now = Date.now()
  if (record.lastAttemptAt && now - record.lastAttemptAt < PENDING_PUSH_REDIRECT_ATTEMPT_COOLDOWN_MS) {
    return false
  }

  const nextAttempts = record.attempts + 1
  if (nextAttempts >= PENDING_PUSH_REDIRECT_MAX_ATTEMPTS) {
    clearPendingPushRedirect()
    return false
  }

  writeStoredRecord({
    ...record,
    attempts: nextAttempts,
    lastAttemptAt: now,
  })
  return true
}

export function resolvePendingPushRedirectOrFallback(fallbackUrl: string): string {
  return getPendingPushRedirectUrl() ?? fallbackUrl
}

export function buildPreferredLoginNextPath(fallbackPath: string | null): string | null {
  const pendingUrl = getPendingPushRedirectUrl()
  if (pendingUrl) return pendingUrl
  return fallbackPath
}