'use client'

import { useViewerStore } from './viewerStore'

export const FAMILY_VIEW_STORAGE_KEY = 'cc:family-view:v1'
export const FAMILY_VIEW_CHANGED_EVENT = 'civil:family-view-changed'

export type FamilyViewBand = 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'

export type FamilyViewState = {
  memberId: string
  displayName: string
  modeBand: FamilyViewBand
  modeLabel: string
  age: number
  relationshipLabel: string
  suspended: boolean
  suspendedAt: string | null
  suspensionNote: string | null
}

function emitFamilyViewChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FAMILY_VIEW_CHANGED_EVENT))
}

export function readStoredFamilyView(): FamilyViewState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(FAMILY_VIEW_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FamilyViewState | null
    if (!parsed || typeof parsed !== 'object' || !parsed.memberId || !parsed.displayName) return null
    return parsed
  } catch {
    return null
  }
}

export function activateFamilyView(next: FamilyViewState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FAMILY_VIEW_STORAGE_KEY, JSON.stringify(next))
  useViewerStore.getState().setFamilyView(next)
  emitFamilyViewChanged()
}

export function clearFamilyView() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(FAMILY_VIEW_STORAGE_KEY)
  useViewerStore.getState().setFamilyView(null)
  emitFamilyViewChanged()
}