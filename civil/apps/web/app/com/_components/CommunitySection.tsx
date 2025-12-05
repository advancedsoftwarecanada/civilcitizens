'use client'

import type { ReactNode } from 'react'
import { useCommunity } from './CommunityContext'

export default function CommunitySection({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  const community = useCommunity()

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{community.municipalityName}</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
        {children ? <div className="mt-6 space-y-4 text-sm text-slate-600">{children}</div> : null}
      </div>
    </div>
  )
}
