'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import VerifiedAvatar from '../_components/VerifiedAvatar'
import { buildApiUrl } from '../_lib/api'
import { DEFAULT_EVENT_CATEGORY, EVENT_CATEGORIES, type EventCategory } from '../com/_lib/eventCategories'

type EventFeedItem = {
  id: string
  title: string
  description: string | null
  category?: EventCategory
  access: 'PUBLIC' | 'RESTRICTED'
  startsAt: string
  endsAt: string | null
  capacity: number | null
  paid: boolean
  priceCents: number | null
  currency: string
  guestSpeakers: string[]
  primaryPhotoUrl: string | null
  galleryPhotoUrls: string[]
  status: 'DRAFT' | 'PUBLISHED'
  createdAt: string
  updatedAt: string
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    isVerified: boolean
  }
  matchedBy: {
    organization: boolean
    community: boolean
  }
}

type EventFeedResponse = {
  items?: EventFeedItem[]
}

function formatEventDateBadge(isoString: string) {
  const value = new Date(isoString)
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const startOfDate = new Date(value)
  startOfDate.setHours(0, 0, 0, 0)

  if (startOfDate.getTime() === startOfToday.getTime()) return 'Today'
  if (startOfDate.getTime() === startOfTomorrow.getTime()) return 'Tomorrow'

  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatEventTimeBadge(isoString: string) {
  const value = new Date(isoString)
  return value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function truncateDescription(value: string | null | undefined, maxChars = 140) {
  const text = (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
    .replace(/\s+/g, ' ')
  if (!text) return null
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}…`
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function toLocalDayKey(isoString: string) {
  const date = new Date(isoString)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, deltaMonths: number) {
  return new Date(date.getFullYear(), date.getMonth() + deltaMonths, 1)
}

function buildCalendarGrid(month: Date) {
  const first = startOfMonth(month)
  const startDow = first.getDay()
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - startDow)

  const weeks: Date[][] = []
  for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
    const week: Date[] = []
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const day = new Date(gridStart)
      day.setDate(gridStart.getDate() + weekIndex * 7 + dayIndex)
      week.push(day)
    }
    weeks.push(week)
  }
  return weeks
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfWeek(date: Date) {
  const result = new Date(date)
  const day = result.getDay()
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() - day)
  return result
}

function endOfWeek(date: Date) {
  const result = startOfWeek(date)
  result.setDate(result.getDate() + 6)
  result.setHours(23, 59, 59, 999)
  return result
}

function endOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

function buildPresetRange(preset: 'today' | 'this_week' | 'this_month' | 'next_30_days') {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  if (preset === 'today') {
    return { start: toDateInputValue(start), end: toDateInputValue(endOfDay(start)) }
  }
  if (preset === 'this_week') {
    const weekStart = startOfWeek(now)
    const weekEnd = endOfWeek(now)
    return { start: toDateInputValue(weekStart), end: toDateInputValue(weekEnd) }
  }
  if (preset === 'this_month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start: toDateInputValue(monthStart), end: toDateInputValue(endOfDay(monthEnd)) }
  }

  const end = new Date(start)
  end.setDate(end.getDate() + 30)
  return { start: toDateInputValue(start), end: toDateInputValue(endOfDay(end)) }
}

function getEventOrganizationHref(event: EventFeedItem): string | null {
  if (!event.organization.provinceCode || !event.organization.communitySlug) return null
  return `/com/${encodeURIComponent(event.organization.provinceCode.toLowerCase())}/${encodeURIComponent(event.organization.communitySlug)}/orgs/${encodeURIComponent(event.organization.slug)}/events`
}

export default function EventsPageClient() {
  const router = useRouter()
  const [items, setItems] = useState<EventFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<'calendar' | 'list'>('list')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>([])
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryDraftSelection, setCategoryDraftSelection] = useState<EventCategory[]>([])
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => toLocalDayKey(new Date().toISOString()))

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])
  const searchParams = useSearchParams()
  const mineFilter = searchParams.get('mine') === 'going' ? 'going' : null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ limit: '200' })
      if (mineFilter === 'going') params.set('mine', 'going')

      const res = await fetch(buildApiUrl(`/events?${params.toString()}`), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })

      if (!res.ok) {
        setError('Unable to load events right now.')
        setItems([])
        return
      }

      const payload = (await res.json().catch(() => null)) as EventFeedResponse | null
      setItems(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setError('Unable to load events right now.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [mineFilter, token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setStartDate('')
    setEndDate('')
  }, [])

  const filteredItems = useMemo(() => {
    const startBoundary = startDate ? new Date(`${startDate}T00:00:00`) : null
    const endBoundary = endDate ? new Date(`${endDate}T23:59:59.999`) : null
    const now = new Date()

    return items.filter((event) => {
      const startsAt = new Date(event.startsAt)
      const category = event.category ?? DEFAULT_EVENT_CATEGORY

      if (selectedCategories.length > 0 && !selectedCategories.includes(category)) return false
      if (!startBoundary && !endBoundary && mineFilter !== 'going' && startsAt < now) return false
      if (startBoundary && startsAt < startBoundary) return false
      if (endBoundary && startsAt > endBoundary) return false
      return true
    })
  }, [endDate, items, mineFilter, selectedCategories, startDate])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventFeedItem[]>()
    for (const event of filteredItems) {
      const key = toLocalDayKey(event.startsAt)
      const existing = map.get(key)
      if (existing) existing.push(event)
      else map.set(key, [event])
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => (a.startsAt === b.startsAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.startsAt < b.startsAt ? -1 : 1))
      map.set(key, list)
    }
    return map
  }, [filteredItems])

  const calendarWeeks = useMemo(() => buildCalendarGrid(calendarMonth), [calendarMonth])
  const selectedDayEvents = useMemo(() => eventsByDay.get(selectedDayKey) ?? [], [eventsByDay, selectedDayKey])
  const monthLabel = useMemo(
    () => calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [calendarMonth],
  )
  const categoryLabel = useMemo(() => {
    if (selectedCategories.length === 0) return 'All'
    if (selectedCategories.length === 1) return selectedCategories[0]
    return `${selectedCategories.length} selected`
  }, [selectedCategories])

  return (
    <DashboardShell rightRail={<RightRail mode="events" showOrganizations />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{mineFilter === 'going' ? 'Your RSVPs' : 'Events'}</h1>

        <section className="surface-card space-y-3 p-4 shadow-subtle">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(displayMode === 'list'
                ? [
                    { key: 'today', label: 'Today' },
                    { key: 'this_week', label: 'This week' },
                    { key: 'this_month', label: 'This month' },
                    { key: 'next_30_days', label: 'Next 30 days' },
                  ]
                : [
                    { key: 'today', label: 'Today' },
                    { key: 'this_week', label: 'This week' },
                    { key: 'this_month', label: 'This month' },
                  ]
              ).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    const { start, end } = buildPresetRange(preset.key as 'today' | 'this_week' | 'this_month' | 'next_30_days')
                    setStartDate(start)
                    setEndDate(end)
                  }}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setDisplayMode('calendar')}
                className={
                  displayMode === 'calendar'
                    ? 'px-4 py-2 text-xs font-semibold text-[var(--cc-primary)]'
                    : 'px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                }
              >
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('list')}
                className={
                  displayMode === 'list'
                    ? 'px-4 py-2 text-xs font-semibold text-[var(--cc-primary)]'
                    : 'px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                }
              >
                List
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2fr]">
            <label className="grid gap-1 text-xs text-slate-600">
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-600">
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
              />
            </label>
            <div className="grid gap-1 text-xs text-slate-600">
              Categories
              <button
                type="button"
                onClick={() => {
                  setCategoryDraftSelection(selectedCategories)
                  setCategoryModalOpen(true)
                }}
                className="inline-flex h-10 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span>{categoryLabel}</span>
                <span className="text-slate-400">▾</span>
              </button>
            </div>
          </div>
        </section>

        {loading ? <p className="text-sm text-slate-500">Loading events…</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {!loading && !error && filteredItems.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
            <p className="text-sm text-slate-600">
              {mineFilter === 'going' ? 'No upcoming RSVP events found for these filters.' : 'No events found for these filters.'}
            </p>
          </section>
        ) : null}

        {!loading && !error && filteredItems.length > 0 && displayMode === 'list' ? (
          <ul className="space-y-6">
            {filteredItems.map((event) => {
              const detailHref = `/events/${encodeURIComponent(event.organization.id)}/${encodeURIComponent(event.id)}`
              const organizationHref = getEventOrganizationHref(event)

              const startsDateBadge = formatEventDateBadge(event.startsAt)
              const startsTimeBadge = formatEventTimeBadge(event.startsAt)
              const descriptionPreview = truncateDescription(event.description)
              const isEnded = new Date(event.startsAt).getTime() < Date.now()

              return (
                <li key={`${event.organization.id}:${event.id}`}>
                  <article
                    className="group cursor-pointer rounded-2xl bg-white p-3 transition hover:bg-slate-50/70"
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(detailHref)}
                    onKeyDown={(eventKey) => {
                      if (eventKey.key === 'Enter' || eventKey.key === ' ') {
                        eventKey.preventDefault()
                        router.push(detailHref)
                      }
                    }}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <div className="w-full sm:w-60 sm:flex-none">
                        <Link href={detailHref} className="block" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                          <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32">
                            {event.primaryPhotoUrl ? <img src={event.primaryPhotoUrl} alt={event.title} className="h-full w-full object-cover" /> : null}
                            {isEnded ? (
                              <span className="absolute left-2 top-2 rounded-full bg-slate-700/90 px-2 py-1 text-xs font-semibold text-white">Sales Ended</span>
                            ) : null}
                          </div>
                        </Link>

                        {organizationHref ? (
                          <Link href={organizationHref} className="mt-3 block" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                            <div className="relative overflow-hidden rounded-xl border border-slate-200 px-3 py-2">
                              <div className="absolute inset-0 bg-slate-50" />
                              <div className="relative z-[1] flex items-center gap-2">
                                <VerifiedAvatar src={event.organization.logoUrl} alt={event.organization.name} initials={event.organization.name} size={24} />
                                <p className="truncate text-sm font-semibold text-slate-700">{event.organization.name}</p>
                              </div>
                            </div>
                          </Link>
                        ) : null}
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <Link href={detailHref} className="text-3xl/none text-xl font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)] hover:underline">
                          {event.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{startsDateBadge}</span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{startsTimeBadge}</span>
                        </div>
                        {descriptionPreview ? <p className="text-sm text-slate-600">{descriptionPreview}</p> : null}
                      </div>
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        ) : null}

        {!loading && !error && filteredItems.length > 0 && displayMode === 'calendar' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((prev) => addMonths(prev, -1))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarMonth((prev) => addMonths(prev, 1))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
              <p className="text-sm font-semibold text-slate-900">{monthLabel}</p>
              <button
                type="button"
                onClick={() => setCalendarMonth(startOfMonth(new Date()))}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                This month
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                  <div key={label} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarWeeks.flat().map((day) => {
                  const inMonth = day.getMonth() === calendarMonth.getMonth()
                  const key = `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
                  const dayEvents = eventsByDay.get(key) ?? []
                  const isSelected = key === selectedDayKey

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDayKey(key)}
                      className={
                        'min-h-24 border-b border-r border-slate-100 px-3 py-2 text-left transition-colors hover:bg-slate-50' +
                        (isSelected ? ' bg-slate-50' : '')
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={inMonth ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-400'}>{day.getDate()}</p>
                        {dayEvents.length ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{dayEvents.length}</span>
                        ) : null}
                      </div>

                      {dayEvents.length ? (
                        <div className="mt-2 space-y-1">
                          {dayEvents.slice(0, 2).map((event) => (
                            <p key={event.id} className="truncate text-[11px] font-semibold text-slate-700">
                              {new Date(event.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {event.title}
                            </p>
                          ))}
                          {dayEvents.length > 2 ? <p className="text-[11px] text-slate-500">+{dayEvents.length - 2} more</p> : null}
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              {!selectedDayEvents.length ? <p className="text-sm text-slate-500">No events on this day.</p> : null}
              {selectedDayEvents.length ? (
                <ul className="space-y-3">
                  {selectedDayEvents.map((event) => {
                    const detailHref = `/events/${encodeURIComponent(event.organization.id)}/${encodeURIComponent(event.id)}`
                    const organizationHref = getEventOrganizationHref(event)
                    const startsDateBadge = formatEventDateBadge(event.startsAt)
                    const startsTimeBadge = formatEventTimeBadge(event.startsAt)
                    const descriptionPreview = truncateDescription(event.description)
                    return (
                      <li key={`${event.organization.id}:${event.id}`}>
                        <article
                          className="group cursor-pointer rounded-2xl bg-white p-3 transition hover:bg-slate-50/70"
                          role="link"
                          tabIndex={0}
                          onClick={() => router.push(detailHref)}
                          onKeyDown={(eventKey) => {
                            if (eventKey.key === 'Enter' || eventKey.key === ' ') {
                              eventKey.preventDefault()
                              router.push(detailHref)
                            }
                          }}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <div className="w-full sm:w-60 sm:flex-none">
                              <Link href={detailHref} className="block" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                                <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32">
                                  {event.primaryPhotoUrl ? <img src={event.primaryPhotoUrl} alt={event.title} className="h-full w-full object-cover" /> : null}
                                </div>
                              </Link>

                              {organizationHref ? (
                                <Link href={organizationHref} className="mt-3 block" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                                  <div className="relative overflow-hidden rounded-xl border border-slate-200 px-3 py-2">
                                    <div className="absolute inset-0 bg-slate-50" />
                                    <div className="relative z-[1] flex items-center gap-2">
                                      <VerifiedAvatar src={event.organization.logoUrl} alt={event.organization.name} initials={event.organization.name} size={24} />
                                      <p className="truncate text-sm font-semibold text-slate-700">{event.organization.name}</p>
                                    </div>
                                  </div>
                                </Link>
                              ) : null}
                            </div>
                            <div className="min-w-0 space-y-1.5">
                              <Link href={detailHref} className="text-xl font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)] hover:underline">
                                {event.title}
                              </Link>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{startsDateBadge}</span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{startsTimeBadge}</span>
                              </div>
                              {descriptionPreview ? <p className="text-sm text-slate-600">{descriptionPreview}</p> : null}
                            </div>
                          </div>
                        </article>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {categoryModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-subtle">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-base font-semibold text-slate-900">Select categories</h4>
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(false)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <div className="max-h-80 space-y-2 overflow-auto pr-1">
                <button
                  type="button"
                  onClick={() => setCategoryDraftSelection([])}
                  className={
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold ' +
                    (categoryDraftSelection.length === 0
                      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                  }
                >
                  <span>All</span>
                  {categoryDraftSelection.length === 0 ? <span>✓</span> : null}
                </button>

                {EVENT_CATEGORIES.map((category) => {
                  const active = categoryDraftSelection.includes(category)
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => {
                        setCategoryDraftSelection((prev) => {
                          if (prev.includes(category)) return prev.filter((item) => item !== category)
                          if (prev.length === 0) return [category]
                          return [...prev, category]
                        })
                      }}
                      className={
                        'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold ' +
                        (active
                          ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                      }
                    >
                      <span>{category}</span>
                      {active ? <span>✓</span> : null}
                    </button>
                  )
                })}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategories(categoryDraftSelection)
                    setCategoryModalOpen(false)
                  }}
                  className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
