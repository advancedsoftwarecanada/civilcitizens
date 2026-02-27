'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import Block from '../../_components/Block'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
import { buildCommunityPath } from '../../_lib/communityRoutes'
import type { CommunityOrganization } from '../../_lib/organizations'
import { useViewerStore } from '../../_lib/viewerStore'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { useCommunity } from './CommunityContext'
import { useOrganization } from './OrganizationContext'

const ORG_LINKS = [
  { key: 'posts', label: 'Posts', segment: '' },
  { key: 'events', label: 'Events', segment: 'events' },
  { key: 'jobs', label: 'Jobs', segment: 'jobs' },
  { key: 'shop', label: 'Shop', segment: 'shop' },
  { key: 'members', label: 'Members', segment: 'members' },
  { key: 'chat-channels', label: 'Chat Channels', segment: 'chat-channels' },
  { key: 'settings', label: 'Settings', segment: 'settings' },
] as const

type MeResponse = {
  id: string
}

type Props = {
  initialOrg: CommunityOrganization | null
  province: string
  municipality: string
}

export default function OrganizationRightColumn({ initialOrg, province, municipality }: Props) {
  const pathname = usePathname()
  const community = useCommunity()
  const organization = useOrganization()
  const cachedMe = useViewerStore((s) => s.me)

  const [org, setOrg] = useState<CommunityOrganization | null>(initialOrg)
  const [me, setMe] = useState<MeResponse | null>(null)

  const isOwner = Boolean(me?.id && org?.ownerId && me.id === org.ownerId)
  const canManageShop = Boolean(org?.viewerRole === 'OWNER' || org?.viewerRole === 'MANAGER' || isOwner)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    if (cachedMe?.id) {
      setMe({ id: cachedMe.id })
    }

    const load = async () => {
      try {
        const orgPromise = fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization.slug)}`,
          ),
          { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
        )

        if (!cachedMe) {
          const payload = await ensureViewerMe({ token })
          if (payload?.id) setMe({ id: payload.id })
        }

        const orgRes = await orgPromise
        if (orgRes.ok) {
          const payload = (await orgRes.json().catch(() => null)) as { org?: CommunityOrganization } | null
          if (payload?.org) setOrg(payload.org)
        }
      } catch {
        // ignore
      }
    }

    void load()
  }, [cachedMe, municipality, organization.slug, province])

  const basePath = useMemo(
    () =>
      buildCommunityPath({
        province: community.provinceCode,
        municipality: community.municipalitySlug,
        segment: 'orgs',
        remainder: [organization.slug],
      }),
    [community.municipalitySlug, community.provinceCode, organization.slug],
  )

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
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {org?.isVerified ? (
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600">Verified</span>
          ) : null}
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/70">
          {ORG_LINKS.map((link) => {
            if (link.key === 'settings' && !isOwner) return null
            const href = link.segment ? `${basePath}/${link.segment}` : basePath
            const active =
              link.key === 'posts'
                ? pathname === basePath || pathname === `${basePath}/posts` || pathname?.startsWith(`${basePath}/posts/`)
                : pathname === href || (link.segment && pathname?.startsWith(`${href}`))

            if (link.key === 'shop' && canManageShop) {
              const manageHref = `${basePath}/shop/manage`
              const manageActive = pathname === manageHref || pathname?.startsWith(`${manageHref}`) || pathname?.startsWith(`${basePath}/shop/new`)

              return (
                <Fragment key={link.key}>
                  <Link
                    href={href}
                    className={clsx(
                      'flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors',
                      'border-b border-slate-100',
                      active ? 'bg-white text-[var(--cc-primary)]' : 'text-slate-700 hover:bg-white hover:text-slate-900',
                    )}
                  >
                    <span>{link.label}</span>
                  </Link>
                  <Link
                    href={manageHref}
                    className={clsx(
                      'flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors',
                      'border-b border-slate-100',
                      manageActive ? 'bg-white text-[var(--cc-primary)]' : 'text-slate-700 hover:bg-white hover:text-slate-900',
                    )}
                  >
                    <span>Manage Shop</span>
                  </Link>
                </Fragment>
              )
            }

            return (
              <Link
                key={link.key}
                href={href}
                className={clsx(
                  'flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors',
                  'border-b border-slate-100 last:border-b-0',
                  active ? 'bg-white text-[var(--cc-primary)]' : 'text-slate-700 hover:bg-white hover:text-slate-900',
                )}
              >
                <span>{link.label}</span>
              </Link>
            )
          })}
        </div>
      </Block>
    </div>
  )
}
