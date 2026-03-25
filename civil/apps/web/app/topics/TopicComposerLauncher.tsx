'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import CivilComposerLauncher from '../_components/CivilComposerLauncher'
import Modal from '../_components/Modal'
import PostComposer, { type ApiPost, type CommunityTarget, type PostType } from '../_components/PostComposer'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import type { MeResponse } from '../_lib/me'
import { formatDisplayName } from '../_lib/text'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

type TopicComposerLauncherProps = {
  onPostCreated?: (post: ApiPost) => void
  guestPrompt?: string
  modalTitle?: string
  className?: string
}

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

type OwnedOrganization = {
  id: string
  name: string
}

type MemberOrganization = {
  id: string
  name: string
}

type OrganizationsOwnedResponse = {
  items?: OwnedOrganization[]
}

type OrganizationsMembershipsResponse = {
  items?: MemberOrganization[]
}

const COMPOSER_ACTIONS: Array<{ type: PostType; label: string; icon: string }> = [
  { type: 'post', label: 'Post', icon: '📝' },
  { type: 'article', label: 'Article', icon: '📄' },
  { type: 'poll', label: 'Poll', icon: '📊' },
]

const mapFollowToCommunityTarget = (follow: CommunityFollowRow): CommunityTarget => {
  const normalizedProvince = normalizeProvinceCode(follow.province)
  const provinceCode = normalizedProvince ?? follow.province
  const provinceName = normalizedProvince
    ? getProvinceDisplayName(normalizedProvince) ?? normalizedProvince.toUpperCase()
    : follow.community?.province ?? follow.province.toUpperCase()

  return {
    provinceCode,
    provinceName,
    communitySlug: follow.communitySlug,
    communityName: follow.community?.name ?? follow.community?.cityName ?? follow.communitySlug,
    isHome: Boolean(follow.home),
  }
}

export default function TopicComposerLauncher({
  onPostCreated,
  guestPrompt = 'Sign in to share a public topic post',
  modalTitle = 'Share something new',
  className,
}: TopicComposerLauncherProps) {
  const cachedMe = useViewerStore((state) => state.me)
  const familyView = useViewerStore((state) => state.familyView)
  const [me, setMe] = useState<MeResponse | null>(cachedMe ?? null)
  const [communityOptions, setCommunityOptions] = useState<CommunityTarget[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])
  const [memberOrganizations, setMemberOrganizations] = useState<MemberOrganization[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')
  const [hasSession, setHasSession] = useState(false)

  const postableOrganizations = useMemo(() => {
    const ownedIds = new Set(ownedOrganizations.map((org) => org.id))
    const memberships = memberOrganizations.filter((org) => !ownedIds.has(org.id))
    return [...ownedOrganizations, ...memberships]
  }, [memberOrganizations, ownedOrganizations])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false
    const token = window.localStorage.getItem('token')
    setHasSession(Boolean(token))
    if (!token) {
      setMe(null)
      setCommunityOptions([])
      setOwnedOrganizations([])
      setMemberOrganizations([])
      return
    }

    if (cachedMe) {
      setMe(cachedMe)
    }

    void (async () => {
      try {
        const resolvedMe = cachedMe ?? (await ensureViewerMe({ token }))
        if (cancelled) return

        if (!resolvedMe) {
          setMe(null)
          setCommunityOptions([])
          setOwnedOrganizations([])
          setMemberOrganizations([])
          return
        }

        setMe(resolvedMe)

        if (resolvedMe.accountType === 'family_member' || familyView) {
          setCommunityOptions([])
          setOwnedOrganizations([])
          setMemberOrganizations([])
          return
        }

        const headers = { authorization: `Bearer ${token}` }
        const [followsRes, ownedRes, membershipsRes] = await Promise.all([
          fetch(buildApiUrl('/communities/follows'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/organizations/owned'), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/organizations/memberships'), { headers, cache: 'no-store' }),
        ])

        if (cancelled) return

        if (followsRes.ok) {
          const payload = (await followsRes.json().catch(() => null)) as CommunityFollowsResponse | null
          const followItems = Array.isArray(payload?.items) ? payload.items : []
          const deduped = new Map<string, CommunityTarget>()
          followItems.forEach((follow) => {
            const target = mapFollowToCommunityTarget(follow)
            deduped.set(`${target.provinceCode}:${target.communitySlug}`, target)
          })
          setCommunityOptions(Array.from(deduped.values()))
        } else {
          setCommunityOptions([])
        }

        if (ownedRes.ok) {
          const payload = (await ownedRes.json().catch(() => null)) as OrganizationsOwnedResponse | null
          setOwnedOrganizations(Array.isArray(payload?.items) ? payload.items : [])
        } else {
          setOwnedOrganizations([])
        }

        if (membershipsRes.ok) {
          const payload = (await membershipsRes.json().catch(() => null)) as OrganizationsMembershipsResponse | null
          setMemberOrganizations(Array.isArray(payload?.items) ? payload.items : [])
        } else {
          setMemberOrganizations([])
        }
      } catch (error) {
        console.error('Failed to load topic composer context', error)
        if (!cancelled) {
          setCommunityOptions([])
          setOwnedOrganizations([])
          setMemberOrganizations([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [cachedMe, familyView])

  const firstName = me?.name?.split(' ')[0] ?? 'Citizen'
  const friendlyFirstName = formatDisplayName(firstName) || firstName
  const viewerDisplayName = me?.name ? formatDisplayName(me.name) : me?.handle ?? friendlyFirstName

  const openComposer = useCallback((type: PostType = 'post') => {
    if (typeof window === 'undefined' || !window.localStorage.getItem('token')) {
      redirectToAuthModal('login')
      return
    }

    setComposerDefaultType(type)
    setComposerOpen(true)
  }, [])

  return (
    <div className={className}>
      <CivilComposerLauncher
        coverUrl={me?.coverUrl ?? null}
        avatarSrc={me?.avatarUrl ?? null}
        avatarAlt={viewerDisplayName}
        avatarInitials={viewerDisplayName}
        avatarHref={me?.handle ? `/u/${me.handle}` : undefined}
        isVerified={Boolean(me?.isVerified)}
        isBusiness={Boolean(me?.isPremium)}
        prompt={hasSession ? `What's on your mind, ${friendlyFirstName}?` : guestPrompt}
        actions={COMPOSER_ACTIONS}
        onPrimaryClick={() => openComposer('post')}
        onActionClick={(type) => openComposer(type as PostType)}
      />

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title={modalTitle}
        key={composerDefaultType}
        maxWidthClassName="max-w-3xl"
        closeOnBackdrop={false}
        closeOnEscape={false}
      >
        <PostComposer
          me={me}
          defaultPostType={composerDefaultType}
          onPostCreated={(post) => {
            onPostCreated?.(post)
            setComposerOpen(false)
          }}
          variant="plain"
          communityOptions={communityOptions}
          defaultAudience="network"
          organizationOptions={postableOrganizations.map((org) => ({ id: org.id, name: org.name }))}
        />
      </Modal>
    </div>
  )
}
