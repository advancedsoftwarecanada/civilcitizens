import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import { buildApiUrl } from '../../_lib/api'
import { ensureViewerMe } from '../../_lib/viewerMe'
import { hasHomeCommunity, type MeResponse } from '../../_lib/me'

export type CommunityFollowRow = {
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

export type CommunityFollowsResponse = {
  items?: CommunityFollowRow[]
}

export type CommunityOption = {
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
  isHome: boolean
}

export function followToCommunityOption(follow: CommunityFollowRow): CommunityOption {
  const normalized = normalizeProvinceCode(follow.province)
  const provinceCode = normalized ?? follow.province
  const provinceName = normalized ? getProvinceDisplayName(normalized) ?? normalized.toUpperCase() : follow.province.toUpperCase()
  const communitySlug = follow.communitySlug
  const communityName = follow.community?.name ?? follow.community?.cityName ?? follow.communitySlug
  return {
    provinceCode,
    provinceName,
    communitySlug,
    communityName,
    isHome: Boolean(follow.home),
  }
}

export function buildCommunityOptions(follows: CommunityFollowRow[]): CommunityOption[] {
  const deduped = new Map<string, CommunityOption>()
  follows.forEach((follow) => {
    if (!follow.communitySlug) return
    const option = followToCommunityOption(follow)
    deduped.set(`${option.provinceCode}:${option.communitySlug}`, option)
  })

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.isHome !== b.isHome) return a.isHome ? -1 : 1
    return a.communityName.localeCompare(b.communityName)
  })
}

export function resolveInitialCommunityKey(
  options: CommunityOption[],
  viewer: MeResponse | null,
  preferredKey?: string | null,
): string {
  const normalizedPreferredKey = preferredKey?.trim() ?? ''
  if (normalizedPreferredKey && options.some((entry) => `${entry.provinceCode}:${entry.communitySlug}` === normalizedPreferredKey)) {
    return normalizedPreferredKey
  }

  if (viewer && hasHomeCommunity(viewer)) {
    const home = (viewer.homeCommunity ?? viewer.homeChamber)!
    const homeKey = `${home.provinceCode}:${home.communitySlug}`
    if (options.some((entry) => `${entry.provinceCode}:${entry.communitySlug}` === homeKey)) return homeKey
  }
  return options[0] ? `${options[0].provinceCode}:${options[0].communitySlug}` : ''
}

export async function loadViewerCommunityOptions({
  token,
  cachedMe,
  preferredKey,
}: {
  token: string | null
  cachedMe: MeResponse | null
  preferredKey?: string | null
}): Promise<{
  status: 'ready' | 'unauthorized' | 'error'
  options: CommunityOption[]
  selectedKey: string
  viewer: MeResponse | null
}> {
  if (!token) {
    return { status: 'unauthorized', options: [], selectedKey: '', viewer: null }
  }

  try {
    const [viewer, followsResponse] = await Promise.all([
      cachedMe ? Promise.resolve(cachedMe) : ensureViewerMe({ token, cache: 'no-store' }),
      fetch(buildApiUrl('/communities/follows'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
    ])

    const tokenStillPresent = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : true
    if (!tokenStillPresent || followsResponse.status === 401) {
      return { status: 'unauthorized', options: [], selectedKey: '', viewer: null }
    }

    if (!viewer || !followsResponse.ok) {
      return { status: 'error', options: [], selectedKey: '', viewer: viewer ?? null }
    }

    const followsData = (await followsResponse.json().catch(() => null)) as CommunityFollowsResponse | null
    const followItems = Array.isArray(followsData?.items) ? followsData.items : []
    const options = buildCommunityOptions(followItems)
    const selectedKey = resolveInitialCommunityKey(options, viewer, preferredKey)

    return { status: 'ready', options, selectedKey, viewer }
  } catch {
    return { status: 'error', options: [], selectedKey: '', viewer: null }
  }
}