const HTTP_URL_REGEX = /https?:\/\/[^\s<>"']+/gi
const TRAILING_URL_PUNCTUATION = /[)\],.!?:;]+$/
const EMPTY_ANCHOR_REGEX = /<a\b([^>]*?)href=(['"])\s*\2([^>]*)>([\s\S]*?)<\/a>/gi
const EMPTY_PARAGRAPH_REGEX = /<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi

const CIVIL_LINK_HOSTS = new Set([
  'dev.civilcitizens.ca',
  'civilcitizens.ca',
  'www.civilcitizens.ca',
  'civilvitizens.ca',
  'www.civilvitizens.ca',
])

function trimUrlPunctuation(raw: string): string {
  let value = raw.trim()
  while (TRAILING_URL_PUNCTUATION.test(value)) {
    const next = value.replace(TRAILING_URL_PUNCTUATION, '')
    if (next === value) break
    value = next
  }
  return value
}

export function normalizeHttpUrl(raw: string): string | null {
  const trimmed = trimUrlPunctuation(raw)
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

export function isCivilUrl(rawUrl: string): boolean {
  const normalized = normalizeHttpUrl(rawUrl)
  if (!normalized) return false
  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase()
    if (CIVIL_LINK_HOSTS.has(host)) return true
    if (host.endsWith('.civilcitizens.ca') || host.endsWith('.civilvitizens.ca')) return true
    if (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase()) return true
    return false
  } catch {
    return false
  }
}

export function extractCivilUrlsFromText(body: string): string[] {
  const matches = body.match(HTTP_URL_REGEX)
  if (!matches) return []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const normalized = normalizeHttpUrl(match)
    if (!normalized || seen.has(normalized) || !isCivilUrl(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }
  return urls
}

export function stripCivilUrlsFromText(body: string | null | undefined): string {
  const raw = body ?? ''
  if (!raw) return ''

  const stripped = raw.replace(HTTP_URL_REGEX, (value) => {
    const normalized = normalizeHttpUrl(value)
    if (!normalized || !isCivilUrl(normalized)) return value
    return ''
  })

  return stripped
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function stripCivilUrlMatches(input: string): string {
  return input.replace(HTTP_URL_REGEX, (value) => {
    const normalized = normalizeHttpUrl(value)
    if (!normalized || !isCivilUrl(normalized)) return value
    return ''
  })
}

export function stripCivilUrlsFromHtml(html: string | null | undefined): string {
  const raw = html ?? ''
  if (!raw) return ''

  const stripped = stripCivilUrlMatches(raw)
    .replace(EMPTY_ANCHOR_REGEX, '$4')
    .replace(EMPTY_PARAGRAPH_REGEX, '')

  return stripped
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
