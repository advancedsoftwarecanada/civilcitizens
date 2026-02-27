'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import type { MeResponse } from '../../_lib/me'
import { useViewerStore } from '../../_lib/viewerStore'
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

export default function OrganizationsManagerPage() {
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMe] = useState<MeResponse | null>(null)
  const [followedOrganizations, setFollowedOrganizations] = useState<OrganizationRow[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OrganizationRow[]>([])
  const cachedMe = useViewerStore((s) => s.me)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])
  const homeCommunity = me?.homeCommunity ?? me?.homeChamber ?? null
  const canCreateOrganization = Boolean(me?.isPremium && homeCommunity?.provinceCode && homeCommunity?.communitySlug)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!token) {
        setStatus('unauthorized')
        return
      }

      setStatus('loading')
      try {
        const requests: Array<Promise<Response>> = []
        if (!cachedMe) {
          requests.push(fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }))
        }
        requests.push(fetch(buildApiUrl('/organizations/follows'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }))
        requests.push(fetch(buildApiUrl('/organizations/owned'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }))

        const responses = await Promise.all(requests)
        const meRes = cachedMe ? null : responses[0]
        const followsRes = (cachedMe ? responses[0] : responses[1])!
        const ownedRes = (cachedMe ? responses[1] : responses[2])!

        if ((meRes && meRes.status === 401) || followsRes.status === 401 || ownedRes.status === 401) {
          if (!cancelled) setStatus('unauthorized')
          return
        }

        if (meRes && !meRes.ok) {
          if (!cancelled) setStatus('error')
          return
        }

        const viewer = cachedMe ?? ((await meRes!.json()) as MeResponse)
        const followsPayload = (await followsRes.json().catch(() => null)) as { items?: OrganizationRow[] } | null
        const ownedPayload = (await ownedRes.json().catch(() => null)) as { items?: OrganizationRow[] } | null

        if (!cancelled) {
          setMe(viewer)
          setFollowedOrganizations(Array.isArray(followsPayload?.items) ? followsPayload.items : [])
          setOwnedOrganizations(Array.isArray(ownedPayload?.items) ? ownedPayload.items : [])
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
            {canCreateOrganization && homeCommunity ? (
              <OrganizationCreateButton
                province={homeCommunity.provinceCode.toLowerCase()}
                municipality={homeCommunity.communitySlug.toLowerCase()}
              />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                {me?.isPremium
                  ? 'Set your home community to create organizations.'
                  : 'Premium is required to create an organization.'}
                {!me?.isPremium ? (
                  <Link href="/settings/billing" className="ml-2 font-semibold text-[var(--cc-primary)] hover:underline">
                    Upgrade
                  </Link>
                ) : null}
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
