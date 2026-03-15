"use client"
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import type {
  CommunityGeoMatch,
  CommunityGeolocateResponse,
  CitySummary,
  ElectoralDistrictBrowserResponse,
  ElectoralDistrictContextResponse,
  PostalLookupResponse,
} from '@civil/shared'
import { HiMiniStar } from 'react-icons/hi2'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '../_components/Sidebar'
import { CivilDistrictBrowserMap } from '../_components/map/CivilDistrictBrowserMap'
import { CivilDistrictMap } from '../_components/map/CivilDistrictMap'
import { pushToast } from '../_components/useToasts'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession } from '../_lib/authSession'
import { buildApiUrl } from '../_lib/api'
import DashboardShell from '../_components/DashboardShell'
import { getAuthedEntryPath, type MeResponse } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import {
  GEOLOCATION_POSTAL_SENTINEL,
  formatStoredPostalCode,
  isGeolocationPostalSentinel,
  normalizePostalCodeForLookup,
  readStoredPostalCode,
  writeStoredPostalCode,
} from '../_lib/postalRequirement'

const provincesFallback = [
  { code: 'nl', name: 'Newfoundland and Labrador' },
  { code: 'pe', name: 'Prince Edward Island' },
  { code: 'ns', name: 'Nova Scotia' },
  { code: 'nb', name: 'New Brunswick' },
  { code: 'qc', name: 'Quebec' },
  { code: 'on', name: 'Ontario' },
  { code: 'mb', name: 'Manitoba' },
  { code: 'sk', name: 'Saskatchewan' },
  { code: 'ab', name: 'Alberta' },
  { code: 'bc', name: 'British Columbia' },
  { code: 'yt', name: 'Yukon' },
  { code: 'nt', name: 'Northwest Territories' },
  { code: 'nu', name: 'Nunavut' },
]

type CommunitiesPageMode = 'default' | 'welcome'

type Province = { code: string; name: string }
type CommunityOption = {
  code?: number
  name?: string
  slug: string
  province: string
  cityName?: string
  citySlug?: string
  cityPopulation?: number | null
}

type CommunityFollow = {
  province: string
  communitySlug: string
  home: boolean
  followedAt?: string
  chamber?: CommunityOption
}

type ItemsResponse<T> = {
  items?: T[]
}

type HomeResponse = {
  home?: CommunityOption | null
}

type ErrorResponse = {
  error?: unknown
}

type CommunitiesDashboardResponse = {
  suggestions?: CitySummary[]
}

type WelcomeHomeConfirmation = {
  match: CommunityGeoMatch
  reason: 'auto' | 'suggestion' | 'postal'
  postalCode?: string | null
}

type PendingHomeChangeConfirmation = {
  provinceCode: string
  communitySlug: string
  communityName: string
}

const populationFormatter = new Intl.NumberFormat('en-CA')
const POSTAL_CODE_PLACEHOLDER = 'e.g. M5V-2T6'

const wallpaperBackground: CSSProperties = {
  backgroundImage: "url('/canadawallpapercivil.jpg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed',
}

function formatPopulation(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return populationFormatter.format(value)
}

function buildCityOptionValue(entry: Pick<CommunityOption, 'province' | 'citySlug' | 'slug'>) {
  return `${entry.province}:${entry.citySlug ?? entry.slug}`
}

function extractCitySlugFromKey(key: string) {
  if (!key) return null
  const [, citySlug] = key.split(':')
  return citySlug || null
}

function formatCityOptionLabel(entry: CommunityOption) {
  const base = entry.cityName ?? entry.name ?? entry.slug
  const edaLabel = entry.cityName ? ` · ${entry.name ?? entry.slug}` : ''
  const population = formatPopulation(entry.cityPopulation)
  const populationLabel = population ? ` — pop ${population}` : ''
  return `${base}${edaLabel}${populationLabel}`
}

function formatMatchCityLabel(match: CommunityGeoMatch) {
  const cityName = match.city?.name ?? match.communityName
  const suffix = match.city?.name ? ` (EDA ${match.communityName})` : ''
  return `${cityName}${suffix}`
}

function formatCommunityDisplayName(value: string | null | undefined) {
  if (!value) return ''
  return value
    .split('-')
    .map((segment) => {
      const trimmed = segment.trim()
      if (!trimmed) return ''
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    })
    .filter(Boolean)
    .join(' - ')
}

function buildMatchCityKey(match: CommunityGeoMatch) {
  return `${match.province}:${match.city?.slug ?? match.communitySlug}`
}

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return undefined
}

function canUseMapStyle(styleUrl: string | null | undefined) {
  if (!styleUrl) return false
  if (typeof window === 'undefined') return true

  const pageProtocol = window.location.protocol
  const resolved = (() => {
    try {
      return new URL(styleUrl, window.location.href)
    } catch {
      return null
    }
  })()

  if (!resolved) return false
  if (pageProtocol === 'https:' && resolved.protocol === 'http:') return false
  return true
}

function calculateDistanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  return earthRadiusKm * arc
}

async function safeJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as T | null
  return data
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const message = getErrorMessage((data as ErrorResponse | null)?.error) ?? 'request_failed'
    throw new Error(message)
  }
  return data as T
}

export function CommunitiesView({ mode = 'default' }: { mode?: CommunitiesPageMode }) {

  const [me, setMe] = useState<MeResponse | null>(null)
  const [provinces, setProvinces] = useState<Province[]>(provincesFallback)
  const [communityOptions, setCommunityOptions] = useState<CommunityOption[]>([])
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedCommunitySlug, setSelectedCommunitySlug] = useState('')
  const [selectedCityKey, setSelectedCityKey] = useState('')
  const [homeCommunity, setHomeCommunityState] = useState<CommunityOption | null>(null)
  const [follows, setFollows] = useState<CommunityFollow[]>([])
  const [loadingCities, setLoadingCities] = useState(false)
  const [savingHome, setSavingHome] = useState(false)
  const [followSaving, setFollowSaving] = useState(false)
  const [loadingFollows, setLoadingFollows] = useState(true)
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [suggestedCommunities, setSuggestedCommunities] = useState<CitySummary[]>([])
  const [managingFollow, setManagingFollow] = useState<string | null>(null)
  const [, setBootstrapped] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoStatus, setGeoStatus] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [geoDetected, setGeoDetected] = useState<CommunityGeoMatch | null>(null)
  const [geoSelected, setGeoSelected] = useState<CommunityGeoMatch | null>(null)
  const [geoAlternatives, setGeoAlternatives] = useState<CommunityGeoMatch[]>([])
  const [showGeoOverlay, setShowGeoOverlay] = useState(false)
  const [postalCodeInput, setPostalCodeInput] = useState('')
  const [postalBusy, setPostalBusy] = useState(false)
  const [postalStatus, setPostalStatus] = useState('')
  const [postalError, setPostalError] = useState<string | null>(null)
  const [postalMatches, setPostalMatches] = useState<CommunityGeoMatch[]>([])
  const [postalFsa, setPostalFsa] = useState<PostalLookupResponse['fsa'] | null>(null)
  const [postalNormalized, setPostalNormalized] = useState<string | null>(null)
  const [districtPreview, setDistrictPreview] = useState<ElectoralDistrictContextResponse | null>(null)
  const [districtBusy, setDistrictBusy] = useState(false)
  const [districtError, setDistrictError] = useState<string | null>(null)
  const [welcomePickerView, setWelcomePickerView] = useState<'options' | 'manual' | 'assist'>(() => (mode === 'welcome' ? 'options' : 'manual'))
  const [assistUnlocked, setAssistUnlocked] = useState(false)
  const [welcomeAutoSaving, setWelcomeAutoSaving] = useState(false)
  const [welcomeHomeConfirmation, setWelcomeHomeConfirmation] = useState<WelcomeHomeConfirmation | null>(null)
  const [pendingHomeChangeConfirmation, setPendingHomeChangeConfirmation] = useState<PendingHomeChangeConfirmation | null>(null)
  const [postalOwnerId, setPostalOwnerId] = useState<string | null>(null)
  const [suggestionSavingKey, setSuggestionSavingKey] = useState<string | null>(null)
  const [selectedBrowserProvince, setSelectedBrowserProvince] = useState('')
  const [districtBrowser, setDistrictBrowser] = useState<ElectoralDistrictBrowserResponse | null>(null)
  const [districtBrowserBusy, setDistrictBrowserBusy] = useState(false)
  const [districtBrowserError, setDistrictBrowserError] = useState<string | null>(null)
  const [selectedBrowserDistrictCode, setSelectedBrowserDistrictCode] = useState<number | null>(null)
  const [mapFocusRequestToken, setMapFocusRequestToken] = useState(0)
  const [provinceCommunityFilter, setProvinceCommunityFilter] = useState('')
  const [provinceCommunitySort, setProvinceCommunitySort] = useState<'alphabetical' | 'distance'>('alphabetical')

  const isWelcomeMode = mode === 'welcome'
  const provinceSelectRef = useRef<HTMLSelectElement | null>(null)
  const latestPostalSelectionRef = useRef<string | null>(null)
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)
  const setViewerStoreMe = useViewerStore((s) => s.setMe)
  const activePostalOwnerId = postalOwnerId ?? me?.id ?? null

  async function loadCitiesForProvince(province: string, preselectCommunity?: string, preselectCitySlug?: string | null) {
    if (!province) {
      setCommunityOptions([])
      setSelectedCityKey('')
      return
    }
    setLoadingCities(true)
    try {
      let items: CommunityOption[] = []
      try {
        const res = await fetch(buildApiUrl(`/cities?province=${encodeURIComponent(province)}&limit=500`))
        const data = await jsonOrThrow<ItemsResponse<CitySummary>>(res)
        const cityItems = Array.isArray(data.items) ? data.items : []
        if (cityItems.length) {
          items = cityItems.map((city) => ({
            slug: city.communitySlug,
            province: city.provinceCode,
            name: city.communityName,
            cityName: city.name,
            citySlug: city.slug,
            cityPopulation: city.population ?? null,
          }))
        }
      } catch (error) {
        console.warn('Failed loading city catalog, falling back to districts', error)
      }

      if (!items.length) {
        const res = await fetch(buildApiUrl(`/communities?province=${encodeURIComponent(province)}`))
        const data = await jsonOrThrow<ItemsResponse<CommunityOption>>(res)
        items = Array.isArray(data.items) ? data.items : []
      }

      setCommunityOptions(items)
      if (preselectCommunity) {
        const match = items.find(
          (entry) => entry.slug === preselectCommunity && (!preselectCitySlug || entry.citySlug === preselectCitySlug),
        )
        if (match) {
          setSelectedCommunitySlug(match.slug)
          setSelectedCityKey(buildCityOptionValue(match))
        } else {
          setSelectedCityKey('')
        }
      } else {
        setSelectedCityKey('')
      }
    } catch (error) {
      console.error('Failed loading cities', error)
      pushToast('Unable to load cities right now. Please try again later.', 'error')
      setCommunityOptions([])
      setSelectedCityKey('')
    } finally {
      setLoadingCities(false)
    }
  }

  const handleProvinceChange = async (evt: ChangeEvent<HTMLSelectElement>) => {
    const value = evt.target.value
    setSelectedProvince(value)
    setSelectedCommunitySlug('')
    setSelectedCityKey('')
    if (value) {
      await loadCitiesForProvince(value)
    } else {
      setCommunityOptions([])
    }
  }

  const handleCityChange = (evt: ChangeEvent<HTMLSelectElement>) => {
    const value = evt.target.value
    setSelectedCityKey(value)
    if (!value) {
      setSelectedCommunitySlug('')
      return
    }
    const match = communityOptions.find((entry) => buildCityOptionValue(entry) === value)
    if (match) {
      setSelectedCommunitySlug(match.slug)
    } else {
      setSelectedCommunitySlug('')
    }
  }

  const handlePostalInputChange = (evt: ChangeEvent<HTMLInputElement>) => {
    if (isWelcomeMode && welcomeAutoSaving) return
    const sanitized = evt.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    let formatted = sanitized
    if (sanitized.length >= 3) {
      const prefix = sanitized.slice(0, 3)
      const suffix = sanitized.slice(3)
      formatted = suffix.length ? `${prefix}-${suffix}` : `${prefix}-`
    }
    setPostalCodeInput(formatted)
    if (postalError) setPostalError(null)
    if (!formatted) {
      setPostalStatus('')
      setPostalMatches([])
      setPostalFsa(null)
      setPostalNormalized(null)
    }
  }

  async function handlePostalLookupSubmit(evt?: FormEvent<HTMLFormElement>) {
    evt?.preventDefault()
    if (isWelcomeMode && welcomeAutoSaving) return
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    const normalized = postalCodeInput.replace(/[^A-Z0-9]/g, '').toUpperCase()
    if (normalized.length < 3) {
      setPostalError('Enter at least the first three characters of your postal code (e.g., M5V).')
      return
    }
    setPostalBusy(true)
    setPostalError(null)
    setPostalStatus('Looking up your postal code…')
    setPostalMatches([])
    setPostalFsa(null)
    setPostalNormalized(null)
    try {
      const res = await fetch(buildApiUrl('/communities/postal-lookup'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postalCode: normalized, limit: 8 }),
      })
      const data = await jsonOrThrow<PostalLookupResponse>(res)
      const matches = [data.primary, ...(Array.isArray(data.alternatives) ? data.alternatives : [])].filter(
        (entry): entry is CommunityGeoMatch => Boolean(entry),
      )
      setPostalMatches(matches)
      setPostalFsa(data.fsa ?? null)
      const resolvedPostal = data.postalCode || normalized
      setPostalNormalized(resolvedPostal)
      latestPostalSelectionRef.current = resolvedPostal
      await loadDistrictPreview({ postalCode: resolvedPostal })
      const primaryMatch = matches[0]
      if (primaryMatch) {
        await applyGeolocationMatch(primaryMatch, 'postal', { postalCode: resolvedPostal })
        setPostalStatus(`Matched ${formatMatchCityLabel(primaryMatch)} using your postal code.`)
      } else if (data.fsa?.defaultCommunityName) {
        setPostalStatus(`Matched ${data.fsa.defaultCommunityName}. Choose it below to continue.`)
      } else {
        setPostalStatus('We found your postal region but need you to pick a city below.')
        setPostalError(
          isWelcomeMode
            ? 'Pick from the suggestions or try another nearby postal code.'
            : 'Pick from the suggestions or choose your province manually.',
        )
      }
    } catch (error) {
      console.error('Postal lookup failed', error)
      const message = getErrorMessage(error)
      const friendly =
        message === 'fsa_not_found'
          ? isWelcomeMode
            ? 'We could not find that postal code yet. Try a nearby one or pick from the suggestions above.'
            : 'We could not find that postal code yet. Try a nearby one or pick manually.'
          : message === 'invalid_postal_code'
            ? 'That postal code looks invalid. Use the first three characters (e.g., M5V).'
            : 'Unable to look up that postal code right now.'
      setPostalError(friendly)
      setPostalStatus('')
      setPostalMatches([])
      setPostalFsa(null)
      setPostalNormalized(null)
    } finally {
      setPostalBusy(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    async function bootstrap() {
      setSuggestionsLoading(true)
      try {
        let meData: MeResponse
        if (cachedMe) {
          meData = cachedMe
        } else {
          const nextMe = await ensureViewerMe({ token })
          if (!nextMe) {
            const tokenStillPresent = typeof window !== 'undefined' ? Boolean(window.localStorage.getItem('token')) : true
            if (!tokenStillPresent) {
              redirectToAuthModal('login')
              return
            }
            throw new Error('failed_me')
          }
          meData = nextMe
        }

        const [provRes, homeRes, followsRes, dashboardRes] = await Promise.all([
          fetch(buildApiUrl('/communities/provinces')),
          fetch(buildApiUrl('/communities/home'), { headers: { authorization: `Bearer ${token}` } }),
          fetch(buildApiUrl('/communities/follows'), { headers: { authorization: `Bearer ${token}` } }),
          fetch(buildApiUrl('/communities/dashboard'), { headers: { authorization: `Bearer ${token}` } }),
        ])

        setMe(meData)
        setPostalOwnerId(meData.id ?? null)
        const storedPostalRaw = readStoredPostalCode(meData.id)
        if (storedPostalRaw) {
          const formatted = formatStoredPostalCode(storedPostalRaw)
          if (formatted) {
            setPostalNormalized(formatted)
          }
          latestPostalSelectionRef.current = storedPostalRaw
        }
        const hasStoredPostal = Boolean(storedPostalRaw)

        let provData: ItemsResponse<Province> | null = null
        try {
          provData = await jsonOrThrow<ItemsResponse<Province>>(provRes)
        } catch {
          provData = { items: provincesFallback }
        }
        if (Array.isArray(provData?.items) && provData.items.length) {
          setProvinces(provData.items)
        }

        const followsData = (await safeJson<ItemsResponse<CommunityFollow>>(followsRes)) ?? { items: [] }
        const followItems = Array.isArray(followsData.items) ? followsData.items : []
        setFollows(followItems)

        const homeData = (await safeJson<HomeResponse>(homeRes)) ?? { home: null }
        let nextHome = homeData.home ?? null
        if (!nextHome) {
          const fallback = followItems.find((item) => item.home && item.chamber)
          if (fallback?.chamber) {
            nextHome = fallback.chamber
          }
        }

        if (nextHome?.slug) {
          setHomeCommunityState(nextHome)
          setSelectedProvince(nextHome.province)
          setSelectedCommunitySlug(nextHome.slug)
          setSelectedBrowserProvince(nextHome.province)
          if (isWelcomeMode) {
            await loadCitiesForProvince(nextHome.province, nextHome.slug)
          }
        } else if (!isWelcomeMode) {
          router.replace('/welcome')
          return
        }

        if (!hasStoredPostal && !isWelcomeMode && !nextHome?.slug) {
          router.replace('/welcome')
          return
        }

        const dashboardData = await safeJson<CommunitiesDashboardResponse>(dashboardRes)
        if (dashboardData?.suggestions && Array.isArray(dashboardData.suggestions)) {
          setSuggestedCommunities(dashboardData.suggestions.slice(0, 8))
        } else {
          setSuggestedCommunities([])
        }

        if (!nextHome?.province && storedPostalRaw && !isGeolocationPostalSentinel(storedPostalRaw)) {
          try {
            const postalRes = await fetch(buildApiUrl('/communities/postal-lookup'), {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ postalCode: storedPostalRaw, limit: 1 }),
            })
            const postalData = await safeJson<PostalLookupResponse>(postalRes)
            if (postalData?.fsa?.provinceCode) {
              setSelectedBrowserProvince(postalData.fsa.provinceCode)
            }
          } catch (error) {
            console.warn('Failed inferring browser province from stored postal code', error)
          }
        }
      } catch (err) {
        console.error('Failed bootstrapping communities screen', err)
        clearAuthSession()
        redirectToAuthModal('login')
      } finally {
        setLoadingFollows(false)
        setSuggestionsLoading(false)
        setBootstrapped(true)
      }
    }

    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshFollows(options: { token?: string; syncHome?: boolean } = {}): Promise<CommunityFollow[]> {
    const token = options.token ?? localStorage.getItem('token')
    if (!token) return []
    setLoadingFollows(true)
    try {
      const res = await fetch(buildApiUrl('/communities/follows'), {
        headers: { authorization: `Bearer ${token}` },
      })
      const data = await jsonOrThrow<ItemsResponse<CommunityFollow>>(res)
      const items = Array.isArray(data.items) ? data.items : []
      setFollows(items)
      if (options.syncHome) {
        const nextHome = items.find((item) => item.home && item.chamber)
        if (nextHome?.chamber) {
          setHomeCommunityState(nextHome.chamber)
        } else if (!items.some((item) => item.home)) {
          setHomeCommunityState(null)
        }
      }
      return items
    } catch (error) {
      console.error('Failed loading followed cities', error)
      pushToast('Unable to load your followed cities right now.', 'error')
      return []
    } finally {
      setLoadingFollows(false)
    }
  }

  async function loadDistrictPreview(args: { postalCode?: string | null; lat?: number; lng?: number }) {
    const token = localStorage.getItem('token')
    if (!token) return
    if (!args.postalCode && !(Number.isFinite(args.lat) && Number.isFinite(args.lng))) {
      setDistrictPreview(null)
      setDistrictError(null)
      return
    }

    setDistrictBusy(true)
    setDistrictError(null)
    try {
      const res = await fetch(buildApiUrl('/geography/district-context'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(args),
      })
      const data = await jsonOrThrow<ElectoralDistrictContextResponse>(res)
      setDistrictPreview(data)
      if (!data.district) {
        setDistrictError('We found your location, but could not match an electoral district yet.')
      }
    } catch (error) {
      console.error('Failed loading district preview', error)
      setDistrictPreview(null)
      const message = getErrorMessage(error)
      setDistrictError(
        message === 'postgis_not_enabled'
          ? 'The map database is not ready yet. Recreate the PostGIS database container and apply the latest migrations.'
          : 'Unable to load your district map right now.',
      )
    } finally {
      setDistrictBusy(false)
    }
  }

  async function applyGeolocationMatch(
    match: CommunityGeoMatch,
    reason: 'auto' | 'suggestion' | 'postal',
    options?: { postalCode?: string | null },
  ) {
    try {
      if (reason === 'auto' || reason === 'postal') {
        setGeoDetected(match)
      }
      setGeoSelected(match)
      setSelectedProvince(match.province)
      if (isWelcomeMode) {
        await loadCitiesForProvince(match.province, match.communitySlug, match.city?.slug ?? null)
      }
      setSelectedCommunitySlug(match.communitySlug)
      setSelectedCityKey(buildMatchCityKey(match))
      const matchLabel = formatMatchCityLabel(match)
      const contextMessage =
        reason === 'auto'
          ? match.method === 'geofenced'
            ? `Matched ${matchLabel} using Elections Canada boundaries.`
            : `Matched ${matchLabel}. This is the closest city district to your location.`
          : reason === 'postal'
            ? `Matched ${matchLabel} using your postal code.`
            : `Switched to ${matchLabel}.`
      pushToast(contextMessage, 'success')
      if (reason === 'postal') {
        setGeoStatus(`Ready to continue in ${matchLabel} using your postal code.`)
      } else {
        setGeoStatus(`Ready to continue in ${matchLabel}.`)
      }
      setGeoError(null)
      if (reason === 'postal') {
        const selectedPostal = options?.postalCode ?? latestPostalSelectionRef.current ?? postalNormalized ?? postalFsa?.code ?? null
        if (selectedPostal) {
          writeStoredPostalCode(activePostalOwnerId, selectedPostal)
          latestPostalSelectionRef.current = selectedPostal
          setPostalNormalized(formatStoredPostalCode(selectedPostal))
        }
      } else if (reason === 'auto') {
        const existingPostal = readStoredPostalCode(activePostalOwnerId)
        if (!existingPostal) {
          writeStoredPostalCode(activePostalOwnerId, GEOLOCATION_POSTAL_SENTINEL)
          setPostalNormalized(formatStoredPostalCode(GEOLOCATION_POSTAL_SENTINEL))
        }
      }
      if (isWelcomeMode) {
        setWelcomeHomeConfirmation({
          match,
          reason,
          postalCode: options?.postalCode ?? latestPostalSelectionRef.current ?? postalNormalized ?? postalFsa?.code ?? null,
        })
        return
      }
    } catch (error) {
      console.error('Failed applying geolocation match', error)
      setGeoError(
        isWelcomeMode
          ? 'We found a nearby city but could not select it automatically. Pick one of the suggestions above to continue.'
          : 'We found a nearby city but could not select it automatically. Please choose from the lists above.',
      )
      pushToast(
        isWelcomeMode
          ? 'We found a nearby city but could not auto-select it. Pick one of the suggestions above.'
          : 'We found a nearby city but could not auto-select it. Pick it manually.',
        'error',
      )
    }
  }

  function handleSuggestionSelect(match: CommunityGeoMatch) {
    if (isWelcomeMode && welcomeAutoSaving) return
    void applyGeolocationMatch(match, 'suggestion')
  }

  async function confirmWelcomeHomeCommunity() {
    if (!welcomeHomeConfirmation) return
    await setHomeCommunity(welcomeHomeConfirmation.match.province, welcomeHomeConfirmation.match.communitySlug, 'welcome', { skipCityLoad: true })
  }

  function resetWelcomeHomeConfirmation() {
    if (welcomeAutoSaving) return
    setWelcomeHomeConfirmation(null)
  }

  function handleAutoDetect() {
    if (isWelcomeMode && welcomeAutoSaving) return
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!navigator.geolocation) {
      pushToast(
        isWelcomeMode
          ? 'Your browser does not support location detection. Use the postal search above instead.'
          : 'Your browser does not support location detection. Please pick your city manually.',
        'error',
      )
      return
    }

    setGeoBusy(true)
    setGeoStatus('Requesting permission…')
    setGeoError(null)
    setGeoAlternatives([])
    setGeoDetected(null)
    setGeoSelected(null)
    setDistrictPreview(null)
    setDistrictError(null)
    setShowGeoOverlay(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeoStatus('Matching your city…')
        try {
          const { latitude, longitude } = pos.coords
          const res = await fetch(buildApiUrl('/communities/geolocate'), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ lat: latitude, lng: longitude, limit: 8 }),
          })
          const data = await jsonOrThrow<CommunityGeolocateResponse>(res)
          const primary = data.primary ?? null
          const alternatives = Array.isArray(data.alternatives) ? data.alternatives : []
          setGeoAlternatives(alternatives)
          await loadDistrictPreview({ lat: latitude, lng: longitude })
          if (primary) {
            await applyGeolocationMatch(primary, 'auto')
          } else {
            setGeoDetected(null)
            setGeoSelected(null)
            setGeoStatus('We could not find an exact city match. Please choose a suggestion below.')
            setGeoError('We matched nearby cities. Pick the correct one to continue.')
          }
        } catch (error) {
          console.error('Geolocation lookup failed', error)
          setGeoStatus('Unable to match your location automatically.')
          const fallbackMessage = isWelcomeMode
            ? 'Unable to match your location right now. Try another postal code or pick from the suggestions above.'
            : 'Unable to match your location right now. Please choose manually.'
          setGeoError(getErrorMessage(error) ?? fallbackMessage)
          pushToast('Unable to identify your city automatically right now.', 'error')
        } finally {
          setGeoBusy(false)
          setShowGeoOverlay(false)
        }
      },
      (err) => {
        console.warn('Geolocation request denied or failed', err)
        setGeoBusy(false)
        setShowGeoOverlay(false)
        if (err.code === 1) {
          setGeoStatus('Location permission was denied.')
          setGeoError(
            isWelcomeMode
              ? 'Enable location permissions in your browser and try again, or enter your postal code above to continue.'
              : 'Enable location permissions in your browser to auto-detect your city, or select it manually.',
          )
          pushToast(
            isWelcomeMode
              ? 'Location permission denied. Adjust permissions or use the postal search above.'
              : 'Location permission denied. Select your city manually.',
            'error',
          )
        } else if (err.code === 3) {
          setGeoStatus('Location lookup timed out.')
          setGeoError(
            isWelcomeMode
              ? 'We could not get a fix. Adjust permissions or search by postal code above to move forward.'
              : 'Try again from a spot with better reception, or pick your city manually.',
          )
          pushToast(
            isWelcomeMode
              ? 'Location lookup timed out. Try again after adjusting permissions or search by postal code.'
              : 'Location lookup timed out. Try again or choose manually.',
            'error',
          )
        } else {
          setGeoStatus('We could not retrieve your location.')
          setGeoError(
            isWelcomeMode
              ? 'We could not retrieve your location. Adjust permissions and retry, or enter your postal code above.'
              : 'Please select your province and city manually.',
          )
          pushToast(
            isWelcomeMode
              ? 'We could not retrieve your location. Adjust permissions or use the postal search above.'
              : 'We could not retrieve your location. Select your city manually.',
            'error',
          )
        }
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    )
  }

  type HomeSetSource = 'picker' | 'list' | 'welcome'

  useEffect(() => {
    if (!isWelcomeMode) return
    const lookupPostalCode = normalizePostalCodeForLookup(postalNormalized)
    if (!lookupPostalCode || isGeolocationPostalSentinel(lookupPostalCode)) return
    void loadDistrictPreview({ postalCode: lookupPostalCode })
  }, [isWelcomeMode, postalNormalized])

  useEffect(() => {
    if (isWelcomeMode) return
    const token = localStorage.getItem('token')
    if (!token) return
    if (!selectedBrowserProvince) {
      setDistrictBrowser(null)
      setDistrictBrowserError(null)
      setSelectedBrowserDistrictCode(null)
      return
    }

    let cancelled = false

    void (async () => {
      setDistrictBrowserBusy(true)
      setDistrictBrowserError(null)

      try {
        const lookupPostalCode = normalizePostalCodeForLookup(postalNormalized)
        const payload: {
          provinceCode: string
          communitySlug?: string
          postalCode?: string
          limit: number
        } = {
          provinceCode: selectedBrowserProvince,
          limit: 16,
        }

        if (lookupPostalCode && !isGeolocationPostalSentinel(lookupPostalCode)) {
          payload.postalCode = lookupPostalCode
        } else if (homeCommunity?.province === selectedBrowserProvince && homeCommunity?.slug) {
          payload.communitySlug = homeCommunity.slug
        }

        const res = await fetch(buildApiUrl('/geography/district-browser'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
        const data = await jsonOrThrow<ElectoralDistrictBrowserResponse>(res)
        if (cancelled) return
        setDistrictBrowser(data)
        setSelectedBrowserDistrictCode((current) => {
          if (current && data.districts.some((district) => district.code === current)) return current
          return data.selectedDistrictCode
        })
      } catch (error) {
        if (cancelled) return
        console.error('Failed loading district browser', error)
        setDistrictBrowser(null)
        setSelectedBrowserDistrictCode(null)
        setDistrictBrowserError('Unable to load district boundaries right now.')
      } finally {
        if (!cancelled) {
          setDistrictBrowserBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isWelcomeMode, postalNormalized, selectedBrowserProvince, homeCommunity?.province, homeCommunity?.slug])

  async function setHomeCommunity(
    provinceCode: string,
    communitySlug: string,
    source: HomeSetSource,
    options?: { skipCityLoad?: boolean },
  ) {
    if (!provinceCode || !communitySlug) return
    if (source === 'welcome' && welcomeAutoSaving) return
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    const selectedCitySlug = extractCitySlugFromKey(selectedCityKey)
    let keepWelcomeLocked = false
    if (source === 'picker') {
      setSavingHome(true)
    } else if (source === 'welcome') {
      setWelcomeAutoSaving(true)
      keepWelcomeLocked = true
    } else {
      setManagingFollow(`${provinceCode}:${communitySlug}:home`)
    }
    try {
      const res = await fetch(buildApiUrl('/communities/home'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provinceCode, communitySlug: communitySlug }),
      })
      const data = await jsonOrThrow<HomeResponse>(res)
      const nextHome = data.home ?? { province: provinceCode, slug: communitySlug }
      setHomeCommunityState(nextHome)
      setSelectedProvince(provinceCode)
      setSelectedCommunitySlug(communitySlug)

      const viewerForUpdate = useViewerStore.getState().me ?? me
      let updatedViewer: MeResponse | null = viewerForUpdate
      if (viewerForUpdate) {
        const provinceName =
          provinces.find((province) => province.code === provinceCode)?.name ??
          nextHome.province ??
          provinceCode.toUpperCase()
        const communityName =
          communityOptions.find((community) => community.province === provinceCode && community.slug === communitySlug)?.name ??
          nextHome.name ??
          communitySlug
        updatedViewer = {
          ...viewerForUpdate,
          homeCommunity: {
            provinceCode,
            provinceName,
            communitySlug,
            communityName,
          },
        }
        setMe(updatedViewer)
        setViewerStoreMe(updatedViewer)
      }

      if (isWelcomeMode && !options?.skipCityLoad) {
        await loadCitiesForProvince(provinceCode, communitySlug, selectedCitySlug)
      }
      if (isWelcomeMode) {
        router.replace(updatedViewer ? getAuthedEntryPath(updatedViewer) : '/verify')
        return
      }

      await refreshFollows({ token, syncHome: true })
      const message = source === 'list' ? 'Home city updated.' : 'Home city set. Welcome home!'
      pushToast(message, 'success')
    } catch (error) {
      console.error('Failed saving home city', error)
      const message = getErrorMessage(error)
      const friendly = message === 'chamber_not_found' ? 'City not found. Please pick a different option.' : 'Unable to save home city right now.'
      pushToast(friendly, 'error')
      keepWelcomeLocked = false
    } finally {
      if (source === 'picker') {
        setSavingHome(false)
      } else if (source === 'welcome') {
        if (!keepWelcomeLocked) {
          setWelcomeAutoSaving(false)
        }
      } else {
        setManagingFollow(null)
      }
    }
  }

  async function followCommunity(provinceCode: string, communitySlug: string, options?: { savingKey?: string }) {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (options?.savingKey) {
      setSuggestionSavingKey(options.savingKey)
    } else {
      setFollowSaving(true)
    }
    try {
      const res = await fetch(buildApiUrl('/communities/follows'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provinceCode, communitySlug: communitySlug }),
      })
      await jsonOrThrow<unknown>(res)
      await refreshFollows({ token, syncHome: true })
      pushToast('City followed! You will now see updates from this community.', 'success')
    } catch (error) {
      console.error('Failed following city', error)
      const message = getErrorMessage(error)
      const friendly =
        message === 'chamber_not_found'
          ? 'City not found. Try selecting from the list above.'
          : message === 'invalid_province'
            ? 'Province not recognized. Please try again.'
            : 'Unable to follow this city right now.'
      pushToast(friendly, 'error')
    } finally {
      if (options?.savingKey) {
        setSuggestionSavingKey(null)
      } else {
        setFollowSaving(false)
      }
    }
  }

  async function handleFollowSelected() {
    if (!selectedProvince || !selectedCommunitySlug) return
    await followCommunity(selectedProvince, selectedCommunitySlug)
  }

  async function handleFollowSuggestion(city: CitySummary) {
    if (!city.communitySlug) return
    const key = `${city.provinceCode}:${city.communitySlug}`
    await followCommunity(city.provinceCode, city.communitySlug, { savingKey: key })
  }

  async function handleUnfollow(follow: CommunityFollow) {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    const key = `${follow.province}:${follow.communitySlug}:remove`
    setManagingFollow(key)
    try {
      const res = await fetch(buildApiUrl('/communities/follows'), {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provinceCode: follow.province, communitySlug: follow.communitySlug }),
      })
      await jsonOrThrow<unknown>(res)
      const items = await refreshFollows({ token, syncHome: true })
      pushToast('City removed from your list.', 'success')
      const homeStillExists = items.some((item) => item.home)
      if (!homeStillExists) {
        setHomeCommunityState(null)
        setSelectedProvince('')
        setSelectedCommunitySlug('')
        setCommunityOptions([])
      }
    } catch (error) {
      console.error('Failed unfollowing city', error)
      const message = getErrorMessage(error)
      const friendly = message === 'not_following' ? 'You are not following that city.' : 'Unable to remove this city right now.'
      pushToast(friendly, 'error')
    } finally {
      setManagingFollow(null)
    }
  }

  const canSave = useMemo(() => {
    if (!selectedProvince || !selectedCommunitySlug) return false
    if (!homeCommunity) return true
    return !(homeCommunity.province === selectedProvince && homeCommunity.slug === selectedCommunitySlug)
  }, [homeCommunity, selectedCommunitySlug, selectedProvince])

  const alreadyFollowingSelected = useMemo(() => {
    if (!selectedProvince || !selectedCommunitySlug) return false
    return follows.some((item) => item.province === selectedProvince && item.communitySlug === selectedCommunitySlug)
  }, [follows, selectedCommunitySlug, selectedProvince])

  const normalizedFollows = useMemo(() => {
    const homeKey = homeCommunity ? `${homeCommunity.province}:${homeCommunity.slug}` : null
    const mapped = follows.map((follow) => ({
      ...follow,
      home: homeKey ? `${follow.province}:${follow.communitySlug}` === homeKey : false,
    }))

    if (!homeKey || mapped.some((follow) => follow.home)) {
      return mapped
    }

    return [
      {
        province: homeCommunity.province,
        communitySlug: homeCommunity.slug,
        home: true,
        chamber: homeCommunity,
      },
      ...mapped,
    ]
  }, [follows, homeCommunity])

  const additionalFollows = useMemo(() => normalizedFollows.filter((item) => !item.home), [normalizedFollows])

  const homeFollow = useMemo(() => normalizedFollows.find((item) => item.home), [normalizedFollows])

  const orderedFollows = useMemo(() => (homeFollow ? [homeFollow, ...additionalFollows] : additionalFollows), [homeFollow, additionalFollows])

  const nearbyCommunities = useMemo(() => {
    const filtered = selectedBrowserProvince
      ? suggestedCommunities.filter((city) => city.provinceCode === selectedBrowserProvince)
      : suggestedCommunities
    return filtered.slice(0, 6)
  }, [selectedBrowserProvince, suggestedCommunities])

  const activeBrowserDistrict = useMemo(
    () => districtBrowser?.districts.find((district) => district.code === selectedBrowserDistrictCode) ?? null,
    [districtBrowser, selectedBrowserDistrictCode],
  )
  const selectedBrowserProvinceName = selectedBrowserProvince
    ? provinces.find((province) => province.code === selectedBrowserProvince)?.name ?? selectedBrowserProvince.toUpperCase()
    : 'Canada'
  const visibleOrderedFollows = useMemo(() => {
    const provinceFollows = selectedBrowserProvince
      ? orderedFollows.filter((follow) => follow.province === selectedBrowserProvince)
      : orderedFollows

    if (!selectedBrowserProvince || !districtBrowser?.districts.length) {
      return provinceFollows
    }

    const followMap = new Map(provinceFollows.map((follow) => [`${follow.province}:${follow.communitySlug}`, follow]))
    const browserDrivenFollows = districtBrowser.districts
      .filter((district) => district.provinceCode === selectedBrowserProvince)
      .filter((district) => {
        const districtKey = `${district.provinceCode}:${district.slug}`
        const isHomeDistrict = homeCommunity?.province === district.provinceCode && homeCommunity?.slug === district.slug
        const isFollowedDistrict = follows.some((follow) => follow.province === district.provinceCode && follow.communitySlug === district.slug)
        return isHomeDistrict || isFollowedDistrict
      })
      .map((district) => {
        const districtKey = `${district.provinceCode}:${district.slug}`
        const existing = followMap.get(districtKey)
        if (existing) {
          return {
            ...existing,
            home: Boolean(homeCommunity?.province === district.provinceCode && homeCommunity?.slug === district.slug),
          }
        }
        return {
          province: district.provinceCode,
          communitySlug: district.slug,
          home: Boolean(homeCommunity?.province === district.provinceCode && homeCommunity?.slug === district.slug),
          chamber: {
            slug: district.slug,
            province: district.provinceCode,
            name: district.name,
          },
        } satisfies CommunityFollow
      })

    return browserDrivenFollows.sort((left, right) => {
      if (left.home !== right.home) return left.home ? -1 : 1
      const leftName = left.chamber?.name ?? formatCommunityDisplayName(left.communitySlug)
      const rightName = right.chamber?.name ?? formatCommunityDisplayName(right.communitySlug)
      return leftName.localeCompare(rightName)
    })
  }, [districtBrowser, follows, homeCommunity, orderedFollows, selectedBrowserProvince])

  const followButtonClass = 'border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
  const visitButtonClass = 'border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
  const locationButtonClass = 'inline-flex items-center justify-center border border-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60'

  function requestHomeCommunityChange(provinceCode: string, communitySlug: string, communityName: string) {
    setPendingHomeChangeConfirmation({ provinceCode, communitySlug, communityName })
  }

  async function confirmHomeCommunityChange() {
    if (!pendingHomeChangeConfirmation) return
    await setHomeCommunity(pendingHomeChangeConfirmation.provinceCode, pendingHomeChangeConfirmation.communitySlug, 'list')
    setPendingHomeChangeConfirmation(null)
  }

  const manageSection = (
    <section className="surface-card space-y-6 px-6 py-5 shadow-subtle">
      <div>
          <h1 className="text-2xl font-bold text-gray-900">Communities you follow in {selectedBrowserProvinceName}</h1>
        <p className="mt-2 text-sm text-gray-600">Stay connected to your home district and add nearby communities to your feed.</p>
      </div>

      <div>
        {loadingFollows ? (
          <div className="mt-3 text-sm text-gray-500">Loading your followed cities…</div>
          ) : visibleOrderedFollows.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              You haven't followed any communities in this province yet.
          </div>
        ) : (
          <div className="mt-3 space-y-3">
              {visibleOrderedFollows.map((follow) => {
              const chamber = follow.chamber ?? { slug: follow.communitySlug, province: follow.province }
              const key = `${follow.province}:${follow.communitySlug}`
              const visitHref = `/${chamber.province.toLowerCase()}/${chamber.slug.toLowerCase()}`
              const isHome = Boolean(follow.home)
              const isUpdating = managingFollow === `${key}:home`
              const isRemoving = managingFollow === `${key}:remove`
              const cityLabel = chamber.name || formatCommunityDisplayName(follow.communitySlug)
              const avatarInitial = cityLabel?.[0]?.toUpperCase() ?? '#'
              const matchingDistrict = districtBrowser?.districts.find((district) => district.provinceCode === chamber.province && district.slug === chamber.slug) ?? null
              return (
                <div key={key} className={`rounded-3xl border p-5 ${isHome ? 'border-emerald-300 bg-emerald-50/70' : 'border-blue-300 bg-blue-50/70'}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${isHome ? 'bg-emerald-100' : 'bg-blue-100'}`}>
                        {isHome ? <HiMiniStar className="h-4 w-4 text-emerald-600" /> : <span className="text-xs font-semibold text-blue-700">{avatarInitial}</span>}
                      </span>
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{cityLabel}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${isHome ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                        {isHome ? 'Home' : 'Following'}
                      </span>
                      {!isHome ? (
                        <button
                          type="button"
                          className="border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => requestHomeCommunityChange(chamber.province, chamber.slug, cityLabel)}
                          disabled={isUpdating}
                        >
                          {isUpdating ? 'Setting…' : 'Set as home'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        if (matchingDistrict) {
                          focusDistrictOnMap(matchingDistrict.code)
                        }
                      }}
                      disabled={!matchingDistrict}
                    >
                      Show on map
                    </button>
                    <Link className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white" href={visitHref}>
                      Visit
                    </Link>
                    <button
                      type="button"
                      className="border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => handleUnfollow(follow)}
                      disabled={isRemoving}
                    >
                      {isRemoving ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )


  const renderPickerSection = (variant: 'default' | 'welcome') => {
    const isWelcome = variant === 'welcome'
    const sectionClasses = isWelcome ? 'surface-card px-8 py-8 shadow-panel' : 'surface-card px-6 py-5 shadow-subtle'
    const heading = isWelcome ? 'Find your Civil Community' : 'Look up another community'
    const isLocked = isWelcome && welcomeAutoSaving

    const showFullPicker = !isWelcome
    const showManualPickers = !isWelcome
    const pickerContainerClass = `${isWelcome ? 'mt-4' : 'mt-6'} space-y-4`
    const activeGeoMatch = geoSelected ?? geoDetected
    const suggestionMatches: CommunityGeoMatch[] = []
    const seenMatches = new Set<string>()
    const addSuggestion = (match: CommunityGeoMatch | null | undefined) => {
      if (!match) return
      const key = `${match.province}:${match.communitySlug}`
      if (seenMatches.has(key)) return
      seenMatches.add(key)
      suggestionMatches.push(match)
    }
    addSuggestion(activeGeoMatch)
    addSuggestion(geoDetected)
    geoAlternatives.forEach((alt) => addSuggestion(alt))
    postalMatches.forEach((match) => addSuggestion(match))
    const isPostalSuggestion = (match: CommunityGeoMatch) =>
      postalMatches.some((entry) => entry.province === match.province && entry.communitySlug === match.communitySlug)
    const showAssistPanel = !isWelcome || welcomePickerView === 'assist' || assistUnlocked || postalMatches.length > 0
    const handleAssistStart = () => {
      if (isLocked) return
      setWelcomePickerView('assist')
      setAssistUnlocked(true)
      handleAutoDetect()
    }

    const handleAssistGeolocate = () => {
      if (isLocked) return
      if (!assistUnlocked) {
        setAssistUnlocked(true)
      }
      handleAutoDetect()
    }

    return (
      <section className={sectionClasses}>
        <h2 className={`text-2xl font-bold text-gray-900 ${isWelcome ? 'text-center' : ''}`}>{heading}</h2>
        {isWelcome && welcomeAutoSaving ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-white/90 p-4 text-sm text-gray-700 shadow-inner">
            <div className="flex items-center gap-3">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold text-gray-900">Setting your Civil home…</div>
                <div className="text-xs text-gray-500">Hang tight while we save your city and redirect you.</div>
              </div>
            </div>
          </div>
        ) : null}
        <div className={pickerContainerClass}>
          {(() => {
            const postalCard = (
              <div className="rounded-2xl border border-[var(--cc-border)] bg-white/80 p-4 shadow-subtle h-full">
                <form className="space-y-3" onSubmit={handlePostalLookupSubmit}>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Postal code</div>
                    <p className="text-xs text-gray-500">Enter the first six characters (e.g., M5V-2T6) to reveal matching communities.</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <label className="sr-only" htmlFor="postal-code-input">
                      Postal code
                    </label>
                    <input
                      id="postal-code-input"
                      type="text"
                      inputMode="text"
                      autoComplete="postal-code"
                      maxLength={7}
                      className="flex-1 rounded-md border border-[var(--cc-border)] px-3 py-2 text-lg tracking-[0.3em] focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
                      placeholder={POSTAL_CODE_PLACEHOLDER}
                      suppressHydrationWarning
                      value={postalCodeInput}
                      onChange={handlePostalInputChange}
                      disabled={isLocked}
                    />
                    <div className="flex flex-col gap-2 sm:w-auto sm:flex-row">
                      <button
                        type="submit"
                        className="bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                        disabled={postalBusy || isLocked}
                      >
                        {postalBusy ? 'Working…' : 'Start!'}
                      </button>
                      {postalCodeInput ? (
                        <button
                          type="button"
                          className="border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            setPostalCodeInput('')
                            setPostalMatches([])
                            setPostalStatus('')
                            setPostalError(null)
                            setPostalFsa(null)
                            setPostalNormalized(null)
                            setDistrictPreview(null)
                            setDistrictError(null)
                            setWelcomeHomeConfirmation(null)
                          }}
                          disabled={isLocked}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                </form>
                {(postalStatus || postalError) && (
                  <div className="mt-3 space-y-2 text-xs">
                    {postalStatus ? <div className="text-gray-700">{postalStatus}</div> : null}
                    {postalError ? <div className="text-red-500">{postalError}</div> : null}
                  </div>
                )}
                {postalFsa && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-gray-600">
                    <div className="font-semibold text-gray-800">Matched FSA {postalFsa.code}</div>
                    <div className="flex flex-wrap gap-4 pt-1">
                      <span>Province: {postalFsa.provinceCode?.toUpperCase() ?? '—'}</span>
                      {postalFsa.subdivisionName ? <span>Subdivision: {postalFsa.subdivisionName}</span> : null}
                      {postalNormalized ? <span>Normalized: {postalNormalized}</span> : null}
                    </div>
                  </div>
                )}
              </div>
            )

            if (!isWelcome) return postalCard

            return (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[var(--cc-border)] bg-white/85 p-4 shadow-subtle h-full flex flex-col justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Let Civil detect your community</div>
                    <p className="text-xs text-gray-500">Allow a one-time location lookup to match the closest electoral district automatically.</p>
                  </div>
                  <div className="mt-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <button
                        type="button"
                        className={locationButtonClass}
                        onClick={handleAssistStart}
                        disabled={geoBusy || isLocked}
                      >
                        {geoBusy ? 'Detecting…' : 'Use my location'}
                      </button>
                      {assistUnlocked ? (
                        <button
                          type="button"
                          className="border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={handleAssistGeolocate}
                          disabled={geoBusy || isLocked}
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                    {(geoStatus || geoError) && (
                      <div className="mt-3 space-y-1 text-xs">
                        {geoStatus ? <div className="text-gray-700">{geoStatus}</div> : null}
                        {geoError ? <div className="text-red-500">{geoError}</div> : null}
                      </div>
                    )}
                  </div>
                </div>
                {postalCard}
              </div>
            )
          })()}

          {(showAssistPanel || suggestionMatches.length > 0) && (
            <div className="border border-dashed border-[var(--cc-border)] bg-slate-50/60 px-3 py-3 text-sm">
              <div className="text-xs text-gray-500">
                Need another city? Search by province/community below or use the postal lookup to surface more matches.
              </div>
            </div>
          )}

          {showManualPickers ? (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700">Province or territory</label>
                <select
                  className="mt-1 w-full border border-[var(--cc-border)] px-3 py-2 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  ref={provinceSelectRef}
                  value={selectedProvince}
                  onChange={handleProvinceChange}
                  disabled={welcomePickerView === 'assist' && !assistUnlocked}
                >
                  <option value="">Select your province / territory</option>
                  {provinces.map((prov) => (
                    <option key={prov.code} value={prov.code}>
                      {prov.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">City</label>
                <select
                  className="mt-1 w-full border border-[var(--cc-border)] px-3 py-2 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  value={selectedCityKey}
                  onChange={handleCityChange}
                  disabled={welcomePickerView === 'assist' ? !assistUnlocked : !selectedProvince || loadingCities}
                >
                  <option value="">{loadingCities ? 'Loading cities…' : 'Select your city'}</option>
                  {communityOptions.map((ch) => {
                    const optionValue = buildCityOptionValue(ch)
                    return (
                      <option key={optionValue} value={optionValue}>
                        {formatCityOptionLabel(ch)}
                      </option>
                    )
                  })}
                </select>
              </div>
            </>
          ) : null}

          {showFullPicker ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                className={`${visitButtonClass} flex-shrink-0 text-center sm:min-w-[120px]`}
                href={selectedProvince && selectedCommunitySlug ? `/${selectedProvince.toLowerCase()}/${selectedCommunitySlug.toLowerCase()}` : '#'}
                aria-disabled={!selectedProvince || !selectedCommunitySlug}
                tabIndex={!selectedProvince || !selectedCommunitySlug ? -1 : 0}
                onClick={(event) => {
                  if (!selectedProvince || !selectedCommunitySlug) {
                    event.preventDefault()
                  }
                }}
              >
                Visit
              </Link>
              {homeCommunity ? (
                <button
                  type="button"
                  className={followButtonClass}
                  onClick={handleFollowSelected}
                  disabled={!selectedProvince || !selectedCommunitySlug || followSaving || alreadyFollowingSelected}
                >
                  {alreadyFollowingSelected ? 'Following' : followSaving ? 'Following…' : 'Follow this city'}
                </button>
              ) : null}
              <button
                type="button"
                className="bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                onClick={() => setHomeCommunity(selectedProvince, selectedCommunitySlug, 'picker')}
                disabled={!canSave || savingHome}
              >
                {savingHome ? 'Saving…' : homeCommunity ? 'Set as home city' : 'Set home city & follow'}
              </button>
              {homeCommunity && !canSave && (
                <span className="text-xs text-gray-500">This city is already set as your home.</span>
              )}
            </div>
          ) : null}

          {isWelcome && suggestionMatches.length > 0 ? (
            <div className="rounded-2xl border border-[var(--cc-border)] bg-white/80 p-4 shadow-subtle">
              <div className="text-sm font-semibold text-gray-900">Detected communities</div>
              <p className="text-xs text-gray-500">Pick the best match if the automatic selection isn’t perfect.</p>
              <div className="mt-3 space-y-3">
                {suggestionMatches.map((match) => {
                  const key = buildMatchCityKey(match)
                  const isPostal = isPostalSuggestion(match)
                  const details: string[] = []
                  if (typeof match.distanceKm === 'number') {
                    details.push(`${match.distanceKm.toFixed(1)} km away`)
                  }
                  details.push(match.method === 'geofenced' ? 'Exact boundary match' : 'Nearest district')
                  if (isPostal) {
                    details.push('From your postal code')
                  }
                  return (
                    <div key={key} className="rounded-xl border border-[var(--cc-border)] bg-white px-3 py-3">
                      <div className="text-sm font-semibold text-gray-900">{formatMatchCityLabel(match)}</div>
                      <div className="text-xs text-gray-500">{details.join(' • ')}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                          onClick={() => handleSuggestionSelect(match)}
                          disabled={isLocked || geoBusy}
                        >
                          Choose this community
                        </button>
                        {isPostal ? <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--cc-primary)]">Postal match</span> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {isWelcome && (districtBusy || districtPreview || districtError) ? (
            <div className="rounded-2xl border border-[var(--cc-border)] bg-white/85 p-4 shadow-subtle">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Your electoral district</div>
                  <p className="text-xs text-gray-500">
                    Civil centers the map on your current location and highlights the district boundary returned by the backend spatial query.
                  </p>
                </div>
                {districtBusy ? <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]">Loading map…</span> : null}
              </div>

              {districtPreview?.district && canUseMapStyle(districtPreview.styleUrl) ? (
                <div className="mt-4 space-y-4">
                  <CivilDistrictMap context={districtPreview} />
                  <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">{districtPreview.district.name}</div>
                    <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>Source: {districtPreview.resolvedFrom === 'postal_code' ? 'postal code' : 'coordinates'}</span>
                      <span>Match: {districtPreview.district.matchMethod === 'contains' ? 'district contains point' : 'nearest district fallback'}</span>
                      {districtPreview.postalCode ? <span>Postal: {districtPreview.postalCode}</span> : null}
                    </div>
                  </div>
                </div>
              ) : districtPreview?.district ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                  District data loaded, but the map preview is disabled because the configured tile server is using insecure HTTP on an HTTPS page.
                </div>
              ) : null}

              {districtError ? <div className="mt-3 text-xs text-red-500">{districtError}</div> : null}
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const districtIsFollowing = activeBrowserDistrict
    ? follows.some((follow) => follow.province === activeBrowserDistrict.provinceCode && follow.communitySlug === activeBrowserDistrict.slug)
    : false
  const districtIsHome = activeBrowserDistrict
    ? homeCommunity?.province === activeBrowserDistrict.provinceCode && homeCommunity?.slug === activeBrowserDistrict.slug
    : false
  const districtSavingKey = activeBrowserDistrict ? `${activeBrowserDistrict.provinceCode}:${activeBrowserDistrict.slug}` : null
  const showNearbyCommunitiesRail = Boolean(selectedBrowserProvince && homeCommunity?.province === selectedBrowserProvince)
  const districtStatusByCode = useMemo(() => {
    if (!districtBrowser) return {}

    const nearbySlugs = new Set(nearbyCommunities.map((city) => `${city.provinceCode}:${city.communitySlug}`))
    const followingSlugs = new Set(follows.map((follow) => `${follow.province}:${follow.communitySlug}`))
    const homeKey = homeCommunity ? `${homeCommunity.province}:${homeCommunity.slug}` : null

    return districtBrowser.districts.reduce<Record<number, 'default' | 'nearby' | 'following' | 'home'>>((acc, district) => {
      const districtKey = `${district.provinceCode}:${district.slug}`
      if (homeKey && districtKey === homeKey) {
        acc[district.code] = 'home'
      } else if (followingSlugs.has(districtKey)) {
        acc[district.code] = 'following'
      } else if (nearbySlugs.has(districtKey)) {
        acc[district.code] = 'nearby'
      } else {
        acc[district.code] = 'default'
      }
      return acc
    }, {})
  }, [districtBrowser, nearbyCommunities, follows, homeCommunity])

  function focusDistrictOnMap(districtCode: number) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setSelectedBrowserDistrictCode(districtCode)
    setMapFocusRequestToken((current) => current + 1)
  }

  const provinceDistrictCards = useMemo(() => {
    if (!districtBrowser) return []

    return districtBrowser.districts.map((district) => {
      const key = `${district.provinceCode}:${district.slug}`
      const isHome = homeCommunity?.province === district.provinceCode && homeCommunity?.slug === district.slug
      const isFollowing = follows.some((follow) => follow.province === district.provinceCode && follow.communitySlug === district.slug)

      return {
        district,
        key,
        isHome,
        isFollowing,
      }
    })
  }, [districtBrowser, follows, homeCommunity])

  const homeProvinceDistrict = useMemo(() => {
    if (!districtBrowser || !homeCommunity || homeCommunity.province !== selectedBrowserProvince) return null
    return districtBrowser.districts.find((district) => district.provinceCode === homeCommunity.province && district.slug === homeCommunity.slug) ?? null
  }, [districtBrowser, homeCommunity, selectedBrowserProvince])

  const canSortProvinceCommunitiesByDistance = Boolean(homeProvinceDistrict)
  const activeProvinceCommunitySort = provinceCommunitySort === 'distance' && canSortProvinceCommunitiesByDistance ? 'distance' : 'alphabetical'

  const filteredProvinceDistrictCards = useMemo(() => {
    const normalizedFilter = provinceCommunityFilter.trim().toLowerCase()

    const cards = provinceDistrictCards
      .map((card) => ({
        ...card,
        distanceKm: homeProvinceDistrict ? calculateDistanceKm(homeProvinceDistrict.center, card.district.center) : null,
      }))
      .filter((card) => {
        if (!normalizedFilter) return true
        return card.district.name.toLowerCase().includes(normalizedFilter)
      })

    cards.sort((left, right) => {
      if (activeProvinceCommunitySort === 'distance' && left.distanceKm != null && right.distanceKm != null) {
        return left.distanceKm - right.distanceKm
      }
      return left.district.name.localeCompare(right.district.name)
    })

    return cards
  }, [activeProvinceCommunitySort, homeProvinceDistrict, provinceCommunityFilter, provinceDistrictCards])

  const districtExplorerSection = isWelcomeMode ? null : (
    <section className="surface-card space-y-5 px-6 py-5 shadow-subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Community Explorer</h2>
          <p className="mt-2 text-sm text-gray-600">
            Join your local community paired by Electoral District Association by Elections Canada.
          </p>
        </div>
        {districtBrowserBusy ? <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]">Loading map…</span> : null}
      </div>

      {districtBrowser?.districts.length && canUseMapStyle(districtBrowser.styleUrl) ? (
        <CivilDistrictBrowserMap
          browser={districtBrowser}
          selectedDistrictCode={selectedBrowserDistrictCode}
          selectedDistrict={activeBrowserDistrict}
          districtStatusByCode={districtStatusByCode}
          focusRequestToken={mapFocusRequestToken}
          isSelectedDistrictFollowing={districtIsFollowing}
          isSelectedDistrictHome={districtIsHome}
          isFollowPending={suggestionSavingKey === districtSavingKey}
          onSelectDistrict={setSelectedBrowserDistrictCode}
          onFollowSelectedDistrict={() => {
            if (activeBrowserDistrict) {
              void followCommunity(activeBrowserDistrict.provinceCode, activeBrowserDistrict.slug, {
                savingKey: districtSavingKey ?? undefined,
              })
            }
          }}
        />
      ) : districtBrowser?.districts.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          District data is available, but the map preview is disabled because the configured tile server is not safe for this page.
        </div>
      ) : districtBrowserBusy ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">Loading district boundaries…</div>
      ) : districtBrowserError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{districtBrowserError}</div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
          Choose a province on the right to load nearby districts.
        </div>
      )}
    </section>
  )

  const communitiesRightRail = isWelcomeMode ? null : (
    <div className="space-y-4">
      <section className="surface-card space-y-4 p-5 shadow-subtle">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Community Lens</p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">Province Filter</h2>
          <p className="mt-2 text-sm text-slate-600">Browse nearby communities and district boundaries within a single province.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">Province or territory</label>
          <select
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
            value={selectedBrowserProvince}
            onChange={(event) => {
              setSelectedBrowserProvince(event.target.value)
              setSelectedBrowserDistrictCode(null)
            }}
          >
            <option value="">Select a province / territory</option>
            {provinces.map((province) => (
              <option key={province.code} value={province.code}>
                {province.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {showNearbyCommunitiesRail ? (
        <section className="surface-card space-y-4 p-5 shadow-subtle">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Nearby Communities</p>
              <p className="mt-2 text-sm text-slate-600">
                Based on your home community, here are some communities around you based on distance:
              </p>
            </div>
            {suggestionsLoading ? <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Loading</span> : null}
          </div>

          {suggestionsLoading ? (
            <div className="text-sm text-slate-500">Loading nearby communities…</div>
          ) : nearbyCommunities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              No nearby communities are available for this province yet.
            </div>
          ) : (
            <div className="space-y-3">
              {nearbyCommunities.map((city) => {
                const key = `${city.provinceCode}:${city.communitySlug}`
                const visitHref = `/${city.provinceCode.toLowerCase()}/${city.communitySlug.toLowerCase()}`
                const isFollowing = follows.some((follow) => follow.province === city.provinceCode && follow.communitySlug === city.communitySlug)
                const isSaving = suggestionSavingKey === key
                const matchingDistrict = districtBrowser?.districts.find((district) => district.provinceCode === city.provinceCode && district.slug === city.communitySlug) ?? null
                return (
                  <div key={key} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">{city.name}</div>
                    {typeof city.distanceKm === 'number' ? <div className="mt-1 text-xs text-slate-500">{city.distanceKm.toFixed(1)} km away</div> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          if (matchingDistrict) {
                            focusDistrictOnMap(matchingDistrict.code)
                          }
                        }}
                        disabled={!matchingDistrict}
                      >
                        Show on map
                      </button>
                      <Link className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" href={visitHref}>
                        Visit
                      </Link>
                      <button
                        type="button"
                        className="border border-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handleFollowSuggestion(city)}
                        disabled={isFollowing || isSaving}
                      >
                        {isFollowing ? 'Following' : isSaving ? 'Following…' : 'Follow'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )

  const provinceCommunitiesSection = isWelcomeMode ? null : (
    <section className="surface-card space-y-6 px-6 py-5 shadow-subtle">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">All Communities in {selectedBrowserProvinceName}</h2>
        <p className="mt-2 text-sm text-gray-600">Browse every community in the selected province and jump straight to the map or community page.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <label className="text-sm font-medium text-slate-700">Filter communities</label>
          <input
            type="text"
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
            value={provinceCommunityFilter}
            onChange={(event) => setProvinceCommunityFilter(event.target.value)}
            placeholder="Type a community name, for example Aur"
          />
        </div>

        <div>
          <div className="text-sm font-medium text-slate-700">Listing</div>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${activeProvinceCommunitySort === 'alphabetical' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
              onClick={() => setProvinceCommunitySort('alphabetical')}
            >
              Alphabetically
            </button>
            <button
              type="button"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${activeProvinceCommunitySort === 'distance' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent`}
              onClick={() => setProvinceCommunitySort('distance')}
              disabled={!canSortProvinceCommunitiesByDistance}
            >
              Distance
            </button>
          </div>
          {!canSortProvinceCommunitiesByDistance ? (
            <p className="mt-2 text-xs text-slate-500">Distance is available when your home riding is in {selectedBrowserProvinceName}.</p>
          ) : null}
        </div>
      </div>

      {!districtBrowser?.districts.length ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No communities are available for this province yet.
        </div>
      ) : filteredProvinceDistrictCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No communities match that filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProvinceDistrictCards.map(({ district, key, isHome, isFollowing, distanceKm }) => {
            const visitHref = `/${district.provinceCode.toLowerCase()}/${district.slug.toLowerCase()}`
            const isSaving = suggestionSavingKey === key
            return (
              <div key={key} className={`rounded-3xl border p-5 ${isHome ? 'border-emerald-300 bg-emerald-50/70' : isFollowing ? 'border-blue-300 bg-blue-50/70' : 'border-slate-200 bg-white'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{district.name}</div>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm text-slate-600">
                      <span>{district.followerCount.toLocaleString()} followers</span>
                      <span>{district.postsToday.toLocaleString()} posts today</span>
                      {distanceKm != null ? <span>{distanceKm.toFixed(1)} km away</span> : null}
                    </div>
                  </div>
                  {isHome ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">Home</span> : isFollowing ? <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Following</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => focusDistrictOnMap(district.code)}
                  >
                    Show on map
                  </button>
                  <Link className="border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" href={visitHref}>
                    Visit
                  </Link>
                  {!isFollowing ? (
                    <button
                      type="button"
                      className="border border-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        void followCommunity(district.provinceCode, district.slug, { savingKey: key })
                      }}
                      disabled={isSaving}
                    >
                      {isSaving ? 'Following…' : 'Follow'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )

  const mainContent = (
    <div className="w-full space-y-6">
      {districtExplorerSection}
      {manageSection}
      {provinceCommunitiesSection}
    </div>
  )

  const geoOverlay = !showGeoOverlay
    ? null
    : (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="border border-gray-200 bg-white px-6 py-4 shadow-lg">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cc-primary)] border-t-transparent"
              />
              <div className="text-sm font-semibold text-gray-900">Locating your city…</div>
            </div>
            <div className="mt-2 text-xs text-gray-500">Please allow location detection when asked!</div>
          </div>
        </div>
      )

  if (mode === 'welcome') {
    const welcomeConfirmationOverlay = !welcomeHomeConfirmation ? null : (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4 py-6 backdrop-blur-sm" aria-modal="true" role="dialog">
        <div className="w-full max-w-3xl rounded-[28px] border border-white/15 bg-white shadow-[0_32px_120px_rgba(15,23,42,0.38)]">
          <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
            <h2 className="text-2xl font-bold text-slate-950">
              Your Home Community Is: <span className="text-slate-900">{formatMatchCityLabel(welcomeHomeConfirmation.match)}</span>
            </h2>
          </div>

          <div className="space-y-5 px-6 py-6 sm:px-8">
            {districtPreview?.district && canUseMapStyle(districtPreview.styleUrl) ? (
              <div>
                <CivilDistrictMap context={districtPreview} />
              </div>
            ) : districtPreview?.district ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                The district map is available in the database, but the tile server is not configured for secure browser use yet. Confirm the community name above, or switch communities.
              </div>
            ) : districtBusy ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">Loading district map…</div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                We matched your community, but the district map is not ready yet. Confirm only if the community name above looks correct.
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={resetWelcomeHomeConfirmation}
                disabled={welcomeAutoSaving}
              >
                Choose another community
              </button>
              <button
                type="button"
                className="rounded-full bg-[var(--cc-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={() => void confirmWelcomeHomeCommunity()}
                disabled={welcomeAutoSaving}
              >
                {welcomeAutoSaving ? 'Saving…' : 'Confirm home community'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )

    const setupOverlay = !welcomeAutoSaving ? null : (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-lg">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cc-primary)] border-t-transparent"
            />
            <div>
              <div className="text-sm font-semibold text-gray-900">Setting up your account…</div>
              <div className="mt-0.5 text-xs text-gray-500">Saving your home community and preparing your feed.</div>
            </div>
          </div>
        </div>
      </div>
    )

    return (
      <div className="relative min-h-screen" style={wallpaperBackground}>
        <div className="absolute inset-0 bg-slate-950/45" aria-hidden />
        <div className="relative mx-auto w-full max-w-4xl px-4 py-10">
          <div className="mb-6 flex justify-center">
            <img src="/logo-white.svg" alt="Civil Citizens" width={160} height={44} className="w-[160px]" />
          </div>
          {renderPickerSection('welcome')}
        </div>
        {geoOverlay}
        {welcomeConfirmationOverlay}
        {setupOverlay}
      </div>
    )
  }

  const homeChangeConfirmationOverlay = !pendingHomeChangeConfirmation ? null : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4 py-6 backdrop-blur-sm" aria-modal="true" role="dialog">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/15 bg-white shadow-[0_32px_120px_rgba(15,23,42,0.38)]">
        <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
          <h2 className="text-2xl font-bold text-slate-950">Change home community?</h2>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="space-y-3 text-sm leading-6 text-slate-700">
            <p>
              Setting your home community will change your membership status, and set your current home community to following. You will still receive relatively the same feeds, but priority is given to your home community.
            </p>
            <p>
              Are you sure you wish to change your home community to <span className="font-semibold text-slate-900">{pendingHomeChangeConfirmation.communityName}</span>?
            </p>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setPendingHomeChangeConfirmation(null)}
              disabled={Boolean(managingFollow)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-[var(--cc-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-400"
              onClick={() => void confirmHomeCommunityChange()}
              disabled={Boolean(managingFollow)}
            >
              {Boolean(managingFollow) ? 'Setting…' : 'Yes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="border-b bg-white py-4 shadow-sm xl:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={me ?? undefined} active="community" />
        </div>
      </div>

      <DashboardShell
        className="min-h-screen"
        mainClassName="space-y-6"
        rightRail={communitiesRightRail}
        showMobileRightRail={!isWelcomeMode}
      >
        {mainContent}
      </DashboardShell>
      {geoOverlay}
      {homeChangeConfirmationOverlay}
    </>
  )
}
