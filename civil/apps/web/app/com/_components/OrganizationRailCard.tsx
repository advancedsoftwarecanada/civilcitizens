'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import Block from '../../_components/Block'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
import type { CommunityOrganization } from '../../_lib/organizations'
import { getStoredToken } from '../../_lib/tokenStorage'
import { useViewerStore } from '../../_lib/viewerStore'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { ORGANIZATION_RIGHT_RAIL_LINKS } from './organizationRailLinks'

type MeResponse = {
  id: string
}

type GovernanceStateResponse = {
  viewer?: {
    permissions?: string[]
  }
}

type Props = {
  pathname: string | null | undefined
  basePath: string
  province: string
  municipality: string
  organizationSlug: string
  organizationName: string
  initialOrg?: CommunityOrganization | null
  onNavigate?: () => void
}

export default function OrganizationRailCard({
  pathname,
  basePath,
  province,
  municipality,
  organizationSlug,
  organizationName,
  initialOrg = null,
  onNavigate,
}: Props) {
  const cachedMe = useViewerStore((s) => s.me)
  const [org, setOrg] = useState<CommunityOrganization | null>(initialOrg)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [viewerPermissions, setViewerPermissions] = useState<string[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [tokenReady, setTokenReady] = useState(false)

  const isOwner = Boolean(me?.id && org?.ownerId && me.id === org.ownerId)
  const canManageSettings = useMemo(() => {
    if (org?.viewerRole === 'OWNER' || org?.viewerRole === 'MANAGER' || isOwner) return true
    return viewerPermissions.length > 0
  }, [isOwner, org?.viewerRole, viewerPermissions])

  useEffect(() => {
    setToken(getStoredToken())
    setTokenReady(true)
  }, [])

  useEffect(() => {
    if (!tokenReady) return
    let cancelled = false

    if (cachedMe?.id) {
      setMe({ id: cachedMe.id })
    }

    const load = async () => {
      try {
        const headers = token ? { authorization: `Bearer ${token}` } : undefined

        const orgPromise = fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organizationSlug)}`,
          ),
          { headers, cache: 'no-store' },
        )

        const governancePromise = token
          ? fetch(
              buildApiUrl(
                `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organizationSlug)}/governance/state`,
              ),
              { headers, cache: 'no-store' },
            )
          : Promise.resolve(null)

        if (token && !cachedMe) {
          const payload = await ensureViewerMe({ token })
          if (!cancelled && payload?.id) {
            setMe({ id: payload.id })
          }
        }

        const orgRes = await orgPromise
        if (!cancelled && orgRes.ok) {
          const payload = (await orgRes.json().catch(() => null)) as { org?: CommunityOrganization } | null
          if (payload?.org) setOrg(payload.org)
        }

        const governanceRes = await governancePromise
        if (!cancelled && governanceRes?.ok) {
          const payload = (await governanceRes.json().catch(() => null)) as GovernanceStateResponse | null
          const permissions = Array.isArray(payload?.viewer?.permissions) ? payload.viewer.permissions : []
          setViewerPermissions(permissions.filter((value): value is string => typeof value === 'string'))
        }
      } catch {
        // Keep the rail usable with any data we already have.
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [cachedMe, municipality, organizationSlug, province, token, tokenReady])

  const resolvedName = org?.name ?? organizationName

  return (
    <div className="space-y-6">
      <Block title="Organization">
        {org?.coverUrl ? (
          <Link href={basePath} onClick={onNavigate} className="mb-4 block">
            <img
              src={org.coverUrl}
              alt={`${resolvedName} cover`}
              className="h-24 w-full rounded-2xl border border-slate-200 object-cover transition-opacity hover:opacity-95"
            />
          </Link>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <VerifiedAvatar
              src={org?.logoUrl ?? null}
              alt={resolvedName}
              initials={resolvedName}
              size={44}
              isVerified={Boolean(org?.isVerified)}
              className="shrink-0"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{resolvedName}</p>
              <p className="mt-0.5 text-xs text-slate-500">{org?.followerCount ?? 0} followers</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {org?.isVerified ? (
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600">Verified</span>
          ) : null}
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/70">
          {ORGANIZATION_RIGHT_RAIL_LINKS.map((link) => {
            if (link.key === 'settings' && !canManageSettings) return null
            const href = link.segment ? `${basePath}/${link.segment}` : basePath
            const active =
              link.key === 'posts'
                ? pathname === basePath || pathname === `${basePath}/posts` || pathname?.startsWith(`${basePath}/posts/`)
                : pathname === href || (link.segment && pathname?.startsWith(`${href}`))

            return (
              <Link
                key={link.key}
                href={href}
                onClick={onNavigate}
                className={clsx(
                  'flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm font-semibold transition-colors last:border-b-0',
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
