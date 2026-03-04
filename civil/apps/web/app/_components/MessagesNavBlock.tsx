'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_MESSAGES_NAV_SECTION,
  readStoredMessagesNavSection,
  writeStoredMessagesNavSection,
  type MessagesNavSection,
} from '../_lib/messagesNav'

const NAV_ITEMS: Array<{ key: MessagesNavSection; label: string; href: string }> = [
  { key: 'friends', label: 'Friends', href: '/messages?inbox=friends' },
  { key: 'network', label: 'Network', href: '/messages?inbox=network' },
  { key: 'market', label: 'Market', href: '/market/chats' },
  { key: 'groups', label: 'Groups', href: '/messages?inbox=groups' },
]

type MessagesNavBlockProps = {
  active?: MessagesNavSection
  className?: string
  onActiveChange?: (next: MessagesNavSection) => void
  unreadCounts?: Partial<Record<MessagesNavSection, number>>
}

export default function MessagesNavBlock({ active, className, onActiveChange, unreadCounts }: MessagesNavBlockProps) {
  const [internalActive, setInternalActive] = useState<MessagesNavSection>(active ?? DEFAULT_MESSAGES_NAV_SECTION)
  const isControlled = typeof active === 'string'

  useEffect(() => {
    if (isControlled) return
    const stored = readStoredMessagesNavSection()
    if (stored) {
      setInternalActive(stored)
    }
  }, [isControlled])

  const resolvedActive = useMemo(
    () => (isControlled ? (active as MessagesNavSection) : internalActive),
    [active, internalActive, isControlled],
  )

  const handleSelect = (next: MessagesNavSection) => {
    writeStoredMessagesNavSection(next)
    if (!isControlled) {
      setInternalActive(next)
    }
    onActiveChange?.(next)
  }

  return (
    <section className={clsx('surface-card p-4', className)}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Messages</h2>
      <div className="grid grid-cols-4 gap-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === resolvedActive
          const unreadCount = Math.max(0, Number(unreadCounts?.[item.key] ?? 0) || 0)
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => handleSelect(item.key)}
              className={clsx(
                'relative inline-flex min-h-10 items-center justify-center rounded-xl border px-2 py-2 text-center text-[11px] font-semibold leading-tight transition',
                isActive
                  ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
              )}
            >
              {item.label}
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
