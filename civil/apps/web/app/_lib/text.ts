export function formatDisplayName(input?: string | null) {
  if (!input) return ''
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ')
}
