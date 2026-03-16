'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type RegisteredRightRail = {
  id: string
  content: ReactNode
  showMobileInline: boolean
}

type RightRailRegistryValue = {
  activeRightRail: RegisteredRightRail | null
  registerRightRail: (entry: RegisteredRightRail) => void
  unregisterRightRail: (id: string) => void
}

const RightRailRegistryContext = createContext<RightRailRegistryValue | null>(null)

export function RightRailRegistryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<RegisteredRightRail[]>([])

  const registerRightRail = useCallback((entry: RegisteredRightRail) => {
    setEntries((current) => {
      const next = current.filter((item) => item.id !== entry.id)
      next.push(entry)
      return next
    })
  }, [])

  const unregisterRightRail = useCallback((id: string) => {
    setEntries((current) => current.filter((item) => item.id !== id))
  }, [])

  const value = useMemo<RightRailRegistryValue>(
    () => ({
      activeRightRail: entries.length ? entries[entries.length - 1] ?? null : null,
      registerRightRail,
      unregisterRightRail,
    }),
    [entries, registerRightRail, unregisterRightRail],
  )

  return <RightRailRegistryContext.Provider value={value}>{children}</RightRailRegistryContext.Provider>
}

export function useRightRailRegistry() {
  const value = useContext(RightRailRegistryContext)
  if (!value) {
    throw new Error('useRightRailRegistry must be used within a RightRailRegistryProvider')
  }
  return value
}