'use client'

import type { ReactNode } from 'react'
import { useOrganization } from './OrganizationContext'
import { useCommunity } from './CommunityContext'

export default function OrganizationSection({
  title,
  description,
  children,
  variant = 'card',
}: {
  title?: string
  description?: string
  children?: ReactNode
  variant?: 'card' | 'plain'
}) {
  const organization = useOrganization()
  const community = useCommunity()

  const cleanTitle = typeof title === 'string' ? title.trim() : ''
  const cleanDescription = typeof description === 'string' ? description.trim() : ''
  const containerClassName =
    variant === 'plain'
      ? 'space-y-0'
      : 'rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'

  return (
    <div className={containerClassName}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {organization.name} · {community.municipalityName}
      </p>
      {cleanTitle ? <h2 className="mt-1 text-xl font-semibold text-slate-900">{cleanTitle}</h2> : null}
      {cleanDescription ? (
        <p className={cleanTitle ? 'mt-1 text-sm text-slate-500' : 'mt-2 text-sm text-slate-500'}>{cleanDescription}</p>
      ) : null}
      {children ? <div className="mt-6 space-y-4 text-sm text-slate-600">{children}</div> : null}
    </div>
  )
}
