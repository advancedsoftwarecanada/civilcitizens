"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { buildHandleBase } from '@civil/shared'
import Sidebar from '../_components/Sidebar'
import RichTextEditor from '../_components/RichTextEditor'
import { pushToast } from '../_components/useToasts'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { hasHomeChamber, type MeResponse } from '../_lib/me'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
}

type ExperienceResponse = {
  id: string
  title: string
  organization: string
  location: string | null
  startDate: string
  endDate: string | null
  current: boolean
  description: string | null
}

type ProfileResponse = {
  user: {
    id: string
    email: string
    handle: string
    firstName: string
    lastName: string
    name?: string | null
    bio: string
    createdAt?: string | null
    experiences?: ExperienceResponse[]
  }
  stats: {
    followers: number
    following: number
    chambersFollowing: number
  }
  homeChamber?: {
    provinceCode: string
    provinceName?: string | null
    chamberSlug: string
    chamberName?: string | null
  } | null
}

type ExperienceFormState = {
  key: string
  title: string
  organization: string
  location: string
  startDate: string
  endDate: string
  current: boolean
  description: string
}

const MAX_EXPERIENCES = 50

function initialsFromUser(user: { name?: string | null; handle?: string | null }) {
  const source = user.name || user.handle || ''
  return source
    .split(' ')
    .map((part) => part?.[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
}

function monthInputFromIso(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

function monthInputToIso(value: string) {
  if (!value) return null
  const [yearStr, monthStr] = value.split('-')
  if (!yearStr || !monthStr) return null
  const year = Number.parseInt(yearStr, 10)
  const month = Number.parseInt(monthStr, 10)
  if (!year || !month || month < 1 || month > 12) return null
  const date = new Date(Date.UTC(year, month - 1, 1))
  return date.toISOString()
}

function formatMonthYear(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function generateKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function emptyExperience(): ExperienceFormState {
  return {
    key: generateKey(),
    title: '',
    organization: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
  }
}

export default function ProfileEditPage() {
  const [token, setToken] = useState<string | null>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [bio, setBio] = useState('')
  const [experiences, setExperiences] = useState<ExperienceFormState[]>([emptyExperience()])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewHandle = useMemo(() => buildHandleBase(firstName, lastName), [firstName, lastName])

  const loadViewer = useCallback(async () => {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!storedToken) {
      if (typeof window !== 'undefined') {
        redirectToAuthModal('login')
      }
      return null
    }
    try {
  const res = await fetch(buildApiUrl('/auth/me'), {
        headers: {
          authorization: `Bearer ${storedToken}`,
        },
      })
      if (!res.ok) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
        }
        return null
      }
      const data: MeResponse = await res.json()
      if (!hasHomeChamber(data)) {
        window.location.replace('/welcome')
        return null
      }
      setViewer({
        id: data.id,
        handle: data.handle,
        name: data.name,
        avatarUrl: data.avatarUrl,
      })
      setToken(storedToken)
      return storedToken
    } catch (err) {
      console.error('Failed fetching viewer', err)
      pushToast('Unable to verify your session. Please sign in again.', 'error', 6000)
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('token')
        redirectToAuthModal('login')
      }
      return null
    }
  }, [])

  const mapExperiencesFromResponse = useCallback((items?: ExperienceResponse[] | null) => {
    if (!items || items.length === 0) {
      return [emptyExperience()]
    }
    return items.map((exp) => ({
      key: exp.id || generateKey(),
      title: exp.title ?? '',
      organization: exp.organization ?? '',
      location: exp.location ?? '',
      startDate: monthInputFromIso(exp.startDate),
      endDate: exp.current ? '' : monthInputFromIso(exp.endDate ?? undefined),
      current: Boolean(exp.current),
      description: exp.description ?? '',
    }))
  }, [])

  const loadProfile = useCallback(
    async (authToken: string) => {
      setLoading(true)
      setError(null)
      try {
  const res = await fetch(buildApiUrl('/profile'), {
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        })
        if (!res.ok) {
          if (res.status === 401) {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem('token')
              redirectToAuthModal('login')
            }
            return
          }
          const payload = await res.json().catch(() => ({}))
          const message = typeof payload?.error === 'string' ? payload.error : 'Unable to load your profile.'
          setError(message)
          return
        }
        const data: ProfileResponse = await res.json()
        setProfile(data)
        setFirstName(data.user.firstName ?? '')
        setLastName(data.user.lastName ?? '')
        setBio(data.user.bio ?? '')
        setExperiences(mapExperiencesFromResponse(data.user.experiences))
        const derivedName = `${data.user.firstName ?? ''} ${data.user.lastName ?? ''}`.trim()
        setViewer((prev) =>
          prev
            ? {
                ...prev,
                handle: data.user.handle,
                name: data.user.name ?? (derivedName.length > 0 ? derivedName : prev.name),
              }
            : prev,
        )
      } catch (err) {
        console.error('Failed loading profile', err)
        setError('Unable to load your profile right now.')
      } finally {
        setLoading(false)
      }
    },
    [mapExperiencesFromResponse],
  )

  useEffect(() => {
    const promise = loadViewer()
    promise
      ?.then((authToken) => {
        if (authToken) {
          loadProfile(authToken).catch(() => {
            /* noop */
          })
        }
      })
      .catch(() => {
        /* noop */
      })
  }, [loadProfile, loadViewer])

  const handleExperienceChange = useCallback((key: string, patch: Partial<ExperienceFormState>) => {
    setExperiences((prev) => prev.map((exp) => (exp.key === key ? { ...exp, ...patch } : exp)))
  }, [])

  const handleExperienceToggleCurrent = useCallback((key: string, value: boolean) => {
    setExperiences((prev) =>
      prev.map((exp) =>
        exp.key === key
          ? {
              ...exp,
              current: value,
              endDate: value ? '' : exp.endDate,
            }
          : exp,
      ),
    )
  }, [])

  const removeExperience = useCallback((key: string) => {
    setExperiences((prev) => {
      const next = prev.filter((exp) => exp.key !== key)
      return next.length > 0 ? next : [emptyExperience()]
    })
  }, [])

  const addExperience = useCallback(() => {
    setExperiences((prev) => {
      if (prev.length >= MAX_EXPERIENCES) {
        pushToast(`You can list up to ${MAX_EXPERIENCES} experiences.`, 'warning')
        return prev
      }
      return [...prev, emptyExperience()]
    })
  }, [])

  const saveProfile = useCallback(async () => {
    if (!token) {
      pushToast('You must be signed in to update your profile.', 'error')
      return
    }

    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    if (!trimmedFirst || !trimmedLast) {
      pushToast('Please provide both your first and last name.', 'error')
      return
    }

    const normalizedExperiences: Array<{
      title: string
      organization: string
      location?: string
      startDate: string
      endDate?: string | null
      current: boolean
      description?: string
    }> = []

    for (let index = 0; index < experiences.length; index += 1) {
      const exp = experiences[index]
      if (!exp) {
        continue
      }

      const title = exp.title.trim()
      const organization = exp.organization.trim()
      const location = exp.location.trim()
      const description = exp.description.trim()
      const hasAnyValue = Boolean(
        title ||
          organization ||
          location ||
          exp.startDate ||
          exp.endDate ||
          description ||
          exp.current,
      )

      if (!hasAnyValue) {
        continue
      }

      const startIso = monthInputToIso(exp.startDate)
      const endIso = exp.current ? null : monthInputToIso(exp.endDate)

      if (!title || !organization || !startIso) {
        pushToast(`Experience ${index + 1} is missing required fields.`, 'error')
        return
      }

      if (endIso && new Date(endIso).getTime() < new Date(startIso).getTime()) {
        pushToast(`Experience ${index + 1} has an end date before the start date.`, 'error')
        return
      }

      normalizedExperiences.push({
        title,
        organization,
        location: location ? location : undefined,
        startDate: startIso,
        endDate: exp.current ? null : endIso ?? undefined,
        current: exp.current,
        description: description ? description : undefined,
      })
    }

    setSaving(true)
    try {
  const res = await fetch(buildApiUrl('/profile'), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: trimmedFirst,
          lastName: trimmedLast,
          bio,
          experiences: normalizedExperiences,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const rawError =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.error?.message === 'string'
            ? payload.error.message
            : null

        const friendlyErrorMap: Record<string, string> = {
          experiences_not_available:
            'Your experiences were not saved because the update is still deploying. Please try again in a moment.',
        }

        const message = rawError ? friendlyErrorMap[rawError] ?? rawError : 'We could not save your profile. Please try again.'
        pushToast(message, 'error', 6000)
        return
      }

      pushToast('Your profile was updated.', 'success')
      await loadProfile(token)
    } catch (err) {
      console.error('Failed updating profile', err)
      pushToast('We ran into a problem saving your profile. Please try again shortly.', 'error', 6000)
    } finally {
      setSaving(false)
    }
  }, [bio, experiences, firstName, lastName, loadProfile, token])

  const handleLogout = useCallback(async () => {
    try {
      if (token) {
        await fetch(buildApiUrl('/auth/logout'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })
      }
    } catch (err) {
      console.error('Failed logging out', err)
    } finally {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('token')
        window.location.replace('/')
      }
    }
  }, [token])

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await saveProfile()
    },
    [saveProfile],
  )

  const formDisabled = saving || loading
  const joinDate = profile?.user?.createdAt ? formatMonthYear(profile.user.createdAt) : ''

  const displayInitials = useMemo(() => {
    return (
      initialsFromUser({
        name: profile?.user?.name,
        handle: profile?.user?.handle,
      }) || 'C'
    )
  }, [profile])

  return (
    <div className="w-full">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <Sidebar me={viewer ?? undefined} active="profile" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:gap-0 xl:max-w-6xl xl:grid-cols-[240px_minmax(0,1fr)_260px] xl:gap-0">
        <Sidebar me={viewer ?? undefined} active="profile" />

        <main className="space-y-4 lg:min-h-[calc(100vh-48px)] lg:px-0">
            {error ? (
              <div className="border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <section className="border border-gray-200 bg-white p-6">
                  <header className="mb-4">
                    <h1 className="text-lg font-semibold text-gray-900">Profile details</h1>
                    <p className="text-sm text-gray-500">Update the basics that other members see.</p>
                  </header>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="h-14 w-14 overflow-hidden rounded-full bg-gray-200">
                      <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-gray-500">
                        {displayInitials}
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="text-sm font-medium text-gray-700">
                          First name
                          <input
                            type="text"
                            value={firstName}
                            onChange={(event) => setFirstName(event.target.value)}
                            disabled={formDisabled}
                            className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                            placeholder="Jane"
                          />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                          Last name
                          <input
                            type="text"
                            value={lastName}
                            onChange={(event) => setLastName(event.target.value)}
                            disabled={formDisabled}
                            className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                            placeholder="Citizen"
                          />
                        </label>
                      </div>
                      <p className="text-xs leading-snug text-gray-500">
                        Your public handle updates automatically from your name. Next handle in line will start with{' '}
                        <span className="font-medium text-gray-900">@{previewHandle}</span>. If it's already taken, we'll add a few digits to keep it unique.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="border border-gray-200 bg-white p-6">
                  <header className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Bio</h2>
                    <p className="text-sm text-gray-500">Share your story, work, and what you're focused on today.</p>
                  </header>
                  <RichTextEditor
                    value={bio}
                    onChange={setBio}
                    placeholder="Tell other citizens about yourself"
                    minHeight={200}
                    disabled={formDisabled}
                  />
                </section>

                <section className="border border-gray-200 bg-white p-6">
                  <header className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Experience</h2>
                      <p className="text-sm text-gray-500">Add roles that highlight your public service, community work, or career.</p>
                    </div>
                    <button
                      type="button"
                      onClick={addExperience}
                      className="border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                      disabled={saving}
                    >
                      Add experience
                    </button>
                  </header>
                  <div className="space-y-6">
                    {experiences.map((exp, index) => (
                      <div key={exp.key} className="border border-gray-200 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-gray-800">Position {index + 1}</h3>
                          <button
                            type="button"
                            onClick={() => removeExperience(exp.key)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                            disabled={experiences.length === 1 || saving}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <label className="text-sm font-medium text-gray-700">
                            Title
                            <input
                              type="text"
                              value={exp.title}
                              onChange={(event) => handleExperienceChange(exp.key, { title: event.target.value })}
                              disabled={formDisabled}
                              className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              placeholder="Community Organizer"
                            />
                          </label>
                          <label className="text-sm font-medium text-gray-700">
                            Organization
                            <input
                              type="text"
                              value={exp.organization}
                              onChange={(event) => handleExperienceChange(exp.key, { organization: event.target.value })}
                              disabled={formDisabled}
                              className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              placeholder="Civic Association"
                            />
                          </label>
                          <label className="text-sm font-medium text-gray-700">
                            Location (optional)
                            <input
                              type="text"
                              value={exp.location}
                              onChange={(event) => handleExperienceChange(exp.key, { location: event.target.value })}
                              disabled={formDisabled}
                              className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              placeholder="Ottawa, ON"
                            />
                          </label>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <label className="text-sm font-medium text-gray-700">
                              Start month
                              <input
                                type="month"
                                value={exp.startDate}
                                onChange={(event) => handleExperienceChange(exp.key, { startDate: event.target.value })}
                                disabled={formDisabled}
                                className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              />
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              End month
                              <input
                                type="month"
                                value={exp.endDate}
                                onChange={(event) => handleExperienceChange(exp.key, { endDate: event.target.value })}
                                disabled={formDisabled || exp.current}
                                className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              />
                            </label>
                          </div>
                        </div>
                        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={exp.current}
                            onChange={(event) => handleExperienceToggleCurrent(exp.key, event.target.checked)}
                            disabled={formDisabled}
                          />
                          I currently hold this role
                        </label>
                        <label className="mt-4 block text-sm font-medium text-gray-700">
                          Description (optional)
                          <textarea
                            value={exp.description}
                            onChange={(event) => handleExperienceChange(exp.key, { description: event.target.value })}
                            disabled={formDisabled}
                            rows={3}
                            className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                            placeholder="Highlight achievements, initiatives, and impact."
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-[var(--cc-primary)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}
          </main>

        <aside className="hidden lg:flex lg:min-h-[calc(100vh-48px)] lg:w-[220px] lg:flex-col lg:border-l lg:border-gray-200 lg:bg-white xl:w-[260px]">
          <div className="sticky top-0 space-y-4">
            <section className="border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Account</h2>
              <ul className="mt-4 space-y-3 text-sm text-gray-700">
                <li>
                  <span className="font-medium text-gray-900">Handle:</span> @{profile?.user?.handle ?? ''}
                </li>
                <li>
                  <span className="font-medium text-gray-900">Member since:</span> {joinDate || '—'}
                </li>
                <li>
                  <span className="font-medium text-gray-900">Email:</span> {profile?.user?.email ?? ''}
                </li>
              </ul>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 w-full border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white"
              >
                Log out
              </button>
            </section>

            <section className="border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Connections</h2>
              <ul className="mt-4 space-y-3 text-sm text-gray-700">
                <li>
                  Followers
                  <span className="float-right font-semibold text-gray-900">{profile?.stats?.followers ?? 0}</span>
                </li>
                <li>
                  Following
                  <span className="float-right font-semibold text-gray-900">{profile?.stats?.following ?? 0}</span>
                </li>
                <li>
                  Chambers
                  <span className="float-right font-semibold text-gray-900">{profile?.stats?.chambersFollowing ?? 0}</span>
                </li>
              </ul>
            </section>

            {profile?.homeChamber ? (
              <section className="border border-gray-200 bg-white p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Home chamber</h2>
                <div className="mt-3 text-sm text-gray-700">
                  <div className="font-semibold text-gray-900">
                    {profile.homeChamber.chamberName ?? profile.homeChamber.chamberSlug}
                  </div>
                  <div className="text-gray-500">
                    {profile.homeChamber.provinceName ?? profile.homeChamber.provinceCode}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Experience preview</h2>
              <div className="mt-4 space-y-4">
                {experiences.length === 0 ? (
                  <p className="text-sm text-gray-500">Add at least one experience to highlight your work.</p>
                ) : (
                  experiences.map((exp) => (
                    <div key={exp.key} className="border-l-2 border-gray-200 pl-3">
                      <div className="text-sm font-semibold text-gray-900">{exp.title || 'Role title'}</div>
                      <div className="text-xs uppercase tracking-wide text-gray-500">{exp.organization || 'Organization'}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatMonthYear(monthInputToIso(exp.startDate) ?? undefined)}
                        {exp.current
                          ? ' – Present'
                          : exp.endDate
                          ? ` – ${formatMonthYear(monthInputToIso(exp.endDate) ?? undefined)}`
                          : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}
