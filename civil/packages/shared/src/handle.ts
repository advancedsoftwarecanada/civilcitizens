const MAX_HANDLE_BASE_LENGTH = 20

export function sanitizeHandleSegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase()
}

export function buildHandleBase(firstName: string, lastName: string): string {
  const first = sanitizeHandleSegment(firstName)
  const last = sanitizeHandleSegment(lastName)
  const combined = `${first}${last}`.slice(0, MAX_HANDLE_BASE_LENGTH)

  if (combined.length >= 3) {
    return combined
  }

  const fallback = (first || last || 'citizen').toLowerCase().slice(0, MAX_HANDLE_BASE_LENGTH)
  if (fallback.length >= 3) {
    return fallback
  }

  return 'citizen'
}

export function getMaxHandleBaseLength() {
  return MAX_HANDLE_BASE_LENGTH
}
