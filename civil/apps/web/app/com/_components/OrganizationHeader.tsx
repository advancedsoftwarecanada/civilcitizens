'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LuRepeat2, LuShare } from 'react-icons/lu'
import ContentModerationMenu from '../../_components/ContentModerationMenu'
import SharePostModal from '../../_components/SharePostModal'
import ShareSendModal from '../../_components/ShareSendModal'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
import { type ShareTarget } from '../../_lib/shareTarget'
import type { CommunityOrganization } from '../../_lib/organizations'
import OrganizationFollowButton from './OrganizationFollowButton'

function formatShortDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDirectoryLabel(value?: string | null) {
  if (!value) return null
  return value
    .split('_')
    .map((segment) => (segment ? segment[0] + segment.slice(1).toLowerCase() : segment))
    .join(' ')
}

function formatTypeLabel(value?: CommunityOrganization['type']) {
  switch (value) {
    case 'INDIVIDUAL':
      return 'Individual'
    case 'SOLE_PROPRIETORSHIP':
      return 'Sole Proprietorship'
    case 'CORPORATION':
      return 'Corporation'
    case 'NON_PROFIT':
      return 'Non Profit'
    case 'CHARITY':
      return 'Charity'
    case 'COMMUNITY_GROUP':
      return 'Community Group'
    case 'RELIGIOUS_ORGANIZATION':
      return 'Religious Organization'
    case 'GOVERNMENT':
      return 'Government'
    default:
      return null
  }
}

export default function OrganizationHeader({
  org,
  fallbackName,
  province,
  municipality,
  slug,
}: {
  org: CommunityOrganization | null
  fallbackName: string
  province: string
  municipality: string
  slug: string
}) {
  const router = useRouter()
  const [resolvedOrg, setResolvedOrg] = useState<CommunityOrganization | null>(org)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
        const authHeaders = token ? { authorization: `Bearer ${token}` } : undefined

        const [orgRes, membersRes] = await Promise.all([
          resolvedOrg
            ? Promise.resolve(null)
            : fetch(
                buildApiUrl(
                  `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`,
                ),
                { headers: authHeaders, cache: 'no-store' },
              ),
          fetch(
            buildApiUrl(
              `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/members`,
            ),
            { headers: authHeaders, cache: 'no-store' },
          ),
        ])

        if (orgRes?.ok) {
          const payload = (await orgRes.json().catch(() => null)) as { org?: CommunityOrganization } | null
          if (!cancelled && payload?.org) setResolvedOrg(payload.org)
        }

        if (membersRes.ok) {
          const payload = (await membersRes.json().catch(() => null)) as { members?: Array<{ userId: string }> } | null
          if (!cancelled) {
            setMemberCount(Array.isArray(payload?.members) ? payload.members.length : 0)
          }
        }
      } catch {
        // ignore
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [municipality, province, resolvedOrg, slug])

  const name = resolvedOrg?.name ?? fallbackName
  const coverDisplayUrl = resolvedOrg?.coverUrl ?? null
  const createdLabel = formatShortDate(resolvedOrg?.createdAt)
  const organizationShareTarget: ShareTarget | null = resolvedOrg
    ? {
        kind: 'organization',
        id: resolvedOrg.id,
        title: resolvedOrg.name,
        description: resolvedOrg.headline || resolvedOrg.description || `Organization profile on Civil`,
        url: `/com/${province.toLowerCase()}/${municipality.toLowerCase()}/orgs/${slug.toLowerCase()}`,
        imageUrl: resolvedOrg.coverUrl ?? resolvedOrg.logoUrl ?? null,
        meta: `${memberCount ?? '—'} members`,
      }
    : null
  const showModerationMenu = Boolean(resolvedOrg && !resolvedOrg.viewerRole)
  const directoryTypeLabel = formatTypeLabel(resolvedOrg?.type)
  const directoryCategoryLabel = formatDirectoryLabel(resolvedOrg?.category)
  const directorySpecializationLabel = formatDirectoryLabel(resolvedOrg?.specialization)
  const categoryDirectoryHref = resolvedOrg?.category
    ? `/organizations/directory?category=${encodeURIComponent(resolvedOrg.category)}`
    : null
  const specializationDirectoryHref = resolvedOrg?.category && resolvedOrg?.specialization
    ? `/organizations/directory?category=${encodeURIComponent(resolvedOrg.category)}&specialization=${encodeURIComponent(resolvedOrg.specialization)}`
    : null

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[32px] border border-white/60 bg-white/92 text-slate-700 shadow-[0_28px_90px_rgba(15,23,42,0.10)] backdrop-blur">
        <div className="relative h-48 w-full overflow-hidden rounded-t-[36px] sm:h-60">
          {coverDisplayUrl ? (
            <>
              <img src={coverDisplayUrl} alt={`${name} cover`} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/20" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-r from-rose-100 via-violet-50 to-sky-100" />
          )}
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-200 via-amber-100 to-sky-200 blur-lg"
                aria-hidden="true"
              />
              <VerifiedAvatar
                src={resolvedOrg?.logoUrl}
                alt={name}
                initials={name}
                size={96}
                isVerified={Boolean(resolvedOrg?.isVerified)}
                className="relative border-4 border-white"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{name}</h1>
              <p className="text-sm text-slate-500">Organization since {createdLabel}</p>
              <p className="mt-1 text-sm text-slate-500">
                {memberCount === null ? '—' : memberCount} members · {resolvedOrg?.followerCount ?? 0} followers
              </p>
              {directoryTypeLabel || directoryCategoryLabel || directorySpecializationLabel ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                  {directoryTypeLabel ? <span>{directoryTypeLabel}</span> : null}
                  {directoryTypeLabel && (directoryCategoryLabel || directorySpecializationLabel) ? <span className="text-slate-300">|</span> : null}
                  {directoryCategoryLabel && categoryDirectoryHref ? (
                    <Link href={categoryDirectoryHref} className="font-medium text-slate-700 hover:text-[var(--cc-primary)] hover:underline">
                      {directoryCategoryLabel}
                    </Link>
                  ) : null}
                  {directoryCategoryLabel && directorySpecializationLabel ? <span className="text-slate-300">|</span> : null}
                  {directorySpecializationLabel && specializationDirectoryHref ? (
                    <Link href={specializationDirectoryHref} className="font-medium text-slate-700 hover:text-[var(--cc-primary)] hover:underline">
                      {directorySpecializationLabel}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        </div>
      </section>

      {resolvedOrg ? (
        <div className="flex justify-center px-2">
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <OrganizationFollowButton
              province={province}
              municipality={municipality}
              slug={slug}
              initialFollowed={resolvedOrg.viewerFollowed ?? false}
            />
            <button
              type="button"
              onClick={() => setRepostModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <LuRepeat2 className="h-4 w-4" />
              <span>Repost</span>
            </button>
            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <LuShare className="h-4 w-4" />
              <span>Share</span>
            </button>
            {showModerationMenu ? (
              <ContentModerationMenu
                reportTarget={{
                  targetType: 'ORGANIZATION',
                  targetId: resolvedOrg.id,
                  targetLabel: resolvedOrg.name,
                }}
                blockTarget={{
                  type: 'organization',
                  id: resolvedOrg.id,
                  label: resolvedOrg.name,
                }}
                buttonClassName="border-slate-200 bg-white text-slate-700 shadow-none backdrop-blur-0 hover:bg-slate-50 hover:text-slate-900 [&_svg]:text-slate-700"
                onReported={() => router.push('/home')}
                onBlocked={() => router.push('/home')}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {repostModalOpen && organizationShareTarget ? (
        <SharePostModal
          target={organizationShareTarget}
          onClose={() => setRepostModalOpen(false)}
        />
      ) : null}

      {shareModalOpen && organizationShareTarget ? (
        <ShareSendModal
          target={organizationShareTarget}
          onClose={() => setShareModalOpen(false)}
        />
      ) : null}
    </div>
  )
}
