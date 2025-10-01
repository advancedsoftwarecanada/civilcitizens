export type AuthModalType = 'login' | 'register' | 'forgot'

const AUTH_MODAL_STORAGE_KEY = 'cc:queued-auth-modal'

const AUTH_MODAL_EVENT_MAP: Record<AuthModalType, string> = {
  login: 'openLoginModal',
  register: 'openRegisterModal',
  forgot: 'openForgotModal',
}

const isAuthModalType = (value: string | null): value is AuthModalType =>
  value === 'login' || value === 'register' || value === 'forgot'

const setQueuedAuthModal = (type: AuthModalType) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(AUTH_MODAL_STORAGE_KEY, type)
  } catch {
    /* ignore storage issues */
  }
}

export const consumeQueuedAuthModal = (): AuthModalType | null => {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(AUTH_MODAL_STORAGE_KEY)
    window.sessionStorage.removeItem(AUTH_MODAL_STORAGE_KEY)
    return isAuthModalType(stored) ? stored : null
  } catch {
    return null
  }
}

export const openAuthModal = (type: AuthModalType) => {
  if (typeof window === 'undefined') return
  const eventName = AUTH_MODAL_EVENT_MAP[type]
  window.dispatchEvent(new CustomEvent(eventName))
}

export const redirectToAuthModal = (type: AuthModalType) => {
  if (typeof window === 'undefined') return
  const currentPath = window.location.pathname
  if (currentPath === '/') {
    // Delay to ensure listeners are ready on the landing page
    window.requestAnimationFrame(() => openAuthModal(type))
    return
  }
  setQueuedAuthModal(type)
  window.location.replace('/')
}

export const queueAuthModal = (type: AuthModalType) => {
  if (typeof window === 'undefined') return
  setQueuedAuthModal(type)
}
