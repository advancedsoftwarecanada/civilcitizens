'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { buildCommunityPath } from '../../_lib/communityRoutes'

const NAV_LINKS = [
  { key: 'posts', label: 'Posts', segment: 'posts' },
  { key: 'market', label: 'Market', segment: 'market' },
  { key: 'jobs', label: 'Jobs', segment: 'jobs' },
  { key: 'gigs', label: 'Gigs', segment: 'gigs' },
  { key: 'events', label: 'Events', segment: 'events' },
  { key: 'orgs', label: 'Organizations', segment: 'orgs' },
]

export default function CommunityNav({ province, municipality }: { province: string; municipality: string }) {
  const pathname = usePathname()

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl gap-2 overflow-x-auto px-4 sm:px-8">
        {NAV_LINKS.map((link) => {
          const href = buildCommunityPath({ province, municipality, segment: link.segment })
          const active = pathname?.startsWith(href)
          return (
            <Link
              key={link.key}
              href={href}
              className={clsx(
                'relative inline-flex items-center justify-center whitespace-nowrap border-b-2 px-3 py-4 text-sm font-semibold transition-colors',
                active
                  ? 'border-[var(--cc-primary)] text-[var(--cc-primary)]'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              {link.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
