import type { MeResponse } from './me'

const DEFAULT_ADMIN_EMAILS = (process.env.NEXT_PUBLIC_CIVIL_ADMIN_EMAILS || 'andrewnormore@gmail.com')
  .split(/[,;]/)
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

export function isEmailSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  return DEFAULT_ADMIN_EMAILS.includes(normalized)
}

export function isSuperAdmin(me: MeResponse | null | undefined): boolean {
  return isEmailSuperAdmin(me?.email)
}
