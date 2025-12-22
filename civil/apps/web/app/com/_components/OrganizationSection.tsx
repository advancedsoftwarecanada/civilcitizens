'use client'

import type { ReactNode } from 'react'
import { useOrganization } from './OrganizationContext'
import { useCommunity } from './CommunityContext'

export default function OrganizationSection({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  const organization = useOrganization()
  const community = useCommunity()

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {organization.name} · {community.municipalityName}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {children ? <div className="mt-6 space-y-4 text-sm text-slate-600">{children}</div> : null}
    </div>
  )
}
