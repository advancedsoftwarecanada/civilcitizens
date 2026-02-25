'use client'

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
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
  province,
  municipality,
  slug,
}: {
  org: CommunityOrganization | null
  fallbackName: string
  province: string
  municipality: string
  slug: string
}) {
  const [resolvedOrg, setResolvedOrg] = useState<CommunityOrganization | null>(org)

  useEffect(() => {
    if (resolvedOrg) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
          ),
          { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
        )
        if (!res.ok) return
        const payload = (await res.json().catch(() => null)) as { org?: CommunityOrganization } | null
        if (!cancelled && payload?.org) setResolvedOrg(payload.org)
      } catch {
        // ignore
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [municipality, province, resolvedOrg, slug])

  const name = resolvedOrg?.name ?? fallbackName
  const coverDisplayUrl = resolvedOrg?.coverUrl ?? null
  const createdLabel = formatShortDate(resolvedOrg?.createdAt)

  return (
    <div className={resolvedOrg ? 'space-y-0' : undefined}>
      <section className="relative rounded-[36px] rounded-b-none border border-white/60 bg-white/40 shadow-subtle">
        <div className="relative h-48 w-full overflow-hidden rounded-t-[36px] sm:h-60">
          {coverDisplayUrl ? (
            <>
              <img src={coverDisplayUrl} alt={`${name} cover`} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/20" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-r from-rose-100 via-violet-50 to-sky-100" />
          )}
        </div>
      </section>

      <section
        className={clsx(
          'rounded-[32px] border border-white/60 bg-white/80 p-6 text-slate-700 shadow-subtle backdrop-blur sm:p-8',
          resolvedOrg && 'rounded-t-none border-t-0',
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
                src={resolvedOrg?.logoUrl}
                alt={name}
                initials={name}
                size={96}
                isVerified={Boolean(resolvedOrg?.isVerified)}
                isBusiness
                className="relative border-4 border-white"
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{name}</h1>
              {resolvedOrg?.slug ? (
                <p className="text-sm text-slate-500">
                  @{resolvedOrg.slug} · Created {createdLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
