'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import { hasHomeCommunity, type MeResponse } from '../../_lib/me'
import { useViewerStore } from '../../_lib/viewerStore'
import OrganizationCreateButton from '../../com/_components/OrganizationCreateButton'
import { RightRail } from '../../_components/RightRail'

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

export default function CreateOrganizationPage() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
  const [options, setOptions] = useState<CommunityOption[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const cachedMe = useViewerStore((s) => s.me)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const load = useCallback(async () => {
    if (!token) {
      setStatus('unauthorized')
      return
    }

    setStatus('loading')
    try {
      let meRes: Response | null = null
      let followsRes: Response

      if (cachedMe) {
        followsRes = await fetch(buildApiUrl('/communities/follows'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
      } else {
        const [meResponse, followsResponse] = await Promise.all([
          fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }),
          fetch(buildApiUrl('/communities/follows'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }),
        ])
        meRes = meResponse
        followsRes = followsResponse
      }

      if ((meRes && meRes.status === 401) || followsRes.status === 401) {
        setStatus('unauthorized')
        return
      }
      if ((meRes && !meRes.ok) || !followsRes.ok) {
        setStatus('error')
        return
      }

      const meData = cachedMe ?? ((await meRes!.json()) as MeResponse)
      const followsData = (await followsRes.json().catch(() => null)) as CommunityFollowsResponse | null

      const followItems = Array.isArray(followsData?.items) ? followsData.items : []
      const deduped = new Map<string, CommunityOption>()
      followItems.forEach((follow) => {
        if (!follow.communitySlug) return
        const option = followToOption(follow)
        deduped.set(`${option.provinceCode}:${option.communitySlug}`, option)
      })

      const sorted = Array.from(deduped.values()).sort((a, b) => {
        if (a.isHome !== b.isHome) return a.isHome ? -1 : 1
        return a.communityName.localeCompare(b.communityName)
      })

      setOptions(sorted)

      const initial = (() => {
        if (hasHomeCommunity(meData)) {
          const home = (meData.homeCommunity ?? meData.homeChamber)!
          return `${home.provinceCode}:${home.communitySlug}`
        }
        return sorted[0] ? `${sorted[0].provinceCode}:${sorted[0].communitySlug}` : ''
      })()
      setSelectedKey(initial)
      setStatus('ready')
    } catch (err) {
      console.error('Unable to load create organization page', err)
      setStatus('error')
    }
  }, [cachedMe, token])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(() => {
    const [provinceCode, communitySlug] = selectedKey.split(':')
    if (!provinceCode || !communitySlug) return null
    return { provinceCode, communitySlug }
  }, [selectedKey])

  return (
    <DashboardShell
      rightRail={<RightRail mode="organizations" />}
      className="bg-slate-50"
      mainClassName="space-y-6"
    >
      <section className="surface-card px-6 py-5 shadow-subtle">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Organizations</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Create an organization</h1>
        <p className="mt-2 text-sm text-slate-600">Choose a community, then create an organization tied to it.</p>

        {status === 'loading' ? <div className="mt-6 h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}

        {status === 'unauthorized' ? (
          <p className="mt-6 text-sm text-slate-600">Please sign in to continue.</p>
        ) : null}

        {status === 'error' ? <p className="mt-6 text-sm text-slate-600">Unable to load your communities right now.</p> : null}

        {status === 'ready' ? (
          <div className="mt-6 space-y-4">
            {options.length ? (
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Community
                <select
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-[var(--cc-primary)] focus:outline-none"
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                >
                  {options.map((opt) => {
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
            ) : (
              <p className="text-sm text-slate-600">Follow a community first to create an organization.</p>
            )}

            {selected ? (
              <OrganizationCreateButton province={selected.provinceCode} municipality={selected.communitySlug} defaultOpen />
            ) : null}
          </div>
        ) : null}
      </section>
    </DashboardShell>
  )
}
