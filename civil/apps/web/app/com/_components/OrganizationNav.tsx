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
  { key: 'settings', label: 'Settings', segment: 'settings' },
]

export default function OrganizationNav() {
  return <OrganizationNavSidebar />
}

function OrganizationNavSidebar() {
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
    <nav aria-label="Organization navigation" className="surface-card overflow-hidden shadow-subtle">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Organization</p>
      </div>

      <div className="flex flex-col">
        {ORG_LINKS.map((link) => {
          const href = link.segment ? `${basePath}/${link.segment}` : basePath
          const active = pathname === href || (link.segment && pathname?.startsWith(`${href}`))

          return (
            <Link
              key={link.key}
              href={href}
              className={clsx(
                'flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors',
                'border-b border-slate-100 last:border-b-0',
                active ? 'bg-slate-50 text-[var(--cc-primary)]' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <span>{link.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
