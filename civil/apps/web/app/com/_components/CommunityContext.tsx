'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { CommunitySummary } from '../../_lib/community'

const CommunityContext = createContext<CommunitySummary | null>(null)

export function CommunityContextProvider({ value, children }: { value: CommunitySummary; children: ReactNode }) {
  const memoizedValue = useMemo(() => value, [value])
  return <CommunityContext.Provider value={memoizedValue}>{children}</CommunityContext.Provider>
}

export function useCommunity() {
  const ctx = useContext(CommunityContext)
  if (!ctx) {
    throw new Error('useCommunity must be used inside CommunityContextProvider')
  }
  return ctx
}
