'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Block from '../../_components/Block'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
import type { CommunityOrganization } from '../../_lib/organizations'
import OrganizationFollowButton from './OrganizationFollowButton'
import { useCommunity } from './CommunityContext'
import { useOrganization } from './OrganizationContext'

type MeResponse = {
  id: string
}

type Props = {
  initialOrg: CommunityOrganization | null
  province: string
  municipality: string
}

export default function OrganizationRightColumn({ initialOrg, province, municipality }: Props) {
  const community = useCommunity()
  const organization = useOrganization()

  const [org, setOrg] = useState<CommunityOrganization | null>(initialOrg)
  const [me, setMe] = useState<MeResponse | null>(null)

  const isOwner = Boolean(me?.id && org?.ownerId && me.id === org.ownerId)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    const load = async () => {
      try {
        const [meRes, orgRes] = await Promise.all([
          fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } }),
          fetch(
            buildApiUrl(
              `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization.slug)}`,
            ),
            { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
          ),
        ])

        if (meRes.ok) {
          const payload = (await meRes.json().catch(() => null)) as MeResponse | null
          if (payload?.id) setMe(payload)
        }

        if (orgRes.ok) {
          const payload = (await orgRes.json().catch(() => null)) as { org?: CommunityOrganization } | null
          if (payload?.org) setOrg(payload.org)
        }
      } catch {
        // ignore
      }
    }

    void load()
  }, [municipality, organization.slug, province])

  const settingsHref = useMemo(() => {
    return `/com/${community.provinceCode.toLowerCase()}/${community.municipalitySlug.toLowerCase()}/orgs/${organization.slug}/settings`
  }, [community.municipalitySlug, community.provinceCode, organization.slug])

  return (
    <div className="space-y-6">
      <Block title="Organization">
        {org?.coverUrl ? (
          <img
            src={org.coverUrl}
            alt={`${org?.name ?? organization.name} cover`}
            className="mb-4 h-24 w-full rounded-2xl border border-slate-200 object-cover"
          />
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <VerifiedAvatar
              src={org?.logoUrl ?? null}
              alt={org?.name ?? organization.name}
              initials={org?.name ?? organization.name}
              size={44}
              isVerified={Boolean(org?.isVerified)}
              className="shrink-0"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{org?.name ?? organization.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {org?.followerCount ?? 0} followers
              </p>
            </div>
          </div>
          <OrganizationFollowButton
            province={province}
            municipality={municipality}
            slug={organization.slug}
            initialFollowed={org?.viewerFollowed ?? false}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {org?.isVerified ? (
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600">Verified</span>
          ) : null}
          {org?.status ? (
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600">{org.status}</span>
          ) : null}
        </div>

        {isOwner ? (
          <div className="mt-4">
            <Link href={settingsHref} className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">
              Settings
            </Link>
          </div>
        ) : null}
      </Block>
    </div>
  )
}
