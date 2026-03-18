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
  { key: 'family', label: 'Family', href: '/messages?inbox=family' },
  { key: 'friends', label: 'Friends', href: '/messages?inbox=friends' },
  { key: 'network', label: 'Network', href: '/messages?inbox=network' },
  { key: 'groups', label: 'Groups', href: '/messages?inbox=groups' },
  { key: 'market', label: 'Market', href: '/messages?inbox=market' },
]

type MessagesNavBlockProps = {
  active?: MessagesNavSection
  className?: string
  onActiveChange?: (next: MessagesNavSection) => void
  unreadCounts?: Partial<Record<MessagesNavSection, number>>
  visibleItems?: MessagesNavSection[]
  hrefOverrides?: Partial<Record<MessagesNavSection, string>>
  footerAction?: {
    label: string
    href: string
  }
}

export default function MessagesNavBlock({ active, className, onActiveChange, unreadCounts, visibleItems, hrefOverrides, footerAction }: MessagesNavBlockProps) {
  const [internalActive, setInternalActive] = useState<MessagesNavSection>(active ?? DEFAULT_MESSAGES_NAV_SECTION)
  const isControlled = typeof active === 'string'
  const allowedItems = useMemo(
    () => (Array.isArray(visibleItems) && visibleItems.length > 0 ? NAV_ITEMS.filter((item) => visibleItems.includes(item.key)) : NAV_ITEMS),
    [visibleItems],
  )

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
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Messages</h2>
        {footerAction ? (
          <Link
            href={footerAction.href}
            className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] transition hover:border-[var(--cc-primary)]/35 hover:bg-[var(--cc-primary)]/5"
          >
            {footerAction.label}
          </Link>
        ) : null}
      </div>
      <div className={clsx('grid gap-2', allowedItems.length >= 5 ? 'grid-cols-5' : allowedItems.length === 4 ? 'grid-cols-4' : allowedItems.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {allowedItems.map((item) => {
          const isActive = item.key === resolvedActive
          const unreadCount = Math.max(0, Number(unreadCounts?.[item.key] ?? 0) || 0)
          const displayLabel = unreadCount > 0 ? `(${unreadCount > 99 ? '99+' : unreadCount}) ${item.label}` : item.label
          return (
            <Link
              key={item.key}
              href={hrefOverrides?.[item.key] ?? item.href}
              onClick={() => handleSelect(item.key)}
              className={clsx(
                'relative inline-flex min-h-10 items-center justify-center rounded-xl border px-2 py-2 text-center text-[11px] font-semibold leading-tight transition',
                isActive
                  ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
              )}
            >
              {displayLabel}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
