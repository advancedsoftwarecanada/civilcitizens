"use client"
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { ChamberGeoMatch, ChamberGeolocateResponse } from '@civil/shared'
import Link from 'next/link'
import Sidebar from '../_components/Sidebar'
import { pushToast } from '../_components/useToasts'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'

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

type ChambersPageMode = 'default' | 'welcome'

type Province = { code: string; name: string }
type Chamber = { code?: number; name?: string; slug: string; province: string }

type ChamberFollow = {
  province: string
  chamberSlug: string
  home: boolean
  followedAt?: string
  chamber?: Chamber
}

type Me = {
  id: string
  name?: string | null
  handle: string
  email: string
  avatarUrl?: string | null
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

export function ChambersView({ mode = 'default' }: { mode?: ChambersPageMode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [provinces, setProvinces] = useState<Province[]>(provincesFallback)
  const [chambers, setChambers] = useState<Chamber[]>([])
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedChamber, setSelectedChamber] = useState('')
  const [home, setHome] = useState<Chamber | null>(null)
  const [follows, setFollows] = useState<ChamberFollow[]>([])
  const [loadingChambers, setLoadingChambers] = useState(false)
  const [savingHome, setSavingHome] = useState(false)
  const [followSaving, setFollowSaving] = useState(false)
  const [loadingFollows, setLoadingFollows] = useState(true)
  const [managingFollow, setManagingFollow] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoStatus, setGeoStatus] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [geoPrimary, setGeoPrimary] = useState<ChamberGeoMatch | null>(null)
  const [geoAlternatives, setGeoAlternatives] = useState<ChamberGeoMatch[]>([])
  const [showGeoOverlay, setShowGeoOverlay] = useState(false)

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

        const meData = await jsonOrThrow<Me>(meRes)
        setMe(meData)

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
          await loadChambersForProvince(homeChamber.province, homeChamber.slug)
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

  async function loadChambersForProvince(province: string, preselect?: string) {
    if (!province) {
      setChambers([])
      return
    }
    setLoadingChambers(true)
    try {
        const res = await fetch(buildApiUrl(`/chambers?province=${encodeURIComponent(province)}`))
      const data = await jsonOrThrow<ItemsResponse<Chamber>>(res)
      const items = Array.isArray(data.items) ? data.items : []
      setChambers(items)
      if (preselect) {
        const exists = items.some((c) => c.slug === preselect)
        if (exists) {
          setSelectedChamber(preselect)
        }
      }
    } catch (error) {
      console.error('Failed loading chambers', error)
      pushToast('Unable to load chambers right now. Please try again later.', 'error')
      setChambers([])
    } finally {
      setLoadingChambers(false)
    }
  }

  const handleProvinceChange = async (evt: ChangeEvent<HTMLSelectElement>) => {
    const value = evt.target.value
    setSelectedProvince(value)
    setSelectedChamber('')
    if (value) {
      await loadChambersForProvince(value)
    } else {
      setChambers([])
    }
  }

  const handleChamberChange = (evt: ChangeEvent<HTMLSelectElement>) => {
    setSelectedChamber(evt.target.value)
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
      console.error('Failed loading followed chambers', error)
      pushToast('Unable to load your followed chambers right now.', 'error')
      return []
    } finally {
      setLoadingFollows(false)
    }
  }

  async function applyGeolocationMatch(match: ChamberGeoMatch, reason: 'auto' | 'suggestion') {
    try {
      setGeoPrimary(match)
      setSelectedProvince(match.province)
      await loadChambersForProvince(match.province, match.chamberSlug)
      setSelectedChamber(match.chamberSlug)
      const contextMessage =
        reason === 'auto'
          ? match.method === 'geofenced'
            ? `Matched ${match.chamberName} using Elections Canada boundaries.`
            : `Matched ${match.chamberName}. This was the closest riding to your location.`
          : `Switched to ${match.chamberName}.`
      pushToast(contextMessage, 'success')
      setGeoStatus(`Ready to continue in ${match.chamberName}.`)
      setGeoError(null)
    } catch (error) {
      console.error('Failed applying geolocation match', error)
      setGeoError('We found a riding but could not select it automatically. Please choose from the lists above.')
      pushToast('We found a riding nearby but could not auto-select it. Pick it manually.', 'error')
    }
  }

  function handleSuggestionSelect(match: ChamberGeoMatch) {
    void applyGeolocationMatch(match, 'suggestion')
  }

  function handleAutoDetect() {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!navigator.geolocation) {
      pushToast('Your browser does not support location detection. Please pick your riding manually.', 'error')
      return
    }

    setGeoBusy(true)
    setGeoStatus('Requesting permission…')
    setGeoError(null)
    setGeoAlternatives([])
    setGeoPrimary(null)
    setShowGeoOverlay(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeoStatus('Matching your riding…')
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
            setGeoPrimary(null)
            setGeoStatus('We could not find an exact riding match. Please choose a suggestion below.')
            setGeoError('We matched nearby ridings. Pick the correct one to continue.')
          }
        } catch (error) {
          console.error('Geolocation lookup failed', error)
          setGeoStatus('Unable to match your location automatically.')
          setGeoError(getErrorMessage(error) ?? 'Unable to match your location right now. Please choose manually.')
          pushToast('Unable to identify your riding automatically right now.', 'error')
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
          setGeoError('Enable location permissions in your browser to auto-detect your riding, or select it manually.')
          pushToast('Location permission denied. Select your riding manually.', 'error')
        } else if (err.code === 3) {
          setGeoStatus('Location lookup timed out.')
          setGeoError('Try again from a spot with better reception, or pick your riding manually.')
          pushToast('Location lookup timed out. Try again or choose manually.', 'error')
        } else {
          setGeoStatus('We could not retrieve your location.')
          setGeoError('Please select your province and riding manually.')
          pushToast('We could not retrieve your location. Select your riding manually.', 'error')
        }
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    )
  }

  async function setHomeChamber(provinceCode: string, chamberSlug: string, source: 'picker' | 'list') {
    if (!provinceCode || !chamberSlug) return
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (source === 'picker') {
      setSavingHome(true)
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
      await loadChambersForProvince(provinceCode, chamberSlug)
      await refreshFollows({ token, syncHome: true })
      const message = source === 'picker' ? 'Home chamber set. Welcome home!' : 'Home chamber updated.'
      pushToast(message, 'success')
      if (mode === 'welcome') {
        window.setTimeout(() => {
          window.location.replace('/home')
        }, 500)
      }
    } catch (error) {
      console.error('Failed saving home chamber', error)
      const message = getErrorMessage(error)
      const friendly = message === 'chamber_not_found' ? 'Chamber not found. Please pick a different option.' : 'Unable to save home chamber right now.'
      pushToast(friendly, 'error')
    } finally {
      if (source === 'picker') {
        setSavingHome(false)
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
      pushToast('Chamber followed! You will now see updates from this riding.', 'success')
    } catch (error) {
      console.error('Failed following chamber', error)
      const message = getErrorMessage(error)
      const friendly =
        message === 'chamber_not_found'
          ? 'Chamber not found. Try selecting from the list above.'
          : message === 'invalid_province'
            ? 'Province not recognized. Please try again.'
            : 'Unable to follow this chamber right now.'
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
      pushToast('Chamber removed from your list.', 'success')
      const homeStillExists = items.some((item) => item.home)
      if (!homeStillExists) {
        setHome(null)
        setSelectedProvince('')
        setSelectedChamber('')
        setChambers([])
      }
    } catch (error) {
      console.error('Failed unfollowing chamber', error)
      const message = getErrorMessage(error)
      const friendly = message === 'not_following' ? 'You are not following that chamber.' : 'Unable to remove this chamber right now.'
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

  const mainContent = (
    <main className={mode === 'welcome' ? 'w-full space-y-6' : 'col-span-12 md:col-span-6 space-y-6'}>
        <section className="rounded-lg border bg-white p-5">
          <h1 className="text-2xl font-bold">Your Chambers of Citizens</h1>
          <p className="mt-2 text-sm text-gray-600">
            Pick your home chamber to personalize your Civil experience. We\'ll use it to curate local news, MP updates,
            and marketplace offers from your riding.
          </p>
          {home ? (
            <div className="mt-4 rounded border bg-gray-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Home Chamber</div>
                  <div className="text-lg font-semibold">{home.name}</div>
                  <div className="text-sm text-gray-500">Province: {homeProvinceName}</div>
                </div>
                {homeFollow && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      href={`/${home.province.toLowerCase()}/${home.slug.toLowerCase()}`}
                    >
                      Visit
                    </Link>
                    <button
                      type="button"
                      className="rounded border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
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
            <div className="mt-4 rounded border border-dashed p-4 text-sm text-gray-500">
              You haven\'t set a home chamber yet. Choose your province and riding to get started.
            </div>
          ) : (
            <div className="mt-4 text-sm text-gray-500">Loading your chamber data…</div>
          )}
          <div className="mt-6">
            <div className="text-sm font-semibold uppercase tracking-wide text-gray-600">Chambers you follow</div>
            {loadingFollows ? (
              <div className="mt-3 text-sm text-gray-500">Loading your followed chambers…</div>
            ) : additionalFollows.length === 0 ? (
              <div className="mt-3 rounded border border-dashed p-4 text-sm text-gray-500">
                {home
                  ? 'You\'re currently following your home chamber. Explore other Chambers of Citizens below to keep an eye on more communities.'
                  : 'You haven\'t followed any chambers yet. Choose one below to get started.'}
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
                    <div key={key} className="flex flex-col gap-2 rounded border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-base font-semibold">{chamber.name || follow.chamberSlug.replace(/-/g, ' ')}</div>
                        <div className="text-sm text-gray-500">Province: {provinceName}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                          href={visitHref}
                        >
                          Visit
                        </Link>
                        <button
                          type="button"
                          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                          onClick={() => setHomeChamber(chamber.province, chamber.slug, 'list')}
                          disabled={isUpdating}
                        >
                          {isUpdating ? 'Setting…' : 'Set as home'}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
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

        <section className="rounded-lg border bg-white p-5">
          <h2 className="text-xl font-semibold">{home ? 'Explore other Chambers Of Citizens' : 'Find your chamber'}</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Province or territory</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2"
                value={selectedProvince}
                onChange={handleProvinceChange}
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
              <label className="text-sm font-medium text-gray-700">Chamber</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2"
                value={selectedChamber}
                onChange={handleChamberChange}
                disabled={!selectedProvince || loadingChambers}
              >
                <option value="">{loadingChambers ? 'Loading chambers…' : 'Select your chamber'}</option>
                {chambers.map((ch) => (
                  <option key={ch.slug} value={ch.slug}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded border border-dashed px-3 py-3 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-gray-700">Need a hand?</div>
                  <div className="text-xs text-gray-500">Let us detect your riding using your current location.</div>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleAutoDetect}
                  disabled={geoBusy}
                >
                  {geoBusy ? 'Detecting…' : 'Use my location'}
                </button>
              </div>
              {(geoStatus || geoError || geoPrimary) && (
                <div className="mt-3 space-y-2 text-xs">
                  {geoPrimary && (
                    <div className="rounded bg-green-50 px-3 py-2 text-green-700">
                      Matched <span className="font-semibold">{geoPrimary.chamberName}</span> ({geoPrimary.province.toUpperCase()})
                      {geoPrimary.method === 'geofenced' ? ' using Elections Canada boundaries.' : ' as the closest riding to you.'}
                    </div>
                  )}
                  {geoStatus && <div className="text-gray-600">{geoStatus}</div>}
                  {geoError && <div className="text-red-500">{geoError}</div>}
                </div>
              )}
              {geoAlternatives.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Other nearby ridings</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {geoAlternatives.map((match) => (
                      <button
                        key={`${match.province}:${match.chamberSlug}`}
                        type="button"
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        onClick={() => handleSuggestionSelect(match)}
                      >
                        {match.chamberName}
                        {typeof match.distanceKm === 'number' ? (
                          <span className="ml-1 text-[11px] text-gray-500">({match.distanceKm} km)</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleFollowSelected}
                disabled={!selectedProvince || !selectedChamber || followSaving || alreadyFollowingSelected}
              >
                {alreadyFollowingSelected ? 'Following' : followSaving ? 'Following…' : 'Follow this chamber'}
              </button>
              {!home && (
                <button
                  type="button"
                  className="rounded bg-black px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                  onClick={() => setHomeChamber(selectedProvince, selectedChamber, 'picker')}
                  disabled={!canSave || savingHome}
                >
                  {savingHome ? 'Saving…' : 'Set home chamber'}
                </button>
              )}
              {home && !canSave && (
                <span className="text-xs text-gray-500">This chamber is already set as your home.</span>
              )}
            </div>
          </div>
        </section>
    </main>
  )

  const geoOverlay = !showGeoOverlay
    ? null
    : (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="rounded-lg bg-white px-6 py-4 shadow-lg">
            <div className="text-sm font-semibold text-gray-900">Locating your riding…</div>
            <div className="mt-1 text-xs text-gray-500">
              {geoStatus || 'Hang tight for a moment while we match you to the right chamber.'}
            </div>
          </div>
        </div>
      )

  if (mode === 'welcome') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">Welcome to Civil</div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Set your home chamber to unlock your feed</h1>
          <p className="mt-3 text-sm text-gray-600">
            We personalize everything around your riding. Confirm your location below—once your home chamber is saved,
            we\'ll take you straight to your timeline.
          </p>
        </div>
        {mainContent}
        {geoOverlay}
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-12 gap-6 p-4">
      <Sidebar me={me ?? undefined} active="chambers" />
      {mainContent}
      <aside className="col-span-3 hidden lg:block">
        <div className="sticky top-4 space-y-4">
          <div className="rounded-lg border bg-white p-4">
            <div className="text-sm font-semibold">Need help choosing?</div>
            <p className="mt-2 text-sm text-gray-600">
              Your chamber matches your federal Electoral District Association (EDA). If you\'re not sure which one is yours,
              look at your voter card or search for your MP by postal code on Elections Canada.
            </p>
          </div>
          <div className="rounded-lg border bg-white p-4 text-sm text-gray-600">
            Tap “Use my location” to let Civil auto-detect your riding, or choose manually and we\'ll tailor your feed instantly.
          </div>
        </div>
      </aside>
      {geoOverlay}
    </div>
  )
}
