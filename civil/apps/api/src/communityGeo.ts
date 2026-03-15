import { prisma } from '@civil/db'
import type { City as CityModel } from '@prisma/client'
import { CitySummarySchema, getProvinceDisplayName, PROVINCES } from '@civil/shared'
import { z } from 'zod'

import { getCommunityCentroid, locateCommunityFromPoint } from './geodata.js'

const COMMUNITY_SUGGESTION_CACHE_LIMIT = 10
const EARTH_RADIUS_KM = 6371
const POSTAL_SANITIZE_RE = /[^A-Z0-9]/g
const POSTAL_FSA_REGEX = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/
const POSTAL_FULL_REGEX = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/

type CitySummaryType = z.infer<typeof CitySummarySchema>
export type ProvinceCodeLiteral = (typeof PROVINCES)[number]['code']

type NormalizedPostal = {
  postal: string
  fsa: string
}

type CommunitySummaryPayload = {
  provinceCode: ProvinceCodeLiteral
  provinceName: string
  municipalitySlug: string
  municipalityName: string
  population: number | null
  regionLabel: string | null
  communitySlug: string | null
  communityName: string | null
  censusSubdivision: {
    slug: string
    name: string
    type: string | null
  } | null
  source: 'city' | 'subdivision'
}

type CityWithSubdivision = CityModel & {
  censusSubdivision?: {
    slug: string
    name: string
    type: string | null
    defaultCommunityName: string | null
  } | null
}

type SubdivisionWithDivision = {
  slug: string
  name: string
  officialName: string | null
  type: string | null
  population: number | null
  defaultCommunityName: string | null
  defaultCommunitySlug: string | null
  division: { name: string | null } | null
}

type LocateResult = Awaited<ReturnType<typeof locateCommunityFromPoint>>
type RawGeoMatch = NonNullable<LocateResult['primary']>
type RawGeoMatchOrNull = LocateResult['primary']
type EnrichedGeoMatch = RawGeoMatch & { city?: CitySummaryType }
type EnrichedGeoMatchOrNull = (RawGeoMatch & { city?: CitySummaryType }) | null

export const buildFollowKey = (province: string, communitySlug: string) => `${province}:${communitySlug}`

function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

const pickLabel = (...labels: Array<string | null | undefined>) => {
  for (const candidate of labels) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (trimmed) return trimmed
  }
  return null
}

export function filterCachedSuggestions(
  suggestions: CitySummaryType[] | undefined,
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): CitySummaryType[] {
  if (!suggestions?.length) return []
  const filtered: CitySummaryType[] = []
  for (const entry of suggestions) {
    if (!entry?.communitySlug) continue
    const key = buildFollowKey(entry.provinceCode, entry.communitySlug)
    if (excludeKeys.has(key)) continue
    filtered.push(entry)
    if (filtered.length >= limit) break
  }
  return filtered
}

export async function computeNearbyCommunitySuggestions(
  referenceCity: CityModel | null,
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): Promise<CitySummaryType[]> {
  let candidateCities: Array<{ city: CityModel; distance?: number }> = []

  if (referenceCity) {
    const provinceCities = await prisma.city.findMany({
      where: { provinceCode: referenceCity.provinceCode },
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: 400,
    })

    candidateCities = provinceCities.map((city: CityModel) => {
      let distance: number | undefined
      if (
        typeof referenceCity.latitude === 'number' &&
        typeof referenceCity.longitude === 'number' &&
        typeof city.latitude === 'number' &&
        typeof city.longitude === 'number'
      ) {
        distance = haversineDistanceKm(referenceCity.latitude, referenceCity.longitude, city.latitude, city.longitude)
      }
      return { city, distance }
    })

    candidateCities.sort((a, b) => {
      const distanceA = a.distance
      const distanceB = b.distance
      if (typeof distanceA === 'number' && typeof distanceB === 'number') return distanceA - distanceB
      if (typeof distanceA === 'number') return -1
      if (typeof distanceB === 'number') return 1
      return (b.city.population ?? 0) - (a.city.population ?? 0)
    })
  } else {
    const topCities = await prisma.city.findMany({
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: 400,
    })
    candidateCities = topCities.map((city: CityModel) => ({ city }))
  }

  const suggestions: CitySummaryType[] = []
  for (const candidate of candidateCities) {
    if (!candidate.city.communitySlug) continue
    const key = buildFollowKey(candidate.city.provinceCode, candidate.city.communitySlug)
    if (excludeKeys.has(key)) continue
    suggestions.push(formatCitySummary(candidate.city, candidate.distance))
    if (suggestions.length >= limit) break
  }

  return suggestions
}

export function normalizePostalCodeInput(value?: string | null): NormalizedPostal | null {
  if (!value) return null
  const sanitized = value.toUpperCase().replace(POSTAL_SANITIZE_RE, '')
  if (sanitized.length < 3) return null
  const fsa = sanitized.slice(0, 3)
  if (!POSTAL_FSA_REGEX.test(fsa)) return null
  const full = sanitized.slice(0, 6)
  const postal = POSTAL_FULL_REGEX.test(full) ? full : fsa
  return { postal, fsa }
}

export function formatCitySummary(city: CityModel, distanceKm?: number): CitySummaryType {
  const provinceName = getProvinceDisplayName(city.provinceCode as ProvinceCodeLiteral) ?? city.provinceCode.toUpperCase()
  return {
    name: city.name,
    slug: city.slug,
    provinceCode: city.provinceCode,
    provinceName,
    communitySlug: city.communitySlug,
    communityName: city.communityName,
    latitude: city.latitude,
    longitude: city.longitude,
    population: city.population ?? null,
    distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(1)) : undefined,
  }
}

function pickNearestCitySummary(cities: CityModel[], lat: number, lng: number): CitySummaryType | undefined {
  if (!cities.length) return undefined
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return formatCitySummary(cities[0]!)

  let closest: CityModel | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const city of cities) {
    const distance = haversineDistanceKm(lat, lng, city.latitude, city.longitude)
    if (!closest || distance < bestDistance) {
      closest = city
      bestDistance = distance
    }
  }

  if (!closest) return formatCitySummary(cities[0]!)
  return formatCitySummary(closest, bestDistance)
}

export function buildCommunityPayloadFromCity(city: CityWithSubdivision): CommunitySummaryPayload {
  const provinceCode = city.provinceCode as ProvinceCodeLiteral
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) ?? provinceCode.toUpperCase(),
    municipalitySlug: city.slug,
    municipalityName: city.name,
    population: city.population ?? null,
    regionLabel: pickLabel(city.censusSubdivision?.defaultCommunityName, city.censusSubdivision?.name, city.communityName),
    communitySlug: city.communitySlug,
    communityName: city.communityName,
    censusSubdivision: city.censusSubdivision
      ? {
          slug: city.censusSubdivision.slug,
          name: city.censusSubdivision.name,
          type: city.censusSubdivision.type ?? null,
        }
      : null,
    source: 'city',
  }
}

export function buildCommunityPayloadFromSubdivision(
  subdivision: SubdivisionWithDivision,
  provinceCode: ProvinceCodeLiteral,
): CommunitySummaryPayload {
  const municipalityName = pickLabel(subdivision.officialName, subdivision.name) ?? subdivision.name
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) ?? provinceCode.toUpperCase(),
    municipalitySlug: subdivision.slug,
    municipalityName,
    population: subdivision.population ?? null,
    regionLabel: pickLabel(subdivision.defaultCommunityName, subdivision.division?.name, subdivision.name),
    communitySlug: subdivision.defaultCommunitySlug ? subdivision.defaultCommunitySlug : null,
    communityName: pickLabel(subdivision.defaultCommunityName),
    censusSubdivision: {
      slug: subdivision.slug,
      name: subdivision.name,
      type: subdivision.type ?? null,
    },
    source: 'subdivision',
  }
}

export async function enrichMatchesWithCities(matches: RawGeoMatchOrNull[], lat: number, lng: number): Promise<EnrichedGeoMatchOrNull[]> {
  const validMatches = matches.filter((match): match is RawGeoMatch => Boolean(match))
  if (!validMatches.length) return matches as EnrichedGeoMatchOrNull[]

  const communitySlugs = [...new Set(validMatches.map((match) => match.communitySlug))]
  const cityRows = await prisma.city.findMany({
    where: { communitySlug: { in: communitySlugs } },
  })

  const citiesByCommunity = new Map<string, CityModel[]>()
  for (const city of cityRows) {
    const list = citiesByCommunity.get(city.communitySlug)
    if (list) list.push(city)
    else citiesByCommunity.set(city.communitySlug, [city])
  }

  return matches.map((match) => {
    if (!match) return null
    const cityOptions = citiesByCommunity.get(match.communitySlug) ?? []
    const summary = pickNearestCitySummary(cityOptions, lat, lng)
    if (!summary) return match
    return { ...match, city: summary }
  }) as EnrichedGeoMatchOrNull[]
}

async function citySummaryFromGeoMatch(match: EnrichedGeoMatch): Promise<CitySummaryType | null> {
  if (match.city) return match.city
  const centroid = await getCommunityCentroid(match.province, match.communitySlug)
  if (!centroid) return null

  const provinceName = getProvinceDisplayName(match.province as ProvinceCodeLiteral) ?? match.province.toUpperCase()
  return {
    name: match.communityName,
    slug: match.communitySlug,
    provinceCode: match.province,
    provinceName,
    communitySlug: match.communitySlug,
    communityName: match.communityName,
    latitude: centroid.lat,
    longitude: centroid.lng,
    population: match.city?.population ?? null,
    distanceKm: typeof match.distanceKm === 'number' ? Number(match.distanceKm.toFixed(1)) : undefined,
  }
}

export async function computeGeodataFallbackSuggestions(
  referenceFollow: { provinceCode: string; communitySlug: string },
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): Promise<CitySummaryType[]> {
  const centroid = await getCommunityCentroid(referenceFollow.provinceCode, referenceFollow.communitySlug)
  if (!centroid) return []

  const locateResult = await locateCommunityFromPoint(centroid.lat, centroid.lng, { limit })
  const enriched = await enrichMatchesWithCities([locateResult.primary, ...locateResult.alternatives], centroid.lat, centroid.lng)
  const suggestions: CitySummaryType[] = []
  for (const match of enriched) {
    if (!match) continue
    const key = buildFollowKey(match.province, match.communitySlug)
    if (excludeKeys.has(key)) continue
    const summary = await citySummaryFromGeoMatch(match)
    if (!summary) continue
    suggestions.push(summary)
    if (suggestions.length >= limit) break
  }
  return suggestions
}