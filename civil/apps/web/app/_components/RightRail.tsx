"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { HiOutlineBell } from 'react-icons/hi2'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, isPremiumMember, type MeResponse } from '../_lib/me'
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

type OrganizationsFollowsResponse = {
  items?: FollowedOrganization[]
}

type Status = 'loading' | 'ready' | 'error' | 'unauthorized'

export function RightRail({
  mode = 'default',
  showOrganizations = false,
}: {
  mode?: 'default' | 'organizations'
  showOrganizations?: boolean
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<RightRailData | null>(null)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [organizations, setOrganizations] = useState<FollowedOrganization[]>([])

  const loadData = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setStatus('unauthorized')
      return
    }
    try {
      const requests: Array<Promise<Response>> = [
        fetch(buildApiUrl('/home/right-rail'), {
          headers: { authorization: `Bearer ${token}` },
        }),
      ]

      const shouldLoadOrganizations = mode === 'organizations' || showOrganizations
      if (shouldLoadOrganizations) {
        requests.push(
          fetch(buildApiUrl('/organizations/follows'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
      }

      if (mode === 'organizations') {
        requests.push(
          fetch(buildApiUrl('/auth/me'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
      }

      const results = await Promise.all(requests)
      const homeRes = results[0]
      if (!homeRes) {
        setStatus('error')
        return
      }
      const orgsRes = (mode === 'organizations' || showOrganizations ? results[1] : undefined) as Response | undefined
      const meRes = (mode === 'organizations' ? results[results.length - 1] : undefined) as Response | undefined

      if (homeRes.status === 401 || orgsRes?.status === 401 || meRes?.status === 401) {
        setStatus('unauthorized')
        return
      }
      if (!homeRes.ok) throw new Error('Failed to load')
      const homeJson = (await homeRes.json()) as RightRailData
      setData(homeJson)

      if (orgsRes) {
        if (orgsRes.ok) {
          const payload = (await orgsRes.json().catch(() => null)) as OrganizationsFollowsResponse | null
          const items = Array.isArray(payload?.items) ? payload.items : []
          setOrganizations(items)
        } else {
          setOrganizations([])
        }
      }

      if (mode === 'organizations') {
        if (meRes?.ok) {
          const viewer = (await meRes.json()) as MeResponse
          setMe(viewer)
        } else {
          setMe(null)
        }
      }

      setStatus('ready')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [mode])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (status === 'loading') {
    return (
      <div className="sticky top-8 space-y-6">
        <div className="surface-card h-48 animate-pulse p-5" />
        <div className="surface-card h-48 animate-pulse p-5" />
      </div>
    )
  }

  if (status === 'unauthorized') return null

  const showCreateOrganization = mode === 'organizations' && isPremiumMember(me) && hasHomeCommunity(me)
  const createOrganizationHref = showCreateOrganization ? '/organizations/create' : null

  return (
    <div className="sticky top-8 space-y-6">
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
          action={createOrganizationHref ? { label: 'Create an organization', href: createOrganizationHref } : undefined}
          actionVariant={createOrganizationHref ? 'pill' : 'link'}
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

      {/* Communities Section */}
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
    </div>
  )
}
