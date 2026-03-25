import { findCommunitiesBySlug, slugifyCommunityName } from './chambers.js'

const NORMALIZED_HASHTAG_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/
const NORMALIZED_MENTION_HANDLE_REGEX = /^[a-z0-9_]{3,32}$/

type BaseTextEntityToken = {
  raw: string
  start: number
  end: number
}

export type TextHashtagToken = BaseTextEntityToken & {
  kind: 'hashtag'
  slug: string
  target: 'community' | 'topic'
}

export type TextMentionToken = BaseTextEntityToken & {
  kind: 'mention'
  handle: string
}

export type TextEntityToken = TextHashtagToken | TextMentionToken

function isWordBoundaryCharacter(value: string | undefined) {
  return Boolean(value && /[A-Za-z0-9_]/.test(value))
}

function isHashtagCharacter(value: string | undefined) {
  return Boolean(value && /[A-Za-z0-9_-]/.test(value)) || value === '—' || value === '–'
}

function isMentionCharacter(value: string | undefined) {
  return Boolean(value && /[A-Za-z0-9_]/.test(value))
}

export function normalizeHashtagSlug(value: string): string | null {
  const raw = value.replace(/^#/, '').trim()
  if (!raw) return null

  const normalized = slugifyCommunityName(raw)
  if (!normalized) return null
  if (!NORMALIZED_HASHTAG_SLUG_REGEX.test(normalized)) return null

  return normalized
}

export function normalizeMentionHandle(value: string): string | null {
  const raw = value.replace(/^@/, '').trim().toLowerCase()
  if (!raw) return null
  if (!NORMALIZED_MENTION_HANDLE_REGEX.test(raw)) return null
  return raw
}

export function isKnownCommunitySlug(value: string): boolean {
  const normalized = normalizeHashtagSlug(value)
  if (!normalized) return false
  return findCommunitiesBySlug(normalized).length > 0
}

export function resolveHashtagTarget(value: string): 'community' | 'topic' {
  return isKnownCommunitySlug(value) ? 'community' : 'topic'
}

export function tokenizeTextEntities(text: string): TextEntityToken[] {
  const tokens: TextEntityToken[] = []

  for (let index = 0; index < text.length; index += 1) {
    const symbol = text[index]
    if (symbol !== '#' && symbol !== '@') continue
    if (isWordBoundaryCharacter(index > 0 ? text[index - 1] : undefined)) continue

    let end = index + 1
    if (symbol === '#') {
      while (end < text.length && isHashtagCharacter(text[end])) {
        end += 1
      }
      if (end === index + 1) continue

      const raw = text.slice(index, end)
      const slug = normalizeHashtagSlug(raw)
      if (!slug) continue

      tokens.push({
        kind: 'hashtag',
        raw,
        start: index,
        end,
        slug,
        target: resolveHashtagTarget(slug),
      })
      index = end - 1
      continue
    }

    while (end < text.length && isMentionCharacter(text[end])) {
      end += 1
    }
    if (end === index + 1) continue

    const raw = text.slice(index, end)
    const handle = normalizeMentionHandle(raw)
    if (!handle) continue

    tokens.push({
      kind: 'mention',
      raw,
      start: index,
      end,
      handle,
    })
    index = end - 1
  }

  return tokens
}

export function extractTextTagging(
  text: string,
  options: {
    hashtags?: string[] | null | undefined
  } = {},
) {
  const topicSlugs = new Set<string>()
  const communitySlugs = new Set<string>()
  const mentionHandles = new Set<string>()
  const tokens = tokenizeTextEntities(text)

  for (const token of tokens) {
    if (token.kind === 'hashtag') {
      if (token.target === 'community') communitySlugs.add(token.slug)
      else topicSlugs.add(token.slug)
      continue
    }

    mentionHandles.add(token.handle)
  }

  for (const hashtag of options.hashtags ?? []) {
    const slug = normalizeHashtagSlug(hashtag)
    if (!slug) continue
    if (resolveHashtagTarget(slug) === 'community') communitySlugs.add(slug)
    else topicSlugs.add(slug)
  }

  return {
    tokens,
    topicSlugs: [...topicSlugs],
    communitySlugs: [...communitySlugs],
    mentionHandles: [...mentionHandles],
  }
}
