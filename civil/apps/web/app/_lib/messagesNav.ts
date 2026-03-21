export type MessagesNavSection = 'friends' | 'family' | 'network' | 'market' | 'groups' | 'drivers'

export const MESSAGES_NAV_STORAGE_KEY = 'civil.messages.nav.active'
export const DEFAULT_MESSAGES_NAV_SECTION: MessagesNavSection = 'friends'

const MESSAGES_NAV_SECTIONS = new Set<MessagesNavSection>(['friends', 'family', 'network', 'market', 'groups', 'drivers'])

export function isMessagesNavSection(value: unknown): value is MessagesNavSection {
  return typeof value === 'string' && MESSAGES_NAV_SECTIONS.has(value as MessagesNavSection)
}

export function readStoredMessagesNavSection(): MessagesNavSection | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(MESSAGES_NAV_STORAGE_KEY)
  if (!raw) return null
  if (isMessagesNavSection(raw)) return raw
  try {
    const parsed = JSON.parse(raw) as { active?: unknown } | null
    return isMessagesNavSection(parsed?.active) ? parsed.active : null
  } catch {
    return null
  }
}

export function writeStoredMessagesNavSection(section: MessagesNavSection): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MESSAGES_NAV_STORAGE_KEY, JSON.stringify({ active: section }))
}
