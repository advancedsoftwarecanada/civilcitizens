"use client"
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import type { ChamberGeoMatch, ChamberGeolocateResponse, CitySummary, PostalLookupResponse } from '@civil/shared'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '../_components/Sidebar'
import { pushToast } from '../_components/useToasts'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import DashboardShell from '../_components/DashboardShell'
import type { MeResponse } from '../_lib/me'
import {
  GEOLOCATION_POSTAL_SENTINEL,
  clearStoredPostalCode,
  formatStoredPostalCode,
  isGeolocationPostalSentinel,
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
type Chamber = {
  code?: number
  name?: string
  slug: string
  province: string
  cityName?: string
  citySlug?: string
  cityPopulation?: number | null
}

type ChamberFollow = {
  province: string
  chamberSlug: string
  home: boolean
  followedAt?: string
  chamber?: Chamber
}

type ItemsResponse<T> = {
  items?: T[]
}

type HomeResponse = {
  home?: Chamber | null
}

type ErrorResponse = {
  error?: unknown
}

const populationFormatter = new Intl.NumberFormat('en-CA')

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

function buildCityOptionValue(entry: Pick<Chamber, 'province' | 'citySlug' | 'slug'>) {
  return `${entry.province}:${entry.citySlug ?? entry.slug}`
}

function extractCitySlugFromKey(key: string) {
  if (!key) return null
  const [, citySlug] = key.split(':')
  return citySlug || null
}

function formatCityOptionLabel(entry: Chamber) {
  const base = entry.cityName ?? entry.name ?? entry.slug
  const edaLabel = entry.cityName ? ` · ${entry.name ?? entry.slug}` : ''
  const population = formatPopulation(entry.cityPopulation)
  const populationLabel = population ? ` — pop ${population}` : ''
  return `${base}${edaLabel}${populationLabel}`
}

function formatMatchCityLabel(match: ChamberGeoMatch) {
  const cityName = match.city?.name ?? match.chamberName
  const suffix = match.city?.name ? ` (EDA ${match.chamberName})` : ''
  return `${cityName}${suffix}`
}

function buildMatchCityKey(match: ChamberGeoMatch) {
  return `${match.province}:${match.city?.slug ?? match.chamberSlug}`
}

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return undefined
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
  const [chambers, setChambers] = useState<Chamber[]>([])
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedChamber, setSelectedChamber] = useState('')
  const [selectedCityKey, setSelectedCityKey] = useState('')
  const [home, setHome] = useState<Chamber | null>(null)
  const [follows, setFollows] = useState<ChamberFollow[]>([])
  const [loadingCities, setLoadingCities] = useState(false)
  const [savingHome, setSavingHome] = useState(false)
  const [followSaving, setFollowSaving] = useState(false)
  const [loadingFollows, setLoadingFollows] = useState(true)
  const [managingFollow, setManagingFollow] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoStatus, setGeoStatus] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [geoDetected, setGeoDetected] = useState<ChamberGeoMatch | null>(null)
  const [geoSelected, setGeoSelected] = useState<ChamberGeoMatch | null>(null)
  const [geoAlternatives, setGeoAlternatives] = useState<ChamberGeoMatch[]>([])
  const [showGeoOverlay, setShowGeoOverlay] = useState(false)
  const [postalCodeInput, setPostalCodeInput] = useState('')
  const [postalBusy, setPostalBusy] = useState(false)
  const [postalStatus, setPostalStatus] = useState('')
  const [postalError, setPostalError] = useState<string | null>(null)
  const [postalMatches, setPostalMatches] = useState<ChamberGeoMatch[]>([])
  const [postalFsa, setPostalFsa] = useState<PostalLookupResponse['fsa'] | null>(null)
  const [postalNormalized, setPostalNormalized] = useState<string | null>(null)
  const [welcomePickerView, setWelcomePickerView] = useState<'options' | 'manual' | 'assist'>(() => (mode === 'welcome' ? 'options' : 'manual'))
  const [assistUnlocked, setAssistUnlocked] = useState(false)
  const [welcomeAutoSaving, setWelcomeAutoSaving] = useState(false)
  const [postalOwnerId, setPostalOwnerId] = useState<string | null>(null)
  const isWelcomeMode = mode === 'welcome'
  const provinceSelectRef = useRef<HTMLSelectElement | null>(null)
  const latestPostalSelectionRef = useRef<string | null>(null)
  const router = useRouter()
  const activePostalOwnerId = postalOwnerId ?? me?.id ?? null

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    async function bootstrap() {
      try {
        const [meRes, provRes, homeRes, followsRes] = await Promise.all([
            fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } }),
            fetch(buildApiUrl('/chambers/provinces')),
            fetch(buildApiUrl('/chambers/home'), { headers: { authorization: `Bearer ${token}` } }),
            fetch(buildApiUrl('/chambers/follows'), { headers: { authorization: `Bearer ${token}` } }),
        ])

        const meData = await jsonOrThrow<MeResponse>(meRes)
        setMe(meData)
        setPostalOwnerId(meData.id ?? null)
        const storedPostalRaw = readStoredPostalCode(meData.id)
        const storedPostalIsGeo = isGeolocationPostalSentinel(storedPostalRaw)
        if (storedPostalRaw) {
          const formatted = formatStoredPostalCode(storedPostalRaw)
          if (formatted) {
            setPostalNormalized(formatted)
          }
          latestPostalSelectionRef.current = storedPostalRaw
        }
        const hasValidStoredPostal = Boolean(storedPostalRaw && !storedPostalIsGeo)

        let provData: ItemsResponse<Province> | null = null
        try {
          provData = await jsonOrThrow<ItemsResponse<Province>>(provRes)
        } catch {
          provData = { items: provincesFallback }
        }
        if (Array.isArray(provData?.items) && provData.items.length) {
          setProvinces(provData.items)
        }

        const followsData = (await safeJson<ItemsResponse<ChamberFollow>>(followsRes)) ?? { items: [] }
        const followItems = Array.isArray(followsData.items) ? followsData.items : []
        setFollows(followItems)

        const homeData = (await safeJson<HomeResponse>(homeRes)) ?? { home: null }
        let homeChamber: Chamber | null = null
        if (homeData?.home?.slug) {
          homeChamber = homeData.home
        } else {
          const fallback = followItems.find((item) => item.home && item.chamber)
          if (fallback?.chamber) homeChamber = fallback.chamber
        }

        if (homeChamber?.slug) {
          setHome(homeChamber)
          setSelectedProvince(homeChamber.province)
          setSelectedChamber(homeChamber.slug)
          await loadCitiesForProvince(homeChamber.province, homeChamber.slug)
        } else if (!isWelcomeMode) {
          router.replace('/welcome')
          return
        }

        if (!hasValidStoredPostal && !isWelcomeMode) {
          if (storedPostalIsGeo) {
            clearStoredPostalCode(meData.id)
          }
          router.replace('/welcome')
          return
        }
      } catch (err) {
        console.error('Failed bootstrapping chambers screen', err)
        localStorage.removeItem('token')
        redirectToAuthModal('login')
      } finally {
        setLoadingFollows(false)
        setBootstrapped(true)
      }
    }

    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadCitiesForProvince(province: string, preselectChamber?: string, preselectCitySlug?: string | null) {
    if (!province) {
      setChambers([])
      setSelectedCityKey('')
      return
    }
    setLoadingCities(true)
    try {
      let items: Chamber[] = []
      try {
        const res = await fetch(buildApiUrl(`/cities?province=${encodeURIComponent(province)}&limit=500`))
        const data = await jsonOrThrow<ItemsResponse<CitySummary>>(res)
        const cityItems = Array.isArray(data.items) ? data.items : []
        if (cityItems.length) {
          items = cityItems.map((city) => ({
            slug: city.chamberSlug,
            province: city.provinceCode,
            name: city.chamberName,
            cityName: city.name,
            citySlug: city.slug,
            cityPopulation: city.population ?? null,
          }))
        }
      } catch (error) {
        console.warn('Failed loading city catalog, falling back to districts', error)
      }

      if (!items.length) {
        const res = await fetch(buildApiUrl(`/chambers?province=${encodeURIComponent(province)}`))
        const data = await jsonOrThrow<ItemsResponse<Chamber>>(res)
        items = Array.isArray(data.items) ? data.items : []
      }

      setChambers(items)
      if (preselectChamber) {
        const match = items.find(
          (entry) => entry.slug === preselectChamber && (!preselectCitySlug || entry.citySlug === preselectCitySlug)
        )
        if (match) {
          setSelectedChamber(match.slug)
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
      setChambers([])
      setSelectedCityKey('')
    } finally {
      setLoadingCities(false)
    }
  }

  const handleProvinceChange = async (evt: ChangeEvent<HTMLSelectElement>) => {
    const value = evt.target.value
    setSelectedProvince(value)
    setSelectedChamber('')
    setSelectedCityKey('')
    if (value) {
      await loadCitiesForProvince(value)
    } else {
      setChambers([])
    }
  }

  const handleCityChange = (evt: ChangeEvent<HTMLSelectElement>) => {
    const value = evt.target.value
    setSelectedCityKey(value)
    if (!value) {
      setSelectedChamber('')
      return
    }
    const match = chambers.find((entry) => buildCityOptionValue(entry) === value)
    if (match) {
      setSelectedChamber(match.slug)
    } else {
      setSelectedChamber('')
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
      const res = await fetch(buildApiUrl('/chambers/postal-lookup'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postalCode: normalized, limit: 8 }),
      })
      const data = await jsonOrThrow<PostalLookupResponse>(res)
      const matches = [data.primary, ...(Array.isArray(data.alternatives) ? data.alternatives : [])].filter(
        (entry): entry is ChamberGeoMatch => Boolean(entry)
      )
      setPostalMatches(matches)
      setPostalFsa(data.fsa ?? null)
      const resolvedPostal = data.postalCode || normalized
      setPostalNormalized(resolvedPostal)
      latestPostalSelectionRef.current = resolvedPostal
      const primaryMatch = matches[0]
      if (primaryMatch) {
        await applyGeolocationMatch(primaryMatch, 'postal', { postalCode: resolvedPostal })
        setPostalStatus(`Matched ${formatMatchCityLabel(primaryMatch)} using your postal code.`)
      } else if (data.fsa?.defaultChamberName) {
        setPostalStatus(`Matched ${data.fsa.defaultChamberName}. Choose it below to continue.`)
      } else {
        setPostalStatus('We found your postal region but need you to pick a city below.')
        setPostalError(
          isWelcomeMode
            ? 'Pick from the suggestions or try another nearby postal code.'
            : 'Pick from the suggestions or choose your province manually.'
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

  async function refreshFollows(options: { token?: string; syncHome?: boolean } = {}): Promise<ChamberFollow[]> {
    const token = options.token ?? localStorage.getItem('token')
    if (!token) return []
    setLoadingFollows(true)
    try {
        const res = await fetch(buildApiUrl('/chambers/follows'), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
      const data = await jsonOrThrow<ItemsResponse<ChamberFollow>>(res)
      const items = Array.isArray(data.items) ? data.items : []
      setFollows(items)
      if (options.syncHome) {
        const nextHome = items.find((item) => item.home && item.chamber)
        if (nextHome?.chamber) {
          setHome(nextHome.chamber)
        } else if (!items.some((item) => item.home)) {
          setHome(null)
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

  async function applyGeolocationMatch(
    match: ChamberGeoMatch,
    reason: 'auto' | 'suggestion' | 'postal',
    options?: { postalCode?: string | null },
  ) {
    try {
      if (reason === 'auto' || reason === 'postal') {
        setGeoDetected(match)
      }
      setGeoSelected(match)
      setSelectedProvince(match.province)
      if (!isWelcomeMode) {
        await loadCitiesForProvince(match.province, match.chamberSlug, match.city?.slug ?? null)
      }
      setSelectedChamber(match.chamberSlug)
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
        await setHomeChamber(match.province, match.chamberSlug, 'welcome', { skipCityLoad: true })
      }
    } catch (error) {
      console.error('Failed applying geolocation match', error)
      setGeoError(
        isWelcomeMode
          ? 'We found a nearby city but could not select it automatically. Pick one of the suggestions above to continue.'
          : 'We found a nearby city but could not select it automatically. Please choose from the lists above.'
      )
      pushToast(
        isWelcomeMode
          ? 'We found a nearby city but could not auto-select it. Pick one of the suggestions above.'
          : 'We found a nearby city but could not auto-select it. Pick it manually.',
        'error'
      )
    }
  }

  function handleSuggestionSelect(match: ChamberGeoMatch) {
    if (isWelcomeMode && welcomeAutoSaving) return
    void applyGeolocationMatch(match, 'suggestion')
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
        'error'
      )
      return
    }

    setGeoBusy(true)
    setGeoStatus('Requesting permission…')
    setGeoError(null)
    setGeoAlternatives([])
    setGeoDetected(null)
    setGeoSelected(null)
    setShowGeoOverlay(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeoStatus('Matching your city…')
        try {
          const { latitude, longitude } = pos.coords
          const res = await fetch(buildApiUrl('/chambers/geolocate'), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ lat: latitude, lng: longitude, limit: 8 }),
          })
          const data = await jsonOrThrow<ChamberGeolocateResponse>(res)
          const primary = data.primary ?? null
          const alternatives = Array.isArray(data.alternatives) ? data.alternatives : []
          setGeoAlternatives(alternatives)
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
              : 'Enable location permissions in your browser to auto-detect your city, or select it manually.'
          )
          pushToast(
            isWelcomeMode
              ? 'Location permission denied. Adjust permissions or use the postal search above.'
              : 'Location permission denied. Select your city manually.',
            'error'
          )
        } else if (err.code === 3) {
          setGeoStatus('Location lookup timed out.')
          setGeoError(
            isWelcomeMode
              ? 'We could not get a fix. Adjust permissions or search by postal code above to move forward.'
              : 'Try again from a spot with better reception, or pick your city manually.'
          )
          pushToast(
            isWelcomeMode
              ? 'Location lookup timed out. Try again after adjusting permissions or search by postal code.'
              : 'Location lookup timed out. Try again or choose manually.',
            'error'
          )
        } else {
          setGeoStatus('We could not retrieve your location.')
          setGeoError(
            isWelcomeMode
              ? 'We could not retrieve your location. Adjust permissions and retry, or enter your postal code above.'
              : 'Please select your province and city manually.'
          )
          pushToast(
            isWelcomeMode
              ? 'We could not retrieve your location. Adjust permissions or use the postal search above.'
              : 'We could not retrieve your location. Select your city manually.',
            'error'
          )
        }
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    )
  }

  type HomeSetSource = 'picker' | 'list' | 'welcome'

  async function setHomeChamber(provinceCode: string, chamberSlug: string, source: HomeSetSource, options?: { skipCityLoad?: boolean }) {
    if (!provinceCode || !chamberSlug) return
    if (source === 'welcome' && welcomeAutoSaving) return
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    const selectedCitySlug = extractCitySlugFromKey(selectedCityKey)
    if (source === 'picker') {
      setSavingHome(true)
    } else if (source === 'welcome') {
      setWelcomeAutoSaving(true)
    } else {
      setManagingFollow(`${provinceCode}:${chamberSlug}:home`)
    }
    try {
        const res = await fetch(buildApiUrl('/chambers/home'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provinceCode, chamberSlug }),
      })
      const data = await jsonOrThrow<HomeResponse>(res)
      const nextHome = data.home ?? { province: provinceCode, slug: chamberSlug }
      setHome(nextHome)
      setSelectedProvince(provinceCode)
      setSelectedChamber(chamberSlug)
      if (!options?.skipCityLoad) {
        await loadCitiesForProvince(provinceCode, chamberSlug, selectedCitySlug)
      }
      await refreshFollows({ token, syncHome: true })
      const message = source === 'list' ? 'Home city updated.' : 'Home city set. Welcome home!'
      pushToast(message, 'success')
      if (isWelcomeMode) {
        window.setTimeout(() => {
          if (readStoredPostalCode(activePostalOwnerId)) {
            window.location.replace('/home')
          }
        }, 500)
      }
    } catch (error) {
      console.error('Failed saving home city', error)
      const message = getErrorMessage(error)
      const friendly = message === 'chamber_not_found' ? 'City not found. Please pick a different option.' : 'Unable to save home city right now.'
      pushToast(friendly, 'error')
    } finally {
      if (source === 'picker') {
        setSavingHome(false)
      } else if (source === 'welcome') {
        setWelcomeAutoSaving(false)
      } else {
        setManagingFollow(null)
      }
    }
  }

  async function handleFollowSelected() {
    if (!selectedProvince || !selectedChamber) return
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setFollowSaving(true)
    try {
  const res = await fetch(buildApiUrl('/chambers/follows'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provinceCode: selectedProvince, chamberSlug: selectedChamber }),
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
      setFollowSaving(false)
    }
  }

  async function handleUnfollow(follow: ChamberFollow) {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    const key = `${follow.province}:${follow.chamberSlug}:remove`
    setManagingFollow(key)
    try {
  const res = await fetch(buildApiUrl('/chambers/follows'), {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provinceCode: follow.province, chamberSlug: follow.chamberSlug }),
      })
      await jsonOrThrow<unknown>(res)
      const items = await refreshFollows({ token, syncHome: true })
      pushToast('City removed from your list.', 'success')
      const homeStillExists = items.some((item) => item.home)
      if (!homeStillExists) {
        setHome(null)
        setSelectedProvince('')
        setSelectedChamber('')
        setChambers([])
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
    if (!selectedProvince || !selectedChamber) return false
    if (!home) return true
    return !(home.province === selectedProvince && home.slug === selectedChamber)
  }, [selectedProvince, selectedChamber, home])

  const alreadyFollowingSelected = useMemo(() => {
    if (!selectedProvince || !selectedChamber) return false
    return follows.some((item) => item.province === selectedProvince && item.chamberSlug === selectedChamber)
  }, [follows, selectedProvince, selectedChamber])

  const additionalFollows = useMemo(() => follows.filter((item) => !item.home), [follows])

  const homeFollow = useMemo(() => follows.find((item) => item.home), [follows])

  const homeProvinceName = useMemo(() => {
    if (!home) return ''
    const found = provinces.find((p) => p.code === home.province)
    return found?.name || home.province.toUpperCase()
  }, [home, provinces])

  const homeFollowKey = homeFollow ? `${homeFollow.province}:${homeFollow.chamberSlug}` : null
  const homeRemoving = homeFollowKey ? managingFollow === `${homeFollowKey}:remove` : false

  const followButtonClass = 'border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
  const visitButtonClass = 'border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
  const locationButtonClass = 'inline-flex items-center justify-center border border-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
  const tabButtonBaseClass = 'inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'
  const postalCodeDisplay = postalNormalized ?? postalFsa?.code ?? ''
  const postalRegionLabel = postalFsa?.subdivisionName ?? postalFsa?.defaultChamberName ?? null
  const postalCommunities = postalMatches.slice(0, 6)

  const manageSection = (
    <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
      <h1 className="text-2xl font-bold text-gray-900">Your home postal code is</h1>
      <p className="mt-2 text-sm text-gray-600">
        Enter your code to list nearby municipalities, electoral districts, and neighbourhood alerts. This is how we tune
        your unified feed into hyperlocal news while still mapping to your federal riding.
      </p>
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">Postal region</div>
        <div className="text-lg font-semibold text-gray-900">{postalCodeDisplay || 'Not set yet'}</div>
        <p className="text-sm text-gray-500">
          {postalRegionLabel ? `Serving ${postalRegionLabel}` : 'Add your postal code below to reveal nearby communities.'}
        </p>
      </div>
      {postalCommunities.length ? (
        <div className="mt-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">Nearby communities</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {postalCommunities.map((match) => {
              const label = formatMatchCityLabel(match)
              const href = `/${match.province.toLowerCase()}/${match.chamberSlug.toLowerCase()}`
              return (
                <div key={buildMatchCityKey(match)} className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-gray-900">{label}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className={visitButtonClass} href={href}>
                      Visit
                    </Link>
                    <button
                      type="button"
                      className="bg-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                      onClick={() => applyGeolocationMatch(match, 'postal', { postalCode: latestPostalSelectionRef.current })}
                      disabled={savingHome || welcomeAutoSaving}
                    >
                      Tune in
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Run the postal lookup below to see nearby municipalities, EDAs, and neighbourhood feeds you can follow instantly.
        </div>
      )}
      {home ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-subtle">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Home City</div>
              <div className="text-lg font-semibold text-gray-900">{home.name}</div>
              <div className="text-sm text-gray-500">Province: {homeProvinceName}</div>
            </div>
            {homeFollow && (
              <div className="flex flex-wrap items-center gap-2">
                <Link className={visitButtonClass} href={`/${home.province.toLowerCase()}/${home.slug.toLowerCase()}`}>
                  Visit
                </Link>
                <button
                  type="button"
                  className="border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => handleUnfollow(homeFollow)}
                  disabled={homeRemoving}
                >
                  {homeRemoving ? 'Removing…' : 'Remove'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : bootstrapped ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          You haven't set a home city yet. Choose your province and city to get started.
        </div>
      ) : (
        <div className="mt-4 text-sm text-gray-500">Loading your city data…</div>
      )}
      <div className="mt-6">
        <div className="text-sm font-semibold uppercase tracking-wide text-gray-600">Cities you follow</div>
        {loadingFollows ? (
          <div className="mt-3 text-sm text-gray-500">Loading your followed cities…</div>
        ) : additionalFollows.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            {home
              ? "You're currently following your home city. Explore other Civil cities below to keep an eye on more communities."
              : "You haven't followed any cities yet. Choose one below to get started."}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {additionalFollows.map((follow) => {
              const chamber = follow.chamber ?? { slug: follow.chamberSlug, province: follow.province }
              const key = `${follow.province}:${follow.chamberSlug}`
              const provinceName = provinces.find((p) => p.code === chamber.province)?.name || chamber.province.toUpperCase()
              const visitHref = `/${chamber.province.toLowerCase()}/${chamber.slug.toLowerCase()}`
              const isUpdating = managingFollow === `${key}:home`
              const isRemoving = managingFollow === `${key}:remove`
              return (
                <div key={key} className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{chamber.name || follow.chamberSlug.replace(/-/g, ' ')}</div>
                    <div className="text-sm text-gray-500">Province: {provinceName}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className={visitButtonClass} href={visitHref}>
                      Visit
                    </Link>
                    <button
                      type="button"
                      className="bg-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                      onClick={() => setHomeChamber(chamber.province, chamber.slug, 'list')}
                      disabled={isUpdating}
                    >
                      {isUpdating ? 'Setting…' : 'Set as home city'}
                    </button>
                    <button
                      type="button"
                      className="border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
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
    const heading = isWelcome ? 'Enter your Postal Code' : home ? 'Explore more Civil cities' : 'Find your city'
    const isLocked = isWelcome && welcomeAutoSaving

    const showFullPicker = !isWelcome
    const showManualPickers = !isWelcome
    const pickerContainerClass = `${isWelcome ? 'mt-4' : 'mt-6'} space-y-4`
    const activeGeoMatch = geoSelected ?? geoDetected
    const suggestionMatches: ChamberGeoMatch[] = []
    const seenMatches = new Set<string>()
    const addSuggestion = (match: ChamberGeoMatch | null | undefined) => {
      if (!match) return
      const key = `${match.province}:${match.chamberSlug}`
      if (seenMatches.has(key)) return
      seenMatches.add(key)
      suggestionMatches.push(match)
    }
    addSuggestion(activeGeoMatch)
    addSuggestion(geoDetected)
    geoAlternatives.forEach((alt) => addSuggestion(alt))
    postalMatches.forEach((match) => addSuggestion(match))
    const isPostalSuggestion = (match: ChamberGeoMatch) =>
      postalMatches.some((entry) => entry.province === match.province && entry.chamberSlug === match.chamberSlug)
    const showAssistPanel = !isWelcome || welcomePickerView === 'assist' || assistUnlocked || postalMatches.length > 0
    const assistButtonClass = `${tabButtonBaseClass} w-full sm:w-auto ${isWelcome && welcomePickerView === 'assist' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white shadow-sm' : 'border-[var(--cc-primary)] text-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/10'}`

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
        <h2 className="text-2xl font-bold text-gray-900">{heading}</h2>
        {isWelcome ? (
          <>
            <p className="mt-2 text-sm text-gray-600">
              To finish your account, just enter your postal code to connect with Citizens near you! Only the first three characters are needed to get started.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" className={assistButtonClass} onClick={handleAssistStart} disabled={isLocked}>
                Detect my postal code automatically
              </button>
            </div>
            {welcomePickerView === 'assist' ? (
              <div className="mt-6 space-y-3 rounded-md border border-dashed border-[var(--cc-border)] bg-slate-50/60 p-4 text-sm text-gray-700">
                <div className="text-sm font-semibold text-gray-800">
                  {geoBusy ? 'Detecting the closest city to your postal area…' : "We're surfacing nearby matches below."}
                </div>
                <p className="text-sm text-gray-600">
                  We'll use your current location to find the closest city and match it to the right Electoral District Association. We already asked for permission—retry below if you need another attempt.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    className={`${locationButtonClass} w-full sm:w-auto`}
                    onClick={handleAssistGeolocate}
                    disabled={geoBusy || isLocked}
                  >
                    {geoBusy ? 'Detecting…' : assistUnlocked ? 'Retry detection' : 'Detect now'}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
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
          <div className="rounded-2xl border border-[var(--cc-border)] bg-white/80 p-4 shadow-subtle">
            <form className="space-y-3" onSubmit={handlePostalLookupSubmit}>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-800">Postal code</label>
                <p className="text-xs text-gray-500">Enter the first six characters (e.g., M5V-2T6). We auto-format as you type.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="postal-code"
                  maxLength={7}
                  className="flex-1 rounded-md border border-[var(--cc-border)] px-3 py-2 text-lg tracking-[0.3em] focus:border-[var(--cc-primary)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  placeholder="e.g. M5V-2T6"
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

          {(showAssistPanel || suggestionMatches.length > 0) && (
            <div className="border border-dashed border-[var(--cc-border)] bg-slate-50/60 px-3 py-3 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-gray-700">Need a hand?</div>
                  <div className="text-xs text-gray-500">Let us detect your city automatically or pick from suggested matches below.</div>
                </div>
                {showAssistPanel ? (
                  <button
                    type="button"
                    className={locationButtonClass}
                    onClick={handleAutoDetect}
                    disabled={geoBusy || isLocked}
                  >
                    {geoBusy ? 'Detecting…' : 'Use my location'}
                  </button>
                ) : null}
              </div>
              {(geoStatus || geoError || activeGeoMatch) && (
                <div className="mt-3 space-y-2 text-xs">
                  {activeGeoMatch && (
                    <div className="border border-green-200 bg-green-50 px-3 py-2 text-green-700">
                      Matched <span className="font-semibold">{formatMatchCityLabel(activeGeoMatch)}</span> ({activeGeoMatch.province.toUpperCase()})
                      {activeGeoMatch.method === 'geofenced'
                        ? ' using Elections Canada boundaries.'
                        : activeGeoMatch.method
                          ? ' as the closest city to you.'
                          : '.'}
                    </div>
                  )}
                  {geoStatus && !geoStatus.startsWith('Ready to continue') && (
                    <div className="text-gray-600">{geoStatus}</div>
                  )}
                  {geoError && <div className="text-red-500">{geoError}</div>}
                </div>
              )}
              {suggestionMatches.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {isWelcome ? 'Tap a city to continue' : 'Tap a city to switch'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestionMatches.map((match) => {
                      const key = `${match.province}:${match.chamberSlug}`
                      const isActive = selectedProvince === match.province && selectedChamber === match.chamberSlug
                      const isDetected = Boolean(
                        geoDetected &&
                        geoDetected.province === match.province &&
                        geoDetected.chamberSlug === match.chamberSlug
                      )
                      const matchLabel = formatMatchCityLabel(match)
                      const distanceValue = typeof match.city?.distanceKm === 'number' ? match.city.distanceKm : match.distanceKm
                      const buttonClass = isActive
                        ? 'border border-red-500 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60'
                        : 'border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
                      const isPostal = isPostalSuggestion(match)
                      return (
                        <button
                          key={key}
                          type="button"
                          className={buttonClass}
                          onClick={() => handleSuggestionSelect(match)}
                          disabled={isLocked}
                          aria-pressed={isActive}
                        >
                          {matchLabel}
                          {typeof distanceValue === 'number' ? (
                            <span className="ml-1 text-[11px] text-gray-500">({distanceValue} km)</span>
                          ) : null}
                          {isDetected ? (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Detected</span>
                          ) : null}
                          {isPostal ? (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--cc-primary)]">Postal</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
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
                  {chambers.map((ch) => {
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
                href={selectedProvince && selectedChamber ? `/${selectedProvince.toLowerCase()}/${selectedChamber.toLowerCase()}` : '#'}
                aria-disabled={!selectedProvince || !selectedChamber}
                tabIndex={!selectedProvince || !selectedChamber ? -1 : 0}
                onClick={(event) => {
                  if (!selectedProvince || !selectedChamber) {
                    event.preventDefault()
                  }
                }}
              >
                Visit
              </Link>
              {home ? (
                <button
                  type="button"
                  className={followButtonClass}
                  onClick={handleFollowSelected}
                  disabled={!selectedProvince || !selectedChamber || followSaving || alreadyFollowingSelected}
                >
                  {alreadyFollowingSelected ? 'Following' : followSaving ? 'Following…' : 'Follow this city'}
                </button>
              ) : null}
              <button
                type="button"
                className="bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                onClick={() => setHomeChamber(selectedProvince, selectedChamber, 'picker')}
                disabled={!canSave || savingHome}
              >
                {savingHome ? 'Saving…' : home ? 'Set as home city' : 'Set home city & follow'}
              </button>
              {home && !canSave && (
                <span className="text-xs text-gray-500">This city is already set as your home.</span>
              )}
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const mainContent = (
    <div className="space-y-6">
      {manageSection}
      {renderPickerSection('default')}
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
    return (
      <div className="relative min-h-screen" style={wallpaperBackground}>
        <div className="absolute inset-0 bg-slate-950/45" aria-hidden />
        <div className="relative mx-auto w-full max-w-4xl px-4 py-10">
          {renderPickerSection('welcome')}
        </div>
        {geoOverlay}
      </div>
    )
  }

  return (
    <>
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={me ?? undefined} active="community" />
        </div>
      </div>

      <DashboardShell
        className="min-h-screen"
        sidebar={<Sidebar me={me ?? undefined} active="community" />}
        gridClassName="lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]"
        mainClassName="space-y-6"
      >
        {mainContent}
      </DashboardShell>
      {geoOverlay}
    </>
  )
}
