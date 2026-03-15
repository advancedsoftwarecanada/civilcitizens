"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'
import DashboardShell from '../../../_components/DashboardShell'
import MessagesNavBlock from '../../../_components/MessagesNavBlock'
import { hasFamilyProfilesAvailable } from '../../../_lib/me'
import CivilCard from '../../../_components/CivilCard'
import { useViewerStore } from '../../../_lib/viewerStore'
import ProfileRelationshipCard from './ProfileRelationshipCard'

type UserListItem = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  bio?: string | null
  since?: string
}

type CommunityListItem = {
  id: string
  provinceCode: string
  communitySlug: string
  name: string
  home?: boolean
  since?: string
}

type OrganizationListItem = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  logoUrl: string | null
  coverUrl: string | null
}

type RelationshipKind = 'friends' | 'connections' | 'communities' | 'organizations'

type Props = {
  handle: string
  kind: RelationshipKind
  title: string
}

function itemCountText(count: number, title: string) {
  return `${count.toLocaleString()} ${title}`
}

export default function UserRelationshipListPage({ handle, kind, title }: Props) {
  const viewer = useViewerStore((state) => state.me)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Array<UserListItem | CommunityListItem | OrganizationListItem>>([])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const endpoint = `/users/${encodeURIComponent(handle)}/${kind}`
        const res = await fetch(buildApiUrl(endpoint), { cache: 'no-store' })
        if (!res.ok) {
          setError(res.status === 404 ? 'User not found.' : 'Unable to load this list right now.')
          setItems([])
          return
        }

        const json = (await res.json().catch(() => null)) as { items?: unknown[] } | null
        setItems(Array.isArray(json?.items) ? (json?.items as Array<UserListItem | CommunityListItem | OrganizationListItem>) : [])
      } catch (err) {
        console.error('Unable to load profile relationship list', err)
        setError('Unable to load this list right now.')
        setItems([])
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [handle, kind])

  const emptyText = useMemo(() => {
    if (kind === 'connections') return 'No business connections yet.'
    if (kind === 'communities') return 'No communities yet.'
    if (kind === 'organizations') return 'No organizations yet.'
    return `No ${kind} yet.`
  }, [kind])

  const rightRail = (
    <div className="space-y-4">
      {kind === 'friends' || kind === 'connections' ? <MessagesNavBlock visibleItems={hasFamilyProfilesAvailable(viewer) ? ['friends', 'family', 'network', 'groups', 'market'] : undefined} /> : null}
      <RightRail hideContacts hideCommunities={kind === 'friends'} />
    </div>
  )

  return (
    <DashboardShell rightRail={rightRail}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">{itemCountText(items.length, title)}</span>
        </div>

        {loading ? <div className="surface-card p-8 text-center text-slate-500">Loading…</div> : null}
        {!loading && error ? <div className="surface-card p-8 text-center text-red-500">{error}</div> : null}

        {!loading && !error && items.length === 0 ? (
          <div className="surface-card p-12 text-center">
            <p className="text-slate-500">{emptyText}</p>
          </div>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <div className="grid gap-4">
            {items.map((entry) => {
              if ('handle' in entry) {
                return (
                  <div key={`user-${entry.id}`}>
                    <ProfileRelationshipCard
                      userId={entry.id}
                      handle={entry.handle}
                      name={entry.name}
                      avatarUrl={entry.avatarUrl}
                      coverUrl={entry.coverUrl}
                      contextLabel={kind === 'connections' ? 'Network' : 'Friend'}
                      since={entry.since ?? null}
                    />
                  </div>
                )
              }

              if ('logoUrl' in entry) {
                const organizationHref =
                  entry.provinceCode && entry.communitySlug
                    ? `/com/${encodeURIComponent(entry.provinceCode)}/${encodeURIComponent(entry.communitySlug)}/orgs/${encodeURIComponent(entry.slug)}`
                    : '/organizations'

                return (
                  <CivilCard
                    key={`org-${entry.id}`}
                    href={organizationHref}
                    size="lg"
                    name={entry.name}
                    avatarAlt={entry.name}
                    avatarInitials={entry.name}
                    avatarSrc={entry.logoUrl}
                    coverUrl={entry.coverUrl}
                    subtitle="Organization"
                  />
                )
              }

              return (
                <CivilCard
                  key={`community-${entry.id}`}
                  href={`/${encodeURIComponent(entry.provinceCode.toLowerCase())}/${encodeURIComponent(entry.communitySlug.toLowerCase())}`}
                  size="lg"
                  name={entry.name}
                  avatarAlt={entry.name}
                  avatarInitials={entry.provinceCode.toUpperCase()}
                  subtitle={`${entry.provinceCode.toUpperCase()} · ${entry.communitySlug}`}
                />
              )
            })}
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
