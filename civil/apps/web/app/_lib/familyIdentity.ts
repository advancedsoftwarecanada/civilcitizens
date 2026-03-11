import type { FamilyViewBand, FamilyViewState } from './familyView'
import type { MeResponse } from './me'

type FamilyIdentityViewer = Pick<MeResponse, 'name' | 'avatarUrl' | 'coverUrl'>

function toDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'C'
  const firstPart = parts[0]
  const lastPart = parts[parts.length - 1]
  if (parts.length === 1 && firstPart) return firstPart.slice(0, 2).toUpperCase()
  return `${firstPart?.charAt(0) ?? ''}${lastPart?.charAt(0) ?? ''}`.toUpperCase()
}

function paletteForBand(modeBand: FamilyViewBand) {
  if (modeBand === 'EARLY_CHILDHOOD') return { start: '#f97316', end: '#ea580c', accent: '#fde68a' }
  if (modeBand === 'JUNIOR') return { start: '#14b8a6', end: '#0f766e', accent: '#ccfbf1' }
  if (modeBand === 'TEEN') return { start: '#2563eb', end: '#1d4ed8', accent: '#bfdbfe' }
  if (modeBand === 'YOUTH') return { start: '#0891b2', end: '#155e75', accent: '#a5f3fc' }
  return { start: '#475569', end: '#0f172a', accent: '#cbd5e1' }
}

export function buildFamilyAvatarDataUrl(name: string, modeBand: FamilyViewBand) {
  const { start, end, accent } = paletteForBand(modeBand)
  const initials = initialsFromName(name)
  return toDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="${name}">
      <defs>
        <linearGradient id="avatarGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="80" fill="url(#avatarGradient)" />
      <circle cx="120" cy="42" r="20" fill="${accent}" fill-opacity="0.35" />
      <text x="80" y="95" text-anchor="middle" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="white">${initials}</text>
    </svg>
  `)
}

export function buildFamilyCoverDataUrl(name: string, modeBand: FamilyViewBand) {
  const { start, end, accent } = paletteForBand(modeBand)
  return toDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="320" viewBox="0 0 800 320" role="img" aria-label="${name}">
      <defs>
        <linearGradient id="coverGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="800" height="320" fill="url(#coverGradient)" />
      <circle cx="120" cy="88" r="88" fill="${accent}" fill-opacity="0.14" />
      <circle cx="698" cy="86" r="116" fill="#ffffff" fill-opacity="0.08" />
      <circle cx="612" cy="248" r="138" fill="#ffffff" fill-opacity="0.06" />
      <text x="54" y="276" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="white" fill-opacity="0.94">${name}</text>
    </svg>
  `)
}

export function getFamilyLockedCardIdentity(viewer: FamilyIdentityViewer | null | undefined, familyView: FamilyViewState | null | undefined) {
  if (familyView) {
    return {
      name: viewer?.name ?? familyView.displayName,
      subtitle: 'Locked device settings',
      href: '/settings/family/settings',
      avatarAlt: viewer?.name ?? familyView.displayName,
      avatarInitials: viewer?.name ?? familyView.displayName,
      avatarSrc: viewer?.avatarUrl ?? buildFamilyAvatarDataUrl(familyView.displayName, familyView.modeBand),
      coverUrl: viewer?.coverUrl ?? buildFamilyCoverDataUrl(familyView.displayName, familyView.modeBand),
      isVerified: false,
      isBusiness: false,
    }
  }

  return null
}