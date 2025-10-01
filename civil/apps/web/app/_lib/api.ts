const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api'

const sanitizeBase = (base: string) => {
  if (!base) return ''
  if (base === '/') return ''
  return base.replace(/\/+$/, '')
}

const ABSOLUTE_URL_REGEX = /^https?:\/\//i

export const API_BASE = sanitizeBase(RAW_API_BASE)

export const buildApiUrl = (path: string): string => {
  if (ABSOLUTE_URL_REGEX.test(path)) {
    return path
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE) {
    return normalizedPath
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
