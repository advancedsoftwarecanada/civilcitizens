function isPrivateIpv4Address(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false

  const octets = match.slice(1).map((part) => Number(part))
  if (octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false

  const [first, second] = octets
  if (first === 10 || first === 127) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 169 && second === 254) return true
  return false
}

function isInternalHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true

  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === 'host.docker.internal' ||
    normalized === 'example.com' ||
    normalized === 'www.example.com' ||
    normalized === 'example.org' ||
    normalized === 'www.example.org' ||
    normalized === 'example.net' ||
    normalized === 'www.example.net'
  ) {
    return true
  }

  if (isPrivateIpv4Address(normalized)) return true
  if (normalized.endsWith('.local') || normalized.endsWith('.internal') || normalized.endsWith('.lan')) return true
  if (!normalized.includes('.')) return true
  return false
}

function shouldAllowHttpUrl(preferredBaseUrl?: string | null) {
  return typeof preferredBaseUrl === 'string' && preferredBaseUrl.startsWith('http://')
}

export function resolvePublicAssetUrl(rawUrl: string | null | undefined, preferredBaseUrl?: string | null): string | null {
  if (typeof rawUrl !== 'string') return null

  const trimmed = rawUrl.trim()
  if (!trimmed || trimmed.startsWith('//')) return null

  if (!/^https?:\/\//i.test(trimmed)) {
    if (preferredBaseUrl) {
      try {
        return new URL(trimmed, preferredBaseUrl).toString()
      } catch {
        return null
      }
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.protocol === 'http:' && !shouldAllowHttpUrl(preferredBaseUrl)) return null
    if (isInternalHostname(parsed.hostname)) return null
    return parsed.toString()
  } catch {
    return null
  }
}