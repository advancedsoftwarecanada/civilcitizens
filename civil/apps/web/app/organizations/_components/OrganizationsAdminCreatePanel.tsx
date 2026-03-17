'use client'

import type { ReactNode } from 'react'
import type { CommunityOption } from './communityOptions'

type Props = {
  title: string
  description: string
  status: 'loading' | 'ready' | 'unauthorized' | 'error'
  options: CommunityOption[]
  selectedKey: string
  onSelectedKeyChange: (value: string) => void
  emptyMessage: string
  errorMessage: string
  unauthorizedMessage?: string
  children?: ReactNode
}

export default function OrganizationsAdminCreatePanel({
  title,
  description,
  status,
  options,
  selectedKey,
  onSelectedKeyChange,
  emptyMessage,
  errorMessage,
  unauthorizedMessage = 'Please sign in to continue.',
  children,
}: Props) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Organizations</p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>

      {status === 'loading' ? <div className="mt-6 h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {status === 'unauthorized' ? <p className="mt-6 text-sm text-slate-600">{unauthorizedMessage}</p> : null}
      {status === 'error' ? <p className="mt-6 text-sm text-slate-600">{errorMessage}</p> : null}

      {status === 'ready' ? (
        <div className="mt-6 space-y-4">
          {options.length ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Community
              <select
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-[var(--cc-primary)] focus:outline-none"
                value={selectedKey}
                onChange={(event) => onSelectedKeyChange(event.target.value)}
              >
                {options.map((option) => {
                  const key = `${option.provinceCode}:${option.communitySlug}`
                  const label = `${option.communityName} (${option.provinceName})${option.isHome ? ' · Home' : ''}`
                  return (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  )
                })}
              </select>
            </label>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">{emptyMessage}</div>
          )}

          {options.length ? children : null}
        </div>
      ) : null}
    </section>
  )
}