export function getStoredToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('token')
}
