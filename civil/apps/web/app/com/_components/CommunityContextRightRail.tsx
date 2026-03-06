import Link from 'next/link'
import Block from '../../_components/Block'
import CivilCard from '../../_components/CivilCard'
import { buildApiUrl } from '../../_lib/api'
import { fetchCommunityOrganizations, type CommunityOrganization } from '../../_lib/organizations'

type NearbyCommunity = {
  name: string
  provinceCode: string
  communitySlug: string
}

type CommunityStatsResponse = {
  members?: number | null
  postsToday?: number
  postsThisMonth?: number
  nearbyCommunities?: NearbyCommunity[]
}

const numberFormatter = new Intl.NumberFormat('en-CA')

function getOrganizationBadge(org: CommunityOrganization): 'Hot' | 'New' | null {
  if (org.followerCount >= 20) return 'Hot'
  const createdAt = Date.parse(org.createdAt)
  if (!Number.isFinite(createdAt)) return null
  const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
  if (ageDays <= 30) return 'New'
  return null
}

export default async function CommunityContextRightRail({
  province,
  municipality,
}: {
  province: string
  municipality: string
}) {
  const statsPromise = fetch(
    buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/stats`),
    { next: { revalidate: 120 } },
  )
    .then(async (res) => (res.ok ? ((await res.json()) as CommunityStatsResponse) : null))
    .catch(() => null)

  const orgsPromise = fetchCommunityOrganizations(province, municipality)

  const [stats, organizations] = await Promise.all([statsPromise, orgsPromise])

  const topOrganizations = [...organizations]
    .sort((a, b) => {
      if (b.followerCount !== a.followerCount) return b.followerCount - a.followerCount
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    .slice(0, 5)

  const nearby = Array.isArray(stats?.nearbyCommunities) ? stats!.nearbyCommunities.slice(0, 5) : []

  return (
    <div className="sticky top-8 space-y-6">
      <Block title="Community Stats">
        <dl className="space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
            <dt className="font-semibold text-slate-600">Members</dt>
            <dd className="font-semibold text-slate-900">
              {typeof stats?.members === 'number' ? numberFormatter.format(stats.members) : '—'}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <dt className="font-semibold text-slate-600">Posts</dt>
            <dd className="mt-1 text-slate-900">
              Today {numberFormatter.format(stats?.postsToday ?? 0)} | This month {numberFormatter.format(stats?.postsThisMonth ?? 0)}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Nearby Communities</p>
          {nearby.length ? (
            <ul className="mt-2 space-y-2">
              {nearby.map((entry) => (
                <li key={`${entry.provinceCode}:${entry.communitySlug}`}>
                  <Link
                    href={`/${entry.provinceCode.toLowerCase()}/${entry.communitySlug.toLowerCase()}`}
                    className="text-sm font-medium text-slate-700 hover:text-slate-900"
                  >
                    {entry.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No nearby communities available yet.</p>
          )}
        </div>
      </Block>

      <Block
        title="Organizations"
        action={{
          label: 'View all',
          href: `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs`,
        }}
      >
        <p className="mb-3 text-xs text-slate-500">New | Hot</p>
        {topOrganizations.length ? (
          <ul className="space-y-3">
            {topOrganizations.map((org) => {
              const badge = getOrganizationBadge(org)
              const provinceCode = (org.provinceCode ?? province).toLowerCase()
              const communitySlug = (org.communitySlug ?? municipality).toLowerCase()
              return (
                <li key={org.id}>
                  <CivilCard
                    href={`/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(org.slug)}`}
                    size="md"
                    name={org.name}
                    avatarAlt={org.name}
                    avatarInitials={org.name}
                    avatarSrc={org.logoUrl ?? null}
                    coverUrl={org.coverUrl}
                    isVerified={Boolean(org.isVerified)}
                    trailing={
                      badge ? (
                        <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">{badge}</span>
                      ) : null
                    }
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No organizations yet.</p>
        )}
      </Block>
    </div>
  )
}
