const MEETING_ROOM_PATH_RE = /^\/com\/[^/]+\/[^/]+\/orgs\/[^/]+\/meetings\/[^/]+\/?$/i

export function isMeetingRoomPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const normalized = pathname.split('?')[0]?.split('#')[0] || ''
  if (!normalized) return false
  if (normalized.includes('/meetings/manage')) return false
  return MEETING_ROOM_PATH_RE.test(normalized)
}

