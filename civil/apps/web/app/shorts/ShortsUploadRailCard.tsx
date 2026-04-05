'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import { LuClapperboard, LuUpload } from 'react-icons/lu'
import Modal from '../_components/Modal'
import PostComposer, { type ApiPost, type CommunityTarget } from '../_components/PostComposer'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import type { MeResponse } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
import { useViewerStore } from '../_lib/viewerStore'

type ShortsUploadRailCardProps = {
  onPostCreated?: (post: ApiPost) => void
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

export default function ShortsUploadRailCard({ onPostCreated }: ShortsUploadRailCardProps) {
  const cachedMe = useViewerStore((state) => state.me)
  const familyView = useViewerStore((state) => state.familyView)
  const [me, setMe] = useState<MeResponse | null>(cachedMe ?? null)
  const [communityOptions, setCommunityOptions] = useState<CommunityTarget[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OwnedOrganization[]>([])
  const [memberOrganizations, setMemberOrganizations] = useState<MemberOrganization[]>([])
  const [composerOpen, setComposerOpen] = useState(false)

  const postableOrganizations = useMemo(() => {
    const ownedIds = new Set(ownedOrganizations.map((org) => org.id))
    const memberships = memberOrganizations.filter((org) => !ownedIds.has(org.id))
    return [...ownedOrganizations, ...memberships]
  }, [memberOrganizations, ownedOrganizations])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false
    const token = window.localStorage.getItem('token')
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
        console.error('Failed to load shorts composer context', error)
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

  const openComposer = useCallback(() => {
    if (typeof window === 'undefined' || !window.localStorage.getItem('token')) {
      redirectToAuthModal('login')
      return
    }
    setComposerOpen(true)
  }, [])

  return (
    <>
      <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.95)_100%)] p-5 shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--cc-primary)] text-white shadow-lg shadow-[var(--cc-primary)]/20">
            <LuClapperboard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Upload a Short</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Upload a short video for your network feed.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openComposer}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
        >
          <LuUpload className="h-4 w-4" />
          Upload Short Video
        </button>
      </section>

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Upload a short video"
        maxWidthClassName="max-w-3xl"
        closeOnBackdrop={false}
        closeOnEscape={false}
      >
        <PostComposer
          me={me}
          defaultPostType="post"
          allowedPostTypes={['post']}
          onPostCreated={(post) => {
            onPostCreated?.(post)
            setComposerOpen(false)
          }}
          variant="plain"
          communityOptions={communityOptions}
          defaultAudience="network"
          hideAudience
          postPlaceholder="Add a description"
          organizationOptions={postableOrganizations.map((org) => ({ id: org.id, name: org.name }))}
        />
      </Modal>
    </>
  )
}