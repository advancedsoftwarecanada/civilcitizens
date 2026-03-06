'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'

type MeetingItem = {
  id: string
  instanceKey?: string
  title?: string
  description?: string | null
  visibility?: 'PUBLIC' | 'PRIVATE'
  status?: 'ACTIVE' | 'ARCHIVED'
  requiresPassword?: boolean
  requiresManualAdmit?: boolean
  participantCount?: number | null
  canJoinNow?: boolean
  blockedReason?: string | null
  schedule?: {
    startsAt?: string | null
    endsAt?: string | null
  }
}

type MeetingsResponse = {
  viewer?: {
    canManageMeetings?: boolean
  }
  items?: MeetingItem[]
}

type Mode = 'view' | 'manage'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function toDayKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseIsoToDate(iso: string | null | undefined) {
  if (!iso) return null
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, deltaMonths: number) {
  return new Date(date.getFullYear(), date.getMonth() + deltaMonths, 1)
}

function buildCalendarGrid(month: Date) {
  const first = startOfMonth(month)
  const firstDay = first.getDay()
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - firstDay)

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

function formatSelectedDayLabel(dayKey: string) {
  const [yearRaw, monthRaw, dayRaw] = dayKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dayKey
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function getMeetingStartDate(meeting: MeetingItem) {
  return parseIsoToDate(meeting.schedule?.startsAt ?? null)
}

function getMeetingEndDate(meeting: MeetingItem) {
  return parseIsoToDate(meeting.schedule?.endsAt ?? null)
}

function isMeetingInSession(meeting: MeetingItem, nowMs: number) {
  const startsAt = getMeetingStartDate(meeting)
  if (!startsAt) return false
  const endsAt = getMeetingEndDate(meeting)
  const startMs = startsAt.getTime()
  if (startMs > nowMs) return false
  if (endsAt && endsAt.getTime() <= nowMs) return false
  return true
}

function sortMeetingsBySchedule(a: MeetingItem, b: MeetingItem, nowMs: number) {
  const aDraft = a.status === 'ARCHIVED'
  const bDraft = b.status === 'ARCHIVED'
  if (aDraft !== bDraft) return aDraft ? 1 : -1

  const aInSession = isMeetingInSession(a, nowMs)
  const bInSession = isMeetingInSession(b, nowMs)
  if (aInSession !== bInSession) return aInSession ? -1 : 1

  const aDate = getMeetingStartDate(a)
  const bDate = getMeetingStartDate(b)

  if (!aDate && bDate) return -1
  if (aDate && !bDate) return 1
  if (!aDate && !bDate) return (a.title || 'Untitled meeting').localeCompare(b.title || 'Untitled meeting')
  if (!aDate || !bDate) return (a.title || 'Untitled meeting').localeCompare(b.title || 'Untitled meeting')

  const aMs = aDate.getTime()
  const bMs = bDate.getTime()
  const aFuture = aMs > nowMs
  const bFuture = bMs > nowMs

  if (aFuture && bFuture && aMs !== bMs) return aMs - bMs
  if (!aFuture && !bFuture && aMs !== bMs) return bMs - aMs
  if (aFuture !== bFuture) return aFuture ? 1 : -1

  return (a.title || 'Untitled meeting').localeCompare(b.title || 'Untitled meeting')
}

export default function OrganizationMeetingsClient({
  mode,
  province,
  municipality,
  slug,
}: {
  mode: Mode
  province: string
  municipality: string
  slug: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [data, setData] = useState<MeetingsResponse | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [displayMode, setDisplayMode] = useState<'calendar' | 'list'>('list')
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => toDayKey(new Date()))

  const basePath = useMemo(
    () => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/meetings`,
    [province, municipality, slug],
  )

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const token = getStoredToken()
      const meetingsUrl = buildApiUrl(
        `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/meetings`,
      )
      const url = new URL(
        meetingsUrl,
        typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
      )
      if (mode === 'manage') {
        url.searchParams.set('includeArchived', '1')
      }

      const fetchMeetings = (authToken: string | null) =>
        fetch(url.toString(), {
          headers: authToken ? { authorization: `Bearer ${authToken}` } : undefined,
          cache: 'no-store',
        })

      let res = await fetchMeetings(token)
      // Stale/invalid token should not hide public meetings in view mode.
      if (res.status === 401 && token && mode === 'view') {
        res = await fetchMeetings(null)
      }

      if (res.status === 401) {
        if (mode === 'manage') {
          redirectToAuthModal('login')
        }
        setData({ viewer: { canManageMeetings: false }, items: [] })
        setStatus('ready')
        return
      }

      const { json, text } = await parseApiResponse<MeetingsResponse & { error?: unknown }>(res)
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : text || `request_failed_${res.status}`
        console.warn('meetings_load_failed', message)
        setData((prev) => prev ?? { viewer: { canManageMeetings: false }, items: [] })
        setStatus('ready')
        return
      }
      setData(json ?? { viewer: { canManageMeetings: false }, items: [] })
      setStatus('ready')
    } catch (err) {
      console.error('meetings_load_failed', err)
      setData((prev) => prev ?? { viewer: { canManageMeetings: false }, items: [] })
      setStatus('ready')
    }
  }, [mode, municipality, province, slug])

  useEffect(() => {
    load()
  }, [load])

  const createDraft = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setIsCreating(true)
    try {
      const res = await fetch(
        buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/meetings`),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Untitled meeting',
            description: null,
            visibility: 'PUBLIC',
            requiresPassword: false,
            password: null,
            requiresManualAdmit: false,
            maxParticipants: 10,
            schedule: null,
            assignedMemberUserIds: [],
            status: 'ARCHIVED',
          }),
        },
      )
      const { json, text } = await parseApiResponse<any>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : text || 'Unable to create meeting draft.'
        pushToast(message, 'error')
        return
      }
      const meetingId = String(json?.meeting?.id || '')
      if (!meetingId) {
        pushToast('Draft created, but missing meeting id.', 'error')
        return
      }
      router.push(`${basePath}/manage/${encodeURIComponent(meetingId)}`)
    } catch (err) {
      console.error('meeting_draft_create_failed', err)
      pushToast('Unable to create meeting draft right now.', 'error')
    } finally {
      setIsCreating(false)
    }
  }, [basePath, municipality, province, router, slug])

  const items = useMemo(() => {
    const nowMs = Date.now()
    const raw = Array.isArray(data?.items) ? data.items.filter(Boolean) : []
    return [...raw].sort((a, b) => sortMeetingsBySchedule(a, b, nowMs))
  }, [data?.items])
  const canManage = Boolean(data?.viewer?.canManageMeetings)
  const calendarWeeks = useMemo(() => buildCalendarGrid(calendarMonth), [calendarMonth])
  const monthLabel = useMemo(
    () => calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [calendarMonth],
  )
  const selectedDayLabel = useMemo(() => formatSelectedDayLabel(selectedDayKey), [selectedDayKey])

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, MeetingItem[]>()
    for (const meeting of items) {
      const startDate = getMeetingStartDate(meeting)
      if (!startDate) continue
      const dayKey = toDayKey(startDate)
      const existing = map.get(dayKey)
      if (existing) existing.push(meeting)
      else map.set(dayKey, [meeting])
    }
    return map
  }, [items])

  const selectedDayMeetings = useMemo(() => meetingsByDay.get(selectedDayKey) ?? [], [meetingsByDay, selectedDayKey])

  const unscheduledMeetings = useMemo(() => items.filter((meeting) => !getMeetingStartDate(meeting)), [items])

  const renderMeetingCard = useCallback(
    (meeting: MeetingItem) => {
      const title = (meeting.title || 'Untitled meeting').trim() || 'Untitled meeting'
      const isDraft = meeting.status === 'ARCHIVED'
      const joinDisabled = meeting.canJoinNow === false
      const joinLabel = joinDisabled ? meeting.blockedReason || 'Not open' : 'Join'
      const startsAt = getMeetingStartDate(meeting)
      const endsAt = getMeetingEndDate(meeting)
      const inSession = isMeetingInSession(meeting, Date.now())
      const scheduleLabel = startsAt
        ? startsAt.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'Schedule TBD'
      const scheduleEndLabel = endsAt
        ? endsAt.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : null

      return (
        <div
          key={meeting.instanceKey || meeting.id}
          data-testid="meeting-card"
          data-meeting-id={meeting.id}
          className="rounded-2xl border border-slate-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p data-testid="meeting-title" className="truncate text-sm font-semibold text-slate-900">
                {title}
              </p>
              <p className="mt-1 text-xs text-slate-500">{scheduleLabel}</p>
              {scheduleEndLabel ? <p className="mt-1 text-xs text-slate-500">Ends {scheduleEndLabel}</p> : null}
              {meeting.description ? <p className="mt-1 text-sm text-slate-500">{meeting.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {inSession ? (
                  <span
                    data-testid="meeting-in-session"
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700"
                  >
                    IN SESSION
                  </span>
                ) : null}
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{meeting.visibility || 'PUBLIC'}</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{isDraft ? 'DRAFT' : 'LIVE'}</span>
                {typeof meeting.participantCount === 'number' ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{meeting.participantCount} in chat</span>
                ) : null}
                {meeting.requiresPassword ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Password</span> : null}
                {meeting.requiresManualAdmit ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Manual admit</span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {mode === 'manage' ? (
                <Link
                  href={`${basePath}/manage/${encodeURIComponent(meeting.id)}`}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Edit
                </Link>
              ) : null}

              <Link
                href={`${basePath}/${encodeURIComponent(meeting.id)}`}
                aria-disabled={joinDisabled}
                className={
                  joinDisabled
                    ? 'pointer-events-none rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-400'
                    : 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                }
              >
                {joinLabel}
              </Link>
            </div>
          </div>
        </div>
      )
    },
    [basePath, mode],
  )

  return (
    <div className="space-y-4">
      {mode === 'manage' ? (
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <button
              type="button"
              onClick={createDraft}
              disabled={isCreating}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isCreating ? 'Creating…' : 'Create draft'}
            </button>
          ) : null}

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
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <>
              <button
                type="button"
                onClick={createDraft}
                disabled={isCreating}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isCreating ? 'Creating…' : 'Create draft'}
              </button>
              <Link
                href={`${basePath}/manage`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Manage
              </Link>
            </>
          ) : null}

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
      )}

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading meetings…</p> : null}

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
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarWeeks.flat().map((day) => {
                const dayKey = toDayKey(day)
                const dayMeetings = meetingsByDay.get(dayKey) ?? []
                const inMonth = day.getMonth() === calendarMonth.getMonth()
                const isSelected = dayKey === selectedDayKey

                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => setSelectedDayKey(dayKey)}
                    className={
                      'min-h-24 border-b border-r border-slate-100 px-3 py-2 text-left transition-colors hover:bg-slate-50' +
                      (isSelected ? ' bg-slate-50' : '')
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={inMonth ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-400'}>{day.getDate()}</p>
                      {dayMeetings.length ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {dayMeetings.length}
                        </span>
                      ) : null}
                    </div>
                    {dayMeetings.slice(0, 2).map((meeting) => (
                      <p key={meeting.id} className="mt-1 truncate text-[11px] font-semibold text-slate-700">
                        {meeting.title || 'Untitled meeting'}
                      </p>
                    ))}
                    {dayMeetings.length > 2 ? <p className="mt-1 text-[11px] text-slate-500">+{dayMeetings.length - 2} more</p> : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">{selectedDayLabel}</p>
            <p className="text-xs text-slate-500">Scheduled meetings.</p>

            {!selectedDayMeetings.length ? <p className="mt-3 text-sm text-slate-500">No scheduled meetings on this day.</p> : null}

            {selectedDayMeetings.length ? <div className="mt-3 grid gap-3">{selectedDayMeetings.map(renderMeetingCard)}</div> : null}
          </div>

          {unscheduledMeetings.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Unscheduled meeting rooms</p>
              <p className="text-xs text-slate-500">These rooms are available without a specific start time.</p>
              <div className="mt-3 grid gap-3">{unscheduledMeetings.map(renderMeetingCard)}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map(renderMeetingCard)}
        </div>
      )}
    </div>
  )
}
