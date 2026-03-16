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

type FamilyListItem = {
  id: string
  handle?: string | null
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  relationshipLabel?: string | null
  bio?: string | null
  interactive?: boolean
}

type RelationshipKind = 'friends' | 'family' | 'contacts' | 'connections' | 'communities' | 'organizations'
type ContactView = 'all' | 'family' | 'friends' | 'connections'

type ContactListItem = {
  id: string
  handle?: string | null
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  bio?: string | null
  since?: string | null
  relationshipLabel?: string | null
  contextLabel: 'Family' | 'Friend' | 'Network'
  interactive?: boolean
}

type FamilyResponse = {
  immediateFamily?: FamilyListItem[]
  guardianOf?: FamilyListItem[]
  extendedFamily?: FamilyListItem[]
}

type Props = {
  handle: string
  kind: RelationshipKind
  title: string
}

function resolveContactViewFromHash(hash: string | null | undefined, fallback: ContactView): ContactView {
  const normalized = (hash ?? '').replace(/^#/, '').trim().toLowerCase()
  if (normalized === 'all') return 'all'
  if (normalized === 'family') return 'family'
  if (normalized === 'friends') return 'friends'
  if (normalized === 'network' || normalized === 'connections') return 'connections'
  return fallback
}

function itemCountText(count: number, title: string) {
  return `${count.toLocaleString()} ${title}`
}

function normalizeContactDisplayName(entry: ContactListItem) {
  return formatUserDisplayName(entry.name, entry.handle ?? undefined) || entry.handle || 'Citizen'
}

function buildContactSearchHaystack(entry: ContactListItem) {
  return [entry.name, entry.handle, entry.bio, entry.relationshipLabel, entry.contextLabel]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
}

function dedupeContactItems(items: ContactListItem[]) {
  const priority: Record<ContactListItem['contextLabel'], number> = {
    Family: 3,
    Friend: 2,
    Network: 1,
  }

  const deduped = new Map<string, ContactListItem>()
  for (const entry of items) {
    const key = entry.id || entry.handle || `${entry.contextLabel}:${entry.name ?? 'unknown'}`
    const existing = deduped.get(key)
    if (!existing || priority[entry.contextLabel] > priority[existing.contextLabel]) {
      deduped.set(key, entry)
    }
  }
  return Array.from(deduped.values())
}

export default function UserRelationshipListPage({ handle, kind, title }: Props) {
  const viewer = useViewerStore((state) => state.me)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Array<UserListItem | CommunityListItem | OrganizationListItem>>([])
  const [contactGroups, setContactGroups] = useState<{
    friends: ContactListItem[]
    family: ContactListItem[]
    connections: ContactListItem[]
  }>({
    friends: [],
    family: [],
    connections: [],
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [activeContactView, setActiveContactView] = useState<ContactView>(kind === 'contacts' ? 'all' : kind === 'family' ? 'family' : kind === 'connections' ? 'connections' : 'friends')

  const isContactKind = kind === 'friends' || kind === 'family' || kind === 'contacts' || kind === 'connections'

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        if (isContactKind) {
          const [friendsResponse, familyResponse, connectionsResponse] = await Promise.all([
            fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/friends`), { cache: 'no-store' }),
            fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/family`), { cache: 'no-store' }),
            fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/connections`), { cache: 'no-store' }),
          ])

          const responses = [friendsResponse, familyResponse, connectionsResponse]
          const notFound = responses.some((response) => response.status === 404)
          const failed = responses.some((response) => !response.ok && response.status !== 404)
          if (notFound || failed) {
            setError(notFound ? 'User not found.' : 'Unable to load this list right now.')
            setItems([])
            setContactGroups({ friends: [], family: [], connections: [] })
            return
          }

          const [friendsJson, familyJson, connectionsJson] = (await Promise.all([
            friendsResponse.json().catch(() => null),
            familyResponse.json().catch(() => null),
            connectionsResponse.json().catch(() => null),
          ])) as [{ items?: UserListItem[] } | null, FamilyResponse | null, { items?: UserListItem[] } | null]

          const nextFriends = (Array.isArray(friendsJson?.items) ? friendsJson.items : []).map((entry) => ({
            id: entry.id,
            handle: entry.handle,
            name: entry.name,
            avatarUrl: entry.avatarUrl,
            coverUrl: entry.coverUrl,
            bio: entry.bio ?? null,
            since: entry.since ?? null,
            contextLabel: 'Friend' as const,
            interactive: true,
          }))

          const familyEntries = [
            ...(Array.isArray(familyJson?.immediateFamily) ? familyJson.immediateFamily : []),
            ...(Array.isArray(familyJson?.guardianOf) ? familyJson.guardianOf : []),
            ...(Array.isArray(familyJson?.extendedFamily) ? familyJson.extendedFamily : []),
          ]
          const nextFamily = dedupeContactItems(
            familyEntries.map((entry) => ({
              id: entry.id,
              handle: entry.handle ?? null,
              name: entry.name,
              avatarUrl: entry.avatarUrl,
              coverUrl: entry.coverUrl,
              relationshipLabel: entry.relationshipLabel ?? null,
              contextLabel: 'Family' as const,
              interactive: entry.interactive ?? Boolean(entry.handle),
            })),
          )

          const nextConnections = (Array.isArray(connectionsJson?.items) ? connectionsJson.items : []).map((entry) => ({
            id: entry.id,
            handle: entry.handle,
            name: entry.name,
            avatarUrl: entry.avatarUrl,
            coverUrl: entry.coverUrl,
            bio: entry.bio ?? null,
            since: entry.since ?? null,
            contextLabel: 'Network' as const,
            interactive: true,
          }))

          setContactGroups({
            friends: nextFriends,
            family: nextFamily,
            connections: nextConnections,
          })
          setItems([])
          return
        }

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
        setContactGroups({ friends: [], family: [], connections: [] })
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [handle, isContactKind, kind])

  useEffect(() => {
    setSearchQuery('')
  }, [handle, kind])

  useEffect(() => {
    const fallback = kind === 'family' ? 'family' : kind === 'connections' ? 'connections' : 'friends'
    const resolvedFallback = kind === 'contacts' ? 'all' : fallback

    if (typeof window === 'undefined') {
      setActiveContactView(resolvedFallback)
      return
    }

    const syncFromHash = () => {
      setActiveContactView(resolveContactViewFromHash(window.location.hash, resolvedFallback))
    }

    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => {
      window.removeEventListener('hashchange', syncFromHash)
    }
  }, [kind])

  const contactViewLabels: Record<ContactView, string> = {
    all: 'Contacts',
    family: 'Family',
    friends: 'Friends',
    connections: 'Network',
  }

  const emptyText = useMemo(() => {
    if (isContactKind && searchQuery.trim()) return `No ${contactViewLabels[activeContactView].toLowerCase()} match your search.`
    if (kind === 'contacts') return 'No contacts yet.'
    if (kind === 'family') return 'No family contacts yet.'
    if (kind === 'friends') return 'No friends yet.'
    if (kind === 'connections') return 'No business connections yet.'
    if (kind === 'communities') return 'No communities yet.'
    if (kind === 'organizations') return 'No organizations yet.'
    return `No ${kind} yet.`
  }, [activeContactView, contactViewLabels, isContactKind, kind, searchQuery])

  const rightRail = (
    <div className="space-y-4">
      {isContactKind ? (
        <MessagesNavBlock
          visibleItems={hasFamilyProfilesAvailable(viewer) ? ['friends', 'family', 'network', 'groups', 'market'] : undefined}
          footerAction={viewer?.handle ? { label: 'My Contacts', href: `/u/${viewer.handle}/contacts` } : undefined}
        />
      ) : null}
      <RightRail hideContacts hideCommunities={kind === 'friends'} />
    </div>
  )

  const visibleContactItems = useMemo(() => {
    if (!isContactKind) return [] as ContactListItem[]

    const baseItems =
      activeContactView === 'all'
        ? dedupeContactItems([...contactGroups.family, ...contactGroups.friends, ...contactGroups.connections])
        : contactGroups[activeContactView]

    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return baseItems

    return baseItems.filter((entry) => buildContactSearchHaystack(entry).includes(normalizedQuery))
  }, [activeContactView, contactGroups, isContactKind, searchQuery])

  const filteredItems = useMemo(() => {
    if (isContactKind) return visibleContactItems
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return items

    return items.filter((entry) => {
      if (!('handle' in entry)) return true
      const haystack = [entry.name, entry.handle, entry.bio]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [isContactKind, items, kind, searchQuery, visibleContactItems])

  const groupedContactItems = useMemo(() => {
    if (!isContactKind) return [] as Array<{ letter: string; items: ContactListItem[] }>

    const sortedItems = [...visibleContactItems].sort((left, right) => {
      const leftName = normalizeContactDisplayName(left)
      const rightName = normalizeContactDisplayName(right)
      return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
    })

    const groups = new Map<string, ContactListItem[]>()
    for (const entry of sortedItems) {
      const displayName = normalizeContactDisplayName(entry)
      const firstLetter = displayName.charAt(0).toUpperCase()
      const key = /[A-Z]/.test(firstLetter) ? firstLetter : '#'
      const bucket = groups.get(key) ?? []
      bucket.push(entry)
      groups.set(key, bucket)
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([letter, groupedItems]) => ({ letter, items: groupedItems }))
  }, [isContactKind, visibleContactItems])

  return (
    <DashboardShell rightRail={rightRail}>
      <div className="space-y-6">
        {isContactKind ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="grid w-full grid-cols-4 gap-2 rounded-[1.75rem] border border-slate-200 bg-white/95 p-2 shadow-sm">
                {([
                  ['all', 'All'],
                  ['family', 'Family'],
                  ['friends', 'Friends'],
                  ['connections', 'Network'],
                ] as Array<[ContactView, string]>).map(([view, label]) => {
                  const isActive = activeContactView === view
                  return (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setActiveContactView(view)}
                      className={isActive
                        ? 'inline-flex w-full items-center justify-center rounded-full bg-[var(--cc-primary)] px-3 py-2 text-center text-sm font-semibold text-white shadow-sm transition'
                        : 'inline-flex w-full items-center justify-center rounded-full px-3 py-2 text-center text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900'}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="relative w-full max-w-xl">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-label={`Quick search ${contactViewLabels[activeContactView].toLowerCase()}`}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-900 shadow-sm outline-none transition focus:border-[var(--cc-primary)]"
                />
                {!searchQuery ? (
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center px-5 text-base font-semibold text-slate-400">
                    Quick search...
                  </span>
                ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">{itemCountText(filteredItems.length, title)}</span>
          </div>
        )}

        {loading ? <div className="surface-card p-8 text-center text-slate-500">Loading…</div> : null}
        {!loading && error ? <div className="surface-card p-8 text-center text-red-500">{error}</div> : null}

        {!loading && !error && filteredItems.length === 0 ? (
          <div className="surface-card p-12 text-center">
            <p className="text-slate-500">{emptyText}</p>
          </div>
        ) : null}

        {!loading && !error && filteredItems.length > 0 ? (
          <div className="grid gap-4">
            {isContactKind
              ? groupedContactItems.map((group) => (
                  <section key={group.letter} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-slate-900">{group.letter}</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                    <div className="grid gap-4">
                      {group.items.map((entry) => (
                        <ProfileRelationshipCard
                          key={`${entry.contextLabel.toLowerCase()}-${entry.id}`}
                          userId={entry.id}
                          handle={entry.handle ?? undefined}
                          name={entry.name}
                          avatarUrl={entry.avatarUrl}
                          coverUrl={entry.coverUrl}
                          contextLabel={entry.contextLabel}
                          relationshipLabel={entry.relationshipLabel ?? null}
                          since={entry.since ?? null}
                          interactive={entry.interactive ?? true}
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
                      contextLabel="Friend"
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

              if (!('provinceCode' in entry) || !('communitySlug' in entry)) {
                return null
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
