"use client"

import { create } from 'zustand'
import type { MeResponse } from './me'

type ViewerState = {
  me: MeResponse | null
  hydrated: boolean
  setMe: (me: MeResponse | null) => void
  setHydrated: (hydrated: boolean) => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  me: null,
  hydrated: false,
  setMe: (me) => set({ me }),
  setHydrated: (hydrated) => set({ hydrated }),
}))
