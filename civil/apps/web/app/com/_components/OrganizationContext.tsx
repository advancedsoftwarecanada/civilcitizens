'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export type OrganizationSummary = {
  slug: string
  name: string
}

const OrganizationContext = createContext<OrganizationSummary | null>(null)

export function OrganizationContextProvider({ value, children }: { value: OrganizationSummary; children: ReactNode }) {
  const memo = useMemo(() => value, [value])
  return <OrganizationContext.Provider value={memo}>{children}</OrganizationContext.Provider>
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext)
  if (!ctx) {
    throw new Error('useOrganization must be used inside OrganizationContextProvider')
  }
  return ctx
}
