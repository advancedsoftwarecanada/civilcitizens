'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../../_lib/me'
import { useViewerStore } from '../../_lib/viewerStore'
import { ensureViewerMe } from '../../_lib/viewerMe'
import OrganizationCreateButton from '../../com/_components/OrganizationCreateButton'

type OrganizationRow = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  isVerified?: boolean
  status?: string
  logoUrl?: string | null
  coverUrl?: string | null
}

type Status = 'loading' | 'ready' | 'unauthorized' | 'error'

type CommunityFollowRow = {
  province: string
  communitySlug: string
  home?: boolean
  community?: {
    name?: string | null
    cityName?: string | null
    province: string
    slug: string
  } | null
}

type CommunityFollowsResponse = {
  items?: CommunityFollowRow[]
}

type CommunityOption = {
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
  isHome: boolean
}

function followToOption(follow: CommunityFollowRow): CommunityOption {
  const normalized = normalizeProvinceCode(follow.province)
  const provinceCode = normalized ?? follow.province
  const provinceName = normalized ? getProvinceDisplayName(normalized) ?? normalized.toUpperCase() : follow.province.toUpperCase()
  const communitySlug = follow.communitySlug
  const communityName = follow.community?.name ?? follow.community?.cityName ?? follow.communitySlug
  return {
    provinceCode,
    provinceName,
    communitySlug,
    communityName,
    isHome: Boolean(follow.home),
  }
}

export default function OrganizationsManagerPage() {
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMe] = useState<MeResponse | null>(null)
  const [followedOrganizations, setFollowedOrganizations] = useState<OrganizationRow[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OrganizationRow[]>([])
  const [communityOptions, setCommunityOptions] = useState<CommunityOption[]>([])
  const [selectedCommunityKey, setSelectedCommunityKey] = useState<string>('')
  const cachedMe = useViewerStore((s) => s.me)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])
  const selectedCommunity = useMemo(() => {
    const [provinceCode, communitySlug] = selectedCommunityKey.split(':')
    if (!provinceCode || !communitySlug) return null
    return { provinceCode, communitySlug }
  }, [selectedCommunityKey])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!token) {
        setStatus('unauthorized')
        return
      }

      setStatus('loading')
      try {
        const followsPromise = fetch(buildApiUrl('/organizations/follows'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const ownedPromise = fetch(buildApiUrl('/organizations/owned'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const communitiesPromise = fetch(buildApiUrl('/communities/follows'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        const viewerPromise = cachedMe
          ? Promise.resolve(cachedMe)
          : ensureViewerMe({ token, cache: 'no-store' })

        const [viewer, followsRes, ownedRes, communitiesRes] = await Promise.all([viewerPromise, followsPromise, ownedPromise, communitiesPromise])

        if (!viewer) {
          if (!window.localStorage.getItem('token')) {
            if (!cancelled) setStatus('unauthorized')
            return
          }
          if (!cancelled) setStatus('error')
          return
        }

        if (followsRes.status === 401 || ownedRes.status === 401 || communitiesRes.status === 401) {
          if (!cancelled) setStatus('unauthorized')
          return
        }

        if (!followsRes.ok || !ownedRes.ok || !communitiesRes.ok) {
          if (!cancelled) setStatus('error')
          return
        }

        const followsPayload = (await followsRes.json().catch(() => null)) as { items?: OrganizationRow[] } | null
        const ownedPayload = (await ownedRes.json().catch(() => null)) as { items?: OrganizationRow[] } | null
        const communitiesPayload = (await communitiesRes.json().catch(() => null)) as CommunityFollowsResponse | null

        const followItems = Array.isArray(communitiesPayload?.items) ? communitiesPayload.items : []
        const deduped = new Map<string, CommunityOption>()
        followItems.forEach((follow) => {
          if (!follow.communitySlug) return
          const option = followToOption(follow)
          deduped.set(`${option.provinceCode}:${option.communitySlug}`, option)
        })
        const communityChoices = Array.from(deduped.values()).sort((a, b) => {
          if (a.isHome !== b.isHome) return a.isHome ? -1 : 1
          return a.communityName.localeCompare(b.communityName)
        })

        const initialSelection = (() => {
          if (hasHomeCommunity(viewer)) {
            const home = (viewer.homeCommunity ?? viewer.homeChamber)!
            const homeKey = `${home.provinceCode}:${home.communitySlug}`
            if (communityChoices.some((entry) => `${entry.provinceCode}:${entry.communitySlug}` === homeKey)) return homeKey
          }
          return communityChoices[0] ? `${communityChoices[0].provinceCode}:${communityChoices[0].communitySlug}` : ''
        })()

        if (!cancelled) {
          setMe(viewer)
          setFollowedOrganizations(Array.isArray(followsPayload?.items) ? followsPayload.items : [])
          setOwnedOrganizations(Array.isArray(ownedPayload?.items) ? ownedPayload.items : [])
          setCommunityOptions(communityChoices)
          setSelectedCommunityKey(initialSelection)
          setStatus('ready')
        }
      } catch (err) {
        console.error('Unable to load organizations manager', err)
        if (!cancelled) setStatus('error')
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [cachedMe, token])

  return (
    <DashboardShell
      rightRail={<RightRail mode="organizations" />}
      className="bg-slate-50"
      mainClassName="space-y-6"
    >
      <section className="surface-card px-6 py-5 shadow-subtle">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Organizations</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Organization manager</h1>
        <p className="mt-3 text-sm text-slate-600">Manage the organizations you follow and the organizations you own.</p>
        {status === 'ready' ? (
          <div className="mt-4">
            {communityOptions.length ? (
              <div className="space-y-3">
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Community
                  <select
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-[var(--cc-primary)] focus:outline-none"
                    value={selectedCommunityKey}
                    onChange={(e) => setSelectedCommunityKey(e.target.value)}
                  >
                    {communityOptions.map((opt) => {
                      const key = `${opt.provinceCode}:${opt.communitySlug}`
                      const label = `${opt.communityName} (${opt.provinceName})${opt.isHome ? ' · Home' : ''}`
                      return (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </label>

                {selectedCommunity ? (
                  <OrganizationCreateButton
                    province={selectedCommunity.provinceCode.toLowerCase()}
                    municipality={selectedCommunity.communitySlug.toLowerCase()}
                  />
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                Follow a community first to create organizations.
              </div>
            )}
          </div>
        ) : null}

        {status === 'loading' ? <div className="mt-6 h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
        {status === 'unauthorized' ? <p className="mt-6 text-sm text-slate-600">Please sign in to continue.</p> : null}
        {status === 'error' ? <p className="mt-6 text-sm text-slate-600">Unable to load organizations right now.</p> : null}

        {status === 'ready' ? (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-subtle">
              <h2 className="text-sm font-semibold text-slate-900">Organizations I follow</h2>
              <div className="mt-3">
                {followedOrganizations.length ? (
                  <ul className="space-y-2">
                    {followedOrganizations.slice(0, 25).map((org) => (
                      <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-800">
                        {org.coverUrl ? <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                        <span className="absolute inset-0 bg-slate-900/60" aria-hidden="true" />
                        <Link
                          href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                          className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium text-white hover:text-white"
                        >
                          <span className="h-8 w-8 overflow-hidden rounded-full border border-white/40 bg-white/20">
                            {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                          </span>
                          {org.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No organizations followed.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-subtle">
              <h2 className="text-sm font-semibold text-slate-900">Organizations I own</h2>
              <div className="mt-3">
                {ownedOrganizations.length ? (
                  <ul className="space-y-2">
                    {ownedOrganizations.slice(0, 25).map((org) => (
                      <li key={org.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-800">
                        {org.coverUrl ? <img src={org.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
                        <span className="absolute inset-0 bg-slate-900/60" aria-hidden="true" />
                        <Link
                          href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                          className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium text-white hover:text-white"
                        >
                          <span className="h-8 w-8 overflow-hidden rounded-full border border-white/40 bg-white/20">
                            {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                          </span>
                          {org.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No owned organizations yet.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </DashboardShell>
  )
}
