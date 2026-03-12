'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import type { IconType } from 'react-icons'

export type CivilPostActionItem = {
  key: string
  label: string
  icon: IconType
  href?: string
  onClick?: () => void
  ariaLabel?: string
  disabled?: boolean
}

type CivilPostActionsProps = {
  leading?: ReactNode
  actions: CivilPostActionItem[]
}

const actionClassName =
  'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900'

export default function CivilPostActions({ leading, actions }: CivilPostActionsProps) {
  return (
    <footer className="space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
      {leading ? <div className="flex w-full justify-center sm:justify-start">{leading}</div> : null}
      <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
        {actions.map((action) => {
          const Icon = action.icon
          if (action.href) {
            return (
              <Link
                key={action.key}
                href={action.href}
                className={clsx(actionClassName, action.disabled && 'pointer-events-none opacity-60')}
                aria-label={action.ariaLabel}
              >
                <Icon className="h-4 w-4" />
                <span>{action.label}</span>
              </Link>
            )
          }

          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={clsx(actionClassName, action.disabled && 'cursor-not-allowed opacity-60')}
              aria-label={action.ariaLabel}
              disabled={action.disabled}
            >
              <Icon className="h-4 w-4" />
              <span>{action.label}</span>
            </button>
          )
        })}
      </div>
    </footer>
  )
}