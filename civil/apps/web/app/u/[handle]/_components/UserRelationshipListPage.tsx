"use client"

import { useEffect, useMemo, useState } from 'react'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'
import DashboardShell from '../../../_components/DashboardShell'
import MessagesNavBlock from '../../../_components/MessagesNavBlock'
import { hasFamilyProfilesAvailable } from '../../../_lib/me'
import CivilCard from '../../../_components/CivilCard'
import { formatUserDisplayName } from '../../../_lib/text'
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
  const [searchQuery, setSearchQuery] = useState('')

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

  useEffect(() => {
    setSearchQuery('')
  }, [handle, kind])

  const emptyText = useMemo(() => {
    if (kind === 'friends' && searchQuery.trim()) return 'No friends match your search.'
    if (kind === 'connections') return 'No business connections yet.'
    if (kind === 'communities') return 'No communities yet.'
    if (kind === 'organizations') return 'No organizations yet.'
    return `No ${kind} yet.`
  }, [kind, searchQuery])

  const rightRail = (
    <div className="space-y-4">
      {kind === 'friends' || kind === 'connections' ? <MessagesNavBlock visibleItems={hasFamilyProfilesAvailable(viewer) ? ['friends', 'family', 'network', 'groups', 'market'] : undefined} /> : null}
      <RightRail hideContacts hideCommunities={kind === 'friends'} />
    </div>
  )

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery || kind !== 'friends') return items

    return items.filter((entry) => {
      if (!('handle' in entry)) return true
      const haystack = [entry.name, entry.handle, entry.bio]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [items, kind, searchQuery])

  const groupedFriendItems = useMemo(() => {
    if (kind !== 'friends') return [] as Array<{ letter: string; items: UserListItem[] }>

    const userItems = filteredItems.filter((entry): entry is UserListItem => 'handle' in entry)
    const sortedItems = [...userItems].sort((left, right) => {
      const leftName = formatUserDisplayName(left.name, left.handle) || left.handle
      const rightName = formatUserDisplayName(right.name, right.handle) || right.handle
      return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
    })

    const groups = new Map<string, UserListItem[]>()
    for (const entry of sortedItems) {
      const displayName = formatUserDisplayName(entry.name, entry.handle) || entry.handle
      const firstLetter = displayName.charAt(0).toUpperCase()
      const key = /[A-Z]/.test(firstLetter) ? firstLetter : '#'
      const bucket = groups.get(key) ?? []
      bucket.push(entry)
      groups.set(key, bucket)
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([letter, groupedItems]) => ({ letter, items: groupedItems }))
  }, [filteredItems, kind])

  return (
    <DashboardShell rightRail={rightRail}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          {kind === 'friends' ? (
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Quick search..."
              data-preserve-placeholder
              aria-label="Quick search friends"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full max-w-sm rounded-full border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--cc-primary)]"
            />
          ) : (
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          )}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">{itemCountText(filteredItems.length, title)}</span>
        </div>

        {loading ? <div className="surface-card p-8 text-center text-slate-500">Loading…</div> : null}
        {!loading && error ? <div className="surface-card p-8 text-center text-red-500">{error}</div> : null}

        {!loading && !error && filteredItems.length === 0 ? (
          <div className="surface-card p-12 text-center">
            <p className="text-slate-500">{emptyText}</p>
          </div>
        ) : null}

        {!loading && !error && filteredItems.length > 0 ? (
          <div className="grid gap-4">
            {kind === 'friends'
              ? groupedFriendItems.map((group) => (
                  <section key={group.letter} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-slate-900">{group.letter}</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                    <div className="grid gap-4">
                      {group.items.map((entry) => (
                        <ProfileRelationshipCard
                          key={`user-${entry.id}`}
                          userId={entry.id}
                          handle={entry.handle}
                          name={entry.name}
                          avatarUrl={entry.avatarUrl}
                          coverUrl={entry.coverUrl}
                          contextLabel="Friend"
                          since={entry.since ?? null}
                        />
                      ))}
                    </div>
                  </section>
                ))
              : filteredItems.map((entry) => {
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
