'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function getEventOrganizationHref(event: EventFeedItem): string | null {
  if (!event.organization.provinceCode || !event.organization.communitySlug) return null
  return `/com/${encodeURIComponent(event.organization.provinceCode.toLowerCase())}/${encodeURIComponent(event.organization.communitySlug)}/orgs/${encodeURIComponent(event.organization.slug)}/events`
}

function getEventDetailHref(event: EventFeedItem): string {
  if (event.organization.provinceCode && event.organization.communitySlug && event.organization.slug) {
    return `/com/${encodeURIComponent(event.organization.provinceCode.toLowerCase())}/${encodeURIComponent(event.organization.communitySlug)}/orgs/${encodeURIComponent(event.organization.slug)}/events/${encodeURIComponent(event.id)}`
  }
  return `/events/${encodeURIComponent(event.organization.id)}/${encodeURIComponent(event.id)}`
}

export default function EventsPageClient() {
  const router = useRouter()
  const [items, setItems] = useState<EventFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>([])
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryDraftSelection, setCategoryDraftSelection] = useState<EventCategory[]>([])
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => toLocalDayKey(new Date().toISOString()))
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null)
  const eventsListRef = useRef<HTMLElement | null>(null)

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

  const filteredItems = useMemo(() => {
    const now = new Date()

    return items.filter((event) => {
      const startsAt = new Date(event.startsAt)
      const category = event.category ?? DEFAULT_EVENT_CATEGORY

      if (selectedCategories.length > 0 && !selectedCategories.includes(category)) return false
      if (mineFilter !== 'going' && startsAt < now) return false
      return true
    })
  }, [items, mineFilter, selectedCategories])

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
  const activeDayEvents = useMemo(() => (activeDayKey ? eventsByDay.get(activeDayKey) ?? [] : []), [activeDayKey, eventsByDay])
  const displayItems = useMemo(() => (activeDayKey ? activeDayEvents : filteredItems), [activeDayEvents, activeDayKey, filteredItems])
  const monthLabel = useMemo(
    () => calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [calendarMonth],
  )
  const activeDayLabel = useMemo(() => {
    if (!activeDayKey) return null
    const [year, month, day] = activeDayKey.split('-').map((value) => Number(value))
    if (!year || !month || !day) return activeDayKey
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }, [activeDayKey])
  const categoryLabel = useMemo(() => {
    if (selectedCategories.length === 0) return 'All'
    if (selectedCategories.length === 1) return selectedCategories[0]
    return `${selectedCategories.length} selected`
  }, [selectedCategories])

  const handleDaySelect = useCallback((key: string) => {
    setSelectedDayKey(key)
    setActiveDayKey(key)
    requestAnimationFrame(() => {
      eventsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  return (
    <DashboardShell rightRail={<RightRail mode="events" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="surface-card space-y-3 p-4 shadow-subtle">
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
        </section>

        <section className="surface-card space-y-4 p-4 shadow-subtle">
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
                <div key={label} className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const today = new Date()
                const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
                const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                const isPastDay = startOfDay.getTime() < startOfToday.getTime()
                const isToday = startOfDay.getTime() === startOfToday.getTime()
                const isDimmedCell = !inMonth || isPastDay
                const startOfCurrentWeek = new Date(startOfToday)
                startOfCurrentWeek.setDate(startOfToday.getDate() - startOfToday.getDay())
                const endOfCurrentWeek = new Date(startOfCurrentWeek)
                endOfCurrentWeek.setDate(startOfCurrentWeek.getDate() + 6)
                endOfCurrentWeek.setHours(23, 59, 59, 999)
                const isCurrentWeek = startOfDay.getTime() >= startOfCurrentWeek.getTime() && startOfDay.getTime() <= endOfCurrentWeek.getTime()

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDaySelect(key)}
                    className={
                      'min-h-24 border-b border-r border-slate-100 px-2 py-2 text-center transition-colors hover:bg-slate-50' +
                      (isDimmedCell ? ' bg-slate-50' : isWeekend ? ' bg-sky-50/70' : ' bg-white') +
                      (isCurrentWeek && !isToday ? ' shadow-[inset_0_0_0_9999px_rgba(34,197,94,0.1)]' : '') +
                      (isToday ? ' !bg-red-600 !text-white hover:!bg-red-600' : '') +
                      (isSelected ? (isToday ? ' shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]' : ' bg-rose-100 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.35)]') : '')
                    }
                  >
                    <div className="flex min-h-20 flex-col items-center justify-center gap-1">
                      <span
                        className={
                          'relative inline-flex h-11 w-11 items-center justify-center rounded-full border text-xl font-semibold leading-none ' +
                          (inMonth
                            ? ' text-slate-900'
                            : ' text-slate-400') +
                          (isDimmedCell && !isToday ? ' border-slate-300' : ' border-black') +
                          (isToday ? ' bg-white text-slate-900' : '') +
                          (isSelected ? ' border-[var(--cc-primary)] bg-[var(--cc-primary)]/8' : ' bg-white') +
                          (isPastDay && !isToday ? ' opacity-70' : '')
                        }
                      >
                        <span>{day.getDate()}</span>
                        {isPastDay ? <span aria-hidden="true" className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 rotate-[-18deg] bg-slate-500" /> : null}
                      </span>
                      <span
                        className={
                          'inline-flex min-w-16 items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ' +
                          (dayEvents.length > 0
                            ? 'border-rose-300 bg-white text-rose-600 shadow-sm'
                            : 'border-slate-200 bg-white/80 text-slate-400')
                        }
                      >
                        {dayEvents.length} {dayEvents.length === 1 ? 'Event' : 'Events'}
                      </span>
                    </div>

                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {loading ? <p className="text-sm text-slate-500">Loading events…</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <section ref={eventsListRef} className="space-y-3">
          {activeDayKey ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-subtle">
              <div>
                <p className="text-sm font-semibold text-slate-900">{activeDayLabel ?? 'Selected day'}</p>
                <p className="text-sm text-slate-600">
                  {displayItems.length === 1 ? '1 event on this day' : `${displayItems.length} events on this day`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveDayKey(null)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear day filter
              </button>
            </div>
          ) : null}

        {!loading && !error && displayItems.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle">
            <p className="text-sm text-slate-600">
              {activeDayKey
                ? 'No events found for the selected day with these filters.'
                : mineFilter === 'going'
                  ? 'No upcoming RSVP events found for these filters.'
                  : 'No events found for these filters.'}
            </p>
          </section>
        ) : null}

        {!loading && !error && displayItems.length > 0 ? (
          <ul className="space-y-6">
            {displayItems.map((event) => {
              const detailHref = getEventDetailHref(event)
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
        </section>

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
