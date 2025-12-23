'use client'

import clsx from 'clsx'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import type { CommunityOrganization } from '../../_lib/organizations'

function formatShortDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OrganizationHeader({
  org,
  fallbackName,
}: {
  org: CommunityOrganization | null
  fallbackName: string
}) {
  const name = org?.name ?? fallbackName
  const coverDisplayUrl = org?.coverUrl ?? null
  const createdLabel = formatShortDate(org?.createdAt)

  return (
    <div className={org ? 'space-y-0' : undefined}>
      <section className="relative rounded-[36px] rounded-b-none border border-white/60 bg-white/40 shadow-[0_35px_120px_rgba(15,23,42,0.12)]">
        <div className="relative h-48 w-full overflow-hidden rounded-t-[36px] sm:h-60">
          {coverDisplayUrl ? (
            <>
              <img src={coverDisplayUrl} alt={`${name} cover`} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/20" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-r from-[#fde2d7] via-[#f7f0ff] to-[#dff3ff]" />
          )}
        </div>
      </section>

      <section
        className={clsx(
          'rounded-[32px] border border-white/60 bg-white/80 p-6 text-slate-700 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8',
          org && 'rounded-t-none border-t-0',
        )}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-200 via-amber-100 to-sky-200 blur-lg"
                aria-hidden="true"
              />
              <VerifiedAvatar
                src={org?.logoUrl}
                alt={name}
                initials={name}
                size={96}
                isVerified={Boolean(org?.isVerified)}
                isBusiness
                className="relative border-4 border-white"
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{name}</h1>
              {org?.slug ? (
                <p className="text-sm text-slate-500">
                  @{org.slug} · Created {createdLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
