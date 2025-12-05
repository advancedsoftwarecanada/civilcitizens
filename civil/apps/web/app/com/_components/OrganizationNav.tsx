'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { buildCommunityPath } from '../../_lib/communityRoutes'
import { useCommunity } from './CommunityContext'
import { useOrganization } from './OrganizationContext'

const ORG_LINKS = [
  { key: 'overview', label: 'Overview', segment: '' },
  { key: 'posts', label: 'Posts', segment: 'posts' },
  { key: 'events', label: 'Events', segment: 'events' },
  { key: 'jobs', label: 'Jobs', segment: 'jobs' },
  { key: 'gigs', label: 'Gigs', segment: 'gigs' },
  { key: 'discussions', label: 'Discussions', segment: 'discussions' },
]

export default function OrganizationNav() {
  const pathname = usePathname()
  const community = useCommunity()
  const organization = useOrganization()

  const basePath = buildCommunityPath({
    province: community.provinceCode,
    municipality: community.municipalitySlug,
    segment: 'orgs',
    remainder: [organization.slug],
  })

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl gap-2 overflow-x-auto px-4 sm:px-8">
        {ORG_LINKS.map((link) => {
          const href = link.segment ? `${basePath}/${link.segment}` : basePath
          const active = pathname === href || (link.segment && pathname?.startsWith(`${href}`))
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
