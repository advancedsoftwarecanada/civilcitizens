const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api'
const RAW_PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? ''

const sanitizeBase = (base: string) => {
  if (!base) return ''
  if (base === '/') return ''
  return base.replace(/\/+$/, '')
}

const ABSOLUTE_URL_REGEX = /^https?:\/\//i

export const API_BASE = sanitizeBase(RAW_API_BASE)
const PUBLIC_BASE_URL = sanitizeBase(RAW_PUBLIC_BASE_URL)

const isServer = typeof window === 'undefined'

export const buildApiUrl = (path: string): string => {
  if (ABSOLUTE_URL_REGEX.test(path)) {
    return path
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE) {
    return normalizedPath
  }

  // In production we often set `NEXT_PUBLIC_API_BASE` to a relative path (e.g. `/api`) and rely on
  // ingress/proxy routing. During server-side rendering, a relative fetch would hit the web pod
  // itself (which typically does not serve `/api/*`), so we expand it to an absolute URL when we can.
  if (isServer && API_BASE.startsWith('/') && PUBLIC_BASE_URL && ABSOLUTE_URL_REGEX.test(PUBLIC_BASE_URL)) {
    return `${PUBLIC_BASE_URL}${API_BASE}${normalizedPath}`
  }

  if (API_BASE.endsWith('/') && normalizedPath.startsWith('/')) {
    return `${API_BASE.slice(0, -1)}${normalizedPath}`
  }
  return `${API_BASE}${normalizedPath}`
}

export const parseApiResponse = async <T = unknown>(response: Response): Promise<{ json: T | null; text: string | null }> => {
  try {
    const json = (await response.clone().json()) as T
    return { json, text: null }
  } catch {
    try {
      const text = await response.text()
      return { json: null, text: text.trim() || null }
    } catch {
      return { json: null, text: null }
    }
  }
}
