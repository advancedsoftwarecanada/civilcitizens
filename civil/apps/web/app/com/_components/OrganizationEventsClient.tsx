'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import { DEFAULT_EVENT_CATEGORY, EVENT_CATEGORIES, type EventCategory } from '../_lib/eventCategories'

type GovernanceEvent = {
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
  sponsors?: EventSponsorTag[]
  primaryPhotoUrl?: string | null
  galleryPhotoUrls?: string[]
  status?: 'DRAFT' | 'PUBLISHED'
  createdAt: string
  updatedAt?: string
}

type EventSponsorTag = {
  organizationId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
}

type GovernanceViewer = {
  userId: string | null
  permissions: string[]
}

type GovernanceStateResponse = {
  state?: {
    events?: GovernanceEvent[]
  }
  viewer?: GovernanceViewer
}

function formatMoney(cents: number) {
  return `${(cents / 100).toFixed(2)} CAD`
}

function formatStartsLabel(isoString: string) {
  const value = new Date(isoString)
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  const startOfDate = new Date(value)
  startOfDate.setHours(0, 0, 0, 0)

  const time = value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (startOfDate.getTime() === startOfToday.getTime()) return `Today at ${time}`
  if (startOfDate.getTime() === startOfTomorrow.getTime()) return `Tomorrow at ${time}`
  return value.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toTitleCase(value: string | null | undefined) {
  if (!value) return ''
  return value
    .split('-')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(' ')
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
  const startDow = first.getDay() // 0=Sun
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

export default function OrganizationEventsClient({
  mode = 'view',
  province,
  municipality,
  slug,
}: {
  mode?: 'view' | 'manage'
  province: string
  municipality: string
  slug: string
}) {
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const [loading, setLoading] = useState(true)
  const [rsvpBusyId, setRsvpBusyId] = useState<string | null>(null)
  const [events, setEvents] = useState<GovernanceEvent[]>([])
  const [displayMode, setDisplayMode] = useState<'calendar' | 'list'>('list')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>([])
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryDraftSelection, setCategoryDraftSelection] = useState<EventCategory[]>([])
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => toLocalDayKey(new Date().toISOString()))

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

  const manageCreateHref = useMemo(() => {
    return `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/events/manage/create`
  }, [municipality, province, slug])

  const manageEditHref = useCallback(
    (eventId: string) => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/events/manage/${encodeURIComponent(eventId)}`,
    [municipality, province, slug],
  )

  const eventDetailHref = useCallback(
    (eventId: string) => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}`,
    [municipality, province, slug],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const statePath = `${orgApiPath}/governance/state${mode === 'manage' ? '?includeDrafts=1' : ''}`
      const res = await fetch(buildApiUrl(statePath), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })

      if (!res.ok) {
        setEvents([])
        return
      }

      const { json } = await parseApiResponse<GovernanceStateResponse>(res)
      const nextEvents = Array.isArray(json?.state?.events) ? json.state.events : []

      setEvents(
        [...nextEvents].sort((a, b) => {
          const statusA = a.status ?? 'PUBLISHED'
          const statusB = b.status ?? 'PUBLISHED'
          if (statusA !== statusB) return statusA === 'DRAFT' ? -1 : 1
          if (a.startsAt === b.startsAt) return a.createdAt < b.createdAt ? -1 : 1
          return a.startsAt < b.startsAt ? -1 : 1
        }),
      )
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [mode, orgApiPath, token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const { start, end } = buildPresetRange('this_week')
    setStartDate(start)
    setEndDate(end)
  }, [])

  const publishedEvents = useMemo(() => events.filter((event) => (event.status ?? 'PUBLISHED') !== 'DRAFT'), [events])
  const draftEvents = useMemo(() => (mode === 'manage' ? events.filter((event) => (event.status ?? 'PUBLISHED') === 'DRAFT') : []), [events, mode])

  const filteredPublishedEvents = useMemo(() => {
    const startBoundary = startDate ? new Date(`${startDate}T00:00:00`) : null
    const endBoundary = endDate ? new Date(`${endDate}T23:59:59.999`) : null

    return publishedEvents.filter((event) => {
      const startsAt = new Date(event.startsAt)
      const category = event.category ?? DEFAULT_EVENT_CATEGORY

      if (selectedCategories.length > 0 && !selectedCategories.includes(category)) {
        return false
      }

      if (startBoundary && startsAt < startBoundary) return false
      if (endBoundary && startsAt > endBoundary) return false

      return true
    })
  }, [endDate, publishedEvents, selectedCategories, startDate])

  const categoryLabel = useMemo(() => {
    if (selectedCategories.length === 0) return 'All'
    if (selectedCategories.length === 1) return selectedCategories[0]
    return `${selectedCategories.length} selected`
  }, [selectedCategories])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, GovernanceEvent[]>()
    for (const event of filteredPublishedEvents) {
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
  }, [filteredPublishedEvents])

  const calendarWeeks = useMemo(() => buildCalendarGrid(calendarMonth), [calendarMonth])
  const selectedDayEvents = useMemo(() => eventsByDay.get(selectedDayKey) ?? [], [eventsByDay, selectedDayKey])
  const monthLabel = useMemo(
    () => calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [calendarMonth],
  )
  const selectedDayLabel = useMemo(() => {
    const [year, month, day] = selectedDayKey.split('-').map((part) => Number(part))
    if (!year || !month || !day) return selectedDayKey
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [selectedDayKey])

  const submitRsvp = useCallback(
    async (eventId: string, status: 'GOING' | 'INTERESTED' | 'DECLINED', ticketType: 'FREE' | 'PAID') => {
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setRsvpBusyId(eventId)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/governance/events/${encodeURIComponent(eventId)}/rsvp`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ status, ticketType }),
        })

        const { json } = await parseApiResponse<{ error?: unknown }>(res)
        if (!res.ok) {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to RSVP right now.', 'error')
          return
        }

        pushToast(`RSVP updated to ${status}.`, 'success')
      } catch {
        pushToast('Unable to RSVP right now.', 'error')
      } finally {
        setRsvpBusyId(null)
      }
    },
    [orgApiPath, token],
  )

  return (
    <div className="space-y-6">
      {mode === 'manage' ? (
        <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-4 shadow-subtle">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Manage Events</h3>
            <p className="text-xs text-slate-500">Drafts are visible here only.</p>
          </div>
          <Link
            href={manageCreateHref}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Create event
          </Link>
        </section>
      ) : null}

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

        {displayMode === 'calendar' ? (
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
                        <p className={inMonth ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-400'}>
                          {day.getDate()}
                        </p>
                        {dayEvents.length ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {dayEvents.length}
                          </span>
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
              <div>
                <p className="text-sm font-semibold text-slate-900">{selectedDayLabel}</p>
                <p className="text-xs text-slate-500">Events on this day.</p>
              </div>

              {loading ? <p className="mt-3 text-sm text-slate-500">Loading events…</p> : null}
              {!loading && !selectedDayEvents.length ? <p className="mt-3 text-sm text-slate-500">No events on this day.</p> : null}

              {selectedDayEvents.length ? (
                <ul className="mt-3 space-y-3">
                  {selectedDayEvents.map((event) => (
                    <li key={event.id} className="rounded-2xl bg-white p-3">
                      <Link href={eventDetailHref(event.id)} className="group block">
                        <article className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32 sm:w-60 sm:flex-none">
                            {event.primaryPhotoUrl ? <img src={event.primaryPhotoUrl} alt={event.title} className="h-full w-full object-cover" /> : null}
                          </div>

                          <div className="min-w-0 space-y-1.5">
                            <h3 className="text-xl font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)]">{event.title}</h3>
                            <p className="text-base text-slate-700">{formatStartsLabel(event.startsAt)}</p>
                            <p className="text-base text-slate-600">{toTitleCase(municipality)} · {toTitleCase(slug)}</p>
                            <p className="pt-1 text-lg font-semibold text-slate-800">
                              {event.paid
                                ? event.priceCents && event.priceCents > 0
                                  ? `From ${formatMoney(event.priceCents)}`
                                  : 'Check ticket price on event'
                                : 'Free'}
                            </p>
                            {event.guestSpeakers.length ? (
                              <p className="text-xs text-slate-500">Speakers: {event.guestSpeakers.join(', ')}</p>
                            ) : null}
                            {event.sponsors?.length ? (
                              <p className="text-xs text-slate-500">Sponsors: {event.sponsors.map((sponsor) => sponsor.name).join(', ')}</p>
                            ) : null}
                            <p className="text-xs text-slate-500">{event.category ?? DEFAULT_EVENT_CATEGORY}</p>
                          </div>
                        </article>
                      </Link>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void submitRsvp(event.id, 'GOING', event.paid ? 'PAID' : 'FREE')}
                          disabled={rsvpBusyId === event.id}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {rsvpBusyId === event.id ? 'Saving…' : 'RSVP Going'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitRsvp(event.id, 'INTERESTED', event.paid ? 'PAID' : 'FREE')}
                          disabled={rsvpBusyId === event.id}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Interested
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitRsvp(event.id, 'DECLINED', event.paid ? 'PAID' : 'FREE')}
                          disabled={rsvpBusyId === event.id}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {mode === 'manage' && draftEvents.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Drafts</p>
                <ul className="mt-2 space-y-2">
                  {draftEvents.map((event) => (
                    <li key={event.id} className="rounded-2xl bg-white p-3">
                      <article className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32 sm:w-60 sm:flex-none">
                          {event.primaryPhotoUrl ? <img src={event.primaryPhotoUrl} alt={event.title} className="h-full w-full object-cover" /> : null}
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xl font-semibold tracking-tight text-slate-900">{event.title || 'Untitled event'}</h3>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Draft</span>
                          </div>
                          <p className="text-base text-slate-700">{formatStartsLabel(event.startsAt)}</p>
                          <p className="text-base text-slate-600">{toTitleCase(municipality)} · {toTitleCase(slug)}</p>
                          <p className="text-xs text-slate-500">Last updated {new Date(event.updatedAt ?? event.createdAt).toLocaleString()}</p>
                        </div>
                      </article>

                      <div className="mt-3">
                        <Link
                          href={manageEditHref(event.id)}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Continue editing
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              {loading ? <p className="text-sm text-slate-500">Loading events…</p> : null}
              {!loading && !filteredPublishedEvents.length ? <p className="text-sm text-slate-500">No events found for these filters.</p> : null}

              {filteredPublishedEvents.length ? (
                <ul className="space-y-3">
                  {filteredPublishedEvents.map((event) => (
                    <li key={event.id} className="rounded-2xl bg-white p-3">
                      <Link href={eventDetailHref(event.id)} className="group block">
                        <article className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32 sm:w-60 sm:flex-none">
                            {event.primaryPhotoUrl ? <img src={event.primaryPhotoUrl} alt={event.title} className="h-full w-full object-cover" /> : null}
                          </div>

                          <div className="min-w-0 space-y-1.5">
                            <h3 className="text-xl font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)]">{event.title}</h3>
                            <p className="text-base text-slate-700">{formatStartsLabel(event.startsAt)}</p>
                            <p className="text-base text-slate-600">{toTitleCase(municipality)} · {toTitleCase(slug)}</p>
                            <p className="pt-1 text-lg font-semibold text-slate-800">
                              {event.paid
                                ? event.priceCents && event.priceCents > 0
                                  ? `From ${formatMoney(event.priceCents)}`
                                  : 'Check ticket price on event'
                                : 'Free'}
                            </p>
                            {event.guestSpeakers.length ? (
                              <p className="text-xs text-slate-500">Speakers: {event.guestSpeakers.join(', ')}</p>
                            ) : null}
                            {event.sponsors?.length ? (
                              <p className="text-xs text-slate-500">Sponsors: {event.sponsors.map((sponsor) => sponsor.name).join(', ')}</p>
                            ) : null}
                            <p className="text-xs text-slate-500">{event.category ?? DEFAULT_EVENT_CATEGORY}</p>
                          </div>
                        </article>
                      </Link>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void submitRsvp(event.id, 'GOING', event.paid ? 'PAID' : 'FREE')}
                          disabled={rsvpBusyId === event.id}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {rsvpBusyId === event.id ? 'Saving…' : 'RSVP Going'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitRsvp(event.id, 'INTERESTED', event.paid ? 'PAID' : 'FREE')}
                          disabled={rsvpBusyId === event.id}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Interested
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitRsvp(event.id, 'DECLINED', event.paid ? 'PAID' : 'FREE')}
                          disabled={rsvpBusyId === event.id}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
