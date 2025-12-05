import type { ProvinceCode } from '@civil/shared'
import { getProvinceDisplayName, normalizeProvinceCode } from '@civil/shared'
import { buildApiUrl } from './api'

export type CommunitySummary = {
  provinceCode: ProvinceCode
  provinceName: string
  municipalitySlug: string
  municipalityName: string
  population?: number | null
  regionLabel?: string | null
  chamberSlug?: string | null
  chamberName?: string | null
  censusSubdivision?: {
    slug: string
    name: string
    type?: string | null
  } | null
  source?: 'city' | 'subdivision' | null
  dataSource: 'api' | 'fallback'
}

const titleCase = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

const buildFallbackSummary = (provinceCode: ProvinceCode, municipalitySlug: string): CommunitySummary => {
  const municipalityName = titleCase(municipalitySlug)
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) || provinceCode.toUpperCase(),
    municipalitySlug,
    municipalityName,
    population: null,
    regionLabel: null,
    chamberSlug: null,
    chamberName: null,
    censusSubdivision: null,
    source: null,
    dataSource: 'fallback',
  }
}

export async function fetchCommunitySummary(provinceParam: string, municipalityParam: string): Promise<CommunitySummary | null> {
  const provinceCode = normalizeProvinceCode(provinceParam)
  if (!provinceCode) {
    return null
  }
  const municipalitySlug = municipalityParam.trim().toLowerCase()
  if (!municipalitySlug) {
    return null
  }

  const apiPath = buildApiUrl(`/communities/${encodeURIComponent(provinceCode)}/${encodeURIComponent(municipalitySlug)}`)

  try {
    const response = await fetch(apiPath, { next: { revalidate: 300 } })
    if (response.ok) {
      const payload = (await response.json()) as Partial<CommunitySummary>
      return {
        provinceCode,
        provinceName: payload.provinceName || getProvinceDisplayName(provinceCode) || provinceCode.toUpperCase(),
        municipalitySlug,
        municipalityName: payload.municipalityName || titleCase(municipalitySlug),
        population: payload.population ?? null,
        regionLabel: payload.regionLabel ?? null,
        chamberSlug: payload.chamberSlug ?? null,
        chamberName: payload.chamberName ?? null,
        censusSubdivision: payload.censusSubdivision ?? null,
        source: payload.source ?? null,
        dataSource: 'api',
      }
    }
  } catch {
    // Ignore API failures for now; fall back to synthetic metadata so routes still render.
  }

  return buildFallbackSummary(provinceCode, municipalitySlug)
}
