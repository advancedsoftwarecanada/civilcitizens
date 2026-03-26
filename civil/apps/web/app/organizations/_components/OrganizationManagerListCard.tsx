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
    <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-subtle">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {items.length}
        </span>
      </div>
      <div className="mt-4">
        {items.length ? (
          <ul className="space-y-3">
            {items.slice(0, 25).map((org) => (
              <li key={org.id}>
                <CivilCard
                  href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                  size="rail"
                  name={org.name}
                  avatarAlt={org.name}
                  avatarInitials={org.name}
                  avatarSrc={org.logoUrl ?? null}
                  coverUrl={org.coverUrl ?? null}
                  isVerified={Boolean(org.isVerified)}
                  subtitle={org.status ? org.status.replace(/_/g, ' ') : null}
                  className="w-full"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        )}
      </div>
    </section>
  )
}