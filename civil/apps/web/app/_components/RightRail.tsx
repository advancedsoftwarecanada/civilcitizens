"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HiOutlineBell } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import VerifiedAvatar from './VerifiedAvatar'
import Block from './Block'

type RightRailData = {
  userHandle?: string
  totalFriends?: number
  friends: Array<{
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    newPosts: number
  }>
  communities: Array<{
    provinceCode: string
    communitySlug: string
    name: string
    newPosts: number
  }>
}

type FollowedOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  isVerified?: boolean
}

type OwnedOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified?: boolean
  status?: string
}

type OrganizationsFollowsResponse = {
  items?: FollowedOrganization[]
}

type OrganizationsOwnedResponse = {
  items?: OwnedOrganization[]
}

type Status = 'loading' | 'ready' | 'error' | 'unauthorized'

export function RightRail({
  mode = 'default',
  showOrganizations = false,
  sticky = true,
  hideContactsAndCommunities = false,
}: {
  mode?: 'default' | 'organizations' | 'organizationsDirectory'
  showOrganizations?: boolean
  sticky?: boolean
  hideContactsAndCommunities?: boolean
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<RightRailData | null>(null)
  const [organizations, setOrganizations] = useState<FollowedOrganization[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])

  const hideSocialBlocks = hideContactsAndCommunities || mode === 'organizations' || mode === 'organizationsDirectory'
  const shouldLoadOrganizations = mode === 'organizations' || mode === 'organizationsDirectory' || showOrganizations
  const shouldLoadOwnedOrganizations = mode === 'organizationsDirectory'
  const shouldLoadHomeRail = !hideSocialBlocks

  const subscribedOrganizations = useMemo(
    () => organizations.filter((org) => Boolean(org.provinceCode) && Boolean(org.communitySlug)),
    [organizations],
  )

  const partOfOrganizations = useMemo(
    () => ownedOrganizations.filter((org) => Boolean(org.provinceCode) && Boolean(org.communitySlug)),
    [ownedOrganizations],
  )

  const loadData = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setStatus('unauthorized')
      return
    }
    try {
      const requests: Array<{ key: 'home' | 'follows' | 'owned'; promise: Promise<Response> }> = []

      if (shouldLoadHomeRail) {
        requests.push({
          key: 'home',
          promise: fetch(buildApiUrl('/home/right-rail'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadOrganizations) {
        requests.push({
          key: 'follows',
          promise: fetch(buildApiUrl('/organizations/follows'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      if (shouldLoadOwnedOrganizations) {
        requests.push({
          key: 'owned',
          promise: fetch(buildApiUrl('/organizations/owned'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        })
      }

      const results = await Promise.all(requests.map((entry) => entry.promise))
      const byKey = new Map(requests.map((entry, index) => [entry.key, results[index] as Response]))

      const homeRes = byKey.get('home')
      const followsRes = byKey.get('follows')
      const ownedRes = byKey.get('owned')

      if (homeRes?.status === 401 || followsRes?.status === 401 || ownedRes?.status === 401) {
        setStatus('unauthorized')
        return
      }

      const requiredHomeOk = shouldLoadHomeRail ? Boolean(homeRes?.ok) : true
      const requiredFollowsOk = shouldLoadOrganizations ? Boolean(followsRes?.ok) : true
      const requiredOwnedOk = shouldLoadOwnedOrganizations ? Boolean(ownedRes?.ok) : true

      if (!requiredHomeOk || !requiredFollowsOk || !requiredOwnedOk) {
        setStatus('error')
        if (!shouldLoadHomeRail) setData(null)
        if (!shouldLoadOrganizations) setOrganizations([])
        if (!shouldLoadOwnedOrganizations) setOwnedOrganizations([])
        return
      }

      if (homeRes?.ok) {
        const homeJson = (await homeRes.json()) as RightRailData
        setData(homeJson)
      } else {
        setData(null)
      }

      if (followsRes?.ok) {
        const payload = (await followsRes.json().catch(() => null)) as OrganizationsFollowsResponse | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setOrganizations(items)
      } else {
        setOrganizations([])
      }

      if (ownedRes?.ok) {
        const payload = (await ownedRes.json().catch(() => null)) as OrganizationsOwnedResponse | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setOwnedOrganizations(items)
      } else {
        setOwnedOrganizations([])
      }

      setStatus('ready')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [shouldLoadHomeRail, shouldLoadOrganizations, shouldLoadOwnedOrganizations])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (status === 'loading') {
    return (
      <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
        <div className="surface-card h-48 animate-pulse p-5" />
        <div className="surface-card h-48 animate-pulse p-5" />
      </div>
    )
  }

  if (status === 'unauthorized') return null

  return (
    <div className={sticky ? 'sticky top-8 space-y-6' : 'space-y-6'}>
      {mode === 'organizationsDirectory' ? (
        <>
          <Block
            title="Organizations You're Subscribed to"
            action={{ label: 'Show all', href: '/organizations/manager' }}
            actionVariant="pill"
          >
            {subscribedOrganizations.length ? (
              <ul className="space-y-3">
                {subscribedOrganizations.slice(0, 10).map((org) => (
                  <li key={org.id} className="flex items-center justify-between">
                    <Link
                      href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                      className="max-w-[200px] truncate text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      {org.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No organizations subscribed.</p>
            )}
          </Block>

          <Block title="Organizations You're a part of" action={{ label: 'Manage', href: '/organizations/manager' }} actionVariant="pill">
            {partOfOrganizations.length ? (
              <ul className="space-y-3">
                {partOfOrganizations.slice(0, 10).map((org) => (
                  <li key={org.id} className="flex items-center justify-between">
                    <Link
                      href={`/com/${String(org.provinceCode).toLowerCase()}/${String(org.communitySlug).toLowerCase()}/orgs/${org.slug}`}
                      className="max-w-[200px] truncate text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      {org.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No organizations managed.</p>
            )}
          </Block>
        </>
      ) : null}

      {mode === 'default' && showOrganizations ? (
        <Block title="Organizations" action={{ label: 'View all', href: '/organizations/directory' }}>
          {organizations.length ? (
            <ul className="space-y-3">
              {organizations.slice(0, 8).map((org) => (
                <li key={org.id} className="flex items-center justify-between">
                  <Link
                    href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                    className="max-w-[180px] truncate text-sm font-medium text-slate-700 hover:text-slate-900"
                  >
                    {org.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No organizations followed.</p>
          )}
        </Block>
      ) : null}

      {mode === 'organizations' ? (
        <Block
          title="Organizations"
          action={{ label: 'View all', href: '/organizations/directory' }}
          actionVariant="link"
        >
          {organizations.length ? (
            <ul className="space-y-3">
              {organizations.slice(0, 10).map((org) => (
                <li key={org.id} className="flex items-center justify-between">
                  <Link
                    href={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                    className="max-w-[180px] truncate text-sm font-medium text-slate-700 hover:text-slate-900"
                  >
                    {org.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No organizations followed.</p>
          )}
        </Block>
      ) : null}

      {/* Friends Section */}
      {!hideSocialBlocks ? (
      <Block
        title="Contacts"
        action={
          data?.userHandle && (data.totalFriends ?? 0) > 0
            ? { label: `View all (${data.totalFriends})`, href: `/u/${data.userHandle}/friends` }
            : undefined
        }
      >
        {data?.friends.length ? (
          <ul className="space-y-3">
            {data.friends.map((friend) => (
              <li key={friend.id} className="flex items-center justify-between">
                <Link href={`/u/${friend.handle}`} className="group flex items-center gap-2">
                  <VerifiedAvatar
                    src={friend.avatarUrl}
                    alt={friend.name || friend.handle}
                    initials={friend.name || friend.handle}
                    size={32}
                  />
                  <div className="flex flex-col">
                    <span className="max-w-[120px] truncate text-sm font-medium text-slate-700 group-hover:text-slate-900">
                      {friend.name || friend.handle}
                    </span>
                    <span className="max-w-[120px] truncate text-xs text-slate-400">
                      @{friend.handle}
                    </span>
                  </div>
                </Link>
                {friend.newPosts > 0 && (
                  <Link href={`/u/${friend.handle}`} className="flex items-center gap-1 text-xs font-semibold text-[var(--cc-primary)] hover:underline">
                    <HiOutlineBell className="h-4 w-4" />
                    ({friend.newPosts})
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No contacts yet.</p>
        )}
      </Block>
      ) : null}

      {/* Communities Section */}
      {!hideSocialBlocks ? (
        <Block title="Your Communities" action={{ label: 'View all', href: '/communities/settings' }}>
          {data?.communities.length ? (
            <ul className="space-y-3">
              {data.communities.map((comm) => {
                const formattedName = comm.name
                  .split('-')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ')

                return (
                  <li key={`${comm.provinceCode}:${comm.communitySlug}`} className="flex items-center justify-between">
                    <Link
                      href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                      className="max-w-[160px] truncate text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      {formattedName}
                    </Link>
                    {comm.newPosts > 0 && (
                      <Link
                        href={`/${comm.provinceCode.toLowerCase()}/${comm.communitySlug.toLowerCase()}`}
                        className="flex items-center gap-1 text-xs font-semibold text-[var(--cc-primary)] hover:underline"
                      >
                        <HiOutlineBell className="h-4 w-4" />
                        ({comm.newPosts})
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No communities followed.</p>
          )}
        </Block>
      ) : null}
    </div>
  )
}
