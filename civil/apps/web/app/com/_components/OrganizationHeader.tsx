'use client'

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { LuRepeat2, LuShare } from 'react-icons/lu'
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

  return (
    <div className={resolvedOrg ? 'space-y-0' : undefined}>
      <section className="relative rounded-[36px] rounded-b-none border border-white/60 bg-white/40 shadow-subtle">
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
      </section>

      <section
        className={clsx(
          'rounded-[32px] border border-white/60 bg-white/80 p-6 text-slate-700 shadow-subtle backdrop-blur sm:p-8',
          resolvedOrg && 'rounded-t-none border-t-0',
        )}
      >
        <div className="flex min-w-0 flex-col gap-6 md:flex-row md:items-center md:justify-between">
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
                isBusiness
                className="relative border-4 border-white"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{name}</h1>
              {resolvedOrg?.slug ? (
                <p className="text-sm text-slate-500">
                  @{resolvedOrg.slug} · Organization since {createdLabel}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-slate-500">
                {memberCount === null ? '—' : memberCount} members · {resolvedOrg?.followerCount ?? 0} joined
              </p>
            </div>
          </div>

          {resolvedOrg ? (
            <div className="flex flex-wrap items-center gap-2 md:self-start">
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
              <OrganizationFollowButton
                province={province}
                municipality={municipality}
                slug={slug}
                initialFollowed={resolvedOrg.viewerFollowed ?? false}
              />
            </div>
          ) : null}
        </div>
      </section>

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
