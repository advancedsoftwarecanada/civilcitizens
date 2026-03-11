"use client"

import { create } from 'zustand'
import type { MeResponse } from './me'
import type { FamilyViewState } from './familyView'

type ViewerState = {
  me: MeResponse | null
  hydrated: boolean
  familyView: FamilyViewState | null
  setMe: (me: MeResponse | null) => void
  setHydrated: (hydrated: boolean) => void
  setFamilyView: (familyView: FamilyViewState | null) => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  me: null,
  hydrated: false,
  familyView: null,
  setMe: (me) => set({ me }),
  setHydrated: (hydrated) => set({ hydrated }),
  setFamilyView: (familyView) => set({ familyView }),
}))
