'use client'

import CivilCard from '../../_components/CivilCard'
import type { OrganizationManagerRow } from '../_hooks/useOrganizationsManagerData'

type Props = {
  title: string
  emptyMessage: string
  items: OrganizationManagerRow[]
}

export default function OrganizationManagerListCard({ title, emptyMessage, items }: Props) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-subtle">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">
        {items.length ? (
          <ul className="space-y-2">
            {items.slice(0, 25).map((org) => (
              <li key={org.id}>
                <CivilCard
                  href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                  size="md"
                  name={org.name}
                  avatarAlt={org.name}
                  avatarInitials={org.name}
                  avatarSrc={org.logoUrl ?? null}
                  coverUrl={org.coverUrl ?? null}
                  isVerified={Boolean(org.isVerified)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        )}
      </div>
    </div>
  )
}