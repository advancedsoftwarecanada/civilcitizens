"use client"

import { create } from 'zustand'

type InviteViewState = {
  inviteGuestMode: boolean | null
  setInviteGuestMode: (value: boolean | null) => void
}

export const useInviteViewStore = create<InviteViewState>((set) => ({
  inviteGuestMode: null,
  setInviteGuestMode: (value) => set({ inviteGuestMode: value }),
}))
