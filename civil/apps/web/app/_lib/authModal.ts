export type AuthModalType = 'login' | 'register' | 'forgot'

import { buildPreferredLoginNextPath } from './pendingPushRedirect'

const AUTH_ROUTE_MAP: Record<AuthModalType, string> = {
  login: '/login',
  register: '/register',
  forgot: '/forgot',
}

const buildNextParam = () => {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname + window.location.search + window.location.hash
  if (!path || path === '/' || path.startsWith('/login')) {
    return buildPreferredLoginNextPath(null)
  }
  return buildPreferredLoginNextPath(path)
}

export const redirectToAuthModal = (type: AuthModalType) => {
  if (typeof window === 'undefined') return
  const targetPath = AUTH_ROUTE_MAP[type]
  if (!targetPath) return

  let nextQuery = ''
  if (type === 'login') {
    const next = buildNextParam()
    if (next) {
      const params = new URLSearchParams()
      params.set('next', next)
      nextQuery = `?${params.toString()}`
    }
  }

  window.location.assign(`${targetPath}${nextQuery}`)
}
