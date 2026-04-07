import { normalizeMentionHandle, tokenizeTextEntities } from '@civil/shared'

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

type MentionLinkTarget = {
  handle: string
  matchedHandle?: string | null
}

type LinkifyTextOptions = {
  mentions?: MentionLinkTarget[] | null | undefined
}

export type LinkedTextSegment =
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'url' | 'hashtag' | 'mention'
      text: string
      href: string
      external: boolean
      slug?: string
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
  return extractHttpUrlsFromText(body).filter((url) => isCivilUrl(url))
}

export function extractHttpUrlsFromText(body: string): string[] {
  const matches = body.match(HTTP_URL_REGEX)
  if (!matches) return []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const normalized = normalizeHttpUrl(match)
    if (!normalized || seen.has(normalized)) continue
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

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function injectAnchorAttributes(tag: string): string {
  if (!/^<a\b/i.test(tag)) return tag
  let next = tag
  if (!/\btarget=/i.test(next)) next = next.replace(/^<a\b/i, '<a target="_blank"')
  if (!/\brel=/i.test(next)) next = next.replace(/^<a\b/i, '<a rel="noopener noreferrer"')
  return next
}

function buildMentionHandleMap(mentions?: MentionLinkTarget[] | null | undefined) {
  const map = new Map<string, MentionLinkTarget>()

  for (const mention of mentions ?? []) {
    const matchedHandle = normalizeMentionHandle(mention.matchedHandle ?? '')
    if (matchedHandle) {
      map.set(matchedHandle, mention)
    }

    const currentHandle = normalizeMentionHandle(mention.handle ?? '')
    if (currentHandle && !map.has(currentHandle)) {
      map.set(currentHandle, mention)
    }
  }

  return map
}

export function extractLinkedTextSegments(text: string, options: LinkifyTextOptions = {}): LinkedTextSegment[] {
  if (!text) return []

  const mentionMap = buildMentionHandleMap(options.mentions)
  const urlRanges = Array.from(text.matchAll(HTTP_URL_REGEX))
    .map((match) => {
      const rawValue = match[0]
      const start = match.index ?? -1
      if (start < 0) return null

      const displayText = trimUrlPunctuation(rawValue)
      const href = normalizeHttpUrl(rawValue)
      if (!displayText || !href) return null

      return {
        kind: 'url' as const,
        text: displayText,
        href,
        external: true,
        start,
        end: start + displayText.length,
      }
    })
    .filter((entry): entry is { kind: 'url'; text: string; href: string; external: true; start: number; end: number } => Boolean(entry))

  const entityRanges: Array<{
    kind: 'hashtag' | 'mention'
    text: string
    href: string
    external: false
    slug?: string
    start: number
    end: number
  }> = []

  for (const token of tokenizeTextEntities(text)) {
    if (urlRanges.some((url) => token.start < url.end && token.end > url.start)) {
      continue
    }

    if (token.kind === 'hashtag') {
      entityRanges.push({
        kind: 'hashtag',
        text: token.raw,
        href: token.target === 'community' ? `/c/${encodeURIComponent(token.slug)}` : `/t/${encodeURIComponent(token.slug)}`,
        external: false,
        slug: token.target === 'topic' ? token.slug : undefined,
        start: token.start,
        end: token.end,
      })
      continue
    }

    const mention = mentionMap.get(token.handle)
    if (!mention?.handle) continue

    entityRanges.push({
      kind: 'mention',
      text: token.raw,
      href: `/u/${encodeURIComponent(mention.handle)}`,
      external: false,
      start: token.start,
      end: token.end,
    })
  }

  const sortedRanges = [...urlRanges, ...entityRanges].sort((left, right) => left.start - right.start)
  const segments: LinkedTextSegment[] = []
  let cursor = 0

  for (const range of sortedRanges) {
    if (range.start < cursor) continue
    if (range.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, range.start) })
    }
    segments.push({
      kind: range.kind,
      text: range.text,
      href: range.href,
      external: range.external,
      ...(range.kind === 'hashtag' && 'slug' in range ? { slug: range.slug } : {}),
    })
    cursor = range.end
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) })
  }

  return segments
}

function linkifyHtmlTextSegment(segment: string, options: LinkifyTextOptions = {}): string {
  return extractLinkedTextSegments(segment, options)
    .map((entry) => {
      if (entry.kind === 'text') return entry.text
      if (entry.external) {
        return `<a href="${escapeAttribute(entry.href)}" target="_blank" rel="noopener noreferrer">${entry.text}</a>`
      }
      return `<a href="${escapeAttribute(entry.href)}">${entry.text}</a>`
    })
    .join('')
}

export function linkifyContentInHtml(html: string | null | undefined, options: LinkifyTextOptions = {}): string {
  const raw = html ?? ''
  if (!raw) return ''

  return raw
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (!segment) return segment
      if (segment.startsWith('<')) {
        return injectAnchorAttributes(segment)
      }
      return linkifyHtmlTextSegment(segment, options)
    })
    .join('')
}

export function linkifyUrlsInHtml(html: string | null | undefined): string {
  return linkifyContentInHtml(html)
}
